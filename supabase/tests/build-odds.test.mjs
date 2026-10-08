/* ============================================================================
   EPINOIΛ'S MODEL, THE RUN (tools/build-odds.mjs), against a stand-in database:
     * a first run learns every finished game, writes a record pick for each it could judge and a fixture pick for each
       game to come, and keeps its state packed and gzipped;
     * it reads 22 numbers of each feature line, never the line, and the named stats of each player line;
     * a week after it last tuned itself it tunes again: every line read, the settings kept in the state, record picks
       only for the games new since the last run, and not again the next hour;
     * a run with nothing new learns nothing and leaves the state be, but still brings the fixtures' picks up to date;
     * the next run reads only what finished after the watermark;
     * the pick's side is never sent (the table generates it); before migration 0253 it says so and keeps learning.

     node supabase/tests/build-odds.test.mjs
   ============================================================================ */
import zlib from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const B = await import(pathToFileURL(path.join(ROOT, 'tools', 'build-odds.mjs')).href);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

/* the stand-in: four clubs, three rounds played, a round to come */
const DAY = 86400000, NOW = Date.UTC(2026, 9, 8, 12);
const clubs = ['h0', 'h1', 'h2', 'h3'], st = [6, 2, -2, -6];
const games = [], lines = [], fixtures = [];
let k = 0;
for (let r = 0; r < 4; r++) for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
  if (i === j) continue;
  const t = NOW - (40 - k) * DAY / 2, id = 'g' + String(k++).padStart(3, '0'), m = st[i] - st[j] + ((k * 7) % 9) - 4;
  if (r === 3) { fixtures.push({ id, home_team_id: clubs[i], away_team_id: clubs[j], tipoff_at: new Date(NOW + (k - 36) * DAY / 2).toISOString(), venue_id: 'v' + i, competitions: { season_id: 's1', seasons: { league_id: 'L1' } } }); continue; }
  games.push({ id, status: 'final', home_team_id: clubs[i], away_team_id: clubs[j], home_score: 80 + Math.round(m / 2), away_score: 80 - Math.round(m / 2) - (m === 0 ? 1 : 0), tipoff_at: new Date(t).toISOString(), venue_id: 'v' + i });
  [0, 1].forEach(ti => lines.push({ game_id: id, team_idx: ti, league_id: 'L1', season_id: 's1', finalised_at: new Date(t + 3 * 3600000).toISOString(),
    q0: 28 + (ti ? -m : m) / 4, q1: 62, q2: 18, q3: 12, q4: 9, q5: 24, q6: 80 + (ti ? -m : m) / 2, q7: 74, q8: 3 }));
}
const db = { lines: lines.slice(0, 40), state: null, picks: [], urls: [], uploads: 0, picks404: false };
const res = (status, body) => new Response(body == null ? '' : (typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body)), { status });
async function fakeFetch(url, init) {
  const u = new URL(url), p = decodeURIComponent(u.pathname + u.search);
  db.urls.push(p);
  if (u.pathname.startsWith('/storage/v1/object/analytics/')) {
    if ((init && init.method) === 'POST') { db.state = Buffer.from(init.body); db.uploads++; return res(200, '{}'); }
    return db.state ? res(200, new Uint8Array(db.state)) : res(404, 'not found');
  }
  if (p.startsWith('/rest/v1/game_features')) {
    const m = /finalised_at\.gt\."([^"]+)"/.exec(p);
    return res(200, db.lines.filter(r => !m || r.finalised_at > m[1]));
  }
  if (p.startsWith('/rest/v1/games?id=in.')) { const ids = /id=in\.\(([^)]*)\)/.exec(p)[1].split(','); return res(200, games.filter(g => ids.includes(g.id))); }
  if (p.startsWith('/rest/v1/player_game_stats')) return res(200, []);
  /* two of the four arenas placed (Leicester and Bristol), two not */
  if (p.startsWith('/rest/v1/venues?id=in.')) { db.venueReads = (db.venueReads || 0) + 1; return res(200, [{ id: 'v0', lat: 52.63, lng: -1.13 }, { id: 'v1', lat: 51.45, lng: -2.59 }, { id: 'v2', lat: null, lng: null }]); }
  if (p.startsWith('/rest/v1/games?status=eq.scheduled')) return res(200, fixtures);
  if (p.startsWith('/rest/v1/model_picks')) {
    if (db.picks404) return res(404, '{"code":"PGRST205","message":"Could not find the table public.model_picks"}');
    db.picks.push({ prefer: init.headers.Prefer, rows: JSON.parse(init.body) });
    return res(201, '');
  }
  return res(500, 'unexpected ' + p);
}
const api = B.client('https://db.invalid', 'service-key', fakeFetch);
const quiet = () => {};

