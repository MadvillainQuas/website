/* ============================================================================
   THE STORED SITUATIONS — stats.sit on every finalised game.

   epinoia/situations.js works out what second chances, breaks, turnovers,
   timeouts and half-court sets turned into; toStored() folds that into the
   compact line finalise-game writes under `sit` on each player_game_stats and
   team_game_stats row, and scripts/backfill_situations.mjs writes the same line
   on games finalised before it existed. The season tables read nothing else, so
   these hold the line itself:

     - the exact arrays for a log small enough to work out by hand (events.test.mjs's)
     - the field order every reader indexes by
     - the Edge Function's import arrangement, run as Deno runs it: generated ESM,
       no require, possessions.js on globalThis or nothing
     - finalise-game's source: the import order, `sit` on both rows, the paged log
     - the backfill's plan: the right PATCH bodies, every other key kept, a stale
       line removed, nothing written when the stored line is already right
     - three real LiveStats games through the ingest's translator: players add up
       to their side, and every player's line is the engine's box score

     node supabase/tests/situations-store.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as nodeModule from 'node:module';        // a namespace: stripTypeScriptTypes is missing on older node
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = nodeModule.createRequire(import.meta.url);
const stripTypeScriptTypes = nodeModule.stripTypeScriptTypes;
const Sit = require(path.join(ROOT, 'epinoia', 'situations.js'));
const engineSrc = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', 'engine.js'), 'utf8');
const E = await import('data:text/javascript;base64,' + Buffer.from(engineSrc).toString('base64'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const note = n => console.log('  NOTE  ' + n);

/* equal as values: object key order is not part of a line (jsonb reorders it anyway) */
const canon = v => Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = canon(v[k]), o), {}) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const show = v => JSON.stringify(v);

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sit-store-'));

/* ---- events.test.mjs's hand log, copied ------------------------------------ */
const player = (t, i, name) => ({ id: (t ? 'a' : 'h') + i, name, num: String(i) });
const S = {
  teams: [
    { name: 'Leeds Force', players: [1, 2, 3, 4, 5, 6].map(i => player(0, i, ['', 'Ada Stone', 'Bea Moss', 'Cy Hart', 'Dee Lowe', 'Eve Park', 'Flo <b>Ray</b>'][i])) },
    { name: 'Hull Pirates', players: [1, 2, 3, 4, 5, 6].map(i => player(1, i, ['', 'Gus Roe', 'Hal Fox', 'Ian Pike', 'Jo Kent', 'Kit Lane', 'Lou Dale'][i])) }
  ],
  starters: [['h1', 'h2', 'h3', 'h4', 'h5'], ['a1', 'a2', 'a3', 'a4', 'a5']],
  period: 2, clockMs: 500000,
  events: []
};
let seq = 0;
const ev = (t, team, pid, clock, extra, period) => { const s = ++seq; S.events.push(Object.assign({ id: s, seq: s, t, team, pid, period: period || 1, clock }, extra || {})); return s; };
const desc = (t, ref, extra) => { const s = ++seq; S.events.push(Object.assign({ id: s, seq: s, t, team: null, pid: null, period: 1, clock: null, ref }, extra)); };

ev('period_start', null, null, 600000);
ev('p2_miss', 0, 'h1', 590000);                                   // A1  half court
ev('reb', 0, 'h2', 588000, { off: true });
const putback = ev('p2_made', 0, 'h2', 587000);                   // A2  second chance, 2
desc('stype', putback, { v: 'putback' });
ev('p3_miss', 1, 'a1', 570000);                                   // B1  half court
ev('reb', 0, 'h3', 568000, { off: false });                       //     the break opens
const layup = ev('p2_made', 0, 'h3', 563000);                     // A3  transition (5 s), 2, assisted
desc('stype', layup, { v: 'layup' });
ev('ast', 0, 'h1', 563000);
ev('p2_miss', 1, 'a2', 550000);                                   // B2  half court
ev('reb', 0, 'h4', 548000, { off: false });
const jumper = ev('p2_miss', 0, 'h4', 530000);                    // A4  18 s after the rebound: half court
desc('stype', jumper, { v: 'jump shot' }); desc('loc', jumper, { x: 0.5, y: 0.3 });   // in the paint, but a jump shot
ev('reb', 1, 'a3', 528000, { off: false });
ev('to', 1, 'a3', 515000);                                        // B3  half court turnover
ev('stl', 0, 'h5', 515000);
ev('p3_made', 0, 'h5', 505000);                                   // A5  off the turnover, 3 (10 s: not a break)
ev('timeout', 1, null, 505000);                                   //     Hull's timeout
ev('p2_miss', 1, 'a4', 490000);                                   // B4  after timeout (own)
ev('reb', 1, 'a5', 488000, { off: true });
ev('p2_made', 1, 'a5', 487000);                                   // B5  second chance, 2 -- the same set
ev('p2_miss', 0, 'h1', 470000);                                   // A6  half court
ev('reb', 0, 'h1', 468000, { off: true });
ev('foul', 1, 'a1', 466000, { kind: 'shooting' });
ev('ft_made', 0, 'h1', 466000);                                   // A7  second chance, 1
ev('timeout', 0, null, 466000);                                   //     Leeds' timeout between free throws
ev('ft_made', 0, 'h1', 466000);                                   //     the engine has shut the window: not second chance
ev('p3_made', 1, 'a1', 450000);                                   // B6  after timeout (theirs), 3, assisted
ev('ast', 1, 'a2', 450000);
ev('foul', 0, 'h2', 440000, { kind: 'shooting' });
ev('ft_made', 1, 'a3', 440000);                                   // B7  half court, 1
ev('ast', 1, 'a4', 440000);                                       //     a pass that drew free throws
ev('ft_miss', 1, 'a3', 440000);
ev('reb', 0, 'h2', 438000, { off: false });
ev('timeout', 1, null, 438000);                                   //     the last timeout of the period: sets nothing up
ev('period_start', null, null, 600000, null, 2);
const late = ev('p2_made', 0, 'h6', 590000, null, 2);             // A9  half court, 2
desc('loc', late, { x: 0.5, y: 0.2 });

