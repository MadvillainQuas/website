# Notifications v2 — tip-off reminders, lineups, results and statlines, on the phone

Written 2026-09-17. The contract for migrations `0121_notifications_v2.sql`,
`0124_notify_halftime.sql`, `0125_push_delivery_status.sql`, `0128_push_client.sql` and `0130_push_apns.sql` (the iPhone app, §8), the `notify` Edge
Function, `epinoia/sw.js`, `epinoia/push.js`, `epinoia/follow.js`, the profile page
and the game page's `show=starters` link. Inspiration: FotMob —
a notification says exactly what happened and when, one tap lands on the thing it
talks about, and the phone is the channel that matters.

The v1 system (0106/0107) stays underneath: `notifications` rows written by
fan-outs, read by the bell, delivered beyond the bell by `notify`. v2 changes what
is written, when, and how it reaches a phone.

**Notification buttons on a league's own website** (no Epinoia account; the browser's
subscription is the subscriber) are `docs/notify-embed.md`, migration 0127. Every
fan-out below writes to those devices from the same statements as to accounts.

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
  thisPhone, text, fix}]`, and whether the asking phone is on the account. With
  `delay: n` it first waits `min(n, 10)` seconds (signed-in callers only), so the test
  can arrive on a locked phone (§5, the Android app), and adds `delayed: <seconds>` to
  the answer.
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
- `sw.js`'s **badge** is `brand/epinoia-badge-96.png`, the Λ in white on a transparent
  ground: Android draws a badge from its alpha channel alone, and the old 32px colour
  mark showed as a blank white square. Its **fetch handler** answers only page loads
  (`request.mode === 'navigate'`) that fail for want of a connection, with a small
  offline page at status 200; every other request is left to the browser, so a Supabase
  read that fails offline is a real network error, not a 503 HTML page.

### The Android app

The Epinoia Android app (`android/`, roadmap Phase 6) is a Trusted Web Activity forced
onto Chrome. Delivery is unchanged: the same Web Push subscription, `notify`, tags,
receipts and check. What changes is **who posts the notification**.

- **Delegation.** Chrome receives the push and, because the app declares a
  `DelegationService`, hands the notification to the app instead of posting it itself.
  `EpinoiaDelegationService` re-posts it on the app's own channel, `epinoia_alerts`
  (**Game alerts**, `IMPORTANCE_HIGH`, vibration, public on the lock screen). androidx's
  own copy would go onto a channel at `IMPORTANCE_DEFAULT`, which sounds but never pops
  up. So in the app, Settings → Apps → Epinoia → Notifications governs every
  notification, not Chrome's or Samsung Internet's site settings.
- **Launch state, trusted over JavaScript.** On a phone, `Notification.permission` can
  read `granted` while Android blocks the app (android-browser-helper #563, One UI 8).
  So every launch URL carries the native answer:
  `/epinoia/home/?source=twa&shell=<versionCode>&notif=<0|1>&chan=<importance>`, where
  `notif` is `areNotificationsEnabled()` and `chan` is Game alerts' importance (4 HIGH and
  5 MAX pop up, 3 sounds only, 1–2 silent, 0 off, -1 not created). `appmode.js` keeps it in
  sessionStorage `epinoia_shell` (`{shell, notif, chan, at}`) for the rest of the session.
  It is true **as of this launch**: a change made in Android settings shows after the app
  is closed and opened again. Two things make it stale sooner. When `enable()` gets a
  permission that was not granted before the tap, it came from Android's own dialog, so
  `enable()` writes `notif: 1` and a new `at` back into `epinoia_shell`. And a tap on
  **Open notification settings** stores sessionStorage `epinoia_settings_opened`
  (`EpinoiaPush.settingsOpened()`); a report whose `at` is older than that is no longer
  believed (Back from the settings screen returns to the same session).
- **The profile card in the app** says so when the launch report has Android blocking
  pop-ups (`EpinoiaPush.appBlocked()`), even while the page's own state reads On.
- **`push.js` in the app.** `inApp()` is true when `epinoia_shell` is in this session or
  the page was launched with `?source=twa`, on Android, and never in Samsung Internet
  (whose installed web app still posts through Samsung Internet). `platform()` is then
  `android-twa`, and `help()` returns its steps: Game alerts on Alert with pop-up and the
  lock screen; One UI's Notification pop-up style on Detailed; the Epinoia and Chrome
  batteries Unrestricted and neither in Sleeping or Deep sleeping apps; Do Not Disturb.
  `help()` also returns `action: {label: 'Open notification settings', href}`, and
  `settingsIntent` is that href:
  `intent://notification-settings#Intent;scheme=epinoia;package=uk.co.prophesyscouting.epinoia;end`,
  which opens the app's native `NotificationSettingsActivity` (channel importance, Do
  Not Disturb, background restriction, with buttons into Android settings). The follow
  sheet's "Your phone is hiding it" and the profile page's draw that button in the app.
- **The native settings screen** only opens from a tap, and only inside the app (the
  package must be installed); a browser tab never shows the button.
