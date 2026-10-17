'use strict';
/**
 * Skills: plain Markdown files in data/skills/<id>.md that models "learn".
 *
 *   ---
 *   name: Python style
 *   description: How we write Python in this team
 *   ---
 *   (any markdown: rules, examples, knowledge, checklists)
 *
 * The same frontmatter (name + description) is used by Anthropic-style SKILL.md files, so those can be imported as they are.
 *
 * Assignments (data/skills-assign.json) map a target -> skill ids. The target is a model/combo id, or "*" for everyone.
 * Before a request goes to a model, buildPrompt(model) renders every skill assigned to it (plus "*") into a system-prompt block.
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');

const SKILLS_DIR = path.join(config.DATA_DIR, 'skills');
const ASSIGN_FILE = path.join(config.DATA_DIR, 'skills-assign.json');
const MAX_SKILL_BYTES = 200 * 1024;
const DEFAULT_BUDGET = 24000; // characters of skill text per request (about 6k tokens)
const PER_SKILL_CAP = 12000;

config.ensureDir(SKILLS_DIR);

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const validId = (id) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(id || ''));

function slugify(name) {
  return (
    String(name || 'skill')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'skill'
  );
}

/* ---------------------------- frontmatter ---------------------------- */

function parse(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const meta = {};
  let body = text;
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (!kv) continue;
      let v = kv[2].trim();
      if (/^\[.*\]$/.test(v)) meta[kv[1]] = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      else meta[kv[1]] = v.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, body: body.replace(/^\n+/, '') };
}

function serialize({ name, description, tags }, body) {
  const one = (s) => String(s || '').replace(/\s*\n\s*/g, ' ').trim();
  let head = `---\nname: ${one(name)}\ndescription: ${one(description)}\n`;
  if (tags && tags.length) head += `tags: [${tags.map(one).join(', ')}]\n`;
  return head + '---\n\n' + String(body || '').replace(/^\n+/, '').replace(/\s+$/, '') + '\n';
}

/* ------------------------------- library ------------------------------ */

function fileFor(id) {
  if (!validId(id)) throw httpError(400, 'Invalid skill id');
  return path.join(SKILLS_DIR, id + '.md');
}

function describe(id) {
  const file = fileFor(id);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const { meta, body } = parse(raw);
  const stat = fs.statSync(file);
  return {
    id,
    name: String(meta.name || id),
    description: String(meta.description || ''),
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    body,
    chars: body.length,
    updated: stat.mtimeMs,
  };
}

