/* ============================================================================
   WHAT WINS: THE BUILDER'S RUN (tools/build-analytics.mjs) against a mocked Supabase (PostgREST + Storage).

     node supabase/tests/ww-build.test.mjs

   What is held here (docs/what-wins-model.md §6, §16 WP3, A.2):
     * the lines are read keyset only (finalised_at, game_id, team_idx), never by offset, across page boundaries
       and ties; no request selects stats->sit or a whole stats blob;
     * a dry run writes nothing; a run uploads the files, then points the index at them, then deletes the old
       objects; the store goes to the bucket and the cache;
     * an unchanged token is skipped; a unit built within the floor is not rebuilt; a unit RECALCULATE could not
       finish (analytics_refresh.due) goes first and its flag is cleared;
     * incremental equals full byte for byte; a re-finalised game replaces its line;
     * a deleted league's objects and index rows are purged; a file over its budget fails its unit and the old file
       stays;
     * --fixtures writes the five §9 sample files.
   ============================================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra !== '' ? '  -> ' + extra : ''}`);
};
const B = await import(pathToFileURL(path.join(ROOT, 'tools', 'build-analytics.mjs')).href);
const M = B.load('', '');
const F = globalThis.EpinoiaFeatures;
const t0 = Date.now();
const URL0 = 'https://mock.supabase.test';
const OPTS = { B: 30, simOpts: { fitN: 30, fitSims: 20, evalSims: 40 }, cacheDir: false, log: () => {} };
const at = (h) => new Date(Date.UTC(2027, 0, 4, 12) + h * 3600000).toISOString();   // after every synthetic game's finalised_at

/* ------------------------------------------------------------------------------------------- the data --- */
const L1 = M.synthUnit({ teams: 10, games: 120, seed: 7 }), L2 = M.synthUnit({ teams: 8, games: 64, seed: 8 });
function unitRows(U, slug) {
  const r = U.raw, lg = { id: U.league.id, slug, name: U.league.name };
  const se = { id: U.season.id, league_id: lg.id, name: U.season.name, starts_on: '2026-09-01' };
  return {
    league: lg, season: se, comp: { id: r.comp, season_id: se.id, kind: 'league' },
    features: r.rows.map(x => Object.assign({}, x, { league_id: lg.id, season_id: se.id, competition_id: r.comp })),
    games: r.games.concat(r.scheduled.map(s => ({ id: s.id, status: 'scheduled', competition_id: r.comp, home_team_id: s.h, away_team_id: s.a, tipoff_at: s.t }))),
    pgs: r.pgs, stints: r.stints,
    teams: r.teams.map(t => ({ id: t.id, name: t.name, short_name: t.short_name, colour: t.colour, logo_path: null, home_venue_id: t.home_venue_id })),
    rosters: r.rosters.map(x => ({ team_id: x.team_id, active: true, position: x.position, players: { id: x.player_id, height_cm: x.height_cm } })),
    players: Array.from(new Set(r.pgs.map(p => p.player_uuid))).map(id => ({ id, is_minor: r.withheld.includes(id), public_consent: !r.withheld.includes(id) })),
    bios: Object.entries(r.bios).map(([id, b]) => ({ player_id: id, age: b.age, birth_year: b.birth_year, height_cm: b.height_cm })),
    venues: Object.entries(r.venues).map(([id, c]) => ({ id, lat: c[0], lng: c[1] }))
  };
}
const U1 = unitRows(L1, 'synth-one'), U2 = unitRows(L2, 'synth-two');
const gameIds1 = Array.from(new Set(U1.features.map(r => r.game_id)));
/* the first 100 games of league one, finalised in tip-off order; the rest come later */
const order1 = M.decodeStore(L1.store).games.map(g => g.id);
const early = new Set(order1.slice(0, 100)), late = order1.slice(100);

