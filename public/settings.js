'use strict';
/* Settings: OmniRoute connection, default models per mode, pinned combos, video endpoint, AutoTune, STM, theme. */
(function () {
  const { el } = S;

  const MODE_LABELS = [
    ['chat', 'Chat'], ['reasoning', 'Reasoning'], ['coding', 'Coding'], ['builder', 'Website builder'], ['app', 'App builder (falls back to the website builder)'], ['rea', 'REA (reverse engineering)'], ['video', 'Video'], ['judge', 'Arena judge (optional)'],
  ];

  S.views.settings = (container) => {
    const url = el('input', { type: 'text', value: S.config.baseUrl, placeholder: 'http://localhost:20128/v1' });
    const key = el('input', { type: 'password', placeholder: S.config.hasKey ? `Saved: ${S.config.apiKeyMasked} (leave blank to keep)` : 'Paste your OmniRoute API key', autocomplete: 'off' });
    const connStatus = el('div', { class: 'hint' });
    const modelsBox = el('div');
    const pinnedBox = el('div', { class: 'row' });
    const learnedBox = el('div');
    let pinned = [...(S.config.pinned || [])];

    const flash = (msg, bad) => { connStatus.textContent = msg; connStatus.style.color = bad ? 'var(--bad)' : 'var(--good)'; };

    async function saveConnection() {
      try {
        const body = { baseUrl: url.value };
        if (key.value.trim()) body.apiKey = key.value.trim();
        S.config = { ...S.config, ...(await S.api('POST', '/api/config', body)) };
        key.value = ''; key.placeholder = `Saved: ${S.config.apiKeyMasked} (leave blank to keep)`; url.value = S.config.baseUrl;
        flash('Saved. Testing connection…');
        await S.loadModels();
        flash(S.modelsError ? S.modelsError : `Connected — ${S.models.length} models${S.combos.length ? `, ${S.combos.length} combos` : ''} found.`, !!S.modelsError || !S.models.length);
        await S.applyStarterModels();
        drawModels(); drawPinned();
      } catch (e) { flash(e.message, true); }
    }

    function drawModels() {
      modelsBox.replaceChildren(...MODE_LABELS.map(([mode, label]) => el('label', { class: 'field' }, el('span', {}, label), S.modelSelect(S.config.modeModels[mode], (v) => { S.saveModeModel(mode, v); S.toast(`${label}: ${v || 'none'}`); }, { allowEmpty: true, emptyLabel: '— choose —' }))));
    }

    async function savePinned() { S.config = { ...S.config, ...(await S.api('POST', '/api/config', { pinned })) }; drawPinned(); drawModels(); }
    function drawPinned() {
      pinned = [...(S.config.pinned || [])];
      pinnedBox.replaceChildren(...pinned.map((p) => el('span', { class: 'chip accent' }, p, el('button', { title: 'Remove', onclick: () => { pinned = pinned.filter((x) => x !== p); savePinned(); } }, '✕'))));
      if (S.combos.length) pinnedBox.append(el('span', { class: 'hint', style: 'margin:0' }, `Auto-detected combos: ${S.combos.join(', ')}`));
    }
    const pinInput = el('input', { type: 'text', placeholder: 'Type a combo or model name, press Enter', onkeydown: (e) => { if (e.key === 'Enter' && pinInput.value.trim()) { pinned.push(pinInput.value.trim()); pinInput.value = ''; savePinned(); } } });

    async function drawLearned() {
      let data = {};
      try { data = await S.api('GET', '/api/autotune/learned'); } catch {}
      const rows = Object.entries(data);
      learnedBox.replaceChildren(rows.length
        ? el('dl', { class: 'kv' }, rows.flatMap(([ctx, v]) => [el('dt', {}, ctx), el('dd', {}, `👍 ${v.up} · 👎 ${v.down} · offsets ${JSON.stringify(v.offsets)}`)]))
        : el('div', { class: 'hint' }, 'Nothing learned yet. Use 👍 / 👎 under replies in Chat, Reasoning or Coding.'));
    }

    const slug = (t) => 'sec-' + t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const card = (title, desc, ...kids) => el('div', { class: 'card', id: slug(title) }, el('h2', {}, title), el('p', { class: 'desc' }, desc), ...kids);

    const videoPath = el('input', { type: 'text', value: S.config.videoPath });
    const atToggle = el('input', { type: 'checkbox', checked: S.config.autotune.enabled, onchange: async (e) => { S.config = { ...S.config, ...(await S.api('POST', '/api/config', { autotune: { enabled: e.target.checked } })) }; S.toast('AutoTune default: ' + (e.target.checked ? 'on' : 'off') + ' (each chat can still override it)'); } });


    /* ---- web search ---- */
    const sc = S.config.search || {};
    const sProv = el('select', {}, Object.entries(S.config.searchProviders || {}).map(([id, p]) => el('option', { value: id, selected: sc.provider === id }, p.label)));
    const sKey = el('input', { type: 'password', autocomplete: 'off', placeholder: sc.hasKey ? `Saved: ${sc.apiKeyMasked} (leave blank to keep)` : 'API key (not needed for DuckDuckGo / SearXNG)' });
    const sUrl = el('input', { type: 'text', value: sc.url || '', placeholder: 'Only for SearXNG (http://localhost:8080) or a custom endpoint' });
    const sOut = el('div', { class: 'hint' });
    const searchHelp = el('div', { class: 'hint' });
    const helpFor = () => { searchHelp.textContent = ({
      duckduckgo: 'No key needed, but DuckDuckGo may rate-limit you. Fine for trying things out.',
      serper: 'Returns real Google results. Create a key at serper.dev (free trial credits).',
      serpapi: 'Returns real Google results. Create a key at serpapi.com.',
      brave: 'Brave’s own index. Create a key at brave.com/search/api.',
      searxng: 'Your own SearXNG server — can aggregate Google without any key. Put its address in the URL box (JSON output must be enabled).',
    })[sProv.value] || ''; };
    sProv.addEventListener('change', helpFor); helpFor();
    async function saveSearch(test) {
      try {
        const body = { search: { provider: sProv.value, url: sUrl.value } };
        if (sKey.value.trim()) body.search.apiKey = sKey.value.trim();
        S.config = { ...S.config, ...(await S.api('POST', '/api/config', body)) };
        sKey.value = ''; sKey.placeholder = S.config.search.hasKey ? `Saved: ${S.config.search.apiKeyMasked} (leave blank to keep)` : sKey.placeholder;
        if (!test) return S.toast('Search settings saved');
        sOut.style.color = ''; sOut.textContent = 'Searching…';
        const r = await S.api('POST', '/api/search', { query: 'OmniStudio test search', n: 3 });
        sOut.style.color = 'var(--good)'; sOut.textContent = `Works — ${r.results.length} results via ${r.provider}. First: ${r.results[0] ? r.results[0].title : '(none)'}`;
      } catch (e) { sOut.style.color = 'var(--bad)'; sOut.textContent = e.message; }
    }
    const agentCfg = S.config.agent || {};
    const aShell = el('select', {}, [['confirm', 'Ask me before every command (recommended)'], ['off', 'Never run commands'], ['auto', 'Run commands automatically']].map(([v, l]) => el('option', { value: v, selected: agentCfg.shell === v }, l)));
    const aSteps = el('input', { type: 'number', min: '1', max: '100', value: agentCfg.maxSteps });
    const aTime = el('input', { type: 'number', min: '5', max: '600', value: agentCfg.commandTimeoutSec });

    container.append(
      el('div', { class: 'topbar' }, el('h1', {}, 'Settings'), el('span', { class: 'spacer' }), el('div', { class: 'pills' },
        [['Connection', 'OmniRoute connection'], ['Models', 'Default model for each mode'], ['Web search', 'Web search'], ['Computer', 'Computer (agents)'], ['Combos', 'Pinned combos'], ['Video', 'Video endpoint'], ['AutoTune', 'AutoTune'], ['STM', 'STM — semantic transformation modules']]
          .map(([label, title]) => el('button', { onclick: () => { const t = document.getElementById(slug(title)); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, label)))),
      el('div', { class: 'page narrow' }, el('div', { class: 'stack' },
        card('OmniRoute connection', 'OmniStudio talks to your own OmniRoute, so every combo and model you already set up there is available here. Your key is stored only in data/config.json on this computer and is never sent to the browser.',
          el('label', { class: 'field' }, el('span', {}, 'Base URL'), url, el('div', { class: 'hint' }, 'OmniRoute default is http://localhost:20128/v1 — if you type just the address, /v1 is added for you.')),
          el('label', { class: 'field' }, el('span', {}, 'API key'), key),
          el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: saveConnection }, 'Save & test connection'), connStatus)),
        card('Default model for each mode', 'Pick any model or combo. Combos you created in OmniRoute appear in the “Combos & pinned” group.', modelsBox,
          el('button', { class: 'btn sm', onclick: async () => { await S.loadModels(); drawModels(); drawPinned(); flash(S.modelsError || `${S.models.length} models loaded.`, !!S.modelsError); } }, S.iconEl('refresh'), 'Reload model list')),
        card('Web search', 'Used by the 🌐 Web option in chat and by the Computer and Team agents. Google closed its own search API to new customers (it shuts down on 1 Jan 2027), so Google results come through Serper or SerpAPI.',
          el('label', { class: 'field' }, el('span', {}, 'Provider'), sProv, searchHelp), el('label', { class: 'field' }, el('span', {}, 'API key'), sKey), el('label', { class: 'field' }, el('span', {}, 'URL (optional)'), sUrl),
          el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => saveSearch(false) }, 'Save'), el('button', { class: 'btn primary', onclick: () => saveSearch(true) }, 'Save & test search'), sOut)),
        card('Computer (agents)', 'Defaults for the Computer and Team tabs. Commands run as you and are not sandboxed — that is why asking first is the default.',
          el('label', { class: 'field' }, el('span', {}, 'Shell commands'), aShell), el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Max steps per task'), aSteps), el('label', { class: 'field' }, el('span', {}, 'Command time limit (seconds)'), aTime)),
          el('button', { class: 'btn', onclick: async () => { S.config = { ...S.config, ...(await S.api('POST', '/api/config', { agent: { shell: aShell.value, maxSteps: Number(aSteps.value), commandTimeoutSec: Number(aTime.value) } })) }; S.toast('Saved'); } }, 'Save')),
        card('Pinned combos', 'If OmniRoute does not list a combo in /v1/models, type its exact name here to add it to every picker.', pinnedBox, el('div', { style: 'margin-top:10px' }, pinInput)),
        card('Video endpoint', 'Path appended to the base URL for video generation. OmniRoute uses /videos/generations.', el('label', { class: 'field', style: 'margin:0' }, videoPath),
          el('button', { class: 'btn sm', style: 'margin-top:10px', onclick: async () => { S.config = { ...S.config, ...(await S.api('POST', '/api/config', { videoPath: videoPath.value })) }; videoPath.value = S.config.videoPath; S.toast('Video endpoint saved'); } }, 'Save')),
        card('AutoTune', 'Classifies every message and picks temperature, top_p and penalties to match (code → low, creative → high). 👍/👎 on replies teaches it.',
          el('label', { class: 'switch', style: 'margin-bottom:12px' }, atToggle, el('span', {}, 'On by default for new chats')), learnedBox,
          el('button', { class: 'btn sm danger', style: 'margin-top:10px', onclick: async () => { if (await S.confirm('Reset AutoTune learning?', 'All 👍/👎 adjustments are cleared.', 'Reset')) { await S.api('POST', '/api/autotune/reset', {}); drawLearned(); } } }, 'Reset learning')),
        card('STM — semantic transformation modules', 'Post-process replies as they arrive. Applies in Chat, Reasoning, Coding, Builder replies and the Arena. Code blocks are never touched.',
          el('div', { class: 'stm-list' }, STM.list().map((m) => el('label', {}, el('span', { class: 'switch' }, el('input', { type: 'checkbox', checked: S.stmActive().includes(m.id), onchange: async () => {
            const ids = S.$$('.stm-list input').map((i, n) => (i.checked ? STM.list()[n].id : null)).filter(Boolean);
            S.config = { ...S.config, ...(await S.api('POST', '/api/config', { stm: { enabled: ids } })) };
          } })), el('span', {}, el('b', {}, m.name), el('small', {}, m.description)))))),
        card('Appearance & data', 'Everything OmniStudio creates stays on this computer.',
          el('div', { class: 'row', style: 'margin-bottom:12px' }, el('button', { class: 'btn', onclick: () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; S.pref.set('theme', t); } }, 'Toggle light / dark')),
          el('dl', { class: 'kv' }, el('dt', {}, 'Data folder'), el('dd', {}, S.config.dataDir), el('dt', {}, 'Website projects'), el('dd', {}, S.config.dataDir + '/projects'), el('dt', {}, 'Videos'), el('dd', {}, S.config.dataDir + '/outputs/videos'), el('dt', {}, 'Chats'), el('dd', {}, S.config.dataDir + '/chats')))
      )));
    drawModels(); drawPinned(); drawLearned();
  };
})();
