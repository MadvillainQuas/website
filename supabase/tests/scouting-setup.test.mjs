/* ============================================================================
   SET UP YOUR SCOUT — epinoia/scouting/setup.js, and the restricted read in global.js.

   What goes wrong quietly here:
   - the address does not come back as it went out, so a shared set-up opens on another one;
   - an older link (?lg=<league>, ?g=women) lands on an empty set-up instead of what it showed;
   - a range filter drops everyone whose height nobody recorded, or keeps them when told not to;
   - a position spelled POINT_GUARD, GF or C/F is read as no position;
   - the gender filter files a league that has not said under men's;
   - the size estimate calls a dozen leagues light;
   - LOAD reads leagues nobody chose, or seasons nobody asked for.

     node supabase/tests/scouting-setup.test.mjs
   ============================================================================ */
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const SU = require(path.join(ROOT, 'epinoia', 'scouting', 'setup.js'));
const G = require(path.join(ROOT, 'epinoia', 'global.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, 'got  ' + g + '\n          want ' + w);
};

console.log('\nthe address');
{
  eq('an empty address is the blank set-up, not loading', SU.readSetup(''), { setup: SU.cleanSetup({}), go: false, has: false, legacy: false });
  eq('the blank set-up writes nothing', SU.writeSetup(SU.DEFAULT_SETUP, ''), '');
  const s = { leagues: ['bcb', 'slb-women'], seasons: ['2025-26', 'current'], g: 'women', gu: true, age: [18, 23], ht: [190, null],
    wt: [null, 110], pos: ['G', 'F'], gp: 5, mpg: 10, unk: true };
  const q = SU.writeSetup(s, '?source=pwa&s=bpm&f=ts:ge:pct:80');
  ok('it reads as a person would write it', /leagues=bcb,slb-women/.test(q) && /age=18-23/.test(q) && /ht=190-(&|$)/.test(q) && /wt=-110/.test(q) && /pos=G,F/.test(q), q);
  const back = SU.readSetup(q);
  eq('a full set-up round trips through the address', back.setup, SU.cleanSetup(s));
  ok('...without go, it does not load', back.go === false && back.has === true);
  const p = new URLSearchParams(q);
  ok('the table\'s own parameters and the rest stay', p.get('s') === 'bpm' && p.get('f') === 'ts:ge:pct:80' && p.get('source') === 'pwa');
  ok('go=1 is written when asked, and read back', SU.readSetup(SU.writeSetup(s, '', { go: true })).go === true);
  ok('go=1 with no leagues does not load (there is nothing to load)', SU.readSetup('?go=1').go === false);
  eq('writing again replaces, never doubles', SU.writeSetup({ leagues: ['nbl'] }, q).match(/leagues=/g).length, 1);
  eq('a stray league name is refused', SU.readSetup('?leagues=bcb,<script>,a%20b').setup.leagues, ['bcb']);
  eq('current alone is the default (no seasons)', SU.readSetup('?leagues=bcb&season=current').setup.seasons, []);
  eq('every position is no position filter', SU.readSetup('?pos=G,F,C').setup.pos, []);
  eq('gu without a gender means nothing', SU.readSetup('?gu=1').setup.gu, false);
}

console.log('\nolder links');
{
  const r = SU.readSetup('?lg=3d9ab0f1-83bb-4f11-9e7c-f310968e7f37&s=bpm');
  eq('?lg= (the table\'s league filter) loads that league at once', [r.setup.leagues, r.go, r.legacy], [['3d9ab0f1-83bb-4f11-9e7c-f310968e7f37'], true, true]);
  eq('?g=women is the gender, as it always was', SU.readSetup('?g=women').setup.g, 'women');
  ok('...and does not load by itself', SU.readSetup('?g=women').go === false);
  eq('an old table-only link (?s=bpm) is not a set-up: the reader\'s own is kept', SU.readSetup('?s=bpm&f=ts:ge:pct:80').has, false);
  eq('?leagues= beside ?lg= wins (the new link says it all)', SU.readSetup('?leagues=bcb&lg=L9').setup.leagues, ['bcb']);
}

console.log('\nranges');
{
  eq('18-23', SU.parseRange('18-23', 'age'), [18, 23]);
  eq('18- (and over)', SU.parseRange('18-', 'age'), [18, null]);
  eq('-23 (and under)', SU.parseRange('-23', 'age'), [null, 23]);
  eq('the wrong way round is turned round', SU.parseRange('23-18', 'age'), [18, 23]);
  eq('held to the bounds', SU.parseRange('100-200', 'ht'), [150, 200]);
  eq('the whole range is no range', SU.parseRange('150-235', 'ht'), null);
  eq('nonsense is no range', [SU.parseRange('tall', 'ht'), SU.parseRange('', 'ht'), SU.parseRange(null, 'ht')], [null, null, null]);
  eq('from two boxes, blanks allowed', SU.cleanRange(['', '110'], 'wt'), [null, 110]);
}

console.log('\na player');
{
  const Y = 2026;
  const set = o => SU.cleanSetup(o);
  eq('age: the exact age first, then from the year', [SU.ageOf({ a: 21, y: 2000 }, Y), SU.ageOf({ y: 2004 }, Y), SU.ageOf({}, Y), SU.ageOf(null, Y)], [21, 22, null, null]);
  const tall = set({ ht: [190, 210] });
  ok('height in range passes', SU.rowPasses({ gp: 3 }, { h: 200 }, tall, Y));
  ok('height out of range fails', !SU.rowPasses({ gp: 3 }, { h: 185 }, tall, Y) && !SU.rowPasses({ gp: 3 }, { h: 211 }, tall, Y));
  ok('an unknown height fails a height range...', !SU.rowPasses({ gp: 3 }, { w: 90 }, tall, Y) && !SU.rowPasses({ gp: 3 }, null, tall, Y));
  ok('...unless unknowns are kept', SU.rowPasses({ gp: 3 }, null, set({ ht: [190, 210], unk: true }), Y));
  ok('a zero height is unknown, not short', !SU.rowPasses({ gp: 3 }, { h: 0 }, tall, Y) && SU.rowPasses({ gp: 3 }, { h: 0 }, set({ ht: [190, null], unk: true }), Y));
  ok('no ranges: everyone, bio or not', SU.rowPasses({}, null, set({}), Y));
  const young = set({ age: [18, 23] });
  ok('age from a birth year is used', SU.rowPasses({}, { y: 2005 }, young, Y) && !SU.rowPasses({}, { y: 1995 }, young, Y));
  ok('weight: and under', SU.rowPasses({}, { w: 100 }, set({ wt: [null, 110] }), Y) && !SU.rowPasses({}, { w: 120 }, set({ wt: [null, 110] }), Y));
  ok('games floor', SU.rowPasses({ gp: 5, min: 50 }, null, set({ gp: 5 }), Y) && !SU.rowPasses({ gp: 4, min: 200 }, null, set({ gp: 5 }), Y));
  ok('minutes a game floor', SU.rowPasses({ gp: 4, min: 80 }, null, set({ mpg: 20 }), Y) && !SU.rowPasses({ gp: 4, min: 79 }, null, set({ mpg: 20 }), Y) &&
     !SU.rowPasses({ gp: 0, min: 0 }, null, set({ mpg: 1 }), Y));
  eq('positions as the rosters spell them', ['PG', 'SHOOTING_GUARD', 'GF', 'C/F', 'F-C', 'Power Forward', 'CENTER', 'center', '', null, 'X'].map(SU.posBuckets),
     [['G'], ['G'], ['G', 'F'], ['F', 'C'], ['F', 'C'], ['F'], ['C'], ['C'], [], [], []]);
  const bigs = set({ pos: ['C'] });
  ok('a position filter: a C/F is a centre, a guard is not', SU.rowPasses({ position: 'C/F' }, null, bigs, Y) && !SU.rowPasses({ position: 'PG' }, null, bigs, Y));
  ok('...no position on record fails, or passes when unknowns are kept', !SU.rowPasses({ position: '' }, null, bigs, Y) &&
     SU.rowPasses({ position: '' }, null, set({ pos: ['C'], unk: true }), Y));
  ok('bio is needed only for age, height or weight', !SU.needsBio(set({ pos: ['G'], gp: 3 })) && SU.needsBio(set({ wt: [80, null] })));
  eq('coverage over the players read', SU.coverage([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], r => ({ 1: { h: 200, a: 20 }, 2: { h: 190, y: 2000 }, 3: { w: 90 } })[r.id]),
     { players: 4, age: 50, ht: 50, wt: 25 });
}

console.log('\nthe leagues');
{
  const L = [
    { id: 'a', slug: 'bcb', name: 'BCB', gender: 'men', seasons: [{ id: 's1', name: '2026-27' }, { id: 's0', name: '2025-26' }] },
    { id: 'b', slug: 'slb-women', name: 'SLB W', gender: 'women', seasons: [{ id: 's2', name: '2026-27' }] },
    { id: 'c', slug: 'euroleague', name: 'EuroLeague', gender: '', seasons: [{ id: 's3', name: '2026-27' }] }
  ];
  eq('all: every league', SU.leaguesFor(L, '', false).map(x => x.id), ['a', 'b', 'c']);
  eq('men\'s: only a league that says so', SU.leaguesFor(L, 'men', false).map(x => x.id), ['a']);
  eq('women\'s likewise', SU.leaguesFor(L, 'women', false).map(x => x.id), ['b']);
  eq('...and the leagues that have not said, when asked', SU.leaguesFor(L, 'men', true).map(x => x.id), ['a', 'c']);
  eq('ids or slugs resolve, in the catalogue\'s order', SU.resolve(['euroleague', 'a', 'zzz'], L).map(x => x.id), ['a', 'c']);
  eq('the seasons these leagues have, newest first, with how many have each', SU.seasonChoices(L).map(s => [s.name, s.n, s.current]),
     [['2026-27', 3, 3], ['2025-26', 1, 0]]);
  eq('reads: the current season is one per league', SU.unitsOf(L, []), 3);
  eq('reads: current and 2025-26 is one more, where a league has it', SU.unitsOf(L, ['current', '2025-26']), 4);
  eq('reads: 2025-26 alone', SU.unitsOf(L, ['2025-26']), 1);

  const one = SU.estimate([L[0]], [], { a: 10 });
  eq('one league of ten clubs: ~120 players, light', [one.players, one.weight, one.huge], [100, 'light', false]);
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 'x' + i, seasons: [{ name: '2026-27' }] }));
  eq('twelve leagues: medium', SU.estimate(many, [], {}).weight, 'medium');
  const lots = Array.from({ length: 30 }, (_, i) => ({ id: 'y' + i, seasons: [{ name: '2026-27' }] }));
  const big = SU.estimate(lots, [], {});
  ok('thirty leagues: heavy, and asked about first', big.weight === 'heavy' && big.huge === true && big.players > 3000);
  ok('a league with no count is taken at ten clubs', SU.estimate([{ id: 'q', seasons: [{ name: 'x' }] }], [], {}).players === SU.estimate([{ id: 'q', seasons: [{ name: 'x' }] }], [], { q: 10 }).players);
}

