# EPINOIA HOME, the global pages and the Android app — roadmap

Written 2026-09-17 and revised the same day after a review pass. **Status: Phases 0 to 7 are built
(branch release-home-app). Phase 8 (Play Store) is not started. What remains is the owner's: the
`notify` redeploy and migration 0128 (6.8), the Magic Link template with `{{ .Token }}` and then
`emailOtp: true` in `epinoia/config.js` (6.1), the signing key and GitHub secrets with the
`assetlinks.json` fingerprint (6.2–6.4), the first signed release and then `"released": true` in
`epinoia/android/version.json` (6.5), and the Phase 7 on-device gate (6.6).** Until those are done
the site behaves as it did before the app: Android browsers are offered the web app, and email
sign-in inside an app says the link signs in the phone's browser.

This plan is based on six read-only maps of the code made the same day, covering statistics on phones,
navigation and entry points, cross-league data, the scouting table, the UI kit and app packaging.
The maps include live measurements against prophesyscouting.co.uk and Supabase, made with the
public key. File:line references are to commit 56b1dbf (stamp 270) and will drift.

## 1. Goal and scope

> Can you please make sure the statistics screen works properly on mobile, then roadmap and then create a full proper mobile app from the website that is self contained within itself able to be downloaded from the website and on the playstore in future (and completely adaptive to improvements that happen to the website). On website and mobile can you add a global screen that clicking epinoia in the top left sends you to, or clicking the countries bit on the sidebar (now want it to be 'HOME'). Can it have the EPINOIA logo in centre top in large font (the same epinoia font), have a 'daily fixtures' section of all the games listed on the entire site map across all leagues of the most recent few games ahead in an appealing way using some of the card css + the league name and logo to indicate which league (clickable to a 'global fixtures' page which lists all the top 30 most recent games across all leagues (then click show more to show more until whole list is exhausted) with each league being a dropdown menu), underneath have a 'best performing players' list using the stars logic for monthly and weekly (across all leagues on the site), then underneath showing each league in cards grouped by country similar to the team cards. Can you also create a 'global scouting' stats page on the home section with top 50 players in that sorted stat shown (same table/buttons as statistics but also a compare feature comparing selected stats using a comparision bar chart, prefilter players acrosss multiple stats) until click show more. Can you make sure that the epinoia screen with the water and background can't be accessed in the mobile app, and that the new home screen is the splash screen you enter into with a smooth transition. Can you also make sure notifications work perfectly on this app? — Louie, verbatim

| # | deliverable | phase |
|---|---|---|
| D1 | The Statistics page works properly on a phone | 0 |
| D2 | This roadmap | — |
| D3 | A HOME page, on the web and in the app, with EPINOIΛ large and centred at the top in the Epinoia font | 1 |
| D4 | The top-left EPINOIΛ and the sidebar's Countries entry (renamed HOME) both open HOME | 1 |
| D5 | Daily fixtures on HOME: the next games across all leagues, as cards showing each league's logo and name, with a link to the global fixtures page | 2 |
| D6 | A global fixtures page: 30 games at a time, Show more until the list ends, a collapsible group per league | 2 |
| D7 | Best performing players on HOME, weekly and monthly, across all leagues, on the stars logic | 3 |
| D8 | Leagues on HOME as cards grouped by country, in the club-card style | 4 |
| D9 | Global scouting: the Statistics table and buttons across all leagues, top 50 with Show more, a multi-stat filter, a compare bar chart | 5 |
| D10 | An Android app built from the website, downloadable from the site now and on Google Play later, always showing the current site | 6, 8 |
| D11 | The water splash can never appear in the app, which opens on HOME with a smooth transition | 1, 6 |
| D12 | Notifications work reliably in the app | 7 |

**What "self-contained" means here.** The app has its own icon, window, splash, notification
channel and notification settings, with no browser bar. It is not an offline app: it shows the live
website, so it needs a connection, and it needs Chrome installed and enabled on the phone. The
download page says so before the download button.

**Out of scope:** an iOS app; offline use; database migrations for HOME, games or scouting; native
Firebase Cloud Messaging (FCM) unless the Phase 7 gate fails.

**Deferred until the Phase 5 phone measurement:** season rows built on the server (risk 11, Q25, Q36).

## 2. Where things stand

- **Live data.** There are 3 leagues, all in Great Britain and all open: BCB, SLB men and SLB women. They have 485 scheduled games (202, 177 and 106) and 20 BCB finals (5–13 Sep). SLB has no finals yet, so global stars and scouting will be BCB-only for now.
- **The next 40 games** (anonymous probe, 17 Sep) run from 18 Sep 17:30 to 3 Oct 18:00: BCB 25, SLB men 13, SLB women 2. SLB women's first game only just fits in a time-ordered page of 40.
- **22 test games have no competition.** 13 of them are "finals" dated up to 8 Oct 2026, and they leak into any query that is not scoped to a league.
- **Statistics on a 360px phone** (`?l=bcb`, 225 players):
  - The header links never wrap, so the page is 504px wide and the menu button is off-screen.
  - 17 resize grips escape into a 9px strip down the right edge that swallows vertical swipes.
  - The first row starts 899px down, and the header row cannot stay stuck.
  - Search redraws every row on each keystroke: 177 ms, or 1781 ms for "everything", on desktop hardware.
  - Taps are 22–29px and text is 8–9px.
- **The splash.** `/epinoia/` without `?l=` shows the pool, and the installed app's start URL `/epinoia/?source=pwa` opens on it. It is linked from 22 top-left wordmarks, the sidebar's bottom row, the "all games" footers and the countries page (a second water page without `nav.js`). The splash never registers the service worker (`nav.js:50-52`). It is also the only page carrying the sign-in panel, the scoring deck (Score a game, Train / demo, Learn more) and the API, Embeds and Contact footer (`index.html:485-555`).
- **The league front page** (`/epinoia/?l=slug`) has no link to the platform: `home.js:1147-1156` swaps its hero wordmark (`index.html:562`, a `<div>`) for the league's name, and its fixture strip (`index.html:572-573`) opens every card in a new window (`embed/strip/strip.js:612`).
- **App detection** lives in five places (`nav.js:475`, `push.js:124-132`, `me.js:172-174`, `clockcam.js:168`, `embed/notify/page.js:113-118`). None runs before paint, and none recognises an Android app launch.
- **Notifications** are Web Push only. On Louie's Samsung the receipts prove `showNotification` resolved, so pushes arrive. Whether they pop up depends on the Android channel of the app that posts them and on One UI's pop-up style, and no website can set either.
- **Android.** There is no project and no CI, and `/.well-known/assetlinks.json` returns 404. `.nojekyll` lets GitHub Pages publish `.well-known/`. The repo is public.
- **Tests at HEAD 56b1dbf:**
  - Passing: push 203/0, access 219/0, sitstats 101/0, league-theme-pages 37/0 and nav-gating.
  - Already failing: touchscroll 37/1 (the season shot chart asks for the plain court) and mobile-grids 10/2 (it still expects the grids that commit 3bbc9c7 replaced with rails on 2026-09-10).
- **Tests in the working tree:** stats-mobile 38/0 (new); touchscroll 39/1 after Phase 0's edit (the remaining failure is the shot-chart case); mobile-grids still 10/2.

## 3. Decisions

The lead took these decisions on 2026-09-17. Each can still be changed.

| decision | why | cost to change later |
|---|---|---|
| New paths: `/epinoia/home/` (HOME), `/epinoia/games/` (global fixtures), `/epinoia/scouting/` (global scouting), `/epinoia/android/` (download page) | `nav.js`'s `LEAGUE_PAGE` regex treats anything under `fixtures/` or `stats/` as a league page, and `/epinoia/app/` is the team portal | free before launch; after, a redirect page per path |
| HOME's script is `epinoia/home/front.js` | `epinoia/home.js` is already the splash and league front page | a rename |
| The top-left EPINOIΛ goes to HOME for everyone, on the web and in the app | one meaning for the logo; the splash is still reachable at `/epinoia/` | 23 `href`s and the sidebar foot row |
| The sidebar's Countries heading becomes HOME, and `/epinoia/countries/` redirects to `/epinoia/home/#leagues` | HOME lists leagues by country, so keeping the old page would duplicate it | restore the page from git |
| The splash stays on the web but never appears in the app. This uses a blocking `epinoia/appmode.js`, manifest `start_url /epinoia/home/?source=pwa` and TWA `startUrl /epinoia/home/?source=twa` | old installs keep their start URL and 60+ links point at the root, so only a redirect before first paint covers every route | remove the redirect |
| Daily fixtures show live games first, then upcoming games, at least one per league before filling by time. Cards show the league badge (logo and name) and both clubs' crests | without the per-league rule, BCB takes 6 of the next 8 slots | one selection function |
| Global fixtures show the 30 games nearest to now (live games pinned first, then upcoming and results merged by distance), with Show more until none are left and collapsible groups per league | with 485 fixtures still to play, "recent" across leagues has to look both before and after now | a constant |
| The stars logic moves to a shared `epinoia/stars.js`, and league pages keep identical output. Stars are computed per league, then merged. Windows are anchored to the latest final across all leagues. Each player appears once, with their best BPM, tagged with their league | BPM and player totals are only correct inside one league; a single anchor makes "weekly" mean the same week everywhere | one line |
| Leagues grouped by country as club-plate cards: logo, name, number of clubs, next fixture | this is the kit's card; the marble look belongs to the pool page | CSS only |
| Global scouting extends `fulltable.js` rather than forking it. It loads each league's rows and merges them (`epinoia/global.js`). It adds a league column and filter, per-league percentiles, top 50 with Show more, a filter drawer for several stats at once, and a compare tray: 2–5 players and chosen stats as grouped horizontal bars in inline SVG (`epinoia/compare.js`) | one table keeps presets, heat colours and access rules identical to Statistics | new options are opt-in |
| No database migration for HOME, games or scouting | row-level security already governs these tables, and today's query costs are acceptable | a precomputed table later (Q36) |
| The Android app is a Trusted Web Activity (TWA) forced onto Chrome, never Samsung Internet (path C). It adds its own IMPORTANCE_HIGH "Game alerts" channel through a custom DelegationService, asks for POST_NOTIFICATIONS natively on first launch, and fades the Android 12+ splash into HOME | Samsung Internet has no TWA splash and no notification delegation, which is today's bug; a WebView shell would lose Web Push and Google sign-in | one method picks the browser |
| `.github/workflows/android.yml` builds a signed APK and AAB and attaches them to a GitHub Release. The APK downloads from `/epinoia/android/`, and Digital Asset Links go at `/.well-known/assetlinks.json` | no Android toolchain needed on the PC; the public repo gives a stable link | — |
| Package id `uk.co.prophesyscouting.epinoia` | the domain the app verifies against, reversed | free until the first Play upload, then permanent |
| Native FCM only if delegated notifications still fail on Louie's Samsung | FCM duplicates `notify`, the phone check and their tests, for no gain if the HIGH channel works | the Phase 7 gate |
| The app always shows the live website | `sw.js` caches nothing, assets carry `?v=` stamps, and the manifest is cached for 10 minutes, so a deploy reaches the app on its next launch | — |

