/* ============================================================================
   THE GRAPHICS TAB (epinoia/admin/graphics-ui.js over socialgfx-ui.js), with no browser.

     node supabase/tests/graphics-tab.test.mjs

   What is held here (the pure parts; the screen itself is looked at in a browser):
     * the week's posts are sorted by kind, each kind counted, and a filter keeps exactly one kind
       (results / stars / table / week ahead / roundup); a kind with nothing is not offered;
     * a player of the week is offered only when there were several games, and is the best game score of them;
     * the week picker: this week, last week, further back (never forward, never past a year); an earlier week
       reads the seven days ending then, has finals and their players, and no table and no week ahead;
     * one competition's view of the week holds its games, its table and no other's;
     * the builder's subject: the newest game unless one is named, any player of that game, one competition's
       list cut into pages; a week with nothing says why instead of drawing;
     * the builder's options are socialcard.js's modules, and an untouched builder is no modules at all;
       stat lines and columns keep within their limits and their own order; the memory is per league and
       survives garbage, a full disk and a missing localStorage;
     * every template has a module list and every module named is one the drawing knows.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const sandbox = { console, module: undefined, setTimeout, clearTimeout, Intl, TextEncoder };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['epinoia/reportcard.js', 'epinoia/socialcard.js', 'epinoia/admin/socialgfx-ui.js', 'epinoia/admin/graphics-ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const SC = sandbox.EpinoiaSocialCard, GX = sandbox.EpinoiaSocialGfx, UI = sandbox.EpinoiaGraphicsUI;
const DAY = 86400000;
const NOW = new Date('2026-09-30T12:00:00Z');

/* a fake week: two competitions, five finals (three in c1, two in c2), one live, two to come, players for every final */
const comps = [{ id: 'c1', name: 'Premier', kind: 'league' }, { id: 'c2', name: 'Cup', kind: 'cup' }];
const iso = d => new Date(NOW.getTime() + d * DAY).toISOString();
const G = [
  ['g1', 'c1', -1, 'final', 80, 70, 't1', 't2'], ['g2', 'c1', -2, 'final', 66, 71, 't3', 't4'], ['g3', 'c1', -6, 'final', 90, 88, 't2', 't3'],
  ['g4', 'c2', -3, 'final', 55, 50, 't1', 't4'], ['g5', 'c2', -5, 'final', 101, 99, 't2', 't4'], ['g6', 'c1', 0.01, 'scheduled', null, null, 't1', 't3'],
  ['g7', 'c2', 3, 'scheduled', null, null, 't2', 't3'], ['g8', 'c1', -0.1, 'live', 10, 9, 't1', 't2'],
  /* last week */ ['g9', 'c1', -9, 'final', 60, 61, 't1', 't3'], ['g10', 'c2', -12, 'final', 70, 65, 't2', 't3']
].map(([id, competition_id, d, status, home_score, away_score, home_team_id, away_team_id]) => ({ id, competition_id, tipoff_at: iso(d), status, home_score, away_score, home_team_id, away_team_id, venue: 'Hall ' + id }));
const TEAMS = ['t1', 't2', 't3', 't4'].map((id, i) => ({ id, name: 'Club ' + (i + 1), short_name: 'C' + (i + 1), colour: '#' + ['fd0204', '004d98', 'ffd100', '119911'][i] }));
const stats = (n, pts) => ({ pts, p2m: 3, p2a: 6, p3m: 1, p3a: 3, fta: 2, ftm: 2, oreb: 1, dreb: 3, ast: 2, stl: 1, blk: 0, tov: 1, pf: 2, pm: 4, min: 1500000, name: 'Player ' + n, num: String(n) });
const rowsFor = { player_game_stats: G.filter(g => g.status === 'final').flatMap((g, k) => [0, 1].flatMap(idx => [0, 1].map(j => Object.assign({ game_id: g.id, team_idx: idx }, stats(k * 10 + idx * 2 + j, 10 + k * 3 + idx * 5 + j))))),
  team_game_stats: [] };
