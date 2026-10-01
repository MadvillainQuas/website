/* ============================================================================
   WHAT WINS 2 — THE analytics-file FUNCTION AND finalise-game's FEATURE LINE (docs/what-wins-model.md §4.1, §10.1, A.2;
   §16 WP1).

   1. handle() from supabase/functions/_shared/analyticsfile.ts, driven with stand-in clients: OPTIONS and 405, 400 for a
      bad body or a non-uuid id, 401 signin / jwt, 403 members / league / scope, 404 none, 429 with Retry-After and the
      X-RateLimit headers, the CALLER's token (and only theirs) used for analytics_check, the subject (user, or a salted
      hash of address, browser and day), createSignedUrl(path, 120), `pending`, Cache-Control: no-store on every answer,
      and logs without a token or a URL.
   2. RECALCULATE (A.2) against a stub honouring EpinoiaWinModel.update(store, delta) -> {store, file(s)}: signed-in only,
      one update for two presses at once, the cap, a refresh already running elsewhere, the ten-minute rule, the per-user
      limit, no model yet; the delta read keyset after the store's watermark, never stats->sit or a whole stats; new files
      uploaded, then the index, then the old objects deleted.
   3. The wiring, read from the files: config.toml's entry; finalise-game's import, its own try/catch outside the inserts'
      Promise.all, FEATURES_OFF, one publishedAt for the game and its rows, and reopen deleting the rows.

     node --experimental-strip-types supabase/tests/ww-function.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const { handle, fileName, tokenAt, jwtSub, REFRESH_CAP } = await import('../functions/_shared/analyticsfile.ts');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d).slice(0, 500))); } };

const L = '0a000000-0000-4000-8000-000000000001', S = '0b000000-0000-4000-8000-000000000002', T = '0c000000-0000-4000-8000-000000000003';
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const JWT = b64u({ alg: 'HS256' }) + '.' + b64u({ sub: 'user-1', role: 'authenticated' }) + '.sig';
const sha256 = async s => createHash('sha256').update(s).digest('hex');

/* ------------------------------------------------- a stand-in supabase-js --- */
function client(handler, calls, who) {
  const from = table => {
    const q = { who, table, op: 'select', filters: [], cols: null, opts: {} };
    const api = {
      select(cols, opts) { q.cols = cols; q.selectOpts = opts || {}; return api; },
      eq(k, v) { q.filters.push(['eq', k, v]); return api; },
      gt(k, v) { q.filters.push(['gt', k, v]); return api; },
      in(k, v) { q.filters.push(['in', k, v]); return api; },
      or(s) { q.filters.push(['or', s]); return api; },
      order(k) { (q.order = q.order || []).push(k); return api; },
      limit(n) { q.limit = n; return api; },
      range(a, b) { q.range = [a, b]; return api; },
      maybeSingle() { q.single = true; return api; },
      upsert(rows, opts) { q.op = 'upsert'; q.rows = rows; q.opts = opts; return api; },
      delete() { q.op = 'delete'; return api; },
      then(res, rej) { calls.push(q); return Promise.resolve().then(() => handler(q)).then(res, rej); }
    };
    return api;
  };
  const rpc = (name, args) => { const q = { who, rpc: name, args }; calls.push(q); return Promise.resolve().then(() => handler(q)); };
  const storage = { from: bucket => ({
    createSignedUrl: (p, ttl) => { const q = { who, storage: 'sign', bucket, path: p, ttl }; calls.push(q); return Promise.resolve(handler(q)); },
    download: p => { const q = { who, storage: 'download', bucket, path: p }; calls.push(q); return Promise.resolve(handler(q)); },
    upload: (p, body, opts) => { const q = { who, storage: 'upload', bucket, path: p, body, opts }; calls.push(q); return Promise.resolve(handler(q)); },
    remove: paths => { const q = { who, storage: 'remove', bucket, paths }; calls.push(q); return Promise.resolve(handler(q)); }
  }) };
  return { from, rpc, storage };
}

