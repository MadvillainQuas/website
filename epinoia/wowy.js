'use strict';
/* ============================================================================
   EPINOIA WOWY — the combination matrix.

   Modelled on index_9's WOWY: choose players, and every ON/OFF arrangement of
   them is aggregated separately. Three players gives eight rows — all on, each
   pair without the third, each alone, none — and the row that turns out to be
   interesting is usually one nobody would have thought to ask for.

   The badges are the point. A table of net ratings tells you which lineup was
   good; a grid of ON and OFF tells you WHO the rating belongs to, at a glance,
   without reading five surnames per row.

   Sample size is never hidden. A combination that played ninety seconds will
   show a spectacular rating and mean nothing, so minutes and possessions sit on
   every row and anything under the floor is dimmed rather than dropped —
   dropping it would hide that the arrangement happened at all.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaWowy = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const f1 = v => (v == null ? '—' : Number(v).toFixed(1));
const sgn = v => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(1));

function num(v, signed) {
  const td = el('td', null, signed ? sgn(v) : f1(v));
  if (signed && v != null && v !== 0) td.classList.add(v > 0 ? 'pos' : 'neg');
  return td;
}

/* opts: { host, stints, meta, preselect, max, minMinutes } */
function render(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const L = window.EpinoiaLineups;
  host.textContent = '';

  const stints = opts.stints || [];
  if (!stints.length) {
    host.appendChild(el('div', 'empty', 'No lineup data yet — this fills in as games are finalised.'));
    return;
  }
  const MAX = opts.max || 4;
  let floor = opts.minMinutes == null ? 2 : opts.minMinutes;

  /* everyone who appears, most-used first — the order a person looks for a name */
  const mins = new Map();
  stints.forEach(st => (st.player_ids || []).forEach(id =>
    mins.set(id, (mins.get(id) || 0) + ((st.stats && st.stats.dur) || 0))));
  const roster = [...mins.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);

  const picked = [];
  (opts.preselect || []).forEach(id => {
    if (picked.length < MAX && roster.indexOf(id) !== -1) picked.push(id);
  });
  if (!picked.length) roster.slice(0, 2).forEach(id => picked.push(id));

  const lead = el('p', 'lu-lead');
  lead.textContent = 'Choose up to ' + MAX + ' players. Every combination of them being ' +
    'on or off the floor is worked out separately, so you can see what the team does ' +
    'with a pairing, with one of them, and with neither.';
  host.appendChild(lead);

  const chips = el('div', 'lu-chips');
  host.appendChild(chips);

  const bar = el('div', 'wowy-bar');
  const inp = el('input', 'ep-input');
  inp.type = 'number'; inp.min = '0'; inp.step = '0.5'; inp.value = String(floor);
  inp.style.width = '72px';
  const note = el('span', 'wl');
  bar.append(el('span', 'wl', 'dim under (minutes)'), inp, note);
  host.appendChild(bar);

  const wrap = el('div', 'ft-wrap');
  host.appendChild(wrap);

  function drawChips() {
    chips.textContent = '';
    roster.forEach(id => {
      const m = (opts.meta && opts.meta[id]) || {};
      const on = picked.indexOf(id) !== -1;
      const b = el('button', 'ep-chip' + (on ? ' on' : ''), m.name || 'Player');
      b.type = 'button';
      if (!on && picked.length >= MAX) b.disabled = true;
      b.addEventListener('click', () => {
        const i = picked.indexOf(id);
        if (i !== -1) picked.splice(i, 1);
        else if (picked.length < MAX) picked.push(id);
        drawChips(); draw();
      });
      chips.appendChild(b);
    });
  }

  function draw() {
    wrap.textContent = '';
    if (!picked.length) {
      note.textContent = '';
      wrap.appendChild(el('div', 'ft-empty', 'Pick a player to begin.'));
      return;
    }
    const rows = L.matrix(stints, picked);
    const played = rows.filter(r => r.stints > 0);
    note.textContent = played.length + ' of ' + rows.length + ' combinations played';

    const t = el('table', 'ft');
    const thead = el('thead'), hr = el('tr');

    /* one badge column per chosen player, then the numbers */
    picked.forEach((id, i) => {
      const m = (opts.meta && opts.meta[id]) || {};
      const short = (m.name || '?').trim().split(/\s+/).pop();
      const th = el('th', i === 0 ? 'stick c0w' : '', short.toUpperCase());
      th.style.width = '84px';
      th.title = m.name || '';
      hr.appendChild(th);
    });
    [['MIN', 58], ['POSS', 58], ['ORTG', 62], ['DRTG', 62], ['NET', 66],
     ['eFG%', 60], ['TOV%', 60], ['OREB%', 64], ['FTr', 56],
     ['OPP eFG%', 74], ['OPP TOV%', 74], ['OPP OREB%', 80]]
      .forEach(([h, w]) => { const th = el('th', null, h); th.style.width = w + 'px'; hr.appendChild(th); });
    thead.appendChild(hr); t.appendChild(thead);

    const tb = el('tbody');
    rows.forEach(r => {
      const tr = el('tr');
      /* An arrangement that never happened is still worth a row: "these three
         were never on together" is a finding, not a gap. */
      if (!r.stints) tr.classList.add('none');
      else if (r.mins < floor) tr.classList.add('thin');

      r.state.forEach((on, i) => {
        const td = el('td', i === 0 ? 'stick c0w' : '');
        td.appendChild(el('span', 'wb ' + (on ? 'on' : 'off'), on ? 'ON' : 'OFF'));
        tr.appendChild(td);
      });

      if (!r.stints) {
        const td = el('td', 'novalue', 'never shared the floor');
        td.colSpan = 12;
        tr.appendChild(td);
      } else {
        tr.appendChild(el('td', null, f1(r.mins)));
        tr.appendChild(el('td', null, f1(r.poss)));
        tr.appendChild(num(r.ortg));
        tr.appendChild(num(r.drtg));
        const net = num(r.net, true); net.classList.add('lead'); tr.appendChild(net);
        [r.efg, r.tov, r.oreb, r.ftr, r.defg, r.dtov, r.doreb]
          .forEach(v => tr.appendChild(num(v)));
      }
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

  drawChips();
  draw();
}

/* one player against every minute they were not on the floor */
function onOffTiles(host, stints, playerId) {
  const L = window.EpinoiaLineups;
  const h = typeof host === 'string' ? document.querySelector(host) : host;
  if (!h) return;
  h.textContent = '';
  if (!stints || !stints.length || !playerId) return;
  const oo = L.onOff(stints, playerId);
  const grid = el('div', 'tiles');
  [['on court net', sgn(oo.on.net), true],
   ['off court net', sgn(oo.off.net), false],
   ['on–off', sgn(oo.diff.net), true],
   ['on ortg', f1(oo.on.ortg), false],
   ['on drtg', f1(oo.on.drtg), false],
   ['minutes on', f1(oo.on.mins), false]]
    .forEach(([l, v, hi]) => {
      const d = el('div', 'tile' + (hi ? ' hi' : ''));
      d.append(el('div', 'v', v), el('div', 'l', l));
      grid.appendChild(d);
    });
  h.appendChild(grid);
}

return { render, onOffTiles };
}));
