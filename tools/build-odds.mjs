/* ============================================================================
   EPINOIΛ'S MODEL OF WHO WINS: THE RUN (epinoia/winodds.js does every number; this file reads and writes).

     SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node tools/build-odds.mjs
     … --worker-config          the URL and key from %APPDATA%\epinoia\worker.json (a local run)
     … --dry-run                read and learn, write nothing; say what would be written
     … --full                   the model from nothing: every finished game in the database, in tip-off order
     … --eval                   with --dry-run --full: how its picks have done, against home-only and Elo
     … --days 14                how far ahead fixtures are given their probability

   ONE RUN, DATA-EFFICIENT: the model's state (analytics/odds/state.json in the private bucket: sixteen weights, a few
   numbers a club and a player) is read; only the What wins feature lines (game_features) finished since its watermark
   are read - keyset on (finalised_at, game_id, team_idx), every league at once - with their games' clubs, scores,
   tip-offs and venues and their player lines (player_game_stats, the named stats keys only); the model predicts each
   game as it stood before it (the RECORD: its pick, made from earlier games only) and then learns it; the fixtures of
   the next DAYS days are predicted; the picks are written to model_picks (0253), the state put back.

   PICKS ARE NEVER MOVED AFTER TIP-OFF: a fixture's row is rewritten each run until its tip-off and frozen from then on
   (model_picks_freeze, 0253); a record row is only ever added, never replaced, so a pick made before the game outranks
   the one worked out after it. A game that arrives late (more than two days older than the newest the model has seen)
   is learned but not recorded: the model has already seen games played after it.
   ============================================================================ */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const Odds = require(path.join(ROOT, 'epinoia', 'winodds.js'));
const Features = require(path.join(ROOT, 'epinoia', 'features.js'));
/* the state is Odds.pack()'s, gzipped (about a sixth of the JSON); the bucket takes application/json only, so it goes up
   labelled so and is told apart on the way back by gzip's first two bytes */
const BUCKET = 'analytics', STATE_PATH = 'odds/state.v' + Odds.V + '.json.gz';
const DAY = 86400000, LATE_MS = 2 * DAY, KEEP_MS = 420 * DAY;
/* nine numbers of each feature line (f->i), not the line's hundred and more */
const FEATURE_SELECT = 'game_id,team_idx,league_id,season_id,finalised_at,' + Odds.lineSelect(Features.INDEX);
const GAME_SELECT = 'id,status,home_team_id,away_team_id,home_score,away_score,tipoff_at,venue_id';
/* a player line: the club side, the player (player_id: the player's uuid once resolved, the feed's id before) and the
   named stats keys the model reads, never the blob */