/* a scenario: what the database answers. Everything overridable per test. */
function world(o = {}) {
  const calls = [], callers = [], logs = [];
  const st = Object.assign({
    check: 'ok', take: { ok: true, used_hour: 3, limit_hour: 60, used_day: 3, limit_day: 400 },
    rows: [{ path: 'wins/' + L + '/' + S + '/v1-12-2026-09-30T10-00-00Z.json', token: '12@2026-09-30T10:00:00Z', bytes: 41234,
             built_at: '2026-09-30T11:00:00Z', layout: 1, fv: 1, n_games: 12, ci_at: '2026-09-28T03:40:00Z', league_id: L, season_id: S }],
    pending: 3, sign: { data: { signedUrl: 'https://x.supabase.co/storage/v1/object/sign/analytics/wins/secret?token=SIGNED' }, error: null }
  }, o);
  const handler = q => {
    if (q.rpc === 'analytics_check') return typeof st.check === 'function' ? st.check(q) : { data: st.check, error: null };
    if (q.rpc === 'analytics_take') return { data: st.take, error: null };
    if (st.extra) { const r = st.extra(q, st); if (r !== undefined) return r; }
    if (q.storage === 'sign') return st.sign;
    if (q.table === 'analytics_files' && q.op === 'select') return { data: st.rows, error: null };
    if (q.table === 'game_features' && q.selectOpts && q.selectOpts.head) return { data: null, count: st.pending, error: null };
    return { data: null, error: null };
  };
  const deps = {
    callerClient: auth => { callers.push(auth); return client(handler, calls, 'caller:' + (auth || 'anon')); },
    admin: client(handler, calls, 'admin'),
    env: { get: k => ({ ANALYTICS_SALT: 'pepper', ANALYTICS_JOIN_WAIT_MS: '3000' })[k] },
    sha256, log: x => logs.push(x), now: () => Date.parse('2026-10-01T12:00:00Z'),
    sleep: () => Promise.resolve()
  };
  return { deps, calls, callers, logs, st };
}
const post = (body, headers = {}) => new Request('https://fn.test/functions/v1/analytics-file', {
  method: 'POST', headers: Object.assign({ 'content-type': 'application/json', apikey: 'sb_publishable_x' }, headers),
  body: typeof body === 'string' ? body : JSON.stringify(body) });
const json = async r => { try { return await r.clone().json(); } catch (_) { return null; } };

/* ================================================================ 1. handle --- */
console.log('\nmethods and bodies');
{
  const w = world();
  const r = await handle(new Request('https://fn.test/x', { method: 'OPTIONS' }), w.deps);
  ok('OPTIONS answers the CORS preflight, naming apikey and authorization', r.status === 200 &&
     /apikey/.test(r.headers.get('access-control-allow-headers')) && /authorization/.test(r.headers.get('access-control-allow-headers')) &&
     r.headers.get('access-control-allow-methods') === 'POST, OPTIONS');
  const g = await handle(new Request('https://fn.test/x', { method: 'GET' }), w.deps);
  ok('any other method is 405', g.status === 405 && g.headers.get('cache-control') === 'no-store');
  const bad = [
    ['a body over 1 KB', post({ scope: 'wins', pad: 'x'.repeat(1100) })],
    ['not JSON', post('{scope:')],
    ['an array', post([1])],
    ['no scope', post({ league: L })],
    ['a league that is not a uuid', post({ scope: 'wins', league: 'abc' })],
    ['a team that is not a uuid', post({ scope: 'club', league: L, team: "x' or 1=1" })],
    ['refresh that is not a boolean', post({ scope: 'wins', league: L, refresh: 'yes' })]
  ];
  for (const [what, req] of bad) {
    const x = await handle(req, w.deps);
    ok('400 bad_request: ' + what, x.status === 400 && (await json(x)).reason === 'bad_request' && x.headers.get('cache-control') === 'no-store');
  }
  ok('...and none of them reached the database', w.calls.length === 0, w.calls);
}

