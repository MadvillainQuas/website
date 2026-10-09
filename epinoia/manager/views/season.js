'use strict';
/* ============================================================================
   MANAGER - THE SEASON'S PAGES: the club's home (#/), the fixtures (#/fixtures), the table (#/table) and the statistics
   with hints (#/stats). A game's own page is views/game.js; a game as it is being played, views/live.js. Everything here is the manager league's own, played in
   this browser (core/season.js state): nothing of it is ever written to the site's real leagues.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const SE = () => Mgr.season;
const LINE = () => Mgr.season.LINE;
const when = (d, o) => new Date(d + 'T' + String(Mgr.season.TIP_UTC).padStart(2, '0') + ':00:00Z').toLocaleString(undefined, o || { weekday: 'short', day: 'numeric', month: 'short' });
const form = list => h('span.mg-form', list.map(x => h('i.' + x, x)));
const resultOf = (f, i) => { const home = f.h === i, us = home ? f.res[0] : f.res[1], them = home ? f.res[1] : f.res[0]; return { won: us > them, us, them, home, opp: home ? f.a : f.h }; };
const per = (L, k) => (L && L.gp ? L[k] / L.gp : null);

/* ------------------------------------------------------------------ the club's home --- */
function home(host) {
  const S = A.view(), T = SE().table(S), me = T.rows.find(r => r.id === 0) || { w: 0, l: 0, pf: 0, pa: 0, gp: 0, pos: null, last5: [] };
  const done = A.club.status === 'done';
  host.appendChild(h('div.mg-top', A.badge(A.club.badge, 72), h('div.who', A.nm(A.club.name, 'h1'), h('div.meta', h('span', 'Manager ', A.nm(A.club.manager, 'b')), h('span', A.nm(A.lg.L.name)),
    h('span', A.lg.L.seasonName || ''), done ? h('span.mg-chip.royal', 'Season complete') : null))));
  /* the reader's game on now: the choice, or the game as it stands (views/live.js) */
  if (A.livePanel) A.livePanel(host);
  /* the results that came in on this visit (a game being watched waits for its end) */
  const hidden = A.hiddenRound();
  if (hidden != null) A.news = A.news.filter(n => n.r !== hidden);
  if (A.news.length) {
    const p = h('div.mg-panel.glow.mg-results-in', h('div.mg-h', h('h2', A.news.length === 1 ? 'Your result is in' : 'Your results are in'), h('span.mg-sub', 'Played since your last visit')));
    const ul = h('ul.mg-news');
    A.news.slice().reverse().forEach(n => ul.appendChild(h('li', h('span.t', 'Round ' + n.r + ' · ' + when(n.d)),
      h('b', { style: { color: n.won ? 'var(--mg-good)' : 'var(--mg-bad)' } }, n.won ? 'W ' : 'L '), h('b', n.us + '–' + n.them + (n.ot ? ' (OT)' : '')), n.home ? ' v ' : ' at ', A.clubLink(n.opp),
      n.top ? h('span', ' · ', A.playerLink(n.top.id), ' ' + n.top.pts + ' pts, ' + n.top.reb + ' reb, ' + n.top.ast + ' ast', n.top.hot ? h('span.mg-chip.good', { style: { marginLeft: '6px' } }, 'in form') : null) : null,
      ' ', h('a', { href: '#/game/' + n.r }, 'box score →'))));
    p.appendChild(ul);
    host.appendChild(p);
    A.news = [];
  }
  /* the tiles */
  /* the next game: the one after a game being played now (that one is the live panel's) */
  const live = A.hiddenRound();
  const nx = S.fixtures.filter(f => f.res == null && !f.live && (f.h === 0 || f.a === 0) && (live == null || f.r > live)).sort((a, b) => a.r - b.r)[0] || null;
  const tiles = h('div.mg-tiles', { style: { margin: '16px 0' } },
    h('a.mg-tile', { href: '#/table' }, h('span.k', 'Position'), h('span.v', me.pos ? String(me.pos) : '–', h('small', 'of ' + S.clubs.length))),
    h('a.mg-tile' + (me.w > me.l ? '.up' : me.l > me.w ? '.dn' : ''), { href: '#/fixtures' }, h('span.k', 'Record'), h('span.v', me.w + '–' + me.l), h('span.s', me.gp ? Math.round(100 * me.w / me.gp) + '% won' : 'No games yet')),
    h('a.mg-tile', { href: '#/stats' }, h('span.k', 'Points a game'), h('span.v', me.gp ? A.fmt(me.pf / me.gp) : '–'), h('span.s', me.gp ? 'allowed ' + A.fmt(me.pa / me.gp) : '')),
    h('a.mg-tile' + (me.gp && me.pf >= me.pa ? '.up' : me.gp ? '.dn' : ''), { href: '#/stats' }, h('span.k', 'Difference'), h('span.v', me.gp ? ((me.pf - me.pa) / me.gp >= 0 ? '+' : '') + A.fmt((me.pf - me.pa) / me.gp) : '–'), h('span.s', 'a game')),
    h('a.mg-tile', { href: '#/fixtures' }, h('span.k', 'Form'), me.last5 && me.last5.length ? form(me.last5) : h('span.s', 'No games yet')),
    h('a.mg-tile', { href: '#/fixtures' }, h('span.k', 'Season'), h('span.v', String(S.played), h('small', 'of ' + S.fixtures.reduce((a, f) => Math.max(a, f.r), 0))), h('span.s', 'rounds played')));
  host.appendChild(tiles);
  const grid = h('div.mg-grid.side'), left = h('div.mg-stack'), right = h('div.mg-stack');
  grid.appendChild(left); grid.appendChild(right); host.appendChild(grid);
  /* the next game, simulated */
  if (nx) {
    const opp = nx.h === 0 ? nx.a : nx.h, homeGame = nx.h === 0;
    const meter = h('div.mg-meter', h('i', { style: { width: '50%' } })), chance = h('b', '…');
    left.appendChild(h('div.mg-panel.glow', h('div.mg-h', h('h2', 'Next game'), h('span.mg-sub', 'Round ' + nx.r + ' · ' + when(nx.d, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))),
      h('div.mg-next', h('div.side', A.crest(homeGame ? 0 : opp, 64), homeGame ? A.nm(A.club.name, 'b') : A.clubLink(opp)), h('div.vs', h('span.mg-cap', homeGame ? 'Home' : 'Away'), h('span.big', 'v')),
        h('div.side', A.crest(homeGame ? opp : 0, 64), homeGame ? A.clubLink(opp) : A.nm(A.club.name, 'b'))),
      meter, h('div.mg-row.between', { style: { marginTop: '8px' } }, h('span.mg-sub', 'Your chance, simulated with your lineups and tactics: ', chance), h('a.mg-btn', { href: '#/tactics' }, 'Tactics')), countdown(nx)));
    setTimeout(() => {
      try {
        const pv = Mgr.engine.preview(A.teamObj(0, null), A.teamObj(opp, null), Object.assign({}, A.X(), { home: homeGame ? 1 : -1, seed: 17 }), 300);
        chance.textContent = Math.round(100 * pv.pWin) + '% (' + (pv.margin >= 0 ? '+' : '') + A.fmt(pv.margin) + ')';
        meter.firstChild.style.width = Math.round(100 * pv.pWin) + '%';
      } catch (_) { chance.textContent = '–'; }
    }, 60);
  } else left.appendChild(h('div.mg-panel', h('h2', done ? 'The season is over' : 'No game to come'), h('p.mg-sub', done ? 'Your final place is on the leaderboards.' : '')));
  /* the last results */
  const rs = SE().results(S, 0).slice(0, 6);
  left.appendChild(h('div.mg-panel', h('div.mg-h', h('h3', 'Last results'), h('a', { href: '#/fixtures' }, 'all fixtures →')),
    rs.length ? h('div.mg-fx', rs.map(f => fxRow(f))) : h('p.mg-sub', 'Your first game is ' + (nx ? when(nx.d, { weekday: 'long', day: 'numeric', month: 'long' }) : 'to come') + '.')));
  /* the table around the club */
  const pos = (me.pos || 1) - 1, around = T.rows.slice(Math.max(0, pos - 3), Math.max(0, pos - 3) + 7);
  right.appendChild(h('div.mg-panel', h('div.mg-h', h('h3', 'Table'), h('a', { href: '#/table' }, 'full table →')), miniTable(around)));
  /* the club's leaders, simulated */
  const mine = (A.club.roster || []).map(e => ({ id: e.id, L: SE().lineOf(S, e.id) })).filter(x => x.L && x.L.gp);
  if (mine.length) {
    const lead = (k, label, f) => { const b = mine.slice().sort((a, c) => f(c.L) - f(a.L))[0]; return h('div.mg-row.between', { style: { padding: '6px 0' } }, h('span.mg-sub', label), h('span', A.playerLink(b.id), ' ', h('b', A.fmt(f(b.L))))); };
    right.appendChild(h('div.mg-panel', h('div.mg-h', h('h3', 'Your leaders')), lead('pts', 'Points', L => L.pts / L.gp), lead('reb', 'Rebounds', L => (L.oreb + L.dreb) / L.gp),
      lead('ast', 'Assists', L => L.ast / L.gp), lead('stl', 'Steals', L => L.stl / L.gp), lead('blk', 'Blocks', L => L.blk / L.gp)));
  }
}
/* TIP-OFF COMING: within three hours, a countdown; at tip-off the round is played here and the game goes live */
function countdown(nx) {
  const tip = Mgr.season.dueAt(nx.d).getTime(), box = h('div.mg-row', { style: { justifyContent: 'center', marginTop: '10px' } });
  if (tip - Date.now() > 3 * 3600 * 1000) return box;
  const out = h('b', { style: { fontVariantNumeric: 'tabular-nums' } });
  box.appendChild(h('span.mg-chip.royal', 'Tip-off in ', out));
  const tick = async () => {
    if (!box.isConnected) return;
    const left = Math.round((tip - Date.now()) / 1000);
    if (left <= 0) { out.textContent = 'now'; try { await A.catchUp(); } catch (_) { /* played on the next visit */ } A.route_(); return; }
    out.textContent = Math.floor(left / 3600) + ':' + String(Math.floor(left % 3600 / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
    setTimeout(tick, 1000);
  };
  tick();
  return box;
}
function miniTable(rows) {
  const t = h('table.mg-table', h('thead', h('tr', h('th', '#'), h('th.l', 'Club'), h('th', 'W'), h('th', 'L'), h('th', '+/−'))));
  const tb = h('tbody');
  rows.forEach(r => tb.appendChild(h('tr' + (r.id === 0 ? '.me' : ''), h('td', String(r.pos)), h('td.l', h('div.who', A.crest(r.id, 22), A.clubLink(r.id))), h('td', String(r.w)), h('td', String(r.l)),
    h('td', (r.diff >= 0 ? '+' : '') + r.diff))));
  t.appendChild(tb);
  return h('div.mg-tablewrap', t);
}
function fxRow(f) {
  const mine = f.h === 0 || f.a === 0, played = f.res != null;
  let sc;
  if (played) {
    const txt = f.res[0] + ' – ' + f.res[1] + (f.res[2] ? ' OT' : '');
    sc = mine ? h('a.sc', { href: '#/game/' + f.r }, txt) : h('span.sc', txt);
    if (mine) { const r = resultOf(f, 0); sc.classList.add(r.won ? 'w' : 'l'); }
  } else sc = h('span.sc', { style: { color: 'var(--mg-ink-3)', fontWeight: '600' } }, 'v');
  return h('div.mg-fxrow' + (mine ? '.me' : ''), h('span.d', when(f.d)), h('span.h', A.clubLink(f.h), A.crest(f.h, 24)), sc, h('span.a', A.crest(f.a, 24), A.clubLink(f.a)));
}
A.fxRow = fxRow;

/* ------------------------------------------------------------------ fixtures --- */
function fixtures(host) {
  const S = A.view();
  let onlyMine = A.stored('mgr_fx_all') !== '1';
  host.appendChild(h('div.mg-top', h('div.who', h('h1', 'Fixtures and results'), h('div.meta', h('span', S.meetings + ' meetings with every club'),
    h('span', (S.perWeek === 1 ? 'Saturdays' : 'Wednesdays and Saturdays') + ', from ' + String(Mgr.season.TIP_UTC).padStart(2, '0') + ':00 UTC')))));
  const tabs = h('div.mg-tabs', { role: 'group' });
  const list = h('div.mg-stack');
  const draw = () => {
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.k === 'mine') === onlyMine)));
    list.textContent = '';
    const byRound = new Map();
    S.fixtures.forEach(f => { if (onlyMine && f.h !== 0 && f.a !== 0) return; if (!byRound.has(f.r)) byRound.set(f.r, []); byRound.get(f.r).push(f); });
    [...byRound.entries()].sort((a, b) => a[0] - b[0]).forEach(([r, fs]) => {
      list.appendChild(h('div', h('div.mg-cap', { style: { margin: '6px 0 6px' } }, 'Round ' + r + ' · ' + when(fs[0].d, { weekday: 'long', day: 'numeric', month: 'long' })), h('div.mg-fx', fs.map(fxRow))));
    });
  };
  [['mine', 'My games'], ['all', 'Every game']].forEach(([k, l]) => tabs.appendChild(h('button', { type: 'button', 'data-k': k, onclick: () => { onlyMine = k === 'mine'; A.store('mgr_fx_all', onlyMine ? null : '1'); draw(); } }, l)));
  host.appendChild(h('div.mg-panel', h('div.mg-h', tabs), list));
  draw();
  const next = list.querySelector('.mg-fxrow .sc:not(a)');
  if (next) setTimeout(() => next.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
}

