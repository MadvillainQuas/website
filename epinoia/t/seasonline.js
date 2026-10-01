'use strict';
/* ============================================================================
   THE CLUB PAGE'S SEASON LINE (t/team.js, the "season line" card of Team statistics; kit/clubstats.css).

   THE RATINGS FIRST, AND APART: offensive, defensive and net rating on one row, each a big number, its place in
   the league, its gap to the league's average and a strip with every club on it (the club's own mark in its
   colour, the league's average a tick), always laid out so that better is to the right.

   THEN ONE TABLE IN FOUR GROUPS. A row the season's rows can rank has the value, the same strip, the rank and the
   gap to the average:
     TEMPO         PACE (possessions per 40 minutes, both sides averaged) and the AVERAGE POSSESSION
     EFFICIENCY    PPP (points per possession: ORTG / 100), TS%, FT% and MOREY% (the share of the club's shots taken
                   at the rim or from three: the box score's zones, and nothing where a league's feed has none)
     DISTRIBUTION  AST% (the club's baskets that were assisted), HELIOCENTRISM and BENCH MINS%
     AGAINST STARTERS & BENCH   the club's ORTG, DRTG and NET in the minutes the other side had its starting five on,
                   and in the minutes it had two of them or fewer (Louie, 2026-09-30: "see the other edits")

   FROM THE PLAY-BY-PLAY, AS THE WOWY PAGE READS IT. Four rows need the club's own game logs: the average possession,
   heliocentrism and the two against-starters rows. They are the WOWY page's own numbers (lineupevents.js, from the
   other chat's WOWY v2), summed over every minute of the club's logged games: one definition on the site.
     the possession    game-clock seconds from the change of possession to its last action (shotclock.js), own and
                       the opponents' beside it
     heliocentrism     how much of the offence runs through one man: each player's usage shared out within every five
                       he played in, the Herfindahl index of the shares averaged over the fives by the plays they used,
                       on 0 (five equal hands) to 100 (one man uses every play); the top user and his share of the
                       plays beside it (lineupevents.js helio)
     against starters  the minutes the opponent had all five of that game's starters on; against the bench, two or
                       fewer of them (lineupevents.js bucketOf: three or four is "mixed", shown on the WOWY page)
   The other clubs' logs are not read on this page, so these are not ranked. Members only, as the shot clock
   analysis and the WOWY page's play-by-play are.

   BENCH MINS%: the share of the club's minutes played by those who did not start, from each game's starters and
   the players' minutes. A side whose starters were never recorded, or whose starters are not among its minutes
   (an id the lines do not use), is left out rather than counted all bench.

   Style rows (pace, the possession, MOREY%, AST%, heliocentrism, the bench) have no good end: they are ranked by
   "most", drawn in one hue, and their strip's ends say what each way means.

   The sums are pure and tested (supabase/tests/seasonline.test.mjs); render() draws, and fills the rows that need a
   read of their own (the logs, the bench) when their promises answer.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSeasonLine = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const isNum = v => v != null && v !== '' && isFinite(+v);
const num = v => (isNum(v) ? +v : 0);
const r1 = v => (isNum(v) ? Math.round(+v * 10) / 10 : null);

function ordinal(n) {
  const t = n % 100, u = n % 10;
  return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
}

/* ---------------------------------------------------------------- the sums --- */
/* games: { id, home_team_id, away_team_id, starters: [homeIds, awayIds] }; lines: { game_id, pid, team_idx, min }
   (min as stored, in milliseconds) -> Map(club -> { bench, all (minutes), pct, games }) */