- **The delayed test.** `test({delay: 10})` sends `{test: true, endpoint, delay: 10}`, and
  `notify` waits `min(delay, 10)` seconds before sending (after checking the caller is
  signed in; the answer is `sendTest`'s plus `delayed: <seconds>`). The profile page shows
  **Test with the phone locked** in the app: the fan locks the phone, and a heads-up on
  the lock screen is the proof that Game alerts pops up. A `notify` deployed before this
  ignores `delay`, sends at once and answers without `delayed`; `test()` then returns
  `{ok: false, notDelayed: true}` saying the test could not wait, and the page does not
  ask whether it popped up.
- **Which client saved a subscription (0128).** `push_subscriptions.client` is `tab`,
  `pwa` (an installed web app, iPhone Home Screen included), `twa` (the Android app) or
  `samsung-app` (Samsung Internet's installed web app); null on rows saved before 0128.
  `push.js` writes it on every save and, while the column does not exist yet, sends the
  row again without it when PostgREST answers 400.
- **Two of every notification.** A fan who used the Samsung Internet web app before
  installing the app keeps that subscription, and `notify` pushes to all of an account's
  subscriptions; both endpoints are Google's, so nothing else tells them apart. In the
  app, with this phone on, the profile page lists the account's `samsung-app` rows, any
  row from Samsung Internet on the same push service whatever its client, and rows with
  no client from an Android phone on the same push service (never another `twa` row), and
  **Turn off the others** deletes them (the fan's own rows, through 0106's `push_own`).
  Deleting a row does not unsubscribe Samsung Internet, so its profile page, once the
  account has a `twa` row, no longer saves itself again (`sync()`) and instead offers
  **Turn off notifications here**, which unsubscribes that browser. Before 0128 the
  `client` read fails and it syncs as before.
- The profile page also carries **Delete my account**, a link to
  `privacy/#delete` (Google Play's account-deletion rule), for every signed-in fan.

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

**In the Android app** (`android-twa`, §5) the permission step is decided by what
Android told the launcher, not by `Notification.permission`:

| launch said | permission step | advice |
|---|---|---|
| `notif=0` | fails: "Notifications are turned off for the Epinoia app (as of this launch)" | allow them, then close and reopen the app |
| `notif=1`, `chan` 0–3 | fails: Game alerts switched off, Silent, or set not to pop up | set Game alerts to pop up, then reopen |
| `notif=1`, `chan=-1` | fails: Game alerts is not set up yet | reopen the app |
| `notif=1`, `chan` ≥ 4 | passes, whatever the page's permission reads | the check goes on |
| anything, but the settings screen was opened since | neither: "Your notification settings may have changed since Epinoia opened" | the check goes on; the live test decides |
| neither (a page not opened by the launcher) | the page's permission, as elsewhere | the app's settings |

The page's own permission is shown in the step's detail, for information only. In the
app every piece of advice carries `action` (**Open notification settings**), which the
profile page draws as a button, and a failed permission step always ends with the
prompt to close and reopen the app, because the answer is only refreshed on a launch.
The arrival step's advice names the app's steps, Chrome's battery included: Chrome
receives each push before the app shows it. **Test with the phone locked** (§5) is the
last proof: a check reports a push as shown once the app has posted it, and only a
heads-up on a locked phone shows that the channel pops up.

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

---

## 8. The iPhone app (`ios/`, `0130_push_apns.sql`, `_shared/apns.js`)

Inside an app, a web page (WKWebView) gets no Web Push, so the EPINOIΛ iPhone app registers with
Apple Push Notification service itself. It hands the page what it knows through
`window.EpinoiaNative`, which it defines before any page script runs and only on this origin
(the full contract is in `ios/README.md`). `push.js` takes that path first in every function
(its section "the iPhone app"), and nothing changes anywhere else:

- **The phone's row** is the same `push_subscriptions` row, with the endpoint
  `apns:production:<hex token>` (`apns:sandbox:` for a development build), no Web Push keys and
  `client = 'ios'`. 0130 lets `p256dh`/`auth` be null on such a row only, and checks its shape.
- **On** means iOS allows notifications *and* this page turned them on (localStorage
  `epinoia_ios_push`), because an iPhone keeps its token: turning off deletes the row and forgets
  the endpoint.
- **A phone that changes account** keeps its token, so the new account calls
  `push_claim_device(endpoint)` (0130) after RLS refuses the upsert: it removes other accounts'
  rows for exactly that address, then saves.
- **Delivery.** `notify`'s `push()` sends an `apns:` row through `sendApns`. It is the same
  payload (`payloadFor`), turned into APNs terms:
  - title and body in `aps.alert`, `url`/`tag`/`kind` beside it
  - `apns-collapse-id` = the web's topic, so a lineups alert replaces the reminder
  - priority 10 unless urgency is low
  - expiration from the TTL

  Apple's `Unregistered`, `BadDeviceToken` and `DeviceTokenNotForTopic` come back as 410, so the
  row is dropped where a dead browser subscription is.
- **The provider token** is ES256, signed with the `.p8` key (`APNS_KEY_ID`, `APNS_TEAM_ID`,
  `APNS_KEY_P8`, optional `APNS_TOPIC`). Its `iat` is rounded to the half hour, because Apple
  refuses a token refreshed more often than every 20 minutes or older than an hour.
- **Receipts.** The app reports a notification shown while it is open (`epinoia-native` event,
  `{type: 'push', tag, shown}`), which is what `test()` and `check()` wait for.
- **Settings.** `settingsIntent`, and the check's action, are `epinoia://notification-settings`,
  which the app turns into iOS's notification settings for EPINOIΛ.
- **The self-check.** `notify {diag: true}` also reports `apns`: a push to a made-up token is
  refused `BadDeviceToken` when Apple accepts the key, `403` when it does not.

Owner setup (the APNs key, the secrets) is `docs/ios-app.md` step 4.
