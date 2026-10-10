'use strict';
/* ============================================================================
   FEATURES (Louie, 2026-10-10): on the many-coloured line under HOME's MAIN / VIDEO / MANAGER strip, a tag that is always
   there - FEATURES - which rolls a panel out of the line, as WHO'S YOUR FAVOURITE? does from its own: what EPINOIA does,
   a card a feature, each opening onto its line of detail.
   ============================================================================ */
(function () {
  const strip = document.getElementById('hmModes');
  if (!strip) return;
  const F = [
    ['◉', 'Live games', 'Live games with granular play-by-play stats in real time.', '../games/'],
    ['▤', 'Profiles', 'Player and team profiles with auto-updated stats and a vast array of game-altering detail, including events, lineup and shot zone stats.', '../scouting/'],
    ['❑', 'News & video', 'Auto-fed news and video from each league, including content creator articles and highlights video available on release.', '../news/'],
    ['▶', 'Watch live', 'Live games with attached box score and storylines pop-up.', '../home/?view=video'],
    ['◎', 'EPINOIA GO', 'A geo-tagging game: gather stamps from the games you attend and compare distances covered worldwide, plus a prediction game with global leaderboards.', '../go/'],
    ['✚', 'Scouting reports', 'Professional-grade automated scouting reports with PDF download and auto-email straight to coaches’ inboxes, and a front office advanced roster analysis model based on thousands of games.', '../scouting/'],
    ['⛉', 'EPINOIA Manager', 'A quasi-fantasy manager game: create your team, set up your tactics and play against the teams in your favourite league, all based on a real analytics model.', '../manager/']
  ];
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const wrap = el('div', 'ft');
  const rule = el('button', 'ft-rule');
  rule.type = 'button';
  rule.setAttribute('aria-expanded', 'false');
  rule.setAttribute('aria-label', 'Features: what EPINOIA does');
  rule.appendChild(el('span', 'ft-tab', 'Features'));
  const panel = el('div', 'ft-panel');
  panel.setAttribute('aria-hidden', 'true');
  panel.inert = true;
  const grid = el('div', 'ft-grid');
  F.forEach(([ic, name, text, href]) => {
    const card = el('div', 'ft-card');
    const head = el('button', 'ft-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    const icon = el('span', 'ft-ic', ic);
    icon.setAttribute('aria-hidden', 'true');
    const chev = el('span', 'ft-chev', '+');
    head.append(icon, el('span', 'ft-name', name), chev);
    const body = el('div', 'ft-body');
    body.hidden = true;
    const go = el('a', 'ft-go', 'open →');
    go.href = href;
    body.append(el('p', null, text), go);
    head.addEventListener('click', () => {
      const open = body.hidden;
      body.hidden = !open;
      card.classList.toggle('on', open);
      head.setAttribute('aria-expanded', String(open));
      chev.textContent = open ? '–' : '+';
    });
    card.append(head, body);
    grid.appendChild(card);
  });
  panel.appendChild(grid);
  rule.addEventListener('click', () => {
    const open = !wrap.classList.contains('on');
    panel.setAttribute('aria-hidden', String(!open));
    panel.inert = !open;
    wrap.classList.toggle('on', open);
    rule.setAttribute('aria-expanded', String(open));
  });
  wrap.append(rule, panel);
  strip.after(wrap);
})();
