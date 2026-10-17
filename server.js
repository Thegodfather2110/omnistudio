#!/usr/bin/env node
'use strict';
/**
 * OmniStudio - local AI workspace for OmniRoute.
 * Zero dependencies: needs only Node.js 18+.  Everything it creates lives in ./data on this computer.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const config = require('./lib/config');
const omni = require('./lib/omni');
const autotune = require('./lib/autotune');
const stm = require('./lib/stm');
const race = require('./lib/race');
const store = require('./lib/store');
const skills = require('./lib/skills');
const web = require('./lib/search');
const agent = require('./lib/agent');
const runs = require('./lib/runs');
const team = require('./lib/team');
const rea = require('./lib/rea');
const connectors = require('./lib/connectors');

const PORT = Number(process.env.PORT) || 3210;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 25 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.xml': 'application/xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};

/* ------------------------------ helpers ------------------------------ */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(store.httpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(store.httpError(400, 'Body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Block other websites from driving this local server (CSRF / DNS rebinding). */
function guard(req, allowOpaqueOrigin) {
  const host = String(req.headers.host || '').toLowerCase();
  if (!process.env.HOST) {
    const allowed = [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`];
    if (!allowed.includes(host)) throw store.httpError(403, 'Forbidden host');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.headers.origin;
    const okOrigin = origin === undefined || origin === 'http://' + host || (allowOpaqueOrigin && origin === 'null');
    if (!okOrigin) throw store.httpError(403, 'Cross-origin request blocked');
    const type = String(req.headers['content-type'] || '');
    if (allowOpaqueOrigin) {
      if (!type.includes('text/plain')) throw store.httpError(415, 'Content-Type must be text/plain');
    } else if (req.method !== 'DELETE' && !type.includes('application/json')) throw store.httpError(415, 'Content-Type must be application/json');
  }
}

function serveFile(req, res, file, extraHeaders = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', ...extraHeaders };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, stat.size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    end = Math.min(end, stat.size - 1);
    if (start > end || start >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function within(base, rel) {
  const full = path.resolve(base, '.' + path.sep + decodeURIComponent(rel));
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

const CHAT_PARAMS = ['temperature', 'top_p', 'max_tokens', 'frequency_penalty', 'presence_penalty', 'reasoning_effort', 'stop'];

function pickParams(params) {
  const out = {};
  for (const k of CHAT_PARAMS) {
    const v = params && params[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) throw store.httpError(400, 'messages is required');
  return messages
    .filter((m) => m && ['system', 'user', 'assistant'].includes(m.role))
    .map((m) => ({ role: m.role, content: m.content }));
}

const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => (p && p.text) || '').join(' ') : '');

function appendSystem(messages, text) {
  const out = messages.map((m) => ({ ...m }));
  const i = out.findIndex((m) => m.role === 'system');
  if (i >= 0 && typeof out[i].content === 'string') out[i].content = out[i].content.replace(/\s+$/, '') + '\n\n' + text;
  else out.unshift({ role: 'system', content: text });
  return out;
}

/** Skills the model has learned + optional live web results, added to the system prompt. */
async function prepareMessages(model, messages, opts) {
  const info = {};
  let out = messages;
  if (opts.skills !== false) {
    const r = skills.inject(out, model);
    out = r.messages;
    if (r.skills.length) info.skills = r.skills;
  }
  if (opts.web) {
    const users = out.filter((m) => m.role === 'user').map((m) => textOf(m.content).trim()).filter(Boolean);
    let query = users[users.length - 1] || '';
    // a short follow-up ("and its price?") means nothing to a search engine on its own: borrow the previous question
    if (query.length < 45 && users.length > 1) query = users[users.length - 2].slice(0, 160) + ' ' + query;
    try {
      const g = await web.groundingFor(query);
      out = appendSystem(out, g.text);
      info.sources = g.sources;
    } catch (e) {
      info.webError = e.message;
    }
  }
  return { messages: out, info };
}

/* ------------------------------ video ------------------------------- */

function findVideoSources(obj, found = []) {
  if (!obj) return found;
  if (typeof obj === 'string') {
    if (/^https?:\/\/\S+$/i.test(obj) && /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(obj)) found.push({ url: obj });
    return found;
  }
  if (Array.isArray(obj)) {
    obj.forEach((x) => findVideoSources(x, found));
    return found;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && /^(b64_json|b64|base64|video_base64)$/i.test(k) && v.length > 100) found.push({ b64: v });
      else if (typeof v === 'string' && /^(url|video_url|download_url|output_url|uri)$/i.test(k) && v) found.push({ url: v });
      else findVideoSources(v, found);
    }
  }
  return found;
}

async function downloadTo(source, id, index) {
  let buffer;
  let ext = '.mp4';
  if (source.b64) {
    buffer = Buffer.from(source.b64.replace(/^data:[^,]+,/, ''), 'base64');
  } else {
    const target = new URL(source.url, omni.origin()).toString();
    const sameOrigin = new URL(target).origin === omni.origin();
    const resp = await fetch(target, { headers: sameOrigin ? { Authorization: omni.headers().Authorization || '' } : {}, signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!resp.ok) throw new Error(`Could not download video (${resp.status})`);
    const ctype = resp.headers.get('content-type') || '';
    if (/webm/.test(ctype)) ext = '.webm';
    else if (/quicktime/.test(ctype)) ext = '.mov';
    const fromUrl = path.extname(new URL(target).pathname).toLowerCase();
    if (['.mp4', '.webm', '.mov', '.m4v'].includes(fromUrl)) ext = fromUrl;
    const name = `${id}-${index + 1}${ext}`;
    await pipeline(Readable.fromWeb(resp.body), fs.createWriteStream(path.join(store.VIDEOS_DIR, name)));
    return { file: name, type: MIME[ext] || 'video/mp4' };
  }
  const name = `${id}-${index + 1}${ext}`;
  fs.writeFileSync(path.join(store.VIDEOS_DIR, name), buffer);
  return { file: name, type: 'video/mp4' };
}

async function runVideoJob(record, payload) {
  const update = (patch) => {
    Object.assign(record, patch);
    store.saveVideoRecord(record);
  };
  try {
    const cfg = config.load();
    const videoPath = cfg.videoPath || '/videos/generations';
    const resp = await omni.postJson(videoPath, payload, { timeoutMs: 15 * 60 * 1000 });
    if (!resp.ok) throw new Error(await omni.readError(resp));
    let json = await resp.json();
    const deadline = Date.now() + 20 * 60 * 1000;
    // asynchronous providers: poll until a result shows up
    while (!findVideoSources(json).length) {
      const status = String(json.status || json.state || '').toLowerCase();
      if (/fail|error|cancel|reject/.test(status)) throw new Error(json.error?.message || json.error || `Video job ${status}`);
      const id = json.id || json.job_id || json.task_id;
      if (!id || Date.now() > deadline) throw new Error('OmniRoute returned no video. Check the video model and endpoint path in Settings.');
      update({ status: 'running', note: `Waiting for provider (${status || 'processing'})…` });
      await new Promise((r) => setTimeout(r, 4000));
      const pollUrl = json.status_url || json.polling_url || `${videoPath.replace(/\/$/, '')}/${encodeURIComponent(id)}`;
      const poll = /^https?:/i.test(pollUrl) ? await fetch(pollUrl, { headers: omni.headers(), signal: AbortSignal.timeout(30000) }) : await omni.getJson(pollUrl, { signal: AbortSignal.timeout(30000) });
      if (!poll.ok) throw new Error(`Polling failed: ${await omni.readError(poll)}`);
      json = await poll.json();
    }
    const seen = new Set();
    const sources = findVideoSources(json).filter((s) => {
      const key = s.url || s.b64.slice(0, 64);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    update({ note: 'Saving to your computer…' });
    const files = [];
    for (let i = 0; i < sources.length; i++) files.push(await downloadTo(sources[i], record.id, i));
    update({ status: 'done', files, note: '' });
  } catch (e) {
    update({ status: 'error', error: omni.describeNetworkError(e) });
  }
}

/* ------------------------------- routes ------------------------------ */

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  let match;

  if (p === '/api/config' && m === 'GET') return sendJson(res, 200, { ...config.publicView(), stmModules: stm.list(), contexts: Object.keys(autotune.CONTEXTS), searchProviders: web.PROVIDERS });

  if (p === '/api/config' && m === 'POST') {
    const b = await readBody(req);
    const patch = {};
    if (typeof b.baseUrl === 'string') patch.baseUrl = config.normalizeBaseUrl(b.baseUrl);
    if (typeof b.apiKey === 'string' && b.apiKey.trim()) patch.apiKey = b.apiKey.trim();
    if (b.clearApiKey === true) patch.apiKey = '';
    if (b.modeModels && typeof b.modeModels === 'object') patch.modeModels = Object.fromEntries(Object.entries(b.modeModels).map(([k, v]) => [k, String(v || '')]));
    if (Array.isArray(b.pinned)) patch.pinned = [...new Set(b.pinned.map((x) => String(x).trim()).filter(Boolean))].slice(0, 200);
    if (typeof b.videoPath === 'string' && b.videoPath.trim()) patch.videoPath = '/' + b.videoPath.trim().replace(/^\/+/, '');
    if (b.autotune && typeof b.autotune.enabled === 'boolean') patch.autotune = { enabled: b.autotune.enabled };
    if (b.stm && Array.isArray(b.stm.enabled)) patch.stm = { enabled: b.stm.enabled.filter((id) => stm.MODULES.some((x) => x.id === id)) };
    if (b.search && typeof b.search === 'object') {
      const sp = {};
      if (typeof b.search.provider === 'string' && web.PROVIDERS[b.search.provider]) sp.provider = b.search.provider;
      if (typeof b.search.url === 'string') sp.url = b.search.url.trim().replace(/\/+$/, '');
      if (b.search.maxResults !== undefined) sp.maxResults = Math.max(1, Math.min(20, Math.round(Number(b.search.maxResults)) || 8));
      if (typeof b.search.apiKey === 'string' && b.search.apiKey.trim()) sp.apiKey = b.search.apiKey.trim();
      if (b.search.clearApiKey === true) sp.apiKey = '';
      patch.search = sp;
    }
    if (b.agent && typeof b.agent === 'object') {
      const ap = {};
      if (['off', 'confirm', 'auto'].includes(b.agent.shell)) ap.shell = b.agent.shell;
      if (b.agent.maxSteps !== undefined) ap.maxSteps = Math.max(1, Math.min(100, Math.round(Number(b.agent.maxSteps)) || 30));
      if (b.agent.commandTimeoutSec !== undefined) ap.commandTimeoutSec = Math.max(5, Math.min(600, Math.round(Number(b.agent.commandTimeoutSec)) || 120));
      patch.agent = ap;
    }
    if (b.team && typeof b.team === 'object') {
      const tp = {};
      if (b.team.maxParallel !== undefined) tp.maxParallel = Math.max(1, Math.min(8, Math.round(Number(b.team.maxParallel)) || 3));
      if (b.team.maxAttempts !== undefined) tp.maxAttempts = Math.max(1, Math.min(5, Math.round(Number(b.team.maxAttempts)) || 3));
      patch.team = tp;
    }
    config.save(patch);
    return sendJson(res, 200, { ...config.publicView(), stmModules: stm.list(), searchProviders: web.PROVIDERS });
  }

  if (p === '/api/models' && m === 'GET') {
    const r = await omni.fetchModels();
    return sendJson(res, 200, { ...r, pinned: config.load().pinned });
  }

  if (p === '/api/autotune' && m === 'POST') {
    const b = await readBody(req);
    return sendJson(res, 200, autotune.tune(b.text, b.mode));
  }
  if (p === '/api/autotune/feedback' && m === 'POST') {
    const b = await readBody(req);
    const r = autotune.recordFeedback(b.context, b.rating, b.params);
    return sendJson(res, r ? 200 : 400, r || { error: 'Invalid feedback' });
  }
  if (p === '/api/autotune/reset' && m === 'POST') {
    autotune.resetFeedback();
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/autotune/learned' && m === 'GET') return sendJson(res, 200, autotune.loadFeedback());

  /* chat (streaming passthrough) */
  if (p === '/api/chat' && m === 'POST') {
    const b = await readBody(req);
    if (!b.model) throw store.httpError(400, 'Choose a model or combo first (Settings → default models).');
    const prepared = await prepareMessages(b.model, cleanMessages(b.messages), { skills: b.skills, web: b.web });
    const body = { model: b.model, messages: prepared.messages, stream: b.stream !== false, ...pickParams(b.params) };
    const hasInfo = Object.keys(prepared.info).length > 0;
    const ctrl = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ctrl.abort();
    });
    let upstream;
    try {
      upstream = await omni.postJson('/chat/completions', body, { signal: ctrl.signal });
    } catch (e) {
      if (ctrl.signal.aborted) return;
      throw store.httpError(502, omni.describeNetworkError(e));
    }
    if (!upstream.ok) throw store.httpError(upstream.status === 401 || upstream.status === 403 ? upstream.status : 502, `OmniRoute ${upstream.status}: ${await omni.readError(upstream)}`);
    if (!body.stream) {
      const j = await upstream.json();
      if (hasInfo) j.omni = prepared.info;
      return sendJson(res, 200, j);
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (hasInfo) res.write('data: ' + JSON.stringify({ omni: prepared.info }) + '\n\n');
    return omni.pipeBody(upstream, res);
  }

  /* arena (NDJSON stream) */
  if (p === '/api/arena' && m === 'POST') {
    const b = await readBody(req);
    const models = [...new Set((b.models || []).map(String).filter(Boolean))].slice(0, 10);
    if (models.length < 2) throw store.httpError(400, 'Pick at least two models or combos to race.');
    const messages = cleanMessages(b.messages);
    const ctrl = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ctrl.abort();
    });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    const emit = (ev) => res.write(JSON.stringify(ev) + '\n');
    try {
      await race.run({ models, messages, params: pickParams(b.params), judgeModel: b.judgeModel || '', signal: ctrl.signal, prepare: b.skills === false ? null : (model, msgs) => skills.inject(msgs, model).messages }, emit);
    } catch (e) {
      emit({ type: 'error', error: e.message });
    }
    return res.end();
  }

  /* chats */
  if (p === '/api/chats' && m === 'GET') return sendJson(res, 200, store.listChats(url.searchParams.get('mode') || ''));
  if ((match = p.match(/^\/api\/chats\/([A-Za-z0-9_-]+)$/))) {
    if (m === 'GET') {
      const c = store.getChat(match[1]);
      return c ? sendJson(res, 200, c) : sendJson(res, 404, { error: 'Chat not found' });
    }
    if (m === 'PUT') return sendJson(res, 200, store.saveChat(match[1], await readBody(req)));
    if (m === 'DELETE') return sendJson(res, 200, { ok: store.deleteChat(match[1]) });
  }

  /* projects (websites) */
  if (p === '/api/projects' && m === 'GET') return sendJson(res, 200, store.listProjects(url.searchParams.get('kind') === 'app' ? 'app' : url.searchParams.get('kind') === 'site' ? 'site' : ''));
  if (p === '/api/projects' && m === 'POST') {
    const b = await readBody(req);
    return sendJson(res, 201, store.createProject(b.name, b.description, b.kind));
  }
  if ((match = p.match(/^\/api\/projects\/([a-z0-9-]+)$/))) {
    if (m === 'GET') return sendJson(res, 200, store.getProject(match[1]));
    if (m === 'PATCH') {
      const b = await readBody(req);
      const patch = {};
      if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
      if (typeof b.description === 'string') patch.description = b.description.slice(0, 500);
      return sendJson(res, 200, store.touchProject(match[1], patch));
    }
    if (m === 'DELETE') {
      store.deleteProject(match[1]);
      return sendJson(res, 200, { ok: true });
    }
  }
  if ((match = p.match(/^\/api\/projects\/([a-z0-9-]+)\/storage$/))) {
    if (m === 'GET') return sendJson(res, 200, { data: store.readStorage(match[1]) });
    if (m === 'DELETE') { store.clearStorage(match[1]); return sendJson(res, 200, { ok: true }); }
  }
  if ((match = p.match(/^\/api\/projects\/([a-z0-9-]+)\/chat$/)) && m === 'PUT') {
    const b = await readBody(req);
    store.saveProjectChat(match[1], b.messages);
    return sendJson(res, 200, { ok: true });
  }
  if ((match = p.match(/^\/api\/projects\/([a-z0-9-]+)\/file$/))) {
    if (m === 'PUT') {
      const b = await readBody(req);
      return sendJson(res, 200, { path: store.writeProjectFile(match[1], b.path, b.content) });
    }
    if (m === 'DELETE') {
      store.deleteProjectFile(match[1], url.searchParams.get('path'));
      return sendJson(res, 200, { ok: true });
    }
  }
  if ((match = p.match(/^\/api\/projects\/([a-z0-9-]+)\/apply$/)) && m === 'POST') {
    const b = await readBody(req);
    return sendJson(res, 200, store.applyModelReply(match[1], String(b.text || '')));
  }


  /* ------------------------------ skills ------------------------------ */
  if (p === '/api/skills' && m === 'GET') {
    return sendJson(res, 200, { skills: skills.list().map(({ body, ...rest }) => rest), assign: skills.loadAssign(), dir: skills.SKILLS_DIR });
  }
  if (p === '/api/skills' && m === 'POST') {
    const b = await readBody(req);
    const saved = skills.save({ name: b.name, description: b.description, tags: b.tags, content: String(b.content || '') });
    if (b.assignTo) {
      const cur = skills.loadAssign()[String(b.assignTo)] || [];
      skills.setAssign(String(b.assignTo), [...cur, saved.id]);
    }
    return sendJson(res, 201, saved);
  }
  if (p === '/api/skills/import' && m === 'POST') {
    const b = await readBody(req);
    const files = Array.isArray(b.files) ? b.files.slice(0, 50) : [];
    if (!files.length) throw store.httpError(400, 'No files to import.');
    const created = [];
    const failed = [];
    for (const f of files) {
      try {
        const base = String(f.name || 'skill').replace(/\.(md|markdown|txt)$/i, '');
        const parsed = skills.parse(f.content);
        created.push(skills.save({ name: parsed.meta.name || base, content: String(f.content || '') }));
      } catch (e) {
        failed.push({ name: f.name, error: e.message });
      }
    }
    if (b.assignTo && created.length) {
      const cur = skills.loadAssign()[String(b.assignTo)] || [];
      skills.setAssign(String(b.assignTo), [...cur, ...created.map((c) => c.id)]);
    }
    return sendJson(res, 201, { created, failed });
  }
  if (p === '/api/skills/draft' && m === 'POST') {
    const b = await readBody(req);
    if (!b.model) throw store.httpError(400, 'Choose a model for drafting (Settings → Chat).');
    if (!String(b.request || '').trim()) throw store.httpError(400, 'Describe the skill you want.');
    const out = await race.askOne(b.model, [
      { role: 'system', content: 'You write skill files for AI models. A skill is a Markdown document that teaches a model how to do one kind of work well: when to use it, the rules, a short worked example, and a checklist. Output ONE complete file and nothing else, starting with this frontmatter:\n---\nname: <short title>\ndescription: <one sentence on when to use this skill>\n---\nThen the Markdown body. Be concrete and practical; keep it under 600 words; do not wrap the file in a code fence.' },
      { role: 'user', content: String(b.request).slice(0, 4000) },
    ], { temperature: 0.5, max_tokens: 3000 });
    if (!out.ok) throw store.httpError(502, out.error);
    return sendJson(res, 200, { content: out.content.replace(/^```(?:markdown|md)?\n/i, '').replace(/\n```\s*$/, '').trim() });
  }
  if (p === '/api/skills/preview' && m === 'GET') {
    const model = url.searchParams.get('model') || '';
    const r = skills.buildPrompt(model);
    return sendJson(res, 200, r);
  }
  if (p === '/api/skills/assign' && m === 'PUT') {
    const b = await readBody(req);
    return sendJson(res, 200, { assign: skills.setAssign(b.target, b.ids || []) });
  }
  if ((match = p.match(/^\/api\/skills\/([a-z0-9-]+)$/))) {
    if (m === 'GET') {
      const sk = skills.get(match[1]);
      return sk ? sendJson(res, 200, sk) : sendJson(res, 404, { error: 'Skill not found' });
    }
    if (m === 'PUT') {
      if (!skills.get(match[1])) throw store.httpError(404, 'Skill not found');
      const b = await readBody(req);
      return sendJson(res, 200, skills.save({ id: match[1], name: b.name, description: b.description, tags: b.tags, content: String(b.content || '') }));
    }
    if (m === 'DELETE') return sendJson(res, 200, { ok: skills.remove(match[1]) });
  }

  /* ------------------------------ web search ------------------------------ */
  if (p === '/api/search' && m === 'POST') {
    const b = await readBody(req);
    try {
      return sendJson(res, 200, await web.search(b.query, { n: b.n }));
    } catch (e) {
      throw store.httpError(502, e.message);
    }
  }
  if (p === '/api/fetch' && m === 'POST') {
    const b = await readBody(req);
    try {
      return sendJson(res, 200, await web.fetchPage(b.url, { maxChars: 20000 }));
    } catch (e) {
      throw store.httpError(502, e.message);
    }
  }

  /* ------------------------------ workspaces ------------------------------ */
  if (p === '/api/workspaces' && m === 'GET') return sendJson(res, 200, agent.listWorkspaces());
  if ((match = p.match(/^\/api\/workspaces\/([a-z0-9-]+)\/files$/)) && m === 'GET') {
    let root;
    try { root = agent.workspaceRoot(match[1], false); } catch { throw store.httpError(404, 'Workspace not found'); }
    return sendJson(res, 200, { name: match[1], folder: root, files: agent.listFiles(root, '.', 6, 500) });
  }
  if ((match = p.match(/^\/api\/workspaces\/([a-z0-9-]+)\/file$/)) && m === 'GET') {
    let root;
    try { root = agent.workspaceRoot(match[1], false); } catch { throw store.httpError(404, 'Workspace not found'); }
    try {
      return sendJson(res, 200, { path: url.searchParams.get('path'), text: agent.readTextFile(root, url.searchParams.get('path'), 1, 1e6, 200000).split('\n').slice(1).join('\n') });
    } catch (e) {
      throw store.httpError(400, e.message);
    }
  }
  if ((match = p.match(/^\/api\/workspaces\/([a-z0-9-]+)$/)) && m === 'DELETE') {
    let root;
    try { root = agent.workspaceRoot(match[1], false); } catch { throw store.httpError(404, 'Workspace not found'); }
    for (const r of runs.list()) if (r.status === 'running' && r.meta && r.meta.workspace === match[1]) throw store.httpError(409, 'A run is still using this workspace. Stop it first.');
    fs.rmSync(root, { recursive: true, force: true });
    return sendJson(res, 200, { ok: true });
  }

  /* ------------------------------ runs (agent / team / benchmark) ------------------------------ */
  if (p === '/api/runs' && m === 'GET') return sendJson(res, 200, runs.list(url.searchParams.get('kind') || ''));
  if ((match = p.match(/^\/api\/runs\/([A-Za-z0-9_-]+)$/))) {
    if (m === 'GET') {
      const v = runs.view(match[1], url.searchParams.get('since'));
      return v ? sendJson(res, 200, v) : sendJson(res, 404, { error: 'Run not found' });
    }
    if (m === 'DELETE') {
      if (!runs.remove(match[1])) throw store.httpError(409, 'Run not found or still running (stop it first).');
      return sendJson(res, 200, { ok: true });
    }
  }
  if ((match = p.match(/^\/api\/runs\/([A-Za-z0-9_-]+)\/approve$/)) && m === 'POST') {
    const run = runs.load(match[1]);
    if (!run) throw store.httpError(404, 'Run not found');
    const b = await readBody(req);
    return sendJson(res, 200, { ok: runs.approve(run, String(b.approvalId || ''), b.allow === true) });
  }
  if ((match = p.match(/^\/api\/runs\/([A-Za-z0-9_-]+)\/stop$/)) && m === 'POST') {
    const run = runs.load(match[1]);
    if (!run) throw store.httpError(404, 'Run not found');
    return sendJson(res, 200, { ok: runs.stop(run) });
  }

  if (p === '/api/agent/runs' && m === 'POST') {
    const b = await readBody(req);
    if (!b.model) throw store.httpError(400, 'Choose a model or combo for the agent.');
    if (!String(b.goal || '').trim()) throw store.httpError(400, 'Describe what the agent should do.');
    if (b.workspace && !agent.validWorkspace(b.workspace)) throw store.httpError(400, 'Invalid workspace name');
    const run = agent.startAgentRun({ goal: String(b.goal), model: b.model, workspace: b.workspace || '', shell: ['off', 'confirm', 'auto'].includes(b.shell) ? b.shell : undefined, maxSteps: b.maxSteps });
    return sendJson(res, 202, { id: run.id, workspace: run.meta.workspace });
  }

  /* ------------------------------ team ------------------------------ */
  if (p === '/api/team' && m === 'GET') {
    let ids = [];
    if (url.searchParams.get('sync') !== '0') {
      try {
        const r = await omni.fetchModels();
        ids = [...new Set([...(config.load().pinned || []), ...r.combos, ...r.models.map((x) => x.id)])];
      } catch {}
    }
    return sendJson(res, 200, { roster: team.rosterView(ids), caps: team.CAPS, labels: team.CAP_LABELS, options: config.load().team, probes: team.PROBES.length });
  }
  if (p === '/api/team' && m === 'PUT') {
    const b = await readBody(req);
    return sendJson(res, 200, { roster: team.updateRoster(b) });
  }
  if (p === '/api/team/benchmark' && m === 'POST') {
    const b = await readBody(req);
    const ids = [...new Set((b.models || []).map(String).filter(Boolean))].slice(0, 30);
    if (!ids.length) throw store.httpError(400, 'Pick at least one model to benchmark.');
    const run = team.startBenchmark({ models: ids, judgeModel: b.judgeModel || config.load().modeModels.judge || '' });
    return sendJson(res, 202, { id: run.id });
  }
  if (p === '/api/team/plan' && m === 'POST') {
    const b = await readBody(req);
    if (!String(b.goal || '').trim()) throw store.httpError(400, 'Describe the project first.');
    try {
      return sendJson(res, 200, await team.previewPlan(String(b.goal)));
    } catch (e) {
      throw store.httpError(e.status || 502, e.message);
    }
  }
  if (p === '/api/team/runs' && m === 'POST') {
    const b = await readBody(req);
    if (!String(b.goal || '').trim()) throw store.httpError(400, 'Describe the project first.');
    if (b.workspace && !agent.validWorkspace(b.workspace)) throw store.httpError(400, 'Invalid workspace name');
    if (!team.enabledModels(team.loadRoster()).length) throw store.httpError(400, 'Switch on at least one model in the Roster first.');
    const run = team.startTeamRun({ goal: String(b.goal), plan: b.plan || null, workspace: b.workspace || '', shell: ['off', 'confirm', 'auto'].includes(b.shell) ? b.shell : undefined, maxParallel: b.maxParallel, maxAttempts: b.maxAttempts, maxSteps: b.maxSteps });
    return sendJson(res, 202, { id: run.id, workspace: run.meta.workspace });
  }

  /* video */
  if (p === '/api/video' && m === 'POST') {
    const b = await readBody(req);
    if (!b.model) throw store.httpError(400, 'Choose a video model or combo first.');
    if (!String(b.prompt || '').trim()) throw store.httpError(400, 'Describe the video you want.');
    const payload = { model: b.model, prompt: String(b.prompt).trim() };
    if (b.duration) payload.duration = Number(b.duration);
    if (b.aspect_ratio) payload.aspect_ratio = String(b.aspect_ratio);
    if (b.size) payload.size = String(b.size);
    if (b.image) payload.image = String(b.image);
    const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const record = { id, created: Date.now(), model: b.model, prompt: payload.prompt, params: { duration: payload.duration, aspect_ratio: payload.aspect_ratio, size: payload.size }, status: 'running', files: [] };
    store.saveVideoRecord(record);
    runVideoJob(record, payload); // background; the UI polls /api/videos
    return sendJson(res, 202, record);
  }
  if (p === '/api/videos' && m === 'GET') return sendJson(res, 200, store.listVideos());
  if ((match = p.match(/^\/api\/videos\/([A-Za-z0-9_-]+)$/)) && m === 'DELETE') return sendJson(res, 200, { ok: store.deleteVideo(match[1]) });


  /* ------------------------------ REA (reverse engineering through an MCP server) ------------------------------ */
  if (p === '/api/rea/config' && m === 'GET') return sendJson(res, 200, rea.publicConfig());
  if (p === '/api/rea/config' && m === 'POST') return sendJson(res, 200, rea.saveConfig(await readBody(req)));
  if (p === '/api/rea/test' && m === 'POST') return sendJson(res, 200, await rea.test());
  if (p === '/api/rea/detect' && m === 'GET') return sendJson(res, 200, rea.detect());
  if (p === '/api/rea/tools' && m === 'GET') {
    try {
      return sendJson(res, 200, { tools: (await rea.getTools()).map((t) => ({ name: t.name, description: t.description || '', args: rea.schemaLine(t) })) });
    } catch (e) {
      rea.resetClient();
      throw store.httpError(502, 'Cannot reach REA: ' + e.message);
    }
  }
  if (p === '/api/rea/investigations' && m === 'GET') return sendJson(res, 200, rea.list());
  if (p === '/api/rea/investigations' && m === 'POST') return sendJson(res, 201, rea.create(await readBody(req)));
  if ((match = p.match(/^\/api\/rea\/investigations\/([a-z0-9-]+)$/))) {
    if (m === 'GET') return sendJson(res, 200, rea.get(match[1]));
    if (m === 'PATCH') {
      const b = await readBody(req);
      const patch = {};
      if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim().slice(0, 80);
      if (typeof b.description === 'string') patch.description = b.description.slice(0, 1000);
      if (typeof b.target === 'string') patch.target = b.target.trim().slice(0, 500);
      return sendJson(res, 200, rea.touch(match[1], patch));
    }
    if (m === 'DELETE') { rea.remove(match[1]); return sendJson(res, 200, { ok: true }); }
  }
  if ((match = p.match(/^\/api\/rea\/investigations\/([a-z0-9-]+)\/run$/)) && m === 'POST') {
    const b = await readBody(req);
    const run = rea.startRun({ slug: match[1], text: b.text, model: b.model, approve: b.approve });
    return sendJson(res, 202, { id: run.id });
  }


  /* ------------------------------ connectors (MCP servers models can use: local commands or remote URLs) ------------------------------ */
  if (p === '/api/connectors' && m === 'GET') return sendJson(res, 200, { connectors: connectors.list(), catalog: connectors.catalog() });
  if (p === '/api/connectors' && m === 'POST') {
    const b = await readBody(req);
    return sendJson(res, 201, b.preset ? connectors.createFromPreset(String(b.preset), b.inputs) : connectors.create(b));
  }
  if (p === '/api/connectors/detect' && m === 'GET') return sendJson(res, 200, connectors.detect());
  if (p === '/api/connectors/import' && m === 'POST') {
    const b = await readBody(req);
    return sendJson(res, 201, { imported: connectors.importServers({ json: b.json, source: b.source, names: b.names }) });
  }
  if (p === '/api/connectors/runs' && m === 'POST') {
    const b = await readBody(req);
    const run = connectors.startChatRun({ model: b.model, text: b.text, history: b.history, system: b.system, connectors: b.connectors, params: b.params });
    return sendJson(res, 202, { id: run.id });
  }
  if ((match = p.match(/^\/api\/connectors\/([a-z0-9-]+)$/))) {
    if (m === 'PATCH') return sendJson(res, 200, connectors.update(match[1], await readBody(req)));
    if (m === 'DELETE') { connectors.remove(match[1]); return sendJson(res, 200, { ok: true }); }
  }
  if ((match = p.match(/^\/api\/connectors\/([a-z0-9-]+)\/test$/)) && m === 'POST') return sendJson(res, 200, await connectors.test(match[1]));
  if ((match = p.match(/^\/api\/connectors\/([a-z0-9-]+)\/tools$/)) && m === 'GET') {
    try { return sendJson(res, 200, { tools: await connectors.toolsOf(match[1]) }); } catch (e) { if (e.status) throw e; throw store.httpError(502, 'Cannot reach this connector: ' + e.message); }
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    const p = url.pathname;
    // an app's sandboxed page has an opaque origin; it may only POST its own localStorage to this one route
    guard(req, req.method === 'POST' && /^\/preview\/[a-z0-9-]+\/__storage$/.test(p));
    if (p.startsWith('/api/')) return await handleApi(req, res, url);

    let match;
    // live preview of a generated website (sandboxed so site scripts cannot reach /api)
    if ((match = p.match(/^\/preview\/([a-z0-9-]+)(\/.*)?$/))) {
      let rel = decodeURIComponent(match[2] || '/');
      if (!match[2]) {
        res.writeHead(302, { Location: `/preview/${match[1]}/` });
        return res.end();
      }
      if (req.method === 'POST' && rel === '/__storage') {
        const raw = await new Promise((resolve, reject) => {
          const chunks = []; let size = 0;
          req.on('data', (c) => { size += c.length; if (size > 1.5 * 1024 * 1024) { reject(store.httpError(413, 'Too much data')); req.destroy(); return; } chunks.push(c); });
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          req.on('error', reject);
        });
        let data;
        try { data = JSON.parse(raw || '{}'); } catch { throw store.httpError(400, 'Body must be JSON text'); }
        store.writeStorage(match[1], data);
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
        return res.end();
      }
      if (rel.endsWith('/')) rel += 'index.html';
      const { full } = store.resolveProjectFile(match[1], rel);
      if (/\.html?$/i.test(full) && store.projectKind(match[1]) === 'app' && fs.existsSync(full)) {
        const html = store.injectIntoHtml(fs.readFileSync(full, 'utf8'), store.storageShim(match[1]));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads', 'Access-Control-Allow-Origin': '*' });
        return req.method === 'HEAD' ? res.end() : res.end(html);
      }
      return serveFile(req, res, full, {
        'Cache-Control': 'no-store',
        'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads',
        'Access-Control-Allow-Origin': '*',
      });
    }
    // files an agent produced (a website it built, a report...) are served sandboxed, like project previews
    if ((match = p.match(/^\/workspace\/([a-z0-9-]+)(\/.*)?$/))) {
      if (!match[2]) {
        res.writeHead(302, { Location: `/workspace/${match[1]}/` });
        return res.end();
      }
      let root;
      try { root = agent.workspaceRoot(match[1], false); } catch { throw store.httpError(404, 'Workspace not found'); }
      let rel = decodeURIComponent(match[2]).replace(/^\/+/, '');
      if (!rel || rel.endsWith('/')) rel += 'index.html';
      let full;
      try { full = agent.safePath(root, rel); } catch (e) { throw store.httpError(400, e.message); }
      return serveFile(req, res, full, { 'Cache-Control': 'no-store', 'Content-Security-Policy': 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads', 'Access-Control-Allow-Origin': '*' });
    }
    if ((match = p.match(/^\/outputs\/videos\/([^/]+)$/))) {
      const full = within(store.VIDEOS_DIR, match[1]);
      if (!full || full.endsWith('.json')) return serveFile(req, res, path.join(store.VIDEOS_DIR, '__missing__'));
      return serveFile(req, res, full, { 'Content-Disposition': 'inline' });
    }
    if (p === '/shared/stm.js') return serveFile(req, res, path.join(__dirname, 'lib', 'stm.js'), { 'Cache-Control': 'no-store' });

    const rel = p === '/' ? 'index.html' : p.slice(1);
    const full = within(PUBLIC_DIR, rel);
    if (!full) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    return serveFile(req, res, full, { 'Cache-Control': 'no-store' });
  } catch (e) {
    if (res.headersSent) return res.end();
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (url.pathname.startsWith('/api/')) return sendJson(res, status, { error: e.message || 'Server error' });
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(e.message || 'Server error');
  }
}

function markStaleJobs() {
  for (const v of store.listVideos()) {
    if (v.status === 'running') {
      v.status = 'error';
      v.error = 'Interrupted (the app was restarted).';
      store.saveVideoRecord(v);
    }
  }
}

if (require.main === module) {
  markStaleJobs();
  runs.markStale();
  // local connector servers are child processes: stop them with us
  process.on('exit', () => connectors.closeAll());
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
  const server = http.createServer(handle);
  server.requestTimeout = 0;
  server.listen(PORT, HOST, () => {
    const cfg = config.load();
    console.log('\n  OmniStudio is running');
    console.log(`  Open:      http://localhost:${PORT}`);
    console.log(`  OmniRoute: ${config.normalizeBaseUrl(cfg.baseUrl)} ${cfg.apiKey ? '(API key saved)' : '(no API key yet - add it in Settings)'}`);
    console.log(`  Data:      ${config.DATA_DIR}\n`);
  });
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\n  Port ${PORT} is already in use. Start with another port:  set PORT=3300 && node server.js\n`);
    else console.error(e);
    process.exit(1);
  });
}

module.exports = { handle, findVideoSources };
