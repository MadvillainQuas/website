// ============================================================================
// snapshots — WORK DONE ONCE, SHARED BY EVERY READER (migration 0152).
//
//   POST {}   anyone; the database's tick (snapshots_tick, every five minutes)
//             calls it with the publishable key when a game has been finalised.
//             Answers counts and nothing else.
//
// The public pages worked everything out from raw per-game rows in each
// visitor's browser, so each visit cost more as leagues and games were added.
// This builds the biggest results once, for everybody:
//
//   ('stars_global', HOME's podiums, was built here first in every call until
//    2026-10-08: over every league it took 3.5 s of CPU and ~300 MB, past the
//    worker's budget, and every call died there from 3 October. It is built by
//    tools/build-stars.mjs in big-seasons.yml now, hourly.)
//   'season:<competition>'  a competition's season lines: EpinoiaData.season(),
//                           the very function the league pages and scouting run,
//                           rebuilt when the competition's token (finished games
//                           and the latest finalised_at) moves;
//   events/<game>.json      a finished game's event log (0156): EpinoiaData.gameLog(),
//                           the very read events() makes, rewritten when the game is
//                           finalised again or its log changes.
//   pos/<game>.json         a finished game's minutes at each position (0216): t/depth.js
//                           posFile(), the club page's depth chart's own sums, a few
//                           hundred bytes a game, rewritten when the game is finalised again.
//   crests/<key>            a copy of each crest that is another site's URL (0158), which
//                           pages ask Storage's image transformation for at display size.
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
import '../_shared/depth.js';      // globalThis.EpinoiaDepth — the depth chart's positions (posFile)

const PUBLISHABLE = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';   // epinoia/config.js publishes it
/* CPU, measured under node on 2026-09-24: a season 0.15-0.3 s. The runtime allows about two seconds a call.
   (The podiums were 0.6 s then and 3.5 s with ~300 MB on 2026-10-08: they left for tools/build-stars.mjs.) */
const MAX_SEASONS = 6;             // competitions rebuilt per call
const WALL_MS = 60_000;            // and none started after this
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

/* A SEASON IS A FILE (0153): snapshots/season/<competition id(s)>/<name>.json, one path per
   version, so the CDN can keep it forever and a new token is a new URL. The name is epinoia/
   data.js's own snapFile() (its shared copy, below), which puts the file's layout in front of
   the token, so a new layout is a new URL too and nobody is left holding an old one:
     154@2026-09-23T23:05:29.983+00:00  ->  v2-154-2026-09-23T23-05-29-983-00-00.json */
const snapFile = (token: string): string => (globalThis as any).EpinoiaData.snapFile(token);
const BUCKET = 'snapshots';

