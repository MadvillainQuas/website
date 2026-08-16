'use strict';
/* ============================================================================
   COURTSIDE WOWY — the shared panel.

   With Or Without You. For a player it answers "which teammates make this
   player's minutes better"; for a team it answers "what does the team do with
   and without each player". Both are the same table read from a different
   direction, so they are one component.

   What it shows, and why that and not net rating alone:

     WITH      the team's net rating over the minutes both were on
     WITHOUT   the same player's minutes when that teammate was off
     SWING     with minus without

   The swing is the column that matters. A high net rating next to a star tells
   you the star is good; the swing tells you whether the pairing is worth more
   than the player alone, which is the actual question.

   Sample size is shown, never hidden. A pairing that played four minutes will
   produce a huge swing and mean nothing, so minutes sit beside every row and
   the floor is adjustable rather than fixed and invisible.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideWowy = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const f1 = v => (v == null ? '—' : Number(v).toFixed(1));
const sgn = v => (v == null ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(1));

function cell(v, signed) {
  const td = el('td', null, signed ? sgn(v) : f1(v));
  if (signed && v != null) td.classList.add(v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  return td;
}

/* opts: { host, stints, playerId, meta, minMinutes, href } */
function render(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const L = window.CourtsideLineups;
  host.textContent = '';

  const stints = opts.stints || [];
  if (!stints.length) {
    host.appendChild(el('div', 'empty',
      'No lineup data yet — this fills in as games are finalised.'));
    return;
  }

  let floor = opts.minMinutes == null ? 5 : opts.minMinutes;

  const bar = el('div', 'wowy-bar');
  const lab = el('span', 'wl', 'minimum minutes together');
  const inp = el('input', 'cs-input');
  inp.type = 'number'; inp.min = '0'; inp.value = String(floor);
  inp.style.width = '72px';
  const note = el('span', 'wl');
  bar.append(lab, inp, note);
  host.appendChild(bar);

  const wrap = el('div', 'ft-wrap');
  host.appendChild(wrap);

  function draw() {
    const pairs = L.pairs(stints, opts.playerId, floor);
    note.textContent = pairs.length + (pairs.length === 1 ? ' teammate' : ' teammates');
    wrap.textContent = '';
    if (!pairs.length) {
      wrap.appendChild(el('div', 'ft-empty',
        'No teammate has shared that many minutes yet — lower the floor to see more.'));
      return;
    }

    const t = el('table', 'ft');
    const thead = el('thead'), hr = el('tr');
    [['', 'stick c0'], ['TEAMMATE', 'stick c1'], ['MIN', ''], ['WITH NET', ''],
     ['WITHOUT NET', ''], ['SWING', ''], ['WITH ORTG', ''], ['WITH DRTG', ''],
     ['WITH eFG%', ''], ['OPP eFG%', '']]
      .forEach(([h, c], i) => {
        const th = el('th', c, h);
        if (i >= 2) th.style.width = i === 5 ? '74px' : '68px';
        hr.appendChild(th);
      });
    thead.appendChild(hr); t.appendChild(thead);

    const tb = el('tbody');
    pairs.forEach((p, i) => {
      const m = (opts.meta && opts.meta[p.id]) || {};
      const tr = el('tr');
      tr.appendChild(el('td', 'stick c0', String(i + 1)));

      const nd = el('td', 'stick c1');
      const cellw = el('div', 'ft-name');
      if (m.colour) {
        const cr = el('span', 'ft-crest', (m.teamShort || '').slice(0, 3));
        cr.style.background = m.colour;
        cellw.appendChild(cr);
      }
      const name = m.name || 'Player';
      if (opts.href) { const a = el('a', null, name); a.href = opts.href(p.id); cellw.appendChild(a); }
      else cellw.appendChild(el('span', null, name));
      nd.appendChild(cellw); tr.appendChild(nd);

      tr.appendChild(el('td', null, f1(p.withMate.mins)));
      tr.appendChild(cell(p.withMate.net, true));
      tr.appendChild(cell(p.withoutMate.net, true));
      const sw = cell(p.swing, true); sw.classList.add('lead'); tr.appendChild(sw);
      tr.appendChild(cell(p.withMate.ortg));
      tr.appendChild(cell(p.withMate.drtg));
      tr.appendChild(cell(p.withMate.efg));
      tr.appendChild(cell(p.withMate.defg));
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

/* the player's own on/off, as three tiles above the table */
function onOffTiles(host, stints, playerId) {
  const L = window.CourtsideLineups;
  const h = typeof host === 'string' ? document.querySelector(host) : host;
  if (!h || !stints || !stints.length) return;
  const oo = L.onOff(stints, playerId);
  h.textContent = '';
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
