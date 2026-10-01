/* ============================================================================
   BIG COMPETITIONS (NCAA, Tercera FEB): summed a batch of games at a time, built
   off the snapshots function, and never read whole in a browser.

     node supabase/tests/big-seasons.test.mjs

   What is held here:
     * season.js: players() and teams() are addPlayers/addTeams then finish. A season
       added up batch by batch is the season read whole, bit for bit, when the batches
       are the rows in the same order;
     * data.js season(): a batch at a time, with any read-ahead (`window`), gives the
       same season as every batch at once, and keeps the rows for a caller that asks;
     * past BIG_GAMES finished games, known from the token's count: a page gets the
       latest file built for the competition (saying when it was built), or an empty
       season marked `building` when there is none, and never the rows. A caller that
       keeps the rows is refused, and so is a builder that is not allowed big ones;
     * seasonUnits: the files there are, the same list for the function and the builder;
     * tools/build-seasons.mjs: builds only the big ones, reading as a signed-out
       visitor and writing with the service key, the file the function would have
       written (packed, named by its token), the index row, and the versions before it
       removed; a current one is left alone, and a dry run writes nothing;
     * the snapshots function leaves big ones to it, and the workflow runs it hourly.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => {
  if (cond) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

globalThis.window = globalThis;
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://abcref.supabase.co', supabaseAnonKey: 'sb_publishable_test' };
globalThis.EpinoiaBPM = require(path.join(ROOT, 'epinoia', 'bpm.js'));
const S = require(path.join(ROOT, 'epinoia', 'season.js'));
globalThis.EpinoiaSeason = S;
const D = require(path.join(ROOT, 'epinoia', 'data.js'));
globalThis.EpinoiaData = D;

/* ---- a season: six clubs, 30 games, the splits in some, on-court blocks, a DNP on every sheet ---- */
let seed = 5;
const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return Math.floor(seed / 2147483648 * n); };
const clubs = ['ca', 'cb', 'cc', 'cd', 'ce', 'cf'];
const games = [], pgs = [], tgs = [];
for (let gi = 0; gi < 30; gi++) {
  const h = clubs[gi % 6], a = clubs[(gi + 1 + (gi >> 3)) % 6] === h ? clubs[(gi + 2) % 6] : clubs[(gi + 1 + (gi >> 3)) % 6];
  const id = 'g' + String(gi).padStart(2, '0');
  games.push({ id, home_team_id: h, away_team_id: a, home_score: 60 + rnd(40), away_score: 60 + rnd(40), tipoff_at: '2026-10-' + String(1 + (gi % 28)).padStart(2, '0') + 'T18:00:00Z' });
  [h, a].forEach((club, side) => {
    const adv = { pts: 70 + rnd(30), fgm: 25 + rnd(10), fga: 60 + rnd(15), fg3m: 7 + rnd(6), fg3a: 20 + rnd(10), ftm: 10 + rnd(8), fta: 15 + rnd(8),
                  oreb: 8 + rnd(6), dreb: 22 + rnd(8), ast: 12 + rnd(10), stl: 5 + rnd(5), blk: 2 + rnd(4), tov: 10 + rnd(8), minutes: 200,
                  possessions: 70 + rnd(8) + 0.44 * rnd(9), rimA: 20 + rnd(8), rimM: 12 + rnd(5), midA: 10 + rnd(6), midM: 4 + rnd(4) };
    const sit = gi % 3 === 0 ? { v: 1, all: Array.from({ length: 13 }, () => rnd(9)), second: [rnd(5), rnd(3), rnd(4)], ast: [rnd(4), rnd(8)], ftAst: rnd(2) } : undefined;
    tgs.push({ game_id: id, team_idx: side, stats: Object.assign({ adv, paint: 30 + rnd(10), fast: rnd(15), sc: rnd(12), pot: rnd(15), bench: rnd(30), foulTot: 15 + rnd(8) }, sit ? { sit } : {}) });
    for (let k = 0; k < 9; k++) {
      pgs.push({ game_id: id, player_uuid: club + '-p' + k, player_id: null, team_idx: side, stats: {
        min: k === 8 ? 0 : 60000 * (6 + rnd(30)) + 1000 * rnd(60), pts: rnd(25), p2m: rnd(6), p2a: 6 + rnd(6), p3m: rnd(4), p3a: 3 + rnd(5),
        ftm: rnd(5), fta: 5 + rnd(3), or: rnd(4), dr: rnd(8), ast: rnd(8), stl: rnd(3), blk: rnd(3), to: rnd(4), pf: rnd(5), fd: rnd(5), pm: rnd(20) - 10,
        rimA: rnd(5), rimM: rnd(3), midA: rnd(4), midM: rnd(2),
        oc: { tFGA: 40 + rnd(10), tFGM: 18 + rnd(6), t3M: 4 + rnd(4), tFTA: 8 + rnd(6), tTOV: 6 + rnd(4), tOR: 4 + rnd(4), tDR: 14 + rnd(6), tPTS: 50 + rnd(20),
              oFGA: 40 + rnd(10), oFGM: 17 + rnd(6), o3M: 4 + rnd(4), oFTA: 8 + rnd(6), oTOV: 6 + rnd(4), oOR: 4 + rnd(4), oDR: 14 + rnd(6), oPTS: 48 + rnd(20) },
        sit: sit && k < 6 ? { v: 1, all: Array.from({ length: 13 }, () => rnd(4)), unast: [rnd(3), rnd(5)] } : undefined } });
    }
  });
}
const byId = {}; games.forEach(g => { byId[g.id] = g; });