/* ------------------------------------------------------------------------------------------- the mock --- */
function mockDb(units, opts) {
  opts = opts || {};
  const db = { leagues: [], seasons: [], competitions: [], game_features: [], games: [], player_game_stats: [], lineup_stints: [], teams: [], roster_entries: [], players: [],
    venues: [], bios: [], analytics_files: [], analytics_refresh: [], open: [] };
  const bucket = new Map(), snapshots = new Map(), events = [], urls = [];
  let seq = 0;
  units.forEach(u => {
    db.leagues.push(u.league); db.seasons.push(u.season); db.competitions.push(u.comp);
    const want = opts.only && opts.only[u.league.id];
    const has = id => !want || want.has(id);
    db.game_features.push(...u.features.filter(r => has(r.game_id)));
    db.games.push(...u.games.filter(g => g.status !== 'final' || has(g.id)));
    db.player_game_stats.push(...u.pgs.filter(r => has(r.game_id)));
    db.lineup_stints.push(...u.stints.filter(r => has(r.game_id)).map((r, i) => Object.assign({ id: u.league.slug + i }, r)));
    db.teams.push(...u.teams); db.roster_entries.push(...u.rosters); db.players.push(...u.players); db.bios.push(...u.bios); db.venues.push(...u.venues);
    if (!(opts.closed && opts.closed.has(u.league.id))) db.open.push(u.league.id);
  });
  const filterOf = sp => {
    const fs_ = [];
    for (const [k, v] of sp.entries()) {
      if (['select', 'order', 'limit', 'offset', 'or', 'on_conflict'].includes(k)) continue;
      const m = /^(eq|in|gt|neq)\.(.*)$/.exec(v);
      if (!m) throw new Error('mock: filter ' + k + '=' + v);
      if (m[1] === 'eq') fs_.push(r => String(r[k]) === m[2]);
      else if (m[1] === 'in') { const set = new Set(m[2].replace(/^\(|\)$/g, '').split(',')); fs_.push(r => set.has(String(r[k]))); }
      else if (m[1] === 'gt') fs_.push(r => String(r[k]) > m[2]);
      else if (m[1] === 'neq') fs_.push(r => String(r[k]) !== m[2]);
    }
    const or = sp.get('or');
    if (or) {
      const a = /finalised_at\.gt\."([^"]+)"/.exec(or), id = /game_id\.gt\.([^),]+)/.exec(or), ti = /team_idx\.gt\.(\d)/.exec(or), idEq = /game_id\.eq\.([^),]+)/.exec(or);
      if (!a || !id) throw new Error('mock: or=' + or);
      fs_.push(r => r.finalised_at > a[1] || (r.finalised_at === a[1] && (r.game_id > id[1] || (ti && idEq && r.game_id === idEq[1] && r.team_idx > +ti[1]))));
    }
    return r => fs_.every(f => f(r));
  };
  const sortBy = (rows, o) => {
    if (!o) return rows;
    const keys = o.split(',').map(x => { const [c, d] = x.split('.'); return [c, d === 'desc' ? -1 : 1]; });
    return rows.slice().sort((a, b) => { for (const [c, d] of keys) { const x = a[c], y = b[c]; if (x < y) return -d; if (x > y) return d; } return 0; });
  };
  const table = name => {
    if (name === 'roster_entries') return db.roster_entries;
    if (!(name in db)) throw new Error('mock: table ' + name);
    return db[name];
  };
  const json = (v, status, headers) => new Response(v == null ? null : JSON.stringify(v), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) });
  const fetch = async (url, init) => {
    init = init || {};
    const u = new URL(url), method = (init.method || 'GET').toUpperCase();
    urls.push(method + ' ' + decodeURIComponent(u.pathname + u.search));
    const hdr = init.headers || {};
    if (hdr.apikey !== 'service-key' || hdr.Authorization !== 'Bearer service-key') return json({ message: 'no key' }, 401);
    let p = u.pathname;
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length), body = init.body ? JSON.parse(init.body) : {};
      events.push({ seq: seq++, op: 'rpc', fn });
      if (fn === 'analytics_issue_prune') return json(0);
      if (fn === 'analytics_open_leagues') return json(db.open);
      if (fn === 'player_bio') { const want = new Set(body.p_ids); return json(db.bios.filter(b => want.has(b.player_id))); }
      return json({ message: 'no rpc ' + fn }, 404);
    }
    if (p.startsWith('/rest/v1/')) {
      const name = p.slice('/rest/v1/'.length), sp = u.searchParams, rows = table(name), f = filterOf(sp);
      if (method === 'HEAD') { const n = rows.filter(f).length; return new Response(null, { status: 200, headers: { 'content-range': '0-0/' + n } }); }
      if (method === 'GET') {
        let out = sortBy(rows.filter(f), sp.get('order'));
        const off = +(sp.get('offset') || 0), lim = sp.get('limit') ? +sp.get('limit') : Infinity;
        out = out.slice(off, off + lim);
        return json(out);
      }
      if (method === 'POST' && name === 'analytics_files') {
        const list = JSON.parse(init.body);
        list.forEach(r => {
          const k = x => [x.scope, x.league_key, x.season_key, x.team_key || ''].join('|');
          const i = db.analytics_files.findIndex(x => k(x) === k(r));
          if (i >= 0) db.analytics_files[i] = Object.assign({}, db.analytics_files[i], r); else db.analytics_files.push(Object.assign({}, r));
        });
        events.push({ seq: seq++, op: 'index', rows: list.map(r => r.scope + ':' + (r.team_key || '') + ':' + r.path) });
        return json(null, 201);
      }
      if (method === 'DELETE' && name === 'analytics_files') {
        const before = db.analytics_files.length;
        db.analytics_files = db.analytics_files.filter(r => !f(r));
        events.push({ seq: seq++, op: 'unindex', n: before - db.analytics_files.length });
        return json(null, 204);
      }
      if (method === 'PATCH' && name === 'analytics_files') {
        const body = JSON.parse(init.body);
        db.analytics_files.filter(f).forEach(r => Object.assign(r, body));
        events.push({ seq: seq++, op: 'retire' });
        return json(null, 204);
      }
      if (method === 'PATCH' && name === 'analytics_refresh') {
        const body = JSON.parse(init.body);
        db.analytics_refresh.filter(f).forEach(r => Object.assign(r, body));
        events.push({ seq: seq++, op: 'patch' });
        return json(null, 204);
      }
      return json({ message: 'mock: ' + method + ' ' + name }, 405);
    }
    if (p.startsWith('/storage/v1/object/list/')) {
      const b = p.split('/')[5], body = JSON.parse(init.body), store = b === 'analytics' ? bucket : snapshots;
      const pre = body.prefix.replace(/\/?$/, '/');
      return json(Array.from(store.keys()).filter(k => k.startsWith(pre) && !k.slice(pre.length).includes('/')).map(k => ({ name: k.slice(pre.length) })));
    }
    if (p.startsWith('/storage/v1/object/')) {
      const rest = decodeURIComponent(p.slice('/storage/v1/object/'.length)), b = rest.split('/')[0], key = rest.slice(b.length + 1);
      const store = b === 'analytics' ? bucket : b === 'snapshots' ? snapshots : null;
      if (!store) return json({ message: 'no bucket' }, 400);
      if (method === 'POST' && key) { store.set(key, { body: String(init.body), cache: hdr['cache-control'] }); events.push({ seq: seq++, op: 'upload', bucket: b, path: key }); return json({ Key: rest }); }
      if (method === 'GET' && key) { const o = store.get(key); return o ? new Response(o.body, { status: 200 }) : json({ message: 'not found' }, 400); }
      if (method === 'DELETE' && !key) { const body = JSON.parse(init.body); body.prefixes.forEach(x => store.delete(x)); events.push({ seq: seq++, op: 'delete', bucket: b, paths: body.prefixes.slice() }); return json([]); }
    }
    return json({ message: 'mock: unknown ' + method + ' ' + p }, 404);
  };
  return { db, bucket, snapshots, events, urls, fetch, mutations: () => events.filter(e => e.op !== 'rpc' || e.fn === 'analytics_issue_prune').length };
}
const run = (mk, o) => B.run(Object.assign({ url: URL0, serviceKey: 'service-key', fetch: mk.fetch }, OPTS, o));
const idxRow = (mk, scope, league, team) => mk.db.analytics_files.find(r => r.scope === scope && r.league_key === league && (r.team_key || '') === (team || ''));

