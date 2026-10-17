'use strict';
/**
 * Team mode: several models/combos work on one project, each on the tasks it is best at.
 *
 *   roster     data/team.json - who is on the team, a 0-100 score per capability (guessed, typed in, or measured by the
 *              benchmark), plus a running pass-rate learned from real tasks.
 *   plan       a lead model splits the goal into tasks (capability, dependencies, deliverable files, acceptance checks).
 *   schedule   ready tasks run in parallel; each goes to the best FREE model for its capability (not just the single best,
 *              so nobody sits idle while one favourite is overloaded). Tasks that touch the same file are serialized.
 *   quality    every task passes gates: deliverables must exist -> a different model reviews the work -> on failure the
 *              task is retried with the reviewer's feedback, then handed to the next-best model.
 *   integrate  a last task checks the finished project as a whole.
 *
 * No system can promise 100% correctness. What this does is put the right model on the right task and refuse to
 * accept work that has not been checked.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const config = require('./config');
const race = require('./race');
const agent = require('./agent');
const runs = require('./runs');
const skills = require('./skills');

const TEAM_FILE = path.join(config.DATA_DIR, 'team.json');

const CAPS = ['coding', 'webdesign', 'reasoning', 'writing', 'research', 'review'];
const DERIVED = ['research', 'integration']; // no direct probe: computed from other scores
const CAP_LABELS = { coding: 'Coding', webdesign: 'Web design', reasoning: 'Reasoning / math', writing: 'Writing', research: 'Research', review: 'Code & work review' };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* -------------------------------- roster -------------------------------- */

function emptyRoster() {
  return { models: {}, lead: '', reviewer: '' };
}

function loadRoster() {
  const r = config.readJson(TEAM_FILE, null);
  return r && typeof r === 'object' ? { ...emptyRoster(), ...r, models: r.models || {} } : emptyRoster();
}

function saveRoster(r) {
  config.writeJsonAtomic(TEAM_FILE, r);
  return r;
}

/** Name-based starting guess. Always labelled "guess" in the UI and replaced by the benchmark or by manual edits. */
function guessScores(id) {
  const n = String(id).toLowerCase();
  const s = { coding: 50, webdesign: 50, reasoning: 50, writing: 50, review: 50 };
  const src = {};
  const bump = (re, caps, v) => { if (re.test(n)) for (const c of caps) { s[c] = Math.max(s[c], v); src[c] = 'guess'; } };
  bump(/cod(e|er|ing)|dev|program|engineer/, ['coding', 'review'], 70);
  bump(/reason|think|\br1\b|\bo[134]\b|math|logic|deep/, ['reasoning', 'review'], 70);
  bump(/design|web|ui|front/, ['webdesign'], 70);
  bump(/writ|creative|story|chat|prose/, ['writing'], 68);
  return { scores: s, source: src };
}

function entryFor(r, id) {
  if (!r.models[id]) {
    const g = guessScores(id);
    r.models[id] = { enabled: false, scores: g.scores, source: g.source, speedMs: null, concurrency: 1, stats: {} };
  }
  return r.models[id];
}

/** Models that cannot do text work (video, image, speech, embeddings...). They are listed but never switched on in bulk. */
const NON_TEXT = /video|image|img\b|imagen|embed|tts|speech|whisper|audio|rerank|moderation|\bocr\b|music|sora|veo\b|flux|dall-?e|diffusion|stable-?diff|midjourney|kling|runway|suno/i;
const isTextModel = (id) => !NON_TEXT.test(String(id));

/** Public view of the roster; every known model/combo id gets an entry so the UI can list them all. */
function rosterView(knownIds = []) {
  const r = loadRoster();
  let changed = false;
  for (const id of knownIds) {
    if (!r.models[id]) {
      entryFor(r, id);
      changed = true;
    }
  }
  if (changed) saveRoster(r);
  const view = { ...r, models: {} };
  for (const [id, e] of Object.entries(r.models)) view.models[id] = { ...e, nonText: !isTextModel(id) };
  return view;
}

function updateRoster(patch) {
  const r = loadRoster();
  if (typeof patch.lead === 'string') r.lead = patch.lead;
  if (typeof patch.reviewer === 'string') r.reviewer = patch.reviewer;
  for (const [id, p] of Object.entries(patch.models || {})) {
    if (!id || id.length > 200) continue;
    const e = entryFor(r, id);
    if (typeof p.enabled === 'boolean') e.enabled = p.enabled;
    if (p.concurrency !== undefined) e.concurrency = clamp(Math.round(Number(p.concurrency) || 1), 1, 4);
    for (const [cap, v] of Object.entries(p.scores || {})) {
      if (!CAPS.includes(cap)) continue;
      const num = Number(v);
      if (!Number.isFinite(num)) continue;
      e.scores[cap] = clamp(Math.round(num), 0, 100);
      e.source[cap] = 'manual';
    }
  }
  if (patch.remove && Array.isArray(patch.remove)) for (const id of patch.remove) delete r.models[id];
  return saveRoster(r);
}