console.log('\nseason.js: a season a batch at a time');
{
  const P = S.players(pgs, tgs), T = S.teams(tgs, byId);
  const accP = new Map(), accT = new Map();
  for (let i = 0; i < games.length; i += 7) {
    const ids = new Set(games.slice(i, i + 7).map(g => g.id));
    const bp = pgs.filter(r => ids.has(r.game_id)), bt = tgs.filter(r => ids.has(r.game_id));
    S.addPlayers(accP, bp, bt);
    S.addTeams(accT, bt, byId);
  }
  const P2 = S.finishPlayers(accP), T2 = S.finishTeams(accT);
  ok('players, added up seven games at a time: every line the same as over the whole season, to the last bit (' + P.length + ' players, ' +
     Object.keys(P[0]).length + ' numbers each)', same(P2, P), P2.length);
  ok('clubs the same, the opponents\' sums and the defensive splits with them (' + T.length + ' clubs)', same(T2, T) && T.some(t => t.dff_efg != null));
  ok('...the finishing halves are what players() and teams() are', same(S.finishPlayers(S.addPlayers(new Map(), pgs, tgs)), P) &&
     same(S.finishTeams(S.addTeams(new Map(), tgs, byId)), T));
}

/* ---- a fake Supabase: the REST reads a page makes, and the builder's writes ---- */
const calls = [];
let W = null;                                  // the world the fake answers from, set per test
function answer(status, body, headers) {
  return { ok: status >= 200 && status < 300, status,
    headers: { get: h => (headers || {})[String(h).toLowerCase()] || null },
    json: async () => JSON.parse(JSON.stringify(body)), text: async () => (body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body)) };
}
const inList = (q, k) => { const m = new RegExp('(?:^|&)' + k + '=in\\.\\(([^)]*)\\)').exec(q); return m ? m[1].split(',') : null; };
const eqOf = (q, k) => { const m = new RegExp('(?:^|&)' + k + '=eq\\.([^&]*)').exec(q); return m ? decodeURIComponent(m[1]) : null; };
function selectRows(rows, select) {
  const parts = select.split(',');
  if (!parts.some(p => p.includes('->'))) return rows;
  return rows.map(r => {
    const o = {};
    parts.forEach(p => {
      const m = /^(\w+):(\w+)((?:->\w+)+)$/.exec(p);
      if (m) { let v = r[m[2]]; m[3].split('->').filter(Boolean).forEach(k => { v = v == null ? undefined : v[k]; }); o[m[1]] = v === undefined ? null : v; }
      else o[p] = r[p];
    });
    return o;
  });
}
globalThis.fetch = async (url, init = {}) => {
  const u = decodeURIComponent(String(url));
  const h = init.headers || {};
  calls.push({ url: u, method: init.method || 'GET', key: h.apikey, body: init.body });
  const st = u.split('/storage/v1/')[1];
  if (st !== undefined) {
    if (st.startsWith('object/public/snapshots/')) {
      const f = W.files[st.slice('object/public/snapshots/'.length)];
      return f === undefined ? answer(400, { error: 'not found' }) : answer(200, f);
    }
    if (st.startsWith('object/list/snapshots')) {
      const prefix = JSON.parse(init.body).prefix;
      return answer(200, Object.keys(W.files).filter(k => k.startsWith(prefix + '/')).map(k => ({ name: k.slice(prefix.length + 1) })));
    }
    if (init.method === 'DELETE' && st === 'object/snapshots') { JSON.parse(init.body).prefixes.forEach(p => { delete W.files[p]; }); return answer(200, []); }
    if (init.method === 'POST' && st.startsWith('object/snapshots/')) { W.files[st.slice('object/snapshots/'.length)] = JSON.parse(init.body); W.uploads.push({ path: st, headers: h }); return answer(200, { Key: st }); }
    return answer(404, { error: 'no route ' + st });
  }
  const rest = u.split('/rest/v1/')[1] || '';
  const [table, q] = [rest.split('?')[0], rest.split('?')[1] || ''];
  const select = (/(?:^|&)select=([^&]*)/.exec(q) || [])[1] || '';
  if (table === 'snapshots' && init.method === 'POST') { const row = JSON.parse(init.body); W.index.set(row.key, row); return answer(201, null); }
  if (table === 'snapshots') {
    const key = eqOf(q, 'key');
    const rows = [...W.index.values()].filter(r => key ? r.key === key : /^season:/.test(r.key))
      .map(r => ({ key: r.key, token: r.token, built_at: r.built_at, file: r.data && r.data.file }));
    return answer(200, rows);
  }
  if (table === 'seasons') return answer(200, W.seasons);
  if (table === 'games') {
    const ids = inList(q, 'competition_id') || [eqOf(q, 'competition_id')];
    const list = W.games.filter(g => ids.includes(g.competition_id));
    if (/finalised_at/.test(q) && /limit=1/.test(q)) {                // the token
      const total = ids.reduce((n, id) => n + (W.counts[id] != null ? W.counts[id] : W.games.filter(g => g.competition_id === id).length), 0);
      return answer(200, total ? [{ id: 'x', finalised_at: '2026-10-30T00:00:00+00:00' }] : [], { 'content-range': '0-0/' + total });
    }
    return answer(200, list, { 'content-range': '0-' + Math.max(0, list.length - 1) + '/' + list.length });
  }
  if (table === 'player_game_stats') { const ids = inList(q, 'game_id'); return answer(200, selectRows(pgs.filter(r => ids.includes(r.game_id)), select)); }
  if (table === 'team_game_stats') { const ids = inList(q, 'game_id'); return answer(200, selectRows(tgs.filter(r => ids.includes(r.game_id)), select)); }
  if (table === 'players' || table === 'roster_entries') return answer(200, []);
  return answer(404, { message: 'no route ' + table });
};
const world = over => Object.assign({ games: games.map(g => Object.assign({ competition_id: 'comp-a' }, g)), counts: {}, files: {}, index: new Map(),
  uploads: [], seasons: [] }, over || {});
