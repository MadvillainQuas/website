/* ============================================================================
   WHICH SEASON A PAGE'S NUMBERS ARE FROM, AND CHOOSING IT ON A PLAYER'S PAGE (2026-10-02).

     node supabase/tests/player-scope.test.mjs

   What is held here:
     * seasonbar.js label(): "2026-27" and "2026-2027" are 2026/27, a one-year season and anything else as they are;
     * a player's seasons (p/player.js playerScopes) are every season he played under this profile and every linked
       one, newest first, one per season name (his league's 2025-26 and a cup's 2025-26 are one season of his), each
       competition under the profile he played most of its minutes under, the most-played competition first; with no
       season line yet, his club's competitions;
     * ALL is offered only for more than one competition played under one profile;
     * ?s= finds a season by how a person writes it, its name or its key, and anything else is the newest;
     * the page reads that season (or one competition of it) for the hero's tiles, the bars, the events and the game
       log, says which on the hero, and the club page's scoreboard says its season too.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + JSON.stringify(d).slice(0, 400) : '')); } };
function lift(src, signature) {
  const from = src.indexOf(signature);
  if (from === -1) throw new Error('cannot find ' + signature);
  let depth = 0;
  for (let j = src.indexOf('{', from); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(from, j + 1); }
  }
  throw new Error('unbalanced ' + signature);
}
const liftLine = (src, start) => { const i = src.indexOf(start); if (i < 0) throw new Error('cannot find ' + start); return src.slice(i, src.indexOf('\n', i)); };

/* ------------------------------------------------------------------ the label --- */
console.log('\nseasonbar.js label');
const SB = require(path.join(ROOT, 'epinoia', 'seasonbar.js'));
ok('2026-27 is 2026/27, and so is 2026-2027 (and 2026/2027, 2026 – 27)',
   SB.label('2026-27') === '2026/27' && SB.label('2026-2027') === '2026/27' && SB.label('2026/2027') === '2026/27' && SB.label('2026 – 27') === '2026/27');
ok('...a season named by one year, or anything else, is as it is; nothing is nothing',
   SB.label('2027') === '2027' && SB.label('Spring 2026') === 'Spring 2026' && SB.label(null) === '' && SB.label(' 2025-26 ') === '2025/26');

/* ------------------------------------------------------------- his seasons --- */
console.log('\na player\'s seasons and competitions (p/player.js playerScopes)');
const PJS = rd('epinoia', 'p', 'player.js');
const src = [liftLine(PJS, 'const seasonLabelOf = '), lift(PJS, 'async function playerScopes(pl, team)'),
             lift(PJS, 'function pickScopeSeason(list, ref)'), liftLine(PJS, 'const allOk = ')].join('\n');