console.log('\nthe check, with the caller\'s token');
{
  const w = world();
  const r = await handle(post({ scope: 'wins', league: L, season: S }, { authorization: 'Bearer ' + JWT }), w.deps);
  const chk = w.calls.find(c => c.rpc === 'analytics_check');
  ok('analytics_check is asked through a client carrying the caller\'s own JWT', w.callers[0] === 'Bearer ' + JWT && chk && chk.who === 'caller:Bearer ' + JWT);
  ok('...with the scope and ids as given', JSON.stringify(chk.args) === JSON.stringify({ p_scope: 'wins', p_league: L, p_season: S, p_team: null }), chk.args);
  ok('...never through the service role', !w.calls.some(c => c.rpc === 'analytics_check' && c.who === 'admin'));
  const take = w.calls.find(c => c.rpc === 'analytics_take');
  ok('the limit is taken by the service role, counted against the user', take.who === 'admin' && take.args.p_subject === 'u:user-1' && take.args.p_signed === true &&
     take.args.p_league === L && take.args.p_scope === 'wins', take.args);
  const body = await json(r);
  ok('200 with a signed URL, the token, bytes, built_at, layout and expires_in 120', r.status === 200 && /token=SIGNED/.test(body.url) && body.token === '12@2026-09-30T10:00:00Z' &&
     body.bytes === 41234 && body.built_at === '2026-09-30T11:00:00Z' && body.layout === 1 && body.expires_in === 120, body);
  const sign = w.calls.find(c => c.storage === 'sign');
  ok('createSignedUrl(path, 120) on the private analytics bucket', sign && sign.bucket === 'analytics' && sign.ttl === 120 && sign.path === w.st.rows[0].path && sign.who === 'admin');
  ok('`pending`: the new games since the file\'s watermark, a HEAD count of game_features', body.pending === 3 &&
     w.calls.some(c => c.table === 'game_features' && c.selectOpts.head && c.filters.some(f => f[0] === 'gt' && f[1] === 'finalised_at' && f[2] === '2026-09-30T10:00:00Z')));
  ok('...and ci_at and n_games for the loader', body.ci_at === '2026-09-28T03:40:00Z' && body.n_games === 12);
  ok('no-store, and the rate headers', r.headers.get('cache-control') === 'no-store' && r.headers.get('x-ratelimit-limit') === '60' && r.headers.get('x-ratelimit-remaining') === '57');
  const files = w.calls.find(c => c.table === 'analytics_files');
  ok('the index row: scope, league_key, team_key \'\' and the season asked for', ['scope:wins', 'league_key:' + L, 'team_key:', 'season_key:' + S].every(s =>
     files.filters.some(f => f[0] === 'eq' && f[1] + ':' + f[2] === s)), files.filters);
  ok('the log has scope, league, signed and bytes, and no token or URL', w.logs.length === 1 && w.logs[0].scope === 'wins' && w.logs[0].signed === true &&
     w.logs[0].bytes === 41234 && !/SIGNED|token|12@/.test(JSON.stringify(w.logs)), w.logs);
}
{
  const w = world();
  await handle(post({ scope: 'wins', league: L }, { authorization: 'Bearer sb_publishable_iYjQ' }), w.deps);
  ok('a bearer that is not a JWT (the publishable key) asks as the signed-out', w.callers[0] === null);
  const take = w.calls.find(c => c.rpc === 'analytics_take');
  const want = 'ip:' + createHash('sha256').update(['203.0.113.9', '', '2026-10-01', 'pepper'].join('|')).digest('hex').slice(0, 32);
  ok('...counted against a salted hash of address, browser and day', take.args.p_subject.startsWith('ip:') && take.args.p_subject.length === 35 && take.args.p_signed === false);
  const w2 = world();
  await handle(post({ scope: 'wins', league: L }, { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }), w2.deps);
  ok('...the first x-forwarded-for address, the user agent, the UTC date and ANALYTICS_SALT, 32 hex characters', w2.calls.find(c => c.rpc === 'analytics_take').args.p_subject === want);
  const files = w.calls.find(c => c.table === 'analytics_files');
  ok('no season asked: the league\'s current file', files.filters.some(f => f[1] === 'is_current' && f[2] === true));
}
{
  const w = world({ rows: [Object.assign({}, world().st.rows[0], { token: '400@2026-09-30T10:00:00Z@o12ab', league_id: null, season_id: null })] });
  const r = await handle(post({ scope: 'wins' }), w.deps);
  const b = await json(r);
  ok('the pooled file: league_key all, no pending count', r.status === 200 && b.pending === null &&
     w.calls.find(c => c.table === 'analytics_files').filters.some(f => f[1] === 'league_key' && f[2] === 'all') && !w.calls.some(c => c.table === 'game_features'));
  ok('...and its limit is taken against league all', w.calls.find(c => c.rpc === 'analytics_take').args.p_league === 'all');
}