## 4. Phases

**Effort** assumes one developer working with Claude: **S** is a day or less, **M** 2–3 days,
**L** about a week and **XL** two weeks or more.

**Definition of done.** Every phase ends when three things are true:
- the lead has stamped the assets
- the listed node suites pass
- the checks pass at 375×812 in both themes

In-app checks need Phase 6, and Phase 6's gate runs them all again.

### Phase 0 — Statistics on phones

**Files**
- `epinoia/stats/index.html`: on phones the header wraps (22px h2; links on their own line with 44px taps), and the scope bar gets a 12px gutter and a full-width 16px select.
- `epinoia/kit/table.css`:
  - `thead th{position:static}` (230) becomes `th:not(.stick){position:relative}`, and grips are hidden on phones.
  - Phone control sizes, one row of preset pills, the `.ft-head` sticky strip, and `touch-action:pan-y pinch-zoom`.
  - The phone breakpoint moves from 640px to 820px.
- `epinoia/fulltable.js`:
  - No grips on a coarse pointer (1040), and CSS classes replace the inline `style.cssText` (648–748).
  - On phones, a **filters** button folds the secondary controls, presets scroll in one row, and a header-only table in `.ft-head` follows the body's scroll.
  - `opts.pageSize` is 50 on phones (unlimited on desktop), with Show more. Percentiles and CSV still cover the whole filtered set.
  - Search is debounced by 160 ms.
  - The name column is 132px on phones in both `measure()` and `draw()`.
  - TEAM is dropped on phones, and the sorted column scrolls into view.
- `epinoia/xscroll.js`: add `.ft-head` to `MANAGED` (41), copy `scrollLeft` to the strip after each drag (140, 179), and switch `PHONE()` at 820px.
- `kit/epinoia-kit.css` and `kit/nav.css`: phone scrollers from 820px, the top safe area when installed, the bell floating above the tab bar, and `body.has-nav` padding set to `calc(58px + env(safe-area-inset-bottom,0px))` (nav.css 418).
- `stats/wowy/index.html`: a light-theme value for the `#0c1f16` header cell (67), and readable chips.
- Tests:
  - `supabase/tests/stats-mobile.test.mjs` (new, 38/0).
  - `touchscroll.test.mjs`: the phone assertions move to the 820px breakpoint and allow `pan-y pinch-zoom` (done in the working tree, 39/1; the remaining failure is the existing shot-chart case).
  - `mobile-grids.test.mjs`: still to update to expect the rails (10/2 today).

**Approach.**
- **Keep the hand-drag model.** `table.css:186-229` and `xscroll.js:76-105` record three failed
  attempts with native `overflow-x`.
- **The header strip** is a second table that shares a `<colgroup>` with the body and sits before
  `.ft-wrap`. The wrap's ancestors are all `overflow:visible`, so `position:sticky` works there.
  This was verified live with injected CSS.
- **Shared code.** Every change also reaches league leaders, team stats, the player career table,
  lineups and WOWY.

**Acceptance** (375×812 and 360×780, `/epinoia/stats/?l=bcb`, both themes):
- **Page width:** `scrollWidth === innerWidth`, and the menu button is fully on screen.
- **Grips:** `elementFromPoint(innerWidth-4, 600)` is not a grip, and a right-edge swipe scrolls the page without resizing anything.
- **Layout:** with filters folded, the first row is above y=420.
- **Sticky header:** at scrollY 2000 the strip is at the top. After a 500px sideways drag, header and body cell 4 share a left edge, and `#` and PLAYER stay pinned.
- **Paging and export:** 50 rows show, Show more adds 50 without changing the first 50's heat colours, and the CSV has all 225 rows.
- **Speed and size:** typing "smith" redraws once, controls are at least 40px tall, and inputs are 16px.
- **Regressions:** desktop at 1440px is unchanged, grips included. League leaders, team stats, player career, lineups and WOWY are re-checked at 375px and 1440px.
- **In the app** (at the Phase 6 gate): the same checks pass on the Samsung.

**Tests:** `stats-mobile`, `sitstats`, `access`, `touchscroll`, `mobile-grids`. **Effort:** M.

### Phase 1 — HOME, navigation and app mode

**Create**
- `epinoia/home/index.html`:
  - **Head:** the head from `stats/index.html:1-21`, plus `../kit/card.css?v=…` (club plates, star cards and league cards need it) and `../kit/home.css?v=…`, with `<meta name="theme-color" content="#f3faf6">` in place of the dark `#04100b` (`appmode.js` changes it to `#04100b` for dark-theme readers). `../appmode.js` is the first script.
  - **Body:** `<h1 class="wordmark epinoia-mark" aria-label="Epinoia">EPINOIΛ</h1>`, then the fixtures, stars and leagues sections and a link to scouting.
  - **A foot band** carrying what only the splash offered: sign in (`signin/`, shown when signed out), score a game (`score/`), train / demo (`score/?train=1`), learn (`learn/`), API, embeds and contact.
  - **Deferred scripts:** `config, season, bpm, data, teamcolour, front, nav, xscroll`. Later phases add to this list (Phases 2, 3 and 4). It never uses `mode.js`, `splash.css` or `splash-body`.
- `epinoia/home/front.js`:
  - Fades each section in over 200 ms (not under reduced motion).
  - Never sets `__CS_LEAGUE_SLUG` or applies a league theme.
  - Strips `source=`, `shell=`, `notif=` and `chan=` from the URL with `replaceState`, and calls `epinoiaClientReady()` when `?code=` or `#access_token` arrives.
  - Fixtures and stars reserve skeleton heights. After the leagues section renders, if `location.hash` is `#leagues`, it scrolls that section into view again, without smooth scrolling, because the browser jumps to the anchor before the sections above it have grown.
- `epinoia/kit/home.css`: the hub blocks lifted verbatim from `index.html` (`.sec`, `.clubgrid`, `.starrow-*`, `.stargrid`, the 720px rails, `.showall`, `.empty`), `.hm-hero` with the wordmark at `clamp(46px,15vw,96px)` (56px at 375px), the skeleton heights and the foot band.
- `epinoia/appmode.js`: a blocking script in the head, because the CSP forbids inline scripts.
  - **Where:** loaded first, without `defer`, in the head of every `/epinoia/` page that links the manifest: `index.html`, `admin/`, `admin/platform/`, `api/`, `app/`, `clockcam/`, `contact/`, `edit/`, `embed/notify/`, `fixtures/`, `game/`, `join/`, `l/`, `learn/`, `me/`, `news/`, `p/`, `privacy/`, `prophesy/`, `score/`, `signin/`, `stats/`, `stats/wowy/`, `t/`, and the new `home/`, `games/`, `scouting/` and `android/`. (`countries/` becomes a redirect and carries no scripts.)
  - **App detection:** any of the `epinoia_app` sessionStorage flag, `?source=pwa|twa`, an `android-app://` referrer, `display-mode: standalone|fullscreen` or `navigator.standalone`.
  - **On every page it is loaded on:** applies the saved theme before paint, using a copy of `config.js:71-74`, and sets `theme-color` to match.
  - **In the app:** sets `html.m-app` and the ground colour, and saves the flag. It stores `shell`, `notif` and `chan` from the launch URL (Phase 6) in sessionStorage `epinoia_shell`.
  - **Redirect:** when its tag has `data-water="front"` and there is no league (no `?l=`, or an empty `?l=`, which `mode.js` also treats as the splash), it sets `document.documentElement.style.display='none'` and then calls `location.replace('/epinoia/home/')`, keeping the query and hash (which carry sign-in tokens). The navigation is asynchronous and the document keeps parsing, so hiding the root first stops `splash.css` from painting the pool or fetching the `pool-*.jpg` backgrounds while it is pending. The pool never enters history.
