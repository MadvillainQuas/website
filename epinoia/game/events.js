'use strict';
/* ============================================================================
   EVENTS — what each kind of play turned into, per team, at both ends.

   The box score already says how many points came off an offensive rebound, off
   a turnover and on the break. It does not say what those plays LOOKED like:
   which shots they produced, how well they were made, who took them. This tab
   is that, for five situations, the assisted / unassisted split, and every
   player's own line across all of them.

   THE NUMBERS ARE epinoia/situations.js's. That file holds the rules (the
   engine's own second-chance, off-turnover and transition windows, chances from
   possessions.js, the after-timeout set) because the same calculator also
   writes the per-game lines the season tables and profiles read; this file only
   draws them. compute() is kept here as a pass-through for the tests and any
   caller that already used it.

   Defence is the other side's offence, read against this side.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaEvents = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* situations.js: a global on the page, a module in node */
const Sit = () => root.EpinoiaSituations ||
  (typeof require === 'function' ? require('../situations.js') : null);
const compute = S => Sit().compute(S);

const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SITS = [
  { key: 'second',     name: 'Second chance', what: 'after an offensive rebound', slot: 1 },
  { key: 'transition', name: 'Transition',    what: 'tagged, or within 8 s of a defensive rebound or steal', slot: 2 },
  { key: 'offTo',      name: 'Off turnovers', what: 'after the other side turned it over', slot: 3 },
  { key: 'ato',        name: 'After timeout', what: 'the possession after a timeout', slot: 4 },
  { key: 'half',       name: 'Half court',    what: 'none of the above', slot: 0 },
  { key: 'all',        name: 'All chances',   what: 'every chance', slot: 0 }
];
const SIT = {}; SITS.forEach(s => { SIT[s.key] = s; });

/* ------------------------------------------------------------ percentiles ---
   Points per chance, eFG%, turnover rate and each zone's shooting, read against
   real games by epinoia/gamepct.js: the number takes its percentile's colour and
   the percentile goes in its tooltip. On the defence view the numbers are the
   other side's offence, so the direction turns round: a low points per chance
   there is this side's success. Without gamepct.js on the page (the tests, a page
   that does not load it) the markup is exactly what it was. */
const GPx = () => root.EpinoiaGamePct || null;
let gpOpts = { league: null, flip: false };
const gpRate = (scope, key, ctx) => { const G = GPx(); return G ? G.rate(scope, key, ctx, gpOpts) : null; };
/* an opening tag with the rating's colour class added to the classes it already had and, given
   a label, the percentile as its tooltip (inside something that has a data-tip of its own, the
   words go there instead: two tooltips on one number is one too many) */
function gpOpen(tag, r, label, cls) {
  const G = GPx();
  const c = ((cls || '') + (G && r ? G.cls(r) : '')).trim();
  return '<' + tag + (c ? ' class="' + c + '"' : '') + (G && r && label ? ' title="' + esc(label + ': ' + G.words(r)) + '"' : '') + '>';
}
/* the words for a data-tip that is already there */
const gpTip = (r, label) => { const G = GPx(); return G && r ? ' · ' + label + ': ' + G.words(r) : ''; };

/* ----------------------------------------------------------------- render --- */
/* the view survives a redraw (a live game redraws on every play). pid is the
   player whose breakdown is open; it belongs to the side on show, so a change
   of team or of end shuts it rather than leave another side's player open. */
const view = { team: 0, side: 'off', sit: 'second', pid: null };
function setView(v) {
  if (!('pid' in v) && (('team' in v && v.team !== view.team) || ('side' in v && v.side !== view.side))) view.pid = null;
  return Object.assign(view, v);
}
let memo = { ref: null, len: -1, out: null };
function computed(S) {
  const len = S && S.events ? S.events.length : 0;
  if (memo.ref !== (S && S.events) || memo.len !== len) memo = { ref: S && S.events, len, out: compute(S) };
  return memo.out;
}

