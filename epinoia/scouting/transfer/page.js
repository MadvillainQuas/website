'use strict';
/* ============================================================================
   /epinoia/scouting/transfer/ — THE TRANSFER MATRIX.

   How a player's numbers change when he moves from one league to another. Every number is worked out in the browser by
   engine.js (EpinoiaTransferEngine) from one members' file, the player store (tools/build-transfer.mjs), which
   transferdata.js (EpinoiaTransferData.load('transfer')) gets from the private bucket; this script draws the sections
   and keeps the reader's choices.

   MEMBERS ONLY, IN FACT (access.js CATALOGUE.locks.transferMatrix, the analytics gate What wins rides on; on the server
   analytics_check, migration 0265: an account always, then the gate). Not entitled - signed out, or not a member once
   memberships are on - every working section keeps its title and shows memlock.js's placeholder, and nothing is asked
   for. The server has the last word: a 'members' answer draws the same placeholder, 'signin' asks the reader to sign in
   again. "How it is worked out" (#method) is always open. A sign-in or a membership in another tab
   (EpinoiaAccess.onChange) opens the page where it stands. There is no preview of it (access.js PEEK_NEVER).

   THE SECTIONS
     #data       the loading state, then the season window, the leagues left out (this visit only), robust weighting
                 and the talent curve: every number below is built from these
     #translate  from and to leagues, a player found in the league he is leaving (or numbers typed in), minutes and
                 stabilise, Blend / This route only / Spanish scale, the route's grades, how sure, and every stat projected
     #movers     the real players on the route, nearest in BPM to the input first, eight and then all
     #index      a measure, seasons and a rating window; a line per league picked (the top five until the reader picks)
     #ranks      every league's rank and rating each season (table.ft, heat by rating), ◉ to chart one, its name for
                 its ledger, ✕ to leave it out
     #ledger     the neighbouring leagues behind one league's rating in the last season it was rated

   STRUCTURE: the views (HTML strings, every value escaped) are pure, so node tests can draw them; boot() puts them on
   the page. In node this file exports them and never touches a document.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaTransferPage = api;
  if (root.document && root.document.getElementById && root.document.getElementById('tm')) api.boot();
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const KEY = 'transferMatrix';
const MEMBER = ['data', 'translate', 'movers', 'index', 'ranks', 'ledger'];
const PH_ROWS = { data: 3, translate: 8, movers: 5, index: 6, ranks: 8, ledger: 5 };
const MAX_PICKS = 6, TOP_PICKS = 5, MOVERS_SHOWN = 8, RANKS_SHOWN = 30;
const WHAT = 'Transfer matrix';

/* ------------------------------------------------------------------ helpers --- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isNum = v => typeof v === 'number' && isFinite(v);
/* a number with its sign, the minus a true minus (the old app's fmtSign) */
const sg = (v, d) => (isNum(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d == null ? 1 : d) : '–');
const fx = (v, d) => (isNum(v) ? v.toFixed(d == null ? 1 : d).replace(/^-/, '−').replace(/^−(0\.0*)$/, '$1') : '–');
const count = n => (isNum(n) ? n.toLocaleString('en-GB') : '–');
const nm = s => '<span translate="no">' + esc(s) + '</span>';
const yearLabel = (RAW, y) => (RAW && RAW.yearLabel && RAW.yearLabel.get(y)) || String(y);
const short = y => '’' + String(y).slice(2);

const MODES = [['blend', 'Blend'], ['direct', 'This route only'], ['spain', 'Spanish scale']];
const MODE_HINT = {
  blend: 'The moves on this route, blended with the league network: the more players made the move, the more they count',
  direct: 'Only the players who made this exact move, either way, and no model: a route nobody took has no answer',
  spain: 'Every league set against Spanish ACB through the chain of moves between leagues; this route’s own moves are not used'
};
const LEVEL = {
  high: 'High confidence', moderate: 'Moderate confidence', sparse: 'Little evidence', model: 'The league network alone',
  nodirect: 'No direct evidence', notconnected: 'Not connected', spain: 'Spanish scale', same: 'The same league'
};
/* a level's tone for its chip: the kit's good / amber / bad */
const LEVEL_TONE = { high: 'good', moderate: 'ok', sparse: 'warn', model: 'bad', nodirect: 'bad', notconnected: 'bad', spain: 'warn', same: 'ok' };
const STAT_NAME = {
  BPM: 'Box plus-minus: points per 100 possessions over an average player', TS_pct: 'True shooting', USG_pct: 'Usage',
  ORB_pct: 'Offensive rebounds taken', DRB_pct: 'Defensive rebounds taken', AST_pct: 'Share of teammates’ baskets he assisted',
  TOV_pct: 'Turnovers per 100 of his plays (lower is better)', STL_pct: 'Steals per 100 opponent possessions', BLK_pct: 'Blocks per 100 opponent two-point tries'
};
/* the League Index's measures, in the order the picker lists them */
const MEASURES = [
  ['Overall', [['bpm', 'BPM']]],
  ['Combined', [['c:phys', 'Physicality (ORB% and DRB%)'], ['c:aggr', 'Aggression (STL% and TOV%)'], ['c:event', 'Event generation (STL% and BLK%)'],
                ['c:score', 'Scoring (TS% and USG%)'], ['c:play', 'Playmaking (USG% and AST%)']]],
  ['One stat', [['s:1', 'TS%'], ['s:2', 'USG%'], ['s:3', 'ORB%'], ['s:4', 'DRB%'], ['s:5', 'AST%'], ['s:6', 'TOV%, turned round'], ['s:7', 'STL%'], ['s:8', 'BLK%']]]
];
const measureLabel = k => { for (const [, list] of MEASURES) for (const [v, t] of list) if (v === k) return t; return k; };
const WINDOWS = [[1, 'One season, moves within it'], [2, 'Two seasons'], [3, 'Three seasons'], [5, 'Five seasons'], [99, 'Every season to date']];
const measureNote = k => (k === 'bpm' ? 'Grade 100 is Spanish ACB, and every 10 points is one point of BPM against it'
  : /^c:/.test(k) ? 'Each part’s ladder in standard scores, averaged: 0 is an average league, 100 is one standard deviation above it'
  : k === 's:6' ? 'The change in TOV% a player can expect moving from the league to Spanish ACB, turned round so that higher is a tougher league'
  : 'The change in this stat a player can expect moving from the league to Spanish ACB: higher is a tougher league');

/* the fulltable's heat, as a --heat colour (kit/table.css draws the lozenge): p is 0..100 */
function heatVar(p) {
  if (!isNum(p)) return '';
  if (p >= 90) return 'color-mix(in oklch,var(--good) 34%,transparent)';
  if (p >= 75) return 'color-mix(in oklch,var(--good) 20%,transparent)';
  if (p >= 60) return 'color-mix(in oklch,var(--good) 10%,transparent)';
  if (p >= 40) return '';
  if (p >= 25) return 'color-mix(in oklch,var(--amber) 12%,transparent)';
  if (p >= 10) return 'color-mix(in oklch,var(--flare) 14%,transparent)';
  return 'color-mix(in oklch,var(--flare) 24%,transparent)';
}
/* the old app's grade bar: the league's grade within the spread of grades, never quite empty */
function gradeFrac(g, lo, hi) {
  const span = Math.max(1, hi - lo);
  return Math.min(1, Math.max(0.03, (g - lo + span * 0.12) / (span * 1.24)));
}
const seg = (act, items, on, label) => '<div class="pg-seg" role="group" aria-label="' + esc(label) + '">' +
  items.map(([v, t]) => '<button type="button" data-act="' + act + '" data-v="' + esc(v) + '" aria-pressed="' + (String(v) === String(on)) + '">' + esc(t) + '</button>').join('') + '</div>';
