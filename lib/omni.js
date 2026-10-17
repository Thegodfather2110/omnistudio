'use strict';
const { Readable } = require('stream');
const config = require('./config');

// Optional params that some providers reject. If OmniRoute answers 400/422 we retry once without them.
const OPTIONAL_PARAMS = ['reasoning_effort', 'reasoning', 'frequency_penalty', 'presence_penalty', 'top_p'];

function headers(extra) {
  const c = config.load();
  const h = { 'Content-Type': 'application/json', Accept: 'application/json', ...extra };
  if (c.apiKey) h.Authorization = 'Bearer ' + c.apiKey;
  return h;
}

function url(pathPart) {
  const c = config.load();
  return config.normalizeBaseUrl(c.baseUrl) + (pathPart.startsWith('/') ? pathPart : '/' + pathPart);
}

function origin() {
  try {
    return new URL(config.normalizeBaseUrl(config.load().baseUrl)).origin;
  } catch {
    return 'http://localhost:20128';
  }
}

function timeoutSignal(ms) {
  return AbortSignal.timeout(ms || config.load().requestTimeoutSec * 1000);
}

async function readError(resp) {
  let text = '';
  try {
    text = await resp.text();
  } catch {}
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = (j.error && (j.error.message || j.error)) || j.message || text;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
  } catch {}
  return (msg || resp.statusText || 'Request failed').slice(0, 1500);
}

function describeNetworkError(err) {
  const code = err && err.cause && err.cause.code;
  if (code === 'ECONNREFUSED') return `Cannot reach OmniRoute at ${origin()} (connection refused). Is OmniRoute running?`;
  if (code === 'ENOTFOUND') return `Host not found for ${origin()}. Check the Base URL in Settings.`;
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'The request to OmniRoute timed out.';
  return (err && err.message) || 'Network error talking to OmniRoute';
}

/** POST JSON to OmniRoute with one automatic retry that strips optional params. */
async function postJson(pathPart, body, opts = {}) {
  const attempt = (b) =>
    fetch(url(pathPart), {
      method: 'POST',
      headers: headers(opts.headers),
      body: JSON.stringify(b),
      signal: opts.signal || timeoutSignal(opts.timeoutMs),
    });
  let resp = await attempt(body);
  if ((resp.status === 400 || resp.status === 422) && OPTIONAL_PARAMS.some((p) => p in body)) {
    const stripped = { ...body };
    for (const p of OPTIONAL_PARAMS) delete stripped[p];
    const retry = await attempt(stripped);
    if (retry.ok) return retry;
    return retry.status === resp.status ? retry : resp;
  }
  return resp;
}

async function getJson(pathPart, opts = {}) {
  return fetch(url(pathPart), { method: 'GET', headers: headers(), signal: opts.signal || timeoutSignal(15000) });
}

async function fetchModels() {
  const result = { models: [], combos: [], error: null };
  try {
    const resp = await getJson('/models');
    if (!resp.ok) {
      result.error = `OmniRoute answered ${resp.status}: ${await readError(resp)}`;
      return result;
    }
    const j = await resp.json();
    const list = Array.isArray(j) ? j : j.data || j.models || [];
    result.models = list
      .map((m) => (typeof m === 'string' ? { id: m } : { id: m.id || m.name, owned_by: m.owned_by || m.provider || '', type: m.type || m.kind || '' }))
      .filter((m) => m.id);
  } catch (e) {
    result.error = describeNetworkError(e);
    return result;
  }
  // Best effort: OmniRoute's dashboard API knows which entries are combos. Not fatal if absent.
  try {
    const resp = await fetch(origin() + '/api/combos', { headers: headers(), signal: timeoutSignal(5000) });
    if (resp.ok) {
      const j = await resp.json();
      const arr = Array.isArray(j) ? j : j.combos || j.data || [];
      result.combos = arr.map((c) => (typeof c === 'string' ? c : c.name || c.id)).filter(Boolean);
    }
  } catch {}
  return result;
}

/** Pipe an upstream response body to a Node http response (used for SSE streaming). */
function pipeBody(upstream, res) {
  Readable.fromWeb(upstream.body).on('error', () => res.end()).pipe(res);
}

module.exports = { postJson, getJson, fetchModels, readError, describeNetworkError, pipeBody, url, origin, headers, timeoutSignal };
