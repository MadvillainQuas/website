// ============================================================================
// MOST VALUABLE PLAYER, BY BOX PLUS/MINUS.
//
// WHY THIS IS NOT IN SQL. Every other award in migration 0018 is a one-line
// expression over `player_season_stats`, and the MVP used to be one too — the
// standard efficiency formula, PTS + REB + AST + STL + BLK minus missed shots
// and turnovers. It is a blunt instrument: it rewards volume, it cannot tell a
// good shot from a bad one, and on any roster with a high-usage inefficient
// scorer it names the wrong player with total confidence.
//
// BPM asks the better question — how many points per 100 possessions a player
// added over a league-average player, adjusted to how their team actually
// performed. But it needs position estimation, role estimation, a per-team
// adjustment across the whole roster and a league average offensive rating. It
// is four hundred lines, it is easy to get subtly wrong, and this project has
// already been bitten by exactly that in the Python it was ported from.
//
// Rewriting it in plpgsql so the database could pick an MVP would mean two
// implementations of a fiddly calculation, and one day the league page and the
// API would name different players and both be able to show their working. So
// the Edge Function runs the SAME FILE the browser runs and writes the answer
// back. `supabase/tests/extract-shared.mjs` keeps the copies identical and CI
// fails if they drift.
//
// THE EFFICIENCY MVP IS STILL COMPUTED FIRST, by compute_season_awards, and
// this overwrites it. If anything here fails the league still has an MVP and
// its `detail` says which basis was used, so a reader is never shown a number
// without being told what it measures.
// ============================================================================
import './bpm.js';                    // attaches globalThis.EpinoiaBPM
import { players as seasonPlayers, teams as seasonTeams, attachBPM } from './season.js';

export interface MvpPick {
  player_id: string;
  team_id: string | null;
  value: number;
  detail: string;
  games: number;
}

/**
 * Read one competition's finalised games and name the BPM leader.
 *
 * Returns null when there is nothing to decide — no games, no eligible player,
 * BPM unavailable — and the caller leaves the efficiency award standing rather
 * than deleting an award it cannot replace.
 */
export async function bpmMvp(admin: any, competitionId: string): Promise<MvpPick | null> {
  const { data: games } = await admin.from('games')
    .select('id,home_team_id,away_team_id,home_score,away_score,tipoff_at')
    .eq('competition_id', competitionId).eq('status', 'final');
  if (!games || !games.length) return null;

  const ids = games.map((g: any) => g.id);
  /* chunked so the in.() filter cannot outgrow a URL on a long season, the
     same way data.js does it for the browser */
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));

  const pgs: any[] = [];
  const tgs: any[] = [];
  for (const c of chunks) {
    const [p, t] = await Promise.all([
      admin.from('player_game_stats')
        .select('game_id,player_id,team_idx,stats').in('game_id', c),
      admin.from('team_game_stats')
        .select('game_id,team_idx,stats').in('game_id', c)
    ]);
    if (p.data) pgs.push(...p.data);
    if (t.data) tgs.push(...t.data);
  }
  if (!pgs.length || !tgs.length) return null;

  const byId: Record<string, any> = {};
  games.forEach((g: any) => { byId[g.id] = g; });

  /* which club each player belongs to, from the per-game rows — a player's
     side is a property of the game, not of the season row */
  const teamOfPlayer = new Map<string, string>();
  pgs.forEach((r: any) => {
    const g = byId[r.game_id];
    if (!g) return;
    const tid = r.team_idx === 0 ? g.home_team_id : g.away_team_id;
    if (tid && !teamOfPlayer.has(r.player_id)) teamOfPlayer.set(r.player_id, tid);
  });

  const playerRows = seasonPlayers(pgs, tgs);
  const teamRows = seasonTeams(tgs, byId);
  attachBPM(playerRows, teamRows, teamOfPlayer);

  /* THE SAME APPEARANCE GATE the SQL awards use: at least half the games any
     player managed, never fewer than three, relaxed if that would leave
     nobody. Two different gates for two awards on the same page would be a
     third thing for a reader to have to know. */
  const maxGp = playerRows.reduce((n: number, p: any) => Math.max(n, p.gp || 0), 0);
  if (!maxGp) return null;
  let gate = Math.max(3, Math.ceil(maxGp * 0.5));
  if (!playerRows.some((p: any) => (p.gp || 0) >= gate)) gate = maxGp;

  const eligible = playerRows
    .filter((p: any) => p.bpm != null && (p.gp || 0) >= gate)
    .sort((a: any, b: any) => b.bpm - a.bpm);
  if (!eligible.length) return null;

  const top = eligible[0];
  /* Only a real UUID goes in — an imported historic game can carry a scorer's
     local player id, and a foreign key will refuse it. Better to leave the
     efficiency award standing than to fail the whole finalise over an award. */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(top.id)) {
    return null;
  }

  return {
    player_id: top.id,
    team_id: teamOfPlayer.get(top.id) || null,
    value: Math.round(top.bpm * 10) / 10,
    detail: 'box plus/minus · minimum ' + gate + ' games',
    games: top.gp || 0
  };
}
