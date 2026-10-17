'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

const CHATS_DIR = path.join(config.DATA_DIR, 'chats');
const PROJECTS_DIR = path.join(config.DATA_DIR, 'projects');
const VIDEOS_DIR = path.join(config.DATA_DIR, 'outputs', 'videos');
const META_DIR = '.studio';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

for (const d of [CHATS_DIR, PROJECTS_DIR, VIDEOS_DIR]) config.ensureDir(d);

const safeId = (id) => /^[A-Za-z0-9_-]{1,80}$/.test(String(id || ''));

/* ------------------------------ chats ------------------------------ */

function listChats(scope) {
  const out = [];
  for (const f of fs.readdirSync(CHATS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const c = config.readJson(path.join(CHATS_DIR, f), null);
    if (!c) continue;
    if (scope && c.mode !== scope) continue;
    out.push({ id: c.id, title: c.title, mode: c.mode, updated: c.updated, count: (c.messages || []).length });
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function getChat(id) {
  if (!safeId(id)) return null;
  return config.readJson(path.join(CHATS_DIR, id + '.json'), null);
}

function saveChat(id, data) {
  if (!safeId(id)) throw httpError(400, 'Invalid chat id');
  const chat = {
    id,
    mode: String(data.mode || 'chat'),
    title: String(data.title || 'New chat').slice(0, 120),
    model: data.model || '',
    messages: Array.isArray(data.messages) ? data.messages : [],
    created: data.created || Date.now(),
    updated: Date.now(),
  };
  config.writeJsonAtomic(path.join(CHATS_DIR, id + '.json'), chat);
  return chat;
}

function deleteChat(id) {
  if (!safeId(id)) return false;
  try {
    fs.unlinkSync(path.join(CHATS_DIR, id + '.json'));
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------- projects ---------------------------- */

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

function slugify(name) {
  return (
    String(name || 'project')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'project'
  );
}

function projectDir(slug) {
  if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(String(slug || ''))) throw httpError(400, 'Invalid project id');
  return path.join(PROJECTS_DIR, slug);
}

/** Resolve a relative file path inside a project; throws on traversal or reserved folders. */
function resolveProjectFile(slug, rel) {
  const base = projectDir(slug);
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.includes('\0')) throw httpError(400, 'Invalid file path');
  const parts = clean.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '' || p === META_DIR || p.startsWith('.git'))) throw httpError(400, 'Path not allowed');
  const full = path.resolve(base, clean);
  if (!full.startsWith(base + path.sep)) throw httpError(400, 'Path not allowed');
  return { full, rel: parts.join('/') };
}

function readMeta(slug) {
  return config.readJson(path.join(projectDir(slug), META_DIR, 'meta.json'), null);
}

function walk(dir, base, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === META_DIR || entry.name.startsWith('.git') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push({ path: path.relative(base, full).split(path.sep).join('/'), size: fs.statSync(full).size });
  }
  return out;
}

function listProjectFiles(slug) {
  const dir = projectDir(slug);
  if (!fs.existsSync(dir)) throw httpError(404, 'Project not found');
  return walk(dir, dir, []).sort((a, b) => (a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : a.path.localeCompare(b.path)));
}

