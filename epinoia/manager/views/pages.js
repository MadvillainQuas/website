'use strict';
/* ============================================================================
   MANAGER - A PLAYER'S PAGE (#/player/<id>) AND A CLUB'S (#/team/<index>).

   Louie, 2026-10-09: "Can player profiles in the manager side have their real irl stats and also a tab for their
   manager mode simulated stats? Can all the manager mode teams in the sim also have team pages (simulating the similar
   team pages for irl) with only the simmed stats + roster etc.?"
     * a player: REAL SEASON (his league's season line, as the site keeps it: per game, shooting, the advanced rates,
       the minutes at each position, the 1-20 attributes) and MANAGER SEASON (what he has done in this manager league:
       his simulated line, and his games against the reader's club);
     * a club of the manager league - the reader's or a real one: its roster as it stands in THIS league (a real club
       without the men the reader drafted), its simulated record, results, fixtures and team stats. Nothing real is
       mixed into a club's page but its name and crest.
   ============================================================================ */
(function (root) {
const Mgr = root.Mgr, A = Mgr.app, h = A.h;
const SE = () => Mgr.season;
const tabsOf = (list, put) => {
  const t = h('div.mg-tabs', { role: 'group' });
  list.forEach(([k, l]) => t.appendChild(h('button', { type: 'button', 'data-k': k, onclick: () => { t.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === k))); put(k); } }, l)));
  return t;
};
const statGrid = list => h('div.mg-statgrid', { 'data-i18n-ctx': 'col' }, list.map(([k, v, d]) => h('div.s', h('b', A.fmt(+v, d)), h('span', k))));

/* ------------------------------------------------------------------ the profile's bars --- */
/* the player profile's sections (p/player.js BAR_SECTIONS and SIMPLE_SECTIONS), their rows and the ones read low-is-better */
const SCOUT = [
  { title: 'Scoring', blocks: [{ rows: [['ppg', 'PTS / GAME'], ['ts', 'TS%'], ['efg', 'eFG%'], ['usg', 'USAGE'], ['ftr', 'FT RATE'], ['ev_ast_pts_sh', 'ASSISTED%'], ['contrib_pg', 'TPC / GAME']] }] },
  { title: 'Shooting', blocks: [
    { title: 'at the rim', rows: [['rim_pct', 'RIM%'], ['rim_a100', 'RIM ATT / 100'], ['ev_rim_astp', 'RIM ASSISTED%'], ['team_spacing', 'TEAM SPACING']] },
    { title: 'mid-range', rows: [['mid_pct', 'MID%'], ['mid_a100', 'MID ATT / 100'], ['ev_mid_astp', 'MID ASSISTED%']] },
    { title: 'three-pointers', rows: [['p3_pct', '3P%'], ['p3_a100', '3P ATT / 100'], ['ev_p3_astp', '3P ASSISTED%']] },
    { title: 'free throws', rows: [['ft_pct', 'FT%'], ['ft_a100', 'FT ATT / 100']] }] },
  { title: 'Playmaking', blocks: [{ rows: [['ast_pct', 'ASSIST%'], ['au', 'AST / USG'], ['ast_to', 'AST / TO'], ['tov_pct', 'TURNOVER%']] }] },
  { title: 'Rebounding', blocks: [{ rows: [['oreb_pct', 'OREB%'], ['dreb_pct', 'DREB%'], ['trb_pct', 'TOTAL REB%']] }] },
  { title: 'Defence', blocks: [{ rows: [['stl_pct', 'STEAL%'], ['blk_pct', 'BLOCK%'], ['pf30', 'FOULS CONCEDED / 30']] },
    { title: 'rim protection', bigsOnly: true, rows: [['def_rim_fg_pm', 'DEF RIM FG% ±'], ['def_rim_vol_pm', 'DEF RIM VOL ±']] }] },
  { title: 'Impact', blocks: [{ title: 'on / off', rows: [['diff_net', 'NET ±'], ['diff_ortg', 'ORTG ±'], ['diff_drtg', 'DRTG ±']] },
    { title: 'box plus / minus', rows: [['bpm', 'BPM'], ['obpm', 'OBPM'], ['dbpm', 'DBPM'], ['vorp', 'VORP']] }] }
];
/* the manager season's own: what a simulated line can say (no play-by-play splits or on/off, but plus-minus in the
   reader's own games) */
