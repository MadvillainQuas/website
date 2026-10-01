/* ============================================================================
   THE BIG SEASONS — every competition with more than BIG_GAMES finished games
   (epinoia/data.js), built into the season file every page already reads.

     SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node tools/build-seasons.mjs
     … node tools/build-seasons.mjs --dry-run            say what would be built
     … node tools/build-seasons.mjs --unit <ids>          one unit (sorted ids, comma-joined)

   Run hourly by .github/workflows/big-seasons.yml.

   WHY HERE. The snapshots function builds every season file, and a season of the
   leagues on the platform in 2026 (240 finished games at the most) takes it 0.15 to
   0.3 s of the two seconds of CPU a call is allowed. An NCAA Division I season is
   about 5,800 games and 140,000 player rows, and a Tercera FEB season is thousands of
   games across its groups: no call can sum one, and no browser should read one (112 MB
   of player rows, trimmed). So past BIG_GAMES the function leaves a competition alone,
   a page reads the latest file built for it (data.js bigSeason), and this builds it in
   GitHub Actions, where a job has minutes and gigabytes: data.js season() a few batches
   of forty games at a time (`window`), each batch added to the running sums and let go,
   so the rows are never all in memory together.

   EXACTLY WHAT THE FUNCTION WOULD HAVE WRITTEN, had it the time:
     * the same code: epinoia/data.js, season.js and bpm.js, loaded as the pages load
       them (the function runs its shared copies of the same files);
     * the same reader: a signed-out visitor, the publishable key and every policy, so a
       file holds nothing an anonymous reader could not already read. The service key
       is used only to write: the file, the index row, and the removal of the versions
       before it;
     * the same file: data.js snapFile names it by its token and layout, packSeason
       packs it; the same index row in public.snapshots, and the same rebuild rules
       (a new token, a file from an older layout, or a day old).
   ============================================================================ */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHABLE = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';   // epinoia/config.js publishes it
const BUCKET = 'snapshots';
const SEASON_MAX_AGE_MS = 24 * 60 * 60 * 1000;   // as the function: a day, token or no token
const WINDOW = 4;                                 // batches of forty games read ahead of the sums

/* two files in the same layout (the v<n>- in front of the token): only then may an older build stand */
function sameLayout(a, b) {
  const v = f => (String(f || '').split('/').pop().match(/^v(\d+)-/) || [])[1] || '';
  return v(a) !== '' && v(a) === v(b);
}

/* the page's own modules, as a browser loads them: globals first, then the files */
function load(url) {
  globalThis.window = globalThis;
  globalThis.EPINOIA_CONFIG = { supabaseUrl: url, supabaseAnonKey: PUBLISHABLE };
  globalThis.EpinoiaBPM = require(path.join(ROOT, 'epinoia', 'bpm.js'));
  globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
  const D = require(path.join(ROOT, 'epinoia', 'data.js'));
  globalThis.EpinoiaData = D;
  return D;
}

/* opts: { url, serviceKey, fetch, dryRun, unit, log, now } — the fetch is the one data.js reads with too
   (it is the global), and every write goes through it. Resolves to what was done. */