function bench(games, lines) {
  const G = new Map();
  (games || []).forEach(g => { if (g && g.id != null) G.set(g.id, g); });
  const sides = new Map();
  (lines || []).forEach(r => {
    const g = r && G.get(r.game_id);
    if (!g || !Array.isArray(g.starters) || (r.team_idx !== 0 && r.team_idx !== 1)) return;
    const five = (g.starters[r.team_idx] || []).filter(Boolean);
    if (five.length < 5) return;
    const m = num(r.min);
    if (!(m > 0)) return;
    const k = r.game_id + ':' + r.team_idx;
    let a = sides.get(k);
    if (!a) { a = { team: r.team_idx === 0 ? g.home_team_id : g.away_team_id, bench: 0, all: 0, seen: 0 }; sides.set(k, a); }
    a.all += m;
    if (five.indexOf(r.pid) === -1) a.bench += m; else a.seen++;
  });
  const out = new Map();
  sides.forEach(a => {
    if (a.seen < 4 || !a.team) return;          // the starters are not the ids these lines use
    const o = out.get(a.team) || { bench: 0, all: 0, games: 0 };
    o.bench += a.bench; o.all += a.all; o.games++;
    out.set(a.team, o);
  });
  out.forEach(o => {
    o.pct = o.all > 0 ? 100 * o.bench / o.all : null;
    o.bench /= 60000; o.all /= 60000;
  });
  return out;
}

/* THE CLUB'S PLAY-BY-PLAY, summed the way the WOWY page sums it. recs: lineupevents.js records from the club's side
   of each game (recordsOf), games: how many logs they came from, LE: lineupevents.js
   -> { games, all, start, bench (LE.line()s: ortg drtg net mins poss sclock helio helioTop helioShare helioEff
        helioUsage ...), oppClock: the opponents' average possession, in seconds } or null without a record */
function logSummary(recs, games, LE) {
  if (!LE || !recs || !recs.length) return null;
  const all = LE.sum(recs);
  return {
    games,
    all: LE.line(all),
    start: LE.line(LE.sum(LE.inBucket(recs, 'start'))),
    bench: LE.line(LE.sum(LE.inBucket(recs, 'bench'))),
    oppClock: all.eopp && all.eopp.scN > 0 ? all.eopp.scS / all.eopp.scN : null
  };
}

/* the share of a club's shots at the rim or from three, when its league's box score splits the twos by zone */
function morey(t) {
  if (!t || !(num(t.fga) > 0) || !isNum(t.rim_share) || !isNum(t.p3_share)) return null;
  const two = 100 - num(t.p3_share);
  if (two > 0.5 && num(t.rim_share) + num(t.mid_share) < 0.9 * two) return null;
  return num(t.rim_share) + num(t.p3_share);
}

/* where a club's value sits among the clubs. dir 1: higher is better, -1: lower is better, 0: a style, ranked by most.
   rank 1 is the best (or the most); pct 0..100, 100 the best end (or the most) */
function place(rows, get, id, dir) {
  const vals = [];
  let mine = null;
  (rows || []).forEach(r => {
    const v = get(r);
    if (!isNum(v)) return;
    vals.push(+v);
    if (r.id === id) mine = +v;
  });
  if (mine == null) return null;
  const n = vals.length;
  const lower = dir < 0;
  const rank = 1 + vals.filter(v => (lower ? v < mine : v > mine)).length;
  const behind = vals.filter(v => (lower ? v > mine : v < mine)).length;
  const level = vals.filter(v => v === mine).length - 1;
  const avg = vals.reduce((s, v) => s + v, 0) / n;
  return { v: mine, n, rank, pct: n > 1 ? 100 * (behind + level / 2) / (n - 1) : null, avg,
           lo: Math.min(...vals), hi: Math.max(...vals), vals };
}

/* five bands from a percentile, 1 the worst end, 5 the best */
function band(pct) {
  if (!isNum(pct)) return 0;
  return 1 + Math.min(4, Math.floor(+pct / 20));
}

/* put the readings on the season's club rows, so the ranks, the strips and the tap-for-a-chart read them there */
function prepare(S) {
  if (!S || !Array.isArray(S.teams)) return;
  S.teams.forEach(t => {
    t.ppp = isNum(t.ortg) ? Math.round(+t.ortg * 10) / 1000 : null;
    t.morey = r1(morey(t));
  });
}
function attachBench(S, B) {
  if (!S || !Array.isArray(S.teams) || !B) return;
  S.teams.forEach(t => { const b = B.get(t.id); t.bench_min_pct = b && isNum(b.pct) ? r1(b.pct) : null; t.bench_games = b ? b.games : 0; });
}