const calls = [];
function client(games) {
  const q = table => {
    const b = { table, f: {}, select() { return b; }, eq() { return b; }, in(k, v) { b.f[k] = v; return b; }, range() { return b; }, gte(k, v) { b.f.gte = v; return b; }, lt(k, v) { b.f.lt = v; return b; },
      order() { return b; }, limit() { return b; },
      run() {
        if (table === 'games') {
          calls.push({ gte: b.f.gte, lt: b.f.lt });
          return { data: games.filter(g => (b.f.gte === undefined || g.tipoff_at >= b.f.gte) && (b.f.lt === undefined || g.tipoff_at < b.f.lt) && (!b.f.status || b.f.status.includes(g.status))) };
        }
        if (table === 'leagues') return { data: { id: 'L', name: 'Test League', slug: 'test', timezone: 'UTC', colour_a: '#ff6600' } };
        if (table === 'standings') { calls.push({ standings: true }); return { data: TEAMS.map((t, i) => ({ competition_id: 'c1', team_id: t.id, rank: i + 1, gp: 3, w: 3 - i, l: i, diff: 10 - 5 * i })) }; }
        if (table === 'teams') return { data: TEAMS };
        return { data: rowsFor[table] || [] };
      },
      maybeSingle() { return Promise.resolve(b.run()); }, then(res, rej) { return Promise.resolve(b.run()).then(res, rej); } };
    return b;
  };
  return { from: q, rpc: async () => ({ data: [{ instagram: '@testleague' }] }) };
}
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m }; };
const sb = client(G);

console.log('\nreading a week');
const now0 = await GX.read(sb, { id: 'L', name: 'Test League' }, comps, NOW);
ok('this week: the finals of the last seven days, the fixtures of the next, a live game neither', now0.finals.map(g => g.id).sort().join() === 'g1,g2,g3,g4,g5'
   && now0.upcoming.map(g => g.id).sort().join() === 'g6,g7', now0.finals.map(g => g.id) + ' / ' + now0.upcoming.map(g => g.id));
ok('...with the table', now0.standings.length === 4 && now0.offset === 0);
calls.length = 0;
const last = await GX.read(sb, { id: 'L', name: 'Test League' }, comps, NOW, -1);
ok('last week: the seven days ending a week ago - g9 and g10, nothing after, nothing to come', last.finals.map(g => g.id).sort().join() === 'g10,g9' && last.upcoming.length === 0, last.finals.map(g => g.id).join());
ok('...and no table (standings are only ever today\'s), and the query never asked for one', last.standings.length === 0 && !calls.some(c => c.standings) && last.offset === -1);
const wk3 = await GX.read(sb, { id: 'L', name: 'Test League' }, comps, NOW, -3);
ok('three weeks ago: a quiet week reads as empty, not as an error', wk3.finals.length === 0 && wk3.offset === -3);
ok('a positive offset is no future: it reads this week', (await GX.read(sb, { id: 'L', name: 'Test League' }, comps, NOW, 2)).offset === 0);

console.log('\nthe week picker');
ok('the words: this week, last week, n weeks ago', GX.weekLabel(0) === 'This week' && GX.weekLabel(-1) === 'Last week' && GX.weekLabel(-4) === '4 weeks ago' && GX.weekLabel(3) === 'This week');
ok('stepping back goes back, stepping on stops at this week, and nothing goes past a year', GX.stepWeek(0, -1) === -1 && GX.stepWeek(-1, 1) === 0 && GX.stepWeek(0, 1) === 0 && GX.stepWeek(-52, -1) === -52);

console.log('\nthe kinds, counted and filtered');
const list = GX.items(now0, 'portrait', null);
const byType = t => list.filter(x => x.type === t).length;
ok('every post has a kind', list.length > 0 && list.every(x => ['results', 'stars', 'table', 'ahead', 'roundup'].includes(x.type)), [...new Set(list.map(x => x.type))].join());
ok('two competitions: a roundup and a week ahead for each that has them, a table for the league (a cup has none), a result and a star for every final',
   byType('roundup') === 2 && byType('ahead') === 1 + 0 + 1 - 0 && byType('table') === 1 && byType('results') === 5, ['roundup', 'ahead', 'table', 'results', 'stars'].map(t => t + ':' + byType(t)).join(' '));