/* ------------------------------------------------------------------------------------------- keyset --- */
console.log('\nreads');
{
  /* 2,500 lines with ties on finalised_at across the page boundaries */
  const rows = [];
  for (let i = 0; i < 1250; i++) for (const ti of [0, 1]) rows.push({ game_id: 'g' + String(i).padStart(5, '0'), team_idx: ti, finalised_at: at(Math.floor(i / 7)), f: [], q: 0 });
  const mk = mockDb([]);
  mk.db.game_features = rows.map(r => Object.assign({ league_id: 'L', season_id: 'S', fv: F.FV }, r));
  const api = { rest: async p => (await (await mk.fetch(URL0 + '/rest/v1/' + p, { headers: { apikey: 'service-key', Authorization: 'Bearer service-key' } })).json()) };
  const got = await B.readFeatures(api, 'L', 'S', F.FV, { at: '1970-01-01T00:00:00Z', id: '00000000-0000-0000-0000-000000000000' });
  const keys = new Set(got.map(r => r.game_id + ':' + r.team_idx));
  ok('readFeatures: every line once, keyset across page boundaries and ties (2,500 lines, 3 pages)', got.length === 2500 && keys.size === 2500 && mk.urls.length === 3 &&
    mk.urls.every(x => x.includes('order=finalised_at,game_id,team_idx') && x.includes('limit=1000') && !x.includes('offset')), mk.urls.length + ' requests');
  const after = await B.readFeatures(api, 'L', 'S', F.FV, { at: rows[1399].finalised_at, id: rows[1399].game_id });
  ok('...after a watermark it reads only what follows it', after.length === 2500 - 1400 && after[0].game_id === rows[1400].game_id);
}