- `supabase/tests/appmode.test.mjs` runs these cases: plain tab, `pwa`, `twa`, referrer, standalone, stored flag, `?l=bcb`, `?l=`, `#access_token`, `shell=&notif=&chan=` stored, the news archive, and HOME.
- `supabase/tests/home-links.test.mjs` checks that all 23 top-left wordmarks (the 22 page wordmarks and the league front page's hero) link to `home/`, and that the sidebar foot row does too.

**Change**
- `epinoia/index.html`:
  - `<script src="appmode.js?v=…" data-water="front">` immediately before `mode.js` (18). It does not go inside `mode.js`, which forbids storage and also runs on the news archive.
  - The league front page's hero (`#hub`) gets `<a class="plain" href="home/"><span class="wm epinoia-mark" aria-label="Epinoia">EPINOIΛ</span></a>` top left. Its class is `wm`, not `wordmark`, so `home.js:1149`'s `querySelector('.wordmark')` still finds the heading it renames.
- The other manifest-linked pages listed above: `appmode.js` as the first script in the head.
- `epinoia/countries/index.html` becomes `<meta http-equiv="refresh" content="0; url=../home/#leagues">`, and `league/countries/` points straight at `/epinoia/home/#leagues`.
- `epinoia/manifest.webmanifest`: `start_url` becomes `/epinoia/home/?source=pwa` (`id` and `scope` unchanged). Add a Home shortcut, and set `background_color` and `theme_color` to `#f3faf6`.
- `epinoia/nav.js`:
  - The Countries heading (250-257) becomes HOME, linking to `home/` and highlighted there. The country header (318, 883) links to `home/#leagues`.
  - The foot row (622-627) goes to `home/` on the web and in the app, with `⌂` before EPINOIΛ in the logotype and the title "HOME". It moves to the top of the foot, so a phone drawer that opens on a league panel shows it without going back two panels.
  - With no league, `paintTabbar` (641-665) draws home · games · scouting · leagues · profile rather than removing the bar, and the league's "home" tab is renamed "league".
  - Tests pin these, so they stay byte-identical: the registration call, `LEAGUE_PAGE`, the splash skip, and `drawLeagues(); themeLeague();`.
- The 22 wordmark anchors point at `home/`. The five inline-styled chips (stats, l, t, me, app) become `class="wm epinoia-mark"`, so light-theme contrast applies.
- `splash.js` "Browse leagues" (266) goes to `home/#leagues`.
- **Framed links on our own pages.** When the parent page is on our own origin, strip cards (`strip.js:612`), the strip plate (`embed/strip/index.html:22`), embed/game `#full` and embed/table `#more` (the league page frames Table and Leaders, `home.js:860-868`) all target `_top`. They use the same-origin parent test `leagueLink` already uses (`strip.js:1114-1117`). On a club's site they keep `_blank`.
- **Notification tap fallback: HOME.**
  - `sw.js`: a new `HOME_PATH = '/epinoia/home/'` is the fallback in `notificationFor` (86) and `clickTarget` (161-162). `SITE_PATH` stays `/epinoia/`, because `pickClient` (171) uses it to find open windows.
  - `supabase/functions/_shared/pushpayload.js`: `payloadFor` uses `base + (link || 'home/')`.
  - `push.test.mjs:659` and `731-732` and `pushpayload.test.mjs` are updated in the same commit, `SW_VERSION` is bumped, and `notify` is redeployed before R2 (6.8).
- `kit/epinoia-kit.css`: `@view-transition{navigation:auto}` inside `@media (display-mode: standalone)`, 180 ms, off under reduced motion. `view-transition-name: ep-mark` goes on one element per page.
- `sitemap.xml`: add `home/`, `games/` and `scouting/`.

**Approach.**
- **Release together.** Phases 1–4 ship as one release. The wordmark links and the countries redirect change only once HOME is complete.
- **Smooth launch.** It does not rely on view transitions, which Samsung Internet skips. Instead, the launch colour matches HOME's first paint, the wordmark and card skeletons paint at once, and the data fades in.
- **Notification tap fallback.** HOME for everyone, on the web and in the app (Q11). A tap that opens a fresh window carries no `?source=`, no referrer and no stored flag, so it must not depend on app detection to avoid the splash.

**Acceptance on the web** (normal tab):
- `/epinoia/` still shows the pool.
- `/epinoia/home/` shows a 56px centred wordmark at 375px, with no horizontal overflow and the bell clear of it.
- All 23 wordmarks, the sidebar's HOME heading and the sidebar foot row lead to HOME, and the heading is highlighted there.
- On `/epinoia/?l=bcb` at 375px, opening the drawer shows the foot's HOME row without going back through the panels.
- HOME's foot band reaches sign in (when signed out), score a game, train / demo, learn, API, embeds and contact.
- `/epinoia/countries/` and `/league/countries/` land on `#leagues`, and stay there after fixtures and stars have loaded.
- On a phone, HOME shows the five platform tabs, and league pages keep theirs.
- `navigator.serviceWorker.getRegistration('/epinoia/')` resolves on HOME.
- A test notification with no link opens HOME.

**Acceptance in app mode** (`?source=pwa`, then the installed web app):
- `/epinoia/?source=pwa` and `/epinoia/?l=&source=pwa` end on HOME **with no request for `brand/pool-*.jpg`**, including with the network throttled to Slow 3G.
- Back from HOME exits the app.
- In-app links to `/epinoia/` land on HOME.
- A `#access_token` survives the redirect.
- `/epinoia/news/` is not redirected.
- There is no dark flash in the light theme on HOME, `/epinoia/games/`, `/epinoia/stats/?l=bcb` and `/epinoia/game/`.

**Tests:** `appmode`, `home-links`, `push`, `pushpayload`, `strip-live`, `league-theme-pages`, `nav-gating`. **Effort:** L.

### Phase 2 — Daily fixtures and the global fixtures page

**Files**
- **New `epinoia/globalgames.js`** (UMD): one select whose `competitions!inner(… seasons!inner(… leagues!inner(…)))` chain drops the 22 test games; `live()`, `upcoming(from, limit)`, `recent()` and `nextFor(leagueId)`; and the pure functions `pickDaily(live, upcoming, nextByLeague, now, n)`, `mergeNearest(up, recent, now, n)` and `groupOrder(rows, now)`.
- **New pages:** `epinoia/games/index.html` and `games.js`.
- **New test:** `supabase/tests/globalgames.test.mjs` covers:
  - ordering by distance (on a tie, the fixture comes before the result);
  - a league whose next game lies beyond the time-ordered 40 still gets a card when it is within 14 days, and gets no reserved slot when it is 15 days out;
  - live games pinned above both cursors, and a scheduled game one hour past tip-off still listed;
  - inside a group, "next" soonest first, then "results" newest first;
  - de-duplication, including a game that turns final between pages, and running out of games.
- **Changes:**
  - `home/index.html`: `../globalgames.js` and `../rt.js`, deferred, before `front.js`.
  - `kit/home.css`: the `.fxc` card, ported from `kit/embed.css:137-276` onto kit tokens with a light variant and labels of at least 8.5px, plus the `.lgb` league badge from `nav.css:222-238`.
  - `config.js`: add `epinoiaLeagueBadge(l)`.
  - `kit/epinoia-kit.css`: `.ep-acc` (on `<details>`) and `.ep-btn.more`, both added to the light-theme lists.
  - `home/front.js`: the daily section. Its header carries `<a class="showall" href="../games/">all fixtures →</a>`.
  - The "all games" and "box scores" links (`game/index.html:192`, `p/index.html:251`, `score/bootstrap.js:722`) point to `../games/`.

**Approach.**
- **Daily fixtures.** In parallel, run the live query, the time-ordered upcoming query (scheduled games from two hours ago onwards, limit 40) and one next-game query per league (the same select, `competitions.seasons.leagues.id=eq.<id>`, `order=tipoff_at.asc`, `limit=1`). Merge by id. Fill 8 cards: every live game, then each league's next game if it is within 14 days (nearest first, if more leagues qualify than there are cards), then the rest by time. The time-ordered query was measured at 108 ms and 9.7 kB. Refresh every 15 s while a game is live and every 30 s otherwise, and re-read on `rt.js`'s `epinoia:live`.
- **Daily fixtures follow the reader (Louie, 2026-09-25).** What the reader follows comes first: with several games live, those in a league or of a club they follow are pulled to the front - all of them - and the next game of each followed league and club takes a card before anybody else's (`pickDaily`'s sixth argument, `{ leagues, teams }`, read from `fan_prefs` through follow.js; re-ordered the moment a follow is saved). Every live game is still shown; nothing followed is everybody's order.
- **Global fixtures.** Freeze "now" at load. Live games from the daily live query are pinned above both cursors. Keep two cursors, each asking for an exact count on its first request: upcoming (scheduled) games from now − 2 h onwards, as on HOME, and results (`status=eq.final`) going back from now. Show 30 at a time by distance from now, fetching more for a side only when its buffer runs out. Measured at 103 ms and 35 kB per page, with 484 games to come.
- **Global fixtures, nearest first, the week's leagues, a Show more in each (Louie, 2026-09-25).** The page is as it was - 30 nearest to now across every league, upcoming and results merged by distance, live pinned above, a page-wide Show more - with two additions. (1) Only leagues with a game in the next 7 days are on it (one light read, `weekLeagues`: ids and tip-offs counted per league; a league with a live game is there too), and both cursors are scoped to them (`feed({ league: [ids] })`, one `in.()` filter on the inner-embedded season's league). The number beside a league is its games in that week. (2) Every league dropdown ends in ONE BUTTON IN TWO HALVES, for that league only: "Show more upcoming in this league" and "Show more results in this league", each half its own cursor of that side of that league (`sideFeed`, upcoming forwards / results backwards) that begins after what the page already shows for it, 6 at a time, so a press adds games and never repeats one, and a half goes when its side has no more; a league with nothing on the page yet (its games are further out than the 30 nearest) is read, both sides, when it is opened. The top of the page says the order in words: the nearest-to-now rule, the four rules, and 'Next games, soonest first' / 'Latest results, newest first' as the sub-headings.
- **Groups.** Each league is a `<details>` element, ordered by its most imminent game. Inside a group, upcoming games run soonest first under "next", then results newest first under "results". Later pages add into existing groups and keep each group's open state.
- **Games that don't show.** Games still marked "scheduled" more than two hours after tip-off match neither query (Q18). Anonymous reads never see `finalising`, so a game can disappear briefly at full time: de-duplicate by id, and never assume counts only grow.

