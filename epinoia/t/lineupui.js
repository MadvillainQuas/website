'use strict';
/* ============================================================================
   The team page's lineup panels.

     THE FILTER   pick any players; see how the team does with all of them on
     THE LIST     every unit that played, longest first

   The filter is the more useful of the two and the less obvious. A five-man
   lineup table answers "which exact unit was good", which for most teams is a
   list of tiny samples. Picking two or three players instead pools every unit
   containing them, which is a sample worth reading — and it is the question a
   coach actually asks: does this pair work.

   Both read summed boxes and derive the rates from those, so a two-possession
   stint cannot outvote a twenty-possession one.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLineupUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const f1 = v => (v == null ? '—' : Number(v).toFixed(1));
const sgn = v => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(1));

function statBlock(line, baseline) {
  const wrap = el('div');

  const tiles = el('div', 'tiles');
  [['minutes', f1(line.mins), false], ['poss', f1(line.poss), false],
   ['ortg', f1(line.ortg), true], ['drtg', f1(line.drtg), false],
   ['net', sgn(line.net), true], ['+/-', (line.pm > 0 ? '+' : '') + line.pm, false]]
    .forEach(([l, v, hi]) => {
      const d = el('div', 'tile' + (hi ? ' hi' : ''));
      d.append(el('div', 'v', v), el('div', 'l', l));
      tiles.appendChild(d);
    });
  wrap.appendChild(tiles);

  /* the four factors at both ends, which is what actually explains the net */
  wrap.appendChild(el('div', 'ffhead', 'four factors on this floor'));
  const grid = el('div', 'ffgrid');
  [['shooting', 'eFG%', line.efg, line.defg, false],
   ['turnovers', 'TOV%', line.tov, line.dtov, true],
   ['rebounding', 'OREB%', line.oreb, line.doreb, false],
   ['free throws', 'FTr', line.ftr, line.dftr, false]]
    .forEach(([label, unit, off, def, lowGood]) => {
      const card = el('div', 'ffcard');
      card.appendChild(el('div', 'ffl', label + ' · ' + unit));
      const pair = el('div', 'ffpair');
      const o = el('div', 'ffside');
      o.append(el('div', 'ffv', f1(off)), el('div', 'ffk', 'own'));
      const d = el('div', 'ffside');
      d.append(el('div', 'ffv', f1(def)), el('div', 'ffk', 'allowed'));
      /* green marks an advantage to this team, never simply the larger number */
      const edge = (off == null || def == null) ? null : (lowGood ? def - off : off - def);
      if (edge != null && Math.abs(edge) >= 0.05) {
        (edge > 0 ? o : d).classList.add(edge > 0 ? 'win' : 'lose');
      }
      pair.append(o, d); card.appendChild(pair);
      grid.appendChild(card);
    });
  wrap.appendChild(grid);

  if (baseline && baseline.net != null && line.net != null) {
    const diff = Math.round((line.net - baseline.net) * 10) / 10;
    const p = el('div', 'lu-note');
    p.textContent = 'The team overall is ' + sgn(baseline.net) + ' net. This selection is ' +
      sgn(line.net) + ', ' + (diff === 0 ? 'the same' :
      (diff > 0 ? '+' + diff.toFixed(1) + ' better' : diff.toFixed(1) + ' worse')) + '.';
    wrap.appendChild(p);
  }
  return wrap;
}

/* ---------------------------------------------------------------- filter --- */
function filterPanel(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const L = window.EpinoiaLineups;
  host.textContent = '';

  const stints = opts.stints || [];
  if (!stints.length) {
    host.appendChild(el('div', 'empty', 'No lineup data yet.'));
    return;
  }

  /* everyone who appears in a stint, most-used first — the order a person
     would look for a name in */
  const mins = new Map();
  stints.forEach(st => {
    (st.player_ids || []).forEach(id =>
      mins.set(id, (mins.get(id) || 0) + ((st.stats && st.stats.dur) || 0)));
  });
  const roster = [...mins.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);

  const picked = new Set();
  const baseline = L.filter(stints, []);

  const chips = el('div', 'lu-chips');
  roster.forEach(id => {
    const m = (opts.meta && opts.meta[id]) || {};
    const b = el('button', 'ep-chip', m.name || 'Player');
    b.type = 'button';
    b.addEventListener('click', () => {
      if (picked.has(id)) picked.delete(id); else picked.add(id);
      b.classList.toggle('on', picked.has(id));
      draw();
    });
    chips.appendChild(b);
  });
  host.appendChild(chips);

  const note = el('div', 'lu-note');
  host.appendChild(note);
  const body = el('div');
  host.appendChild(body);

  function draw() {
    const ids = [...picked];
    const line = L.filter(stints, ids);
    note.textContent = ids.length
      ? line.stints + ' stint' + (line.stints === 1 ? '' : 's') +
        ' with ' + (ids.length === 1 ? 'that player' : 'all ' + ids.length + ' on the floor together')
      : 'No one selected — this is the team over every minute it played. Pick players to narrow it.';
    body.textContent = '';
    if (ids.length && !line.stints) {
      body.appendChild(el('div', 'empty',
        'Those players never shared the floor. Remove one to widen the selection.'));
      return;
    }
    body.appendChild(statBlock(line, ids.length ? baseline : null));
  }
  draw();
}

