'use strict';
/**
 * Runs are long-lived background jobs (an agent working in its workspace, a team project, a benchmark).
 * Each run keeps an append-only event log that the UI polls (GET /api/runs/:id?since=N), can be stopped, and can
 * wait for the user to approve a shell command. Logs are saved to data/runs/<id>.json so history survives a restart.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

const RUNS_DIR = path.join(config.DATA_DIR, 'runs');
config.ensureDir(RUNS_DIR);

const RUNS = new Map();
const MAX_EVENTS = 6000;
const MAX_TEXT = 20000;
const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;

const validId = (id) => /^[A-Za-z0-9_-]{1,80}$/.test(String(id || ''));

function trimEvent(ev) {
  const out = {};
  for (const [k, v] of Object.entries(ev)) out[k] = typeof v === 'string' && v.length > MAX_TEXT ? v.slice(0, MAX_TEXT) + '\n…(truncated)' : v;
  return out;
}

function summary(run) {
  return { id: run.id, kind: run.kind, title: run.title, status: run.status, created: run.created, ended: run.ended || null, meta: run.meta, events: run.events.length };
}

function persist(run) {
  clearTimeout(run._timer);
  run._timer = null;
  try {
    config.writeJsonAtomic(path.join(RUNS_DIR, run.id + '.json'), { ...summary(run), events: run.events });
  } catch {}
}

function create({ kind, title, meta }) {
  const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const run = {
    id, kind, title: String(title || kind).slice(0, 120), status: 'running', created: Date.now(), ended: null,
    meta: meta || {}, events: [], pending: new Map(), abort: new AbortController(), _timer: null,
  };
  run.emit = (ev) => {
    if (run.events.length >= MAX_EVENTS) return;
    run.events.push({ i: run.events.length, t: Date.now(), ...trimEvent(ev) });
    if (!run._timer) run._timer = setTimeout(() => persist(run), 1500);
  };
  run.finish = (status, extra) => {
    if (run.ended) return;
    run.status = status;
    run.ended = Date.now();
    if (extra) Object.assign(run.meta, extra);
    for (const [, p] of run.pending) p.resolve(false);
    run.pending.clear();
    run.emit({ type: 'end', status });
    persist(run);
  };
  RUNS.set(id, run);
  persist(run);
  return run;
}

/** Ask the user to approve a shell command. Resolves true/false; false on stop or after 15 minutes. */
function requestApproval(run, info) {
  return new Promise((resolve) => {
    const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    const timer = setTimeout(() => {
      if (run.pending.delete(id)) {
        run.emit({ type: 'approval_result', approvalId: id, allowed: false, note: 'timed out', taskId: info.taskId });
        resolve(false);
      }
    }, APPROVAL_TIMEOUT_MS);
    run.pending.set(id, {
      info,
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
    });
    run.emit({ type: 'approval', approvalId: id, ...info });
  });
}

function approve(run, approvalId, allow) {
  const p = run.pending.get(approvalId);
  if (!p) return false;
  run.pending.delete(approvalId);
  run.emit({ type: 'approval_result', approvalId, allowed: !!allow, taskId: p.info.taskId });
  p.resolve(!!allow);
  return true;
}

function stop(run) {
  if (run.ended) return false;
  run.abort.abort();
  for (const [, p] of run.pending) p.resolve(false);
  run.pending.clear();
  return true;
}

function load(id) {
  if (!validId(id)) return null;
  if (RUNS.has(id)) return RUNS.get(id);
  return null;
}

function readDisk(id) {
  return validId(id) ? config.readJson(path.join(RUNS_DIR, id + '.json'), null) : null;
}

// Listing is polled every few seconds by the UI; parsing every saved log each time gets slow once there is history.
// So summaries of files on disk are cached by modified time and only re-read when a file changes.
const SUMMARY_CACHE = new Map(); // file -> { mtimeMs, summary }

function list(kind) {
  const seen = new Map();
  const present = new Set();
  for (const f of fs.readdirSync(RUNS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const file = path.join(RUNS_DIR, f);
    present.add(file);
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; } catch { continue; }
    let hit = SUMMARY_CACHE.get(file);
    if (!hit || hit.mtimeMs !== mtimeMs) {
      const r = config.readJson(file, null);
      hit = { mtimeMs, summary: r && r.id ? { id: r.id, kind: r.kind, title: r.title, status: r.status, created: r.created, ended: r.ended, meta: r.meta, events: (r.events || []).length } : null };
      SUMMARY_CACHE.set(file, hit);
    }
    if (hit.summary) seen.set(hit.summary.id, hit.summary);
  }
  for (const file of SUMMARY_CACHE.keys()) if (!present.has(file)) SUMMARY_CACHE.delete(file);
  for (const run of RUNS.values()) seen.set(run.id, summary(run));
  return [...seen.values()].filter((r) => !kind || r.kind === kind).sort((a, b) => b.created - a.created);
}

/** Events after index `since` plus anything waiting on the user. Works for live runs and saved ones. */
function view(id, since) {
  const live = load(id);
  const from = Math.max(0, Number(since) || 0);
  if (live) {
    return {
      ...summary(live),
      events: live.events.slice(from),
      next: live.events.length,
      pending: [...live.pending].map(([approvalId, p]) => ({ approvalId, ...p.info })),
    };
  }
  const disk = readDisk(id);
  if (!disk) return null;
  const events = disk.events || [];
  return { id: disk.id, kind: disk.kind, title: disk.title, status: disk.status, created: disk.created, ended: disk.ended, meta: disk.meta, events: events.slice(from), next: events.length, pending: [] };
}

function remove(id) {
  const live = RUNS.get(id);
  if (live && !live.ended) return false;
  RUNS.delete(id);
  try {
    fs.unlinkSync(path.join(RUNS_DIR, id + '.json'));
    return true;
  } catch {
    return false;
  }
}

/** On startup: anything that was still running when the app stopped cannot continue. */
function markStale() {
  for (const f of fs.readdirSync(RUNS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const file = path.join(RUNS_DIR, f);
    const r = config.readJson(file, null);
    if (r && r.status === 'running') {
      r.status = 'interrupted';
      r.ended = Date.now();
      (r.events ||= []).push({ i: r.events.length, t: Date.now(), type: 'end', status: 'interrupted' });
      config.writeJsonAtomic(file, r);
    }
  }
}

module.exports = { create, requestApproval, approve, stop, load, list, view, remove, markStale, validId, RUNS_DIR };