const PGS_SELECT = 'game_id,team_idx,player_id,' + ['min', 'pts', 'p2a', 'p2m', 'p3a', 'p3m', 'fta', 'ftm', 'or', 'dr', 'ast', 'stl', 'blk', 'to', 'pf'].map(k => k + ':stats->' + k).join(',');
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const qv = v => '"' + String(v).replace(/"/g, '\\"') + '"';
const r4 = v => Math.round(v * 1e4) / 1e4;

/* PostgREST and Storage with the service key */
export function client(url, key, f) {
  const base = String(url).replace(/\/+$/, ''), hdr = { apikey: key, Authorization: 'Bearer ' + key };
  const fetchFn = f || fetch;
  const rest = async (p, init) => {
    const r = await fetchFn(base + '/rest/v1/' + p, Object.assign({}, init, { headers: Object.assign({ Accept: 'application/json' }, hdr, (init || {}).headers || {}) }));
    if (!r.ok) { const e = new Error(p.split('?')[0] + ': ' + r.status + ' ' + String(await r.text()).slice(0, 200)); e.status = r.status; throw e; }
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  const enc = p => p.split('/').map(encodeURIComponent).join('/');
  /* JSON, gzipped or not (gzip's first two bytes, 1f 8b, tell them apart) */
  const download = async (bucket, p) => {
    const r = await fetchFn(base + '/storage/v1/object/' + bucket + '/' + enc(p), { headers: hdr });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error('download ' + p + ': ' + r.status);
    const b = Buffer.from(await r.arrayBuffer());
    if (!b.length) return null;
    return JSON.parse((b[0] === 0x1f && b[1] === 0x8b ? zlib.gunzipSync(b) : b).toString('utf8'));
  };
  const upload = async (bucket, p, body) => {
    const r = await fetchFn(base + '/storage/v1/object/' + bucket + '/' + enc(p), { method: 'POST', body,
      headers: Object.assign({ 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'private, no-store' }, hdr) });
    if (!r.ok) throw new Error('upload ' + p + ': ' + r.status + ' ' + String(await r.text()).slice(0, 200));
  };
  return { rest, download, upload };
}

/* the feature lines after a watermark, every league, 1000 a page */
export async function readLines(api, wm) {
  const out = [];
  let at = wm && wm.at, id = wm && wm.id, ti = wm && wm.ti != null ? wm.ti : null;
  for (;;) {
    const after = !at ? '' : '&or=' + encodeURIComponent('(finalised_at.gt.' + qv(at) + ',and(finalised_at.eq.' + qv(at) + ',game_id.gt.' + id + ')' +
      (ti != null ? ',and(finalised_at.eq.' + qv(at) + ',game_id.eq.' + id + ',team_idx.gt.' + ti + ')' : '') + ')');
    const rows = await api.rest('game_features?fv=eq.' + Features.FV + '&select=' + FEATURE_SELECT + after + '&order=finalised_at,game_id,team_idx&limit=1000');
    out.push(...(rows || []));
    if (!rows || rows.length < 1000) return out;
    const last = rows[rows.length - 1];
    at = last.finalised_at; id = last.game_id; ti = last.team_idx;
  }
}
/* the games of those lines, each with both sides' counts: the model's input */
export async function readGames(api, lines) {
  const by = new Map();
  lines.forEach(r => { const g = by.get(r.game_id) || { lg: r.league_id, s: r.season_id, c: [null, null] }; g.c[r.team_idx] = Odds.countsOfRow(r); by.set(r.game_id, g); });
  const out = [];
  for (const c of chunks(Array.from(by.keys()), 150)) {
    const rows = (await api.rest('games?id=in.(' + c.join(',') + ')&select=' + GAME_SELECT)) || [];
    rows.forEach(g => {
      const x = by.get(g.id);
      if (!x || g.status !== 'final' || !x.c[0] || !x.c[1] || g.home_score == null || g.away_score == null || !g.tipoff_at) return;
      out.push({ id: g.id, h: g.home_team_id, a: g.away_team_id, lg: x.lg, s: x.s, t: Date.parse(g.tipoff_at), v: g.venue_id || null,
                 hs: +g.home_score, as: +g.away_score, c: x.c, pl: [] });
    });
  }
  /* the player lines of those games (the named stats keys, never the blob): the positions' input */
  const at = new Map(out.map(g => [g.id, g]));
  for (const c of chunks(out.map(g => g.id), 40)) {
    for (let off = 0; ; off += 1000) {
      const rows = (await api.rest('player_game_stats?game_id=in.(' + c.join(',') + ')&select=' + PGS_SELECT + '&order=game_id,team_idx,player_id&limit=1000&offset=' + off)) || [];
      rows.forEach(r => { const g = at.get(r.game_id); if (g && r.player_id && (r.team_idx === 0 || r.team_idx === 1)) g.pl.push(Odds.lineOf(r.player_id, r.team_idx, r)); });
      if (rows.length < 1000) break;
    }
  }
  return out;
}
/* the fixtures to come: scheduled, tipping off between now and `days` ahead */
export async function readFixtures(api, now, days) {
  const out = [];
  const from = new Date(now).toISOString(), to = new Date(now + days * DAY).toISOString();
  for (let off = 0; ; off += 1000) {
    const rows = (await api.rest('games?status=eq.scheduled&tipoff_at=gt.' + from + '&tipoff_at=lte.' + to +
      '&select=id,home_team_id,away_team_id,tipoff_at,venue_id,competitions(season_id,seasons(league_id))&order=tipoff_at,id&limit=1000&offset=' + off)) || [];
    rows.forEach(g => {
      const co = g.competitions || {}, se = co.seasons || {};
      if (!g.home_team_id || !g.away_team_id || !co.season_id || !se.league_id) return;
      out.push({ id: g.id, h: g.home_team_id, a: g.away_team_id, lg: se.league_id, s: co.season_id, t: Date.parse(g.tipoff_at), v: g.venue_id || null });
    });
    if (rows.length < 1000) return out;
  }
}
/* the state as it is kept: packed, gzipped */
export const packed = (S, now) => zlib.gzipSync(JSON.stringify(Odds.pack(S, { keepAfter: now - KEEP_MS })), { level: 9 });
/* a pick as written (its side, `pick`, is the table's own, generated from p_home) */
const pickRow = (g, pre, kind) => ({ game_id: g.id, league_id: g.lg, p_home: r4(pre.p), kind,
  n_home: pre.n[0], n_away: pre.n[1], margin: Math.round(pre.margin * 10) / 10, sigma: Math.round(pre.sigma * 10) / 10, model: Odds.MODEL });

export async function run(api, o) {
  const now = o.now || Date.now(), log = o.log || console.log;
  const out = { learned: 0, records: 0, fixtures: 0, late: 0, wrote: { records: 0, fixtures: 0 }, warnings: [] };
  let S = o.full ? null : await api.download(BUCKET, STATE_PATH).catch(() => null);
  S = S ? Odds.unpack(S) : null;
  const fresh = !S || !S.wm;
  if (!S) S = Odds.create();
  const lines = await readLines(api, fresh ? null : S.wm);
  const games = await readGames(api, lines);
  const lastSeen = S.lastT || 0;
  const recs = Odds.walk(S, games, { late: g => !fresh && lastSeen && g.t < lastSeen - LATE_MS });
  out.learned = recs.length;
  if (lines.length) { const L = lines[lines.length - 1]; S.wm = { at: L.finalised_at, id: L.game_id, ti: L.team_idx }; }
  const recordRows = recs.filter(r => r.pre.ok && !r.late).map(r => pickRow(r.game, r.pre, 'record'));
  out.records = recordRows.length; out.late = recs.filter(r => r.late).length;
  const fixtures = await readFixtures(api, now, o.days || 14);
  const fixtureRows = [];
  fixtures.forEach(fx => { const pre = Odds.predict(S, fx); if (pre.ok) fixtureRows.push(pickRow(fx, pre, 'fixture')); });
  out.fixtures = fixtureRows.length; out.fixturesSeen = fixtures.length;
  out.summary = Odds.summary(S);
  if (o.eval) out.eval = evaluate(recs);
  if (o.dryRun) { log('dry run: nothing written'); return out; }
  /* the picks: records only added (a pick made before the game is never replaced), fixtures rewritten until tip-off */
  try {
    for (const c of chunks(recordRows, 500)) {
      await api.rest('model_picks?on_conflict=game_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(c) });
      out.wrote.records += c.length;
    }
    for (const c of chunks(fixtureRows, 500)) {
      await api.rest('model_picks?on_conflict=game_id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(c) });
      out.wrote.fixtures += c.length;
    }
  } catch (e) {
    /* before migration 0253 the table is not there: the model still learns and keeps its state */
    if (e.status === 404 || /PGRST205|model_picks/.test(String(e.message))) out.warnings.push('model_picks is not there yet (apply migration 0253): no picks written');
    else throw e;
  }
  /* the state only goes back when the run learned something */
  if (recs.length || fresh) await api.upload(BUCKET, STATE_PATH, packed(S, now));
  return out;
}

/* how its record picks did, against home-only (the running home win share) and Elo (its own ratings, 60 points home) */
export function evaluate(recs) {
  const ok = recs.filter(r => r.pre.ok && r.game.hs !== r.game.as);
  let hw = 0, hn = 0;
  const acc = { model: [0, 0], home: [0, 0], elo: [0, 0] };
  const add = (k, p, won) => { acc[k][0] += (p - won) ** 2; acc[k][1] += (p >= 0.5) === (won === 1) ? 1 : 0; };
  ok.forEach(r => {
    const won = r.game.hs > r.game.as ? 1 : 0;
    add('model', r.pre.p, won);
    add('home', hn ? hw / hn : 0.6, won);
    add('elo', 1 / (1 + Math.pow(10, -(r.pre.x[5] * 100 + 60 * r.pre.home) / 400)), won);
    if (r.pre.home) { hn++; hw += won; }
  });
  const n = ok.length, f = k => ({ brier: n ? r4(acc[k][0] / n) : null, right: n ? r4(acc[k][1] / n) : null });
  return { n, model: f('model'), home: f('home'), elo: f('elo') };
}

async function main() {
  const argv = process.argv.slice(2), has = k => argv.includes(k), val = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  let url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (has('--worker-config')) {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || '', 'epinoia', 'worker.json'), 'utf8'));
    url = url || cfg.supabase_url; key = key || cfg.service_key;
  }
  if (!url || !key) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing'); process.exit(2); }
  const t0 = Date.now();
  const out = await run(client(url, key), { dryRun: has('--dry-run'), full: has('--full'), eval: has('--eval'), days: +val('--days', 14) });
  const s = out.summary;
  console.log('learned ' + out.learned + ' games (' + out.late + ' late), ' + out.records + ' record picks, ' + out.fixtures + ' of ' + out.fixturesSeen + ' fixtures; '
    + 'wrote ' + out.wrote.records + ' + ' + out.wrote.fixtures + '; ' + Math.round((Date.now() - t0) / 100) / 10 + ' s');
  console.log('model: ' + s.games + ' games, judged ' + s.judged + ', right ' + (s.right == null ? '–' : (100 * s.right).toFixed(1) + '%') + ', Brier ' + (s.brier == null ? '–' : s.brier.toFixed(4)) +
    ', sigma ' + s.sigma.toFixed(1) + ', cal ' + s.cal.map(v => v.toFixed(3)).join('/') + ', w ' + JSON.stringify(Object.fromEntries(Object.entries(s.w).map(([k, v]) => [k, +v.toFixed(3)]))));
  if (out.eval) console.log('eval (record games): ' + JSON.stringify(out.eval));
  out.warnings.forEach(w => console.log('warning: ' + w));
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## EPINOIA model\n\n' + out.learned + ' games learned, ' + out.records + ' record picks, ' + out.fixtures + ' fixtures; right ' +
      (s.right == null ? '–' : (100 * s.right).toFixed(1) + '%') + ' of ' + s.judged + ', Brier ' + (s.brier == null ? '–' : s.brier.toFixed(4)) + '\n' + out.warnings.map(w => '\n- ' + w).join('') + '\n'); } catch (_) { /* not in Actions */ }
  }
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