function capScore(entry, cap) {
  const s = entry.scores || {};
  const v = (c) => (typeof s[c] === 'number' ? s[c] : 50);
  if (cap === 'research') return typeof s.research === 'number' ? s.research : Math.round(0.5 * v('reasoning') + 0.5 * v('writing'));
  if (cap === 'integration') return Math.round((v('coding') + v('review') + v('reasoning')) / 3);
  if (CAPS.includes(cap)) return v(cap);
  return Math.round(CAPS.filter((c) => c !== 'research').reduce((n, c) => n + v(c), 0) / 5); // "general"
}

/** How well a model fits a capability: its score, reliability on strict formats, and what real tasks taught us. */
function fit(entry, cap) {
  let f = 0.85 * capScore(entry, cap) + 0.15 * (typeof entry.scores.instructions === 'number' ? entry.scores.instructions : 60);
  const st = (entry.stats || {})[cap];
  if (st && st.n >= 3) f *= 0.7 + 0.3 * (st.pass / st.n); // learned from real outcomes
  return Math.round(f * 10) / 10;
}

function enabledModels(r) {
  return Object.entries(r.models).filter(([, e]) => e.enabled).map(([id]) => id);
}

function recordOutcome(model, cap, passed) {
  const r = loadRoster();
  const e = r.models[model];
  if (!e) return;
  const st = ((e.stats ||= {})[cap] ||= { n: 0, pass: 0 });
  st.n++;
  if (passed) st.pass++;
  saveRoster(r);
}

function ranking(r, cap, exclude = []) {
  return enabledModels(r).filter((m) => !exclude.includes(m)).map((m) => ({ model: m, fit: fit(r.models[m], cap) })).sort((a, b) => b.fit - a.fit);
}

/* ------------------------------- benchmark ------------------------------- */

function extractCode(text) {
  const m = String(text).match(/```(?:js|javascript|node|ts|typescript)?[^\n]*\n([\s\S]*?)```/i);
  return (m ? m[1] : String(text)).trim();
}

/** Run model-written JavaScript against test cases in a child process (timeout, no secrets in env). */
function runJsCases(code, fnName, cases) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-bench-'));
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
    fs.writeFileSync(path.join(dir, 'code.txt'), code);
    fs.writeFileSync(path.join(dir, 'run.js'), `
const fs = require('fs');
let code = fs.readFileSync(__dirname + '/code.txt', 'utf8').replace(/^\\s*export\\s+default\\s+/mg, '').replace(/^\\s*export\\s+/mg, '');
const cases = ${JSON.stringify(cases)};
let fn;
try {
  const mod = { exports: {} };
  fn = new Function('module', 'exports', code + '\\n;return typeof ${fnName} === "function" ? ${fnName} : (typeof module.exports === "function" ? module.exports : module.exports && module.exports.${fnName});')(mod, mod.exports);
} catch (e) { console.log(JSON.stringify({ passed: 0, total: cases.length, error: String(e.message) })); process.exit(0); }
if (typeof fn !== 'function') { console.log(JSON.stringify({ passed: 0, total: cases.length, error: 'function ${fnName} not found' })); process.exit(0); }
let passed = 0;
for (const [args, want] of cases) { try { if (JSON.stringify(fn(...args)) === JSON.stringify(want)) passed++; } catch {} }
console.log(JSON.stringify({ passed, total: cases.length }));
`);
    // Model-written code must not be able to touch the computer. Node's permission model (Node 20+) denies file writes,
    // reading anything outside the temp folder, and starting processes. Network access is not covered by it.
    const flags = [];
    const allowed = process.allowedNodeEnvironmentFlags;
    if (allowed.has('--permission')) flags.push('--permission', `--allow-fs-read=${dir}`);
    else if (allowed.has('--experimental-permission')) flags.push('--experimental-permission', `--allow-fs-read=${dir}`);
    const child = spawn(process.execPath, [...flags, path.join(dir, 'run.js')], { cwd: dir, env: { PATH: process.env.PATH || '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    child.on('close', () => {
      clearTimeout(timer);
      cleanup();
      try {
        resolve(JSON.parse(out.trim().split('\n').pop()));
      } catch {
        resolve({ passed: 0, total: cases.length, error: 'crashed or timed out' });
      }
    });
    child.on('error', () => { clearTimeout(timer); cleanup(); resolve({ passed: 0, total: cases.length, error: 'could not run' }); });
  });
}

const words = (t) => (String(t).trim().match(/\S+/g) || []).length;
const finalAnswer = (t) => (String(t).match(/FINAL:\s*(.+)/i) || [])[1] || '';

