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
// the partner feeds — built and posted by the same code the console tests with
import { dispatchGame } from '../_shared/feeds.ts';
// the MVP, decided by the same BPM the pages show
import { bpmMvp } from '../_shared/awards.ts';

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

  const { gameId, reopen, competitionId, awards } = await req.json().catch(() => ({}));

  /* ------------------------------------------------- recompute the awards ---
     Awards are rebuilt whenever a game is finalised, which is right for a
     season in progress and useless for one that has already ended — a league
     that changes a rule, corrects a historic game, or simply wants the MVP
     moved onto BPM without replaying anything needs a way to ask.

     Authorised as the CALLER: `competitions` is only writable through RLS by
     an administrator of its league, so asking the database whether they can
     see it is the same question as whether they may rebuild it. */
  if (awards && competitionId) {
    const { data: mine } = await caller.rpc('is_league_admin_of_competition',
      { p_competition: competitionId });
    if (mine !== true) return json({ error: 'not your competition' }, 403);

    const notes: string[] = [];
    for (const [fn, label] of [
      ['recompute_standings', 'standings'],
      ['advance_bracket', 'bracket'],
      ['compute_season_awards', 'awards']
    ] as const) {
      const { error } = await admin.rpc(fn, { p_competition: competitionId });
      if (error) notes.push(`${label}: ${error.message}`);
    }

    let mvp: unknown = null;
    try {
      const pick = await bpmMvp(admin, competitionId);
      if (pick) {
        const { error } = await admin.from('season_awards').upsert({
          competition_id: competitionId, code: 'mvp',
          player_id: pick.player_id, team_id: pick.team_id,
          value: pick.value, detail: pick.detail,
          updated_at: new Date().toISOString()
        }, { onConflict: 'competition_id,code' });
        if (error) notes.push('MVP left on efficiency: ' + error.message);
        else mvp = pick;
      } else {
        notes.push('not enough played for a BPM MVP — the efficiency award stands');
      }
    } catch (e) {
      notes.push('BPM could not be computed — the efficiency award stands');
      console.error('[awards] BPM MVP failed:', String(e));
    }

    await admin.from('audit_log').insert({
      actor: user.id, action: 'recompute-awards', subject: 'competition',
      subject_id: competitionId, detail: { notes, mvp }
    });
    return json({ ok: true, mvp, notes });
  }

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

      /* THE MVP IS DECIDED BY BPM, not by the efficiency formula the SQL award
         uses. compute_season_awards has just written the efficiency pick;
         this replaces it with the box plus/minus leader, running the SAME
         bpm.js and season.js the pages run so the award and the leaderboard
         two sections below it can never name different players.
         See _shared/awards.ts for why this is not in plpgsql.

         Non-fatal on purpose: if it cannot be computed the efficiency MVP
         stands, and its `detail` says which basis was used, so a reader is
         never shown a number without being told what it measures. */
      try {
        const pick = await bpmMvp(admin, g.competition_id);
        if (pick) {
          const { error } = await admin.from('season_awards').upsert({
            competition_id: g.competition_id, code: 'mvp',
            player_id: pick.player_id, team_id: pick.team_id,
            value: pick.value, detail: pick.detail,
            updated_at: new Date().toISOString()
          }, { onConflict: 'competition_id,code' });
          if (error) {
            warnings.push('the MVP award is still on efficiency: ' + error.message);
          }
        }
      } catch (e) {
        console.error('[finalise] BPM MVP failed:', String(e));
        warnings.push('the MVP award is still on efficiency — BPM could not be computed');
      }
    }

    // queue the static page + OG image; a scheduled job commits these in batches
    await admin.from('publish_queue').upsert({ game_id: gameId, requested_at: new Date().toISOString() });

    // Tell the league's Discord, if it has one. Deliberately last, deliberately
    // non-throwing: the game is final and correct whatever a third-party
    // webhook does, and a Discord outage must not fail a finalise or reopen a
    // game. The outcome is recorded so an admin can see why nothing arrived.
    await notify(admin, gameId, g.competition_id, d, game.teams).catch(() => {});

    // And tell the sites that carry our results — RealGM, Eurobasket, anyone
    // else holding a scraper key. Queued first so a delivery survives this
    // function falling over mid-post, then attempted immediately because a
    // result is worth most on the night. Same rule as the webhook above: a
    // partner being down is not a reason to fail a finalise, so failures are
    // recorded and reported, never thrown.
    let feeds: any[] = [];
    try {
      await admin.rpc('queue_feed_deliveries', { p_game: gameId });
      feeds = await dispatchGame(admin, gameId);
      feeds.filter((f) => !f.ok).forEach((f) =>
        warnings.push(`feed "${f.feed}" did not accept the result: ` +
                      (f.error || 'HTTP ' + f.status) + ' — it can be resent from the console'));
    } catch (e) {
      console.error('[finalise] feed dispatch failed:', String(e));
    }

    await admin.from('audit_log').insert({
      actor: user.id, action: 'finalise', subject: 'game', subject_id: gameId,
      detail: { score: d.score, warnings, feeds: feeds.map((f) => ({ feed: f.feed, ok: f.ok })) }
    });

    return json({ ok: true, status: 'final', score: d.score, warnings, feeds });
  } catch (err) {
    // never strand a game in 'finalising'
    await admin.from('games').update({ status: 'live' }).eq('id', gameId);
    return json({ error: 'finalise failed, game reopened', detail: String(err) }, 500);
  }
});