**Acceptance.**
- **HOME at 375px:**
  - At least one card for each league with a game in the next 14 days (three badges today). Each card shows the league's logo and name, both crests and the tip-off, and a tap opens the game.
  - The "all fixtures →" link opens `/epinoia/games/`.
- **Test games:** none appear (checked against `games?competition_id=is.null`).
- **`/epinoia/games/`:**
  - Live games sit above the rest.
  - The count reads "30 of N"; Show more adds 30 until "all N shown", then disappears.
  - The 48px group headers keep their open state, and each group lists "next" before "results".
  - Both themes work.
- **In the app:**
  - Taps stay in the app with no URL bar, and Back returns to HOME.
  - On `/epinoia/?l=bcb`, tapping a strip card opens the game inside the app with no URL bar.

**Tests:** `globalgames`, `strip-live`, `push`. **Effort:** M.

### Phase 3 — Best performing players

**Files**
- **`epinoia/stars.js`** (new, UMD `EpinoiaStars`): `WINDOWS`; `computeWindow(pgs, tgs, games, {leagueOf})`, which splits rows by league before running `players/teams/attachBPM`; and `pick`, `card(…, {base})` and `render`.
- **`epinoia/home.js`:** the league page calls `EpinoiaStars`. It fetches the 30-day window once and derives the 7-day window from it, which saves one `statsForGames` call and one `playerMeta` call. `merch()` gets the same input as before. This moves battle-tested league-page code, so it ships only with the parity check below: the league page's stars must come out identical (same players, order, BPM and card markup) before and after.
- **`home/index.html`:** `../stars.js`, deferred, before `front.js`.
- **Also:** `epinoia/index.html`, `home/front.js`, `kit/home.css`, a new `supabase/tests/stars.test.mjs` and a new fixture `supabase/tests/fixtures/stars-bcb.json`.

**Approach.**
1. **Anchor.** `games?status=eq.final&competition_id=not.is.null&tipoff_at=lte.<now>&order=tipoff_at.desc&limit=1`. Both filters are needed, or the future-dated test finals become the anchor.
2. **Windows.** Unchanged: the month is 30 days with at least 2 games and 60 minutes; the week is 7 days with at least 1 game and 20 minutes.
3. **Fetch.** Box scores in chunks of 40 game ids, selecting only the 15 stat keys BPM needs: 212 kB instead of 827 kB.
4. **Rank.** Compute per league, then merge, keeping each player's best BPM row with their league.
5. **Names.** Fetch names for the top 20, drop rows without a slug (withheld minors), and keep 10. Cards read "Club · League", with BPM in the band.
6. **Cache.** Stars load after the fixtures and are cached in sessionStorage for 10 minutes, keyed by anchor.

**Acceptance.**
- **League page parity:**
  - Before the refactor, save BCB's league-page inputs for both windows (the `games`, `player_game_stats`, `team_game_stats` and `playerMeta` rows) and its outputs (ids, order, BPM to 1 dp, card HTML) to `supabase/tests/fixtures/stars-bcb.json`.
  - `stars.test.mjs` runs `EpinoiaStars` on those rows offline and must match the saved outputs exactly.
  - The live `/epinoia/?l=bcb` comparison ("the same ten names") happens on the same day as the save, before any new BCB final.
- **HOME:**
  - Shows weekly and monthly podiums with the top-10 toggle, no card named "Player", and no anchor date in the future.
  - Today that takes about 10 requests and under 400 kB. A second visit within 10 minutes makes no box-score request.
- **At 375px, on the web and in the app:** the rails snap, and the top-10 toggle closes. (CSS has overridden `[hidden]` here before; see `home.js:740-742`.) Star cards open player pages inside the app.

**Tests:** `stars`, `bpm`, `mobile-grids`. **Effort:** M.

### Phase 4 — Leagues by country

**Files**
- **New:** `epinoia/country.js`, holding `flagOf`, `countryName` and `group`, moved from `countries.js:23-81`.
- **Changed:** `home/index.html` (`../country.js`, deferred, before `front.js`), `home/front.js` and `kit/home.css`.
- **Retired:** `countries.js` and `countries.css` become unused and go in a later cleanup.

**Approach.**
- **Data:** `leagues` (colours, `colour_source`, `logo_path`), `teams?select=league_id` for club counts, `seasons` newest first for the band, and each league's next fixture from Phase 2.
- **Layout:** each country gets a `.starrow-h` (flag, name, count), then a `.clubgrid` of club plates linking to `../?l=slug`.
- **Colours:** a card uses league colours only when `colour_source` is `logo` or `manual`; otherwise it stays platform mint (BCB today).
- **Names and logos:** names clamp to two lines on phones, and BCB's logo sits on a white tile.

**Acceptance.**
- **Content:** one "United Kingdom" group of three cards, with 20, 10 and 10 clubs; next fixtures match `/epinoia/games/`.
- **Logos:** a blocked logo falls back to the monogram, and BCB's logo reads in dark mode.
- **Layout and links:** no overflow at 375px, and `/epinoia/countries/` lands on this section on the web and in the app, and stays there once fixtures and stars have loaded.

**Effort:** S.

### Phase 5 — Global scouting

Ships in R4, after the Android app (R3, §5), so its phone checks run inside the app.

**Create:** `epinoia/scouting/index.html` and `scouting.js`; `epinoia/global.js`; `epinoia/compare.js` (UMD, with a pure `html(o)` and a `render(o)` redrawn by a debounced ResizeObserver); `kit/compare.css`; and `supabase/tests/global.test.mjs` and `compare.test.mjs`.

**Change `epinoia/fulltable.js`** (every option is opt-in)
- **League column** (`leagueColumn`): added after `gp`. The sort fallback at 850 becomes `CAT.find(x => x.k === 'gp')` instead of `CAT[3]`.
- **League select** (`leagueSelect`): the team select is keyed by team id and labelled like "LEI · SLB W", because six short names repeat between SLB men and women.
- **Rank within league:** a toggle, on by default here. It sets `groupOf = r => r.leagueId` and builds position groups per league.
- **Access:** a `locked()` callback.
- **Filters drawer:** each line is a stat, ≥ or ≤, and a value or a percentile, with quick sets such as "shooters" and "rim protectors". A rate stat also gets a volume floor of `max(MIN, 25% of the median volume)`, stated in the count. Heat is ranked over the filtered population.
- **Compare selection:** `selectable {max:5}` puts a pick button in the rank cell. A tray above the tab bar holds the picks and a Compare button.
- **Other:** `getView/getPool/getRanks/getSelected`, `setRows` fixed or re-rendered, and search matches league names.

**Change other files**
- `access.js`: `loadMany({leagueIds})`, one `access_state` call for up to 50 leagues.
- `data.js`:
  - `playerMeta` fetches its chunks in parallel. Serially they take 1.55 s.
  - A season select that leaves out `stats->adv` on player rows, used by `global.js`: it selects the keys `players()` reads and reassembles `stats`, as Phase 3 does for BPM. `players()` never reads `adv` from a player row (only `teamLine` reads it, from team rows), and it is 55% of each player row's JSON (447 final rows, measured 17 Sep). Team rows keep `adv`.
- `season.js`: percentiles by binary search, giving identical results. Then run `node supabase/tests/extract-shared.mjs`.
- `kit/table.css`, `home/front.js` and `sitemap.xml`.

**How `global.js` loads rows**
1. Load the leagues, then await `access.loadMany`, so a member's token is sent.
2. Skip leagues the viewer cannot see, and show "N members-only leagues not included".
3. For each league, take its newest season with all competitions, and run the trimmed `D.season` for all leagues in parallel.
4. Merge rows with `id = leagueId + ':' + playerId`. Percentiles, position groups and heat colours are keyed by `r.id`. `playerHref` keeps using `playerId`.
5. Take the team from the games, and names from `playerMeta`. Drop rows with no name.
6. Mark a player `qualified` when `gp ≥ ceil(teamGp/3)` and `min ≥ max(30, 5 × teamGp)`. The qualified filter is on by default.
7. Draw each league as it arrives.

**Page rules**
- No RAPM button: players in different leagues never share a floor.
- No covering select: scouting always covers each league's newest season with all its competitions (Q20).
- If any included league locks premium columns, they are locked for everyone on this page and left out of the pickers.
- The default sort is PPG, with 50 rows and Show more at every width. Filters, sort and league are kept in the URL.
- Measured today, in node on desktop: 237 rows, 3.4 s, 931 kB, for only 20 BCB finals. Row-level security's server time dominates (0.75 s per 447 rows), and the rows grow with every final in every league, so by the time this phase ships the load will be several times larger.