const SCOUT_SIM = [
  { title: 'Scoring', blocks: [{ rows: [['ppg', 'PTS / GAME'], ['ts', 'TS%'], ['efg', 'eFG%'], ['usg', 'USAGE'], ['ftr', 'FT RATE']] }] },
  { title: 'Shooting', blocks: [
    { title: 'at the rim', rows: [['rim_pct', 'RIM%'], ['rim_a100', 'RIM ATT / 100']] },
    { title: 'mid-range', rows: [['mid_pct', 'MID%'], ['mid_a100', 'MID ATT / 100']] },
    { title: 'three-pointers', rows: [['p3_pct', '3P%'], ['p3_a100', '3P ATT / 100']] },
    { title: 'free throws', rows: [['ft_pct', 'FT%'], ['ft_a100', 'FT ATT / 100']] }] },
  { title: 'Playmaking', blocks: [{ rows: [['ast_pct', 'ASSIST%'], ['au', 'AST / USG'], ['ast_to', 'AST / TO'], ['tov_pct', 'TURNOVER%']] }] },
  { title: 'Rebounding', blocks: [{ rows: [['oreb_pct', 'OREB%'], ['dreb_pct', 'DREB%'], ['trb_pct', 'TOTAL REB%']] }] },
  { title: 'Defence', blocks: [{ rows: [['stl_pct', 'STEAL%'], ['blk_pct', 'BLOCK%'], ['pf30', 'FOULS CONCEDED / 30']] }] },
  { title: 'Impact', blocks: [{ title: 'in your games', rows: [['pm40', '+/− PER 40']] }] }
];
const SIMPLE = [
  { title: 'Scoring', blocks: [{ rows: [['pts_p75', 'PTS / 75']] }, { title: 'field goals', rows: [['fg_pct', 'FG%'], ['fgm_p75', 'FGM / 75'], ['fga_p75', 'FGA / 75']] },
    { title: 'three-pointers', rows: [['p3_pct', '3P%'], ['p3m_p75', '3PM / 75'], ['p3a_p75', '3PA / 75']] }, { title: 'free throws', rows: [['ft_pct', 'FT%'], ['ftm_p75', 'FTM / 75'], ['fta_p75', 'FTA / 75']] }] },
  { title: 'Rebounding', blocks: [{ rows: [['reb_p75', 'REB / 75'], ['oreb_p75', 'OREB / 75'], ['dreb_p75', 'DREB / 75']] }] },
  { title: 'Playmaking', blocks: [{ rows: [['ast_p75', 'AST / 75'], ['tov_p75', 'TOV / 75']] }] },
  { title: 'Defence', blocks: [{ rows: [['stl_p75', 'STL / 75'], ['blk_p75', 'BLK / 75'], ['pf_p75', 'PF / 75']] }] }
];
const LOW = new Set(['tov_pct', 'diff_drtg', 'pf30', 'ev_ast_pts_sh', 'ev_rim_astp', 'ev_mid_astp', 'ev_p3_astp', 'def_rim_fg_pm', 'def_rim_vol_pm', 'tov_p75', 'pf_p75']);
const SIGNED = k => /^diff_|pm$|^bpm$|^obpm$|^dbpm$|pm40/.test(k);
const isBig = r => { const p = r && +r.bpm_pos; return isFinite(p) && p >= 3.6; };
const n0 = v => (isFinite(+v) ? +v : 0);
/* a real season line's values (the per-75 box over the possessions he was on the floor for, as the profile's simple view) */
function realVals(r) {
  const o = Object.assign({ id: String(r.id) }, r), poss = n0(r.on_poss);
  o.ppg = r.gp ? r.pts / r.gp : null;
  const p75 = k => (poss >= 20 ? 75 * n0(r[k]) / poss : null);
  o.pts_p75 = p75('pts'); o.fgm_p75 = p75('fgm'); o.fga_p75 = p75('fga'); o.p3m_p75 = p75('p3m'); o.p3a_p75 = p75('p3a'); o.ftm_p75 = p75('ftm'); o.fta_p75 = p75('fta');
  o.reb_p75 = p75('reb'); o.oreb_p75 = p75('oreb'); o.dreb_p75 = p75('dreb'); o.ast_p75 = p75('ast'); o.tov_p75 = p75('tov'); o.stl_p75 = p75('stl'); o.blk_p75 = p75('blk'); o.pf_p75 = p75('pf');
  return o;
}
/* a simulated line's values: his share of his club's possessions, boards and shots while on, from the club's totals and
   the opponents' (core/season.js tstats), a 40-minute game */
