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

  let floor = 2;
  const bar = el('div', 'wowy-bar');
  const inp = el('input', 'ep-input');
  inp.type = 'number'; inp.min = '0'; inp.step = '0.5'; inp.value = String(floor);
  inp.style.width = '72px';
  const note = el('span', 'wl');
  bar.append(el('span', 'wl', 'minimum minutes'), inp, note);
  host.appendChild(bar);

  const wrap = el('div', 'ft-wrap');
  wrap.style.maxHeight = '420px';       // scrollable: a team has dozens of units
  host.appendChild(wrap);

  function names(ids) {
    return ids.map(id => {
      const m = (opts.meta && opts.meta[id]) || {};
      /* surnames only — five full names will not fit a row and the surname is
         what a reader recognises a unit by */
      const n = (m.name || '').trim().split(/\s+/);
      return n.length > 1 ? n[n.length - 1] : (n[0] || '?');
    }).join(' · ');
  }

  function draw() {
    const rows = L.all(stints, floor);
    note.textContent = rows.length + (rows.length === 1 ? ' lineup' : ' lineups');
    wrap.textContent = '';
    if (!rows.length) {
      wrap.appendChild(el('div', 'ft-empty', 'No unit played that long — lower the floor.'));
      return;
    }
    const t = el('table', 'ft');
    const thead = el('thead'), hr = el('tr');
    [['', 'stick c0', 34], ['LINEUP', 'stick c1', 250], ['MIN', '', 58], ['POSS', '', 58],
     ['ORTG', '', 62], ['DRTG', '', 62], ['NET', '', 66], ['eFG%', '', 60],
     ['TOV%', '', 60], ['OREB%', '', 64], ['FTr', '', 56],
     ['OPP eFG%', '', 72], ['OPP TOV%', '', 72], ['OPP OREB%', '', 78]]
      .forEach(([h, c, w]) => {
        const th = el('th', c, h);
        if (!c) th.style.width = w + 'px';
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
      const tr = el('tr');
      tr.appendChild(el('td', 'stick c0', String(i + 1)));
      const nd = el('td', 'stick c1');
      const c = el('div', 'ft-name');
      c.appendChild(el('span', null, names(l.ids)));
      nd.appendChild(c); nd.title = names(l.ids);
      tr.appendChild(nd);
      [f1(l.mins), f1(l.poss), f1(l.ortg), f1(l.drtg)].forEach(v =>
        tr.appendChild(el('td', null, v)));
      const net = el('td', 'lead', sgn(l.net));
      if (l.net != null) net.classList.add(l.net > 0 ? 'pos' : l.net < 0 ? 'neg' : '');
      tr.appendChild(net);
      [f1(l.efg), f1(l.tov), f1(l.oreb), f1(l.ftr),
       f1(l.defg), f1(l.dtov), f1(l.doreb)].forEach(v =>
        tr.appendChild(el('td', null, v)));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
  }

  inp.addEventListener('input', () => {
    floor = parseFloat(inp.value);
    if (!isFinite(floor) || floor < 0) floor = 0;
    draw();
  });
  draw();
}

return { filterPanel, listPanel, statBlock };
}));