**The compare chart**
- **Percentile mode** is the default, ranked against the page's population, or within league when that toggle is on.
- **Value mode** draws a zero line for signed stats: `bpm`, `obpm`, `dbpm`, `diff_*`, `pm`.
- **Sizing:** the viewBox width equals the host's CSS width, so 11px text stays 11px. `game/flow.js` uses a fixed 800-wide box instead.
- **Layout:** below 560px, each stat gets a label line and then one 16px row per player. Wider screens put labels in a 120px column.
- **Colours:** the series use `--lume --aqua --amber --violet --ink-2`. `--good` and `--flare` are avoided because they already mean good and bad in the heat map.
- **Accessibility:** each player's number 1–5 appears on their bars and legend chip, every bar has a `<title>`, and the chart has `role="img"`.

**Acceptance**
- **At 375px:** 50 rows, and Show more adds 50 without changing heat colours. The LEAGUE column and filter are present, and the team select tells the two LEI teams apart.
- **First load on a phone:** on Louie's Samsung, in the app, over mobile data, the first league's rows appear within 3 s and all leagues within 6 s. If not, season rows are built on the server within Phase 5, which needs Louie's decision on Q36 first.
- **`global.test.mjs`:** the same player id in two leagues gives two rows, each with its own league's percentiles and position group. Withheld minors are dropped, and a locked league locks the premium columns. `players()` gives identical rows with and without `stats->adv` on the player rows.
- **Filters:** "3P% percentile ≥ 80 and 3PA/G ≥ 3" returns only rows that meet both, and the count names the volume minimum.
- **Compare, 3 players × 6 stats:** 18 bars, no NaN, no overflow at 375px, and text of 11px or more in both themes. `compare.test.mjs` finds one bar for each player and stat, and no premium stat while locked.
- **No regressions:** Statistics at 1440px is unchanged, CSV exports the whole filtered view, and in the app the tray clears the tab bar and the gesture area.

**Tests:** `sitstats`, `access`, `touchscroll`, `global`, `compare`, and `extract-shared.mjs` with no drift. **Effort:** XL.

### Phase 6 — The Android app

**Create `android/`.** Written by hand from android-browser-helper's `demos/twa-basic`, as text files
only. There is no Bubblewrap, whose first run installs a JDK and the Android SDK and offers to
create a signing key in the target folder, which here is the public repo checkout. No keystore goes
anywhere near the checkout. Icons, the splash image and the notification icon are vector drawables,
so nothing binary is committed. There is no Gradle wrapper: `gradle-wrapper.jar` is binary, and a
`gradlew` committed from Windows loses its executable bit (`core.fileMode` is off). If a wrapper is
added later, commit it with `git add --chmod=+x android/gradlew`. CI never runs Bubblewrap.
- **TWA settings**, where `demos/twa-basic` puts them (there is no `twa-manifest.json`, which only Bubblewrap reads): package `uk.co.prophesyscouting.epinoia`; host `prophesyscouting.co.uk` (the apex) in the `asset_statements` string; `DEFAULT_URL https://prophesyscouting.co.uk/epinoia/home/?source=twa`; the DelegationService declared, which enables notifications; `SPLASH_SCREEN_FADE_OUT_DURATION 300`; `FALLBACK_STRATEGY customtabs`; orientation `default`.
- **`app/build.gradle`:** `compileSdk` and `targetSdk` 36, `minSdk` 23; a pinned `androidbrowserhelper`; the version read from `epinoia/android/version.json`; release signing from environment variables.
- **`EpinoiaLauncherActivity.java`:**
  - Launches with `new TwaLauncher(this, "com.android.chrome")` when Chrome is installed and enabled; otherwise it shows a one-time dialog saying the app needs Chrome.
  - On the first launch on Android 13+, it holds the launch, shows a one-screen native pre-prompt in HOME's colour explaining game alerts, asks for POST_NOTIFICATIONS, and then launches.
  - `getLaunchingUrl()` appends `shell=<versionCode>&notif=<0|1>&chan=<importance>` on every launch: `notif` from `NotificationManagerCompat.areNotificationsEnabled()`, and `chan` from the `epinoia_alerts` channel's importance.
- **`Channels.java`:** `epinoia_alerts` ("Game alerts"), IMPORTANCE_HIGH, with vibration and public visibility on the lock screen. Below Android 8, priority HIGH.
- **`EpinoiaDelegationService.java`:** `onNotifyNotificationWithChannel` rebuilds Chrome's delegated notification onto `epinoia_alerts` with `Notification.Builder.recoverBuilder`. `onAreNotificationsEnabled` answers from that channel.
- **`NotificationSettingsActivity.java`:** declared with `android:exported="true"` and an intent filter with action VIEW, categories DEFAULT and BROWSABLE, scheme `epinoia` and host `notification-settings`; without BROWSABLE, Chrome will not open it. The site opens it through `intent://notification-settings#Intent;scheme=epinoia;package=uk.co.prophesyscouting.epinoia;end`. It shows channel importance, Do Not Disturb and background restriction, with buttons into Android settings.
- **`AndroidManifest.xml`:** App Links with `autoVerify` for `https://prophesyscouting.co.uk` and `pathPrefix /epinoia`, which decides which outside links open the app; a white vector notification icon; a `values-v31` splash background in HOME's colour.

**Create outside `android/`:**
- **`.gitignore`**, in the same commit as `android/` or earlier: `*.jks`, `*.keystore`, `android/.gradle/`, `android/**/build/`, `android/local.properties`, `google-services.json`.
- **`.well-known/assetlinks.json`** at the repo root, with the package and its SHA-256 fingerprint (public by design).
- **`.github/workflows/android.yml`:**
  - **Runs** on a push to `main` that touches `android/**` or `epinoia/android/version.json`, and on demand. `permissions: contents: write`, so it can publish a release.
  - **Builds** with Temurin 17, the Android SDK and `gradle/actions/setup-gradle@v4` with a pinned `gradle-version`. It decodes the keystore with `printf '%s' "$ANDROID_KEYSTORE_B64" | tr -d '\r\n' | base64 -d`, then runs `gradle --no-daemon assembleRelease bundleRelease` in `android/`.
  - **Fails unless the APK's certificate is listed in `assetlinks.json`.** apksigner is not on the runner's PATH, so the workflow installs `build-tools;36.0.0` with sdkmanager and calls `$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs`. That prints lowercase hex without colons, so the digest is uppercased and colon-separated before comparing.
  - **Publishes** release `android-v<code>` with `epinoia.apk` and `epinoia.aab`, then deletes the keystore. The release step is skipped, with a warning, when tag `android-v<code>` already exists (for example an edit to `version.json` that only changes `minShell`).
- **`epinoia/android/`:** `index.html`, `android.js`, and `version.json` (`versionCode`, `versionName`, `minShell`, `apk`, `play`). The page says, before the download button, that the app shows the live site, needs a connection, and needs Chrome installed and enabled.

**Change:**
- `guard.yml`: also triggers on `.well-known/**` and `android/**`, and checks that the package name matches in both files.
- The web manifest: `related_applications` for Play, with `prefer_related_applications: false`.
- The install banner in `nav.js`, and the link in `me/me.js`: hidden inside the app; on Android browsers they link to `/epinoia/android/`.
- `home/front.js` and `kit/home.css`: HOME shows a "Get the Android app" card to Android browsers (never in the app), linking to `/epinoia/android/`.
- `appmode.js`: in app mode (`html.m-app`), one document click listener gives links from `/epinoia/` to same-origin paths outside `/epinoia/` `target="_blank" rel="noopener"`, so they open in a browser tab. The TWA verifies the whole origin, so without this they would open full-screen in the app (Q30).
- **Email sign-in in the app.** A magic link's first stop is `*.supabase.co`, which no App Link covers, so tapped in Gmail it finishes in the default browser and the app stays signed out. In app mode, every `signInWithOtp` form (`signin/signin.js`, `app/app.js`, `admin/admin.js`, `admin/platform/platform.js`) shows a code field after sending: `signInWithOtp({email})`, then `verifyOtp({email, token, type:'email'})` with the 6-digit code typed into the app. The email template carries the code (6.1).
- The update notice reads `epinoia_shell.shell` (below).

**Approach.**
- **Launch sequence.** From the second launch on, the Android 12+ system splash, in HOME's colour, hands over to the TWA splash, which fades out over 300 ms as HOME first paints. On the first launch on Android 13+: system splash → the native pre-prompt in HOME's colour → the Android permission dialog → the TWA splash → HOME.
- **Download page.** The steps are written for a Samsung:
  1. Download the APK.
  2. Allow "Install unknown apps".
  3. Install. If Play Protect asks, choose Scan app, then Install.
  4. Open the app. A screen explains game alerts, then Android asks about notifications: allow them.
  5. Keep Chrome enabled.
  6. Turn off notifications in the old Samsung Internet web app.
- **Updates.** Website changes never need an app update. The site shows "Update the Epinoia app" only when `epinoia_shell.shell` is below `minShell`. A new APK installs over the old one, because it has the same key and a higher `versionCode`.

**Acceptance.**
- **Build and hosting:**
  - CI passes, and the release has both files.
  - `…/releases/latest/download/epinoia.apk` downloads.
  - `assetlinks.json` returns 200 `application/json` with no redirect.
  - Google's Statement List tester passes.
  - Re-running the workflow without a new `versionCode` succeeds and publishes nothing.
