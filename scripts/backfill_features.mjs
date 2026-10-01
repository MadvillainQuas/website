/* ============================================================================
   BACKFILL: What wins 2's feature line (game_features) for the games finalised before finalise-game wrote it
   (docs/what-wins-model.md §4.2).

   The same epinoia/features.js the finalise function runs, over the stored log and roster snapshot, read exactly
   as finalise reads them (mapEvents from backfill_situations.mjs, line for line), and upserted as the two rows
   finalise would have written: same layout, same 4 significant figures, the game's own finalised_at.

     node scripts/backfill_features.mjs                     # every final game without its two rows (resumable)
     node scripts/backfill_features.mjs --dry               # work it all out, write nothing
     node scripts/backfill_features.mjs --league <slug>     # one league's games
     node scripts/backfill_features.mjs --since 2026-09-01  # games finalised since a date
     node scripts/backfill_features.mjs --force             # rewrite rows that are already there
     node scripts/backfill_features.mjs --max-minutes 45 --lanes 4
     node scripts/backfill_features.mjs <game-id>           # one game

   Env SUPABASE_URL and SUPABASE_SERVICE_KEY (sent as apikey and Authorization: Bearer). The games come from
   rpc/game_features_missing (500 at a time), or, with --force, --league or --since, every final game keyset by id.
   Lanes read in parallel (4 by default); after --max-minutes (45) it stops taking games and says how far it got, and
   a second run carries on: the missing list only ever shrinks.

   SKIPPED, AND NAMED: a game with no roster snapshot or starters (nothing to replay), no events, or whose replayed
   score is not the score stored on it (its box score was built from another log: re-finalise it, which writes both).

   Importable without side effects: planFeatures() is the pure half, and main() runs only when this file is the one
   node was asked to execute.
   ============================================================================ */
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mapEvents } from './backfill_situations.mjs';

const require = createRequire(import.meta.url);
const E = require('../epinoia/engine.js');
const Sit = require('../epinoia/situations.js');
const F = require('../epinoia/features.js');

/* ------------------------------------------------------------ the pure half --- */

/* finalise-game's game object, from the games row and its mapped log */
export function gameOf(row, events) {
  const snap = (row && row.roster_snapshot) || {};
  return { teams: snap.teams, starters: row && row.starters, events: events || [], period: (row && row.period) || 4, clockMs: 0,
           tipWinner: row && row.tip_winner, arrowInit: row && row.arrow_init };
}

/* What one game needs written: {skip: reason | null, detail, rows, ms}.
     row     the games row (id, status, period, starters, roster_snapshot, competition_id, finalised_at, home_score, away_score)
     events  mapEvents() of its log
     meta    {league_id, season_id, competition_id} of its competition */
export function planFeatures({ row, events, meta }) {
  const out = { skip: null, detail: null, rows: [], ms: 0 };
  const snap = row && row.roster_snapshot;
  if (!snap || !Array.isArray(snap.teams) || snap.teams.length < 2 || !Array.isArray(row.starters) || row.starters.length < 2) { out.skip = 'no roster snapshot or starters'; return out; }
  if (!(events || []).length) { out.skip = 'no events'; return out; }
  if (!meta || !meta.league_id || !meta.season_id) { out.skip = 'no season or league for its competition'; return out; }
  const game = gameOf(row, events);
  const t0 = performance.now();
  let d, TA, C;
  try {
    d = E.deriveGame(game);
    TA = [E.teamAdv(game, d, 0), E.teamAdv(game, d, 1)];
  } catch (e) { out.skip = 'the log does not replay'; out.detail = String(e && e.message || e).slice(0, 160); return out; }
  if (typeof row.home_score === 'number' && typeof row.away_score === 'number' && (d.score[0] !== row.home_score || d.score[1] !== row.away_score)) {
    out.skip = 'replayed score differs';
    out.detail = `the log gives ${d.score[0]}-${d.score[1]}, the game says ${row.home_score}-${row.away_score} -- re-finalise this game`;
    return out;
  }
  try { C = Sit.compute(game); } catch (_) { C = null; }
  const FL = F.extract(game, { d, TA, C: C && C.possessions ? C : null });
  out.ms = performance.now() - t0;
  out.rows = F.toRows(row.id, FL, { league_id: meta.league_id, season_id: meta.season_id, competition_id: row.competition_id,
                                     finalised_at: row.finalised_at || new Date().toISOString() });
  return out;
}