/* ------------------------------------------------------------------ the table --- */
function teamStatsOf(S) {
  return S.clubs.map((_, i) => {
    const t = S.tstats[i];
    if (!t || !t.gp) return { i, gp: 0 };
    const plays = t.fga + 0.44 * t.fta + t.tov;
    return { i, gp: t.gp, ppg: t.pts / t.gp, opp: t.opp / t.gp, pace: t.poss / t.gp, ortg: 100 * t.pts / Math.max(1, t.poss), efg: 100 * (t.fgm + 0.5 * t.p3m) / Math.max(1, t.fga),
      tov: 100 * t.tov / Math.max(1, plays), orb: t.oreb / t.gp, drb: t.dreb / t.gp, ast: t.ast / t.gp, stl: t.stl / t.gp, blk: t.blk / t.gp, p3: 100 * t.p3m / Math.max(1, t.p3a),
      p3a: t.p3a / t.gp, ftr: 100 * t.fta / Math.max(1, t.fga), drtg: 100 * t.opp / Math.max(1, t.poss) };
  });
}
A.teamStatsOf = teamStatsOf;
function table(host) {
  const S = A.view(), T = SE().table(S);
  host.appendChild(h('div.mg-top', h('div.who', h('h1', 'Table'), h('div.meta', h('span', A.nm(A.lg.L.name)), h('span', 'Manager league: ' + S.clubs.length + ' clubs')))));
  const tabs = h('div.mg-tabs', { role: 'group' }), body = h('div');
  const standings = () => {
    const t = h('table.mg-table', h('thead', h('tr', h('th', '#'), h('th.l', 'Club'), h('th', 'GP'), h('th', 'W'), h('th', 'L'), h('th', 'PCT'), h('th', 'PF'), h('th', 'PA'), h('th', '+/−'),
      h('th', 'Home'), h('th', 'Away'), h('th.l', 'Last 5'), h('th', 'Streak'))));
    const tb = h('tbody');
    T.rows.forEach(r => tb.appendChild(h('tr' + (r.id === 0 ? '.me' : ''), h('td', String(r.pos)), h('td.l', h('div.who', A.crest(r.id, 24), A.clubLink(r.id))), h('td', String(r.gp)),
      h('td', String(r.w)), h('td', String(r.l)), h('td', r.gp ? r.pct.toFixed(3).replace(/^0/, '') : '–'), h('td', r.gp ? A.fmt(r.pf / r.gp) : '–'), h('td', r.gp ? A.fmt(r.pa / r.gp) : '–'),
      h('td', (r.diff >= 0 ? '+' : '') + r.diff), h('td', r.hw + '–' + r.hl), h('td', r.aw + '–' + r.al), h('td.l', form(r.last5)), h('td', r.streak || '–'))));
    t.appendChild(tb);
    return h('div.mg-tablewrap', t);
  };
  const stats = () => {
    const rows = teamStatsOf(S).filter(x => x.gp);
    const cols = [['ppg', 'PTS'], ['opp', 'OPP'], ['ortg', 'ORTG'], ['drtg', 'DRTG'], ['pace', 'PACE'], ['efg', 'eFG%'], ['p3', '3P%'], ['p3a', '3PA'], ['tov', 'TOV%'], ['ftr', 'FTr'], ['orb', 'OREB'], ['drb', 'DREB'], ['ast', 'AST'], ['stl', 'STL'], ['blk', 'BLK']];
    let sort = 'ppg', dir = -1;
    const wrap = h('div');
    const draw = () => {
      wrap.textContent = '';
      const t = h('table.mg-table'), hr = h('tr', h('th.l', 'Club'));
      cols.forEach(([k, l]) => hr.appendChild(h('th', { 'data-sort': k, 'aria-sort': sort === k ? (dir < 0 ? 'descending' : 'ascending') : null, onclick: () => { if (sort === k) dir = -dir; else { sort = k; dir = ['opp', 'drtg', 'tov'].includes(k) ? 1 : -1; } draw(); } }, l)));
      t.appendChild(h('thead', hr));
      const tb = h('tbody');
      rows.slice().sort((a, b) => dir * (a[sort] - b[sort])).forEach(r => tb.appendChild(h('tr' + (r.i === 0 ? '.me' : ''), h('td.l', h('div.who', A.crest(r.i, 22), A.clubLink(r.i))),
        cols.map(([k]) => h('td', A.fmt(r[k]))))));
      t.appendChild(tb);
      wrap.appendChild(h('div.mg-tablewrap', t));
    };
    draw();
    return wrap;
  };
  const put = k => { body.textContent = ''; body.appendChild(k === 'stats' ? stats() : standings()); tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k))); };
  [['table', 'Standings'], ['stats', 'Team stats']].forEach(([k, l]) => tabs.appendChild(h('button', { type: 'button', 'data-k': k, onclick: () => put(k) }, l)));
  host.appendChild(h('div.mg-panel', h('div.mg-h', tabs), body));
  put('table');
}

