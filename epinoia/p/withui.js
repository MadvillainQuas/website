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

/* the rows of the comparison, and how each is read */
const ROWS = [
  ['minutes',      'mins',   1, false],
  ['points / 36',  'pts36',  1, true],
  ['shots / 36',   'fga36',  1, true],
  ['threes / 36',  'p3a36',  1, true],
  ['rebounds / 36','reb36',  1, true],
  ['assists / 36', 'ast36',  1, true],
  ['turnovers / 36','tov36', 1, false],
  ['FG%',          'fg_pct', 1, true],
  ['3P%',          'p3_pct', 1, true],
  ['FT%',          'ft_pct', 1, true],
  ['eFG%',         'efg',    1, true],
  ['TS%',          'ts',     1, true],
  ['AST / TO',     'ast_to', 2, true]
];

/* opts: { host, recs, stints, playerId, meta, teammates } */
function render(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const W = window.EpinoiaWith;
  host.textContent = '';

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
  const chips = el('div', 'lu-chips');
  host.appendChild(chips);
  const body = el('div');
  host.appendChild(body);

  (opts.teammates || []).forEach(id => {
    const m = (opts.meta && opts.meta[id]) || {};
    const b = el('button', 'ep-chip', m.name || 'Player');
    b.type = 'button';
    b.addEventListener('click', () => {
      const i = picked.indexOf(id);
      if (i !== -1) picked.splice(i, 1); else picked.push(id);
      b.classList.toggle('on', picked.indexOf(id) !== -1);
      draw();
    });
    chips.appendChild(b);
  });

  function draw() {
    body.textContent = '';
    const sp = W.split(recs, stints, opts.playerId, picked);

    if (!picked.length) {
      body.appendChild(el('div', 'lu-note',
        'No teammate selected — pick one above. Overall is shown for reference.'));
      body.appendChild(single(sp.all));
      return;
    }

    const names = picked.map(id => ((opts.meta && opts.meta[id]) || {}).name || 'Player');
    body.appendChild(el('div', 'lu-note',
      'With ' + names.join(' and ') + ' on the floor, against with ' +
      (picked.length === 1 ? 'them' : 'none of them') + ' on.'));

    /* a split that never happened must say so rather than print zeros, which
       would read as "he did nothing" instead of "this never occurred" */
    if (!sp.withMates.mins) {
      body.appendChild(el('div', 'empty',
        'They never shared the floor.'));
      return;
    }

    const wrap = el('div', 'ft-wrap');
    const t = el('table', 'ft with-tbl');
    const thead = el('thead'), hr = el('tr');
    [['', 'stick c1', 150], ['WITH', '', 84], ['WITHOUT', '', 84],
     ['DIFF', '', 84], ['OVERALL', '', 84]]
      .forEach(([h, c, w]) => {
        const th = el('th', c, h); th.style.width = w + 'px'; hr.appendChild(th);
      });
    thead.appendChild(hr); t.appendChild(thead);

    const tb = el('tbody');
    ROWS.forEach(([label, key, dp, higherBetter]) => {
      const a = sp.withMates[key], b = sp.without[key], o = sp.all[key];
      const tr = el('tr');
      const nd = el('td', 'stick c1');
      nd.appendChild(el('div', 'ft-name', label));
      tr.appendChild(nd);
      tr.appendChild(el('td', null, dp === 2 ? f2(a) : f1(a)));
      tr.appendChild(el('td', null, dp === 2 ? f2(b) : f1(b)));

      const d = (a != null && b != null) ? a - b : null;
      const dtd = el('td', 'lead', d == null ? '—' : sgn(d, dp));
      /* colour by whether the difference is good for the player, not by sign:
         more turnovers is a bigger number and a worse outcome */
      if (d != null && Math.abs(d) > 0.05 && key !== 'mins') {
        const good = higherBetter ? d > 0 : d < 0;
        dtd.classList.add(good ? 'pos' : 'neg');
      }
      tr.appendChild(dtd);
      tr.appendChild(el('td', null, dp === 2 ? f2(o) : f1(o)));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    body.appendChild(wrap);
  }

  function single(l) {
    const grid = el('div', 'tiles');
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
