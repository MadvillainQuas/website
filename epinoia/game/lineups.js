'use strict';
/* ============================================================================
   THE LINEUPS TAB (game page): who shared the floor, and what happened while they did.

     5-MAN / 3-MAN / 2-MAN   the fives, or every trio and pair inside them (boxscore.js lineupCombos): the
                             question a coach asks is as often "how did these two go together" as "which five"
     MINUTES                 all, 2+ or 5+ - a lineup that played ninety seconds has a net rating of anything
     WITH A PLAYER           only the groups one player was in
     SORT                    any column, highest first; again for lowest first
     FOUR FACTORS            the eight detail columns, on request; the default is the few that fit a phone

   THE TABLE IS READ IN FOUR GROUPS (2026-09-30), each under a band of its own: BASIC (min, +/-, pts, poss),
   RATINGS (net, ortg, drtg), FOUR FACTORS (ours, in the club's colour) and OPP FOUR FACTORS (theirs, in the
   opponent's). Fifteen columns in one undifferentiated band made a reader count cells to find drtg.

   A ROW IS A CARD, the way the traditional box score's rows are (cards.js box): the names in the sticky first
   cell with each number in the club's colour, a thin bar for the group's share of the game under them.

   EVERY FIGURE IS SHADED, cell by cell, not the row:
     * a rate (ortg, drtg, the eight factors) against the TEAM'S OWN NUMBER FOR THE GAME, the reference row
       at the foot: green where the group did better than the team did, red worse, darker the further off,
       the scale being the widest gap in that column of this table (with a floor, so a column of near-equal
       numbers is not painted as if they differed). Lower is the better end for drtg, tov%, opp efg%,
       orb allowed and opp ft rate (LOWER);
     * +/- and net around 0;
     * min, pts and poss are volumes, not verdicts: a quiet shade of the club's colour, deeper for more.
   A stint under two minutes is not shaded at all: its rates are noise, so it is greyed like a DNP line.

   The five's own boxes are the only input, so every number here agrees with the old tab's for the fives.
   Nothing is remembered but the reader's choices (size, minutes, four factors), in localStorage.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLineups = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const KEY = 'epinoia_lineups';
const SIZES = [[5, '5-man'], [3, '3-man'], [2, '2-man']];
const MINS = [[0, 'all'], [120000, '2+ min'], [300000, '5+ min']];
const SHORT_STINT = 120000;           // under two minutes together: greyed and never shaded
/* lower is the better end */
const LOWER = { drtg: 1, tovp: 1, oefg: 1, oreba: 1, oftr: 1 };
/* the column groups: key, label, detail-only, columns [key, label, title, decimals, kind]
   kind: 'div' shaded around the team's game number, 'zero' around 0, 'vol' a volume */
const GROUPS = [
  { k: 'basic', l: 'basic', detail: false, cols: [
    ['dur', 'min', 'minutes together', null, 'vol'],
    ['pm', '+/-', 'points margin while together', 0, 'zero'],
    ['pts', 'pts', 'points scored – points allowed', null, 'vol'],
    ['poss', 'poss', 'possessions', 1, 'vol']] },
  { k: 'rtg', l: 'ratings', detail: false, cols: [
    ['net', 'net', 'net rating: ortg − drtg', 1, 'zero'],
    ['ortg', 'ortg', 'points scored per 100 possessions', 1, 'div'],
    ['drtg', 'drtg', 'points allowed per 100 possessions', 1, 'div']] },
  { k: 'ff', l: 'four factors', detail: true, cols: [
    ['efg', 'efg%', 'effective field goal %', 1, 'div'],
    ['tovp', 'tov%', 'turnovers per 100 plays', 1, 'div'],
    ['orebp', 'orb%', 'offensive rebound %', 1, 'div'],
    ['ftr', 'ft rate', 'free throws attempted per 100 field goal attempts', 0, 'div']] },
  { k: 'opp', l: 'opp four factors', detail: true, cols: [
    ['oefg', 'opp efg%', 'the opponent’s effective field goal %', 1, 'div'],
    ['tovf', 'tov forced', 'opponent turnovers per 100 of their plays', 1, 'div'],
    ['oreba', 'orb allowed', 'the opponent’s offensive rebound %', 1, 'div'],
    ['oftr', 'opp ft rate', 'the opponent’s free throw rate', 0, 'div']] }
];
const COLS = GROUPS.reduce((a, g) => a.concat(g.cols.map(c => ({ k: c[0], l: c[1], title: c[2], dec: c[3], kind: c[4], g: g.k, detail: g.detail }))), []);
/* the smallest gap a column's darkest shade stands for: without it, a column whose numbers barely differ
   would be painted as if they did */