/* ------------------------------------------------------------------ list --- */
/* THE HEAT SCALE. Every stat column is ranked across the lineups on show, the way the season tables
   rank a column (fulltable.js heatStyle): five bands of green to red about a neutral middle, in
   --good / --amber / --flare (never --lume, which is the club's colour). Direction-aware: `low`
   columns rank in reverse, so a green cell is always the better number. A unit under the minimum
   minutes is not ranked and not coloured at all -- it is dimmed, because thin samples make the
   loudest numbers. The band is a class (kit/lineups.css) so both themes set their own tint. */
const LU_COLS = [
  /* k        head         low    fmt */
  ['net',    'NET',        false, sgn, 'net'],     // first: the gauge to read before the rest
  ['pm',     '+/-',        false, v => (v == null ? '—' : (v > 0 ? '+' : '') + v), 'net'],
  ['ortg',   'ORTG',       false, f1],
  ['drtg',   'DRTG',       true,  f1],
  ['efg',    'eFG%',       false, f1],
  ['tov',    'TOV%',       true,  f1],
  ['oreb',   'OREB%',      false, f1],
  ['ftr',    'FTr',        false, f1],
  ['defg',   'OPP eFG%',   true,  f1],
  ['dtov',   'OPP TOV%',   false, f1],
  ['doreb',  'OPP OREB%',  true,  f1]
];

/* a row's percentile (0-100) in its column: the share of the pool it beats, ties counting half.
   Needs three or more to compare; null otherwise. */
function percentile(v, pool, low) {
  if (v == null || pool.length < 3) return null;
  let worse = 0, tie = 0;
  pool.forEach(x => { if (x === v) tie++; else if (low ? x > v : x < v) worse++; });
  return ((worse + tie / 2 - 0.5) / (pool.length - 1)) * 100;
}
function band(p) {
  if (p == null) return '';
  if (p >= 90) return 'g3';
  if (p >= 75) return 'g2';
  if (p >= 60) return 'g1';
  if (p >= 40) return '';
  if (p >= 25) return 'a1';
  if (p >= 10) return 'r1';
  return 'r2';
}