/* ---- the lines, worked out by hand ------------------------------------------
   Index order: pts fgm fga p3m p3a rimM rimA midM midA ftm fta tov [ch].
   Leeds (8 chances): A1 miss mid, A2 putback rim (second), A3 layup rim (break,
   assisted), A4 jump shot mid, A5 three (off the turnover), A6 miss mid, A7 two
   free throws after an offensive rebound (only the first is second chance), A9
   located two at the rim. Nobody on Leeds took a timeout play.
   Hull (7 chances): B1 missed three, B2 miss mid, B3 turnover, B4 miss mid and
   B5 its putback (one after-timeout set: 2 chances, ONE possession), B6 three
   (after Leeds' timeout, assisted), B7 1 of 2 free throws plus a pass that drew
   them. Hull shots carry no type or location, so every two is mid. */
const Z12 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const TEAM = [
  { v: 1,
    all:        [11, 4, 7, 1, 1, 3, 3, 0, 3, 2, 2, 0, 8],
    second:     [3, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 2],
    transition: [2, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 1],
    offTo:      [3, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1],
    ato:        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    half:       [2, 1, 4, 0, 0, 1, 1, 0, 3, 0, 0, 0, 4],
    ast: [1, 2, 0, 1, 0], unast: [3, 7, 1, 2, 0], ftAst: 0 },
  { v: 1,
    all:        [6, 2, 5, 1, 2, 0, 0, 1, 3, 1, 2, 1, 7],
    second:     [2, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1],
    transition: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    offTo:      [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ato:        [5, 2, 3, 1, 1, 0, 0, 1, 2, 0, 0, 0, 2],
    half:       [1, 0, 2, 0, 1, 0, 0, 0, 1, 1, 2, 1, 4],
    ast: [1, 3, 1, 0, 0], unast: [1, 2, 0, 0, 1], ftAst: 1 }
];
const PLAYERS = {
  h1: { v: 1, all: [2, 0, 2, 0, 0, 0, 0, 0, 2, 2, 2, 0], second: [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0], half: [0, 0, 2, 0, 0, 0, 0, 0, 2, 0, 0, 0] },
  h2: { v: 1, all: [2, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0], second: [2, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0], unast: [1, 2, 0, 1, 0] },
  h3: { v: 1, all: [2, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0], transition: [2, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0], ast: [1, 2, 0, 1, 0] },
  h4: { v: 1, all: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0], half: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
  h5: { v: 1, all: [3, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], offTo: [3, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], unast: [1, 3, 1, 0, 0] },
  h6: { v: 1, all: [2, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0], half: [2, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0], unast: [1, 2, 0, 1, 0] },
  a1: { v: 1, all: [3, 1, 2, 1, 2, 0, 0, 0, 0, 0, 0, 0], ato: [3, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], half: [0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0], ast: [1, 3, 1, 0, 0] },
  a2: { v: 1, all: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0], half: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
  a3: { v: 1, all: [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1], half: [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1] },
  a4: { v: 1, all: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0], ato: [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0] },
  a5: { v: 1, all: [2, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0], second: [2, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0], ato: [2, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0], unast: [1, 2, 0, 0, 1] }
  // a6 did nothing: no line
};

