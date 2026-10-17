'use strict';
/* Team: several models/combos on one project. Roster = who is good at what. Project = plan, assign, run, review. */
(function () {
  const { el } = S;

  const STATUS = {
    pending: ['Waiting', ''], assigned: ['Assigned', 'accent'], working: ['Working', 'accent'], review: ['In review', ''],
    done: ['Passed review', 'accent'], done_unreviewed: ['Done (unreviewed)', 'accent'], done_with_issues: ['Done, concerns', ''],
    failed: ['Failed', ''], blocked: ['Blocked', ''], stopped: ['Stopped', ''],
  };

  S.views.team = (container) => {
    let tab = S.pref.get('team.tab', 'project');
    let data = null; // { roster, caps, labels, options }
    let dead = false;
    const cleanups = [];
    const body = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto' });
    const clean = () => { while (cleanups.length) { try { cleanups.pop()(); } catch {} } };

    async function load(sync = true) {
      try { data = await S.api('GET', '/api/team' + (sync ? '' : '?sync=0')); } catch (e) { S.toast(e.message, true); data = null; }
      draw();
    }
    const enabled = () => Object.entries(data.roster.models).filter(([, m]) => m.enabled).map(([id]) => id);

    const tabs = () => el('div', { class: 'tabs' },
      ['project', 'roster', 'history'].map((t) => el('button', { class: 'tab' + (tab === t ? ' active' : ''), onclick: () => { tab = t; S.pref.set('team.tab', t); clean(); load(false); } }, { project: 'Project', roster: 'Roster', history: 'History' }[t])),
      el('span', { class: 'spacer' }), el('span', { class: 'chip accent' }, data ? `${enabled().length} on the team` : '…'));

    function draw() {
      clean();
      body.replaceChildren(tabs());
      if (!data) { body.append(el('div', { class: 'page' }, el('div', { class: 'banner bad' }, 'Could not load the team. Check the connection in Settings.'))); return; }
      body.append(tab === 'roster' ? roster() : tab === 'history' ? history() : project());
    }

    /* -------------------------------- roster -------------------------------- */
    function roster() {
      const r = data.roster;
      const caps = data.caps.filter((c) => c !== 'research');
      const filter = el('input', { type: 'text', placeholder: 'Filter models…', style: 'max-width:220px' });
      const onlyOn = el('input', { type: 'checkbox', checked: S.pref.get('team.onlyOn', false) });
      const tbody = el('tbody');
      const progress = el('div');
      let skillAssign = {};
      S.api('GET', '/api/skills').then((r) => { skillAssign = r.assign || {}; drawRows(); }).catch(() => {});

      const patch = async (id, p) => {
        try { data.roster = (await S.api('PUT', '/api/team', { models: { [id]: p } })).roster; } catch (e) { S.toast(e.message, true); }
      };
      const drawRows = () => {
        const q = filter.value.trim().toLowerCase();
        const ids = Object.keys(r.models).filter((id) => (!q || id.toLowerCase().includes(q)) && (!onlyOn.checked || r.models[id].enabled)).sort((a, b) => (r.models[b].enabled - r.models[a].enabled) || a.localeCompare(b));
        tbody.replaceChildren(...ids.map((id) => {
          const m = data.roster.models[id];
          return el('tr', { class: m.nonText ? 'nontext' : '' },
            el('td', {}, el('label', { style: 'display:flex;gap:8px;align-items:center;cursor:pointer' }, el('input', { type: 'checkbox', checked: m.enabled, onchange: async (e) => { await patch(id, { enabled: e.target.checked }); draw(); } }), id, m.nonText ? el('span', { class: 'chip', title: 'Looks like a video / image / audio model, so it is not used for team work unless you switch it on yourself' }, 'not text') : null)),
            caps.map((c) => el('td', {}, el('input', { type: 'number', min: '0', max: '100', class: 'src-' + ((m.source || {})[c] || 'guess'), value: (m.scores || {})[c] ?? 50, title: ({ measured: 'Measured by the benchmark', manual: 'Typed in by you', guess: 'Guessed from the name — run the benchmark or type your own' })[(m.source || {})[c] || 'guess'], onchange: (e) => patch(id, { scores: { [c]: Number(e.target.value) } }).then(() => { e.target.className = 'src-manual'; }) }))),
            el('td', { style: 'font-family:var(--mono);font-size:12px;color:var(--muted)' }, m.speedMs ? (m.speedMs / 1000).toFixed(1) + 's' : '–'),
            el('td', {}, el('select', { style: 'width:56px;padding:3px', onchange: (e) => patch(id, { concurrency: Number(e.target.value) }) }, [1, 2, 3, 4].map((n) => el('option', { value: n, selected: (m.concurrency || 1) === n }, n)))),
            el('td', {}, (() => {
              const own = (skillAssign[id] || []).length, all = (skillAssign['*'] || []).length;
              return el('button', { class: 'link', title: `${own} skill(s) for this model + ${all} for everyone. Click to edit in the Skills tab.`, onclick: () => { S.pref.set('skills.target', id); S.pref.set('skills.tab', 'model'); S.go('skills'); } }, own + all ? String(own + all) : 'add');
            })()));
        }));
      };
      filter.addEventListener('input', drawRows);
      onlyOn.addEventListener('change', () => { S.pref.set('team.onlyOn', onlyOn.checked); drawRows(); });
      drawRows();

      const pickOne = (label, key, hint) => {
        const ids = Object.keys(r.models);
        return el('label', { class: 'field', style: 'margin:0' }, el('span', {}, label), el('select', { onchange: async (e) => { data.roster = (await S.api('PUT', '/api/team', { [key]: e.target.value })).roster; S.toast(`${label}: ${e.target.value || 'automatic'}`); } },
          el('option', { value: '' }, 'Automatic (best score)'), ids.sort().map((id) => el('option', { value: id, selected: r[key] === id }, id))), el('div', { class: 'hint' }, hint));
      };

      async function bench() {
        const ids = enabled();
        if (!ids.length) return S.toast('Switch on the models you want measured first.', true);
        if (!(await S.confirm(`Benchmark ${ids.length} model${ids.length === 1 ? '' : 's'}?`, `Sends ${data.probes} short test prompts to each (code is run against real test cases, math answers are checked). It uses a little of your quota and takes a minute or two.`, 'Start benchmark'))) return;
        try {
          const res = await S.api('POST', '/api/team/benchmark', { models: ids });
          progress.replaceChildren(el('div', { class: 'hint' }, 'Running…'));
          const lines = [];
          const stop = S.pollRun(res.id, (v) => {
            for (const ev of v.events) {
              if (ev.type === 'bench_probe') lines.push(`${ev.model} · ${ev.probe}: ${ev.ok ? ev.score + '%' : 'failed'}${ev.note ? ' (' + ev.note + ')' : ''}`);
            }
            S.set(progress, el('div', { class: 'viewer', style: 'max-height:160px' }, lines.slice(-14).join('\n')), v.status !== 'running' ? el('div', { class: 'hint' }, 'Benchmark ' + v.status + '. Scores updated.') : null);
          }, { onEnd: () => load(false) });
          cleanups.push(stop);
        } catch (e) { S.toast(e.message, true); }
      }

      return el('div', { class: 'page' }, el('div', { class: 'stack' },
        el('div', { class: 'card' },
          el('h2', {}, 'Who is on the team and what they are good at'),
          el('p', { class: 'desc' }, 'Switch on the models and combos that should work together. Scores (0–100) decide who gets which task. Underline shows the source: grey = guessed from the name, green = measured by the benchmark, amber = typed by you. The scheduler also learns from real results. The Skills column shows how many skills each model has learned — click it to change them.'),
          el('div', { class: 'row', style: 'margin-bottom:12px' }, filter, el('label', { class: 'switch' }, onlyOn, el('span', {}, 'Only show models that are on')), el('span', { class: 'spacer' }),
            el('button', { class: 'btn', title: 'Turns on every text model. Video, image and audio models are skipped.', onclick: async () => { const all = {}; Object.entries(r.models).forEach(([id, m]) => { if (!m.nonText) all[id] = { enabled: true }; }); data.roster = (await S.api('PUT', '/api/team', { models: all })).roster; draw(); } }, 'Switch all on'),
            el('button', { class: 'btn primary', onclick: bench }, 'Benchmark the ones that are on')),
          progress,
          el('div', { style: 'overflow:auto;max-height:55vh;margin-top:10px' }, el('table', { class: 'score-table' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Model / combo'), caps.map((c) => el('th', {}, data.labels[c] || c)), el('th', {}, 'Speed'), el('th', { title: 'How many tasks it may work on at once' }, 'Parallel'), el('th', { title: 'Skills this model has learned (its own + Everyone)' }, 'Skills'))), tbody))),
        el('div', { class: 'card' }, el('div', { class: 'grid2' },
          pickOne('Lead (plans the project)', 'lead', 'Splits the goal into tasks. A strong reasoning model works best.'),
          pickOne('Reviewer (checks the work)', 'reviewer', 'Used to check other models’ work; a different model than the author whenever possible.')))));
    }

    /* -------------------------------- project -------------------------------- */
    function project() {
      const goal = el('textarea', { rows: '5', placeholder: 'Describe the project. For example: “Build a small website for a bakery with a menu page, an order form and a README, and check that it all fits together.”', value: S.pref.get('team.goal', '') });
      goal.addEventListener('input', () => S.pref.set('team.goal', goal.value));
      const out = el('div');
      let workspaces = [];
      let plan = null;

      const shell = el('select', {}, [['confirm', 'Ask me before each command'], ['auto', 'Run commands automatically'], ['off', 'No shell']].map(([v, l]) => el('option', { value: v, selected: S.config.agent.shell === v }, l)));
      const par = el('input', { type: 'number', min: '1', max: '8', value: data.options.maxParallel });
      const att = el('input', { type: 'number', min: '1', max: '5', value: data.options.maxAttempts });
      const ws = el('select', {}, el('option', { value: '' }, 'New workspace'));
      S.api('GET', '/api/workspaces').then((w) => { workspaces = w; w.forEach((x) => ws.append(el('option', { value: x.name }, 'Continue in: ' + x.name))); }).catch(() => {});

      const preflight = () => {
        if (!enabled().length) { S.toast('Switch on at least one model in the Roster.', true); return false; }
        if (!goal.value.trim()) { S.toast('Describe the project first.', true); return false; }
        return true;
      };

      const start = async (withPlan) => {
        if (!preflight()) return;
        try {
          const body = { goal: goal.value, shell: shell.value, maxParallel: Number(par.value), maxAttempts: Number(att.value), workspace: ws.value || undefined };
          if (withPlan) body.plan = { summary: withPlan.summary, tasks: withPlan.tasks.map(({ id, title, description, capability, depends_on, deliverables, acceptance, model }) => ({ id, title, description, capability, depends_on, deliverables, acceptance, model })) };
          const r = await S.api('POST', '/api/team/runs', body);
          S.pref.set('team.run', r.id);
          watch(r.id);
        } catch (e) { S.toast(e.message, true); }
      };

      const planBtn = el('button', { class: 'btn', onclick: async () => {
        if (!preflight()) return;
        planBtn.disabled = true; planBtn.textContent = 'Planning…';
        out.replaceChildren(el('div', { class: 'hint' }, el('span', { class: 'spin', style: 'display:inline-block;vertical-align:middle;margin-right:8px' }), 'The lead model is splitting the project into tasks…'));
        try { plan = await S.api('POST', '/api/team/plan', { goal: goal.value }); drawPlan(); } catch (e) { out.replaceChildren(el('div', { class: 'banner bad' }, e.message)); }
        planBtn.disabled = false; planBtn.textContent = 'Plan it & review assignments';
      } }, 'Plan it & review assignments');
      const goBtn = el('button', { class: 'btn primary', onclick: () => start(null) }, 'Start team now');

      function drawPlan() {
        out.replaceChildren(el('h3', { style: 'margin:16px 0 4px' }, 'Plan'), el('p', { class: 'hint', style: 'margin:0 0 10px' }, `${plan.summary || ''} Planned by ${plan.lead}. “Auto” gives each task to the best model that is free when it is ready; pin a model to override. An integration check is added at the end.`),
          el('div', { class: 'board' }, plan.tasks.map((t) => el('div', { class: 'tcard' },
            el('h4', {}, `${t.id}: ${t.title}`),
            el('div', { class: 'row', style: 'margin-bottom:6px' }, el('span', { class: 'chip accent' }, data.labels[t.capability] || t.capability), t.depends_on.length ? el('span', { class: 'chip' }, 'after ' + t.depends_on.join(', ')) : el('span', { class: 'chip' }, 'can start now')),
            el('div', { class: 'm' }, t.description.slice(0, 160) + (t.description.length > 160 ? '…' : '')),
            t.deliverables.length ? el('div', { class: 'm', style: 'font-family:var(--mono);margin-top:4px' }, t.deliverables.join(', ')) : null,
            el('label', { class: 'field', style: 'margin:8px 0 0' }, el('span', {}, 'Model'), el('select', { onchange: (e) => { t.model = e.target.value; } },
              el('option', { value: '' }, t.ranked.length ? `Auto — best: ${t.ranked[0].model} (${t.ranked[0].fit})` : 'Auto'), enabled().map((id) => el('option', { value: id, selected: t.model === id }, id))))))),
          el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: () => start(plan) }, 'Start with this plan'), el('span', { class: 'hint', style: 'margin:0' }, 'The reviewer checks every task; failed work is retried with feedback, then given to the next-best model.')));
      }

      const hasModels = enabled().length > 0;
      return el('div', { class: 'page narrow' }, el('div', { class: 'stack' },
        !hasModels ? el('div', { class: 'banner' }, 'No models are on the team yet. Open the Roster, switch some on, and (optionally) run the benchmark so tasks go to whoever is actually best.', el('button', { class: 'btn sm', onclick: () => { tab = 'roster'; S.pref.set('team.tab', tab); draw(); } }, 'Open roster')) : null,
        el('div', { class: 'card' },
          el('h2', {}, 'Work on a project together'),
          el('p', { class: 'desc' }, 'A lead model plans the work. Each task goes to the model on your team that is best at that kind of work, independent tasks run at the same time, a second model reviews every result, and a final check makes sure the pieces fit.'),
          el('label', { class: 'field' }, el('span', {}, 'Project goal'), goal),
          el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Workspace'), ws), el('label', { class: 'field' }, el('span', {}, 'Shell commands'), shell)),
          el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Tasks at the same time'), par), el('label', { class: 'field' }, el('span', {}, 'Attempts per task'), att)),
          el('div', { class: 'row' }, planBtn, goBtn)),
        out));
    }

    /* -------------------------------- run view -------------------------------- */
    function watch(id) {
      clean();
      body.replaceChildren(tabs());
      const tasks = new Map();
      const board = el('div', { class: 'board' });
      const head = el('div', { class: 'row', style: 'margin-bottom:12px' });
      const reports = el('div');
      const drawBoard = () => {
        board.replaceChildren(...[...tasks.values()].map((t) => {
          const [label, cls] = STATUS[t.status] || [t.status, ''];
          return el('div', { class: 'tcard ' + t.status },
            el('h4', {}, `${t.id}: ${t.title}`),
            el('div', { class: 'row', style: 'margin-bottom:4px' }, el('span', { class: 'chip ' + cls }, label), el('span', { class: 'chip' }, data.labels[t.capability] || t.capability)),
            t.model ? el('div', { class: 'm' }, '🤖 ' + t.model + (t.attempt > 1 ? ` · attempt ${t.attempt}` : '')) : null,
            t.note ? el('div', { class: 'm' }, t.note) : null,
            t.review ? el('div', { class: 'm' }, `🔍 ${t.review.reviewer}: ${t.review.verdict}${t.review.score !== null && t.review.score !== undefined ? ' (' + t.review.score + '/10)' : ''}`) : null);
        }));
      };
      const tl = S.timeline(id, {
        showModel: true,
        extra: (ev, { who }) => {
          if (ev.type === 'plan') { ev.tasks.forEach((t) => tasks.set(t.id, { ...t, status: 'pending' })); drawBoard(); return el('div', { class: 'hint', style: 'margin:0 4px' }, `Plan ready: ${ev.tasks.length} tasks. ${ev.summary || ''}`); }
          if (ev.type === 'task') { const t = tasks.get(ev.taskId); if (t) { Object.assign(t, { status: ev.status, model: ev.model || t.model, attempt: ev.attempt, note: ev.note || '' }); drawBoard(); } return null; }
          if (ev.type === 'review') {
            const t = tasks.get(ev.taskId); if (t) { t.review = ev; drawBoard(); }
            return el('div', { class: 'ev' + (ev.verdict === 'fail' ? ' bad' : '') }, el('div', { class: 'h' }, `🔍 ${ev.taskId}: ${ev.reviewer} says`, el('b', {}, ev.verdict.toUpperCase()), ev.score !== null && ev.score !== undefined ? `(${ev.score}/10)` : ''), ev.issues && ev.issues.length ? el('pre', {}, ev.issues.map((x) => '• ' + x).join('\n')) : null);
          }
          if (ev.type === 'report') { reports.replaceChildren(el('div', { class: 'card', style: 'margin-bottom:14px' }, el('div', { class: 'md', html: S.md(ev.text) }))); return null; }
          return null;
        },
      });
      const filesSlot = el('div');
      let files = null, wsName = '';
      const stopBtn = el('button', { class: 'btn danger', onclick: async () => { try { await S.api('POST', `/api/runs/${id}/stop`, {}); } catch (e) { S.toast(e.message, true); } } }, S.iconEl('stop'), 'Stop');
      const pendingBanner = el('div');
      body.append(el('div', { class: 'page' }, el('button', { class: 'btn sm', style: 'margin-bottom:10px', onclick: () => { S.pref.set('team.run', ''); draw(); } }, S.iconEl('back'), 'Back'), head, pendingBanner, board, reports,
        el('div', { class: 'grid2', style: 'align-items:start;grid-template-columns:minmax(0,3fr) minmax(0,2fr)' }, tl.root, el('div', { class: 'card' }, filesSlot))));
      const stop = S.pollRun(id, (v) => {
        S.set(head, el('h2', { style: 'margin:0;font-size:16px' }, v.title), S.statusChip(v.status), el('span', { class: 'spacer' }), v.status === 'running' ? stopBtn : null);
        pendingBanner.replaceChildren(...((v.pending || []).length ? [el('div', { class: 'warnbox', style: 'margin-bottom:10px' }, `${v.pending.length} command${v.pending.length === 1 ? ' is' : 's are'} waiting for your approval — see the orange cards below.`)] : []));
        if (!wsName && v.meta.workspace) { wsName = v.meta.workspace; files = S.filesPanel(wsName); filesSlot.append(files.root); cleanups.push(() => files.stop()); }
        v.events.forEach(tl.add);
      }, { onEnd: () => { if (files) files.refresh(); } });
      cleanups.push(stop);
    }

    /* -------------------------------- history -------------------------------- */
    function history() {
      const list = el('div', { class: 'stack' });
      S.api('GET', '/api/runs?kind=team').then((runs) => {
        list.replaceChildren(...(runs.length ? runs.map((r) => el('div', { class: 'card', style: 'display:flex;gap:12px;align-items:center;cursor:pointer', onclick: () => watch(r.id) },
          el('b', {}, r.title), S.statusChip(r.status), el('span', { class: 'hint', style: 'margin:0' }, S.ago(r.created)), el('span', { class: 'spacer' }),
          el('button', { class: 'btn sm ghost danger', onclick: async (e) => { e.stopPropagation(); try { await S.api('DELETE', '/api/runs/' + r.id); draw(); } catch (er) { S.toast(er.message, true); } } }, S.iconEl('trash')))) : [el('div', { class: 'hint' }, 'No team projects yet.')]));
      });
      return el('div', { class: 'page narrow' }, list);
    }

    container.append(el('div', { class: 'topbar' }, el('h1', {}, 'Team'), el('span', { class: 'sub' }, 'Put your models and combos on one project — each on what it does best')), body);
    if (!S.modelsLoaded) S.loadModels();
    load().then(() => { const r = S.pref.get('team.run', ''); if (r && tab === 'project') watch(r); });
    return () => { dead = true; clean(); };
  };
})();