- **On Louie's Samsung, with Samsung Internet as the default browser:**
  - No URL bar appears, which confirms a verified TWA.
  - First launch: system splash → pre-prompt → permission dialog (once) → app splash → HOME, with no pool.
  - From the second launch on, the app goes from the system splash to HOME with no pool and no colour flash.
  - Google sign-in returns to the app.
  - An email sign-in requested inside the app signs the app in.
  - A link from `/epinoia/` to a page outside it opens in a browser tab, not full-screen in the app.
  - Back from HOME closes the app.
  - HOME's "Get the Android app" card shows in Chrome on Android and never inside the app.
- **Chrome disabled:** the dialog appears instead of the app silently launching in Samsung Internet.
- **Updates:**
  - A website-only change shows after relaunching the app.
  - A newer APK installs over the old one and keeps the sign-in.
- **Earlier phases:** all 375px checks from Phases 0–4 pass inside the app. Phase 5 runs its own in-app checks when it ships.

**Effort:** L. It depends only on Phase 1 and ships before Phase 5 (R3, §5), so Play's testing clock starts sooner.

### Phase 7 — Notifications in the app

**Files**
- **`epinoia/push.js`**:
  - An `android-twa` platform. Its settings steps are Game alerts on Alert with pop-up, One UI pop-up style Detailed, the Epinoia and Chrome batteries Unrestricted and never sleeping, and Do Not Disturb.
  - A `settingsIntent` for an "Open notification settings" button.
  - The subscription row records its client.
  - In the app, `check()` takes the permission step only from `epinoia_shell.notif` and `chan` (IMPORTANCE_HIGH is 4), shown as "as of this launch", with the Open notification settings button to fix it and a prompt to relaunch. The JavaScript `Notification.permission` is shown but never trusted.
- **`epinoia/sw.js`**:
  - `BADGE` becomes a white-on-transparent `brand/epinoia-badge-96.png`; the 32px colour mark shows as a white square.
  - The offline page is served only for navigations, with status 200. Today every failed GET, Supabase JSON included, gets a 503 HTML page.
  - `SW_VERSION` is bumped.
- **`epinoia/me/me.js`**: shows the settings button in the app, and a "turn off" for the account's other subscriptions on this phone.
- **`supabase/migrations/0128_push_client.sql`**: adds `push_subscriptions.client` (`tab`, `pwa`, `twa`, `samsung-app`), nullable and additive. It is this roadmap's only migration. Applied by owner step 6.8 before R3.
- **`supabase/functions/notify/index.ts`**: `{test: true, delay: 10}` waits up to 10 s, so the test can arrive with the phone locked. Deployed by owner step 6.8 before R3.
- **Also:** `supabase/tests/push.test.mjs` gains a TWA environment, and `docs/notifications.md` §5 and §7 gain the app.

**Approach.**
- **Delivery is unchanged.** Delegation keeps the whole Web Push stack: `notify`, tags and topics, receipts, and the 7-step check.
- **Who posts the notification.** Chrome receives the push and hands it to the app, which re-posts it on its own HIGH channel. The app's Android settings then govern it, not Samsung Internet's.
- **Trusting the permission.** The JavaScript permission result is not trusted, because android-browser-helper #563 reports "granted" on One UI 8 while Android blocks the app. The native `areNotificationsEnabled()` and the channel's importance decide instead. They reach the page on the launch URL (`notif=` and `chan=`, Phase 6), so the answer is as of the latest launch. A live answer over the TWA postMessage channel (Chrome 115+) is possible later; choosing it would add the PostMessage wiring to Phase 6's Create list.

**Acceptance.** "Works perfectly" means all ten checks pass on Louie's Samsung, and checks 1–4 also pass on one non-Samsung Android phone from the closed test.
1. With the app closed and the phone locked, a test shows a heads-up with sound or vibration within 10 s, and the status bar shows the silhouette.
2. The delayed test, started from the home screen, also pops up.
3. Each kind opens the right page inside the app: the 2-day and 2-hour reminders, lineups (`show=starters`), half-time, the result (Box score action), and a statline.
4. The 2-hour reminder replaces the 2-day one on the lock screen.
5. **Check this phone** passes all seven steps and names the `android-twa` settings.
6. Settings → Apps → Epinoia → Notifications shows Game alerts set to Alert, with pop-up on.
7. With Samsung Internet's subscription turned off, one notification arrives, not two.
8. After a force stop and a reboot, the next real reminder still arrives.
9. Denying the permission makes **Check this phone** fail its permission step. Allowing it from the settings button and relaunching the app passes that step and restores delivery.
10. `last_push_status` is 201 on the app's subscription.

**Gate.** If check 1 or 2 still fails with the channel at HIGH, the pop-up style on Detailed and the battery unrestricted, add native FCM in the same package. That means data messages built natively on `epinoia_alerts`, a `native_push_tokens` table (`push_devices` is taken), and an FCM v1 sender in `notify`.

**Effort:** M, plus XL if the gate fails.

### Phase 8 — Play Store release

**Files.**
- **An audit of every write and upload reachable under `/epinoia/`** (`me/`, `app/`, `admin/`, `broadcast/`, `score/`, `clockcam/`, `edit/`, `join/`), because the app shows every page, not only the fan pages. It feeds Data safety (6.7 step 7). Data safety declares at least:
  - Personal info: Name, Email address (accounts, Google sign-in profile, player records)
  - Photos and videos (uploads from admin, broadcast and edit)
  - Other user-generated content (scores, rosters, news)
  - App activity (follows)
  - Device or other IDs (push subscriptions)
  - Clock Cam's camera: declared only if any frame leaves the phone
- **`epinoia/privacy/index.html`**: an "Epinoia on Android" section, and a `#delete` anchor that pre-selects erasure. The section:
  - says the app is the website shown in Chrome;
  - lists what the account holds (email, name, follows, push subscription details);
  - says clubs enter player records, including minors' birth years (`app/app.js:660`);
  - says email goes through Resend;
  - states there are no ads or tracking and that notifications are optional.
- **`epinoia/me/`**: a "Delete my account" link to `privacy/#delete`, so deletion can be started inside the app, as Play's account-deletion rule requires.
- **The Play listing** describes what the app adds to the website: the native Game alerts channel, the native notification settings screen and the offline page.
- **The download page and `version.json`**: a Play badge once the app is live. An optional Play upload step in `android.yml`.

**Approach.** Calendar time dominates, not code.
- **Closed test first.** A personal developer account created after 13 Nov 2023 needs 12 testers opted in for 14 consecutive days before production.
- **Deadlines.** New apps must target API 36. Android developer verification starts on 30 Sep 2026 in Brazil, Indonesia, Singapore and Thailand, and worldwide in 2027, so register the package and key early.
- **Listing assets.** A 512px icon, a 1024×500 feature graphic and phone screenshots, all taken during Phase 6.

**Acceptance.**
- No crashes in the pre-launch report.
- Data safety matches the audit and the privacy page, and the deletion URL opens the erasure form.
- The reviewer account named under App access reaches the staff areas.
- "Delete my account" on the profile page opens the erasure form inside the app.
- Production access is granted.
- A Play install updates a GitHub-installed app in place.
- `version.json` has its `play` field set.

**Effort:** S of code, then 4–6 weeks of calendar time from the first closed-test upload.

## 5. Order and releases

| release | phases | what users see | effort |
|---|---|---|---|
| R1 | 0 | Statistics works on phones | M |
| R2 | 1–4 | HOME with fixtures, stars and leagues; the wordmark and HOME tab; the countries redirect; the installed web app opens on HOME | L + M + M + S |
| R3 | 6–7 | The Android app, downloadable from the website, with notifications | L + M |
| R4 | 5 | Global scouting | XL |
| R5 | 8 | Epinoia on Google Play | S + 4–6 weeks |

The app comes before global scouting. It depends only on Phase 1, it fixes today's notification bug
on Louie's Samsung, and it starts Play's clock (12 testers for 14 days, 4–6 weeks overall), which is
the longest wait in the plan. The closed test can run while Phase 5 is built.

## 6. Owner's steps

These are Command Prompt commands. Each block starts with `cd /d`. Steps 6.2–6.7 run outside the
website repo folder, because the repo is public and the signing key must never be committed. Step
6.8 must run inside it, because the Supabase CLI is linked there.

**6.1 Supabase sign-in.**
- **Before R2: redirects.** In the Supabase dashboard, open Authentication → URL Configuration → Redirect URLs, and check that `https://prophesyscouting.co.uk/epinoia/**` is listed.
- **Before R3: the sign-in code.** Open Authentication → Email Templates → Magic Link, and make sure the message includes `{{ .Token }}` (for example "or enter this code: {{ .Token }}"). The app signs in by that code, because the link itself finishes in the phone's default browser. Once a test email shows the code, have the lead set `emailOtp: true` in `epinoia/config.js`; until then the in-app code field stays hidden.

**6.2 Before Phase 6: install Java,** which provides keytool. Afterwards, open a new Command Prompt
so the PATH change applies.

```bat
cd /d %USERPROFILE%
winget install --id EclipseAdoptium.Temurin.17.JDK -e --accept-source-agreements --accept-package-agreements
```

