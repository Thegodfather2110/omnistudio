'use strict';
/**
 * Arena (multi-model race): send one prompt to several models/combos at the same time,
 * then rank the answers on quality: completeness, relevance, structure, cleanliness and speed.
 * An optional "judge" model can add its own 0-10 scores, blended 50/50 with the heuristics.
 */
const omni = require('./omni');

const STOP = new Set('the a an and or but if then of to in on for with without from by at as is are was were be been being it its this that these those i you he she we they my your our their do does did can could should would will just about into over under than so not no yes how what why when where which who whom'.split(' '));

function words(text) {
  return (String(text).toLowerCase().match(/[a-z0-9_]{3,}/g) || []).filter((w) => !STOP.has(w));
}

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function wantsCode(prompt) {
  return /```|\b(code|function|script|html|css|python|javascript|typescript|sql|regex|api|class|implement|program)\b/i.test(prompt);
}

function heuristicScores(prompt, results) {
  const ok = results.filter((r) => r.ok && r.content.trim());
  const lens = ok.map((r) => r.content.length);
  const medLen = median(lens) || 1;
  const times = ok.map((r) => r.ms);
  const fastest = Math.min(...times, Infinity);
  const promptWords = new Set(words(prompt));
  const code = wantsCode(prompt);

  return results.map((r) => {
    if (!r.ok || !r.content.trim()) return { total: 0, parts: { completeness: 0, relevance: 0, structure: 0, cleanliness: 0, speed: 0 } };
    const text = r.content;

    // completeness (25): close to or above the median length, but diminishing returns; truncation hurts
    const ratio = text.length / medLen;
    let completeness = 25 * Math.min(1, ratio / 0.9) * (ratio > 2.5 ? 0.85 : 1);
    if (r.finish === 'length') completeness *= 0.6;

    // relevance (25): share of prompt keywords that show up in the answer
    const answerWords = new Set(words(text));
    let hit = 0;
    for (const w of promptWords) if (answerWords.has(w)) hit++;
    const relevance = promptWords.size ? 25 * Math.min(1, (hit / promptWords.size) / 0.6) : 18;

    // structure (20): headings / lists / paragraphs; code blocks when code was requested
    let structure = 6;
    if (/^#{1,4}\s/m.test(text)) structure += 4;
    if (/^\s*(?:[-*]|\d+\.)\s+/m.test(text)) structure += 4;
    if (text.split(/\n\n+/).length >= 3) structure += 3;
    if (code) structure += /```[\s\S]+```/.test(text) ? 3 : -6;
    else structure += 3;
    structure = Math.max(0, Math.min(20, structure));

    // cleanliness (15): no repeated sentences, no rambling filler
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim().toLowerCase()).filter((s) => s.length > 20);
    const uniq = new Set(sentences).size;
    const repetition = sentences.length ? uniq / sentences.length : 1;
    let cleanliness = 15 * repetition;
    if (/^\s*(sure|of course|certainly|great question)[!,.]/i.test(text)) cleanliness -= 2;

    // speed (15): relative to the fastest successful model
    const speed = 15 * Math.min(1, fastest / Math.max(r.ms, 1));

    const parts = { completeness, relevance, structure, cleanliness: Math.max(0, cleanliness), speed };
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    for (const k of Object.keys(parts)) parts[k] = Math.round(parts[k] * 10) / 10;
    return { total: Math.round(total * 10) / 10, parts };
  });
}

async function askOne(model, messages, params, signal) {
  const t0 = Date.now();
  try {
    const body = { model, messages, stream: false, ...params };
    const resp = await omni.postJson('/chat/completions', body, { signal });
    if (!resp.ok) return { model, ok: false, error: await omni.readError(resp), ms: Date.now() - t0, content: '' };
    const j = await resp.json();
    const choice = (j.choices && j.choices[0]) || {};
    const msg = choice.message || {};
    return {
      model,
      ok: true,
      content: msg.content || '',
      reasoning: msg.reasoning_content || msg.reasoning || '',
      finish: choice.finish_reason || '',
      usage: j.usage || null,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { model, ok: false, error: omni.describeNetworkError(e), ms: Date.now() - t0, content: '' };
  }
}

async function judge(judgeModel, prompt, results, signal) {
  const candidates = results.map((r, i) => ({ id: i + 1, r })).filter((x) => x.r.ok && x.r.content.trim());
  if (candidates.length < 2) return null;
  const body = candidates.map((x) => `### Answer ${x.id}\n${x.r.content.slice(0, 6000)}`).join('\n\n');
  const messages = [
    {
      role: 'system',
      content: 'You are a strict, fair evaluator. Score each answer to the user prompt from 0 to 10 for correctness, helpfulness and clarity. Reply with ONLY a JSON object mapping the answer number to its score, like {"1": 7, "2": 9}.',
    },
    { role: 'user', content: `User prompt:\n${prompt}\n\n${body}` },
  ];
  const out = await askOne(judgeModel, messages, { temperature: 0 }, signal);
  if (!out.ok) return { error: out.error };
  const m = out.content.match(/\{[\s\S]*\}/);
  if (!m) return { error: 'Judge did not return JSON' };
  try {
    const parsed = JSON.parse(m[0]);
    const scores = {};
    for (const x of candidates) {
      const v = Number(parsed[String(x.id)]);
      if (Number.isFinite(v)) scores[x.id - 1] = Math.max(0, Math.min(10, v));
    }
    return { scores };
  } catch {
    return { error: 'Judge returned invalid JSON' };
  }
}

/**
 * Runs the race. `emit` is called with each event: {type:'result',index,result} as models finish,
 * then {type:'done', ranking:[...], judge:{...}}.
 */
async function run({ models, messages, params, judgeModel, signal, prepare }, emit) {
  const prompt = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const results = new Array(models.length);
  await Promise.all(
    models.map(async (model, index) => {
      const r = await askOne(model, prepare ? prepare(model, messages) : messages, params || {}, signal);
      results[index] = r;
      emit({ type: 'result', index, result: r });
    })
  );
  const heur = heuristicScores(typeof prompt === 'string' ? prompt : JSON.stringify(prompt), results);
  let judgeInfo = null;
  if (judgeModel) judgeInfo = await judge(judgeModel, String(prompt), results, signal);
  const ranking = results.map((r, i) => {
    let score = heur[i].total;
    let judgeScore = null;
    if (judgeInfo && judgeInfo.scores && judgeInfo.scores[i] != null) {
      judgeScore = judgeInfo.scores[i];
      score = Math.round((heur[i].total * 0.5 + judgeScore * 10 * 0.5) * 10) / 10;
    }
    return { index: i, model: r.model, ok: r.ok, score, parts: heur[i].parts, judgeScore, ms: r.ms };
  });
  ranking.sort((a, b) => b.score - a.score);
  emit({ type: 'done', ranking, judge: judgeInfo && judgeInfo.error ? { error: judgeInfo.error } : judgeInfo ? { used: judgeModel } : null });
}

module.exports = { run, heuristicScores, askOne };