export async function run(opts) {
  const o = opts || {};
  const log = o.log || (m => console.log(m));
  const url = String(o.url || '').replace(/\/+$/, '');
  if (!url || !o.serviceKey) { log('no SUPABASE_URL / SUPABASE_SERVICE_KEY: nothing to do'); return { skipped: 'no keys' }; }
  if (o.fetch) globalThis.fetch = o.fetch;
  const now = typeof o.now === 'function' ? o.now : () => Date.now();
  const D = load(url);
  const svc = { apikey: o.serviceKey, Authorization: 'Bearer ' + o.serviceKey };
  const rest = async (p, init) => {
    const r = await fetch(url + '/rest/v1/' + p, Object.assign({}, init, { headers: Object.assign({ Accept: 'application/json' }, svc, (init || {}).headers || {}) }));
    if (!r.ok) throw new Error(p.split('?')[0] + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  const storage = async (p, init) => {
    const r = await fetch(url + '/storage/v1/' + p, Object.assign({}, init, { headers: Object.assign({}, svc, (init || {}).headers || {}) }));
    if (!r.ok) throw new Error('storage ' + p.split('?')[0] + ': ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const t = await r.text();
    try { return t ? JSON.parse(t) : null; } catch (_) { return t; }
  };

  /* the units, as the function reads them: every season (the service key sees them all), newest first */
  const seasons = await rest('seasons?select=id,league_id,starts_on,competitions(id)&order=starts_on.desc');
  let units = D.seasonUnits(seasons || []);
  if (o.unit) units = units.filter(u => u === o.unit);
  const held = new Map(((await rest("snapshots?select=key,token,built_at,file:data->>file&key=like.season:*")) || []).map(r => [r.key, r]));

  const done = { built: [], current: 0, small: 0, empty: 0, failed: [] };
  for (const unit of units) {
    const ids = unit.split(',');
    const scope = ids.length === 1 ? `competition_id=eq.${ids[0]}` : `competition_id=in.(${unit})`;
    const tok = await D.seasonToken(scope);                 // as a signed-out visitor
    if (tok == null || /^0@/.test(tok)) { done.empty++; continue; }
    const n = D.gamesIn(tok);
    if (n <= D.BIG_GAMES) { done.small++; continue; }       // the snapshots function's
    const key = 'season:' + unit;
    const name = D.snapFile(tok), file = 'season/' + unit + '/' + name;
    const h = held.get(key);
    if (h && h.file === file && h.token === tok && now() - Date.parse(h.built_at) < SEASON_MAX_AGE_MS) { done.current++; continue; }
    /* A FLOOR BETWEEN TWO BUILDS (o.minGapMs, --min-gap-hours, the BIG_SEASONS_MIN_GAP_H variable). Every build reads
       the whole season again: an NCAA division is ~5,000 games at ~19 KB of box score, trimmed lines and splits each,
       about 95 MB, and on a college evening its token moves every hour. Four divisions rebuilt hourly would read
       ~9 GB a day out of the database, most of the plan's egress (docs/ncaa-readiness.md). With a floor, a file
       younger than it stands even though its token moved; the pages say "As of" its build (data.js bigSeason).
       Unset (0) is the rule as it was. A file in an older layout is always rebuilt. */
    if (o.minGapMs > 0 && h && h.built_at && sameLayout(h.file, file)
        && now() - Date.parse(h.built_at) < o.minGapMs) { done.current++; continue; }
    if (o.dryRun) { log(`would build ${unit}: ${n} games (${tok})`); done.built.push({ unit, games: n, dry: true }); continue; }
    try {
      const t0 = now();
      const s = await D.season(ids.length === 1 ? ids[0] : ids, { trim: true, rows: false, snapshot: false, allowBig: true, window: WINDOW });
      /* the names, as the function reads them, four hundred players (ten requests of forty) at a time
         rather than an NCAA's five thousand at once */
      const pids = (s.players || []).map(p => p.id).filter(Boolean), meta = {};
      for (let i = 0; i < pids.length; i += 400) Object.assign(meta, await D.playerMeta(pids.slice(i, i + 400)));
      const data = D.packSeason({ games: s.games || [], players: s.players || [], teams: s.teams || [],
                                 teamOfPlayer: s.teamOfPlayer || new Map(), meta });
      /* THE POLICY'S COMPETITION, as the function picks it: one of the set with finished games a
         signed-out reader can see, or a merged file would be hidden by a phase with none yet */
      let withFinals = ids[0];
      if (ids.length > 1) {
        for (const id of ids) {
          const t = await D.seasonToken(`competition_id=eq.${id}`);
          if (t != null && !/^0@/.test(t)) { withFinals = id; break; }
        }
      }
      const body = JSON.stringify({ token: tok, data });
      await storage('object/' + BUCKET + '/' + file.split('/').map(encodeURIComponent).join('/'), {
        method: 'POST', body,
        headers: { 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }
      });
      await rest('snapshots?on_conflict=key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ key, competition_id: withFinals, token: tok, data: { file }, built_at: new Date(now()).toISOString() })
      });
      /* the versions before this one */
      const list = await storage('object/list/' + BUCKET, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix: 'season/' + unit, limit: 100 })
      });
      const old = (Array.isArray(list) ? list : []).map(x => x && x.name).filter(x => x && x !== name).map(x => 'season/' + unit + '/' + x);
      if (old.length) {
        await storage('object/' + BUCKET, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: old }) });
      }
      const kb = Math.round(body.length / 1024);
      log(`built ${unit}: ${n} games, ${(s.players || []).length} players, ${(s.teams || []).length} clubs, ${kb} KB, ${Math.round((now() - t0) / 1000)} s`);
      done.built.push({ unit, games: n, players: (s.players || []).length, kb, removed: old.length });
    } catch (e) {
      log(`FAILED ${unit}: ${e && e.message || e}`);
      done.failed.push({ unit, error: String(e && e.message || e) });
    }
  }
  log(`big seasons: ${done.built.length} built, ${done.current} current, ${done.small} for the snapshots function, ` +
      `${done.empty} with nothing a signed-out reader can see` + (done.failed.length ? `, ${done.failed.length} FAILED` : ''));
  return done;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = k => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  run({ url: process.env.SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_KEY,
        dryRun: process.argv.includes('--dry-run'), unit: arg('--unit'),
        minGapMs: (+(arg('--min-gap-hours') || process.env.BIG_SEASONS_MIN_GAP_H || 0) || 0) * 3600000 })
    .then(r => { process.exit(r && r.failed && r.failed.length ? 1 : 0); })
    .catch(e => { console.error(e); process.exit(1); });
}