async function removeFiles(admin: any, unit: string, keep: string | null) {
  const dir = 'season/' + unit;
  const { data: list } = await admin.storage.from(BUCKET).list(dir, { limit: 100 });
  const old = (list || []).map((o: any) => o.name).filter((n: string) => n && n !== keep).map((n: string) => dir + '/' + n);
  if (old.length) await admin.storage.from(BUCKET).remove(old);
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

  /* WHAT PAGES ASK FOR (data.js seasonUnits, which tools/build-seasons.mjs reads the same way):
     every competition on its own, and each league's newest season whole when it has more than
     one competition, keyed by the sorted ids; the merged ones first */
  const units: string[] = D.seasonUnits(seasons || []);

  /* the tokens, eight at a time: 94-byte answers, read as a signed-out visitor */
  const tokens = new Map<string, string | null>();
  for (let i = 0; i < units.length; i += 8) {
    const part = units.slice(i, i + 8);
    const got = await Promise.all(part.map(u =>
      D.seasonToken(u.includes(',') ? `competition_id=in.(${u})` : `competition_id=eq.${u}`).catch(() => null)));
    part.forEach((u, k) => tokens.set(u, got[k]));
  }

  let built = 0, current = 0, removed = 0, left = 0, big = 0;
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
    /* A BIG COMPETITION (data.js BIG_GAMES finished games) is built in GitHub Actions by
       tools/build-seasons.mjs, a batch of games at a time: this function's two seconds of CPU
       cannot sum one, and pages read the latest file meanwhile */
    if (D.gamesIn(tok) > D.BIG_GAMES) { big++; continue; }
    const h: any = held.get(key);
    /* current: the file this token would be named, in this layout (snapFile carries both) */
    if (h && h.file === 'season/' + unit + '/' + snapFile(tok) && h.token === tok &&
        Date.now() - Date.parse(h.built_at) < SEASON_MAX_AGE_MS) { current++; continue; }
    if (built >= maxBuilds || Date.now() - started > WALL_MS) { left++; continue; }

    const ids = unit.split(',');
    /* THE POLICY'S COMPETITION: one of the set with finished games a signed-out reader can see
       (they are one league's, so one rule), or a merged snapshot would be hidden by, say, a
       play-off competition with nothing played yet */
    const withFinals = ids.find(id => { const t = tokens.get(id); return t != null && !/^0@/.test(t); }) || ids[0];
    const s = await D.season(ids.length === 1 ? ids[0] : ids, { trim: true, rows: false, snapshot: false });
    /* the names, jerseys and clubs of everybody on it, as the page's playerMeta() reads them
       signed out, so a page that has the season has its names too (data.js seedMeta) */
    const meta = await D.playerMeta((s.players || []).map((p: any) => p.id).filter(Boolean));
    /* PACKED (data.js packSeason, the layout snapFile names): the rows as columns, every name once
       instead of once a player - LNBP's 1.9 MB of JSON is 0.52 MB, 319 KB gzipped is 143 KB - and
       unpackSeason gives back exactly the rows it was given */
    const data = D.packSeason({ games: s.games || [], players: s.players || [], teams: s.teams || [],
                                teamOfPlayer: s.teamOfPlayer || new Map(), meta });
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
  return { built, current, removed, left, big };
}

/* A FINISHED GAME'S EVENT LOG IS A FILE (0156): snapshots/events/<game id>.json, one stable path
   per game, rewritten in place when the game is finalised again or its log changes (Smart CDN
   purges a rewritten file within a minute; browsers keep a copy five minutes). Written for the
   games a signed-out reader may read, final ones only: the ids come from game_rows_public read
   with the publishable key, the rows from the page's own gameLog(), so a file holds exactly what
   such a reader's browser would have read from the database. */
const EVENT_LANES = 6;
const MAX_EVENT_FILES = 60;          // written per call (JSON in and out, about 4 ms of CPU each)
const MAX_EVENT_REMOVALS = 200;      // and removed