console.log('\nthe summary');
{
  eq('the line over the table', SU.summaryParts({ leagues: ['a', 'b'], g: 'men', age: [18, 23], ht: [190, 210], pos: ['G'], gp: 5 }, { leagues: 12 }),
     ['12 leagues', 'current season', 'men’s', 'age 18–23', '190–210 cm', 'G', '5+ games']);
  eq('one league, named seasons, both genders, one-ended ranges', SU.summaryParts({ leagues: ['a'], seasons: ['2025-26'], wt: [null, 100], age: [21, null] }),
     ['1 league', '2025-26', 'men’s and women’s', 'age 21+', 'up to 100 kg']);
  eq('in the reader\'s units when given', SU.summaryParts({ leagues: ['a'], ht: [190, 210] }, { height: v => v + 'x' })[3], '190x–210x');
}

console.log('\nthis browser');
{
  const mem = {}; const store = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const k = SU.storeKey('user-1');
  ok('kept per account', k !== SU.storeKey('user-2') && k !== SU.storeKey('') && /anon$/.test(SU.storeKey('')));
  const s = SU.cleanSetup({ leagues: ['bcb'], age: [18, 23] });
  ok('saved and read back', SU.saveStored(store, k, s) && JSON.stringify(SU.loadStored(store, k)) === JSON.stringify(s));
  ok('a broken copy is no copy', (mem.bad = '{nope', SU.loadStored(store, 'bad') === null));
  const thrower = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  ok('blocked storage never throws', SU.loadStored(thrower, k) === null && SU.saveStored(thrower, k, s) === false);
  mem['sb-abc-auth-token'] = JSON.stringify({ access_token: 't', user: { id: 'u-9' } });
  eq('the account from the session this browser keeps', SU.userId(store, 'https://abc.supabase.co'), 'u-9');
  eq('...none when signed out', SU.userId({ getItem: () => null }, 'https://abc.supabase.co'), '');
}