ok('...the stars: a player of the game for each of the five, a player of the week, and the stars of the week (there were several games)', byType('stars') === 7
   && list.filter(x => x.type === 'stars').some(x => x.model.label === 'Player of the week'));
const best = list.filter(x => x.type === 'stars' && x.model.label !== 'Player of the week').sort((a, b) => b.model.gameScore - a.model.gameScore)[0];
ok('the stars of the week are a card of their own under Stars: five players, ranked, one per player', (() => { const w = list.find(x => x.model.kind === 'weekstars'); return w && w.type === 'stars' && w.group === 'week' && w.model.rows.length === 5
   && new Set(w.model.rows.map(r => r.name + r.team.name)).size === 5 && w.model.rows.every((r, i) => i === 0 || r.gameScore <= w.model.rows[i - 1].gameScore); })());
ok('...built for the builder by game score, by points, or by pick (in the order given); earlier weeks too', (() => {
  const g = by => GX.builderModel(now0, { tpl: 'weekstars', by }, 'portrait', null);
  const pts = g('pts').model.rows.map(r => r.stats.pts), pool = g('gs').pool;
  const pick = GX.builderModel(now0, { tpl: 'weekstars', by: 'pick', picks: [pool[3].key, pool[0].key] }, 'portrait', null).model;
  return pts.every((v, i) => i === 0 || v <= pts[i - 1]) && pool.length > 5 && pick.rows.map(r => r.name).join() === pool[3].name + ',' + pool[0].name
    && GX.builderModel(now0, { tpl: 'weekstars', by: 'pick', picks: [] }, 'portrait', null).model === null && GX.builderModel(last, { tpl: 'weekstars' }, 'portrait', null).model !== undefined;
})());
ok('...the player of the week is the best of the players of the game', list.find(x => x.model.label === 'Player of the week').model.player.name === best.model.player.name
   && /player-of-the-week-/.test(list.find(x => x.model.label === 'Player of the week').model.key));
ok('...and says so in its words', /^Player of the week: /.test(SC.caption(list.find(x => x.model.label === 'Player of the week').model)));
const c = GX.counts(list);
ok('the chips: "All" and the count of everything first, then each kind that has any, in a set order', c[0].id === 'all' && c[0].n === list.length
   && c.slice(1).map(x => x.id).join() === 'results,stars,table,ahead,roundup' && c.slice(1).reduce((a, x) => a + x.n, 0) === list.length, JSON.stringify(c.map(x => x.id + ':' + x.n)));
ok('a kind with nothing is not offered', !GX.counts(list.filter(x => x.type !== 'table')).some(x => x.id === 'table') && GX.counts([]).length === 1 && GX.counts([])[0].n === 0);
ok('a filter keeps exactly one kind, "all" and nothing keep everything', GX.filterBy(list, 'stars').length === 7 && GX.filterBy(list, 'stars').every(x => x.type === 'stars')
   && GX.filterBy(list, 'all').length === list.length && GX.filterBy(list, '').length === list.length && GX.filterBy(list, 'nope').length === 0);
ok('...the counts on the chips are what the filters return', c.slice(1).every(x => GX.filterBy(list, x.id).length === x.n));
ok('a single game: no player of the week (there is nothing to pick between)', GX.items(GX.scope(now0, 'c2'), 'portrait', null).filter(x => x.model.label === 'Player of the week').length === 1
   && GX.items(Object.assign({}, now0, { finals: now0.finals.slice(0, 1), comps: [comps[0]] }), 'portrait', null).filter(x => x.model.label === 'Player of the week').length === 0);