async function allAdmin(admin: any, table: string, cols: string, filter?: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    let q = admin.from(table).select(cols).order(cols.split(',')[0]).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(table + ': ' + error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

/* what a signed-out reader may read: the public games (final, or live where the league shows live), and the
   finished ones among them with the finalisation their files are named from, newest first: the games people are
   opening now. Read once a call, for the event logs and the positions alike. */
/* (a paged read needs a total order, or two pages can overlap: hence the ids) */
async function publicFinals(D: any) {
  const pub = new Set((await D.all('game_rows_public?select=id&order=id')).map((r: any) => r.id));
  return (await D.all('games?select=id,finalised_at,competition_id&status=eq.final&order=finalised_at.desc.nullslast,id'))
    .filter((g: any) => pub.has(g.id));
}
const sameMoment = (a: any, b: any) => a != null && b != null && Date.parse(a) === Date.parse(b);

async function buildEventFiles(admin: any, D: any, finals: any[], started: number, maxBuilds: number) {
  const want = new Map(finals.map((g: any) => [g.id, g.finalised_at]));
  const held = new Map((await allAdmin(admin, 'event_files', 'game_id,finalised_at'))
    .map((r: any) => [r.game_id, r.finalised_at]));

  /* newest finals first: the games people are opening now */
  const due = finals.filter((g: any) => !sameMoment(held.get(g.id), g.finalised_at)).map((g: any) => g.id);
  const gone = [...held.keys()].filter(id => !want.has(id));

  let removed = 0;
  const drop = gone.slice(0, MAX_EVENT_REMOVALS);
  if (drop.length) {
    const { error } = await admin.storage.from(BUCKET).remove(drop.map(id => 'events/' + id + '.json'));
    if (error) throw new Error('events remove: ' + error.message);
    const { error: delErr } = await admin.from('event_files').delete().in('game_id', drop);
    if (delErr) throw new Error('event_files delete: ' + delErr.message);
    removed = drop.length;
  }

  let built = 0, next = 0;
  const todo = due.slice(0, maxBuilds);
  const lane = async () => {
    while (next < todo.length && Date.now() - started < WALL_MS) {
      const id = todo[next++];
      const finalisedAt = want.get(id);
      const rows = await D.gameLog(id);
      const { error } = await admin.storage.from(BUCKET).upload('events/' + id + '.json',
        JSON.stringify({ v: 1, game: id, finalised_at: finalisedAt, rows }),
        { contentType: 'application/json', upsert: true, cacheControl: '300' });
      if (error) throw new Error('events/' + id + ': ' + error.message);
      const { error: upErr } = await admin.from('event_files').upsert(
        { game_id: id, finalised_at: finalisedAt, events: rows.length, built_at: new Date().toISOString() },
        { onConflict: 'game_id' });
      if (upErr) throw new Error('event_files ' + id + ': ' + upErr.message);
      built++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(EVENT_LANES, todo.length) }, lane));
  return { built, removed, current: finals.length - due.length,
           left: (due.length - built) + (gone.length - removed) };
}

/* EACH FINISHED GAME'S MINUTES AT EACH POSITION, AS A FILE (0216): snapshots/pos/<game id>.json, written with
   t/depth.js posFile() - the club page's depth chart's own sums - for the games that get an event log, and rewritten
   when a game is finalised again (lineups and box scores are only ever written by finalising). Each five is ranked
   point guard to centre by the players' positions as the page ranks them (depth.js positionOf: the box score's
   estimate on the season line of the game's competition, the roster's listing, the height), from the latest line
   built: a game finalised a moment ago may be ranked by the line from before it, which moves nobody. A batch is forty
   games of one competition: their lineups and box minutes in two reads, the players' heights in one; the files are
   a few hundred bytes. pos_files is the index, as event_files is the logs'. */
const POS_LANES = 6;
const MAX_POS_FILES = 120;           // written per call
const MAX_POS_REMOVALS = 200;        // and removed
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function buildPosFiles(admin: any, D: any, X: any, finals: any[], started: number, maxBuilds: number) {
  const want = new Map(finals.map((g: any) => [g.id, g]));
  const held = new Map((await allAdmin(admin, 'pos_files', 'game_id,finalised_at'))
    .map((r: any) => [r.game_id, r.finalised_at]));
  const due = finals.filter((g: any) => !sameMoment(held.get(g.id), g.finalised_at));
  const gone = [...held.keys()].filter(id => !want.has(id));

  let removed = 0;
  const drop = gone.slice(0, MAX_POS_REMOVALS);
  if (drop.length) {
    const { error } = await admin.storage.from(BUCKET).remove(drop.map(id => 'pos/' + id + '.json'));
    if (error) throw new Error('pos remove: ' + error.message);
    const { error: delErr } = await admin.from('pos_files').delete().in('game_id', drop);
    if (delErr) throw new Error('pos_files delete: ' + delErr.message);
    removed = drop.length;
  }

  /* the batches: forty games of one competition at a time, newest competitions' games first */
  const byComp = new Map<string, any[]>();
  due.slice(0, maxBuilds).forEach((g: any) => {
    const k = g.competition_id || '';
    if (!byComp.has(k)) byComp.set(k, []);
    byComp.get(k)!.push(g);
  });
  const batches: { comp: string, games: any[] }[] = [];
  byComp.forEach((gs, comp) => { for (let i = 0; i < gs.length; i += 40) batches.push({ comp, games: gs.slice(i, i + 40) }); });

  const lines = new Map<string, any>();
  let built = 0;
  for (const b of batches) {
    if (Date.now() - started >= WALL_MS) break;
    const ids = b.games.map((g: any) => g.id).join(',');
    if (b.comp && !lines.has(b.comp)) lines.set(b.comp, await D.latestSeason([b.comp]).catch(() => null));
    const [stints, box] = await Promise.all([
      D.all(`lineup_stints?game_id=in.(${ids})&select=game_id,team_idx,player_ids,dur:stats->dur&order=game_id,id`),
      D.all(`player_game_stats?game_id=in.(${ids})&select=game_id,player_uuid,player_id,team_idx,min:stats->min&order=game_id,team_idx,player_id`)
    ]);
    /* what positionOf reads: the season line's estimate and minutes, the roster's listing (the season file's own
       names, else the register's), the height */
    const pids = [...new Set(stints.flatMap((st: any) => st.player_ids || []).concat(box.map((r: any) => r.player_uuid))
      .filter((id: any) => UUID.test(String(id || ''))))] as string[];
    const height = new Map<string, any>();
    for (let i = 0; i < pids.length; i += 40) {
      (await D.all(`players?id=in.(${pids.slice(i, i + 40).join(',')})&select=id,height_cm`)).forEach((p: any) => height.set(p.id, p.height_cm));
    }
    const meta = pids.length ? await D.playerMeta(pids).catch(() => ({})) : {};
    const line = b.comp ? lines.get(b.comp) : null;
    const row = new Map(((line && line.players) || []).map((p: any) => [p.id, p]));
    const value = new Map<string, number>();
    const valueOf = (id: string) => {
      if (!value.has(id)) value.set(id, X.positionOf({ position: (meta[id] && meta[id].position) || '', height: height.get(id) }, row.get(id)));
      return value.get(id)!;
    };
    const stintsOf = new Map<string, any[]>(), boxOf = new Map<string, any[]>();
    stints.forEach((st: any) => { if (!stintsOf.has(st.game_id)) stintsOf.set(st.game_id, []); stintsOf.get(st.game_id)!.push(st); });
    box.forEach((r: any) => { if (!boxOf.has(r.game_id)) boxOf.set(r.game_id, []); boxOf.get(r.game_id)!.push(r); });

    let next = 0;
    const lane = async () => {
      while (next < b.games.length && Date.now() - started < WALL_MS) {
        const g = b.games[next++];
        const file = X.posFile({ game: g.id, finalised_at: g.finalised_at, stints: stintsOf.get(g.id) || [], lines: boxOf.get(g.id) || [], valueOf });
        const { error } = await admin.storage.from(BUCKET).upload('pos/' + g.id + '.json', JSON.stringify(file),
          { contentType: 'application/json', upsert: true, cacheControl: '300' });
        if (error) throw new Error('pos/' + g.id + ': ' + error.message);
        const { error: upErr } = await admin.from('pos_files').upsert(
          { game_id: g.id, finalised_at: g.finalised_at, players: Object.keys(file.t[0]).length + Object.keys(file.t[1]).length,
            built_at: new Date().toISOString() }, { onConflict: 'game_id' });
        if (upErr) throw new Error('pos_files ' + g.id + ': ' + upErr.message);
        built++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(POS_LANES, b.games.length) }, lane));
  }
  return { built, removed, current: finals.length - due.length,
           left: (due.length - built) + (gone.length - removed) };
}