/* the names every stored index stands for, read off compute()'s own objects */
const FIELD_OF = {
  pts: b => b.pts, fgm: b => b.fgm, fga: b => b.fga, p3m: b => b.p3m, p3a: b => b.p3a,
  rimM: b => b.zones.rim.m, rimA: b => b.zones.rim.a, midM: b => b.zones.mid.m, midA: b => b.zones.mid.a,
  ftm: b => b.ftm, fta: b => b.fta, tov: b => b.tov, ch: b => b.chances
};
const AFIELD_OF = { fgm: g => g.fgm, pts: g => g.pts, p3m: g => g.p3m, rimM: g => g.zones.rim, midM: g => g.zones.mid };

console.log('\nthe stored line, worked out by hand');
const C = Sit.compute(S);
const St = Sit.toStored(C);
{
  ok('compute found its chance enumerator (node require)', C.possessions === true);
  ok('Leeds all is the contract\'s example: [11,4,7,1,1,3,3,0,3,2,2,0,8]', same(St.teams[0].all, [11, 4, 7, 1, 1, 3, 3, 0, 3, 2, 2, 0, 8]), show(St.teams[0].all));
  [0, 1].forEach(t => ok((t ? 'Hull' : 'Leeds') + ': the whole side line, every situation, assisted, unassisted and free-throw assists',
    same(St.teams[t], TEAM[t]), show(St.teams[t])));
  ok('every player line, exactly (and no line for the player who did nothing)',
    same(St.players, PLAYERS), show(St.players));
  ok('a6 has no sit at all', !('a6' in St.players));
  ok('side lines carry all six situations, 13 numbers each, and v:1',
    [0, 1].every(t => St.teams[t].v === 1 && Sit.KEYS.every(k => Array.isArray(St.teams[t][k]) && St.teams[t][k].length === 13)));
  ok('player lines carry 12 numbers (no ch) and only situations with something in them',
    Object.values(St.players).every(L => L.v === 1 && Sit.KEYS.every(k => !(k in L) || (L[k].length === 12 && L[k].some(Boolean)))));
  const bad = [];
  [0, 1].forEach(t => Sit.KEYS.forEach(k => Sit.FIELDS.forEach((f, i) => {
    if (St.teams[t][k][i] !== FIELD_OF[f](C.side[t].sits[k])) bad.push('team ' + t + ' ' + k + '.' + f);
  })));
  [0, 1].forEach(t => Object.keys(C.side[t].players).forEach(pid => {
    const p = C.side[t].players[pid], L = St.players[pid] || {};
    Sit.KEYS.forEach(k => Sit.FIELDS.slice(0, 12).forEach((f, i) => { if ((L[k] || Z12)[i] !== FIELD_OF[f](p.sits[k])) bad.push(pid + ' ' + k + '.' + f); }));
    ['ast', 'unast'].forEach(g => Sit.AFIELDS.forEach((f, i) => { if ((L[g] || [0, 0, 0, 0, 0])[i] !== AFIELD_OF[f](p[g])) bad.push(pid + ' ' + g + '.' + f); }));
  }));
  [0, 1].forEach(t => ['ast', 'unast'].forEach(g => Sit.AFIELDS.forEach((f, i) => {
    if (St.teams[t][g][i] !== AFIELD_OF[f](C.side[t].assists[g])) bad.push('team ' + t + ' ' + g + '.' + f);
  })));
  ok('each stored index is the field FIELDS / AFIELDS names there, for sides and players', bad.length === 0, bad.slice(0, 10).join(', '));
}

console.log('\nthe order every reader indexes by');
{
  ok('FIELDS', same(Sit.FIELDS, ['pts', 'fgm', 'fga', 'p3m', 'p3a', 'rimM', 'rimA', 'midM', 'midA', 'ftm', 'fta', 'tov', 'ch']), show(Sit.FIELDS));
  ok('AFIELDS', same(Sit.AFIELDS, ['fgm', 'pts', 'p3m', 'rimM', 'midM']), show(Sit.AFIELDS));
  ok('KEYS', same(Sit.KEYS, ['all', 'second', 'transition', 'offTo', 'ato', 'half']), show(Sit.KEYS));
  ok('VERSION is 1', Sit.VERSION === 1);
  const Season = require(path.join(ROOT, 'epinoia', 'season.js'));
  if (Season.SIT_FIELDS === undefined && Season.SIT_AFIELDS === undefined) note('epinoia/season.js does not export SIT_FIELDS / SIT_AFIELDS yet -- not checked');
  else ok('season.js reads the line by the same order (SIT_FIELDS, SIT_AFIELDS)',
    same(Season.SIT_FIELDS, Sit.FIELDS) && same(Season.SIT_AFIELDS, Sit.AFIELDS), show([Season.SIT_FIELDS, Season.SIT_AFIELDS]));
}

