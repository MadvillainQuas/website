'use strict';
/* ============================================================================
   THE LINEUPS TAB (game page): who shared the floor, and what happened while they did.

   It used to be one fixed table a team: the fifteen longest fives, sixteen columns and 980px wide, so on a
   phone the only thing on screen was a column of names. Now:

     5-MAN / 3-MAN / 2-MAN   the fives, or every trio and pair inside them (boxscore.js lineupCombos): the
                             question a coach asks is as often "how did these two go together" as "which five"
     MINUTES                 all, 2+ or 5+ - a lineup that played ninety seconds has a net rating of anything
     WITH A PLAYER           only the groups one player was in
     SORT                    any column, highest first; again for lowest first
     FOUR FACTORS            the eight detail columns, on request; the default is the few that fit a phone

   The five's own boxes are the only input, so every number here agrees with the one before this change for
   the fives. A row's tint is its net rating; a short stint's row is dimmed because its rates are noise.

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
const SHORT_STINT = 120000;           // under two minutes together: dimmed, whatever the numbers say
const COLS = [
  // key, label, lower-is-better, detail-only, format
  ['dur', 'min', false, false, null],
  ['pm', '+/-', false, false, null],
  ['pts', 'pts', false, false, null],
  ['net', 'net', false, false, null],
  ['ortg', 'ortg', false, false, 1],
  ['drtg', 'drtg', true, false, 1],
  ['poss', 'poss', false, false, 1],
  ['efg', 'efg%', false, true, 1],
  ['tovp', 'tov%', true, true, 1],
  ['orebp', 'orb%', false, true, 1],
  ['ftr', 'ft rate', false, true, 0],
  ['oefg', 'opp efg', true, true, 1],
  ['tovf', 'tov frc', false, true, 1],
  ['oreba', 'orb alwd', true, true, 1],
  ['oftr', 'opp ftr', true, true, 0]
];
/* the old tab's thresholds, kept: good / bad */
const GOOD = { ortg: [110, 95], efg: [52, 45], tovp: [12, 18], orebp: [30, 20], ftr: [30, 15],
               drtg: [100, 115], oefg: [45, 52], tovf: [18, 12], oreba: [20, 30], oftr: [15, 30] };

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

function grade(k, v) {
  const g = GOOD[k];
  if (!g) return '';
  const lower = g[0] < g[1];
  if (lower) return v <= g[0] ? 'good' : (v >= g[1] ? 'bad' : '');
  return v >= g[0] ? 'good' : (v <= g[1] ? 'bad' : '');
}
function tint(net) {
  const c = Math.max(-30, Math.min(30, net)), i = Math.abs(c) / 30 * 0.18;
  return c >= 0 ? 'rgba(99,255,160,' + i.toFixed(3) + ')' : 'rgba(255,95,107,' + i.toFixed(3) + ')';
}
function mins(ms) {
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function players(t) {
  const S = root.S;
  return ((S && S.teams && S.teams[t] && S.teams[t].players) || []).slice().sort((a, b) => (+a.num || 0) - (+b.num || 0));
}

function teamHTML(d, t) {
  const Bx = B();
  const list = rows(d, t).slice(0, 25);
  const total = (d.lineups[t] || []).reduce((a, l) => a + l.dur, 0) || 1;
  const cols = COLS.filter(c => state.detail || !c[3]);
  const head = '<tr><th class="lu2-who">' + (state.size === 5 ? 'lineup' : state.size === 3 ? 'trio' : 'pair') + '</th>' +
    cols.map(c => '<th class="lu2-s' + (state.sort === c[0] ? ' on ' + (state.dir < 0 ? 'desc' : 'asc') : '') +
      (c[0] === 'ortg' ? ' blk-o' : c[0] === 'drtg' ? ' blk-d' : c[0] === 'net' ? ' blk-n' : '') +
      '" data-lu-sort="' + c[0] + '" role="button" tabindex="0">' + esc(c[1]) + '</th>').join('') + '</tr>';
  const body = list.map(l => {
    const cells = cols.map(c => {
      const k = c[0];
      if (k === 'dur') return '<td>' + mins(l.dur) + '</td>';
      if (k === 'pm') return '<td class="' + (l.pm > 0 ? 'pos' : l.pm < 0 ? 'neg' : '') + '">' + (l.pm > 0 ? '+' : '') + l.pm + '</td>';
      if (k === 'pts') return '<td>' + l.pf + '–' + l.pa + '</td>';
      if (k === 'net') return '<td class="blk-n"><span class="netpill ' + (l.net >= 0 ? 'pos' : 'neg') + '">' + (l.net > 0 ? '+' : '') + l.net.toFixed(1) + '</span></td>';
      const v = l[k];
      return '<td class="' + (k === 'ortg' ? 'blk-o ' : k === 'drtg' ? 'blk-d ' : '') + grade(k, v) + '">' + (v == null ? '—' : v.toFixed(c[4])) + '</td>';
    }).join('');
    const share = Math.min(100, l.dur / total * 100);
    return '<tr class="' + (l.dur < SHORT_STINT ? 'lu2-short' : '') + '" style="background:' + tint(l.net) + '">' +
      '<td class="lu2-who"><div class="lunums">' + Bx.luNames(t, l.ids) + '</div>' +
      '<span class="lu2-bar" style="--w:' + share.toFixed(1) + '%" title="' + share.toFixed(0) + '% of the game"></span></td>' + cells + '</tr>';
  }).join('') || '<tr><td colspan="' + (cols.length + 1) + '" class="lu2-none">' +
    (state.players[t] ? 'no group with that player at this size and length' : 'no lineup data yet') + '</td></tr>';
  const opts = '<option value="">with any player</option>' + players(t).map(p =>
    '<option value="' + esc(p.id) + '"' + (String(state.players[t]) === String(p.id) ? ' selected' : '') + '>' +
    (p.num != null && p.num !== '' ? '#' + esc(p.num) + ' ' : '') + esc(p.name) + '</option>').join('');
  return '<div class="glass bxteam advcard lu2-team" data-lu-team="' + t + '"><div class="lu2-head"><h3 data-team-slot="' + t + '">' + esc(Bx.tname(t)) + '</h3>' +
    '<select class="lu2-player" data-lu-player="' + t + '" aria-label="lineups with a player">' + opts + '</select></div>' +
    '<div class="tblwrap"><table class="bx lu lu2' + (state.detail ? ' lu2-detail' : '') + '">' + head + body + '</table></div></div>';
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
    '<div class="setup-note lu2-note">row tint = net rating · dimmed: under 2 minutes together · the bar is the share of the game · ' +
    'green / red: ortg 110/95 · efg 52/45 · tov 12/18 · orb 30/20 · drtg 100/115</div></div>';
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
      state.dir = state.sort === k ? -state.dir : (COLS.find(c => c[0] === k) || [])[2] ? 1 : -1;
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

return { render, mounted, rows, _state: () => state, _set: s => { state = Object.assign(load(), s); } };
}));
