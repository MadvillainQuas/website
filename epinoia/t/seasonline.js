'use strict';
/* ============================================================================
   THE CLUB PAGE'S SEASON LINE (t/team.js, the "season line" card of Team statistics; kit/clubstats.css).

   THE RATINGS FIRST, AND APART: offensive, defensive and net rating on one row, each a big number, its place in
   the league, its gap to the league's average and a strip with every club on it (the club's own mark in its
   colour, the league's average a tick), always laid out so that better is to the right.

   THEN ONE TABLE IN THREE GROUPS, each row the value, the same strip, the rank and the gap to the average:
     TEMPO         PACE (possessions per 40 minutes, both sides averaged) and the AVERAGE POSSESSION: game-clock
                   seconds from the change of possession to its last action (shotclock.js), over the club's own
                   logs, with its opponents' beside it. The league has no logs on this page, so it is not ranked.
     EFFICIENCY    PPP (points per possession: ORTG / 100), TS%, FT% and MOREY% (the share of the club's shots taken
                   at the rim or from three: the box score's zones, and nothing where a league's feed has none).
     DISTRIBUTION  AST% (the club's baskets that were assisted), HELIOCENTRISM% and BENCH MINS%.

   HELIOCENTRISM (Louie, 2026-09-30): how far a club depends on one player, through usage. The share of the club's
   used possessions (FGA + 0.44 x FTA + TOV, the count usage rate is made of) that its busiest player used. The other
   side of it, how evenly the ball is shared, is said beside it as the effective number of users: 1 / the sum of
   every player's squared share ("spread like 5.8 equal users", a Herfindahl reading).
   BENCH MINS%: the share of the club's minutes played by those who did not start, from each game's starters and
   the players' minutes. A side whose starters were never recorded, or whose starters are not among its minutes
   (an id the lines do not use), is left out rather than counted all bench.

   Style rows (pace, the possession, MOREY%, AST%, heliocentrism, the bench) have no good end: they are ranked by
   "most", drawn in one hue, and their strip's ends say what each way means.

   The sums are pure and tested (supabase/tests/seasonline.test.mjs); render() draws, and fills the two rows that
   need a read of their own (the possession, the bench) when their promises answer.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSeasonLine = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const isNum = v => v != null && v !== '' && isFinite(+v);
const num = v => (isNum(v) ? +v : 0);
const r1 = v => (isNum(v) ? Math.round(+v * 10) / 10 : null);
const MIN_USED = 40;          // fewer used possessions than this is a game's scraps, not a way of playing

function ordinal(n) {
  const t = n % 100, u = n % 10;
  return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
}

/* ---------------------------------------------------------------- the sums --- */
/* the possessions a player used: the count usage rate is made of */
function usedPoss(p) { return num(p && p.fga) + 0.44 * num(p && p.fta) + num(p && p.tov); }

/* players: season rows (id, fga, fta, tov); teamOf(row) -> the club
   -> Map(club -> { share: the busiest player's %, users: 1 / sum of squared shares, top: his id, total, n }) */
function helio(players, teamOf) {
  const by = new Map();
  (players || []).forEach(p => {
    const t = teamOf(p);
    const u = usedPoss(p);
    if (!t || !(u > 0)) return;
    const a = by.get(t) || { total: 0, list: [] };
    a.total += u; a.list.push([p.id, u]);
    by.set(t, a);
  });
  const out = new Map();
  by.forEach((a, t) => {
    if (a.total < MIN_USED) return;
    let top = null, max = 0, hhi = 0;
    a.list.forEach(([id, u]) => {
      const s = u / a.total;
      hhi += s * s;
      if (u > max) { max = u; top = id; }
    });
    out.set(t, { share: 100 * max / a.total, users: hhi > 0 ? 1 / hhi : null, top, total: a.total, n: a.list.length });
  });
  return out;
}

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

/* logs: [{ side, events }] (the club's side in each game), compute: shotclock.js compute
   -> { own, opp: seconds per timed possession, nOwn, nOpp, games } */