/* ------------------------------------------------------------------------------------------- dry run --- */
console.log('\na dry run, then the first run');
const mk = mockDb([U1, U2], { only: { [U1.league.id]: early } });
{
  const r = await run(mk, { dryRun: true, now: at(0) });
  ok('a dry run reads and builds but writes nothing (no upload, index, delete, prune, flag)', mk.events.filter(e => e.op !== 'rpc').length === 0 &&
    !mk.events.some(e => e.fn === 'analytics_issue_prune') && mk.bucket.size === 0 && r.writes.some(w => w.startsWith('upload wins/')) && r.built.length > 10, r.writes.length + ' writes said');
  ok('...its summary says so', /dry run: nothing written/.test(r.summary));
}
let first;
{
  mk.events.length = 0; mk.urls.length = 0;
  first = await run(mk, { now: at(0) });
  const scopes = s => first.built.filter(b => b.scope === s).length;
  ok('the first run builds the pooled file, the teaser, and each unit\'s wins, fo, clubs and pos', !first.failed.length && scopes('wins') === 3 && scopes('fo') === 2 &&
    scopes('club') === 18 && scopes('pos') === 18 && scopes('teaser') === 1, first.failed.map(f => f.error).join('; ') || first.built.length + ' files');
  const w1 = idxRow(mk, 'wins', U1.league.id);
  ok('...index rows name objects inside the bucket, with token, layout, fv, bytes, n, built_at and ci_at', !!w1 && w1.path === 'wins/' + U1.league.id + '/' + U1.season.id + '/' + B.fileName(1, w1.token) &&
    mk.bucket.has(w1.path) && w1.token === '100@' + U1.features.filter(r => early.has(r.game_id)).map(r => r.finalised_at).sort().pop() && w1.layout === 1 && w1.fv === F.FV &&
    w1.n_games === 100 && w1.built_at === at(0) && w1.ci_at === at(0) && w1.is_current === true && w1.bytes === mk.bucket.get(w1.path).body.length);
  const st = idxRow(mk, 'store', U1.league.id), pos = mk.db.analytics_files.filter(r => r.scope === 'pos');
  ok('...the private store is registered (scope store) and pos files have scope pos and their team', !!st && st.path === 'store/' + U1.league.id + '/' + U1.season.id + '/s1-fv1.json' &&
    mk.bucket.has(st.path) && pos.length === 18 && pos.every(r => r.team_key && r.team_id === r.team_key && mk.bucket.has(r.path)));
  const pool = idxRow(mk, 'wins', 'all'), pri = idxRow(mk, 'priors', 'all');
  ok('...the pooled row (all / current) and the priors', !!pool && pool.season_key === 'current' && pool.is_current && mk.bucket.has(pool.path) && !!pri && mk.bucket.has('priors/v1.json'));
  const ix = mk.snapshots.get('whatwins/index.json');
  ok('...the teaser goes to the public snapshots bucket with its index (max-age 600)', !!ix && mk.snapshots.has(JSON.parse(ix.body).file) && ix.cache === 'max-age=600' &&
    mk.snapshots.get(JSON.parse(ix.body).file).cache === 'max-age=31536000');
  /* the order: within each unit, every upload before the index, and the index before any delete */
  const unitIdx = mk.events.filter(e => e.op === 'index' && e.rows.some(x => x.startsWith('wins:') && x.includes(U1.league.id)));
  const ups = mk.events.filter(e => e.op === 'upload' && e.path.includes(U1.league.id) && !e.path.startsWith('store/'));
  ok('...uploads first, then the index points at them', unitIdx.length === 1 && ups.length > 0 && ups.every(e => e.seq < unitIdx[0].seq));
  const prune = mk.events.find(e => e.fn === 'analytics_issue_prune');
  ok('...the issue log is pruned first (§6.4 step 0)', !!prune && mk.events[0] === prune);
  const bad = mk.urls.filter(x => /stats->sit/.test(x) || /[?&,]select=([^&]*,)?stats(,|&|$)/.test(x) || /select=\*/.test(x));
  ok('no request selects stats->sit, a whole stats blob or *', !bad.length, bad.slice(0, 2).join(' | '));
  const gf = mk.urls.filter(x => x.includes('/rest/v1/game_features'));
  ok('...every game_features read is a count, the newest line, or keyset after the watermark (never by offset)', gf.length > 0 && gf.every(x => !x.includes('offset=') &&
    (x.startsWith('HEAD') || x.includes('limit=1&') || x.endsWith('limit=1') || (x.includes('or=(finalised_at.gt.') && x.includes('order=finalised_at,game_id,team_idx')) ||
     /game_id=in\.\([^)]*\)&select=game_id,team_idx,st$/.test(x))));
  const lines = gf.filter(x => x.includes('or=(finalised_at.gt.'));
  ok('...the delta\'s lines are read without st (asked for only for the games whose stints are missing or short)', lines.length > 0 && lines.every(x => /select=game_id,team_idx,f,q,finalised_at&/.test(x)), lines[0]);
  /* PERF-10: a unit's context (teams, rosters, bios, the withheld check, venues, fixtures) is read once a run, even when
     the pooled file is due too */
  const teamsReads = mk.urls.filter(x => /\/rest\/v1\/teams\?id=in\./.test(x)).length;
  ok('...each unit\'s context is read once in the run (the pooled step\'s read is reused by the unit\'s)', teamsReads === 2, teamsReads + ' teams reads for 2 units');
  const pg = mk.urls.filter(x => x.includes('/rest/v1/player_game_stats'));
  ok('...player lines name their stats keys one by one (§6.3)', pg.length > 0 && pg.every(x => x.includes('min:stats->min') && x.includes('pf:stats->pf')));
  const w = JSON.parse(mk.bucket.get(w1.path).body);
  ok('...the files in the bucket validate', M.validate(w, 'wins').length === 0 && M.validate(JSON.parse(mk.bucket.get(idxRow(mk, 'fo', U1.league.id).path).body), 'fo').length === 0);
  ok('...the job summary carries the §16 live acceptance numbers and the sizes', /\| unit \| games \| R²/.test(first.summary) && /Sizes: .*club 18 \(max/.test(first.summary) && first.summary.includes('synth-one') && first.accept[U1.league.id + ':' + U1.season.id].n === 100);
}

/* ------------------------------------------------------------------------------------------- skips --- */
console.log('\nskips and the floor');
{
  mk.events.length = 0;
  const r = await run(mk, { now: at(0.2) });
  ok('an unchanged token is skipped: nothing built, nothing uploaded', r.built.length === 0 && r.current === 2 && !mk.events.some(e => e.op === 'upload' || e.op === 'index'), r.current + ' current');
  /* twenty more games of league one arrive, finalised later */
  const lateSet = new Set(late);
  mk.db.game_features.push(...U1.features.filter(x => lateSet.has(x.game_id)).map(x => Object.assign({}, x, { finalised_at: at(0.3) })));
  mk.db.games.push(...U1.games.filter(g => lateSet.has(g.id)));
  mk.db.player_game_stats.push(...U1.pgs.filter(x => lateSet.has(x.game_id)));
  mk.db.lineup_stints.push(...U1.stints.filter(x => lateSet.has(x.game_id)).map((x, i) => Object.assign({ id: 'late' + i }, x)));
  mk.events.length = 0;
  const r2 = await run(mk, { now: at(0.5) });
  ok('a new token inside the floor (built 30 minutes ago, floor 1 h) waits', r2.built.length === 0 && r2.skipped.some(s => s.why === 'floor' && s.unit.startsWith(U1.league.id)));
}