console.log('\nglobal.js: the seasons LOAD reads');
{
  const L = { id: 'L1', slug: 'bcb', name: 'British Championship Basketball', short: 'BCB', seasonId: 's1', seasonName: '2026-27', competitionIds: ['c1'],
    seasons: [{ id: 's1', name: '2026-27', competitionIds: ['c1'] }, { id: 's0', name: '2025-26', competitionIds: ['c0'] }] };
  const M = { id: 'L2', slug: 'nbl', name: 'NBL', short: 'NBL', seasonId: 't1', seasonName: '2026', competitionIds: ['d1'], seasons: [{ id: 't1', name: '2026', competitionIds: ['d1'] }] };
  ok('no seasons: each league as it is (its newest)', G.seasonUnits([L, M], []).every((u, i) => u === [L, M][i]));
  const u = G.seasonUnits([L, M], ['current', '2025-26']);
  eq('current and an earlier season: the newest as the league, the earlier as its own unit',
     u.map(x => [x.id, x.short, x.competitionIds.join(), x.accessId || '']), [['L1', 'BCB', 'c1', ''], ['L1~s0', 'BCB 25-26', 'c0', 'L1'], ['L2', 'NBL', 'd1', '']]);
  eq('an earlier season alone: only the leagues that have it', G.seasonUnits([L, M], ['2025-26']).map(x => x.id), ['L1~s0']);
  eq('season names are matched loosely (2025/26)', G.seasonUnits([L], ['2025/26']).map(x => x.id), ['L1~s0']);
  eq('short season names', [G.shortSeason('2025-26'), G.shortSeason('2025/2026'), G.shortSeason('2026')], ['25-26', '25-26', '2026']);
  ok('the earlier season names its league and its season', u[1].name === 'British Championship Basketball 2025-26' && u[1].seasonName === '2025-26');
}

