'use strict';
/* Websites and Apps: a gallery of saved projects + a workspace (chat → files on disk → live preview → code editor).
   Both tabs share this code; `makeBuilder(cfg)` decides the wording, the system prompt and which projects are listed. */
(function () {
  const { el } = S;

  const BUILDER_SYSTEM = `You are an expert web designer and front-end developer acting as a website builder. You build complete, polished, responsive websites out of plain HTML, CSS and JavaScript files that open directly in a browser (no build step, nothing to install).

OUTPUT FORMAT (strict). For every file you create or change, output the FULL file contents in a fenced code block whose info string is the language followed by file=<relative path>. Example:

\`\`\`html file=index.html
<!doctype html>
...
\`\`\`

\`\`\`css file=css/style.css
...
\`\`\`

RULES
- index.html is always the entry page. Link CSS and JS with relative paths (css/style.css, js/app.js).
- Mobile-first and responsive. Semantic HTML, good contrast, alt text, labelled form fields.
- Write real, specific copy for the user's business or topic - never lorem ipsum.
- Make it look designed: a clear type scale, a restrained colour palette, generous spacing, subtle hover and focus states. Use CSS or inline SVG for visuals; avoid external image URLs that can break. System fonts are fine.
- When editing an existing site, output ONLY the files that change, each one in full. Never write "rest unchanged" or partial snippets.
- Start with one or two sentences saying what you built or changed, then the files, then a short note on what to try next.`;

  const SITE_STARTERS = [
    ['Bakery landing page', 'Build a landing page for a neighbourhood bakery called "Crumb & Co" with hero, menu highlights, opening hours, and an order-by-phone call to action.'],
    ['Portfolio', 'Build a minimal personal portfolio for a freelance photographer with a project grid, an about section, and a contact form.'],
    ['Restaurant menu', 'Build a one-page restaurant site with a sticky nav, a tabbed menu (starters, mains, desserts), and a reservation form.'],
    ['Product launch', 'Build a product launch page for a smart water bottle with features, pricing table, FAQ accordion, and email signup.'],
  ];


  const APP_SYSTEM = `You are an expert product engineer acting as an app builder. You build complete, working web apps out of plain HTML, CSS and JavaScript files that open directly in a browser (no build step, no packages, nothing to install). An app is something people USE: it has real features, state, and data that survives a reload. It is not a brochure page.

OUTPUT FORMAT (strict). For every file you create or change, output the FULL file contents in a fenced code block whose info string is the language followed by file=<relative path>. Example:

\`\`\`html file=index.html
<!doctype html>
...
\`\`\`

\`\`\`js file=js/app.js
...
\`\`\`

RULES
- index.html is always the entry page. Link CSS and JS with relative paths. Use classic <script src> tags (not ES module imports across files) so it also works when opened from disk.
- Build the actual features the user asked for, end to end: forms, validation, add / edit / delete, filtering, empty states, keyboard support. No placeholder buttons that do nothing.
- Keep state in one JavaScript object and render from it. Save it with localStorage (JSON.stringify under one key, wrapped in try/catch) and load it on start, so the data survives reloads. Do not use IndexedDB, cookies, or network calls to other sites: the preview runs in a sandbox. If the app needs data, ship sensible sample data the user can delete.
- Mobile-first and responsive, usable with touch and keyboard. Semantic HTML, labelled controls, visible focus states, good contrast, respect prefers-color-scheme.
- Make it look like a product: a clear layout, a restrained palette, consistent spacing, subtle transitions. Use CSS or inline SVG for icons; avoid external image URLs and CDNs that can break.
- Escape any user text you insert into the page (use textContent, never innerHTML with user input).
- When editing an existing app, output ONLY the files that change, each one in full. Never write "rest unchanged" or partial snippets.
- Start with one or two sentences saying what you built or changed, then the files, then a short note on what to try.`;

  const APP_STARTERS = [
    ['Habit tracker', 'Build a habit tracker app: add habits, tick them off per day, show a 7-day streak grid and a current-streak counter. Data must survive reloads.'],
    ['Expense splitter', 'Build an app that splits shared expenses between friends: add people, add expenses with who paid, and show who owes whom with the fewest payments.'],
    ['Kanban board', 'Build a kanban board with three columns, drag-and-drop cards between columns, add/edit/delete cards, and colour labels.'],
    ['Flashcards', 'Build a flashcard study app: create decks and cards, a study mode with flip animation, and a "knew it / missed it" score per deck.'],
  ];

  const SITE_CFG = { kind: 'site', route: 'builder', pref: 'project', mode: 'builder', title: 'Websites', noun: 'website', nounCap: 'Website', system: BUILDER_SYSTEM, starters: SITE_STARTERS, verb: 'Build', askLabel: 'What should we build?', hint: 'Describe your site. Files are written straight into this project’s folder, and the preview updates live.', placeholder: 'Describe the site, or what to change…', empty: 'No pages yet' };
  const APP_CFG = { kind: 'app', route: 'apps', pref: 'app.project', mode: 'app', title: 'Apps', noun: 'app', nounCap: 'App', system: APP_SYSTEM, starters: APP_STARTERS, verb: 'Build', askLabel: 'What app should we build?', hint: 'Describe the app and what it should do. Files are written into this project’s folder, the preview runs it live, and its data is kept between reloads.', placeholder: 'Describe the app, or what to change…', empty: 'No app yet' };

  function makeBuilder(cfg) {
  /** The model for this tab; Apps falls back to the website builder's model until you pick one. */
  const modelOf = () => S.config.modeModels[cfg.mode] || (cfg.mode !== 'builder' ? S.config.modeModels.builder : '') || '';
  /* ------------------------------- gallery ------------------------------- */
  async function gallery(container) {
    const grid = el('div', { class: 'proj-grid' });
    const search = el('input', { type: 'text', placeholder: 'Search projects…', style: 'max-width:240px' });
    let projects = [];

    const draw = () => {
      const q = search.value.trim().toLowerCase();
      grid.replaceChildren(el('button', { class: 'proj-new', onclick: createDialog }, el('div', { style: 'font-size:28px;line-height:1;color:var(--accent)' }, '+'), 'New ' + cfg.noun));
      for (const p of projects.filter((p) => !q || (p.name + ' ' + p.description).toLowerCase().includes(q))) {
        grid.append(el('div', { class: 'proj-card' },
          el('div', { class: 'proj-thumb' }, p.hasIndex ? el('iframe', { src: `/preview/${p.slug}/?t=${p.updated}`, sandbox: 'allow-scripts', loading: 'lazy', tabindex: '-1', title: p.name }) : el('div', { class: 'none' }, cfg.empty)),
          el('div', { class: 'proj-body' },
            el('h3', {}, p.name),
            el('div', { class: 'd' }, p.description || 'No description'),
            el('div', { class: 'm' }, `${p.fileCount} file${p.fileCount === 1 ? '' : 's'} · updated ${S.ago(p.updated)}`),
            el('div', { class: 'm', style: 'font-family:var(--mono);word-break:break-all', title: 'Folder on this computer' }, p.folder),
            el('div', { class: 'row', style: 'margin-top:6px' },
              el('button', { class: 'btn primary sm', onclick: () => open(p.slug) }, 'Open'),
              p.hasIndex ? el('a', { class: 'btn sm', href: `/preview/${p.slug}/`, target: '_blank', rel: 'noopener' }, 'Preview') : null,
              el('span', { class: 'spacer' }),
              el('button', { class: 'btn sm ghost danger', title: 'Delete project and its files', onclick: async () => { if (await S.confirm(`Delete “${p.name}”?`, 'This permanently deletes the project folder and all its files from your computer.', 'Delete')) { await S.api('DELETE', '/api/projects/' + p.slug); S.toast('Project deleted'); load(); } } }, S.iconEl('trash'))))));
      }
    };

    async function load() {
      try { projects = await S.api('GET', '/api/projects?kind=' + cfg.kind); } catch (e) { S.toast(e.message, true); }
      draw();
    }

    async function createDialog() {
      const name = el('input', { type: 'text', placeholder: 'e.g. Crumb & Co bakery', maxlength: '80' });
      const desc = el('textarea', { rows: '3', placeholder: 'Optional: what is this ' + cfg.noun + ' for?' });
      const r = await S.dialog('New ' + cfg.noun + ' project', [
        el('label', { class: 'field' }, el('span', {}, 'Project name'), name),
        el('label', { class: 'field' }, el('span', {}, 'Description'), desc),
      ], [{ label: 'Cancel', value: false }, { label: 'Create project', cls: 'primary', value: () => (name.value.trim() ? true : null) }]);
      if (!r) return;
      try {
        const p = await S.api('POST', '/api/projects', { name: name.value, description: desc.value, kind: cfg.kind });
        open(p.slug);
      } catch (e) { S.toast(e.message, true); }
    }
    function open(slug) { S.pref.set(cfg.pref, slug); S.go(cfg.route); }

    search.addEventListener('input', draw);
    container.append(
      el('div', { class: 'topbar' }, el('h1', {}, cfg.title), el('span', { class: 'sub' }, 'All your ' + cfg.title.toLowerCase() + ' — each one is a real folder on this computer'), el('span', { class: 'spacer' }), search),
      el('div', { class: 'page' }, grid));
    load();
  }

  /* ------------------------------ workspace ------------------------------ */
  async function workspace(container, slug) {
    let project;
    try { project = await S.api('GET', '/api/projects/' + slug); } catch (e) { S.toast(e.message, true); S.pref.set(cfg.pref, ''); return gallery(container); }

    const state = { busy: false, abort: null, tab: 'preview', device: '', file: 'index.html', dirty: false };
    const messages = project.chat.messages || [];
    const messagesEl = el('div', { class: 'messages' });
    const input = el('textarea', { rows: '2', placeholder: cfg.placeholder });
    const sendBtn = el('button', { class: 'btn primary' });
    const rightEl = el('div', { class: 'ws-right' });
    const titleEl = el('h1', { title: 'Click to rename', style: 'cursor:text' }, project.name);
    let nodes = [];

    titleEl.addEventListener('click', async () => {
      const inp = el('input', { type: 'text', value: project.name });
      const ok = await S.dialog('Rename project', [el('label', { class: 'field' }, el('span', {}, 'Project name'), inp)], [{ label: 'Cancel', value: false }, { label: 'Rename', cls: 'primary', value: () => (inp.value.trim() ? true : null) }]);
      if (!ok) return;
      await S.api('PATCH', '/api/projects/' + slug, { name: inp.value });
      project.name = inp.value.trim(); titleEl.textContent = project.name;
    });

    const refreshProject = async () => { const fresh = await S.api('GET', '/api/projects/' + slug); project.files = fresh.files; project.updated = fresh.updated; drawRight(); };
    const saveChat = () => S.api('PUT', `/api/projects/${slug}/chat`, { messages }).catch(() => {});

    const onRate = null;
    function addNode(msg, isLast, streaming) {
      const node = S.msgEl(msg, { streaming, isLast, collapseFiles: true, onRegen: isLast ? regenerate : null });
      messagesEl.append(node); nodes.push(node);
      if (msg.written && msg.written.length) node.append(el('div', { class: 'foot' }, el('span', { class: 'chip accent' }, 'Saved: ' + msg.written.join(', '))));
      return node;
    }
    function renderMessages() {
      messagesEl.replaceChildren(); nodes = [];
      if (!messages.length) {
        messagesEl.append(el('div', { class: 'empty', style: 'margin-top:5vh' }, el('h2', {}, cfg.askLabel), el('p', {}, cfg.hint),
          el('div', { class: 'suggest', style: 'grid-template-columns:1fr' }, cfg.starters.map(([t, p]) => el('button', { onclick: () => { input.value = p; input.focus(); } }, el('b', { style: 'color:var(--text)' }, t), el('div', { style: 'font-size:12.5px' }, p))))));
        return;
      }
      messages.forEach((m, i) => addNode(m, i === messages.length - 1));
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function setBusy(b) { state.busy = b; sendBtn.replaceChildren(S.iconEl(b ? 'stop' : 'send'), b ? 'Stop' : 'Build'); sendBtn.classList.toggle('danger', b); }

    function systemPrompt() {
      let s = cfg.system + `\n\nPROJECT: "${project.name}"${project.description ? ' - ' + project.description : ''}\n`;
      const textFiles = project.files.filter((f) => f.content !== null);
      if (!textFiles.length) return s + 'The project is empty. Create the ' + cfg.noun + ' from scratch.';
      s += 'CURRENT FILES (these exist on disk right now):\n';
      let budget = 60000;
      for (const f of textFiles) {
        const body = f.content.length > 20000 ? f.content.slice(0, 20000) + '\n/* …truncated… */' : f.content;
        if (budget - body.length < 0) { s += `\n--- ${f.path} (omitted: too large for context)\n`; continue; }
        budget -= body.length;
        s += `\n--- ${f.path}\n${body}\n`;
      }
      return s;
    }

    /** Old replies carry whole files; the current files are already in the system prompt, so shrink them. */
    const compact = (m) => ({ role: m.role, content: m.role === 'assistant' ? String(m.content).replace(/```[^\n]*(?:file|path)\s*[=:]\s*["']?([^\s"']+)[^\n]*\n[\s\S]*?```/gi, '[wrote $1]') : m.content });

    async function run() {
      const model = modelOf();
      if (!model) return S.toast('Choose a model or combo for the builder (top right of this page).', true);
      const lastUser = messages[messages.length - 1];
      let tuneInfo = null, params = {};
      if (S.config.autotune.enabled) { try { tuneInfo = await S.api('POST', '/api/autotune', { text: lastUser.content, mode: cfg.mode }); params = tuneInfo.params; } catch {} }
      params.max_tokens = 16000;
      const msg = { role: 'assistant', content: '', reasoning: '', meta: { model, params, tune: tuneInfo } };
      messages.push(msg);
      renderMessages();
      nodes.pop().remove();
      const live = addNode(msg, true, true);
      state.abort = new AbortController(); setBusy(true);
      const t0 = Date.now();
      try {
        const r = await S.streamChat({
          model, messages: [{ role: 'system', content: systemPrompt() }, ...messages.slice(0, -1).slice(-14).map(compact)], params, signal: state.abort.signal,
          onUpdate: (res) => { msg.content = res.content; msg.reasoning = res.reasoning; live.update(true); if (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 160) messagesEl.scrollTop = messagesEl.scrollHeight; },
        });
        msg.content = r.content; msg.reasoning = r.reasoning; msg.meta.ms = Date.now() - t0; msg.meta.finish = r.finish;
        if (!r.content) { msg.error = true; msg.content = 'The model returned an empty reply.'; }
        else {
          const res = await S.api('POST', `/api/projects/${slug}/apply`, { text: r.content });
          msg.written = res.written;
          if (res.skipped.length) S.toast('Skipped: ' + res.skipped.map((s) => `${s.path} (${s.reason})`).join(', '), true);
          if (!res.written.length) S.toast('The reply had no files to save — ask it to output files in full.');
          else { state.tab = 'preview'; state.file = res.written.includes('index.html') ? 'index.html' : res.written[0]; }
        }
      } catch (e) {
        if (e.name === 'AbortError') { if (!msg.content) messages.pop(); }
        else { msg.error = true; msg.content = e.message; }
      } finally { setBusy(false); state.abort = null; }
      renderMessages(); await saveChat();
      try { await refreshProject(); } catch {}
    }

    async function submit() {
      if (state.busy) { state.abort && state.abort.abort(); return; }
      const text = input.value.trim();
      if (!text) return;
      if (!modelOf()) return S.toast('Choose a model or combo for the builder first.', true);
      input.value = ''; input.dispatchEvent(new Event('input'));
      messages.push({ role: 'user', content: text });
      await run();
    }
    async function regenerate() {
      if (state.busy) return;
      if (messages.length && messages[messages.length - 1].role === 'assistant') messages.pop();
      if (messages.length && messages[messages.length - 1].role === 'user') await run();
    }

    /* ---- right side: preview / code ---- */
    function drawRight() {
      const stage = el('div', { class: 'preview-stage ' + state.device });
      const hasIndex = project.files.some((f) => f.path === 'index.html');
      const frame = hasIndex
        ? el('iframe', { sandbox: 'allow-scripts allow-forms allow-popups allow-modals allow-downloads', src: `/preview/${slug}/?t=${Date.now()}`, title: cfg.nounCap + ' preview' })
        : el('div', { class: 'empty', style: 'align-self:center' }, el('h2', {}, 'Nothing to preview yet'), el('p', {}, 'Ask the builder for ' + (cfg.kind === 'app' ? 'an app' : 'a site') + ' on the left, or add an index.html in the Code tab.'));
      stage.append(frame);

      const devBtn = (label, v) => el('button', { class: 'btn sm ' + (state.device === v ? 'primary' : ''), onclick: () => { state.device = v; drawRight(); } }, label);
      const tabs = el('div', { class: 'tabs' },
        el('button', { class: 'tab' + (state.tab === 'preview' ? ' active' : ''), onclick: () => { state.tab = 'preview'; drawRight(); } }, 'Preview'),
        el('button', { class: 'tab' + (state.tab === 'code' ? ' active' : ''), onclick: () => { state.tab = 'code'; drawRight(); } }, `Code (${project.files.length})`),
        cfg.kind === 'app' ? el('button', { class: 'tab' + (state.tab === 'data' ? ' active' : ''), onclick: () => { state.tab = 'data'; drawRight(); } }, 'Data') : null,
        el('span', { class: 'spacer' }),
        state.tab === 'preview' ? [devBtn('Desktop', ''), devBtn('Tablet', 'tablet'), devBtn('Mobile', 'mobile'), el('button', { class: 'btn sm', title: 'Reload', onclick: () => drawRight() }, S.iconEl('refresh'))] : null,
        hasIndex ? el('a', { class: 'btn sm', href: `/preview/${slug}/`, target: '_blank', rel: 'noopener' }, S.iconEl('external'), 'Open in tab') : null,
        el('button', { class: 'btn sm', title: project.folder, onclick: () => S.copy(project.folder, 'Folder path copied') }, S.iconEl('copy'), 'Folder path'));

      rightEl.replaceChildren(tabs, state.tab === 'preview' ? stage : state.tab === 'data' ? dataPane() : codePane());
    }

    /** What the app has saved in its localStorage (kept in the project folder, so it survives reloads and restarts). */
    function dataPane() {
      const box = el('div', { class: 'page', style: 'padding:18px 22px' });
      const list = el('div', { class: 'stack', style: 'gap:8px' });
      const load = async () => {
        let data = {};
        try { data = (await S.api('GET', `/api/projects/${slug}/storage`)).data; } catch (e) { return S.set(list, el('div', { class: 'banner bad' }, e.message)); }
        const keys = Object.keys(data);
        S.set(list, keys.length ? keys.map((k) => {
          let shown = data[k];
          try { shown = JSON.stringify(JSON.parse(data[k]), null, 2); } catch {}
          return el('div', { class: 'ev' }, el('div', { class: 'h' }, el('code', { class: 'cmd' }, k), el('span', {}, `${data[k].length} characters`)), el('pre', {}, shown.length > 6000 ? shown.slice(0, 6000) + '\n…' : shown));
        }) : el('div', { class: 'empty' }, el('h2', {}, 'No saved data yet'), el('p', {}, 'When the app saves something with localStorage it shows up here.')));
      };
      box.append(
        el('p', { class: 'desc', style: 'margin:0 0 12px' }, 'The app’s own saved data. It lives in this project’s folder and survives reloads.'),
        el('div', { class: 'row', style: 'margin-bottom:12px' },
          el('button', { class: 'btn sm', onclick: load }, S.iconEl('refresh'), 'Refresh'),
          el('button', { class: 'btn sm danger', onclick: async () => { if (await S.confirm('Reset the app’s data?', 'This deletes everything the app has saved, so it starts fresh next time.', 'Reset')) { try { await S.api('DELETE', `/api/projects/${slug}/storage`); S.toast('App data cleared'); load(); } catch (e) { S.toast(e.message, true); } } } }, 'Reset data')),
        list);
      load();
      return box;
    }

    function codePane() {
      if (!project.files.some((f) => f.path === state.file)) state.file = (project.files[0] || {}).path || '';
      const file = project.files.find((f) => f.path === state.file);
      const list = el('div', { class: 'files' },
        el('button', { class: 'btn sm', style: 'width:100%;justify-content:center;margin-bottom:8px', onclick: newFile }, S.iconEl('plus'), 'New file'),
        project.files.map((f) => el('div', { class: 'file' + (f.path === state.file ? ' active' : ''), onclick: () => { state.file = f.path; drawRight(); } }, el('span', { style: 'overflow:hidden;text-overflow:ellipsis' }, f.path))));
      let editor;
      if (!file) editor = el('div', { class: 'empty' }, el('p', {}, 'No files yet.'));
      else if (file.content === null) editor = el('div', { class: 'empty' }, el('p', {}, `${file.path} is a binary or large file (${Math.round(file.size / 1024)} KB) and can’t be edited here.`));
      else {
        const ta = el('textarea', { spellcheck: 'false' }); ta.value = file.content;
        const status = el('span', {}, '');
        const saveBtn = el('button', { class: 'btn sm primary', onclick: save }, 'Save');
        async function save() {
          try { await S.api('PUT', `/api/projects/${slug}/file`, { path: file.path, content: ta.value }); file.content = ta.value; status.textContent = 'Saved'; await refreshProjectQuiet(); } catch (e) { S.toast(e.message, true); }
        }
        ta.addEventListener('input', () => { status.textContent = 'Unsaved changes'; });
        ta.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
          if (e.key === 'Tab') { e.preventDefault(); const s = ta.selectionStart; ta.setRangeText('  ', s, ta.selectionEnd, 'end'); }
        });
        editor = el('div', { class: 'editor' },
          el('div', { class: 'bar' }, el('span', {}, file.path), status, el('span', { class: 'spacer' }), saveBtn,
            el('button', { class: 'btn sm danger', onclick: async () => { if (await S.confirm(`Delete ${file.path}?`, 'This removes the file from disk.', 'Delete')) { await S.api('DELETE', `/api/projects/${slug}/file?path=${encodeURIComponent(file.path)}`); await refreshProject(); } } }, 'Delete')),
          ta);
      }
      return el('div', { class: 'code-pane' }, list, editor);
    }
    async function refreshProjectQuiet() { const fresh = await S.api('GET', '/api/projects/' + slug); project.files = fresh.files; }
    async function newFile() {
      const inp = el('input', { type: 'text', placeholder: 'e.g. about.html or css/extra.css' });
      const ok = await S.dialog('New file', [el('label', { class: 'field' }, el('span', {}, 'File path'), inp)], [{ label: 'Cancel', value: false }, { label: 'Create', cls: 'primary', value: () => (inp.value.trim() ? true : null) }]);
      if (!ok) return;
      try { const r = await S.api('PUT', `/api/projects/${slug}/file`, { path: inp.value.trim(), content: '' }); state.file = r.path; state.tab = 'code'; await refreshProject(); } catch (e) { S.toast(e.message, true); }
    }

    /* ---- assemble ---- */
    sendBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
    S.autoGrow(input, 160);
    setBusy(false);
    const modelSlot = el('span');
    const drawModel = () => modelSlot.replaceChildren(S.modelSelect(modelOf(), (v) => S.saveModeModel(cfg.mode, v), { title: 'Model or combo that builds the ' + cfg.noun }));
    drawModel();
    if (!S.modelsLoaded) S.loadModels().then(drawModel);

    container.append(
      el('div', { class: 'topbar' },
        el('button', { class: 'btn sm', onclick: () => { if (state.busy) return S.toast('Stop the current build first.'); S.pref.set(cfg.pref, ''); S.go(cfg.route); } }, S.iconEl('back'), 'All ' + cfg.title.toLowerCase()),
        titleEl, el('span', { class: 'sub', style: 'font-family:var(--mono)' }, project.folder), el('span', { class: 'spacer' }), modelSlot),
      el('div', { class: 'ws' },
        el('div', { class: 'ws-chat' }, messagesEl, el('div', { class: 'composer' }, el('div', { class: 'box' }, input, sendBtn))),
        rightEl));
    renderMessages(); drawRight();
    return () => { if (state.abort) state.abort.abort(); };
  }

  return (container) => {
    const slug = S.pref.get(cfg.pref, '');
    const host = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' }); // detached on navigation, so late async work can't leak into another view
    container.append(host);
    let inner = null, left = false;
    (slug ? workspace(host, slug) : gallery(host)).then((c) => { inner = c; if (left && c) c(); });
    return () => { left = true; if (inner) inner(); host.remove(); };
  };
  }

  S.views.builder = makeBuilder(SITE_CFG);
  S.views.apps = makeBuilder(APP_CFG);
})();
