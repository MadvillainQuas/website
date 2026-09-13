/* ============================================================================
   BACKFILL: the situations line (stats.sit) on every finalised game.

   finalise-game now stores what second chances, breaks, turnovers, timeouts
   and half-court sets turned into -- a compact line from epinoia/situations.js
   under `sit` on every player_game_stats and team_game_stats row. The games
   finalised before that carry nothing, and the season tables count a team's
   coverage from exactly that key, so without this they would simply be missing
   from every events split. This replays them: the same situations.js the game
   page and the finalise function run, over the stored log and roster snapshot,
   and only `sit` is written -- every other key on a row is sent back as it was.

     node scripts/backfill_situations.mjs              # every final game
     node scripts/backfill_situations.mjs --dry        # count, change nothing
     node scripts/backfill_situations.mjs <game-id>    # one game
     node scripts/backfill_situations.mjs --force      # rewrite lines that are already right

   THE LOG IS READ EXACTLY AS finalise-game READS IT: paged by seq, each row
   {id: seq, seq, t, team, pid, period, clock, ...payload} with the payload
   winning. (backfill_player_misc.mjs lets the columns win, which is harmless for
   the four points it writes; a situation reads team and pid on every action, so
   here the two paths must be the same path.)

   WHAT IT REFUSES, AND WHY. A game with no stats rows (an adapter that stores
   finals without a log), no roster snapshot or no events is skipped: there is
   nothing to hang a line on, or nothing to work one out from, and an all-zero
   line would count as a covered game of zeros. A game whose log no longer adds
   up to the score stored on its team rows is skipped too and named -- its box
   score was built from a different log (edited since, or read short before
   finalise paged the log), so a line written from today's log would disagree
   with the numbers beside it. Re-finalise those; that writes both.

   A PLAYER WHO DID NOTHING HAS NO LINE, so a player row still carrying a `sit`
   the replay no longer gives him has it removed rather than left stale.

   Lines are compared as values, not as text: jsonb hands keys back in its own
   order, so a byte comparison would call every stored line changed.

   Sequential per game and per row, so the database sees one request at a time.
   The service key comes from the worker's own config
   (%APPDATA%\epinoia\worker.json), the same place every other repair reads it
   from; it never lives in the repo.

   Importable without side effects: the pure half (mapEvents, planGame, sameSit)
   is exported for supabase/tests/situations-store.test.mjs, and main() runs only
   when this file is the one node was asked to execute.
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Sit = require('../epinoia/situations.js');

/* ------------------------------------------------------------ the pure half --- */

/* finalise-game's mapping, line for line: the payload is spread last and wins */
export function mapEvents(rows) {
  return (rows || []).map(r =>
    ({ id: r.seq, seq: r.seq, t: r.t, team: r.team, pid: r.pid, period: r.period, clock: r.clock, ...(r.payload ?? {}) }));
}

/* a value with its object keys in one order, so two equal lines stringify alike */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach(k => { o[k] = canon(v[k]); });
    return o;
  }
  return v;
}
export const sameSit = (a, b) => JSON.stringify(canon(a === undefined ? null : a)) === JSON.stringify(canon(b === undefined ? null : b));

/* PostgREST filter values: a pid is a uuid on a platform game, a local label on an ad-hoc one */
const q = v => encodeURIComponent(String(v));

/* What one game needs written.
     game        the games row: { id, roster_snapshot }
     events      mapEvents() of its log
     playerRows  player_game_stats rows: { player_id, team_idx, stats }
     teamRows    team_game_stats rows: { team_idx, stats }
   Returns { skip: reason|null, detail?, patches: [{ kind, key, action, path, body }] }, where
   action is 'set' (write the line) or 'remove' (take a stale line off a player). `force`
   rewrites lines that are already right; a row that should carry no line and carries
   none is left alone either way, since there is nothing to write to it. */
export function planGame({ game, events, playerRows, teamRows, force = false }) {
  const out = { skip: null, detail: null, patches: [] };
  const snap = game && game.roster_snapshot;
  if (!snap || !Array.isArray(snap.teams) || snap.teams.length < 2) { out.skip = 'no roster snapshot'; return out; }
  if (!(playerRows || []).length && !(teamRows || []).length) { out.skip = 'no stats rows'; return out; }
  if (!(events || []).length) { out.skip = 'no events'; return out; }

  /* compute reads only the teams and the log; the rest of finalise's game object is the engine's */
  const C = Sit.compute({ teams: snap.teams, events });
  if (!C.possessions) { out.skip = 'possessions.js did not load'; return out; }
  const St = Sit.toStored(C);

  for (const row of teamRows || []) {
    const t = row.team_idx;
    if (t !== 0 && t !== 1) continue;
    const cur = row.stats || {};
    const pts = St.teams[t].all[Sit.FIELDS.indexOf('pts')];
    if (typeof cur.score === 'number' && cur.score !== pts) {
      out.skip = 'log and box score disagree';
      out.detail = `the log gives team ${t} ${pts} points, its stored box score ${cur.score} -- re-finalise this game`;
      return out;
    }
  }

  for (const row of teamRows || []) {
    const t = row.team_idx;
    if (t !== 0 && t !== 1) continue;
    const cur = row.stats || {};
    const want = St.teams[t];
    if (!force && sameSit(cur.sit, want)) continue;
    out.patches.push({ kind: 'team', key: t, action: 'set',
                       path: 'team_game_stats?game_id=eq.' + q(game.id) + '&team_idx=eq.' + t,
                       body: { stats: Object.assign({}, cur, { sit: want }) } });
  }

  for (const row of playerRows || []) {
    const cur = row.stats || {};
    const want = St.players[row.player_id];
    const path = 'player_game_stats?game_id=eq.' + q(game.id) + '&player_id=eq.' + q(row.player_id);
    if (want === undefined) {
      if (!Object.prototype.hasOwnProperty.call(cur, 'sit')) continue;     // nothing to write, nothing stale
      const stats = Object.assign({}, cur);
      delete stats.sit;
      out.patches.push({ kind: 'player', key: row.player_id, action: 'remove', path, body: { stats } });
      continue;
    }
    if (!force && sameSit(cur.sit, want)) continue;
    out.patches.push({ kind: 'player', key: row.player_id, action: 'set', path,
                       body: { stats: Object.assign({}, cur, { sit: want }) } });
  }
  return out;
}