console.log('\nrefusals');
for (const [verdict, status] of [['signin', 401], ['members', 403], ['league', 403], ['scope', 403]]) {
  const w = world({ check: verdict });
  const r = await handle(post({ scope: 'fo', league: L }), w.deps);
  ok(`'${verdict}' from the database is ${status} {reason: '${verdict}'}, no-store, and nothing is taken or signed`,
     r.status === status && (await json(r)).reason === verdict && r.headers.get('cache-control') === 'no-store' &&
     !w.calls.some(c => c.rpc === 'analytics_take' || c.storage));
}
{
  const w = world({ check: () => ({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }) });
  const r = await handle(post({ scope: 'wins', league: L }, { authorization: 'Bearer ' + JWT }), w.deps);
  ok('PostgREST refusing the JWT is 401 {reason: \'jwt\'}', r.status === 401 && (await json(r)).reason === 'jwt');
  const w2 = world({ check: 'ok' });
  const r2 = await handle(post({ scope: 'store', league: L }), w2.deps);
  ok('a scope outside wins/fo/club/pos is refused even if the check were to pass', r2.status === 403 && (await json(r2)).reason === 'scope');
}
{
  const w = world({ take: { ok: false, used_hour: 20, limit_hour: 20, used_day: 20, limit_day: 100, retry_after: 1234 } });
  const r = await handle(post({ scope: 'wins', league: L }), w.deps);
  const b = await json(r);
  ok('over the limit: 429 {reason: \'rate\', retry_after}', r.status === 429 && b.reason === 'rate' && b.retry_after === 1234, b);
  ok('...with Retry-After, X-RateLimit-Limit and X-RateLimit-Remaining', r.headers.get('retry-after') === '1234' && r.headers.get('x-ratelimit-limit') === '20' &&
     r.headers.get('x-ratelimit-remaining') === '0' && r.headers.get('cache-control') === 'no-store');
  ok('...and no URL is signed', !w.calls.some(c => c.storage === 'sign'));
}
{
  const w = world({ rows: [] });
  const r = await handle(post({ scope: 'club', league: L, season: S, team: T }), w.deps);
  ok('no file built yet: 404 {reason: \'none\'}', r.status === 404 && (await json(r)).reason === 'none');
  ok('...the club\'s row was looked up by its team', w.calls.find(c => c.table === 'analytics_files').filters.some(f => f[1] === 'team_key' && f[2] === T));
  const w2 = world({ sign: { data: null, error: { message: 'Object not found' } } });
  ok('an index row whose object is gone is 404 too, not a broken URL', (await handle(post({ scope: 'wins', league: L }), w2.deps)).status === 404);
}

