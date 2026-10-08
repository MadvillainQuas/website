/* ============================================================================
   SIMILAR PLAYERS, BUILT - one small file for every player-season that can be compared.

     node tools/build-similar.mjs --out <dir>              read the public data, write the files to <dir>
     node tools/build-similar.mjs --out <dir> --report     ...and print the scale and a few examples
     SUPABASE_SERVICE_KEY=… node tools/build-similar.mjs --upload     ...and put them in the public 'snapshots' bucket
     … --only <competition id,…>                           only those competitions' players get a file (the pool is whole)
     … --no-pos                                            skip the per-game position files (position shares sit out)

   WHY HERE, AND WHY FILES. The profile page ranks a player against their own competition from one season file. A match
   across EVERY competition needs every season file, so no page can do it: a visit would read sixty-odd files to
   answer a question that has one answer. This works out each player's twelve nearest once (epinoia/similar.js has
   the rules), and a page reads the one file that is theirs: about 5 KB, nothing to sum.

   WHAT IT READS, all of it public and as a signed-out reader (a members-only league has no file and is not here):
     * public.snapshots: the index of the season files; each competition's file (the player lines, names, clubs);
     * public.competitions: its name, season and league (the labels, as the season chips read them: seasonbar.js);
     * public.lineup_stints: each game's lineups, for the share of minutes at PG..C (cached in .cache/).
   The service key is only used to write, and only with --upload.

   WHERE A FILE GOES: snapshots/similar/v<VERSION>/<competition id>/<player id>.json (epinoia/similar.js filePath).
   A new layout is a new path, so a browser's copy of an old file is never read as a new one. Files are written with a
   short cache time: they change as the games come in.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIM = require(path.join(ROOT, 'epinoia', 'similar.js'));
const SB = require(path.join(ROOT, 'epinoia', 'seasonbar.js'));

const PUBLISHABLE = 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO';   // epinoia/config.js publishes it
const URL_ = (process.env.SUPABASE_URL || 'https://hhvofgqqadtyvcjudhjx.supabase.co').replace(/\/$/, '');
const BUCKET = 'snapshots';
const SEASON_FILE_LAYOUT = 3;           // data.js SEASON_FILE_V: the layout unpack() below reads

const argv = process.argv.slice(2);
const flag = n => argv.includes('--' + n);
const opt = n => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const OUT = opt('out');
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
const UPLOAD = flag('upload');
if (!OUT && !UPLOAD) { console.error('give --out <dir> and/or --upload'); process.exit(2); }

const get = async (url, headers) => {
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(url, { headers: headers || { apikey: PUBLISHABLE } });
      if (r.status === 404 || r.status === 400) return null;      // a storage object that is not there answers 400
      if (r.ok) return r;
    } catch (_) { /* again */ }
    await new Promise(res => setTimeout(res, 400 * (t + 1)));
  }
  return null;
};
const getJson = async url => { const r = await get(url); return r ? r.json() : null; };

/* data.js unpack, the layout of a season file's columns */
function unpack(p) {
  if (!p) return [];
  if (Array.isArray(p)) return p;
  const k = p.k || [], x = p.x || {};
  return (p.v || []).map((vals, i) => {
    const r = {}, skip = x[i] ? new Set(x[i]) : null;
    for (let j = 0; j < k.length; j++) if (!skip || !skip.has(j)) r[k[j]] = vals[j];
    return r;
  });
}
function unpackMap(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.i) || !p.c || !Array.isArray(p.c.k)) return p || {};
  const rows = unpack(p.c), out = {};
  p.i.forEach((id, n) => { out[id] = rows[n]; });
  return out;
}

