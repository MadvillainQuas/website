# Notifications v2 — tip-off reminders, lineups, results and statlines, on the phone

Written 2026-09-17. The contract for migrations `0121_notifications_v2.sql`,
`0124_notify_halftime.sql` and `0125_push_delivery_status.sql`, the `notify` Edge
Function, `epinoia/sw.js`, `epinoia/push.js`, `epinoia/follow.js`, the profile page
and the game page's `show=starters` link. Inspiration: FotMob —
a notification says exactly what happened and when, one tap lands on the thing it
talks about, and the phone is the channel that matters.

The v1 system (0106/0107) stays underneath: `notifications` rows written by
fan-outs, read by the bell, delivered beyond the bell by `notify`. v2 changes what
is written, when, and how it reaches a phone.

---

## 1. What a fan gets

A fan **follows** clubs (`fav_team_ids`), players (`fav_player_ids`) and single
games (`fav_game_ids`). For each game:

| when | who | kind / ref | title | body |
|---|---|---|---|---|
| **2 days before** tip-off (written in the window 44–48 h before) | follows either club or the game | `fixture` / `<game>:2d` | `Reading Rockets v London Lions` | `In 2 days · Sat 19 Sep, 19:30 · Archers Arena` |
| same | follows a player in either squad, but neither club nor the game | same | `Ben Baker has a game in 2 days` (`Ben Baker and Yusef Salih have a game in 2 days`) | `Reading Rockets v London Lions · Sat 19 Sep, 19:30` |
| **within 2 hours** of tip-off (written once the game is 2 h or less away and still scheduled) | club / game followers | `fixture` / `<game>:2h` | `Reading Rockets v London Lions` | `In 2 hours · tip-off 19:30 · Archers Arena` (`In 1 hour`, `In 35 minutes` when written later) |
| same | player-only followers | same | `Ben Baker plays in 2 hours` (`… in 35 minutes`) | `Reading Rockets v London Lions · tip-off 19:30` |
| **starting lineups confirmed** (both fives, ≥5 each, in `games.starters`) | club / game followers | `lineups` / `<game>:lineups` | `Lineups are in: Rockets v Lions` | `Rockets: Baker, Salih, Cole, Diaz, Eze` ⏎ `Lions: …` (surnames) |
| same | player-only followers | same | `Ben Baker starts for Reading Rockets` / `Ben Baker is on the bench for Reading Rockets` | `Reading Rockets v London Lions · tip-off 19:30` (other followed players appended) |
| **half-time** (0124: the second quarter over, the third not started, no play written for a minute) | club / game followers | `halftime` / `<game>:ht` | `HT · Reading Rockets 48–45 London Lions` | the first-half lines of any followed players who have played, then `Top scorers: Baker 14, Salih 12` (home first) |
| same | follows a player who has played in the first half (not a club / game follower) | same | `Ben Baker at half-time: 12 PTS · 3 REB · 2 AST` | `Reading Rockets 48–45 London Lions · HT · 5/9 FG · 14 MIN` (other followed players' lines appended) |
| **full time** | club / game followers | `result` / `<game>` | `FT · Reading Rockets 96–95 London Lions` | competition name |
| same | follows a player who played (a `player_game_stats` row) | `player` / `<game>:<player>` | `Ben Baker: 23 PTS · 6 REB · 5 AST` | `Reading Rockets 96–95 London Lions · FT · 8/20 FG · 32 MIN` |

Rules:

- **One notice per fan per game per moment.** A fan who follows the club and a
  player in it gets the club notice only (same `ref`). Player-only notices group
  every followed player in that game into one row.
- **Result and statline are separate** (FotMob sends both): a club follower who
  also follows a player gets the score and the statline.
- **Half-time is one notice** per fan: a club follower's carries their players'
  lines. On the phone it sits in the slot full time takes over (§4), so the result
  replaces it rather than stacking under it.
- **When it is half-time** (0124): the game is live, its league shows live games in
  public (`public_live`), its state is not running and reads period 2 at 0:00 (or a
  full clock in period 2 or 3), the log has second-quarter play with time off the
  clock and no third-quarter play, the state was written in the last 30 minutes, and
  no play has been written for a minute (free throws at the buzzer count). The
  first-half line is replayed from `game_events` in the engine's terms
  (`notif_first_half`).
- **Minors are never named** unless publication consent is recorded
  (`player_withheld(is_minor, public_consent)`): a withheld player is not a
  trigger for player-only notices, and appears in a lineup body as `#12`.
- **Members-only leagues** keep 0118's rule: a fan who cannot view the league is
  not told its results, lineups or statlines; fixture reminders follow
  `access_fixtures_public` as in 0118.
- **Every kind has a switch** (§2); `want_fixtures`, `want_results`,
  `want_players`, `want_announcements` keep their meaning as the master switches.
- The **link** of a fixture or result opens the game page; a lineups link is
  `game/?g=<id>&mode=supabase&show=starters`, which opens the page on the starting
  fives (§6); a statline link adds `&vp=<player>`.

## 2. Preferences (`fan_prefs`, added in 0121)

| column | default | governs |
|---|---|---|
| `want_fixture_2d` | true | the 2-day reminder (under `want_fixtures`) |
| `want_fixture_2h` | true | the 2-hour reminder (under `want_fixtures`) |
| `want_lineups` | true | lineups notices |
| `want_player_games` | true | player-only fixture and lineup notices (club not followed) |
| `want_halftime` | true | the half-time notice, both audiences (0124) |

Existing: `want_fixtures`, `want_results`, `want_players` (statlines),
`want_announcements`, channels `notify_inapp`, `notify_email`, `notify_push`.
`set_fan_prefs(p jsonb)` accepts the new keys (latest definition 0124, extended —
same null-means-keep behaviour). At half-time `want_results` still decides who counts
as a club follower, and `want_players` whether player lines are sent at all.

## 3. Database (`0121_notifications_v2.sql`)

- `notifications` gains `data jsonb not null default '{}'`, `expires_at timestamptz`
  (a push is not sent after it; the bell still shows the row) and
  `urgency text not null default 'normal' check (urgency in ('very-low','low','normal','high'))`.
  The kind check adds `lineups` (keeping every existing kind, including 0120's
  `highlights` and `privacy`). A partial index on undelivered rows
  (`pushed_at is null`) serves the delivery query.
- `data` carries what a phone or page needs beyond title/body:
  `{game, home, away, tipoff, window: '2d'|'2h', starters: [[{id,name,num}],[…]], players: [{id,name,role:'starter'|'bench'}], score: [h,a], statline: {pts,reb,ast,…}}`
  — only the keys relevant to the kind.
- Helpers (immutable/stable, `set search_path = public`):
  `notif_when(timestamptz) → 'Sat 19 Sep, 19:30'` (Europe/London),
  `notif_until(timestamptz) → 'In 2 hours' | 'In 1 hour' | 'In 35 minutes'`,
  `notif_statline(jsonb) → '23 PTS · 6 REB · 5 AST'` plus
  `notif_statline_more(jsonb) → '8/20 FG · 32 MIN'` (FG from p2m+p3m / p2a+p3a,
  minutes from `min` in ms; STL/BLK appended to the first when non-zero).
- Fan-outs (security definer, owner postgres, revoked from browser roles):
  - `notify_fixture_windows() → int` — both windows, both audiences.
  - `notify_fixtures() → int` — kept for the ingest runner, now just calls
    `notify_fixture_windows()` (the old `:soon`/`:today` refs are retired).
  - `notify_lineups(p_game uuid default null) → int` — games with both fives
    confirmed, status `scheduled` or `live`, tip-off from 30 min ago to 6 h ahead.
  - `notify_game_final(p_game uuid) → int` — redefined from 0118 with the v2
    titles, `data`, `urgency high`, `expires_at now()+24h`, members-only rule kept.
- **Lineups trigger:** `after update of starters on games` → `notify_lineups(new.id)`
  when both fives are complete. It **never blocks the write**: any error is caught
  and ignored (the minute tick sweeps again).
- **The minute tick:** `notify_tick() → jsonb` runs `notify_fixture_windows()` and
  `notify_lineups()`, counts undelivered push rows, and when there are any calls the
  `notify` function with `pg_net` (`net.http_post`, the project URL, the publishable
  key — both already public in `epinoia/config.js`). It records the run in
  `notify_ticks` (one row). Scheduled with `pg_cron` as `epinoia-notify-tick`,
  `* * * * *`. Extensions are created only if available; without them the functions
  still install (the PGlite harness), and `notify_health()` says so.
- **Half-time (0124):** `notify_halftime(p_game uuid default null) → int` (definer,
  closed to browsers) writes §1's half-time notices for every live game at half-time,
  or the one given; `notif_first_half(p_game) → table(player_id, team_idx, played, stats)`
  replays the first half from `game_events` (points, rebounds by `payload.off`,
  assists, steals, blocks, turnovers, and minutes from the starting fives and the
  substitutions in game order, as `engine.js` does), keyed like `player_game_stats`;
  `notif_statline_data(jsonb)` is the `data.statline` shape. Urgency high, expiring
  20 minutes after it is written. `data`: `{game, home, away, tipoff, period: 2,
  score, leaders: [{id,name,side,pts}], audience: 'club'|'player', players: [{id,name,statline}]}`.
  `notify_tick()` sweeps it every minute, between the lineups and the count, and
  reports `halftime` in its result.
- **What each phone's push service last said (0125):** `push_subscriptions` gains
  `last_push_at`, `last_push_status` (the HTTP status: 2xx accepted, 401/403 a key
  mismatch, 404/410 expired and removed, 429/5xx later, 0 the server failed first)
  and `last_push_error`, written by every push; the phone's owner reads them through
  0106's `push_own`.
- `notify_health() → jsonb` (anon): `{cron: bool, net: bool, last_tick, last_called}`
  — no personal data; lets a deploy be checked from outside.
- `swap_push_subscription(p_old text, p_endpoint text, p_p256dh text, p_auth text) → boolean`
  (anon, authenticated): the service worker's `pushsubscriptionchange` handler
  replaces a rotated subscription. Knowing the old endpoint (an unguessable URL) is
  the credential; it updates only that row.

## 4. Delivery (`notify` Edge Function)

- `verify_jwt = false` (config.toml): the database tick cannot hold a user token.
  Callers: the tick (no bearer), the ingest worker, finalise-game, signed-in fans.
  **An anonymous call only delivers rows already waiting to their owners** — exactly
  what any signed-in fan could already trigger — and runs at most every 15 s per
  instance. `{test: true}` with a signed-in token sends a test push to that fan's
  own subscriptions immediately.
- Push payload: `{title, body, url, tag, renotify, kind, timestamp, actions}`:
  - `tag` groups a game's notices on the lock screen and replaces the older one:
    `fixture:<game>` (the 2 h reminder replaces the 2 d one), `lineups:<game>`,
    `result:<game>`, `player:<game>:<player>`; half-time takes the slot of what
    supersedes it — `result:<game>` for a club follower, the first player's
    `player:<game>:<player>` for a player follower (`data.audience`); other kinds
    `kind:<id>`.
  - Web Push `urgency` from the row; `TTL` = seconds to `expires_at` (60 s minimum,
    24 h maximum, 6 h when there is no expiry); `topic` (a short hash of the tag) so
    a phone that was offline receives only the newest notice for that tag.
  - `actions`: lineups `[{action:'starters', title:'See lineups'}]`, result and
    half-time `[{action:'box', title:'Box score'}]`.
- A row past `expires_at` is stamped and not pushed. Everything else as v1: stamped
  as it goes, dead subscriptions (404/410) removed, email batches unchanged. Every
  push's answer is recorded on its subscription (0125).
- `{test: true, endpoint}` answers per device: `devices: [{service, status, ok,
  thisPhone, text, fix}]`, and whether the asking phone is on the account.
- `{check: {endpoint, keys}}` (anyone) and `{diag: true}` (anyone) are §7's.

## 5. The phone (`epinoia/sw.js`, `epinoia/push.js`, `epinoia/follow.js`, `epinoia/me/`)

- `sw.js`: shows the payload (`body`, `icon`, `badge`, `tag`, `renotify`,
  `timestamp`, `vibrate`, `actions`, `data.url`); a tap or an action opens or
  focuses the site at the right URL (a focused tab navigates; otherwise a new
  window); `pushsubscriptionchange` re-subscribes and calls
  `swap_push_subscription`.
- `push.js` (`window.EpinoiaPush`), one module every page can lazy-load:
  `state() → 'unsupported'|'ios-install'|'denied'|'off'|'on'`,
  `enable()` (must run inside a tap: permission → service worker → subscription →
  `push_subscriptions` upsert → `set_fan_prefs {notify_push: true}`), `disable()`,
  `test()`, and `offer({name})` — the FotMob-style sheet after following something:
  *"Get notified about Reading Rockets? Tip-off reminders 2 days and 2 hours before,
  starting lineups, the half-time score and the result, on this phone."* **Turn on** / **Not now**
  (not asked again for 14 days). On iOS outside the Home Screen app it explains how
  to add Epinoia to the Home Screen, because iOS only delivers web push to installed
  apps.
- `follow.js`: after a successful follow, `EpinoiaPush.offer(...)` unless push is
  already on or permission was denied.
- Profile page, Notifications section: this device's state with **Turn on
  notifications** / **Send a test** / **Turn off** / **Check this phone** (§7), the
  channels, and one switch per §1 moment.
- `sw.js` also tells every open Epinoia page when a push arrives
  (`{type: 'epinoia-push', kind, tag, shown, error, at, version}`) and answers a ping
  (`{type: 'epinoia-ping'}` on a MessageChannel port) with its version.

## 6. The lineups link

`game/?g=<id>&show=starters`: on a scheduled game the preview already renders a
"Starting five" section once both fives are confirmed — it gets `id="starters"` and
the page scrolls to it and highlights it. On a game already live or final, the page
draws the same section (exported as `EpinoiaPreview.startersHTML(ctx)`) above the
tabs, with a close button.

## 7. Checking a phone that gets nothing

A notification can stop in six places, and from the outside they all look the same:
nothing arrives. **Check this phone** on the profile page (`EpinoiaPush.check()`)
walks them in the order a notification travels, puts right what needs no decision,
and says what the person has to change for the rest:

| step | fails when | put right by the check | otherwise |
|---|---|---|---|
| browser | no Push API (an in-app browser; iPhone outside the Home Screen) | — | where to open Epinoia instead |
| permission | never allowed, or blocked | — (asking needs the Turn on tap) | the settings path for this platform |
| worker | the service worker is not running | registers it | reload |
| subscription | none, or made with an old VAPID key | subscribes again | allow notifications |
| account | the phone is not in `push_subscriptions` under this account; `notify_push` off | saves it | tick Phone and desktop alerts |
| delivery | the push service refuses a test (`{check}`) | 404/410/401/403: subscribes again and re-tests | the push service's reason |
| arrival | the worker never reports the test (20 s), or reports it could not show it | — | the phone's background and notification settings |

The settings it names depend on where it runs: the installed Android app (App info →
Notifications), Chrome in a tab (Site settings → Notifications, and Chrome's own
Android notification switch), Samsung Internet, an iPhone Home Screen app (Settings →
Notifications → Epinoia), or a computer. When every step passes and the fan still saw
nothing, the phone is hiding notifications, and the check says which switches to
look at.

`notify {check: {endpoint, keys}}` sends one test push to the subscription the
caller holds and returns `{ok, status, service, text, fix, detail, saved}`. It is
anonymous, so it answers even when saving to the account is what failed; it accepts
only endpoints of known push services (Google, Apple, Mozilla, Microsoft —
`_shared/pushcheck.js serviceOf`), so it cannot be pointed at any other URL, and it is
throttled (one per endpoint per 5 s, 30 a minute per instance).

`notify {diag: true}` checks the server without a phone: that the VAPID private key
signs for the public key browsers subscribe with, that this runtime's `web-push`
encrypts a message a browser can read (decrypted with RFC 8291, verified against the
RFC's own example in `pushpayload.test.mjs`), and that a push service answers. It
also counts registered phones by push service, and accepted and refused pushes in
the last day. No personal data.