/* ------------------------------------------------------------------------------------------- incremental --- */
console.log('\nincremental against full');
let inc;
{
  const old = { wins: idxRow(mk, 'wins', U1.league.id).path, fo: idxRow(mk, 'fo', U1.league.id).path };
  mk.events.length = 0; mk.urls.length = 0;
  /* simGrow 0: the simulator is calibrated afresh here as in the full build (carrying it while a unit grows by under 25%
     is PERF2-5's deliberate shortcut between weekly full runs, held in ww-winmodel) */
  inc = await run(mk, { now: at(2), poolGapHours: 0, simGrow: 0 });
  const w = idxRow(mk, 'wins', U1.league.id);
  ok('past the floor the unit is rebuilt from its store plus the 20 new games', !inc.failed.length && w.n_games === 120 && w.path !== old.wins && inc.built.some(b => b.scope === 'wins' && b.unit.startsWith(U1.league.id)),
    inc.failed.map(f => f.error).join('; ') + ' n ' + w.n_games + ' ' + JSON.stringify(inc.skipped));
  const fr = mk.urls.filter(x => x.startsWith('GET') && x.includes('/rest/v1/game_features') && x.includes(U1.league.id) && x.includes('or=('));
  ok('...reading only the lines after its watermark', fr.length >= 1 && fr.every(x => x.includes('finalised_at.gt."' + at(0)) || x.includes('finalised_at.gt."' + U1.features.filter(r => early.has(r.game_id)).map(r => r.finalised_at).sort().pop())));
  const idxE = mk.events.find(e => e.op === 'index' && e.rows.some(x => x.startsWith('wins:') && x.includes(U1.league.id)));
  const del = mk.events.find(e => e.op === 'delete' && e.paths.includes(old.wins));
  ok('...the old objects are deleted after the index names the new ones', !!idxE && !!del && del.seq > idxE.seq && !mk.bucket.has(old.wins) && !mk.bucket.has(old.fo) && mk.bucket.has(w.path));
  /* the same 120 + 64 games in a fresh project, built from nothing */
  const mf = mockDb([U1, U2]);
  mf.db.game_features.forEach(x => { if (late.includes(x.game_id)) x.finalised_at = at(0.3); });
  const full = await run(mf, { now: at(2), full: true });
  const same = scope => { const a = idxRow(mk, scope, U1.league.id), b = idxRow(mf, scope, U1.league.id); return a && b && a.path === b.path && mk.bucket.get(a.path).body === mf.bucket.get(b.path).body; };
  const clubsSame = mk.db.analytics_files.filter(r => r.scope === 'club' && r.league_key === U1.league.id).every(r => { const b = idxRow(mf, 'club', U1.league.id, r.team_key); return b && b.path === r.path && mf.bucket.get(b.path).body === mk.bucket.get(r.path).body; });
  const posSame = mk.db.analytics_files.filter(r => r.scope === 'pos' && r.league_key === U1.league.id).every(r => { const b = idxRow(mf, 'pos', U1.league.id, r.team_key); return b && mf.bucket.get(b.path).body === mk.bucket.get(r.path).body; });
  const body = t => { const s = JSON.parse(t); return JSON.stringify(Object.assign(s, { ctx: null })); };
  const stA = mk.bucket.get(idxRow(mk, 'store', U1.league.id).path).body, stB = mf.bucket.get(idxRow(mf, 'store', U1.league.id).path).body;
  ok('incremental = full, byte for byte: wins, fo, every club and pos file, and the store', !full.failed.length && same('wins') && same('fo') && clubsSame && posSame && body(stA) === body(stB) && stA === stB,
    [same('wins'), same('fo'), clubsSame, posSame, body(stA) === body(stB), stA === stB].join(','));
  const pa = idxRow(mk, 'wins', 'all'), pb = idxRow(mf, 'wins', 'all');
  ok('...and the pooled file too', pa.path === pb.path && mk.bucket.get(pa.path).body === mf.bucket.get(pb.path).body);
}

