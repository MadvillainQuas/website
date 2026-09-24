// ============================================================================
// WHO IS ON THE WEEK'S BALLOT (migration 0150, docs/fanvote.md).
//
// The players are the Stars podium's own answer for the week: stars.js
// computeWindow + pick with its 'week' window (a game and twenty minutes, best
// BPM first), run over the league's finished games of that week, from the same
// generated files the league page runs. Twenty-five are handed to fanvote_open, which
// drops anybody withheld (a minor without consent) or unknown and keeps fifteen, so
// a withheld player costs the ballot nobody.
//
// The clubs are every club that WON a game that week, best week first: more
// wins, then the bigger margin across the week, then the name. Each carries its
// results so the card can say "W 80-70 v Owls".
//
// Pure: no database, no Deno. The fanvote function fetches; this decides; and
// supabase/tests/fanvote.test.mjs runs it against the browser's own pick.
// ============================================================================
import './bpm.js';                    // attaches globalThis.EpinoiaBPM
import './season.js';                 // attaches globalThis.EpinoiaSeason, read by computeWindow
import { computeWindow, pick, WINDOWS } from './stars.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r1 = (x: unknown) => (x == null || !isFinite(Number(x)) ? null : Math.round(Number(x) * 10) / 10);

export interface WeekGame {
  id: string; home_team_id: string; away_team_id: string;
  home_score: number | null; away_score: number | null; tipoff_at?: string | null;
}
export interface TeamName { id: string; name?: string | null; short_name?: string | null; }

export const BALLOT_PLAYERS = 25;     // asked for; the database keeps fifteen

/** The week's best players by BPM, as fanvote_open takes them: [{id, team_id, line}]. */
export function playerCandidates(games: WeekGame[], pgs: any[], tgs: any[], n = BALLOT_PLAYERS) {
  const week = (WINDOWS as any[]).find(w => w.key === 'week');
  if (!week || !games.length || !pgs.length) return [];
  const agg = computeWindow(pgs, tgs, games);
  return (pick(agg.players, week, n) as any[])
    .filter(p => UUID.test(String(p.id)))
    .map(p => ({
      id: String(p.id),
      team_id: agg.teamOfPlayer.get(p.id) || null,
      line: { bpm: r1(p.bpm), gp: p.gp ?? null, min: r1(p.min), ppg: p.ppg ?? null,
              rpg: p.rpg ?? null, apg: p.apg ?? null }
    }));
}

/** Every club that won a game in the week, best week first: [{id, line}]. */
export function teamCandidates(games: WeekGame[], names: Map<string, TeamName>) {
  const label = (id: string) => {
    const t = names.get(id);
    return String((t && (t.short_name || t.name)) || '').trim();
  };
  const full = (id: string) => String((names.get(id) || {}).name || '');
  const rows = new Map<string, { id: string; wins: number; losses: number; diff: number; results: any[] }>();
  const row = (id: string) => {
    if (!rows.has(id)) rows.set(id, { id, wins: 0, losses: 0, diff: 0, results: [] });
    return rows.get(id)!;
  };
  [...games].sort((a, b) => String(a.tipoff_at || '').localeCompare(String(b.tipoff_at || '')))
    .forEach(g => {
      const hs = Number(g.home_score), as = Number(g.away_score);
      if (!g.home_team_id || !g.away_team_id || !isFinite(hs) || !isFinite(as) || hs === as) return;
      const home = row(g.home_team_id), away = row(g.away_team_id);
      const homeWon = hs > as;
      home.diff += hs - as; away.diff += as - hs;
      if (homeWon) { home.wins++; away.losses++; } else { away.wins++; home.losses++; }
      home.results.push({ vs: label(away.id), won: homeWon, for: hs, against: as, home: true });
      away.results.push({ vs: label(home.id), won: !homeWon, for: as, against: hs, home: false });
    });
  return [...rows.values()]
    .filter(r => r.wins > 0 && UUID.test(r.id))
    .sort((a, b) => b.wins - a.wins || b.diff - a.diff || full(a.id).localeCompare(full(b.id)))
    .map(r => ({ id: r.id, line: { wins: r.wins, losses: r.losses, diff: r.diff, results: r.results } }));
}
