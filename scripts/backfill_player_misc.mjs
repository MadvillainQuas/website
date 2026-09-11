/* ============================================================================
   BACKFILL: a player's own paint, transition, second-chance and off-turnover
   points on every finalised game.

   The engine credits the scorer with those four alongside the side (2026-09-11),
   so every game finalised from now on carries them in player_game_stats. The
   games finalised before that do not, and the season table would show a zero
   against every player for the misc view until they were replayed. This replays
   them: the same deriveGame the page and the finalise function run, over the
   stored log and roster snapshot, and only the four new fields are merged into
   each player's stats row -- nothing else about a finalised game is touched.

     node scripts/backfill_player_misc.mjs            # every final game
     node scripts/backfill_player_misc.mjs --dry      # count, change nothing
     node scripts/backfill_player_misc.mjs <game-id>  # one game

   The service key comes from the worker's own config (%APPDATA%\epinoia\worker.json),
   the same place every other repair reads it from; it never lives in the repo.
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../epinoia/engine.js');

const cfg = JSON.parse(readFileSync(join(process.env.APPDATA, 'epinoia', 'worker.json'), 'utf8'));
const URL_ = cfg.supabase_url.replace(/\/$/, ''), KEY = cfg.service_key;
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const dry = process.argv.includes('--dry');
const only = process.argv.slice(2).find(a => /^[0-9a-f-]{36}$/i.test(a));

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

const games = await get('games?status=eq.final&select=id,roster_snapshot,starters,tip_winner,arrow_init' + (only ? '&id=eq.' + only : '') + '&order=tipoff_at');
console.log(games.length + ' finalised game' + (games.length === 1 ? '' : 's'));
let touched = 0, players = 0;
for (const g of games) {
  const snap = g.roster_snapshot;
  if (!snap || !snap.teams) { console.log('  skip ' + g.id.slice(0, 8) + ': no snapshot'); continue; }
  const rows = await get('game_events?game_id=eq.' + g.id + '&select=seq,t,team,pid,period,clock,payload&order=seq');
  const events = rows.map(r => Object.assign({ t: r.t, id: r.seq, seq: r.seq, period: r.period, clock: r.clock }, r.payload || {},
                                             r.team != null ? { team: r.team } : {}, r.pid != null ? { pid: r.pid } : {}));
  const game = { teams: snap.teams, starters: g.starters || [[], []], events, tip_winner: g.tip_winner, arrow_init: g.arrow_init };
  let d;
  try { d = E.deriveGame(game); } catch (e) { console.log('  skip ' + g.id.slice(0, 8) + ': ' + e.message); continue; }
  const pgs = await get('player_game_stats?game_id=eq.' + g.id + '&select=game_id,player_uuid,player_id,team_idx,stats');
  let n = 0;
  for (const row of pgs) {
    const pid = row.player_uuid || row.player_id;
    const s = d.stats[pid];
    if (!s) continue;
    const cur = row.stats || {};
    const want = { paint: s.paint || 0, fast: s.fast || 0, sc: s.sc || 0, pot: s.pot || 0 };
    if (['paint', 'fast', 'sc', 'pot'].every(k => cur[k] === want[k])) continue;
    if (!dry) await patch('player_game_stats?game_id=eq.' + g.id + (row.player_uuid ? '&player_uuid=eq.' + row.player_uuid : '&player_id=eq.' + row.player_id), { stats: Object.assign({}, cur, want) });
    n++;
  }
  if (n) { touched++; players += n; }
  console.log('  ' + g.id.slice(0, 8) + ': ' + n + ' player row' + (n === 1 ? '' : 's') + (dry ? ' would change' : ' updated'));
}
console.log((dry ? 'would touch ' : 'touched ') + touched + ' games, ' + players + ' player rows');
