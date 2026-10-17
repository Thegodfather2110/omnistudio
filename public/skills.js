'use strict';
/* Skills: .md files that models learn. "By model" = choose what each model/combo knows. "Library" = write and edit the files. */
(function () {
  const { el } = S;

  const readFiles = (files) => Promise.all([...files].map((f) => f.text().then((content) => ({ name: f.name, content }))));

  function pickFiles(onFiles) {
    const inp = el('input', { type: 'file', accept: '.md,.markdown,.txt,text/markdown,text/plain', multiple: true, style: 'display:none' });
    inp.addEventListener('change', async () => { if (inp.files.length) onFiles(await readFiles(inp.files)); inp.remove(); });
    document.body.append(inp);
    inp.click();
  }

  S.views.skills = (container) => {
    let tab = S.pref.get('skills.tab', 'model');
    let skills = [], assign = {}, dir = '';
    let target = S.pref.get('skills.target', '*');
    let editing = null; // skill id, or '' for new
    const body = el('div', { style: 'display:flex;flex-direction:column;flex:1;min-height:0' });

    async function load() {
      try { const r = await S.api('GET', '/api/skills'); skills = r.skills; assign = r.assign; dir = r.dir; } catch (e) { S.toast(e.message, true); }
      draw();
    }

    const tabs = () => el('div', { class: 'tabs' },
      el('button', { class: 'tab' + (tab === 'model' ? ' active' : ''), onclick: () => { tab = 'model'; S.pref.set('skills.tab', tab); draw(); } }, 'By model'),
      el('button', { class: 'tab' + (tab === 'library' ? ' active' : ''), onclick: () => { tab = 'library'; S.pref.set('skills.tab', tab); draw(); } }, `Library (${skills.length})`),
      el('span', { class: 'spacer' }),
      el('span', { class: 'hint', style: 'margin:0', title: dir }, 'Files live in ' + dir));

    function draw() {
      body.replaceChildren(tabs(), tab === 'model' ? byModel() : library());
    }

    /* ------------------------------ by model ------------------------------ */
    function byModel() {
      const filter = el('input', { type: 'text', placeholder: 'Filter models…' });
      const list = el('div');
      const main = el('div', { class: 'main' });
      const { pinned, rest } = S.modelGroups();
      const known = new Set([...pinned, ...rest]);
      const extra = Object.keys(assign).filter((k) => k !== '*' && !known.has(k));

      const row = (id, label) => el('div', { class: 'target' + (target === id ? ' active' : ''), title: id, onclick: () => { target = id; S.pref.set('skills.target', id); draw(); } },
        el('span', { style: 'overflow:hidden;text-overflow:ellipsis' }, label || id), (assign[id] || []).length ? el('span', { class: 'n' }, String(assign[id].length)) : null);

      const drawList = () => {
        const q = filter.value.trim().toLowerCase();
        list.replaceChildren(row('*', '★ Everyone (all models)'));
        const grp = (title, ids) => {
          const shown = ids.filter((id) => !q || id.toLowerCase().includes(q));
          if (!shown.length) return;
          list.append(el('div', { class: 'nav-sep', style: 'padding:10px 8px 3px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint)' }, title));
          shown.forEach((id) => list.append(row(id)));
        };
        grp('Combos & pinned', [...new Set([...pinned, ...extra])]);
        grp('All models', rest);
        if (!S.models.length && !pinned.length) list.append(el('div', { class: 'hint', style: 'padding:8px' }, 'No models loaded yet — check the connection in Settings. You can still teach "Everyone".'));
      };
      filter.addEventListener('input', drawList);
      drawList();

      // ---- right side: the selected target
      const isAll = target === '*';
      const mine = new Set(assign[target] || []);
      const inherited = new Set(isAll ? [] : assign['*'] || []);

      const save = async (ids) => {
        try { assign = (await S.api('PUT', '/api/skills/assign', { target, ids })).assign; draw(); } catch (e) { S.toast(e.message, true); }
      };

      const previewBox = el('div');
      const showPreview = async () => {
        if (previewBox.firstChild) { previewBox.replaceChildren(); return; }
        const r = await S.api('GET', '/api/skills/preview?model=' + encodeURIComponent(isAll ? '' : target));
        previewBox.replaceChildren(r.text
          ? el('div', {}, el('div', { class: 'hint' }, `${r.included.length} loaded, ${r.listed.length} listed by name only · about ${Math.round(r.chars / 4).toLocaleString()} tokens added to every request`), el('div', { class: 'viewer' }, r.text))
          : el('div', { class: 'hint' }, 'No skills yet — nothing is added to this model’s prompt.'));
      };

      const uploadFiles = async (files) => {
        try {
          const r = await S.api('POST', '/api/skills/import', { files, assignTo: target });
          S.toast(`${r.created.length} skill${r.created.length === 1 ? '' : 's'} added to ${isAll ? 'everyone' : target}` + (r.failed.length ? ` · ${r.failed.length} skipped (empty)` : ''), !r.created.length);
          load();
        } catch (e) { S.toast(e.message, true); }
      };
      const upload = () => pickFiles(uploadFiles);

      const writeNew = async () => {
        const name = el('input', { type: 'text', placeholder: 'e.g. How we write SQL' });
        const text = el('textarea', { rows: '9', placeholder: 'Rules, knowledge, examples… Markdown is fine.' });
        const ok = await S.dialog('New skill for ' + (isAll ? 'everyone' : target), [el('label', { class: 'field' }, el('span', {}, 'Name'), name), el('label', { class: 'field' }, el('span', {}, 'Content'), text)],
          [{ label: 'Cancel', value: false }, { label: 'Save & assign', cls: 'primary', value: () => (name.value.trim() && text.value.trim() ? true : null) }]);
        if (!ok) return;
        try { await S.api('POST', '/api/skills', { name: name.value, content: text.value, assignTo: target }); load(); } catch (e) { S.toast(e.message, true); }
      };

      main.append(
        el('div', { class: 'row', style: 'margin-bottom:6px' }, el('h2', { style: 'margin:0;font-size:17px;font-family:var(--mono)' }, isAll ? '★ Everyone' : target), el('span', { class: 'chip accent' }, `${mine.size} skill${mine.size === 1 ? '' : 's'}`)),
        el('p', { class: 'hint', style: 'margin:0 0 14px' }, isAll
          ? 'Skills you tick here are given to every model and combo, on top of their own.'
          : 'This model reads these skills before every reply — in Chat, Builder, Arena, the Computer and Team. Skills from “Everyone” are added automatically. You can also drag .md files onto this page.'),
        el('div', { class: 'row', style: 'margin-bottom:14px' },
          el('button', { class: 'btn primary', onclick: upload }, S.iconEl('plus'), 'Upload .md files'),
          el('button', { class: 'btn', onclick: writeNew }, 'Write a skill'),
          el('button', { class: 'btn', onclick: showPreview }, 'Preview what it sees')),
        previewBox,
        el('div', { class: 'card', style: 'margin-top:12px;padding:6px 16px' }, skills.length
          ? skills.map((s) => {
            const inh = inherited.has(s.id);
            return el('label', { class: 'skill-row' },
              el('input', { type: 'checkbox', checked: mine.has(s.id) || inh, disabled: inh, onchange: (e) => { const next = new Set(mine); e.target.checked ? next.add(s.id) : next.delete(s.id); save([...next]); } }),
              el('span', { style: 'flex:1' }, el('b', { style: 'font-weight:600' }, s.name), inh ? el('span', { class: 'chip', style: 'margin-left:8px' }, 'from Everyone') : null, el('small', {}, s.description || '(no description)'), el('small', { style: 'color:var(--faint)' }, `${s.chars.toLocaleString()} characters`)),
              el('button', { class: 'link', title: 'Open this skill in the library to edit it', onclick: (ev) => { ev.preventDefault(); editing = s.id; tab = 'library'; S.pref.set('skills.tab', tab); draw(); } }, 'Edit'));
          })
          : el('div', { class: 'hint', style: 'padding:14px 0' }, 'No skills yet. Upload .md files or write one — then tick it for this model.')));

      main.classList.add('dropzone');
      const hasFiles = (e) => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
      const over = (e) => { if (hasFiles(e)) { e.preventDefault(); main.classList.add('dropping'); } };
      main.addEventListener('dragenter', over);
      main.addEventListener('dragover', over);
      main.addEventListener('dragleave', (e) => { if (!main.contains(e.relatedTarget)) main.classList.remove('dropping'); });
      main.addEventListener('drop', async (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault(); main.classList.remove('dropping');
        const files = [...e.dataTransfer.files].filter((f) => /\.(md|markdown|txt)$/i.test(f.name));
        if (!files.length) return S.toast('Only .md files can be dropped here.', true);
        uploadFiles(await readFiles(files));
      });
      return el('div', { class: 'split' }, el('div', { class: 'side' }, el('div', { style: 'margin-bottom:8px' }, filter), list), main);
    }

    /* ------------------------------- library ------------------------------- */
    function library() {
      const wrap = el('div', { class: 'split' });
      const side = el('div', { class: 'side' });
      const main = el('div', { class: 'main' });
      side.append(el('div', { class: 'row', style: 'margin-bottom:10px' },
        el('button', { class: 'btn primary sm', onclick: () => { editing = ''; draw(); } }, S.iconEl('plus'), 'New'),
        el('button', { class: 'btn sm', onclick: () => pickFiles(async (files) => { try { const r = await S.api('POST', '/api/skills/import', { files }); S.toast(`${r.created.length} imported`); load(); } catch (e) { S.toast(e.message, true); } }) }, 'Import .md')));
      for (const s of skills) {
        const users = Object.entries(assign).filter(([, ids]) => ids.includes(s.id)).length;
        side.append(el('div', { class: 'target' + (editing === s.id ? ' active' : ''), onclick: () => { editing = s.id; draw(); } }, el('span', { style: 'overflow:hidden;text-overflow:ellipsis;font-family:var(--sans)' }, s.name), users ? el('span', { class: 'n', title: users + ' target(s) use it' }, String(users)) : null));
      }
      if (!skills.length) side.append(el('div', { class: 'hint', style: 'padding:8px' }, 'Empty. Create your first skill.'));

      if (editing === null) {
        main.append(el('div', { class: 'empty', style: 'margin-top:6vh' }, el('h2', {}, 'Skills'), el('p', {}, 'A skill is a Markdown file: rules, knowledge or a checklist that a model should follow. Write one, draft one with AI, or drop in files you already have (Anthropic-style SKILL.md files work as they are).')));
        wrap.append(side, main);
        return wrap;
      }

      const existing = editing ? skills.find((s) => s.id === editing) : null;
      const name = el('input', { type: 'text', value: existing ? existing.name : '', placeholder: 'Skill name' });
      const desc = el('input', { type: 'text', value: existing ? existing.description : '', placeholder: 'One line: when should a model use this?' });
      const text = el('textarea', { rows: '18', spellcheck: 'false', style: 'font-family:var(--mono);font-size:13px', placeholder: '# Rules\n- …' });
      const draftBox = el('input', { type: 'text', style: 'flex:1;min-width:220px', placeholder: 'Or describe a skill and let your chat model draft it…' });
      const draftBtn = el('button', { class: 'btn', onclick: async () => {
        const model = S.config.modeModels.chat;
        if (!model) return S.toast('Choose a default Chat model in Settings first.', true);
        if (!draftBox.value.trim()) return S.toast('Describe the skill first.');
        draftBtn.disabled = true; draftBtn.textContent = 'Drafting…';
        try {
          const r = await S.api('POST', '/api/skills/draft', { model, request: draftBox.value });
          const p = r.content.match(/^---\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
          if (p) { const n = p[1].match(/^name:\s*(.*)$/m), d = p[1].match(/^description:\s*(.*)$/m); if (n) name.value = n[1]; if (d) desc.value = d[1]; text.value = p[2].trim(); } else text.value = r.content;
        } catch (e) { S.toast(e.message, true); }
        draftBtn.disabled = false; draftBtn.textContent = '✨ Draft with AI';
      } }, '✨ Draft with AI');

      const apply = (txt) => { text.value = txt; };
      if (existing) S.api('GET', '/api/skills/' + existing.id).then((full) => apply(full.body)).catch(() => {});

      main.append(
        el('div', { class: 'stack', style: 'max-width:860px' },
          el('div', { class: 'row' }, draftBox, draftBtn),
          el('div', { class: 'grid2' }, el('label', { class: 'field', style: 'margin:0' }, el('span', {}, 'Name'), name), el('label', { class: 'field', style: 'margin:0' }, el('span', {}, 'Description'), desc)),
          el('label', { class: 'field', style: 'margin:0' }, el('span', {}, 'Content (Markdown)'), text),
          el('div', { class: 'row' },
            el('button', { class: 'btn primary', onclick: async () => {
              if (!text.value.trim()) return S.toast('Write some content first.', true);
              try {
                const payload = { name: name.value, description: desc.value, content: text.value };
                const saved = existing ? await S.api('PUT', '/api/skills/' + existing.id, payload) : await S.api('POST', '/api/skills', payload);
                editing = saved.id; S.toast('Saved ' + saved.name); load();
              } catch (e) { S.toast(e.message, true); }
            } }, 'Save'),
            existing ? el('button', { class: 'btn danger', onclick: async () => { if (await S.confirm(`Delete “${existing.name}”?`, 'It is removed from every model that uses it.', 'Delete')) { await S.api('DELETE', '/api/skills/' + existing.id); editing = null; load(); } } }, 'Delete') : null,
            el('span', { class: 'spacer' }),
            el('span', { class: 'hint', style: 'margin:0' }, existing ? `Stored as ${existing.id}.md` : 'Saved as a .md file in the skills folder')),
          existing ? whoLearns(existing) : el('div', { class: 'hint' }, 'Save the skill first, then choose which models and combos learn it.')));
      wrap.append(side, main);
      return wrap;
    }

    /** Checklist of every model/combo (and Everyone) with a switch for "this skill is learned by". */
    function whoLearns(skill) {
      const filter = el('input', { type: 'text', placeholder: 'Filter models…', style: 'margin-bottom:8px' });
      const list = el('div', { class: 'who-learns' });
      const { pinned, rest } = S.modelGroups();
      const extra = Object.keys(assign).filter((k) => k !== '*' && !pinned.includes(k) && !rest.includes(k));
      const has = (t) => (assign[t] || []).includes(skill.id);
      const toggle = async (t, on) => {
        const cur = new Set(assign[t] || []);
        on ? cur.add(skill.id) : cur.delete(skill.id);
        try {
          assign = (await S.api('PUT', '/api/skills/assign', { target: t, ids: [...cur] })).assign;
          S.toast(on ? `${t === '*' ? 'Everyone' : t} now learns “${skill.name}”` : `${t === '*' ? 'Everyone' : t} no longer uses “${skill.name}”`);
        } catch (e) { S.toast(e.message, true); }
        drawWho();
      };
      const drawWho = () => {
        const q = filter.value.trim().toLowerCase();
        list.replaceChildren();
        const row = (id, label) => list.append(el('label', {}, el('input', { type: 'checkbox', checked: has(id), onchange: (e) => toggle(id, e.target.checked) }), label || id));
        row('*', '★ Everyone (all models)');
        const grp = (title, ids) => {
          const shown = ids.filter((id) => !q || id.toLowerCase().includes(q));
          if (!shown.length) return;
          list.append(el('div', { class: 'grp' }, title));
          shown.forEach((id) => row(id));
        };
        grp('Combos & pinned', [...new Set([...pinned, ...extra])]);
        grp('All models', rest);
      };
      filter.addEventListener('input', drawWho);
      drawWho();
      const n = Object.entries(assign).filter(([, ids]) => ids.includes(skill.id)).length;
      return el('div', { class: 'card' }, el('h2', {}, 'Who learns this skill'),
        el('p', { class: 'desc' }, n ? `Used by ${n} target${n === 1 ? '' : 's'} right now. Tick the models and combos that should read it before every reply.` : 'Nobody uses this skill yet. Tick the models and combos that should read it before every reply.'), filter, list);
    }

    container.append(el('div', { class: 'topbar' }, el('h1', {}, 'Skills'), el('span', { class: 'sub' }, 'Teach models and combos your rules and knowledge with plain .md files')), body);
    if (!S.modelsLoaded) S.loadModels().then(draw);
    load();
  };
})();
