/* ============================================================================
   BACKFILL: the rebound-linked and rim-defence counters on every finalised game.

   The engine now links a rebound to the miss before it (the rule of situations.js
   reboundOutcomes) and counts opponent rim shots while each player is on the floor.
   Every player_game_stats.stats row written from now on carries
       rbTm rbTmO rbSf rbSfO   and   oc.oRimA oc.oRimM
   Games finalised before that do not, and season.js counts coverage per player from
   exactly those fields, so until they are replayed those games simply read as "no
   data". This replays them with the same epinoia/engine.js the page and the finalise
   function run, over the stored log and roster snapshot, and merges ONLY those six
   numbers into each player's stats -- every other key is sent back as it was.

     node scripts/backfill_player_reb.mjs              # every final game
     node scripts/backfill_player_reb.mjs --dry        # count, change nothing
     node scripts/backfill_player_reb.mjs <game-id>    # one game
     node scripts/backfill_player_reb.mjs --force      # rewrite rows that are already right

   A game whose replay does not give the score stored on its team rows is skipped and
   named (its box score was built from a different log: re-finalise it). A game with no
   roster snapshot, no log or no stats rows is skipped.

   Credentials: env SUPABASE_URL + SUPABASE_SERVICE_KEY, else the worker's own config
   (%APPDATA%\epinoia\worker.json). The key never lives in the repo.

   Importable without side effects: planGame() is exported for tests; main() runs only
   when this file is the one node was asked to execute.
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mapEvents } from './backfill_situations.mjs';

const require = createRequire(import.meta.url);
const E = require('../epinoia/engine.js');
export { mapEvents };

const TOP = ['rbTm', 'rbTmO', 'rbSf', 'rbSfO'];
const q = v => encodeURIComponent(String(v));

/* the six numbers one player-game should carry */
export function wanted(s) {
  const o = {}; TOP.forEach(k => { o[k] = s[k] || 0; });
  return { top: o, oc: { oRimA: (s.oc && s.oc.oRimA) || 0, oRimM: (s.oc && s.oc.oRimM) || 0 } };
}
const same = (cur, w) => TOP.every(k => cur[k] === w.top[k]) &&
  !!cur.oc && cur.oc.oRimA === w.oc.oRimA && cur.oc.oRimM === w.oc.oRimM;

/* game: { id, roster_snapshot, starters, tip_winner, arrow_init }; events: mapEvents() of its log
   playerRows: { player_id, stats }; teamRows: { team_idx, stats }
   Returns { skip, detail, patches: [{ key, path, body }] } */
export function planGame({ game, events, playerRows, teamRows, force = false }) {
  const out = { skip: null, detail: null, patches: [] };
  const snap = game && game.roster_snapshot;
  if (!snap || !Array.isArray(snap.teams) || snap.teams.length < 2) { out.skip = 'no roster snapshot'; return out; }
  if (!(playerRows || []).length) { out.skip = 'no stats rows'; return out; }
  if (!(events || []).length) { out.skip = 'no events'; return out; }
  let d;
  try {
    d = E.deriveGame({ teams: snap.teams, starters: game.starters || [[], []], events,
                       tipWinner: game.tip_winner, arrowInit: game.arrow_init });
  } catch (e) { out.skip = 'replay failed'; out.detail = e.message; return out; }
  for (const row of teamRows || []) {
    const t = row.team_idx, cur = row.stats || {};
    if ((t === 0 || t === 1) && typeof cur.score === 'number' && cur.score !== d.score[t]) {
      out.skip = 'log and box score disagree';
      out.detail = `the log gives team ${t} ${d.score[t]} points, its stored box score ${cur.score} -- re-finalise this game`;
      return out;
    }
  }
  for (const row of playerRows) {
    const s = d.stats[row.player_id];
    if (!s) continue;
    const cur = row.stats || {}, w = wanted(s);
    if (!force && same(cur, w)) continue;
    out.patches.push({ key: row.player_id,
      path: 'player_game_stats?game_id=eq.' + q(game.id) + '&player_id=eq.' + q(row.player_id),
      body: { stats: Object.assign({}, cur, w.top, { oc: Object.assign({}, cur.oc || {}, w.oc) }) } });
  }
  return out;
}

async function main() {
  let URL_, KEY;
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    URL_ = process.env.SUPABASE_URL.replace(/\/$/, ''); KEY = process.env.SUPABASE_SERVICE_KEY;
  } else {
    const cfg = JSON.parse(readFileSync(join(process.env.APPDATA || '', 'epinoia', 'worker.json'), 'utf8'));
    URL_ = cfg.supabase_url.replace(/\/$/, ''); KEY = cfg.service_key;
  }
  const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
  const args = process.argv.slice(2);
  const dry = args.includes('--dry'), force = args.includes('--force');
  const only = args.find(a => /^[0-9a-f-]{36}$/i.test(a));

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

  const games = await get('games?status=eq.final&select=id,roster_snapshot,starters,tip_winner,arrow_init' +
                          (only ? '&id=eq.' + only : '') + '&order=tipoff_at,id');
  console.log(games.length + ' finalised game' + (games.length === 1 ? '' : 's') + (dry ? ' (dry run)' : '') + (force ? ' (forced)' : ''));
  let touched = 0, rows = 0, failed = 0;
  const skipped = {};
  for (const g of games) {
    const id8 = g.id.slice(0, 8);
    try {
      const playerRows = await get('player_game_stats?game_id=eq.' + g.id + '&select=player_id,team_idx,stats&order=player_id');
      const teamRows = await get('team_game_stats?game_id=eq.' + g.id + '&select=team_idx,stats&order=team_idx');
      const events = playerRows.length
        ? mapEvents(await get('game_events?game_id=eq.' + g.id + '&select=seq,t,team,pid,period,clock,payload&order=seq')) : [];
      const plan = planGame({ game: g, events, playerRows, teamRows, force });
      if (plan.skip) {
        skipped[plan.skip] = (skipped[plan.skip] || 0) + 1;
        if (plan.skip !== 'no stats rows' && plan.skip !== 'no roster snapshot') console.log('  skip ' + id8 + ': ' + (plan.detail || plan.skip));
        continue;
      }
      if (!dry) for (const p of plan.patches) await patch(p.path, p.body);
      if (plan.patches.length) { touched++; rows += plan.patches.length; }
      console.log('  ' + id8 + ': ' + plan.patches.length + ' player row' + (plan.patches.length === 1 ? '' : 's') +
                  (plan.patches.length ? (dry ? ' would change' : ' updated') : ' already right'));
      if (!dry && plan.patches.length) await pause(100);
    } catch (e) { failed++; console.log('  FAIL ' + id8 + ': ' + e.message); }
  }
  const n = Object.values(skipped).reduce((a, b) => a + b, 0);
  console.log('\n' + games.length + ' games: ' + (dry ? 'would touch ' : 'touched ') + touched + ', ' + rows + ' player rows; skipped ' + n +
              (n ? ' (' + Object.keys(skipped).map(k => skipped[k] + ' ' + k).join('; ') + ')' : '') + (failed ? '; FAILED ' + failed : ''));
  if (failed) process.exitCode = 1;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  const norm = p => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  try { return norm(fileURLToPath(import.meta.url)) === norm(process.argv[1]); } catch (_) { return false; }
})();
if (isMain) await main();