/* CRESTS, COPIED ONCE (0158). A club's or league's crest that is another site's URL is fetched
   and stored in the public 'crests' bucket as crests/<crestKey(url)>, which is what
   epinoia/config.js asks Storage's image transformation for, at display size. A URL is fetched
   once; one that cannot be copied (dead, not a raster image, over 5 MB) is noted and tried again
   after a week, and pages keep drawing it from its own URL. An SVG is never copied: config.js
   draws those as they are. crestKey is config.js's, character for character (tested). */
const MAX_CRESTS = 40;
const CREST_LANES = 6;
const CREST_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const CREST_MAX_BYTES = 5 * 1024 * 1024;

function crestKey(s: string) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* the URL config.js would transform, or null (a stored upload, an SVG, anything else) */
function crestSource(path: any) {
  if (!path) return null;
  let p = String(path).trim();
  if (p.charAt(0) === '{') {
    try { p = (JSON.parse(p) || {}).url || ''; } catch (_) { return null; }
  }
  return /^https:\/\//i.test(p) && !/\.svg(\?|#|$)/i.test(p) ? p : null;
}

/* what the bytes are, whatever the host said they were */
function rasterType(b: Uint8Array) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 12 && ascii(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii(8, 12))) return 'image/avif';
  return null;
}

