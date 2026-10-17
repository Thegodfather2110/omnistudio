'use strict';
/* Boot: load config, build the sidebar, open the last view. */
(async function () {
  const { el } = S;
  try { document.documentElement.dataset.theme = S.pref.get('theme', 'dark'); } catch {}

  const NAV = [
    ['sep', 'Talk'], ['chat', 'Chat'], ['reasoning', 'Reasoning'], ['coding', 'Coding'],
    ['sep', 'Create'], ['builder', 'Websites'], ['rea', 'REA'], ['apps', 'Apps'], ['video', 'Video'],
    ['sep', 'Work'], ['agent', 'Computer'], ['team', 'Team'], ['connectors', 'Connectors'],
    ['sep', 'Compare'], ['arena', 'Arena'],
    ['sep', 'Teach'], ['skills', 'Skills'],
    ['sep', 'Setup'], ['settings', 'Settings'],
  ];
  const nav = S.$('#nav');
  for (const [route, label] of NAV) {
    if (route === 'sep') { nav.append(el('div', { class: 'nav-sep' }, label)); continue; }
    nav.append(el('button', { class: 'nav-item', 'data-route': route, title: label, onclick: () => {
      // leaving the Websites tab always lands on the gallery first
      if (route === 'builder' && S.route === 'builder') S.pref.set('project', '');
      if (route === 'rea' && S.route === 'rea') S.pref.set('rea.project', '');
      if (route === 'apps' && S.route === 'apps') S.pref.set('app.project', '');
      S.go(route);
    } }, S.iconEl(route), el('span', {}, label)));
  }
  S.$('#status').addEventListener('click', () => S.go('settings'));

  try {
    S.config = await S.api('GET', '/api/config');
  } catch (e) {
    S.$('#view').append(el('div', { class: 'page' }, el('div', { class: 'banner bad' }, 'Cannot reach the OmniStudio server: ' + e.message)));
    return;
  }

  const first = !S.config.hasKey;
  const saved = S.pref.get('route', 'chat');
  S.go(first ? 'settings' : S.views[saved] ? saved : 'chat');
  S.loadModels().then(async () => { if (await S.applyStarterModels()) S.go(S.route); });
})();