function possTime(logs, compute) {
  let os = 0, on = 0, ds = 0, dn = 0, games = 0;
  (logs || []).forEach(L => {
    let R = null;
    try { R = compute({ events: (L && L.events) || [] }); } catch (_) { R = null; }
    if (!R || !Array.isArray(R.possessions)) return;
    games++;
    R.possessions.forEach(p => {
      if (p.dur == null || !isFinite(p.dur)) return;
      if (p.team === L.side) { os += p.dur; on++; } else { ds += p.dur; dn++; }
    });
  });
  return { own: on ? os / on : null, opp: dn ? ds / dn : null, nOwn: on, nOpp: dn, games };
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
  const map = S.teamOfPlayer;
  const teamOf = p => p._teamId || (map && map.get ? map.get(p.id) : null) || null;
  const H = helio(S.players, teamOf);
  S.teams.forEach(t => {
    t.ppp = isNum(t.ortg) ? Math.round(+t.ortg * 10) / 1000 : null;
    t.morey = r1(morey(t));
    const h = H.get(t.id);
    t.helio = h ? r1(h.share) : null;
    t.helio_users = h ? r1(h.users) : null;
    t.helio_top = h ? h.top : null;
  });
}
function attachBench(S, B) {
  if (!S || !Array.isArray(S.teams) || !B) return;
  S.teams.forEach(t => { const b = B.get(t.id); t.bench_min_pct = b && isNum(b.pct) ? r1(b.pct) : null; t.bench_games = b ? b.games : 0; });
}

/* ------------------------------------------------------------- the rows --- */
/* dir as place(); ends: the strip's left and right, most: the word for rank 1 of a style; club: this club's alone */
const RATINGS = [
  { k: 'ortg', l: 'ORTG', sub: 'points per 100 possessions', dir: 1, dp: 1 },
  { k: 'drtg', l: 'DRTG', sub: 'points allowed per 100 possessions', dir: -1, dp: 1 },
  { k: 'net', l: 'NET', sub: 'ORTG minus DRTG', dir: 1, dp: 1, signed: true }
];
const GROUPS = [
  { key: 'tempo', title: 'Tempo', rows: [
    { k: 'pace', l: 'PACE', sub: 'possessions per 40 minutes', dir: 0, ends: ['slower', 'faster'], most: 'fastest', dp: 1 },
    { k: 'poss_time', l: 'AVG POSSESSION', sub: 'seconds from winning the ball to the last action', dir: 0, dp: 1, unit: ' s', club: true }
  ] },
  { key: 'efficiency', title: 'Efficiency', rows: [
    { k: 'ppp', l: 'PPP', sub: 'points per possession', dir: 1, dp: 2 },
    { k: 'ts', l: 'TS%', sub: 'points per shot, free throws counted', dir: 1, dp: 1 },
    { k: 'ft_pct', l: 'FT%', sub: 'free throws made', dir: 1, dp: 1 },
    { k: 'morey', l: 'MOREY%', sub: 'shots at the rim or from three', dir: 0, ends: ['fewer', 'more'], most: 'highest', dp: 1 }
  ] },
  { key: 'distribution', title: 'Distribution', rows: [
    { k: 'ast_pct', l: 'AST%', sub: 'baskets that were assisted', dir: 0, ends: ['fewer', 'more'], most: 'highest', dp: 1 },
    { k: 'helio', l: 'HELIOCENTRISM%', sub: 'possessions used by the busiest player', dir: 0, ends: ['shared', 'one player'], most: 'highest', dp: 1 },
    { k: 'bench_min_pct', l: 'BENCH MINS%', sub: 'minutes played by those who did not start', dir: 0, ends: ['starters', 'bench'], most: 'highest', dp: 1, later: true }
  ] }
];
const KEYS = RATINGS.concat(...GROUPS.map(g => g.rows)).map(d => d.k);

/* ---------------------------------------------------------------- drawing --- */
function h(tag, cls, text) {
  const n = root.document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
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
  p.appendChild(document_text(' ' + (d.dir === 0 && d.most ? d.most + ' ' : '') + 'of ' + P.n));
  return p;
}
function document_text(t) { return root.document.createTextNode(t); }
function tip(P, d) {
  if (!P) return '';
  return d.l + ' ' + fmt(P.v, d) + ' · ' + ordinal(P.rank) + (d.dir === 0 && d.most ? ' ' + d.most : '') + ' of ' + P.n +
    ' · league average ' + fmt(P.avg, Object.assign({}, d, { signed: d.signed })) + ' · range ' + fmt(P.lo, d) + ' to ' + fmt(P.hi, d);
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
  if (g) sub.append(h('b', 'cs-gap ' + g.tone, g.text), document_text(' vs avg'));
  t.append(top, v, sub, strip(P, d), ends(d));
  t.title = tip(P, d);
  if (o.bind && P) o.bind(t, d);
  return t;
}