function listProjects(kind) {
  const out = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const meta = readMeta(entry.name);
    if (!meta) continue;
    if (kind && (meta.kind || 'site') !== kind) continue;
    let files = [];
    try {
      files = listProjectFiles(entry.name);
    } catch {}
    out.push({
      slug: entry.name,
      name: meta.name,
      description: meta.description || '',
      kind: meta.kind || 'site',
      created: meta.created,
      updated: meta.updated,
      fileCount: files.length,
      hasIndex: files.some((f) => f.path === 'index.html'),
      folder: path.join(PROJECTS_DIR, entry.name),
    });
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

/** 'site' (default, also for projects made before 1.3) or 'app'. */
function projectKind(slug) {
  const meta = readMeta(slug);
  return meta ? meta.kind || 'site' : null;
}

function createProject(name, description, kind) {
  const cleanName = String(name || '').trim().slice(0, 80);
  if (!cleanName) throw httpError(400, 'Project name is required');
  let slug = slugify(cleanName);
  let n = 1;
  while (fs.existsSync(path.join(PROJECTS_DIR, slug))) slug = slugify(cleanName).slice(0, 44) + '-' + ++n;
  const dir = projectDir(slug);
  config.ensureDir(path.join(dir, META_DIR));
  const now = Date.now();
  const meta = { name: cleanName, description: String(description || '').slice(0, 500), kind: kind === 'app' ? 'app' : 'site', created: now, updated: now };
  config.writeJsonAtomic(path.join(dir, META_DIR, 'meta.json'), meta);
  config.writeJsonAtomic(path.join(dir, META_DIR, 'chat.json'), { messages: [] });
  return { slug, ...meta, folder: dir };
}

function touchProject(slug, patch) {
  const meta = readMeta(slug);
  if (!meta) throw httpError(404, 'Project not found');
  const next = { ...meta, ...patch, updated: Date.now() };
  config.writeJsonAtomic(path.join(projectDir(slug), META_DIR, 'meta.json'), next);
  return next;
}

function getProject(slug) {
  const meta = readMeta(slug);
  if (!meta) throw httpError(404, 'Project not found');
  const files = listProjectFiles(slug).map((f) => {
    let content = null;
    if (f.size <= 400 * 1024 && /\.(html?|css|js|mjs|json|svg|txt|md|xml|csv|ts|tsx|jsx|webmanifest)$/i.test(f.path)) {
      content = fs.readFileSync(path.join(projectDir(slug), f.path), 'utf8');
    }
    return { ...f, content };
  });
  const chat = config.readJson(path.join(projectDir(slug), META_DIR, 'chat.json'), { messages: [] });
  return { slug, ...meta, folder: projectDir(slug), files, chat };
}

function writeProjectFile(slug, rel, content) {
  if (!readMeta(slug)) throw httpError(404, 'Project not found');
  const { full, rel: clean } = resolveProjectFile(slug, rel);
  const data = Buffer.from(String(content ?? ''), 'utf8');
  if (data.length > MAX_FILE_BYTES) throw httpError(413, 'File too large');
  config.ensureDir(path.dirname(full));
  fs.writeFileSync(full, data);
  touchProject(slug, {});
  return clean;
}

function deleteProjectFile(slug, rel) {
  const { full } = resolveProjectFile(slug, rel);
  fs.unlinkSync(full);
  touchProject(slug, {});
}

function saveProjectChat(slug, messages) {
  if (!readMeta(slug)) throw httpError(404, 'Project not found');
  config.writeJsonAtomic(path.join(projectDir(slug), META_DIR, 'chat.json'), { messages: Array.isArray(messages) ? messages : [] });
}

function deleteProject(slug) {
  const dir = projectDir(slug);
  if (!readMeta(slug)) throw httpError(404, 'Project not found');
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Pull files out of a model reply. Accepts:
 *   ```html file=index.html            (preferred)
 *   ```file:css/style.css
 *   ```css path="style.css"
 * and falls back to a lone ```html block -> index.html.
 */
function extractFiles(text) {
  const files = [];
  const re = /```([a-zA-Z0-9+#-]*)[ \t]*(?:(?:file|path|filename)\s*[=:]\s*["']?([^\s"'`]+)["']?)?[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const lang = (m[1] || '').toLowerCase();
    let name = m[2];
    if (!name && /^(file|path):/i.test(lang)) name = lang.replace(/^(file|path):/i, '');
    if (!name) {
      const first = (m[3].split('\n', 1)[0] || '').match(/^(?:<!--|\/\*|\/\/|#)\s*(?:file|path|filename)\s*:\s*([^\s*>-]+)/i);
      if (first) name = first[1];
    }
    if (name) files.push({ path: name, content: m[3].replace(/\n$/, '') });
  }
  if (!files.length) {
    const html = text.match(/```html[^\n]*\n([\s\S]*?)```/i);
    if (html && /<html|<!doctype|<body/i.test(html[1])) files.push({ path: 'index.html', content: html[1].replace(/\n$/, '') });
  }
  return files;
}

function applyModelReply(slug, text) {
  const written = [];
  const skipped = [];
  for (const f of extractFiles(text)) {
    try {
      written.push(writeProjectFile(slug, f.path, f.content));
    } catch (e) {
      skipped.push({ path: f.path, reason: e.message });
    }
  }
  return { written, skipped };
}


/* ------------------- app storage (what the app's localStorage persists) ------------------- */

const MAX_STORAGE_BYTES = 1024 * 1024;

function storageFile(slug) {
  return path.join(projectDir(slug), META_DIR, 'storage.json');
}

function readStorage(slug) {
  const j = config.readJson(storageFile(slug), {});
  const out = {};
  if (j && typeof j === 'object' && !Array.isArray(j)) for (const [k, v] of Object.entries(j)) if (typeof v === 'string') out[k] = v;
  return out;
}

function writeStorage(slug, data) {
  if (projectKind(slug) !== 'app') throw httpError(404, 'App not found');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw httpError(400, 'Storage must be an object of text values');
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v !== 'string' || k.length > 200) continue;
    clean[k] = v;
  }
  const json = JSON.stringify(clean);
  if (Buffer.byteLength(json) > MAX_STORAGE_BYTES) throw httpError(413, 'The app stored more than 1 MB of data');
  config.writeJsonAtomic(storageFile(slug), clean);
  return clean;
}