/* ------------------------------------------------------------ the database --- */
async function main() {
  const cfg = JSON.parse(readFileSync(join(process.env.APPDATA, 'epinoia', 'worker.json'), 'utf8'));
  const URL_ = cfg.supabase_url.replace(/\/$/, ''), KEY = cfg.service_key;
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const force = args.includes('--force');
  const only = args.find(a => /^[0-9a-f-]{36}$/i.test(a));

  /* a thousand rows a page, the PostgREST cap, until a page comes back short */
  async function get(path) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const r = await fetch(URL_ + '/rest/v1/' + path, { headers: Object.assign({ Range: from + '-' + (from + 999) }, H) });
      if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const rows = await r.json();
      out.push(...rows);
      if (rows.length < 1000) return out;
    }
  }
  async function patch(path, body) {
    const r = await fetch(URL_ + '/rest/v1/' + path, { method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, H), body: JSON.stringify(body) });
    if (!r.ok) throw new Error('patch ' + path + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
  }
  const pause = ms => new Promise(res => setTimeout(res, ms));

  /* id breaks tipoff_at ties, so a page boundary cannot skip or repeat a game */
  const games = await get('games?status=eq.final&select=id,roster_snapshot' + (only ? '&id=eq.' + only : '') + '&order=tipoff_at,id');
  console.log(games.length + ' finalised game' + (games.length === 1 ? '' : 's') + (dry ? ' (dry run)' : '') + (force ? ' (forced)' : ''));

  let touched = 0, playerPatched = 0, teamPatched = 0, removed = 0, failed = 0;
  const skipped = {};
  for (const g of games) {
    const id8 = g.id.slice(0, 8);
    try {
      let plan;
      const snap = g.roster_snapshot;
      if (!snap || !Array.isArray(snap.teams)) plan = { skip: 'no roster snapshot', patches: [] };
      else {
        const playerRows = await get('player_game_stats?game_id=eq.' + g.id + '&select=player_id,team_idx,stats&order=player_id');
        const teamRows = await get('team_game_stats?game_id=eq.' + g.id + '&select=team_idx,stats&order=team_idx');
        /* the log is only worth reading for a game that has rows to write to */
        const events = (playerRows.length || teamRows.length)
          ? mapEvents(await get('game_events?game_id=eq.' + g.id + '&select=seq,t,team,pid,period,clock,payload&order=seq'))
          : [];
        plan = planGame({ game: g, events, playerRows, teamRows, force });
      }
      if (plan.skip) {
        skipped[plan.skip] = (skipped[plan.skip] || 0) + 1;
        /* the two expected gaps are only counted; anything else is named, since it wants a look */
        if (plan.skip !== 'no stats rows' && plan.skip !== 'no roster snapshot') console.log('  skip ' + id8 + ': ' + (plan.detail || plan.skip));
        continue;
      }
      const P = plan.patches.filter(p => p.kind === 'player'), T = plan.patches.filter(p => p.kind === 'team');
      const gone = P.filter(p => p.action === 'remove').length;
      if (!dry) for (const p of plan.patches) await patch(p.path, p.body);
      if (plan.patches.length) touched++;
      playerPatched += P.length; teamPatched += T.length; removed += gone;
      console.log('  ' + id8 + ': ' + T.length + ' team row' + (T.length === 1 ? '' : 's') + ', ' +
                  P.length + ' player row' + (P.length === 1 ? '' : 's') + (gone ? ' (' + gone + ' stale line' + (gone === 1 ? '' : 's') + ' removed)' : '') +
                  (plan.patches.length ? (dry ? ' would change' : ' updated') : ' already right'));
      if (!dry && plan.patches.length) await pause(100);
    } catch (e) {
      failed++;
      console.log('  FAIL ' + id8 + ': ' + e.message);
    }
  }

  const skips = Object.keys(skipped).map(k => skipped[k] + ' ' + k).join('; ');
  const n = Object.values(skipped).reduce((a, b) => a + b, 0);
  console.log('\n' + games.length + ' games: ' + (dry ? 'would touch ' : 'touched ') + touched +
              ', ' + teamPatched + ' team rows, ' + playerPatched + ' player rows' + (removed ? ' (' + removed + ' stale lines removed)' : '') +
              '; skipped ' + n + (n ? ' (' + skips + ')' : '') + (failed ? '; FAILED ' + failed : ''));
  if (failed) process.exitCode = 1;
}

/* run only when executed, never when imported by a test */
const isMain = (() => {
  if (!process.argv[1]) return false;
  const norm = p => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  try { return norm(fileURLToPath(import.meta.url)) === norm(process.argv[1]); } catch (_) { return false; }
})();
if (isMain) await main();
