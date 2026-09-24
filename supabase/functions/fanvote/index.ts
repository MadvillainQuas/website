// ============================================================================
// fanvote — OPENS THE WEEK'S FANS' VOTE (migration 0150, docs/fanvote.md).
//
//   POST { league: <uuid> }   anyone. Answers { opened: boolean } and nothing else.
//
// The league page calls this only when fanvote_state says a round is due: the
// Monday after a week the league played, from 06:00 on its own clock. It asks
// the database again (fanvote_due, service role only), and if the round is still
// due it reads that week's finished games and box scores, puts the week's best
// players by BPM and every winning club on the ballot (_shared/fanvote.ts, the
// Stars podium's own rule from the same files the page runs), and hands them to
// fanvote_open, which checks every card and keeps fifteen players.
//
// SAFE TO CALL BY ANYBODY, ANY NUMBER OF TIMES. Nothing a caller sends ends up on
// a ballot: the league id only says which league to look at, the database decides
// whether a round is due, and a round is opened once (a second call, or two pages
// asking at once, gets the same round back). The answer carries no data at all,
// so it cannot show anybody a private or members-only league's players.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { playerCandidates, teamCandidates, type TeamName } from '../_shared/fanvote.ts';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* chunked so the in.() filter cannot outgrow a URL, as data.js and awards.ts do */
const chunk40 = (ids: string[]) => {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += 40) out.push(ids.slice(i, i + 40));
  return out;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }
  const league = String((body && body.league) || '');
  if (!UUID.test(league)) return json({ error: 'league is required' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
                             { auth: { persistSession: false } });

  const { data: due, error: dueErr } = await admin.rpc('fanvote_due', { p_league: league });
  if (dueErr) return json({ error: dueErr.message }, 500);
  if (!due) return json({ opened: false });

  /* the league's competitions, then that week's finished games in them */
  const { data: comps, error: compErr } = await admin.from('competitions')
    .select('id,seasons!inner(league_id)').eq('seasons.league_id', league);
  if (compErr) return json({ error: compErr.message }, 500);
  const compIds = (comps || []).map((c: any) => c.id);
  if (!compIds.length) return json({ opened: false });

  const games: any[] = [];
  for (const c of chunk40(compIds)) {
    const { data, error } = await admin.from('games')
      .select('id,home_team_id,away_team_id,home_score,away_score,tipoff_at')
      .in('competition_id', c).eq('status', 'final')
      .gte('tipoff_at', due.starts_at).lt('tipoff_at', due.ends_at);
    if (error) return json({ error: error.message }, 500);
    games.push(...(data || []));
  }
  if (!games.length) return json({ opened: false });

  const pgs: any[] = [];
  const tgs: any[] = [];
  for (const c of chunk40(games.map(g => g.id))) {
    const [p, t] = await Promise.all([
      admin.from('player_game_stats').select('game_id,player_uuid,player_id,team_idx,stats').in('game_id', c),
      admin.from('team_game_stats').select('game_id,team_idx,stats').in('game_id', c)
    ]);
    if (p.error) return json({ error: p.error.message }, 500);
    if (t.error) return json({ error: t.error.message }, 500);
    pgs.push(...(p.data || []));
    tgs.push(...(t.data || []));
  }

  const teamIds = [...new Set(games.flatMap(g => [g.home_team_id, g.away_team_id]).filter(Boolean))];
  const names = new Map<string, TeamName>();
  for (const c of chunk40(teamIds)) {
    const { data } = await admin.from('teams').select('id,name,short_name').in('id', c);
    (data || []).forEach((t: TeamName) => names.set(t.id, t));
  }

  let players: any[] = [];
  try { players = playerCandidates(games, pgs, tgs); }
  catch (e) { console.error('[fanvote] BPM failed for league', league, e); players = []; }
  const teams = teamCandidates(games, names);

  const { data: round, error: openErr } = await admin.rpc('fanvote_open', {
    p_league: league, p_week_start: due.week_start, p_players: players, p_teams: teams
  });
  if (openErr) return json({ error: openErr.message }, 500);
  return json({ opened: !!round });
});