/* ---- as the Edge Function runs it ------------------------------------------ */
console.log('\nthe generated modules, imported as Deno imports them');
{
  const SHARED = path.join(ROOT, 'supabase', 'functions', '_shared');
  const child = path.join(TMP, 'deno-like.mjs');
  const gameFile = path.join(TMP, 'hand.json');
  fs.writeFileSync(gameFile, JSON.stringify(S));
  /* a fresh process each time: nothing on globalThis but what the imports put there,
     and as in Deno an ES module has no require and no module */
  fs.writeFileSync(child, [
    "import fs from 'node:fs';",
    "const [possPath, sitPath, gamePath, withPoss] = process.argv.slice(2);",
    "const imp = f => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(f, 'utf8')).toString('base64'));",
    "const out = { require: typeof require, module: typeof module };",
    "if (withPoss === '1') { const P = await imp(possPath); out.possNamed = typeof P.enumerate; out.possGlobal = globalThis.EpinoiaPossessions === P.default; }",
    "else out.possGlobal = typeof globalThis.EpinoiaPossessions;",
    "const M = await imp(sitPath);",
    "const C = M.compute(JSON.parse(fs.readFileSync(gamePath, 'utf8')));",
    "out.possessions = C.possessions;",
    "out.chances = C.side.map(s => s.sits.all.chances);",
    "out.named = ['compute','toStored','finish','howEnded','surname','KEYS','STAMPED','FIELDS','AFIELDS','VERSION','cumEl','inGameOrder'].filter(n => M[n] === undefined);",
    "out.sameDefault = M.default === globalThis.EpinoiaSituations;",
    "out.FIELDS = M.FIELDS; out.AFIELDS = M.AFIELDS;",
    "out.stored = M.toStored(C);",
    "process.stdout.write(JSON.stringify(out));"
  ].join('\n'));
  const run = withPoss => {
    const r = spawnSync(process.execPath, [child, path.join(SHARED, 'possessions.js'), path.join(SHARED, 'situations.js'), gameFile, withPoss ? '1' : '0'],
      { encoding: 'utf8', maxBuffer: 16 << 20 });
    try { return JSON.parse(r.stdout); } catch (_) { return { error: (r.stderr || r.stdout || '').slice(0, 400) }; }
  };
  const W = run(true);
  ok('possessions.js then situations.js: both load as ES modules with no require or module in scope',
    !W.error && W.require === 'undefined' && W.module === 'undefined' && W.possNamed === 'function' && W.possGlobal === true, W.error || show(W));
  ok('...every name finalise-game could import is exported, and the default is the global', W.named && W.named.length === 0 && W.sameDefault === true, show(W.named));
  ok('...compute finds the enumerator on globalThis: possessions true, chances 8 and 7', W.possessions === true && same(W.chances, [8, 7]), show([W.possessions, W.chances]));
  ok('...and stores exactly what node does', same(W.stored, St), show(W.stored));
  ok('...with the same field order', same(W.FIELDS, Sit.FIELDS) && same(W.AFIELDS, Sit.AFIELDS));
  const N = run(false);
  ok('situations.js WITHOUT possessions.js reports possessions:false (and its chances are the zeros it warns of)',
    !N.error && N.possGlobal === 'undefined' && N.possessions === false && same(N.chances, [0, 0]), N.error || show([N.possessions, N.chances]));
}