function list() {
  const out = [];
  for (const f of fs.readdirSync(SKILLS_DIR)) {
    if (!f.endsWith('.md')) continue;
    const id = f.slice(0, -3);
    if (!validId(id)) continue; // files dropped in by hand with odd names are ignored, not crashed on
    const s = describe(id);
    if (s) out.push(s);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function get(id) {
  return validId(id) ? describe(id) : null;
}

/** Find by id or (case-insensitive) name. */
function find(ref) {
  const r = String(ref || '').trim().toLowerCase();
  if (!r) return null;
  const all = list();
  return all.find((s) => s.id === r) || all.find((s) => s.name.toLowerCase() === r) || all.find((s) => s.id === slugify(r)) || null;
}

/**
 * Create or update a skill. `content` may be a complete .md file (with its own frontmatter) or just a body.
 * Explicit name/description arguments win over frontmatter.
 */
function save({ id, name, description, tags, content }) {
  const parsed = parse(content);
  const finalName = String(name || parsed.meta.name || '').trim() || 'Untitled skill';
  const finalDesc = String(description !== undefined && description !== null && description !== '' ? description : parsed.meta.description || '').trim();
  const finalTags = Array.isArray(tags) ? tags : Array.isArray(parsed.meta.tags) ? parsed.meta.tags : [];
  const body = parsed.body;
  if (!body.trim()) throw httpError(400, 'A skill needs some content.');
  let sid = id;
  if (sid) {
    if (!validId(sid)) throw httpError(400, 'Invalid skill id');
  } else {
    sid = slugify(finalName);
    let n = 1;
    const base = sid.slice(0, 56);
    while (fs.existsSync(fileFor(sid))) sid = base + '-' + ++n;
  }
  const out = serialize({ name: finalName, description: finalDesc, tags: finalTags }, body);
  if (Buffer.byteLength(out) > MAX_SKILL_BYTES) throw httpError(413, 'Skill is too large (limit 200 KB).');
  const file = fileFor(sid);
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, out);
  fs.renameSync(tmp, file);
  return describe(sid);
}

function remove(id) {
  const file = fileFor(id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  // drop dangling references
  const a = loadAssign();
  let changed = false;
  for (const k of Object.keys(a)) {
    const next = a[k].filter((x) => x !== id);
    if (next.length !== a[k].length) {
      a[k] = next;
      changed = true;
    }
  }
  if (changed) saveAssign(a);
  return true;
}

/* ----------------------------- assignments ---------------------------- */

function loadAssign() {
  const raw = config.readJson(ASSIGN_FILE, {});
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) if (Array.isArray(v)) out[k] = [...new Set(v.map(String))];
  return out;
}

function saveAssign(a) {
  const clean = {};
  for (const [k, v] of Object.entries(a)) if (v.length) clean[k] = v;
  config.writeJsonAtomic(ASSIGN_FILE, clean);
}

/** Replace the skill list of one target ("*" = everyone). Unknown ids are rejected. */
function setAssign(target, ids) {
  const t = String(target || '').trim();
  if (!t || t.length > 200) throw httpError(400, 'Choose a model, combo, or * for everyone');
  const known = new Set(list().map((s) => s.id));
  const next = [...new Set((ids || []).map(String))];
  const bad = next.filter((x) => !known.has(x));
  if (bad.length) throw httpError(400, 'Unknown skill: ' + bad.join(', '));
  const a = loadAssign();
  a[t] = next;
  saveAssign(a);
  return loadAssign();
}

function assignedIds(model) {
  const a = loadAssign();
  return [...new Set([...(a['*'] || []), ...(model ? a[String(model)] || [] : [])])];
}

/* ------------------------------ prompt block ------------------------------ */

/**
 * Render the skills a model has learned. Skills that do not fit the budget are listed by name only
 * (agents can pull them in with the read_skill tool).
 */
function buildPrompt(model, opts = {}) {
  const budget = opts.budget || DEFAULT_BUDGET;
  const ids = assignedIds(model);
  if (!ids.length) return { text: '', included: [], listed: [], chars: 0 };
  const skills = ids.map((id) => get(id)).filter(Boolean);
  if (!skills.length) return { text: '', included: [], listed: [], chars: 0 };
  const included = [];
  const listed = [];
  let used = 0;
  let text = '';
  for (const s of skills) {
    let body = s.body.trim();
    if (body.length > PER_SKILL_CAP) body = body.slice(0, PER_SKILL_CAP) + '\n…(truncated)';
    const section = `\n## Skill: ${s.name}\n${s.description ? `_${s.description}_\n\n` : ''}${body}\n`;
    if (used + section.length > budget) {
      listed.push({ id: s.id, name: s.name, description: s.description });
      continue;
    }
    used += section.length;
    text += section;
    included.push({ id: s.id, name: s.name, chars: section.length });
  }
  let head = '# SKILLS AND KNOWLEDGE YOU HAVE LEARNED\nThe sections below are part of how you work. Follow them whenever they are relevant to the task; if one conflicts with an explicit instruction from the user, the user wins.\n';
  if (listed.length) {
    text += `\n## More skills (not loaded - too long for this request)\n` + listed.map((s) => `- ${s.name}${s.description ? ': ' + s.description : ''}`).join('\n') + '\n';
  }
  return { text: head + text, included, listed, chars: (head + text).length };
}

/** Add the skills block to the system message (or create one). Returns { messages, skills }. */
function inject(messages, model, opts = {}) {
  const block = buildPrompt(model, opts);
  if (!block.text) return { messages, skills: [] };
  const out = messages.map((m) => ({ ...m }));
  const i = out.findIndex((m) => m.role === 'system');
  if (i >= 0 && typeof out[i].content === 'string') out[i].content = out[i].content.replace(/\s+$/, '') + '\n\n' + block.text;
  else out.unshift({ role: 'system', content: block.text });
  return { messages: out, skills: block.included.map((s) => s.name) };
}

module.exports = {
  SKILLS_DIR, list, get, find, save, remove, parse, serialize, slugify, validId,
  loadAssign, setAssign, assignedIds, buildPrompt, inject, httpError,
};
