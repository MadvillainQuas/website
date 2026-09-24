// ============================================================================
// snapshots — WORK DONE ONCE, SHARED BY EVERY READER (migration 0152).
//
//   POST {}   anyone; the database's tick (snapshots_tick, every five minutes)
//             calls it with the publishable key when a game has been finalised.
//             Answers counts and nothing else.
//
// The public pages worked everything out from raw per-game rows in each
// visitor's browser, so each visit cost more as leagues and games were added.
// This builds the two biggest results once, for everybody:
//
//   'stars_global'          HOME's podiums: EpinoiaStars.global(), the very
//                           function HOME runs, rebuilt when its anchor (the
//                           latest final) moves, or after an hour;
//   'season:<competition>'  a competition's season lines: EpinoiaData.season(),
//                           the very function the league pages and scouting run,
//                           rebuilt when the competition's token (finished games
//                           and the latest finalised_at) moves.
//
// AS A SIGNED-OUT VISITOR. Every read goes out with the publishable key and no
// session, through the page's own data.js, so every policy applies and a
// snapshot can only hold what an anonymous reader could already read: no second
// copy of the access rules to keep in step. The service role is used for one
// thing, writing snapshots and snapshot_ticks. Pages use a snapshot only when
// its token is the one they read themselves, and work it out the old way
// otherwise, so a late or failed build costs speed, never correctness.
//
// BOUNDED. An Edge Function has a small CPU budget per request, so each call
// builds the podiums and at most MAX_SEASONS competitions, newest seasons first;
// the tick calls again five minutes later while anything is left (it compares
// what the database has finalised with what this function last finished).
// SAFE TO CALL BY ANYBODY, ANY NUMBER OF TIMES: it only rebuilds what changed.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import '../_shared/bpm.js';        // globalThis.EpinoiaBPM
import '../_shared/season.js';     // globalThis.EpinoiaSeason
import '../_shared/data.js';       // globalThis.EpinoiaData — the page's own reads and sums
import '../_shared/stars.js';      // globalThis.EpinoiaStars

const PUBLISHABLE = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';   // epinoia/config.js publishes it
/* CPU, measured under node on 2026-09-24: the podiums about 0.6 s (a month of box scores
   across every league), a season 0.15-0.3 s. The runtime allows about two seconds a call. */
const MAX_SEASONS = 6;             // competitions rebuilt per call...
const MAX_SEASONS_AFTER_STARS = 3; // ...or this many when the podiums were rebuilt in the same call
const WALL_MS = 60_000;            // and none started after this
const STARS_MAX_AGE_MS = 60 * 60 * 1000;
/* a season rebuilt once a day even when its token has not moved: a box score corrected
   without a new finalised_at would otherwise stay as it was (the page's own cache has the
   same backstop, six hours, in data.js) */
const SEASON_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/* data.js asks fetch for {cache: 'no-store'}, which is a browser option; Deno is not asked */
const realFetch = globalThis.fetch.bind(globalThis);
(globalThis as any).fetch = (input: any, init?: any) => {
  if (init && typeof init === 'object' && 'cache' in init) {
    const { cache: _cache, ...rest } = init;
    return realFetch(input, rest);
  }
  return realFetch(input, init);
};
/* the reads are a signed-out visitor's: the publishable key, no session, no EpinoiaAccess */
(globalThis as any).EPINOIA_CONFIG = {
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  supabaseAnonKey: PUBLISHABLE
};

/* A SEASON IS A FILE (0153): snapshots/season/<competition id(s)>/<token>.json, one path per
   version, so the CDN can keep it forever and a new token is a new URL. The token turned into a
   file name exactly as epinoia/data.js turns it (snapFile there):
     154@2026-09-23T23:05:29.983+00:00  ->  154-2026-09-23T23-05-29-983-00-00.json */
const snapFile = (token: string) => String(token).replace(/[^A-Za-z0-9]+/g, '-') + '.json';
const BUCKET = 'snapshots';

async function removeFiles(admin: any, unit: string, keep: string | null) {
  const dir = 'season/' + unit;
  const { data: list } = await admin.storage.from(BUCKET).list(dir, { limit: 100 });
  const old = (list || []).map((o: any) => o.name).filter((n: string) => n && n !== keep).map((n: string) => dir + '/' + n);
  if (old.length) await admin.storage.from(BUCKET).remove(old);
}

/* stars.js hands back its windows revived (w = the WINDOWS entry); stored, w is the key */
const unrevive = (row: any) => (row ? { ...row, w: row.w && row.w.key ? row.w.key : row.w } : null);

async function buildStars(admin: any, D: any, ST: any) {
  const anchorRows = await D.get('games?select=tipoff_at&status=eq.final&competition_id=not.is.null' +
    '&tipoff_at=lte.' + encodeURIComponent(new Date().toISOString()) + '&order=tipoff_at.desc&limit=1');
  const anchor = anchorRows[0] && anchorRows[0].tipoff_at;
  if (!anchor) return 'no finals';
  const { data: held } = await admin.from('snapshots').select('token,built_at').eq('key', 'stars_global').maybeSingle();
  if (held && held.token === anchor && Date.now() - Date.parse(held.built_at) < STARS_MAX_AGE_MS) return 'current';

  const res = await ST.global({ now: new Date(), snapshot: false });
  if (!res || res.anchor !== anchor) return 'anchor moved while building';   // the next tick builds it
  const data = { week: unrevive(res.week), month: unrevive(res.month), anchor };
  const { error } = await admin.from('snapshots').upsert(
    { key: 'stars_global', competition_id: null, token: anchor, data, built_at: new Date().toISOString() },
    { onConflict: 'key' });
  if (error) throw new Error('stars_global: ' + error.message);
  return 'built';
}

