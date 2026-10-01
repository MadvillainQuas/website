/* ============================================================================
   WHAT WINS: THE MODEL BUILDER (docs/what-wins-model.md §6, A.1, A.2). I/O only; every number is worked out by
   epinoia/winmodel.js, the file the Edge Function's RECALCULATE also runs.

     SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node tools/build-analytics.mjs
     … --dry-run                     read and build, write nothing, say what would be written
     … --unit <league>:<season>      one unit (ids)
     … --full                        every store rebuilt from nothing, every unit and the pooled file built
     … --min-gap-hours 1 --pool-gap-hours 6
     node tools/build-analytics.mjs --fixtures supabase/tests/fixtures/ww         the §9 sample files, offline
     node tools/build-analytics.mjs --local --out <dir> [--leagues cebl,orlen-basket-liga] [--pool-leagues a,b,…]
                                     REAL data, read-only: the public tables with the publishable key, feature lines
                                     worked out here with epinoia/features.js, files written to <dir> with a summary

   Run hourly (and a full rebuild on Sunday 03:40 UTC) by .github/workflows/analytics.yml.

   ONE RUN (§6.4): prune the issue log; discover leagues, seasons, the open set, the index and every unit's token;
   refresh the private stores of the units that are due (keyset after each store's watermark: only lines it has not
   seen, never stats->sit, never a whole stats blob); the pooled file and the priors when due; each due unit's wins,
   fo, club and pos files; the public teaser when the pooled file or the open set changed; purge the objects of
   deleted leagues; a job summary with §16's live acceptance numbers.

   SAFE ORDER. A file is uploaded under a new name (its token), then the index row is pointed at it, then the old
   object is deleted: a reader never meets a row naming a missing file. A file over its budget by more than 25%
   fails its unit and the old file stays.

   THE STORE (§6.2) lives in the private bucket (store/<league>/<season>/s1-fv1.json) and in .cache/analytics/ for
   actions/cache; whichever has the later watermark wins. A full run starts every store from nothing.
   ============================================================================ */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHABLE = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';   // epinoia/config.js publishes it
const BUCKET = 'analytics', PUBLIC_BUCKET = 'snapshots';
const DAY = 86400000, HOUR = 3600000;
const BIG_GAMES = 800;
/* §6.3's reads: the named stats keys out of the blob, never the blob */
export const PGS_SELECT = 'game_id,team_idx,player_uuid,player_id,min:stats->min,pts:stats->pts,p2a:stats->p2a,p2m:stats->p2m,p3a:stats->p3a,' +
  'p3m:stats->p3m,fta:stats->fta,ftm:stats->ftm,or:stats->or,dr:stats->dr,ast:stats->ast,stl:stats->stl,blk:stats->blk,to:stats->to,pf:stats->pf';
export const STINT_SELECT = 'game_id,team_idx,player_ids,dur:stats->dur,pf:stats->pf,pa:stats->pa,off:stats->off,def:stats->def';
export const GAME_SELECT = 'id,status,competition_id,home_team_id,away_team_id,home_score,away_score,tipoff_at,venue_id,starters';
export const FEATURE_SELECT = 'game_id,team_idx,f,q,st,finalised_at';

/* the page's own modules, as a browser loads them: globals first, then the files */
export function load(url, key) {
  globalThis.window = globalThis;
  globalThis.EPINOIA_CONFIG = { supabaseUrl: url || '', supabaseAnonKey: key || PUBLISHABLE };
  globalThis.EpinoiaAccess = globalThis.EpinoiaAccess || { authHeaders: () => (key ? { Authorization: 'Bearer ' + key } : {}) };
  const g = (name, file) => { globalThis[name] = require(path.join(ROOT, 'epinoia', file)); return globalThis[name]; };
  g('EpinoiaBPM', 'bpm.js'); g('EpinoiaSeason', 'season.js');
  try { g('EpinoiaData', 'data.js'); } catch (_) { /* data.js is read for nothing here; the builder's reads are its own */ }
  g('EpinoiaSOS', 'sos.js'); g('EpinoiaWinning', 'winning.js'); g('EpinoiaDepth', path.join('t', 'depth.js'));
  g('EpinoiaFeatures', 'features.js'); g('EpinoiaWinStats', 'winstats.js'); g('EpinoiaWinSim', 'winsim.js');
  return g('EpinoiaWinModel', 'winmodel.js');
}

