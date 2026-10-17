'use strict';
/* Video generation + Arena (multi-model race). */
(function () {
  const { el } = S;

  /* --------------------------------- video --------------------------------- */
  S.views.video = (container) => {
    const prompt = el('textarea', { rows: '4', placeholder: 'Describe the shot: subject, action, camera movement, lighting, mood…' });
    const duration = el('select', {}, ['5', '8', '10', '15'].map((v) => el('option', { value: v }, v + ' seconds')));
    const aspect = el('select', {}, [['16:9', 'Landscape 16:9'], ['9:16', 'Vertical 9:16'], ['1:1', 'Square 1:1']].map(([v, l]) => el('option', { value: v }, l)));
    const gallery = el('div', { class: 'video-grid' });
    const modelSlot = el('span', { style: 'display:block' });
    const genBtn = el('button', { class: 'btn primary' }, 'Generate video');
    const boostBtn = el('button', { class: 'btn', title: 'Ask your chat model to turn a rough idea into a detailed video prompt' }, '✨ Improve prompt');
    let timer = null, videos = [], dead = false;

    const drawModel = () => modelSlot.replaceChildren(S.modelSelect(S.config.modeModels.video, (v) => S.saveModeModel('video', v), { title: 'Video model or combo' }));
    drawModel();
    if (!S.modelsLoaded) S.loadModels().then(drawModel);

    function draw() {
      gallery.replaceChildren();
      if (!videos.length) gallery.append(el('div', { class: 'hint', style: 'grid-column:1/-1' }, 'No videos yet. Videos you generate are saved to your computer in data/outputs/videos.'));
      for (const v of videos) {
        let top;
        if (v.status === 'done' && v.files[0]) top = el('video', { controls: true, preload: 'metadata', src: '/outputs/videos/' + encodeURIComponent(v.files[0].file) });
        else if (v.status === 'error') top = el('div', { class: 'ph', style: 'color:var(--bad)' }, v.error || 'Failed');
        else top = el('div', { class: 'ph' }, el('div', {}, el('div', { class: 'spin' }), v.note || 'Generating… this can take a few minutes'));
        gallery.append(el('div', { class: 'vcard' }, top, el('div', { class: 'b' },
          el('div', { class: 'p', title: v.prompt }, v.prompt),
          el('div', { class: 'row' }, el('span', { class: 'chip' }, v.model), v.params && v.params.duration ? el('span', { class: 'chip' }, v.params.duration + 's') : null, v.params && v.params.aspect_ratio ? el('span', { class: 'chip' }, v.params.aspect_ratio) : null, el('span', { class: 'hint', style: 'margin:0' }, S.ago(v.created))),
          el('div', { class: 'row' },
            v.status === 'done' && v.files[0] ? el('a', { class: 'btn sm', href: '/outputs/videos/' + encodeURIComponent(v.files[0].file), download: v.files[0].file }, S.iconEl('down'), 'Download') : null,
            el('button', { class: 'btn sm', onclick: () => { prompt.value = v.prompt; prompt.focus(); S.toast('Prompt copied into the box'); } }, 'Reuse prompt'),
            el('span', { class: 'spacer' }),
            el('button', { class: 'btn sm ghost danger', onclick: async () => { if (await S.confirm('Delete this video?', 'The file is removed from your computer.', 'Delete')) { await S.api('DELETE', '/api/videos/' + v.id); poll(); } } }, S.iconEl('trash'))))));
      }
    }

    async function poll() {
      if (dead) return;
      try { videos = await S.api('GET', '/api/videos'); } catch {}
      if (dead) return;
      // only redraw when something changed so playing videos are not interrupted
      const sig = JSON.stringify(videos.map((v) => [v.id, v.status, v.note, (v.files[0] || {}).file]));
      if (sig !== poll.sig) { poll.sig = sig; draw(); }
      clearTimeout(timer);
      if (videos.some((v) => v.status === 'running')) timer = setTimeout(poll, 3000);
    }

    genBtn.addEventListener('click', async () => {
      const model = S.config.modeModels.video;
      if (!model) return S.toast('Choose a video model or combo first.', true);
      if (!prompt.value.trim()) return S.toast('Describe the video first.', true);
      genBtn.disabled = true;
      try {
        await S.api('POST', '/api/video', { model, prompt: prompt.value, duration: duration.value, aspect_ratio: aspect.value });
        S.toast('Video job started — it will appear below when ready');
        poll();
      } catch (e) { S.toast(e.message, true); }
      genBtn.disabled = false;
    });

    boostBtn.addEventListener('click', async () => {
      const text = prompt.value.trim();
      const model = S.config.modeModels.chat;
      if (!text) return S.toast('Type a rough idea first.');
      if (!model) return S.toast('Pick a default Chat model in Settings to use this.', true);
      boostBtn.disabled = true; boostBtn.textContent = 'Improving…';
      try {
        const r = await S.api('POST', '/api/chat', { model, stream: false, skills: false, params: { temperature: 0.8 }, messages: [
          { role: 'system', content: 'You write prompts for AI video generators. Rewrite the user idea as ONE detailed prompt (60-110 words): subject, action, setting, camera movement and angle, lighting, colour mood, style. No preamble, no quotes, output only the prompt.' },
          { role: 'user', content: text }] });
        const out = (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content || '').trim();
        if (out) prompt.value = out;
      } catch (e) { S.toast(e.message, true); }
      boostBtn.disabled = false; boostBtn.textContent = '✨ Improve prompt';
    });

    container.append(
      el('div', { class: 'topbar' }, el('h1', {}, 'Video'), el('span', { class: 'sub' }, `Generates through OmniRoute (${S.config.videoPath}) and saves the file on this computer`)),
      el('div', { class: 'page' }, el('div', { class: 'stack' },
        el('div', { class: 'card' },
          el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Video model or combo'), modelSlot), el('div', { class: 'grid2' }, el('label', { class: 'field' }, el('span', {}, 'Length'), duration), el('label', { class: 'field' }, el('span', {}, 'Shape'), aspect))),
          el('label', { class: 'field' }, el('span', {}, 'Prompt'), prompt),
          el('div', { class: 'row' }, genBtn, boostBtn, el('span', { class: 'hint', style: 'margin:0' }, 'Not every provider supports every length or shape — unsupported options are ignored by the provider.'))),
        gallery)));
    poll();
    return () => { dead = true; clearTimeout(timer); };
  };

  /* --------------------------------- arena --------------------------------- */
  S.views.arena = (container) => {
    const selected = new Set(S.pref.get('arena.models', []));
    const prompt = el('textarea', { rows: '4', placeholder: 'One prompt, sent to every selected model or combo at the same time…' });
    const picker = el('div', { class: 'model-pick' });
    const filter = el('input', { type: 'text', placeholder: 'Filter models…' });
    const judgeSlot = el('span', { style: 'display:block' });
    const results = el('div', { class: 'arena-grid' });
    const runBtn = el('button', { class: 'btn primary' }, 'Run race');
    const count = el('span', { class: 'chip accent' });
    let running = false, abort = null, judgeModel = S.config.modeModels.judge || '';

    function drawPicker() {
      const q = filter.value.trim().toLowerCase();
      const { pinned, rest } = S.modelGroups();
      picker.replaceChildren();
      const group = (title, ids) => {
        const shown = ids.filter((id) => !q || id.toLowerCase().includes(q));
        if (!shown.length) return;
        picker.append(el('div', { class: 'grp' }, title));
        for (const id of shown) picker.append(el('label', {}, el('input', { type: 'checkbox', checked: selected.has(id), onchange: (e) => { e.target.checked ? selected.add(id) : selected.delete(id); S.pref.set('arena.models', [...selected]); count.textContent = selected.size + ' selected'; } }), id));
      };
      group('Combos & pinned', pinned); group('All models', rest);
      if (!picker.children.length) picker.append(el('div', { class: 'hint', style: 'padding:8px' }, S.models.length ? 'No match.' : 'No models loaded — check the connection in Settings.'));
      count.textContent = selected.size + ' selected';
    }
    const drawJudge = () => judgeSlot.replaceChildren(S.modelSelect(judgeModel, (v) => { judgeModel = v; S.saveModeModel('judge', v); }, { allowEmpty: true, emptyLabel: 'No judge (heuristic score only)' }));
    drawPicker(); drawJudge();
    if (!S.modelsLoaded) S.loadModels().then(() => { drawPicker(); drawJudge(); });
    filter.addEventListener('input', drawPicker);

    const cards = {};
    function card(index, model) {
      const c = el('div', { class: 'acard' }, el('div', { class: 'h' }, el('b', {}, model), el('span', { class: 'chip' }, 'running…')), el('div', { class: 'c' }, el('div', { class: 'spin' })));
      cards[index] = c; results.append(c); return c;
    }
    function fill(c, r) {
      const h = c.firstChild; h.lastChild.textContent = r.ok ? (r.ms / 1000).toFixed(1) + 's' : 'failed';
      const body = c.children[1]; body.replaceChildren();
      if (!r.ok) { body.append(el('div', { style: 'color:var(--bad)' }, r.error || 'Error')); return; }
      const msg = { content: r.content, reasoning: r.reasoning };
      const { think, answer } = S.splitThink(msg);
      if (think) body.append(el('details', { class: 'think' }, el('summary', {}, 'Thought process'), el('div', { class: 'md', html: S.md(think) })));
      body.append(el('div', { class: 'md', html: S.md(S.display(answer, msg)) }));
      h.append(el('button', { class: 'btn sm ghost', onclick: () => S.copy(S.display(answer, msg)) }, 'Copy'));
    }

    async function run() {
      if (running) { abort && abort.abort(); return; }
      const text = prompt.value.trim();
      if (!text) return S.toast('Write a prompt first.', true);
      if (selected.size < 2) return S.toast('Select at least two models or combos.', true);
      const models = [...selected];
      results.replaceChildren(); Object.keys(cards).forEach((k) => delete cards[k]);
      models.forEach((m, i) => card(i, m));
      running = true; abort = new AbortController(); runBtn.textContent = 'Stop';
      const ranking = [];
      try {
        const resp = await fetch('/api/arena', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
          body: JSON.stringify({ models, judgeModel, messages: [{ role: 'user', content: text }], params: { temperature: 0.7 } }) });
        if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.error || 'Request failed'); }
        const reader = resp.body.getReader(); const dec = new TextDecoder(); let buf = '';
        const handle = (line) => {
          if (!line.trim()) return;
          const ev = JSON.parse(line);
          if (ev.type === 'result') fill(cards[ev.index], ev.result);
          else if (ev.type === 'error') S.toast(ev.error, true);
          else if (ev.type === 'done') {
            ev.ranking.forEach((r, pos) => {
              const c = cards[r.index]; if (!c) return;
              c.classList.toggle('win', pos === 0 && r.ok);
              c.style.order = pos;
              if (!r.ok) return;
              c.firstChild.prepend(el('span', { class: 'score', title: 'Quality score out of 100' }, (pos === 0 ? '🏆 ' : '#' + (pos + 1) + ' ') + r.score));
              const p = r.parts;
              c.append(el('div', { class: 's' }, [['Complete', p.completeness, 25], ['Relevant', p.relevance, 25], ['Structure', p.structure, 20], ['Clean', p.cleanliness, 15], ['Speed', p.speed, 15]].map(([l, v, max]) => el('div', {}, l, el('b', {}, `${v}/${max}`)))));
              if (r.judgeScore !== null) c.append(el('div', { class: 'hint', style: 'padding:0 14px 10px' }, `Judge score: ${r.judgeScore}/10 (blended 50/50 with the heuristic score)`));
            });
            if (ev.judge && ev.judge.error) S.toast('Judge failed: ' + ev.judge.error, true);
          }
        };
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(handle);
        }
        if (buf) handle(buf);
      } catch (e) { if (e.name !== 'AbortError') S.toast(e.message, true); }
      running = false; abort = null; runBtn.textContent = 'Run race';
    }
    runBtn.addEventListener('click', run);
    prompt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); } });

    container.append(
      el('div', { class: 'topbar' }, el('h1', {}, 'Arena'), el('span', { class: 'sub' }, 'Race several models or combos on one prompt and rank the answers (quality, not refusals)')),
      el('div', { class: 'page' }, el('div', { class: 'stack' },
        el('div', { class: 'card' },
          el('label', { class: 'field' }, el('span', {}, 'Prompt (Ctrl+Enter to run)'), prompt),
          el('div', { class: 'grid2' },
            el('div', {}, el('div', { class: 'row', style: 'margin-bottom:5px' }, el('span', { style: 'font-size:12.5px;color:var(--muted)' }, 'Contestants'), count, el('span', { class: 'spacer' }), el('div', { style: 'width:200px' }, filter)), picker),
            el('div', {}, el('label', { class: 'field' }, el('span', {}, 'Judge (optional second opinion)'), judgeSlot),
              el('p', { class: 'hint' }, 'Score = completeness 25 + relevance 25 + structure 20 + cleanliness 15 + speed 15. With a judge model, its 0–10 rating is blended 50/50. Failed models score 0.'),
              runBtn))),
        results)));
    return () => { if (abort) abort.abort(); };
  };
})();