/* ============================================================ 2. RECALCULATE --- */
console.log('\nRECALCULATE');
const WM = { at: '2026-09-30T10:00:00Z', id: '00000000-0000-0000-0000-000000000000' };
function refreshWorld(o = {}) {
  const updates = [];
  const old = {
    store: { scope: 'store', league_key: L, season_key: S, team_key: '', league_id: L, season_id: S, team_id: null, is_current: true,
             path: 'store/' + L + '/' + S + '/s1-fv1.json', token: '12@2026-09-30T10:00:00Z', layout: 1, fv: 1, ci_at: null },
    wins: { scope: 'wins', league_key: L, season_key: S, team_key: '', league_id: L, season_id: S, team_id: null, is_current: true,
            path: 'wins/' + L + '/' + S + '/v1-12-2026-09-30T10-00-00Z.json', token: '12@2026-09-30T10:00:00Z', layout: 1, fv: 1, ci_at: '2026-09-28T03:40:00Z' }
  };
  const feat = [0, 1, 2].flatMap(k => [0, 1].map(t => ({ game_id: 'g' + k, team_idx: t, f: [1, 2], q: 1023, st: null, finalised_at: '2026-10-01T0' + k + ':00:00Z' })));
  const w = world(Object.assign({
    take: { ok: true, used_hour: 1, limit_hour: 60 },
    extra: (q, st) => {
      if (q.rpc === 'analytics_refresh_take') return { data: st.refreshTake || { ok: true }, error: null };
      if (q.rpc === 'analytics_refresh_done') { st.done = q.args; return { data: null, error: null }; }
      if (q.table === 'analytics_refresh') return { data: st.refreshRows || [{ finished_at: '2026-10-01T12:00:05Z', status: 'done' }], error: null };
      if (q.table === 'analytics_files' && q.op === 'select' && q.filters.some(f => f[1] === 'season_key') && !q.filters.some(f => f[1] === 'scope'))
        return { data: [old.store, old.wins], error: null };
      if (q.table === 'analytics_files' && q.op === 'upsert') { st.upserted = q.rows; st.order.push('index'); return { data: null, error: null }; }
      if (q.storage === 'download') return { data: JSON.stringify({ v: 1, fv: 1, n: 12, wm: WM }), error: null };
      if (q.storage === 'upload') { st.order.push('upload:' + q.path); return { data: {}, error: null }; }
      if (q.storage === 'remove') { st.order.push('remove'); st.removed = q.paths; return { data: {}, error: null }; }
      if (q.table === 'game_features' && q.selectOpts && q.selectOpts.head && q.filters.some(f => f[0] === 'or')) return { data: null, count: st.delta, error: null };
      if (q.table === 'game_features' && q.op === 'select') return { data: feat, error: null };
      if (q.table === 'games') return { data: [0, 1, 2].map(k => ({ id: 'g' + k, status: 'final' })), error: null };
      if (q.table === 'player_game_stats') { st.pgsCols = q.cols; return { data: [{ game_id: 'g0', pts: 10 }], error: null }; }
      if (q.table === 'lineup_stints') { st.stintCols = q.cols; return { data: [{ game_id: 'g0', dur: 300 }], error: null }; }
      return undefined;
    },
    delta: 3, order: []
  }, o));
  w.deps.update = async (store, delta, opts) => {
    updates.push({ store, delta, opts });
    await new Promise(r => setTimeout(r, 5));
    return { store: Object.assign({}, store, { n: store.n + 3, wm: { at: '2026-10-01T02:00:00Z', id: 'g2' } }),
             files: { wins: { w: 1, scope: 'wins', n: { games: 15 } }, fo: { w: 1, scope: 'fo' }, club: { [T]: { w: 1, scope: 'club' } } } };
  };
  if (o.noModel) delete w.deps.update;
  return Object.assign(w, { updates, old });
}
{
  const w = refreshWorld();
  const r = await handle(post({ scope: 'wins', league: L, refresh: true }), w.deps);
  ok('signed out: RECALCULATE asks you to sign in', r.status === 401 && (await json(r)).reason === 'signin' && !w.updates.length);
}
{
  const w = refreshWorld();
  const [a, b] = await Promise.all([
    handle(post({ scope: 'wins', league: L, season: S, refresh: true }, { authorization: 'Bearer ' + JWT }), w.deps),
    handle(post({ scope: 'fo', league: L, season: S, refresh: true }, { authorization: 'Bearer ' + JWT }), w.deps)
  ]);
  const A = await json(a), Bj = await json(b);
  ok('two presses at once: one update, the second joins it', w.updates.length === 1 && A.refreshed === true && Bj.refreshed === true && Bj.joined === true, [A, Bj]);
  ok('...and one analytics_refresh_take for the unit', w.calls.filter(c => c.rpc === 'analytics_refresh_take').length === 1);
  const u = w.updates[0];
  ok('update(store, delta) gets the store and the delta: lines, games, player lines, stints', u.store.n === 12 && u.delta.rows.length === 6 &&
     u.delta.games.length === 3 && u.delta.pgs.length === 1 && u.delta.stints.length === 1);
  const read = w.calls.find(c => c.table === 'game_features' && c.op === 'select' && !c.selectOpts.head);
  ok('the delta is read keyset after the store\'s watermark (finalised_at, game_id)', read.filters.some(f => f[0] === 'or' &&
     f[1] === 'finalised_at.gt.2026-09-30T10:00:00Z,and(finalised_at.eq.2026-09-30T10:00:00Z,game_id.gt.00000000-0000-0000-0000-000000000000)') &&
     JSON.stringify(read.order) === '["finalised_at","game_id","team_idx"]', read);
  ok('...player lines and stints by named keys: never stats->sit, never the whole stats', !/stats->sit|(^|,)stats(,|$)/.test(w.st.pgsCols) &&
     /min:stats->min/.test(w.st.pgsCols) && !/stats->sit|(^|,)stats(,|$)/.test(w.st.stintCols) && /dur:stats->dur/.test(w.st.stintCols));
  const ups = w.st.order.filter(x => x.startsWith('upload:'));
  ok('new files are written beside the old ones, named by the new token', ups.includes('upload:wins/' + L + '/' + S + '/v1-15-2026-10-01T02-00-00Z.json') &&
     ups.includes('upload:club/' + L + '/' + S + '/' + T + '/v1-15-2026-10-01T02-00-00Z.json') && ups.includes('upload:store/' + L + '/' + S + '/s1-fv1.json'), ups);
  ok('...the index after every upload, the delete after the index', w.st.order.indexOf('index') > w.st.order.lastIndexOf(ups[ups.length - 1]) &&
     w.st.order.indexOf('remove') > w.st.order.indexOf('index'), w.st.order);
  ok('...only the old file the new one replaced is deleted', JSON.stringify(w.st.removed) === JSON.stringify([w.old.wins.path]), w.st.removed);
  const winsRow = w.st.upserted.find(x => x.scope === 'wins');
  ok('the index row keeps is_current and the last bootstrap time (ci_at), with the new token', winsRow.is_current === true && winsRow.ci_at === '2026-09-28T03:40:00Z' &&
     winsRow.token === '15@2026-10-01T02:00:00Z' && winsRow.n_games === 15, winsRow);
  ok('the unit is marked done', w.st.done && w.st.done.p_status === 'done' && w.st.done.p_league === L && w.st.done.p_season === S);
}
{
  const w = refreshWorld({ delta: REFRESH_CAP + 1 });
  const r = await handle(post({ scope: 'wins', league: L, season: S, refresh: true }, { authorization: 'Bearer ' + JWT }), w.deps);
  const b = await json(r);
  ok('more than ' + REFRESH_CAP + ' new games: {queued: true}, the unit marked for the scheduled build, the current file still answered',
     r.status === 200 && b.queued === true && b.refresh_reason === 'cap' && w.st.done.p_status === 'queued' && !w.updates.length && /SIGNED/.test(b.url), b);
}
{
  const w = refreshWorld({ delta: 0 });
  const b = await json(await handle(post({ scope: 'wins', league: L, season: S, refresh: true }, { authorization: 'Bearer ' + JWT }), w.deps));
  ok('nothing new: no update, {refreshed: false}', b.refreshed === false && b.refresh_reason === 'current' && !w.updates.length);
}
{
  const w = refreshWorld({ refreshTake: { ok: false, state: 'running' }, refreshRows: [{ finished_at: '2026-10-01T12:00:09Z', status: 'done' }] });
  const b = await json(await handle(post({ scope: 'wins', league: L, season: S, refresh: true }, { authorization: 'Bearer ' + JWT }), w.deps));
  ok('a refresh already running in another isolate: wait for it and answer its file (joined)', b.refreshed === true && b.joined === true && !w.updates.length, b);
}
{
  const w = refreshWorld({ refreshTake: { ok: false, state: 'recent', retry_after: 420 } });
  const b = await json(await handle(post({ scope: 'wins', league: L, season: S, refresh: true }, { authorization: 'Bearer ' + JWT }), w.deps));
  ok('refreshed under ten minutes ago: the current file, refreshed false, retry_after', b.refreshed === false && b.refresh_reason === 'recent' && b.retry_after === 420 && !w.updates.length);
}
{
  const w = refreshWorld({ refreshTake: { ok: false, state: 'rate', retry_after: 900 } });
  const r = await handle(post({ scope: 'wins', league: L, season: S, refresh: true }, { authorization: 'Bearer ' + JWT }), w.deps);
  ok('the caller\'s own refresh limit: 429 with Retry-After', r.status === 429 && r.headers.get('retry-after') === '900');
}
{
  const w = refreshWorld({ noModel: true });
  const b = await json(await handle(post({ scope: 'wins', league: L, season: S, refresh: true }, { authorization: 'Bearer ' + JWT }), w.deps));
  ok('no model in the function yet: queued for the scheduled build, never an error', b.queued === true && b.refresh_reason === 'model' && w.st.done.p_status === 'queued');
}
{
  const w = refreshWorld({ check: 'members' });
  const r = await handle(post({ scope: 'wins', league: L, season: S, refresh: true }, { authorization: 'Bearer ' + JWT }), w.deps);
  ok('RECALCULATE behind the same gate as the files (members only)', r.status === 403 && !w.calls.some(c => c.rpc === 'analytics_refresh_take'));
  const w2 = refreshWorld();
  const r2 = await handle(post({ scope: 'wins', refresh: true }, { authorization: 'Bearer ' + JWT }), w2.deps);
  ok('...and only for a league\'s own unit, not the pooled file', r2.status === 403 && !w2.updates.length);
}
ok('helpers: fileName replaces each non-alphanumeric run, tokenAt reads a unit token and not a pooled one, jwtSub reads the subject',
   fileName(1, '12@2026-09-30T10:00:00.5+00:00') === 'v1-12-2026-09-30T10-00-00-5-00-00.json' && tokenAt('12@2026-09-30T10:00:00Z') === '2026-09-30T10:00:00Z' &&
   tokenAt('40@2026-09-30T10:00:00Z@oab12') === null && jwtSub(JWT) === 'user-1' && jwtSub('x.y.z') === '');