const FLOOR = { pm: 3, net: 8, ortg: 8, drtg: 8, efg: 4, tovp: 4, orebp: 6, ftr: 8, oefg: 4, tovf: 4, oreba: 6, oftr: 8 };

let state = load();
let lastD = null;

function load() {
  const s = { size: 5, min: 0, players: { 0: '', 1: '' }, sort: 'dur', dir: -1, detail: false };
  try {
    const v = JSON.parse(root.localStorage && root.localStorage.getItem(KEY) || 'null');
    if (v && typeof v === 'object') {
      if ([5, 3, 2].includes(v.size)) s.size = v.size;
      if (MINS.some(m => m[0] === v.min)) s.min = v.min;
      s.detail = !!v.detail;
    }
  } catch (_) { /* a browser that keeps nothing still gets the tab */ }
  return s;
}
function save() {
  try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify({ size: state.size, min: state.min, detail: state.detail })); }
  catch (_) { /* fine */ }
}

const B = () => root.EpinoiaBox;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* THE ROWS, pure: a derived game (engine deriveGame) and the reader's choices in, the rows to draw out */
function rows(d, t, opts) {
  const o = Object.assign({}, state, opts || {});
  const Bx = B();
  let list = Bx.lineupCombos(d, t, o.size);
  list = list.filter(l => l.dur >= Math.max(o.min, 30000) || l.pf || l.pa);
  const who = (o.players || {})[t];
  if (who) list = list.filter(l => l.ids.map(String).includes(String(who)));
  const val = l => o.sort === 'pts' ? l.pf : l[o.sort];
  list.sort((a, b) => ((val(b) || 0) - (val(a) || 0)) * (o.dir < 0 ? 1 : -1) || b.dur - a.dur);
  return list;
}

/* THE TEAM'S OWN GAME, from the same boxes: every stint summed, read by the same rates */
function teamLine(d, t) {
  const Bx = B();
  const a = { ids: [], dur: 0, pf: 0, pa: 0, off: Bx.mkBox(), def: Bx.mkBox() };
  (d.lineups[t] || []).forEach(l => {
    a.dur += l.dur; a.pf += l.pf; a.pa += l.pa;
    for (const k in l.off) { a.off[k] += l.off[k]; a.def[k] += l.def[k]; }
  });
  return Bx.lineupRates(a);
}

const valOf = (l, k) => k === 'pts' ? l.pf : l[k];

/* THE SHADES, per column across the table's rows: the class for each ranked cell.
   'g1'..'g3' better, 'b1'..'b3' worse, 'v1'..'v3' a volume; '' level with the reference */
function shades(list, team) {
  const ranked = list.filter(l => l.dur >= SHORT_STINT);
  const out = new Map(list.map(l => [l, {}]));
  COLS.forEach(c => {
    const k = c.k;
    if (c.kind === 'vol') {
      const max = Math.max(1e-9, ...ranked.map(l => valOf(l, k) || 0));
      ranked.forEach(l => { const a = (valOf(l, k) || 0) / max; out.get(l)[k] = a >= 0.67 ? 'v3' : a >= 0.34 ? 'v2' : a > 0 ? 'v1' : ''; });
      return;
    }
    const ref = c.kind === 'zero' ? 0 : team[k];
    const diff = l => ((l[k] || 0) - ref) * (LOWER[k] ? -1 : 1);
    const scale = Math.max(FLOOR[k] || 1, ...ranked.map(l => Math.abs(diff(l))));
    ranked.forEach(l => {
      const v = diff(l), a = Math.abs(v) / scale;
      const lvl = a < 0.12 ? 0 : a < 0.4 ? 1 : a < 0.7 ? 2 : 3;
      out.get(l)[k] = lvl ? (v > 0 ? 'g' : 'b') + lvl : '';
    });
  });
  return out;
}

function mins(ms) {
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
const signed = (v, dec) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dec);

function fig(l, c) {
  const k = c.k, v = l[k];
  if (k === 'dur') return mins(l.dur);
  if (k === 'pts') return l.pf + '<i>–</i>' + l.pa;
  if (k === 'pm') return signed(l.pm, 0);
  if (v == null || !isFinite(v)) return '—';
  if (k === 'net') return signed(v, 1);
  return v.toFixed(c.dec);
}

function players(t) {
  const S = root.S;
  return ((S && S.teams && S.teams[t] && S.teams[t].players) || []).slice().sort((a, b) => (+a.num || 0) - (+b.num || 0));
}
function colour(t) {
  const Bx = B(), S = root.S, TC = root.EpinoiaTeamColour;
  const c = Bx.safeColour(((S && S.teams && S.teams[t]) || {}).color, t ? '#8ff5ff' : '#93f2bf');
  return (TC && TC.ink && TC.ink(c)) || c;
}

