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

/* opts: { host, stints, meta, preselect, max, minMinutes, preview, leagueSlug }

   preview: the members' version is locked (docs/memberships.md), so the matrix
   is capped at CATALOGUE.wowyPreviewMax players through the same MAX that
   already disables the extra chips, with a one-line way to join under the bar.
   The page decides and passes the flag; this file never reads access itself. */
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
  const A = typeof window !== 'undefined' ? window.EpinoiaAccess : null;
  const MAX = opts.preview
    ? ((A && A.CATALOGUE && A.CATALOGUE.wowyPreviewMax) || 1)
    : (opts.max || 4);
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
  /* capped by MAX too, so a preview (MAX 1) never opens holding two; the same two
     as before on every page whose cap is 2 or more */
  if (!picked.length) roster.slice(0, Math.min(2, MAX)).forEach(id => picked.push(id));

  const lead = el('p', 'lu-lead');
  lead.textContent = 'Pick up to ' + MAX + (MAX === 1 ? ' player' : ' players') + '. Each row is one way they ' +
    'shared the floor (together, one without another, or none of them) and how the team played in those ' +
    'minutes. Faded rows are too few minutes to read much into.';
  host.appendChild(lead);

  const chips = el('div', 'lu-chips');
  host.appendChild(chips);

  const bar = el('div', 'wowy-bar');
  const inp = el('input', 'ep-input');
  inp.type = 'number'; inp.min = '0'; inp.step = '0.5'; inp.value = String(floor);
  inp.style.width = '72px';
  const note = el('span', 'wl');
  bar.append(el('span', 'wl', 'dim under (minutes)'), inp, note);
  /* the preview says what the full version is, in one line, where the cap bites */
  if (opts.preview && A && typeof A.teaserHTML === 'function') {
    const tease = el('div', 'wowy-tease');
    tease.style.flex = '1 1 100%';          // its own line under the controls, on every page that hosts the bar
    tease.innerHTML = A.teaserHTML({   // escaped by access.js
      compact: true, leagueSlug: opts.leagueSlug || null,
      title: 'A preview: ' + MAX + (MAX === 1 ? ' player' : ' players') + ' at a time. Members compare up to ' +
             (opts.max || 4) + ' at once.'
    });
    bar.appendChild(tease);
  }
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

    /* THE LINEUP IN WORDS first ("Brakefield + Aita · not Okabe"), so a row can be read without
       decoding the badges; then one badge column per chosen player, then the numbers */
    const shortOf = id => (((opts.meta && opts.meta[id]) || {}).name || '?').trim().split(/\s+/).pop();
    const thd = el('th', 'stick c0w wdesc', 'LINEUP'); thd.style.width = '190px'; hr.appendChild(thd);
    picked.forEach((id, i) => {
      const m = (opts.meta && opts.meta[id]) || {};
      const short = (m.name || '?').trim().split(/\s+/).pop();
      const th = el('th', '', short.toUpperCase());
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

      const onN = picked.filter((id, i) => r.state[i]).map(shortOf);
      const offN = picked.filter((id, i) => !r.state[i]).map(shortOf);
      const words = picked.length === 1
        ? (onN.length ? onN[0] + ' on the floor' : offN[0] + ' off the floor')
        : !onN.length ? (picked.length === 2 ? 'neither of them' : 'none of them')
        : !offN.length ? (picked.length === 2 ? 'both together' : 'all ' + picked.length + ' together')
        : onN.join(' + ') + ' · not ' + offN.join(', ');
      const wd = el('td', 'stick c0w wdesc', words); wd.title = words;
      tr.appendChild(wd);
      r.state.forEach((on, i) => {
        const td = el('td', 'wbc');
        const b = el('span', 'wb ' + (on ? 'on' : 'off'), on ? 'ON' : 'OFF');
        td.appendChild(b);
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
/* A GAP AS IT READS AT A GLANCE (2026-10-02, the player profile's "on the floor with"): the signed difference on a pill,
   green where it is better, red where it is worse and grey where more is only a style, the arrow the way the number
   went; beside it a bar from the centre, right for better and left for worse, full at `scale`. The cell's data-s is how
   big the gap is against the scale (2: half of it or more, 1: less), so a big gain is a deep green and a small one a
   light one, a small loss amber and a big one red: the report's four bands.
   dir: 1 more is better, -1 less is better, 0 neither. kit/onfloor.css. */
function deltaCell(d, dir, scale, dp) {
  const cell = el('div', 'dl-d');
  const small = dp === 2 ? 0.005 : 0.05;
  const tone = d == null || Math.abs(d) < small ? 'nt' : dir === 0 ? 'st' : ((d > 0) === (dir > 0) ? 'gd' : 'bd');
  if (tone === 'gd' || tone === 'bd') cell.setAttribute('data-s', Math.abs(d) >= (scale || 1) / 2 ? '2' : '1');
  const pill = el('span', 'dpill ' + tone);
  pill.appendChild(el('i', null, d == null || Math.abs(d) < small ? '' : d > 0 ? '\u25b2' : '\u25bc'));
  pill.appendChild(document.createTextNode(d == null ? '\u2014' : (Math.abs(d) < small ? '\u00b1' : d > 0 ? '+' : '\u2212') + Math.abs(d).toFixed(dp == null ? 1 : dp)));
  const bar = el('span', 'dbar');
  bar.setAttribute('aria-hidden', 'true');
  if (tone !== 'nt') {
    const w = Math.min(50, 50 * Math.abs(d) / (scale || 1));
    const right = tone === 'gd' || (tone === 'st' && d > 0);
    const i = el('i', tone);
    i.style.width = Math.max(2, w).toFixed(1) + '%';
    i.style.left = (right ? 50 : 50 - Math.max(2, w)).toFixed(1) + '%';
    bar.appendChild(i);
  }
  cell.append(pill, bar);
  return cell;
}

/* THE TEAM WITH HIM ON AND OFF (the player profile, and the player report's "on the floor with"; 2026-10-02 in colour).
   THE HEAD    with him on and with him off, each with its net rating large on a ground coloured by how good it is
               (deep green the team outscores opponents by five or more per 100, light green it outscores them, amber
               it is outscored, red by five or more), its ratings at both ends and its minutes; between them the swing
               (on - off) in a solid colour, its arrow, and a verdict in words; under the three, his share of the minutes.
   THE ROWS    in four groups -- the ratings, the offence's four factors, the defence's four factors (what the opponents
               did), the style -- each figure with him on and off, the better of the two tinted green and the worse red,
               the gap as a pill and a bar (deltaCell). Every figure where less is better (the defensive rating, the
               turnover rate, the opponents' shooting, offensive rebounding and free throws) is turned round, and says
               so ("lower is better"); turnovers forced are better higher; pace is neither. Ratings per 100 possessions. */
const OO_GROUPS = [
  ['rt', 'the ratings', 'points per 100 possessions', [['net', 'net rating', 1, 20], ['ortg', 'offensive rating', 1, 15], ['drtg', 'defensive rating', -1, 15]]],
  ['of', 'offence', 'the four factors, with the ball', [['efg', 'effective fg%', 1, 8], ['ts', 'true shooting %', 1, 8], ['tov', 'turnover %', -1, 6],
    ['oreb', 'offensive rebound %', 1, 10], ['ftr', 'free-throw rate', 1, 10]]],
  ['df', 'defence', 'what the opponents did', [['defg', 'opponents\u2019 effective fg%', -1, 8], ['dtov', 'turnovers forced %', 1, 6],
    ['doreb', 'opponents\u2019 offensive rebound %', -1, 10], ['dftr', 'opponents\u2019 free-throw rate', -1, 10]]],
  ['st', 'style', 'neither better nor worse', [['pace', 'pace', 0, 8]]]
];
const OO_ROWS = OO_GROUPS.flatMap(g => g[3]);
/* a net rating's band: 4 five or more to the good, 3 to the good, 2 behind, 1 five or more behind */
const netBand = v => (v == null ? 0 : v >= 5 ? 4 : v >= 0 ? 3 : v > -5 ? 2 : 1);
/* the swing's verdict: within two points of even it is the same team */
const SWING = [[6, 4, 'much better with him on'], [2, 3, 'better with him on'], [-2, 0, 'about the same either way'], [-6, 2, 'worse with him on'], [-Infinity, 1, 'much worse with him on']];
function onOffTiles(host, stints, playerId) {
  const L = window.EpinoiaLineups;
  const h = typeof host === 'string' ? document.querySelector(host) : host;
  if (!h) return;
  h.textContent = '';
  if (!stints || !stints.length || !playerId) return;
  const oo = L.onOff(stints, playerId);
  const card = el('div', 'oo');
  card.setAttribute('data-i18n-ctx', 'onoff');
  const top = el('div', 'oo-top');
  const side = (cls, label, l) => {
    const s = el('div', 'oo-s ' + cls);
    s.setAttribute('data-b', String(netBand(l.net)));
    const r = el('span', 'oo-r');
    r.append(el('i', null, 'ORTG'), document.createTextNode(f1(l.ortg)), el('i', null, 'DRTG'), document.createTextNode(f1(l.drtg)));
    s.append(el('span', 'oo-k', label), el('b', null, sgn(l.net)), r, el('span', 'oo-m', f1(l.mins) + ' min'));
    return s;
  };
  const d = oo.diff.net;
  const v = d == null ? null : SWING.find(x => d >= x[0]);
  const sw = el('div', 'oo-sw ' + (d == null || Math.abs(d) < 0.05 ? 'nt' : d > 0 ? 'gd' : 'bd'));
  sw.setAttribute('data-b', String(v ? v[1] : 0));
  sw.append(el('span', 'oo-k', 'on\u2013off'), el('b', null, (d > 0 ? '\u25b2 ' : d < 0 ? '\u25bc ' : '') + sgn(d)),
    el('span', 'oo-v', v ? v[2] : 'not enough minutes yet'), el('span', 'oo-m', 'net rating per 100 possessions'));
  top.append(side('on', 'on the floor', oo.on), sw, side('off', 'off the floor', oo.off));
  card.appendChild(top);
  /* his share of the minutes, on against off */
  const tm = (+oo.on.mins || 0) + (+oo.off.mins || 0);
  if (tm > 0) {
    const share = el('div', 'oo-split');
    const part = (cls, label, m) => {
      const p = el('span', cls);
      p.style.flexGrow = String(Math.max(0.0001, m));
      p.append(el('b', null, label), document.createTextNode(' ' + Math.round(100 * m / tm) + '%'));
      return p;
    };
    share.append(part('on', 'on', +oo.on.mins || 0), part('off', 'off', +oo.off.mins || 0));
    card.appendChild(share);
  }
  const grid = el('div', 'dl oo-dl');
  ['', 'on', 'off', 'on \u2212 off'].forEach((t, i) => grid.appendChild(el('div', 'dl-h' + (i ? ' n' : ' l'), t)));
  OO_GROUPS.forEach(([g, name, what, rows]) => {
    const gh = el('div', 'dl-g ' + g);
    gh.append(el('b', null, name), el('span', null, what));
    grid.appendChild(gh);
    rows.forEach(([k, label, dir, scale]) => {
      const on = oo.on[k], off = oo.off[k], dd = on != null && off != null ? on - off : null;
      const lab = el('div', 'dl-l');
      lab.appendChild(el('span', 'dl-t', label));
      if (dir < 0) lab.appendChild(el('em', 'lo', '\u2193 lower is better'));
      /* the better of the two figures green, the worse red: the right way round for a figure where less is better */
      const better = dir === 0 || dd == null || Math.abs(dd) < 0.05 ? 0 : (dd > 0) === (dir > 0) ? 1 : -1;
      const vOn = el('div', 'dl-v' + (better > 0 ? ' w' : better < 0 ? ' l' : ''), f1(on));
      const vOff = el('div', 'dl-v' + (better < 0 ? ' w' : better > 0 ? ' l' : ''), f1(off));
      grid.append(lab, vOn, vOff, deltaCell(dd, dir, scale));
    });
  });
  card.appendChild(grid);
  const key = el('div', 'oo-key');
  [['4', 'much better'], ['3', 'better'], ['2', 'worse'], ['1', 'much worse'], ['9', 'a style']].forEach(([b, t]) => {
    const c = el('span', 'oo-c', t); c.setAttribute('data-b', b); key.appendChild(c);
  });
  key.appendChild(el('span', 'oo-kt', 'for the team with him on the floor'));
  card.appendChild(key);
  card.appendChild(el('div', 'oo-note', 'the team\u2019s numbers in the minutes this player was on the floor and the minutes off it \u00b7 the better of the two figures is green and the worse red, ' +
    'the right way round where less is better (a defensive rating, a turnover rate and what the opponents did) \u00b7 a gap of half its scale or more is a deep green or red'));
  h.appendChild(card);
}

return { render, onOffTiles, deltaCell };
}));