function simVals(S, id) {
  const L = Mgr.season.lineOf(S, id), ci = A.clubOfPlayer ? A.clubOfPlayer(id) : null, T = ci != null ? S.tstats[ci] : null;
  if (!L || !L.gp || !T || !T.gp || !(L.min > 0)) return null;
  const on = L.min / (40 * T.gp), plays = L.fga + 0.44 * L.fta + L.tov, tPlays = T.fga + 0.44 * T.fta + T.tov, poss = on * T.poss;
  const pct = (a, b) => (b > 0 ? 100 * a / b : null);
  const o = { id: String(id), gp: L.gp, min: L.min };
  o.ppg = L.pts / L.gp; o.ts = pct(L.pts, 2 * (L.fga + 0.44 * L.fta)); o.efg = pct(L.fgm + 0.5 * L.p3m, L.fga); o.usg = pct(plays, on * tPlays); o.ftr = pct(L.fta, L.fga);
  o.fg_pct = pct(L.fgm, L.fga); o.rim_pct = pct(L.rimM, L.rimA); o.mid_pct = pct(L.midM, L.midA); o.p3_pct = pct(L.p3m, L.p3a); o.ft_pct = pct(L.ftm, L.fta);
  o.rim_a100 = pct(L.rimA, poss); o.mid_a100 = pct(L.midA, poss); o.p3_a100 = pct(L.p3a, poss); o.ft_a100 = pct(L.fta, poss);
  o.ast_pct = pct(L.ast, on * T.fgm - L.fgm); o.au = o.ast_pct != null && o.usg ? o.ast_pct / o.usg : null; o.ast_to = L.tov ? L.ast / L.tov : null; o.tov_pct = pct(L.tov, plays);
  o.oreb_pct = pct(L.oreb, on * (T.oreb + (T.odreb || 0))); o.dreb_pct = pct(L.dreb, on * (T.dreb + (T.ooreb || 0)));
  o.trb_pct = pct(L.oreb + L.dreb, on * (T.oreb + T.dreb + (T.odreb || 0) + (T.ooreb || 0)));
  o.stl_pct = pct(L.stl, on * (T.oposs || T.poss)); o.blk_pct = pct(L.blk, on * ((T.ofga || 0) - (T.ofg3a || 0))); o.pf30 = 30 * L.pf / L.min;
  const p75 = k => (poss > 5 ? 75 * L[k] / poss : null);
  o.pts_p75 = p75('pts'); o.fgm_p75 = p75('fgm'); o.fga_p75 = p75('fga'); o.p3m_p75 = p75('p3m'); o.p3a_p75 = p75('p3a'); o.ftm_p75 = p75('ftm'); o.fta_p75 = p75('fta');
  o.oreb_p75 = p75('oreb'); o.dreb_p75 = p75('dreb'); o.reb_p75 = poss > 5 ? 75 * (L.oreb + L.dreb) / poss : null; o.ast_p75 = p75('ast'); o.tov_p75 = p75('tov'); o.stl_p75 = p75('stl');
  o.blk_p75 = p75('blk'); o.pf_p75 = p75('pf');
  /* plus-minus over his minutes in the reader's games (the box scores kept) */
  const pi = S.people.indexOf(String(id)), LN = Mgr.season.LINE;
  let pm = 0, mins = 0;
  Object.keys(S.box || {}).forEach(r => (S.box[r] || []).forEach(side => side.forEach(l => { if (l[0] === pi) { pm += l[LN.length] || 0; mins += l[LN.indexOf('min')] || 0; } })));
  o.pm40 = mins >= 20 ? 40 * pm / mins : null;
  return o;
}
/* each row a bar: the value, and where it sits among the field (the top of the field fills it) */
function bars(sections, me, field, big) {
  const wrap = h('div.mg-bars');
  sections.forEach(sec => {
    const blocks = sec.blocks.filter(b => !b.bigsOnly || big).map(b => Object.assign({}, b, { rows: b.rows.filter(([k]) => isFinite(+me[k]) && me[k] != null) })).filter(b => b.rows.length);
    if (!blocks.length) return;
    const box = h('div.sec', h('div.mg-cap', { style: { margin: '12px 0 6px' } }, sec.title));
    blocks.forEach(b => {
      if (b.title) box.appendChild(h('div.mg-sub', { style: { margin: '6px 0 2px', fontWeight: '700' } }, b.title));
      b.rows.forEach(([k, label]) => {
        const v = +me[k], xs = field.map(x => +x[k]).filter(x => isFinite(x));
        let below = 0, eq = 0;
        xs.forEach(x => { if (x < v) below++; else if (x === v) eq++; });
        let p = xs.length ? (below + 0.5 * eq) / xs.length : null;
        if (p != null && LOW.has(k)) p = 1 - p;
        const pc = p == null ? null : Math.round(100 * p);
        const dp = k === 'ast_to' || k === 'au' ? 2 : 1;
        box.appendChild(h('div.mg-barrow', h('span.k', label), h('span.v', (SIGNED(k) && v > 0 ? '+' : '') + v.toFixed(dp)),
          h('span.track', h('i', { style: { width: (pc == null ? 0 : Math.max(2, pc)) + '%' }, 'data-band': pc == null ? '' : pc >= 80 ? 'a4' : pc >= 55 ? 'a3' : pc >= 30 ? 'a2' : 'a1' })),
          h('span.p', pc == null ? '–' : String(pc))));
      });
    });
    wrap.appendChild(box);
  });
  return wrap;
}