function make(tables, linked) {
  const asked = [];
  const D = { all: async q => { asked.push(q); for (const [k, rows] of Object.entries(tables)) if (q.startsWith(k)) return typeof rows === 'function' ? rows(q) : rows; return []; } };
  const window = { EpinoiaData: D, EpinoiaSeasonBar: SB,
    EpinoiaLinks: { playerIds: (l, id) => (l && l.length ? [id].concat(l) : [id]) } };
  const api = new Function('window', 'LINKED_P', 'console', src + '\nreturn { playerScopes, pickScopeSeason, allOk };')(window, Promise.resolve(linked || null), { warn: () => {} });
  return { api, asked };
}
const COMPS = [
  { id: 'c-lg25', name: 'Primera FEB', kind: 'league', season_id: 's25', seasons: { id: 's25', name: '2025-26', starts_on: '2025-09-01', leagues: { name: 'Primera FEB' } } },
  { id: 'c-cup25', name: 'Copa Princesa', kind: 'cup', season_id: 's25', seasons: { id: 's25', name: '2025-26', starts_on: '2025-09-01', leagues: { name: 'Primera FEB' } } },
  { id: 'c-lg26', name: 'Primera FEB', kind: 'league', season_id: 's26', seasons: { id: 's26', name: '2026-27', starts_on: '2026-09-01', leagues: { name: 'Primera FEB' } } },
  { id: 'c-eu26', name: 'FIBA Europe Cup', kind: 'cup', season_id: 'e26', seasons: { id: 'e26', name: '2026-27', starts_on: '2026-09-20', leagues: { name: 'FIBA Europe Cup' } } }
];
{
  /* one person, two profiles: A in Primera FEB both seasons and the cup, B (his linked profile) in a European cup;
     in 2025-26 a mid-season move gives the league two rows */
  const apps = [
    { player_id: 'A', competition_id: 'c-lg25', season_id: 's25', team_id: 't1', gp: 10, min: 240 },
    { player_id: 'A', competition_id: 'c-lg25', season_id: 's25', team_id: 't2', gp: 6, min: 150 },
    { player_id: 'A', competition_id: 'c-cup25', season_id: 's25', team_id: 't1', gp: 2, min: 30 },
    { player_id: 'A', competition_id: 'c-lg26', season_id: 's26', team_id: 't2', gp: 1, min: 12 },
    { player_id: 'B', competition_id: 'c-eu26', season_id: 'e26', team_id: 't9', gp: 2, min: 61 }
  ];
  const { api, asked } = make({ 'player_season_stats?': apps, 'competitions?': COMPS }, ['B']);
  const sc = await api.playerScopes({ id: 'A' }, { id: 't2' });
  ok('his season lines are read for every linked profile', asked[0].startsWith('player_season_stats?player_id=in.(A,B)') && /&select=player_id,competition_id,season_id,team_id,gp,min$/.test(asked[0]) &&
     JSON.stringify(sc.ids) === '["A","B"]', asked);
  ok('one season a season name, newest first, named as a person writes it', sc.seasons.map(s => s.label).join() === '2026/27,2025/26', sc.seasons.map(s => s.label));
  const s26 = sc.seasons[0], s25 = sc.seasons[1];
  ok('...his league\'s 2026-27 and the European cup\'s 2026-27 are one season with two competitions, the most-played first, each under its profile',
     s26.comps.map(c => c.id + ':' + c.pid).join() === 'c-eu26:B,c-lg26:A' && s26.comps[0].league === 'FIBA Europe Cup', s26.comps);
  ok('...a season at two clubs is its minutes and games added together', s25.comps[0].id === 'c-lg25' && s25.comps[0].min === 390 && s25.comps[0].gp === 16, s25.comps);
  ok('ALL is offered for two competitions under one profile, never across two profiles, never for one competition',
     api.allOk(s25) && !api.allOk(s26) && !api.allOk({ comps: [{ id: 'x', pid: 'A' }] }) && !api.allOk(null));
  ok('?s= finds a season as a person writes it, by its name or its key; anything else, or nothing, is the newest',
     api.pickScopeSeason(sc.seasons, '2025/26') === s25 && api.pickScopeSeason(sc.seasons, '2025-26') === s25 &&
     api.pickScopeSeason(sc.seasons, '2025-2026') === s25 && api.pickScopeSeason(sc.seasons, 'nonsense') === s26 && api.pickScopeSeason(sc.seasons, null) === s26 &&
     api.pickScopeSeason([], '2025/26') === null);
}
{
  /* the season line view has not caught up: his club's competitions, as the page read them before */
  const { api, asked } = make({ 'player_season_stats?': [], 'games?': [{ competition_id: 'c-lg26' }, { competition_id: 'c-lg26' }], 'competitions?': COMPS.filter(c => c.id === 'c-lg26') });
  const sc = await api.playerScopes({ id: 'A' }, { id: 't2' });
  ok('no season line yet: his club\'s finished games say which competitions', asked.some(q => q.startsWith('games?or=(home_team_id.eq.t2,away_team_id.eq.t2)&status=eq.final')) &&
     sc.seasons.length === 1 && sc.seasons[0].comps[0].pid === 'A', sc);
  const none = await make({}).api.playerScopes({ id: 'A' }, null);
  ok('...and a free agent with nothing played has no seasons, and the page says nothing it cannot back', JSON.stringify(none) === '{"ids":["A"],"seasons":[]}');
}