console.log('a first run');
const r1 = await B.run(api, { now: NOW, days: 30, log: quiet });
ok('every finished game learned (20 of the first 40 lines)', r1.learned === 20, r1);
const recs = db.picks.filter(x => /ignore-duplicates/.test(x.prefer)).flatMap(x => x.rows), fx = db.picks.filter(x => /merge-duplicates/.test(x.prefer)).flatMap(x => x.rows);
ok('a record pick for each it could judge (both clubs three games in)', recs.length === r1.records && recs.length > 0 && recs.length < 20, [recs.length, r1.records]);
ok('a fixture pick for each game to come', fx.length === 12 && fx.every(x => x.kind === 'fixture' && x.p_home > 0 && x.p_home < 1), fx.length);
ok('the pick\'s side is never sent (the table generates it from p_home)', [...recs, ...fx].every(x => !('pick' in x)));
ok('the strongest club at home to the weakest is favoured', (() => { const f = fixtures.find(g => g.home_team_id === 'h0' && g.away_team_id === 'h3'); const row = fx.find(x => x.game_id === f.id); return row && row.p_home > 0.6; })());
ok('the state kept gzipped (1f 8b)', db.uploads === 1 && db.state[0] === 0x1f && db.state[1] === 0x8b);
ok('...and packed: every id once', (() => { const j = JSON.parse(zlib.gunzipSync(db.state)); return j.v === 5 && Array.isArray(j.id) && new Set(j.id).size === j.id.length && j.wm && j.wm.id === 'g' + '019'.padStart(3, '0'); })());
const fq = db.urls.find(u => u.startsWith('/rest/v1/game_features'));
ok('22 numbers of each feature line, never the whole line', /q0:f->\d+/.test(fq) && /q21:f->\d+/.test(fq) && !/q22:/.test(fq) && !/select=[^&]*(^|,)f(,|&)/.test(fq), fq);
const pq = db.urls.find(u => u.startsWith('/rest/v1/player_game_stats'));
ok('the named stats of each player line, never the blob', /min:stats->min/.test(pq) && !/select=[^&]*(^|,)stats(,|&)/.test(pq) && !/player_uuid/.test(pq), pq);

console.log('\nnothing new');
db.picks = []; db.urls = [];
const r2 = await B.run(api, { now: NOW, days: 30, log: quiet });
ok('learns nothing and leaves the state be', r2.learned === 0 && db.uploads === 1, [r2.learned, db.uploads]);
ok('...but brings the fixtures\' picks up to date', db.picks.flatMap(x => x.rows).length === 12);
ok('...and no venue it has met is read again (placed or not)', !db.urls.some(u => u.startsWith('/rest/v1/venues')), db.urls.filter(u => u.startsWith('/rest/v1/venues')));
ok('...reading from the watermark', db.urls.some(u => u.startsWith('/rest/v1/game_features') && /finalised_at\.gt\."/.test(u)));

console.log('\nthe next games');
db.lines = lines.slice(0, 44); db.picks = [];
const r3 = await B.run(api, { now: NOW, days: 30, log: quiet });
ok('only the two finished since are read and learned', r3.learned === 2, r3);
ok('...their record picks written, the state put back', db.picks.filter(x => /ignore-duplicates/.test(x.prefer)).flatMap(x => x.rows).length === 2 && db.uploads === 2);

console.log('\nbefore migration 0253');
db.lines = lines.slice(0, 48); db.picks404 = true;
const r4 = await B.run(api, { now: NOW, days: 30, log: quiet });
ok('it says so, writes no picks, and still learns and keeps its state', r4.learned === 2 && r4.warnings.some(w => /0253/.test(w)) && db.uploads === 3, r4);

console.log('\na plain (not gzipped) state');
db.state = Buffer.from(JSON.stringify({ v: 1, w: [] })); db.picks404 = false;
const r5 = await B.run(api, { now: NOW, days: 30, log: quiet });
ok('read as JSON; of another layout, so the model starts again from every game', r5.learned === 24, r5.learned);

console.log('\na week on: it tunes itself');
{
  const j = JSON.parse(zlib.gunzipSync(db.state));
  j.tunedAt = NOW - 8 * DAY;
  db.state = zlib.gzipSync(JSON.stringify(j));
  db.lines = lines.slice(0, 52); db.picks = []; db.urls = [];
  const up = db.uploads;
  const r6 = await B.run(api, { now: NOW, days: 30, log: quiet, tuneBudgetMs: 20000 });
  const reads = db.urls.filter(u => u.startsWith('/rest/v1/game_features'));
  ok('it reads every line again (no watermark), tunes, and says what it tried', !!r6.tune && r6.tune.tried >= 1 && reads.some(u => !/finalised_at\.gt\./.test(u)), r6.tune);
  ok('...only the two games new since the last run are learned as new and get record picks', r6.learned === 2 &&
     db.picks.filter(x => /ignore-duplicates/.test(x.prefer)).flatMap(x => x.rows).length <= 2, r6.learned);
  const k = JSON.parse(zlib.gunzipSync(db.state));
  ok('...and its settings and the time it tuned are kept in the state', db.uploads === up + 1 && k.tunedAt === NOW && !!k.tuned && typeof k.tuned === 'object', { tunedAt: k.tunedAt, tuned: k.tuned });
  db.urls = [];
  const r7 = await B.run(api, { now: NOW + 3600000, days: 30, log: quiet });
  ok('...the next hour it does not tune again', !r7.tune && db.urls.filter(u => u.startsWith('/rest/v1/game_features')).every(u => /finalised_at\.gt\./.test(u)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
