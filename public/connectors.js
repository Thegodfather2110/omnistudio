'use strict';
/* Connectors: apps and tools your models can use. A connector is an MCP server, either a command that runs on this computer
   or a remote URL. This file has the Connectors tab, the picker in the chat composer, and the helper chat.js uses to run a
   message with connector tools. */
(function () {
  const { el } = S;

  const SUMMARY = {
    smart: 'Ask before tools that change things (read-only tools run on their own)',
    confirm: 'Ask before every tool call',
    auto: 'Allow every tool without asking',
  };
  const POLICY_LABEL = { '': 'Default', confirm: 'Ask first', auto: 'Allow', off: 'Off' };

  const wideDialog = (title, nodes, actions) => {
    const d = S.$('#dialog');
    d.classList.add('wide');
    const p = S.dialog(title, nodes, actions);
    p.then(() => d.classList.remove('wide'));
    return p;
  };

  const avatar = (name) => el('div', { class: 'conn-avatar', 'aria-hidden': 'true' }, (String(name).trim().charAt(0) || '?').toUpperCase());

  /* ------------------------- helpers shared with chat.js ------------------------- */

  /** Run one chat message that may use connector tools. Resolves with { content, runId }. */
  S.runConnectors = ({ model, text, history, system, params, connectors, signal, onStart }) =>
    new Promise((resolve, reject) => {
      (async () => {
        let id;
        try {
          id = (await S.api('POST', '/api/connectors/runs', { model, text, history, system, params, connectors })).id;
        } catch (e) { return reject(e); }
        if (onStart) onStart(id);
        const stop = () => S.api('POST', `/api/runs/${id}/stop`, {}).catch(() => {});
        if (signal) { if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true }); }
        S.pollRun(id, () => {}, {
          onEnd: (v) => {
            const summary = (v.meta && v.meta.summary) || '';
            if (v.status === 'done') resolve({ content: summary, runId: id });
            else if (v.status === 'stopped') reject(Object.assign(new Error('Stopped'), { name: 'Stopped', runId: id }));
            else reject(Object.assign(new Error(summary || 'The connector task did not finish.'), { runId: id }));
          },
        });
      })();
    });

  /** The little "Connectors" button in the composer. ids() = the enabled connectors the user ticked for this view. */
  S.connectorPicker = (mode) => {
    const key = 'conn.' + mode;
    let enabled = null; // [{id,name,...}] once loaded
    const chosen = () => {
      const saved = S.pref.get(key, []);
      const ids = Array.isArray(saved) ? saved : [];
      return enabled ? ids.filter((id) => enabled.some((c) => c.id === id)) : ids;
    };
    const btn = el('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); pop.classList.toggle('open'); if (pop.classList.contains('open')) load(); } });
    const panel = el('div', { class: 'pop-panel' });
    const pop = el('div', { class: 'pop' }, btn, panel);

    const label = () => {
      const n = chosen().length;
      btn.replaceChildren(S.iconEl('connectors'), el('span', {}, n ? `Connectors · ${n}` : 'Connectors'));
      btn.classList.toggle('on', n > 0);
      btn.title = n ? 'This message can use the ticked connectors' : 'Let the model use your apps and tools';
    };
    const draw = () => {
      const ids = new Set(chosen());
      const list = enabled || [];
      panel.replaceChildren(
        el('h4', {}, 'Connectors'),
        list.length
          ? el('div', { class: 'stack', style: 'gap:2px;max-height:260px;overflow:auto;margin-bottom:10px' }, list.map((c) => el('label', { class: 'switch', style: 'display:flex;padding:6px 2px', title: c.description || '' },
              el('input', { type: 'checkbox', checked: ids.has(c.id), onchange: (e) => {
                const next = new Set(chosen()); e.target.checked ? next.add(c.id) : next.delete(c.id);
                S.pref.set(key, [...next]); label();
              } }),
              el('span', {}, el('b', { style: 'font-weight:600' }, c.name), el('small', { style: 'display:block;color:var(--muted)' }, c.lastTest && c.lastTest.ok ? `${c.lastTest.tools} tools` : 'not tested')))))
          : el('p', { class: 'hint', style: 'margin:0 0 10px' }, enabled ? 'No connector is switched on yet.' : 'Loading…'),
        el('p', { class: 'hint', style: 'margin:0 0 10px' }, 'With a connector ticked, the model can call its tools for this message. You approve anything that changes things. Web search is skipped while connectors are used; add a search connector instead.'),
        el('button', { class: 'btn sm', onclick: () => { pop.classList.remove('open'); S.go('connectors'); } }, 'Manage connectors'));
    };
    async function load() {
      draw();
      try { enabled = (await S.api('GET', '/api/connectors')).connectors.filter((c) => c.enabled); } catch { enabled = enabled || []; }
      S.pref.set(key, chosen());
      label(); draw();
    }
    const outside = (e) => { if (!e.target.closest('.pop') || !pop.contains(e.target)) pop.classList.remove('open'); };
    document.addEventListener('click', outside);
    label();
    S.api('GET', '/api/connectors').then((r) => { enabled = r.connectors.filter((c) => c.enabled); S.pref.set(key, chosen()); label(); }).catch(() => {});
    return { node: pop, ids: chosen, destroy: () => document.removeEventListener('click', outside) };
  };

  /* ------------------------------ the form ------------------------------ */

  /** Name/value rows for environment variables or headers. Saved values are never shown; blank keeps them. */
  function kvEditor(existingKeys, { keyPlaceholder, valuePlaceholder }) {
    const rows = el('div', { class: 'stack', style: 'gap:6px' });
    const add = (key = '', saved = false) => {
      const k = el('input', { type: 'text', placeholder: keyPlaceholder, value: key, spellcheck: 'false', style: 'flex:1' });
      const v = el('input', { type: 'password', placeholder: saved ? 'saved: leave blank to keep' : valuePlaceholder, autocomplete: 'off', style: 'flex:2' });
      const row = el('div', { class: 'row', style: 'flex-wrap:nowrap;gap:6px' }, k, v, el('button', { class: 'btn sm ghost', type: 'button', title: 'Remove', onclick: () => row.remove() }, '✕'));
      row._get = () => [k.value.trim(), v.value];
      rows.append(row);
    };
    existingKeys.forEach((k) => add(k, true));
    return {
      node: el('div', {}, rows, el('button', { class: 'btn sm', type: 'button', style: 'margin-top:6px', onclick: () => add() }, '+ Add')),
      value: () => { const o = {}; [...rows.children].forEach((r) => { const [k, v] = r._get(); if (k) o[k] = v; }); return o; },
    };
  }

  /** Build the add / manage form. conn = null creates a new custom connector. */
  function connForm(conn) {
    const creating = !conn;
    const type = el('select', { disabled: !creating }, [['stdio', 'A command on this computer'], ['http', 'A remote server (URL)']].map(([v, l]) => el('option', { value: v, selected: (conn ? conn.type : 'stdio') === v }, l)));
    const name = el('input', { type: 'text', value: conn ? conn.name : '', maxlength: '60', placeholder: 'e.g. My notes' });
    const desc = el('input', { type: 'text', value: conn ? conn.description || '' : '', maxlength: '300', placeholder: 'Optional: what is it for? The model reads this.' });
    const command = el('input', { type: 'text', value: conn ? conn.command || '' : '', placeholder: 'npx', spellcheck: 'false' });
    const args = el('input', { type: 'text', value: conn ? conn.args || '' : '', placeholder: '-y @modelcontextprotocol/server-memory', spellcheck: 'false' });
    const cwd = el('input', { type: 'text', value: conn ? conn.cwd || '' : '', placeholder: 'Optional: folder to start it in', spellcheck: 'false' });
    const url = el('input', { type: 'text', value: conn ? conn.url || '' : '', placeholder: 'https://example.com/mcp', spellcheck: 'false' });
    const env = kvEditor(conn && conn.type === 'stdio' ? conn.env : [], { keyPlaceholder: 'NAME', valuePlaceholder: 'value' });
    const headers = kvEditor(conn && conn.type === 'http' ? conn.headers : [], { keyPlaceholder: 'Header', valuePlaceholder: 'e.g. Bearer your-token' });
    const approve = el('select', {}, Object.entries(SUMMARY).map(([v, l]) => el('option', { value: v, selected: (conn ? conn.approve : 'confirm') === v }, l)));
    const local = el('div', {}, el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Command'), command), el('label', { class: 'field' }, el('span', {}, 'Arguments'), args)),
      el('label', { class: 'field' }, el('span', {}, 'Working folder (optional)'), cwd),
      el('div', { class: 'field' }, el('span', { style: 'display:block;font-size:12.5px;color:var(--muted);margin-bottom:5px' }, 'Environment variables (API keys, tokens)'), env.node));
    const remoteBox = el('div', {}, el('label', { class: 'field' }, el('span', {}, 'Server URL'), url),
      el('div', { class: 'field' }, el('span', { style: 'display:block;font-size:12.5px;color:var(--muted);margin-bottom:5px' }, 'Headers (for sign-in, e.g. Authorization)'), headers.node),
      el('div', { class: 'hint' }, 'Servers that need an OAuth browser sign-in are not supported yet; use one that accepts a token or API key header.'));
    const sync = () => { local.style.display = type.value === 'stdio' ? '' : 'none'; remoteBox.style.display = type.value === 'http' ? '' : 'none'; };
    type.addEventListener('change', sync);
    sync();
    const nodes = [
      creating ? el('label', { class: 'field' }, el('span', {}, 'Type'), type) : null,
      el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Name'), name), el('label', { class: 'field' }, el('span', {}, 'Description'), desc)),
      local, remoteBox,
      el('label', { class: 'field' }, el('span', {}, 'Permissions'), approve),
    ];
    return {
      nodes,
      body: () => {
        const t = type.value;
        const b = { type: t, name: name.value, description: desc.value, approve: approve.value };
        if (t === 'stdio') Object.assign(b, { command: command.value, args: args.value, cwd: cwd.value, env: env.value() });
        else Object.assign(b, { url: url.value, headers: headers.value() });
        return b;
      },
      valid: () => (name.value.trim() ? (type.value === 'stdio' ? !!command.value.trim() : !!url.value.trim()) : false),
    };
  }

  /** Show the outcome of a connection test and the tool list with per-tool permission rules. */
  function toolsPanel(conn, policy) {
    const box = el('div', {});
    const render = (r) => {
      if (!r) return box.replaceChildren();
      if (!r.ok) {
        return S.set(box, el('div', { class: 'banner bad', style: 'margin:0;flex-direction:column;align-items:flex-start' }, el('b', {}, 'Could not connect'), el('div', { style: 'white-space:pre-wrap;font-size:13px;word-break:break-word' }, r.error || '')));
      }
      const list = r.toolList || r.tools || [];
      S.set(box,
        el('div', { class: 'banner', style: 'margin:0 0 10px' }, el('span', {}, `✅ Connected${r.server ? ' to ' + r.server : ''} · ${list.length} tool${list.length === 1 ? '' : 's'}`)),
        list.length ? el('div', { class: 'hint', style: 'margin:0 0 6px' }, 'Rule for each tool. “Default” follows the Permissions setting above.') : null,
        el('div', { class: 'conn-tools' }, list.map((t) => {
          const sel = el('select', { onchange: () => { if (sel.value) policy[t.name] = sel.value; else delete policy[t.name]; } },
            Object.entries(POLICY_LABEL).map(([v, l]) => el('option', { value: v, selected: (policy[t.name] || '') === v }, l)));
          return el('div', { class: 'tool-row' },
            el('div', { style: 'min-width:0;flex:1' },
              el('div', {}, el('code', { class: 'cmd' }, t.name), ' ', t.readOnly ? el('span', { class: 'chip' }, 'read-only') : null, t.destructive ? el('span', { class: 'chip', style: 'color:var(--warn)' }, 'can change things') : null),
              t.description ? el('div', { class: 'hint', style: 'margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: t.description }, t.description) : null),
            sel);
        })));
    };
    return { node: box, render };
  }

  /* ------------------------------ dialogs ------------------------------ */

  async function manage(conn, refresh) {
    const form = connForm(conn);
    const policy = { ...(conn.toolPolicy || {}) };
    const tp = toolsPanel(conn, policy);
    const status = el('div', {});
    const testBtn = el('button', { class: 'btn', type: 'button', onclick: async () => {
      if (!form.valid()) return S.toast('Fill in the name and the command or URL first.', true);
      testBtn.disabled = true; testBtn.textContent = 'Connecting…';
      S.set(status, el('div', { class: 'hint' }, 'The first start of an npx or uvx server can take a minute while it downloads.'));
      try {
        await S.api('PATCH', '/api/connectors/' + conn.id, { ...form.body(), toolPolicy: policy });
        const r = await S.api('POST', `/api/connectors/${conn.id}/test`, {});
        status.replaceChildren(); tp.render(r);
      } catch (e) { status.replaceChildren(); tp.render({ ok: false, error: e.message }); }
      testBtn.disabled = false; testBtn.textContent = 'Save & test connection';
    } }, 'Save & test connection');
    if (conn.lastTest && conn.lastTest.ok) S.api('GET', `/api/connectors/${conn.id}/tools`).then((r) => tp.render({ ok: true, server: conn.lastTest.server, toolList: r.tools })).catch(() => tp.render(conn.lastTest));
    else if (conn.lastTest) tp.render(conn.lastTest);
    const r = await wideDialog(`Manage · ${conn.name}`, [
      ...form.nodes.filter(Boolean),
      el('div', { class: 'row', style: 'margin:4px 0 10px' }, testBtn),
      status, tp.node,
    ], [{ label: 'Remove', cls: 'danger', value: 'remove' }, { label: 'Cancel', value: false }, { label: 'Save', cls: 'primary', value: () => (form.valid() ? 'save' : null) }]);
    if (r === 'remove') {
      if (!(await S.confirm(`Remove “${conn.name}”?`, 'Its saved keys and settings are deleted from this computer.', 'Remove'))) return;
      try { await S.api('DELETE', '/api/connectors/' + conn.id); S.toast('Connector removed'); } catch (e) { S.toast(e.message, true); }
    } else if (r === 'save') {
      try { await S.api('PATCH', '/api/connectors/' + conn.id, { ...form.body(), toolPolicy: policy }); S.toast('Saved'); } catch (e) { S.toast(e.message, true); }
    }
    refresh();
  }

  /** Switch a connector on: connect first, so a broken one never looks "on". */
  async function turnOn(conn, refresh) {
    try {
      await S.api('PATCH', '/api/connectors/' + conn.id, { enabled: true });
      S.toast(`Connecting to ${conn.name}…`);
      const r = await S.api('POST', `/api/connectors/${conn.id}/test`, {});
      if (!r.ok) {
        await S.api('PATCH', '/api/connectors/' + conn.id, { enabled: false });
        S.toast(`${conn.name} could not connect: ${(r.error || '').split('\n')[0]}`, true);
        return refresh().then(() => manageById(conn.id, refresh));
      }
      S.toast(`${conn.name} is on · ${r.tools} tool${r.tools === 1 ? '' : 's'}`);
    } catch (e) { S.toast(e.message, true); }
    refresh();
  }

  async function manageById(id, refresh) {
    try {
      const c = (await S.api('GET', '/api/connectors')).connectors.find((x) => x.id === id);
      if (c) manage(c, refresh);
    } catch {}
  }

  async function addFromCatalog(p, refresh) {
    const inputs = {};
    const fields = p.inputs.map((inp) => {
      const input = el('input', { type: inp.secret ? 'password' : 'text', placeholder: inp.placeholder || '', autocomplete: 'off', spellcheck: 'false', oninput: () => { inputs[inp.key] = input.value; } });
      return el('label', { class: 'field' }, el('span', {}, inp.label + (inp.required ? '' : ' (optional)')), input);
    });
    const r = await S.dialog(`Add ${p.name}`, [
      el('p', { style: 'color:var(--muted);margin:0 0 12px' }, p.description),
      ...fields,
      el('div', { class: 'hint' }, `Runs on this computer: ${p.command} ${p.args}`),
      el('div', { class: 'hint' }, 'Nothing is installed until you press Add. npx and uvx download the server the first time it starts.'),
    ], [{ label: 'Cancel', value: false }, { label: 'Add & connect', cls: 'primary', value: () => (p.inputs.every((i) => !i.required || (inputs[i.key] || '').trim()) ? true : (S.toast('Fill in the required field.', true), null)) }]);
    if (!r) return;
    try {
      const c = await S.api('POST', '/api/connectors', { preset: p.id, inputs });
      await refresh();
      await turnOn(c, refresh);
    } catch (e) { S.toast(e.message, true); }
  }

  async function addCustom(refresh) {
    const form = connForm(null);
    const r = await wideDialog('Add a custom connector', [
      el('p', { style: 'color:var(--muted);margin:0 0 12px' }, 'Any MCP server works: a command that runs on this computer, or a remote URL.'),
      ...form.nodes.filter(Boolean),
      el('div', { class: 'hint' }, 'A command runs with your user account’s permissions. Only add servers you trust.'),
    ], [{ label: 'Cancel', value: false }, { label: 'Add & connect', cls: 'primary', value: () => (form.valid() ? true : (S.toast('Fill in the name and the command or URL.', true), null)) }]);
    if (!r) return;
    try {
      const c = await S.api('POST', '/api/connectors', form.body());
      await refresh();
      await turnOn(c, refresh);
    } catch (e) { S.toast(e.message, true); }
  }

  async function importDialog(refresh) {
    const text = el('textarea', { rows: '6', placeholder: '{ "mcpServers": { "name": { "command": "npx", "args": ["-y", "some-server"] } } }', spellcheck: 'false', style: 'font-family:var(--mono);font-size:12.5px' });
    const found = el('div', { class: 'stack', style: 'gap:4px' }, el('div', { class: 'hint' }, 'Looking in Claude Desktop, Cursor and Claude Code…'));
    const picked = new Set();
    let detected = [];
    S.api('GET', '/api/connectors/detect').then((list) => {
      detected = list;
      S.set(found, list.length
        ? [el('div', { class: 'hint', style: 'margin-bottom:4px' }, 'Found on this computer. Tick the ones to import:'), ...list.map((d, i) => el('label', { class: 'switch', style: 'display:flex;padding:3px 0' },
            el('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? picked.add(i) : picked.delete(i); } }),
            el('span', {}, el('b', { style: 'font-weight:600' }, d.name), ' ', el('span', { class: 'chip' }, d.source), d.already ? el('span', { class: 'chip' }, 'already added') : null,
              el('small', { style: 'display:block;color:var(--muted);font-family:var(--mono)' }, (d.type === 'http' ? d.url : `${d.command} ${d.args}`).slice(0, 90)))))]
        : el('div', { class: 'hint' }, 'No MCP servers found in other apps on this computer.'));
    }).catch(() => S.set(found, el('div', { class: 'hint' }, 'Could not look for other apps.')));
    const r = await wideDialog('Import connectors', [
      el('p', { style: 'color:var(--muted);margin:0 0 12px' }, 'Bring in MCP servers you already set up elsewhere. Imported connectors start switched off so you can check them first.'),
      found,
      el('label', { class: 'field', style: 'margin-top:12px' }, el('span', {}, 'Or paste a config (the “mcpServers” JSON)'), text),
    ], [{ label: 'Cancel', value: false }, { label: 'Import', cls: 'primary', value: true }]);
    if (!r) return;
    try {
      const out = [];
      if (text.value.trim()) out.push(...(await S.api('POST', '/api/connectors/import', { json: text.value })).imported);
      const bySource = {};
      for (const i of picked) (bySource[detected[i].source] ||= []).push(detected[i].name);
      for (const [source, names] of Object.entries(bySource)) out.push(...(await S.api('POST', '/api/connectors/import', { source, names })).imported);
      if (!out.length) return S.toast('Nothing to import. Tick a server or paste a config.', true);
      S.toast(`Imported ${out.length} connector${out.length === 1 ? '' : 's'}. Press Manage to test and switch them on.`);
    } catch (e) { S.toast(e.message, true); }
    refresh();
  }

  /* -------------------------------- the tab -------------------------------- */

  S.views.connectors = (container) => {
    let state = { connectors: [], catalog: [], loaded: false };
    const search = el('input', { type: 'text', placeholder: 'Search…', style: 'max-width:220px' });
    const mine = el('div', { class: 'proj-grid' });
    const dir = el('div', { class: 'proj-grid' });
    const notice = el('div');

    const statusOf = (c) => {
      if (c.enabled && c.lastTest && c.lastTest.ok) return el('span', { class: 'chip accent' }, `Connected · ${c.lastTest.tools} tool${c.lastTest.tools === 1 ? '' : 's'}`);
      if (c.enabled) return el('span', { class: 'chip' }, 'On · not tested');
      if (c.lastTest && !c.lastTest.ok) return el('span', { class: 'chip', style: 'color:var(--bad)', title: c.lastTest.error || '' }, 'Needs attention');
      return el('span', { class: 'chip' }, 'Off');
    };

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      const match = (o) => !q || (o.name + ' ' + (o.description || '') + ' ' + (o.category || '')).toLowerCase().includes(q);
      S.set(notice, state.loaded && !state.connectors.length
        ? el('div', { class: 'banner' }, el('span', {}, 'Connectors let your models use your apps and tools, like files, GitHub, search and a browser. Add one from the directory below, then tick it with the Connectors button in Chat, Reasoning or Coding.'))
        : null);
      S.set(mine, state.connectors.filter(match).map((c) => el('div', { class: 'proj-card conn-card' },
        el('div', { class: 'conn-head' }, avatar(c.name), el('div', { style: 'min-width:0;flex:1' }, el('h3', { style: 'margin:0' }, c.name), el('div', { class: 'hint', style: 'margin:0' }, c.type === 'http' ? 'Remote · ' + (c.url || '') : 'This computer')),
          el('label', { class: 'switch', title: c.enabled ? 'Switch off' : 'Switch on' }, el('input', { type: 'checkbox', checked: c.enabled, onchange: (e) => { e.target.disabled = true; if (e.target.checked) turnOn(c, load); else S.api('PATCH', '/api/connectors/' + c.id, { enabled: false }).then(load).catch((er) => S.toast(er.message, true)); } }))),
        el('div', { class: 'd', style: 'padding:0 14px' }, c.description || SUMMARY[c.approve]),
        el('div', { class: 'row', style: 'padding:10px 14px 14px' }, statusOf(c), el('span', { class: 'spacer' }), el('button', { class: 'btn sm', onclick: () => manage(c, load) }, S.iconEl('sliders'), 'Manage')))));
      if (!state.connectors.length && state.loaded) S.set(mine, el('div', { class: 'hint' }, 'Nothing added yet.'));
      S.set(dir, state.catalog.filter(match).map((p) => el('div', { class: 'proj-card conn-card' },
        el('div', { class: 'conn-head' }, avatar(p.name), el('div', { style: 'min-width:0;flex:1' }, el('h3', { style: 'margin:0' }, p.name), el('div', { class: 'hint', style: 'margin:0' }, p.category))),
        el('div', { class: 'd', style: 'padding:0 14px' }, p.description),
        el('div', { class: 'row', style: 'padding:10px 14px 14px' }, p.added ? el('span', { class: 'chip' }, 'Added') : null, el('span', { class: 'spacer' }),
          el('button', { class: 'btn sm primary', onclick: () => addFromCatalog(p, load) }, S.iconEl('plus'), p.added ? 'Add another' : 'Add')))));
    };

    async function load() {
      try { const r = await S.api('GET', '/api/connectors'); state = { connectors: r.connectors, catalog: r.catalog, loaded: true }; }
      catch (e) { S.toast(e.message, true); }
      draw();
    }

    search.addEventListener('input', draw);
    container.append(
      el('div', { class: 'topbar' }, el('h1', {}, 'Connectors'), el('span', { class: 'sub' }, 'Let your models use your apps and tools'), el('span', { class: 'spacer' }), search),
      el('div', { class: 'page' },
        notice,
        el('div', { class: 'row', style: 'justify-content:space-between;margin:0 0 10px' }, el('h2', { class: 'conn-h' }, 'Your connectors'),
          el('div', { class: 'row' }, el('button', { class: 'btn sm', onclick: () => importDialog(load) }, S.iconEl('down'), 'Import'), el('button', { class: 'btn sm primary', onclick: () => addCustom(load) }, S.iconEl('plus'), 'Add custom'))),
        mine,
        el('h2', { class: 'conn-h', style: 'margin:26px 0 10px' }, 'Directory'),
        el('p', { class: 'hint', style: 'margin:-6px 0 12px' }, 'Popular servers, ready to add. Each one is an ordinary connector afterwards, so you can change its command.'),
        dir));
    load();
  };
})();
