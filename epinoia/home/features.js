'use strict';
/* ============================================================================
   FEATURES (Louie, 2026-10-10): on the many-coloured line under HOME's MAIN / VIDEO / MANAGER strip, a tag that is always
   there - FEATURES - which rolls a panel out of the line, as WHO'S YOUR FAVOURITE? does from its own: what EPINOIA does,
   a card a feature, each opening onto its line of detail.
   ============================================================================ */
(function () {
  const strip = document.getElementById('hmModes');
  if (!strip) return;
  /* the cards are epinoia/help.js's (the strip's ? pop-up shows the same ones), their links relative to epinoia/ */
  const H = window.EpinoiaHelp;
  if (!H) return;
  const F = H.FEATURES.map(([ic, name, text, href]) =>
    [ic, name, text, Array.isArray(href) ? href.map(([l, to]) => [l, '../' + to]) : '../' + href]);
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
    body.append(el('p', null, text));
    (Array.isArray(href) ? href : [['open →', href]]).forEach(([label, to]) => { const go = el('a', 'ft-go', label); go.href = to; body.appendChild(go); });
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