const fresh = () => { calls.length = 0; try { localStorage.clear(); } catch (_) { /* none in node */ } };

console.log('\ndata.js season(): a batch at a time');
{
  W = world(); fresh();
  const all = await D.season('comp-a', { trim: true, rows: false, snapshot: false });
  const one = await D.season('comp-a', { trim: true, rows: false, snapshot: false, batch: 1, window: 1 });
  const ahead = await D.season('comp-a', { trim: true, rows: false, snapshot: false, batch: 3, window: 4 });
  const key = s => JSON.stringify([s.players, s.teams, [...s.teamOfPlayer]]);
  ok('one game a batch, and three a batch four ahead, give the season every batch at once gives', key(one) === key(all) && key(ahead) === key(all) && all.players.length === 54);
  ok('...asked a batch at a time: thirty games are sixty requests one at a time', calls.filter(c => /player_game_stats|team_game_stats/.test(c.url)).length === 2 + 60 + 20, calls.length);
  const kept = await D.season('comp-a', { trim: true, batch: 7 });
  ok('a caller that keeps the rows has every row, in order', kept.pgs.length === pgs.length && kept.tgs.length === tgs.length &&
     same(kept.pgs.map(r => r.game_id + r.player_uuid), pgs.map(r => r.game_id + r.player_uuid)));
}

