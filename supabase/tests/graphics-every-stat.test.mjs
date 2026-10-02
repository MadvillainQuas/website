/* ============================================================================
   EVERY STAT ON EVERY GRAPHIC THAT TAKES STATS (socialcard.js, admin/socialgfx-ui.js, admin/statcat.js, admin/graphics-ui.js).

     node supabase/tests/graphics-every-stat.test.mjs

   Each stat a picker offers - the graphic's own and every column of the site's catalogue (BPM, OBPM, DBPM, VORP, the
   percentages, the per-game and total columns, the club ratings) - is chosen on each template that takes stats, through
   the builder's own path (graphics-ui modulesOf / needKeys -> socialgfx builderModel -> socialcard draw), on the three
   shapes, and the drawing is recorded (every fillText): the stat's label and its value must be drawn, never "undefined"
   or "NaN", and a star's stat line is never cut short.

   What this found (and what was fixed with it):
     * a final's leaders: a site column chosen beside each leader ("Stats beside each leader") was drawn as a label with
       no figure ("27 PTS ·  PPG") - socialgfx decorate() worked the site's numbers for the final's team stats only, never
       for the leader and the top scorers; and its label was the club column's when the key is both (TRANS / FAST);
     * the stars of the week and of the month drew only the first four stats chosen (the first three big on the lead card,
       four on each row, cut with an ellipsis when long) and the starting-five layout only two or three: a fifth to eighth
       stat chosen never appeared anywhere;
     * the stars of the month shared the star's list, so a built-in stat chosen for a star or the week (PTS) was carried to
       the month, whose rows have only the site's columns: it was drawn as "undefined";
     * ticking one of a template's own stats dropped every site column chosen from the second box (toggleKey kept only
       the keys of its own order).
   ============================================================================ */
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d).slice(0, 1200))); } };
const sandbox = { console, module: undefined, setTimeout, clearTimeout, Intl, TextEncoder, document: { createElement: () => ({}) }, navigator: {}, matchMedia: () => ({ matches: false }) };
sandbox.self = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['epinoia/reportcard.js', 'epinoia/socialcard.js', 'epinoia/bpm.js', 'epinoia/season.js', 'epinoia/statinfo.js', 'epinoia/fulltable.js', 'epinoia/admin/statcat.js', 'epinoia/admin/socialgfx-ui.js', 'epinoia/admin/graphics-ui.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
const SC = sandbox.EpinoiaSocialCard, GX = sandbox.EpinoiaSocialGfx, X = sandbox.EpinoiaStatCat, UI = sandbox.EpinoiaGraphicsUI;
const teamsList = [['t0', 'Alpha Basket', '#fd0204'], ['t1', 'Bravo Basket', '#004d98'], ['t2', 'Charlie Basket', '#ffd100']].map(([id, name, colour]) => ({ id, name, short_name: name.slice(0, 3).toUpperCase(), colour }));
const iso = (d, h) => new Date(Date.UTC(2026, 8, d, h, 0)).toISOString();
const G = [['g1', iso(2, 18), 't0', 't1', 88, 79], ['g2', iso(5, 18), 't1', 't2', 70, 75], ['g3', iso(9, 18), 't2', 't0', 66, 90], ['g4', iso(12, 18), 't0', 't2', 81, 80],
  ['g5', iso(19, 18), 't1', 't0', 60, 77], ['g6', iso(26, 18), 't2', 't1', 72, 71], ['g7', iso(28, 20), 't0', 't1', 85, 84], ['g8', iso(29,18), 't1', 't2', 90, 88]
].map(([id, tipoff_at, h, a, hs, as]) => ({ id, competition_id: 'c1', tipoff_at, status: 'final', home_team_id: h, away_team_id: a, home_score: hs, away_score: as }));
const P = [['p1', 'Ann Ace', 0], ['p2', 'Bea Big', 0], ['p3', 'Cy Cold', 1], ['p4', 'Di Dime', 1], ['p5', 'Ed Even', 2], ['p6', 'Flo Few', 2]];
const mkStats = (name, k, j) => ({ min: (28 - j) * 60000, pts: 10 + ((k * 5 + j * 7) % 18), p2m: 3 + (k % 3), p2a: 7, p3m: j % 3, p3a: 4, ftm: 2, fta: 3, or: j, dr: 3 + (k % 4), ast: 2 + j % 4, stl: k % 3, blk: j % 2, to: 1 + (j + k) % 4, pf: 2, pm: k - j, adv: { name, num: String(j + 1) } });
const lines = { games: G, pgs: [], tgs: [], teams: new Map(teamsList.map(t => [t.id, t])), teamName: id => (teamsList.find(t => t.id === id) || {}).name };
G.forEach((g, k) => [[0, g.home_team_id, g.home_score], [1, g.away_team_id, g.away_score]].forEach(([idx, tid, sc]) => {
  P.filter(p => p[2] === +tid.slice(1)).forEach((p, j) => lines.pgs.push({ game_id: g.id, player_uuid: p[0], team_idx: idx, stats: mkStats(p[1], k, j) }));
  lines.tgs.push({ game_id: g.id, team_idx: idx, stats: { adv: { pts: sc, fgm: 30, fga: 65, fg3m: 8, fg3a: 22, ftm: 15, fta: 20, oreb: 9, dreb: 28, ast: 18, stl: 7, blk: 3, tov: 12, minutes: 200, possessions: 78 } } });
}));
const data = { comps: [{ id: 'c1', name: 'Premier', kind: 'league' }], league: { name: 'L', timezone: 'UTC' }, teams: new Map(teamsList.map(t => [t.id, t])), finals: G, upcoming: [],
  standings: teamsList.map((t, i) => ({ competition_id: 'c1', team_id: t.id, rank: i + 1, gp: 5, w: 4 - i, l: 1 + i, diff: 5 - i, league_points: 9-i, pts_for: 400, pts_against: 390, streak: 'W1' })),
  since: new Date('2026-09-23'), now: new Date('2026-09-30'), until: new Date('2026-10-07'), offset: 0,
  players: new Map(G.map(g => [g.id, lines.pgs.filter(r => r.game_id === g.id).map(r => ({ game_id: g.id, team_idx: r.team_idx, stats: r.stats }))])), perQ: new Map() };
const recorder = () => { const log = []; let size = 10; const c = { log, textAlign: 'left', fillStyle: '', save() {}, restore() {}, set font(f) { const m = /(\d+)px/.exec(f); size = m ? +m[1] : size; }, get font() { return ''; }, measureText: t => ({ width: String(t).length * size * 0.56 }),
  fillText(t) { log.push(String(t)); }, fillRect() {}, createRadialGradient() { return { addColorStop() {} }; }, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {}, drawImage() {}, setLineDash() {}, scale() {}, clip() {} }; return c; };
const OPTS = UI.CATOPTS;
const pcat = X.available(X.catalogue('player', OPTS), X.rowsOf(lines, null).players), tcat = X.available(X.catalogue('team', OPTS), X.rowsOf(lines, null).teams);

const has = (log, s) => log.some(t => t.includes(s));
const odd = log => log.filter(t => /undefined|NaN/.test(t));
function build(tpl, mods, size, extra) {
  const b = UI.defaultBuilder(); b.tpl = tpl; Object.assign(b.mods, mods); Object.assign(b, extra || {});
  const M = b.mods, cat = l => (l || []).filter(k => /^c:/.test(k));
  const sel = Object.assign({}, b, { lines, need: UI.needKeys(b), opts: OPTS, bounds: GX.monthBounds(new Date('2026-09-30T12:00:00Z'), 0, 'UTC'), by: b.by || 'gs', stat: M.rankStat, minGames: 0,
    keys: tpl === 'leaders' ? (M.leadCats || UI.LEAD_CAT_DEFAULT) : (cat(M.monthKeys).length ? cat(M.monthKeys) : UI.MONTH_DEFAULT), scope: M.leadScope, subject: M.leadSubject, rows: 0 });
  const r = GX.builderModel(data, sel, size, null);
  if (!r.model) return { log: [], model: null, reason: r.reason };
  const c = recorder(); const out = SC.draw(c, r.model, { size, modules: UI.modulesOf(b) });
  return { log: c.log, model: r.model, dropped: out.dropped };
}
const labelOf = (k, kind) => { const c = (kind === 'team' ? tcat : pcat).find(x => x.id === k); return c ? [c.label.toUpperCase()] : null; };
const vtext = v => String(v == null || v === '' ? '—' : v).replace(/^-(?=[\d.])/, '\u2212');
const said = (text, v, labs) => labs.some(l => text.includes(v + ' ' + l)) || (labs.some(l => text.includes(l)) && text.includes(v));
const ALL_P = UI.STAT_ORDER.concat(pcat.map(c => c.id));

ok('the catalogue is the site\'s, BPM, OBPM, DBPM and VORP with numbers', ['c:bpm', 'c:obpm', 'c:dbpm', 'c:vorp', 'c:ts', 'c:usg', 'c:fg_pct'].every(k => pcat.some(c => c.id === k)) && pcat.length > 60 && tcat.length > 40, [pcat.length, tcat.length]);

for (const size of ['portrait', 'square', 'story']) {
  console.log('\n' + size);
  /* a star, the week's and the month's stars: every stat, in lists of eight (every slot used), every layout */
  for (const [tpl, key, pool, layouts] of [['star', 'statKeys', ALL_P, ['']], ['weekstars', 'weekKeys', ALL_P, ['', 'hero', 'five']], ['monthstars', 'monthKeys', pcat.map(c => c.id), ['', 'hero', 'five']]]) {
    for (const layout of layouts) {
      const miss = [], weird = [], cut = [];
      for (let i = 0; i < pool.length; i += 8) {
        let keys = pool.slice(i, i + 8);
        if (keys.length < 3) keys = pool.slice(-3);
        const r = build(tpl, { [key]: keys, layout });
        if (!r.model) { miss.push(keys.join() + ': no graphic (' + r.reason + ')'); continue; }
        const rows = tpl === 'star' ? [r.model.stats] : r.model.rows.slice(0, layout === 'hero' ? 3 : 5).map(x => x.stats);
        const text = r.log.join('\n');
        keys.forEach(k => {
          const labs = labelOf(k, 'player') || SC.STAT_DEFS[k];
          rows.forEach((st, ri) => { if (!said(text, vtext(st[k]), labs)) miss.push(k + ' row ' + ri + ' (' + vtext(st[k]) + ')'); });
        });
        weird.push(...odd(r.log));
        cut.push(...r.log.filter(t => / · /.test(t) && !/  ·  /.test(t) && /…$/.test(t)));     // a stat line (the game line, "Club  ·  W 80–70 v ...", may be cut)
      }
      ok(tpl + (layout ? ' (' + layout + ')' : '') + ': every stat chosen is drawn, label and value, on every row shown', !miss.length, miss.slice(0, 12));
      ok('...never "undefined" or "NaN", never a stat line cut short', !weird.length && !cut.length, weird.concat(cut).slice(0, 6));
    }
  }
  /* the month's stars with a built-in stat carried over from the week: only the site's columns are the month's */
  {
    const r = build('monthstars', { monthKeys: ['pts', 'c:ppg', 'c:bpm', 'c:vorp'], statKeys: ['pts', 'reb', 'ast'], weekKeys: ['pts', 'reb', 'ast'] });
    ok('the month\'s stars never draw a night\'s stat they do not have (a carried-over PTS): no undefined', r.model && !odd(r.log).length && has(r.log, 'BPM') && has(r.log, 'VORP'), odd(r.log));
  }
  /* the table's columns: each of the table's own and every club column of the site's, with five others */
  {
    const miss = [], weird = [];
    for (const k of UI.COL_ORDER.concat(tcat.map(c => c.id))) {
      const keys = UI.COL_DEFAULT.filter(x => x !== k).slice(0, 5).concat([k]);
      const r = build('table', { cols: keys });
      const lab = (labelOf(k, 'team') || [SC.COL_DEFS[k]])[0];
      if (!r.model || !has(r.log, lab)) miss.push(k);
      weird.push(...odd(r.log));
    }
    ok('the table: every column, its header drawn', !miss.length, miss);
    ok('...never "undefined" or "NaN"', !weird.length, weird.slice(0, 5));
  }
  /* the leaders: every column of the site's, players and clubs */
  for (const subj of ['players', 'teams']) {
    const miss = [];
    for (const c of (subj === 'teams' ? tcat : pcat)) {
      const r = build('leaders', { leadCats: [c.id], leadSubject: subj });
      const lab = c.title && c.title.length <= 26 ? c.title : c.label;
      if (!r.model) { miss.push(c.id + ': ' + r.reason); continue; }
      if (!has(r.log, lab.toUpperCase()) && !has(r.log, lab)) miss.push(c.id + ' label');
      if (!has(r.log, r.model.boards[0].rows[0].value.replace(/^-(?=[\d.])/, '\u2212'))) miss.push(c.id + ' value');
      if (odd(r.log).length) miss.push(c.id + ' undefined');
    }
    ok('the leaders (' + subj + '): every category, its title and its leader\'s figure', !miss.length, miss);
  }
  /* a final: every team stat side by side, and every stat beside the leaders (one leader a side, and the top three) */
  {
    const miss = [];
    for (const k of UI.TEAM_ORDER.concat(tcat.map(c => c.id))) {
      const r = build('result', { teamStats: [k] });
      const lab = (labelOf(k, 'team') || [SC.TEAM_STAT_DEFS[k][0]])[0];
      const st = r.model && r.model.teamStats ? r.model.teamStats.home[k] : null;
      if (!r.model || !has(r.log, lab) || !st || !has(r.log, vtext(st.v)) || odd(r.log).length) miss.push(k);
    }
    ok('a final\'s team stats: every one, label and both sides\' figures', !miss.length, miss);
    for (const leaderN of ['', '3']) {
      const m2 = [];
      for (const k of UI.LEAD_ORDER.concat(pcat.map(c => c.id))) {
        const keys = ['pts', k].filter((x, i, a) => a.indexOf(x) === i);
        const r = build('result', { leaderKeys: keys, leaderN });
        const lab = (labelOf(k, 'player') || [SC.STAT_DEFS[k][1]])[0];
        const t = r.model && r.model.top.home, v = t && vtext(t.stats[k]);
        if (!r.model || !has(r.log, v + ' ' + lab) || odd(r.log).length) m2.push(k + ' (' + v + ' ' + lab + ')');
      }
      ok('a final\'s ' + (leaderN ? 'top three scorers' : 'leaders') + ': every stat beside them, its figure and its label', !m2.length, m2.slice(0, 12));
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
