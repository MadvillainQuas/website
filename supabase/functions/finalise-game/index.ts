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
// the match-report writer. story.js FIRST and for its side effect: report.js
// finds the fact engine on globalThis, which story.js is what puts there.
import '../_shared/gamepct-data.js';   // side effect: globalThis.EpinoiaGamePctData, before its reader
import '../_shared/gamepct.js';        // side effect: globalThis.EpinoiaGamePct, which story.js's scout grades with
import '../_shared/story.js';
import { report as buildReport } from '../_shared/report.js';
import { gameBrief, articleBody, reportSlug } from '../_shared/matchreport.ts';
// the situations (second chance, transition, off turnovers, after timeout, half
// court, assisted or not) stored on every stats row. possessions.js FIRST and for
// its side effect, like story.js above: situations.js finds the chance enumerator
// on globalThis, and there is no require in Deno to fall back on. Without it the
// chance-based numbers are all zero, which compute() reports as possessions:false.
import '../_shared/possessions.js';
import { compute as computeSituations, toStored as storedSituations } from '../_shared/situations.js';

/* EVERY HEADER A BROWSER ACTUALLY SENDS HAS TO BE NAMED HERE.

   This said 'authorization, content-type', and the scorer — like every other
   caller on the platform — sends apikey alongside them. A preflight that does
   not clear every requested header is refused by the browser before the real
   request is ever made, and the fetch rejects with a bare "Failed to fetch"
   that is indistinguishable from being offline. So finalising a game failed
   from the browser every single time, while curl and every server-side call
   worked perfectly, because only a browser enforces this.

   contact, feeds, merch and socials all list apikey already; this function was
   the one that did not. x-client-info is added too — supabase-js attaches it
   to its own requests, so anything later routed through the SDK rather than a
   hand-written fetch does not reintroduce the same failure. */
const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
/* The report's headline and standfirst are escaped for HTML, because that is
   what the page wants. A news title is a text column and gets the plain form. */