/* the names, as the traditional box score writes them: the number in the club's colour, then the name.
   A first name is its own span so a phone can drop it from a five (the surname and number still say who) */
function namesHTML(t, ids) {
  const byId = {};
  players(t).forEach(p => { byId[String(p.id)] = p; });
  return ids.map(id => byId[String(id)]).filter(Boolean).sort((a, b) => (+a.num || 0) - (+b.num || 0)).map(p => {
    const nm = String(p.name || ''), sp = nm.indexOf(' ');
    const name = sp > 0 ? '<span class="lu2-fn">' + esc(nm.slice(0, sp + 1)) + '</span>' + esc(nm.slice(sp + 1)) : esc(nm);
    return '<span class="lu2-p" title="' + esc((p.num != null && p.num !== '' ? '#' + p.num + ' ' : '') + nm) + '">' +
      (p.num != null && p.num !== '' ? '<i>' + esc(p.num) + '</i>' : '') + '<b>' + name + '</b></span>';
  }).join('');
}

function teamHTML(d, t) {
  const Bx = B();
  const list = rows(d, t).slice(0, 25);
  const team = teamLine(d, t);
  const total = team.dur || 1;
  const groups = GROUPS.filter(g => state.detail || !g.detail);
  const cols = COLS.filter(c => state.detail || !c.detail);
  const sh = shades(list, team);
  const whoLabel = state.size === 5 ? 'lineup' : state.size === 3 ? 'trio' : 'pair';
  const gs = c => groups.some(g => g.cols[0][0] === c.k) ? ' gs' : '';

  const band = '<tr class="lu2-gh"><th class="lu2-who" rowspan="2" scope="col"><span>' + whoLabel + '</span></th>' +
    groups.map(g => '<th colspan="' + g.cols.length + '" class="lu2-g g-' + g.k + '" scope="colgroup"><span>' + esc(g.l) + '</span></th>').join('') + '</tr>';
  const head = '<tr class="lu2-ch">' + cols.map(c => '<th class="lu2-s g-' + c.g + gs(c) + (state.sort === c.k ? ' on ' + (state.dir < 0 ? 'desc' : 'asc') : '') +
    '" data-lu-sort="' + c.k + '" role="button" tabindex="0" scope="col" title="' + esc(c.title) + (LOWER[c.k] ? ' (lower is better)' : '') + '"' +
    (state.sort === c.k ? ' aria-sort="' + (state.dir < 0 ? 'descending' : 'ascending') + '"' : '') + '>' + esc(c.l) + '</th>').join('') + '</tr>';

  const netEdge = l => l.dur < SHORT_STINT ? '' : (sh.get(l).net || '');
  const body = list.map((l, i) => {
    const short = l.dur < SHORT_STINT, s = sh.get(l);
    const cells = cols.map(c => {
      const cls = 'g-' + c.g + gs(c) + (short ? '' : s[c.k] ? ' h' + s[c.k] : '');
      if (c.k === 'net') return '<td class="' + cls + '"><span class="lu2-net ' + (l.net >= 0 ? 'pos' : 'neg') + (short ? '' : s.net ? ' n' + s.net : '') + '">' + fig(l, c) + '</span></td>';
      return '<td class="' + cls + '">' + fig(l, c) + '</td>';
    }).join('');
    const share = Math.min(100, l.dur / total * 100);
    const edge = netEdge(l);
    return '<tr class="lu2-r' + (i % 2 ? ' odd' : '') + (short ? ' lu2-short' : '') + (edge ? ' e' + edge : '') + '">' +
      '<td class="lu2-who"><div class="lu2-names">' + namesHTML(t, l.ids) + '</div>' +
      '<div class="lu2-share" title="' + share.toFixed(0) + '% of the team’s minutes"><span class="lu2-bar"><i style="width:' + share.toFixed(1) + '%"></i></span><small>' + share.toFixed(0) + '%</small></div></td>' +
      cells + '</tr>';
  }).join('') || '<tr class="lu2-r"><td colspan="' + (cols.length + 1) + '" class="lu2-none">' +
    (state.players[t] ? 'no group with that player at this size and length' : 'no lineup data yet') + '</td></tr>';
  const teamRow = team.dur ? '<tr class="lu2-r lu2-team"><td class="lu2-who"><b>' + esc(Bx.tname(t)) + '</b><small>whole game · the reference</small></td>' +
    cols.map(c => {
      const txt = c.k === 'net' ? '<span class="lu2-net ' + (team.net >= 0 ? 'pos' : 'neg') + '">' + fig(team, c) + '</span>' : fig(team, c);
      return '<td class="g-' + c.g + gs(c) + '">' + txt + '</td>';
    }).join('') + '</tr>' : '';

  const opts = '<option value="">with any player</option>' + players(t).map(p =>
    '<option value="' + esc(p.id) + '"' + (String(state.players[t]) === String(p.id) ? ' selected' : '') + '>' +
    (p.num != null && p.num !== '' ? '#' + esc(p.num) + ' ' : '') + esc(p.name) + '</option>').join('');
  const name = esc(Bx.tname(t));
  /* the key: each phrase its own text node, so the page's translator (i18n.js) finds it whole */
  const key = '<div class="lu2-key"><span class="lu2-sw"><i class="hg3"></i><i class="hg1"></i><i class="hb1"></i><i class="hb3"></i></span>' +
    '<b>' + name + '</b><span> \u00b7 green = better \u00b7 red = worse \u00b7 darker = further from the team\u2019s game number (the last row) \u00b7 +/- and net around 0</span> ' +
    '<span class="lu2-sw"><i class="hv1"></i><i class="hv3"></i></span><span>min, pts, poss: more is deeper</span></div>';
  return '<div class="glass bxteam advcard lu2-team" data-lu-team="' + t + '" style="--c:' + esc(colour(t)) + ';--oc:' + esc(colour(1 - t)) + '">' +
    '<div class="lu2-head"><h3 data-team-slot="' + t + '">' + name + '</h3>' +
    '<select class="lu2-player" data-lu-player="' + t + '" aria-label="lineups with a player">' + opts + '</select></div>' +
    '<div class="tblwrap lu2-wrap"><table class="lu2 s' + state.size + (state.detail ? ' lu2-detail' : '') + '"><thead>' + band + head + '</thead><tbody>' + body + teamRow + '</tbody></table></div>' +
    key + '</div>';
}