function listPanel(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const L = window.EpinoiaLineups;
  host.textContent = '';

  const stints = opts.stints || [];
  if (!stints.length) {
    host.appendChild(el('div', 'empty', 'No lineup data yet.'));
    return;
  }

  let floor = opts.floor != null ? opts.floor : 2;
  const bar = el('div', 'wowy-bar');
  const inp = el('input', 'ep-input');
  inp.type = 'number'; inp.min = '0'; inp.step = '0.5'; inp.value = String(floor);
  inp.style.width = '72px';
  inp.setAttribute('aria-label', 'dim lineups under this many minutes');
  const note = el('span', 'wl');
  bar.append(el('span', 'wl', 'dim under (minutes)'), inp, note);
  host.appendChild(bar);

  const wrap = el('div', 'ft-wrap lu-wrap');
  host.appendChild(wrap);
  const legend = el('div', 'lu-legend');
  host.appendChild(legend);

  function names(ids) {
    return ids.map(id => {
      const m = (opts.meta && opts.meta[id]) || {};
      /* surnames only — five full names will not fit a row and the surname is
         what a reader recognises a unit by */
      const n = (m.name || '').trim().split(/\s+/);
      return n.length > 1 ? n[n.length - 1] : (n[0] || '?');
    }).join(' · ');
  }

  function drawLegend(ranked) {
    legend.textContent = '';
    const sw = el('span', 'lu-sw');
    ['r2', 'r1', 'a1', '', 'g1', 'g2', 'g3'].forEach(b => sw.appendChild(el('i', 'lu-h' + (b ? ' ' + b : ''))));
    legend.append(sw, el('span', null,
      'greener = better than the other lineups, redder = worse. Ranked across the ' + ranked +
      ' lineups shown; for TOV%, DRTG and what opponents shot, lower is the green end. ' +
      'NET and +/- are the ones to read first. Faded rows played under ' + floor + ' min and are not coloured.'));
  }

  function draw() {
    const rows = L.all(stints, 0);
    const solid = rows.filter(l => l.mins >= floor);
    note.textContent = rows.length + (rows.length === 1 ? ' lineup' : ' lineups') +
      (solid.length < rows.length ? ' · ' + solid.length + ' ranked' : '');
    wrap.textContent = '';
    if (!rows.length) {
      wrap.appendChild(el('div', 'ft-empty', 'No lineup data yet.'));
      legend.textContent = '';
      return;
    }
    /* the pool each column is ranked in: the lineups that played enough, no others */
    const pools = {};
    LU_COLS.forEach(([k]) => { pools[k] = solid.map(l => l[k]).filter(v => v != null); });

    const t = el('table', 'ft lu-t');
    const thead = el('thead'), hr = el('tr');
    const heads = [['', 'stick c0', 34], ['LINEUP', 'stick c1', 250], ['MIN', '', 52], ['POSS', '', 52]]
      .concat(LU_COLS.map(c => [c[1], c[4] === 'net' ? 'lu-net-h' : '', c[4] === 'net' ? 66 : 62]));
    heads.forEach(([h, c, w]) => {
      const th = el('th', c, h);
      if (!c || c === 'lu-net-h') th.style.width = w + 'px';
      hr.appendChild(th);
    });
    /* THE NAME COLUMN FOLDS ON A TAP, and says so.

       Five surnames is the widest thing here by a distance and on a phone it
       takes most of the screen to repeat something the reader has just read —
       they are comparing units, and after the first glance the numbers are the
       point. The header is the control because it is the column whose width
       changes, and the arrows mark it as a fold rather than a sort. */
    const nameTh = hr.querySelector('th.c1');
    if (nameTh) {
      const fold = el('span', 'fold', '⇤⇥');
      nameTh.appendChild(fold);
      nameTh.title = 'tap to fold the lineup names away and give the numbers the room';
      nameTh.addEventListener('click', () => {
        const on = t.classList.toggle('lu-fold');
        fold.textContent = on ? '⇥⇤' : '⇤⇥';
        nameTh.title = on
          ? 'tap to show the lineup names again'
          : 'tap to fold the lineup names away and give the numbers the room';
      });
    }
    thead.appendChild(hr); t.appendChild(thead);

    const tb = el('tbody');
    rows.forEach((l, i) => {
      const thin = l.mins < floor;
      const tr = el('tr', thin ? 'lu-thin' : '');
      tr.appendChild(el('td', 'stick c0', String(i + 1)));
      const nd = el('td', 'stick c1');
      const c = el('div', 'ft-name');
      c.appendChild(el('span', null, names(l.ids)));
      nd.appendChild(c); nd.title = names(l.ids);
      tr.appendChild(nd);
      tr.appendChild(el('td', null, f1(l.mins)));
      tr.appendChild(el('td', null, f1(l.poss)));
      LU_COLS.forEach(([k, , low, fmt, kind]) => {
        const td = el('td', kind === 'net' ? 'lu-net' : '', fmt(l[k]));
        /* the band is a class; a level or unranked unit gets no class at all (classList.add('')
           throws, and one throw here empties the whole list) */
        const b = thin ? '' : band(percentile(l[k], pools[k], low));
        if (b) td.classList.add('lu-h', b);
        if (kind === 'net' && l[k] > 0) td.classList.add('pos');
        else if (kind === 'net' && l[k] < 0) td.classList.add('neg');
        td.setAttribute('data-k', k);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
    drawLegend(solid.length);
  }

  inp.addEventListener('input', () => {
    floor = parseFloat(inp.value);
    if (!isFinite(floor) || floor < 0) floor = 0;
    draw();
  });
  draw();
}

return { filterPanel, listPanel, statBlock, percentile, band };
}));