const only1 = GX.items(GX.scope(now0, 'c1'), 'portrait', null);
ok('one competition\'s view: its games and table, none of the other\'s', only1.filter(x => x.type === 'results').length === 3 && only1.some(x => x.type === 'table') && GX.scope(now0, 'c2').standings.length === 0
   && GX.scope(now0, 'c2').finals.every(g => g.competition_id === 'c2') && GX.scope(now0, 'all') === now0 && GX.scope(now0, '') === now0);
const wkList = GX.items(last, 'portrait', null);
ok('an earlier week: results, stars and the roundup - no table, no week ahead', GX.counts(wkList).map(x => x.id).join() === 'all,results,stars,roundup', GX.counts(wkList).map(x => x.id + ':' + x.n).join());
ok('...the graphics say which days they cover (the seven days to then, not to today)', wkList.find(x => x.type === 'roundup').model.range === GX.rangeLabel(last.since, last.until));
const wide = GX.items(now0, 'story', null), sq = GX.items(now0, 'square', null);
ok('the shape changes how a list is cut, never what there is', wide.length >= list.length - 0 && sq.map(x => x.title).length >= 1 && sq.filter(x => x.type === 'results').length === 5);

console.log('\nthe builder\'s subject');
const b = (o) => GX.builderModel(now0, o, 'portrait', null);
const newest = now0.finals[now0.finals.length - 1];
ok('a final: the newest game when none is named, or the one named', b({ tpl: 'result' }).model.kind === 'result' && b({ tpl: 'result' }).game.id === newest.id && b({ tpl: 'result', gameId: 'g3' }).game.id === 'g3'
   && b({ tpl: 'result', gameId: 'gone' }).game.id === newest.id);
const r3 = b({ tpl: 'star', gameId: 'g3' });
ok('a star: the player of the game unless one is named, and any of the game\'s four when one is', r3.model.kind === 'performer' && r3.players.length === 4
   && r3.players[0].stats.pts >= r3.players[3].stats.pts && b({ tpl: 'star', gameId: 'g3', player: 3 }).model.player.name === r3.players[3].stats.adv.name && b({ tpl: 'star', gameId: 'g3', player: 99 }).model.kind === 'performer');
ok('...best first, and the pick is one of the game\'s own players', r3.players.every(p => p.game_id === 'g3'));
ok('a list: one competition\'s, the first when none is named', b({ tpl: 'week' }).comp.id === 'c1' && b({ tpl: 'week', compId: 'c2' }).model.rows.length === 2 && b({ tpl: 'week', compId: 'c1' }).model.rows.length === 3);
ok('...the table is the league\'s and a cup has none, and says so', b({ tpl: 'table' }).model.rows.length === 4 && b({ tpl: 'table', compId: 'c2' }).model === null && /no table/.test(b({ tpl: 'table', compId: 'c2' }).reason));
ok('...the week ahead likewise', b({ tpl: 'fixtures', compId: 'c1' }).model.rows.length === 1 && b({ tpl: 'fixtures', compId: 'c2' }).model.rows.length === 1);
const onePage = GX.builderModel(GX.scope(now0, 'c1'), { tpl: 'week', page: 7 }, 'portrait', null);
ok('a page beyond the last is the last', onePage.model.page === onePage.pages);
const lastB = GX.builderModel(last, { tpl: 'table' }, 'portrait', null);
ok('an earlier week has no table for the builder either, and the reason says why', lastB.model === null && /earlier week/.test(lastB.reason), lastB.reason);
ok('a week with nothing: no model, a reason, never a throw', GX.builderModel(wk3, { tpl: 'result' }, 'portrait', null).model === null && GX.builderModel(wk3, { tpl: 'week' }, 'portrait', null).model === null
   && GX.builderModel(Object.assign({}, now0, { comps: [] }), { tpl: 'table' }, 'portrait', null).reason.length > 0);
const many = Array.from({ length: 30 }, (_, i) => ({ id: 'x' + i, competition_id: 'c1', tipoff_at: iso(-1 - (i % 5) / 10), status: 'final', home_score: 80, away_score: 70, home_team_id: 't1', away_team_id: 't2' }));
ok('a long list is cut into pages for the shape, and the builder can pick one', GX.builderModel(Object.assign({}, now0, { finals: many }), { tpl: 'week', page: 1 }, 'portrait', null).pages === 4
   && GX.builderModel(Object.assign({}, now0, { finals: many }), { tpl: 'week', page: 1 }, 'portrait', null).model.page === 2);
