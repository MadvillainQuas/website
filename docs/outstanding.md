# Outstanding work

Generated 2026-09-12 from a 27-agent survey of the platform (six market-research lanes on
Sportzcast/Genius, Sports Connect and the rival scoring, broadcast and league-ops field; seven
code-audit lanes, each with an adversarial verification pass). Ranked by the synthesis, with
correctness and on-air embarrassment ahead of features, and cheap-and-valuable ahead of
expensive-and-valuable.

**Read this first:** these are findings, not instructions. Several first-pass claims were wrong
when checked against the code, and at least one was wrong about production (see #2). Verify each
one yourself before acting on it — the audit prompt asked for adversarial verification precisely
because auditors report problems that are already solved a few lines below what they read.

## Progress

Items marked **STATUS — DONE** below were completed on 2026-09-12. As of that date:
1, 2, 4, 5, 6, 8, 9, 11, 12, 13, 14, 16, 17 and 18 are done, plus the whole LiveStats-to-footage video
sync chain and the starting-five preview graphic (neither of which was on this
list). Item 4 — gateScorer treating a transport error as a refusal — was deferred while
live fixtures were imminent and has since been done.

## The headline

> Epinoia's analytics and transport engineering is already ahead of the commercial field, but four verified defects silently corrupt on-air stats, the permanent box score, and a statistician's ability to keep scoring when hall wifi drops — and three of the platform's public integration surfaces (api, broadcast, ics) return 401 to every call shape their own documentation describes, because config.toml never turned off the gateway JWT check.

**Correction to that headline, checked against production on 2026-09-12:** `api` and `ics` do NOT
401 — both were deployed with the gateway check off and answer an anonymous request today
(`curl` them and see). The survey reasoned from `config.toml` rather than testing. Only `broadcast`
was genuinely gated. The real defect was the opposite one and is fixed: the file had drifted away
from the deployment, so deploying `api` or `ics` FROM it would have switched the check back on and
silently 401'd every API key call and every subscribed team calendar.

## Where Epinoia stands

Where Epinoia genuinely wins: the clock model. live.js publishes a clock as {clock_ms, running, updated_at, source}, ticks locally against a one-shot server offset, arbitrates keeper/cam/feed with AUTHORITY_MS + HANDOVER_MS + an assert override, and freezes rather than inventing time when a source dies. Sportzcast ships digits 1–2s late; FIBA LiveStats hands the clock to hardware and locks the human out. Louie's is better, and it cost nothing per viewer. diffLog comparing identities rather than counts, the ordered backlog that drains held frames first, whole() rounding at the table boundary, the finalise gate that refuses to close a game the server cannot reproduce, and one shared engine.js feeding scorer, box score, broadcast and the edge function — all of these are above the standard of the products being sold against.

clockcam is the genuinely uncopyable asset: a purpose-built seven-segment decoder with Otsu thresholding, per-digit adaptive cuts, three-frame PWM voting and a physics model that refuses implausible jumps, benched at 90.3% read / 0.5% wrong. That is ScoreLink's job done over a camera with no console, no cable and no licence. The analytics stack (RAPM, BPM 2.0, on/off, stints, shot zones, play types) is a category above PlayHQ eScoring, FIBA Organizer or NBN23, none of which produce any of it.

Where Epinoia is behind, honestly: operations maturity. No shot clock anywhere. No venue/court entity, so the Sunday-central-venue format 68 English leagues actually run cannot be scheduled or clash-checked. No forfeit result. Tiebreakers declared in leagues.rules and ignored by recompute_standings. player_ban() and membership_status() have zero callers — the closed loop that sells the product does not close. No sponsor inventory, so a league that streams cannot monetise it. No PlayHQ adapter, which is now the price of entry to the home market. And the broadcast layer hard-cuts every graphic with zero @keyframes in 616 lines of CSS, which reads amateur beside anything LIGR ships.

The strategic correction that should govern the build order: the digital scoresheet is now free, from both FIBA and Basketball England. Stop selling capture. Sell what the same twenty minutes at the table also yields — a shot chart, a broadcast-ready scorebug, a player page worth sharing — on top of a PlayHQ membership the league is obliged to hold anyway.

## Needs Louie, not an engineer

- Deploying the config.toml verify_jwt change and confirming with a bare curl carrying no Authorization header — the edit is trivial, the deploy needs his Supabase credentials.
- Any migration that touches recompute_standings, roster_entries RLS, or the players_write policy on a live league database — these are behaviour-changing on production data and want his sign-off plus a quiet window.
- A real hall with a real scoreboard to verify the clockcam box-slip signature guard, the exposure lock, and the shot-clock reader. Nothing in that lane can be honestly signed off from a rendered bench alone.
- A decision on the capture-tier default per league ('score' / 'scoresheet' / 'full') — this is a product-positioning call, not an engineering one, and it determines what the derived pages are allowed to publish.
- A vMix licence (or the free trial) and one hour to author epinoia-scorebug.gtzip in GT Title Designer — the code path is cheap, the template is hand-drawn and needs his eye.
- Whether suspensions block or merely warn at the scorer's table, and who may override. The schema supports both; picking wrong ends a league's trial either way.
- A PlayHQ participant CSV export from a real Basketball England affiliated league, to map columns against rather than guess.
- Confirmation that the OBR 2026 foul vocabulary (category 1/2 technicals, disruptive, flagrant) is what his leagues will actually play under next season, before engine.js is migrated to it.
- Sponsor inventory design — logo slot sizes, dwell timing, and whether the feature is gated behind a paid league tier.
- A Stripe Connect Standard decision if team entry fees and fines are ever built: the league must be merchant of record, and that is a commercial posture Louie has to choose deliberately.

## The ranked list

### 1. Stop the broadcast layer re-normalising already-flat live events

**critical** / hours · `broadcast`

> **STATUS — DONE 2026-09-12 — guarded rowToEvent on the presence of a payload column; test supabase/tests/broadcast-liveevents.test.mjs.**

**Why.** rowToEvent is written for a raw PostgREST row and re-applied to every live frame, which already carries flattened events. Re-applying it returns only the seven core fields, so on air a 'sub' loses out/in (onCourt becomes a permanent six-man list with a blank card), every offensive rebound counts as defensive, techs and DQs vanish, and loc/stype lose their ref so the rim/mid split collapses. The 10s full snapshot re-strips the WHOLE log, so it is not transient. The scorebug survives because points derive from t alone, which is exactly why nobody has noticed — every during-play stat card has been quietly wrong all season.

**What.** In epinoia/broadcast/broadcast.js:122 guard rowToEvent on the shape it is handed: `const rowToEvent = r => ('payload' in r) ? Object.assign({id:r.seq,seq:r.seq,t:r.t,team:r.team,pid:r.pid,period:r.period,clock:r.clock}, r.payload||{}) : Object.assign({}, r, {id: r.id != null ? r.id : r.seq, seq: r.seq != null ? r.seq : r.id});`. The boot path (rows with a payload column) is unchanged; the live path passes through verbatim, matching what game.js:2108-2128 already does correctly. Add a test that feeds merge() a scorer-shaped sub and an {off:true} reb and asserts deriveGame yields the same onCourt and OR/DR split as the DB-row path.

**Risk.** None to the boot path — the guard keys on a column only PostgREST rows have. Verify by booting the layer against a finished game (boot path) and then feeding it a synthetic live sub frame, and asserting the lineup card is identical both ways.

`epinoia/broadcast/broadcast.js`, `epinoia/engine.js`

### 2. Turn off the gateway JWT check for api, broadcast and ics in config.toml

**critical** / hours · `integration`

> **STATUS — PARTLY DONE 2026-09-12 — the survey was wrong that api and ics were gated: both were deployed open and answer anonymously (verified with curl). config.toml had drifted the dangerous way and now matches the deployment. `broadcast` really is gated and is LEFT so pending Louie: a vMix data source cannot send a header.**

**Why.** Verified: config.toml's own header asserts api and broadcast 'keep the default verify_jwt = true' and are 'unaffected'. With that on, the Supabase gateway demands a project-signed JWT before the function runs. But epk_ keys are not JWTs, and every documented call shape (X-API-Key header, ?key= query) carries no Authorization at all — so api/index.ts:367 never executes and the whole key/rate-limit/attribution design is unreachable. ics has the same problem with its --no-verify-jwt intent living only in a source comment, so every subscribed team calendar 401s silently (calendar clients never surface subscription errors), and broadcast 401s on a match night.

**What.** Add [functions.api], [functions.broadcast] and [functions.ics] blocks with verify_jwt = false to supabase/config.toml, each carrying a comment in the style the livestats and share blocks already use. Correct the file header comment, which currently asserts the opposite. Delete the --no-verify-jwt claim from supabase/functions/ics/index.ts:8 and point it at the config block so intent and deploy live in one file.

**Risk.** This genuinely makes all three anonymous, which is intended: api still authenticates and meters itself via api_key_check (a 401 from the function, not the gateway), and broadcast/ics read with the anon key under RLS so they expose nothing a site visitor cannot already see. Verify each with a bare curl carrying no Authorization header before believing it — that check needs Louie's deploy.

`supabase/config.toml`, `supabase/functions/ics/index.ts`, `supabase/functions/api/index.ts`

### 3. Give the scorer its own service worker so a wifi drop does not serve a dead page

**critical** / days · `scorer`

**Why.** Verified: epinoia/sw.js caches nothing and its fetch handler returns a hard-coded 503 reading 'Nothing is stored on this phone'. nav.js and me/me.js register it at scope '/epinoia/', which covers '/epinoia/score/'. So any statistician whose phone has ever opened an Epinoia page gets that dead page — for index.html and every script — the moment hall wifi drops, while epinoia_v1 holds the entire first half. The message is false, it is shown to somebody mid-game, and it discourages the one thing that would help. The app described as offline-first is not offline-capable at all.

**What.** Create epinoia/score/sw.js and register it at the bottom of score/index.html with scope '/epinoia/score/' — a more specific scope wins, so it displaces the push worker for the scorer only and leaves the public site's deliberate no-cache decision untouched. Precache on install with the exact query strings as deployed (index.html:6497-6505 and the @font-face block at 27-51): '/epinoia/score/', sync.js?v=239, bootstrap.js?v=239, ../config.js?v=281, ../vendor/supabase.js?v=239, ../live.js?v=305, ../video.js?v=293, ../kit/fonts.css?v=239, ../video.css?v=276, ../kit/scorer-type.css?v=274, and the five woff2 faces. Serve cache-first; on a miss retry caches.match(req,{ignoreSearch:true}) so a version bump can never 503 a scorer mid-season. Do not call respondWith at all for anything on CFG.supabaseUrl. Name the cache ep-score-<build>, skipWaiting + clients.claim, delete every other ep-score-* on activate. Post {type:'precached'} to clients and have bootstrap.js hold the 'go into game' CTA until it arrives, showing 'ready to score offline'.

**Risk.** A stale cached script after a redeploy. Bounded by the ?v= stamps plus the cache-name bump on activate. Verify in Chrome devtools: load the scorer, tick Offline, reload, and confirm the scoring UI comes up with the saved game rather than the 503.

`epinoia/sw.js`, `epinoia/score/index.html`, `epinoia/score/bootstrap.js`, `epinoia/nav.js`

### 4. Stop gateScorer treating an unanswered question as a refusal

**critical** / hours · `scorer`

> **STATUS — DONE 2026-09-12 — gateScorer now returns three states. A transport error or a thrown call is 'could not ask', which lets the scorer run, publishes nothing, says so on the badge and re-asks every 20s; only a clean `data === false` (or being signed out) refuses. halt() is not reached on that path. Tests in supabase/tests/durability.test.mjs.**

**Why.** Verified at bootstrap.js:1767: `allowed = !error && data === true` with a catch that sets allowed=false. A transport error is indistinguishable from 'you may not score this'. Hall wifi drops at 28 minutes, the PWA is relaunched or the tab is killed for memory, the RPC fails, and refuse() calls EpinoiaSync.halt() (permanent, per sync.js:305), sets refused=true which kills the takeover guard and every video write, and mounts a full-screen panel at z-index 2147483600 — above the escape-hatch bar, so the saved-game control is physically unreachable behind it. The statistician is told they are not authorised to score the game in their hands, and nothing recovers when the wifi returns.

**What.** In gateScorer() (bootstrap.js:1751) return a third state, 'unverified', whenever `error` is present or the call threw; keep refuse() only when the RPC returned cleanly with data === false. In the unverified state let the scoring UI run, leave EpinoiaSync unattached so no phantom score can be broadcast, set the badge to 'offline · not verified' via say(), and re-run gateScorer on a 20s interval until it gets a definite answer — attaching sync on a yes, refusing on a definite no. Move the halt() at bootstrap.js:1701 out of the unverified path entirely; halt() is documented as one-way.

**Risk.** Someone holding a fixture link with no network briefly sees the scoring UI. Acceptable: every durable write is independently gated by can_score at the row level, and not attaching sync closes the broadcast hole the gate exists for. Verify by blocking the RPC in devtools and confirming the UI runs, publishes nothing, and attaches when the block is lifted.

`epinoia/score/bootstrap.js`, `epinoia/score/sync.js`

### 5. Move the guarded latch so a failed count does not disable the takeover guard for the game

**critical** / hours · `scorer`

> **STATUS — DONE 2026-09-12 — `guarded = true` moved to after the count read, so a refused or thrown request leaves the guard armed for the next poll. Test in supabase/tests/takeover.test.mjs. The scoring_session_id half of the suggestion was NOT done.**

**Why.** Verified at bootstrap.js:472: `guarded = true` is set BEFORE anything is attempted, and three paths then return without clearing it (no client, res.error, thrown request). The 3s poll calls it forever and it returns at line 470 every time. Hall wifi down at page load — the normal case after the crash the same flaky connection caused — latches it for the session. The device then scores a parallel copy from evSeq 0, its ids collide with the durable rows, the upsert's ignoreDuplicates throws every one away silently, and maybeScore writes its own 0-0-onwards score onto the games row while the badge says 'live'.

**What.** Move `guarded = true` from bootstrap.js:472 to immediately after `count = res.count || 0;` so only a successful read latches it. Then add the case counting structurally cannot see: in claimFixture (bootstrap.js:194-200) include a per-load `scoring_session_id: crypto.randomUUID()` in the patch, and in sync.js watchStatus (267) select it alongside status — when a successful read returns an id that is not this load's, call halt() and surface offerTakeover. Two devices starting together never trip a count comparison (both see 0 <= 0) and this catches them.

**Risk.** scoring_session_id needs a column on games; until the migration lands the isUnknownColumn tolerance pattern at live.js:169 keeps the claim working without it. The latch move alone is one line and carries no risk — ship it tonight and the session id separately.

`epinoia/score/bootstrap.js`, `epinoia/score/sync.js`

### 6. Remove the simulate button from real fixtures — it DELETEs the durable event log

**critical** / hours · `scorer`

> **STATUS — DONE 2026-09-12 — the button is removed outside the practice game and simulateGame refuses as a floor under it. Note the suggested "leave evSeq alone" fix does NOT work: diffLog matches from index 0, so an emptied array retracts everything regardless. Test: supabase/tests/scorer-simulate.test.mjs.**

**Why.** Verified: btnSim is an ordinary always-visible entry in the slide-up sheet (index.html:1569), listed in both SHEET_PREGAME and SHEET_INPLAY at 4398-4400, immediately before 'end game'. Its handler asks one askConfirm and runs simulateGame, which does S.events=[]; S.evSeq=0. diffLog then sees sentIds [1..520] against S.events [1], agrees at index 0 and stops, so removed = seqs 2..520 — and live.js:225 issues a real DELETE that the policy permits, because the scorer is precisely who may delete on an unfinished game. Five hundred and nineteen rows of a real game are removed from the league database in one frame and the simulator's fabricated events are inserted over the same seq range. Both copies gone, on the happy path.

**What.** In initSetup() (index.html:6039) add `if (!EP_TRAIN) { const b = $('#btnSim'); if (b) b.remove(); }`, and drop 'btnSim' from SHEET_PREGAME and SHEET_INPLAY (4397-4400) so orderSheet does not reference a missing node. Independently harden simulateGame at 5858: do not reset S.evSeq to 0 — leave it where it is so a stray invocation can only ever append, never make diffLog emit a retraction.

**Risk.** None for the demo, which is where the function is actually used (EP_TRAIN is already a first-class flag at index.html:1734); the browser console remains a route for testing. Verify the sheet still renders with the button absent and that ?train=1 keeps it.

`epinoia/score/index.html`, `epinoia/live.js`

### 7. Delete before upsert in the Supabase transport, and make diffLog content-aware

**critical** / hours · `transport`

**Why.** Two coupled defects that together lose corrections permanently. (a) send() pushes the events upsert into jobs first and the delete second, then fires both with Promise.allSettled — so both requests leave in the same tick and the server orders them, contradicting the publisher's own comment at live.js:89-92 that retractions must apply first. Because ignoreDuplicates makes the upsert a no-op for rows that still exist, a mid-log time correction deterministically truncates the durable log from the correction point. (b) diffLog compares ids positionally only, so an in-place edit that keeps its id and position — correcting a foul from personal to shooting, fixing which player scored, flipping a rebound to offensive — generates no frame at all. The 10s snapshot broadcasts the corrected object so the live view self-heals and looks right all game, but ignoreDuplicates means the durable row keeps its old payload forever, and finalise-game rebuilds the permanent box score from that row.

**What.** In supabaseTransport.send (live.js:207) await the delete BEFORE building the upsert, mirroring localTransport: `if (frame.removed && frame.removed.length) { const r = await sb.from('game_events').delete().eq('game_id', gameId).in('seq', frame.removed); if (r.error) { onError && onError(r.error, frame); return false; } }` then push the events upsert and state write into jobs as today. With the delete guaranteed first the rows are gone when the upsert runs, so it inserts fresh and ignoreDuplicates can stay (which keeps the 10s snapshot cheap). Then in diffLog (live.js:65-74) build the comparison key as id + ':' + JSON.stringify(rest) excluding volatile fields like wall, so an in-place edit registers as removed-then-added and the existing retraction machinery carries it. Keep returning raw ids in removed/ids — only the comparison changes.

**Risk.** One extra round trip on the rare frame carrying a retraction. JSON.stringify on every event on every 2s drain is a few ms at 800 events; hash only the non-core fields if it measures. Do NOT drop ignoreDuplicates on its own — without the ordering fix the 10s snapshot would rewrite all 800 rows every 10s and the delete would race its replacement. Verify with a scripted edit-in-place and a mid-log time correction, asserting the durable rows match the scorer's log after each.

`epinoia/live.js`, `epinoia/score/sync.js`, `supabase/functions/finalise-game/index.ts`

### 8. Sort events by game clock inside deriveGame so retro-added plays are not replayed after the buzzer

**critical** / hours · `integration`

> **STATUS - DONE 2026-09-12 - deriveGame sorts into game order before replaying, stably, with the incoming index as the tiebreak so a run of free throws at one dead ball keeps the order it was shot in; an already ordered log is returned untouched and the caller's array is never reordered. NOTE the item overstated the damage: per-player MINUTES survive the old behaviour, because cum is read off the event's own period and clock rather than its position. What was destroyed is everything measured between events - a stint clamped to zero, plus-minus reported as 0 for both players in a missed substitution, on-court totals attributed to five who were not on the floor, and the play-by-play in entry order. Measured in supabase/tests/engine-order.test.mjs, which fails 8 assertions against the pre-fix engine.**

**Why.** The scorer's log is ordered by game time — a normal tap pushes, but 'add a missed play' splices at insertPos(cumEl(period, clock)) with the highest id. The transport carries no position: the durable table is keyed by seq, snapshot() and delta() both .order('seq'), broadcast.js:1528 sorts by seq, game.js sorts by id, and finalise-game reads .order('seq'). So a play added retroactively at 7:41 of Q1 is replayed after the final buzzer. close(t, cum) sees cum jump backwards and clamps the stint to 0, lastIn minutes clamp to 0, the possession arrow and the second-chance/points-off-turnover/transition windows replay against the wrong neighbour, and ptsAst credits the wrong lastMade. The scorer's own screen is right and the public page, the on-air lineups and the permanent box score are wrong. It is also self-inconsistent on air: broadcast.js:1519 preserves the scorer's order while :1528 re-sorts, so the lineup graphic changes depending on which frame landed last.

**What.** At the top of deriveGame in epinoia/engine.js, before the descriptor pass at ~line 157, replace events with a stable copy sorted by cumEl(ev.period||1, ev.clock != null ? ev.clock : PLEN(ev.period||1)). Array.prototype.sort is stable, so a plain sort on the cum key already preserves incoming order for equal clocks — which is what keeps a same-clock free-throw sequence in the order it was tapped. Do NOT tiebreak by id; that would reorder those. Every consumer and finalise-game already funnel through this one function.

**Risk.** Re-finalising an already-final game containing retro-added plays will produce slightly different stints, minutes and assist credit — that is the point, but announce it rather than let a league notice a number move. Do not fix this by publishing an explicit position field: that needs a migration and leaves the ~200 already-recorded games wrong. Verify with a fixture containing one spliced event, asserting stints and minutes match a log where the same event was tapped in order.

`epinoia/engine.js`, `epinoia/broadcast/broadcast.js`, `epinoia/game/game.js`

### 9. Restore starters, tip winner and arrow on takeover — every minute and on/off number depends on them

**critical** / hours · `scorer`

> **STATUS - DONE 2026-09-12 - loadRecorded now reads starters, tip_winner and arrow_init from games and applies them, with the ids checked against the squad this device is holding so a reverted snapshot cannot put an unknown player on court. Tests in supabase/tests/takeover.test.mjs.**

**Why.** loadRecorded (bootstrap.js:499) rebuilds S.events from game_events and reads period/clock from game_state, but never reads games.starters, games.tip_winner or games.arrow_init — all three of which claimFixture wrote at tip. S.starters stays whatever THIS device picked, and the picker defaults to the first five of the roster. derive() seeds onCourt and the stint accumulator directly from S.starters and replays subs from there, so a single wrong starter puts the wrong player on court for every possession until their first substitution, shifting every lineup, every plus/minus, every minutes total and every on/off split for the game. Nothing warns — the box score looks complete and the analytics underneath it are quietly wrong, which is precisely the data the platform exists to produce. S.tipWinner and S.arrowInit are likewise unset, so the alternating-possession arrow starts from null and is wrong all game.

**What.** In loadRecorded (bootstrap.js:499), alongside the game_state read at 527, select starters, tip_winner and arrow_init from games and apply them before calling buildPmap(): `if (g.starters) S.starters = g.starters; if (g.tip_winner != null) S.tipWinner = g.tip_winner; if (g.arrow_init != null) S.arrowInit = g.arrow_init;`. Player ids match because loadFixture already returned the frozen roster_snapshot, which is the same snapshot claimFixture wrote the starters against.

**Risk.** A game claimed before this shipped may have a null starters column — fall back to the current S.starters and say so in the takeover panel ('starting fives could not be recovered — check them in the log') rather than silently proceeding. Verify by taking over a half-scored game on a second device and asserting the derived minutes match the original device's.

`epinoia/score/bootstrap.js`, `epinoia/score/index.html`

### 10. Stop the local copy of a live game being overwritten within 1.5s of a reload

**critical** / days · `scorer`

**Why.** A recovery route exists — guardAgainstOverwrite plus offerTakeover plus loadRecorded — but the local copy is destroyed before it can run, and the guard needs the network the crash usually took away. On reload with 520 events in localStorage, adoptVideo's 1500ms timer fires the moment S is truthy (it already is, a blank newState in phase 'setup'), and if the fixture has a game_videos row it calls window.save() and writes the BLANK state over the 520-event game. No user action required. Only up to 3s later does the guard run, and if the count query fails at that instant the latch (item 5) kills it forever. Both copies are then gone. The escape hatch's resume control holds the saved object in a closure but refuses to apply it on a fixture, and the stamp that would make it decidable — epinoia_v1_game, written at bootstrap.js:1047 — is read by nothing anywhere in the repo.

**What.** Three changes, smallest first. (a) bootstrap.js:421 — do not call window.save() from adoptVideo while S.phase === 'setup'; it exists only to persist S.video, which nothing needs before a game starts. (b) index.html:1743 — give save() a shrink guard: at boot read loadSaved() once into a module-level SAVED_HW = saved.events.length, and make save(allowShrink) refuse when (S.events||[]).length < SAVED_HW unless allowShrink is true, updating SAVED_HW after each accepted write; pass true from undo(), deleteEvent(), simulateGame(), launchGame() and the newGame handler — the five places that legitimately shrink. (c) bootstrap.js:705 — replace the blanket isFixture refusal with the comparison the stamp was written for: if localStorage.getItem('epinoia_v1_game') === gameId, resume it; if it names another fixture, keep the refusal and name that fixture. Better still, when the stamp matches and phase is 'setup', surface 'pick up where you left off — 520 actions' as the primary button on the starter-pick screen.

**Risk.** Resuming a log whose ids overlap the server's is harmless — sentIds starts empty on a fresh load so diffLog emits no retraction, and the upsert ignores duplicates. Verify by scoring 20 events, reloading, and confirming the events survive and the resume prompt appears on the starter screen.

`epinoia/score/bootstrap.js`, `epinoia/score/index.html`

### 11. Stop a clock keeper or clock cam masking a dead scorer

**critical** / hours · `transport`

> **STATUS - DONE 2026-09-12 - the bare f.state clause is gone from the traffic test, so only a frame carrying a seq counts as the scorer being alive; clock freshness is tracked separately and exposed as sub.clockAge() alongside sub.logAge(). The end-to-end degradation is asserted at real speed in supabase/tests/clockauthority.test.mjs.**

**Why.** live.js:547 refreshes lastTraffic on any frame carrying f.state, and the comment above it says a phone saying hello must not stop the ladder noticing a dark scorer. But keeper frames (control.js:155, every 5s) and cam reading frames (clockcam.js:551, every ~1.5s) both carry state. So when the statistician's tablet dies at 8:00 of Q3 while the control room keeps the clock, Date.now() - lastTraffic never exceeds STALE_MS, the watchdog never fires, status never degrades to 'delayed', pollTimer is never armed, and no consumer ever reads the durable store again. On air the clock keeps ticking perfectly and the score freezes for the rest of the game with nothing anywhere saying why — the worst failure mode a scorebug has, because it looks healthy. The sibling line at 555 already gets this right.

**What.** Drop the bare f.state clause at live.js:547: `if (f.events || f.seq != null || f.full) lastTraffic = Date.now();`. Safe because every publisher frame carries a seq (flush:335, pushState:378, pushSnapshot:439) and no keeper or cam frame does. Then track clock freshness separately — a `let clockTraffic` bumped inside the keeper/cam branch of adoptState (live.js:530) — and expose sub.clockAge() and sub.logAge() so a layer can say 'clock live, score stale' rather than showing a healthy bug over a dead feed. Assert the seq invariant in a test so a future publisher that sends state without a seq is caught.

**Risk.** Any future publisher sending state with no seq would stop counting as traffic — hence the asserted invariant. Verify by driving a keeper frame loop with no scorer frames and confirming status degrades to 'delayed' within STALE_MS.

`epinoia/live.js`, `epinoia/broadcast/control/control.js`, `epinoia/clockcam/clockcam.js`

### 12. Stop the on-air clock sawtoothing when its source dies

**critical** / hours · `broadcast`

> **STATUS — HALF DONE 2026-09-12 — the SOURCE side is capped (CLOCK_RUN_ON_MS in live.js, so clockMs() freezes instead of running to zero). The LAYER still sawtooths: smoothClock keeps decrementing while running is true, then snaps back when the gap exceeds 10s. Still to do.**

**Why.** Found independently by two lanes and verified. live.js caps run-on at CLOCK_RUN_ON_MS so a dead source freezes rather than inventing the rest of the quarter — deliberate, and better than what Sportzcast ships. But state.running is never cleared by anything, so broadcast.js:143 still passes running:true into smoothClock, which decrements shownMs by dt every 200ms render and slides toward the frozen target at only 0.25×dt. Net 0.75× real time below a frozen value; after ~13.3s the diff > 10000 guard snaps shownMs straight back UP ten seconds. Permanent 13-second sawtooth with a ten-second leap backwards, on air, in exactly the scenario the run-on cap was written to make safe — a keeper's tab closing, a clock-cam battery dying, the ingest stalling. A clock that counts down and then jumps up is unmistakably broken to every viewer; the frozen clock it replaces is not.

**What.** (1) Add to live.js's returned subscriber object `stale() { if (!state) return false; const age = (Date.now()+offset) - new Date(state.updated_at||state.at||0).getTime(); return age > CLOCK_RUN_ON_MS; }` — purely additive, reusing the offset and state the closure already holds. (2) At broadcast.js:143 pass `running && !(sub && sub.stale && sub.stale())` into smoothClock. (3) In smoothClock change the guard at 459 to `if (diff < -1500 || (diff > 10000 && !running)) shownMs = target;` — a clock going UP by ten seconds while running is always a fault, never a correction.

**Risk.** None to the normal path — stale() is false whenever any source is stamping updated_at, which all of them do far faster than 20s. On a genuinely slow-cadence source the shown clock now holds instead of creeping, which is what the hall board does. Verify by stopping a synthetic keeper mid-quarter and watching the rendered clock freeze rather than oscillate.

`epinoia/live.js`, `epinoia/broadcast/broadcast.js`

### 13. Define OFFICIAL_ROLES in the layer and never let one scene take the whole broadcast down

**critical** / hours · `broadcast`

> **STATUS — DONE 2026-09-12 — OFFICIAL_ROLES copied into broadcast.js, the paint wrapped, and an unknown scene now blanks rather than falling back to the scorebug. Tests in supabase/tests/broadcast.test.mjs.**

**Why.** Verified: broadcast.js:930 reads OFFICIAL_ROLES; the identifier is defined only in boxscore.js:270 and score/index.html, and broadcast/index.html loads config, vendor/supabase, engine, rt, live and broadcast — not boxscore. render() does stage.innerHTML = fn(st) with no try/catch. Two live outcomes: a fixed-URL source at ?scene=officials throws inside the first render, the boot catch swallows it, so listenForScenes, watchPregame and the subscriber are NEVER created and the source stays blank for the whole game with nothing in the log; or a director presses the tile mid-game, scene is set, lastJSON updated, then the paint throws — so the DOM keeps the previous graphic and the scorebug freezes on a stale score and clock until something else is taken. The tile is enabled whenever officials are entered, so both paths ship today.

**What.** Copy the eight-row table into broadcast.js above SCENES (it is already duplicated twice, so a third literal is cheaper than widening the layer's download). Wrap the paint: `try { stage.innerHTML = fn(st); } catch (e) { if (debug) diag.textContent = 'scene ' + scene + ': ' + e.message; }`. Change the fallback at 1225 from `SCENES[scene] || SCENES.scorebug` to `|| SCENES.blank` and write 'unknown scene: ' + scene into #diag under ?debug=1 — an unrecognised name must never put a live graphic on air (the help page currently documents a scene called 'squads' when the key is 'squad', which today silently puts a scorebug up instead). Add a smoke check iterating Object.keys(SCENES) against a stub state and asserting a string comes back.

**Risk.** A typo in a scorebug URL now shows nothing instead of a scorebug — correct, and the exporters never typo it. The catch only changes behaviour on a path that is currently fatal.

`epinoia/broadcast/broadcast.js`, `epinoia/boxscore.js`, `epinoia/broadcast/help/index.html`

### 14. Flip the layer to FINAL when a game ends while it is running

**critical** / hours · `broadcast`

> **STATUS — DONE 2026-09-12 — merge() carries g.status through to game.status and clears lastJSON to force the repaint; the edge function makes the same FINAL/FIN substitution so a bound template and a browser source cannot disagree.**

**Why.** Every final-state decision in the layer reads game.status, which is written in exactly two places — boot, and watchPregame's poll that returns immediately if the status is already live and clears its own interval the moment it becomes live. So it never runs during play. merge() receives g.status from the snapshot and assigns it to S.phase, a field nothing reads. At the buzzer the scorebug shows a dim white 0.0 under 'Q4' instead of amber FIN, and the Final Score board — the single most-screenshotted graphic of the night — is headed Q4. The .clk.fin amber styling, written specifically so a still of a rerun cannot be read as a live game, never fires. The edge function has the mirror-image bug, so a vMix template bound to clock_display reads 0:00 while the HTML layer reads FIN.

**What.** In merge() at broadcast.js:1503 change the line to `if (g.status) { if (g.status !== game.status) lastJSON = ''; game.status = g.status; S.phase = g.status === 'final' ? 'final' : 'game'; }` — clearing lastJSON forces the repaint on the same tick rather than waiting for the clock to change. In supabase/functions/broadcast/index.ts:253-254 apply the same game.status === 'final' test to periodLabel and display so the JSON and the layer agree.

**Risk.** A feed reporting 'final' early would show FIN before the buzzer — acceptable, and no worse than the box score, which already trusts the same column. Verify by flipping a test game's status while a layer is open and confirming both the bug and the final board repaint within one tick.

`epinoia/broadcast/broadcast.js`, `supabase/functions/broadcast/index.ts`

### 15. Hold a screen wake lock in the scoring app

**critical** / hours · `scorer`

> **STATUS — NOT the clock cam — the clock cam holds one as of 2026-09-12. This is the SCORING app, which still has none.**

**Why.** Verified: grep for wakeLock across the whole of epinoia/ hits exactly one file, clockcam/clockcam.js:237. The scoring app — the one held for forty minutes of live play — requests nothing. iOS auto-lock defaults to 30 seconds; a scorer's hands leave the screen for every stretch of play with no event in it, which in a semi-pro game is routinely 20-40 seconds. Every sleep costs a wake, a passcode or Face ID, and a re-orient, dozens of times a game. Worse, if the lock outlasts the clock remainder, tick() drives clockMs to 0 and fires onPeriodEnd(), which starts the 15-minute half-time interval and throws up the period-confirm modal for a quarter that has not ended, on a screen the operator is trying to score on. This is the single biggest operator tax in the app and the pattern to copy is already in the codebase.

**What.** Lift keepAwake(on) verbatim from clockcam/clockcam.js:235-242 into bootstrap.js beside trackLegend. Call keepAwake(true) from the existing showScreen wrapper whenever the argument is 'game' and keepAwake(false) on any other screen. The UA releases the lock on every backgrounding and does NOT restore it, so also add a visibilitychange listener re-requesting it when visibilityState === 'visible' and the game screen is up. Guard with `if ('wakeLock' in navigator)` and try/catch as clockcam does; below iOS 16.4 show a one-time setup note to turn the screen timeout off. Surface it as a small '⦿ awake' chip in the existing #topbar beside the undo/redo caps.

**Risk.** Battery drain — the right trade for a courtside device on a charger; add a toggle in the bottom sheet beside 'match details' if Louie wants an escape hatch. Verify the chip appears, survives a background/foreground cycle, and clears on finalise.

`epinoia/score/bootstrap.js`, `epinoia/score/index.html`, `epinoia/clockcam/clockcam.js`

### 16. Fix the free-throw prediction firing one team foul early

**critical** / hours · `scorer`

> **STATUS - DONE 2026-09-12 - the threshold is >= 5, with a comment saying D already counts the foul being recorded and that the header threshold of 4 is a different statement and correct. Both are pinned in supabase/tests/scorer-foul.test.mjs so neither gets "fixed" to match the other.**

**Why.** index.html:3869 computes ftExp with `teamFoulsNow(D,team)>=4`, but the foul was added ten lines earlier and addEvent ends with renderAll(), which reassigns D = derive() — so the count is POST-increment. On a team's FOURTH team foul the test passes, the sub-bar draws a 'ft 1 · ft 2' step bar and the app toasts 'free throw 1 of 2'. FIBA Art. 41 penalises from the FIFTH; the fourth awards none. A scorer following the prompt taps the fouled player twice and puts up to two points on the board that were never scored. The score is the one number everyone in the hall checks, so it becomes a mid-game argument rather than a quiet data error.

**What.** Change `teamFoulsNow(D,team)>=4` to `>=5` at index.html:3869 and add an inline comment saying D already includes this foul — the display threshold at 2370 (fouls>=4 → 'bonus') is CORRECT as-is because it means 'the next foul shoots', so the two now legitimately differ by one and without the comment the next reader will 'fix' it back. Leave the floor-foul chip gate at 3493 alone: raising it would remove the scorer's ability to relabel a mistyped foul out of penalty.

**Risk.** None — one comparison. Verify by walking a team to five fouls in the demo game and asserting the FT prompt appears on the fifth, not the fourth, while the bonus indicator still lights on the fourth.

`epinoia/score/index.html`

### 17. Stop ✕ deleting the foul it was advertised to cancel

**critical** / hours · `scorer`

> **STATUS - DONE 2026-09-12 - the legend now names the green disc as "no free throws - keep the foul" and the cross as "delete the foul", and the delete asks first, naming the player. Tests in supabase/tests/scorer-foul.test.mjs, which runs the shipped cancelStep. Browser-verified in the practice game.**

**Why.** A defensive personal foul not in the bonus is the commonest foul in a game. It opens a kind:'foul' window with one step and no flow, and the legend at index.html:2537-2540 names exactly one exit: '✕ — no free throws'. cancelStep then falls through every guard and reaches removeEventKeep(steps[0]) — the foul itself is erased. The toast reads 'cancelled: foul on #12 smith' and is gone in 2.2s; the player's foul badge silently drops back. By Q4 a player with five fouls is still on the floor and the team-foul count driving the bonus is one light. The window never expires on its own either (the clock is stopped, so tick keeps pushing expires), so the scorer is parked in a window whose only advertised exit destroys their work.

**What.** Two changes. (1) In helpSpec's p.kind==='foul' branch (index.html:2537-2540) replace k('✕','no free throws','x') with k(DONEK(),'no free throws — bank the foul','grn'); k(CANCK(),'delete the foul','x') — the green disc is already on screen because renderX unhides #doneB for any pending. (2) In cancelStep, immediately before `const id = steps[0];` at 2463, add a confirm gate scoped to this kind only: `if(p.kind==='foul' && p.foulIdx!=null && steps.length===1){ askConfirm('delete the foul on '+pname(p.pid)+'?', ...); return; }`. askConfirm already exists and is used for end-game and simulate.

**Risk.** The fall-through at 2463 is CORRECT for a shot at flow step 0 and for a turnover — do not widen the guard past p.kind==='foul' or ✕ stops cancelling a mis-armed shot. Verify all three cancel paths in the demo game.

`epinoia/score/index.html`

### 18. Make save() verify its write and shout when localStorage is full

**critical** / hours · `scorer`

> **STATUS — DONE 2026-09-12 — a throw raises a sticky red banner with an export button, it does not stack, it clears on recovery, the write is read back every 40th save, and stale eplive: keys are swept on boot. Tests in supabase/tests/durability.test.mjs.**

**Why.** save() is one setItem of the whole state blob inside a bare try/catch with no read-back, no flag and no banner, called on every tap. The origin is shared: prophesyscouting.co.uk also hosts index_9.html, which writes its own large keys into the same 5MB, and scratch/train sessions accumulate one uncollected eplive: key each. Whichever fills it, the failure is identical and silent — setItem throws, the catch eats it, the screen keeps drawing a perfect game, and nothing has been persisted since. supabase-js's session storage is on the same quota, so sign-in starts failing in the same minute. The operator finds out when the tab dies. live.js:234-248 already learned this exact lesson for durable writes; localStorage has not.

**What.** (a) In save() (index.html:1743), after setItem compare localStorage.getItem(EP_KEY).length against the serialised string's length; on mismatch or throw set a sticky module flag and render a persistent red banner — 'THIS GAME IS NOT BEING SAVED ON THIS PHONE — export the play-by-play now' — with a button wired to the existing downloadJSON at 6018. (b) Garbage-collect on boot: iterate localStorage keys matching /^eplive:/ and drop any whose id is not the current gameId.

**Risk.** None — additive. This is the stopgap for item 26 (IndexedDB), which is the real fix; land this one first because it is an hour and covers the season. Verify by filling the quota from the console and asserting the banner appears and the export button works.

`epinoia/score/index.html`, `epinoia/score/bootstrap.js`

### 19. Subscribe the publisher's realtime channel and await its send

**high** / days · `transport`

**Why.** send() does `channel = sb.channel('game:'+gameId)` and never calls .subscribe(); the scorer creates a publisher only and never a subscriber, so listen() — the one place that subscribes — never runs. The bundled send() therefore takes the !canPush() branch on every frame: a console warning plus a fresh HTTPS POST to /realtime/v1/api/broadcast, the slowest path, from a phone on hall wifi, several times a second. The returned 'ok'|'error'|'timed out' is discarded because the call is not awaited, so a refused or oversized broadcast is invisible and viewers fall back entirely on the durable poll ladder — which is exactly the path that does not work when the scorer is signed out. Because it is fire-and-forget, the chain's ordering guarantee does not extend to the broadcast, so two POSTs can overlap and a retraction can reach a viewer after its replacement.

**What.** In supabaseTransport create the channel once at construction and subscribe it: `channel = sb.channel('game:'+gameId); let joined=false; channel.subscribe(s => { joined = (s==='SUBSCRIBED'); });` and have listen() reuse that same object rather than reassigning it at live.js:281. In send(), `const ok = await ch.send(...)` and fold `ok !== 'ok'` into the bad array at :252 so a dropped broadcast is retried from the backlog like a refused write. Gate the first sends on SUBSCRIBED by returning false — the backlog exists for exactly this. Separately in pushSnapshot (live.js:436) measure JSON.stringify(frame).length and skip the broadcast above ~180KB, letting consumers heal via the poll ladder rather than posting a body Realtime will refuse without a word.

**Risk.** Awaiting the broadcast adds its latency to the chain, delaying the next frame — keep the durable jobs concurrent with it (they already are) so the added cost is one socket push, not a round trip. Verify by watching the network panel for the disappearance of the /api/broadcast POSTs and confirming frames still arrive at a second tab.

`epinoia/live.js`

### 20. Stop the 10-second snapshot re-upserting the whole event log to Postgres

**high** / days · `transport`

**Why.** sync.js pushes a full snapshot every 10 seconds, and its doc comment explains why: a viewer joining mid-game needs the whole log over the BROADCAST, with no credentials and no database read. But pushSnapshot routes the frame through the same tx.send, and supabaseTransport.send has no idea a snapshot is different — it fires the game_events upsert for it exactly as for a delta. So every ten seconds the entire log is written to Postgres again. At 800 events and ~180 bytes a row that is a ~145KB request body six times a minute on a phone sharing a hall AP with the crowd, achieving nothing, since deltas and the backlog already own durability. It is serialised onto the same chain as the tap-driven frames, so each snapshot delays every tap behind it, and it is the single most likely thing to trigger a stalled publisher. It scales with the length of the game, so it is worst in overtime.

**What.** In supabaseTransport.send (live.js:213) gate the durable upsert on the frame not being a snapshot: `if (frame.events && frame.events.length && !frame.full)`. The broadcast half at :206 is untouched, which is the snapshot's actual purpose. To replace the accidental self-heal it was providing, add a deliberate one: in sync.js's 10s interval, every sixth pass read `select('seq',{count:'exact',head:true})` for the game and, if the server count is below S.events.length, push the missing tail through the normal pushEvents path.

**Risk.** An event whose delta frame was lost AND whose backlog entry died with the tab would no longer be silently re-inserted — covered by the reconcile above and by the finalise gate that already refuses to close a game the server cannot reproduce. Verify by measuring outbound bytes over a scripted 400-event game before and after.

`epinoia/live.js`, `epinoia/score/sync.js`

### 21. Put a hard deadline on every Supabase fetch so one hung request cannot stall the game

**high** / days · `transport`

**Why.** Every frame goes through `chain = chain.then(() => deliver(frame))` and deliver awaits tx.send with no timeout anywhere; config.js sets no custom fetch and no AbortController. A sports-hall access point that accepts the TCP connection and then stops responding — a captive-portal re-auth, a saturated uplink, an AP handover — leaves that fetch open for the browser's own timeout, minutes on Chrome and effectively unbounded on some iOS builds. Nothing after it on the chain runs. And the health signal cannot see it: flush() has already spliced the buffer into the queued frame and nothing has failed yet, so pending() returns ~0 and the badge keeps painting green 'live', while the broadcast half already went out so the public page keeps updating too. The statistician has every signal that the game is being saved and nothing is being written. It surfaces at the final whistle, when the finalise gate refuses.

**What.** (a) In epinoiaClient() (config.js:113) pass a wrapped fetch with a 15s AbortController: `global: { fetch: (u,o) => { const c = new AbortController(); const t = setTimeout(() => c.abort(), 15000); return fetch(u, Object.assign({}, o, {signal:c.signal})).finally(() => clearTimeout(t)); } }`. An aborted send rejects, deliver's catch backlogs the frame, and it retries in order — safe because every durable write is idempotent (event upsert on conflict game_id,seq; state upsert; retraction delete by seq) and it does not touch the realtime websocket. (b) Make the stall visible: change pending() at live.js:457 to also count frames queued on the chain via an inFlight counter incremented in flush/pushState/pushSnapshot and decremented in deliver's finally, so bootstrap.js:1610 can report 'live · not saved (N held)'.

**Risk.** A genuinely slow but working connection could now abort a write that would have completed — the backlog retries it in order, so the cost is a delay, not a loss. Verify with a devtools request-blocking rule that hangs one PostgREST call and asserting the badge goes amber and the chain resumes.

`epinoia/config.js`, `epinoia/live.js`, `epinoia/score/bootstrap.js`

### 22. Restate the on-air scene every four seconds, and default a live layer to blank

**high** / hours · `broadcast`

**Why.** scene defaults to 'scorebug' and only ever changes on an inbound frame. The control room publishes a frame ONLY from take() and clearAir(); Supabase broadcast has no retained message, there is no periodic restatement and no hello-from-the-layer handshake. So any reload of a ?live=1 source puts a scorebug up unbidden — an OBS refresh, a browser-source crash, a laptop waking, a vMix input restart, or the layer being added mid-game. The worst instance: the director pressed 'off air', the source reloads, and a full scorebug goes up over a picture the mixer believes is clean. The exposed paths are every mixer without a control API, which is exactly the path this module recommends for Wirecast, Streamlabs and hardware HTML inputs.

**What.** (1) In control.js add `setInterval(() => { const [sc, sd] = currentKey.split(':'); publish(sc === 'blank' ? 'blank' : sc, sd ? {side: sd} : null); }, 4000)` inside connect() after the subscribe callback, and call the same restatement from the chan.subscribe handler whenever the status is SUBSCRIBED — it already holds currentKey. (2) In broadcast.js:59 make the default conditional: `let scene = (qp.get('scene') || (qp.get('live')==='1' ? 'blank' : 'scorebug')).toLowerCase();`.

**Risk.** A live source now shows nothing for up to 4s after a reload — strictly better than showing the wrong graphic, and nil once the restatement lands. Verify by reloading a live layer while the control room holds 'blank' and confirming nothing appears.

`epinoia/broadcast/control/control.js`, `epinoia/broadcast/broadcast.js`

### 23. Stop the control room lighting a tile green when the take never reached the layer

**high** / hours · `broadcast`

**Why.** publish() returns false when the channel is not joined and take() discards it entirely: it sets currentKey, repoints the preview iframe and toggles the .on class regardless. On the single-source path — Wirecast, Streamlabs, mimoLive, a hardware HTML input, vMix overlay 1, everything the module's own help recommends — a dropped socket means the director presses 'Top scorers', the tile lights, the preview shows the graphic, and nothing at all happens on air. The only contradicting signal is a small grey pill a director is not reading while a play finishes. clearAir() has the same hole, and a failed 'off air' is the most dangerous failed command in the set.

**What.** Change take() to `const sent = publish(scene, opts); const driven = mxTake(currentKey);` and make mxTake return true when it actually issued a command. If neither succeeded, do NOT move the .on class: add a 'failed' class on the pressed tile with a label reading 'not sent — socket down', leave the previous tile .on, and flash #liveTag. Then queue it: keep a pendingKey and fire it from the chan.subscribe SUBSCRIBED handler, showing the tile as .pending meanwhile. Apply identical treatment to clearAir(). Gate the failed state on !sent && !driven so a mixer-driven path with #mxDrive unchecked does not read as a failure.

**Risk.** None to the OBS/vMix-driven path, where mxTake still executes through the mixer API and the green tile is already truthful. Verify by killing the socket in devtools, pressing a tile, and confirming it shows failed rather than on-air, then recovers when the socket returns.

`epinoia/broadcast/control/control.js`

### 24. Scope the control room's Space bar so it cannot seize the game clock by accident

**high** / hours · `clock`

**Why.** control.js:287 is a document-level keydown handler excluding only input, textarea and select. <button> is not excluded, so after clicking any tile's take button (which takes focus) a Space press fires it — and Space is also the standard page-scroll key on a long page. kpSet sets kp.active and publishes with assert:true, which live.js adoptState treats as a DELIBERATE act that takes the clock away from a clock cam immediately with no handover delay. The room then re-publishes every 5s, holding authority permanently. One stray keypress starts or stops a clock on every layer on the stream that the hall's board is not running, locks out the camera reading the real board, and the only way back is a release button the director does not know they need. control.js:143-145 compounds it by painting 'clock: you are keeping it' purely from kp.active, never from feedSub.clockSource().

**What.** (1) Scope the handler: return early unless `document.getElementById('keeper').contains(document.activeElement) || kp.active`, and add button to the target exclusion list. Better still, require the keeper card to be explicitly armed by clicking #kpToggle before Space binds at all, with a persistent amber banner and a release control while kp.active is true. (2) Separately, derive the keeper tag at control.js:143-145 from feedSub.clockSource() and show 'clock: the camera took it back' when kp.active but the source is 'cam'.

**Risk.** A keeper who relied on Space working from anywhere now has to click the card once per game — the right trade. Verify by focusing a take button and pressing Space, asserting no clock frame is published.

`epinoia/broadcast/control/control.js`, `epinoia/live.js`

### 25. Make an asserted clock act sticky so a misreading camera cannot take it back in three seconds

**high** / hours · `clock`

> **STATUS — PARTLY — assert exists as of 2026-09-12 (a deliberate keeper tap wins at once). Making it STICKY afterwards is still to do.**

**Why.** adoptState measures `contested` from authority.at, which is refreshed on EVERY adopted frame from the incumbent — so it means 'the incumbent spoke within the last 3s', not 'the incumbent recently made a deliberate act'. With a camera on the board at ~1.5s cadence and a keeper restating every 5s, the sequence is: keeper taps start with assert:true and takes authority; 3s later the camera's next frame is no longer contested and takes the clock; from then the keeper's restatements are always contested by the camera's faster frames and are always refused, because only an explicit set sends assert. The human wins for exactly three seconds and then the misreading camera wins permanently — the opposite of the stated intent, which the code comment names as the one case where the human must win.

**What.** In adoptState (live.js:514) record `authority = {source, until, at, assertedAt: next.assert ? now : (authority && authority.source===src ? authority.assertedAt : 0)}`, and compute `const contested = authority && authority.source !== src && (now - (authority.at||0) < HANDOVER_MS || now - (authority.assertedAt||0) < ASSERT_HOLD_MS)` with a new ASSERT_HOLD_MS = 15000. A non-asserting rival cannot take the clock for 15s after a deliberate act; another assert still wins instantly because the `&& !next.assert` guard at :520 is unchanged.

**Risk.** A keeper who taps once and walks away now blocks the camera for 15s instead of 3 — acceptable, and well under AUTHORITY_MS. Verify with a scripted keeper-assert followed by a stream of cam frames, asserting clockSource() stays 'keeper' for 15s.

`epinoia/live.js`, `epinoia/broadcast/control/control.js`

### 26. Move the scorer's event log to IndexedDB with a durable outbox

**critical** / days · `scorer`

**Why.** Two lanes found this independently. The live game is in EP_KEY='epinoia_v1', written by save() as JSON.stringify of the ENTIRE state, synchronously, on every tap — a ~100KB serialise-and-write inside the gesture handler by Q4. localStorage is ~5MB for the whole origin, shared with every other Epinoia page, and is the first storage iOS evicts. There is no IndexedDB anywhere in the scorer. Separately, live.js's ordered retry backlog is correct but not durable: it is a plain in-memory array, so a reload or an OS eviction drops it and recovery depends on the 10s snapshot firing while the tab is still alive. A scorer that loses a game is worse than any missing feature, and this is the structural version of that risk.

**What.** Add an IndexedDB database 'epinoia-scorer' v1 with two stores. (1) 'events', keyPath ['game_id','seq'], one record per append with deliberately the same column set bootstrap.js:487 already selects from game_events, so loadRecorded() and a local replay share one mapper; append-only, so an undo writes {t:'__void', ref:seq} rather than deleting, which diffLog already tolerates. (2) 'outbox', keyPath 'n' autoIncrement, holding exactly what live.js pushes onto backlog: change backlog.push(frame) at live.js:366-370 to a put() and backlog.shift() at 363/446 to a delete(), and drain the store on boot before the first new frame. Then shrink save() to metadata only — {phase, period, clockMs, running, teams, starters, evSeq, video} — a few KB, so the synchronous write stays cheap for the life of the game, and rehydrate S.events on boot with a cursor over the game_id prefix. One ~200-line module, no dependency.

**Risk.** This touches the load path, which is the most dangerous thing in the app. Ship it dual-writing for one weekend and assert counts match before removing the localStorage path. Land items 10 and 18 first so the season is covered while this is proved.

`epinoia/score/index.html`, `epinoia/score/sync.js`, `epinoia/live.js`, `epinoia/score/bootstrap.js`

### 27. Replace the event-count takeover guard with a writer lease

**critical** / days · `scorer`

**Why.** The existing guard is good and its two defects are structural, not cosmetic. It is one-directional and count-based, firing only when serverCount > mine, so two devices running neck-and-neck never trip it — and the device that LOSES a takeover is never told, so it keeps writing. Because the durable write is an upsert on (game_id,seq) with ignoreDuplicates, the two logs interleave into one corrupt log, which is the worst possible outcome. FIBA's rule is explicit that two users are never allowed on the same game at once; making that true rather than aspirational needs a lease, not a counter.

**What.** Add table game_writer(game_id uuid primary key, writer_id uuid, device_label text, lease_until timestamptz, last_seq int, updated_at timestamptz) with RLS mirroring game_events. writer_id is minted per TAB in sessionStorage, because a second tab IS a second writer. One RPC claim_writer(p_game, p_writer, p_label, p_force) upserting only when lease_until < now() OR writer_id = p_writer OR p_force, returning the winning row. Heartbeat every 10s with lease_until = now() + 30s, piggybacked on the existing 2s safety-net timer in sync.js so it costs no new interval. The missing half: on every heartbeat, if the returned writer_id is not mine, call EpinoiaSync.halt() and show a non-dismissable banner 'Scoring moved to <device_label> — you are read-only'. Rewrite guardAgainstOverwrite to read game_writer instead of counting: a live lease renders 'Lea is scoring on iPhone — last action 4s ago' with a 'Take over' behind a typed confirmation; a stale lease (>30s) offers takeover with no confirmation, because a dead lease is exactly a crashed phone. Keep loadRecorded() and the reload as they are.

**Risk.** Additive migration only — no existing column changes. A network partition could make a live writer look stale to itself; the 30s lease against a 10s heartbeat gives three misses of headroom. Verify with two browser profiles on one fixture, asserting exactly one publishes and the other goes read-only within 10s.

`epinoia/score/bootstrap.js`, `epinoia/score/sync.js`, `supabase/migrations`

### 28. Add an integrity linter to engine.js, with the two checks that guard the analytics

**critical** / days · `scorer`

**Why.** There is nothing comparable today. The starters picker enforces five, but nothing re-checks it once the game is running: D.onCourt is derived purely by replaying sub events, so a missed substitution silently leaves four or six on court for the rest of the quarter. Epinoia is the platform where that hurts most — every stint, lineup, on/off and RAPM number is built from exactly that array, and today nobody finds out until the season table looks wrong. FIBA LiveStats flags eight classes, renders them in the action list, gives a Review button naming the reason, prompts after every quarter and clears flags automatically when the cause is fixed. Because engine.js is shared with finalise-game, a linter written once runs on both sides with no duplication — which no rival can match.

**What.** Add EpinoiaEngine.lint(game) → [{seq, code, severity, message, fixes:[{label, apply}]}] beside deriveGame and fullGame. Ten codes: FIBA's eight as POSSESSION_INCONSISTENT, PLAYER_NOT_ON_COURT, AHEAD_OF_CLOCK, ZERO_CLOCK, EJECTED_PLAYER, FT_NOT_LINKED, MISSING_SUB, USER_FLAG; plus COURT_COUNT (D.onCourt[t].length !== 5 at any point after period_start — report the INTERVAL, not the instant, so one missed sub is one finding not four hundred) and STINT_UNBALANCED (sum of player seconds for a team across a period != 5 × period length, tolerance 1s). That last is the direct guard on the RAPM/on-off pipeline and no rival has it, because no rival computes those numbers. Tag each with severity 'score' / 'attribution' / 'derived'. Run it inside the existing addEvent wrapper in sync.js; if a few hundred rows ever measures, lint only the window since the last period_start. UI: an amber dot on the offending row in the existing .loglist, a count chip in #topbar, and tapping the dot opens the existing event modal with the reason at the top.

**Risk.** A noisy linter gets ignored, so COURT_COUNT reporting intervals rather than instants is load-bearing, not a nicety. Verify against a recorded game with a deliberately dropped sub and assert exactly one COURT_COUNT finding spanning the right interval.

`epinoia/engine.js`, `epinoia/score/sync.js`, `epinoia/score/index.html`, `supabase/functions/finalise-game/index.ts`

### 29. Wire the eligibility gate at the scorer's table — player_ban() and membership_status() have zero callers

**critical** / days · `league-ops`

**Why.** Verified by grep across the whole repo: player_ban and membership_status are called from no client code at all. Migration 0045's own comment asserts 'the scorer calls it before a starting five is confirmed, and the club portal shows it on the roster' and grants both to anon precisely so the public box score and club page can show an unavailable player. Neither does. rosterOfTeam in the scorer just pulls roster_entries where active is true. A suspended or unregistered player is put on a team sheet, the game is played, and the league voids a result it had every piece of data to prevent. This is the single highest-differentiation item on the list: Epinoia is the only platform here that owns the federation adapter AND the scoring app, so it can do this better than PlayHQ can.

**What.** Add one RPC, roster_eligibility(p_game uuid) returns table(player_id, name, status, severity, reason): for each player in both rosters return 'red' if player_ban(player_id, competition_id) has an ACTIVE row or the synced federation status is 'suspended'/'lapsed'; 'amber' if status is 'unknown'/'unregistered' or last_synced_at is older than 30 days; 'green' otherwise, with reason carrying human text ('serving 2 of 3 games', 'BE membership expired 2026-07-01'). Call it in three places: the scorer's roster load in bootstrap.js (cache the result into the offline queue at game open so it survives dead hall wifi; colour each player chip; refuse a red player into the starting five unless a league admin types an override reason); the roster editor in epinoia/admin; and finalise-game, which should flag 'ineligible player fielded' rather than silently finalising. Store overrides in game_eligibility_overrides(game_id, player_id, reason not null, overridden_by, overridden_at) so a protest six weeks later is settled by a row, not a memory. Never hard-block — a scorer who cannot start a game at 19:25 abandons the app.

**Risk.** player_ban returns one row per suspension with an `active` column and NOT a filtered set — every caller must filter on active or every lifted or expired suspension flags. membership_status deliberately answers 'unknown' rather than 'no' when nothing is recorded, so the scorer must treat an empty result as silence, never a refusal, or every league without a federation blocks every player.

`epinoia/score/bootstrap.js`, `epinoia/membership.js`, `supabase/functions/finalise-game/index.ts`, `supabase/migrations`

### 30. Plumb a shot clock through the transport, the scorer and the scorebug

**critical** / days · `clock`

> **STATUS — Flagged independently by three research lanes as the highest-value missing field.**

**Why.** Verified by grep: shot_clock and shotClock appear nowhere in live.js, engine.js or the entire broadcast module. The only matches in the platform are a turnover-violation subtype in a dropdown and an official's role string. STATE_CORE has no shot-clock member. This is a basketball scorebug with no shot clock, which every federation-grade product from FIBA upward shows, which LiveStats carries as a first-class status field, and which Daktronics and OES feed to XPression. It is the most conspicuous single absence in the on-air product.

**What.** Scope this item to everything except the camera reader, so it can be finished and proved without a hall. (1) Migration: add shot_clock_ms int, shot_clock_running bool default false to game_state; add shot_clock_len int default 24 and shot_clock_reset int default 14 to the competition settings row. (2) live.js: append shot_clock_ms and shot_clock_running to STATE_CORE at :158 and add shotClockMs() alongside clockMs() — same server-offset arithmetic, same run-on guard, and it MUST stop at 0 rather than going negative. (3) Scorer UI: three controls only — reset-24, reset-14, stop/start — bound to the existing period/clock control group, with auto-reset-24 on a change-of-possession event and auto-reset-14 on an offensive rebound, both overridable, because a statistician cannot hand-tap a shot clock and call the game. (4) broadcast edge function: emit clock.shotMs and clock.shot (whole seconds above 5.0, one decimal at or below, matching the existing mmss convention) so flatten() yields clock_shotMs and clock_shot for free. (5) Scorebug: render only when running or below the configured length, in the corner opposite the period, flashing red below 5.0s.

**Risk.** Additive columns only, and the existing isUnknownColumn retry at live.js:169 means the migration can lag the deploy without costing the score. The auto-reset heuristics will sometimes be wrong; making them overridable from the same three controls is what keeps that cheap. Verify against a scripted possession sequence.

`epinoia/live.js`, `epinoia/score/index.html`, `epinoia/broadcast/broadcast.js`, `supabase/functions/broadcast/index.ts`, `supabase/migrations`

### 31. Make the bonus threshold a per-league rule instead of a literal 5

**high** / days · `broadcast`

**Why.** broadcast/broadcast.js:156 computes `bonus: fouls >= 5` as a hard literal, so a league with a different bonus rule silently renders a wrong scorebug — and double-bonus does not exist at all. LiveStats supplies exactly this as configuration (setup.foulsBeforeBonus, timeouts.timeoutsStyle, per-period and per-half timeout counts), and Sportzcast's contract carries HomeBonus alongside HomeDoubleBonus because a graphics operator keys on them. A wrong bonus indicator on a stream is the kind of error a league's own officials notice immediately.

**What.** Add a per-league rules object read once per game — {fouls_before_bonus: 5, fouls_before_double_bonus: null, timeouts_style: 'HALF'|'PERIOD'|'UNLIMITED', timeouts_period: [n,n,n,n], timeouts_half: [n,n], timeouts_ot: n, period_length_ms, ot_length_ms} defaulting to FIBA. Kill the literal at broadcast.js:156: compute bonus as team_fouls >= rules.fouls_before_bonus and double_bonus as (rules.fouls_before_double_bonus != null && team_fouls >= it). Derive team_fouls from the engine's foul actions per period so it costs nothing extra on games Epinoia already scores. Extend STATE_CORE with team_fouls_home/team_fouls_away, timeouts_full/partial per side, and a one-frame horn bool, mirroring the game_state columns and reusing the existing isUnknownColumn retry so the migration can lag the deploy.

**Risk.** Deriving team fouls from the event log must keep the existing bench/coach-technical exclusion the engine already gets right (bench techs are excluded, player techs included). Verify against a game with a coach technical and assert the team-foul count is unchanged by it.

`epinoia/broadcast/broadcast.js`, `epinoia/live.js`, `epinoia/engine.js`, `supabase/migrations`

### 32. Add period-end score confirmation, recorded as an event and enforced at finalise

**high** / days · `scorer`

**Why.** There is no end-of-period step at all — grep for endPeriod returns nothing. Periods simply advance and period_start is just another event. Nobody is ever asked whether the score on the phone matches the score on the wall, which is the single cheapest check that catches a missed basket before it becomes a season-table error. FIBA prompts mid-screen to confirm the quarter score against BOTH the scoresheet and the scoreboard, makes the confirmation irreversible, and keeps a Confirm Quarter button live beside the clock until it is done.

**What.** Add an event type 'period_end' with payload {confirmed_home, confirmed_away, confirmed_at, flags_open:[seq]}, appended through the same addEvent funnel so it syncs, undoes, replays and finalises like everything else — no new plumbing. When the clock reaches 0:00 or on a manual 'end period', show a sheet stating the derived score large, asking 'does the scoreboard say 62–58?', listing any lint findings of severity 'score' with their one-tap fixes, and offering three buttons: confirm, 'edit the log' (opens .loglist filtered to this period), and 'confirm later' — FIBA's postpone, which leaves a persistent amber 'confirm Q2' chip in #topbar. Never block; a live game must always remain scoreable. Then close the loop server-side: in finalise-game, refuse to close a game with any unresolved severity:'score' flag or any unconfirmed period, naming the period. Five lines there, because the engine is already shared — and the server is the only place a volunteer cannot click past it.

**Risk.** Depends on item 28's linter for the 'score' severity list; ship the confirmation sheet first with an empty findings list if the linter lands later. A server-side refusal at the whistle is unpleasant if it is wrong, so make the message name the period and offer the exact fix.

`epinoia/score/index.html`, `epinoia/engine.js`, `supabase/functions/finalise-game/index.ts`

### 33. Add an animation layer to the broadcast graphics

**high** / days · `broadcast`

**Why.** Verified by grep: zero @keyframes across the entire 616-line stylesheet, and the only motion in the module is three opacity transitions. Once the layer has settled, render() replaces stage.innerHTML outright, so taking scene B over scene A is an instantaneous DOM swap with no cross-fade and no exit, and taking blank makes the graphic vanish in one frame. A graphic that pops in and vanishes is the most reliable single tell of an amateur stream, and it is the one thing a viewer notices about a lower third regardless of what it says. Both the broadcast and streaming-stack lanes raised this independently; CasparCG's CG STOP exists specifically to let a template animate out, and vMix GT titles animate a bound field on data change with no operator action.

**What.** (1) Add an animation layer keyed off .anim-in and .anim-out classes on #stage plus a per-element --d custom property for stagger, animating ONLY transform and opacity — CEF composites those on the GPU, whereas width/left/box-shadow force layout and are what makes browser sources judder. Durations: scorebug in 400ms, lower third 520ms with 60ms per-row stagger, full-frame 700ms; every out at 60% of its in. (2) Make the take two-phase: on a new scene, add .anim-out, resolve on a transitionend-plus-timeout race against the declared OUT duration, then swap and add .anim-in. Track the previous scene in a module-level `painted` so a pure data update (a score change) does not re-animate, and keep the scorebug exempt from re-entry. (3) Publish window.EpinoiaBroadcast.durations = {in:{}, out:{}} so mixers.js can keep an OBS source enabled through its out-animation instead of disabling it mid-fade — that single change is the difference between a fade and a pop. (4) Honour ?anim=0 for directors who cut hard on purpose, and deliberately IGNORE prefers-reduced-motion with a comment saying why: this is video, not a web page, and the viewer's OS setting is not the director's.

**Risk.** A two-phase take briefly shows nothing during the cut; 180-400ms is under the threshold where that reads as a fault and is what a real mixer's dissolve does. Set the OBS browser source FPS equal to OBS's output FPS in mixers.js layout() or the animation is sampled unevenly. Verify by capturing the layer at 60fps and stepping the frames.

`epinoia/broadcast/index.html`, `epinoia/broadcast/broadcast.js`, `epinoia/broadcast/control/mixers.js`

### 34. Show staleness, half-time and timeouts on the scorebug

**high** / days · `broadcast`

**Why.** Three defects in one graphic, all cheap, all visible to every viewer. (a) The layer shows no staleness at all — the edge function already publishes clock.stale and the help page documents it to integrators, but .clk.run is driven by st.clock.running, which stays true forever once the source dies, so the bug paints a confident bright-white running clock over a frozen score. (b) At the end of a period clockMs is 0 and running is false, and the only special state buildState knows is 'final' — so the bug reads '0.0 Q2' for the ten to fifteen minutes of half-time, which is exactly what a BROKEN scorebug looks like. (c) buildState computes timeoutsLeft per team via the engine and lastPlay, and grep shows neither is read by any scene — the work is done and thrown away, the help page already tells producers it is on screen, and the flat XML exposes home_timeoutsLeft to vMix template authors while the HTML layer's own users get nothing.

**What.** (a) Build on the sub.stale() accessor from item 12: add stale to the clock block in buildState, drop the run class and add a stale class in SCENES.scorebug, add `.bug .clk.stale{color:rgba(255,255,255,.55)}` and a small Silkscreen 'NO CLOCK' mark under the period label. Never blank the bug — a missing scorebug is worse than a dim one. Gate it on stale() being true for two consecutive 200ms renders so a hiccup does not flash. Mirror it in the control room's paintLive(). (b) In buildState derive a `between` state (clockMs 0, not running, not final, events exist) and render 'HALF TIME' or 'END Q3' across the clock slot in the .per treatment rather than the figures; add a `break` scene reusing the fixture card layout with the score and the period-by-period line. (c) In SCENES.scorebug's rail block, render timeoutsLeft per side beside the foul dots reusing the dots(n) helper with a `.to` class, rendering nothing when timeoutsLeft is null.

**Risk.** The rail already carries two foul groups; measure at 1× before committing and consider moving the bonus flag inline to make room. An OT period sitting at 0:00 before tip would read 'END OT1' — gate `between` on the period having advanced past 1. Keep the last-play strip behind ?lastplay=1: a two-line scorebug is a different design decision.

`epinoia/broadcast/broadcast.js`, `epinoia/broadcast/index.html`, `epinoia/broadcast/control/control.js`

### 35. Scorebug correctness pass: long club names, unescaped colours, blank takes

**high** / hours · `broadcast`

**Why.** Three small on-air defects in one file. (a) shortOf falls through to the full name when short_name is empty — the three-letter derivation is the fallback for a MISSING TEAM ROW, not a missing column — and .bug .tag has no max-width and no ellipsis, so 'Bristol Academy Flyers' widens the scorebug plate until it runs off the frame, for two hours. In an academy league an unfilled optional column is the normal case. (b) The layer's esc() escapes only &, < and >, and club colours are concatenated into style attributes in nineteen places; boxscore.js:84-115 documents having fixed exactly this and added safeColour with an allow-list, and the broadcast layer uses neither. CSP blocks script but not injected markup or CSS, and the everyday case is duller: a stray quote breaks the div and the graphic renders wrong on air. (c) reveal() waits on rosters, photos and cut-outs before the source is allowed to appear, while mixers.js writes shutdown:true on every source so each take cold-boots — so a stoppage graphic on air for four seconds is blank for up to 2.5 of them, and the scorebug, which needs none of those assets, waits on all three.

**What.** (a) Rewrite shortOf to derive: use src.short_name when present, else split the name — three-plus words give initials (BAF), one or two give the first three letters — upper-cased and sliced to 4. Add max-width:9vmin, overflow:hidden, text-overflow:ellipsis, white-space:nowrap to .bug .tag. Mirror the derivation in supabase/functions/broadcast/index.ts:230 so a template and the layer agree. (b) Add .replace(/"/g,'&quot;') to esc() at broadcast.js:126 and copy safeColour plus the COLOUR_OK regex from boxscore.js; route colourOf through it so the ?home=/?away= URL overrides are validated too. (c) Split the reveal gate: reveal immediately once the fixture row and events land for the in-play scenes (scorebug, lower, scorers, plusminus, rebounds, assists, index, lineups, compare, final) and keep the current race only for the portrait-bearing pre-game scenes; drop REVEAL_MAX_MS to 1200.

**Risk.** A league storing the full name in short_name still overflows — the CSS clamp covers it. A colour format COLOUR_OK rejects (a named colour like 'navy') falls back to the platform green; check the column's actual contents before landing. In-play scenes now appear before crests load, showing a monogram for a beat — which is what wireFades was built for.

`epinoia/broadcast/broadcast.js`, `epinoia/broadcast/index.html`, `supabase/functions/broadcast/index.ts`

### 36. Add CSV and row-per-player tables to the broadcast feed, and fix the on-court column names

**high** / days · `integration`

**Why.** Merged from three lanes, with the first pass's error corrected: ?format=flat and ?format=flatxml already exist and already bind by name in vMix. What is genuinely missing is narrower and cheap. flatten() collapses arrays into home_onCourt_p1_pts, deliberately, so there is nothing for vMix's Auto Next / DataSourceNextRow to walk and no league can build its own data-driven stat card. There is no CSV output, which is what most amateur producers actually use. And both docs tell the producer to bind home_p1_name through away_p5_pts — columns that are never emitted. Worse, flatten returns no key at all for an empty array, so before the first event the row contains ZERO player columns; vMix binds a title to the columns present in the first successful fetch, so a producer who loads the data source before tip-off has nothing to bind, and the columns then appear mid-game, which is exactly how a bound title breaks on air.

**What.** (1) In reply(), before flatten(body), pad each side's onCourt to exactly five entries with a blank card, and in flatten emit out[prefix] = '' when an array or object is empty so a key never disappears. Do the padding in reply() ONLY, not in teamOf — broadcast.js picks a player-of-the-game from onCourt by sorting on pts and a blank card would win that sort at 0-0. (2) Add a `table` parameter alongside `format`, keeping single-row as the default: &table=players (one row per player with Number, Name, Team, TeamShort, PTS…MIN, PlusMinus, Index, OnCourt, Photo as an ABSOLUTE https URL), &table=leaders&stat=pts|reb|ast|index|pm pre-sorted and capped at 10, &table=lineups, &table=scoring, &table=officials. (3) Add &format=csv on every table and on the scoreboard row: column names on line 1, '.' as decimal separator regardless of locale, every field quoted with internal quotes doubled, CRLF, Content-Type text/csv. (4) Document the XPath as /data/row. (5) Correct broadcast/help/index.html:144 and docs/integration-broadcast.md to the real column names. (6) Write the one-page guide the whole thing exists for: 'Bind your own vMix title to Epinoia'.

**Risk.** The nested json/xml document and the browser layer must stay byte-identical — keep the pad on the server's flat path only. Verify by diffing a ?format=json response before and after, and by loading the flat row in vMix before tip-off and confirming all forty player columns are bindable.

`supabase/functions/broadcast/index.ts`, `epinoia/broadcast/help/index.html`

### 37. Add broadcast-delay compensation so the scorebug is not ahead of the picture it is burned into

**high** / hours · `broadcast`

**Why.** clockMs() computes `since = (Date.now() + offset) - updated_at` and subtracts it from the base — correct for real time, wrong for a stream. A YouTube or Twitch stream is 8-30 seconds behind the hall, so an OBS browser-source scorebug driven by Epinoia shows a clock 8-30 seconds ahead of the play beside it. Nothing in the payload, the control room or the layer URLs can express this. Sportzcast carries an explicit five-digit millisecond Delay field in its connection string for precisely this reason. It is the single most visible production defect a viewer can spot, and it is one field.

**What.** (1) ALTER TABLE game_state ADD COLUMN broadcast_delay_ms int DEFAULT 0 and add it to STATE_CORE. (2) In control.js add a delay control to the mixer panel — a number input in seconds plus a 'tap when you see the horn on the stream' calibration button that sets delay_ms to the gap between the horn event's timestamp and the tap. (3) In live.js clockMs() (and shotClockMs() from item 30) change the since computation to `(Date.now() + offset - delayMs) - updated_at` where delayMs = state.broadcast_delay_ms || 0, and allow a per-layer override via ?delay=8000 for the case where an in-arena videowall runs at 0 and a YouTube feed at 20s. Clamp to 0..60000. Leave the control room's own display at delay 0 — the operator is watching the hall, not the stream.

**Risk.** Additive column with the existing isUnknownColumn retry, so the migration can lag. A delay applied to the control room's own readout would make the keeper fight the clock — keep that path at 0 explicitly and comment why. Verify with a synthetic delay of 10s and a stopwatch against the un-delayed reading.

`epinoia/live.js`, `epinoia/broadcast/control/control.js`, `supabase/migrations`

### 38. Re-arm the clockcam wake lock and watchdog a frozen camera

**high** / hours · `clock`

> **STATUS — The clock cam holds a wake lock as of 2026-09-12; RE-ARMING it after the browser drops it, and watchdogging a frozen camera, are still to do.**

**Why.** Two independent silent-death modes on the phone driving the clock. (a) keepAwake() is called from only two places — the send button and visibilitychange when the page comes BACK — and the release listener nulls `wake` and does nothing else. Chrome releases a screen wake lock on its own when the battery gets low or battery saver engages, which on a phone driving a camera at 15fps for ninety minutes is near certain by the third quarter. Once released the screen sleeps, the camera stops delivering, and the page is now hidden — so visibilitychange will not fire again until somebody walks over and touches the phone. (b) camLive() checks readyState, muted and videoWidth but not whether new pixels are arriving. On a stalled camera HAL the track stays live with the last frame frozen, so the reader decodes the same value four times a second, clock.js sets running=false after 1.6s, and publish() re-states it every 1500ms with a fresh updated_at so live.js never times the source out. The graphics show a stopped clock as if the whistle had gone, and the control room's health line says 'cam: live' with a board thumbnail that even looks right.

**What.** (a) Re-arm on the existing 5-second hello timer: in hello() add `if (sending && !wake) keepAwake(true);` — a wakeLock request from a timer is allowed while the document is visible, and the visibilitychange handler covers the return. Surface the existing `awake` health field in control.js's phoneHealthLine so a lost lock is announced rather than inferred, and add a 'plug the phone in' line to the setup hint. (b) In tick() keep `let lastVT = -1, lastVTAt = 0` and each tick read video.currentTime; if it has not advanced for more than 1000ms set camFail = 'the picture has frozen', clear the ring, skip the read and publish, call startCamera() to rebuild the stream, and repaint the status. Belt and braces for a browser that fakes currentTime: compare the newest crop's byte array to the previous one with a strided sample (every 37th byte) — a real sensor always has noise, so an exact match over a few hundred samples proves a freeze.

**Risk.** currentTime can legitimately hold for a frame or two on a 15fps stream, so 1000ms (fifteen frames) is right — do not tighten it to 250ms. Verify by stopping the track from the console and asserting the status flips and a restart is attempted.

`epinoia/clockcam/clockcam.js`, `epinoia/broadcast/control/control.js`

### 39. Move every clockcam box together after a knock, and suspend the followers while re-acquiring

**high** / hours · `clock`

**Why.** tryHunt assigns boxes.clock and leaves home, away and period where they were — but the phone has physically moved, so all three now point at whatever the knock put under them. readPeriod believes any value 1-6 after three agreeing frames, and a stable wrong digit agrees forever: it sets period, calls resetLock() — throwing away a lock just recovered — and publishes with force. Downstream that period is authoritative: broadcast.js takes state.period over the scorer's own and indexes team fouls by it, so a misread period box puts the wrong quarter AND the wrong bonus state on air at once. The score boxes have the same shape of problem (a 30%-clipped '104' reads as 4 on ten renders out of ten) — inert today only because broadcast derives the score from the event log.

**What.** (a) In tryHunt, when an offset succeeds, apply the SAME {dx,dy} to every box that is set, not only the clock — the phone moved as one object, so a single rigid translation is the correct model and it is two lines. (b) Suspend readPeriod and readScores while hunt is non-null or boxPending is true, and reset perSeen and scoreSeen inside resetLock(), so nothing is believed from a box that has not re-proved itself. (c) Raise readPeriod's agreement from 3 to 6 frames (1.5s) and require the new period to be within one of the current one, since a board never skips a quarter. (d) Give the score the same first-acquisition care the clock has: require 4 agreeing frames when the current value is null, not 2. (e) Also add to resetLock(): clockMs = null, running = false, lastSentMs = null — today it clears the lock but keeps publishing the previous period's clock, still running, so a mid-quarter period correction shows the wrong quarter's remaining time counting down until the lock returns.

**Risk.** The rigid translation is wrong if the board itself was re-framed rather than the phone knocked — keep boxPending gating the localStorage write and extend it to cover the follower boxes. A layer rendering state.clock_ms without a null guard would show blank during re-acquisition; check broadcast.js:143 (it falls back) and the strip's clockNow (it null-guards) first. Verify against the existing rendered bench with a synthetic offset applied to all boxes.

`epinoia/clockcam/clockcam.js`, `epinoia/live.js`, `epinoia/broadcast/broadcast.js`

### 40. Fix the clockcam tenths fallback that averages three different numbers

**high** / hours · `clock`

> **STATUS — Raised against the fallback added 2026-09-12. That change was measured as a clear win (36 -> 188 publishes, 1 -> 0 wrong, worst error 3,975ms -> 925ms on a flickering sub-minute board). Re-read the finding before acting; it may be arguing for a shorter capture window rather than against the fallback.**

**Why.** Measured, not guessed. Below a minute the app reads the newest frame alone because averaging a tenths board blurs three different numbers — but when that frame will not read, the code falls back to exactly the stack it just rejected. Simulating the real loop over the last 40 seconds of a quarter at PWM flicker 0.30: the fallback answers 76% of failed reads and is WRONG 30% of those, by up to -700ms. Current code gives mean published error 191ms, worst -750ms and sixteen backward clock steps per minute, versus 46ms and zero steps with the fallback off. Each step is absorbed by smoothClock at a quarter-second per second, so the last minute of every quarter runs visibly slow and uneven. Crucially, simply deleting the fallback is harmful: on a board showing whole seconds all the way down — common in club halls — the read rate falls from 96% to 13%.

**What.** Decide 'tenths board' from the readings rather than from the prediction, and shorten the stack when it is one. Add `let tenthsBoard = null, tenthHits = 0, wholeHits = 0;` and after each successful sub-minute read: `if (ms % 1000) tenthHits++; else wholeHits++; if (tenthHits >= 2) tenthsBoard = true; else if (wholeHits >= 6 && !tenthHits) tenthsBoard = false;`, clearing all three in resetLock(). Then replace the read at clockcam.js:457-469 with: `const isTenths = predNow != null && predNow < 60000 && tenthsBoard === true; const b = binarise(isTenths ? ring[ring.length-1] : stack(ring), inv, adj); let ms = readClock(b, predNow); if (ms == null && ring.length > 1) ms = readClock(binarise(stack(isTenths ? ring.slice(-2) : ring), inv, adj), predNow);` — a two-frame stack spans 125ms and so straddles at most two adjacent tenths, which measured safe at 84/84 where a three-value blend fails.

**Risk.** None to the whole-seconds path (unchanged at 96%); the tenths read rate drops 72%→66%, which the 8s forget window absorbs. Add a bench case that renders a CHANGING face across the stack — the current bench renders the same text for all three frames, which is why this never showed up. Measured result: 191ms→79ms mean error, 16→3 backward steps at PWM 0.30.

`epinoia/clockcam/clockcam.js`, `epinoia/clockcam/decode.js`

### 41. Give the clockcam lock a geometric signature so a slipped box cannot adopt a ten-minutes-short clock

**high** / days · `clock`

**Why.** Measured: clip a rendered 10:03 crop from the left and at 25% — one digit width — it reads 3000ms on twelve renders out of twelve, because readClock accepts any 1-4 digit group and the surviving '0:03' is a legal face with a legal colon in a legal position. Fed to clock.js after a clean lock, it is refused three times and then ADOPTED at 1000ms with running=false. smoothClock snaps any difference below -1500ms at once, so the stream drops to 0:03 in one frame and stays there. Nothing recovers it: tryHunt only fires after 6s with NO reading and this box is reading happily four times a second, and the health line shows 0% refused because the stats only count frames that decoded. This is the single worst on-air outcome the camera path can produce.

**What.** (a) In decode.js add readClockSig(b, hintMs) returning {ms, digits, sepAt, sepKind, xs} and leave readClock as a thin wrapper returning .ms so the bench, readScore and clock_cam.py are untouched. (b) In clockcam.js tick(), capture the signature on the frame that first makes CLK.locked true and pass it into CLK.consider as a third argument. (c) In clock.js's held-adoption branch, require the candidate's signature to match the locked one on digit count and separator index before adopting; a mismatch keeps the old clock and increments a new `slipped` counter. Genuine corrections — a reset to 10:00, the table putting the clock right — come from the same digits in the same box and match; a slipped box does not. (d) Start tryHunt on a slipped trigger (>50% of the last 20 decodes mismatching over 5s) as well as on 6s of silence, and surface `slipped` in hello()'s health. (e) Separately tighten the hunt gate from 30000ms to 3000ms and require two consecutive agreeing reads before committing a move — today a shot clock showing '18' beside a game clock at 20s passes the gate and captures the clock box, and the new box is written to localStorage so the next game opens on the shot clock.

**Risk.** The legitimate 4-digit→3-digit transition at 10:00→9:59 and the MM:SS→SS.t switch at a minute both change the signature; because both arrive through the fits branch rather than the held branch the adoption gate never sees them — but add both to clockcam.clock.test.mjs before landing. Every change here should land as a case in the existing bench first.

`epinoia/clockcam/decode.js`, `epinoia/clockcam/clock.js`, `epinoia/clockcam/clockcam.js`

### 42. Stop a gap-triggered resync wiping the on-air game, and let the public page heal a retraction

**high** / hours · `transport`

**Why.** Two mirror-image bugs. (a) On a frame-sequence gap, live.js calls resync('gap') and DISCARDS the frame; resync reads the durable store and hands it to onSnapshot, which in broadcast.js REPLACES S.events wholesale. Combined with the two documented failure modes — unawaited REST broadcasts so dropped frames are not rare, and a signed-out statistician who 'still broadcasts perfectly well while every durable write is refused' — one dropped frame during a game whose durable writes are failing replaces the on-air event log with empty table contents, and the scorebug drops to 0-0 mid-stream. (b) On the public game page, goLive's onSnapshot calls mergeLive with only two arguments, so removed and full are both undefined and the replace branch is gated on `full` — meaning the poll ladder can only ADD events, never remove one. A viewer who missed the retraction frame keeps a retracted basket on the public box score, score off by two, until a full snapshot arrives over the socket or they reload.

**What.** (a) In applyFrame, apply the frame before resyncing rather than discarding it — frames are idempotent, so `onFrame && onFrame(f); resync('gap');` loses nothing and keeps the newest truth. (b) In resync, refuse to present a snapshot behind what is already held: compute snapMax from the snapshot's events; if snapMax < maxSeq, call onFrame with full:false so the consumer merges rather than replaces, and leave maxSeq alone. Only a snapshot level or ahead earns the authoritative replace. (c) At game.js:1764 pass the authority through: `mergeLive(snap.game || null, snap.events, null, true)`. (d) Cheap security mitigation that needs no migration: at live.js:551 ignore a full:true frame whose gameId does not match (keeper and cam frames already lack it — copy the pattern from embed/strip/strip.js:481), and treat a full frame as a signal to call resync() rather than as the data itself.

**Risk.** (c) must ship together with (b) or it turns an additive bug into a wipe on a game whose durable writes are refused. A genuine retraction of the highest-seq event leaves snapMax below maxSeq and would no longer heal by replace — accepted, because the scorer's removed frames and the 10s full snapshot both still carry it.

`epinoia/live.js`, `epinoia/game/game.js`, `epinoia/broadcast/broadcast.js`

### 43. Bound the publisher backlog so recovery does not replay an hour of clock over the air

**medium** / hours · `transport`

**Why.** `const backlog = []` has no cap. Every failed frame is held — correct for events, wrong for state: the heartbeat pushes a state-only frame every 5s and the 2s divergence poll pushes more, so a statistician who is signed out or whose write policy refuses (the documented case onError exists for) accumulates roughly one frame every 2-5 seconds for the whole game, a couple of thousand objects. When writes start working again, deliver drains them in order and tx.send BROADCASTS each one, so every consumer replays the clock backwards through the entire history at one frame per durable round trip: on air, the scorebug runs the last hour again in fast-forward for minutes. Even a benign 60-second wifi dropout replays ~20 stale frames.

**What.** In deliver (live.js:360-371), coalesce on the way in and strip on the way out. (1) Before backlog.push(frame), if the last held frame has no events and no removed, REPLACE it instead of appending — a state-only frame is entirely superseded by the next one. (2) When draining, blank `state` on every held frame except the last, so recovery replays the events but only one current clock. (3) Hard-cap at ~500 frames by merging the oldest two frames' events and removed arrays rather than dropping them — events must never be dropped, state always may be.

**Risk.** (2) changes what a consumer sees during recovery; live.js:551 already guards with `if (f.state)` so a frame with state:null is a no-op there — verify that explicitly. Test by forcing 200 write failures then restoring, and asserting the consumer's clock moves once rather than sweeping.

`epinoia/live.js`

### 44. Add a clear_fixtures RPC — regenerating a schedule silently doubles it

**critical** / hours · `league-ops`

**Why.** Verified: RLS is on for public.games and across all 114 migrations the only policies are select, insert and update. There is NO delete policy. fixtures-ui.js commit() filters the unplayed fixtures, confirms 'N unplayed fixtures will be replaced', then issues a PostgREST DELETE — which matches zero rows after RLS filtering and returns 204 with no error. The code proceeds to insert the full new plan. The old fixtures are still there. A club withdraws in October, the secretary regenerates, and the competition now carries both schedules: every club appears twice per round, on the fixtures page and in the ICS feed, having been explicitly told the old ones were replaced. schedule.test.mjs only exercises the pure pairing module, so nothing catches it.

**What.** Add a clear_fixtures(p_competition uuid) security-definer RPC beside delete_fixture: authorise with is_competition_admin, delete only games where competition_id matches, status = 'scheduled' and no game_events rows exist, write one audit_log row with the count, and RETURN the deleted count. Change fixtures-ui.js commit() to call it and to ABORT the insert if the returned count is less than removable.length. Do NOT fix this by adding a games DELETE policy — delete_fixture's 'played games are voided, not deleted' rule is enforced in the function, and a policy would let any competition admin bypass it from the console.

**Risk.** The RPC deletes by competition rather than by the id list the UI computed, so a fixture created between page load and commit is also removed — returning the count and comparing it in the client makes that visible instead of silent. Verify with the migration's own DO-block self-test, the pattern 0045/0076/0086 already use.

`epinoia/admin/fixtures-ui.js`, `epinoia/admin/admin.js`, `supabase/migrations`

### 45. Implement the standings tie-breakers that leagues.rules already declares

**critical** / days · `league-ops` · _needs a decision or a quiet window_

**Why.** leagues.rules ships tiebreak = ['points','h2h','h2h_diff','diff','scored'] and the docs advertise configurable tiebreakers, but a repo-wide grep returns exactly one hit — that default. recompute_standings ranks by league_points, then point difference, then points for, and nothing else. Two clubs finish level; one won both meetings but lost a blowout elsewhere. Epinoia awards the title, the playoff seed or the relegation place to the other club, and the league's own published regulations and FIBA Art. 20 say the opposite. The public table prints rank with no indication a tie was broken or how. This is the finding most likely to end in a protest the league loses.

**What.** Rewrite the final `ranked` CTE of recompute_standings in a new migration, keeping the aggregate and sanctions passes untouched. After computing league_points, partition teams into groups level on (group_name, league_points); for any group of size > 1 build a mini-league over games in this competition where both teams are in that group, and order within the group by h2h wins, then h2h point difference, then h2h points scored, then overall difference, then points for. Read the step order from leagues.rules->'tiebreak' with the existing default as fallback, so the declared vocabulary finally means something. Add standings.rank_reason text ('head-to-head 2-0', 'point difference in games between +14') and render it as a hover on the public table — explainability is itself the sales feature and it is free once the recursion is written. Implement one re-partition pass for three-way ties that remain level after h2h and document that a residual tie falls through to overall difference rather than looping. Test against FIBA Appendix D.2.1-D.2.7 plus a Leeds profile (win 1 / loss 0 / forfeit -1) as pgTAP cases.

**Risk.** This replaces a live function every league's public table depends on, on production data. Build and prove it against the seven worked FIBA examples locally first; deploy in a window with no games. Existing standings will move for any league that currently has a tie — announce it rather than let a club notice.

`supabase/migrations`, `epinoia/l/league.js`

### 46. Add a forfeit / awarded result type

**high** / days · `league-ops` · _needs a decision or a quiet window_

**Why.** game_status is scheduled/live/finalising/final/void, and recompute_standings derives the whole table from home_score/away_score where status='final'. The only writers of a final score are finalise-game and the LiveStats ingest, both of which require an event log. A club turns up with four players and the fixture is awarded 20-0: there is no path. The options are leave it scheduled forever (games-played never balances for either club), void it (for a result that was played and then annulled, and still leaves GP wrong), or have a statistician fake twenty points against real players — which poisons their season averages, BPM, leaderboards and the awards computed from them. Every rulebook researched specifies forfeits precisely (FIBA 20-0 and 0 classification points; LBA 20-0; Leeds -1 league point), and Epinoia can record none of them. A drawn abandonment is also unrepresentable, because the aggregate counts only pf>pa and pf<pa, so a level final score gives gp ≠ w + l.

**What.** Add games.result_type text not null default 'played' check in ('played','forfeit','default','void') plus games.forfeiting_team_id and games.award_reason. Extend leagues.rules with forfeit_points (default 0), default_loss_points (default 1, FIBA D.1.1), forfeit_score (default [20,0]). Add award_game(p_game, p_winner, p_home, p_away, p_reason): security definer, is_competition_admin, refuse if game_events exist, set the scores and status='final', write an audit_log row, call recompute_standings. Write NO player_game_stats or team_game_stats — the box score must stay empty and the engine must remain the only producer of statistics. Surface the badge in l/league.js's fixture row, in the governance console's fixture surgery panel, and in games.csv. Decide deliberately whether award_game calls notify_game_final (finalise-game does, this path would not otherwise) and say which in the function's comment.

**Risk.** Touches recompute_standings' point award, so land it with or after item 45 rather than in parallel — two people rewriting the same function is how a table quietly goes wrong. Cover the level-score case while you are there, or gp ≠ w + l survives.

`supabase/migrations`, `epinoia/admin/governance-ui.js`, `epinoia/l/league.js`

### 47. Close two RLS holes: players DELETE, and the safeguarding flags a manager can clear

**high** / days · `league-ops` · _needs a decision or a quiet window_

**Why.** players_write is `for all`, which includes DELETE, and no later migration narrows it. player_suspensions, season_awards, player_previous_clubs and membership_eligibility all cascade on delete, and player_game_stats.player_uuid is set null with every season view filtering nulls out. So one DELETE authorised for the manager of any club the player is rostered at erases the suspension the league imposed, erases the awards, and removes the entire season from every leaderboard and aggregate — with no audit row, because this is a table write, not an RPC. Separately, the enforce_minor_photo_consent trigger is a genuinely good database-level guard that reads two booleans the guarded party can PATCH directly: setting is_minor false makes the trigger pass, players_read stops withholding, and a child's photograph and profile go public. Only admin_update_player was ever meant to touch those.

**What.** (a) Split players_write into players_update (for update) and players_insert (for insert) with the current predicates, and create NO delete policy. Add retire_player(p_player) for the legitimate case: platform admin only, refuses while any player_game_stats or player_suspensions row exists, writes an audit_log row. Convert roster-csv.js:230's rollback path (`from('players').delete().in('id', made)`) to a rollback_import(p_ids uuid[]) RPC or the import's failure-undo stops working silently. (b) Add a BEFORE UPDATE trigger guard_player_protected_fields raising 42501 when is_minor, photo_consent, public_consent, consent_guardian, consent_at, consent_by or birth_year change and the caller is neither a platform admin nor a league admin of the player's club's league, unless the transaction is inside a security-definer function (check current_setting('epinoia.privileged', true), set by set_player_profile and admin_update_player). A trigger, not a policy, because WITH CHECK cannot see the old row — the reason migration 0028 already documents.

**Risk.** set_player_profile writes public_consent and the consent_* fields legitimately, so it must set the privileged flag before its UPDATE or every club consent tick breaks — test that path explicitly in the migration's self-test block. The CSV rollback path breaking silently is the same class of bug as item 44; convert it in the same commit.

`supabase/migrations`, `epinoia/app/roster-csv.js`, `epinoia/app/app.js`

### 48. Make the audit log unforgeable and readable by the league it is about

**high** / days · `league-ops` · _needs a decision or a quiet window_

**Why.** Two halves. (a) The only SELECT policy is is_platform_admin(), and the only UI is the platform console. A league admin cannot see who deducted three points from a club, who lifted a suspension or who reverted a game in their own competition — and platform_prune_audit defaults to deleting at 730 days. When a club's board or a federation asks the league to evidence a disciplinary decision, the league has nothing to produce. (b) Worse: `audit_insert ... with check (auth.uid() is not null)` — no constraint that actor = auth.uid() and no column default. Any signed-in account (a fan, a statistician, a rival club's manager) can POST an arbitrary actor, action and detail. They cannot read it back, but a platform admin investigating a dispute will. An evidence record anyone can write into is not evidence.

**What.** One migration. (a) `alter table public.audit_log alter column actor set default auth.uid()` and replace audit_insert with `with check (actor = auth.uid() and auth.uid() is not null)` — every RPC that writes it already passes auth.uid() explicitly at ~50 call sites across 28 migrations, so none break, and the edge functions use the service role and bypass RLS. (b) Add league_id uuid to audit_log, populate it in the governance RPCs that know it (suspend_player, lift_suspension, add_sanction, remove_sanction, revert_game, set_game_status, delete_fixture, admin_update_team, admin_update_player) and backfill by resolving subject/subject_id where possible. (c) Add a SELECT policy `using (is_platform_admin() or (league_id is not null and is_league_admin(league_id)))` and a league_audit(p_league, p_action, p_limit, p_offset) RPC mirroring platform_audit; mount it in admin/index.html reusing the platform pane's filter and paging, and add audit.csv to the season export. Also add an audit_log row to set_match_details, which writes officials today and records nothing.

**Risk.** Verify no client code inserts into audit_log directly before tightening the policy — currently none does, but item 29's override path is about to want to, so give it an RPC rather than a direct insert. Backfilling league_id is best-effort; leave nulls platform-only rather than guessing.

`supabase/migrations`, `epinoia/admin/index.html`, `epinoia/admin/export-ui.js`

### 49. Build a PlayHQ CSV membership adapter — the price of entry to the English market

**critical** / days · `integration`

**Why.** Basketball England moved membership and registration to PlayHQ for 2025/26; affiliated local leagues get it free and affiliations went from 26 to 68 in a year, most digitally scoring for the first time. An affiliated league is OBLIGED to hold its membership in PlayHQ, so today Epinoia cannot tell whether any player in it is a registered, insured member — which means it cannot legally serve one at all. But the mandate is split: competition management and the league website remain the league's choice. With an adapter, Epinoia becomes the competition and broadcast layer on top of a membership system the league is already forced to use, which is the only defensible position available. membership.js is already a well-built read-only federation sync with exactly the right status vocabulary and a restAdapter/tableAdapter contract — it is missing one adapter.

**What.** Stage 1 only, tonight: write a playhqAdapter in epinoia/membership.js alongside restAdapter and tableAdapter, same contract {id, label, byClub(clubExternalId, since), byId(externalId)} returning the normaliseMember shape, fed by a CSV a BE league admin exports from the PlayHQ admin portal. Map columns to {externalId, firstName, lastName, dob, status, validFrom, validTo, raw}, deriving status from the PlayHQ membership state (active→eligible, expired→lapsed, absent→unregistered) and keeping the whole row in raw as evidence. This reuses tableAdapter almost verbatim and unblocks item 29's eligibility gate with no API dependency. Reuse the external_identities table from migration 0077 for per-player id mapping rather than inventing a second one. Also make supabase/functions/_shared/membership.js a generated copy of epinoia/membership.js, or add a test asserting the two are byte-identical — today it is duplicated verbatim and can drift.

**Risk.** Column names are guesses until Louie supplies a real PlayHQ export — write the mapping as configuration, not as literals, so correcting it is a config edit rather than a code change. Stage 2 (the live public-tier API against Seasons→Grades→Fixture, plus webhooks) is a separate, later item.

`epinoia/membership.js`, `supabase/functions/_shared/membership.js`, `supabase/functions/membership-sync/index.ts`

### 50. Make the federation eligibility machinery reachable at all

**high** / days · `league-ops`

**Why.** Migration 0077 defines external_sources, external_identities, membership_eligibility and membership_syncs with good reasoning; membership.js gives the adapter contract; the membership-sync edge function is a working runner with a dry-run mode. None of it is reachable. No client or console file references external_sources, no concrete federation adapter exists, and membership_status has zero callers outside its own self-test. Two structural blocks: every RLS policy on all four tables is is_platform_admin(), so a LEAGUE admin cannot read their own league's eligibility; and membership_status is granted only to authenticated, so it cannot be called from the anon paths where player_ban already can. This is a complete third of a feature with no way in and no way out, and items 29 and 49 both depend on it.

**What.** (1) Widen the reads: add `or is_league_admin(<league>)` policies to membership_eligibility and membership_syncs (leave external_identities platform-only — it carries membership numbers), and grant membership_status to anon alongside player_ban so the scorer's pre-game check is one pattern rather than two. (2) Add an external_sources panel to admin/platform/platform.js: create/edit source, edit the config JSON, run a dry sync through the membership-sync function, show the last membership_syncs row and its conflicts array. (3) Wire the playhqAdapter from item 49 into it as the first concrete source.

**Risk.** membership_status deliberately answers 'unknown' rather than 'no' when nothing is recorded — every new caller must treat an empty result as silence. external_sources.config already models an 'eligibility: advisory|blocking' key; keep advisory as the default so widening the reads changes no behaviour on its own.

`supabase/migrations`, `epinoia/admin/platform/platform.js`, `supabase/functions/membership-sync/index.ts`

### 51. Add a venue and court model with clash detection

**critical** / days · `league-ops`

**Why.** Migration 0034 states the choice outright: a venue is a label and an address that get printed together, never queried across. That reasoning is correct for a home-and-away league and wrong for the format most English amateur basketball actually runs — a central venue, two courts, six games on a Sunday — which queries across venues constantly. There is no court, no availability window, no blackout and no double-booking detection anywhere. Separately, fixture generation checks nothing outside its own competition, so generating a cup after a league routinely puts a club in two fixtures on the same Saturday evening with nothing saying so. PlayHQ runs live conflict checks against teams, officials AND surfaces before fixtures publish. This is the highest value-per-hour league-ops item and it is entirely internal — no third party, no API, no money.

**What.** Migrate without breaking the printed path. Create venues(id, league_id on delete cascade, name, address default '', lat numeric(9,6), lon numeric(9,6), unique(league_id,name)) and courts(id, venue_id on delete cascade, label default 'Court 1', unique(venue_id,label)); add games.court_id references courts on delete set null; KEEP games.venue and venue_address as the display fallback and backfill court_id by case-folded name match, leaving unmatched rows on the text path. Add competitions.slot_minutes int default 110 (a fixture plus warm-up and changeover). Put the clash check inside upsert_fixture, the single authorised write path: add p_court and, when p_court and p_tipoff are both present, raise on any non-void game sharing that court whose [tipoff, tipoff+slot_minutes) overlaps. For the bulk generator follow the advisory model instead of the blocking one — generate, then return a conflict list the admin accepts or edits, because a hard failure the night before publication is worse than a flagged clash. In fixtures-ui.js, between plan() and commit(), also query the season's OTHER competitions and warn on any club playing within ±4 hours. Two near-free follow-ons: a printable per-venue day sheet (the thing a league secretary currently makes in Word) and distance on the public fixture page from lat/lon.

**Risk.** Keeping the text columns as the display fallback is what makes this non-breaking — do not drop them, and leave unmatched rows on the text path rather than forcing a backfill. Verify the public fixture page and the ICS feed render identically for a league with no venues rows.

`supabase/migrations`, `epinoia/admin/fixtures-ui.js`, `epinoia/admin/schedule.js`

### 52. Add capture-depth tiers so a volunteer can score less without scoring wrong

**high** / days · `scorer`

**Why.** Epinoia has one depth, the deepest — shot locations, shot types, assists, blocks, steals, second-chance and points-off-turnover windows, substitutions. That is correct for Louie's own leagues and wrong for the parent volunteering at an U14 game, and it is probably the single biggest reason a league says no. Worse, a half-hearted attempt at the full depth produces the exact failure mode the linter exists to catch: sub events entered for the first quarter and then abandoned, which is far more damaging than never having entered them. NBN23 ships three explicit levels for precisely this reason.

**What.** Add capture_tier to the league, overridable per fixture, with three values whose effect is on the UI ONLY — never on the schema, because the engine must keep deriving from one event vocabulary. 'score': p2/p3/ft made+miss, foul, timeout, period_start only; suppress the pending chain entirely (a make does not ask for an assist), hide the shot-location sheet, hide the sub UI and pin D.onCourt to the starters so NO stint is computed rather than a wrong one; team totals only. 'scoresheet': adds substitutions, rebounds, and individual fouls with type (the P/T/U column already modelled at index.html:5094) — the FIBA official-scoresheet set and what an association actually demands. 'full': today's behaviour. Store the tier on the fixture so the same statistician gets the same screen every week, and show it in the setup header. Then gate the derived pages honestly: a game captured at 'score' shows the team box and says 'lineup data was not captured for this game' rather than publishing a stint page built on air.

**Risk.** The honest gating of derived pages is the part that protects the analytics reputation the whole platform rests on — if only half of this ships, ship that half. Verify that a 'score'-tier game produces no lineup_stints rows at all rather than degenerate ones.

`epinoia/score/index.html`, `epinoia/score/bootstrap.js`, `epinoia/lineups.js`, `supabase/migrations`

### 53. Scorer input-model truth pass: the cues that lie and the gestures that silently do nothing

**high** / hours · `scorer`

**Why.** Five verified defects in one file, each an hour, all of which cost recorded data or operator time. (a) The blanket prefers-reduced-motion rule forces the .prow.charging progress fill to .01ms, so the row fills instantly on every press — including the plain tap about to be recorded as a MISS. The one visual distinguishing miss from make says 'make' for both, permanently, for any scorer with Reduce Motion on. (b) A press that drifts 15-70px records nothing at all and says nothing: the make timer is killed above 14px and the tap requires under 12px, so with 2pt armed (where gestureOptions returns an empty list) a thumb rolling 20px on a 40px row produces no event, no toast, no vibration. This is the app's 'I tapped and it didn't take'. (c) Every cue for the hold duration says 1.5 seconds while MAKE_MS on touch is 500, so a scorer who trusts the bar holds three times longer than needed on roughly half of everything that happens — the exact saving the MAKE_MS change was made to win. (d) No rebound chip exists in a free-throw window although the legend advertises one, on the most common rebound in the game; the fallback is a team-header tap that records a TEAM rebound, wrong and invisible until someone reads the box score. (e) Toasts are nowrap-clipped to ~40 characters, so the instructional ones — including 'moved behind the arc — recorded as a 3PT attempt', which reports a silent change to recorded data — are cut off.

**What.** (a) After index.html:847 add `@media (prefers-reduced-motion:reduce){.prow.charging::before,.act.charging::before{animation-duration:var(--ep-make-ms,1500ms) !important;}}` — class specificity beats *::before at equal importance and source order removes any doubt. (b) At onGUp:3730 replace the bare distance test with `if (dist<12 || !gestureOptions(team,pid).length) tap(team,pid); else toast('nothing recorded — the drag stopped short');` — gestureOptions returns [] precisely when the row has no legal drag meaning, so a short movement there can only have meant a tap. (c) Add `:root{--ep-make-ms:1500ms}`, drive both charge animations from it, set it beside the constant with `document.documentElement.style.setProperty('--ep-make-ms', MAKE_MS+'ms')`, and replace the three literal '1.5s' legend strings and the renderControls sentence with IS_TOUCH-conditional copy. (d) In subbarSpec at 3482 build the list conditionally, pushing pickChip('reb','rebound → tap','r') when p.kind==='miss' && p.shot==='ft' before the foul-type chips; pickAllowed and tap() already route a live pick. (e) Replace the toast's nowrap/ellipsis with `white-space:normal; line-height:1.5; text-align:center; max-width:min(92vw,420px); -webkit-line-clamp:3;` and raise the default duration to 2800ms, passing 3600 at the snap call. Also fix the two documentation gaps: the touch tap-to-sub-in route is implemented and advertised nowhere, and undo() will pop a period_start that deleteEvent explicitly refuses — guard it and revert S.period/S.clockMs.

**Risk.** (d) adds one more chip to a sub-bar that already wraps — check it at 375px. (e) a three-line toast grows up into the row where the confirm/cancel discs sit; #toast is pointer-events:none so it only obscures them briefly, but check it against the disc-clearance padding rather than in isolation. None of these touch recorded data shape.

`epinoia/score/index.html`

### 54. Put the FIBA zone vocabulary on the loc event and compute it once

**medium** / hours · `integration`

**Why.** Shot location is stored as {t:'loc', ref, x, y} — a good shape that keeps the base event small and allows a location to be added after the fact. But only the raw coordinate travels, so shotchart.js, the box score, the JSON api and any club widget each re-derive zones from x/y with their own thresholds, and any disagreement is invisible until somebody compares two pages. LiveStats sends x and y AND an 'area' string from a fixed vocabulary of exactly thirteen values, so a consumer that cannot do geometry still gets a correct zone and two consumers can never disagree about what a corner three is.

**What.** Compute the zone once, at capture, and store it on the same event: {t:'loc', ref, x, y, area}. Use FIBA's thirteen values verbatim (underbasket, inthepaint, insiderightwing, insideright, insidecenter, insideleft, insideleftwing, outsiderightwing, outsideright, outsidecenter, outsideleft, outsideleftwing, backcourt) rather than inventing a vocabulary — it costs nothing, makes the JSON api drop-in readable by anyone who has consumed a LiveStats feed, and critically means a game ingested via scripts/ingest and a game scored in Epinoia produce identical rows with no translation table between them. Write it as EpinoiaEngine.areaOf(x, y) in engine.js so the scorer, the ingest lane and a backfill script all call one implementation. Keep Epinoia's own finer zones as a derived layer on top of area; do not replace them. Backfill is a single pass over existing loc events with the same pure function, since x and y are already stored.

**Risk.** None — additive field on an existing event, and the payload jsonb takes it with no migration. Verify the backfill against a known game by asserting the derived zone totals match the current shot-chart page before and after.

`epinoia/engine.js`, `epinoia/score/index.html`, `epinoia/livestats.js`, `scripts/ingest`

### 55. Give shared links a real unfurl, or stop writing to a queue nothing reads

**high** / days · `fan`

**Why.** Verified by grep: no og:title or og:image in any static HTML across epinoia. The game page's static head carries only a title; all OG, Twitter and JSON-LD is injected by seo.js after load, and its og:image is the generic brand mark with twitter:card 'summary'. WhatsApp, Slack, Discord, Facebook, LinkedIn, iMessage and X unfurl bots do not execute JavaScript. So the highest-volume integration on the whole platform — a club secretary pasting a result into a team WhatsApp — emits a grey box with no teams, no score and no crest. Meanwhile finalise-game upserts each finished game into publish_queue 'for a scheduled job' that generates the static page and OG image, and nothing in the repo reads that table.

**What.** Add an edge function `og` (verify_jwt=false, alongside the three in item 2) taking a game id, reading teams, score, competition and date, and returning a static HTML shell with server-filled og:title ('East Dock 81–74 Neon City'), og:description, og:image and twitter:card=summary_large_image, then client-redirecting a real browser to /epinoia/game/?g=. Point shared links at it. The OG image can be an SVG render of the final-score scene broadcast.js already draws. Then either drain publish_queue from a scheduled pass on the existing .github/workflows/ingest.yml runner (it already holds the service key) or delete the table and the write, so the queue stops implying a job that does not exist.

**Risk.** None to existing pages — a new route. Keep seo.js as-is so in-browser canonical and JSON-LD behaviour is unchanged. Verify with the Facebook sharing debugger and by pasting a link into Slack.

`supabase/functions`, `epinoia/seo.js`, `supabase/functions/finalise-game/index.ts`, `epinoia/broadcast/broadcast.js`

### 56. Fix the API's season blindness and its silent wrong-competition fallback

**high** / days · `integration`

**Why.** route() reads seasons ordered by starts_on descending with limit 1, loads competitions for that one season, then picks `comps.find(c => c.id === compId) || comps[0] || null`. Two consequences. (1) Last season's standings, games, players, awards and bracket are unreachable through the API, on a platform whose pitch is that the archive came across — every public page shows them and no API route can. There is no ?season= parameter anywhere. (2) A competition id from any other season, or a typo, falls through to comps[0] and is returned with HTTP 200 naming the fallback competition. An integrator who stored a competition id last May and polls it in October gets this season's Division One labelled with this season's name and no error — the exact failure mode that has two sites publishing different numbers for the same league.

**What.** Replace the season-limited lookup with a direct resolve: when ?competition= is given, select the competition joined to seasons filtered on the league, and fail(404, 'no such competition in this league', 'list them at /v1/leagues/{slug}') when it does not resolve — never fall back. Add ?season=<id> filtering the competition list, and return EVERY season (not just the newest) in the /leagues/{slug} overview so an integrator can discover ids. Keep 'newest season's first competition' as the no-parameter default only. While in the file, add `'Vary': 'X-API-Key, Authorization'` to the header block in json() — /v1/leagues varies by key scope but is served public, max-age=60 with no Vary, so a shared cache can hand a league-scoped key the platform-wide list.

**Risk.** Any caller passing a stale competition id starts getting a 404 instead of silently wrong data — that is the point, but document it on the API page. Blocked behind item 2: the routes are unreachable until the gateway check is off, so verify both together.

`supabase/functions/api/index.ts`, `epinoia/api/index.html`

### 57. Add ?since= incremental sync, backed by a real updated_at column

**high** / days · `integration`

**Why.** The games collection accepts only status, competition, limit and offset. So an integrator republishing a league must either re-page the whole season every poll (200 rows at a time against a 1000/hour key) or trust the push feed with no way to reconcile a miss. A corrected result — which the platform explicitly supports, since a re-finalised game re-queues its delivery — is undetectable by a puller. And there is no column to build a cursor on: games carries created_at, finalised_at, reverted_at and nothing that moves on every change.

**What.** Migration first: `alter table public.games add column if not exists updated_at timestamptz not null default now()`, a before-update trigger setting it to now(), and an index on it; backfill with coalesce(finalised_at, tipoff_at, created_at). Then in api/index.ts add ?since=<ISO8601> to the games, standings and players routes applied as .gte('updated_at', since), switch to ascending order when since is given so paging is stable, and include updated_at (and finalised_at on finals) in every games and box-score object. Document the contract plainly: poll with since = the max updated_at you have seen.

**Risk.** The trigger fires on every scorer write to games (the live-score mirror), so updated_at churns for live rows — correct for a sync cursor, but a poller with ?since= will re-fetch live games constantly; cap it by having integrators poll finals with ?status=final&since=. The additive column and trigger are low-risk; the backfill should run once, off-peak.

`supabase/migrations`, `supabase/functions/api/index.ts`, `epinoia/api/index.html`

### 58. Add a retry sweeper for failed feed deliveries

**high** / days · `integration`

**Why.** dispatchGame posts once, writes 'sent' or 'failed' with attempts+1, and stops. The only retry path is a league admin manually pressing a button in the console. There is no cron, no pg_cron job, no scheduled function and no backoff anywhere in the repo. If a partner's endpoint is down for ten minutes on a Saturday with six games finishing, all six sit failed until a human notices — for a partner like RealGM that means results are missing until Monday. The infrastructure for the missing caller is all built: feed_deliveries.attempts, the partial index on (status, queued_at) where status in ('pending','failed'), and requeue_feed_delivery.

**What.** Add a scheduled sweep on the runner that already exists — .github/workflows/ingest.yml runs every 30 minutes with the service key in env — or a new feed-retry edge function called from it. Select DISTINCT game_id from feed_deliveries where status='failed' and attempts < 6 (dispatchGame takes a gameId and re-selects all owed rows for that game itself), skip rows inside the backoff window keyed on attempts (1m, 5m, 25m, 2h, 12h), and call dispatchGame per game. Add a next_attempt_at timestamptz column so the window is a query rather than arithmetic on queued_at. Leave the manual retry uncapped so an admin can still force one. While in the same area, schedule notify_fixtures(): it is revoke-all-from-authenticated and invoked from exactly one place — scripts/ingest/run_ingest.py — so a league scoring inside Epinoia never runs it and its fans never receive a fixture reminder, a preference that visibly does nothing in the profile page.

**Risk.** Nothing currently caps attempts, so a permanently dead endpoint would be retried forever once a sweeper exists — the cap must be in the sweeper's WHERE. notify_fixtures is idempotent via `on conflict do nothing` keyed on ':soon'/':today', so it is safe under repeated runs — but for the same reason a re-dated fixture produces no new notification; clear the matching notifications row inside upsert_fixture when tipoff_at changes, or fans get the old time and are never corrected.

`supabase/functions/_shared/feeds.ts`, `supabase/functions/feeds/index.ts`, `.github/workflows/ingest.yml`, `supabase/migrations`

### 59. Stop the standings embed serving the demo league to a club's own website

**medium** / hours · `integration`

**Why.** Migration 0057 builds host-based embed configuration whose kind check explicitly allows any/strip/table/game/merch, and grants embed_config to anon. Only strip.js implements it. table.js instead reads `const leagueSlug = qp.get('l') || 'demo-league';`. So a club that pastes the one-line snippet with no data-league — exactly the snippet 0057's header promises the league can configure remotely — gets EPINOIA'S DEMO LEAGUE'S TABLE rendered on their own website, permanently, with no error. embed.js only sets ?l= when data-league is present and the gallery only emits data-league when a league is picked, so producing that snippet takes one missed dropdown. Someone else's fixtures on a club's homepage is the kind of thing a committee cancels over.

**What.** Lift hostOfParent() and siteConfig() out of strip.js:64-87 into a shared epinoia/embed/site.js, include it in embed/table/index.html and embed/merch/index.html, and await it with p_kind 'table' / 'merch' before first paint. Replace table.js:20's 'demo-league' default with an empty value and render the existing fail() empty state ('this embed has not been told which league to show') rather than someone else's data. Short-circuit the RPC whenever ?l= is present, as strip.js already does, so an already-configured snippet gains no round trip.

**Risk.** table.js currently paints without awaiting anything, so this adds a gate on first render for unconfigured snippets only. Verify a configured snippet's time-to-first-paint is unchanged.

`epinoia/embed/table/table.js`, `epinoia/embed/strip/strip.js`, `epinoia/embed/merch/merch.js`, `epinoia/embed.js`

### 60. Cap the ICS feed to a rolling window so upcoming fixtures cannot fall off the end

**medium** / hours · `fan`

**Why.** Both ICS queries order ascending by tipoff_at with no date floor — the team feed caps at 400 rows, the league feed at 1000. A calendar's job is upcoming fixtures, but the row budget is spent oldest-first on completed games. A league with several competitions per season reaches 1000 finished games inside two or three seasons, after which the ?league= feed contains nothing but history and a subscriber sees no fixtures at all. The failure is silent: the file parses, the events are valid, the calendar simply stops gaining new games, and calendar clients surface neither errors nor absences. Compounding this, the ?league= form is linked from nowhere on the site — grep finds one hit, the team page, which only builds the ?team= form.

**What.** Add a date floor before the limit on both queries: `.gte('tipoff_at', new Date(Date.now() - 120*86400000).toISOString())`. If the results-archive property the source comment describes matters, do it as two queries instead — the most recent 60 finals ordered desc plus every scheduled/live game ordered asc — concatenated before building VEVENTs. Add a league-level 'add fixtures to your calendar' chip on the league page mirroring the team page's, and document both forms plus the webcal:// variant on epinoia/api/index.html, which currently does not mention the calendar feed at all.

**Risk.** An ICS PUBLISH feed is the whole calendar, not a diff, so any game that drops out is DELETED from a subscriber's calendar on the next refresh. Pick the window deliberately and keep it stable — changing it later silently removes events from people's calendars. Blocked behind item 2, which is what makes the feed reachable at all.

`supabase/functions/ics/index.ts`, `epinoia/l/league.js`, `epinoia/api/index.html`

### 61. Store the clockcam board profile against the venue, not the game

**high** / days · `clock` · _needs a decision or a quiet window_

**Why.** openGame() reads and every save writes localStorage['cc:' + gameId] — the key is the GAME id and the store is that one phone's localStorage. A statistician who boxed the board last Tuesday, on a different phone, or for a different fixture in the same hall, starts from nothing, every week, forever. The control room has no way to know whether a profile exists before someone travels. Every rival treats the board as a property of the building: Spiideo calibrates once per venue, UniversoOCR trains a board in about a minute and then reads it every game, Daktronics persists its OCR configuration to a file. This is the difference between clockcam being a party trick and being the thing a league sets up once.

**What.** Depends on item 51's venues table. Add board_profiles(venue_id uuid primary key references venues, boxes jsonb not null, exposure jsonb, invert boolean default false, thr int default 0, updated_by, updated_at) with RLS mirroring may_broadcast_game. boxes keeps the same fraction-of-frame rectangles already in use, so no format change. In openGame(), select the game's venue_id, load the profile, and fall back to localStorage then to empty; write back on every box change, debounced 2s. Add the profile's existence and updated_at to the hello telemetry's health object so control.js can show 'this hall is calibrated (last set 14 Feb)' in its pre-game checklist. Critically, the boxes are fractions of the FRAME, so they only transfer if the phone is in the same position — store an 80px-wide JPEG of the clock crop alongside (reuse peek()) and on load show it beside the live view as a 'line the phone up with this' ghost. That ghost is what makes the profile actually reusable rather than nominally reusable.

**Risk.** Blocked on the venues entity. Until then the localStorage fallback must stay as the second tier, or a league without venues configured loses what it has today. Verify the ghost-alignment flow in a browser against a rendered board before assuming it helps.

`epinoia/clockcam/clockcam.js`, `epinoia/broadcast/control/control.js`, `supabase/migrations`

### 62. Name OBS scenes and sources per game so covering two courts does not repoint the first

**medium** / hours · `broadcast` · _needs a decision or a quiet window_

**Why.** SCENE_NAME is the constant 'Epinoia graphics' and graphicsList() names every source 'Epinoia · ' + title — neither carries the game id, though the URL inside does. mixers.layout() is deliberately re-runnable and calls SetInputSettings on any source it already knows. So a producer covering two courts from one OBS opens the control room for game B, presses 'Build the rundown in OBS', and every source belonging to game A is reconfigured to game B's URLs — including the scorebug currently on air. MX_KEY is one localStorage slot too, so the two tabs share and overwrite mixer credentials. The layer side is fine because bcast:<gameId> is per game, which makes the failure quieter: the takes still route correctly, only the content is wrong.

**What.** Derive a short tag once at boot from the fixture (HOMvAWY, or gameId.slice(0,8) before the names load) and use it: SCENE_NAME = 'Epinoia graphics · ' + tag and name every source 'Epinoia · ' + title + ' · ' + tag. layout() then creates a second OBS scene rather than overwriting the first, and take() already scopes by sceneName, so switching courts becomes switching OBS scenes. Key the auto-connect preference per game rather than globally, keeping credentials in the shared slot. Say so in #mxNote after a layout ('built as a new scene; the old "Epinoia graphics" scene can be deleted') so an existing user's orphaned rundown is explained.

**Risk.** An existing user's rundown is orphaned on first run after the change — hence the note. Verify against a real OBS instance with two control-room tabs open on different fixtures.

`epinoia/broadcast/control/control.js`, `epinoia/broadcast/control/mixers.js`

### 63. Add a rundown and a real preview/program split to the control room

**medium** / days · `broadcast`

**Why.** The control room is twenty buttons with no order, no cue and no next: each scene is taken directly, there is no ordered list, no auto-advance and no way to save an order for next week. And the 'preview' iframe is a program monitor — it is set only by take() and clearAir(), so it only ever shows what has already gone out. That matters most for the graphics that render empty when their data is not there (bench before the fives are picked, lineups below the 4-minute floor, lower with nobody matching on court, ranked cards whose squad-pool filter has excluded everyone in the first two minutes). Each produces a blank hole where a graphic should be, and the first person to see it is the audience. Every comparable product — SPX-GC's rundown API, vMix's Auto Next, CasparCG's load/cue/take separation — exists so a one-person production decides the order before tip-off instead of hunting buttons during a timeout.

**What.** (1) Table broadcast_rundowns(id, league_id, name, items jsonb) where each item is {id, scene, params, dwell_ms, auto_next, label}. Seed three defaults: 'Pre-game' (fixture → squads → officials → starting fives, 20s dwell, looping), 'Timeout' (scorers → plusminus → index), 'Full-time' (final → index → lineups). (2) A second column beside the scene grid showing the rundown, the CUED item outlined and the ON-AIR item filled; keyboard is the whole point — Down/Up move the cue, Space takes the cued item (scoped per item 24), Escape takes blank. (3) Cue must pre-load: render the cued scene into a hidden second stage in the overlay page so a take is a class swap, not a fetch. (4) Split the pane into two labelled iframes, PREVIEW (amber) and PROGRAM (red), both using the fixed non-live URL they already use so neither can publish; hover or single-click sets preview, the take button promotes it. (5) Bind digits 1-9 with a modifier for direct takes, with the number drawn in the tile corner.

**Risk.** Two iframes doubles the layer instances the control machine runs; both are static and idle, so negligible. Cheap interim if the layout change is too much: have render() paint a diagnostic placeholder instead of '' under ?debug=1 so the preview shows 'bench — fives not picked' rather than nothing.

`epinoia/broadcast/control/control.js`, `epinoia/broadcast/control/index.html`, `epinoia/broadcast/broadcast.js`

### 64. Build sponsor inventory and exposure reporting into the broadcast layer

**high** / weeks · `broadcast` · _needs a decision or a quiet window_

**Why.** Verified by grep: the word 'sponsor' appears exactly once in the entire broadcast module, in a code comment. The twenty-scene catalogue has no sponsor scene and no sponsor slot inside any existing scene. A league streaming on Epinoia literally cannot put a sponsor on air. This is the gap that costs the league money and therefore the one that justifies the subscription: LIGR sells exactly this — ad sets assigned by percentage or connected to in-game events, assignable to specific teams, with exposure analytics that prove ROI — and Epinoia already owns the hardest part, which is the live data and the graphics that render from it. Three separate lanes raised it independently, which is unusual.

**What.** Copy LIGR's data model, because it is the one that has been sold. (1) sponsors(id, league_id, competition_id null, team_id null, name, asset_path in Supabase storage requiring a transparent PNG at 2× the rendered slot, slot enum('bug','strip','endcard','attached'), weight, attach_scene text null, attach_event text null, starts_on, ends_on, max_impressions, active). (2) sponsor_impressions(id, sponsor_id, game_id, scene, shown_at, seconds) — written by the OVERLAY, not the control room, so it records what actually reached air. (3) Render: add a sponsor scene (endcard full-frame plus strip variant) to both SCENES tables and a persistent bug slot inside the scorebug and on the right edge of every ranked stat card, rotated by weighted random WITHOUT replacement over a dwell timer (default 20s), reshuffling when the bag empties so the same logo never repeats back to back. (4) 'attached' mode: when a scene is taken and an active sponsor names it, render the lockup in the card footer and set the header to '<Scene title>, presented by <name>'. Drive break placements from game state rather than a timer — a timeout event triggers the full card, period end triggers the quarter-break slate. (5) A post-game sponsor report per game and per competition: impressions, total seconds on air, share of air, split by scene, plus a contact sheet of six actual frames pulled from the recording (the existing video pipeline can produce it, and the contact sheet is what gets the sponsorship renewed). (6) Gate the whole feature behind the league tier so it is a paid upgrade.

**Risk.** Design work is the real cost, not code — slot sizes, dwell timing and the tier gate are Louie's calls. Build it after item 33's animation layer so sponsor cards inherit the transitions rather than needing their own. Impressions written by the overlay means a layer open on a producer's second monitor logs air it never reached; scope the write to ?live=1 sources only.

`epinoia/broadcast/broadcast.js`, `epinoia/broadcast/control/control.js`, `supabase/migrations`, `scripts/worker`

### 65. Build officials appointments — and deliberately skip officials payouts

**high** / weeks · `league-ops` · _needs a decision or a quiet window_

**Why.** league_officials solves the identity half well (the unique constraint that stops 'A Shaw', 'Shaw, A.' and 'Adam Shaw' becoming three referees is the right call). The scheduling half is absent: no availability, no offer, no acceptance, no clash check, no appearance count. Covering thirty fixtures with twenty officials is the league secretary's biggest weekly job and it is not modelled at all. Worse, games.officials stores role→NAME STRINGS with no id, so even an official picked from the directory has no referential link back to it and 'how many games did Adam Shaw referee?' is a string match — which is the number referee societies actually ask for.

**What.** Build the appointment half; skip the money half. Two tables: official_availability(official_id, on_date, weekday, from_date, to_date, available boolean default false, note) — default false means rows record BLOCKS, which is what officials actually tell you; and game_appointments(game_id, official_id, role, status check in ('offered','accepted','declined','withdrawn'), fee_pence, responded_at, unique(game_id, role)). On status→accepted, write the official's name into games.officials jsonb so the existing scoresheet and public-page code paths are untouched — the appointment layer feeds the register, it does not replace it — and store the ids in a SIBLING column, never inside that object, or every printed scoresheet renders a uuid where a name should be. Three screens: an assignor view listing unfilled chairs across the fixture list; a per-official page reached by token link, not an account (the no-accounts principle migration 0078 already established); and a season appearance count per official. Clash detection is free once item 51's courts exist: same official, two games, overlapping slots. Add a per-game fee_pence and a printable expense sheet — but do NOT pay officials through Epinoia: onboarding every referee to Stripe Connect means owning their KYC and walking into UK employment-status questions for people paid £25 cash a game. Add an audit_log row to set_match_details, which today writes officials and records nothing.

**Risk.** games.officials is read by scoresheetHTML as a flat role→name map — adding ids must go in a sibling column. Keep the free-text path that 0078 deliberately preserves for a late replacement. Skip the Assignr API bridge until a league actually asks for it.

`supabase/migrations`, `epinoia/admin/officials-ui.js`, `epinoia/boxscore.js`

### 66. Make the game sheet signed, hashed and archived

**high** / weeks · `league-ops` · _needs a decision or a quiet window_

**Why.** boxscore.js already renders a real FIBA-layout A4 sheet with per-period team-foul boxes, fouls in commission order, the eight official chairs and six blank signature rules including 'Captain (in case of protest)'. It is a browser print job and nothing more: no signature captured, no crew-chief approval recorded, no protest flag anywhere in the repo, no immutable artefact stored. A club disputes Saturday's result on Tuesday and the league can only re-render an HTML page from the CURRENT event log, which shows what the log says today, not what was agreed at the table. For a league using Epinoia as its system of record, a disputed result has no artefact to point at — and that is the conversation that ends a league's trial. NBN23 charges money for exactly this.

**What.** Add game_signatures(game_id, role check in the eight chairs plus captain_protest, signer_name, signer_user_id, stage check in ('pregame','postgame'), signed_at default now() using SERVER time never the device's, device_id, event_count, event_hash, ink jsonb). event_hash = sha256 over the ordered event log at the moment of signing — a signature is a commitment to a specific event log, which is the part that makes it defensible. Capture ink as stroke points normalised 0-1, not a PNG: a tenth of the bytes, crisp at any render size, replayable if challenged. Enforce ordering in a BEFORE INSERT trigger: refuse crew_chief until every present umpire row exists, refuse postgame rows before the game is pending approval. Add games.sheet_state ('draft','lodged','confirmed_a','confirmed_b','live','pending_approval','signed','amended'). On the transition to 'signed', have finalise-game render the existing scoresheetDoc() HTML to PDF with the hash and a verification short-URL in the footer, into a private bucket keyed by game_id. Any later event edit flips the state to 'amended', keeps the original PDF, and stamps 'AMENDED AFTER SIGNATURE' on the reissue with a diff appended. Also add the per-half timeouts row (leagues.rules already has the counts) and fix OFFICIAL_ROLES to include crew_chief — FIBA has no role called 'referee' on a three-person crew.

**Risk.** The sheet is derived from the event log, so the stored hash covers a RENDERING, not the log — record max(game_events.seq) at signing alongside the hash so a later divergence is detectable rather than merely suspected. Make required roles configurable per league defaulting to 'scorer' only, so nothing breaks for existing users.

`epinoia/boxscore.js`, `supabase/functions/finalise-game/index.ts`, `supabase/migrations`

### 67. Season-scope rosters and add a real transfer path

**high** / weeks · `league-ops` · _needs a decision or a quiet window_

**Why.** roster_entries carries season_id and no client path ever writes it; every reader queries active=true with no season filter. So a squad is a rolling list with no notion of who was registered for which season — and export-ui.js builds roster_entries.csv with no season predicate while the archive README presents it as the named season's squads, so a 2024-25 export ships the 2026 squad under a 2024-25 label. 'Remove player' hard-deletes the row, so when a player leaves there is no record he was ever registered. Separately there is no transfer mechanism at all: the CSV importer matches only against this team's roster, and both slug generators append a random suffix so nothing collides — a player moving clubs in January becomes two uuids, two player pages, two sets of season stats, no history, and his suspension stops accruing served games at a club he has left. And roster_write is `for all` on is_team_manager of the RECEIVING club with player_id unconstrained, so a manager can add any player on the platform at 19:20 on match night, with no audit row, no approval and no registration deadline anywhere in the schema.

**What.** Three coupled changes. (1) Write season_id on both inserts via a current_season(p_team) SQL helper; add left_on date and replace the hard delete with active=false, left_on=current_date; add season_id to every reader (team page, scorer roster, data.js, modern box, bcastimg) defaulting to the season being viewed; backfill existing rows and have readers treat a null season_id as 'any season' for one release. Filter export-ui.js by season_id and say so in README.txt. (2) Move the write behind register_player / deregister_player RPCs that refuse when the player already has an active entry at another club in the same league, refuse after a new seasons.registration_closes_on unless the caller is a league admin, and write an audit_log row either way; then reduce roster_write to a narrow position-only UPDATE policy so the team page's inline position editor keeps working. (3) Add transfer_player(p_player, p_from_team, p_to_team, p_on): league-admin authorised, because a transfer is the league's decision not either club's; deactivate the old entry, insert the new with the current season, carry any unexpired suspension's team_id so served keeps accruing, notify both clubs' managers. In the importer, widen the candidate set league-wide and add a fourth verdict, 'transfer', requiring explicit per-row confirmation and never the default for an unattended import.

**Risk.** Adding season_id to readers before the backfill runs shows every roster as empty — the backfill and the client change must ship together, with the null-means-any tolerance for one release. Widening the importer's match set will surface genuine namesakes, which is why the transfer verdict must be explicitly confirmed per row.

`epinoia/app/app.js`, `epinoia/app/roster-csv.js`, `epinoia/app/csv.js`, `epinoia/admin/export-ui.js`, `supabase/migrations`

### 68. Port engine.js to the OBR 2026 foul vocabulary

**high** / days · `scorer` · _needs a decision or a quiet window_

**Why.** engine.js:271 sets a disqualification on `ev.kind === 'disq' || s.t + s.u >= 2`, so two category-2 technicals (delay of game, ring-hang, goaltending the last free throw) disqualify a player who is legally still on court under the 2026 rules. FOUL_MARK prints a 'U' that no longer exists on the sheet and has no DI, no FL, no circle for category-1 and no GD cell. Restart logic keys on 'unsport' only. Epinoia is scoring by the 2020 rulebook, and the leagues it serves will be playing under 2026. A scoring app that disqualifies the wrong player is a scoring app a league stops trusting.

**What.** Migrate the vocabulary while keeping old rows readable. New ev.kind set: personal | offensive | tech1 | tech2 | disrupt | flagrant | disq, with ev.against in (player, head_coach, bench, delegation) and ev.sheet_mark derived (P, C, T, B, BD, DI, FL, D). Write a pure legacy(kind) mapper — tech→tech2, unsport→flagrant — so historic games replay unchanged, and add competitions.rules.ruleset ('obr2020'|'obr2026', default obr2026) so the DQ predicate is selected by data, not by date. Replace the DQ test with: player DQ when count(tech1) >= 2 || count(flagrant) >= 2 || (count(tech1) >= 1 && count(flagrant) >= 1); head coach DQ when two personal category-1s or three across coach/bench/delegation. Team fouls: count personal, either technical category, disrupt, flagrant and disq when ev.pid is set — the existing bench exclusion is already right. Restart: disrupt, flagrant and disq give FTs then a throw-in at the throw-in line; tech1/tech2 to the non-offending team where the ball was. Emit a 'GD' pseudo-event into the log when the threshold trips, so the sheet and the discipline ledger both read it from one place. Ship with a fixture file of the twenty sequences in FIBA Appendix B.8.6 as unit tests.

**Risk.** Every historic game replays through the legacy mapper, so the mapper must be exhaustive and tested before the engine changes — a silent mapping gap re-derives two hundred box scores wrong. Confirm with Louie that his leagues will play OBR 2026 before committing; the ruleset field exists so the answer can be per-competition.

`epinoia/engine.js`, `epinoia/boxscore.js`, `epinoia/score/index.html`

### 69. Derive the discipline ledger from the event log instead of typing it in

**high** / days · `league-ops` · _needs a decision or a quiet window_

**Why.** suspend_player() and lift_suspension() are excellent and entirely manual. A disqualifying foul or a technical recorded in the scorer produces an event row and nothing else: the league secretary has to notice it, remember the rule, and type the suspension in. suspension_served() counts games served correctly once a suspension exists; nothing creates one. This is CRUD over data no rival has, and it is the demo that sells the platform — a technical foul typed at 20:41 putting the player out of Saturday's lineup picker by 20:42.

**What.** Close the loop at finalise-game, which is already the moment the game record becomes authoritative. Add discipline_rules(league_id, trigger check in ('disqualifying_foul','two_technicals','technical_accumulation'), threshold, games default 1, auto boolean default false, note) so each league encodes its own rulebook rather than inheriting an American one. After the box score is computed, evaluate the rules against the event log and write matches to pending_sanctions(game_id, player_id, rule_id, proposed_games, evidence jsonb, state check in ('proposed','confirmed','dismissed') default 'proposed'). Default to PROPOSED, not committed — a disqualification is frequently rescinded on appeal and a platform that auto-bans a player off a mis-tapped button will be switched off within a fortnight. Surface proposals as a badge in governance-ui.js beside the existing suspensions panel; confirming one calls the existing suspend_player() RPC with the evidence jsonb as the reason, so the audit_log entry that function already writes carries the chain. Add player_discipline_tallies refreshed by the same trigger that already calls recompute_standings, and a nightly digest to the secretary through the existing notify function. Ties directly into item 29: a confirmed suspension turns the player red at the next scorer's table automatically, which is the whole point.

**Risk.** Depends on item 68's vocabulary to trigger on the right foul types — with the legacy mapper in place it can ship against either ruleset. Keep 'proposed' as the only default; an auto:true flag should exist in the schema but ship switched off.

`supabase/functions/finalise-game/index.ts`, `epinoia/admin/governance-ui.js`, `supabase/migrations`

### 70. DO NOT BUILD: payments, screening, hardware, betting data, and four broadcast standards

**high** / hours · `league-ops`

**Why.** Recommending everything is the failure mode, and each of these looks adjacent enough to drift into. Player registration checkout is a fight Epinoia cannot win — affiliated English leagues are OBLIGED to take membership through PlayHQ, so a competing checkout is something a league is contractually barred from using. DBS and safeguarding are mandated to PlayHQ with multi-season carry-over; storing that data creates a data-protection liability with no revenue attached. Insurance is bundled into the £23/£35 BE membership. Officials payouts mean owning referee KYC and UK employment-status questions for people paid cash. Facility booking is a mature council-leisure market Epinoia would enter as the worst product in it. Betting data at semi-pro level carries courtsiding and manipulation risk that is uninsurable for one person. Ticketing and PPV make Epinoia a merchant of record with VAT place-of-supply rules. Camera hardware is capex Pixellot already removed. And four broadcast items are premature: an NDI converter (document vMix's Straight/Premultiplied path, OBS's per-source filter and ATEM's PNG-into-media-pool route instead), an OGraf manifest (an EBU standard with no renderer Louie's leagues run), a published Companion module, and the Pixellot Marketplace integration, which needs a partnership before it needs code.

**What.** Write the five no-build lines down where they will be read — a section in docs/campaign-plan.md and a comment block at the top of the relevant module — each naming the integration that replaces it. Registration: read the compliance flag through the PlayHQ adapter and DISPLAY it, never collect or store it. Officials money: ship the printable expense sheet from item 65 and let the treasurer pay by bank transfer, which is what English leagues already do. Ticketing/PPV: integrate a platform that handles VAT and chargebacks and take a referral. Cameras: integrate Pixellot/Veo output as a video source into the existing video tables; do not source hardware. Betting: keep the API key model as attribution-not-monetisation and add a 60s delay on any key flagged commercial. Fill-and-key: write the one-page 'Fill and key' note covering the three paths that already work, and support them with ?still=1 (renders the current scene with animations disabled for a clean transparent capture), ?bg=key (white-on-black silhouette on a second source) and a ?safe=1 debug overlay drawing the 90%/80% safe boxes — every graphic here is currently authored blind to safe areas. Also skip FIBA software approval: the programme has no electronic-scoresheet category, costs CHF 1,000 to open a file, and requires paid testing at an accredited institute.

**Risk.** The risk is not building these — it is the slow drift into them one plausible feature request at a time, which for a solo dev is how a year disappears. The ?still=1 / ?bg=key / ?safe=1 parameters are the only code here and they are each a handful of lines.

`docs/campaign-plan.md`, `epinoia/broadcast/broadcast.js`, `epinoia/broadcast/help/index.html`