const PROBES = [
  {
    id: 'code-twosum', cap: 'coding', prompt: 'Write a JavaScript function named solve(nums, target) that returns the indices [i, j] (with i < j) of the two numbers in the array that add up to target, or null if there is no such pair. Output only the code in one ```js block. Plain JavaScript, no export statements.',
    check: async (t) => {
      const r = await runJsCases(extractCode(t), 'solve', [[[[2, 7, 11, 15], 9], [0, 1]], [[[3, 2, 4], 6], [1, 2]], [[[3, 3], 6], [0, 1]], [[[1, 2, 3], 7], null], [[[-1, -2, -3, -4, -5], -8], [2, 4]]]);
      return r.passed / r.total;
    },
  },
  {
    id: 'code-substring', cap: 'coding', prompt: 'Write a JavaScript function named solve(s) that returns the length of the longest substring of s without repeating characters. Output only the code in one ```js block. Plain JavaScript, no export statements.',
    check: async (t) => {
      const r = await runJsCases(extractCode(t), 'solve', [[['abcabcbb'], 3], [['bbbbb'], 1], [['pwwkew'], 3], [[''], 0], [['dvdf'], 3]]);
      return r.passed / r.total;
    },
  },
  {
    id: 'reason-trains', cap: 'reasoning', prompt: 'A train leaves a station at 09:00 travelling at 60 km/h. A second train leaves the same station on the same track in the same direction at 10:30 travelling at 90 km/h. At what clock time (24-hour, hh:mm) does the second train catch the first? Think it through, then end your reply with a line exactly like: FINAL: hh:mm',
    check: (t) => (/13:30|1:30\s*pm/i.test(finalAnswer(t)) ? 1 : 0),
  },
  {
    id: 'reason-sum', cap: 'reasoning', prompt: 'What is the sum of all integers from 1 to 200 (inclusive) that are divisible by 3 or by 5? Work it out carefully, then end your reply with a line exactly like: FINAL: <number>',
    check: (t) => (finalAnswer(t).replace(/[,\s]/g, '').match(/\d+/) || [])[0] === '9368' ? 1 : 0,
  },
  {
    id: 'format-json', cap: 'instructions', prompt: 'Reply with ONLY a JSON object - no prose, no code fences - that has exactly these keys: "city" (a string), "rank" (an integer from 1 to 10), "tags" (an array of exactly three lowercase strings). Choose any city.',
    check: (t) => {
      try {
        const o = JSON.parse(String(t).trim());
        const keys = Object.keys(o).sort().join(',');
        return keys === 'city,rank,tags' && typeof o.city === 'string' && Number.isInteger(o.rank) && o.rank >= 1 && o.rank <= 10 && Array.isArray(o.tags) && o.tags.length === 3 && o.tags.every((x) => typeof x === 'string' && x === x.toLowerCase()) ? 1 : 0;
      } catch {
        return 0;
      }
    },
  },
  {
    id: 'write-bottle', cap: 'writing', judged: true, prompt: 'Write a product description of 90 to 120 words for a reusable steel water bottle that keeps drinks cold for 24 hours. It must mention the 24 hours. Use flowing prose: no bullet points, no headings.',
    check: (t) => {
      const w = words(t);
      return (w >= 80 && w <= 130 ? 0.4 : 0) + (!/^\s*([-*•]|\d+\.|#)/m.test(t) ? 0.3 : 0) + (/24/.test(t) ? 0.3 : 0);
    },
  },
  {
    id: 'web-pricing', cap: 'webdesign', judged: true, prompt: 'Create ONE self-contained HTML file (inline CSS, no external files) for a pricing section with three plans named Starter, Pro and Team. Each plan has a price and a call-to-action button. It must be responsive and use a media query. Output only the HTML in one ```html block.',
    check: (t) => {
      const h = String(t);
      return (/<!doctype html/i.test(h) ? 0.2 : 0) + (/<style/i.test(h) ? 0.15 : 0) + (/@media/i.test(h) ? 0.25 : 0) + (['starter', 'pro', 'team'].every((n) => h.toLowerCase().includes(n)) ? 0.2 : 0) + ((h.match(/<button/gi) || []).length >= 3 ? 0.2 : 0);
    },
  },
  {
    id: 'review-bug', cap: 'review', prompt: 'Review this JavaScript and list every bug you can find:\n\nfunction average(arr) {\n  let sum = 0;\n  for (let i = 0; i <= arr.length; i++) {\n    sum += arr[i];\n  }\n  return sum / arr.length;\n}',
    check: (t) => (/<=|off[- ]by[- ]one|out of (bounds|range)|undefined|NaN|arr\.length\s*\)?\s*(should|instead)/i.test(t) ? 0.7 : 0) + (/empty|zero length|length (is|of) 0|divide by zero|division by zero|0\/0/i.test(t) ? 0.3 : 0),
  },
];

async function judgeOne(judgeModel, prompt, answer, signal) {
  const out = await race.askOne(judgeModel, [
    { role: 'system', content: 'You are a strict evaluator. Score the answer to the task from 0 to 10 for quality (correctness, craft, following every instruction). Reply with ONLY a number.' },
    { role: 'user', content: `TASK:\n${prompt}\n\nANSWER:\n${String(answer).slice(0, 6000)}` },
  ], { temperature: 0 }, signal);
  if (!out.ok) return null;
  const n = Number((out.content.match(/\d+(?:\.\d+)?/) || [])[0]);
  return Number.isFinite(n) ? clamp(n, 0, 10) : null;
}

async function benchModel(model, { judgeModel, signal, onProbe }) {
  const per = {}; // cap -> [fractions]
  const times = [];
  for (const p of PROBES) {
    if (signal.aborted) break;
    const r = await race.askOne(model, [{ role: 'user', content: p.prompt }], { temperature: 0.2, max_tokens: 2500 }, signal);
    let frac = 0;
    let note = '';
    if (r.ok && r.content.trim()) {
      times.push(r.ms);
      let content = r.content.replace(/<think>[\s\S]*?<\/think>/gi, '');
      try { frac = await p.check(content); } catch { frac = 0; }
      if (p.judged && judgeModel) {
        const j = await judgeOne(judgeModel, p.prompt, content, signal);
        if (j !== null) { frac = 0.5 * frac + 0.5 * (j / 10); note = `judge ${j}/10`; }
      }
    } else {
      note = r.error || 'empty reply';
    }
    (per[p.cap] ||= []).push(frac);
    if (onProbe) onProbe({ model, probe: p.id, cap: p.cap, score: Math.round(frac * 100), ms: r.ms, ok: r.ok, note });
  }
  const scores = {};
  for (const [cap, arr] of Object.entries(per)) scores[cap] = Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100);
  const sorted = [...times].sort((a, b) => a - b);
  return { scores, speedMs: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null };
}