console.log('\npast BIG_GAMES: never the rows in a browser');
{
  ok('BIG_GAMES is 800 finished games, and a token\'s count is read off its front', D.BIG_GAMES === 800 && D.gamesIn('5812@2026-03-01T00:00:00+00:00') === 5812 && D.gamesIn(null) === 0);
  W = world({ counts: { 'comp-a': 5812 } }); fresh();
  const first = await D.season('comp-a', { trim: true, rows: false });
  ok('a big one with nothing built yet: an empty season marked building, and no box score asked for',
     first.building === true && first.players.length === 0 && !calls.some(c => /player_game_stats|team_game_stats/.test(c.url)), calls.map(c => c.url.slice(0, 80)));
  ok('...nor even its list of games', !calls.some(c => /games\?.*select=id,home_team_id/.test(c.url)));
  /* a file from an earlier token: what the builder last wrote */
  const older = D.packSeason({ games: games.slice(0, 3), players: S.players(pgs.filter(r => r.game_id < 'g03'), tgs), teams: [], teamOfPlayer: new Map([['ca-p0', 'ca']]) });
  W.files['season/comp-a/v3-5790-old.json'] = { token: '5790@earlier', data: older };
  W.index.set('season:comp-a', { key: 'season:comp-a', token: '5790@earlier', built_at: '2026-10-30T11:00:00Z', data: { file: 'season/comp-a/v3-5790-old.json' } });
  fresh();
  const stale = await D.season('comp-a', { trim: true, rows: false });
  ok('once one is built: the latest file, saying which and when, and still no rows', stale.players.length === older.players.v.length &&
     stale.stale && stale.stale.builtAt === '2026-10-30T11:00:00Z' && stale.stale.token === '5790@earlier' && !calls.some(c => /player_game_stats/.test(c.url)));
  ok('...not kept in this browser as the current token\'s season', (() => { try { return !localStorage.getItem('epinoia_season_v2:comp-a'); } catch (_) { return true; } })());
  let err = null;
  try { await D.season('comp-a', { trim: true, rows: false, snapshot: false }); } catch (e) { err = e.message; }
  ok('a builder that is not allowed big ones is refused, not handed the older file to save under the newer token', /too big for this builder/.test(err || ''), err);
  const big = world({ games: Array.from({ length: 801 }, (_, i) => ({ id: 'b' + i, competition_id: 'comp-b', home_team_id: 'ca', away_team_id: 'cb' })) });
  W = big; fresh(); err = null;
  try { await D.season('comp-b', { trim: true }); } catch (e) { err = e.message; }
  ok('a caller that keeps the rows (the injury wire) is refused past it, with the count, before a row is read',
     /too big to read whole in a browser \(801 games\)/.test(err || '') && !calls.some(c => /player_game_stats/.test(c.url)), err);
}

console.log('\nseasonUnits: which seasons have a file');
{
  const units = D.seasonUnits([
    { id: 's2', league_id: 'L1', competitions: [{ id: 'c-play' }, { id: 'c-league' }] },
    { id: 's1', league_id: 'L1', competitions: [{ id: 'c-old1' }, { id: 'c-old2' }] },
    { id: 's3', league_id: 'L2', competitions: [{ id: 'c-one' }] }]);
  ok('each league\'s newest season whole (its ids sorted) first, then every competition on its own',
     same(units, ['c-league,c-play', 'c-league', 'c-play', 'c-old1', 'c-old2', 'c-one']), units);
}