/* ============================================================== 3. the wiring --- */
console.log('\nthe wiring');
{
  const cfg = read('supabase', 'config.toml');
  ok('config.toml: [functions.analytics-file] verify_jwt = false, with its reason', /\n# analytics-file[\s\S]{100,1500}?\[functions\.analytics-file\]\nverify_jwt = false/.test(cfg));
  const idx = read('supabase', 'functions', 'analytics-file', 'index.ts');
  ok('the function wires handle() to Deno.serve with the caller\'s client, the service role, sha256 and the model\'s update',
     /import \{ handle \} from '\.\.\/_shared\/analyticsfile\.ts'/.test(idx) && /Deno\.serve\(\(req\) =>[^\n]*req\.method === 'OPTIONS'[^\n]*handle\(req, \{/.test(idx) && /SUPABASE_SERVICE_ROLE_KEY/.test(idx) &&
     /crypto\.subtle\.digest\('SHA-256'/.test(idx) && /EpinoiaWinModel\.update/.test(idx) && /import '\.\.\/_shared\/winmodel\.js'/.test(idx));
  const pure = read('supabase', 'functions', '_shared', 'analyticsfile.ts');
  ok('the pure half imports nothing', !/^\s*import\s/m.test(pure));
  ok('...and every answer it builds is no-store', /'Cache-Control': 'no-store'/.test(pure));

  const fin = read('supabase', 'functions', 'finalise-game', 'index.ts');
  ok('finalise-game imports extract and toRows from the shared features.js', /import \{ extract as extractFeatures, toRows as featureRows \} from '\.\.\/_shared\/features\.js';/.test(fin));
  const iSit = fin.indexOf('computeSituations(game)'), iX = fin.indexOf('extractFeatures(game, { d, TA, C: SITC })'), iLock = fin.indexOf("update({ status: 'finalising'");
  ok('the line is worked out after the situations and before the lock, from what finalise holds', iSit > 0 && iX > iSit && iLock > iX);
  ok('...unless FEATURES_OFF is 1, in its own try/catch, with the backfill warning',
     /if \(Deno\.env\.get\('FEATURES_OFF'\) !== '1'\) \{\s*try \{\s*FL = extractFeatures\(game, \{ d, TA, C: SITC \}\);\s*\} catch \(e\) \{[\s\S]{0,200}?could not be worked out — run the features backfill/.test(fin));
  const iAll = fin.indexOf('const w = await Promise.all(['), iThrow = fin.indexOf('if (failed) throw new Error(failed.error!.message);');
  const iUp = fin.indexOf("from('game_features').upsert("), iPub = fin.indexOf("status: 'final',");
  ok('the rows are stored after the three inserts have succeeded and before publishing, outside their Promise.all',
     iAll > 0 && iThrow > iAll && iUp > iThrow && iPub > iUp && !fin.slice(iAll, iThrow).includes('game_features'));
  const block = fin.slice(fin.indexOf('const publishedAt'), iPub);
  ok('...in their own try/catch, never blocking, with the backfill warning', /if \(FL && g\.competition_id\) \{\s*try \{/.test(block) &&
     /\} catch \(e\) \{[\s\S]{0,200}?was not stored — run the features backfill/.test(block) && !/return json\(/.test(block));
  ok('...upserted on game_id,team_idx with the competition\'s season and league', /\.select\('season_id,seasons\(league_id\)'\)/.test(block) &&
     /\{ onConflict: 'game_id,team_idx' \}/.test(block) && /featureRows\(gameId, FL, \{ league_id: leagueId, season_id: seasonId, competition_id: g\.competition_id, finalised_at: publishedAt \}\)/.test(block));
  ok('one publishedAt for games.finalised_at and the rows', (fin.match(/const publishedAt = new Date\(\)\.toISOString\(\);/g) || []).length === 1 &&
     /finalised_at: publishedAt, finalised_by: user\.id/.test(fin));
  const reopen = fin.slice(fin.indexOf('if (reopen) {'), fin.indexOf("return json({ ok: true, status: 'live', warnings });"));
  ok('reopen deletes the game\'s feature rows', /from\('game_features'\)\.delete\(\)\.eq\('game_id', gameId\)/.test(reopen));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
