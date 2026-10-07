// ============================================================================
// gamecontext — the season around a game that has just finished, for the filed match report.
//
// The game page builds this in the browser (epinoia/game/game.js ensureGameContext) and story.js turns it into the
// streaks made and ended, the table, the meetings, upsets, season highs, returns and what the season expected. The
// article finalise-game files used to be written without it, so the news feed's report said what happened and never
// what it meant. This reads the same things with the function's own client, small and named:
//
//   the season's finished games           light columns
//   the two clubs' games' player lines    by named keys out of the stats, never the blob
//   the same games' team lines            the adv block only
//   the table the league page shows       the league competition's standings (just recomputed by finalise)
//   the next fixtures, and the fans' picks for this game
//
// and hands them to the same context.js the page runs (_shared/context.js, extracted). Non-fatal: any failure is an
// article without the season, exactly as before.
// ============================================================================
import { build as buildContext } from './context.js';

const chunks = <T>(a: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const PK = 'game_id,team_idx,player_uuid,player_id,min:stats->min,pts:stats->pts,or:stats->or,dr:stats->dr,ast:stats->ast,' +
  'stl:stats->stl,blk:stats->blk,p3m:stats->p3m';

// deno-lint-ignore no-explicit-any
export async function seasonContext(admin: any, g: any, score: number[], model: any = null): Promise<any> {
  if (!g?.competition_id || !g?.home_team_id || !g?.away_team_id) return null;
  const { data: own } = await admin.from('competitions').select('season_id,kind').eq('id', g.competition_id).maybeSingle();
  if (!own?.season_id) return null;
  const { data: comps } = await admin.from('competitions').select('id,name,kind').eq('season_id', own.season_id);
  const ids = (comps ?? []).map((c: any) => c.id);
  if (!ids.length) return null;
  const { data: games } = await admin.from('games')
    .select('id,home_team_id,away_team_id,home_score,away_score,tipoff_at,attendance,competition_id')
    .in('competition_id', ids).eq('status', 'final').order('tipoff_at').limit(3000);
  const all = games ?? [];
  if (!all.some((x: any) => x.id === g.id)) all.push({ id: g.id, home_team_id: g.home_team_id, away_team_id: g.away_team_id,
    home_score: score[0], away_score: score[1], tipoff_at: g.tipoff_at, attendance: g.attendance, competition_id: g.competition_id });
  const clubs = [g.home_team_id, g.away_team_id];
  const mine = all.filter((x: any) => clubs.includes(x.home_team_id) || clubs.includes(x.away_team_id)).map((x: any) => x.id);
  const pgs: any[] = [], tgs: any[] = [];
  for (const c of chunks(mine, 60)) {
    const [{ data: p }, { data: t }] = await Promise.all([
      admin.from('player_game_stats').select(PK).in('game_id', c),
      admin.from('team_game_stats').select('game_id,team_idx,adv:stats->adv').in('game_id', c)
    ]);
    (p ?? []).forEach((r: any) => pgs.push({ game_id: r.game_id, team_idx: r.team_idx, player_uuid: r.player_uuid, player_id: r.player_id,
      stats: { min: r.min, pts: r.pts, or: r.or, dr: r.dr, ast: r.ast, stl: r.stl, blk: r.blk, p3m: r.p3m } }));
    (t ?? []).forEach((r: any) => tgs.push({ game_id: r.game_id, team_idx: r.team_idx, stats: { adv: r.adv ?? {} } }));
  }
  /* the table: the league's own competition in this season (a cup tie reads the league table, as tablepos.js does) */
  const leagueComp = (own.kind ?? 'league') === 'league' ? { id: g.competition_id } : ((comps ?? []).find((c: any) => (c.kind ?? 'league') === 'league') ?? { id: g.competition_id });
  const { data: rows } = await admin.from('standings').select('team_id,rank,gp,w,l,group_name,league_points').eq('competition_id', leagueComp.id);
  const { data: fx } = await admin.from('games').select('id,home_team_id,away_team_id,tipoff_at').eq('status', 'scheduled')
    .or(`home_team_id.in.(${clubs.join(',')}),away_team_id.in.(${clubs.join(',')})`).gt('tipoff_at', g.tipoff_at ?? new Date().toISOString())
    .order('tipoff_at').limit(10);
  const opp = [...new Set((fx ?? []).flatMap((f: any) => [f.home_team_id, f.away_team_id]).filter((id: string) => id && !clubs.includes(id)))];
  const names: Record<string, string> = {};
  if (opp.length) { const { data: ts } = await admin.from('teams').select('id,name').in('id', opp); (ts ?? []).forEach((t: any) => { names[t.id] = t.name; }); }
  let tally = null;
  try {
    const { data: tl } = await admin.rpc('prediction_tally', { p_games: [g.id] });
    const r = Array.isArray(tl) ? tl[0] : null;
    if (r) tally = { home: r.home, away: r.away };
  } catch (_) { /* a database without picks */ }
  return buildContext({
    gameId: g.id, tipoff: g.tipoff_at, home: g.home_team_id, away: g.away_team_id, score,
    games: all, pgs, tgs, table: { comp: { id: leagueComp.id }, rows: rows ?? [] }, fixtures: fx ?? [], teamNames: names,
    tally, model, competitionId: g.competition_id, attendance: g.attendance ?? null
  });
}
