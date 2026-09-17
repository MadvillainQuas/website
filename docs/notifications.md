# Notifications v2 — tip-off reminders, lineups, results and statlines, on the phone

Written 2026-09-17. The contract for migration `0121_notifications_v2.sql`, the
`notify` Edge Function, `epinoia/sw.js`, `epinoia/push.js`, `epinoia/follow.js`,
the profile page and the game page's `show=starters` link. Inspiration: FotMob —
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
| **full time** | club / game followers | `result` / `<game>` | `FT · Reading Rockets 96–95 London Lions` | competition name |
| same | follows a player who played (a `player_game_stats` row) | `player` / `<game>:<player>` | `Ben Baker: 23 PTS · 6 REB · 5 AST` | `Reading Rockets 96–95 London Lions · FT · 8/20 FG · 32 MIN` |

Rules:

- **One notice per fan per game per moment.** A fan who follows the club and a
  player in it gets the club notice only (same `ref`). Player-only notices group
  every followed player in that game into one row.
- **Result and statline are separate** (FotMob sends both): a club follower who
  also follows a player gets the score and the statline.
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

Existing: `want_fixtures`, `want_results`, `want_players` (statlines),
`want_announcements`, channels `notify_inapp`, `notify_email`, `notify_push`.
`set_fan_prefs(p jsonb)` accepts the four new keys (latest definition 0107,
extended — same null-means-keep behaviour).

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
    `result:<game>`, `player:<game>:<player>`; other kinds `kind:<id>`.
  - Web Push `urgency` from the row; `TTL` = seconds to `expires_at` (60 s minimum,
    24 h maximum, 6 h when there is no expiry); `topic` (a short hash of the tag) so
    a phone that was offline receives only the newest notice for that tag.
  - `actions`: lineups `[{action:'starters', title:'See lineups'}]`, result
    `[{action:'box', title:'Box score'}]`.
- A row past `expires_at` is stamped and not pushed. Everything else as v1: stamped
  as it goes, dead subscriptions (404/410) removed, email batches unchanged.

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
  starting lineups and full-time results, on this phone."* **Turn on** / **Not now**
  (not asked again for 14 days). On iOS outside the Home Screen app it explains how
  to add Epinoia to the Home Screen, because iOS only delivers web push to installed
  apps.
- `follow.js`: after a successful follow, `EpinoiaPush.offer(...)` unless push is
  already on or permission was denied.
- Profile page, Notifications section: this device's state with **Turn on
  notifications** / **Send a test** / **Turn off**, the channels, and one switch per
  §1 moment.

## 6. The lineups link

`game/?g=<id>&show=starters`: on a scheduled game the preview already renders a
"Starting five" section once both fives are confirmed — it gets `id="starters"` and
the page scrolls to it and highlights it. On a game already live or final, the page
draws the same section (exported as `EpinoiaPreview.startersHTML(ctx)`) above the
tabs, with a close button.
