# Notification buttons on a league's own website

Written 2026-09-17. The contract for migration `0127_notify_embed.sql`, the `notify`
Edge Function's device delivery, `epinoia/embed/notify/` (the button, its window
and the service worker a site can host), `embed.js`'s `notify` kind, the embed
gallery and the console. It extends `docs/notifications.md`; everything there
still holds for Epinoia accounts.

A league that runs its own website and uses Epinoia behind it (fixtures, scoring,
stats) can put a **notification button** on any page of that site, and its
visitors get Epinoia's notifications for exactly what the button names, without
an Epinoia account.

---

## 1. The button

```html
<!-- a club page: that club only -->
<script src="https://prophesyscouting.co.uk/epinoia/embed.js"
        data-epinoia="notify" data-league="slb-men" data-team="london-lions"></script>

<!-- a player page: that player only -->
<script src=".../embed.js" data-epinoia="notify" data-league="slb-men" data-player="ben-baker"></script>

<!-- a match page: that game only -->
<script src=".../embed.js" data-epinoia="notify" data-league="slb-men" data-game="<game uuid>"></script>

<!-- anywhere: the visitor picks from the league's clubs -->
<script src=".../embed.js" data-epinoia="notify" data-league="slb-men"></script>
```

| attribute | meaning |
|---|---|
| `data-league` | the league's slug (required) |
| `data-team` / `data-player` | a slug or an id; the button follows that one club / player |
| `data-game` | a game id |
| `data-label` | the button's words (default "Get notifications" / "Following") |
| `data-theme` | `dark` (default) or `light`; `data-accent` a `#rrggbb` colour |
| `data-into` | a CSS selector to put the button into (default: right after the script) |
| `data-sw` | the path of the service worker file on the site (§3); without it, §2 |

