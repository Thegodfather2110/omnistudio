'use strict';
/* OmniStudio core: helpers shared by every view. */
(function () {
  const S = (window.S = {
    config: null, models: [], combos: [], modelsError: null, modelsLoaded: false,
    views: {}, route: null, cleanup: null, chatState: {},
  });

  S.$ = (sel, root = document) => root.querySelector(sel);
  S.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  S.el = (tag, attrs, ...kids) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') node[k] = !!v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return node;
  };
  const el = S.el;

  /** Replace a node's children; unlike replaceChildren it flattens arrays and skips null/false. */
  S.set = (node, ...kids) => {
    node.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
  };

  S.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  S.api = async (method, path, body) => {
    const resp = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : method === 'DELETE' ? {} : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await resp.json(); } catch {}
    if (!resp.ok) throw new Error((json && json.error) || `Request failed (${resp.status})`);
    return json;
  };

  S.toast = (msg, bad) => {
    const t = el('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    S.$('#toasts').append(t);
    setTimeout(() => t.remove(), bad ? 7000 : 3200);
  };

  S.copy = async (text, note = 'Copied') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = el('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    S.toast(note);
  };

  S.ago = (ts) => {
    if (!ts) return '';
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  };

  S.pref = {
    get(key, fallback) { try { const v = localStorage.getItem('os.' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem('os.' + key, JSON.stringify(value)); } catch {} },
  };

  const ICONS = {
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    reasoning: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    coding: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
    builder: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
    apps: '<rect x="3" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8"/>',
    connectors: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>',
    rea: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.9-4.9M8.5 8.5l-2 2 2 2M12.5 8.5l2 2-2 2"/>',
    video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
    arena: '<path d="M6 4l6 8-6 8M18 4l-6 8 6 8"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
    send: '<path d="M5 12l15-8-5 17-3-7z"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4"/>',
    down: '<path d="M12 4v12M6 12l6 6 6-6M5 21h14"/>',
    skills: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M9 7h6M9 11h6"/>',
    agent: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
    team: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5M15 14.8c3 0 6.5 1.5 6.5 5.2"/>',
  };
  S.icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  S.iconEl = (name) => el('span', { html: S.icon(name), style: 'display:inline-flex' });

  /* ------------------------------ markdown ------------------------------ */
  function renderCode(b, opts) {
    const info = b.info || '';
    const fileM = info.match(/(?:file|path|filename)\s*[=:]\s*["']?([^\s"']+)/i);
    const lang = (info.split(/\s+/)[0] || '').replace(/^(file|path|filename)[=:].*$/i, '');
    const code = b.code.replace(/\n$/, '');
    if (opts.collapseFiles && fileM) {
      const lines = code ? code.split('\n').length : 0;
      return `<details class="filecard"><summary>📄 ${S.esc(fileM[1])} · ${lines} lines</summary><pre>${S.esc(code)}</pre></details>`;
    }
    return `<div class="code"><div class="code-head"><span>${S.esc(lang || 'text')}</span><button class="btn sm ghost" data-copy>Copy</button></div><pre><code>${S.esc(code)}</code></pre></div>`;
  }

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0002${codes.length - 1}\u0002`; });
    s = S.esc(s);
    s = s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(])_(?!\s)(.+?)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|#[^\s)]*)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s.replace(/\u0002(\d+)\u0002/g, (_, i) => `<code>${S.esc(codes[i])}</code>`);
  }

  S.md = (src, opts = {}) => {
    const blocks = [];
    let text = String(src || '').replace(/\r\n/g, '\n');
    text = text.replace(/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g, (m, info, code) => {
      blocks.push({ info: info.trim(), code });
      return `\n\u0001${blocks.length - 1}\u0001\n`;
    });
    const lines = text.split('\n');
    const out = [];
    let para = [];
    let i = 0;
    const flush = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (!line.trim()) { flush(); i++; continue; }
      if ((m = line.match(/^\u0001(\d+)\u0001$/))) { flush(); out.push(renderCode(blocks[+m[1]], opts)); i++; continue; }
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
      if (/^>\s?/.test(line)) {
        flush();
        const q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
        out.push('<blockquote>' + q.map(inline).join('<br>') + '</blockquote>');
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
        flush();
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/).test(lines[i])) {
          items.push(lines[i++].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/, ''));
        }
        out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
        continue;
      }
      if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush();
        const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
        out.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      para.push(line);
      i++;
    }
    flush();
    return out.join('\n');
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const pre = btn.closest('.code')?.querySelector('pre');
    if (pre) S.copy(pre.innerText);
  });

  /* --------------------------- thinking + stream -------------------------- */
  /** Separate <think>…</think> text (used by some models) from the answer. */
  S.splitThink = (msg) => {
    let think = msg.reasoning || '';
    let answer = msg.content || '';
    const closed = answer.match(/<think>([\s\S]*?)<\/think>\s*/i);
    if (closed) { think = (think ? think + '\n\n' : '') + closed[1].trim(); answer = answer.replace(closed[0], ''); }
    else {
      const open = answer.match(/<think>([\s\S]*)$/i);
      if (open) { think = (think ? think + '\n\n' : '') + open[1].trim(); answer = answer.slice(0, open.index); }
    }
    return { think: think.trim(), answer };
  };

  S.stmActive = () => (S.config?.stm?.enabled || []).filter((id) => window.STM && STM.MODULES.some((m) => m.id === id));
  S.display = (text, msg) => {
    const active = S.stmActive();
    if (!active.length || (msg && msg.showRaw)) return text;
    return STM.apply(text, active);
  };

  S.streamChat = async ({ model, messages, params, signal, onUpdate, web, skills }) => {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, params, stream: true, web: !!web, skills }),
      signal,
    });
    if (!resp.ok) {
      let j = null;
      try { j = await resp.json(); } catch {}
      throw new Error((j && j.error) || `Request failed (${resp.status})`);
    }
    const result = { content: '', reasoning: '', usage: null, finish: '', omni: null };
    const ctype = resp.headers.get('content-type') || '';
    if (ctype.includes('application/json')) {
      const j = await resp.json();
      const c = (j.choices && j.choices[0]) || {};
      const msg = c.message || {};
      Object.assign(result, { content: msg.content || '', reasoning: msg.reasoning_content || msg.reasoning || '', usage: j.usage || null, finish: c.finish_reason || '', omni: j.omni || null });
      onUpdate && onUpdate(result);
      return result;
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let scheduled = false;
    const notify = () => {
      if (scheduled || !onUpdate) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; onUpdate(result); });
    };
    const text = (v) => (typeof v === 'string' ? v : Array.isArray(v) ? v.map((p) => p.text || '').join('') : '');
    const handle = (line) => {
      if (!line.startsWith('data:')) return false;
      const payload = line.slice(5).trim();
      if (!payload) return false;
      if (payload === '[DONE]') return true;
      let j;
      try { j = JSON.parse(payload); } catch { return false; }
      if (j.error) throw new Error(typeof j.error === 'string' ? j.error : j.error.message || 'Stream error');
      if (j.omni) result.omni = j.omni;
      const c = j.choices && j.choices[0];
      if (c) {
        const d = c.delta || c.message || {};
        result.content += text(d.content);
        result.reasoning += text(d.reasoning_content) || text(d.reasoning);
        if (c.finish_reason) result.finish = c.finish_reason;
      }
      if (j.usage) result.usage = j.usage;
      notify();
      return false;
    };
    let done = false;
    while (!done) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const l of lines) if (handle(l)) { done = true; break; }
    }
    if (buffer) handle(buffer);
    onUpdate && onUpdate(result);
    return result;
  };

  /* -------------------------------- models -------------------------------- */
  S.loadModels = async () => {
    try {
      const r = await S.api('GET', '/api/models');
      S.models = r.models || [];
      S.combos = r.combos || [];
      S.modelsError = r.error || null;
    } catch (e) {
      S.models = [];
      S.modelsError = e.message;
    }
    S.modelsLoaded = true;
    S.updateStatus();
    return S.models;
  };

  S.updateStatus = () => {
    const b = S.$('#status');
    if (!b) return;
    b.className = 'status ' + (S.modelsError ? 'bad' : S.models.length ? 'ok' : '');
    S.$('span', b).textContent = S.modelsError ? 'Not connected' : S.models.length ? `Connected · ${S.models.length} models` : 'No models found';
    b.title = S.modelsError || 'Click to open connection settings';
  };

  /** Pinned + combos first, then everything else. */
  S.modelGroups = () => {
    const pinned = [...new Set([...(S.config?.pinned || []), ...S.combos])];
    const rest = S.models.map((m) => m.id).filter((id) => !pinned.includes(id));
    return { pinned, rest };
  };

  S.modelSelect = (value, onChange, opts = {}) => {
    const sel = el('select', { title: opts.title || 'Model or combo' });
    const { pinned, rest } = S.modelGroups();
    const known = new Set([...pinned, ...rest]);
    if (opts.allowEmpty) sel.append(el('option', { value: '' }, opts.emptyLabel || '— none —'));
    else if (!value && !known.size) sel.append(el('option', { value: '' }, 'No models loaded — open Settings'));
    else if (!value) sel.append(el('option', { value: '' }, 'Choose a model…'));
    if (value && !known.has(value)) sel.append(el('option', { value }, value));
    if (pinned.length) sel.append(el('optgroup', { label: 'Combos & pinned' }, pinned.map((id) => el('option', { value: id }, id))));
    if (rest.length) sel.append(el('optgroup', { label: 'All models' }, rest.map((id) => el('option', { value: id }, id))));
    sel.value = value || '';
    if (sel.value !== (value || '')) sel.value = '';
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  };

  S.saveModeModel = async (mode, model) => {
    S.config.modeModels = { ...S.config.modeModels, [mode]: model };
    try { S.config = { ...S.config, ...(await S.api('POST', '/api/config', { modeModels: S.config.modeModels })) }; } catch (e) { S.toast(e.message, true); }
  };

  /** First run: if no mode has a model yet, start every text mode on the first combo (or model) found. */
  S.applyStarterModels = async () => {
    if (!S.models.length) return null;
    const modes = S.config.modeModels;
    const empty = ['chat', 'reasoning', 'coding', 'builder'].filter((m) => !modes[m]);
    if (empty.length !== 4) return null;
    const { pinned, rest } = S.modelGroups();
    const pick = pinned[0] || rest[0];
    if (!pick) return null;
    for (const m of empty) S.config.modeModels = { ...S.config.modeModels, [m]: pick };
    try { S.config = { ...S.config, ...(await S.api('POST', '/api/config', { modeModels: S.config.modeModels })) }; } catch {}
    S.toast(`Starter model set to ${pick} — change it any time in Settings.`);
    return pick;
  };

  /* -------------------------------- dialogs ------------------------------- */
  S.dialog = (title, bodyNodes, actions) =>
    new Promise((resolve) => {
      const d = S.$('#dialog');
      d.replaceChildren(el('h3', {}, title), ...[].concat(bodyNodes));
      const bar = el('div', { class: 'actions' });
      const close = (v) => { d.close(); resolve(v); };
      for (const a of actions) bar.append(el('button', { class: 'btn ' + (a.cls || ''), onclick: () => close(a.value === undefined ? a.label : typeof a.value === 'function' ? a.value() : a.value) }, a.label));
      d.append(bar);
      d.onclose = () => resolve(null);
      d.showModal();
      const first = S.$('input, textarea', d);
      if (first) first.focus();
    });

  S.confirm = async (title, message, danger) => (await S.dialog(title, [el('p', { style: 'color:var(--muted);margin:0 0 8px' }, message)], [{ label: 'Cancel', value: false }, { label: danger || 'OK', cls: danger ? 'danger primary' : 'primary', value: true }])) === true;

  S.autoGrow = (ta, max = 220) => {
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, max) + 'px'; };
    ta.addEventListener('input', fit);
    setTimeout(fit, 0);
    return fit;
  };

  /* -------------------------------- router -------------------------------- */
  S.go = (route) => {
    if (S.cleanup) { try { S.cleanup(); } catch {} S.cleanup = null; }
    S.route = route;
    S.pref.set('route', route);
    S.$$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.route === route));
    const view = S.$('#view');
    view.replaceChildren();
    const fn = S.views[route] || S.views.chat;
    const cleanup = fn(view);
    if (typeof cleanup === 'function') S.cleanup = cleanup;
  };
})();