ok('a game in a dropdown: the day, both clubs and the score', UI.gameLabel(G[0], id => TEAMS.find(t => t.id === id).name, 'UTC') === 'Tue 29 Sep · Club 1 80–70 Club 2', UI.gameLabel(G[0], id => TEAMS.find(t => t.id === id).name, 'UTC'));

console.log('\nthe builder\'s options');
const d0 = UI.defaultBuilder();
ok('an untouched builder is no modules at all: it draws what the weekly content does', Object.keys(UI.modulesOf(d0)).length === 0, JSON.stringify(UI.modulesOf(d0)));
const touched = UI.defaultBuilder();
Object.assign(touched.mods, { headline: ' Derby  night ', crests: false, rows: '6', theme: 'light', accent: '#ffe600', logoPos: 'footer', statKeys: ['pts', 'reb', 'ast', 'stl'], cols: ['w', 'l'], sponsor: 'Acme',
  teamStats: ['reb', 'tov'], leaderKeys: ['pts', 'stl'], leaderN: '3', weekExtras: ['venue', 'elo'], fixExtras: ['record'], zoneLabel: 'always' });
const as = tpl => UI.modulesOf(Object.assign({}, touched, { tpl }));
const mm = as('table');
ok('each option is a module, only what differs', mm.headline === 'Derby night' && mm.crests === false && mm.rows === 6 && mm.theme === 'light' && mm.accent === '#ffe600' && mm.logoPos === 'footer' && mm.zoneLabel === 'always'
   && mm.cols.join() === 'w,l' && mm.sponsor === 'Acme' && !('quarters' in mm) && !('handle' in mm), JSON.stringify(mm));
ok('...and each template takes only its own stats: the table its columns, the star its stat lines, the final its team stats and leaders, a results row and a fixture their own extras',
   as('star').statKeys.join() === 'pts,reb,ast,stl' && !as('star').cols && !as('star').teamStats && !as('table').statKeys && !as('table').teamStats
   && as('result').teamStats.join() === 'reb,tov' && as('result').leaderKeys.join() === 'pts,stl' && as('result').leaderN === 3 && !as('result').cols && !as('result').rowExtras
   && as('week').rowExtras.join() === 'venue,elo' && as('fixtures').rowExtras.join() === 'record' && !as('week').statKeys && !as('table').rowExtras && !as('star').rowExtras);
ok('...nothing chosen is nothing: an untouched result has no team stats, no leader lines, one leader a side', !('teamStats' in UI.modulesOf(UI.defaultBuilder())) && !('leaderN' in UI.modulesOf(UI.defaultBuilder())) && !('rowExtras' in UI.modulesOf(Object.assign(UI.defaultBuilder(), { tpl: 'week' }))));
ok('...and the dark theme, the league colour and both logos are the default, so no module', !('theme' in UI.modulesOf(Object.assign(UI.defaultBuilder(), { mods: Object.assign(UI.defaultBuilder().mods, { theme: 'dark', accent: '', logoPos: 'both', rows: '' }) }))));
ok('every template has a module list, and every template it names exists', UI.TEMPLATES.every(t => Array.isArray(UI.HAS[t.id]) && UI.HAS[t.id].includes('headline') && UI.HAS[t.id].includes('crests')) && Object.keys(UI.HAS).length === UI.TEMPLATES.length);
ok('...a star has stat lines and no rows, a table has rows and columns and no quarters, a final has quarters', UI.HAS.star.includes('stats') && !UI.HAS.star.includes('rows') && UI.HAS.table.includes('cols')
   && UI.HAS.table.includes('rows') && !UI.HAS.table.includes('quarters') && UI.HAS.result.includes('quarters'));
