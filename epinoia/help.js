'use strict';
/* ============================================================================
   HOW EPINOIA WORKS (Louie, 2026-10-16): "on that strip, can there always be a neon question mark in the colour of the
   text that pops up the 'features' segment on home but in a digestible pop-up explaining how to use the site?"

   window.EpinoiaHelp = { FEATURES, open(root) }
     FEATURES   HOME's FEATURES cards (home/features.js draws them from here, so the two never say different things):
                [icon, name, text, href | [[label, href], ...]] with every href relative to epinoia/
     open(root) the pop-up - getting around in a few lines, then the same cards - over whatever page is open.
                root = the page's way back to epinoia/ ('../', './'), as nav.js has it.

   Loaded by home/index.html (for the cards), and by nav.js only when the strip's ? is first pressed: nobody who never
   asks pays for it. The pop-up is a <dialog>, so Esc, focus and the top layer are the browser's.
   ============================================================================ */
(function () {
  if (window.EpinoiaHelp) return;

  const FEATURES = [
    ['◉', 'Live games', 'Live games with granular play-by-play stats in real time.', 'games/'],
    ['▤', 'Profiles', 'Player and team profiles with auto-updated stats and a vast array of game-altering detail, including events, lineup and shot zone stats.', [['see an example: London Lions →', 't/?t=london-lions']]],
    /* Louie, 2026-10-16 */
    ['★', 'Following', 'Follow your favourite players and teams, with notifications sent direct to your phone (editable on Personalisation in Your Hub). All players can be tracked on Your Dashboard, which shows their most recent performances and links to their player page.', [['Your Dashboard →', 'profile/'], ['Personalisation →', 'me/']]],
    ['❑', 'News & video', 'Auto-fed news and video from each league, including content creator articles and highlights video available on release.', [['news →', 'news/'], ['video →', 'home/?view=video']]],
    ['▶', 'Watch live', 'Live games with attached box score and storylines pop-up.', 'home/?view=video'],
    ['◎', 'EPINOIA GO', 'A geo-tagging game: gather stamps from the games you attend and compare distances covered worldwide, plus a prediction game with global leaderboards.', 'go/'],
    ['✚', 'Scouting reports', 'Professional-grade automated scouting reports with PDF download and auto-email straight to coaches’ inboxes, and a front office advanced roster analysis model based on thousands of games.', [['see an example: London Lions →', 't/?t=london-lions']]],
    ['⛉', 'EPINOIA Manager', 'A quasi-fantasy manager game: create your team, set up your tactics and play against the teams in your favourite league, all based on a real analytics model.', 'manager/']
  ];

  /* getting around: one line each, in the words the site's own buttons use */
  const STEPS = [
    ['☰', 'The menu', 'Everything starts in the menu on the left (☰ on a phone): pick a league, then its fixtures, statistics, table and teams.'],
    ['Λ', 'Back to HOME', 'Click EPINOIΛ at the top left of any page to come back to HOME.'],
    ['⌕', 'Search', 'Press / (or SEARCH BAR in the menu) to find any player, club or league.'],
    ['▦', 'Games', 'Open a game for its box score, play-by-play, shot charts and lineups - the tabs across the top switch between them.'],
    ['▤', 'Profiles', 'Click a player or a club to open their profile: stats that update after every game, lineups, shot zones and scouting reports.'],
    ['◈', 'Follow', 'FOLLOW a club, a player or a league for game alerts; Your Dashboard (in YOUR HUB) shows their latest games.'],
    ['Aあ', 'Languages', 'Switch between English, 日本語 and Español at the foot of the menu.']
  ];

  const CSS = `
.hp-dlg{--hp-z:1;width:min(740px,calc((100vw - 32px) / var(--hp-z)));max-height:min(calc(86vh / var(--hp-z)),860px);padding:0;border:1px solid rgba(63,240,255,.55);border-radius:14px;
  background:#050706;color:#f2f6f4;box-shadow:0 0 0 1px #000,0 0 28px rgba(63,240,255,.22),0 24px 60px rgba(0,0,0,.6);overflow:hidden}
.hp-dlg[open]{display:flex;flex-direction:column;animation:hp-in .2s ease both}
.hp-dlg::backdrop{background:rgba(3,6,5,.62);backdrop-filter:blur(3px)}
@keyframes hp-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}
.hp-top{flex:none;display:flex;align-items:center;gap:10px;padding:10px 12px 9px 16px;border-bottom:1px solid rgba(242,246,244,.14);
  font:10px/1.2 var(--f-micro,monospace);letter-spacing:.08em;text-transform:uppercase;color:#3ff0ff}
.hp-top .hp-wm{padding:3px 8px 2px;font-size:12px;background:linear-gradient(100deg,#93f2bf,#8ff5ff);color:#04100b}
.hp-top .hp-t{flex:1;min-width:0}
.hp-x{flex:none;width:30px;height:30px;display:grid;place-items:center;padding:0;border:1px solid rgba(242,246,244,.25);border-radius:50%;
  background:transparent;color:#f2f6f4;font-size:16px;line-height:1;cursor:pointer}
.hp-x:hover,.hp-x:focus-visible{border-color:#3ff0ff;color:#3ff0ff}
.hp-body{overflow:auto;overscroll-behavior:contain;padding:18px 18px 22px}
.hp-h{margin:0 0 10px;font:600 10px/1.3 var(--f-micro,monospace);letter-spacing:.14em;text-transform:uppercase;color:#ffe44d}
.hp-h + .hp-lede{margin-top:-4px}
.hp-lede{margin:0 0 14px;font-size:13.5px;line-height:1.5;color:rgba(242,246,244,.72)}
.hp-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:8px;margin:0 0 24px;padding:0;list-style:none}
.hp-step{display:flex;gap:12px;align-items:flex-start;padding:11px 12px;border:1px solid rgba(242,246,244,.14);border-radius:12px;background:#101614}
.hp-ic{flex:none;width:30px;height:30px;display:grid;place-items:center;border-radius:9px;font-size:14px;font-weight:700;color:#050706;
  background:linear-gradient(100deg,#93f2bf,#8ff5ff)}
.hp-step b{display:block;margin:1px 0 3px;font:600 10px/1.3 var(--f-micro,monospace);letter-spacing:.1em;text-transform:uppercase}
.hp-step .hp-tx{display:block;font-size:13.5px;line-height:1.45;color:rgba(242,246,244,.84)}
.hp-feats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;align-items:start}
.hp-card{border:1px solid rgba(242,246,244,.14);border-radius:12px;background:#101614;overflow:hidden}
.hp-card.on,.hp-card:hover{border-color:#93f2bf}
.hp-head{display:flex;align-items:center;gap:10px;width:100%;padding:10px 12px;border:0;background:transparent;color:inherit;cursor:pointer;text-align:left}
.hp-name{flex:1;font:600 10px/1.3 var(--f-micro,monospace);letter-spacing:.1em;text-transform:uppercase}
.hp-chev{font-size:16px;color:#ffe44d}
.hp-more{padding:0 12px 12px}
.hp-more p{margin:0 0 8px;font-size:13px;line-height:1.5;color:rgba(242,246,244,.82)}
.hp-go{display:inline-block;margin-right:14px;font:600 10px/1.4 var(--f-micro,monospace);letter-spacing:.1em;text-transform:uppercase;color:#93f2bf;text-decoration:none}
.hp-go:hover{color:#3ff0ff}
@media (max-width:560px){
  .hp-dlg{width:calc((100vw - 16px) / var(--hp-z));max-height:calc((100dvh - 24px) / var(--hp-z))}
  .hp-body{padding:14px 12px 18px}
  .hp-steps{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){.hp-dlg[open]{animation:none}}`;

  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

  let dlg = null, opener = null;

  function build(root) {
    if (!document.getElementById('hp-css')) {
      const st = el('style');
      st.id = 'hp-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    dlg = el('dialog', 'hp-dlg');
    dlg.setAttribute('aria-labelledby', 'hp-title');

    const top = el('div', 'hp-top');
    const wm = el('span', 'hp-wm epinoia-mark', 'EPINOIΛ');
    wm.setAttribute('translate', 'no');
    const title = el('span', 'hp-t', 'How it works');
    title.id = 'hp-title';
    const x = el('button', 'hp-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => dlg.close());
    top.append(wm, title, x);

    const body = el('div', 'hp-body');
    body.append(el('h2', 'hp-h', 'Getting around'));
    const steps = el('ul', 'hp-steps');
    STEPS.forEach(([ic, name, text]) => {
      const li = el('li', 'hp-step');
      const i = el('span', 'hp-ic', ic);
      i.setAttribute('aria-hidden', 'true');
      const t = el('div');
      t.append(el('b', null, name), el('span', 'hp-tx', text));
      li.append(i, t);
      steps.appendChild(li);
    });
    body.append(steps, el('h2', 'hp-h', 'What’s on EPINOIΛ'), el('p', 'hp-lede', 'Open a card for what it does and where to find it.'));

    const feats = el('div', 'hp-feats');
    FEATURES.forEach(([ic, name, text, href]) => {
      const card = el('div', 'hp-card');
      const head = el('button', 'hp-head');
      head.type = 'button';
      head.setAttribute('aria-expanded', 'false');
      const i = el('span', 'hp-ic', ic);
      i.setAttribute('aria-hidden', 'true');
      const chev = el('span', 'hp-chev', '+');
      chev.setAttribute('aria-hidden', 'true');
      head.append(i, el('span', 'hp-name', name), chev);
      const more = el('div', 'hp-more');
      more.hidden = true;
      more.appendChild(el('p', null, text));
      (Array.isArray(href) ? href : [['open →', href]]).forEach(([label, to]) => {
        const a = el('a', 'hp-go', label);
        a.href = root + to;
        more.appendChild(a);
      });
      head.addEventListener('click', () => {
        const open = more.hidden;
        more.hidden = !open;
        card.classList.toggle('on', open);
        head.setAttribute('aria-expanded', String(open));
        chev.textContent = open ? '–' : '+';
      });
      card.append(head, more);
      feats.appendChild(card);
    });
    body.appendChild(feats);

    dlg.append(top, body);
    /* a click on the dim around the box closes it (the dialog's own box is the click target there) */
    dlg.addEventListener('click', e => {
      if (e.target !== dlg) return;
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
    dlg.addEventListener('close', () => { if (opener && opener.focus) opener.focus(); });
    document.body.appendChild(dlg);
  }

  function open(root) {
    opener = document.activeElement;
    if (!dlg) build(root == null ? '../' : root);
    if (dlg.open) return;
    /* the page's body is zoomed on a wide screen (epinoia-kit.css: 1.25, 1.5), and the box with it: its vw/vh limits
       are divided back by that zoom, or a box sized to 86vh stood 1.5 times taller than the window */
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    dlg.style.setProperty('--hp-z', String(z));
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    const x = dlg.querySelector('.hp-x');
    if (x) x.focus();
  }

  window.EpinoiaHelp = { FEATURES, open };
})();