/* ------------------------------------------------------------------------------------------- re-finalised --- */
console.log('\na re-finalised game, a queued RECALCULATE, a deleted league, a file over budget');
{
  const gid = late[3];
  mk.db.game_features.filter(x => x.game_id === gid).forEach(x => { x.finalised_at = at(3); x.f = x.f.slice(); x.f[F.INDEX.pts] += 2; x.f[F.INDEX.c_pts] += 2; });
  const g = mk.db.games.find(x => x.id === gid); g.home_score += 2;
  mk.db.analytics_refresh.push({ league_id: U2.league.id, season_id: U2.season.id, due: true, status: 'queued' });
  mk.events.length = 0;
  const r = await run(mk, { now: at(5) });
  const st = M.decodeStore(JSON.parse(mk.bucket.get(idxRow(mk, 'store', U1.league.id).path).body));
  const gs = st.games.find(x => x.id === gid);
  ok('a re-finalised game replaces its line (same count, the new numbers, the watermark moves)', !r.failed.length && st.games.length === 120 && gs.hs === g.home_score &&
    gs.F[0][F.INDEX.pts] === mk.db.game_features.find(x => x.game_id === gid && x.team_idx === 0).f[F.INDEX.pts] && JSON.parse(mk.bucket.get(idxRow(mk, 'store', U1.league.id).path).body).wm.at === at(3));
  const u2 = r.built.filter(b => b.unit && b.unit.startsWith(U2.league.id) && b.scope === 'wins');
  ok('a unit RECALCULATE queued is rebuilt (its token unchanged) and its flag cleared', u2.length === 1 && mk.db.analytics_refresh[0].due === false && mk.events.some(e => e.op === 'patch'));
  /* a league deleted since its files were built */
  mk.db.analytics_files.push({ scope: 'wins', league_key: 'deadbeef-0000-4000-a000-000000000000', season_key: 's', team_key: '', path: 'wins/dead/s/v1-x.json', token: 'x', layout: 1, fv: 1 },
    { scope: 'club', league_key: 'deadbeef-0000-4000-a000-000000000000', season_key: 's', team_key: 't', path: 'club/dead/s/t/v1-x.json', token: 'x', layout: 1, fv: 1 });
  mk.bucket.set('wins/dead/s/v1-x.json', { body: '{}' }); mk.bucket.set('club/dead/s/t/v1-x.json', { body: '{}' });
  mk.events.length = 0;
  await run(mk, { now: at(5.5) });
  ok('a deleted league\'s objects and index rows are purged', !mk.bucket.has('wins/dead/s/v1-x.json') && !mk.bucket.has('club/dead/s/t/v1-x.json') &&
    !mk.db.analytics_files.some(x => x.league_key.startsWith('deadbeef')) && mk.events.some(e => e.op === 'unindex' && e.n === 2));
  /* a league's older season still marked current is retired when the current season is built */
  mk.db.analytics_files.push({ scope: 'wins', league_key: U1.league.id, season_key: 'old-season', team_key: '', path: 'wins/x/old/v1-y.json', token: 'y', layout: 1, fv: 1, is_current: true });
  mk.db.game_features.filter(x => x.game_id === late[4]).forEach(x => { x.finalised_at = at(5.6); });
  await run(mk, { now: at(7) });
  ok('one current season a league: building the current season retires an older season\'s rows', mk.db.analytics_files.find(x => x.season_key === 'old-season').is_current === false &&
    idxRow(mk, 'wins', U1.league.id).is_current === true);
  /* over budget: the unit fails, the old file stays, the lines are still kept */
  const before = idxRow(mk, 'wins', U1.league.id).path;
  const gid2 = late[5];
  mk.db.game_features.filter(x => x.game_id === gid2).forEach(x => { x.finalised_at = at(6); });
  mk.events.length = 0;
  const r3 = await run(mk, { now: at(8), budget: { wins: 2000 } });
  ok('a file more than 25% over its budget fails its unit; the old file and its index row stay', r3.failed.some(f => f.unit.startsWith(U1.league.id)) &&
    idxRow(mk, 'wins', U1.league.id).path === before && mk.bucket.has(before) && !mk.events.some(e => e.op === 'upload' && e.path.startsWith('wins/' + U1.league.id)),
    r3.failed.map(f => f.error.slice(0, 80)).join('; '));
  ok('...the store still takes the new line (read once)', JSON.parse(mk.bucket.get(idxRow(mk, 'store', U1.league.id).path).body).wm.at === at(6));
}

/* ------------------------------------------------------------------------------------------- a RECALCULATE's lease --- */
console.log('\na RECALCULATE\'s lease (PERF2-4)');
{
  const ml = mockDb([U2]);
  await run(ml, { now: at(0) });
  /* a refresh running for 2 minutes holds due = true: the hourly build leaves it to finish */
  ml.db.analytics_refresh.push({ league_id: U2.league.id, season_id: U2.season.id, due: true, status: 'running', started_at: at(1.9), finished_at: null });
  const r1 = await run(ml, { now: at(2) });
  ok('a live RECALCULATE lease (running, under 10 minutes old) is not built over by the scheduled run', !r1.built.some(b => b.scope === 'wins' && b.unit.startsWith(U2.league.id)) &&
     ml.db.analytics_refresh[0].due === true, JSON.stringify(r1.built.map(b => b.scope)));
  /* the isolate was killed (its finally never ran): eleven minutes on, the build takes the unit and clears the flag */
  ml.db.analytics_refresh[0].started_at = at(2 - 11 / 60);
  const r2 = await run(ml, { now: at(2) });
  ok('...a dead one (no finish after 10 minutes) is built by the scheduled run and its flag cleared', r2.built.some(b => b.scope === 'wins' && b.unit.startsWith(U2.league.id)) &&
     ml.db.analytics_refresh[0].due === false, JSON.stringify(r2.skipped));
}