/* ------------------------------------------------------------- the rows --- */
/* dir as place(); ends: the strip's left and right, most: the word for rank 1 of a style; log: from the club's own
   play-by-play (not ranked), drawn by its `kind` */
const RATINGS = [
  { k: 'ortg', l: 'ORTG', sub: 'points per 100 possessions', dir: 1, dp: 1 },
  { k: 'drtg', l: 'DRTG', sub: 'points allowed per 100 possessions', dir: -1, dp: 1 },
  { k: 'net', l: 'NET', sub: 'ORTG minus DRTG', dir: 1, dp: 1, signed: true }
];
const GROUPS = [
  { key: 'tempo', title: 'Tempo', rows: [
    { k: 'pace', l: 'PACE', sub: 'possessions per 40 minutes', dir: 0, ends: ['slower', 'faster'], most: 'fastest', dp: 1 },
    { k: 'poss_time', l: 'AVG POSSESSION', sub: 'seconds from winning the ball to the last action', dir: 0, dp: 1, unit: ' s', log: 'clock' }
  ] },
  { key: 'efficiency', title: 'Efficiency', rows: [
    { k: 'ppp', l: 'PPP', sub: 'points per possession', dir: 1, dp: 2 },
    { k: 'ts', l: 'TS%', sub: 'points per shot, free throws counted', dir: 1, dp: 1 },
    { k: 'ft_pct', l: 'FT%', sub: 'free throws made', dir: 1, dp: 1 },
    { k: 'morey', l: 'MOREY%', sub: 'shots at the rim or from three', dir: 0, ends: ['fewer', 'more'], most: 'highest', dp: 1 }
  ] },
  { key: 'distribution', title: 'Distribution', rows: [
    { k: 'ast_pct', l: 'AST%', sub: 'baskets that were assisted', dir: 0, ends: ['fewer', 'more'], most: 'highest', dp: 1 },
    { k: 'helio', l: 'HELIOCENTRISM', sub: 'how much of the offence runs through one player: 0 shared evenly, 100 one player', dir: 0, dp: 1, log: 'helio' },
    { k: 'bench_min_pct', l: 'BENCH MINS%', sub: 'minutes played by those who did not start', dir: 0, ends: ['starters', 'bench'], most: 'highest', dp: 1, later: true }
  ] },
  { key: 'matchups', title: 'Against starters & bench', rows: [
    { k: 'vs_start', l: 'VS STARTERS', sub: 'the minutes the other side had all five of its starters on', dir: 1, dp: 1, signed: true, log: 'trio', part: 'start' },
    { k: 'vs_bench', l: 'VS BENCH', sub: 'the minutes it had two of its starters on, or fewer', dir: 1, dp: 1, signed: true, log: 'trio', part: 'bench' }
  ] }
];
const KEYS = RATINGS.concat(...GROUPS.map(g => g.rows)).map(d => d.k);
const ROWS = GROUPS.map(g => g.rows).flat();