const pct = v => (v == null ? '–' : Math.round(v * 100) + '%');
const dec2 = v => (v == null ? '–' : v.toFixed(2));
const clockText = ms => { if (ms == null) return ''; const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const qText = p => (p <= 4 ? 'Q' + p : 'OT' + (p - 4));
const person = (pid, name) => UUID.test(pid || '')
  ? '<a class="ev-person" href="../p/?p=' + encodeURIComponent(pid) + '">' + esc(name) + '</a>'
  : '<span class="ev-person">' + esc(name) + '</span>';
const hasFootage = S => !!(S && S.video && S.video.url);
const sitColour = k => (SIT[k].slot ? 'var(--ev-s' + SIT[k].slot + ')' : 'var(--ev-neutral)');
const typeLabel = T => (T.three ? (T.type && T.type !== 'jump shot' ? T.type + ' three' : 'three') : (T.type || 'two, type not recorded'));

/* rim · mid · three as one ordered bar, darkest nearest the basket, each part named beneath */
function dietHTML(z, colour) {
  const n = z.rim.a + z.mid.a + z.three.a;
  if (!n) return '<span class="ev-diet none"><span class="ev-stack"></span><small>no shots</small></span>';
  const seg = (k, cls) => (z[k].a ? '<i class="' + cls + '" style="flex:' + z[k].a + '"></i>' : '');
  return '<span class="ev-diet" style="--s:' + colour + '"><span class="ev-stack">' +
    seg('rim', 'z0') + seg('mid', 'z1') + seg('three', 'z2') + '</span>' +
    '<small>' + z.rim.a + ' rim · ' + z.mid.a + ' mid · ' + z.three.a + ' three</small></span>';
}

function rowHTML(key, s, base, scale, all) {
  const S0 = SIT[key], on = view.sit === key;
  const few = s.fga < 3;
  const rp = gpRate('sit', key + '.ppp', { s }), re = few ? null : gpRate('sit', key + '.efg', { s }), rt = gpRate('sit', key + '.tov', { s });
  /* HOW OFTEN, NOT JUST HOW WELL. rp/re/rt grade what a side did with this kind of chance;
     rf grades how often it got one at all, against every other side's own share of its chances
     -- a side that lives in transition and one that barely gets there are two different teams
     before either takes a shot. Only defined for the four situations gamepct.js gives a
     direction to (not 'all', trivially always 100%, and not 'ato', a count of timeouts called
     rather than a skill), so a null result here just means no colour, same as everywhere else. */
  const rf = key === 'all' ? null : gpRate('sit', key + '.freq', { s, all });
  const tip = S0.name + ': ' + s.pts + ' pts on ' + s.chances + (key === 'ato' ? ' possessions' : ' chances') +
    (s.ppp != null ? ', ' + s.ppp.toFixed(2) + ' per ' + (key === 'ato' ? 'possession' : 'chance') : '') +
    ' · FG ' + s.fgm + '/' + s.fga + ' · 3PT ' + s.p3m + '/' + s.p3a + ' · FT ' + s.ftm + '/' + s.fta + ' · ' + s.tov + ' turnovers' +
    gpTip(rp, 'points per ' + (key === 'ato' ? 'possession' : 'chance')) + gpTip(re, 'eFG%') + gpTip(rt, 'turnover rate') +
    gpTip(rf, 'share of chances');
  return '<button type="button" class="ev-row' + (on ? ' on' : '') + (key === 'all' ? ' ref' : '') + '" data-evsit="' + key + '" aria-pressed="' + on + '" style="--s:' + sitColour(key) + '" data-tip="' + esc(tip) + '">' +
    '<span class="ev-name"><i class="ev-sw"></i><span><b>' + S0.name + '</b><small>' + S0.what + '</small></span></span>' +
    '<span class="ev-pts"><b>' + s.pts + '</b><small>' + (key === 'all' ? 'points' : pct(s.share) + ' of points') + '</small></span>' +
    '<span class="ev-freq">' + gpOpen('b', rf) + (key === 'all' ? '100%' : pct(s.chances / (all.chances || 1))) + '</b><small>' + (key === 'ato' ? 'of possessions' : 'of chances') + '</small></span>' +
    '<span class="ev-ppp"><span class="ev-track"><i class="ev-fill" style="width:' + (s.ppp == null ? 0 : Math.min(100, 100 * s.ppp / scale)).toFixed(1) + '%"></i>' +
      (key === 'all' || base == null ? '' : '<i class="ev-tick" style="left:' + Math.min(100, 100 * base / scale).toFixed(1) + '%"></i>') + '</span>' +
      gpOpen('b', rp) + dec2(s.ppp) + '</b><small>' + s.chances + (key === 'ato' ? ' poss.' : ' chances') + '</small></span>' +
    '<span class="ev-efg' + (few ? ' few' : '') + '">' + gpOpen('b', re) + (s.efg == null ? '–' : (100 * s.efg).toFixed(0) + '%') + '</b><small>' + s.fgm + '/' + s.fga + ' FG' + (few && s.fga ? ' · few shots' : '') + '</small></span>' +
    '<span class="ev-tov' + (s.chances < 3 ? ' few' : '') + '">' + gpOpen('b', s.chances < 3 ? null : rt) + pct(s.tovPct) + '</b><small>' + s.tov + (s.tov === 1 ? ' turnover' : ' turnovers') + '</small></span>' +
    dietHTML(s.zones, sitColour(key)) +
  '</button>';
}

function courtHTML(s, colour, names) {
  const Box = root.EpinoiaBox;
  const located = s.shots.filter(x => x.x != null && x.y != null);
  if (!Box || !Box.courtSVG) return '';
  if (!located.length) return '<div class="ev-court empty"><p>No shot locations were recorded for ' + (s.fga === 1 ? 'this shot.' : s.fga ? 'these ' + s.fga + ' shots.' : 'this situation.') + '</p></div>';
  const C = Box.COURT;
  const dots = located.slice().sort((a, b) => a.made - b.made).map(x => {   // makes drawn last, on top
    const p = Box.snapToValue ? Box.snapToValue(x.x, x.y, x.three) : x;
    const cx = (p.x * C.W).toFixed(0), cy = (p.y * C.H).toFixed(0);
    const tip = qText(x.period) + ' ' + clockText(x.clock) + ' · ' + (x.pid ? names[x.pid] || '' : '') + ' · ' +
      typeLabel({ three: x.three, type: x.type }) + ' · ' + (x.made ? 'made' : 'missed');
    return x.made
      ? '<circle class="ev-dot made" cx="' + cx + '" cy="' + cy + '" r="34" data-tip="' + esc(tip) + '"/>'
      : '<circle class="ev-dot miss" cx="' + cx + '" cy="' + cy + '" r="27" data-tip="' + esc(tip) + '"/>';
  }).join('');
  return '<div class="ev-court" style="--s:' + colour + '">' + Box.courtSVG(null, { plain: true }).replace('</svg>', dots + '</svg>') +
    '<p class="ev-key"><span><i class="made"></i>made</span><span><i class="miss"></i>missed</span><span>' + located.length + ' of ' + s.fga + ' shots located</span></p></div>';
}

function typesHTML(s) {
  if (!s.types.length) return '<p class="ev-none">No field goals.</p>';
  const top = s.types.slice(0, 7), rest = s.types.slice(7);
  if (rest.length) top.push({ three: null, type: 'other', a: rest.reduce((n, T) => n + T.a, 0), m: rest.reduce((n, T) => n + T.m, 0), other: true });
  const max = Math.max(...top.map(T => T.a));
  return '<ul class="ev-types">' + top.map(T => {
    const label = T.other ? 'everything else' : typeLabel(T);
    return '<li data-tip="' + esc(label + ': ' + T.m + ' made of ' + T.a + (T.a ? ' (' + Math.round(100 * T.m / T.a) + '%)' : '')) + '">' +
      '<span class="ev-tlabel">' + esc(label) + '</span>' +
      '<span class="ev-tbar"><i class="att" style="width:' + (100 * T.a / max).toFixed(1) + '%"></i><i class="made" style="width:' + (100 * T.m / max).toFixed(1) + '%"></i></span>' +
      '<span class="ev-tval">' + T.m + '/' + T.a + '</span></li>';
  }).join('') + '</ul>';
}

const hasPlayer = (players, pid) => !!players && pid != null && Object.prototype.hasOwnProperty.call(players, pid);

/* A name in a list, and beside it (never around it: the name may be a link to the
   profile) a button that opens the player's breakdown in the players card. It
   OPENS rather than toggles: tapped again from up here, it should take you back
   down to the breakdown, not shut it out of sight. */
function whoHTML(pid, name, players) {
  const known = hasPlayer(players, pid);
  return '<span class="ev-who">' + person(pid, name) +
    (known ? '<button type="button" class="ev-pbtn' + (view.pid === pid ? ' on' : '') + '" data-evpid="' + esc(pid) + '" aria-label="Shots by situation: ' + esc(name) + '">Shots</button>' : '') +
    '</span>';
}

function scorersHTML(s, players) {
  if (!s.scorers.length) return '<p class="ev-none">Nobody scored.</p>';
  const max = s.scorers[0].pts;
  return '<ol class="ev-scorers">' + s.scorers.map(p =>
    '<li>' + whoHTML(p.pid, p.name, players) + '<span class="ev-sbar"><i style="width:' + (100 * p.pts / max).toFixed(1) + '%"></i></span>' +
    '<b>' + p.pts + '</b><small>' + p.fgm + '/' + p.fga + ' FG</small></li>').join('') + '</ol>';
}

/* ---------------------------------------------------------------- players ---
   Every player of the side on show, one row each, and under the row that is
   open the player's own line in every situation. The numbers are the side's
   rules applied to one player (situations.js), so a player's second-chance
   points here are the box score's second-chance points for that player. */
const ZONES = [['rim', 'Rim', 'at the rim'], ['mid', 'Mid', 'mid-range'], ['three', '3PT', 'threes']];
const MX_ROWS = [['all', 'All shots'], ['second', 'Second chance'], ['transition', 'Transition'],
                 ['offTo', 'Off turnovers'], ['ato', 'After timeout'], ['half', 'Half court']];
const FEW = 3;                                          // a percentage on fewer tries than this is greyed
const few = n => (n < FEW ? ' class="few"' : '');
const efgText = v => (v == null ? '–' : Math.round(100 * v) + '%');
const share = (n, d) => Math.round(100 * n / d) + '%';

function playersOf(D) {
  /* points, then shots; a tie keeps the roster order situations.js gave them */
  return Object.values(D.players || {}).sort((a, b) => (b.sits.all.pts - a.sits.all.pts) || (b.sits.all.fga - a.sits.all.fga));
}

/* how a row's shots (or baskets) split between rim, mid and three: one stacked
   bar the width of its cell, the shares written beneath it */
function splitBar(n, label, noun) {
  const tot = n[0] + n[1] + n[2];
  if (!tot) return '<span class="ev-stack"></span><small>no ' + noun + 's</small>';
  const seg = i => (n[i] ? '<i class="z' + i + '" style="flex:' + n[i] + '" data-tip="' +
    esc(label + ' · ' + ZONES[i][1] + ': ' + n[i] + ' of ' + tot + ' ' + noun + (tot === 1 ? '' : 's') + ' (' + share(n[i], tot) + ')') + '"></i>' : '');
  return '<span class="ev-stack">' + seg(0) + seg(1) + seg(2) + '</span><small>' + n.map(x => Math.round(100 * x / tot)).join(' · ') + '%</small>';
}

function matrixHTML(p, colour, id) {
  const nil = '<td><b class="nil">–</b></td>';
  const sitRow = ([k, label]) => {
    const s = p.sits[k];
    const none = !(s.pts || s.fga || s.fta || s.tov);
    return '<tr class="ev-mxsit' + (none ? ' zero' : '') + '" data-evk="' + k + '" style="--s:' + sitColour(k) + '">' +
      '<th scope="row"><span class="ev-mxname"><i class="ev-sw"></i>' + label + '</span></th>' +
      '<td><b>' + s.pts + '</b>' + (s.fta ? '<small>' + s.ftm + '/' + s.fta + ' FT</small>' : '') + '</td>' +
      (s.fga ? '<td><b>' + s.fgm + '/' + s.fga + '</b></td><td>' +
        gpOpen('b', s.fga < FEW ? null : gpRate('psit', k + '.efg', { s }), label + ' eFG%', s.fga < FEW ? 'few' : '') + efgText(s.efg) + '</b></td>' : nil + nil) +
      ZONES.map(([z, Z]) => {
        const q = s.zones[z];
        const rz = q.a < FEW ? null : gpRate('zone', 'player.' + k + '.' + z, { z: q });
        return q.a ? '<td data-tip="' + esc(label + ' · ' + Z + ': ' + q.m + ' made of ' + q.a + gpTip(rz, Z + ' FG%')) + '"><b>' + q.m + '/' + q.a + '</b>' +
          gpOpen('small', rz, '', q.a < FEW ? 'few' : '') + share(q.m, q.a) + '</small></td>' : nil;
      }).join('') +
      '<td class="ev-mxbar">' + splitBar(ZONES.map(([z]) => s.zones[z].a), label, 'attempt') + '</td></tr>';
  };
  /* assisted or not is a property of a basket, so these rows count makes */
  const made = p.ast.fgm + p.unast.fgm;
  const madeRow = (k, label, g) =>
    '<tr class="ev-mxmade' + (g.fgm ? '' : ' zero') + '" data-evk="' + k + '" style="--s:' + colour + '">' +
      '<th scope="row"><span class="ev-mxname"><i class="ev-sw"></i>' + label + '</span></th>' +
      '<td><b>' + g.pts + '</b></td>' +
      '<td><b>' + g.fgm + '</b>' + (made ? '<small' + few(made) + '>' + share(g.fgm, made) + ' of makes</small>' : '') + '</td>' +
      '<td><b' + (g.fgm ? '' : ' class="nil"') + '>' + (g.fgm ? (g.pts / g.fgm).toFixed(2) : '–') + '</b></td>' +
      ZONES.map(([z, Z]) => {
        const zm = p.ast.zones[z] + p.unast.zones[z];
        return zm ? '<td data-tip="' + esc(Z + ': ' + g.zones[z] + ' of ' + zm + ' made ' + (zm === 1 ? 'basket' : 'baskets') + ' ' + label.toLowerCase() + ' (' + share(g.zones[z], zm) + ')') + '"><b>' + g.zones[z] + '</b><small' + few(zm) + '>' + share(g.zones[z], zm) + '</small></td>' : nil;
      }).join('') +
      '<td class="ev-mxbar">' + splitBar(ZONES.map(([z]) => g.zones[z]), label, 'basket') + '</td></tr>';
  const head = (first, fg, efg) => '<tr><th scope="col">' + first + '</th><th scope="col">PTS</th><th scope="col">' + fg + '</th><th scope="col">' + efg + '</th>' +
    ZONES.map(([, Z]) => '<th scope="col">' + Z + '</th>').join('') + '<th scope="col" class="ev-mxbar">Rim · mid · 3PT share</th></tr>';
  return '<div class="ev-pmx" id="' + id + '">' +
    '<div class="ev-mwrap"><table class="ev-mx">' +
      '<caption class="ev-vh">' + esc(p.name) + ': shots in every situation, then made baskets assisted and unassisted</caption>' +
      '<thead>' + head('Situation', 'FG', 'eFG%') + '</thead>' +
      '<tbody>' + MX_ROWS.map(sitRow).join('') + '</tbody>' +
      '<tbody class="ev-mxmade">' + head('Made baskets', 'Baskets', 'Per basket').replace('<tr>', '<tr class="ev-mxsub">') +
        madeRow('ast', 'Assisted', p.ast) + madeRow('unast', 'Unassisted', p.unast) + '</tbody>' +
    '</table></div>' +
    '<p class="ev-note">The situations overlap (a break off a steal is transition and off a turnover at once), so they do not add up to all shots. ' +
      'Assisted and unassisted count made baskets only, because a missed shot has no assist: those rows give baskets, their share of the player’s makes ' +
      '(and, under each zone, of that zone’s makes) and points per basket, where the rows above give FG and eFG%. Grey percentages rest on fewer than three shots.</p>' +
  '</div>';
}

function playersHTML(D, colour, pid) {
  const list = playersOf(D);
  if (!list.length) return '<p class="ev-none">No play in this game has a player’s name on it.</p>';
  return '<ul class="ev-plist">' + list.map((p, i) => {
    const s = p.sits.all, open = p.pid === pid, id = 'ev-pm-' + i;
    const extra = [s.fta ? s.ftm + '/' + s.fta + ' FT' : '', s.tov ? s.tov + (s.tov === 1 ? ' turnover' : ' turnovers') : ''].filter(Boolean).join(' · ');
    return '<li class="ev-pitem' + (open ? ' open' : '') + '"><div class="ev-phead">' +
      '<button type="button" class="ev-prow" data-evpid="' + esc(p.pid) + '" aria-expanded="' + open + '"' + (open ? ' aria-controls="' + id + '"' : '') + '>' +
        '<span class="ev-pname"><i class="ev-chev" aria-hidden="true"></i><span><b>' + esc(p.name) + '</b>' + (extra ? '<small>' + extra + '</small>' : '') + '</span></span>' +
        '<span class="ev-ppts"><b>' + s.pts + '</b><small>pts</small></span>' +
        '<span class="ev-pfg"><b>' + s.fgm + '/' + s.fga + '</b><small>FG</small></span>' +
        '<span class="ev-pefg' + (s.fga < FEW ? ' few' : '') + '">' + gpOpen('b', s.fga < FEW ? null : gpRate('psit', 'all.efg', { s }), 'eFG%') + efgText(s.efg) + '</b><small>eFG</small></span>' +
        dietHTML(s.zones, colour) +
      '</button>' +
      (UUID.test(p.pid) ? '<a class="ev-plink" href="../p/?p=' + encodeURIComponent(p.pid) + '" aria-label="Profile: ' + esc(p.name) + '">Profile</a>' : '') +
    '</div>' + (open ? matrixHTML(p, colour, id) : '') + '</li>';
  }).join('') + '</ul>';
}

/* WATCH VIDEO ONLY WHERE THE FOOTAGE HAS THE PLAY. The video tab lists what epinoia/video.js
   index() could place; a button for a play it could not place would open the tab on nothing.
   The button names the first action of the set that was placed. */
let placedMemo = { key: '', ids: null };
function placedIds(S) {
  const V = root.EpinoiaVideo;
  if (!hasFootage(S) || !V || !V.index) return null;
  const v = S.video;
  const key = S.events.length + ':' + (v.tip_wall || v.tip_at || '') + ':' + (v.stream_started_at || '') + ':' + (v.trim_ms || 0) + ':' +
              (v.clock_track && v.clock_track.samples ? v.clock_track.samples.length : 0);
  if (placedMemo.key !== key) {
    const ids = new Set();
    try { V.index(S.events, v, { skipStructural: true }).forEach(p => ids.add(String(p.id))); } catch (_) { /* no buttons */ }
    placedMemo = { key, ids };
  }
  return placedMemo.ids;
}

/* whose timeout it was, by name: "own" and "their" turn over when the tab shows the defence */
function atoHTML(list, S, nm, o) {
  if (!list.length) return '<p class="ev-none">No timeouts were followed by a play from this side.</p>';
  const placed = placedIds(S);
  return '<ol class="ev-ato">' + list.map(p => {
    const at = placed ? p.seqs.find(q => placed.has(String(q))) : undefined;
    return '<li class="' + (p.made ? 'scored' : 'blank') + '">' +
      '<span class="ev-when">' + qText(p.period) + ' ' + clockText(p.clock) + '</span>' +
      '<span class="ev-chip ' + p.calledBy + '">' + (p.calledBy === 'official' ? 'official timeout' : esc(nm[p.calledBy === 'own' ? o : 1 - o]) + ' timeout') + '</span>' +
      '<span class="ev-how">' + esc(p.how) + (p.chances > 1 ? ' <small>(' + p.chances + ' chances)</small>' : '') + '</span>' +
      '<b class="ev-atopts">' + (p.pts ? '+' + p.pts : '0') + '</b>' +
      (at != null ? '<button type="button" class="ev-watch" data-evwatch="' + esc(at) + '">Watch video</button>' : '') +
    '</li>';
  }).join('') + '</ol>';
}

/* EACH ZONE'S SHOOTING BESIDE HOW ITS MAKES WERE MADE. A miss cannot be assisted,
   so there is no assisted eFG%: an assisted three that went in would read 150%
   and every assisted shot would look like a make, because it was one. The
   shooting columns are every attempt from the zone; the assisted and unassisted
   columns split that zone's baskets, each with the zone's share of that group. */
function assistZonesHTML(A) {
  const Z = A.zones;
  if (!Z) return '';
  const all = { a: 0, m: 0, ast: 0, unast: 0 };
  ZONES.forEach(([z]) => { ['a', 'm', 'ast', 'unast'].forEach(f => { all[f] += Z[z][f]; }); });
  const groupCell = (n, tot, label) => '<td><b>' + n + '</b>' + (tot ? '<small' + few(tot) + '>' + share(n, tot) + ' of ' + label + '</small>' : '') + '</td>';
  const row = (key, label, q, p3m, isAll) => {
    const made = q.ast + q.unast;
    const efg = q.a ? (q.m + 0.5 * p3m) / q.a : null;
    /* a zone's eFG% moves with its FG% (a three's is one and a half times it), so the two share
       the zone's colour; the All row's eFG% is the side's own */
    const rated = q.a >= FEW;
    const rFg = rated ? gpRate('zone', 'team.all.' + (isAll ? 'all' : key), { z: q }) : null;
    const rEfg = !rated ? null : isAll ? gpRate('sit', 'all.efg', { s: { efg, fga: q.a } }) : rFg;
    const shade = q.a ? (rated ? '' : 'few') : 'nil';
    return '<tr' + (isAll ? ' class="ev-azall"' : '') + ' data-evz="' + key + '">' +
      '<th scope="row">' + label + '</th>' +
      '<td><b' + (q.a ? '' : ' class="nil"') + '>' + (q.a ? q.m + '/' + q.a : '–') + '</b></td>' +
      '<td>' + gpOpen('b', rFg, label + ' FG%', shade) + (q.a ? share(q.m, q.a) : '–') + '</b></td>' +
      '<td>' + gpOpen('b', rEfg, label + ' eFG%', shade) + efgText(efg) + '</b></td>' +
      (isAll ? '<td><b>' + q.ast + '</b></td><td><b>' + q.unast + '</b></td>'
             : groupCell(q.ast, A.ast.fgm, 'assisted') + groupCell(q.unast, A.unast.fgm, 'unassisted')) +
      '<td><b' + (made ? few(made) : ' class="nil"') + '>' + (made ? share(q.ast, made) : '–') + '</b></td></tr>';
  };
  const ppb = g => '<td><b' + (g.fgm ? '' : ' class="nil"') + '>' + (g.fgm ? (g.pts / g.fgm).toFixed(2) : '–') + '</b></td>';
  return '<h4 class="ev-sub">By zone</h4>' +
    '<div class="ev-mwrap"><table class="ev-mx az">' +
      '<caption class="ev-vh">Shooting from each zone, and how its baskets were made</caption>' +
      '<thead><tr><th scope="col">Zone</th><th scope="col">FG</th><th scope="col">FG%</th><th scope="col">eFG%</th>' +
        '<th scope="col">Assisted</th><th scope="col">Unassisted</th><th scope="col">% assisted</th></tr></thead>' +
      '<tbody>' + ZONES.map(([z, label]) => row(z, label, Z[z], z === 'three' ? Z[z].m : 0, false)).join('') +
        row('all', 'All', all, Z.three.m, true) + '</tbody>' +
      '<tfoot><tr data-evz="ppb"><th scope="row">Points per basket</th><td></td><td></td><td></td>' + ppb(A.ast) + ppb(A.unast) + '<td></td></tr></tfoot>' +
    '</table></div>' +
    '<p class="ev-note">There is no eFG% for assisted shots. Only a basket can be assisted, a miss cannot, so assisted shots have makes but no misses to set them against. ' +
      'FG% and eFG% here are every attempt from the zone (a three counts one and a half); the assisted and unassisted columns say how that zone’s baskets were made, ' +
      'with the zone’s share of each group under the count. Grey percentages rest on fewer than three shots.</p>';
}

function assistsHTML(A, colour, players) {
  const max = Math.max(1, A.ast.fgm, A.unast.fgm);
  const made = A.ast.fgm + A.unast.fgm;
  const line = (label, g) => {
    const z = g.zones, n = g.fgm;
    const seg = (k, cls, word) => (z[k] ? '<i class="' + cls + '" style="flex:' + z[k] + '" data-tip="' + esc(label + ': ' + z[k] + ' ' + word) + '">' + (z[k] / max >= 0.12 ? z[k] : '') + '</i>' : '');
    return '<div class="ev-aline">' +
      '<span class="ev-alabel"><b>' + label + '</b><small>' + g.fgm + ' baskets · ' + g.pts + ' pts</small></span>' +
      '<span class="ev-abar"><span class="ev-stack big" style="width:' + (100 * n / max).toFixed(1) + '%">' +
        seg('rim', 'z0', 'at the rim') + seg('mid', 'z1', 'mid-range') + seg('three', 'z2', 'threes') + '</span></span>' +
      '<span class="ev-apct">' + (made ? Math.round(100 * g.fgm / made) + '%' : '–') + '</span></div>';
  };
  const lead = A.leaders;
  const top = lead.length ? Math.max(...lead.map(p => p.unFgm)) : 1;
  return '<div class="ev-assist" style="--s:' + colour + '">' +
    line('Assisted', A.ast) + line('Unassisted', A.unast) +
    '<p class="ev-key"><span><i class="z0"></i>rim</span><span><i class="z1"></i>mid-range</span><span><i class="z2"></i>three</span><span>share of made baskets on the right</span></p>' +
    (A.ftAssists ? '<p class="ev-note">Plus ' + A.ftAssists + ' assist' + (A.ftAssists === 1 ? '' : 's') + ' on a pass that drew free throws, which the box score’s assists include.</p>' : '') +
    assistZonesHTML(A) +
    '<h4 class="ev-sub">Most unassisted baskets</h4>' +
    (lead.length ? '<ol class="ev-scorers">' + lead.map(p =>
      '<li>' + whoHTML(p.pid, p.name, players) + '<span class="ev-sbar"><i style="width:' + (100 * p.unFgm / top).toFixed(1) + '%"></i></span>' +
      '<b>' + p.unFgm + '</b><small>' + p.unPts + ' pts · ' + Math.round(100 * p.unFgm / p.fgm) + '% of their baskets</small></li>').join('') + '</ol>'
      : '<p class="ev-none">Every basket was assisted.</p>') +
  '</div>';
}

function inner(S) {
  const C = computed(S);
  const t = view.team, off = view.side === 'off';
  const o = off ? t : 1 - t;                      // whose offence is on show
  gpOpts = { league: S && S.leagueSlug, flip: !off };
  const D = C.side[o];
  const all = D.sits.all;
  const nm = C.names, me = esc(nm[t]), them = esc(nm[1 - t]), attackers = esc(nm[o]);
  if (!all.chances) {
    return controlsHTML(nm) + '<section class="ev-card ev-empty"><h3 class="ev-title">No plays yet</h3><p>This tab is drawn from the play-by-play, and there is none for this game yet.</p></section>';
  }
  const keys = ['second', 'transition', 'offTo', 'ato', 'half', 'all'];
  const scale = Math.max(1.6, ...keys.map(k => D.sits[k].ppp || 0)) * 1.05;
  const sit = view.sit in D.sits ? view.sit : 'second';
  const s = D.sits[sit], colour = sitColour(sit);
  const teamColour = 'var(--vis-t' + o + ',var(--team' + o + '))';
  const pid = view.pid != null && hasPlayer(D.players, view.pid) ? view.pid : null;   // only a player of the side on show
  const lede = off
    ? '<b>' + me + '</b> on offence'
    : '<b>' + them + '</b> against <b>' + me + '</b>’s defence';
  /* a figure in the running text: wrapped only when there is a percentile to show */
  const gpWrap = (r, text, label) => (r && GPx() ? gpOpen('span', r, label) + text + '</span>' : text);
  const figPpp = gpRate('sit', sit + '.ppp', { s }), figEfg = s.fga < FEW ? null : gpRate('sit', sit + '.efg', { s }), figTov = gpRate('sit', sit + '.tov', { s });
  return controlsHTML(nm) +
    '<p class="ev-lede">' + lede + ': ' + all.chances + ' chances, ' + all.pts + ' points, ' + gpOpen('b', gpRate('sit', 'all.ppp', { s: all }), 'points per chance') + dec2(all.ppp) + '</b> points per chance, ' +
      (all.efg == null ? '' : gpWrap(gpRate('sit', 'all.efg', { s: all }), (100 * all.efg).toFixed(1) + '%', 'eFG%') + ' eFG, ') +
      gpWrap(gpRate('sit', 'all.tov', { s: all }), pct(all.tovPct), 'turnover rate') + ' turnovers.</p>' +
    '<section class="ev-card">' +
      '<div class="ev-head"><h3 class="ev-title">Where ' + attackers + '’ points came from</h3>' +
        '<p class="ev-key"><span><i class="tick"></i>' + dec2(all.ppp) + ' per chance overall</span><span>shots: rim · mid · three</span></p></div>' +
      '<div class="ev-cols" aria-hidden="true"><span>situation</span><span>points</span><span>share of chances</span><span>points per chance</span><span>eFG%</span><span>TOV%</span><span>shot diet</span></div>' +
      '<div class="ev-rows">' + keys.map(k => rowHTML(k, D.sits[k], all.ppp, scale, all)).join('') + '</div>' +
      '<p class="ev-note">Second chance, transition and off-turnover points are the box score’s, and a basket can be in more than one. ' +
        'After-timeout plays run from the first play after the timeout to the end of that possession. Tap a row to see its shots.</p>' +
    '</section>' +
    '<section class="ev-card ev-detail" style="--s:' + colour + '">' +
      '<div class="ev-head"><h3 class="ev-title"><i class="ev-sw"></i>' + SIT[sit].name + ' <small>' + attackers + (off ? '' : ' against ' + me) + '</small></h3>' +
        '<p class="ev-figs"><span><b>' + s.pts + '</b>pts</span><span>' + gpOpen('b', figPpp, 'points per ' + (sit === 'ato' ? 'possession' : 'chance')) + dec2(s.ppp) + '</b>per ' + (sit === 'ato' ? 'poss.' : 'chance') + '</span>' +
        '<span>' + gpOpen('b', figEfg, 'eFG%') + (s.efg == null ? '–' : (100 * s.efg).toFixed(0) + '%') + '</b>eFG</span><span><b>' + s.ftm + '/' + s.fta + '</b>FT</span><span>' + gpOpen('b', figTov, 'turnover rate') + pct(s.tovPct) + '</b>TO</span></p></div>' +
      '<div class="ev-grid">' + courtHTML(s, colour, namesOf(S)) +
        '<div class="ev-side-col"><h4 class="ev-sub">Shot types</h4>' + typesHTML(s) +
        '<div class="ev-zones">' + ['rim', 'mid', 'three'].map(z => '<span><small>' + (z === 'mid' ? 'mid-range' : z) + '</small><b>' + s.zones[z].m + '/' + s.zones[z].a + '</b>' +
          gpOpen('em', s.zones[z].a >= FEW ? gpRate('zone', 'team.' + sit + '.' + z, { z: s.zones[z] }) : null, (z === 'mid' ? 'mid-range' : z) + ' FG%') +
          (s.zones[z].a ? Math.round(100 * s.zones[z].m / s.zones[z].a) + '%' : '–') + '</em></span>').join('') + '</div>' +
        '<h4 class="ev-sub">Who scored</h4>' + scorersHTML(s, D.players) + '</div></div>' +
      (sit === 'ato' ? '<h4 class="ev-sub">Every play after a timeout</h4>' + atoHTML(D.ato, S, nm, o) : '') +
    '</section>' +
    '<section class="ev-card ev-players" style="--s:' + teamColour + '">' +
      '<div class="ev-head"><h3 class="ev-title">Every player’s shots <small>' + attackers + (off ? '' : ' against ' + me) + '</small></h3>' +
        '<p class="ev-key"><span><i class="z0"></i>rim</span><span><i class="z1"></i>mid-range</span><span><i class="z2"></i>three</span><span>tap a player for every situation</span></p></div>' +
      playersHTML(D, teamColour, pid) +
    '</section>' +
    '<section class="ev-card">' +
      '<div class="ev-head"><h3 class="ev-title">Assisted and unassisted baskets <small>' + attackers + '</small></h3></div>' +
      assistsHTML(D.assists, teamColour, D.players) +
    '</section>';
}

function namesOf(S) {
  const n = {};
  ((S && S.teams) || []).forEach(tm => (tm.players || []).forEach(p => { n[p.id] = p.name || '#' + (p.num || '?'); }));
  return n;
}

function controlsHTML(nm) {
  return '<div class="ev-bar">' +
    '<div class="ev-teams" role="group" aria-label="Team">' + [0, 1].map(t =>
      '<button type="button" data-evteam="' + t + '" aria-pressed="' + (view.team === t) + '"' + (view.team === t ? ' class="on"' : '') + ' style="--c:var(--vis-t' + t + ',var(--team' + t + '))"><i></i>' + esc(nm[t]) + '</button>').join('') + '</div>' +
    '<div class="ev-seg" role="group" aria-label="Offence or defence">' + [['off', 'Offence'], ['def', 'Defence']].map(x =>
      '<button type="button" data-evside="' + x[0] + '" aria-pressed="' + (view.side === x[0]) + '"' + (view.side === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>').join('') + '</div>' +
  '</div>';
}

function render(S) {
  return '<div class="ev">' + inner(S) + '<div class="ev-tip" role="tooltip" hidden></div></div>';
}

/* the clubs' colours, inked for this theme, as game flow does it */
function inkTeams(host) {
  const TC = root.EpinoiaTeamColour;
  if (!host || !TC || !TC.ink || typeof getComputedStyle !== 'function') return;
  const cs = getComputedStyle(document.documentElement);
  ['0', '1'].forEach(t => {
    const c = cs.getPropertyValue('--team' + t).trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) host.style.setProperty('--vis-t' + t, TC.ink(c) || c);
  });
}

/* One set of listeners on the host renderBody keeps: the controls redraw the tab in place,
   a hover (or a tap, on a phone) shows what a mark is, and WATCH VIDEO asks the page for
   the video tab at that play. */
function mounted(host) {
  if (!host) return;
  inkTeams(host);
  if (host.__evBound) return;
  host.__evBound = true;
  const wrap = () => host.querySelector('.ev');
  const redraw = () => {
    const w = wrap(); if (!w) return;
    const tip = w.querySelector('.ev-tip');
    w.innerHTML = inner(root.S);
    if (tip) { tip.hidden = true; w.appendChild(tip); }
  };
  const tipOf = e => { const m = e.target && e.target.closest && e.target.closest('[data-tip]'); return m && wrap() && wrap().contains(m) ? m : null; };
  const show = m => {
    const w = wrap(), tip = w && w.querySelector('.ev-tip');
    if (!tip || !m) return;
    tip.textContent = m.getAttribute('data-tip');
    tip.hidden = false;
    /* the rects are screen pixels and the page is zoomed on a desktop, the tip's left and top
       are CSS pixels: k, read off the tab itself, turns the one into the other */
    const r = m.getBoundingClientRect(), R = w.getBoundingClientRect();
    const k = w.offsetWidth ? (R.width / w.offsetWidth) || 1 : 1;
    const left = (r.left - R.left) / k, top = (r.top - R.top) / k, bottom = (r.bottom - R.top) / k;
    const x = Math.max(8, Math.min(R.width / k - tip.offsetWidth - 8, left + r.width / k / 2 - tip.offsetWidth / 2));
    const above = top - tip.offsetHeight - 8;
    tip.style.left = x + 'px';
    tip.style.top = (above > 0 ? above : bottom + 8) + 'px';
  };
  const hide = () => { const w = wrap(), tip = w && w.querySelector('.ev-tip'); if (tip) tip.hidden = true; };
  /* A player's row toggles that player's breakdown (one open at a time); a Shots button in a
     list above opens it and brings the row up. The redraw replaces the buttons, so
     the row gets the focus back, and a row tapped where it is stays where it is on
     screen even when the breakdown that shut was above it. */
  const openPlayer = b => {
    const pid = b.dataset.evpid, fromRow = b.classList.contains('ev-prow');
    const before = fromRow && b.getBoundingClientRect ? b.getBoundingClientRect().top : null;
    view.pid = fromRow && view.pid === pid ? null : pid;
    redraw();
    const w = wrap();
    const row = w && Array.prototype.find.call(w.querySelectorAll('.ev-prow'), x => x.dataset.evpid === pid);
    if (!row) return;
    if (row.focus) row.focus({ preventScroll: true });
    if (!row.getBoundingClientRect) return;
    const top = row.getBoundingClientRect().top;
    if (fromRow) { if (before != null && Math.abs(top - before) > 1 && root.scrollBy) root.scrollBy(0, top - before); }
    else if (top < 0 || top > (root.innerHeight || 800) * 0.8) row.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  host.addEventListener('pointerover', e => { if (!wrap()) return; const m = tipOf(e); if (m && e.pointerType !== 'touch') show(m); });
  host.addEventListener('pointerout', e => { if (wrap() && tipOf(e) && e.pointerType !== 'touch') hide(); });
  host.addEventListener('click', e => {
    if (!wrap()) return;
    const b = e.target.closest && e.target.closest('[data-evteam],[data-evside],[data-evsit],[data-evwatch],[data-evpid]');
    if (b && wrap().contains(b)) {
      if (b.dataset.evwatch != null) {
        root.dispatchEvent(new CustomEvent('epinoia:watchplay', { detail: { seq: b.dataset.evwatch } }));
        return;
      }
      if (b.dataset.evpid != null) { openPlayer(b); return; }
      /* another team or the other end: the open player was one of the side that was on show */
      if (b.dataset.evteam != null && +b.dataset.evteam !== view.team) { view.team = +b.dataset.evteam; view.pid = null; }
      if (b.dataset.evside != null && b.dataset.evside !== view.side) { view.side = b.dataset.evside; view.pid = null; }
      if (b.dataset.evsit != null) {
        view.sit = b.dataset.evsit;
        redraw();
        const d = wrap() && wrap().querySelector('.ev-detail');
        /* a phone shows the table and the detail one above the other: bring the detail up */
        if (d && d.getBoundingClientRect && d.getBoundingClientRect().top > (root.innerHeight || 800) * 0.8) d.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      redraw();
      return;
    }
    /* a tap on a mark shows its tooltip; a tap anywhere else puts it away */
    const m = tipOf(e);
    if (m && !m.closest('button')) show(m); else hide();
  });
}

return { compute, render, mounted, view, SITS, setView };
}));
