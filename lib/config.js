'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.OMNISTUDIO_DATA || path.join(__dirname, '..', 'data'));
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  baseUrl: 'http://localhost:20128/v1',
  apiKey: '',
  // default model / combo per mode
  modeModels: { chat: '', reasoning: '', coding: '', builder: '', app: '', rea: '', video: '', judge: '' },
  // combos or models typed in by hand (shown first in every picker)
  pinned: [],
  videoPath: '/videos/generations',
  autotune: { enabled: true },
  stm: { enabled: [] },
  requestTimeoutSec: 300,
  // web search: duckduckgo (no key, best effort) | serper | serpapi (both return real Google results) | brave | searxng
  search: { provider: 'duckduckgo', apiKey: '', url: '', maxResults: 8 },
  // the agent's computer. shell: off | confirm (ask before every command) | auto
  agent: { shell: 'confirm', maxSteps: 30, commandTimeoutSec: 120 },
  // multi-model team defaults (the roster itself lives in data/team.json)
  team: { maxParallel: 3, maxAttempts: 3 },
  // REA (reverse engineering) through an MCP server that OmniStudio starts on this computer.
  // The default command is a best guess; use Detect in the REA tab to copy the exact one REA's own setup wrote.
  // Connectors: MCP servers (local command or remote URL) that models can use from Chat / Reasoning / Coding. The list itself lives in data/connectors.json.
  connectors: { maxSteps: 15, callTimeoutSec: 300 },
  rea: { command: 'npx', args: '-y rea-agents mcp', cwd: '', approve: 'confirm', maxSteps: 40, callTimeoutSec: 600 },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file, data) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = merge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

let cache = null;

function load() {
  if (!cache) cache = merge(DEFAULTS, readJson(CONFIG_FILE, {}));
  return cache;
}

function save(patch) {
  cache = merge(load(), patch);
  writeJsonAtomic(CONFIG_FILE, cache);
  return cache;
}

/** Turn what the user typed into a usable OpenAI-compatible base URL. */
function normalizeBaseUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return DEFAULTS.baseUrl;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  s = s.replace(/\/+$/, '');
  try {
    const u = new URL(s);
    if (u.pathname === '' || u.pathname === '/') s = u.origin + '/v1';
  } catch {
    return DEFAULTS.baseUrl;
  }
  return s;
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

function publicView() {
  const c = load();
  const search = { ...c.search, apiKey: '', apiKeyMasked: maskKey(c.search.apiKey), hasKey: !!c.search.apiKey };
  return { ...c, apiKey: '', apiKeyMasked: maskKey(c.apiKey), hasKey: !!c.apiKey, search, dataDir: DATA_DIR };
}

module.exports = { DATA_DIR, load, save, publicView, normalizeBaseUrl, ensureDir, writeJsonAtomic, readJson, maskKey };