console.log('\ntools/build-seasons.mjs');
{
  const B = await import(pathToFileURL(path.join(ROOT, 'tools', 'build-seasons.mjs')).href);
  const logs = [];
  const seasons = [{ id: 's1', league_id: 'L1', starts_on: '2026-09-01', competitions: [{ id: 'comp-a' }] },
                   { id: 's2', league_id: 'L2', starts_on: '2026-09-01', competitions: [{ id: 'comp-s' }] }];
  const mk = () => world({ seasons, counts: { 'comp-a': 900 }, games: games.map(g => Object.assign({ competition_id: 'comp-a' }, g)).concat([{ id: 'small1', competition_id: 'comp-s' }]) });
  W = mk();
  W.files['season/comp-a/v3-800-before.json'] = { token: '800@before', data: {} };
  fresh();
  const dry = await B.run({ url: 'https://abcref.supabase.co', serviceKey: 'service-secret', dryRun: true, log: m => logs.push(m) });
  ok('a dry run says what it would build and writes nothing', dry.built.length === 1 && dry.built[0].unit === 'comp-a' && !W.uploads.length && !W.index.size && /would build comp-a: 900 games/.test(logs.join('\n')));
  fresh();
  const r = await B.run({ url: 'https://abcref.supabase.co', serviceKey: 'service-secret', log: m => logs.push(m), now: () => Date.parse('2026-10-30T12:00:00Z') });
  const name = D.snapFile('900@2026-10-30T00:00:00+00:00'), file = 'season/comp-a/' + name;
  ok('only the big one is built (the small one is the snapshots function\'s)', r.built.length === 1 && r.built[0].unit === 'comp-a' && r.small === 1, r);
  ok('...the file the function would write: named by its token and layout, packed, and the season exactly',
     !!W.files[file] && W.files[file].token === '900@2026-10-30T00:00:00+00:00' && Array.isArray(W.files[file].data.players.k) &&
     same(D.unpackSeason(W.files[file].data).players, (await (async () => { W.counts = {}; const s = await D.season('comp-a', { trim: true, rows: false, snapshot: false }); W.counts = { 'comp-a': 900 }; return s; })()).players));
  ok('...uploaded with the service key, upserted, kept a year by the CDN', W.uploads.length === 1 && W.uploads[0].headers.apikey === 'service-secret' &&
     W.uploads[0].headers['x-upsert'] === 'true' && /max-age=31536000/.test(W.uploads[0].headers['cache-control']));
  ok('...the index row names it', W.index.get('season:comp-a') && W.index.get('season:comp-a').data.file === file &&
     W.index.get('season:comp-a').competition_id === 'comp-a' && W.index.get('season:comp-a').token === '900@2026-10-30T00:00:00+00:00');
  ok('...and the versions before it are removed', !W.files['season/comp-a/v3-800-before.json'] && Object.keys(W.files).filter(k => k.startsWith('season/comp-a/')).length === 1);
  const reads = calls.filter(c => /player_game_stats|team_game_stats|games\?/.test(c.url));
  ok('every read of the season went out as a signed-out visitor (the publishable key), never with the service key',
     reads.length > 0 && reads.every(c => /^sb_publishable_/.test(c.key || '')), [...new Set(reads.map(c => c.key))]);
  fresh(); W.uploads.length = 0;
  const again = await B.run({ url: 'https://abcref.supabase.co', serviceKey: 'service-secret', log: () => {}, now: () => Date.parse('2026-10-30T13:00:00Z') });
  ok('an hour later with the same token: current, nothing read or written', again.current === 1 && !again.built.length && !W.uploads.length &&
     !calls.some(c => /player_game_stats/.test(c.url)));
  const tomorrow = await B.run({ url: 'https://abcref.supabase.co', serviceKey: 'service-secret', log: () => {}, now: () => Date.parse('2026-10-31T13:00:00Z') });
  ok('...and built again once it is a day old, token or no token (as the function does)', tomorrow.built.length === 1);
  ok('no keys: nothing done, and said so', (await B.run({ url: '', serviceKey: '', log: () => {} })).skipped === 'no keys');
  /* NCAA (docs/ncaa-readiness.md): a floor between two builds, so a season whose token moves every hour is not read whole every hour */
  W.counts = { 'comp-a': 901 }; fresh(); W.uploads.length = 0;
  const floored = await B.run({ url: 'https://abcref.supabase.co', serviceKey: 'service-secret', log: () => {},
                               now: () => Date.parse('2026-10-31T14:00:00Z'), minGapMs: 6 * 3600000 });
  ok('with a six-hour floor, a token that moved an hour after the last build leaves the file standing, nothing read',
     floored.current === 1 && !floored.built.length && !W.uploads.length && !calls.some(c => /player_game_stats/.test(c.url)), floored);
  const later = await B.run({ url: 'https://abcref.supabase.co', serviceKey: 'service-secret', log: () => {},
                             now: () => Date.parse('2026-10-31T20:00:00Z'), minGapMs: 6 * 3600000 });
  ok('...and builds it once the floor has passed', later.built.length === 1);
  W.counts = { 'comp-a': 902 }; fresh();
  const nofloor = await B.run({ url: 'https://abcref.supabase.co', serviceKey: 'service-secret', log: () => {},
                               now: () => Date.parse('2026-10-31T21:00:00Z') });
  ok('without one (the rule as it was) a moved token is built at once', nofloor.built.length === 1);
}

console.log('\nthe snapshots function and the workflow');
{
  const fn = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'snapshots', 'index.ts'), 'utf8');
  ok('the function takes its units from data.js seasonUnits and leaves big ones alone',
     /D\.seasonUnits\(/.test(fn) && /if \(D\.gamesIn\(tok\) > D\.BIG_GAMES\) \{ big\+\+; continue; \}/.test(fn) &&
     fn.indexOf('D.gamesIn(tok) > D.BIG_GAMES') < fn.indexOf('D.season(ids.length'));
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'big-seasons.yml'), 'utf8');
  ok('big-seasons.yml runs the builder hourly and on request, one at a time, with the service key',
     /cron: "\d+ \* \* \* \*"/.test(wf) && /workflow_dispatch/.test(wf) && /node tools\/build-seasons\.mjs/.test(wf) &&
     /concurrency:/.test(wf) && /SUPABASE_SERVICE_KEY: \$\{\{ secrets\.SUPABASE_SERVICE_KEY \}\}/.test(wf));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