/* ------------------------------------------------------------------------------------------- egress and time --- */
console.log('\negress and the run\'s time (PERF2-3, PERF2-5)');
{
  /* league two's previous season (the same league, an earlier season) */
  const L3 = M.synthUnit({ teams: 8, games: 64, seed: 18 }), U3 = unitRows(L3, 'synth-two');
  U3.league = U2.league;
  U3.season = Object.assign({}, U3.season, { league_id: U2.league.id, starts_on: '2025-09-01' });
  U3.features.forEach(r => { r.league_id = U2.league.id; });
  const me = mockDb([U3, U2]);
  me.db.leagues = [U2.league];
  await run(me, { now: at(0) });
  const prevStore = 'store/' + U2.league.id + '/' + U3.season.id + '/';
  /* the current season is built first, before its previous season has a store: the next build reads it */
  me.urls.length = 0;
  me.db.analytics_refresh.push({ league_id: U2.league.id, season_id: U2.season.id, due: true, status: 'queued' });
  await run(me, { now: at(2) });
  ok('a build reads its previous season\'s store once, and keeps its players by club with that store\'s token',
     me.urls.some(x => x.startsWith('GET /storage/v1/object/analytics/' + prevStore)) &&
     JSON.parse(me.bucket.get(me.db.analytics_files.find(x => x.scope === 'store' && x.season_key === U2.season.id).path).body).ctx.prevToken ===
     me.db.analytics_files.find(x => x.scope === 'store' && x.season_key === U3.season.id).token);
  me.urls.length = 0;
  me.db.analytics_refresh[0].due = true;
  const r2 = await run(me, { now: at(3) });
  ok('...the next build of it does not download the previous season\'s whole store again', r2.built.some(b => b.scope === 'wins' && b.unit.startsWith(U2.league.id + ':' + U2.season.id)) &&
     !me.urls.some(x => x.startsWith('GET /storage/v1/object/analytics/' + prevStore)), me.urls.filter(x => x.includes(prevStore)).join(' | '));
  /* the weekly full run leaves the past season alone (its token and layout stand) */
  me.urls.length = 0;
  const rf = await run(me, { now: at(4), full: true });
  ok('--full rebuilds the current season and the pooled file but not a past season whose token stands (--full-past does)',
     rf.built.some(b => b.scope === 'wins' && b.unit.startsWith(U2.league.id + ':' + U2.season.id)) && !rf.built.some(b => b.unit && b.unit.startsWith(U2.league.id + ':' + U3.season.id)) &&
     rf.built.some(b => b.unit === 'all:current'), JSON.stringify(rf.built.filter(b => b.scope === 'wins').map(b => b.unit)));
  /* a run past its wall clock stops between units; the units stay due */
  me.db.analytics_refresh[0].due = true;
  const rt = await run(me, { now: at(5), budgetMin: 0 });
  ok('a run past its budget (budgetMin) builds nothing more and leaves the due units for the next run', rt.built.length === 0 && rt.skipped.some(x => x.why === 'time'), JSON.stringify(rt.skipped));
  const rb = await run(me, { now: at(6), bigGames: 10, maxBig: 0 });
  ok('...and big units over maxBig wait an hour before their stores are read', rb.built.length === 0 && rb.skipped.some(x => x.why === 'big units a run'), JSON.stringify(rb.skipped));
}

/* ------------------------------------------------------------------------------------------- the public log --- */
console.log('\nthe public Actions log and job summary (SEC2-1)');
{
  /* league two is members-only; a wins budget of 2,000 bytes fails both units */
  const mp = mockDb([U1, U2], { closed: new Set([U2.league.id]) }), logs = [];
  const r = await run(mp, { now: at(0), log: m => logs.push(String(m)), budget: { wins: 2000 } });
  const tag2 = B.opaque(U2.league.id + ':' + U2.season.id);
  const text = logs.join('\n') + '\n' + r.summary;
  ok('a members-only league is never named in the log or the summary (an opaque hash instead); an open one is',
     !text.includes('synth-two') && !text.includes(U2.league.id) && !text.includes(U2.season.id) && text.includes('synth-one') && text.includes(tag2),
     logs.filter(l => l.includes('synth-two')).join(' | '));
  const f2 = text.split('\n').filter(l => l.includes(tag2) && /FAILED/.test(l));
  ok('...its failure is printed with no error text at all (an open league\'s keeps a clipped message)', r.failed.some(f => f.unit.startsWith(U2.league.id)) && f2.length >= 1 &&
     f2.every(l => / failed$/.test(l)) && !/withheld/.test(text), f2.join(' | '));
  const rep = mp.bucket.get('reports/last.json');
  ok('...the whole report goes to the private bucket (reports/last.json) for the operator', !!rep && rep.body.includes('synth-two') && /budget/.test(rep.body));
  const sm = B.summary({ built: [], current: 0, failed: [{ unit: 'L:S', label: B.opaque('L:S'), error: 'club t1: withheld player 1234abcd-0000-4000-a000-000000000000', pub: 'club: 1 problems' }],
    accept: { 'L:S': { slug: 'secret-league', label: B.opaque('L:S'), open: false, n: 80, check4: { r2: 0.9 } } }, warnings: [] }, { units: 1, due: 1 });
  ok('summary(): a withheld player\'s id and a closed league\'s slug never reach it', !sm.includes('withheld') && !sm.includes('1234abcd') && !sm.includes('secret-league') && sm.includes('1 members-only or private unit built'));
}

