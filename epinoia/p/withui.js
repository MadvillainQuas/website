'use strict';
/* ============================================================================
   The player profile's "on the floor with" panel.

   Team WOWY asks how the TEAM does with certain players on. This asks what
   THIS PLAYER does when he shares the floor with them — the question index_9's
   profile answers, and the more revealing one about an individual.

   Three columns: with, without, and overall. Per 36 minutes rather than per
   game, because these are slices of games and a per-game average would divide
   by a number of games that does not exist. The difference column is the point;
   everything else is context for it.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWithUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const f1 = v => (v == null ? '—' : Number(v).toFixed(1));
const f2 = v => (v == null ? '—' : Number(v).toFixed(2));
const sgn = (v, d) => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d));

/* the rows of the comparison: label, key, decimals, and which way is better (1 more, -1 fewer, 0 neither: a shot is
   neither, how many he takes is his role), and the gap a full delta bar stands for (a share of the "without" figure for
   a count, points for a percentage) */
const ROWS = [
  ['points / 36',   'pts36',  1, 1,  0.5],
  ['shots / 36',    'fga36',  1, 0,  0.5],
  ['threes / 36',   'p3a36',  1, 0,  0.5],
  ['rebounds / 36', 'reb36',  1, 1,  0.5],
  ['assists / 36',  'ast36',  1, 1,  0.5],
  ['turnovers / 36','tov36',  1, -1, 0.5],
  ['FG%',           'fg_pct', 1, 1,  12],
  ['3P%',           'p3_pct', 1, 1,  15],
  ['FT%',           'ft_pct', 1, 1,  15],
  ['eFG%',          'efg',    1, 1,  12],
  ['TS%',           'ts',     1, 1,  12],
  ['AST / TO',      'ast_to', 2, 1,  1.5]
];
const SHOWN = 10;            // teammates offered before "more"

/* opts: { host, recs, stints, playerId, meta, teammates, locked, leagueSlug }

   locked: the teammate comparison is the members' (docs/memberships.md), so a
   compact line saying so is drawn in its place. The page decides and passes the
   flag; this file never reads the access state itself. Without access.js on the
   page there is nothing to draw the line with, and the comparison is shown —
   analytics fail open.

   2026-10-02: the teammates come most minutes together first, the first ten with the rest a press away, each with the
   minutes the two shared; the comparison is a row a statistic -- with, without, the gap as a delta (wowy.js deltaCell:
   green better, red worse, grey a style, a bar from the centre) and his overall line -- under a head that says whose
   minutes each column is. */