ok('the stat lines the builder offers are all ones the drawing knows, its default among them', UI.STAT_ORDER.every(k => SC.STAT_DEFS[k]) && UI.STAT_DEFAULT.every(k => UI.STAT_ORDER.includes(k)) && UI.COL_ORDER.every(k => SC.COL_DEFS[k])
   && UI.COL_DEFAULT.every(k => UI.COL_ORDER.includes(k)));
ok('a stat line is toggled in its own order, between three and eight', UI.toggleKey(['pts', 'reb', 'ast'], 'fg', UI.STAT_ORDER, 3, 8).join() === 'pts,reb,ast,fg'
   && UI.toggleKey(['pts', 'reb', 'ast'], 'stl', UI.STAT_ORDER, 3, 8).join() === 'pts,reb,ast,stl' && UI.toggleKey(['pts', 'reb', 'ast', 'fg'], 'reb', UI.STAT_ORDER, 3, 8).join() === 'pts,ast,fg');
ok('...never fewer than three, never more than eight (the list comes back as it was)', UI.toggleKey(['pts', 'reb', 'ast'], 'reb', UI.STAT_ORDER, 3, 8).join() === 'pts,reb,ast'
   && UI.toggleKey(UI.STAT_DEFAULT, 'stl', UI.STAT_ORDER, 3, 8).join() === UI.STAT_DEFAULT.join());
ok('columns: one to six, in the table\'s own order', UI.toggleKey(['gp', 'w', 'l', 'diff'], 'pf', UI.COL_ORDER, 1, 6).join() === 'gp,w,l,diff,pf' && UI.toggleKey(['w'], 'w', UI.COL_ORDER, 1, 6).join() === 'w'
   && UI.toggleKey(['gp', 'w', 'l', 'pct', 'diff', 'pf'], 'pa', UI.COL_ORDER, 1, 6).length === 6);

ok('every stat the builder offers is one the drawing knows: star lines, table columns, team stats, leader lines, row extras', UI.STAT_ORDER.every(k => SC.STAT_DEFS[k]) && UI.COL_ORDER.every(k => SC.COL_DEFS[k]) && UI.TEAM_ORDER.every(k => SC.TEAM_STAT_DEFS[k])
   && UI.LEAD_ORDER.every(k => SC.STAT_DEFS[k]) && Object.keys(SC.COL_DEFS).every(k => UI.COL_ORDER.includes(k)) && Object.keys(SC.STAT_DEFS).every(k => UI.STAT_ORDER.includes(k)) && Object.keys(SC.TEAM_STAT_DEFS).every(k => UI.TEAM_ORDER.includes(k)));
const need = (tpl, mods) => UI.needsExtras({ tpl, mods });
ok('ELO, form and home / away are read from the games only when a table asks for a column of them (or a row for ELO)', need('table', { cols: ['w', 'elo'] }) && need('table', { cols: ['l5'] }) && need('table', { cols: ['home'] }) && !need('table', { cols: ['w', 'pf'] }) && !need('table', { cols: null })
   && need('week', { weekExtras: ['elo'] }) && !need('week', { weekExtras: ['venue'] }) && need('fixtures', { fixExtras: ['record', 'elo'] }) && !need('fixtures', { fixExtras: ['record'] }) && !need('result', { cols: ['elo'], weekExtras: ['elo'] }) && !need('star', { cols: ['elo'] }));