/* ---------------------------------------------------------------- drawing --- */
function h(tag, cls, text) {
  const n = root.document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const txt = t => root.document.createTextNode(t);
function fmt(v, d) {
  if (!isNum(v)) return '—';
  const x = +v;
  return (d.signed && x > 0 ? '+' : '') + x.toFixed(d.dp == null ? 1 : d.dp) + (d.unit || '');
}
function gapText(P, d) {
  if (!P || P.n < 3) return null;
  const g = P.v - P.avg, dp = d.dp == null ? 1 : d.dp;
  if (Number(Math.abs(g).toFixed(dp)) === 0) return { text: 'level', tone: '' };
  const good = d.dir === 0 ? '' : ((d.dir > 0 ? g > 0 : g < 0) ? 'good' : 'bad');
  return { text: (g > 0 ? '+' : '−') + Math.abs(g).toFixed(dp), tone: good };
}

/* the league on a line: every club a dot, the average a tick, this club the big mark; better (or more) to the right */
function strip(P, d) {
  const s = h('div', 'cs-strip' + (d.dir === 0 ? ' style' : ''));
  s.setAttribute('aria-hidden', 'true');
  if (!P || P.n < 2 || !(P.hi > P.lo)) { s.classList.add('flat'); return s; }
  const at = v => {
    let x = (v - P.lo) / (P.hi - P.lo);
    if (d.dir < 0) x = 1 - x;
    return (3 + 94 * x).toFixed(2) + '%';
  };
  P.vals.forEach(v => { const i = h('i'); i.style.left = at(v); s.appendChild(i); });
  const u = h('u'); u.style.left = at(P.avg); s.appendChild(u);
  const b = h('b'); b.style.left = at(P.v); s.appendChild(b);
  return s;
}
function ends(d) {
  const e = h('div', 'cs-ends');
  const pair = d.dir === 0 ? (d.ends || ['less', 'more']) : ['worse', 'better'];
  e.append(h('span', null, pair[0]), h('span', null, pair[1]));
  return e;
}
function pill(P, d) {
  if (!P || P.n < 2) return h('span', 'cs-rk none', '—');
  const b = d.dir === 0 ? 0 : band(P.pct);
  const p = h('span', 'cs-rk' + (d.dir === 0 ? ' style' : ''));
  if (b) p.dataset.b = String(b);
  p.appendChild(h('b', null, ordinal(P.rank)));
  p.appendChild(txt(' ' + (d.dir === 0 && d.most ? d.most + ' ' : '') + 'of ' + P.n));
  return p;
}
function tip(P, d) {
  if (!P) return '';
  return d.l + ' ' + fmt(P.v, d) + ' · ' + ordinal(P.rank) + (d.dir === 0 && d.most ? ' ' + d.most : '') + ' of ' + P.n +
    ' · league average ' + fmt(P.avg, d) + ' · range ' + fmt(P.lo, d) + ' to ' + fmt(P.hi, d);
}

function ratingTile(d, S, mine, o) {
  const P = place(S.teams, r => r[d.k], mine.id, d.dir);
  const t = h('div', 'csr-t');
  t.dataset.k = d.k;
  const top = h('div', 'csr-h');
  top.append(h('span', 'csr-l', d.l), pill(P, d));
  const v = h('div', 'csr-v', fmt(P ? P.v : null, d));
  const sub = h('div', 'csr-s');
  const g = gapText(P, d);
  sub.appendChild(h('span', 'csr-d', d.sub + (g ? ' · ' : '')));
  if (g) sub.append(h('b', 'cs-gap ' + g.tone, g.text), txt(' vs avg'));
  t.append(top, v, sub, strip(P, d), ends(d));
  t.title = tip(P, d);
  if (o.bind && P) o.bind(t, d);
  return t;
}

/* ---- the rows from the play-by-play ---- */
const fig = (label, value, cls) => {
  const s = h('span', 'cst-fig' + (cls ? ' ' + cls : ''));
  const l = h('span', 'cst-fig-l', label);
  l.setAttribute('data-i18n-ctx', 'col');
  s.append(l, h('b', null, value));
  return s;
};
const minsText = L => 'over ' + Math.round(num(L.mins)) + ' min · ' + Math.round(num(L.poss)) + ' possessions';

/* the value and the note of a log row, from logSummary() (x), the club's overall line beside it where it helps */
function logCell(d, x, nameOf) {
  const out = { v: null, note: null };
  if (d.log === 'clock') {
    const own = x.all.sclock, opp = x.oppClock;
    out.v = own;
    if (own == null) { out.why = 'no possession could be timed'; return out; }
    const n = h('div', 'cst-vs');
    const a = h('span', 'cst-vs-own'), b = h('span', 'cst-vs-opp');
    a.append(txt('offence '), h('b', null, own.toFixed(1) + ' s'));
    b.append(txt('defence '), h('b', null, opp == null ? '—' : opp.toFixed(1) + ' s'));
    const bar = h('span', 'cst-vs-bar');
    if (opp != null && own + opp > 0) bar.style.setProperty('--own', (100 * own / (own + opp)).toFixed(1) + '%');
    n.append(a, bar, b, h('span', 'cst-vs-n', 'over ' + x.games + (x.games === 1 ? ' game' : ' games') + ' of the club’s own logs · not ranked: the other clubs’ logs are not read here'));
    out.note = n;
    return out;
  }
  if (d.log === 'helio') {
    const L = x.all;
    out.v = L.helio;
    if (L.helio == null) { out.why = 'too few plays used yet'; return out; }
    const n = h('div', 'cst-helio');
    const bar = h('span', 'cst-helio-bar');
    bar.style.setProperty('--h', Math.max(0, Math.min(100, +L.helio)).toFixed(1) + '%');
    bar.setAttribute('aria-hidden', 'true');
    const e = h('div', 'cs-ends');
    e.append(h('span', null, 'shared'), h('span', null, 'one player'));
    const who = h('span', 'cst-helio-who');
    const nm = h('b', 'cst-helio-name');
    who.append(nm, txt(' used ' + num(L.helioShare).toFixed(1) + '% of the plays · usage ' + num(L.helioUsage).toFixed(1) +
      '% while on · shared like ' + num(L.helioEff).toFixed(1) + ' equal hands of 5'));
    nm.textContent = 'The top user';
    if (L.helioTop && nameOf) Promise.resolve(nameOf(L.helioTop)).then(t => { if (t) nm.textContent = t; }).catch(() => {});
    n.append(bar, e, who);
    out.note = n;
    return out;
  }
  /* trio: against the starters, or the bench */
  const L = x[d.part];
  out.v = L && L.poss ? L.net : null;
  if (!L || !L.poss) { out.why = 'no minutes against them on record yet'; return out; }
  const n = h('div', 'cst-trio');
  const tone = v => (v > 0 ? 'good' : v < 0 ? 'bad' : '');
  n.append(fig('ORTG', fmt(L.ortg, { dp: 1 })), fig('DRTG', fmt(L.drtg, { dp: 1 })));
  const all = x.all && x.all.poss ? x.all.net : null;
  if (all != null && L.net != null) {
    const dlt = L.net - all;
    n.appendChild(fig('vs all minutes', (dlt > 0 ? '+' : dlt < 0 ? '−' : '') + Math.abs(dlt).toFixed(1), 'gap ' + tone(dlt)));
  }
  n.appendChild(h('span', 'cst-trio-n', minsText(L)));
  out.note = n;
  out.tone = tone(L.net);
  return out;
}

function statRow(d, S, mine, o) {
  const tr = h('tr', 'r');
  tr.dataset.k = d.k;
  const th = h('th', 'l');
  th.scope = 'row';
  th.append(h('span', 'cst-l', d.l), h('span', 'cst-sub', d.sub));
  if (d.log) {
    tr.appendChild(th);
    const x = o.logs;
    const c = x === undefined ? null : x && x.all ? logCell(d, x, o.nameOf) : { v: null, why: (x && x.why) || 'not recorded for this club' };
    const v = h('td', 'v' + (c && c.tone ? ' ' + c.tone : ''), x === undefined ? '…' : fmt(c.v, d));
    const n = h('td', 'cst-club');
    n.colSpan = 3;
    if (c && c.note) n.appendChild(c.note);
    else n.appendChild(h('span', 'cst-wait', x === undefined ? 'reading the play-by-play…' : (c.why || 'not recorded for this club')));
    tr.append(v, n);
    return tr;
  }
  const P = place(S.teams, r => r[d.k], mine.id, d.dir);
  const later = d.later && o.pending && o.pending[d.k];
  const v = h('td', 'v', later ? '…' : fmt(P ? P.v : null, d));
  const lg = h('td', 'lg');
  lg.append(strip(later ? null : P, d), ends(d));
  const rk = h('td', 'rk');
  rk.appendChild(later ? h('span', 'cs-rk none', '…') : pill(P, d));
  const gp = h('td', 'gap');
  const g = later ? null : gapText(P, d);
  if (g) gp.appendChild(h('b', 'cs-gap ' + g.tone, g.text));
  else gp.textContent = '—';
  if (o.extra && o.extra[d.k]) th.appendChild(o.extra[d.k]);
  tr.append(th, v, lg, rk, gp);
  tr.title = later ? '' : tip(P, d);
  if (o.bind && P && !later) o.bind(tr, d);
  return tr;
}

/* host: the card's body. ctx: { S, mine, bind(node, def), logs: Promise<logSummary() | { why }>, bench: Promise<Map>
   (bench()), nameOf(id): Promise<name> } */
function render(host, ctx) {
  const S = ctx.S, mine = ctx.mine;
  prepare(S);
  const wrap = h('div', 'csl');
  wrap.setAttribute('data-i18n-ctx', 'seasonline');           // the strips' ends and the groups' words (i18n/es.js, ja.js)
  const rt = h('div', 'csr');
  RATINGS.forEach(d => rt.appendChild(ratingTile(d, S, mine, ctx)));
  wrap.appendChild(rt);

  const bx = h('span', 'cst-x');
  const o = { bind: ctx.bind, logs: undefined, nameOf: ctx.nameOf, pending: { bench_min_pct: !!ctx.bench }, extra: { bench_min_pct: bx } };
  const tw = h('div', 'cst-wrap');
  const table = h('table', 'cst');
  const thead = h('thead');
  const hr = h('tr');
  [['stat', 'l'], ['value', 'v'], ['league', 'lg'], ['rank', 'rk'], ['vs avg', 'gap']].forEach(([t, c]) => hr.appendChild(h('th', c, t)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const rows = {};
  GROUPS.forEach(G => {
    const tb = h('tbody', 'cst-g');
    tb.dataset.g = G.key;
    const gh = h('tr', 'cst-gh');
    const c = h('th', null, G.title);
    c.colSpan = 5;
    gh.appendChild(c);
    tb.appendChild(gh);
    G.rows.forEach(d => { const r = statRow(d, S, mine, o); rows[d.k] = r; tb.appendChild(r); });
    table.appendChild(tb);
  });
  tw.appendChild(table);
  wrap.appendChild(tw);
  host.appendChild(wrap);

  const redraw = k => {
    const d = ROWS.find(x => x.k === k);
    if (!d || !rows[k] || !rows[k].parentNode) return;
    const nr = statRow(d, S, mine, o);
    rows[k].replaceWith(nr);
    rows[k] = nr;
  };
  const logRows = ROWS.filter(d => d.log).map(d => d.k);

  /* the play-by-play: the possession, heliocentrism, against the starters and the bench */
  Promise.resolve(ctx.logs).then(x => { o.logs = x || null; logRows.forEach(redraw); })
    .catch(() => { o.logs = { why: 'the play-by-play could not be read' }; logRows.forEach(redraw); });
  /* the bench, from every game's starters and minutes */
  if (ctx.bench) {
    Promise.resolve(ctx.bench).then(B => {
      attachBench(S, B);
      const b = B && B.get(mine.id);
      bx.textContent = b && b.games ? 'over ' + b.games + (b.games === 1 ? ' game' : ' games') + ' with the starters on record' : '';
      o.pending.bench_min_pct = false; redraw('bench_min_pct');
    }).catch(() => { o.pending.bench_min_pct = false; redraw('bench_min_pct'); });
  }
  return wrap;
}

return { bench, logSummary, morey, place, band, ordinal, prepare, attachBench, render, RATINGS, GROUPS, KEYS };
}));