const stripTags = (s: string) => String(s)
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

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
  /* THE INGEST WORKER IS A CALLER TOO. It holds the service-role key (GitHub Actions
     secret), never a person's session, so it identifies itself with that key and its
     actions are attributed to a platform admin in the audit log. Everything else it does
     goes through the admin client anyway; this only lets it reach the finalise gate. */
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  let isWorker = bearer.length > 0 && bearer === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!isWorker && bearer && req.headers.get('x-ingest-worker') === '1') {
    // the worker may hold the newer sb_secret_… form of the service key, which is not the
    // string this function was deployed with — prove the privilege instead of matching bytes:
    // only a service-role key may list users.
    try {
      const probe = createClient(Deno.env.get('SUPABASE_URL')!, bearer, { auth: { persistSession: false } });
      const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
      isWorker = !error;
    } catch (_) { isWorker = false; }
  }
  let user: { id: string } | null = null;
  if (isWorker) {
    const { data: adminRow } = await admin.from('memberships').select('user_id')
      .eq('role', 'platform_admin').limit(1).maybeSingle();
    user = { id: adminRow?.user_id ?? '00000000-0000-0000-0000-000000000000' };
  } else {
    const got = await caller.auth.getUser();
    user = got.data.user;
  }
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

  /* SEEING A GAME IS NOT BEING ALLOWED TO CHANGE IT.

     This used to be the whole check: read the row as the caller and carry on
     if RLS returned it. But can_read_game (0005) makes every scheduled and
     every final game public, and a live one too where the league has
     public_live on — so a fan's account passed, and with this function's
     service role could reopen any final game (deleting its box score and
     lineups) or finalise somebody else's live one.

     The read stays, because it is still how a game the caller cannot even see
     is refused, and it brings back the status. The question that decides it is
     the one the database already answers for every other write to a game:
     may_score_game (a platform admin, an official on this game, an
     administrator or statistician of its league) or can_manage_game (which
     adds the creator of an ad-hoc game). Both are asked as the CALLER. A
     failed call leaves data null, which is a refusal, not a pass. */
  const { data: allowed } = await (isWorker ? admin : caller).from('games')
    .select('id,status,competition_id').eq('id', gameId).maybeSingle();
  if (!allowed) return json({ error: 'not your game' }, 403);
  if (!isWorker) {
    const [{ data: scorer }, { data: manager }] = await Promise.all([
      caller.rpc('may_score_game', { p_game: gameId }),
      caller.rpc('can_manage_game', { p_game: gameId })
    ]);
    if (scorer !== true && manager !== true) return json({ error: 'not your game' }, 403);
  }

  // --------------------------------------------------------------- reopen ---
  if (reopen) {
    if (allowed.status !== 'final') return json({ error: 'game is not final' }, 409);
    await admin.from('player_game_stats').delete().eq('game_id', gameId);
    await admin.from('team_game_stats').delete().eq('game_id', gameId);
    await admin.from('lineup_stints').delete().eq('game_id', gameId);
    await admin.from('games').update({ status: 'live', finalised_at: null, finalised_by: null }).eq('id', gameId);
    await admin.from('audit_log').insert({ actor: user.id, action: 'reopen', subject: 'game', subject_id: gameId });
    /* The table counts final games only, so a reopened one has to leave it
       until it is finalised again, which rebuilds it once more. Not fatal: the
       game is reopened either way, and the response says the table is stale. */
    const warnings: string[] = [];
    if (allowed.competition_id) {
      const { error } = await admin.rpc('recompute_standings', { p_competition: allowed.competition_id });
      if (error) warnings.push('standings could not be rebuilt: ' + error.message);
    }
    return json({ ok: true, status: 'live', warnings });
  }

  if (allowed.status === 'final') return json({ error: 'already final' }, 409);

  // ----------------------------------------------------------- load state ---
  /* THE LOG IS READ A THOUSAND ROWS AT A TIME. PostgREST caps a response at 1000
     rows and says nothing when it does: a regulation LiveStats game is already
     800 events, so an overtime one could come back cut short and be finalised
     from its first thousand plays, the last minutes missing from every table.
     Pages are ordered by seq (unique per game) and read until one comes back
     short -- the same paging the backfills use, so the two cannot disagree.

     A page that fails is a refusal, not a shorter log. Nothing has been locked
     or deleted yet, so the game is left exactly as it was. */
  const readEvents = async () => {
    const out: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('game_events').select('*').eq('game_id', gameId)
        .order('seq').range(from, from + 999);
      if (error) return { rows: out, error: error.message };
      out.push(...(data ?? []));
      if (!data || data.length < 1000) return { rows: out, error: null };
    }
  };
  const [{ data: g }, log, { data: state }] = await Promise.all([
    admin.from('games').select('*').eq('id', gameId).single(),
    readEvents(),
    admin.from('game_state').select('*').eq('game_id', gameId).maybeSingle()
  ]);
  if (log.error) return json({ error: 'the event log could not be read', detail: log.error }, 500);
  const rows = log.rows;

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

  /* A translated feed (B.LEAGUE) snapshots its players in katakana and kanji; the players
     rows carry the romanised name their profile shows. Swap it in here so the published
     report -- headline, standfirst, prose -- names players the way the page around it does
     (the game page does the same in game.js romanise()). A name with no romanised twin, or
     a failed read, stays as the feed wrote it. */
  try {
    const NON_LATIN = /[぀-ヿㇰ-ㇿ㐀-鿿豈-﫿ｦ-ﾟ가-힯]/;
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const need: any[] = [];
    for (const tm of game.teams) for (const p of (tm?.players ?? []))
      if (p && UUID.test(String(p.id ?? '')) && NON_LATIN.test(String(p.name ?? ''))) need.push(p);
    if (need.length) {
      const { data: prs } = await admin.from('players').select('id,first_name,last_name')
        .in('id', need.map((p) => p.id));
      const latin = new Map<string, string>();
      for (const r of (prs ?? []) as any[]) {
        const n = `${r.first_name ?? ''} ${r.last_name ?? ''}`.replace(/\s+/g, ' ').trim();
        if (n && !NON_LATIN.test(n)) latin.set(r.id, n);
      }
      for (const p of need) if (latin.has(p.id)) p.name = latin.get(p.id);
    }
  } catch (_) { /* a report in the feed's script beats no report */ }


  // ---------------------------------------------------------- sanity gate ---
  const d = deriveGame(game);
  const TA = [teamAdv(game, d, 0), teamAdv(game, d, 1)];
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (game.period < 4) blocking.push(`only ${game.period} periods played`);
  if (game.clockMs > 0) warnings.push('clock is not at zero');
  if (d.score[0] === d.score[1]) blocking.push('scores are level — play overtime');

  /* ONE PERSON CANNOT BE TWO OF THE TEN ON COURT. player_game_stats is keyed (game_id,
     player_id), so a roster snapshot naming the same player twice does not make a blurred box
     score, it makes an insert that throws a duplicate key half way through the rebuild below —
     which lands in the catch, reopens the game, and leaves a finished match sitting at Q4 0:00
     with a Postgres string in external_games.error. Bristol Hurricanes v Gloucester (19 Sep
     2026) did exactly that: a stale FIBA LiveStats slot stamp gave Kobe Hill's line to Corey
     Samuels, who already held his own slot. The feed side is fixed (feedplatform.by_feed_key
     checks the name on the stamp, ensure_game_people gives one player one slot), and this says
     so in words if anything ever puts such a snapshot up again. Blocking, not deduplicated:
     the two slots' stats are already conflated by the time they get here, so there is no
     correct box score to publish — the sheet has to be fixed, not averaged. */
  const byPlayer = new Map<string, string[]>();
  [0, 1].forEach(t => game.teams[t].players.forEach((p: any) =>
    byPlayer.set(String(p.id), [...(byPlayer.get(String(p.id)) ?? []), p.name || String(p.id)])));
  for (const [, names] of byPlayer)
    if (names.length > 1) blocking.push(`${names.join(' and ')} are the same player on the team sheet — fix the roster`);

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

  /* ------------------------------------------------------- the situations ---
     Worked out from the same game object the box score was, by the same
     situations.js the game page's EVENTS tab runs, and stored as one compact
     line under `sit` on every row (epinoia/situations.js toStored has the
     shape). The season tables and both profiles read nothing else.

     NEVER ALLOWED TO STOP A FINALISE. The box score is the result; the splits
     are a view of it. A throw here, or a run without the chance enumerator
     (possessions:false, where every chance count would be a confident zero),
     writes no `sit` at all rather than a wrong one, says so in the warnings,
     and leaves the game for scripts/backfill_situations.mjs to fill in. */
  let SIT: { teams: any[]; players: Record<string, any> } | null = null;
  let SITC: any = null;             // the full result too: the match report reads each side's buckets
  try {
    const C = computeSituations(game);
    if (C && C.possessions) { SIT = storedSituations(C); SITC = C; }
    else {
      console.warn(`[finalise] situations for ${gameId}: possessions.js did not load, no sit written`);
      warnings.push('the events splits were not stored (no chance enumerator) — run the situations backfill');
    }
  } catch (e) {
    console.warn(`[finalise] situations for ${gameId} failed:`, String(e));
    warnings.push('the events splits could not be worked out — run the situations backfill');
  }

  // ---------------------------------------------------------------- lock ---
  /* ONE FINALISE AT A TIME, AND THE LOCK SAYS WHOSE IT IS. This was a plain update to
     'finalising', so two calls for the same game - the GitHub lane and the PC's lane both see
     the final whistle within a second - both took it, both rebuilt the box score, and the one
     whose insert lost the race hit player_game_stats_pkey, fell into the catch below and set the
     game back to 'live' AFTER the other had published it. Alba Berlin v Skyliners (24 Sep 2026,
     84a0d371) sat at "live" with a complete box score and an audit row saying it was finalised.

     Now the update only happens if the game is not final and not already being finalised, and
     stamps the lock's start in finalised_at (publishing overwrites it with the real time). A lock
     older than five minutes is a finalise that died without reaching its catch, and may be taken
     over, so a crashed run can never leave a game unfinalisable. */
  const lockedAt = new Date().toISOString();
  const staleLock = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: locked, error: lockErr } = await admin.from('games')
    .update({ status: 'finalising', finalised_at: lockedAt })
    .eq('id', gameId)
    .or(`status.not.in.(final,finalising),and(status.eq.finalising,or(finalised_at.is.null,finalised_at.lt."${staleLock}"))`)
    .select('id');
  if (lockErr) return json({ error: 'the game could not be locked', detail: lockErr.message }, 500);
  if (!locked?.length) return json({ error: 'already being finalised' }, 409);

  try {
    // ------------------------------------------------------------ rebuild ---
    /* `sit` goes LAST and under that one nested key: the season views cast
       top-level keys (ast, to, pts...) to int, so nothing new may sit beside
       them. A player who did nothing has no line and gets no key; a side's line
       is always there when the situations were worked out. */
    const playerRows = [0, 1].flatMap(t =>
      game.teams[t].players.map((p: any) => ({
        game_id: gameId, player_id: p.id, team_idx: t,
        stats: { ...d.stats[p.id], adv: playerAdv(game, d, t, p, TA[t], TA[1 - t]),
                 ...(SIT && SIT.players[p.id] ? { sit: SIT.players[p.id] } : {}) }
      })));
    const teamRows = [0, 1].map(t => ({
      game_id: gameId, team_idx: t,
      stats: { ...d.team[t], adv: TA[t], perQ: d.perQ[t], score: d.score[t],
               ...(SIT ? { sit: SIT.teams[t] } : {}) }
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

    /* ------------------------------------------------- the match report ---
       Written from the replay that has just produced every table above, by
       the same story.js/report.js the public page renders with, so the
       article and the page it links to cannot describe the game differently.

       NON-FATAL, like everything after the status flip. The game is final and
       its box score is correct whatever happens here; a failed report is a
       missing article, not a broken result, and it is reported rather than
       swallowed so nobody has to guess why the news page is empty.

       Idempotent by slug, which is derived from the game id: re-finalising a
       reopened game rewrites its own report instead of leaving two. Reopening
       to fix a scoring mistake is normal, and the report must follow the
       correction rather than accumulate. */
    try {
      const { data: tgt } = await admin.rpc('game_report_target', { p_game: gameId });
      const target = Array.isArray(tgt) ? tgt[0] : tgt;
      if (target?.league_id && target.auto_reports) {
        /* the dateline: the games row has venue, attendance and tip-off; the
           competition and league names are one hop away */
        let comp: any = null;
        try {
          const { data: c } = await admin.from('competitions')
            .select('name,seasons(leagues(name,slug,timezone))').eq('id', g.competition_id).maybeSingle();
          comp = c;
        } catch (_) { /* a report without a dateline is still a report */ }
        const brief = gameBrief(game, d, TA, lineupAgg, {
          venue: g.venue, attendance: g.attendance, tipoff_at: g.tipoff_at,
          competition: comp?.name ?? null, league: comp?.seasons?.leagues?.name ?? null,
          leagueSlug: comp?.seasons?.leagues?.slug ?? null,
          timezone: comp?.seasons?.leagues?.timezone ?? null,
          sits: SITC ? [SITC.side[0].sits, SITC.side[1].sits] : null
        });
        const rep = buildReport(brief);
        const slug = reportSlug(gameId);
        const { error } = await admin.from('news_articles').upsert({
          league_id: target.league_id,
          slug,
          game_id: gameId,           /* the card draws the two clubs from it (0105) */
          title: stripTags(rep.headline),
          standfirst: stripTags(rep.standfirst),
          body: articleBody(rep, gameId),
          status: 'published',
          published_at: new Date().toISOString(),
          author_id: null,
          author_name: 'Epinoia match report',
          updated_at: new Date().toISOString()
        }, { onConflict: 'league_id,slug' });
        if (error) warnings.push('the match report was not filed: ' + error.message);
      }
    } catch (e) {
      console.error('[finalise] match report failed:', String(e));
      warnings.push('the match report could not be written');
    }

    // queue the static page + OG image; a scheduled job commits these in batches
    await admin.from('publish_queue').upsert({ game_id: gameId, requested_at: new Date().toISOString() });

    // THE FANS. Everyone following either club gets the score, everyone following a player in
    // it gets his line (notify_game_final, 0106); then the notify function emails and pushes to
    // those who asked. Neither may fail a finalise.
    try {
      await admin.rpc('notify_game_final', { p_game: gameId });
      const sk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      fetch(Deno.env.get('SUPABASE_URL')! + '/functions/v1/notify', {
        method: 'POST', headers: { apikey: sk, Authorization: 'Bearer ' + sk, 'Content-Type': 'application/json' }, body: '{}'
      }).catch(() => {});
    } catch (e) { console.error('[finalise] fan notifications:', String(e)); }

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
    // never strand a game in 'finalising' - but only ever undo THIS call's own lock: a game
    // somebody else has since finalised (or re-locked) is theirs, and stays as they left it
    await admin.from('games').update({ status: 'live', finalised_at: null })
      .eq('id', gameId).eq('status', 'finalising').eq('finalised_at', lockedAt);
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
  const url = `${base}/epinoia/game/?g=${gameId}&mode=supabase`;

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