async function pool(items, lanes, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

/* ---- 1. the competitions' season files ---- */
console.log('reading the season index ...');
const index = await getJson(`${URL_}/rest/v1/snapshots?select=key,competition_id,data&key=like.season:*&limit=2000`) || [];
const units = index.filter(r => r.competition_id && !String(r.key).includes(',') && r.data && r.data.file);
const wrongLayout = units.filter(r => !String(r.data.file).split('/').pop().startsWith('v' + SEASON_FILE_LAYOUT + '-'));
if (wrongLayout.length) { console.error(wrongLayout.length + ' season file(s) are not layout v' + SEASON_FILE_LAYOUT + ': this builder reads an older layout; update unpack()'); process.exit(1); }
const compIds = units.map(r => r.competition_id);

const comps = new Map();
for (let i = 0; i < compIds.length; i += 40) {
  const rows = await getJson(`${URL_}/rest/v1/competitions?id=in.(${compIds.slice(i, i + 40).join(',')})&select=id,name,kind,seasons(id,name,starts_on,leagues(name,slug,initials))`) || [];
  rows.forEach(c => comps.set(c.id, c));
}
/* each competition as a reader names it within its season (SLB, SLB Cup, EuroCup) */
const bySeason = new Map();
comps.forEach(c => { const k = (c.seasons && c.seasons.id) || c.id; if (!bySeason.has(k)) bySeason.set(k, []); bySeason.get(k).push(c); });
const compLabel = new Map();
bySeason.forEach(list => {
  const labs = SB.compLabels ? SB.compLabels(list.map(c => ({ id: c.id, name: c.name, kind: c.kind, league: (c.seasons && c.seasons.leagues) || '' }))) : new Map();
  list.forEach(c => compLabel.set(c.id, labs.get(c.id) || c.name || ''));
});

const lines = [];       // every comparable player-season
const games = [];       // { comp, id, home, away }: the games, for the position files
const seasonByComp = new Map();
await pool(units, 8, async u => {
  const j = await getJson(`${URL_}/storage/v1/object/public/${BUCKET}/${String(u.data.file).split('/').map(encodeURIComponent).join('/')}`);
  if (!j || !j.data) { console.warn('  no file for', u.competition_id); return; }
  const d = j.data, rows = unpack(d.players), meta = unpackMap(d.meta), teamOf = new Map(d.teamOfPlayer || []);
  const teams = new Map(unpack(d.teams).map(t => [t.id, t]));
  seasonByComp.set(u.competition_id, { rows, meta, teamOf, teams, games: d.games || [] });
});
units.forEach(u => { const S = seasonByComp.get(u.competition_id); if (S) S.games.forEach(g => games.push({ comp: u.competition_id, id: g.id })); });
console.log(`${seasonByComp.size} competitions, ${games.length} games`);

/* ---- 2. the minutes at each position, from the games' lineups ----
   The same rule the club page and the profile use when a game has no position file (t/depth.js): in every stint the five
   on the floor are ranked by where each plays (positionOf: the season line's estimate, the listing) and the lowest
   spends the stint at PG, the next at SG ... the highest at C. A game's stints never change once it is final, so
   each game is kept in .cache/ after the first read. */
const posSec = new Map();      // comp|player -> [5] seconds
if (!flag('no-pos')) {
  console.log('reading the lineups ...');
  globalThis.EpinoiaSeason = require(path.join(ROOT, 'epinoia', 'season.js'));
  const DEPTH = require(path.join(ROOT, 'epinoia', 't', 'depth.js'));
  const cache = path.join(ROOT, '.cache', 'similar-stints');
  fs.mkdirSync(cache, { recursive: true });
  const byGame = new Map();          // game id -> [{ team_idx, player_ids, dur }]
  const need = [];
  games.forEach(g => {
    try { byGame.set(g.id, JSON.parse(fs.readFileSync(path.join(cache, g.id + '.json'), 'utf8'))); } catch (_) { need.push(g.id); }
  });
  const chunks = [];
  for (let i = 0; i < need.length; i += 8) chunks.push(need.slice(i, i + 8));
  await pool(chunks, 6, async ids => {
    const got = new Map(ids.map(id => [id, []]));
    for (let off = 0; ; off += 1000) {
      const rows = await getJson(`${URL_}/rest/v1/lineup_stints?game_id=in.(${ids.join(',')})&select=game_id,team_idx,player_ids,dur:stats->dur&order=game_id,team_idx,id&limit=1000&offset=${off}`);
      if (!rows) break;
      rows.forEach(r => { if (got.has(r.game_id)) got.get(r.game_id).push({ team_idx: r.team_idx, player_ids: r.player_ids, dur: r.dur }); });
      if (rows.length < 1000) break;
    }
    got.forEach((list, id) => { byGame.set(id, list); fs.writeFileSync(path.join(cache, id + '.json'), JSON.stringify(list)); });
  });
  let withStints = 0;
  games.forEach(g => {
    const st = byGame.get(g.id);
    if (!st || !st.length) return;
    const S = seasonByComp.get(g.comp);
    const rowOf = new Map(S.rows.map(r => [r.id, r]));
    const valueOf = id => { const m = S.meta[id] || {}; return DEPTH.positionOf({ position: m.position || '', height: m.height }, rowOf.get(id)); };
    const fp = DEPTH.floorPos(st, null, valueOf);
    if (!fp) return;
    withStints++;
    fp.players.forEach(p => {
      const k = g.comp + '|' + p.id;
      if (!posSec.has(k)) posSec.set(k, [0, 0, 0, 0, 0]);
      const s = posSec.get(k);
      for (let i = 0; i < 5; i++) s[i] += p.min[i] * 60;
    });
  });
  console.log(`  ${withStints} of ${games.length} games have lineups`);
}

/* ---- 3. the pool ---- */
const POS_KEYS = ['pos_pg', 'pos_sg', 'pos_sf', 'pos_pf', 'pos_c'];
const people = [];
seasonByComp.forEach((S, compId) => {
  const c = comps.get(compId) || {}, sn = c.seasons || {};
  S.rows.forEach(r => {
    if (!SIM.eligible(r)) return;
    const row = Object.assign({}, r);
    const s = posSec.get(compId + '|' + r.id);
    const tot = s ? s.reduce((a, b) => a + b, 0) : 0;
    POS_KEYS.forEach((k, i) => { row[k] = tot >= 300 ? Math.round(1000 * s[i] / tot) / 10 : null; });   // five minutes of floor time to speak of
    const m = S.meta[r.id] || {};
    const team = S.teams.get(S.teamOf.get(r.id) || r._teamId) || {};
    people.push({
      comp: compId, id: r.id, row,
      nm: m.name || '', tm: m.teamShort || team.short_name || m.teamName || '', ps: m.position || '',
      cp: compLabel.get(compId) || c.name || '', ss: SB.label ? SB.label(sn.name) : (sn.name || '')
    });
  });
});
console.log(`${people.length} comparable player-seasons`);
const named = people.filter(p => p.nm);
if (named.length < people.length) console.warn(`  ${people.length - named.length} have no name in their season file and are left out`);
const P = named;

const prep = SIM.prepare(P.map(p => p.row));
const tau = SIM.calibrate(prep);
console.log('tau', JSON.stringify(tau, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v)));

