'use strict';
/* Computer: give a model a workspace + shell + web tools and watch it work. Also exports the timeline/files helpers Team reuses. */
(function () {
  const { el } = S;

  /* --------------------------- polling a run --------------------------- */
  S.pollRun = (id, onView, opts = {}) => {
    let since = 0, dead = false, timer = null;
    const tick = async () => {
      if (dead) return;
      let v = null;
      try { v = await S.api('GET', `/api/runs/${id}?since=${since}`); } catch (e) { if (/not found/i.test(e.message)) return; }
      if (dead) return;
      if (v) { since = v.next; onView(v); if (v.status !== 'running' && !(v.pending || []).length) { if (opts.onEnd) opts.onEnd(v); return; } }
      timer = setTimeout(tick, v && v.pending && v.pending.length ? 500 : 700);
    };
    tick();
    return () => { dead = true; clearTimeout(timer); };
  };

  /* ------------------------------ timeline ------------------------------ */
  S.timeline = (runId, opts = {}) => {
    const root = el('div', { class: 'tl' });
    const lastTool = {};
    const approvals = {};
    const who = (ev) => (opts.showModel && ev.model ? el('span', { class: 'chip' }, (ev.taskId ? ev.taskId + ' · ' : '') + ev.model) : null);

    const toolTitle = (ev) => {
      const a = ev.args || {};
      if (ev.name === 'shell') return el('code', { class: 'cmd' }, '$ ' + (a.command || ''));
      if (ev.name === 'write_file') return el('code', { class: 'cmd' }, `write ${a.path} (${a.lines} lines)`);
      if (ev.name === 'read_file') return el('code', { class: 'cmd' }, `read ${a.path}`);
      if (ev.name === 'list_files') return el('code', { class: 'cmd' }, `list ${a.path}`);
      if (ev.name === 'web_search') return el('code', { class: 'cmd' }, `search “${a.query}”`);
      if (ev.name === 'fetch_url') return el('code', { class: 'cmd' }, `open ${a.url}`);
      if (ev.name === 'read_skill') return el('code', { class: 'cmd' }, `read skill “${a.skill}”`);
      if (a.summary !== undefined) return el('code', { class: 'cmd' }, (ev.name + ' ' + a.summary).trim());
      return el('code', { class: 'cmd' }, ev.name);
    };

    const decide = async (approvalId, allow, node) => {
      node.querySelectorAll('button').forEach((b) => (b.disabled = true));
      try { await S.api('POST', `/api/runs/${runId}/approve`, { approvalId, allow }); } catch (e) { S.toast(e.message, true); }
    };

    const add = (ev) => {
      const key = ev.taskId || '_';
      let node = null;
      switch (ev.type) {
        case 'assistant': node = el('div', { class: 'ev say' }, who(ev), ' ', ev.text); break;
        case 'note': node = el('div', { class: 'hint', style: 'margin:0 4px' }, ev.text); break;
        case 'tool': node = el('div', { class: 'ev' }, el('div', { class: 'h' }, who(ev), '🔧', toolTitle(ev))); lastTool[key] = node; break;
        case 'observation': {
          const target = lastTool[key];
          const pre = el('pre', {}, ev.text);
          if (target) { target.append(pre); if (!ev.ok) target.classList.add('bad'); } else node = el('div', { class: 'ev' }, pre);
          break;
        }
        case 'approval': {
          node = el('div', { class: 'ev appr' }, el('div', { class: 'h' }, who(ev), '⚠️ ' + (ev.title || 'Approve this command?')), el('div', { style: 'margin:6px 0' }, el('code', { class: 'cmd' }, (ev.title ? '' : '$ ') + ev.command)),
            el('div', { class: 'row' }, el('button', { class: 'btn sm primary', onclick: () => decide(ev.approvalId, true, node) }, ev.title ? 'Allow' : 'Run it'), el('button', { class: 'btn sm danger', onclick: () => decide(ev.approvalId, false, node) }, 'Deny')));
          approvals[ev.approvalId] = node;
          break;
        }
        case 'approval_result': {
          const n = approvals[ev.approvalId];
          if (n) { n.replaceChildren(el('div', { class: 'h' }, ev.allowed ? '✅ You approved it' : '🚫 ' + (ev.note ? ev.note.charAt(0).toUpperCase() + ev.note.slice(1) : 'Denied'))); n.classList.remove('appr'); }
          break;
        }
        case 'final': node = el('div', { class: 'ev final' }, el('div', { class: 'h' }, who(ev), '✔ Finished'), el('div', { class: 'md', html: S.md(ev.summary || '') })); break;
        case 'error': node = el('div', { class: 'ev bad' }, el('div', { class: 'h' }, who(ev), 'Error'), ev.error); break;
        case 'end': node = el('div', { class: 'hint', style: 'margin:4px' }, 'Run ' + ev.status + '.'); break;
        default:
          if (opts.extra) node = opts.extra(ev, { who });
      }
      if (node) root.append(node);
    };
    return { root, add };
  };

  /* ------------------------------ workspace files ------------------------------ */
  S.filesPanel = (workspace) => {
    const root = el('div');
    const tree = el('div', { class: 'filetree' });
    const viewer = el('div');
    let current = '', dead = false, timer = null, sig = '', previewing = false;
    const previewBox = el('div');
    const open = async (p) => {
      current = p;
      try {
        const r = await S.api('GET', `/api/workspaces/${workspace}/file?path=${encodeURIComponent(p)}`);
        viewer.replaceChildren(el('div', { class: 'row', style: 'margin-top:8px' }, el('b', { style: 'font-family:var(--mono);font-size:12.5px' }, p), el('span', { class: 'spacer' }), el('button', { class: 'btn sm', onclick: () => S.copy(r.text) }, 'Copy')), el('div', { class: 'viewer' }, r.text));
      } catch (e) { viewer.replaceChildren(el('div', { class: 'hint' }, e.message)); }
      draw(lastFiles);
    };
    let lastFiles = [];
    const draw = (files) => {
      lastFiles = files;
      const hasIndex = files.some((f) => f.path === 'index.html');
      S.set(tree,
        el('div', { class: 'row', style: 'margin-bottom:8px' },
          hasIndex ? el('button', { class: 'btn sm' + (previewing ? ' on' : ' primary'), onclick: () => { previewing = !previewing; drawPreview(); draw(lastFiles); } }, previewing ? 'Hide preview' : 'Preview here') : null,
          hasIndex ? el('a', { class: 'btn sm', href: `/workspace/${workspace}/`, target: '_blank', rel: 'noopener' }, S.iconEl('external'), 'Open site') : null,
          el('button', { class: 'btn sm', title: 'Copy the folder path', onclick: async () => { const r = await S.api('GET', `/api/workspaces/${workspace}/files`); S.copy(r.folder, 'Folder path copied'); } }, S.iconEl('copy'), 'Folder')),
        files.length ? files.map((f) => el('div', { class: 'f' + (f.path === current ? ' active' : ''), onclick: () => open(f.path) }, el('span', { style: 'overflow:hidden;text-overflow:ellipsis' }, f.path), el('span', { style: 'color:var(--faint)' }, f.size > 1024 ? Math.round(f.size / 1024) + ' KB' : f.size + ' B'))) : el('div', { class: 'hint' }, 'No files yet.'));
    };
    const drawPreview = () => {
      previewBox.replaceChildren(previewing ? el('iframe', { src: `/workspace/${workspace}/?t=${Date.now()}`, sandbox: 'allow-scripts allow-forms allow-popups allow-modals', title: 'Preview', style: 'width:100%;height:420px;border:1px solid var(--line);border-radius:10px;background:#fff;margin-top:8px' }) : []);
    };
    const refresh = async () => {
      if (dead) return;
      try {
        const r = await S.api('GET', `/api/workspaces/${workspace}/files`);
        const s = JSON.stringify(r.files);
        if (s !== sig) { sig = s; draw(r.files); if (previewing) drawPreview(); if (current && r.files.some((f) => f.path === current)) open(current); }
      } catch {}
    };
    root.append(el('h3', { style: 'margin:0 0 8px;font-size:14px' }, 'Workspace · ', el('span', { style: 'font-family:var(--mono);font-weight:400' }, workspace)), tree, previewBox, viewer);
    refresh();
    timer = setInterval(refresh, 2500);
    return { root, refresh, stop: () => { dead = true; clearInterval(timer); } };
  };

  S.statusChip = (status) => {
    const map = { running: ['Running', 'accent'], done: ['Done', 'accent'], failed: ['Failed', ''], stopped: ['Stopped', ''], interrupted: ['Interrupted', ''] };
    const [label, cls] = map[status] || [status, ''];
    return el('span', { class: 'chip ' + cls, style: status === 'failed' ? 'color:var(--bad)' : '' }, label);
  };

  /* --------------------------------- view --------------------------------- */
  S.views.agent = (container) => {
    let runs = [], current = S.pref.get('agent.run', ''), stopPoll = null, files = null, listTimer = null, dead = false;
    const side = el('div', { class: 'side' });
    const main = el('div', { class: 'main' });

    const loadRuns = async () => {
      try { runs = await S.api('GET', '/api/runs?kind=agent'); } catch {}
      drawSide();
    };
    const drawSide = () => {
      side.replaceChildren(el('button', { class: 'btn primary', style: 'width:100%;justify-content:center;margin-bottom:10px', onclick: () => open('') }, S.iconEl('plus'), 'New task'));
      if (!runs.length) side.append(el('div', { class: 'hint', style: 'padding:6px' }, 'Past tasks appear here.'));
      for (const r of runs) {
        side.append(el('div', { class: 'target' + (r.id === current ? ' active' : ''), style: 'font-family:var(--sans)', onclick: () => open(r.id) },
          el('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: r.title }, (r.status === 'running' ? '⏳ ' : '') + r.title),
          el('button', { class: 'x', style: 'margin-left:auto;background:none;border:0;color:var(--faint)', title: 'Delete', onclick: async (e) => { e.stopPropagation(); try { await S.api('DELETE', '/api/runs/' + r.id); if (current === r.id) { current = ''; S.pref.set('agent.run', ''); } loadRuns(); open(current); } catch (er) { S.toast(er.message, true); } } }, '✕')));
      }
    };

    function cleanup() { if (stopPoll) stopPoll(); stopPoll = null; if (files) files.stop(); files = null; }

    function open(id) {
      cleanup();
      current = id; S.pref.set('agent.run', id);
      drawSide();
      main.replaceChildren();
      if (!id) return newForm();
      watch(id);
    }

    async function newForm() {
      let workspaces = [];
      try { workspaces = await S.api('GET', '/api/workspaces'); } catch {}
      const goal = el('textarea', { rows: '5', placeholder: 'What should the model do on its computer? For example: “Build a to-do list web app in a folder called app, run it to check it works, and tell me how to open it.”' });
      let model = S.pref.get('agent.model', '') || S.config.modeModels.coding || S.config.modeModels.chat || '';
      const modelSlot = el('span', { style: 'display:block' });
      const skillHint = el('div', { class: 'skillhint' });
      const drawHint = async () => {
        if (!model) return skillHint.replaceChildren();
        try {
          const r = await S.api('GET', '/api/skills/preview?model=' + encodeURIComponent(model));
          const n = r.included.length + r.listed.length;
          S.set(skillHint, n ? `🎓 ${model} will read ${n} skill${n === 1 ? '' : 's'} before it starts: ${[...r.included, ...r.listed].map((x) => x.name).slice(0, 4).join(', ')}${n > 4 ? '…' : ''}` : `🎓 ${model} has no skills yet. `, el('button', { class: 'link', onclick: () => { S.pref.set('skills.target', model); S.pref.set('skills.tab', 'model'); S.go('skills'); } }, n ? 'Change' : 'Teach it something'));
        } catch { skillHint.replaceChildren(); }
      };
      const drawModel = () => { modelSlot.replaceChildren(S.modelSelect(model, (v) => { model = v; S.pref.set('agent.model', v); drawHint(); }, { title: 'Model or combo that does the work' })); drawHint(); };
      drawModel();
      const shell = el('select', {}, [['confirm', 'Ask me before each command (recommended)'], ['off', 'No shell (files and web only)'], ['auto', 'Run commands automatically']].map(([v, l]) => el('option', { value: v, selected: S.config.agent.shell === v }, l)));
      const steps = el('input', { type: 'number', min: '1', max: '100', value: S.config.agent.maxSteps });
      const ws = el('select', {}, el('option', { value: '' }, 'New workspace'), workspaces.map((w) => el('option', { value: w.name }, 'Continue in: ' + w.name)));
      const warn = el('div', { class: 'warnbox', style: 'display:none' }, '“Automatic” lets the model run any command as you, without asking. Commands are not sandboxed — they can reach your files and the internet. Use it only for tasks and models you trust.');
      shell.addEventListener('change', () => { warn.style.display = shell.value === 'auto' ? '' : 'none'; });
      const go = el('button', { class: 'btn primary', onclick: async () => {
        if (!model) return S.toast('Choose a model or combo first.', true);
        if (!goal.value.trim()) return S.toast('Describe the task first.', true);
        go.disabled = true;
        try {
          const r = await S.api('POST', '/api/agent/runs', { goal: goal.value, model, shell: shell.value, maxSteps: Number(steps.value) || undefined, workspace: ws.value || undefined });
          await loadRuns(); open(r.id);
        } catch (e) { S.toast(e.message, true); go.disabled = false; }
      } }, 'Start');
      main.append(el('div', { class: 'stack', style: 'max-width:820px' },
        el('div', { class: 'card' },
          el('h2', {}, 'Give a model a computer'),
          el('p', { class: 'desc' }, 'It gets its own workspace folder with a shell, a file editor, web search and a page reader. It works step by step, runs what it writes, fixes errors, and tells you what it did. Skills assigned to the model are loaded automatically.'),
          el('label', { class: 'field' }, el('span', {}, 'Task'), goal),
          el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Model or combo'), modelSlot, skillHint), el('label', { class: 'field' }, el('span', {}, 'Workspace'), ws)),
          el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Shell commands'), shell), el('label', { class: 'field' }, el('span', {}, 'Max steps'), steps)),
          warn, el('div', { class: 'row', style: 'margin-top:12px' }, go, el('span', { class: 'hint', style: 'margin:0' }, 'Works best with a coding-strong model or combo.')))));
      shell.dispatchEvent(new Event('change'));
      if (!S.modelsLoaded) S.loadModels().then(drawModel);
    }

    function watch(id) {
      const head = el('div', { class: 'row', style: 'margin-bottom:12px' });
      const tl = S.timeline(id);
      const filesSlot = el('div');
      main.append(head, el('div', { class: 'grid2', style: 'align-items:start;grid-template-columns:minmax(0,3fr) minmax(0,2fr)' }, tl.root, el('div', { class: 'card' }, filesSlot)));
      let wsName = '';
      const stopBtn = el('button', { class: 'btn danger', onclick: async () => { try { await S.api('POST', `/api/runs/${id}/stop`, {}); } catch (e) { S.toast(e.message, true); } } }, S.iconEl('stop'), 'Stop');
      stopPoll = S.pollRun(id, (v) => {
        S.set(head, el('h2', { style: 'margin:0;font-size:16px' }, v.title), S.statusChip(v.status), el('span', { class: 'chip' }, v.meta.model || ''), el('span', { class: 'chip', title: 'Shell mode' }, 'shell: ' + (v.meta.shell || '')), el('span', { class: 'spacer' }), v.status === 'running' ? stopBtn : null);
        if (!wsName && v.meta.workspace) { wsName = v.meta.workspace; files = S.filesPanel(wsName); filesSlot.append(files.root); }
        v.events.forEach(tl.add);
        main.scrollTop = main.scrollHeight;
      }, { onEnd: () => { loadRuns(); if (files) files.refresh(); } });
    }

    container.append(el('div', { class: 'topbar' }, el('h1', {}, 'Computer'), el('span', { class: 'sub' }, 'A model with its own workspace, shell and web tools')), el('div', { class: 'split' }, side, main));
    loadRuns().then(() => open(runs.some((r) => r.id === current) ? current : ''));
    listTimer = setInterval(() => { if (!dead) loadRuns(); }, 6000);
    return () => { dead = true; clearInterval(listTimer); cleanup(); };
  };
})();
