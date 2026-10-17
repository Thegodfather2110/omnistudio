'use strict';
/* REA: reverse engineer anything. A gallery of investigations + a workspace (chat → REA tools via MCP → live evidence → report). */
(function () {
  const { el } = S;

  const STARTERS = [
    ['Map an application', 'Give me an overview of this target: what it is, how it is structured, its main components and entry points.'],
    ['Explain one feature', 'Find where the target implements the feature I describe below, explain how it works step by step, and show the evidence.'],
    ['Check what it uses', 'List the libraries, system APIs and strings this target relies on, and point out anything security-relevant.'],
    ['Rebuild a feature', 'Investigate how this feature works, then write a clean-room description of its behaviour that I can implement in my own stack.'],
  ];

  /* ------------------------------ connection ------------------------------ */
  function connectionPanel(onResult) {
    const root = el('div', { class: 'stack', style: 'gap:12px' });
    const command = el('input', { type: 'text', placeholder: 'npx', spellcheck: 'false' });
    const args = el('input', { type: 'text', placeholder: '-y rea-agents mcp', spellcheck: 'false' });
    const cwd = el('input', { type: 'text', placeholder: 'Optional: folder to start it in', spellcheck: 'false' });
    const steps = el('input', { type: 'number', min: '1', max: '100' });
    const timeout = el('input', { type: 'number', min: '10', max: '3600' });
    const approve = el('select', {}, [['confirm', 'Ask me before each tool call (recommended)'], ['auto', 'Run tool calls automatically']].map(([v, l]) => el('option', { value: v }, l)));
    const detectBox = el('div');
    const result = el('div');

    const showResult = (r) => {
      if (!r) return result.replaceChildren();
      if (r.ok) S.set(result, el('div', { class: 'banner', style: 'margin:0' }, el('span', {}, `✅ Connected${r.server ? ' to ' + r.server : ''} · ${r.tools} tool${r.tools === 1 ? '' : 's'}`)));
      else S.set(result, el('div', { class: 'banner bad', style: 'margin:0;flex-direction:column;align-items:flex-start' }, el('b', {}, 'Could not connect'), el('div', { style: 'white-space:pre-wrap;font-size:13px' }, r.error || ''), r.stderr ? el('pre', { class: 'viewer', style: 'width:100%;margin:6px 0 0;max-height:160px' }, r.stderr) : null));
    };
    const fill = (c) => {
      command.value = c.command || ''; args.value = c.args || ''; cwd.value = c.cwd || '';
      approve.value = c.approve || 'confirm'; steps.value = c.maxSteps || 40; timeout.value = c.callTimeoutSec || 600;
    };
    const body = () => ({ command: command.value, args: args.value, cwd: cwd.value, approve: approve.value, maxSteps: Number(steps.value) || undefined, callTimeoutSec: Number(timeout.value) || undefined });
    const save = async () => { const c = await S.api('POST', '/api/rea/config', body()); fill(c); return c; };

    const test = el('button', { class: 'btn primary', onclick: async () => {
      test.disabled = true; test.textContent = 'Starting REA…';
      S.set(result, el('div', { class: 'hint' }, 'The first start can take a minute while npx downloads the package.'));
      try { await save(); const r = await S.api('POST', '/api/rea/test', {}); showResult(r); if (onResult) onResult(r); }
      catch (e) { showResult({ ok: false, error: e.message }); }
      test.disabled = false; test.textContent = 'Save & test connection';
    } }, 'Save & test connection');

    const detect = el('button', { class: 'btn', onclick: async () => {
      try {
        const found = await S.api('GET', '/api/rea/detect');
        if (!found.length) return S.set(detectBox, el('div', { class: 'hint' }, 'No REA entry found in Claude Desktop, Cursor or Claude Code. Run “npx -y rea-agents setup --yes” first, or type the command by hand.'));
        S.set(detectBox, el('div', { class: 'hint', style: 'margin-bottom:6px' }, 'Found in other apps on this computer. Click to use:'), found.map((f) => el('button', { class: 'btn sm', style: 'margin:0 6px 6px 0', title: `${f.command} ${f.args}`, onclick: () => { command.value = f.command; args.value = f.args; cwd.value = f.cwd || ''; S.toast('Filled in — press Save & test.'); } }, `${f.source}: ${f.command} ${f.args}`.slice(0, 80))));
      } catch (e) { S.toast(e.message, true); }
    } }, 'Detect from other apps');

    root.append(
      el('p', { class: 'desc', style: 'margin:0' }, 'OmniStudio starts REA as a local MCP server and lets your OmniRoute models call its tools. Whatever you enter here runs on this computer.'),
      el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Command'), command), el('label', { class: 'field' }, el('span', {}, 'Arguments'), args)),
      el('label', { class: 'field' }, el('span', {}, 'Working folder (optional)'), cwd),
      el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Max steps per task'), steps), el('label', { class: 'field' }, el('span', {}, 'Tool call timeout (seconds)'), timeout)),
      el('label', { class: 'field' }, el('span', {}, 'Tool calls'), approve),
      el('div', { class: 'row' }, test, detect), detectBox, result);
    S.api('GET', '/api/rea/config').then((c) => { fill(c); if (c.lastTest) showResult(c.lastTest); }).catch((e) => S.toast(e.message, true));
    return root;
  }

  /* ------------------------------- gallery ------------------------------- */
  async function gallery(container) {
    const grid = el('div', { class: 'proj-grid' });
    const search = el('input', { type: 'text', placeholder: 'Search investigations…', style: 'max-width:240px' });
    const status = el('div');
    let items = [];

    const drawStatus = (t) => {
      const connect = el('button', { class: 'btn sm', onclick: openConnection }, S.iconEl('sliders'), 'Connection');
      if (t && t.ok) S.set(status, el('div', { class: 'banner', style: 'margin-bottom:16px' }, el('span', {}, `✅ REA is connected${t.server ? ' (' + t.server + ')' : ''} · ${t.tools} tools`), el('span', { class: 'spacer' }), connect));
      else if (t) S.set(status, el('div', { class: 'banner bad' }, el('span', {}, 'REA could not be reached: ' + (t.error || 'unknown error').split('\n')[0]), el('span', { class: 'spacer' }), connect));
      else S.set(status, el('div', { class: 'banner' }, el('span', {}, 'REA gives your models reverse-engineering tools. Set up the connection once, then start an investigation.'), el('span', { class: 'spacer' }), el('button', { class: 'btn primary sm', onclick: openConnection }, 'Set up connection')));
    };
    async function openConnection() {
      await S.dialog('Connect REA', [connectionPanel((r) => drawStatus(r))], [{ label: 'Close', value: true }]);
      try { drawStatus((await S.api('GET', '/api/rea/config')).lastTest); } catch {}
    }

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      grid.replaceChildren(el('button', { class: 'proj-new', onclick: createDialog }, el('div', { style: 'font-size:28px;line-height:1;color:var(--accent)' }, '+'), 'New investigation'));
      for (const p of items.filter((p) => !q || (p.name + ' ' + p.description + ' ' + p.target).toLowerCase().includes(q))) {
        grid.append(el('div', { class: 'proj-card' },
          el('div', { class: 'proj-thumb' }, el('div', { class: 'none', style: 'padding:14px;text-align:center;font-family:var(--mono);word-break:break-all' }, p.target || 'No target set yet')),
          el('div', { class: 'proj-body' },
            el('h3', {}, p.name),
            el('div', { class: 'd' }, p.description || 'No description'),
            el('div', { class: 'm' }, `${p.turns} task${p.turns === 1 ? '' : 's'} · ${p.reportChars ? 'report saved' : 'no report yet'} · updated ${S.ago(p.updated)}`),
            el('div', { class: 'm', style: 'font-family:var(--mono);word-break:break-all', title: 'Folder on this computer' }, p.folder),
            el('div', { class: 'row', style: 'margin-top:6px' },
              el('button', { class: 'btn primary sm', onclick: () => open(p.slug) }, 'Open'),
              p.running ? el('span', { class: 'chip accent' }, 'Working…') : null,
              el('span', { class: 'spacer' }),
              el('button', { class: 'btn sm ghost danger', title: 'Delete investigation', onclick: async () => {
                if (!(await S.confirm(`Delete “${p.name}”?`, 'This deletes the investigation, its chat and its report from your computer.', 'Delete'))) return;
                try { await S.api('DELETE', '/api/rea/investigations/' + p.slug); S.toast('Investigation deleted'); load(); } catch (e) { S.toast(e.message, true); }
              } }, S.iconEl('trash'))))));
      }
    };
    async function load() {
      try { items = await S.api('GET', '/api/rea/investigations'); } catch (e) { S.toast(e.message, true); }
      draw();
    }
    async function createDialog() {
      const name = el('input', { type: 'text', placeholder: 'e.g. How Notes syncs checklists', maxlength: '80' });
      const target = el('input', { type: 'text', placeholder: 'e.g. /Applications/Notes.app (a path on this computer)', spellcheck: 'false' });
      const desc = el('textarea', { rows: '3', placeholder: 'What do you want to find out? You can also say it in the chat later.' });
      const r = await S.dialog('New investigation', [
        el('label', { class: 'field' }, el('span', {}, 'Name'), name),
        el('label', { class: 'field' }, el('span', {}, 'Target'), target),
        el('label', { class: 'field' }, el('span', {}, 'Goal'), desc),
        el('div', { class: 'hint' }, 'Only investigate software you own or are allowed to analyse.'),
      ], [{ label: 'Cancel', value: false }, { label: 'Create', cls: 'primary', value: () => (name.value.trim() ? true : null) }]);
      if (!r) return;
      try { const p = await S.api('POST', '/api/rea/investigations', { name: name.value, target: target.value, description: desc.value }); open(p.slug); } catch (e) { S.toast(e.message, true); }
    }
    function open(slug) { S.pref.set('rea.project', slug); S.go('rea'); }

    search.addEventListener('input', draw);
    container.append(
      el('div', { class: 'topbar' }, el('h1', {}, 'REA'), el('span', { class: 'sub' }, 'Reverse engineer anything — every answer comes with its evidence'), el('span', { class: 'spacer' }), search),
      el('div', { class: 'page' }, status, grid));
    drawStatus(null);
    S.api('GET', '/api/rea/config').then((c) => drawStatus(c.lastTest)).catch(() => {});
    load();
  }

  /* ------------------------------ workspace ------------------------------ */
  async function workspace(container, slug) {
    let inv;
    try { inv = await S.api('GET', '/api/rea/investigations/' + slug); } catch (e) { S.toast(e.message, true); S.pref.set('rea.project', ''); return gallery(container); }

    const state = { busy: false, runId: null, tab: 'report', report: inv.report || '' };
    const stops = [];
    const messagesEl = el('div', { class: 'messages' });
    const input = el('textarea', { rows: '2', placeholder: 'What should REA investigate? Follow-ups keep the context.' });
    const sendBtn = el('button', { class: 'btn primary' });
    const rightEl = el('div', { class: 'ws-right' });
    const titleEl = el('h1', { title: 'Click to edit name, target and goal', style: 'cursor:text' }, inv.name);
    const subEl = el('span', { class: 'sub', style: 'font-family:var(--mono)' }, inv.target || 'No target set');
    let reportTimer = null;

    titleEl.addEventListener('click', async () => {
      const name = el('input', { type: 'text', value: inv.name, maxlength: '80' });
      const target = el('input', { type: 'text', value: inv.target || '', spellcheck: 'false' });
      const desc = el('textarea', { rows: '3' }); desc.value = inv.description || '';
      const ok = await S.dialog('Investigation details', [el('label', { class: 'field' }, el('span', {}, 'Name'), name), el('label', { class: 'field' }, el('span', {}, 'Target'), target), el('label', { class: 'field' }, el('span', {}, 'Goal'), desc)], [{ label: 'Cancel', value: false }, { label: 'Save', cls: 'primary', value: () => (name.value.trim() ? true : null) }]);
      if (!ok) return;
      try {
        await S.api('PATCH', '/api/rea/investigations/' + slug, { name: name.value, target: target.value, description: desc.value });
        Object.assign(inv, { name: name.value.trim(), target: target.value.trim(), description: desc.value });
        titleEl.textContent = inv.name; subEl.textContent = inv.target || 'No target set';
      } catch (e) { S.toast(e.message, true); }
    });

    const refreshReport = async () => {
      try { const f = await S.api('GET', '/api/rea/investigations/' + slug); state.report = f.report || ''; if (state.tab === 'report') drawRight(); } catch {}
    };
    const soonRefresh = () => { clearTimeout(reportTimer); reportTimer = setTimeout(refreshReport, 300); };

    function setBusy(b) { state.busy = b; sendBtn.replaceChildren(S.iconEl(b ? 'stop' : 'send'), b ? 'Stop' : 'Investigate'); sendBtn.classList.toggle('danger', b); }

    function addTurn(turn, live) {
      const wrap = el('div', { class: 'stack', style: 'gap:8px;margin-bottom:18px' });
      const user = S.msgEl({ role: 'user', content: turn.text }, {});
      user.update(false);
      const tl = S.timeline(turn.runId, { extra: (ev) => { if (ev.type === 'report') soonRefresh(); return null; } });
      wrap.append(user, tl.root);
      messagesEl.append(wrap);
      const stop = S.pollRun(turn.runId, (v) => {
        v.events.forEach(tl.add);
        if (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 220) messagesEl.scrollTop = messagesEl.scrollHeight;
      }, { onEnd: () => { if (state.runId === turn.runId) { state.runId = null; setBusy(false); } refreshReport(); } });
      stops.push(stop);
      if (live) { state.runId = turn.runId; setBusy(true); }
    }

    function renderMessages() {
      messagesEl.replaceChildren();
      if (!inv.turns.length) {
        messagesEl.append(el('div', { class: 'empty', style: 'margin-top:5vh' }, el('h2', {}, 'What should REA find out?'), el('p', {}, 'Your model calls REA’s tools one step at a time and shows the evidence. Findings are saved to the report on the right.'),
          el('div', { class: 'suggest', style: 'grid-template-columns:1fr' }, STARTERS.map(([t, p]) => el('button', { onclick: () => { input.value = p; input.focus(); input.dispatchEvent(new Event('input')); } }, el('b', { style: 'color:var(--text)' }, t), el('div', { style: 'font-size:12.5px' }, p))))));
        return;
      }
      inv.turns.forEach((t) => addTurn(t, t.runId === inv.running));
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function submit() {
      if (state.busy) {
        if (state.runId) { try { await S.api('POST', `/api/runs/${state.runId}/stop`, {}); } catch (e) { S.toast(e.message, true); } }
        return;
      }
      const text = input.value.trim();
      if (!text) return;
      const model = S.config.modeModels.rea || S.config.modeModels.coding || S.config.modeModels.chat;
      if (!model) return S.toast('Choose a model or combo that drives REA (top right).', true);
      try {
        const r = await S.api('POST', `/api/rea/investigations/${slug}/run`, { text, model });
        input.value = ''; input.dispatchEvent(new Event('input'));
        const turn = { runId: r.id, text, at: Date.now(), model };
        inv.turns.push(turn);
        if (inv.turns.length === 1) messagesEl.replaceChildren();
        addTurn(turn, true);
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } catch (e) { S.toast(e.message, true); }
    }

    /* ---- right side: report / tools / connection ---- */
    let toolsCache = null;
    function drawRight() {
      const tab = (id, label) => el('button', { class: 'tab' + (state.tab === id ? ' active' : ''), onclick: () => { state.tab = id; drawRight(); } }, label);
      const bar = el('div', { class: 'tabs' }, tab('report', 'Report'), tab('tools', 'REA tools'), tab('connection', 'Connection'), el('span', { class: 'spacer' }),
        state.tab === 'report' ? [
          el('button', { class: 'btn sm', onclick: refreshReport }, S.iconEl('refresh')),
          el('button', { class: 'btn sm', disabled: !state.report, onclick: () => S.copy(state.report, 'Report copied') }, S.iconEl('copy'), 'Copy'),
          el('button', { class: 'btn sm', disabled: !state.report, onclick: () => {
            const a = el('a', { href: URL.createObjectURL(new Blob([state.report], { type: 'text/markdown' })), download: slug + '-report.md' });
            document.body.append(a); a.click(); a.remove();
          } }, S.iconEl('down'), 'Download .md'),
        ] : null,
        el('button', { class: 'btn sm', title: inv.folder, onclick: () => S.copy(inv.folder, 'Folder path copied') }, S.iconEl('copy'), 'Folder path'));
      let body;
      if (state.tab === 'report') {
        body = el('div', { class: 'page', style: 'padding:18px 22px' }, state.report
          ? el('div', { class: 'md', html: S.md(state.report) })
          : el('div', { class: 'empty' }, el('h2', {}, 'No report yet'), el('p', {}, 'While it works, the model saves what it finds here, with the evidence for each claim.')));
      } else if (state.tab === 'tools') body = toolsPane();
      else body = el('div', { class: 'page', style: 'padding:18px 22px' }, connectionPanel());
      rightEl.replaceChildren(bar, body);
    }

    function toolsPane() {
      const box = el('div', { class: 'page', style: 'padding:18px 22px' });
      const list = el('div', { class: 'stack', style: 'gap:8px' });
      const q = el('input', { type: 'text', placeholder: 'Filter tools…', style: 'margin-bottom:12px' });
      const draw = () => {
        const f = q.value.trim().toLowerCase();
        S.set(list, (toolsCache || []).filter((t) => !f || (t.name + ' ' + t.description).toLowerCase().includes(f)).map((t) => el('div', { class: 'ev' }, el('div', { class: 'h' }, el('code', { class: 'cmd' }, t.name), el('span', { style: 'font-family:var(--mono)' }, t.args)), t.description ? el('div', { style: 'margin-top:4px;color:var(--muted)' }, t.description) : null)));
      };
      q.addEventListener('input', draw);
      box.append(q, list);
      if (toolsCache) draw();
      else {
        list.append(el('div', { class: 'hint' }, 'Starting REA to list its tools…'));
        S.api('GET', '/api/rea/tools').then((r) => { toolsCache = r.tools; draw(); }).catch((e) => S.set(list, el('div', { class: 'banner bad' }, e.message, el('span', { class: 'spacer' }), el('button', { class: 'btn sm', onclick: () => { state.tab = 'connection'; drawRight(); } }, 'Open connection'))));
      }
      return box;
    }

    /* ---- assemble ---- */
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
    S.autoGrow(input, 160);
    setBusy(false);
    const modelSlot = el('span');
    const drawModel = () => modelSlot.replaceChildren(S.modelSelect(S.config.modeModels.rea, (v) => S.saveModeModel('rea', v), { title: 'Model or combo that drives REA' }));
    drawModel();
    if (!S.modelsLoaded) S.loadModels().then(drawModel);
    const approve = el('select', { title: 'Whether REA tool calls need your approval' }, [['confirm', 'Ask before each tool call'], ['auto', 'Run tool calls automatically']].map(([v, l]) => el('option', { value: v }, l)));
    S.api('GET', '/api/rea/config').then((c) => { approve.value = c.approve; }).catch(() => {});
    approve.addEventListener('change', () => S.api('POST', '/api/rea/config', { approve: approve.value }).catch((e) => S.toast(e.message, true)));

    container.append(
      el('div', { class: 'topbar' },
        el('button', { class: 'btn sm', onclick: () => { S.pref.set('rea.project', ''); S.go('rea'); } }, S.iconEl('back'), 'All investigations'),
        titleEl, subEl, el('span', { class: 'spacer' }), modelSlot),
      el('div', { class: 'ws' },
        el('div', { class: 'ws-chat' }, messagesEl, el('div', { class: 'composer' }, el('div', { class: 'tools' }, approve), el('div', { class: 'box' }, input, sendBtn))),
        rightEl));
    renderMessages(); drawRight();
    if (inv.running) { /* a task is still working: addTurn already attached to it */ }
    return () => { clearTimeout(reportTimer); stops.forEach((s) => s()); };
  }

  S.views.rea = (container) => {
    const slug = S.pref.get('rea.project', '');
    const host = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' });
    container.append(host);
    let inner = null, left = false;
    (slug ? workspace(host, slug) : gallery(host)).then((c) => { inner = c; if (left && c) c(); });
    return () => { left = true; if (inner) inner(); host.remove(); };
  };
})();
