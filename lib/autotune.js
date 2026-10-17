'use strict';
/**
 * AutoTune: looks at the prompt (and the mode you are in), decides what kind of task it is,
 * and picks sampling parameters to match. Thumbs up/down on replies slowly nudge the
 * parameters of that context toward what you liked.
 */
const path = require('path');
const config = require('./config');

const FEEDBACK_FILE = path.join(config.DATA_DIR, 'autotune-feedback.json');

// base params per context
const CONTEXTS = {
  code:        { label: 'Code generation',   temperature: 0.2, top_p: 0.9,  frequency_penalty: 0.0, presence_penalty: 0.0 },
  debug:       { label: 'Debugging',         temperature: 0.1, top_p: 0.85, frequency_penalty: 0.0, presence_penalty: 0.0 },
  webdesign:   { label: 'Web design',        temperature: 0.6, top_p: 0.95, frequency_penalty: 0.1, presence_penalty: 0.1 },
  reasoning:   { label: 'Reasoning / math',  temperature: 0.3, top_p: 0.9,  frequency_penalty: 0.0, presence_penalty: 0.0 },
  analysis:    { label: 'Analysis',          temperature: 0.4, top_p: 0.9,  frequency_penalty: 0.1, presence_penalty: 0.1 },
  factual:     { label: 'Factual Q&A',       temperature: 0.3, top_p: 0.9,  frequency_penalty: 0.0, presence_penalty: 0.0 },
  summarize:   { label: 'Summarising',       temperature: 0.3, top_p: 0.9,  frequency_penalty: 0.2, presence_penalty: 0.0 },
  translate:   { label: 'Translation',       temperature: 0.2, top_p: 0.9,  frequency_penalty: 0.0, presence_penalty: 0.0 },
  creative:    { label: 'Creative writing',  temperature: 1.0, top_p: 0.95, frequency_penalty: 0.4, presence_penalty: 0.5 },
  brainstorm:  { label: 'Brainstorming',     temperature: 1.1, top_p: 0.97, frequency_penalty: 0.5, presence_penalty: 0.6 },
  chat:        { label: 'Conversation',      temperature: 0.8, top_p: 0.95, frequency_penalty: 0.1, presence_penalty: 0.2 },
};

const RANGES = {
  temperature: [0, 2], top_p: [0.1, 1], frequency_penalty: [-1, 1.5], presence_penalty: [-1, 1.5],
};

const PATTERNS = {
  code: [/```/, /\b(function|class|def|import|const|let|var|async|await|api|endpoint|regex|sql|query|json|html|css|python|javascript|typescript|java|rust|golang|php|react|node|bash|script|compile|refactor|implement|algorithm|database|docker|git)\b/gi, /[{};]\s*$|=>|\(\)/m],
  debug: [/\b(error|exception|traceback|stack ?trace|bug|crash|fails?|failing|not working|undefined|null pointer|segfault|why (is|does|doesn'?t)|fix (this|my|the))\b/gi],
  webdesign: [/\b(website|web ?page|landing page|portfolio|navbar|hero section|layout|responsive|tailwind|ui|ux|dashboard design|homepage|footer|css animation)\b/gi],
  reasoning: [/\b(prove|proof|solve|equation|calculate|probability|puzzle|riddle|logic|step by step|derive|theorem|how many|integral|derivative|optimi[sz]e)\b/gi, /\d+\s*[+\-*/^=]\s*\d+/],
  analysis: [/\b(analy[sz]e|compare|contrast|evaluate|pros and cons|trade-?offs?|assess|critique|review|strategy|market|impact|implications?|explain why)\b/gi],
  factual: [/^(what|who|when|where|which|how (much|many|old|long|far))\b/i, /\b(define|definition|capital of|meaning of|difference between)\b/gi],
  summarize: [/\b(summari[sz]e|tl;?dr|key points|shorten|condense|recap|brief overview)\b/gi],
  translate: [/\b(translate|translation|in (hindi|gujarati|spanish|french|german|japanese|chinese|arabic|english)\b)/gi],
  creative: [/\b(story|poem|lyrics|screenplay|script for|narrative|fiction|character|plot|write (a|an) (scene|chapter|essay|speech)|metaphor)\b/gi],
  brainstorm: [/\b(ideas?|brainstorm|names? for|suggestions?|come up with|slogan|taglines?|options for|creative ways)\b/gi],
};

const MODE_BIAS = { coding: { code: 3 }, builder: { webdesign: 4, code: 1 }, app: { code: 3, webdesign: 2 }, reasoning: { reasoning: 3, analysis: 1 } };

function count(text, patterns) {
  let n = 0;
  for (const p of patterns) {
    const flags = p.flags.includes('g') ? p.flags : p.flags + 'g';
    const m = text.match(new RegExp(p.source, flags));
    if (m) n += Math.min(m.length, 4);
  }
  return n;
}

function loadFeedback() {
  return config.readJson(FEEDBACK_FILE, {});
}

function clamp(key, v) {
  const [lo, hi] = RANGES[key];
  return Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100;
}

function classify(text, mode) {
  const t = String(text || '').slice(0, 4000);
  const scores = {};
  for (const [ctx, pats] of Object.entries(PATTERNS)) scores[ctx] = count(t, pats);
  for (const [ctx, bonus] of Object.entries(MODE_BIAS[mode] || {})) scores[ctx] = (scores[ctx] || 0) + bonus;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, score] = ranked[0];
  const second = ranked[1][1];
  if (score === 0) return { context: 'chat', confidence: 0.4 };
  const confidence = Math.min(0.99, 0.5 + (score - second) * 0.12 + score * 0.04);
  return { context: best, confidence: Math.round(confidence * 100) / 100 };
}

function paramsFor(context) {
  const base = CONTEXTS[context] || CONTEXTS.chat;
  const learned = (loadFeedback()[context] || {}).offsets || {};
  const params = {};
  for (const key of Object.keys(RANGES)) params[key] = clamp(key, base[key] + (learned[key] || 0));
  return params;
}

function tune(text, mode) {
  const { context, confidence } = classify(text, mode);
  const fb = loadFeedback()[context] || {};
  return {
    context,
    label: CONTEXTS[context].label,
    confidence,
    params: paramsFor(context),
    feedbackCount: (fb.up || 0) + (fb.down || 0),
  };
}

/** rating = 'up' | 'down'; params = the params that produced the rated response. */
function recordFeedback(context, rating, params) {
  if (!CONTEXTS[context] || !['up', 'down'].includes(rating) || !params) return null;
  const all = loadFeedback();
  const entry = all[context] || { up: 0, down: 0, offsets: {} };
  const base = CONTEXTS[context];
  // Move 20% toward liked params, 10% away from disliked ones; limit drift to +-0.4 from base.
  const step = rating === 'up' ? 0.2 : -0.1;
  for (const key of Object.keys(RANGES)) {
    if (typeof params[key] !== 'number') continue;
    const current = base[key] + (entry.offsets[key] || 0);
    const next = current + (params[key] - current) * step;
    entry.offsets[key] = Math.max(-0.4, Math.min(0.4, Math.round((next - base[key]) * 1000) / 1000));
  }
  entry[rating] += 1;
  all[context] = entry;
  config.writeJsonAtomic(FEEDBACK_FILE, all);
  return { context, ...entry, params: paramsFor(context) };
}

function resetFeedback() {
  config.writeJsonAtomic(FEEDBACK_FILE, {});
}

module.exports = { CONTEXTS, classify, tune, paramsFor, recordFeedback, resetFeedback, loadFeedback };