function statRow(d, S, mine, o) {
  const tr = h('tr', 'r');
  tr.dataset.k = d.k;
  const th = h('th', 'l');
  th.scope = 'row';
  th.append(h('span', 'cst-l', d.l), h('span', 'cst-sub', d.sub));
  if (d.club) {
    tr.appendChild(th);
    const x = o.club && o.club[d.k];
    const v = h('td', 'v', x === undefined ? '…' : fmt(x && x.v, d));
    const n = h('td', 'cst-club');
    n.colSpan = 3;
    if (x && x.note) n.appendChild(x.note);
    else n.appendChild(h('span', 'cst-wait', x === undefined ? 'timing every possession…' : (x && x.why) || 'not recorded for this club'));
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

/* host: the card's body. ctx: { S, mine, bind(node, def), club: { poss_time: Promise<{ v, note } | { v:null, why }> },
   bench: Promise<Map> (bench()), nameOf(id): Promise<name> } */
function render(host, ctx) {
  const S = ctx.S, mine = ctx.mine;
  prepare(S);
  const wrap = h('div', 'csl');
  wrap.setAttribute('data-i18n-ctx', 'seasonline');           // the strips' ends and the groups' words (i18n/es.js, ja.js)
  const rt = h('div', 'csr');
  RATINGS.forEach(d => rt.appendChild(ratingTile(d, S, mine, ctx)));
  wrap.appendChild(rt);

  const extra = {};
  const hx = h('span', 'cst-x');
  if (isNum(mine.helio_users)) hx.textContent = 'spread like ' + (+mine.helio_users).toFixed(1) + ' equal users';
  extra.helio = hx;
  const bx = h('span', 'cst-x');
  extra.bench_min_pct = bx;

  const o = { bind: ctx.bind, club: {}, pending: { bench_min_pct: !!ctx.bench }, extra };
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
    const d = KEYS.indexOf(k) >= 0 ? GROUPS.map(g => g.rows).flat().find(x => x.k === k) : null;
    if (!d || !rows[k] || !rows[k].parentNode) return;
    const nr = statRow(d, S, mine, o);
    rows[k].replaceWith(nr);
    rows[k] = nr;
  };

  /* the busiest player's name, once it is read */
  if (mine.helio_top && ctx.nameOf) {
    Promise.resolve(ctx.nameOf(mine.helio_top)).then(nm => {
      if (!nm) return;
      hx.textContent = nm + (isNum(mine.helio_users) ? ' · spread like ' + (+mine.helio_users).toFixed(1) + ' equal users' : '');
    }).catch(() => { /* the number stands on its own */ });
  }
  /* the possession, from the club's own logs */
  const pt = ctx.club && ctx.club.poss_time;
  if (pt) {
    Promise.resolve(pt).then(x => { o.club.poss_time = x || null; redraw('poss_time'); })
      .catch(() => { o.club.poss_time = { v: null, why: 'could not be timed' }; redraw('poss_time'); });
  } else { o.club.poss_time = null; redraw('poss_time'); }
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

/* the AVERAGE POSSESSION row's contents, from possTime() */
function possNote(x, games) {
  if (!x || x.own == null) return { v: null, why: 'no possession could be timed' };
  const n = h('div', 'cst-vs');
  const own = h('span', 'cst-vs-own'), opp = h('span', 'cst-vs-opp');
  own.append(document_text('offence '), h('b', null, x.own.toFixed(1) + ' s'));
  opp.append(document_text('defence '), h('b', null, x.opp == null ? '—' : x.opp.toFixed(1) + ' s'));
  const bar = h('span', 'cst-vs-bar');
  if (x.opp != null && x.own + x.opp > 0) bar.style.setProperty('--own', (100 * x.own / (x.own + x.opp)).toFixed(1) + '%');
  const note = h('span', 'cst-vs-n', 'over ' + games + (games === 1 ? ' game' : ' games') + ' of the club’s own logs · not ranked: the other clubs’ logs are not read here');
  n.append(own, bar, opp, note);
  return { v: x.own, note: n };
}

return { usedPoss, helio, bench, possTime, morey, place, band, ordinal, prepare, attachBench, render, possNote,
         RATINGS, GROUPS, KEYS, MIN_USED };
}));