/* ------------------------------------------------------------------ a player --- */
async function player(host, args) {
  const id = String(args[0] || ''), lid = A.route.q ? A.route.q.get('l') : null;
  let L = A.leagueDataOf(id);
  if (lid && lid !== (L && L.L.id)) { try { L = await A.loadLeagueFor(lid); } catch (_) { /* his league as best we have it */ } }
  const row = L && L.byId.get(id), named = L && L.named.get(id);
  if (!row || !named) { host.appendChild(h('div.mg-panel', 'This player could not be found in the leagues loaded here.')); return; }
  const price = L.priced.get(id) || {}, at = L.attrs.get(id) || {}, share = L.share.get(id) || Mgr.cards.shareOf(row), slot = A.slotIn(L, id, share);
  const mine = (A.club && A.club.roster || []).some(e => String(e.id) === id);
  const S = A.club && A.view();
  host.appendChild(h('div.mg-top', h('span.mg-pos', { 'data-i18n-ctx': 'pos', style: { fontSize: '16px', height: '34px', minWidth: '46px' } }, A.SLOTS[slot]),
    h('div.who', A.nm(named.name, 'h1'), h('div.meta', mine ? h('span.mg-chip.royal', 'Your squad') : h('span', A.nm(named.teamName || '')), h('span', A.nm(L.L.name)),
      h('span', 'Value ', h('b', A.money(price.value))), h('span', 'Wage ', h('b', A.money(price.wage))))), h('div.grow'),
    A.club && A.club.status !== 'draft' ? h('a.mg-btn.primary', { href: mine ? '#/trade?out=' + encodeURIComponent(id) : '#/trade?in=' + encodeURIComponent(id) + '&l=' + encodeURIComponent(L.L.id) }, mine ? 'Trade him' : 'Trade for him') : null,
    h('a.mg-profile', { href: '../p/?p=' + encodeURIComponent(id), target: '_blank', rel: 'noopener', style: { marginTop: '0' } }, 'EPINOIA profile ↗')));
  const body = h('div');
  const put = k => { body.textContent = ''; body.appendChild(k === 'sim' ? simTab() : realTab()); };
  host.appendChild(h('div.mg-row', { style: { marginBottom: '14px' } }, tabsOf([['real', 'Real season'], ['sim', 'Manager season']], put)));
  host.appendChild(body);
  /* THE SIMPLE AND THE SCOUTING VIEW, as the player profile has them (Louie: "real/manager season on player profiles have
     to have the simple/scouting view stats as outlaid on the real player profile screens"): the profile's sections and
     rows (p/player.js SIMPLE_SECTIONS, BAR_SECTIONS), each a percentile bar - the real season against his league's
     players, the manager season against this manager league's */
  let view = A.stored('mgr_bars_view') === 'simple' ? 'simple' : 'scout';
  const viewSwitch = redraw => {
    const t = h('div.mg-tabs', { role: 'group', 'aria-label': 'Scouting or simple view' });
    [['scout', 'Scouting view'], ['simple', 'Simple view']].forEach(([k, l]) => t.appendChild(h('button', { type: 'button', 'aria-pressed': String(view === k),
      onclick: () => { view = k; A.store('mgr_bars_view', k); redraw(); } }, l)));
    return t;
  };
  function realTab() {
    const r = row, g = Math.max(1, r.gp || 1), wrap = h('div.mg-grid.side');
    const left = h('div.mg-stack'), right = h('div.mg-stack');
    left.appendChild(h('div.mg-panel', h('div.mg-h', h('h3', 'A game'), h('span.mg-sub', A.nm(L.L.seasonName || ''), ' · ', r.gp + ' games')),
      statGrid([['MIN', r.min / g], ['PTS', r.pts / g], ['REB', (r.reb || 0) / g], ['AST', (r.ast || 0) / g], ['STL', (r.stl || 0) / g], ['BLK', (r.blk || 0) / g], ['TO', (r.tov || 0) / g], ['PF', (r.pf || 0) / g]])));
    const barsHost = h('div.mg-panel');
    const draw = () => {
      barsHost.textContent = '';
      const field = (L.S.players || []).filter(x => (x.min || 0) >= 40).map(realVals), mineV = realVals(r);
      barsHost.appendChild(h('div.mg-row.between', { style: { marginBottom: '10px' } }, h('span.mg-sub', 'Against ' + field.length + ' players of ' + L.L.name), viewSwitch(draw)));
      barsHost.appendChild(bars(view === 'simple' ? SIMPLE : SCOUT, mineV, field, isBig(r)));
    };
    left.appendChild(barsHost); draw();
    const tot = share.reduce((a, v) => a + v, 0) || 1;
    right.appendChild(h('div.mg-panel.glow', h('div.mg-h', h('h3', 'Attributes'), h('span.mg-sub', 'for reading him; the games use his numbers')),
      h('div.mg-attrs', { style: { gridTemplateColumns: '1fr' } }, Mgr.ratings.ATTRS.map(a => h('div.row', h('span', a.label), A.attrChip(at[a.k]))))));
    right.appendChild(h('div.mg-panel', h('div.mg-h', h('h3', 'Minutes at each position')),
      h('div.mg-posmins', { 'data-i18n-ctx': 'pos' }, A.SLOTS.map((s2, k) => h('div.c', h('i', { style: { height: Math.max(3, Math.round(56 * share[k] / tot)) + 'px' } }), h('b', s2), h('span', Math.round(100 * share[k] / tot) + '%'))))));
    wrap.appendChild(left); wrap.appendChild(right);
    return wrap;
  }
  function simTab() {
    if (!S) return h('div.mg-panel', 'The manager season starts once your squad is confirmed.');
    const Ls = SE().lineOf(S, id), wrap = h('div.mg-stack');
    const club = A.clubOfPlayer ? A.clubOfPlayer(id) : null;
    if (!Ls || !Ls.gp) { wrap.appendChild(h('div.mg-panel', 'He has not played in this manager league yet.')); return wrap; }
    const g = Ls.gp;
    wrap.appendChild(h('div.mg-panel.glow', h('div.mg-h', h('h3', 'Manager season'), club != null ? h('span', A.crest(club, 20), ' ', A.clubLink(club)) : null, h('span.mg-sub', g + ' games')),
      statGrid([['MIN', Ls.min / g], ['PTS', Ls.pts / g], ['REB', (Ls.oreb + Ls.dreb) / g], ['AST', Ls.ast / g], ['STL', Ls.stl / g], ['BLK', Ls.blk / g], ['TO', Ls.tov / g], ['PF', Ls.pf / g],
        ['FG%', Ls.fga ? 100 * Ls.fgm / Ls.fga : null], ['3P%', Ls.p3a ? 100 * Ls.p3m / Ls.p3a : null], ['FT%', Ls.fta ? 100 * Ls.ftm / Ls.fta : null], ['TS%', Ls.fga + Ls.fta ? 100 * Ls.pts / (2 * (Ls.fga + 0.44 * Ls.fta)) : null]])));
    /* the bars: his simulated line against every man of this league with half the most games */
    const barsHost = h('div.mg-panel');
    const draw = () => {
      barsHost.textContent = '';
      const top = Object.values(S.stats).reduce((a, x) => Math.max(a, x[0]), 0);
      const field = Object.keys(S.stats).filter(i => S.stats[i][0] >= Math.max(1, top / 2)).map(i => simVals(S, S.people[+i])).filter(Boolean), mineV = simVals(S, id);
      barsHost.appendChild(h('div.mg-row.between', { style: { marginBottom: '10px' } }, h('span.mg-sub', 'Against ' + field.length + ' players of this manager league'), viewSwitch(draw)));
      barsHost.appendChild(mineV ? bars(view === 'simple' ? SIMPLE : SCOUT_SIM, mineV, field, isBig(row)) : h('p.mg-sub', 'Not enough of a season yet.'));
    };
    wrap.appendChild(barsHost); draw();
    /* his games in the box scores this league keeps (the reader's club's games) */
    const pi = S.people.indexOf(id), games = [];
    Object.keys(S.box).forEach(r => [0, 1].forEach(s2 => { const line = (S.box[r][s2] || []).find(x => x[0] === pi); if (line) games.push({ r: +r, line }); }));
    if (games.length) {
      const LN = SE().LINE, t = h('table.mg-table', h('thead', h('tr', h('th.l', 'Game'), ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'FG', '3P', 'FT', '+/−'].map(k => h('th', k)))));
      const tb = h('tbody');
      games.sort((a, b) => b.r - a.r).forEach(({ r, line }) => {
        const o = {}; LN.forEach((k, j) => { if (j > 0) o[k] = line[j]; });
        const f = S.fixtures.find(x => x.r === r && (x.h === 0 || x.a === 0));
        if (!f || !f.res) return;
        const pm = line[LN.length] || 0;
        tb.appendChild(h('tr', h('td.l', h('a', { href: '#/game/' + r }, 'Round ' + r), h('span.mg-sub', ' ' + f.res[0] + '–' + f.res[1])), h('td', A.fmt(o.min, 0)), h('td', h('b', String(o.pts))),
          h('td', String(o.oreb + o.dreb)), h('td', String(o.ast)), h('td', String(o.stl)), h('td', String(o.blk)), h('td', o.fgm + '-' + o.fga), h('td', o.p3m + '-' + o.p3a), h('td', o.ftm + '-' + o.fta),
          h('td', (pm > 0 ? '+' : '') + pm)));
      });
      t.appendChild(tb);
      wrap.appendChild(h('div.mg-panel', h('div.mg-h', h('h3', 'Against your club'), h('span.mg-sub', 'Box scores are kept for your own games')), h('div.mg-tablewrap', t)));
    }
    return wrap;
  }
  put('real');
  const first = host.querySelector('.mg-tabs button'); if (first) first.setAttribute('aria-pressed', 'true');
}

