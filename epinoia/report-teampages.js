'use strict';
/* ============================================================================
   THE CLUB'S REPORT (report.js on the club page, t/team.js reportTab): its modules.

     cover            the club's name and crest, the title and subtitle, its most-used five on a half court
     MAIN STATS       the four factors in a row; the ratings; the season line (half court and transition at both ends,
                      against the other side's starters and bench, the club's own starters and bench); REBOUNDS
                      ANALYSIS (what became of every shot attempt) after it, a page of its own when it does not fit
     SHOT CHART       offence and defence on the zones court, side by side, then one table of both ends zone by zone
                      in the court's colours, then both ends' shots on the half court over the zones, then the events
     PLAYERS          a card row a player: photo, name, his minutes at each position, and the stats of his position's
                      template (guard, wing, big), each tinted by his percentile in the competition
     DEPTH CHART      each position's share of minutes, the rotations with the average margin at each minute, and the
                      most-used lineups as a table
     COMBINATIONS     the five best and five worst trios, and the shot clock: 0-7, 8-16 and 17-24 seconds at both ends
     LEGEND           every statistic printed, defined

   ctx (from t/team.js): season() -> {S, mine, scopeComps, kind}, logs() -> {gs, byG, sideOf}, clubLogs(scopedSet),
   starters(compIds), depth(all) -> {c}, rebounds(S, mine) -> html, meta(ids), stints(gs) -> full stints, rapm(ids, fn).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaReportTeam = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* the club's season line, as report.js's catalogue reads it (added once) */
const TEAM_STATS = {
  ff_efg: { l: 'eFG%', dp: 1 }, ff_tov: { l: 'TOV%', dp: 1, low: true }, ff_oreb: { l: 'OREB%', dp: 1 }, ff_ftr: { l: 'FTr', dp: 1 },
  dff_efg: { l: 'OPP eFG%', dp: 1, low: true }, dff_tov: { l: 'OPP TOV%', dp: 1 }, dff_oreb: { l: 'OPP OREB%', dp: 1, low: true }, dff_ftr: { l: 'OPP FTr', dp: 1, low: true },
  ortg: { l: 'ORTG', dp: 1 }, drtg: { l: 'DRTG', dp: 1, low: true }, net: { l: 'NET', dp: 1, signed: true }, pace: { l: 'PACE', dp: 1, style: true },
  ft_pct: { l: 'FT%', dp: 1 },
  ev_half_pts_sh: { l: 'HALF-COURT %PTS', dp: 1, style: true }, evd_half_pts_sh: { l: 'DEF HALF-COURT %PTS', dp: 1, style: true },
  hc_ast_pct: { l: 'HALF-COURT AST%', dp: 1, style: true, rank: false },
  evd_half_tov_pct: { l: 'DEF HALF-COURT TO%', dp: 1 }, evd_half_efg: { l: 'DEF HALF-COURT eFG%', dp: 1, low: true },
  evd_half_ppp: { l: 'DEF HALF-COURT PTS / CHANCE', dp: 2, low: true },
  tr_def_delta: { l: 'TRANSITION PTS GIVEN v OPP AVG', dp: 1, signed: true, low: true, rank: false },
  evd_transition_ppp: { l: 'DEF TRANSITION PTS / CHANCE', dp: 2, low: true },
  vs_start_net: { l: 'VS STARTERS NET', dp: 1, signed: true, rank: false }, vs_start_ortg: { l: 'VS STARTERS ORTG', dp: 1, rank: false },
  vs_start_drtg: { l: 'VS STARTERS DRTG', dp: 1, low: true, rank: false },
  vs_bench_net: { l: 'VS BENCH NET', dp: 1, signed: true, rank: false }, vs_bench_ortg: { l: 'VS BENCH ORTG', dp: 1, rank: false },
  vs_bench_drtg: { l: 'VS BENCH DRTG', dp: 1, low: true, rank: false },
  own_start_net: { l: 'OUR STARTERS NET', dp: 1, signed: true, rank: false }, own_start_ortg: { l: 'OUR STARTERS ORTG', dp: 1, rank: false },
  own_start_drtg: { l: 'OUR STARTERS DRTG', dp: 1, low: true, rank: false },
  own_bench_net: { l: 'OUR BENCH NET', dp: 1, signed: true, rank: false }, own_bench_ortg: { l: 'OUR BENCH ORTG', dp: 1, rank: false },
  own_bench_drtg: { l: 'OUR BENCH DRTG', dp: 1, low: true, rank: false }
};
const TEAM_DEFS = {
  ortg: ['Offensive rating', 'Points scored per 100 possessions.'], drtg: ['Defensive rating', 'Points allowed per 100 possessions. Lower is better.'],
  net: ['Net rating', 'Offensive rating minus defensive rating.'], pace: ['Pace', 'Possessions per 40 minutes, both sides averaged.'],
  ev_half_pts_sh: ['Half-court share of points', 'The share of the club’s points scored in the half court (not a second chance, a fast break, off a turnover or after a timeout).'],
  evd_half_pts_sh: ['Opponents’ half-court share of points', 'The same share for what opponents scored against the club.'],
  hc_ast_pct: ['Half-court assist %', 'Of the club’s half-court baskets, the share that were assisted (its last forty games’ play-by-play).'],
  ev_half_tov_pct: ['Half-court turnover %', 'Turnovers per half-court chance. Lower is better.'],
  evd_half_tov_pct: ['Opponents’ half-court turnover %', 'Turnovers the club forces per half-court chance. Higher is better.'],
  ev_half_efg: ['Half-court eFG%', 'Effective field-goal percentage in the half court.'], evd_half_efg: ['Opponents’ half-court eFG%', 'Lower is better.'],
  ev_half_ppp: ['Half-court points per chance', 'Points per half-court chance (a trip ending in a shot, a turnover or free throws).'],
  evd_half_ppp: ['Opponents’ half-court points per chance', 'Lower is better.'],
  ev_transition_pts_sh: ['Transition share of points', 'The share of the club’s points scored in transition.'],
  tr_def_delta: ['Transition points given up against the opponents’ own average', 'Transition points a game opponents scored against the club, minus what the same opponents average in transition over the season. Below zero, the club gives up fewer than those opponents usually score.'],
  ev_transition_ppp: ['Transition points per chance', 'Points per transition chance.'], evd_transition_ppp: ['Opponents’ transition points per chance', 'Lower is better.'],
  vs_start_net: ['Against the starters', 'Net, offensive and defensive rating in the minutes the other side had four or more of its regular starters on (a regular starter: ten starts or more in the scope, or that game’s starters).'],
  vs_bench_net: ['Against the bench', 'The same ratings in every other minute.'],
  own_start_net: ['Our starters', 'Net, offensive and defensive rating in the minutes the club had four or more of its own regular starters on (the five who started most when fewer than five have ten starts).'],
  own_bench_net: ['Our bench', 'The same ratings in every other minute of the club’s.'],
  vs_start_ortg: ['Against the starters: offence', 'Points scored per 100 possessions against the other side’s starters.'],
  vs_start_drtg: ['Against the starters: defence', 'Points allowed per 100 possessions against the other side’s starters. Lower is better.'],
  vs_bench_ortg: ['Against the bench: offence', 'Points scored per 100 possessions against the other side’s bench.'],
  vs_bench_drtg: ['Against the bench: defence', 'Points allowed per 100 possessions against the other side’s bench. Lower is better.'],
  own_start_ortg: ['Our starters: offence', 'Points scored per 100 possessions with four or more of the club’s starters on.'],
  own_start_drtg: ['Our starters: defence', 'Points allowed per 100 possessions with four or more of the club’s starters on. Lower is better.'],
  own_bench_ortg: ['Our bench: offence', 'Points scored per 100 possessions in the club’s other minutes.'],
  own_bench_drtg: ['Our bench: defence', 'Points allowed per 100 possessions in the club’s other minutes. Lower is better.']
};