The button is drawn into the page itself (a closed shadow root, so neither the
site's CSS nor ours leaks), not an iframe: browsers refuse to ask for notification
permission from a frame on another site.

A button for one thing does one thing: a club page's button follows that club and
nothing else. Visitors choose which moments they get (§4) in the window.

## 2. Through Epinoia (the default: no setup)

The button opens a small window at
`/epinoia/embed/notify/?l=<league>&team=|player=|game=<id>&from=<site origin>`.
There the visitor allows notifications for prophesyscouting.co.uk, the subscription
is saved as a **device** (§5) following that one thing, and the window says so and
can be closed. It tells the button (`postMessage`, checked against both origins),
which then reads "Following". The site remembers that hint in its own
`localStorage` under `epinoia-notify:<league>:<kind>:<id>`, and nothing else.

Notifications come from prophesyscouting.co.uk. A tap opens the league's own page
when the league has given a link pattern (§6), otherwise Epinoia's.

This works on any website, including ones that cannot host files (Wix,
Squarespace). On an iPhone, web notifications need an app on the Home Screen, so
the window says how to add Epinoia there instead.

## 3. On the league's own domain (optional)

The league uploads one file to its site's root, `/epinoia-sw.js`:

```js
importScripts('https://prophesyscouting.co.uk/epinoia/embed/notify/sw.js');
```

adds its site's address in the console (§7), and puts `data-sw="/epinoia-sw.js"` on
its buttons. The button then asks for permission on the site itself, registers
that file with the scope `/epinoia-push/` (a path the site does not use, so an
existing service worker of the site's is left alone), and saves the subscription
as a device. Notifications come from the league's own site, with the league's
crest. If the file is missing or registration fails, the button falls back to §2.

## 4. What a device is told

Exactly what an Epinoia account following the same thing is told
(docs/notifications.md §1): the reminders 2 days and 2 hours before, lineups,
half-time, full time, player lines, and, for a device following a club, the
league's announcements. The same rules apply: one notice per device per game per
moment, minors never named, and a device following a club and a player in it gets
the club's notice.

**Members-only leagues** (0118): a device has no membership, so while memberships
are switched on a members-only league tells devices nothing but public fixtures.

Moment switches per device, all on by default: `want_fixture_2d`,
`want_fixture_2h`, `want_lineups`, `want_halftime`, `want_results`, `want_players`
(player lines), `want_announcements`.

## 5. Database (`0127_notify_embed.sql`)

- `push_devices`: one row per browser subscription (`endpoint` unique, `p256dh`,
  `auth`), `origin` (the site that saved it), follows (`fav_team_ids`,
  `fav_player_ids`, `fav_game_ids`), the switches above, `created_at`,
  `updated_at`, and 0125's `last_push_*`. RLS on, no policy: only the functions
  below touch it.
- `notifications.user_id` becomes nullable and gains `device_id` (on delete
  cascade), exactly one of the two set; `(device_id, kind, ref)` is unique. The
  bell's policy is by `user_id`, so a device's rows are never anybody's bell.
- `notify_audience`: a view, the accounts (`fan_prefs`) and the devices
  (`push_devices`) with the same columns plus `user_id`, `device_id` and `sub` (the
  one that is set). Every fan-out (`notify_fixture_windows`, `notify_lineups`,
  `notify_halftime`, `notify_game_final`, `post_announcement`) writes from it,
  so the two audiences cannot drift apart.
- `notify_embeds` (per league): `sites text[]` (origins allowed to save devices
  from their own domain, §3), `game_url` (a link pattern with `{game}` or
  `{external}`), `home_url`. League admins read and write their own row.
- Functions callable signed out (security definer, owner postgres):
  - `notify_device_get(p_endpoint, p_auth) → jsonb`: what the device follows and its
    switches, or null. The subscription's `auth` secret is the credential: only the
    browser holding the subscription knows it.
  - `notify_device_follow(p_league, p_endpoint, p_p256dh, p_auth, p_add, p_remove, p_prefs) → jsonb`:
    creates or updates the device, adds or removes a team, player or game of that
    league (validated: it exists and belongs to the league), and sets switches.
    The request's `Origin` must be Epinoia's or one of the league's `sites`. At
    most 50 clubs, 100 players and 50 games per device, and 60 calls in 10 minutes
    from one network address.
  - `notify_device_forget(p_endpoint, p_auth) → boolean`: deletes the device and its
    rows.
  - `notify_device_test(p_endpoint, p_auth) → boolean`: writes one `test`
    notification for the device (at most one a minute), delivered the way every
    other one is, so "Send a test" proves the whole path, links included.
  - `notify_embed_public(p_league) → jsonb`: the league's name, crest and whether
    the calling origin may save devices from its own domain.
- `swap_push_subscription` (0121) also moves a device whose subscription the
  browser rotated. `notify_tick` counts a device's waiting rows as waiting for a
  phone, and removes device rows older than 7 days.

## 6. Delivery (`notify`)

A device's waiting rows are pushed to its subscription like an account's. The link
is absolute:
- a game notice: the league's `game_url` with `{game}` (the Epinoia game id) or
  `{external}` (the feed's game id; when the game has none, Epinoia's page is used
  instead), else `<SITE_URL>game/?g=<id>&mode=supabase`;
- an announcement: `home_url`, else Epinoia's league page;
- a test: `home_url`, else Epinoia's front page.
The payload also carries `icon`: the league's crest when it has one. What the push
service answers is recorded on the device, and a 404/410 removes it.

## 7. The console and the gallery

- The embed gallery (`/epinoia/embed/`) gains **Notification button**: pick a
  league, then a club, a player, a game or "the visitor picks", and copy the snippet.
- The console's Embeds section gains **Notification buttons**: the same snippet
  maker for the admin's league, the league's `sites`, the `/epinoia-sw.js` file to
  upload, `game_url` / `home_url`, and how many devices follow the league.

## 8. Privacy

A device stores a push address and what it follows, and no name or email.
Turning notifications off in the window, or on the site's button, deletes the
device. So does a push address the push service says is gone. The privacy page
says this.