console.log('\nELO and form, read from the games');
{
  const ex = await GX.readExtras(sb, comps);
  /* the fake games: t1 beat t2 (g1), t4 beat t3 (g2 lost by the home side t3), t2 beat t3 (g3), t1 beat t4 (g4), t2 beat t4 (g5), then last week's g9 (t3 beat t1), g10 (t2 beat t3) */
  const fin = G.filter(g => g.status === 'final').sort((a, b) => a.tipoff_at.localeCompare(b.tipoff_at));
  ok('every finished game of the competitions is read, none that is live or to come', ex.games === fin.length, ex.games + ' of ' + fin.length);
  const win = (team) => fin.filter(g => (g.home_team_id === team && g.home_score > g.away_score) || (g.away_team_id === team && g.away_score > g.home_score)).length;
  ok('form: the last five games as wins-losses (a club with fewer has all it played)', TEAMS.every(t => { const played = fin.filter(g => g.home_team_id === t.id || g.away_team_id === t.id); const last = played.slice(-5);
    const w = last.filter(g => (g.home_team_id === t.id) === (g.home_score > g.away_score)).length; return ex.l5.get(t.id) === w + '-' + (last.length - w); }), [...ex.l5].join(' '));
  ok('home and away records: each club\'s wins and losses in its own hall and on the road', TEAMS.every(t => {
    const h = fin.filter(g => g.home_team_id === t.id), a = fin.filter(g => g.away_team_id === t.id);
    return (h.length === 0 || ex.home.get(t.id) === h.filter(g => g.home_score > g.away_score).length + '-' + h.filter(g => g.home_score < g.away_score).length)
      && (a.length === 0 || ex.away.get(t.id) === a.filter(g => g.away_score > g.home_score).length + '-' + a.filter(g => g.away_score < g.home_score).length); }));
  ok('no ELO without sos.js loaded: the column is a dash rather than the tab failing', ex.elo.size === 0);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'epinoia/sos.js'), 'utf8'), ctx, { filename: 'epinoia/sos.js' });
  const ex2 = await GX.readExtras(sb, comps);
  const rated = TEAMS.map(t => ex2.elo.get(t.id));
  ok('with sos.js: a rating for each club that has played, 1500 the average - the winners above it, the losers below', rated.every(v => typeof v === 'number') && Math.abs(rated.reduce((a, v) => a + v, 0) / 4 - 1500) < 1
     && ex2.elo.get('t2') > ex2.elo.get('t3'), rated.map(v => Math.round(v)).join());
  ok('...the same rating the league page\'s table shows (sos.js eloRatings, from these games)', TEAMS.every(t => ex2.elo.get(t.id) === sandbox.EpinoiaSOS.eloRatings(fin).get(t.id).elo));
  const dataX = Object.assign({}, now0, { extras: ex2 });
  const tb = GX.builderModel(dataX, { tpl: 'table', compId: 'c1' }, 'portrait', null);
  ok('the table\'s rows carry ELO, form and records: drawn as columns when asked', tb.model.rows.every(r => r.elo != null && r.l5 && (r.home || r.away)) && tb.model.rows[0].elo === Math.round(ex2.elo.get('t1')));
  ok('...and without the extras the columns are empty, not wrong', GX.builderModel(now0, { tpl: 'table', compId: 'c1' }, 'portrait', null).model.rows.every(r => r.elo === null && r.l5 === ''));
  const wkx = GX.builderModel(dataX, { tpl: 'week', compId: 'c1' }, 'portrait', null).model.rows[0];
  ok('a results row has its records (from the standings) and its ELO', /^\d+-\d+$/.test(wkx.home.record) && wkx.home.elo != null && wkx.venue.length > 0 && wkx.time.length === 5);
  const fxx = GX.builderModel(dataX, { tpl: 'fixtures', compId: 'c1' }, 'portrait', null).model.rows[0];
  ok('...and a fixture\'s', /^\d+-\d+$/.test(fxx.home.record) && fxx.home.elo != null);
  const err = await GX.readExtras({ from: () => { const b = { select: () => b, in: () => b, order: () => b, range: () => Promise.resolve({ error: new Error('denied') }) }; return b; } }, comps).then(() => 'read', e => e.message);
  ok('a refused read says so (the tab shows it), never a silent empty column', err === 'denied', String(err));
  ok('nothing to read for no competitions', (await GX.readExtras(sb, [])).games === 0);
}

console.log('\nthe clock');
ok('three ways to show times: the league\'s own (the default: no module), the device\'s, UTC', UI.TZ_MODES.map(m => m[0]).join() === 'league,device,utc' && UI.zoneFor('league', 'Asia/Tokyo') === null && UI.zoneFor('utc', 'Asia/Tokyo') === 'UTC'
   && UI.zoneFor('device', 'Australia/Sydney') === 'Australia/Sydney' && UI.zoneFor('device', 'Mars/Olympus') === UI.deviceZone() && SC.validZone(UI.deviceZone()) !== null);