/* ============================================================================
   Webhook delivery.

   The URL is a secret that never reaches a browser — league_webhooks has no
   RLS policy at all, so only this function, holding the service role, can read
   it. See migration 0025 for why that is a separate table rather than a column
   on `leagues`, which is world-readable.

   Everything here is best-effort by design. A final game is a fact; whether
   Discord accepted a message about it is not, and must never be able to undo
   it or leave a game stranded in 'finalising'.
   ============================================================================ */
async function notify(admin: any, gameId: string, competitionId: string | null,
                      d: any, teams: any[]) {
  if (!competitionId) return;

  const { data: chain } = await admin.from('competitions')
    .select('name,seasons(league_id,leagues(name,slug))')
    .eq('id', competitionId).maybeSingle();
  const leagueId = (chain as any)?.seasons?.league_id;
  if (!leagueId) return;

  const { data: hook } = await admin.from('league_webhooks')
    .select('url,kind,enabled').eq('league_id', leagueId).maybeSingle();
  if (!hook || !hook.enabled || !hook.url) return;

  const { data: g } = await admin.from('games')
    .select('venue,tipoff_at,home:home_team_id(name),away:away_team_id(name)')
    .eq('id', gameId).maybeSingle();
  const home = (g as any)?.home?.name || 'Home';
  const away = (g as any)?.away?.name || 'Away';
  const [hs, as_] = d.score;
  const leagueName = (chain as any)?.seasons?.leagues?.name || '';
  const slug = (chain as any)?.seasons?.leagues?.slug || '';

  const base = Deno.env.get('PUBLIC_SITE_URL') || 'https://prophesyscouting.co.uk';
  const url = `${base}/league/game/?g=${gameId}&mode=supabase`;

  // the winner first reads like a result rather than a fixture list
  const headline = hs === as_
    ? `${home} ${hs}–${as_} ${away}`
    : hs > as_ ? `${home} ${hs}–${as_} ${away}` : `${away} ${as_}–${hs} ${home}`;

  const top = topScorers(d, teams);
  const body = hook.kind === 'slack'
    ? { text: `*FULL TIME* — ${headline}\n${[leagueName, (chain as any)?.name].filter(Boolean).join(' · ')}` +
              (top ? `\n${top}` : '') + `\n<${url}|Box score>` }
    : {
        username: 'Epinoia',
        embeds: [{
          title: headline,
          url,
          description: [leagueName, (chain as any)?.name].filter(Boolean).join(' · ') || undefined,
          color: 0x93f2bf,
          fields: top ? [{ name: 'Leading scorers', value: top }] : undefined,
          footer: { text: 'Full box score, play-by-play and lineups' },
          timestamp: new Date().toISOString()
        }]
      };

  let status = 0, error: string | null = null;
  try {
    // a webhook that never answers must not hold a finalise open
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(hook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    status = res.status;
    if (!res.ok) error = (await res.text().catch(() => '')).slice(0, 300) || res.statusText;
  } catch (e) {
    error = String(e).slice(0, 300);
  }

  await admin.from('league_webhooks').update({
    last_sent_at: new Date().toISOString(), last_status: status, last_error: error
  }).eq('league_id', leagueId);
}

/* the two or three names that make a result worth clicking on */
function topScorers(d: any, teams: any[]): string | null {
  const rows = Object.keys(d.stats || {})
    .map((pid) => ({ pid, pts: d.stats[pid]?.pts || 0 }))
    .filter((r) => r.pts > 0)
    .sort((a, b) => b.pts - a.pts)
    .slice(0, 3);
  if (!rows.length) return null;
  const name = (pid: string) => {
    for (const tm of teams || []) {
      const p = (tm.players || []).find((x: any) => x.id === pid);
      if (p) return p.name;
    }
    return null;
  };
  const parts = rows.map((r) => {
    const n = name(r.pid);
    return n ? `${n} ${r.pts}` : null;
  }).filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