/** Benchmark several models (3 at a time) and save the results into the roster. */
async function runBenchmark({ run, models, judgeModel }) {
  const signal = run.abort.signal;
  const queue = [...models];
  const worker = async () => {
    while (queue.length && !signal.aborted) {
      const model = queue.shift();
      run.emit({ type: 'bench_start', model });
      const res = await benchModel(model, { judgeModel, signal, onProbe: (p) => run.emit({ type: 'bench_probe', ...p }) });
      if (signal.aborted) return;
      const r = loadRoster();
      const e = entryFor(r, model);
      for (const [cap, v] of Object.entries(res.scores)) {
        e.scores[cap] = v;
        e.source[cap] = 'measured';
      }
      if (res.speedMs) e.speedMs = res.speedMs;
      saveRoster(r);
      run.emit({ type: 'bench_done', model, scores: res.scores, speedMs: res.speedMs });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/* -------------------------------- planner -------------------------------- */

const PLANNER_SYSTEM = `You are the project planner for a team of AI specialists. Split the user's goal into tasks that individual specialists can finish on their own, working in one shared workspace folder.

Reply with ONLY a JSON object (no prose, no code fences) shaped exactly like:
{"summary": "one sentence describing the project",
 "tasks": [
  {"id": "t1", "title": "short title", "description": "what to do, specific enough to act on without asking questions",
   "capability": "coding|webdesign|reasoning|writing|research|review",
   "depends_on": [], "deliverables": ["relative/path/to/file.ext"], "acceptance": ["a check someone can verify"]}
 ]}

RULES
- 2 to 8 tasks. Each task is one focused piece of work, small enough for one session.
- capability is the skill the task mainly needs: coding (programs, scripts, APIs), webdesign (HTML/CSS/UI), reasoning (math, logic, algorithms, analysis), writing (docs, copy, README), research (finding facts on the web), review (testing and checking).
- Tasks that can happen at the same time must NOT write the same file. If two tasks need the same file, make one depend on the other.
- If tasks must agree on an interface (file names, function names, data format, API routes), the FIRST task writes that contract into a file (for example SPEC.md) and the others depend on it.
- deliverables are relative file paths the task creates or changes; always list them.
- acceptance are concrete, checkable statements (for example "running node app.js prints the sum"). Do not add a final integration task; one is added automatically.`;

function safeRel(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
  if (!s || s.includes('..') || /^[a-z]:/i.test(s) || s.length > 200) return null;
  return s;
}

function extractJson(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fenced ? fenced[1] : t;
  const a = src.indexOf('{');
  const b = src.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(src.slice(a, b + 1));
  } catch {
    return null;
  }
}

function normalizePlan(obj) {
  if (!obj || !Array.isArray(obj.tasks) || !obj.tasks.length) return null;
  const tasks = [];
  const seen = new Set();
  for (const [i, t] of obj.tasks.slice(0, 12).entries()) {
    let id = String(t.id || `t${i + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || `t${i + 1}`;
    while (seen.has(id)) id += 'x';
    seen.add(id);
    const cap = String(t.capability || '').toLowerCase();
    tasks.push({
      id,
      title: String(t.title || `Task ${i + 1}`).slice(0, 100),
      description: String(t.description || t.title || '').slice(0, 3000),
      capability: CAPS.includes(cap) ? cap : 'general',
      depends_on: Array.isArray(t.depends_on) ? t.depends_on.map((d) => String(d).toLowerCase()) : [],
      deliverables: (Array.isArray(t.deliverables) ? t.deliverables : []).map(safeRel).filter(Boolean).slice(0, 12),
      acceptance: (Array.isArray(t.acceptance) ? t.acceptance : []).map((a) => String(a).slice(0, 300)).slice(0, 6),
      model: typeof t.model === 'string' ? t.model : '',
    });
  }
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.depends_on = [...new Set(t.depends_on.filter((d) => ids.has(d) && d !== t.id))];

  // break dependency cycles: anything Kahn's algorithm cannot order loses its dependencies
  const remaining = new Set(tasks.map((t) => t.id));
  let progress = true;
  const done = new Set();
  while (progress) {
    progress = false;
    for (const t of tasks) if (remaining.has(t.id) && t.depends_on.every((d) => done.has(d))) { done.add(t.id); remaining.delete(t.id); progress = true; }
  }
  for (const t of tasks) if (remaining.has(t.id)) t.depends_on = [];

  // serialize tasks that would write the same file at the same time
  const reach = (from) => {
    const out = new Set();
    const stack = [...tasks.find((t) => t.id === from).depends_on];
    while (stack.length) {
      const d = stack.pop();
      if (out.has(d)) continue;
      out.add(d);
      stack.push(...tasks.find((t) => t.id === d).depends_on);
    }
    return out;
  };
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i], b = tasks[j];
      if (!a.deliverables.some((f) => b.deliverables.includes(f))) continue;
      if (reach(b.id).has(a.id) || reach(a.id).has(b.id)) continue;
      b.depends_on.push(a.id);
    }
  }
  return { summary: String(obj.summary || '').slice(0, 300), tasks };
}

async function makePlan(goal, leadModel, signal) {
  const messages = [{ role: 'system', content: PLANNER_SYSTEM }, { role: 'user', content: `PROJECT GOAL:\n${goal}` }];
  let lastErr = 'The planner did not return a usable plan.';
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await race.askOne(leadModel, skills.inject(messages, leadModel).messages, { temperature: 0.2, max_tokens: 4000 }, signal);
    if (!out.ok) { lastErr = out.error; continue; }
    const plan = normalizePlan(extractJson(out.content));
    if (plan) return plan;
    messages.push({ role: 'assistant', content: out.content }, { role: 'user', content: 'That was not valid. Reply with ONLY the JSON object described above.' });
  }
  throw new Error(lastErr);
}

function addIntegration(plan) {
  const base = plan.tasks.filter((t) => t.id !== 'integrate');
  const ids = base.map((t) => t.id);
  return {
    ...plan,
    tasks: [...base, {
      id: 'integrate', title: 'Integrate and verify the whole project',
      description: 'Check that the finished pieces work together as one project. Open the files, run the program or build if there is one, and fix any small mismatches between the parts (naming, imports, paths, interfaces). Do not rewrite working parts. In your final message, state plainly what works and what does not.',
      capability: 'integration', depends_on: ids, deliverables: [], acceptance: ['The project runs or opens without errors', 'The parts agree on names, paths and interfaces'], model: '',
    }],
  };
}

/* ------------------------------- scheduler ------------------------------- */

function priorities(tasks) {
  const dependents = new Map(tasks.map((t) => [t.id, 0]));
  const stack = (id, seen = new Set()) => {
    for (const t of tasks) if (t.depends_on.includes(id) && !seen.has(t.id)) { seen.add(t.id); stack(t.id, seen); }
    return seen.size;
  };
  for (const t of tasks) dependents.set(t.id, stack(t.id));
  return dependents;
}

function taskContext(goal, plan, task, state, feedback) {
  let c = `PROJECT GOAL:\n${goal}\n\nPROJECT PLAN (a team of AI specialists shares this workspace):\n` + plan.tasks.map((t) => `- ${t.id}: ${t.title} [${t.capability}]${t.deliverables.length ? ' -> ' + t.deliverables.join(', ') : ''}`).join('\n');
  c += `\n\nYOUR TASK: ${task.id} - ${task.title}\n`;
  if (task.deliverables.length) c += `Files you must create or change: ${task.deliverables.join(', ')}\n`;
  if (task.acceptance.length) c += 'Acceptance checks:\n' + task.acceptance.map((a) => `- ${a}`).join('\n') + '\n';
  const deps = task.depends_on.map((d) => state.get(d)).filter(Boolean);
  if (deps.length) {
    c += '\nWORK ALREADY DONE BY TEAMMATES (the files are in the workspace - read them, build on them, keep their names and interfaces):\n';
    for (const d of deps) c += `- ${d.id} ${d.title} (${d.status}): ${String(d.summary || '').replace(/\s+/g, ' ').slice(0, 500)}${d.deliverables.length ? ' Files: ' + d.deliverables.join(', ') : ''}\n`;
  }
  c += '\nOther tasks run in parallel with yours. Touch only the files for your task unless you must fix a real conflict. Never delete teammates\' files.';
  if (feedback) c += `\n\nA REVIEWER REJECTED YOUR PREVIOUS ATTEMPT. Fix these problems (the earlier files are still in the workspace):\n${feedback}`;
  return c;
}

function fileExcerpts(root, paths, per = 6000, max = 6) {
  let out = '';
  for (const p of paths.slice(0, max)) {
    try { out += `\n--- ${p}\n${agent.readTextFile(root, p, 1, 100000, per).split('\n').slice(1).join('\n')}\n`; } catch (e) { out += `\n--- ${p}\n(${e.message})\n`; }
  }
  return out;
}

const REVIEW_SYSTEM = 'You are a strict, fair reviewer on a software and content team. Judge whether the work meets the task and every acceptance check. Be specific. Reply with ONLY a JSON object: {"verdict":"pass" or "fail","score":0-10,"issues":["specific problem and how to fix it"]}. Pass only if the work is complete and correct as far as you can tell from the files and the report; list issues when you fail.';

async function review({ run, task, executor, summary, root, roster, signal }) {
  const candidates = ranking(roster, 'review', [executor]);
  const reviewer = (roster.reviewer && roster.models[roster.reviewer] && roster.reviewer !== executor ? roster.reviewer : '') || (candidates[0] && candidates[0].model) || roster.reviewer || executor;
  const files = task.deliverables.length ? task.deliverables : [];
  const body = `TASK: ${task.title}\n${task.description}\n\nACCEPTANCE CHECKS:\n${task.acceptance.map((a) => '- ' + a).join('\n') || '(none given)'}\n\nWORKER'S REPORT:\n${String(summary).slice(0, 3000)}\n\nDELIVERABLE FILES:${files.length ? fileExcerpts(root, files) : '\n(no files expected - judge the report)'}`;
  const out = await race.askOne(reviewer, skills.inject([{ role: 'system', content: REVIEW_SYSTEM }, { role: 'user', content: body }], reviewer).messages, { temperature: 0, max_tokens: 1500 }, signal);
  if (!out.ok) return { reviewer, verdict: 'unknown', score: null, issues: [], note: out.error };
  const j = extractJson(out.content);
  if (!j || !['pass', 'fail'].includes(String(j.verdict).toLowerCase())) return { reviewer, verdict: 'unknown', score: null, issues: [], note: 'reviewer reply was not usable' };
  return { reviewer, verdict: String(j.verdict).toLowerCase(), score: Number.isFinite(Number(j.score)) ? Number(j.score) : null, issues: (Array.isArray(j.issues) ? j.issues : []).map((x) => String(x).slice(0, 400)).slice(0, 8) };
}

async function runTeamProject({ run, goal, plan: rawPlan, workspace, shell, maxParallel, maxAttempts, maxSteps }) {
  const cfg = config.load();
  const signal = run.abort.signal;
  const roster = loadRoster();
  const team = enabledModels(roster);
  if (!team.length) throw new Error('No models are enabled on the team. Open the Roster and switch some on.');
  const root = agent.workspaceRoot(workspace);
  const par = clamp(Number(maxParallel) || cfg.team.maxParallel || 3, 1, 8);
  const attemptsMax = clamp(Number(maxAttempts) || cfg.team.maxAttempts || 3, 1, 5);

  let plan = rawPlan ? normalizePlan(rawPlan) : null;
  if (!plan) {
    const lead = (roster.lead && roster.models[roster.lead] ? roster.lead : '') || ranking(roster, 'reasoning')[0].model;
    run.emit({ type: 'note', text: `Planning with ${lead}…` });
    plan = await makePlan(goal, lead, signal);
  }
  plan = addIntegration(plan);
  const prio = priorities(plan.tasks);
  run.emit({ type: 'plan', summary: plan.summary, tasks: plan.tasks.map((t) => ({ id: t.id, title: t.title, capability: t.capability, depends_on: t.depends_on, deliverables: t.deliverables, pinned: t.model || '' })) });

  const state = new Map(plan.tasks.map((t) => [t.id, { ...t, status: 'pending', attempts: 0, tried: [], model: '', summary: '', review: null }]));
  const running = new Map(); // taskId -> promise
  const load = (m) => [...running.keys()].filter((id) => state.get(id).model === m).length;
  const setStatus = (t, status, extra = {}) => { t.status = status; run.emit({ type: 'task', taskId: t.id, status, model: t.model, attempt: t.attempts, ...extra }); };

  function pickModel(task, force) {
    const r = loadRoster();
    const pool = enabledModels(r);
    if (task.model && pool.includes(task.model) && !task.tried.includes(task.model)) return { model: task.model, why: 'pinned by you' };
    let ranked = ranking(r, task.capability, task.tried);
    if (!ranked.length) ranked = ranking(r, task.capability); // everyone failed once: allow repeats
    if (!ranked.length) return null;
    const free = ranked.filter((c) => load(c.model) < (r.models[c.model].concurrency || 1));
    if (!free.length) return null;
    const best = ranked[0];
    const pick = free[0];
    if (!force && running.size > 0 && pick.fit < 0.75 * best.fit) return null; // better to wait for the specialist
    const label = CAP_LABELS[task.capability] || task.capability;
    const why = pick === best ? `best at ${label} (fit ${pick.fit})` : `${best.model} is busy; best free model for ${label} (fit ${pick.fit})`;
    return { model: pick.model, why };
  }

  async function execute(task) {
    let feedback = '';
    let switchModel = false;
    for (let attempt = 1; attempt <= attemptsMax; attempt++) {
      if (signal.aborted) return setStatus(task, 'stopped');
      task.attempts = attempt;
      // attempt 1: the model the scheduler chose; attempt 2: same model, now with feedback;
      // attempt 3+ (or right after a crash): the next-best model that has not tried yet
      if (attempt >= 3 || switchModel) {
        const next = ranking(loadRoster(), task.capability, task.tried)[0];
        if (next) task.model = next.model;
        switchModel = false;
      }
      const model = task.model;
      if (!task.tried.includes(model)) task.tried.push(model);
      setStatus(task, 'working', { note: attempt > 1 ? `attempt ${attempt}${feedback ? ' with reviewer feedback' : ''}` : task.why });

      const res = await agent.runAgent({
        run, model, taskId: task.id, label: model, workspace, shell, maxSteps,
        goal: task.description,
        context: taskContext(goal, plan, task, state, feedback),
        system: `You are a specialist on a multi-model team, assigned task ${task.id} (${task.title}). Create exactly the deliverable files for your task, then verify them (run them if they are code). Finish with: what you built, the files, and how you checked it.`,
      });
      if (res.status === 'stopped' || signal.aborted) return setStatus(task, 'stopped');
      task.summary = res.summary;
      if (res.status === 'error') { feedback = `The previous attempt crashed: ${res.error}`; recordOutcome(model, task.capability, false); switchModel = true; continue; }

      // gate 1: the promised files exist and are not empty
      const missing = task.deliverables.filter((f) => { try { const p = agent.safePath(root, f); return !fs.existsSync(p) || fs.statSync(p).size === 0; } catch { return true; } });
      if (missing.length) { feedback = `These deliverables are missing or empty: ${missing.join(', ')}. Create them.`; recordOutcome(model, task.capability, false); run.emit({ type: 'review', taskId: task.id, reviewer: 'automatic check', verdict: 'fail', issues: [feedback] }); continue; }
      if (res.status === 'incomplete') { feedback = 'The previous attempt ran out of steps before finishing. Work more directly and finish.'; recordOutcome(model, task.capability, false); continue; }

      // gate 2: another model reviews it
      setStatus(task, 'review', { note: 'being reviewed' });
      const rv = await review({ run, task, executor: model, summary: task.summary, root, roster: loadRoster(), signal });
      if (signal.aborted) return setStatus(task, 'stopped');
      task.review = rv;
      run.emit({ type: 'review', taskId: task.id, reviewer: rv.reviewer, verdict: rv.verdict, score: rv.score, issues: rv.issues, note: rv.note });
      if (rv.verdict !== 'fail') {
        recordOutcome(model, task.capability, rv.verdict === 'pass');
        return setStatus(task, rv.verdict === 'pass' ? 'done' : 'done_unreviewed', { note: rv.verdict === 'pass' ? 'passed review' : 'finished; reviewer unavailable' });
      }
      recordOutcome(model, task.capability, false);
      feedback = rv.issues.map((x) => `- ${x}`).join('\n') || 'The reviewer rejected the work without details; re-check it against the acceptance checks.';
    }
    // out of attempts
    const exists = task.deliverables.length && task.deliverables.every((f) => { try { return fs.statSync(agent.safePath(root, f)).size > 0; } catch { return false; } });
    if (exists || (!task.deliverables.length && task.summary)) setStatus(task, 'done_with_issues', { note: 'kept after the last attempt; reviewer still had concerns' });
    else setStatus(task, 'failed', { note: 'could not produce the deliverables' });
  }

  // main scheduling loop
  while (!signal.aborted) {
    const all = [...state.values()];
    for (const t of all) {
      if (t.status === 'pending' && t.depends_on.some((d) => ['failed', 'blocked'].includes(state.get(d).status))) setStatus(t, 'blocked', { note: 'a task it depends on failed' });
    }
    const ready = all.filter((t) => t.status === 'pending' && t.depends_on.every((d) => ['done', 'done_unreviewed', 'done_with_issues'].includes(state.get(d).status))).sort((a, b) => prio.get(b.id) - prio.get(a.id));
    for (const t of ready) {
      if (running.size >= par) break;
      const pick = pickModel(t, false);
      if (!pick) continue;
      t.model = pick.model;
      t.why = pick.why;
      setStatus(t, 'assigned', { note: pick.why });
      const p = execute(t).catch((e) => { run.emit({ type: 'error', taskId: t.id, error: e.message }); setStatus(t, 'failed', { note: e.message }); }).finally(() => running.delete(t.id));
      running.set(t.id, p);
    }
    if (!running.size) {
      if (ready.length) { // nothing could start although tasks are ready: stop waiting for specialists
        const t = ready[0];
        const pick = pickModel(t, true);
        if (!pick) { setStatus(t, 'failed', { note: 'no model available' }); continue; }
        t.model = pick.model;
        t.why = pick.why;
        setStatus(t, 'assigned', { note: pick.why });
        running.set(t.id, execute(t).catch((e) => { setStatus(t, 'failed', { note: e.message }); }).finally(() => running.delete(t.id)));
      } else break;
    }
    await Promise.race(running.values());
  }

  const results = [...state.values()];
  const failed = results.filter((t) => ['failed', 'blocked'].includes(t.status));
  const issues = results.filter((t) => t.status === 'done_with_issues' || t.status === 'done_unreviewed');
  const report = buildReport(goal, plan, results);
  try { fs.writeFileSync(path.join(root, 'TEAM_REPORT.md'), report); } catch {}
  const status = signal.aborted ? 'stopped' : failed.length ? 'failed' : 'done';
  const finalTask = state.get('integrate');
  run.emit({ type: 'report', text: report });
  return { status, failed: failed.length, issues: issues.length, summary: finalTask && finalTask.summary ? finalTask.summary : '' };
}

function buildReport(goal, plan, results) {
  const label = { done: 'passed review', done_unreviewed: 'finished, not reviewed', done_with_issues: 'finished, reviewer still had concerns', failed: 'FAILED', blocked: 'blocked', stopped: 'stopped', pending: 'not started' };
  let md = `# Team report\n\n**Goal:** ${goal}\n\n${plan.summary ? plan.summary + '\n\n' : ''}| Task | Skill needed | Model | Attempts | Result |\n|---|---|---|---|---|\n`;
  for (const t of results) md += `| ${t.id}: ${t.title} | ${CAP_LABELS[t.capability] || t.capability} | ${t.model || '-'} | ${t.attempts} | ${label[t.status] || t.status} |\n`;
  const notes = results.filter((t) => t.review && t.review.issues && t.review.issues.length && t.status !== 'done');
  if (notes.length) md += '\n## Open concerns from reviewers\n' + notes.map((t) => `**${t.id}** (${t.review.reviewer}): ${t.review.issues.join('; ')}`).join('\n') + '\n';
  const fin = results.find((t) => t.id === 'integrate');
  if (fin && fin.summary) md += `\n## Integration check\n${fin.summary}\n`;
  return md;
}

function startTeamRun(opts) {
  const ws = opts.workspace && agent.validWorkspace(opts.workspace) ? opts.workspace : agent.newWorkspaceName(opts.goal);
  agent.workspaceRoot(ws);
  const run = runs.create({ kind: 'team', title: String(opts.goal).replace(/\s+/g, ' ').slice(0, 80), meta: { workspace: ws, goal: String(opts.goal).slice(0, 4000), shell: opts.shell || config.load().agent.shell } });
  (async () => {
    try {
      const r = await runTeamProject({ ...opts, run, workspace: ws });
      run.finish(r.status, { summary: r.summary, failed: r.failed, issues: r.issues });
    } catch (e) {
      run.emit({ type: 'error', error: e.message });
      run.finish('failed', { summary: e.message });
    }
  })();
  return run;
}

function startBenchmark({ models, judgeModel }) {
  const run = runs.create({ kind: 'bench', title: `Benchmark: ${models.length} model${models.length === 1 ? '' : 's'}`, meta: { models, judgeModel: judgeModel || '' } });
  (async () => {
    try {
      await runBenchmark({ run, models, judgeModel });
      run.finish(run.abort.signal.aborted ? 'stopped' : 'done');
    } catch (e) {
      run.emit({ type: 'error', error: e.message });
      run.finish('failed', { summary: e.message });
    }
  })();
  return run;
}

/** Plan only (no work): the plan plus the ranked candidates per task so the user can review and pin models. */
async function previewPlan(goal) {
  const roster = loadRoster();
  if (!enabledModels(roster).length) throw Object.assign(new Error('Enable at least one model in the Roster first.'), { status: 400 });
  const lead = (roster.lead && roster.models[roster.lead] ? roster.lead : '') || ranking(roster, 'reasoning')[0].model;
  const plan = addIntegration(await makePlan(goal, lead, AbortSignal.timeout(5 * 60 * 1000)));
  const tasks = plan.tasks.map((t) => ({ ...t, ranked: ranking(roster, t.capability).slice(0, 4) }));
  return { lead, summary: plan.summary, tasks: tasks.filter((t) => t.id !== 'integrate'), integrate: tasks.find((t) => t.id === 'integrate') ? { ranked: tasks.find((t) => t.id === 'integrate').ranked } : null };
}

module.exports = {
  CAPS, CAP_LABELS, PROBES, isTextModel, loadRoster, rosterView, updateRoster, capScore, fit, ranking, guessScores, enabledModels,
  normalizePlan, extractJson, previewPlan, startTeamRun, startBenchmark, runJsCases, buildReport,
};