/* --------------------------------------------------------------------------------------------- helpers --- */
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const q = v => '"' + String(v).replace(/"/g, '\\"') + '"';
export const fileName = (v, token) => 'v' + v + '-' + String(token).replace(/[^A-Za-z0-9]+/g, '-') + '.json';
const sameLayout = (p, v) => new RegExp('(^|/)v' + v + '-').test(String(p || '').split('/').pop());
const stripBucket = p => String(p || '').replace(/^analytics\//, '');

/* PostgREST and Storage with a key: {rest, restAll, count, storage, upload, download, remove, list} */
function client(url, key, f, opts) {
  const base = String(url).replace(/\/+$/, '');
  const hdr = { apikey: key, Authorization: 'Bearer ' + key };
  const reads = opts && opts.reads;
  const rest = async (p, init) => {
    if (reads) reads.push(p);
    const r = await f(base + '/rest/v1/' + p, Object.assign({}, init, { headers: Object.assign({ Accept: 'application/json' }, hdr, (init || {}).headers || {}) }));
    if (!r.ok) throw new Error(p.split('?')[0] + ': ' + r.status + ' ' + String(await r.text()).slice(0, 200));
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  /* every page of a read (offset paging, 1000 a page) */
  const restAll = async (p, page) => {
    const n = page || 1000, out = [];
    for (let off = 0; ; off += n) {
      const rows = await rest(p + (p.includes('?') ? '&' : '?') + 'limit=' + n + '&offset=' + off);
      out.push(...(rows || []));
      if (!rows || rows.length < n) return out;
    }
  };
  const count = async p => {
    if (reads) reads.push('HEAD ' + p);
    const r = await f(base + '/rest/v1/' + p, { method: 'HEAD', headers: Object.assign({ Prefer: 'count=exact', Range: '0-0' }, hdr) });
    if (!r.ok && r.status !== 206) throw new Error('count ' + p.split('?')[0] + ': ' + r.status);
    const cr = (r.headers.get && r.headers.get('content-range')) || '';
    const n = parseInt(String(cr).split('/')[1], 10);
    return isFinite(n) ? n : 0;
  };
  const storage = async (p, init) => {
    const r = await f(base + '/storage/v1/' + p, Object.assign({}, init, { headers: Object.assign({}, hdr, (init || {}).headers || {}) }));
    if (!r.ok) throw new Error('storage ' + p.split('?')[0] + ': ' + r.status + ' ' + String(await r.text()).slice(0, 200));
    const t = await r.text();
    try { return t ? JSON.parse(t) : null; } catch (_) { return t; }
  };
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  const upload = (bucket, p, body, o) => storage('object/' + bucket + '/' + enc(p), { method: 'POST', body,
    headers: { 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=' + ((o && o.maxAge) || 31536000) } });
  const download = async (bucket, p) => {
    const r = await f(base + '/storage/v1/object/' + bucket + '/' + enc(p), { headers: hdr });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error('download ' + p + ': ' + r.status);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  const remove = (bucket, paths) => (paths.length ? storage('object/' + bucket, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) }) : null);
  const list = (bucket, prefix) => storage('object/list/' + bucket, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix, limit: 1000 }) });
  return { rest, restAll, count, storage, upload, download, remove, list };
}

/* --------------------------------------------------------------------------------------------- reads (§6.3) --- */
/* the lines after a watermark, keyset on (finalised_at, game_id, team_idx), 1000 a page */
export async function readFeatures(api, league, season, fv, wm) {
  const out = [];
  let at = wm.at, id = wm.id, ti = null;
  for (;;) {
    const after = ti == null
      ? `(finalised_at.gt.${q(at)},and(finalised_at.eq.${q(at)},game_id.gt.${id}))`
      : `(finalised_at.gt.${q(at)},and(finalised_at.eq.${q(at)},game_id.gt.${id}),and(finalised_at.eq.${q(at)},game_id.eq.${id},team_idx.gt.${ti}))`;
    const rows = await api.rest(`game_features?league_id=eq.${league}&season_id=eq.${season}&fv=eq.${fv}&select=${FEATURE_SELECT}` +
      `&or=${encodeURIComponent(after)}&order=finalised_at,game_id,team_idx&limit=1000`);
    out.push(...(rows || []));
    if (!rows || rows.length < 1000) return out;
    const last = rows[rows.length - 1];
    at = last.finalised_at; id = last.game_id; ti = last.team_idx;
  }
}
/* their games (150 a request), player lines and stints (40 games a request) */
export async function readDelta(api, rows) {
  const ids = Array.from(new Set(rows.map(r => r.game_id))).sort();
  const games = [], pgs = [], stints = [];
  for (const c of chunks(ids, 150)) games.push(...((await api.rest(`games?id=in.(${c.join(',')})&select=${GAME_SELECT}`)) || []).filter(g => g.status === 'final'));
  for (const c of chunks(ids, 40)) {
    pgs.push(...await api.restAll(`player_game_stats?game_id=in.(${c.join(',')})&select=${PGS_SELECT}&order=game_id,team_idx,player_id`));
    stints.push(...await api.restAll(`lineup_stints?game_id=in.(${c.join(',')})&select=${STINT_SELECT}&order=game_id,team_idx,id`));
  }
  return { rows, games, pgs, stints };
}
/* the context a unit's files need (clubs, rosters, heights and ages, the withheld, venues, fixtures to come) */
async function readContext(api, M, unit, store, o) {
  const D = M.decodeStore(store);
  const teamIds = Array.from(new Set(D.games.flatMap(g => [g.h, g.a]))).filter(Boolean).sort();
  const teams = [];
  for (const c of chunks(teamIds, 150)) teams.push(...((await api.rest(`teams?id=in.(${c.join(',')})&select=id,name,short_name,colour,logo_path,home_venue_id`)) || []));
  const rosters = [];
  for (const c of chunks(teamIds, 60)) {
    const rs = await api.restAll(`roster_entries?team_id=in.(${c.join(',')})&active=eq.true&select=team_id,position,players(id,height_cm)&order=team_id`);
    rs.forEach(r => rosters.push({ team_id: r.team_id, player_id: r.players && r.players.id, position: r.position || null, height_cm: r.players && r.players.height_cm }));
  }
  const pids = D.players.slice();
  const bios = {};
  for (const c of chunks(pids, 500)) {
    const rs = await api.rest('rpc/player_bio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_ids: c }) });
    (rs || []).forEach(r => { bios[r.player_id] = { age: r.age, birth_year: r.birth_year, height_cm: r.height_cm }; });
  }
  const withheld = [];
  if (o.anon) {
    /* signed out, a withheld player's row is not there to read: whoever does not come back is withheld */
    const seen = new Set();
    for (const c of chunks(pids, 150)) ((await api.rest(`players?id=in.(${c.join(',')})&select=id`)) || []).forEach(r => seen.add(r.id));
    pids.forEach(id => { if (!seen.has(id)) withheld.push(id); });
  } else {
    for (const c of chunks(pids, 150)) ((await api.rest(`players?id=in.(${c.join(',')})&select=id,is_minor,public_consent`)) || []).forEach(r => { if (r.is_minor && !r.public_consent) withheld.push(r.id); });
  }
  const vids = Array.from(new Set(D.games.map(g => g.v).concat(teams.map(t => t.home_venue_id)).filter(Boolean))).sort();
  const venues = {};
  for (const c of chunks(vids, 150)) ((await api.rest(`venues?id=in.(${c.join(',')})&select=id,lat,lng`)) || []).forEach(v => { if (v.lat != null && v.lng != null) venues[v.id] = [v.lat, v.lng]; });
  const comps = unit.comps || [];
  const scheduled = comps.length ? ((await api.rest(`games?competition_id=in.(${comps.join(',')})&status=in.(scheduled,live)&select=id,home_team_id,away_team_id,tipoff_at&order=tipoff_at&limit=1000`)) || [])
    .map(g => ({ id: g.id, h: g.home_team_id, a: g.away_team_id, t: g.tipoff_at })) : [];
  return { league: unit.leagueRow ? { id: unit.leagueRow.id, slug: unit.leagueRow.slug, name: unit.leagueRow.name } : { id: unit.league },
    season: unit.seasonRow ? { id: unit.seasonRow.id, name: unit.seasonRow.name } : { id: unit.season },
    current: !!unit.current, open: !!unit.open, teams, rosters, bios, withheld: withheld.sort(), venues, homeVenues: {}, scheduled,
    prev: o.prev || null, priors: o.priors || null, kinds: unit.kinds || {} };
}

/* --------------------------------------------------------------------------------------------- the store --- */
const storePath = (league, season, M) => `store/${league}/${season}/s${M.STORE_V}-fv${(globalThis.EpinoiaFeatures || {}).FV || 1}.json`;
const later = (a, b) => (!a ? b : !b ? a : (b.wm && a.wm && (b.wm.at > a.wm.at || (b.wm.at === a.wm.at && b.wm.id > a.wm.id))) ? b : a);
function cacheRead(dir, p) { try { return JSON.parse(fs.readFileSync(path.join(dir, p), 'utf8')); } catch (_) { return null; } }
function cacheWrite(dir, p, obj) { const f = path.join(dir, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj)); }

/* =============================================================================================== run === */
/* opts: {url, serviceKey, fetch, dryRun, unit, full, minGapHours, poolGapHours, fixtures, log, now, cacheDir, B, simOpts}
   -> {built: [{scope, unit, bytes, games}], current, skipped, failed: [{unit, error}], summary, accept, writes, reads} */
export async function run(opts) {
  const o = opts || {};
  const log = o.log || (m => console.log(m));
  if (o.fixtures) return fixtures(o.fixtures, o);
  const url = String(o.url || '').replace(/\/+$/, '');
  if (!url || !o.serviceKey) { log('no SUPABASE_URL / SUPABASE_SERVICE_KEY: nothing to do'); return { built: [], current: 0, skipped: 'no keys', failed: [], summary: '' }; }
  const f = o.fetch || globalThis.fetch;
  const nowMs = typeof o.now === 'function' ? o.now() : o.now ? Date.parse(o.now) : Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const M = load(url, o.serviceKey);
  const F = globalThis.EpinoiaFeatures, FV = F.FV;
  const reads = [], writes = [];
  const api = client(url, o.serviceKey, f, { reads });
  const minGap = (o.minGapHours != null ? +o.minGapHours : 1) * HOUR, poolGap = (o.poolGapHours != null ? +o.poolGapHours : 6) * HOUR;
  const cacheDir = o.cacheDir === false ? null : (o.cacheDir || path.join(ROOT, '.cache', 'analytics'));
  const out = { built: [], current: 0, skipped: [], failed: [], summary: '', accept: {}, writes, reads, warnings: [] };
  const write = async (what, fn) => { writes.push(what); if (o.dryRun) return null; return fn(); };

  /* 0. the issue log keeps 30 days */
  await write('rpc analytics_issue_prune', () => api.rest('rpc/analytics_issue_prune', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));

  /* 1. discover */
  const leagues = (await api.rest('leagues?select=id,slug,name&order=slug')) || [];
  const leagueBy = new Map(leagues.map(l => [l.id, l]));
  const seasons = (await api.rest('seasons?select=id,league_id,name,starts_on&order=starts_on.desc')) || [];
  const comps = (await api.restAll('competitions?select=id,season_id,kind&order=id')) || [];
  const openRaw = (await api.rest('rpc/analytics_open_leagues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })) || [];
  const open = new Set(openRaw.map(x => (typeof x === 'string' ? x : x && (x.analytics_open_leagues || x.id))).filter(Boolean));
  const index = (await api.rest('analytics_files?select=scope,league_key,season_key,team_key,league_id,season_id,team_id,is_current,path,token,layout,fv,bytes,n_games,built_at,ci_at')) || [];
  const idx = new Map(index.map(r => [r.scope + '|' + r.league_key + '|' + r.season_key + '|' + (r.team_key || ''), r]));
  let dueFlags = [];
  try { dueFlags = (await api.rest('analytics_refresh?due=eq.true&select=league_id,season_id')) || []; } catch (_) { dueFlags = []; }
  const flagged = new Set(dueFlags.map(r => r.league_id + '|' + r.season_id));
  const units = [];
  for (const s of seasons) {
    if (!leagueBy.has(s.league_id)) continue;
    const key = s.league_id + ':' + s.id;
    if (o.unit && o.unit !== key) continue;
    const scope = `league_id=eq.${s.league_id}&season_id=eq.${s.id}&fv=eq.${FV}&team_idx=eq.0`;
    const n = await api.count(`game_features?${scope}&select=game_id`);
    if (!n) continue;
    const top = (await api.rest(`game_features?${scope}&select=finalised_at,game_id&order=finalised_at.desc,game_id.desc&limit=1`)) || [];
    const kinds = {};
    comps.filter(c => c.season_id === s.id).forEach(c => { kinds[c.id] = c.kind; });
    units.push({ key, league: s.league_id, season: s.id, n, token: n + '@' + (top[0] ? top[0].finalised_at : ''), starts: s.starts_on || '',
      leagueRow: leagueBy.get(s.league_id), seasonRow: s, open: open.has(s.league_id), comps: Object.keys(kinds).sort(), kinds, flagged: flagged.has(s.league_id + '|' + s.id) });
  }
  /* each league's newest season with lines is its current one (the pooled unit's) */
  const newest = new Map();
  units.forEach(u => { const c = newest.get(u.league); if (!c || u.starts > c.starts || (u.starts === c.starts && u.season > c.season)) newest.set(u.league, u); });
  units.forEach(u => { u.current = newest.get(u.league) === u; });
  /* due (§6.1) */
  const due = [];
  units.forEach(u => {
    const w = idx.get('wins|' + u.league + '|' + u.season + '|'), st = idx.get('store|' + u.league + '|' + u.season + '|');
    const age = w && w.built_at ? nowMs - Date.parse(w.built_at) : Infinity;
    const layoutChanged = !!w && (!sameLayout(w.path, M.FILE_V) || +w.fv !== FV);
    let why = null;
    if (o.full) why = 'full';
    else if (u.flagged) why = 'refresh queued';
    else if (!w && u.n >= M.MIN.own) why = 'new';
    else if (layoutChanged) why = 'layout';
    else if (w && w.token !== u.token) why = 'token';
    else if (u.current && age > DAY) why = 'a day old';
    else if (!u.current && age > 30 * DAY) why = 'a month old';
    else if (!st || st.token !== u.token) why = 'store';
    const floor = u.n > BIG_GAMES ? Math.max(minGap, 6 * HOUR) : minGap;
    if (why && !['full', 'refresh queued', 'layout', 'new'].includes(why) && w && age < floor && why !== 'store') { out.skipped.push({ unit: u.key, why: 'floor' }); why = null; }
    if (why) { u.why = why; due.push(u); } else out.current++;
  });
  due.sort((a, b) => (b.flagged - a.flagged) || (b.current - a.current) || a.key.localeCompare(b.key));
  /* the pooled file: due when a current unit is rebuilt and it is older than the pool gap, on a layout change, after a day */
  const poolRow = idx.get('wins|all|current|');
  const poolAge = poolRow && poolRow.built_at ? nowMs - Date.parse(poolRow.built_at) : Infinity;
  const openHash = M.poolToken([], open).split('@o')[1];
  const poolDue = !!o.full || !poolRow || !sameLayout(poolRow.path, M.FILE_V) || poolAge > DAY ||
    (due.some(u => u.current) && poolAge > poolGap) || String(poolRow.token || '').split('@o')[1] !== openHash;

  /* 2. the stores: of every due unit, and (for the pooled file) of every current unit */
  const stores = new Map();
  const need = new Set(due.map(u => u.key));
  if (poolDue && !o.unit) units.filter(u => u.current).forEach(u => need.add(u.key));
  const deltas = new Map();
  for (const u of units.filter(x => need.has(x.key))) {
    try {
      const sp = storePath(u.league, u.season, M);
      let st = null;
      if (!o.full) {
        const fromCache = cacheDir ? cacheRead(cacheDir, sp) : null;
        let fromBucket = null;
        try { fromBucket = await api.download(BUCKET, sp); } catch (_) { fromBucket = null; }
        st = later(fromCache, fromBucket);
        if (st && (st.v !== M.STORE_V || +st.fv !== FV)) st = null;
      }
      if (!st) st = M.emptyStore(u.league, u.season);
      const rows = await readFeatures(api, u.league, u.season, FV, st.wm);
      const delta = rows.length ? await readDelta(api, rows) : { rows: [], games: [], pgs: [], stints: [] };
      const next = rows.length ? M.storeAdd(st, delta.rows, delta.games, delta.pgs, delta.stints, { kinds: u.kinds }) : st;
      next.ctx = st.ctx || null; next.carry = st.carry || null; next.ci_at = st.ci_at || null;
      stores.set(u.key, next);
      deltas.set(u.key, delta);
    } catch (e) {
      out.failed.push({ unit: u.key, error: 'store: ' + String(e && e.message || e) });
    }
  }

  /* 3. the pooled file and the priors */
  let priors = null, poolBuilt = false;
  const priorsRow = idx.get('priors|all|current|');
  if (poolDue && !o.unit) {
    const cur = units.filter(u => u.current && stores.has(u.key));
    const inputs = [];
    for (const u of cur) {
      const st = stores.get(u.key);
      if (!st.ctx || deltas.get(u.key).rows.length || o.full) st.ctx = await readContext(api, M, u, st, { priors: st.ctx && st.ctx.priors });
      inputs.push(Object.assign(M.inputFromStore(st), { league: st.ctx.league, token: u.token }));
    }
    if (inputs.length) {
      try {
        const token = M.poolToken(inputs.map(i => i.token), open);
        const r = M.buildPool(inputs, open, { now: nowIso, token, B: o.B || 400 });
        r.warnings.forEach(w => out.warnings.push('pooled: ' + w));
        if (r.wins) {
          const probs = M.validate(r.wins, 'wins', { open, openTeams: new Set(inputs.filter(i => open.has(i.league.id)).flatMap(i => (i.store.ctx.teams || []).map(t => t.id))) });
          if (probs.length) throw new Error('the pooled file is not valid: ' + probs.slice(0, 3).join('; '));
          const wp = 'wins/all/current/' + fileName(M.FILE_V, token), text = JSON.stringify(r.wins);
          await write('upload ' + wp, () => api.upload(BUCKET, wp, text));
          await write('upload priors/v1.json', () => api.upload(BUCKET, 'priors/v1.json', JSON.stringify(r.priors), { maxAge: 60 }));
          await write('index wins all', () => upsertIndex(api, [
            { scope: 'wins', league_key: 'all', season_key: 'current', team_key: '', league_id: null, season_id: null, team_id: null, is_current: true, path: wp, token, layout: M.FILE_V, fv: FV, bytes: text.length, n_games: r.wins.n.games, built_at: nowIso, ci_at: nowIso },
            { scope: 'priors', league_key: 'all', season_key: 'current', team_key: '', league_id: null, season_id: null, team_id: null, is_current: true, path: 'priors/v1.json', token, layout: 1, fv: FV, bytes: JSON.stringify(r.priors).length, n_games: r.wins.n.games, built_at: nowIso, ci_at: nowIso }]));
          if (poolRow && stripBucket(poolRow.path) !== wp) await write('delete ' + poolRow.path, () => api.remove(BUCKET, [stripBucket(poolRow.path)]));
          out.built.push({ scope: 'wins', unit: 'all:current', bytes: text.length, games: r.wins.n.games });
          out.accept['all:current'] = r.accept;
          priors = r.priors; poolBuilt = true;
          /* 5. the teaser: box-score aggregates of the open leagues only */
          const teaser = M.buildTeaser(inputs, open, { token, now: nowIso });
          const tp = M.validate(teaser, 'teaser');
          if (!tp.length) {
            const tf = 'whatwins/' + fileName(M.FILE_V, token);
            await write('upload snapshots/' + tf, () => api.upload(PUBLIC_BUCKET, tf, JSON.stringify(teaser)));
            await write('upload snapshots/whatwins/index.json', () => api.upload(PUBLIC_BUCKET, 'whatwins/index.json', JSON.stringify({ file: tf, token, built: nowIso }), { maxAge: 600 }));
            const old = await write('list snapshots/whatwins', () => api.list(PUBLIC_BUCKET, 'whatwins'));
            const stale = (Array.isArray(old) ? old : []).map(x => x && x.name).filter(n => n && n !== 'index.json' && 'whatwins/' + n !== tf).map(n => 'whatwins/' + n);
            if (stale.length) await write('delete old teasers', () => api.remove(PUBLIC_BUCKET, stale));
            out.built.push({ scope: 'teaser', unit: 'all:current', bytes: JSON.stringify(teaser).length, games: teaser.n });
          } else out.warnings.push('teaser not written: ' + tp.join('; '));
        }
      } catch (e) { out.failed.push({ unit: 'all:current', error: String(e && e.message || e) }); }
    }
  }
  if (!priors && priorsRow) { try { priors = await api.download(BUCKET, stripBucket(priorsRow.path)); } catch (_) { priors = null; } }

  /* 4. each due unit */
  for (const u of due) {
    const st = stores.get(u.key);
    if (!st) continue;
    const sp = storePath(u.league, u.season, M);
    try {
      const delta = deltas.get(u.key);
      const prevSeason = seasons.filter(s => s.league_id === u.league && (s.starts_on || '') < u.starts).sort((a, b) => (b.starts_on || '').localeCompare(a.starts_on || ''))[0];
      let prev = null;
      if (prevSeason) {
        let ps = cacheDir ? cacheRead(cacheDir, storePath(u.league, prevSeason.id, M)) : null;
        if (!ps) { try { ps = await api.download(BUCKET, storePath(u.league, prevSeason.id, M)); } catch (_) { ps = null; } }
        if (ps) { const D = M.decodeStore(ps), by = {}; D.pgs.forEach(r => { const g = D.games[r.g]; if (!g || !(r.min > 0)) return; const t = r.side ? g.a : g.h; (by[t] = by[t] || new Set()).add(D.players[r.p]); }); prev = {}; Object.keys(by).forEach(t => { prev[t] = Array.from(by[t]).sort(); }); }
      }
      st.ctx = await readContext(api, M, u, st, { priors, prev });
      if (st.n < M.MIN.own) {
        await write('upload ' + sp, async () => { await api.upload(BUCKET, sp, JSON.stringify(st), { maxAge: 60 }); if (cacheDir) cacheWrite(cacheDir, sp, st); });
        await write('index store ' + u.key, () => upsertIndex(api, [storeRow(u, sp, st, M, FV, nowIso, st.ci_at)]));
        out.skipped.push({ unit: u.key, why: 'fewer than ' + M.MIN.own + ' games' });
        continue;
      }
      const t0 = Date.now();
      const r = M.buildUnit(M.inputFromStore(st), { token: u.token, now: nowIso, B: o.B || 400, priors, simOpts: o.simOpts });
      r.warnings.forEach(w => out.warnings.push(u.leagueRow.slug + ': ' + w));
      const withheld = new Set(st.ctx.withheld || []);
      const files = [];
      if (r.wins) files.push({ scope: 'wins', team: '', file: r.wins });
      if (r.fo) files.push({ scope: 'fo', team: '', file: r.fo });
      if (!r.wins) throw new Error('no wins file (' + r.warnings.join('; ') + ')');
      const changed = new Set();
      const full = o.full || u.why === 'layout' || u.why === 'new';
      (delta.games || []).forEach(g => { changed.add(g.home_team_id); changed.add(g.away_team_id); });
      r.clubs.forEach((c, tid) => { if (full || changed.has(tid) || !idx.get('club|' + u.league + '|' + u.season + '|' + tid)) files.push({ scope: 'club', team: tid, file: c }); });
      r.pos.forEach((p, tid) => { if (full || changed.has(tid) || !idx.get('pos|' + u.league + '|' + u.season + '|' + tid)) files.push({ scope: 'pos', team: tid, file: p }); });
      const rows = [], stale = [];
      for (const x of files) {
        const D = M.decodeStore(st);
        const clubGames = x.scope === 'club' ? new Set(D.games.filter(g => g.h === x.team || g.a === x.team).map(g => g.id)) : null;
        const probs = M.validate(x.file, x.scope, { games: clubGames, withheld });
        if (probs.length) { out.failed.push({ unit: u.key, error: x.scope + (x.team ? ' ' + x.team : '') + ': ' + probs.slice(0, 3).join('; ') }); continue; }
        const p = x.scope + '/' + u.league + '/' + u.season + '/' + (x.team ? x.team + '/' : '') + fileName(M.FILE_V, u.token), text = JSON.stringify(x.file);
        await write('upload ' + p, () => api.upload(BUCKET, p, text));
        const prevRow = idx.get(x.scope + '|' + u.league + '|' + u.season + '|' + x.team);
        rows.push({ scope: x.scope, league_key: u.league, season_key: u.season, team_key: x.team, league_id: u.league, season_id: u.season, team_id: x.team || null,
          is_current: !!u.current, path: p, token: u.token, layout: M.FILE_V, fv: FV, bytes: text.length, n_games: st.n, built_at: nowIso, ci_at: nowIso });
        if (prevRow && stripBucket(prevRow.path) !== p) stale.push(stripBucket(prevRow.path));
        out.built.push({ scope: x.scope, unit: u.key, team: x.team || undefined, bytes: text.length, games: st.n });
      }
      st.carry = r.carry; st.ci_at = nowIso;
      await write('upload ' + sp, async () => { await api.upload(BUCKET, sp, JSON.stringify(st), { maxAge: 60 }); if (cacheDir) cacheWrite(cacheDir, sp, st); });
      rows.push(storeRow(u, sp, st, M, FV, nowIso, nowIso));
      /* the index after the uploads, the deletes after the index */
      await write('index ' + u.key, () => upsertIndex(api, rows));
      if (stale.length) await write('delete ' + stale.length + ' old files of ' + u.key, () => api.remove(BUCKET, stale));
      if (u.flagged) await write('refresh flag ' + u.key, () => api.rest(`analytics_refresh?league_id=eq.${u.league}&season_id=eq.${u.season}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ due: false }) }));
      out.accept[u.key] = Object.assign({ slug: u.leagueRow.slug, ms: Date.now() - t0 }, r.accept);
      log(`built ${u.leagueRow.slug} ${u.seasonRow.name}: ${st.n} games, ${files.length} files, ${Math.round((Date.now() - t0) / 1000)} s (${u.why})`);
    } catch (e) {
      out.failed.push({ unit: u.key, error: String(e && e.message || e) });
      log(`FAILED ${u.key}: ${e && e.message || e}`);
      /* the refreshed store is kept even when its files fail: its lines are read once */
      try { await write('upload ' + sp, async () => { await api.upload(BUCKET, sp, JSON.stringify(st), { maxAge: 60 }); if (cacheDir) cacheWrite(cacheDir, sp, st); }); } catch (_) { /* next run */ }
    }
  }
  /* the current stores read for the pooled file and not rebuilt keep their new lines too */
  for (const [key, st] of stores) {
    if (due.some(u => u.key === key)) continue;
    const u = units.find(x => x.key === key), sp = storePath(u.league, u.season, M);
    if (!(deltas.get(key) || {}).rows || !deltas.get(key).rows.length) continue;
    await write('upload ' + sp, async () => { await api.upload(BUCKET, sp, JSON.stringify(st), { maxAge: 60 }); if (cacheDir) cacheWrite(cacheDir, sp, st); });
  }

  /* 6. the objects of deleted leagues */
  const gone = index.filter(r => r.league_key !== 'all' && !leagueBy.has(r.league_key));
  if (gone.length && !o.unit) {
    await write('purge ' + gone.length + ' files of deleted leagues', async () => {
      await api.remove(BUCKET, gone.map(r => stripBucket(r.path)));
      for (const lk of Array.from(new Set(gone.map(r => r.league_key)))) await api.rest(`analytics_files?league_key=eq.${lk}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    });
  }
  /* 7. the job summary */
  out.summary = summary(out, { poolBuilt, units: units.length, due: due.length, dry: !!o.dryRun });
  log(out.summary);
  if (process.env.GITHUB_STEP_SUMMARY && !o.fetch) { try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, out.summary + '\n'); } catch (_) { /* not in Actions */ } }
  return out;
}
const storeRow = (u, sp, st, M, FV, built, ciAt) => ({ scope: 'store', league_key: u.league, season_key: u.season, team_key: '', league_id: u.league, season_id: u.season, team_id: null,
  is_current: !!u.current, path: sp, token: u.token, layout: M.STORE_V, fv: FV, bytes: JSON.stringify(st).length, n_games: st.n, built_at: built, ci_at: ciAt || null });
const upsertIndex = (api, rows) => api.rest('analytics_files?on_conflict=scope,league_key,season_key,team_key', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });

/* the job summary: what was built and §16's live acceptance numbers per unit */
export function summary(out, o) {
  const f = (v, d) => (v == null || !isFinite(v) ? '–' : (+v).toFixed(d == null ? 3 : d));
  const L = [];
  L.push('## What wins model build' + (o && o.dry ? ' (dry run: nothing written)' : ''));
  L.push('');
  L.push(`${(o && o.units) || 0} units, ${(o && o.due) || 0} due, ${out.built.length} files, ${out.current} current, ${out.failed.length} failed` + (o && o.poolBuilt ? ', pooled file rebuilt' : ''));
  if (out.failed.length) { L.push(''); out.failed.forEach(x => L.push(`- FAILED ${x.unit}: ${x.error}`)); }
  const acc = out.accept || {};
  if (Object.keys(acc).length) {
    L.push('');
    L.push('| unit | games | R² (4F, FT rate) | b efg / tovp / orebp / ftr | eFG share | home win | Brier (home / Elo) | log loss | slope | live | sim Brier | sim slope | sim pace / ortg Δ | margin SD ratio | sim calibrated |');
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    Object.keys(acc).sort().forEach(k => {
      const a = acc[k] || {}, c = a.check4 || {}, s = a.sim || {}, ch = s.checks || {};
      const d = x => (ch[x] ? f(ch[x].sim - ch[x].obs, 2) : '–');
      L.push(`| ${a.slug || k} | ${a.n || '–'} | ${f(c.r2)} | ${f(c.efg)} / ${f(c.tovp)} / ${f(c.orebp)} / ${f(c.ftr)} | ${f(a.efgShare, 1)}% | ${f(a.homeWin)} | ${f(a.brier)} (${f(a.brierHome)} / ${f(a.brierElo)}) | ${f(a.logloss)} | ${f(a.slope, 2)} | ${a.live ? 'yes' : 'no'} | ${f(s.brier)} | ${f(s.slope, 2)} | ${d('pace')} / ${d('ortg')} | ${ch.marginSd ? f(ch.marginSd.sim / ch.marginSd.obs, 3) : '–'} | ${s.calibrated ? 'yes' : 'no'} |`);
    });
    L.push('');
    L.push('Targets (§16): pooled R² in [0.93, 0.95], b near 1.157 / −1.130 / 0.398 / 0.094; eFG share [40, 55]; home win [0.55, 0.59]; Brier below home-only and within 0.002 of Elo; slope [0.85, 1.15]; simulator pace and ortg within 0.5, margin SD ratio [0.95, 1.05].');
  }
  if (out.warnings && out.warnings.length) { L.push(''); L.push('<details><summary>' + out.warnings.length + ' warnings</summary>'); L.push(''); out.warnings.slice(0, 200).forEach(w => L.push('- ' + w)); L.push('</details>'); }
  return L.join('\n');
}

/* =============================================================================================== fixtures === */
/* the five §9 sample files from synthetic leagues (deterministic), for the page's and the Front office's tests */
export function fixtures(dir, o) {
  o = o || {};
  const M = load('', PUBLISHABLE);
  const now = '2026-10-01T12:00:00.000Z';
  const A = M.synthUnit({ teams: 12, games: 216, seed: 11 }), B = M.synthUnit({ teams: 10, games: 120, seed: 12 }), C = M.synthUnit({ teams: 8, games: 48, seed: 13, zones: false });
  const open = new Set([A.league.id, B.league.id]);
  const pt = M.poolToken([A.token, B.token, C.token], open);
  const pool = M.buildPool([A, B, C], open, { now, token: pt, B: o.B || 100 });
  A.store.ctx.priors = pool.priors;
  const r = M.buildUnit(A, { now, token: A.token, priors: pool.priors, B: o.B || 100, simOpts: { fitN: 60, fitSims: 60, evalSims: 200 } });
  const teaser = M.buildTeaser([A, B, C], open, { token: pt, now });
  const club = Array.from(r.clubs.values())[0];
  const files = { 'wins.sample.json': r.wins, 'wins-all.sample.json': pool.wins, 'fo.sample.json': r.fo, 'club.sample.json': club, 'teaser.sample.json': teaser };
  const probs = [];
  Object.entries(files).forEach(([n, f]) => {
    const scope = n.startsWith('wins') ? 'wins' : n.split('.')[0];
    M.validate(f, scope, { open }).forEach(p => probs.push(n + ': ' + p));
  });
  if (probs.length) throw new Error('the sample files are not valid: ' + probs.join('; '));
  fs.mkdirSync(dir, { recursive: true });
  Object.entries(files).forEach(([n, f]) => fs.writeFileSync(path.join(dir, n), JSON.stringify(f, null, 1) + '\n'));
  (o.log || console.log)('wrote ' + Object.keys(files).map(n => n + ' (' + fs.statSync(path.join(dir, n)).size + ' B)').join(', ') + ' to ' + dir);
  return { built: Object.keys(files).map(n => ({ scope: n, bytes: fs.statSync(path.join(dir, n)).size })), files };
}

/* =============================================================================================== local === */
/* REAL data, read-only, without the service key: the public tables with the publishable key (games, game_events,
   player_game_stats, lineup_stints, players, teams, rosters, venues, rpc/player_bio; never stats->sit), the feature
   lines worked out here with epinoia/features.js exactly as the backfill does, every file written to `out`. */
export async function local(opts) {
  const o = opts || {};
  const log = o.log || (m => console.log(m));
  const url = String(o.url || 'https://hhvofgqqadtyvcjudhjx.supabase.co').replace(/\/+$/, '');
  const key = o.anonKey || PUBLISHABLE;
  const M = load(url, key);
  globalThis.EpinoiaEngine = require(path.join(ROOT, 'epinoia', 'engine.js'));
  globalThis.EpinoiaPossessions = require(path.join(ROOT, 'epinoia', 'possessions.js'));
  globalThis.EpinoiaShotClock = require(path.join(ROOT, 'epinoia', 'shotclock.js'));
  globalThis.EpinoiaSituations = require(path.join(ROOT, 'epinoia', 'situations.js'));
  const { planFeatures } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'backfill_features.mjs')).href);
  const { mapEvents } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'backfill_situations.mjs')).href);
  const f = o.fetch || globalThis.fetch;
  const retry = async (fn) => { for (let a = 0; ; a++) { try { return await fn(); } catch (e) { if (a >= 3) throw e; await new Promise(r => setTimeout(r, 1500 * (a + 1))); } } };
  const raw = client(url, key, f);
  const api = { rest: (p, i) => retry(() => raw.rest(p, i)), restAll: (p, n) => retry(() => raw.restAll(p, n)) };
  const outDir = o.out;
  fs.mkdirSync(path.join(outDir, 'cache'), { recursive: true });
  const nowIso = o.now || new Date().toISOString();
  const slugs = (o.leagues || []).concat(o.poolLeagues || []).filter((s, i, a) => a.indexOf(s) === i);
  const units = [];
  for (const slug of slugs) {
    const lg = ((await api.rest(`leagues?slug=eq.${slug}&select=id,slug,name`)) || [])[0];
    if (!lg) { log('no league ' + slug); continue; }
    const ss = (await api.rest(`seasons?league_id=eq.${lg.id}&select=id,name,starts_on&order=starts_on.desc`)) || [];
    let pick = null, games = [], kinds = {};
    for (const s of ss) {
      const cs = (await api.rest(`competitions?season_id=eq.${s.id}&select=id,kind`)) || [];
      if (!cs.length) continue;
      const gs = await api.restAll(`games?competition_id=in.(${cs.map(c => c.id).join(',')})&status=eq.final&select=id,status,period,starters,roster_snapshot,competition_id,` +
        `finalised_at,home_score,away_score,home_team_id,away_team_id,tipoff_at,venue_id,tip_winner,arrow_init&order=id`, 200);
      if (gs.length) { pick = s; games = gs; cs.forEach(c => { kinds[c.id] = c.kind; }); break; }
    }
    if (!pick) { log('no finished games for ' + slug); continue; }
    /* the feature lines: computed once per game and cached in out/cache */
    const rows = [], skipped = {};
    let i = 0;
    const lane = async () => {
      for (;;) {
        const g = games[i++];
        if (!g) return;
        const cf = path.join(outDir, 'cache', g.id + '.json');
        let plan = null;
        try { plan = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch (_) { plan = null; }
        if (!plan) {
          const ev = [];
          let after = -1;
          for (;;) { const page = await api.rest(`game_events?game_id=eq.${g.id}&select=seq,t,team,pid,period,clock,payload&order=seq&seq=gt.${after}&limit=1000`); ev.push(...(page || [])); if (!page || page.length < 1000) break; after = page[page.length - 1].seq; }
          const p = planFeatures({ row: g, events: mapEvents(ev), meta: { league_id: lg.id, season_id: pick.id } });
          plan = { skip: p.skip, rows: p.rows };
          fs.writeFileSync(cf, JSON.stringify(plan));
        }
        if (plan.skip) { skipped[plan.skip] = (skipped[plan.skip] || 0) + 1; continue; }
        rows.push(...plan.rows);
      }
    };
    await Promise.all([lane(), lane(), lane(), lane(), lane(), lane()]);
    const ids = Array.from(new Set(rows.map(r => r.game_id))).sort();
    const gameRows = games.filter(g => ids.includes(g.id)).map(g => ({ id: g.id, status: g.status, competition_id: g.competition_id, home_team_id: g.home_team_id,
      away_team_id: g.away_team_id, home_score: g.home_score, away_score: g.away_score, tipoff_at: g.tipoff_at, venue_id: g.venue_id, starters: g.starters }));
    const pgs = [], stints = [];
    for (const c of chunks(ids, 40)) {
      pgs.push(...await api.restAll(`player_game_stats?game_id=in.(${c.join(',')})&select=${PGS_SELECT}&order=game_id,team_idx,player_id`));
      stints.push(...await api.restAll(`lineup_stints?game_id=in.(${c.join(',')})&select=${STINT_SELECT}&order=game_id,team_idx,id`));
    }
    let st = M.storeAdd(M.emptyStore(lg.id, pick.id), rows, gameRows, pgs, stints, { kinds });
    const n = st.n;
    const token = n + '@' + st.wm.at;
    const unit = { key: lg.id + ':' + pick.id, league: lg.id, season: pick.id, leagueRow: lg, seasonRow: pick, current: true, open: true, comps: Object.keys(kinds).sort(), kinds };
    st.ctx = await readContext(api, M, unit, st, { anon: true });
    units.push({ slug, unit, store: st, token, skipped, focus: (o.leagues || []).includes(slug) });
    log(`${slug} ${pick.name}: ${n} games with lines (${Object.entries(skipped).map(([k, v]) => v + ' ' + k).join(', ') || 'none skipped'}), ${pgs.length} player lines, ${stints.length} stints`);
  }
  const open = new Set(units.map(u => u.unit.league));
  const inputs = units.map(u => Object.assign(M.inputFromStore(u.store), { league: u.store.ctx.league, token: u.token }));
  const pt = M.poolToken(inputs.map(i => i.token), open);
  const t0 = Date.now();
  const pool = M.buildPool(inputs, open, { now: nowIso, token: pt, B: o.B || 400 });
  log(`pooled: ${pool.wins ? pool.wins.n.games : 0} games in ${Math.round((Date.now() - t0) / 1000)} s`);
  const out = { built: [], failed: [], current: 0, accept: { 'all:current': pool.accept }, warnings: pool.warnings.map(w => 'pooled: ' + w) };
  const wr = (n, obj) => { fs.writeFileSync(path.join(outDir, n), JSON.stringify(obj)); out.built.push({ scope: n, bytes: fs.statSync(path.join(outDir, n)).size }); };
  if (pool.wins) wr('wins-all.json', pool.wins);
  wr('priors.json', pool.priors);
  wr('teaser.json', M.buildTeaser(inputs, open, { token: pt, now: nowIso }));
  for (const u of units.filter(x => x.focus)) {
    u.store.ctx.priors = pool.priors;
    const t1 = Date.now();
    const r = M.buildUnit(M.inputFromStore(u.store), { token: u.token, now: nowIso, priors: pool.priors, B: o.B || 400, simOpts: o.simOpts });
    r.warnings.forEach(w => out.warnings.push(u.slug + ': ' + w));
    if (!r.wins) { out.failed.push({ unit: u.slug, error: r.warnings.join('; ') }); continue; }
    wr(`wins-${u.slug}.json`, r.wins); wr(`fo-${u.slug}.json`, r.fo);
    const tid = Array.from(r.clubs.keys())[0];
    if (tid) wr(`club-${u.slug}.json`, r.clubs.get(tid));
    const pid = Array.from(r.pos.keys())[0];
    if (pid) wr(`pos-${u.slug}.json`, r.pos.get(pid));
    const probs = [M.validate(r.wins, 'wins'), M.validate(r.fo, 'fo'), ...Array.from(r.clubs.values()).map(c => M.validate(c, 'club', { withheld: new Set(u.store.ctx.withheld) }))].flat();
    if (probs.length) out.warnings.push(u.slug + ' validation: ' + probs.slice(0, 5).join('; '));
    out.accept[u.unit.key] = Object.assign({ slug: u.slug, ms: Date.now() - t1, timing: r.timing, sizes: { wins: JSON.stringify(r.wins).length, fo: JSON.stringify(r.fo).length,
      clubMax: Math.max(...Array.from(r.clubs.values()).map(c => JSON.stringify(c).length)), posMax: Math.max(...Array.from(r.pos.values()).map(c => JSON.stringify(c).length)) } }, r.accept);
    log(`${u.slug}: built in ${Math.round((Date.now() - t1) / 1000)} s`);
    /* RECALCULATE as the Edge Function runs it: the newest games held back, the store built without them, then update() */
    if (o.updateCheck !== false) {
      const D = M.decodeStore(u.store), keep = D.games.slice(0, Math.max(M.MIN.own, D.games.length - 10)).map(g => g.id);
      const late = D.games.filter(g => !keep.includes(g.id)).map(g => g.id);
      if (late.length) {
        const A = M.storeDrop(u.store, late);
        A.ctx = u.store.ctx;
        const ra = M.buildUnit(M.inputFromStore(A), { now: nowIso, priors: pool.priors, B: 40, sim: false });
        A.carry = ra.carry; A.ci_at = nowIso;
        const t2 = Date.now();
        const delta = deltaOf(u.store, late, M);
        const up = M.update(A, delta, { now: nowIso });
        out.accept[u.unit.key].update = { games: late.length, ms: Date.now() - t2, files: Object.keys(up.files), n: up.store.n, sameStore: storeBody(up.store) === storeBody(u.store) };
      }
    }
  }
  out.summary = summary(out, { units: units.length, due: units.filter(u => u.focus).length, poolBuilt: !!pool.wins });
  fs.writeFileSync(path.join(outDir, 'summary.md'), out.summary + '\n\n```json\n' + JSON.stringify(out.accept, null, 1) + '\n```\n');
  log(out.summary);
  return out;
}
/* the store's lines without its context, carry and build stamps */
const storeBody = s => JSON.stringify(Object.assign({}, s, { ctx: null, carry: null, ci_at: null }));
/* a store's games as the delta the Edge Function would read (the rows game_features and the tables give) */
function deltaOf(store, ids, M) {
  const D = M.decodeStore(store), want = new Set(ids), F = globalThis.EpinoiaFeatures;
  const rows = [], games = [], pgs = [], stints = [];
  D.games.forEach((g, gi) => {
    if (!want.has(g.id)) return;
    const fa = g.fa || new Date(g.t).toISOString();
    [0, 1].forEach(s => rows.push({ game_id: g.id, team_idx: s, fv: F.FV, f: Array.from(g.F[s], v => (isFinite(v) ? v : null)), q: g.q[s], finalised_at: fa }));
    games.push({ id: g.id, status: 'final', competition_id: store.comps[g.c] || null, home_team_id: g.h, away_team_id: g.a, home_score: g.hs, away_score: g.as,
      tipoff_at: new Date(g.t).toISOString(), venue_id: g.v || null, starters: null, _s: [g.s0, g.s1] });
    D.pgs.filter(r => r.g === gi).forEach(r => pgs.push({ game_id: g.id, team_idx: r.side, player_uuid: D.players[r.p], player_id: D.players[r.p], min: r.min * 60000, pts: r.pts,
      p2a: r.fga - r.fg3a, p2m: r.fgm - r.fg3m, p3a: r.fg3a, p3m: r.fg3m, fta: r.fta, ftm: r.ftm, or: r.or, dr: r.dr, ast: r.ast, stl: r.stl, blk: r.blk, to: r.to, pf: r.pf }));
    D.stints.filter(r => r.g === gi).forEach(r => stints.push({ game_id: g.id, team_idx: r.side, player_ids: r.p.map(i => D.players[i]), dur: r.dur * 1000, pf: r.pf, pa: r.pa,
      off: { fga: r.poss / 0.96, tov: 0, fta: 0, or: 0 }, def: { fga: r.poss / 0.96, tov: 0, fta: 0, or: 0 } }));
  });
  return { rows, games, pgs, stints };
}