ok('...remembered per league, in this browser: another league starts on its own clock, garbage and a missing store are the league\'s', (() => {
  const st = store(); UI.saveTz('L1', 'device', st); UI.saveTz('L2', 'utc', st); st.setItem(UI.tzKey('L3'), 'moon');
  return UI.loadTz('L1', st) === 'device' && UI.loadTz('L2', st) === 'utc' && UI.loadTz('L9', st) === 'league' && UI.loadTz('L3', st) === 'league'
    && UI.loadTz('L', { getItem() { throw new Error('denied'); } }) === 'league' && (UI.saveTz('L', 'utc', { setItem() { throw new Error('full'); } }), true);
})());
{
  const utcLeague = { name: 'T', timezone: 'UTC' };
  const g = { tipoff_at: '2026-09-26T23:30:00Z', home: { name: 'A' }, away: { name: 'B' } };
  const m = SC.fixtures({ games: [g], league: utcLeague }, 'portrait')[0];
  ok('the tab\'s clock reaches the graphic and its words: Saturday 23:30 UTC, drawn for a Sydney device, is Sunday 09:30 AEST', SC.caption(m, Object.assign({}, UI.modulesOf(UI.defaultBuilder()), { zone: UI.zoneFor('device', 'Australia/Sydney') }))
     .includes('Sun 27 Sep 09:30 AEST') && SC.caption(m, {}).includes('Sat 26 Sep 23:30 · A v B'));
  ok('...a builder option to always name the zone, or never, rides along', UI.modulesOf(Object.assign(UI.defaultBuilder(), { mods: Object.assign(UI.defaultBuilder().mods, { zoneLabel: 'never' }) })).zoneLabel === 'never' && !('zoneLabel' in UI.modulesOf(UI.defaultBuilder())));
}

console.log('\nthe builder\'s memory');
const st = store();
const mine = UI.defaultBuilder();
mine.tpl = 'table'; mine.mods.rows = '4'; mine.mods.headline = 'Top four'; mine.mods.cols = ['w', 'l']; mine.gameId = 'g1';
UI.saveBuilder('L1', mine, st);
const back = UI.loadBuilder('L1', st);
ok('kept per league: the template and every option come back', back.tpl === 'table' && back.mods.rows === '4' && back.mods.headline === 'Top four' && back.mods.cols.join() === 'w,l');
ok('...the game is not kept (next week it is another), and another league starts from the defaults', back.gameId === '' && UI.loadBuilder('L2', st).tpl === 'result' && UI.loadBuilder('L2', st).mods.rows === '');
st.setItem(UI.memKey('L3'), '{not json');
ok('a garbled memory is the defaults', UI.loadBuilder('L3', st).tpl === 'result');
st.setItem(UI.memKey('L4'), JSON.stringify({ tpl: 'evil', mods: { rows: 5, theme: ['x'], cols: 'w', headline: { a: 1 }, crests: 'no', statKeys: ['pts', 'reb', 'ast'] } }));
const odd = UI.loadBuilder('L4', st);
ok('...and wrong types are dropped one by one: a stranger\'s template, a number where text goes, an object for words', odd.tpl === 'result' && odd.mods.rows === '' && odd.mods.theme === 'dark' && odd.mods.cols === null
   && odd.mods.headline === '' && odd.mods.crests === true && odd.mods.statKeys.join() === 'pts,reb,ast');
ok('whatever was kept, it draws only known modules', Object.keys(UI.modulesOf(odd)).every(k => ['statKeys'].includes(k)), JSON.stringify(UI.modulesOf(odd)));
ok('no storage, or a full one: nothing thrown', (() => { try { UI.saveBuilder('L', mine, { setItem() { throw new Error('full'); } }); return UI.loadBuilder('L', { getItem() { throw new Error('denied'); } }).tpl === 'result'; } catch (e) { return false; } })());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