function modules(ctx) {
  const E = root.EpinoiaReport;
  const { block, title, esc } = E;
  Object.keys(TEAM_STATS).forEach(k => { if (!E.STATS[k] || /^(ft_pct|ortg|drtg|net|pace|ff_|dff_)/.test(k)) E.STATS[k] = TEAM_STATS[k]; });
  Object.keys(TEAM_DEFS).forEach(k => { if (!E.DEFS[k]) E.DEFS[k] = TEAM_DEFS[k]; });
  const RAPM = { map: null, running: false };
  const f1 = v => (E.isNum(v) ? (+v).toFixed(1) : '—');
  const sg1 = v => (E.isNum(v) ? (+v > 0 ? '+' : '') + (+v).toFixed(1) : '—');
  const nameOf = (meta, id) => (meta && meta[id] && meta[id].name) || 'Player';
  const surname = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : (p[0] || ''); };

  /* the club's season once: the season object, its row, its scope's games and its lineups' records */
  let seasonP = null;
  const season = () => seasonP || (seasonP = Promise.resolve(ctx.season()).catch(e => { seasonP = null; throw e; }));
  let stintP = null;
  const stints = () => stintP || (stintP = (async () => {
    const L = await ctx.logs();
    const st = await ctx.stints(L.gs);
    const ids = [...new Set(st.flatMap(s => s.player_ids || []))];
    const meta = ids.length ? await ctx.meta(ids).catch(() => ({})) : {};
    return { st, meta, L };
  })().catch(e => { stintP = null; throw e; }));

  /* ---------------- the cover ---------------- */
  const cover = {
    key: 'cover', title: 'Cover', on: true,
    async build(c) {
      let names = null, games = 0;
      try {
        const d = await ctx.depth(false);
        if (d && d.c && d.c.slots) { names = d.c.slots.map(s => (s.players[0] ? surname(s.players[0].name) : '')); games = d.c.games || 0; }
      } catch (_) { /* no lineups */ }
      try {
        const T = await season();
        const m = T && T.mine;
        if (m) {
          const rec = E.isNum(m.w) && E.isNum(m.l) ? m.w + '–' + m.l : '';
          c.facts = [['Club', c.name], ['Competition', c.scope], ['Record', rec], ['Games', m.gp ? m.gp + ' played' : ''],
            ['Net rating', E.isNum(m.net) ? sg1(m.net) + ' (ORTG ' + f1(m.ortg) + ', DRTG ' + f1(m.drtg) + ')' : ''],
            ['Pace', E.isNum(m.pace) ? f1(m.pace) + ' possessions a game' : '']];
        }
      } catch (_) { c.facts = [['Club', c.name], ['Competition', c.scope]]; }
      if (!names) return '<h4>The most-used five</h4><div class="rp-empty">No lineups on record yet.</div>';
      return '<h4>The most-used five<span>most minutes at each position' + (games ? ' · ' + games + ' games' : '') + '</span></h4>' +
        E.posCourtHTML([20, 20, 20, 20, 20], { names }) +
        '<p class="rp-note">Each spot names the player with the most minutes there this season (the depth chart’s first choice).</p>';
    }
  };

  /* ---------------- MAIN STATS ---------------- */
  async function halfCourtAst() {
    const SI = root.EpinoiaSituations;
    if (!SI || !SI.stamps || !SI.assistedShots || !SI.inGameOrder) return null;
    const L = await ctx.logs();
    let made = 0, ast = 0;
    L.gs.forEach(g => {
      const evs = L.byG[g.id] || [];
      if (!evs.length) return;
      const all = SI.inGameOrder(evs);
      const desc = SI.describe ? SI.describe(all) : { tags: {} };
      const plays = all.filter(e => e && !/^(loc|stype|tag|tags)$/.test(e.t));
      const st = SI.stamps(plays, desc.tags);
      const A = SI.assistedShots(plays).assisted;
      const side = L.sideOf[g.id];
      plays.forEach(e => {
        if (e.team !== side || !(e.t === 'p2_made' || e.t === 'p3_made')) return;
        const s = st.get(e);
        if (!s || s.second || s.offTo || s.transition) return;
        made++; if (A.has(e)) ast++;
      });
    });
    return made ? Math.round(1000 * ast / made) / 10 : null;
  }
  /* the ratings of a list of lineup records (lineupevents.js) */
  const LE = () => root.EpinoiaLineupEvents;
  function ratingsOf(recs) {
    const X = LE();
    if (!X || !recs || !recs.length) return null;
    const l = X.line(X.sum(recs));
    return l && l.mins > 0 ? l : null;
  }
  const main = {
    key: 'main', title: 'Main stats', page: 'MAIN STATS', on: true,
    async build(c, R) {
      const T = await season();
      if (!T || !T.mine) return [block('<div class="rp-empty">No team statistics for this club in this scope yet.</div>')];
      const { S, mine } = T;
      const teams = S.teams.map(r => Object.assign({}, r));
      const me = teams.find(r => r.id === mine.id);
      /* the transition points opponents scored against the club, against what they score on average */
      const tByT = new Map(teams.map(r => [r.id, r.ev_transition_ppg]));
      const mineGames = (S.games || []).filter(g => g.home_team_id === me.id || g.away_team_id === me.id);
      const oppAvg = mineGames.map(g => tByT.get(g.home_team_id === me.id ? g.away_team_id : g.home_team_id)).filter(E.isNum).map(Number);
      if (oppAvg.length && E.isNum(me.evd_transition_ppg)) me.tr_def_delta = Math.round(10 * (me.evd_transition_ppg - oppAvg.reduce((a, b) => a + b, 0) / oppAvg.length)) / 10;
      try { me.hc_ast_pct = await halfCourtAst(); } catch (_) { /* without it */ }
      /* against the other side's starters and bench, and the club's own: its play-by-play records */
      try {
        const scoped = new Set((S.games || []).map(g => g.id));
        const logs = await ctx.clubLogs(scoped);
        if (logs && logs.recs) {
          const SL = root.EpinoiaSeasonLine;
          const games = (await ctx.starters(T.scopeComps)) || [];
          const reg = SL ? SL.regularStarters(games, 10) : new Map();
          const sp = SL ? SL.splitRecs(logs.recs, LE(), { mode: 'regular', regular: reg }) : null;
          const put = (pre, l) => { if (!l) return; me[pre + '_net'] = Math.round(10 * l.net) / 10; me[pre + '_ortg'] = Math.round(10 * l.ortg) / 10; me[pre + '_drtg'] = Math.round(10 * l.drtg) / 10; };
          if (sp) { put('vs_start', ratingsOf(sp.start)); put('vs_bench', ratingsOf(sp.bench)); }
          /* the club's own: its regular starters, or the five who started most when fewer than five have ten starts */
          const count = new Map();
          games.forEach(g => { if (!Array.isArray(g.starters)) return; const i = g.home_team_id === me.id ? 0 : g.away_team_id === me.id ? 1 : -1; if (i < 0) return;
            (g.starters[i] || []).filter(Boolean).forEach(p => count.set(p, (count.get(p) || 0) + 1)); });
          let own = new Set([...count].filter(([, n]) => n >= 10).map(([p]) => p));
          if (own.size < 5) own = new Set([...count].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p));
          const st = [], bn = [];
          logs.recs.forEach(r => ((r.ids || []).filter(p => own.has(p)).length >= 4 ? st : bn).push(r));
          put('own_start', ratingsOf(st)); put('own_bench', ratingsOf(bn));
        }
      } catch (e) { if (root.console) root.console.warn('[report starters]', e); }
      const ff = [['Shooting', 'eFG%', 'ff_efg', 'dff_efg', false], ['Turnovers', 'TOV%', 'ff_tov', 'dff_tov', true],
                  ['Rebounding', 'OREB%', 'ff_oreb', 'dff_oreb', false], ['Free throws', 'FTr', 'ff_ftr', 'dff_ftr', false]];
      const Rf = E.ranker(teams, ff.flatMap(x => [x[2], x[3]]).concat(['ortg', 'drtg', 'net', 'pace']));
      const lowFF = new Set(['ff_tov', 'dff_efg', 'dff_oreb', 'dff_ftr']);
      const rk = k => { const p = Rf.pct(k, me.id); if (p == null) return ''; const pp = lowFF.has(k) ? p : p; return '<span class="rp-rk" data-b="' + E.band(pp) + '">' + E.ordinal(pp) + '</span>'; };
      R.legend.push('ff_efg', 'ff_tov', 'ff_oreb', 'ff_ftr');
      const ffHTML = '<div class="rp-ff">' + ff.map(([l, u, o, d, lowGood]) => {
        const ov = me[o], dv = me[d];
        const edge = E.isNum(ov) && E.isNum(dv) ? (lowGood ? dv - ov : ov - dv) : null;
        return '<div class="rp-ffc"><h4>' + l + ' · ' + u + '</h4><div class="rp-ffp">' +
          '<div class="rp-ffs' + (edge > 0.05 ? ' win' : '') + '"><b>' + f1(ov) + '</b><span>own ' + rk(o) + '</span></div>' +
          '<div class="rp-ffs' + (edge < -0.05 ? ' lose' : '') + '"><b>' + f1(dv) + '</b><span>allowed ' + rk(d) + '</span></div></div></div>';
      }).join('') + '</div>';
      const tiles = [['ORTG', 'ortg', false], ['DRTG', 'drtg', false], ['NET', 'net', true], ['PACE', 'pace', false]];
      const tileHTML = '<div class="rp-tiles" style="--n:4;margin-top:10px">' + tiles.map(([l, k, sg]) => '<div class="rp-tile' + (sg && +me[k] > 0 ? ' good' : sg && +me[k] < 0 ? ' bad' : '') + '"><b>' +
        (sg ? sg1(me[k]) : f1(me[k])) + '</b><span>' + l + ' ' + rk(k) + '</span></div>').join('') + '</div>';
      const out = [block(title('Four factors', [c.scope, 'own · allowed · the chip is the club’s place among ' + teams.length].filter(Boolean).join(' · ')) + ffHTML + tileHTML)];
      const groups = [
        ['EFFICIENCY', ['ts', 'ft_pct']],
        ['HALF COURT', ['ev_half_pts_sh', 'evd_half_pts_sh', 'hc_ast_pct', 'ev_half_tov_pct', 'evd_half_tov_pct', 'ev_half_efg', 'evd_half_efg', 'ev_half_ppp', 'evd_half_ppp']],
        ['TRANSITION', ['ev_transition_pts_sh', 'tr_def_delta', 'ev_transition_ppp', 'evd_transition_ppp']],
        ['AGAINST STARTERS & BENCH', ['vs_start_net', 'vs_start_ortg', 'vs_start_drtg', 'vs_bench_net', 'vs_bench_ortg', 'vs_bench_drtg']],
        ['OUR STARTERS & BENCH', ['own_start_net', 'own_start_ortg', 'own_start_drtg', 'own_bench_net', 'own_bench_ortg', 'own_bench_drtg']]
      ];
      const keys = groups.flatMap(g => g[1]);
      const Rk = E.ranker(teams, keys);
      R.legend.push(...keys);
      out.push(block(title('Season line', 'ranked among ' + teams.length + ' clubs where every club has the number') +
        '<div class="rp-groups">' + groups.map(([t, ks]) => '<div class="rp-g"><h4>' + esc(t) + '</h4>' + ks.map(k => E.statRowHTML(k, me, Rk)).join('') + '</div>').join('') + '</div>'));
      try {
        const html = await ctx.rebounds(S, mine);
        if (html) out.push(block(title('Rebounds analysis', 'what became of every shot attempt, by zone') + html, 'rp-reb'));
      } catch (_) { /* without it */ }
      R.legendExtra.push(['FOUR FACTORS', 'Shooting (eFG%), turnovers (per 100 possessions), offensive rebounding (share of own misses rebounded) and free-throw rate: the four things that decide a game, at both ends. The better end of each is boxed in green.'],
        ['REBOUNDS ANALYSIS', 'Every shot attempt in a zone went in, was rebounded by the shooter’s side, by the other side, or had no rebound; ORB% and DRB% are of the misses somebody rebounded.']);
      return out;
    }
  };

  /* ---------------- SHOT CHART ---------------- */
  const shots = {
    key: 'shots', title: 'Shot chart', page: 'SHOT CHART', on: true,
    async build(c, R) {
      const SC = root.EpinoiaShotChart;
      const L = await ctx.logs();
      if (!SC || !L || !L.gs.length) return [block('<div class="rp-empty">No finalised games yet.</div>')];
      const fetchEvents = async () => Object.values(L.byG);
      const ids = L.gs.map(g => g.id);
      const off = await SC.gather({ fetchEvents, gameIds: ids, playerId: null, sideOf: id => L.sideOf[id] });
      const def = await SC.gather({ fetchEvents, gameIds: ids, playerId: null, sideOf: id => 1 - L.sideOf[id] });
      if (!off.length && !def.length) return [block('<div class="rp-empty">No located shots for this club yet.</div>')];
      const court = (sh, view, colour) => {
        const h = E.el('div');
        SC.renderZones({ host: h, shots: sh, colour, minAttempts: 5, games: L.gs.length, zones: true, table: false, view, controls: false });
        return h.innerHTML;
      };
      const colour = c.accent || '#08603f';
      const head = (t, sh) => { const m = sh.filter(s => s.made).length; return '<div class="rp-cap">' + t + '<span>' + m + '/' + sh.length + (sh.length ? ' · ' + Math.round(100 * m / sh.length) + '%' : '') + '</span></div>'; };
      const out = [];
      out.push(block(title('Offence and defence by zone', 'the last ' + L.gs.length + ' games · each zone tinted against its break-even') +
        '<div class="rp-two"><div>' + head('Offence', off) + court(off, 'zones', colour) + '</div><div>' + head('Defence (opponents’ shots)', def) + court(def, 'zones', '#5d6b64') + '</div></div>'));
      /* both ends, zone by zone, in one table */
      const zr = sh => { const z = SC.zoneRows(sh, L.gs.length); return z.groups.concat(z.big); };
      const ro = zr(off), rd = zr(def);
      const byKey = rows => new Map(rows.map(r => [r.k || r.label, r]));
      const mo = byKey(ro), md = byKey(rd);
      /* FG% against the zone's break-even: green above it for the offence, under it for the defence */
      const cell = (r, def) => {
        if (!r || !r.att) return '<td>\u2014</td><td>\u2014</td><td>\u2014</td>';
        const d = E.isNum(r.fg) && E.isNum(r.be) ? (def ? r.be - r.fg : r.fg - r.be) : null;
        const b = d == null || r.att < 5 ? 0 : d >= 6 ? 4 : d >= 0 ? 3 : d >= -6 ? 2 : 1;
        return '<td>' + r.made + '/' + r.att + '</td><td>' + (E.isNum(r.share) ? f1(r.share) + '%' : '\u2014') + '</td><td data-b="' + b + '">' + f1(r.fg) + '</td>';
      };
      const cellD = r => cell(r, true);
      const keys = [...new Set(ro.map(r => r.k || r.label).concat(rd.map(r => r.k || r.label)))];
      out.push(block(title('Both ends, zone by zone', 'FG% green where it beats the zone’s break-even (offence) or holds opponents under it (defence)') +
        '<table class="rp-tbl"><thead><tr><th class="l">zone</th><th>off made/att</th><th>off % of shots</th><th>off FG%</th><th>def made/att</th><th>def % of shots</th><th>def FG%</th><th>break-even</th></tr></thead><tbody>' +
        keys.map(k => { const a = mo.get(k), b = md.get(k), any = a || b;
          return '<tr><td class="l">' + esc(any.label || k) + '</td>' + cell(a) + cellD(b) + '<td>' + (E.isNum(any.be) ? f1(any.be) : '—') + '</td></tr>'; }).join('') +
        '</tbody></table>'));
      /* the box score's half-court and transition cards over the season, at both ends (situations.js on every log) */
      try {
        if (root.EpinoiaSituations) {
          const run = def => E.sitSeason(L.gs.map(g => ({ events: L.byG[g.id] || [], teams: (g.roster_snapshot && g.roster_snapshot.teams) || null,
            side: def ? 1 - L.sideOf[g.id] : L.sideOf[g.id] })));
          const O = run(false), Dd = run(true);
          const pids = [...new Set([O, Dd].flatMap(x => x.half.scorers.concat(x.transition.scorers)).map(x => x.pid))];
          const names = {};
          try { const meta = await ctx.meta(pids); pids.forEach(id => { if (meta[id] && meta[id].name) names[id] = meta[id].name; }); } catch (_) { /* unnamed */ }
          out.push(block(title('Half court', 'the box score’s half-court card over the last ' + L.gs.length + ' games, both ends') +
            E.sitCardHTML(O.half, { key: 'half', colour, who: c.name + ' offence', names })));
          out.push(block(E.sitCardHTML(Dd.half, { key: 'half', colour: '#5d6b64', who: 'opponents against ' + c.name, names })));
          out.push(block(title('Transition', 'fast breaks, and within eight seconds of a defensive rebound or a steal') +
            E.sitCardHTML(O.transition, { key: 'transition', colour: '#b4572e', who: c.name + ' offence', names })));
          out.push(block(E.sitCardHTML(Dd.transition, { key: 'transition', colour: '#5d6b64', who: 'opponents against ' + c.name, names })));
        }
      } catch (e) { if (root.console) root.console.warn('[report situations]', e); }
      /* the events: what the club made of each situation, and what opponents made of the same */
      try {
        const T = await season();
        const SP = root.EpinoiaSitPanel;
        if (T && T.mine && SP && SP.html) {
          const h1 = SP.html({ kind: 'team', row: T.mine, field: T.S.teams, name: c.name, side: 'off' });
          const h2 = SP.html({ kind: 'team', row: T.mine, field: T.S.teams, name: c.name, side: 'def' });
          out.push(block(title('Events', 'second chances, transition, off turnovers, after timeouts and the half court, at both ends') +
            '<div class="rp-cap">Offence</div>' + h1 + '<div class="rp-cap" style="margin-top:10px">Defence</div>' + h2, 'rp-ev'));
        }
      } catch (_) { /* without it */ }
      R.legendExtra.push(['ZONES', 'The court cut into twelve areas, each tinted against its own break-even (paint 58%, mid-range 40%, three 35%): orange above, blue below, grey within two points; hatched where there are too few attempts to rate.'],
        ['BREAK-EVEN', 'The percentage a zone’s shots must go in at to be worth the league’s average possession.']);
      return out;
    }
  };

  /* ---------------- PLAYERS ---------------- */
  const players = {
    key: 'players', title: 'Players', page: 'PLAYERS', on: true,
    controls(host, state) {
      E.templateControl(host, state, { set: 'players', label: 'players page', pos: () => 'guard' });
      if (ctx.rapm) {
        const row = E.el('div', 'rp-rapm');
        const b = E.el('button', 'ep-btn mini', 'Calculate RAPM'); b.type = 'button';
        const say = E.el('span', null, 'ORAPM and DRAPM need every stint of the league’s season: worked out on request.');
        b.onclick = async () => {
          if (RAPM.running) return;
          RAPM.running = true; b.disabled = true;
          try {
            const T = await season();
            RAPM.map = await ctx.rapm((T.S.games || []).map(g => g.id), (d, n) => { say.textContent = 'reading the league’s games: ' + d + ' of ' + n + '…'; });
            say.textContent = 'RAPM worked out over ' + (RAPM.map ? RAPM.map.size : 0) + ' players.';
            state.rebuild();
          } catch (e) { say.textContent = 'RAPM could not be worked out: ' + (e.message || e); }
          RAPM.running = false; b.disabled = false;
        };
        row.append(E.el('span', 'rp-k', 'RAPM'), b, say);
        host.appendChild(row);
      }
    },
    async build(c, R) {
      const T = await season();
      if (!T || !T.S) return [block('<div class="rp-empty">No player statistics for this club in this scope yet.</div>')];
      const field = T.S.players.map(r => Object.assign({}, r));
      if (RAPM.map) field.forEach(r => { const v = RAPM.map.get(r.id); if (v) { r.orapm = v.orapm; r.drapm = v.drapm; r.rapm = v.rapm; } });
      field.forEach(E.derive);
      const squad = field.filter(r => r.teamId === T.mine.id && +r.gp > 0).sort((a, b) => (+b.mpg || 0) * (+b.gp || 0) - (+a.mpg || 0) * (+a.gp || 0));
      if (!squad.length) return [block('<div class="rp-empty">No player has played for the club in this scope yet.</div>')];
      /* his minutes at each position (the depth chart's, every player), his turnover types (the club's logs) */
      const posMin = new Map();
      try {
        const d = await ctx.depth(true);
        ((d && d.c && d.c.slots) || []).forEach((s, k) => s.players.forEach(p => { const m = posMin.get(String(p.id)) || [0, 0, 0, 0, 0]; m[k] += p.min; posMin.set(String(p.id), m); }));
      } catch (_) { /* without them */ }
      try {
        const L = await ctx.logs();
        const tt = E.turnoverTypes(L.byG);
        squad.forEach(r => { const t = tt.get(r.id); if (t && t.typed) { r.badpass_pg = Math.round(10 * t.bad / Math.max(1, +r.gp)) / 10; r.handle_pg = Math.round(10 * t.handle / Math.max(1, +r.gp)) / 10; } });
      } catch (_) { /* without them */ }
      const meta = await ctx.meta(squad.map(r => r.id)).catch(() => ({}));
      const allKeys = new Set();
      const sets = {};
      ['guard', 'wing', 'big'].forEach(g => { sets[g] = E.groupsFor(R.state, 'players', g); sets[g].forEach(x => x[1].forEach(k => allKeys.add(k))); });
      const Rk = E.ranker(field, [...allKeys]);
      R.legend.push(...allKeys);
      const SL = ['PG', 'SG', 'SF', 'PF', 'C'];
      const out = [block(title('The squad', squad.length + ' players · most minutes first · each stat tinted by its percentile among the ' + Rk.n + ' players of ' + (c.scope || 'the competition')))];
      squad.forEach(r => {
        const m = meta[r.id] || {};
        const pm = posMin.get(String(r.id));
        const tot = pm ? pm.reduce((a, b) => a + b, 0) : 0;
        const pct = tot > 0 ? pm.map(v => 100 * v / tot) : null;
        const grp = E.posGroup(pct, m.position);
        const top = pct ? pct.indexOf(Math.max(...pct)) : -1;
        const chips = pct ? pct.map((v, k) => v >= 1 ? '<span' + (k === top ? ' class="top"' : '') + '>' + SL[k] + ' ' + Math.round(v) + '%</span>' : '').join('') : (m.position ? '<span>' + esc(m.position) + '</span>' : '');
        const ph = m.photo_url ? '<span class="rp-ph"><img src="' + esc(m.photo_url) + '" alt="" crossorigin="anonymous"></span>'
          : '<span class="rp-ph"><b>' + esc((m.jersey ? m.jersey : (m.name || r.name || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2))) + '</b></span>';
        const nm = m.name || r.name || 'Player';
        const groups = sets[grp].map(([t, ks]) => '<div class="rp-pg2"><h5>' + esc(t) + '</h5><div class="rp-cells">' + ks.map(k => E.statCellHTML(k, r, Rk)).join('') + '</div></div>').join('');
        out.push(block('<div class="rp-pcard"><div class="rp-pid">' + ph + '<div class="rp-pname">' + (m.jersey ? '#' + esc(m.jersey) + ' ' : '') + esc(nm) + '</div>' +
          '<div class="rp-pmeta">' + esc(grp) + ' · ' + (r.gp || 0) + ' gp · ' + f1(r.mpg) + ' mpg · ' + f1(r.ppg) + ' ppg</div>' +
          '<div class="rp-ppos">' + chips + '</div></div><div class="rp-pgroups">' + groups + '</div></div>'));
      });
      return out;
    }
  };

  /* ---------------- DEPTH CHART ---------------- */
  const depth = {
    key: 'depth', title: 'Depth chart', page: 'DEPTH CHART', on: true,
    async build(c, R) {
      const X = root.EpinoiaDepth, Ro = root.EpinoiaRotation, Ln = root.EpinoiaLineups;
      const out = [];
      try {
        const d = await ctx.depth(false);
        if (d && d.c && X && X.shareHTML) out.push(block(title('Depth chart', 'each player’s share of the minutes at each position') + '<div class="rp-dc">' + X.shareHTML(d.c, {}) + '</div>'));
      } catch (_) { /* without it */ }
      try {
        const L = await ctx.logs();
        if (Ro && L.gs.length) {
          const games = L.gs.filter(g => g.roster_snapshot && g.roster_snapshot.teams && Array.isArray(g.starters)).map(g => ({
            side: L.sideOf[g.id],
            model: Ro.compute({ status: 'final', period: g.period || 4, clockMs: 0, teams: g.roster_snapshot.teams, starters: g.starters, events: L.byG[g.id] || [] })
          }));
          if (games.length) {
            const M = Ro.season(games, c.name);
            try { const meta = await ctx.meta(M.teams[0].rows.map(r => r.pid).filter(Boolean)); M.teams[0].rows.forEach(r => { const mm = meta[r.pid]; if (mm && mm.name && mm.name !== 'Player') r.name = mm.name; }); } catch (_) { /* the snapshot's names */ }
            out.push(block(title('Rotations', games.length + ' games, regulation only · the average margin at each minute beneath') + '<div class="rp-rot">' +
              Ro.html(M, { colours: [c.accent || '#08603f', '#8a9a92'], marginLabel: 'average margin at each minute · above the line ' + c.name + ' ahead' }) + '</div>'));
          }
        }
      } catch (e) { if (root.console) root.console.warn('[report rotations]', e); }
      try {
        const { st, meta } = await stints();
        let floor = 10, units = Ln.all(st, floor);
        while (units.length < 5 && floor > 2) { floor = Math.floor(floor / 2); units = Ln.all(st, floor); }
        units = units.slice(0, 10);
        if (units.length) {
          const rows = units.map(u => '<tr><td class="l names">' + u.ids.map(id => esc(surname(nameOf(meta, id)))).join(', ') + '</td><td>' + Math.round(u.mins) + '</td><td>' + Math.round(u.poss) + '</td>' +
            '<td>' + f1(u.ortg) + '</td><td>' + f1(u.drtg) + '</td><td class="' + (u.net > 0 ? 'pos' : u.net < 0 ? 'neg' : '') + '">' + sg1(u.net) + '</td>' +
            '<td>' + f1(u.efg) + '</td><td>' + f1(u.tov) + '</td><td>' + f1(u.oreb) + '</td><td>' + f1(u.ftr) + '</td><td>' + (u.pm > 0 ? '+' : '') + Math.round(u.pm || 0) + '</td></tr>').join('');
          out.push(block(title('The most-used lineups', 'every five with ' + floor + '+ minutes together, most minutes first') +
            '<table class="rp-tbl"><thead><tr><th class="l">lineup</th><th>min</th><th>poss</th><th>ORTG</th><th>DRTG</th><th>NET</th><th>eFG%</th><th>TOV%</th><th>OREB%</th><th>FTr</th><th>+/-</th></tr></thead><tbody>' + rows + '</tbody></table>'));
        }
      } catch (e) { if (root.console) root.console.warn('[report lineups]', e); }
      R.legendExtra.push(['DEPTH CHART', 'Every five on the floor ranked point guard to centre by the players’ positions; each player’s share of the minutes at each position.'],
        ['ROTATIONS', 'Each player’s share of every minute across the club’s games, with the club’s average margin at each minute beneath.']);
      return out.length ? out : [block('<div class="rp-empty">No lineups for this club yet.</div>')];
    }
  };

  /* ---------------- COMBINATIONS & SHOT CLOCK ---------------- */
  const combos = {
    key: 'combos', title: 'Combinations & shot clock', page: 'COMBINATIONS', on: true,
    async build(c, R) {
      const Ln = root.EpinoiaLineups, SCk = root.EpinoiaShotClock;
      const out = [];
      try {
        const { st, meta } = await stints();
        let floor = 20, trios = Ln.sized(st, 3, floor).filter(t => E.isNum(t.net));
        while (trios.length < 10 && floor > 3) { floor = Math.floor(floor / 2); trios = Ln.sized(st, 3, floor).filter(t => E.isNum(t.net)); }
        if (trios.length) {
          trios.sort((a, b) => b.net - a.net);
          const best = trios.slice(0, 5), worst = trios.slice(-5).reverse().filter(t => best.indexOf(t) < 0);
          const tbl = (rows, cap) => '<div><div class="rp-cap">' + cap + '</div><table class="rp-tbl"><thead><tr><th class="l">trio</th><th>min</th><th>ORTG</th><th>DRTG</th><th>NET</th></tr></thead><tbody>' +
            rows.map(t => '<tr><td class="l names">' + t.ids.map(id => esc(surname(nameOf(meta, id)))).join(', ') + '</td><td>' + Math.round(t.mins) + '</td><td>' + f1(t.ortg) + '</td><td>' + f1(t.drtg) + '</td>' +
              '<td class="' + (t.net > 0 ? 'pos' : t.net < 0 ? 'neg' : '') + '">' + sg1(t.net) + '</td></tr>').join('') + '</tbody></table></div>';
          out.push(block(title('Combinations', 'trios with ' + floor + '+ minutes together, by net rating') + '<div class="rp-two">' + tbl(best, 'Best five') + tbl(worst, 'Worst five') + '</div>'));
        }
      } catch (e) { if (root.console) root.console.warn('[report combos]', e); }
      try {
        const L = await ctx.logs();
        if (SCk && L.gs.length) {
          const own = [], opp = [];
          L.gs.forEach(g => { const Rr = SCk.compute({ events: L.byG[g.id] || [] }); (Rr.chances || []).forEach(r => (r.team === L.sideOf[g.id] ? own : opp).push(r)); });
          const W = [['0–7 s', 0, 8], ['8–16 s', 8, 17], ['17–24 s', 17, 1e9]];
          const rowsOf = list => { const first = list.filter(r => !r.second && r.dur != null); return W.map(([l, a, b]) => { const sub = first.filter(r => r.dur >= a && r.dur < b); return [l, sub.length, first.length, SCk.summary(sub)]; }); };
          const pc = v => (v == null ? '—' : (100 * v).toFixed(1));
          const tbl = (rows, cap, def) => '<div><div class="rp-cap">' + cap + '</div><table class="rp-tbl"><thead><tr><th class="l">shot clock</th><th>poss</th><th>share</th><th>PPP</th><th>eFG%</th><th>TOV%</th><th>OREB%</th><th>FTr</th></tr></thead><tbody>' +
            rows.map(([l, n, all, s]) => '<tr><td class="l">' + l + '</td><td>' + n + '</td><td>' + (all ? (100 * n / all).toFixed(1) + '%' : '—') + '</td>' +
              '<td>' + (s.ppp == null ? '—' : s.ppp.toFixed(2)) + '</td><td>' + pc(s.efg) + '</td><td>' + pc(s.tovPct) + '</td><td>' + pc(s.orebPct) + '</td><td>' + pc(s.ftr) + '</td></tr>').join('') + '</tbody></table></div>';
          out.push(block(title('Shot clock', 'every first chance of the last ' + L.gs.length + ' games by how long it ran from the change of possession') +
            tbl(rowsOf(own), 'Offence') + '<div style="height:10px"></div>' + tbl(rowsOf(opp), 'Defence (what opponents did)') +
            '<p class="rp-note">PPP: points per possession. A possession’s time runs from winning the ball to its last action; second chances after an offensive rebound are left out, so each row is how the first look ended.</p>'));
          R.legendExtra.push(['SHOT CLOCK', 'Possessions grouped by how long they ran: early offence (0–7 seconds), the middle of the clock (8–16) and late (17–24).'],
            ['PPP', 'Points per possession.']);
        }
      } catch (e) { if (root.console) root.console.warn('[report shot clock]', e); }
      return out.length ? out : [block('<div class="rp-empty">No play-by-play for this club yet.</div>')];
    }
  };

  const week = {
    key: 'week', title: 'Last 7 days', page: 'LAST 7 DAYS', on: false,
    async build() {
      const W = root.EpinoiaWeekly;
      if (!W || !ctx.week) return [];
      const rep = await ctx.week();
      return [block(W.render(rep, { window: 'the last seven days', saveable: false }))];
    }
  };
  const legend = { key: 'legend', title: 'Legend', on: true };
  return [cover, main, shots, players, depth, combos, week, legend];
}

return { modules, TEAM_STATS };
}));