/* ------------------------------------------------------------------------------------------- the cache --- */
console.log('\nthe store\'s local cache (--cache-dir; .cache/ is git-ignored)');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-cache-'));
  const mc = mockDb([U2]);
  await run(mc, { now: at(0), cacheDir: dir });
  const sp = idxRow(mc, 'store', U2.league.id).path;
  ok('a run mirrors the store it uploads into the cache', fs.existsSync(path.join(dir, sp)) && fs.readFileSync(path.join(dir, sp), 'utf8') === mc.bucket.get(sp).body);
  mc.urls.length = 0;
  await run(mc, { now: at(30), cacheDir: dir });
  ok('...and the next run reads it from there, not from the bucket, when it holds the token the index names', !mc.urls.some(x => x.startsWith('GET /storage/v1/object/analytics/store/')) &&
    mc.urls.some(x => x.startsWith('HEAD /rest/v1/game_features')));
  fs.writeFileSync(path.join(dir, sp), JSON.stringify(Object.assign(JSON.parse(mc.bucket.get(sp).body), { n: 1, wm: { at: '2000-01-01T00:00:00Z', id: '0' } })));
  mc.urls.length = 0;
  await run(mc, { now: at(60), cacheDir: dir });
  ok('...an older cache is passed over for the bucket\'s copy (the later watermark wins)', mc.urls.some(x => x.startsWith('GET /storage/v1/object/analytics/store/')) &&
    JSON.parse(mc.bucket.get(sp).body).n === 64);
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------------------------------- fixtures --- */
console.log('\n--fixtures');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-fix-'));
  const r = await B.run({ fixtures: dir, log: () => {}, B: 40 });
  const names = ['wins.sample.json', 'wins-all.sample.json', 'fo.sample.json', 'club.sample.json', 'teaser.sample.json'];
  const files = names.map(n => (fs.existsSync(path.join(dir, n)) ? JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) : null));
  ok('--fixtures writes the five §9 sample files', files.every(Boolean) && r.built.length === 5, names.filter((n, i) => !files[i]).join(', '));
  ok('...each valid for its scope (the pooled one without blocks, the teaser public keys only)', M.validate(files[0], 'wins').length === 0 && M.validate(files[1], 'wins').length === 0 &&
    files[1].blocks === null && M.validate(files[2], 'fo').length === 0 && M.validate(files[3], 'club').length === 0 && M.validate(files[4], 'teaser').length === 0);
  const committed = path.join(ROOT, 'supabase', 'tests', 'fixtures', 'ww');
  if (fs.existsSync(path.join(committed, 'wins.sample.json'))) {
    const B2 = await B.run({ fixtures: fs.mkdtempSync(path.join(os.tmpdir(), 'ww-fix-')), log: () => {} });
    const same = names.every(n => JSON.stringify(B2.files[n]) === JSON.stringify(JSON.parse(fs.readFileSync(path.join(committed, n), 'utf8'))));
    ok('...and the committed samples are what --fixtures writes today', same);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

/* ------------------------------------------------------------------------------------------- workflow --- */
console.log('\n.github/workflows/analytics.yml (§6.7)');
{
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'analytics.yml'), 'utf8');
  ok('hourly at :40 and a full rebuild on Sunday 03:40 UTC; dispatch inputs unit, full, dry_run', y.includes('cron: "40 * * * *"') && y.includes('cron: "40 3 * * 0"') &&
    /unit:\n/.test(y) && /full:\n/.test(y) && /dry_run:\n/.test(y) && y.includes("github.event.schedule == '40 3 * * 0'"));
  ok('...concurrency analytics, the RUNS_ON pattern, 50 minutes, sparse epinoia + tools, node 24', /group: analytics\b/.test(y) && y.includes('vars.RUNS_ON && fromJSON(vars.RUNS_ON)') &&
    y.includes('timeout-minutes: 50') && /sparse-checkout: \|\n\s+epinoia\n\s+tools/.test(y) && y.includes("node-version: '24'"));
  ok('...NO actions/cache (the private stores stay in the private bucket, never a public repository\'s cache); the two secrets and two variables',
    !/actions\/cache/.test(y.replace(/^\s*#.*$/gm, '')) && !/\.cache\/analytics/.test(y.replace(/^\s*#.*$/gm, '')) && y.includes('secrets.SUPABASE_URL') &&
    y.includes('secrets.SUPABASE_SERVICE_KEY') && y.includes('vars.ANALYTICS_MIN_GAP_H') && y.includes('vars.ANALYTICS_POOL_GAP_H') && y.includes('node tools/build-analytics.mjs'));
  const a = B.parseArgs(['--dry-run', '--unit', 'a:b', '--full', '--min-gap-hours', '6', '--pool-gap-hours', '12', '--fixtures', 'x']);
  ok('the flags: --dry-run, --unit, --full, --min-gap-hours, --pool-gap-hours, --fixtures (and --local --out)', a.dryRun && a.unit === 'a:b' && a.full && a.minGapHours === 6 &&
    a.poolGapHours === 12 && a.fixtures === 'x' && B.parseArgs(['--local', '--out', 'd']).local);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
process.exit(fail ? 1 : 0);
