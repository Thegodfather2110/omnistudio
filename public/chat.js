'use strict';
/* Chat, Reasoning and Coding views (one implementation, three modes) + the shared message component. */
(function () {
  const { el, esc } = S;

  const MODES = {
    chat: {
      title: 'Chat', sub: 'Everyday conversation with any model or combo',
      system: 'You are a helpful, clear and honest assistant. Answer directly and accurately. Use Markdown when it helps readability.',
      suggestions: ['Explain how HTTP caching works, with a simple example', 'Draft a friendly follow-up email to a client who has gone quiet', 'Give me 10 name ideas for a local delivery startup', 'Summarise the pros and cons of SQLite vs Postgres'],
    },
    reasoning: {
      title: 'Reasoning', sub: 'Slow, careful thinking for hard problems — thinking is shown separately',
      system: 'You are a careful analytical thinker. Work through the problem step by step, check your work for mistakes, and then give a clear final answer at the end under the heading "Answer".',
      suggestions: ['A bat and a ball cost $1.10 in total and the bat costs $1 more than the ball. What does the ball cost? Show your checking.', 'Plan a 3-month roadmap for launching a small SaaS with one developer — what do I cut first and why?', 'Prove that the square root of 2 is irrational', 'I have 3 job offers with different pay, growth and commute. Help me build a decision framework'],
      effort: 'medium',
    },
    coding: {
      title: 'Coding', sub: 'Software engineering help — low-temperature, complete working code',
      system: 'You are a senior software engineer. Write correct, complete, runnable code in fenced code blocks tagged with the language. Prefer simple solutions, handle errors, and note any assumptions. Briefly explain the approach and how to run or test it. When debugging, identify the root cause first, then show the fix.',
      suggestions: ['Write a Python script that watches a folder and renames new files by date', 'Review this regex for validating Indian mobile numbers and improve it', 'Create a Node.js Express REST API for a todo list with validation', 'Explain this error: TypeError: Cannot read properties of undefined (reading "map")'],
    },
  };

  const NO_MODEL = 'No model chosen yet. Pick a model or combo in the box above the message field (or in Settings).';

  /* -------------------- one message (used by chat + builder) -------------------- */
  S.msgEl = (msg, o = {}) => {
    const root = el('div', { class: 'msg ' + msg.role + (msg.error ? ' error' : '') });
    const who = el('div', { class: 'who' }, msg.role === 'user' ? 'You' : (msg.meta && msg.meta.model) || 'Assistant');
    const bubble = el('div', { class: 'bubble' });
    const foot = el('div', { class: 'foot' });
    root.append(who, bubble, foot);

    let thinkEl = null, thinkBody = null, answerEl = null, toolsEl = null, errEl = null;

    root.update = (streaming) => {
      if (msg.role === 'user') { bubble.textContent = typeof msg.content === 'string' ? msg.content : ''; return; }
      if (msg.meta && msg.meta.runId && !toolsEl) buildTrace(streaming);
      if (msg.error) {
        if (!toolsEl) { bubble.textContent = msg.content; return; }
        if (!errEl) { errEl = el('div'); bubble.append(errEl); } // keep the connector activity visible next to the error
        errEl.textContent = msg.content;
        return;
      }
      const { think, answer } = S.splitThink(msg);
      if (think) {
        if (!thinkEl) {
          thinkEl = el('details', { class: 'think' }, el('summary', {}, 'Thinking'), (thinkBody = el('div', { class: 'md' })));
          bubble.prepend(thinkEl);
          if (streaming) thinkEl.open = true;
        }
        thinkBody.innerHTML = S.md(think);
        thinkEl.firstChild.textContent = streaming && !answer ? 'Thinking…' : 'Thought process';
        if (streaming && answer && thinkEl.dataset.closed !== '1') { thinkEl.open = false; thinkEl.dataset.closed = '1'; }
      }
      if (!answerEl) { answerEl = el('div', { class: 'md' }); bubble.append(answerEl); }
      const shown = S.display(answer, msg);
      answerEl.innerHTML = shown ? S.md(shown, { collapseFiles: o.collapseFiles }) : '';
      answerEl.classList.toggle('cursor', !!streaming);
      if (streaming && !shown && !think) answerEl.innerHTML = '<span class="chip">Waiting for the model…</span>';
      renderFoot(streaming);
    };

    /** The connector activity (tool calls, approvals, results) of this reply, loaded from the run log. */
    function buildTrace(streaming) {
      const tl = S.timeline(msg.meta.runId, {});
      const sum = el('summary', {}, 'Connector activity');
      toolsEl = el('details', { class: 'think conn-trace' }, sum, tl.root);
      if (streaming) toolsEl.open = true;
      bubble.prepend(toolsEl);
      let calls = 0;
      S.pollRun(msg.meta.runId, (v) => {
        for (const ev of v.events) {
          if (ev.type === 'final' || ev.type === 'end') continue; // the answer itself is shown below
          if (ev.type === 'tool' && ev.name !== 'describe_tool') calls++;
          tl.add(ev);
        }
        sum.textContent = calls ? `Used connectors · ${calls} tool call${calls === 1 ? '' : 's'}` : 'Connector activity';
        if ((v.pending || []).length) toolsEl.open = true;
      });
    }

    function renderFoot(streaming) {
      foot.replaceChildren();
      if (msg.role !== 'assistant' || streaming || msg.error) return;
      const m = msg.meta || {};
      if (m.tune) {
        const p = m.tune.params || {};
        foot.append(el('span', { class: 'chip accent tune-chip', title: `AutoTune detected "${m.tune.label}" (confidence ${m.tune.confidence}). Parameters: ${JSON.stringify(p)}` }, `AutoTune · ${m.tune.label} · temp ${p.temperature}`));
      } else if (m.params && m.params.temperature !== undefined) {
        foot.append(el('span', { class: 'chip' }, `temp ${m.params.temperature}`));
      }
      if (m.skills && m.skills.length) foot.append(el('span', { class: 'chip accent', title: m.skills.join(', ') }, `Skills · ${m.skills.length}`));
      if (m.ms) foot.append(el('span', {}, (m.ms / 1000).toFixed(1) + 's'));
      if (m.tokens) foot.append(el('span', {}, m.tokens + ' tokens'));
      if (m.finish === 'length') foot.append(el('span', { class: 'chip', style: 'color:var(--warn)' }, 'cut off (max tokens)'));
      if (m.sources && m.sources.length) foot.append(el('div', { class: 'sources' }, el('span', {}, 'Sources:'), m.sources.map((s) => el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.title }, `[${s.n}] ${s.title.slice(0, 40)}`))));
      const btn = (label, title, fn, cls = '') => foot.append(el('button', { class: 'btn sm ghost ' + cls, title, onclick: fn }, label));
      btn('Copy', 'Copy the reply', () => S.copy(S.display(S.splitThink(msg).answer, msg)));
      if (S.stmActive().length && S.display(msg.content, { showRaw: false }) !== msg.content) {
        btn(msg.showRaw ? 'Show STM' : 'Show original', 'Toggle STM transforms on this reply', () => { msg.showRaw = !msg.showRaw; root.update(false); });
      }
      if (o.onRate && m.tune) {
        const rated = m.rating;
        btn('👍', 'Good reply — teach AutoTune to favour these settings', () => o.onRate(msg, 'up', root), rated === 'up' ? 'rated' : '');
        btn('👎', 'Poor reply — nudge AutoTune away from these settings', () => o.onRate(msg, 'down', root), rated === 'down' ? 'rated' : '');
      }
      if (o.isLast && o.onRegen) btn('↻ Regenerate', 'Ask again', () => o.onRegen());
    }

    root.update(!!o.streaming);
    return root;
  };

  /* ---------------------------------- view --------------------------------- */
  function chatView(mode) {
    return (container) => {
      const M = MODES[mode];
      const st = (S.chatState[mode] ||= { chat: null, list: [], busy: false, abort: null });
      const tuneKey = 'tune.' + mode;
      const tune = Object.assign(
        { auto: S.config.autotune.enabled, temperature: 0.7, top_p: 1, max_tokens: '', effort: M.effort || '', system: '', web: false },
        S.pref.get(tuneKey, {})
      );
      const saveTune = () => S.pref.set(tuneKey, tune);

      const listEl = el('div', { class: 'items' });
      const messagesEl = el('div', { class: 'messages' });
      const input = el('textarea', { rows: '1', placeholder: mode === 'coding' ? 'Describe the code you need, or paste an error…' : mode === 'reasoning' ? 'Ask something that needs careful thinking…' : 'Message the model…' });
      const sendBtn = el('button', { class: 'btn primary', title: 'Send (Enter)' });
      const modelSlot = el('span');
      const conn = S.connectorPicker(mode);
      let nodes = [];

      const newChat = () => {
        st.chat = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), mode, title: 'New chat', model: '', messages: [], created: Date.now() };
        renderMessages(); renderList(); input.focus();
      };
      const refreshList = async () => { try { st.list = await S.api('GET', `/api/chats?mode=${mode}`); } catch {} renderList(); };
      const save = async () => {
        if (!st.chat.messages.length) return;
        try { await S.api('PUT', '/api/chats/' + st.chat.id, st.chat); } catch (e) { S.toast('Could not save chat: ' + e.message, true); }
        refreshList();
      };

      function renderList() {
        listEl.replaceChildren();
        const items = st.list.slice();
        if (st.chat && st.chat.messages.length && !items.some((c) => c.id === st.chat.id)) items.unshift({ id: st.chat.id, title: st.chat.title });
        if (!items.length) listEl.append(el('div', { class: 'hint', style: 'padding:8px 10px' }, 'Your saved chats appear here.'));
        for (const c of items) {
          listEl.append(el('div', { class: 'chat-item' + (st.chat && st.chat.id === c.id ? ' active' : ''), onclick: () => openChat(c.id) },
            el('span', { class: 't', title: c.title }, c.title),
            el('button', { class: 'x', title: 'Delete chat', onclick: async (e) => { e.stopPropagation(); if (!(await S.confirm('Delete this chat?', c.title, 'Delete'))) return; await S.api('DELETE', '/api/chats/' + c.id); if (st.chat && st.chat.id === c.id) newChat(); refreshList(); } }, '✕')));
        }
      }

      async function openChat(id) {
        if (st.busy) return S.toast('Wait for the current reply (or press Stop) before switching chats.');
        try { st.chat = await S.api('GET', '/api/chats/' + id); renderMessages(); renderList(); } catch (e) { S.toast(e.message, true); }
      }

      function renderMessages() {
        messagesEl.replaceChildren();
        nodes = [];
        const msgs = st.chat.messages;
        if (!msgs.length) {
          messagesEl.append(el('div', { class: 'empty' },
            el('div', { html: `<svg viewBox="0 0 24 24" width="40" height="40" style="stroke:var(--accent);fill:none;stroke-width:1.6">${S.icon(mode).replace(/<svg[^>]*>|<\/svg>/g, '')}</svg>` }),
            el('h2', {}, M.title), el('p', {}, M.sub),
            el('div', { class: 'suggest' }, M.suggestions.map((s) => el('button', { onclick: () => { input.value = s; input.dispatchEvent(new Event('input')); input.focus(); } }, s)))));
          return;
        }
        msgs.forEach((m, i) => addNode(m, i === msgs.length - 1));
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      const onRate = async (msg, rating, node) => {
        try {
          await S.api('POST', '/api/autotune/feedback', { context: msg.meta.tune.context, rating, params: msg.meta.tune.params });
          msg.meta.rating = rating; node.update(false); save();
          S.toast(rating === 'up' ? 'AutoTune will lean toward these settings' : 'AutoTune will move away from these settings');
        } catch (e) { S.toast(e.message, true); }
      };

      function addNode(msg, isLast, streaming) {
        const node = S.msgEl(msg, { streaming, isLast, onRegen: regenerate, onRate });
        messagesEl.append(node);
        nodes.push(node);
        return node;
      }

      function setBusy(b) {
        st.busy = b;
        sendBtn.replaceChildren(S.iconEl(b ? 'stop' : 'send'), b ? 'Stop' : 'Send');
        sendBtn.classList.toggle('danger', b);
      }

      async function buildParams(text) {
        const params = {};
        let tuneInfo = null;
        if (tune.auto) {
          try { tuneInfo = await S.api('POST', '/api/autotune', { text, mode }); Object.assign(params, tuneInfo.params); } catch {}
        }
        if (!tuneInfo) { params.temperature = Number(tune.temperature); params.top_p = Number(tune.top_p); }
        if (tune.max_tokens) params.max_tokens = Number(tune.max_tokens);
        if (tune.effort) params.reasoning_effort = tune.effort;
        return { params, tuneInfo };
      }

      async function run(userText) {
        const model = S.config.modeModels[mode];
        if (!model) return S.toast(NO_MODEL, true);
        const chat = st.chat;
        if (!chat.messages.length) { chat.title = userText.replace(/\s+/g, ' ').slice(0, 52); chat.model = model; }
        const { params, tuneInfo } = await buildParams(userText);
        const msg = { role: 'assistant', content: '', reasoning: '', meta: { model, params, tune: tuneInfo } };
        chat.messages.push(msg);
        renderMessages();
        const node = nodes[nodes.length - 1];
        node.remove(); nodes.pop();
        const live = addNode(msg, true, true);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        const history = chat.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));
        const system = (tune.system || '').trim() || M.system;
        st.abort = new AbortController();
        setBusy(true);
        const t0 = Date.now();
        const stick = () => { if (messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140) messagesEl.scrollTop = messagesEl.scrollHeight; };
        try {
          const connIds = conn.ids();
          if (connIds.length) {
            // this message may use connector tools: the server runs the tool loop, we follow it
            const cr = await S.runConnectors({
              model, text: userText, history: history.slice(0, -1), system, params, connectors: connIds, signal: st.abort.signal,
              onStart: (runId) => { msg.meta.runId = runId; msg.meta.connectors = connIds; live.update(true); stick(); },
            });
            msg.content = cr.content; msg.reasoning = '';
            msg.meta.ms = Date.now() - t0;
            msg.meta.tokens = Math.round(cr.content.length / 4);
          } else {
          const r = await S.streamChat({
            model, messages: [{ role: 'system', content: system }, ...history], params, signal: st.abort.signal, web: tune.web,
            onUpdate: (res) => { msg.content = res.content; msg.reasoning = res.reasoning; live.update(true); stick(); },
          });
          msg.content = r.content; msg.reasoning = r.reasoning;
          msg.meta.ms = Date.now() - t0; msg.meta.finish = r.finish;
          if (r.omni) { msg.meta.skills = r.omni.skills; msg.meta.sources = r.omni.sources; if (r.omni.webError) S.toast('Web search failed: ' + r.omni.webError, true); }
          msg.meta.tokens = r.usage ? r.usage.completion_tokens || r.usage.total_tokens : Math.round((r.content.length + r.reasoning.length) / 4);
          if (!r.content && !r.reasoning) { msg.error = true; msg.content = 'The model returned an empty reply.'; }
          }
        } catch (e) {
          if (e.name === 'AbortError') { msg.meta.ms = Date.now() - t0; if (!msg.content && !msg.reasoning) { chat.messages.pop(); } }
          else if (e.name === 'Stopped') { msg.meta.ms = Date.now() - t0; msg.content = 'Stopped before finishing. The connector activity above shows what happened.'; }
          else { msg.error = true; msg.content = e.message; }
        } finally {
          setBusy(false); st.abort = null;
        }
        renderMessages();
        save();
      }


      async function submit() {
        if (st.busy) { st.abort && st.abort.abort(); return; }
        const text = input.value.trim();
        if (!text) return;
        if (!S.config.modeModels[mode]) return S.toast(NO_MODEL, true);
        input.value = ''; input.dispatchEvent(new Event('input'));
        st.chat.messages.push({ role: 'user', content: text });
        await run(text);
      }

      async function regenerate() {
        if (st.busy) return;
        const msgs = st.chat.messages;
        if (msgs.length && msgs[msgs.length - 1].role === 'assistant') msgs.pop();
        const lastUser = [...msgs].reverse().find((m) => m.role === 'user');
        if (!lastUser) return;
        await run(lastUser.content);
      }

      /* ---- composer tools ---- */
      const range = (label, key, min, max, step) => {
        const out = el('output', {}, String(tune[key]));
        const inp = el('input', { type: 'range', min, max, step, value: tune[key], oninput: () => { tune[key] = Number(inp.value); out.textContent = inp.value; saveTune(); } });
        return el('div', { class: 'range-row' }, el('span', {}, label), inp, out);
      };
      const tunePanel = el('div', { class: 'pop-panel' });
      const buildTunePanel = () => {
        tunePanel.replaceChildren(
          el('h4', {}, 'Generation settings'),
          el('label', { class: 'switch', style: 'margin-bottom:10px' }, el('input', { type: 'checkbox', checked: tune.auto, onchange: (e) => { tune.auto = e.target.checked; saveTune(); buildTunePanel(); } }), el('span', {}, 'AutoTune (pick settings per message)')),
          el('label', { class: 'switch', style: 'margin-bottom:10px;display:flex' }, el('input', { type: 'checkbox', checked: tune.web, onchange: (e) => { tune.web = e.target.checked; saveTune(); webBtn(); } }), el('span', {}, 'Search the web for each message')),
          tune.auto
            ? el('p', { class: 'hint', style: 'margin:0 0 10px' }, 'Each message is classified (code, creative, reasoning…) and temperature / top_p / penalties are chosen to match. Use 👍/👎 on replies to teach it.')
            : el('div', {}, range('Temperature', 'temperature', 0, 2, 0.05), range('Top-p', 'top_p', 0.1, 1, 0.05)),
          el('label', { class: 'field' }, el('span', {}, 'Thinking effort (sent as reasoning_effort)'),
            el('select', { onchange: (e) => { tune.effort = e.target.value; saveTune(); } }, ['', 'low', 'medium', 'high'].map((v) => el('option', { value: v, selected: tune.effort === v }, v || 'off / model default')))),
          el('label', { class: 'field' }, el('span', {}, 'Max tokens (blank = model default)'), el('input', { type: 'number', min: '1', value: tune.max_tokens, placeholder: 'e.g. 4096', oninput: (e) => { tune.max_tokens = e.target.value; saveTune(); } })),
          el('label', { class: 'field', style: 'margin-bottom:0' }, el('span', {}, `System prompt (blank = default ${M.title.toLowerCase()} prompt)`), el('textarea', { rows: '4', placeholder: M.system, oninput: (e) => { tune.system = e.target.value; saveTune(); } }, tune.system))
        );
      };
      buildTunePanel();
      const webBtnEl = el('button', { class: 'btn sm', onclick: () => {
        tune.web = !tune.web; saveTune(); webBtn(); buildTunePanel();
        const sp = (S.config.search || {}).provider;
        if (tune.web) S.toast(sp === 'duckduckgo' || !sp ? 'Web search is on (DuckDuckGo, no key). For real Google results add a Serper or SerpAPI key in Settings → Web search.' : `Web search is on (${sp}). Replies will cite their sources.`);
      } }, '🌐 Web');
      const webBtn = () => { webBtnEl.classList.toggle('on', !!tune.web); webBtnEl.title = tune.web ? 'Web search is ON for each message (click to turn off)' : 'Click to let the model search the web before answering'; };
      webBtn();
      const tuneBtn = el('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); tunePop.classList.toggle('open'); stmPop.classList.remove('open'); } }, S.iconEl('sliders'), el('span', {}, 'Settings'));
      const tunePop = el('div', { class: 'pop' }, tuneBtn, tunePanel);

      const stmPanel = el('div', { class: 'pop-panel' });
      const stmBtn = el('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); stmPop.classList.toggle('open'); tunePop.classList.remove('open'); } });
      const stmPop = el('div', { class: 'pop' }, stmBtn, stmPanel);
      const buildStm = () => {
        const active = S.stmActive();
        stmBtn.textContent = active.length ? `STM · ${active.length} on` : 'STM · off';
        stmPanel.replaceChildren(el('h4', {}, 'Semantic transformation modules'), el('p', { class: 'hint', style: 'margin:0 0 8px' }, 'Clean up replies after they arrive. Code blocks are never changed.'),
          ...STM.list().map((m) => el('label', { class: 'switch', style: 'display:flex;margin:6px 0', title: m.description },
            el('input', { type: 'checkbox', checked: active.includes(m.id), onchange: async (e) => {
              const next = new Set(S.stmActive()); e.target.checked ? next.add(m.id) : next.delete(m.id);
              S.config = { ...S.config, ...(await S.api('POST', '/api/config', { stm: { enabled: [...next] } })) };
              buildStm(); nodes.forEach((n) => n.update(false));
            } }), el('span', {}, el('b', { style: 'font-weight:600' }, m.name), el('small', { style: 'display:block;color:var(--muted)' }, m.description)))));
      };
      buildStm();
      const closePops = () => { tunePop.classList.remove('open'); stmPop.classList.remove('open'); };
      document.addEventListener('click', (e) => { if (!e.target.closest('.pop')) closePops(); });

      const renderModelSlot = () => modelSlot.replaceChildren(S.modelSelect(S.config.modeModels[mode], (v) => S.saveModeModel(mode, v), { title: `Model for ${M.title}` }));
      renderModelSlot();

      sendBtn.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });
      S.autoGrow(input);
      setBusy(st.busy);

      container.append(
        el('div', { class: 'topbar' }, el('h1', {}, M.title), el('span', { class: 'sub' }, M.sub)),
        el('div', { class: 'chat-wrap' },
          el('div', { class: 'chat-list' }, el('div', { class: 'head' }, el('button', { class: 'btn', style: 'width:100%;justify-content:center', onclick: newChat }, S.iconEl('plus'), 'New chat')), listEl),
          el('div', { class: 'chat-main' }, messagesEl,
            el('div', { class: 'composer' }, el('div', { class: 'composer-inner' },
              el('div', { class: 'tools' }, modelSlot, tunePop, stmPop, webBtnEl, conn.node, el('span', { class: 'hint', style: 'margin:0' }, 'Enter to send · Shift+Enter for a new line')),
              el('div', { class: 'box' }, input, sendBtn))))));

      if (!st.chat) newChat(); else { renderMessages(); renderList(); }
      refreshList();
      if (!S.modelsLoaded) S.loadModels().then(renderModelSlot);
      return () => { document.removeEventListener('click', closePops); conn.destroy(); };
    };
  }

  S.views.chat = chatView('chat');
  S.views.reasoning = chatView('reasoning');
  S.views.coding = chatView('coding');
})();