function render(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const W = window.EpinoiaWith, WY = window.EpinoiaWowy;
  host.textContent = '';

  const A = window.EpinoiaAccess;
  if (opts.locked && A && typeof A.teaserHTML === 'function') {
    const tease = el('div', 'with-tease');
    tease.innerHTML = A.teaserHTML({   // escaped by access.js
      compact: true, leagueSlug: opts.leagueSlug || null, peek: 'wowy',
      title: 'This player’s splits with and without each teammate are for members'
    });
    host.appendChild(tease);
    return;
  }

  const recs = opts.recs || [];
  const stints = opts.stints || [];
  if (!recs.length || !stints.length) {
    host.appendChild(el('div', 'empty',
      'No lineup data yet — this fills in as games are finalised.'));
    return;
  }

  const lead = el('p', 'lu-lead');
  lead.textContent = 'Pick one or more teammates to see what this player does when they are ' +
    'on the floor with him, against when none of them are. Per 36 minutes, because ' +
    'these are parts of games rather than whole ones.';
  host.appendChild(lead);

  const picked = [];
  const chips = el('div', 'lu-chips wchips');
  host.appendChild(chips);
  const body = el('div', 'wbody');
  host.appendChild(body);

  /* the minutes each teammate shared with him, most first */
  const shared = new Map();
  (opts.teammates || []).forEach(id => { shared.set(id, W && W.sharedMinutes ? W.sharedMinutes(stints, [opts.playerId, id], []) : 0); });
  const mates = (opts.teammates || []).slice().sort((a, b) => (shared.get(b) || 0) - (shared.get(a) || 0));
  let all = false;
  const drawChips = () => {
    chips.textContent = '';
    mates.forEach((id, i) => {
      if (!all && i >= SHOWN && picked.indexOf(id) === -1) return;
      const m = (opts.meta && opts.meta[id]) || {};
      const b = el('button', 'ep-chip wchip' + (picked.indexOf(id) !== -1 ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', picked.indexOf(id) !== -1 ? 'true' : 'false');
      const nm = el('span', 'wc-n', m.name || 'Player'); nm.setAttribute('translate', 'no');
      b.append(nm, el('span', 'wc-m', Math.round(shared.get(id) || 0) + "'"));
      b.title = Math.round(shared.get(id) || 0) + ' minutes together';
      b.addEventListener('click', () => {
        const j = picked.indexOf(id);
        if (j !== -1) picked.splice(j, 1); else picked.push(id);
        drawChips(); draw();
      });
      chips.appendChild(b);
    });
    if (mates.length > SHOWN) {
      const more = el('button', 'ep-chip wmore', all ? 'fewer' : '+' + (mates.length - SHOWN) + ' more');
      more.type = 'button';
      more.addEventListener('click', () => { all = !all; drawChips(); });
      chips.appendChild(more);
    }
  };
  drawChips();

  function draw() {
    body.textContent = '';
    const sp = W.split(recs, stints, opts.playerId, picked);

    if (!picked.length) {
      body.appendChild(el('div', 'lu-note', 'No teammate picked yet: this player\u2019s own numbers over these games, for reference.'));
      body.appendChild(single(sp.all));
      return;
    }

    const names = picked.map(id => ((opts.meta && opts.meta[id]) || {}).name || 'Player');
    /* a split that never happened must say so rather than print zeros, which
       would read as "he did nothing" instead of "this never occurred" */
    if (!sp.withMates.mins) {
      body.appendChild(el('div', 'empty', 'They never shared the floor.'));
      return;
    }

    const card = el('div', 'wcmp');
    card.setAttribute('data-i18n-ctx', 'onoff');
    const head = el('div', 'wcmp-h');
    const side = (cls, k, who, mins) => {
      const s = el('div', 'wcmp-s ' + cls);
      const w = el('b', null, who); w.setAttribute('translate', 'no');
      s.append(el('span', 'oo-k', k), w, el('span', 'oo-m', f1(mins) + ' min'));
      return s;
    };
    head.append(side('w', 'with', names.join(' + '), sp.withMates.mins),
                side('wo', 'without', names.join(' + '), sp.without.mins));
    card.appendChild(head);
    const grid = el('div', 'dl five');
    ['', 'with', 'without', 'with \u2212 without', 'overall'].forEach((t, i) => grid.appendChild(el('div', 'dl-h' + (i ? ' n' : ' l'), t)));
    ROWS.forEach(([label, key, dp, dir, scale]) => {
      const a = sp.withMates[key], b = sp.without[key], o = sp.all[key];
      const d = (a != null && b != null) ? a - b : null;
      /* a count's gap is read against what he does without them; a percentage's in points */
      const full = scale < 1 ? Math.max(1, Math.abs(b || 0) * scale) : scale;
      const fmt = dp === 2 ? f2 : f1;
      grid.append(el('div', 'dl-l', label), el('div', 'dl-v', fmt(a)), el('div', 'dl-v', fmt(b)),
                  WY && WY.deltaCell ? WY.deltaCell(d, dir, full, dp) : el('div', 'dl-d', sgn(d, dp)), el('div', 'dl-v o', fmt(o)));
    });
    card.appendChild(grid);
    card.appendChild(el('div', 'oo-note', 'this player\u2019s own numbers per 36 minutes, with the teammates picked on the floor against with none of them on' +
      ' \u00b7 green is better, red worse (fewer turnovers are better) \u00b7 grey is only a style: how many shots a player takes is the role'));
    body.appendChild(card);
  }

  function single(l) {
    const grid = el('div', 'tiles wtiles');
    [['min', f1(l.mins)], ['pts/36', f1(l.pts36)], ['fga/36', f1(l.fga36)],
     ['reb/36', f1(l.reb36)], ['ast/36', f1(l.ast36)], ['ts%', f1(l.ts)]]
      .forEach(([lab, v]) => {
        const d = el('div', 'tile');
        d.append(el('div', 'v', v), el('div', 'l', lab));
        grid.appendChild(d);
      });
    return grid;
  }

  draw();
}

return { render };
}));