**6.3 Create the signing key (once, ever).** keytool asks for a password twice. Keep that password
in a password manager; with PKCS12 the key uses the same password. The `-list` line asks for the
password again and prints the certificate: copy the line that starts with `SHA256:` (not the
`SHA256withRSA` one) and give it to the lead for `assetlinks.json`. The last line backs the key up
to a USB stick (change `E:` to the stick's drive letter). **If the file or its password is lost,
installed apps can never be updated.**

```bat
cd /d C:\Users\Admin\Documents
mkdir epinoia-android-key
cd /d C:\Users\Admin\Documents\epinoia-android-key
where keytool
keytool -genkeypair -v -storetype PKCS12 -keystore epinoia.jks -alias epinoia -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Epinoia, O=Prophesy Scouting, C=GB"
keytool -list -v -keystore epinoia.jks -alias epinoia
copy epinoia.jks E:\epinoia.jks
```

**6.4 Set the GitHub secrets and check gh's workflow scope.** The two password lines prompt for a
value: paste the keystore password into both. The last line shows gh's token scopes.

```bat
cd /d C:\Users\Admin\Documents\epinoia-android-key
powershell -NoProfile -Command "[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\Users\Admin\Documents\epinoia-android-key\epinoia.jks'))" | gh secret set ANDROID_KEYSTORE_B64 --repo MadvillainQuas/website
gh secret set ANDROID_KEYSTORE_PASSWORD --repo MadvillainQuas/website
gh secret set ANDROID_KEY_ALIAS --repo MadvillainQuas/website --body epinoia
gh secret set ANDROID_KEY_PASSWORD --repo MadvillainQuas/website
gh secret list --repo MadvillainQuas/website
gh auth status
```

Only if the "Token scopes" line has no `workflow`, run this too:

```bat
cd /d %USERPROFILE%
gh auth refresh -h github.com -s workflow
```

This makes sure gh's own token has the workflow scope. The lead's push of `android.yml` uses that
token through `gh auth git-credential`, not the stored PAT (risk 19).

**6.5 After the workflow is pushed: run the first build.** The wait gives GitHub time to register
the run before it is watched. The last line should show status 200 and
`content-type: application/json`. Once `gh release view` shows `epinoia.apk`, have the lead set
`"released": true` in `epinoia/android/version.json`: only then do Android browsers get the
"Get the Epinoia app" banner, HOME card and profile button (until then they keep the web-app offer).

```bat
cd /d %USERPROFILE%
gh workflow run android.yml --repo MadvillainQuas/website --ref main
timeout /t 15
gh run list --workflow android.yml --repo MadvillainQuas/website --limit 1
gh run watch --repo MadvillainQuas/website
gh release view --repo MadvillainQuas/website
curl.exe -sI https://prophesyscouting.co.uk/.well-known/assetlinks.json
```

**6.6 On the Samsung: Chrome and notifications.** Do this after installing the app.

1. Settings → Apps → Chrome. If the bottom button says **Enable**, tap it. Then update Chrome in the Play Store.
2. Settings → Apps → Chrome → Battery → **Unrestricted**. Chrome receives each push before it reaches the app.
3. Settings → Notifications → Notification pop-up style → **Detailed**.
4. Settings → Apps → Epinoia → Notifications → Allow. Then Notification categories → **Game alerts**: Alert, with pop-up and lock screen on.
5. Settings → Apps → Epinoia → Battery → **Unrestricted**.
6. Settings → Battery → Background usage limits → Never sleeping apps: add **Epinoia** and **Chrome**. Make sure neither is under Sleeping or Deep sleeping apps.
7. Turn Do Not Disturb off, or allow Epinoia as an exception.
8. In the old Samsung Internet web app, go to Profile → Turn off notifications, then remove that web app from the home screen.

You can also check over USB.
1. On the phone, open Settings → About phone → Software information and tap **Build number** 7 times. Then open Settings → Developer options and turn on **USB debugging**.
2. On the PC, install adb:

```bat
cd /d %USERPROFILE%
winget install --id Google.PlatformTools -e --accept-source-agreements --accept-package-agreements
```

3. Open a **new** Command Prompt, so adb is on the PATH. Connect the phone by USB and accept "Allow USB debugging?" on it.
4. Run the lines below. If `adb devices` lists nothing, install Samsung's Android USB Driver for Windows, reconnect the phone, accept the prompt on it again, and re-run.
   - If the `pm` line prints nothing, Chrome is not disabled.
   - The `dumpsys` line should show `mImportance=4`, which means the channel is HIGH.

```bat
cd /d %USERPROFILE%
adb devices
adb shell pm list packages -d | findstr chrome
adb shell dumpsys notification | findstr /i "epinoia_alerts"
```

**6.7 Play Console.** Open the account early; the release itself is Phase 8.

1. At play.google.com/console, create a developer account. A personal account works; an organisation account needs a D-U-N-S number but skips the tester rule. Pay the one-off US$25 fee and complete identity verification. **Play will ask whether you are a trader** (EU Digital Services Act). A trader's address and phone number are shown on the listing to users in the EU. Epinoia plans paid memberships, so choose the account type knowing that: an organisation account shows the business's details, a personal account shows yours (Q27).
2. Create the app: Epinoia, English (United Kingdom), App, Free.
3. Go to App integrity → Play App Signing and choose "Export and upload a key from Java keystore". Download `pepk.jar` and the encryption key into the key folder, then run the exact command Play Console shows. It looks like the `java` line below.
4. Download the AAB with the `gh` line below, and upload it to **Internal testing**.
5. Set up **Closed testing** with at least 12 testers' Google accounts, such as league and club staff. They must stay opted in for 14 consecutive days. Then apply for production access.
6. Fill in **App content**:
   - Privacy policy: `https://prophesyscouting.co.uk/epinoia/privacy/`
   - Account deletion: `https://prophesyscouting.co.uk/epinoia/privacy/#delete`
   - Ads: none
   - App access: some functionality is restricted. Fans sign in with any Google account; scoring can be tried without an account at `https://prophesyscouting.co.uk/epinoia/score/?train=1`; staff areas (team portal, admin, broadcast) use a reviewer account you create for Play and name here.
   - Content rating: complete the questionnaire
   - Target audience: 13 and over
7. Fill in **Data safety** from the Phase 8 audit:
   - Collected: Personal info (Name, Email address); Photos and videos (uploads); Other user-generated content (scores, rosters, news); App activity (follows); Device or other IDs (push subscriptions)
   - Security: encrypted in transit; deleted on request
   - Sharing: none (Supabase and Resend are service providers)
   - SDKs: no ads or analytics SDK

```bat
cd /d C:\Users\Admin\Documents\epinoia-android-key
java -jar pepk.jar --keystore=epinoia.jks --alias=epinoia --output=epinoia-signing.zip --include-cert --rsa-aes-encryption --encryption-key-path=encryption_public_key.pem
gh release download --repo MadvillainQuas/website --pattern epinoia.aab --clobber
```

**6.8 Deploy `notify`, and apply migration 0128.** Run these inside the website repo checkout, where
the Supabase CLI is linked. `git pull` first, so the new code and `0128` are present. If the pull
reports conflicts or local changes, stop and tell the lead. The last line of each block should
print the self-check's JSON. If it prints a 401 error instead, the gateway is checking JWTs:
`config.toml` keeps `[functions.notify] verify_jwt = false`, so deploy again with `--no-verify-jwt`
added.

Before R2, `notify` carries HOME as the fallback for notifications with no link:

```bat
cd /d C:\Users\Admin\Documents\website_repo
git pull
npx supabase@latest functions deploy notify
curl.exe -s -X POST -H "content-type: application/json" -d "{\"diag\":true}" https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/notify
```

Before R3, apply `0128` and deploy `notify` again (the delayed test). `db push` is not
transactional, so compare the migration list before and after: `0128` should show as applied in the
second list, and if the push stopped part-way the second list shows how far it got.

```bat
cd /d C:\Users\Admin\Documents\website_repo
git pull
npx supabase@latest migration list
npx supabase@latest db push
npx supabase@latest migration list
npx supabase@latest functions deploy notify
curl.exe -s -X POST -H "content-type: application/json" -d "{\"diag\":true}" https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/notify
```

## 7. Risks

| # | risk | mitigation |
|---|---|---|
| 1 | The app runs on Samsung Internet (the default browser, or Chrome disabled): no splash, no delegation, today's bug inside an app | Chrome forced in `createTwaLauncher()`; a dialog when Chrome is disabled; step 6.6 |
| 2 | JavaScript reports permission granted while Android blocks the app (One UI 8, android-browser-helper #563) | native POST_NOTIFICATIONS before launch; `areNotificationsEnabled()` and the channel importance reach the page as `notif=` and `chan=` on the launch URL and decide `check()`; check 9 |
| 3 | One UI's Brief pop-up style shrinks heads-up notices even on a HIGH channel, and no app can override it | settings steps in `push.js`, the native settings screen, step 6.6 |
| 4 | The delegation override depends on androidx.browser internals | pin androidbrowserhelper; re-run Phase 7 checks 1–4 on every bump |
| 5 | The signing key is lost, or leaks (public repo; key stored in GitHub secrets) | key kept outside the repo and in `.gitignore` (committed with or before `android/`); no Bubblewrap, which offers to create a key in the checkout; offline backup and password manager; Play App Signing with the same key, so one certificate covers both channels |
| 6 | Old installs keep opening `/epinoia/?source=pwa` | `appmode.js` ships with, or before, the manifest change |
| 7 | A redirect keyed on `m-splash` would also redirect the news archive | keyed on the script tag's `data-water`; covered by `appmode.test.mjs` |
| 8 | The redirect drops sign-in tokens, or HOME never hands them to Supabase | query and hash kept; `epinoiaClientReady()` on HOME; redirect allow-list (6.1) |
| 9 | The referrer and `?source` exist only on first load, so app mode depends on the sessionStorage flag; whether a Samsung Internet install reports standalone is untested | every signal sets the flag; `appmode.js` runs on every manifest-linked page; notification taps with no link go to HOME without needing detection; tested on the Samsung at the Phase 6 gate |
| 10 | `fulltable.js`, `table.css` and `xscroll.js` are shared by six surfaces | Phase 0 and 5 acceptance re-check each one; desktop DOM unchanged when new options are absent |
| 11 | Data volume on phones: a full season is about 11k box-score rows (~18 MB decoded) for scouting, and today's 3.4 s load covers only 20 finals | render each league as it arrives; player rows without `stats->adv` (55% of each row); parallel names; session caches; the Phase 5 phone check (first league 3 s, all leagues 6 s) decides whether season rows are built on the server within Phase 5 (Q25, Q36) |
| 12 | Test games (no competition), `finalising` games that anonymous reads never return, and withheld minors distort global lists | `competitions!inner` everywhere; de-duplicate by id and allow counts to shrink; drop rows with no player name; all tested |
| 13 | On a multi-league page, access fails open, and a member's token is not sent unless access state loads first | `loadMany` awaited first; conservative `locked()`; memberships are off today |
| 14 | BPM and on/off numbers are relative to the player's league, so a global sort can mislead | percentiles within league by default; column titles say so |
| 15 | Men's and women's leagues share one list; there is no category column | league filter; a category column only if asked for |
| 16 | Duplicate notifications from the old Samsung Internet subscription | `client` column and "turn off" on the profile page; step 6.6 |
| 17 | Play's calendar: 12 testers for 14 days, target API 36, developer verification from 30 Sep 2026 | open the account early; the app (R3) ships before global scouting (R4); start closed testing as soon as R3 exists |
| 18 | Play's Payments policy generally requires Google Play Billing for digital subscriptions sold inside a Play app (memberships are off today) | before memberships go on, hide checkout in the Play build or add Play Billing through the Digital Goods API; the GitHub APK is unaffected |
| 19 | A push of a commit that touches `.github/workflows` is rejected when git signs in with the stored PAT, which lacks the workflow scope; refreshing gh's token does not change that PAT | push such commits with `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin main` (`docs/feed-timing.md:118`). Only if `gh auth status` does not list the workflow scope, run `gh auth refresh -h github.com -s workflow` first (6.4) |
| 20 | New pages without `?v=` stamps, or a `sw.js` change without a new `SW_VERSION` | the lead stamps; `guard.yml`; `push.test.mjs` |
| 21 | Cross-document view transitions are unsupported on Samsung Internet | purely decorative; launch smoothness comes from colours and skeletons |
| 22 | Framed links on our own pages open a new window, which leaves the app: strip cards (`strip.js:612`), the strip plate, embed/game `#full`, embed/table `#more` | when the parent page is on our own origin, all of them target `_top`, using the same-origin parent test `leagueLink` already uses (`strip.js:1114-1117`) (Phase 1); Phase 2's in-app strip-card check |
| 23 | Two suites already fail at HEAD: `touchscroll` (1) and `mobile-grids` (2) | `mobile-grids` updated in Phase 0; `touchscroll`'s phone assertions already moved to 820px in the working tree (39/1); the shot-chart case raised separately |
| 24 | Email magic links finish in the default browser, so the app never gets a session and cannot subscribe to account notifications | in the app, email sign-in uses the code: `signInWithOtp({email})`, then `verifyOtp({email, token, type:'email'})` typed into the app (Phase 6); the Magic Link template includes `{{ .Token }}` (6.1) |
| 25 | Play may reject a thin website wrapper (Minimum Functionality) | the listing describes the native Game alerts channel, the native notification settings screen and the offline page (Phase 8) |
| 26 | Play's EU trader declaration shows a trader's address and phone number on the listing | choose the account type knowing it (6.7 step 1, Q27) |
| 27 | A TWA verifies the whole origin, so same-site pages outside `/epinoia/` open full-screen in the app with no URL bar | in app mode, `appmode.js` sends those links to a browser tab (Phase 6, Q30) |
| 28 | The first-launch permission dialog sits between the system splash and HOME | a native pre-prompt in HOME's colour; the no-flash check applies from the second launch (Phase 6) |
| 29 | A reader who chose the dark theme sees the light `#f3faf6` splash fade into a dark HOME: Android cannot read the site's saved theme, and `STATUS_BAR_COLOR_DARK` follows only the phone's system setting | accepted for this release (light is the default theme); if it matters, a `values-night` splash colour covers readers whose phone is also in dark mode |

## 8. Open questions

Each question has a default, which this roadmap uses until Louie says otherwise.

| # | question | default used |
|---|---|---|
| 1 | On phones, drop the TEAM column? Start with PLAYER folded? | TEAM dropped (the crest stays); PLAYER not folded |
| 2 | Presets on phones: a scrolling row or a select? | scrolling row |
| 3 | Show more on desktop Statistics too? | phones only on Statistics; every width on scouting |
| 4 | Allow column resizing on touch screens? | desktop only |
| 5 | Where does the notification bell go on phones? | floats above the tab bar, bottom right; the compare tray pushes it up |
| 6 | Use the phone table at 641–820px (landscape phones, foldables)? | yes, one breakpoint at 820px |
| 7 | Is iOS Safari a target? | cheap fixes only (16px inputs, top safe area); tested on Android |
| 8 | Where does the sidebar's bottom "← EPINOIΛ" row go? | HOME, on the web and in the app (one meaning for the logo), shown as ⌂ EPINOIΛ at the top of the foot; the splash stays reachable at `/epinoia/` |
| 9 | Put the wordmark back at the top of the desktop sidebar? | no; HOME is the sidebar's first heading |
| 10 | How do league pages reach HOME on phones? | no seventh tab; the league "home" tab becomes "league"; HOME via the wordmark (including the league front page's hero) and the HOME row leading the drawer's foot |
| 11 | Should tapping a notification with no link open the splash or HOME on the web? | `/epinoia/home/` for everyone: `sw.js`'s fallback and `pushpayload.js`'s base-plus-link, with `push.test.mjs:659` and `731-732` updated in the same commit, `SW_VERSION` bumped and `notify` redeployed (6.8) |
| 12 | Launch colour: light `#f3faf6` or dark `#04100b`? | light, the default theme; dark-theme users see a light splash for 300 ms |
| 13 | The Clock Cam app's wordmark now leads to HOME. Is that acceptable? | accepted |
| 14 | BCB has only default colours: neutral card, or colours from its logo? | neutral mint until its logo colours are set |
| 15 | Show played and upcoming game counts on league cards? | not included (needs a count query per league) |
| 16 | Should league cards link to the league front page or its table? | front page, `?l=slug` |
| 17 | Daily fixtures: native cards, or extend the embeddable strip? | native `.fxc` cards; the strip embed stays unchanged apart from `_top` on our own pages |
| 18 | Show past games still marked scheduled? | shown for two hours after tip-off on HOME and `/epinoia/games/`, hidden after that |
| 19 | Rank men's, women's and youth leagues together? | together, with a league filter |
| 20 | Which season counts for scouting? | each league's newest `starts_on`, with all its competitions (the Statistics rule); no covering select, where a "league games · cups · everything" select would be the alternative |
| 21 | Default sort and percentile pool for scouting? | PPG; within league, with a toggle to pool all leagues |
| 22 | Premium access differs between leagues: what happens? | premium columns locked for everyone on the page if any included league locks them |
| 23 | A player who moved leagues: one row or two? | one row per league |
| 24 | Should scouting views be shareable? | filters, sort and league in the URL; the compare selection is not kept |
| 25 | Build season rows on the server? | not before Phase 5's phone check; if the first league takes over 3 s or all leagues over 6 s on the Samsung in the app over mobile data, build them within Phase 5, subject to Q36 |
| 26 | Package id? | `uk.co.prophesyscouting.epinoia` |
| 27 | Play account type, and when was it created? | assume a new personal account, so the 12-tester, 14-day rule applies. Play's EU trader declaration shows a trader's address and phone number to EU users; with paid memberships planned, Epinoia likely counts as a trader, so a personal account would show Louie's own details |
| 28 | Which key uploads to Play? | Louie's own key, also used as the upload key (one certificate, one set of secrets); a separate upload key is safer and optional |
| 29 | Chrome state, One UI version and pop-up style on the Samsung? | confirmed at the Phase 6 gate (step 6.6) |
| 30 | Should links outside `/epinoia/` stay in the app? | no. The whole origin is verified, so same-site pages outside `/epinoia/` would open full-screen in the app. In app mode (`html.m-app`), links from `/epinoia/` to paths outside `/epinoia/` get `target="_blank" rel="noopener"`, which opens them in a browser tab. `pathPrefix /epinoia` still decides which outside links open the app |
| 31 | Allow landscape in the app? | allowed (scorer, video); the web manifest stays portrait |
| 32 | Target audience on Play? | 13 and over |
| 33 | Build an iOS app? | out of scope |
| 34 | Does "top 30 most recent" on global fixtures mean nearest to now in both directions, or results only? | nearest to now in both directions, with live games pinned first |
| 35 | Does Louie approve moving the league page's stars into `stars.js`? | not assumed: Phase 3's `home.js` change waits for a yes; the saved BCB fixture must then match exactly |
| 36 | If Phase 5's phone check fails, server-built season rows need a migration (a table or an RPC), which reverses the decision "No database migration for HOME, games or scouting" for scouting. Is that allowed? | ask Louie at that point; until then, no migration |
