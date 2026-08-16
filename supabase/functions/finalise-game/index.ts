// ============================================================================
// finalise-game — turns a scored game into a published one.
//
// Runs with the service-role key, which exists ONLY here and in GitHub Actions
// secrets. It never reaches a browser.
//
//   POST { gameId }           -> finalise
//   POST { gameId, reopen:1 } -> reverse it
//
// Sequence (see plan §06): sanity gate -> lock -> rebuild with the SHARED
// engine -> derived tables -> standings -> publish queue -> status=final.
// The public page is correct the moment status flips; the git commit that
// follows is only for permanence and link previews.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
// the very same file the scorer and the public page run — one source of truth
import { deriveGame, teamAdv, playerAdv, lineupAgg } from '../_shared/engine.js';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  // --- who is asking? the caller's JWT, never the service role ---
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } }
  );
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'sign in first' }, 401);

  const { gameId, reopen } = await req.json().catch(() => ({}));
  if (!gameId) return json({ error: 'gameId required' }, 400);

  // authorisation is evaluated as the CALLER, so RLS decides — not this code
  const { data: allowed } = await caller.from('games').select('id,status').eq('id', gameId).maybeSingle();
  if (!allowed) return json({ error: 'not your game' }, 403);

  // --------------------------------------------------------------- reopen ---
  if (reopen) {
    if (allowed.status !== 'final') return json({ error: 'game is not final' }, 409);
    await admin.from('player_game_stats').delete().eq('game_id', gameId);
    await admin.from('team_game_stats').delete().eq('game_id', gameId);
    await admin.from('lineup_stints').delete().eq('game_id', gameId);
    await admin.from('games').update({ status: 'live', finalised_at: null, finalised_by: null }).eq('id', gameId);
    await admin.from('audit_log').insert({ actor: user.id, action: 'reopen', subject: 'game', subject_id: gameId });
    return json({ ok: true, status: 'live' });
  }

  if (allowed.status === 'final') return json({ error: 'already final' }, 409);

  // ----------------------------------------------------------- load state ---
  const [{ data: g }, { data: rows }, { data: state }] = await Promise.all([
    admin.from('games').select('*').eq('id', gameId).single(),
    admin.from('game_events').select('*').eq('game_id', gameId).order('seq'),
    admin.from('game_state').select('*').eq('game_id', gameId).maybeSingle()
  ]);

  const events = (rows ?? []).map((r: any) =>
    ({ id: r.seq, seq: r.seq, t: r.t, team: r.team, pid: r.pid, period: r.period, clock: r.clock, ...(r.payload ?? {}) }));

  const snap = g.roster_snapshot ?? {};
  const game = {
    teams: snap.teams,
    starters: g.starters,
    events,
    period: state?.period ?? g.period ?? 4,
    clockMs: state?.clock_ms ?? 0,
    tipWinner: g.tip_winner,
    arrowInit: g.arrow_init
  };
  if (!game.teams || !game.starters) return json({ error: 'game has no roster snapshot' }, 422);

  // ---------------------------------------------------------- sanity gate ---
  const d = deriveGame(game);
  const TA = [teamAdv(game, d, 0), teamAdv(game, d, 1)];
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (game.period < 4) blocking.push(`only ${game.period} periods played`);
  if (game.clockMs > 0) warnings.push('clock is not at zero');
  if (d.score[0] === d.score[1]) blocking.push('scores are level — play overtime');

  [0, 1].forEach(t => {
    const mins = game.teams[t].players.reduce((a: number, p: any) => a + (d.stats[p.id]?.min ?? 0), 0) / 60000;
    const expected = (game.period <= 4 ? game.period * 10 : 40 + (game.period - 4) * 5) * 5;
    if (Math.abs(mins - expected) > 1) warnings.push(`${game.teams[t].name}: ${mins.toFixed(1)} player-minutes, expected ${expected}`);
    game.teams[t].players.forEach((p: any) => {
      const s = d.stats[p.id];
      if (s && (s.pf > 5 || (s.pf === 5 && d.onCourt[t].includes(p.id))))
        blocking.push(`${p.name} has ${s.pf} fouls and is still on court`);
    });
  });
  if (blocking.length) return json({ error: 'sanity gate failed', blocking, warnings }, 422);

  // ---------------------------------------------------------------- lock ---
  await admin.from('games').update({ status: 'finalising' }).eq('id', gameId);

  try {
    // ------------------------------------------------------------ rebuild ---
    const playerRows = [0, 1].flatMap(t =>
      game.teams[t].players.map((p: any) => ({
        game_id: gameId, player_id: p.id, team_idx: t,
        stats: { ...d.stats[p.id], adv: playerAdv(game, d, t, p, TA[t], TA[1 - t]) }
      })));
    const teamRows = [0, 1].map(t => ({
      game_id: gameId, team_idx: t,
      stats: { ...d.team[t], adv: TA[t], perQ: d.perQ[t], score: d.score[t] }
    }));
    const lineupRows = [0, 1].flatMap(t =>
      lineupAgg(d, t).map((l: any) => ({ game_id: gameId, team_idx: t, player_ids: l.ids, stats: l })));

    await admin.from('player_game_stats').delete().eq('game_id', gameId);
    await admin.from('team_game_stats').delete().eq('game_id', gameId);
    await admin.from('lineup_stints').delete().eq('game_id', gameId);
    const w = await Promise.all([
      admin.from('player_game_stats').insert(playerRows),
      admin.from('team_game_stats').insert(teamRows),
      admin.from('lineup_stints').insert(lineupRows)
    ]);
    const failed = w.find(r => r.error);
    if (failed) throw new Error(failed.error!.message);

    // --------------------------------------------------------- publish it ---
    await admin.from('games').update({
      status: 'final',
      home_score: d.score[0], away_score: d.score[1],
      period: game.period,
      finalised_at: new Date().toISOString(), finalised_by: user.id
    }).eq('id', gameId);

    // Standings, bracket and awards, if the game belongs to a competition.
    //
    // These used to be one call swallowed by .catch(() => {}), which is how a
    // broken recompute_standings survived unnoticed: the function raised on
    // every call, the error went nowhere, and a league's table would simply
    // stop updating with nothing anywhere saying why.
    //
    // A failure here must not undo a finalised game — the game IS final and
    // its box score is correct — so these still do not throw. They are
    // reported instead: onto the response, so the statistician sees it, and
    // into the audit log, so it is findable afterwards.
    const derivedWarnings: string[] = [];
    if (g.competition_id) {
      for (const [fn, label] of [
        ['recompute_standings', 'standings'],
        ['advance_bracket', 'bracket'],
        ['compute_season_awards', 'awards']
      ] as const) {
        const { error } = await admin.rpc(fn, { p_competition: g.competition_id });
        if (error) {
          derivedWarnings.push(`${label} could not be rebuilt: ${error.message}`);
          console.error(`[finalise] ${fn} failed for competition ${g.competition_id}:`, error.message);
        }
      }
      if (derivedWarnings.length) warnings.push(...derivedWarnings);
    }

    // queue the static page + OG image; a scheduled job commits these in batches
    await admin.from('publish_queue').upsert({ game_id: gameId, requested_at: new Date().toISOString() });
    await admin.from('audit_log').insert({
      actor: user.id, action: 'finalise', subject: 'game', subject_id: gameId,
      detail: { score: d.score, warnings }
    });

    return json({ ok: true, status: 'final', score: d.score, warnings });
  } catch (err) {
    // never strand a game in 'finalising'
    await admin.from('games').update({ status: 'live' }).eq('id', gameId);
    return json({ error: 'finalise failed, game reopened', detail: String(err) }, 500);
  }
});