/* ------------------------------------------------------------- the page reads it --- */
console.log('\nthe page reads the season shown, and says which');
{
  const scope = PJS.slice(PJS.indexOf('const paintScope = async kind =>'), PJS.indexOf('const drawComps = ()'));
  ok('the tiles, bars and events are the season\'s competitions (all, or one), his row found under the profile he played them under',
     /const ids = comps\.filter\(c => kind === 'all' \|\| c\.id === kind\)\.map\(c => c\.id\);/.test(scope) &&
     /const pids = new Set\(comps\.filter\(c => ids\.indexOf\(c\.id\) >= 0\)\.map\(c => c\.pid\)\);/.test(scope) &&
     /D\.season\(ids, \{ rows: false, trim: true \}\)/.test(scope) && /mine = field\.find\(r => pids\.has\(r\.id\)\)/.test(scope) &&
     /paintScopeLabel\(SEASON, kind\);/.test(scope));
  ok('...no longer every competition his club ever played, every season at once', !/games\?or=\(home_team_id\.eq\.\$\{team\.id\},away_team_id\.eq\.\$\{team\.id\}\)` \+\s*`&status=eq\.final&select=competition_id`\)\s*: \[\];/.test(PJS));
  const log = lift(PJS, 'async function seasonLog(ids, sn)');
  ok('the game log is the season shown, every linked profile\'s games in it', /player_uuid=\$\{who\}/.test(log) && /games!inner\(/.test(log) &&
     /&games\.competition_id=in\.\(\$\{comps\.join\(','\)\}\)/.test(log) && /LOG_ROWS = rows;/.test(log));
  const label = lift(PJS, 'function paintScopeLabel(sn, kind)');
  ok('the hero says the season, large, and the competition beside it (or all competitions)', /el\('span', 'is-l', 'season'\), el\('span', 'is-v', sn\.label\)/.test(label) &&
     /'all competitions'/.test(label) && /setAttribute\('translate', 'no'\)/.test(label));
  const html = rd('epinoia', 'p', 'index.html');
  ok('p/index.html: the season line in the hero, the chips between it and the tiles, seasonbar.js before player.js',
     /<div class="idseason" id="idseason" hidden><\/div>/.test(html) && html.indexOf('id="pscope"') < html.indexOf('id="tiles"') &&
     html.indexOf('id="idseason"') < html.indexOf('id="pscope"') && html.indexOf('seasonbar.js') > 0 && html.indexOf('seasonbar.js') < html.indexOf('src="player.js'));
  ok('a season chip is a link (?s=) that redraws in place, a modified click left to the browser; the reader\'s choice is put in the address, the default is not',
     /a\.href = scopeHref\(sn, null\);/.test(PJS) && /if \(ev\.metaKey \|\| ev\.ctrlKey \|\| ev\.shiftKey \|\| ev\.altKey \|\| ev\.button\) return;/.test(PJS) &&
     /if \(picked\) syncScopeUrl\(SEASON, scopeKind\);/.test(PJS) && /await chooseSeason\(SEASON, q0\.get\('c'\)\);/.test(PJS));
}
{
  const TJS = rd('epinoia', 't', 'team.js'), CSS = rd('epinoia', 'kit', 'clubhero.css');
  const rec = lift(TJS, 'async function record(team)'), choose = lift(TJS, 'async function chooseSeason(team, lg)');
  ok('the club\'s scoreboard says its season, on a line across its top', /if \(SEASON_LABEL\) \{/.test(rec) && /h\.dataset\.k = 'season';/.test(rec) &&
     /wrap\.insertBefore\(h, wrap\.firstChild\);/.test(rec) && /\[data-k="season"\]\{grid-column:1\/-1;/.test(CSS) && /#rec\.has-season > div:nth-child\(-n\+5\)\{border-top:0\}/.test(CSS));
  ok('...a league with one season still names it; the chosen one when there is a choice',
     choose.indexOf("SEASON_LABEL = o.current ? seasonText(o.current.name) : '';") >= 0 &&
     choose.indexOf("SEASON_LABEL = o.current ? seasonText(o.current.name) : '';") < choose.indexOf('if (!o.list || o.list.length < 2) return;') &&
     /SEASON_LABEL = seasonText\(season\.name\);/.test(choose));
  ok('...and the depth chart names its season with the same label', /const season = SEASON_NAME \? seasonText\(SEASON_NAME\) : '';/.test(TJS));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