async function buildCrests(admin: any, D: any, started: number, maxBuilds: number) {
  const rows = [...await D.all('teams?select=logo_path&logo_path=not.is.null&order=id'),
                ...await D.all('leagues?select=logo_path&logo_path=not.is.null&order=id')];
  const urls = [...new Set(rows.map((r: any) => crestSource(r.logo_path)).filter(Boolean))] as string[];
  const held = new Map((await allAdmin(admin, 'crest_files', 'url,ok,checked_at')).map((r: any) => [r.url, r]));
  const due = urls.filter(u => {
    const h: any = held.get(u);
    return !h || (!h.ok && Date.now() - Date.parse(h.checked_at) > CREST_RETRY_MS);
  });

  let built = 0, failed = 0, next = 0;
  const todo = due.slice(0, maxBuilds);
  const lane = async () => {
    while (next < todo.length && Date.now() - started < WALL_MS) {
      const url = todo[next++];
      const row: any = { url, key: crestKey(url), ok: false, content_type: null, bytes: null, error: null,
                         checked_at: new Date().toISOString() };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10_000);
      try {
        const r = await realFetch(url, { signal: ctl.signal, redirect: 'follow',
          headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif;q=0.9,*/*;q=0.1' } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length > CREST_MAX_BYTES) throw new Error('too big: ' + bytes.length + ' bytes');
        const type = rasterType(bytes);
        if (!type) throw new Error('not a raster image (' + (r.headers.get('content-type') || 'no type') + ')');
        const { error } = await admin.storage.from('crests').upload(row.key, bytes,
          { contentType: type, upsert: true, cacheControl: '604800' });
        if (error) throw new Error('upload: ' + error.message);
        Object.assign(row, { ok: true, content_type: type, bytes: bytes.length });
        built++;
      } catch (e) {
        row.error = String((e as Error)?.message || e).slice(0, 300);
        failed++;
      } finally {
        clearTimeout(timer);
      }
      await admin.from('crest_files').upsert(row, { onConflict: 'url' });
    }
  };
  await Promise.all(Array.from({ length: Math.min(CREST_LANES, todo.length) }, lane));
  return { built, failed, current: urls.length - due.length, left: due.length - built - failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const started = Date.now();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
                             { auth: { persistSession: false } });
  const D = (globalThis as any).EpinoiaData, X = (globalThis as any).EpinoiaDepth;
  try {
    /* what the tick last saw: marking THAT done means a game finalised while this runs
       leaves the two different, and the next tick calls again */
    const { data: tick } = await admin.from('snapshot_ticks').select('fingerprint').eq('id', 1).maybeSingle();
    /* HOME's podiums are built in GitHub Actions (tools/build-stars.mjs): past this worker's budget */
    const stars = 'tools/build-stars.mjs';
    const seasons = await buildSeasons(admin, D, started, MAX_SEASONS);
    /* the event files take what is left of the call: fewer when seasons were rebuilt in it */
    const finals = await publicFinals(D);
    const events = await buildEventFiles(admin, D, finals, started,
      seasons.built ? Math.floor(MAX_EVENT_FILES / 2) : MAX_EVENT_FILES);
    const pos = await buildPosFiles(admin, D, X, finals, started, MAX_POS_FILES);
    const crests = await buildCrests(admin, D, started, MAX_CRESTS);
    const complete = seasons.left === 0 && events.left === 0 && pos.left === 0 && crests.left === 0;
    if (complete) {
      await admin.from('snapshot_ticks').upsert(
        { id: 1, done_fingerprint: tick ? tick.fingerprint : null, done_at: new Date().toISOString() },
        { onConflict: 'id' });
    }
    return json({ stars, seasons, events, pos, crests, complete, ms: Date.now() - started });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e), ms: Date.now() - started }, 500);
  }
});