/* ------------------------------------------------------------------ a club --- */
function team(host, args) {
  const S = A.club && A.view(), i = +args[0];
  if (!S || !(i >= 0 && i < S.clubs.length)) { host.appendChild(h('div.mg-panel', 'No such club in this league.')); return; }
  const c = A.clubAt(i), T = SE().table(S), row = T.rows.find(r => r.id === i) || { w: 0, l: 0, gp: 0, pos: null, last5: [] };
  host.appendChild(h('div.mg-top', A.crest(i, 72), h('div.who', A.nm(c.name, 'h1'), h('div.meta', c.me ? h('span', 'Manager ', A.nm(A.club.manager, 'b')) : h('span', A.nm(A.lg.L.name)),
    h('span', h('b', row.w + '–' + row.l)), row.pos ? h('span', ordinal(row.pos) + ' of ' + S.clubs.length) : null, row.last5 && row.last5.length ? h('span.mg-form', row.last5.map(x => h('i.' + x, x))) : null)),
    h('div.grow'), c.me ? null : h('a.mg-profile', { href: '../t/?t=' + encodeURIComponent(c.id), target: '_blank', rel: 'noopener', style: { marginTop: '0' } }, 'Real club on EPINOIA ↗')));
  const body = h('div');
  const put = k => { body.textContent = ''; body.appendChild(k === 'results' ? results() : k === 'stats' ? stats() : roster()); };
  const tabs = tabsOf([['roster', 'Roster'], ['results', 'Results and fixtures'], ['stats', 'Team stats']], put);
  host.appendChild(h('div.mg-row', { style: { marginBottom: '14px' } }, tabs));
  host.appendChild(body);
  function members() {
    if (c.me) return (A.club.roster || []).map(e => String(e.id));
    const drafted = new Set((A.club.roster || []).map(e => String(e.id)));
    return A.lg.S.players.filter(r => String(A.lg.teamOf(r.id)) === String(c.id) && r.min > 0 && !drafted.has(String(r.id))).sort((a, b) => b.min - a.min).map(r => String(r.id));
  }
  function roster() {
    const t = h('table.mg-table', h('thead', h('tr', h('th.l', 'Player'), h('th', 'Pos'), h('th', 'GP'), h('th', 'MIN'), h('th', 'PTS'), h('th', 'REB'), h('th', 'AST'), h('th', 'STL'), h('th', 'BLK'),
      h('th', 'FG%'), h('th', '3P%'), h('th', 'Value'))));
    const tb = h('tbody');
    members().forEach(id => {
      const Ls = SE().lineOf(S, id), g = Ls && Ls.gp ? Ls.gp : 0, p = A.priceOf(id) || {};
      tb.appendChild(h('tr', h('td.l', A.playerLink(id)), h('td', h('span.mg-pos', { 'data-i18n-ctx': 'pos' }, A.posOf(id))), h('td', String(g)), h('td', g ? A.fmt(Ls.min / g) : '–'), h('td', g ? A.fmt(Ls.pts / g) : '–'),
        h('td', g ? A.fmt((Ls.oreb + Ls.dreb) / g) : '–'), h('td', g ? A.fmt(Ls.ast / g) : '–'), h('td', g ? A.fmt(Ls.stl / g) : '–'), h('td', g ? A.fmt(Ls.blk / g) : '–'),
        h('td', g && Ls.fga ? A.fmt(100 * Ls.fgm / Ls.fga) : '–'), h('td', g && Ls.p3a ? A.fmt(100 * Ls.p3m / Ls.p3a) : '–'), h('td', A.money(p.value))));
    });
    t.appendChild(tb);
    return h('div.mg-panel', h('div.mg-h', h('h3', 'Roster in this league'), h('span.mg-sub', c.me ? 'Your squad' : 'Its own players, less any you drafted · simulated stats')), h('div.mg-tablewrap', t));
  }
  function results() {
    const fs = S.fixtures.filter(f => f.h === i || f.a === i).sort((a, b) => a.r - b.r);
    return h('div.mg-panel', h('div.mg-fx', fs.map(f => A.fxRow(f))));
  }
  function stats() {
    const all = A.teamStatsOf(S).filter(x => x.gp), me = all.find(x => x.i === i);
    if (!me) return h('div.mg-panel', 'No games yet.');
    const cols = [['ppg', 'Points', -1], ['opp', 'Allowed', 1], ['ortg', 'Offensive rating', -1], ['drtg', 'Defensive rating', 1], ['pace', 'Possessions', -1], ['efg', 'eFG%', -1], ['p3', '3P%', -1],
      ['tov', 'TOV%', 1], ['orb', 'Off. rebounds', -1], ['drb', 'Def. rebounds', -1], ['ast', 'Assists', -1], ['stl', 'Steals', -1], ['blk', 'Blocks', -1]];
    const t = h('table.mg-table', h('thead', h('tr', h('th.l', 'Stat'), h('th', 'Club'), h('th', 'League'), h('th', 'Rank'))));
    const tb = h('tbody');
    cols.forEach(([k, l, dir]) => {
      const avg = all.reduce((a, x) => a + x[k], 0) / all.length, rank = 1 + all.filter(x => (dir < 0 ? x[k] > me[k] : x[k] < me[k])).length;
      tb.appendChild(h('tr', h('td.l', l), h('td', h('b', A.fmt(me[k]))), h('td', A.fmt(avg)), h('td', ordinal(rank))));
    });
    t.appendChild(tb);
    return h('div.mg-panel', h('div.mg-h', h('h3', 'Team stats'), h('span.mg-sub', 'Simulated, a game')), h('div.mg-tablewrap', t));
  }
  put('roster');
  const first = tabs.querySelector('button'); if (first) first.setAttribute('aria-pressed', 'true');
}
const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

A.views.player = { render: player };
A.views.team = { render: team };
})(typeof globalThis !== 'undefined' ? globalThis : self);