function clearStorage(slug) {
  if (!readMeta(slug)) throw httpError(404, 'Project not found');
  try { fs.unlinkSync(storageFile(slug)); } catch {}
}

/** Script injected into an app's HTML so localStorage works inside the sandboxed preview and survives reloads. */
function storageShim(slug) {
  const json = JSON.stringify(readStorage(slug)).replace(/</g, '\\u003c');
  return `<script>/*omnistudio-storage*/(function(){var d=Object.assign(Object.create(null),${json}),slug=${JSON.stringify(slug)},timer=null;
function flush(){clearTimeout(timer);try{fetch('/preview/'+slug+'/__storage',{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(d),keepalive:true}).catch(function(){})}catch(e){}}
function save(){clearTimeout(timer);timer=setTimeout(flush,250)}
function make(persist){var m=persist?d:Object.create(null);var s={getItem:function(k){k=String(k);return k in m?m[k]:null},setItem:function(k,v){m[String(k)]=String(v);if(persist)save()},removeItem:function(k){delete m[String(k)];if(persist)save()},clear:function(){for(var k in m)delete m[k];if(persist)save()},key:function(i){var ks=Object.keys(m);return i>=0&&i<ks.length?ks[i]:null}};Object.defineProperty(s,'length',{get:function(){return Object.keys(m).length}});return s}
try{Object.defineProperty(window,'localStorage',{value:make(true),configurable:true});Object.defineProperty(window,'sessionStorage',{value:make(false),configurable:true})}catch(e){}
window.addEventListener('pagehide',flush);})();</script>`;
}

function injectIntoHtml(html, snippet) {
  const m = html.match(/<head[^>]*>/i);
  if (m) return html.slice(0, m.index + m[0].length) + snippet + html.slice(m.index + m[0].length);
  const d = html.match(/<!doctype[^>]*>/i);
  if (d) return html.slice(0, d.index + d[0].length) + snippet + html.slice(d.index + d[0].length);
  return snippet + html;
}

/* ------------------------------ videos ----------------------------- */

function saveVideoRecord(record) {
  config.writeJsonAtomic(path.join(VIDEOS_DIR, record.id + '.json'), record);
}

function listVideos() {
  const out = [];
  for (const f of fs.readdirSync(VIDEOS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const r = config.readJson(path.join(VIDEOS_DIR, f), null);
    if (r) out.push(r);
  }
  return out.sort((a, b) => b.created - a.created);
}

function deleteVideo(id) {
  if (!safeId(id)) return false;
  const rec = config.readJson(path.join(VIDEOS_DIR, id + '.json'), null);
  if (!rec) return false;
  for (const f of rec.files || []) {
    try {
      fs.unlinkSync(path.join(VIDEOS_DIR, path.basename(f.file)));
    } catch {}
  }
  try {
    fs.unlinkSync(path.join(VIDEOS_DIR, id + '.json'));
  } catch {}
  return true;
}

module.exports = {
  CHATS_DIR, PROJECTS_DIR, VIDEOS_DIR, httpError, safeId,
  listChats, getChat, saveChat, deleteChat,
  projectKind, readStorage, writeStorage, clearStorage, storageShim, injectIntoHtml,
  listProjects, createProject, getProject, touchProject, writeProjectFile, deleteProjectFile,
  saveProjectChat, deleteProject, projectDir, resolveProjectFile, extractFiles, applyModelReply,
  saveVideoRecord, listVideos, deleteVideo,
};