async function buildSeasons(admin: any, D: any, started: number, maxBuilds: number) {
  /* every season with its competitions, newest first, as global scouting orders them
     (starts_on descending: data.js pickSeason's rule) */
  const { data: seasons, error } = await admin.from('seasons')
    .select('id,league_id,starts_on,competitions(id)').order('starts_on', { ascending: false });
  if (error) throw new Error('seasons: ' + error.message);
  /* the index rows: a season's token and its file (a row from before 0153 has no file, and is
     built again as a file) */
  const { data: heldRows } = await admin.from('snapshots').select('key,token,built_at,file:data->>file').like('key', 'season:%');
  const held = new Map((heldRows || []).map((r: any) => [r.key, r]));

  /* WHAT PAGES ASK FOR: every competition on its own (a league page scoped to one), and each
     league's newest season whole when it has more than one competition (global scouting, and a
     league page's "all competitions"), keyed by the sorted ids as data.js looks it up. The
     merged ones first: they serve the most readers. */
  const singles: string[] = [];
  const merged: string[][] = [];
  const newestSeen = new Set<string>();
  for (const s of seasons || []) {
    const ids = (s.competitions || []).map((c: any) => c.id).filter(Boolean).sort();
    ids.forEach((id: string) => singles.push(id));
    if (!newestSeen.has(s.league_id)) {
      newestSeen.add(s.league_id);
      if (ids.length > 1) merged.push(ids);
    }
  }

  /* the tokens, eight at a time: 94-byte answers, read as a signed-out visitor */
  const tokens = new Map<string, string | null>();
  const units = [...merged.map(ids => ids.join(',')), ...singles];
  for (let i = 0; i < units.length; i += 8) {
    const part = units.slice(i, i + 8);
    const got = await Promise.all(part.map(u =>
      D.seasonToken(u.includes(',') ? `competition_id=in.(${u})` : `competition_id=eq.${u}`).catch(() => null)));
    part.forEach((u, k) => tokens.set(u, got[k]));
  }

  let built = 0, current = 0, removed = 0, left = 0;
  for (const unit of units) {
    const key = 'season:' + unit;
    const tok = tokens.get(unit);
    if (tok == null) continue;       // not known this call (a blip, or no count): leave it as it is
    if (/^0@/.test(tok)) {
      /* nothing a signed-out reader can see (private, members-only, or no finals): no
         snapshot. One kept from before is dropped, file and index row. */
      if (held.has(key)) {
        await removeFiles(admin, unit, null);
        await admin.from('snapshots').delete().eq('key', key);
        removed++;
      }
      continue;
    }
    const h: any = held.get(key);
    if (h && h.file && h.token === tok && Date.now() - Date.parse(h.built_at) < SEASON_MAX_AGE_MS) { current++; continue; }
    if (built >= maxBuilds || Date.now() - started > WALL_MS) { left++; continue; }

    const ids = unit.split(',');
    /* THE POLICY'S COMPETITION: one of the set with finished games a signed-out reader can see
       (they are one league's, so one rule), or a merged snapshot would be hidden by, say, a
       play-off competition with nothing played yet */
    const withFinals = ids.find(id => { const t = tokens.get(id); return t != null && !/^0@/.test(t); }) || ids[0];
    const s = await D.season(ids.length === 1 ? ids[0] : ids, { trim: true, rows: false, snapshot: false });
    const data = { games: s.games || [], players: s.players || [], teams: s.teams || [],
                   teamOfPlayer: Array.from((s.teamOfPlayer || new Map()).entries()) };
    const name = snapFile(tok);
    const file = 'season/' + unit + '/' + name;
    const { error: fileErr } = await admin.storage.from(BUCKET).upload(file, JSON.stringify({ token: tok, data }),
      { contentType: 'application/json', upsert: true, cacheControl: '31536000' });
    if (fileErr) throw new Error(file + ': ' + fileErr.message);
    const { error: upErr } = await admin.from('snapshots').upsert(
      { key, competition_id: withFinals, token: tok, data: { file }, built_at: new Date().toISOString() }, { onConflict: 'key' });
    if (upErr) throw new Error(key + ': ' + upErr.message);
    await removeFiles(admin, unit, name);     // the versions before this one
    built++;
  }
  return { built, current, removed, left };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const started = Date.now();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
                             { auth: { persistSession: false } });
  const D = (globalThis as any).EpinoiaData, ST = (globalThis as any).EpinoiaStars;
  try {
    /* what the tick last saw: marking THAT done means a game finalised while this runs
       leaves the two different, and the next tick calls again */
    const { data: tick } = await admin.from('snapshot_ticks').select('fingerprint').eq('id', 1).maybeSingle();
    const stars = await buildStars(admin, D, ST);
    const seasons = await buildSeasons(admin, D, started,
      stars === 'built' ? MAX_SEASONS_AFTER_STARS : MAX_SEASONS);
    if (seasons.left === 0) {
      await admin.from('snapshot_ticks').upsert(
        { id: 1, done_fingerprint: tick ? tick.fingerprint : null, done_at: new Date().toISOString() },
        { onConflict: 'id' });
    }
    return json({ stars, seasons, complete: seasons.left === 0, ms: Date.now() - started });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e), ms: Date.now() - started }, 500);
  }
});