function controls() {
  const seg = (items, cur, attr) => '<span class="lu2-seg" role="group">' + items.map(([v, l]) =>
    '<button type="button" data-' + attr + '="' + v + '"' + (v === cur ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + l + '</button>').join('') + '</span>';
  return '<div class="lu2-ctl">' + seg(SIZES, state.size, 'lu-size') + seg(MINS, state.min, 'lu-min') +
    '<button type="button" class="lu2-tog' + (state.detail ? ' on' : '') + '" data-lu-detail aria-pressed="' + state.detail + '">four factors</button></div>';
}

function render(d) {
  lastD = d;
  if (!B() || !B().lineupCombos || !d || !d.lineups) return '<div class="msg">The lineups could not be loaded.</div>';
  return '<div class="lu2">' + controls() + teamHTML(d, 0) + teamHTML(d, 1) +
    '<div class="setup-note lu2-note">greyed: under 2 minutes together, not shaded (too short to mean much) · the bar is the group’s share of the team’s minutes · ' +
    'the left edge and the net pill carry the net rating · lower is better for drtg, tov%, opp efg%, orb allowed and opp ft rate</div></div>';
}

/* one listener on the tab's own element: every control redraws the tab in place from the last game drawn */
function mounted(el) {
  const host = el && (el.querySelector('.lu2') ? el : null);
  if (!host || host.__lu2) return;
  host.__lu2 = true;
  const redraw = () => { const box = host.querySelector('.lu2'); if (box && lastD) box.outerHTML = render(lastD); };
  host.addEventListener('click', e => {
    const b = e.target.closest('[data-lu-size],[data-lu-min],[data-lu-detail],[data-lu-sort]');
    if (!b || !host.contains(b)) return;
    if (b.hasAttribute('data-lu-size')) state.size = +b.getAttribute('data-lu-size');
    else if (b.hasAttribute('data-lu-min')) state.min = +b.getAttribute('data-lu-min');
    else if (b.hasAttribute('data-lu-detail')) state.detail = !state.detail;
    else if (b.hasAttribute('data-lu-sort')) {
      const k = b.getAttribute('data-lu-sort');
      state.dir = state.sort === k ? -state.dir : LOWER[k] ? 1 : -1;
      state.sort = k;
    }
    save(); redraw();
  });
  host.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-lu-sort]')) { e.preventDefault(); e.target.click(); }
  });
  host.addEventListener('change', e => {
    const s = e.target.closest && e.target.closest('[data-lu-player]');
    if (!s) return;
    state.players[+s.getAttribute('data-lu-player')] = s.value;
    redraw();
  });
}

return { render, mounted, rows, teamLine, shades, _state: () => state, _set: s => { state = Object.assign(load(), s); } };
}));