console.log('\nglobal.js players(): only what was chosen, a few at a time');
{
  const cat = {
    leagues: ['A', 'B', 'C', 'D', 'E', 'F'].map((x, i) => ({ id: 'L' + x, slug: x.toLowerCase(), name: x, short: x, seasonId: 's' + x, seasonName: '2026-27',
      competitionIds: ['c' + x], seasons: [{ id: 's' + x, name: '2026-27', competitionIds: ['c' + x] }], gender: i % 2 ? 'women' : 'men' })),
    excluded: [{ id: 'LZ', name: 'Z', reason: 'members' }], access: new Map(),
    all: [{ id: 'LZ', slug: 'z', locked: true }]
  };
  let live = 0, peak = 0;
  const asked = [];
  globalThis.EpinoiaData = {
    get: async () => { throw new Error('the catalogue was handed over: nothing to ask'); },
    all: async () => { throw new Error('the catalogue was handed over: nothing to ask'); },
    season: async ids => { asked.push(ids.join()); live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 5)); live--;
      return { players: [], teams: [], teamOfPlayer: new Map() }; },
    teamMeta: async () => ({}), playerMeta: async () => ({})
  };
  const got = [];
  const res = await G.players({ catalogue: cat, leagueIds: ['a', 'LC', 'e', 'z'], concurrency: 2, onLeague: (rows, L) => got.push(L.id) });
  eq('only the chosen leagues are read (by slug or id)', asked.sort(), ['cA', 'cC', 'cE']);
  ok('never more than the cap at once', peak <= 2 && peak >= 1, 'peak ' + peak);
  eq('each is announced', got.sort(), ['LA', 'LC', 'LE']);
  eq('a chosen members-only league is said to be left out', res.excluded.map(x => x.id), ['LZ']);
  asked.length = 0;
  await G.players({ catalogue: cat, leagueIds: ['a'], seasons: ['2025-26'] });
  eq('a season a league does not have is not read', asked, []);
  const ac = new AbortController();
  asked.length = 0;
  const p = G.players({ catalogue: cat, leagueIds: ['a', 'b', 'c', 'd'], concurrency: 1, signal: ac.signal, onLeague: () => ac.abort() });
  let err = null; try { await p; } catch (e) { err = e; }
  ok('cancelled after the first league: the rest are never read', err && err.name === 'AbortError' && asked.length === 1, asked.join());
  delete globalThis.EpinoiaData;
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