const options = (items, on, names) => items.map(([v, t]) => '<option value="' + esc(v) + '"' + (String(v) === String(on) ? ' selected' : '') + (names ? ' translate="no"' : '') + '>' + esc(t) + '</option>').join('');
const empty = msg => '<div class="pg-empty"><p>' + esc(msg) + '</p></div>';

/* ------------------------------------------------------------------ the views --- */
/* #data's status line once the window is worked out */
function statusHTML(D, RAW, st) {
  const ex = st.excluded.size;
  return '<b class="tm-n">' + count(D.players.length) + '</b> <span>player-seasons</span> · <b class="tm-n">' + count(D.nTransfers) +
    '</b> <span>moves</span> · <b class="tm-n">' + count(D.leagues.length) + '</b> <span>leagues</span> · ' +
    '<span translate="no">' + esc(yearLabel(RAW, st.lo)) + ' – ' + esc(yearLabel(RAW, st.hi)) + '</span>' +
    (ex ? ' · <b class="tm-n">' + ex + '</b> <span>left out</span>' : '');
}
function settingsHTML(RAW, st) {
  const yrs = RAW.years.slice().sort((a, b) => a - b).map(y => [y, yearLabel(RAW, y)]);
  const ncaa = RAW.allLeagues.filter(n => n.toUpperCase().includes('NCAA'));
  const ncaaOut = ncaa.length && ncaa.every(n => st.excluded.has(n));
  return '<div class="pg-row ww-ctl">' +
      '<label class="ww-field"><span class="ww-flab">Earliest season</span><select id="tmLo" class="ep-input" data-act="lo">' + options(yrs, st.lo, true) + '</select></label>' +
      '<label class="ww-field"><span class="ww-flab">Latest season</span><select id="tmHi" class="ep-input" data-act="hi">' + options(yrs, st.hi, true) + '</select></label>' +
    '</div>' +
    '<div class="pg-row ww-ctl tm-toggles">' +
      '<div class="ww-field"><span class="ww-flab" id="tmRbL">Robust weighting</span>' + seg('robust', [['1', 'On'], ['0', 'Off']], st.robust ? '1' : '0', 'Robust weighting') + '</div>' +
      '<div class="ww-field"><span class="ww-flab" id="tmTcL">Talent curve</span>' + seg('talent', [['0', 'Off'], ['1', 'On']], st.talent ? '1' : '0', 'Talent curve') + '</div>' +
    '</div>' +
    '<p class="ww-note">' + esc(st.robust ? 'Robust weighting is on: a player counts once on each route, and no route can outvote the rest by volume'
      : 'Robust weighting is off: every move counts as recorded, however often one player made it') + '</p>' +
    '<p class="ww-note">' + esc(st.talent ? 'The talent curve is on: each change is corrected for how far the mover sat from his old league’s average'
      : 'The talent curve is off: changes are used as the movers showed them') + '</p>' +
    '<details class="ww-details tm-ex" id="tmEx"' + (st.exOpen ? ' open' : '') + '><summary><span>Leagues left out</span>: <b>' + (st.excluded.size ? st.excluded.size : '<span>none</span>') + '</b></summary>' +
      '<div class="pg-row">' + (ncaa.length ? '<button type="button" class="ep-btn" data-act="ncaa">' + esc(ncaaOut ? 'Put the NCAA back' : 'Leave out the NCAA') + '</button>' : '') +
        '<button type="button" class="ep-btn" data-act="exclear"' + (st.excluded.size ? '' : ' disabled') + '>Put every league back</button></div>' +
      '<div class="tm-exlist">' + RAW.allLeagues.map(n => '<label class="ww-check' + (st.excluded.has(n) ? ' tm-off' : '') + '"><input type="checkbox" data-act="ex" value="' + esc(n) + '"' +
        (st.excluded.has(n) ? '' : ' checked') + '> ' + nm(n) + '</label>').join('') + '</div>' +
      '<p class="ww-note">Untick a league to leave it out of every number, for this visit only. Two leagues always stay in</p>' +
    '</details>';
}
/* #translate: the controls, drawn once per data window (the parts that change are filled by summaryHTML and the table) */
function translateHTML(D, st) {
  const opts = D.leagues.map((n, i) => [n, n + ' (' + D.strength[i][1].toFixed(0) + ')']);
  const E = engine();
  return '<div class="pg-row ww-ctl tm-route">' +
      '<label class="ww-field"><span class="ww-flab">Moving from</span><select id="tmFrom" class="ep-input" data-act="from">' + options(opts, st.from, true) + '</select></label>' +
      '<button type="button" class="ep-btn tm-swap" data-act="swap" aria-label="Swap the two leagues" title="Swap the two leagues">⇄</button>' +
      '<label class="ww-field"><span class="ww-flab">Moving to</span><select id="tmTo" class="ep-input" data-act="to">' + options(opts, st.to, true) + '</select></label>' +
    '</div>' +
    '<div class="tm-find">' +
      '<label class="ww-field tm-search"><span class="ww-flab">Player</span><input type="search" id="tmQ" class="ep-input" placeholder="Search the league he is leaving" ' +
        'autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="tmRes"></label>' +
      '<div class="tm-res" id="tmRes" role="listbox" aria-label="Players" hidden></div>' +
    '</div>' +
    '<p class="tm-loaded" id="tmLoaded" hidden></p>' +
    '<div class="pg-row ww-ctl tm-mins">' +
      '<label class="ww-field tm-num"><span class="ww-flab">Minutes</span><input type="number" id="tmMin" class="ep-input" min="0" step="10" value="' + esc(st.min) + '" data-act="min"></label>' +
      '<label class="ww-field tm-num"><span class="ww-flab">Games</span><input type="number" id="tmGP" class="ep-input" min="0" step="1" value="' + esc(st.gp) + '" data-act="gp"></label>' +
      '<label class="ww-check"><input type="checkbox" id="tmStab" data-act="stab"' + (st.stab ? ' checked' : '') + '> <span>Stabilise a small sample</span></label>' +
    '</div>' +
    '<div class="pg-row ww-ctl" id="tmModeRow">' + seg('mode', MODES, st.mode, 'How the move is translated') + '</div>' +
    '<p class="ww-note tm-hint" id="tmHint">' + esc(MODE_HINT[st.mode]) + '</p>' +
    '<div class="tm-sum" id="tmSum" aria-live="polite"></div>' +
    '<div class="ep-tw"><table class="ww-tbl tm-stats"><thead><tr><th scope="col">Stat</th><th scope="col">His numbers</th><th scope="col">In his new league</th><th scope="col">Change</th></tr></thead><tbody>' +
      E.META.map((m, k) => '<tr class="' + (k === 0 ? 'tm-bpm' : '') + '"><th scope="row"><abbr title="' + esc(STAT_NAME[m.k]) + '" translate="no">' + esc(m.lab) + '</abbr></th>' +
        '<td><input type="number" step="0.1" class="ep-input tm-in" id="tmIn' + k + '" data-act="in" data-k="' + k + '" value="' + esc(st.inputs[k]) + '" aria-label="' + esc(m.lab) + '"></td>' +
        '<td class="tm-out" id="tmOut' + k + '">–</td><td class="tm-d" id="tmD' + k + '">–</td></tr>').join('') +
    '</tbody></table></div>' +
    '<p class="ww-note">Rates, not totals: what he does with his minutes, not how many minutes he gets. TOV% is better lower</p>';
}
/* the route: both leagues' grades, the step between them, how sure, and the projected BPM */
function summaryHTML(D, F, T, tr, st) {
  const g = D.strength.map(s => s[1]), lo = Math.min.apply(null, g), hi = Math.max.apply(null, g);
  const leg = (lab, i, cls) => '<div class="tm-leg ' + cls + '"><span class="ww-flab">' + esc(lab) + '</span><b class="tm-lg" translate="no">' + esc(D.leagues[i]) + '</b>' +
    '<span class="tm-bar" aria-hidden="true"><i style="width:' + (100 * gradeFrac(D.strength[i][1], lo, hi)).toFixed(1) + '%"></i></span>' +
    '<span class="tm-gr"><span>grade</span> <b>' + D.strength[i][1].toFixed(0) + '</b> · <span translate="no">BPM</span> <b>' + sg(D.strength[i][0]) + '</b></span></div>';
  const dir = tr.same ? 'same' : tr.climbing ? 'up' : 'down';
  const gap = tr.same ? '<span class="tm-gapw"><span>The same league</span></span><span class="tm-gapc">Pick two different leagues to translate</span>'
    : '<span class="tm-gapw"><span>' + (tr.climbing ? 'A step up of' : 'A step down of') + '</span> <b>' + Math.abs(tr.gap).toFixed(1) + '</b> <span translate="no">BPM</span></span>' +
      '<span class="tm-gapc">' + esc(tr.climbing ? 'A stronger league: expect his numbers to come down' : 'A weaker league: expect his numbers to go up') + '</span>';
  const tone = !isNum(tr.bpmOut) ? 'none' : tr.bpmOut >= 5 ? 'good' : tr.bpmOut >= 0 ? 'ok' : tr.bpmOut >= -5 ? 'warn' : 'bad';
  let conf = '';
  if (!tr.same) {
    const E = engine(), r = E.routeDiff(D, F, T, 0, st.mode);
    let basis;
    if (st.mode === 'direct') basis = r ? '<span>Only the players who made this move, no model</span>' : '<span>No player made this move, either way</span>';
    else if (st.mode === 'spain') basis = r ? '<span>Both leagues set against</span> ' + nm(D.spainAnchor || 'Spanish ACB') + ' <span>through the chain of moves; this route’s own moves are not used</span>'
      : '<span>One of these leagues has no chain of moves to the Spanish leagues in these seasons</span>';
    else basis = '<b>' + Math.round(r.w * 100) + '%</b> <span>this route’s moves</span> · <b>' + (100 - Math.round(r.w * 100)) + '%</b> <span>the league network</span>';
    conf = '<p class="tm-conf"><span class="ww-chip tm-lvl" data-tone="' + LEVEL_TONE[tr.level] + '">' + esc(LEVEL[tr.level]) + '</span> ' +
      '<b class="tm-n">' + count(tr.n) + '</b> <span>' + esc(st.robust ? 'different players on this route, both ways' : 'moves on this route, both ways') + '</span>' +
      (st.talent ? ' · <span>talent curve corrected</span>' : '') + '</p><p class="tm-basis">' + basis + '</p>';
  }
  return '<div class="tm-legs">' + leg('Moving from', F, 'tm-a') +
      '<div class="tm-gap" data-dir="' + dir + '"><b class="tm-arrow" aria-hidden="true">' + (dir === 'same' ? '▶' : dir === 'up' ? '▲' : '▼') + '</b>' + gap + '</div>' +
      leg('Moving to', T, 'tm-b') + '</div>' +
    '<div class="tm-hero"><span class="ww-flab">Projected BPM</span><b class="tm-big" data-tone="' + tone + '">' + (isNum(tr.bpmOut) ? sg(tr.bpmOut) : '–') + '</b>' +
      (isNum(tr.bpmIn) ? '<span class="tm-from"><span>before the move</span> <b>' + sg(tr.bpmIn) + '</b></span>' : '') + '</div>' + conf;
}
/* one stat's projected value and change, as the old app wrote them */
function cellText(m, r) {
  if (r.raw === null) return { out: '–', d: '–', cls: 'tm-neu' };
  if (r.noData) return { out: 'No data', d: '–', cls: 'tm-neu' };
  const small = Math.abs(r.d) < 0.05;
  return { out: m.signed ? sg(r.proj, m.dec) : fx(r.proj, m.dec), d: (r.d >= 0 ? '+' : '−') + Math.abs(r.d).toFixed(m.dec) + (small ? '' : r.good > 0 ? ' ▲' : ' ▼'),
           cls: small ? 'tm-neu' : r.good > 0 ? 'tm-up' : 'tm-dn' };
}
/* #movers */
function moversHTML(D, F, T, ref, st) {
  const E = engine();
  if (F === T) return empty('Pick two different leagues to see the players who made the move');
  const g = E.ghostsFor(D, F, T, ref);
  if (!g.rows.length) {
    let msg;
    if (st.mode === 'spain') msg = 'Nobody made this move this way. The Spanish scale does not use the route’s own moves anyway';
    else if (g.reverse) msg = st.mode === 'blend' ? 'Nobody made this move this way: the translation uses the players who moved the other way, and the league network'
      : 'Nobody made this move this way: the translation uses the players who moved the other way';
    else if (st.mode === 'direct') msg = 'Nobody made this move either way, so this route alone has no answer';
    else msg = 'Nobody made this move: the translation comes from the league network alone';
    return empty(msg) + (g.reverse ? '<p class="ww-lead"><b class="tm-n">' + count(g.reverse) + '</b> <span>moved the other way</span></p>' : '');
  }
  const rows = st.moversAll ? g.rows : g.rows.slice(0, MOVERS_SHOWN);
  let html = '<p class="ww-lead"><b class="tm-n">' + count(g.rows.length) + '</b> <span>' + (g.rows.length === 1 ? 'move' : 'moves') + '</span> · <span>closest in BPM to your player first</span></p>' +
    '<div class="ep-tw"><table class="ww-tbl tm-movers"><thead><tr><th scope="col">Player</th><th scope="col">Seasons</th><th scope="col">Club he joined</th>' +
    '<th scope="col">Minutes</th><th scope="col">BPM</th><th scope="col">Change</th></tr></thead><tbody>';
  for (const x of rows) {
    const d = x[9] - x[8];
    html += '<tr><th scope="row" translate="no">' + esc(x[2]) + '</th><td translate="no">' + esc(x[3]) + ' → ' + esc(x[4]) + '</td><td class="tm-club" translate="no">' + esc(x[5]) + '</td>' +
      '<td>' + x[6] + ' → ' + x[7] + '</td><td>' + sg(x[8]) + ' → ' + sg(x[9]) + '</td><td class="' + (d >= 0 ? 'tm-up' : 'tm-dn') + '">' + sg(d) + '</td></tr>';
  }
  html += '</tbody></table></div>';
  if (g.rows.length > MOVERS_SHOWN) {
    html += '<div class="pg-more"><button type="button" class="ep-btn" data-act="moversall">' +
      (st.moversAll ? '<span>Show the nearest eight</span>' : '<span>Show all</span> <b>' + count(g.rows.length) + '</b>') + '</button></div>';
  }
  return html;
}
/* #index's controls */
function indexCtlHTML(RAW, st) {
  const yrs = RAW.years.slice().sort((a, b) => a - b).map(y => [y, yearLabel(RAW, y)]);
  return '<div class="pg-row ww-ctl">' +
      '<label class="ww-field"><span class="ww-flab">Measure</span><select id="tmIm" class="ep-input" data-act="im">' +
        MEASURES.map(([g, list]) => '<optgroup label="' + esc(g) + '">' + options(list, st.idx.m) + '</optgroup>').join('') + '</select></label>' +
      '<label class="ww-field"><span class="ww-flab">From</span><select id="tmIlo" class="ep-input" data-act="ilo">' + options(yrs, st.idx.lo, true) + '</select></label>' +
      '<label class="ww-field"><span class="ww-flab">To</span><select id="tmIhi" class="ep-input" data-act="ihi">' + options(yrs, st.idx.hi, true) + '</select></label>' +
      '<label class="ww-field"><span class="ww-flab">Rating window</span><select id="tmIw" class="ep-input" data-act="iw">' + options(WINDOWS, st.idx.win) + '</select></label>' +
    '</div>' +
    '<p class="ww-note" id="tmIdxNote">' + esc(measureNote(st.idx.m)) + '</p>' +
    '<div class="pg-row tm-picks" id="tmPicks"></div>' +
    '<div class="ww-chart tm-chart" id="tmChart"></div>' +
    '<p class="ww-note">The leagues left out, robust weighting and the talent curve in The data count here too; its seasons do not</p>';
}
function picksHTML(data, st) {
  const picks = st.idx.picks.filter(n => data.leagues.includes(n));
  return '<span class="ww-flab">On the chart</span> ' + (picks.length ? picks.map((n, i) => '<button type="button" class="ep-chip on tm-pick" data-act="unpick" data-v="' + esc(n) + '" data-i="' + i +
    '" title="Take it off the chart"><span class="tm-vh">Take it off the chart</span><i class="tm-key" data-i="' + i + '" aria-hidden="true"></i>' + nm(n) + ' <span aria-hidden="true">×</span></button>').join('') : '<span class="ww-mute">no league</span>') +
    (st.idx.custom ? ' <button type="button" class="ep-btn tm-top" data-act="toppicks">Back to the top five</button>' : '');
}
/* the line chart's series: one per league picked, in the order picked */
function chartSeries(data, st) {
  return st.idx.picks.filter(n => data.leagues.includes(n)).slice(0, MAX_PICKS).map((n, i) => ({ k: n, label: n,
    cls: ['vz-s1l', 'vz-s2l', 'vz-s3l'][i % 3], dash: i >= 3,
    pts: data.per.filter(p => p.byLeague.get(n)).map(p => [p.y, p.byLeague.get(n).grade]) }));
}
/* #ranks: every league's rank (and rating) each season, heat by rating across the table */
function ranksHTML(data, st, RAW) {
  const E = engine(), m = E.IDX_METRICS[data.metric] || E.IDX_METRICS.bpm;
  const per = data.per;
  let gmin = Infinity, gmax = -Infinity;
  per.forEach(p => p.list.forEach(r => { if (r.grade < gmin) gmin = r.grade; if (r.grade > gmax) gmax = r.grade; }));
  if (!isFinite(gmin)) return empty('No moves between these leagues in these seasons');
  const span = Math.max(1e-9, gmax - gmin);
  const W = 46 + 200 + per.length * 62;
  let html = '<p class="ww-note">1 is the strongest. ▲ climbed and ▼ fell since the season before. A league’s name opens what sets its rating; ◉ puts it on the chart</p>' +
    '<div class="ft-wrap tm-ranks"><table class="ft tm-rt" style="width:' + W + 'px"><thead><tr>' +
    '<th class="stick c0 tm-c0" scope="col" title="On the chart"><span aria-hidden="true">◉</span><span class="tm-vh">On the chart</span></th><th class="stick c1 tm-c1" scope="col">League</th>' +
    per.map(p => '<th scope="col" title="' + esc(p.label) + '"><span translate="no">' + esc(short(p.y)) + '</span></th>').join('') + '</tr></thead><tbody>';
  /* the strongest RANKS_SHOWN first; the rest on a press (and a league picked for the chart or the ledger always shows) */
  const shown = st.idx.allRanks ? data.leagues : data.leagues.filter((n, i) => i < RANKS_SHOWN || st.idx.picks.includes(n) || st.idx.ledger === n);
  for (const n of shown) {
    const on = st.idx.picks.includes(n);
    /* the league's cell is the row's header, so the toggles beside it are read with its name */
    html += '<tr data-lg="' + esc(n) + '"' + (st.idx.ledger === n ? ' class="tm-sel"' : '') + '><td class="stick c0 tm-c0"><button type="button" class="tm-pk" data-act="pick" data-v="' + esc(n) + '" aria-pressed="' + on +
      '" title="On the chart"><span class="tm-pkg" aria-hidden="true">' + (on ? '◉' : '○') + '</span><span class="tm-vh">On the chart</span></button></td>' +
      '<th scope="row" class="stick c1 tm-c1"><button type="button" class="tm-lgb" data-act="ledger" data-v="' + esc(n) + '" translate="no">' + esc(n) + '</button>' +
      '<button type="button" class="tm-x" data-act="exclude" data-v="' + esc(n) + '" title="Leave it out"><span aria-hidden="true">✕</span><span class="tm-vh">Leave it out</span></button></th>';
    let prev = null;
    for (const p of per) {
      const r = p.byLeague.get(n);
      if (!r) { html += '<td class="tm-nil">–</td>'; prev = null; continue; }
      const mv = prev === null ? '' : r.rank < prev ? '<span class="tm-up"><span aria-hidden="true">▲</span><span class="tm-vh">climbed</span></span>'
        : r.rank > prev ? '<span class="tm-dn"><span aria-hidden="true">▼</span><span class="tm-vh">fell</span></span>' : '';
      const hv = heatVar(100 * (r.grade - gmin) / span);
      html += '<td class="heat"' + (hv ? ' style="--heat:' + hv + '"' : '') + ' title="' + esc(p.label + ' · ' + (m.dec ? r.grade.toFixed(1) : Math.round(r.grade)) + ' · ' + r.rank + '/' + p.list.length) + '">' +
        '<span class="tm-rk">' + r.rank + mv + '</span><span class="tm-gd">' + (m.dec ? fx(r.grade, 1) : fx(Math.round(r.grade), 0)) + '</span></td>';
      prev = r.rank;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  if (data.leagues.length > RANKS_SHOWN) {
    html += '<div class="pg-more"><button type="button" class="ep-btn" data-act="allranks">' +
      (st.idx.allRanks ? '<span>Show the strongest</span> <b>' + RANKS_SHOWN + '</b>' : '<span>Show every league</span> <b>' + count(data.leagues.length) + '</b>') + '</button></div>';
  }
  return html;
}
/* #ledger */
function ledgerHTML(data, L, st) {
  const opts = data.leagues.map(n => [n, n]);
  let html = '<div class="pg-row ww-ctl"><label class="ww-field"><span class="ww-flab">League</span><select id="tmLed" class="ep-input" data-act="led">' + options(opts, st.idx.ledger, true) + '</select></label></div>';
  if (!L) return html + empty('This league was not rated in these seasons');
  const single = L.single;
  html += '<dl class="tm-facts">' +
    '<div><dt>Season</dt><dd translate="no">' + esc(L.label) + '</dd></div>' +
    '<div><dt>' + esc(single && L.metric === 'bpm' ? 'BPM against Spanish ACB' : single ? 'Its rating against Spanish ACB' : 'BPM against Spanish ACB') + '</dt><dd>' + sg(L.rating, 2) + '</dd></div>' +
    '<div><dt>Rank</dt><dd>' + L.rank + ' / ' + L.of + '</dd></div>' +
    '<div><dt>Rating window</dt><dd>' + esc((WINDOWS.find(w => w[0] === L.win) || [0, ''])[1]) + '</dd></div>' +
    '<div><dt>Weighting</dt><dd>' + esc(st.robust ? 'Robust' : 'As recorded') + (st.talent ? ' · <span>talent curve corrected</span>' : '') + '</dd></div>' +
    '</dl>' + (single ? '' : '<p class="ww-note">A combined measure’s ledger shows BPM</p>');
  if (!L.rows.length) return html + empty('No moves to or from this league in its window');
  const f2 = v => (v === null ? '–' : sg(v, 2));
  html += '<div class="ep-tw"><table class="ww-tbl tm-ledger"><thead><tr><th scope="col">Neighbouring league</th><th scope="col">Share of the say</th><th scope="col">Moves</th>' +
    '<th scope="col">Different players</th><th scope="col">Change leaving</th><th scope="col">Change arriving</th><th scope="col">Its rating</th><th scope="col">Its vote</th></tr></thead><tbody>';
  for (const r of L.rows) {
    html += '<tr><th scope="row" translate="no">' + esc(r.league) + '</th><td>' + (100 * r.share).toFixed(1) + '%</td><td>' + count(r.records) + '</td><td>' + count(r.movers) + '</td>' +
      '<td>' + f2(r.d1) + '</td><td>' + f2(r.d2) + '</td><td>' + f2(r.rating) + '</td><td><b>' + f2(r.v) + '</b></td></tr>';
  }
  return html + '</tbody></table></div>' +
    '<p class="ww-note">A vote is the neighbour’s own rating plus the change seen between the two. The rating is about the weighted mean of the votes, and a route is trustworthy when the change leaving and the change arriving roughly mirror each other</p>';
}

/* the engine, wherever this runs */
function engine() {
  if (root.EpinoiaTransferEngine) return root.EpinoiaTransferEngine;
  if (typeof require === 'function') { try { return require('./engine.js'); } catch (_) { /* no engine */ } }
  return null;
}

/* ============================================================================================ THE BROWSER === */
function boot() {
  const doc = root.document, $ = id => doc.getElementById(id);
  const E = engine(), V = () => root.EpinoiaVizKit;
  const frame = $('tm');
  const q = new URLSearchParams(root.location.search);
  /* THE ADDRESS: ?from=&to=&by= (the leagues by name, the way of translating when it is not Blend). Never ?t=, ?l= or
     ?mode=: the first two name a club and a league to the rail and to a preview (access.js peekSubject), and robots.txt
     keeps ?mode= addresses out of search */
  const st = { from: q.get('from') || '', to: q.get('to') || '', mode: MODES.some(x => x[0] === q.get('by')) ? q.get('by') : 'blend', stab: false, min: 700, gp: 30,
    inputs: E ? E.META.map(() => '') : [], loaded: null, lo: 0, hi: 0, excluded: new Set(), robust: true, talent: false, exOpen: false, moversAll: false, moversKey: '',
    idx: { m: 'bpm', lo: 0, hi: 0, win: 3, picks: [], custom: false, ledger: '', allRanks: false } };
  let RAW = null, D = null, data = null, state = 'idle', chart = null, F = 0, T = 0, last = null;
  const idxCache = new Map();
  const reduced = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tick = ms => new Promise(r => root.setTimeout(r, ms || 0));
  const address = () => {
    try {
      const u = new URL(root.location.href), p = u.searchParams;
      const set = (k, v) => (v ? p.set(k, v) : p.delete(k));
      set('from', st.from); set('to', st.to); set('by', st.mode === 'blend' ? '' : st.mode);
      root.history.replaceState(null, '', u);
    } catch (_) { /* no address */ }
  };

  /* ---- members only ---- */
  const A = () => root.EpinoiaAccess, M = () => root.EpinoiaMemLock;
  const lockedNow = () => !!(M() && M().locked && M().locked(KEY));
  function drawLocked() {
    destroyChart();
    MEMBER.forEach(id => {
      const host = $(id + 'B'); if (!host) return;
      host.textContent = ''; host.removeAttribute('aria-busy');
      const node = M() && M().placeholder ? M().placeholder({ rows: PH_ROWS[id], what: WHAT, key: KEY }) : null;
      if (node) host.appendChild(node); else host.innerHTML = empty('Members’ analysis');
    });
    try { if (A() && A().queuePeekFill) A().queuePeekFill(); } catch (_) { /* no previews */ }
  }

  /* ---- the loading state: #data's line and What wins' block bar ---- */
  const STAGES = [['download', 'Downloading'], ['model', 'Working out the leagues'], ['index', 'Rating every season'], ['draw', 'Drawing']];
  function statusShell() {
    $('dataB').innerHTML = '<div class="ww-status"><p class="ww-line tm-line" id="tmLine" aria-live="polite">Loading the transfer matrix…</p>' +
      '<div class="ww-prog hide" id="tmProg" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-labelledby="tmProgL">' +
      '<ol class="ww-stages">' + STAGES.map(([k, t]) => '<li data-stage="' + k + '">' + esc(t) + '</li>').join('') + '</ol>' +
      '<div class="ww-blocks" id="tmBlocks" aria-hidden="true">' + '<i></i>'.repeat(24) + '</div><p class="ww-progl" id="tmProgL" aria-live="polite"></p></div>' +
      '</div><div id="tmSet"></div>';
  }
  function stage(name, frac, text) {
    const prog = $('tmProg'); if (!prog) return;
    prog.classList.remove('hide');
    const i = STAGES.findIndex(s => s[0] === name);
    const pct = Math.round(100 * Math.min(1, (Math.max(0, i) + Math.max(0, Math.min(1, frac || 0))) / STAGES.length));
    prog.setAttribute('aria-valuenow', String(pct));
    if (text != null) prog.setAttribute('aria-valuetext', text);
    const all = i === STAGES.length - 1 && frac >= 1;
    prog.querySelectorAll('li').forEach((li, k) => { li.classList.toggle('on', k === i && !all); li.classList.toggle('done', k < i || all); });
    prog.querySelectorAll('.ww-blocks i').forEach((b, k) => b.classList.toggle('on', k < Math.round(24 * pct / 100)));
    if (text != null) $('tmProgL').textContent = text;
  }
  const line = html => { const l = $('tmLine'); if (l) l.innerHTML = html; };

  /* the store, from the private bucket through the loader: the gate asked every visit, the file downloaded only when it
     is not already on this device (transferdata.js) */
  async function fetchStore() {
    const TD = root.EpinoiaTransferData;
    if (!TD || typeof TD.load !== 'function') { const e = new Error('no loader'); e.reason = 'network'; throw e; }
    return TD.load('transfer', { onProgress: p => {
      if (p.stage === 'download') stage('download', 0.3, 'Downloading the player data');
      else if (p.stage === 'unzip') stage('download', 0.8, p.cached ? 'Opening the copy on this device' : 'Unpacking the player data');
    } });
  }
  /* what the server said, said to the reader: the lock, a sign-in, a wait, or a message with a way to try again */
  function refused(e) {
    const why = (e && e.reason) || 'network';
    const prog = $('tmProg'); if (prog) prog.classList.add('hide');
    if (why === 'members') { state = 'locked'; drawLocked(); return; }
    MEMBER.slice(1).forEach(id => { const h = $(id + 'B'); if (h) { h.innerHTML = empty('Members’ analysis'); h.removeAttribute('aria-busy'); } });
    const again = ' <button type="button" class="ep-btn" data-act="retry">Try again</button>';
    if (why === 'signin') {
      let href = '/epinoia/signin/';
      try { if (A() && A().signinHref) href = A().signinHref(); } catch (_) { /* the default */ }
      line('<span>Sign in again to load the player data.</span> <a class="ep-btn" href="' + esc(href) + '">Sign in</a>');
    } else if (why === 'rate') {
      /* one sentence (a count between two halves translates badly); the button waits out the server's Retry-After */
      line('<span>Too many requests just now. Try again in a few minutes.</span>' + again);
      const b = doc.querySelector('#tmLine [data-act="retry"]');
      if (b) { b.disabled = true; root.setTimeout(() => { b.disabled = false; }, 1000 * Math.min(900, Math.max(5, +e.retryAfter || 60))); }
    } else if (why === 'none' || why === 'scope') line('<span>The player data is not available just now.</span>' + again);
    else if (why === 'unsupported') line('<span>This browser cannot open the player data. Please update it, or try another browser.</span>');
    else if (why === 'layout') line('<span>The player data has been rebuilt. Reload the page to get the new version.</span>');
    else line('<span>The player data could not be loaded just now.</span>' + again);
  }

  let run = 0;
  async function start() {
    if (state === 'loading' || state === 'ready') return;
    const my = ++run;
    state = 'loading';
    statusShell();
    MEMBER.slice(1).forEach(id => { const h = $(id + 'B'); if (h) { h.innerHTML = '<div class="pg-empty tm-wait"><p>Loading…</p></div>'; h.setAttribute('aria-busy', 'true'); } });
    if (!E || !V()) { line('The page could not be loaded.'); state = 'error'; return; }
    stage('download', 0, 'Asking for the player data');
    let C;
    try { C = await fetchStore(); }
    catch (e) {
      if (my !== run) return;
      state = 'error';
      const why = (e && e.reason) || 'network';
      if (root.console && ['signin', 'members', 'aborted'].indexOf(why) < 0) root.console.warn('[transfer]', why);
      if (why === 'aborted') { state = 'idle'; settle(); return; }   // the account changed while it loaded: as it is now
      refused(e);
      return;
    }
    if (my !== run) return;                                  // locked again meanwhile (signed out in another tab)
    stage('model', 0, 'Working out the leagues');
    await tick(30);
    if (my !== run) return;
    try { RAW = E.decodeStore(C); } catch (e) { state = 'error'; line('The player data could not be read.'); if (root.console) root.console.warn('[transfer]', e); return; }
    C = null;
    const ys = RAW.years.slice().sort((a, b) => a - b);
    st.lo = st.idx.lo = ys[0]; st.hi = st.idx.hi = ys[ys.length - 1];
    D = derive();
    pickRoute();
    stage('index', 0, 'Rating every season');
    await tick(30);
    if (my !== run) return;
    data = indexData();
    stage('draw', 0.5, 'Drawing');
    await tick(16);
    if (my !== run) return;
    state = 'ready';
    drawAll();
    stage('draw', 1, 'Done');
    root.setTimeout(() => { const p = $('tmProg'); if (p) p.classList.add('hide'); }, reduced() ? 0 : 900);
    const asof = $('tmAsof');
    if (asof) asof.innerHTML = '<span>Data built</span> <span translate="no">' + esc(RAW.info.built || '') + '</span> · <span>seasons</span> <span translate="no">' +
      esc(yearLabel(RAW, ys[0]) + ' – ' + yearLabel(RAW, ys[ys.length - 1])) + '</span>';
  }

  /* ---- the model ---- */
  const opts = () => ({ robust: st.robust, talent: st.talent, excluded: st.excluded });
  const derive = () => E.deriveD(RAW, st.lo, st.hi, Object.assign(opts(), { lazySpain: true }));
  function indexData() {
    const k = [st.idx.win, st.idx.lo, st.idx.hi, st.idx.m, st.robust ? 1 : 0, st.talent ? 1 : 0, [...st.excluded].sort().join('|')].join('#');
    if (!idxCache.has(k)) idxCache.set(k, E.computeIndex(RAW, st.idx.win, Math.min(st.idx.lo, st.idx.hi), Math.max(st.idx.lo, st.idx.hi), st.idx.m, opts()));
    const d = idxCache.get(k);
    if (!st.idx.custom) st.idx.picks = d.leagues.slice(0, TOP_PICKS);
    if (!st.idx.ledger || !d.leagues.includes(st.idx.ledger)) st.idx.ledger = d.leagues[0] || '';
    return d;
  }
  /* the route by name, kept across a new window; the first time, Primera FEB up to ACB when both are in. A from-league
     that is gone (left out) takes the default, and its average as the input, as picking a league does */
  function pickRoute() {
    const has = n => D.leagues.indexOf(n), acb = has('Spanish ACB'), feb = has('Spanish Primera FEB');
    let f = has(st.from), t = has(st.to);
    const lost = f < 0;
    if (f < 0) f = feb >= 0 && acb >= 0 ? feb : 0;
    if (t < 0) t = acb >= 0 && acb !== f ? acb : (f === 0 ? Math.min(1, D.leagues.length - 1) : 0);
    F = f; T = t; st.to = D.leagues[t];
    if (lost) { st.from = D.leagues[f]; st.loaded = null; prefill(); }
  }
  function prefill() { st.inputs = D.means[F].map(v => v.toFixed(1)); }

  /* ---- drawing ---- */
  function drawAll() {
    drawData(); drawTranslate(); drawIndex(); address();
  }
  function drawData() {
    $('dataB').removeAttribute('aria-busy');
    line(statusHTML(D, RAW, st));
    $('tmSet').innerHTML = settingsHTML(RAW, st);
    const ex = $('tmEx'); if (ex) ex.addEventListener('toggle', () => { st.exOpen = ex.open; });
  }
  function drawTranslate() {
    const host = $('translateB');
    host.removeAttribute('aria-busy');
    /* no Spanish league in the window (or left out): no Spanish scale, as the old app greyed it */
    if (st.mode === 'spain' && !D.spainAvailable) st.mode = 'blend';
    host.innerHTML = translateHTML(D, st);
    const sp = host.querySelector('[data-act="mode"][data-v="spain"]');
    if (sp && !D.spainAvailable) { sp.disabled = true; sp.title = 'No Spanish league in these seasons'; }
    showLoaded();
    compute();
  }
  function compute() {
    const inputs = st.inputs.map(v => (v === '' || v == null ? NaN : parseFloat(v)));
    const tr = E.translate(D, F, T, inputs, { mode: st.mode, minutes: parseFloat(st.min) || 0, stabilise: st.stab });
    last = tr;
    $('tmSum').innerHTML = summaryHTML(D, F, T, tr, st);
    tr.rows.forEach((r, k) => {
      const c = cellText(E.META[k], r), o = $('tmOut' + k), d = $('tmD' + k);
      if (o) o.textContent = c.out;
      if (d) { d.textContent = c.d; d.className = 'tm-d ' + c.cls; }
    });
    drawMovers();
  }
  function drawMovers() {
    const host = $('moversB');
    host.removeAttribute('aria-busy');
    const key = F + '>' + T;
    if (key !== st.moversKey) { st.moversKey = key; st.moversAll = false; }
    host.innerHTML = moversHTML(D, F, T, last ? last.bpmIn : null, st);
  }
  function destroyChart() { if (chart) { try { chart.destroy(); } catch (_) { /* gone */ } chart = null; } }
  function drawIndex() {
    const host = $('indexB');
    host.removeAttribute('aria-busy');
    destroyChart();
    host.innerHTML = indexCtlHTML(RAW, st);
    drawIndexParts();
  }
  /* what a new measure, season range or window changes: never the pickers themselves, so a keyboard keeps its place */
  function drawIndexParts() {
    const note = $('tmIdxNote'); if (note) note.textContent = measureNote(data.metric);
    drawChart();
    drawRanks();
    drawLedger();
  }
  function drawChart() {
    $('tmPicks').innerHTML = picksHTML(data, st);
    destroyChart();
    const series = chartSeries(data, st), slot = $('tmChart');
    const m = E.IDX_METRICS[data.metric] || E.IDX_METRICS.bpm;
    if (!series.length) { slot.innerHTML = empty('Put a league on the chart with ◉ in the ranks below'); return; }
    const VK = V();
    chart = VK.bind(slot, o => VK.line(series, { W: o.W, x: { label: 'Season', fmt: v => (Math.abs(v - Math.round(v)) < 1e-6 ? short(Math.round(v)) : '') },
      y: { label: measureLabel(data.metric), fmt: v => (m.dec ? fx(v, 1) : fx(v, 0)) }, title: 'League strength over time', desc: measureNote(data.metric) }), { label: 'League strength over time' });
  }
  function drawRanks() {
    const host = $('ranksB');
    host.removeAttribute('aria-busy');
    host.innerHTML = ranksHTML(data, st, RAW);
  }
  function drawLedger() {
    const host = $('ledgerB');
    host.removeAttribute('aria-busy');
    const L = st.idx.ledger ? E.ledger(RAW, data, st.idx.ledger, opts()) : null;
    host.innerHTML = ledgerHTML(data, L, st);
  }

  /* the control that had focus, found again after its section is drawn anew (its id, or its data-act and data-v) */
  function keepFocus(fn) {
    const a = doc.activeElement;
    let sel = null;
    if (a && a !== doc.body && frame.contains(a)) {
      if (a.id) sel = '#' + a.id;
      else if (a.getAttribute('data-act')) sel = '[data-act="' + a.getAttribute('data-act') + '"]' + (a.getAttribute('data-v') != null ? '[data-v="' + String(a.getAttribute('data-v')).replace(/["\\]/g, '\\$&') + '"]' : '');
    }
    fn();
    if (sel) { const el = frame.querySelector(sel); if (el && el.focus) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } } }
  }
  /* ---- a change that needs the model worked out again ---- */
  let busy = 0;
  async function rederive(withIndex) {
    const my = ++busy;
    line('<span>Working it out…</span>');
    frame.setAttribute('aria-busy', 'true');
    await tick(30);
    if (my !== busy || state !== 'ready') return;
    D = derive();
    pickRoute();
    if (withIndex) data = indexData();
    frame.removeAttribute('aria-busy');
    keepFocus(() => { drawData(); drawTranslate(); if (withIndex) drawIndex(); });
    address();
  }
  async function reindex() {
    const my = ++busy;
    $('tmPicks').innerHTML = '<span class="ww-mute">Working it out…</span>';
    await tick(30);
    if (my !== busy || state !== 'ready') return;
    data = indexData();
    keepFocus(drawIndexParts);
  }

  /* ---- the player search ---- */
  let resIds = [];
  function search() {
    const box = $('tmRes'), inp = $('tmQ');
    const ids = E.searchPlayers(D, F, inp.value, 14);
    resIds = ids;
    if (inp.value.trim().length < 2) { box.hidden = true; inp.setAttribute('aria-expanded', 'false'); return; }
    box.innerHTML = ids.length ? ids.map((i, j) => {
      const p = D.players[i];
      return '<button type="button" class="tm-hit" role="option" id="tmHit' + j + '" data-act="hit" data-v="' + i + '"><b translate="no">' + esc(p[0]) + '</b>' +
        '<span class="tm-hitm"><span translate="no">' + esc(p[1]) + ' · ' + esc(p[3]) + '</span> · <span>' + p[4] + ' games</span> · <span>' + p[5] + ' min</span></span>' +
        '<span class="tm-hitb"><span translate="no">BPM</span> ' + sg(p[6]) + '</span></button>';
    }).join('') : '<p class="tm-none">Nobody by that name in this league</p>';
    box.hidden = false; inp.setAttribute('aria-expanded', 'true');
  }
  function closeSearch() { const box = $('tmRes'), inp = $('tmQ'); if (box) box.hidden = true; if (inp) inp.setAttribute('aria-expanded', 'false'); }
  function loadPlayer(i) {
    const p = D.players[i];
    st.inputs = E.META.map((m, k) => (p[6 + k] === null ? '' : String(p[6 + k])));
    st.min = p[5]; st.gp = p[4];
    st.loaded = { name: p[0], season: p[1], teams: p[3] };
    E.META.forEach((m, k) => { const el = $('tmIn' + k); if (el) el.value = st.inputs[k]; });
    $('tmMin').value = st.min; $('tmGP').value = st.gp;
    $('tmQ').value = p[0];
    closeSearch(); showLoaded(); compute();
  }
  function showLoaded() {
    const el = $('tmLoaded'); if (!el) return;
    if (!st.loaded) { el.hidden = true; el.textContent = ''; return; }
    el.innerHTML = '<span class="ep-chip on"><span>Loaded</span>: <b translate="no">' + esc(st.loaded.name) + '</b> · <span translate="no">' + esc(st.loaded.season) + ' · ' + esc(st.loaded.teams) + '</span></span>';
    el.hidden = false;
  }
  const unload = () => { if (st.loaded) { st.loaded = null; showLoaded(); } };

  /* ---- the leagues left out ---- */
  function toggleEx(n) {
    if (st.excluded.has(n)) st.excluded.delete(n);
    else { if (RAW.allLeagues.length - st.excluded.size <= 2) return false; st.excluded.add(n); }
    return true;
  }

  /* ---- every control, by delegation ---- */
  frame.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-act]');
    if (!b || state !== 'ready' && b.getAttribute('data-act') !== 'retry') return;
    const act = b.getAttribute('data-act'), v = b.getAttribute('data-v');
    if (b.tagName === 'SELECT' || (b.tagName === 'INPUT' && b.type !== 'button')) return;
    if (act === 'retry') { state = 'idle'; start(); return; }
    if (act === 'robust') { const on = v === '1'; if (on !== st.robust) { st.robust = on; rederive(true); } return; }
    if (act === 'talent') { const on = v === '1'; if (on !== st.talent) { st.talent = on; rederive(true); } return; }
    if (act === 'ncaa') {
      const ncaa = RAW.allLeagues.filter(n => n.toUpperCase().includes('NCAA'));
      if (ncaa.every(n => st.excluded.has(n))) ncaa.forEach(n => st.excluded.delete(n));
      else { const would = new Set([...st.excluded, ...ncaa]); if (RAW.allLeagues.length - would.size < 2) return; ncaa.forEach(n => st.excluded.add(n)); }
      rederive(true); return;
    }
    if (act === 'exclear') { st.excluded.clear(); rederive(true); return; }
    if (act === 'exclude') { if (toggleEx(v)) rederive(true); return; }
    if (act === 'swap') { const t = st.from; st.from = st.to; st.to = t; const i = F; F = T; T = i; $('tmFrom').value = st.from; $('tmTo').value = st.to; unload(); $('tmQ').value = ''; closeSearch(); compute(); address(); return; }
    if (act === 'mode') {
      if (v === st.mode) return;
      st.mode = v;
      $('tmModeRow').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.getAttribute('data-v') === v)));
      $('tmHint').textContent = MODE_HINT[v];
      compute(); address(); return;
    }
    if (act === 'hit') { loadPlayer(+v); return; }
    if (act === 'moversall') { st.moversAll = !st.moversAll; drawMovers(); const n = $('moversB').querySelector('[data-act="moversall"]'); if (n) n.focus(); return; }
    if (act === 'pick' || act === 'unpick') {
      const picks = st.idx.picks.slice(), at = picks.indexOf(v);
      if (at >= 0) picks.splice(at, 1); else { if (picks.length >= MAX_PICKS) picks.shift(); picks.push(v); }
      st.idx.picks = picks; st.idx.custom = true;
      keepFocus(drawChart);
      $('ranksB').querySelectorAll('.tm-pk').forEach(pk => {
        const n = pk.getAttribute('data-v'), on = picks.includes(n);
        pk.setAttribute('aria-pressed', String(on));
        const g = pk.querySelector('.tm-pkg'); if (g) g.textContent = on ? '◉' : '○';
      });
      return;
    }
    if (act === 'toppicks') { st.idx.custom = false; st.idx.picks = data.leagues.slice(0, TOP_PICKS); drawChart(); drawRanks(); return; }
    if (act === 'allranks') { st.idx.allRanks = !st.idx.allRanks; keepFocus(drawRanks); return; }
    if (act === 'ledger') {
      st.idx.ledger = v; drawLedger();
      $('ranksB').querySelectorAll('tr[data-lg]').forEach(tr => tr.classList.toggle('tm-sel', tr.getAttribute('data-lg') === v));
      const s = $('ledger'); if (s) s.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      return;
    }
  });
  frame.addEventListener('change', e => {
    const t = e.target, act = t.getAttribute && t.getAttribute('data-act');
    if (!act || state !== 'ready') return;
    if (act === 'lo' || act === 'hi') {
      st[act] = +t.value;
      if (st.lo > st.hi) { const x = st.lo; st.lo = st.hi; st.hi = x; }
      rederive(false); return;
    }
    if (act === 'ex') { if (!toggleEx(t.value)) { t.checked = true; return; } st.exOpen = true; rederive(true); return; }
    if (act === 'from' || act === 'to') {
      const i = D.leagues.indexOf(t.value); if (i < 0) return;
      if (act === 'from') { F = i; st.from = t.value; unload(); $('tmQ').value = ''; closeSearch(); prefill(); E.META.forEach((m, k) => { $('tmIn' + k).value = st.inputs[k]; }); }
      else { T = i; st.to = t.value; }
      compute(); address(); return;
    }
    if (act === 'stab') { st.stab = !!t.checked; compute(); return; }
    if (act === 'im') { st.idx.m = t.value; reindex(); return; }
    if (act === 'ilo') { st.idx.lo = +t.value; reindex(); return; }
    if (act === 'ihi') { st.idx.hi = +t.value; reindex(); return; }
    if (act === 'iw') { st.idx.win = +t.value; reindex(); return; }
    if (act === 'led') { st.idx.ledger = t.value; keepFocus(() => { drawRanks(); drawLedger(); }); return; }
  });
  let qT = 0;
  frame.addEventListener('input', e => {
    const t = e.target, act = t.getAttribute && t.getAttribute('data-act');
    if (state !== 'ready') return;
    if (t.id === 'tmQ') { root.clearTimeout(qT); qT = root.setTimeout(search, 120); return; }
    if (act === 'in') { st.inputs[+t.getAttribute('data-k')] = t.value; unload(); compute(); return; }
    if (act === 'min') { st.min = t.value; compute(); return; }
    if (act === 'gp') { st.gp = t.value; return; }
  });
  frame.addEventListener('keydown', e => {
    if (e.target && e.target.id === 'tmQ') {
      if (e.key === 'Escape') { closeSearch(); return; }
      if (e.key === 'ArrowDown') { const f = $('tmHit0'); if (f) { e.preventDefault(); f.focus(); } return; }
      if (e.key === 'Enter' && resIds.length) { e.preventDefault(); loadPlayer(resIds[0]); }
      return;
    }
    const hit = e.target && e.target.closest && e.target.closest('.tm-hit');
    if (hit && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const sib = e.key === 'ArrowDown' ? hit.nextElementSibling : hit.previousElementSibling;
      if (sib) sib.focus(); else if (e.key === 'ArrowUp') $('tmQ').focus();
    } else if (hit && e.key === 'Escape') { closeSearch(); $('tmQ').focus(); }
  });
  doc.addEventListener('click', e => { if (!(e.target.closest && e.target.closest('.tm-find'))) closeSearch(); });

  /* the chart kit translates a label whole before cutting it: the chart is drawn again once a language pack has arrived */
  try {
    const I = root.EpinoiaI18n;
    if (I && I.lang && I.lang !== 'en' && typeof I.whenReady === 'function') I.whenReady(() => { if (chart) { try { chart.redraw(); } catch (_) { /* redrawn since */ } } });
  } catch (_) { /* English */ }

  /* ---- the lock, now and whenever the account changes (a sign-in, a preview, a membership in another tab) ---- */
  function settle() {
    if (lockedNow()) {
      if (state !== 'locked') { run++; state = 'locked'; RAW = D = data = null; idxCache.clear(); drawLocked(); }
      return;
    }
    if (state === 'locked' || state === 'idle') { state = 'idle'; start(); }
  }
  (async function first() {
    try { if (A() && A().load) await A().load({}); } catch (_) { /* fails open */ }
    settle();
    try { if (A() && A().onChange) A().onChange(() => settle()); } catch (_) { /* no live changes */ }
  })();
}

return { boot, statusHTML, settingsHTML, translateHTML, summaryHTML, cellText, moversHTML, indexCtlHTML, picksHTML, chartSeries, ranksHTML, ledgerHTML,
  heatVar, gradeFrac, MODES, MODE_HINT, LEVEL, MEASURES, WINDOWS, measureNote, measureLabel, KEY, MEMBER };
}));