export function parseArgs(argv) {
  const a = { dry: false, force: false, league: null, since: null, maxMinutes: 45, lanes: 4, game: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--dry' || x === '--dry-run') a.dry = true;
    else if (x === '--force') a.force = true;
    else if (x === '--league') a.league = argv[++i] || null;
    else if (x === '--since') a.since = argv[++i] || null;
    else if (x === '--max-minutes') a.maxMinutes = Math.max(1, +argv[++i] || 45);
    else if (x === '--lanes') a.lanes = Math.max(1, Math.min(16, +argv[++i] || 4));
    else if (/^[0-9a-f-]{36}$/i.test(x)) a.game = x.toLowerCase();
  }
  return a;
}

/* ------------------------------------------------------------ the database --- */
async function main() {
  const URL_ = String(process.env.SUPABASE_URL || '').replace(/\/$/, ''), KEY = process.env.SUPABASE_SERVICE_KEY || '';
  if (!URL_ || !KEY) { console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are needed'); process.exit(2); }
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  const A = parseArgs(process.argv.slice(2));
  const started = Date.now(), deadline = started + A.maxMinutes * 60000;
  const q = v => encodeURIComponent(String(v));

  async function get(path) {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(URL_ + '/rest/v1/' + path, { headers: H });
      if (r.ok) return r.json();
      if (attempt < 2 && r.status >= 500) { await new Promise(res => setTimeout(res, 1000 * (attempt + 1))); continue; }
      throw new Error(path.slice(0, 80) + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
    }
  }
  async function rpc(name, body) {
    const r = await fetch(URL_ + '/rest/v1/rpc/' + name, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('rpc ' + name + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r.json();
  }
  async function upsert(rows) {
    const r = await fetch(URL_ + '/rest/v1/game_features?on_conflict=game_id,team_idx',
      { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, H), body: JSON.stringify(rows) });
    if (!r.ok) throw new Error('upsert -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  /* the log, a thousand rows at a time by seq, until a page comes back short (finalise-game's paging) */
  async function events(gameId) {
    const out = [];
    let after = -1;
    for (;;) {
      const page = await get('game_events?game_id=eq.' + q(gameId) + '&select=seq,t,team,pid,period,clock,payload&order=seq&seq=gt.' + after + '&limit=1000');
      out.push(...page);
      if (page.length < 1000) return mapEvents(out);
      after = page[page.length - 1].seq;
    }
  }
  const comps = new Map();
  async function compMeta(id) {
    if (!comps.has(id)) {
      const rows = await get('competitions?id=eq.' + q(id) + '&select=season_id,seasons(league_id)');
      const c = rows[0];
      comps.set(id, c ? { season_id: c.season_id, league_id: c.seasons && c.seasons.league_id } : null);
    }
    return comps.get(id);
  }

  /* ---- which games ---- */
  let compFilter = null;
  if (A.league) {
    const lg = (await get('leagues?slug=eq.' + q(A.league) + '&select=id'))[0];
    if (!lg) { console.error('no league ' + A.league); process.exit(2); }
    const seasons = await get('seasons?league_id=eq.' + lg.id + '&select=id');
    const cs = seasons.length ? await get('competitions?season_id=in.(' + seasons.map(s => s.id).join(',') + ')&select=id') : [];
    compFilter = cs.map(c => c.id);
    if (!compFilter.length) { console.log('the league has no competitions'); return; }
  }
  const keyset = A.force || !!A.league || !!A.since;
  const seen = new Set();
  let lastId = '00000000-0000-0000-0000-000000000000', exhausted = false;
  async function nextBatch() {
    if (exhausted) return [];
    if (A.game) { exhausted = true; return [A.game]; }
    if (!keyset) {
      const ids = (await rpc('game_features_missing', { p_fv: F.FV, p_limit: Math.min(5000, 500 + seen.size) })).map(x => (typeof x === 'string' ? x : x.game_features_missing || x.id));
      const fresh = ids.filter(id => id && !seen.has(id));
      if (!fresh.length) exhausted = true;
      return fresh;
    }
    for (;;) {
      let path = 'games?status=eq.final&competition_id=not.is.null&id=gt.' + lastId + '&order=id&limit=500&select=id';
      if (compFilter) path += '&competition_id=in.(' + compFilter.join(',') + ')';
      if (A.since) path += '&finalised_at=gte.' + q(A.since);
      const page = await get(path);
      if (!page.length) { exhausted = true; return []; }
      lastId = page[page.length - 1].id;
      let ids = page.map(g => g.id).filter(id => !seen.has(id));
      if (!A.force && ids.length) {
        const have = new Map();
        for (let i = 0; i < ids.length; i += 100) {
          const rows = await get('game_features?game_id=in.(' + ids.slice(i, i + 100).join(',') + ')&fv=gte.' + F.FV + '&select=game_id');
          rows.forEach(r => have.set(r.game_id, (have.get(r.game_id) || 0) + 1));
        }
        ids = ids.filter(id => (have.get(id) || 0) < 2);
      }
      if (page.length < 500 && !ids.length) { exhausted = true; return []; }
      if (ids.length) return ids;
    }
  }

  console.log('features backfill: FV ' + F.FV + (A.dry ? ', dry run' : '') + (A.force ? ', forced' : '') + (A.league ? ', league ' + A.league : '') +
              (A.since ? ', since ' + A.since : '') + ', ' + A.lanes + ' lanes, ' + A.maxMinutes + ' min');
  let written = 0, failed = 0, bytes = 0, ms = 0, done = 0, stopped = false;
  const skipped = {};
  const queue = [];
  let refill = null;
  async function lane() {
    for (;;) {
      if (Date.now() > deadline) { stopped = true; return; }
      if (!queue.length) {
        if (exhausted) return;
        /* one lane asks for the next batch at a time; the others wait for the same answer */
        if (!refill) refill = nextBatch().then(b => { b.forEach(id => { if (!seen.has(id)) { seen.add(id); queue.push(id); } }); }).finally(() => { refill = null; });
        await refill;
        if (!queue.length && exhausted) return;
        continue;
      }
      const id = queue.shift();
      try {
        const row = (await get('games?id=eq.' + q(id) + '&select=id,status,period,starters,roster_snapshot,competition_id,finalised_at,home_score,away_score,tip_winner,arrow_init'))[0];
        if (!row || row.status !== 'final') { skipped['not final'] = (skipped['not final'] || 0) + 1; continue; }
        const meta = row.competition_id ? await compMeta(row.competition_id) : null;
        const evs = row.roster_snapshot ? await events(id) : [];
        const plan = planFeatures({ row, events: evs, meta });
        if (plan.skip) {
          skipped[plan.skip] = (skipped[plan.skip] || 0) + 1;
          console.log('  skip ' + id.slice(0, 8) + ': ' + (plan.detail || plan.skip));
          continue;
        }
        ms += plan.ms; bytes += JSON.stringify(plan.rows).length;
        if (!A.dry) await upsert(plan.rows);
        written++;
      } catch (e) {
        failed++;
        console.log('  FAIL ' + id.slice(0, 8) + ': ' + String(e && e.message || e).slice(0, 200));
      } finally {
        done++;
        if (done % 50 === 0) console.log('  ' + done + ' games, ' + written + (A.dry ? ' would be written' : ' written') + ', ' + Math.round((Date.now() - started) / 1000) + ' s');
      }
    }
  }
  await Promise.all(Array.from({ length: A.lanes }, lane));

  const nSkip = Object.values(skipped).reduce((a, b) => a + b, 0);
  console.log('\n' + done + ' games: ' + (A.dry ? 'would write ' : 'wrote ') + written + ' (' + (written * 2) + ' rows, ~' +
              (written ? Math.round(bytes / written / 2) : 0) + ' bytes a row, ' + (written ? (ms / written).toFixed(1) : 0) + ' ms a game to work out)' +
              '; skipped ' + nSkip + (nSkip ? ' (' + Object.entries(skipped).map(([k, v]) => v + ' ' + k).join('; ') + ')' : '') +
              (failed ? '; FAILED ' + failed : '') + '; ' + Math.round((Date.now() - started) / 1000) + ' s');
  if (stopped) console.log('stopped at --max-minutes ' + A.maxMinutes + ': run it again to carry on');
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Features backfill${A.dry ? ' (dry run)' : ''}\n\n| games | ${A.dry ? 'would write' : 'written'} | skipped | failed | ms a game |\n|---|---|---|---|---|\n` +
        `| ${done} | ${written} | ${nSkip} | ${failed} | ${written ? (ms / written).toFixed(1) : '-'} |\n` + (stopped ? '\nStopped at max_minutes: run it again to carry on.\n' : ''));
    } catch (_) { /* the log above says the same */ }
  }
  if (failed) process.exitCode = 1;
}

/* run only when executed, never when imported by a test */
const isMain = (() => {
  if (!process.argv[1]) return false;
  const norm = p => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  try { return norm(fileURLToPath(import.meta.url)) === norm(process.argv[1]); } catch (_) { return false; }
})();
if (isMain) await main();