/* ---- 4. each player's neighbours, and the files ---- */
/* the pool's mean and spread of each feature, as the file keeps a value: where a marker sits on a feature's scale */
const STATS = prep.stats.map((s, i) => [Math.round(s.mean * SIM.FEATURES[i].mul), Math.round(s.sd * SIM.FEATURES[i].mul)]);
const nameKeys = P.map(p => SIM.nameKey(p.nm));
const files = [];
const t0 = Date.now();
P.forEach((p, i) => {
  if (ONLY && !ONLY.has(p.comp)) return;
  /* neither himself, nor the same person under another competition's profile */
  const near = SIM.nearest(prep, i, SIM.NEIGHBOURS, j => P[j].id === p.id || nameKeys[j] === nameKeys[i]);
  files.push({
    path: SIM.filePath(p.comp, p.id),
    body: {
      v: SIM.VERSION, pool: P.length,
      st: STATS,
      me: { nm: p.nm, vals: SIM.pack(p.row), gp: p.row.gp || 0, min: Math.round(p.row.min || 0) },
      n: near.map(x => {
        const q = P[x.j];
        return {
          c: q.comp, p: q.id, nm: q.nm, tm: q.tm, cp: q.cp, ss: q.ss, ps: q.ps, gp: q.row.gp || 0, min: Math.round(q.row.min || 0),
          s: SIM.percent(x.d, tau.all),
          g: SIM.GROUPS.map(gr => SIM.percent(x.g[gr.key], tau[gr.key])),
          vals: SIM.pack(q.row)
        };
      })
    }
  });
});
console.log(`${files.length} files in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const sizes = files.map(f => JSON.stringify(f.body).length).sort((a, b) => a - b);
console.log(`file size: median ${sizes[sizes.length >> 1]} B, largest ${sizes[sizes.length - 1]} B, total ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB`);

if (flag('report')) {
  const cov = SIM.FEATURES.map((f, i) => f.k + ' ' + Math.round(100 * P.filter(p => p.row[f.k] != null).length / P.length) + '%');
  console.log('coverage of each measure over the pool:\n  ' + cov.join('\n  '));
  const hist = new Array(10).fill(0);
  files.forEach(f => f.body.n.forEach(n => { hist[Math.min(9, Math.floor(n.s / 10))]++; }));
  console.log('neighbour match % by tens:', hist.join(' '));
  files.slice(0, 40).filter((_, i) => i % 8 === 0).forEach(f => {
    console.log(`\n${f.body.me.nm} (${f.path.split('/')[2].slice(0, 8)})`);
    f.body.n.slice(0, 4).forEach(n => console.log(`   ${String(n.s).padStart(2)}%  ${n.nm}  ${n.tm}  ${n.cp} ${n.ss}  [style ${n.g[0]} eff ${n.g[1]} def ${n.g[2]}]`));
  });
}

if (OUT) {
  for (const f of files) {
    const p = path.join(OUT, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(f.body));
  }
  console.log('written to', OUT);
}

/* ---- 5. upload (never the page's key: the service key writes, and only here) ---- */
if (UPLOAD) {
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!KEY) { console.error('--upload needs SUPABASE_SERVICE_KEY'); process.exit(2); }
  let ok = 0, bad = 0;
  await pool(files, 12, async f => {
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${f.path}`, {
          method: 'POST', body: JSON.stringify(f.body),
          headers: { Authorization: 'Bearer ' + KEY, apikey: KEY, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=3600' }
        });
        if (r.ok) { ok++; return; }
      } catch (_) { /* again */ }
      await new Promise(res => setTimeout(res, 500 * (t + 1)));
    }
    bad++;
  });
  console.log(`uploaded ${ok}, failed ${bad}`);
  if (bad) process.exit(1);
}