/* =============================================================================================== cli === */
export function parseArgs(argv) {
  const a = { dryRun: false, full: false, unit: null, minGapHours: null, poolGapHours: null, fixtures: null, local: false, out: null, leagues: [], poolLeagues: [], B: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i], nx = () => argv[++i];
    if (x === '--dry-run' || x === '--dry') a.dryRun = true;
    else if (x === '--full') a.full = true;
    else if (x === '--unit') a.unit = nx();
    else if (x === '--min-gap-hours') a.minGapHours = +nx();
    else if (x === '--pool-gap-hours') a.poolGapHours = +nx();
    else if (x === '--fixtures') a.fixtures = nx();
    else if (x === '--local') a.local = true;
    else if (x === '--out') a.out = nx();
    else if (x === '--leagues') a.leagues = String(nx() || '').split(',').filter(Boolean);
    else if (x === '--pool-leagues') a.poolLeagues = String(nx() || '').split(',').filter(Boolean);
    else if (x === '--B') a.B = +nx();
  }
  return a;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = parseArgs(process.argv.slice(2));
  const env = k => (process.env[k] != null && process.env[k] !== '' ? process.env[k] : null);
  const p = a.local
    ? local({ out: a.out || path.join(ROOT, '.cache', 'analytics-local'), leagues: a.leagues.length ? a.leagues : ['cebl', 'orlen-basket-liga'], poolLeagues: a.poolLeagues, B: a.B || undefined })
    : run({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY, dryRun: a.dryRun, unit: a.unit, full: a.full, fixtures: a.fixtures,
      minGapHours: a.minGapHours != null ? a.minGapHours : (env('ANALYTICS_MIN_GAP_H') != null ? +env('ANALYTICS_MIN_GAP_H') : 1),
      poolGapHours: a.poolGapHours != null ? a.poolGapHours : (env('ANALYTICS_POOL_GAP_H') != null ? +env('ANALYTICS_POOL_GAP_H') : 6), B: a.B || undefined });
  p.then(r => { process.exit(r && r.failed && r.failed.length ? 1 : 0); }).catch(e => { console.error(e); process.exit(1); });
}