/* ---- finalise-game's source ------------------------------------------------ */
console.log('\nfinalise-game stores the line');
const FIN = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'finalise-game', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
const EVENT_MAP = '({ id: r.seq, seq: r.seq, t: r.t, team: r.team, pid: r.pid, period: r.period, clock: r.clock, ...(r.payload ?? {}) })';
{
  const iPoss = FIN.search(/^import '\.\.\/_shared\/possessions\.js';\s*$/m);
  const sitImport = FIN.match(/^import \{([^}]*)\} from '\.\.\/_shared\/situations\.js';\s*$/m);
  ok('possessions.js is imported for its side effect, BEFORE situations.js', iPoss >= 0 && sitImport && iPoss < sitImport.index,
     [iPoss, sitImport && sitImport.index].join(' '));
  const tailOf = f => {
    const m = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', '_shared', f), 'utf8').match(/export const \{ ([^}]*) \} = __api;/);
    return m ? m[1].split(',').map(s => s.trim()) : [];
  };
  const imported = sitImport ? sitImport[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) : [];
  const exported = tailOf('situations.js');
  ok('every name it imports from _shared/situations.js is in the generated export list (a missing one fails the function at boot)',
     imported.length > 0 && imported.every(n => exported.includes(n)), show({ imported, exported }));
  const iDerive = FIN.indexOf('const d = deriveGame(game);');
  const iCompute = FIN.indexOf('computeSituations(game)');
  const iRows = FIN.indexOf('const playerRows');
  ok('the situations are worked out after deriveGame and before the rows are built', iDerive >= 0 && iCompute > iDerive && iRows > iCompute);
  ok('...inside a try, so a throw there cannot stop a finalise',
     /try \{\s*const C = computeSituations\(game\);[\s\S]{0,600}?\} catch \(e\) \{/.test(FIN));
  ok('...and a run without the enumerator writes no line (possessions:false is not stored)',
     /if \(C && C\.possessions\) SIT = storedSituations\(C\);/.test(FIN) && /let SIT: [^=]*= null;/.test(FIN));
  ok('a player row carries sit AFTER its existing keys, only when he has a line',
     /stats: \{ \.\.\.d\.stats\[p\.id\], adv: playerAdv\(game, d, t, p, TA\[t\], TA\[1 - t\]\),\s*\.\.\.\(SIT && SIT\.players\[p\.id\] \? \{ sit: SIT\.players\[p\.id\] \} : \{\}\) \}/.test(FIN));
  ok('a team row carries sit AFTER adv, perQ and score',
     /stats: \{ \.\.\.d\.team\[t\], adv: TA\[t\], perQ: d\.perQ\[t\], score: d\.score\[t\],\s*\.\.\.\(SIT \? \{ sit: SIT\.teams\[t\] \} : \{\}\) \}/.test(FIN));
  ok('the log is read in pages of 1000 by seq until a short page',
     /for \(let from = 0; ; from \+= 1000\)/.test(FIN) &&
     /\.from\('game_events'\)\.select\('\*'\)\.eq\('game_id', gameId\)\s*\.order\('seq'\)\.range\(from, from \+ 999\)/.test(FIN) &&
     /data\.length < 1000/.test(FIN));
  ok('...and nowhere unpaged', (FIN.match(/from\('game_events'\)/g) || []).length === 1);
  ok('...a page that fails refuses the finalise instead of finalising a short log', /if \(log\.error\) return json\(/.test(FIN));
  ok('the event mapping is unchanged', FIN.includes('const events = (rows ?? []).map((r: any) =>\n    ' + EVENT_MAP + ');'));
  if (typeof stripTypeScriptTypes !== 'function') note('this node cannot strip TypeScript -- finalise-game syntax not checked');
  else {
    let js = null;
    try { js = stripTypeScriptTypes(FIN); } catch (e) { ok('finalise-game strips as TypeScript', false, String(e)); }
    if (js != null) {
      const f = path.join(TMP, 'finalise.mjs');
      fs.writeFileSync(f, js);
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
      ok('finalise-game parses (types stripped, node --check)', r.status === 0, (r.stderr || '').slice(0, 400));
    }
  }
}

/* ---- the backfill ---------------------------------------------------------- */
console.log('\nthe backfill plans the same line');
const BACKFILL = path.join(ROOT, 'scripts', 'backfill_situations.mjs');
let B = null;
{
  /* pointed at a config that does not exist: if importing it ever ran main(), it would
     throw on the key file before any request could be made */
  const realAppData = process.env.APPDATA;
  process.env.APPDATA = path.join(TMP, 'no-appdata');
  try { B = await import(pathToFileURL(BACKFILL).href); } catch (e) { B = null; ok('importing the backfill runs nothing', false, String(e)); }
  if (B) ok('importing the backfill runs nothing, and exports mapEvents / planGame / sameSit',
            typeof B.mapEvents === 'function' && typeof B.planGame === 'function' && typeof B.sameSit === 'function');
  const r = spawnSync(process.execPath, [BACKFILL, '--dry'], { encoding: 'utf8', env: Object.assign({}, process.env, { APPDATA: path.join(TMP, 'no-appdata') }) });
  ok('...while executing it does run main (it stops at the missing key file, before any request)',
     r.status !== 0 && /worker\.json/.test(r.stderr || ''), (r.stderr || r.stdout || '').slice(0, 300));
  if (realAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = realAppData;
}
if (B) {
  const BSRC = fs.readFileSync(BACKFILL, 'utf8');
  ok('its event mapping is finalise-game\'s, character for character', BSRC.includes(EVENT_MAP));

  /* the log as the database holds it: columns, and the rest in payload */
  const COLS = ['seq', 't', 'team', 'pid', 'period', 'clock'];
  const dbRows = S.events.map(e => {
    const payload = {};
    Object.keys(e).forEach(k => { if (k !== 'id' && !COLS.includes(k)) payload[k] = e[k]; });
    return { seq: e.seq, t: e.t, team: e.team, pid: e.pid, period: e.period, clock: e.clock, payload };
  });
  const events = B.mapEvents(dbRows);
  ok('mapEvents turns the stored rows back into the page\'s log', same(events, S.events));
  const pw = B.mapEvents([{ seq: 7, t: 'p2_made', team: 0, pid: 'x', period: 1, clock: 1000, payload: { team: 1, pid: 'y' } }])[0];
  ok('...with the payload winning over the columns, as in finalise-game', pw.id === 7 && pw.team === 1 && pw.pid === 'y', show(pw));

  const game = { id: 'g-hand', roster_snapshot: { teams: S.teams } };
  const pstats = pid => ({ pts: 9, to: 1, min: 600000, keep: 'kept ' + pid, adv: { min: 10, name: pid }, oc: { tPTS: 20 } });
  const reorder = v => Array.isArray(v) ? v.map(reorder)
    : v && typeof v === 'object' ? Object.keys(v).reverse().reduce((o, k) => (o[k] = reorder(v[k]), o), {}) : v;
  const fresh = () => ({
    playerRows: S.teams.flatMap((tm, t) => tm.players.map(p => ({ player_id: p.id, team_idx: t, stats: pstats(p.id) }))),
    teamRows: [0, 1].map(t => ({ team_idx: t, stats: { pts: [11, 6][t], score: [11, 6][t], adv: { pts: [11, 6][t] }, perQ: [[t]], tos: { h1: 0 } } }))
  });
  const R = fresh();
  R.playerRows.find(r => r.player_id === 'a6').stats.sit = { v: 1, all: [9, 9, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0] };   // stale
  R.playerRows.find(r => r.player_id === 'h2').stats.sit = reorder(PLAYERS.h2);                                   // already right, jsonb order
  const plan = B.planGame({ game, events, playerRows: R.playerRows, teamRows: R.teamRows });
  const T = plan.patches.filter(p => p.kind === 'team'), P = plan.patches.filter(p => p.kind === 'player');
  ok('plans a patch for both sides, with the hand-worked lines', plan.skip === null && T.length === 2 &&
     T.every(p => p.action === 'set' && same(p.body.stats.sit, TEAM[p.key]) && p.path === 'team_game_stats?game_id=eq.g-hand&team_idx=eq.' + p.key),
     show(plan.skip || T.map(p => [p.path, p.body.stats.sit])));
  const sets = P.filter(p => p.action === 'set');
  ok('...a patch for each player whose line is missing, with his line (h2 already right: none)',
     sets.map(p => p.key).sort().join() === 'a1,a2,a3,a4,a5,h1,h3,h4,h5,h6' &&
     sets.every(p => same(p.body.stats.sit, PLAYERS[p.key]) && p.path === 'player_game_stats?game_id=eq.g-hand&player_id=eq.' + p.key),
     show(sets.map(p => p.key)));
  const rm = P.filter(p => p.action === 'remove');
  ok('...and the stale line taken off the player who did nothing', rm.length === 1 && rm[0].key === 'a6' && !('sit' in rm[0].body.stats), show(rm));
  const rowOf = p => (p.kind === 'team' ? R.teamRows.find(r => r.team_idx === p.key) : R.playerRows.find(r => r.player_id === p.key));
  ok('every body sends back every other key of the row exactly as it was',
     plan.patches.every(p => {
       const cur = rowOf(p).stats, body = p.body.stats;
       const others = o => Object.keys(o).filter(k => k !== 'sit').reduce((m, k) => (m[k] = o[k], m), {});
       return same(others(cur), others(body)) && Object.keys(cur).filter(k => k !== 'sit').every(k => k in body);
     }));
  /* write them as the database would, keys in its own order, and ask again */
  plan.patches.forEach(p => { rowOf(p).stats = reorder(p.body.stats); });
  const again = B.planGame({ game, events, playerRows: R.playerRows, teamRows: R.teamRows });
  ok('once written, a second run plans nothing (lines compared as values, not text)', again.skip === null && again.patches.length === 0, show(again.patches.map(p => p.key)));
  const forced = B.planGame({ game, events, playerRows: R.playerRows, teamRows: R.teamRows, force: true });
  ok('--force rewrites every line, and still leaves the row with nothing to carry alone',
     forced.patches.filter(p => p.kind === 'team').length === 2 &&
     forced.patches.filter(p => p.kind === 'player').map(p => p.key).sort().join() === 'a1,a2,a3,a4,a5,h1,h2,h3,h4,h5,h6',
     show(forced.patches.map(p => p.key)));

  const M = fresh(); M.teamRows[0].stats.score = 10;
  const mis = B.planGame({ game, events, playerRows: M.playerRows, teamRows: M.teamRows });
  ok('a log that no longer adds up to the stored score is skipped and named, nothing planned',
     mis.skip === 'log and box score disagree' && mis.patches.length === 0 && /11 points.*10/.test(mis.detail), show(mis));
  ok('a game with no stats rows is skipped', B.planGame({ game, events, playerRows: [], teamRows: [] }).skip === 'no stats rows');
  ok('a game with no roster snapshot is skipped', B.planGame({ game: { id: 'x', roster_snapshot: null }, events, ...fresh() }).skip === 'no roster snapshot');
  ok('a game with rows but no events is skipped rather than given zero lines', B.planGame({ game, events: [], ...fresh() }).skip === 'no events');
  const enc = B.planGame({ game: { id: 'g 1', roster_snapshot: { teams: S.teams } }, events, teamRows: [], playerRows: [{ player_id: 'h1', team_idx: 0, stats: {} }] });
  ok('filter values are URL-encoded', enc.patches[0] && enc.patches[0].path === 'player_game_stats?game_id=eq.g%201&player_id=eq.h1', enc.patches[0] && enc.patches[0].path);
}

/* ---- real games, through the ingest's own translator ----------------------- */
console.log('\nreal LiveStats games: players add up to their side, and each line is the box score');
{
  const script = [
    'import sys, json, io',
    'sys.path.insert(0, sys.argv[1])',
    'from translate.fiba_events import translate',
    'raw = json.load(io.open(sys.argv[2], encoding="utf-8"))',
    'T = translate(raw, lambda team, pno: "%s:%s" % (team, pno))',
    'sys.stdout.write(json.dumps(T))',
  ].join('\n');
  const feeds = [
    path.join(ROOT, 'supabase', 'tests', 'fixtures', 'feedtiming', 'feed.json'),
    path.join(ROOT, 'data', 'data_2026-05-09T15-59_SLB', 'game_data', '2702542.json'),
    path.join(ROOT, 'data', 'data_2026-05-09T15-59_SLB', 'game_data', '2702545.json')
  ];
  const SUMMED = ['pts', 'fgm', 'fga', 'p3m', 'p3a', 'rimM', 'rimA', 'midM', 'midA', 'ftm', 'fta', 'tov'];
  const FG = { p2_made: 2, p3_made: 3, p2_miss: 0, p3_miss: 0 }, FT = { ft_made: 1, ft_miss: 0 };
  const DESCRIPTOR = { loc: 1, tag: 1, stype: 1 };
  const ix = f => Sit.FIELDS.indexOf(f);
  for (const f of feeds) {
    let T = null;
    for (const exe of ['python3', 'python']) {
      const r = spawnSync(exe, ['-c', script, path.join(ROOT, 'scripts', 'ingest'), f], { encoding: 'utf8', maxBuffer: 64 << 20 });
      if (r.status === 0 && r.stdout) { T = JSON.parse(r.stdout); break; }
    }
    const name = path.basename(f);
    ok(name + ' translates', !!T);
    if (!T) continue;
    /* the rows as game_events holds them, read the way finalise-game and the backfill read them */
    const events = B ? B.mapEvents(T.events) : T.events.map(e => Object.assign({ id: e.seq }, e, e.payload || {}));
    const G = { teams: T.roster_snapshot.teams, starters: T.starters, tipWinner: T.tip_winner, arrowInit: T.arrow_init,
                period: T.period, clockMs: 0, events };
    const d = E.deriveGame(G);
    const RC = Sit.compute(G);
    const RS = Sit.toStored(RC);
    ok(name + ': possessions found', RC.possessions === true);

    [0, 1].forEach(t => {
      const TL = RS.teams[t];
      /* what has no player to go to: counted straight off the log, zones off the side's own shot list */
      const none = { pts: 0, fgm: 0, fga: 0, p3m: 0, p3a: 0, rimM: 0, rimA: 0, midM: 0, midA: 0, ftm: 0, fta: 0, tov: 0 };
      let pidless = 0;
      events.forEach(e => {
        if (!e || DESCRIPTOR[e.t] || e.team !== t || e.pid) return;
        if (e.t in FG) { pidless++; none.fga++; if (e.t[1] === '3') none.p3a++; if (FG[e.t]) { none.fgm++; none.pts += FG[e.t]; if (e.t[1] === '3') none.p3m++; } }
        else if (e.t in FT) { pidless++; none.fta++; if (FT[e.t]) { none.ftm++; none.pts++; } }
        else if (e.t === 'to') { pidless++; none.tov++; }
      });
      RC.side[t].sits.all.shots.filter(s => !s.pid && s.zone !== 'three').forEach(s => {
        const z = s.zone === 'rim' ? 'rim' : 'mid';
        none[z + 'A']++; if (s.made) none[z + 'M']++;
      });
      const pids = Object.keys(RC.side[t].players);
      const sum = SUMMED.map((k, i) => pids.reduce((n, pid) => n + ((RS.players[pid] && RS.players[pid].all) || Z12)[i], 0));
      const off = SUMMED.filter((k, i) => TL.all[ix(k)] !== sum[i] + none[k]);
      ok(name + ' team ' + t + ': player lines sum to the side\'s "all" (pts fg 3pt rim mid ft tov), plus the ' + pidless + ' actions with no player',
         off.length === 0, off.map(k => k + ': side ' + TL.all[ix(k)] + ' players ' + sum[SUMMED.indexOf(k)] + ' no-player ' + none[k]).join('; '));
      const madePidless = RC.side[t].sits.all.shots.filter(s => !s.pid && s.made);
      const aSum = Sit.AFIELDS.map((k, i) => pids.reduce((n, pid) => n + ((RS.players[pid] && RS.players[pid].ast) || [0, 0, 0, 0, 0])[i], 0));
      const uSum = Sit.AFIELDS.map((k, i) => pids.reduce((n, pid) => n + ((RS.players[pid] && RS.players[pid].unast) || [0, 0, 0, 0, 0])[i], 0));
      ok(name + ' team ' + t + ': assisted baskets sum exactly, unassisted plus the baskets with no player',
         same(TL.ast, aSum) && TL.unast[0] === uSum[0] + madePidless.length &&
         TL.unast[1] === uSum[1] + madePidless.reduce((n, s) => n + (s.three ? 3 : 2), 0),
         show({ side: [TL.ast, TL.unast], players: [aSum, uSum], pidless: madePidless.length }));

      const bad = [];
      G.teams[t].players.forEach(p => {
        const s = d.stats[p.id];
        if (!s) return;
        const L = RS.players[p.id] || {};
        const get = k => L[k] || Z12;
        const A = get('all');
        const want = [
          ['all.pts', A[ix('pts')], s.pts], ['all.fgm', A[ix('fgm')], s.p2m + s.p3m], ['all.fga', A[ix('fga')], s.p2a + s.p3a],
          ['all.p3m', A[ix('p3m')], s.p3m], ['all.p3a', A[ix('p3a')], s.p3a],
          ['all.rimM', A[ix('rimM')], s.rimM], ['all.rimA', A[ix('rimA')], s.rimA],
          ['all.midM', A[ix('midM')], s.midM], ['all.midA', A[ix('midA')], s.midA],
          ['all.ftm', A[ix('ftm')], s.ftm], ['all.fta', A[ix('fta')], s.fta], ['all.tov', A[ix('tov')], s.to],
          ['second.pts', get('second')[0], s.sc], ['offTo.pts', get('offTo')[0], s.pot], ['transition.pts', get('transition')[0], s.fast],
          ['ast+unast fgm', (L.ast || [0])[0] + (L.unast || [0])[0], s.p2m + s.p3m]
        ];
        want.forEach(([k, have, eng]) => { if (have !== eng) bad.push(p.id + ' ' + k + ' ' + have + '/' + eng); });
        if (!(p.id in RS.players) && (s.pts || s.p2a || s.p3a || s.fta || s.to)) bad.push(p.id + ' has a box score but no line');
      });
      ok(name + ' team ' + t + ': every stored player line is the engine\'s box score (pts fg 3pt rim mid ft tov, sc pot fast, made = ast+unast)',
         bad.length === 0, bad.slice(0, 8).join(', '));
    });

    if (B) {
      const playerRows = G.teams.flatMap((tm, t) => tm.players.map(p => ({ player_id: p.id, team_idx: t, stats: Object.assign({}, d.stats[p.id]) })));
      const teamRows = [0, 1].map(t => ({ team_idx: t, stats: Object.assign({}, d.team[t], { score: d.score[t] }) }));
      const plan = B.planGame({ game: { id: 'g', roster_snapshot: T.roster_snapshot }, events: B.mapEvents(T.events), playerRows, teamRows });
      const withLine = playerRows.filter(r => r.player_id in RS.players).length;
      ok(name + ': the backfill plans this game (its score check agrees) -- 2 sides, ' + withLine + ' players',
         plan.skip === null && plan.patches.filter(p => p.kind === 'team').length === 2 &&
         plan.patches.filter(p => p.kind === 'player').length === withLine &&
         plan.patches.every(p => same(p.body.stats.sit, p.kind === 'team' ? RS.teams[p.key] : RS.players[p.key])),
         show(plan.skip ? plan : plan.patches.length));
    }
  }
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