/* ------------------------------------------------------------------ statistics, with hints --- */
const clubOfPlayer = id => {
  if ((A.club.roster || []).some(e => String(e.id) === String(id))) return 0;
  const tid = A.lg.teamOf(id), i = A.club.state.clubs.indexOf(String(tid));
  return i >= 0 ? i : null;
};
A.clubOfPlayer = clubOfPlayer;
function stats(host) {
  const S = A.view();
  host.appendChild(h('div.mg-top', h('div.who', h('h1', 'Statistics'), h('div.meta', h('span', 'The manager league’s season, simulated')))));
  /* THE HINTS: where the club stands among the league's at what wins, and what would move it */
  const ts = teamStatsOf(S).filter(x => x.gp), me = ts.find(x => x.i === 0);
  const hints = h('div.mg-stack');
  if (me && ts.length >= 4) {
    const rank = (k, low) => 1 + ts.filter(x => (low ? x[k] < me[k] : x[k] > me[k])).length, n = ts.length, bottom = r => r > n - Math.max(2, Math.round(n / 4));
    const out = [];
    if (bottom(rank('efg'))) out.push('Your shooting (eFG% ' + A.fmt(me.efg) + ') is among the league’s lowest. A shooter at the wing, or more of the plays to your most efficient scorer (the usage dial), moves it; so does Get downhill if your guards finish at the rim.');
    if (bottom(rank('tov', true))) out.push('You turn the ball over more than most (' + A.fmt(me.tov) + '% of plays). A point guard with a better Handling pressure attribute, or less Off-ball cutting, steadies it.');
    if (bottom(rank('drb'))) out.push('You give up the defensive glass. A big with a high Def. boards attribute, or less Leak out, wins it back.');
    if (bottom(rank('drtg', true))) out.push('Your defence allows ' + A.fmt(me.drtg) + ' points per 100 possessions. A rim protector lets you Funnel to rim protection; quick hands make Gamble for steals pay.');
    if (rank('p3') <= 3 && me.p3a < ts.reduce((a, x) => a + x.p3a, 0) / n) out.push('You make your threes (' + A.fmt(me.p3) + '%) but take fewer than the league does: Punish from deep plays to it.');
    if (!out.length) out.push('No glaring weakness: your club is at or above the league at most of what wins. Fine-tune the lineups’ minutes and watch the tired legs.');
    out.forEach(t => hints.appendChild(h('div.mg-hintcard', h('span.ic', 'i'), h('span', t))));
  } else hints.appendChild(h('p.mg-sub', 'The hints arrive once a few rounds have been played.'));
  host.appendChild(h('div.mg-panel.glow', h('div.mg-h', h('h2', 'Hints'), h('span.mg-sub', 'From your club’s numbers against the league’s')), hints));
  /* the leaders */
  const cats = [['pts', 'Points'], ['reb', 'Rebounds'], ['ast', 'Assists'], ['stl', 'Steals'], ['blk', 'Blocks'], ['p3m', 'Threes made']];
  const grid = h('div.mg-grid.c3', { style: { marginTop: '16px' } });
  const top = Object.values(S.stats).reduce((a, L) => Math.max(a, L[0]), 0);
  cats.forEach(([k, label]) => {
    const j = LINE().indexOf(k);
    const rows = Object.entries(S.stats).filter(([, L]) => L[0] >= Math.max(1, top / 2)).map(([i, L]) => ({ id: S.people[+i], v: (k === 'reb' ? L[LINE().indexOf('oreb')] + L[LINE().indexOf('dreb')] : L[j]) / L[0] }))
      .sort((a, b) => b.v - a.v).slice(0, 8);
    const t = h('table.mg-table', h('tbody', rows.map((r, n) => { const c = clubOfPlayer(r.id); return h('tr' + (c === 0 ? '.me' : ''), h('td', String(n + 1)), h('td.l', h('div.who', c != null ? A.crest(c, 20) : null, A.playerLink(r.id))), h('td', h('b', A.fmt(r.v)))); })));
    grid.appendChild(h('div.mg-panel', h('div.mg-h', h('h3', label), h('span.mg-sub', 'a game')), rows.length ? h('div.mg-tablewrap', t) : h('p.mg-sub', 'No games yet.')));
  });
  host.appendChild(grid);
}

A.views.home = { render: home };
A.views.fixtures = { render: fixtures };
A.views.table = { render: table };
A.views.stats = { render: stats };
})(typeof globalThis !== 'undefined' ? globalThis : self);
