# Memberships — paid access to analytics and to members-only leagues

Written 2026-09-16. This is the contract every part of the build is written
against: the database, the `billing` Edge Function, the browser module and the
consoles. Change it here first.

---

## 0. Words, because three of them are taken

"Membership" is what a fan sees and pays for. In code the word is already used
three times for other things, so none of the new objects use it:

| already means | where |
|---|---|
| a person's **role** (league admin, team manager, statistician) | `public.memberships`, `league_members()` |
| a **federation register** (Basketball England numbers, eligibility) | `epinoia/membership.js` / `EpinoiaMembership`, `membership-sync`, `membership_eligibility`, `membership_status()` |
| Web Push | `push_subscriptions` |

New objects use **`access_`** in the database, **`EpinoiaAccess`** in the
browser, and **`billing`** for the Edge Function that talks to Stripe.

---

## 1. What is sold

Two **features**. A feature is a text key; everything that decides access
compares against these and nothing else.

| key | unlocks |
|---|---|
| `analytics` | the advanced analytics: the **events** splits (second chance, transition, off turnovers, after timeout, assisted/unassisted) on every screen; the **zone** analytics (tinted twelve-zone shot charts, zone tables, zone and expected-eFG columns); the **game flow**, **connections** and **events** tabs of every box score; the **full WOWY** screen (non-members get a preview) |
| `league` | a **members-only league** at all: its results, box scores, live games, statistics, standings, awards, news and video |

**Plans** bundle features at a price. A plan is either

- a **platform plan** (`league_id` null) — sold by Epinoia, applies in every
  league. A platform plan may carry `analytics` only, never `league`: a league
  that closes its doors does so for its own members, and Epinoia does not sell
  its way past that; or
- a **league plan** (`league_id` set) — applies in that league only, may carry
  `league`, `analytics` or both. When the league has connected a Stripe account
  (§5) the money goes to the league less Epinoia's fee.

**Grants** give features without payment: press passes, club officials, a
sponsor's guests, a refund-by-goodwill. They are keyed on an **email address**,
so a grant can be issued before the person has ever signed in and takes effect
the moment they do.

**Staff never pay for their own league.** Platform admins, and a league's admins,
statisticians and writers, hold every feature in that league. **Club managers hold
`league` only**, not `analytics`: a manager can appoint further managers by email
(`grant_role`), so counting them as full staff would let any club hand Epinoia's
analytics to anybody.

---

## 2. What each league decides

Three columns on `leagues`, changed ONLY through the RPCs (a trigger refuses a
direct PATCH, which `leagues_write` would otherwise allow a league admin):

| column | values | set by | meaning |
|---|---|---|---|
| `access_mode` | `open` (default) / `members` | league admin or platform admin, `set_league_access` | `members` hides everything that happened on court from anyone without `league` |
| `access_fixtures_public` | boolean, default `true` | same | in `members` mode, upcoming fixtures (status `scheduled`) stay public, because a league that wants people through the door must say when the doors open |
| `analytics_access` | `inherit` (default) / `free` / `members` | **platform admin only**, `platform_set_league_analytics` | overrides the platform default for this league (a sponsor paying for free analytics, for instance). League admins cannot set it: it is Epinoia's product |

And two platform settings:

| `platform_settings` key | value | public | set by | meaning |
|---|---|---|---|---|
| `memberships_enabled` | `false` (as shipped) / `true` | yes | **platform admin only**, the master switch at the top of the platform console's Plans tab (`platform_set_setting`, audited as `platform_setting`) | **the master switch.** While it is not the JSON boolean `true`, nothing is gated anywhere: every league can be seen and the analytics are free, whatever `access_mode`, `analytics_access` or the default below say. The settings are kept and can still be changed; they apply the moment it is switched on |
| `analytics_access` | `"free"` (as shipped) / `"members"` | yes | platform admin, Plans tab | the default for every league on `inherit` (applies only while `memberships_enabled` is on) |

**As shipped nothing changes for anyone:** memberships are switched off, every
league is `open`, the platform default is `free`. Leagues can set themselves up
(members only, plans, grants) while the switch is off; nothing is enforced until
a platform admin switches memberships on, which is the last step of going live
(`docs/switch-on.md` §6.12), once a plan can be bought and payments are live.

### What a members-only league still shows to everyone

The shop window stays open, because a paywall nobody can find sells nothing and
a page that errors looks broken rather than closed:

- the league row itself (name, crest, colours, appearance), its seasons and
  competitions, its clubs and their crests, squads and player names;
- upcoming fixtures, while `access_fixtures_public` is on;
- its plans and prices.

Behind the wall: games that are live or final (and unscheduled ones when fixtures
are private), every event, state, box score and stint, season tables, standings,
brackets, awards and Team of the Year, news articles and match reports, video and
highlight rows, the external feed tables.

### What a members-only league does NOT yet protect

Stated in the console before a league switches, and tracked in
`docs/outstanding.md`:

1. **Public storage buckets** — photos, crests and highlight MP4s are served from
   public URLs that no policy can refuse. Needs private buckets + signed URLs.
2. **Realtime channels** `game:<id>`, `bcast:<id>`, `epinoia:live` are open
   broadcast topics (see the open-game-channel finding). Live frames of a
   members-only game can be heard by anyone who knows the id.
3. **The `broadcast` function and overlays** read with the anon key, so a
   members-only league's own on-air graphics go blank until a signed overlay
   token exists. A league that streams should stay `open` until then.
4. **Fed leagues**: when a league's data comes from a public FIBA LiveStats feed,
   the raw play-by-play is already public at source. The paywall protects the
   presentation and the analysis, not the facts.
5. **Partner feeds, webhooks and API keys the league itself configured** keep
   working — that is the league's choice, not a leak.

---

## 3. Two kinds of enforcement, and why

**A members-only league is enforced by the database.** Row-level security refuses
the rows; no page, script or API call can get them.

**Premium analytics are enforced by the page.** Every one of them is *computed in
the browser* from `game_events` and the box-score rows, which the free box score
itself needs. Refusing those rows would take the free box score down with the
analytics. So a non-member's page draws a teaser in place of the analysis, and
someone determined could rebuild the numbers from the free play-by-play — exactly
as they could from FIBA's own public feed. What is sold is the analysis and its
presentation, not the facts. Moving the analytics server-side (an `analytics`
function that returns computed splits to entitled callers, with `stats.sit` moved
off the public row) is roadmap work, not this build.

The client therefore **fails open for analytics** (if the access check cannot be
made, show the analytics — nothing is protected by hiding them on an error) and
**fails closed only on a known answer for a league** (the paywall card is drawn
only when the server has said `can_view = false`; the rows are refused by the
database either way).

---

## 4. Database contract

Migrations: `0117_access_plans.sql` (tables, rules, RPCs) and
`0118_members_only_leagues.sql` (enforcement across existing tables, views and
RPCs). Every function below is `security definer`, `set search_path = public`,
with explicit `revoke ... from public, anon` / `grant ... to <roles>` and an
ownership pin, and each migration ends by calling what it created, impersonating
real roles (the 0115 `P0115` pattern — never `RESET ROLE`).

### 4.1 Tables

```
access_plans (
  id uuid pk default gen_random_uuid(),
  league_id uuid null references leagues on delete cascade,
  name text not null (1..60),
  blurb text (<= 400),
  features text[] not null   -- non-empty, subset of {analytics, league};
                             -- 'league' only when league_id is not null
  price_pennies int not null >= 0,
  currency text not null default 'gbp'  -- lower-case ISO 4217
  interval text not null in ('month','year'),
  stripe_price_id text null  -- ^price_[A-Za-z0-9]+$ ; null = not yet purchasable
  seller text not null default 'platform' in ('platform','league'),
                             -- 'platform': charged on Epinoia's Stripe account (every
                             --   platform plan; a league plan only when a PLATFORM admin
                             --   says Epinoia is the seller)
                             -- 'league': a league plan charged on the league's own
                             --   connected account (direct charge, Epinoia takes
                             --   fee_percent); stripe_price_id is a price ON THAT ACCOUNT
                             -- a league admin can only create 'league' plans
  active boolean not null default true,
  sort int not null default 0,
  created_at, updated_at timestamptz)
  RLS select: active or is_platform_admin() or (league_id is not null and is_league_admin(league_id))
  no write policies

access_customers (user_id uuid -> auth.users on delete cascade,
                  stripe_account_id text not null default '',  -- '' = Epinoia's own account
                  stripe_customer_id text not null, created_at,
                  primary key (user_id, stripe_account_id))
  RLS on, NO policy (service role only). A customer is per Stripe account: a league
  selling on its own account has its own customer object for the same person.

access_checkouts (id uuid pk, user_id uuid not null -> auth.users on delete cascade,
                  plan_id uuid -> access_plans on delete set null,
                  stripe_session_id text unique, stripe_account_id text,
                  consent_version text not null,       -- which wording they agreed to
                  acknowledged_at timestamptz not null,-- express consent + loss of the
                                                       -- 14-day right once access starts
                  adult_confirmed boolean not null,
                  created_at)
  RLS on, NO policy. The evidence CCR 2013 regs 14/16/37 ask for, written before the
  redirect to Stripe, so it exists even if the webhook never arrives.

access_subscriptions (
  id uuid pk, user_id uuid not null -> auth.users on delete cascade,
  plan_id uuid null -> access_plans on delete set null,
  league_id uuid null -> leagues on delete cascade,   -- copied from the plan
  features text[] not null,                          -- copied from the plan at purchase
  status text not null,        -- Stripe's own words: incomplete, incomplete_expired,
                               -- trialing, active, past_due, canceled, unpaid, paused
  stripe_subscription_id text unique not null,
  stripe_customer_id text not null,
  stripe_account_id text null,         -- null = Epinoia's account; else the league's
  current_period_end timestamptz, cancel_at_period_end boolean not null default false,
  trial_end timestamptz, ended_at timestamptz,
  cooling_off_waived_at timestamptz,   -- evidence for the CCR 2013 acknowledgement
  created_at, updated_at)
  RLS select: user_id = auth.uid() or is_platform_admin()
              or (league_id is not null and is_league_admin(league_id))
  no write policies

access_grants (
  id uuid pk, league_id uuid null -> leagues on delete cascade,
  email text not null (lower-cased on write),
  features text[] not null (subset, non-empty),
  note text, granted_by uuid -> auth.users on delete set null,
  expires_at timestamptz null, revoked_at timestamptz null, created_at)
  RLS select: lower(email) = lower(auth.email()) or is_platform_admin()
              or (league_id is not null and is_league_admin(league_id))
  no write policies

billing_events (id text pk,  -- Stripe event id: idempotency
                type text not null, received_at timestamptz default now(),
                processed_at timestamptz, error text)
  RLS on, NO policy

league_billing_accounts (league_id uuid pk -> leagues on delete cascade,
  stripe_account_id text unique, charges_enabled bool default false,
  payouts_enabled bool default false, details_submitted bool default false,
  fee_percent numeric(5,2) not null default 10 check 0..100,  -- platform admin sets
  updated_at)
  RLS on, NO policy; status only through league_access_admin() / platform_access_admin();
  fee through platform_set_league_fee(p_league uuid, p_fee numeric) (platform admin)
```

### 4.2 Rules

| function | grant | returns |
|---|---|---|
| `access_active(p_status text, p_period_end timestamptz)` | internal (immutable-ish helper, stable) | `active`/`trialing` → true; `past_due` → true while `p_period_end + 7 days > now()`; everything else false |
| `access_features_for(p_user uuid, p_league uuid)` | **service_role only** (revoked from anon/authenticated) | `text[]`: `{analytics,league}` if `p_user` is staff of `p_league` (platform admin; or league_admin / statistician scoped to the league; or writer in `league_writers`; or team_manager of a team whose `league_id = p_league`); else the distinct union of features from active subscriptions (platform plans: their features minus `league`; league plans for `p_league`) and live grants (not revoked, not expired, email = the user's `auth.users.email`, league null or `p_league`) |
| `access_features(p_league uuid default null)` | anon, authenticated | `access_features_for(auth.uid(), p_league)`; `{}` when signed out |
| `access_analytics_mode(p_league uuid)` | anon, authenticated | `'free'` or `'members'`: the league's `analytics_access` unless `inherit`, else the `analytics_access` platform setting, else `'free'` |
| `can_view_league(p_league uuid)` | anon, authenticated | `true` when `p_league` is null, the league does not exist, or its `access_mode = 'open'` — **decided before any feature lookup, so an open league costs one primary-key read** — else `'league' = any(access_features(p_league))` |
| `can_view_league_for(p_user uuid, p_league uuid)` | service_role only | same, for another user (fan-outs) |
| `can_use_analytics(p_league uuid)` | anon, authenticated | `access_analytics_mode(p_league) = 'free' or 'analytics' = any(access_features(p_league))` |
| `access_state(p_leagues uuid[] default null)` | anon, authenticated | see 4.3 |
| `access_plans_public(p_league uuid default null)` | anon, authenticated | `jsonb` array of active plans: platform plans + that league's, ordered by `league_id nulls first, sort, price_pennies`; each `{id, league_id, name, blurb, features, price_pennies, currency, interval, purchasable}` (`purchasable` = `stripe_price_id is not null`) |
| `my_access()` | authenticated | `{subscriptions:[{id, plan_id, plan_name, league_id, league_name, league_slug, features, status, active, current_period_end, cancel_at_period_end}], grants:[{id, league_id, league_name, features, expires_at, note}], has_customer}` |
| `set_league_access(p_league uuid, p_mode text, p_fixtures_public boolean)` | authenticated; league admin | `{ok, access_mode, fixtures_public, warnings:[text]}` — warns (does not refuse) when switching to `members` with no active purchasable plan carrying `league` |
| `platform_set_league_analytics(p_league uuid, p_mode text)` | authenticated; platform admin | `{ok, analytics_access}` |
| `save_access_plan(p jsonb)` | authenticated; league admin for a league plan, platform admin for a platform plan | `uuid`. Keys: `id` (update when present), `league_id`, `name`, `blurb`, `features`, `price_pennies`, `currency`, `interval`, `stripe_price_id` (`''` clears), `active`, `sort`. A plan's `league_id` never changes after creation. Validation errors are sentences with errcode `22023` |
| `platform_set_league_fee(p_league uuid, p_fee numeric)` | authenticated; platform admin | `void`; upserts `league_billing_accounts.fee_percent` (0–100) |
| `archive_access_plan(p_plan uuid)` | same rights | `void`, sets `active = false` (existing subscribers keep their subscription) |
| `grant_access(p_league uuid, p_email text, p_features text[], p_expires timestamptz, p_note text)` | authenticated; league admin (league grants) / platform admin (`p_league` null) | `uuid` |
| `revoke_access_grant(p_grant uuid)` | same | `void` |
| `league_access_admin(p_league uuid)` | authenticated; league admin | `{league:{id,slug,name,access_mode,fixtures_public,analytics_access,analytics_mode}, plans:[...all fields but stripe ids shown as has_price boolean + stripe_price_id...], members:[{email, plan_name, features, status, active, current_period_end, cancel_at_period_end, created_at}], grants:[{id,email,features,expires_at,revoked_at,note,created_at}], counts:{active, past_due, ended, grants}, payouts:{connected, charges_enabled, payouts_enabled, fee_percent}}` |
| `platform_access_admin()` | authenticated; platform admin | `{analytics_default, plans:[every plan incl. league_name], leagues:[{id,slug,name,access_mode,fixtures_public,analytics_access,active_members,plans}], totals:{active_subscriptions, past_due, grants}}` |

Every write RPC audits: `insert into audit_log (actor, action, subject, subject_id, detail)` with snake_case actions `set_league_access`, `set_league_analytics`, `save_access_plan`, `archive_access_plan`, `grant_access`, `revoke_access_grant`.

`whoami` is NOT changed.

The `leagues` guard: `before update of access_mode, access_fixtures_public, analytics_access` refuses (`42501`) unless the transaction-local setting `epinoia.access_rpc` is `'on'`, which only the two setter RPCs set.

### 4.3 `access_state`

Callable signed out. `p_leagues` null → no per-league entries.

```json
{
  "signed_in": true,
  "memberships_enabled": false,      // the master switch (§2, §8); off = nothing gated
  "analytics_default": "free",
  "leagues": [{
    "id": "…", "slug": "…", "name": "…",
    "access_mode": "open", "fixtures_public": true,
    "analytics": "free",             // access_analytics_mode
    "features": ["analytics"],       // the caller's, in this league
    "can_view": true, "analytics_ok": true,
    "has_plans": true                // an active plan applies here (platform or league)
  }],
  "subscriptions": 1                 // count of the caller's active subscriptions
}
```

### 4.4 Enforcement (0118)

- `can_read_game(p_game)` and `can_read_game_detail(p_game)`: the PUBLIC branches
  (scheduled/final/live+public_live) are AND-ed with
  `case when l.id is null or l.access_mode = 'open' then true
        when g.status = 'scheduled' and l.access_fixtures_public then true   -- can_read_game only
        else public.can_view_league(l.id) end`.
  The staff branches are unchanged. Copy the LATEST definitions.
- The inlined `game_events` / `game_state` read policies (0084) get the same
  condition, and 0084's equivalence self-test is re-run against the new
  `can_read_game_detail`.
- `player_season_stats` and `team_season_stats` (owner-rights views) gain the
  condition in their WHERE clause with identical columns.
- RESTRICTIVE `for select to anon, authenticated` policies, through helpers
  `competition_visible(uuid)`, `game_visible(uuid)` and `league_visible(uuid)`
  (each: null → true, open → true, else `can_view_league`), on `standings`,
  `bracket_ties`, `season_awards`, `season_award_overrides`, `team_sanctions`,
  `player_suspensions`, `toty_ballots`, `toty_candidates`, `toty_results`,
  `feed_team_season`, `news_articles`, `game_advanced`, `external_games`,
  `game_videos`, `video_jobs`, `highlight_jobs`. A restrictive SELECT policy also
  constrains UPDATE/DELETE with RETURNING and upserts, so staff must pass it —
  they do, because staff hold `league`.
- Anon-callable definer RPCs that return on-court content check visibility
  inside: `news_public`, `news_article`, `season_awards_resolved`, `toty_public`,
  `toty_ballot_public`, `cast_toty_vote`, `bracket_summary`, `broadcast_images`,
  `season_leaders`, `officials_for_game`.
- Fan-outs `notify_game_final` and `notify_fixtures` skip followers for whom
  `can_view_league_for(user, league)` is false (fixtures only when fixtures are
  private).

As built, three things go beyond the text above:

- `game_visible` also passes the people in `game_officials` for that game, as
  `can_read_game` already did — otherwise a per-game statistician could not see
  or save the video rows of the game they are scoring.
- The access helpers answer `true` for the **service role**, so `finalise-game`,
  the API and the ingest worker keep seeing members-only leagues. A caller with no
  JWT claims at all (pg_cron, direct SQL) is treated as anonymous: never run
  `compute_season_awards` for a members-only league that way, it would see no games.
- `news_public` and `toty_public` are dropped and re-created (their grants
  restored exactly), because their shapes came from bare `create` statements.

---

## 5. `billing` Edge Function

One function, `verify_jwt = false` (Stripe cannot send a Supabase JWT), routing
on the body's `action`, and on the path for the webhook. Stripe is called with
plain `fetch` — no SDK — pinned to **`Stripe-Version: 2026-08-26.dahlia`**. Pure
logic lives in `supabase/functions/_shared/billing.js` (signature verification,
form encoding, parameter builders, subscription mapping, email wording) and is
unit-tested in `supabase/tests/billing.test.mjs`.

Dahlia facts the code depends on: the period end is on the subscription ITEM
(`items.data[0].current_period_end`), not the subscription; an invoice names its
subscription at `parent.subscription_details.subscription`; leave `ui_mode` unset
(hosted page).

| call | auth | does |
|---|---|---|
| `POST /functions/v1/billing {action:'status'}` | none | `{configured, connect}` — whether the secrets are set |
| `POST … {action:'checkout', planId, next, consent:{version, acknowledged:true, adult:true}}` | signed-in JWT | refuses without both acknowledgements; resolves the plan (active, purchasable); for `seller='league'` requires the league's connected account with `charges_enabled` and sends `Stripe-Account` + `subscription_data[application_fee_percent]`; reuses or creates the customer for that account (`access_customers`); writes `access_checkouts` BEFORE calling Stripe; creates a Checkout Session `mode=subscription`, `line_items[0][price]`, `client_reference_id`=user id, `metadata` AND `subscription_data[metadata]` = `{user_id, plan_id, league_id, consent_version, checkout_id}`, `allow_promotion_codes=true`, `custom_text[submit][message]` stating the price and renewal, `success_url` = SITE_URL + next + `joined=1`, `cancel_url` = SITE_URL + next; an idempotency key per checkout row. Returns `{url}` |
| `POST … {action:'portal', subscriptionId?, cancel?, next}` | signed-in JWT | Customer Portal session on the right account for that subscription (or the platform customer); `cancel:true` deep-links `flow_data[type]=subscription_cancel` → `{url}` |
| `POST … {action:'connect', leagueId, next}` | league admin JWT (checked through the caller's token with `is_league_admin`) | creates the league's full-dashboard connected account if missing (`controller[stripe_dashboard][type]=full`, `controller[fees][payer]=account`, `controller[losses][payments]=stripe`), returns an `account_onboarding` link `{url}` |
| `POST /functions/v1/billing/webhook` | `Stripe-Signature` | verifies over the RAW body (any `v1`, 300 s tolerance, ignore `v0`) against `STRIPE_WEBHOOK_SECRET`, or `STRIPE_CONNECT_WEBHOOK_SECRET` when the event carries `account`; records the event id (a repeat is acknowledged with 200 and skipped); for `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `invoice.upcoming` works out the subscription id, RE-FETCHES it (with `Stripe-Account` when `event.account`), and overwrites the `access_subscriptions` row; `account.updated` refreshes `league_billing_accounts`. One-off emails fire only on the FIRST delivery of an event |

**Emails** (Resend, `RESEND_API_KEY` + `CONTACT_FROM`, as the `contact` and
`notify` functions already do; skipped with a note when unset):

- on first activation — the durable-medium confirmation CCR 2013 reg 16 asks for:
  what was bought, price per period, that it renews until cancelled, how to cancel
  online, and the consent wording they agreed to (by `consent_version`);
- when `cancel_at_period_end` becomes true or the subscription ends — the
  end-of-contract notice (DMCCA 2024 s.261, 24 hours; not yet in force, cheap now);
- `invoice.payment_failed` — update your card, with the portal link;
- `invoice.upcoming` on a yearly plan — the renewal reminder (DMCCA s.258).

As built, beyond the table: the webhook tries **every configured signing
secret** rather than choosing one from `event.account` (which would trust a field
before it is verified); checkout answers 503 without `STRIPE_WEBHOOK_SECRET` (and,
for league-sold plans, without `STRIPE_CONNECT_WEBHOOK_SECRET`), because a sale
whose confirmation can never arrive must not be taken; buying a plan already held
answers 409; and a customer or connected account created in **test mode** is
replaced once when the live key does not know it, so moving from test to live on
one database does not strand anybody.

Secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optional
`STRIPE_CONNECT_WEBHOOK_SECRET`, `SITE_URL` (`https://prophesyscouting.co.uk/epinoia/`
— `notify` and `ics` append paths to it; `billing` reads only its origin). Without the secret key every action
but `status` answers `503 {error:'payments are not switched on yet'}`. `next` is a
same-origin path starting `/epinoia/`, validated like `signin.js` does.

**Before a league sells on its own account:** HMRC's digital-platform rule can
make Epinoia the VAT supplier of league memberships even under direct charges.
Get an accountant's view first; the console says so next to the Connect button.

---

## 6. Browser contract — `epinoia/access.js`, `window.EpinoiaAccess`

UMD, loaded right after `config.js` on every page that shows gated content.

```js
EpinoiaAccess.FEATURES        // { analytics:{label, blurb, includes:[…]}, league:{…} }
EpinoiaAccess.CATALOGUE       // what counts as premium — the ONE place to move things between tiers
  .gameTabs                   // ['flow','connections','events']
  .columnPrefixes             // ['ev_','evd_','z_']
  .columns                    // ['pred_efg','efg_sh','efg_vs','morey']
  .presets                    // the full-table preset ids that are wholly premium
  .barKeys(key)               // player-profile bar keys that are premium
  .wowyPreviewMax             // 1
await EpinoiaAccess.load({ leagueId, leagueSlug })   // either one; a slug is resolved to its id
                              // with a public leagues read. Idempotent per league; resolves
                              // the state; never throws; gives up after 4 s (fail open)
EpinoiaAccess.get(leagueId)   // { known, signedIn, accessMode, fixturesPublic, analytics,
                              //   features, canView, analyticsOk, hasPlans }
EpinoiaAccess.analyticsOk(leagueId)   // boolean; TRUE when unknown or on error (fail open)
EpinoiaAccess.canView(leagueId)       // boolean; TRUE unless the server said false
EpinoiaAccess.isPremiumColumn(key)    // boolean
EpinoiaAccess.teaserHTML({ leagueSlug, title, lines, compact })   // escaped HTML string
EpinoiaAccess.paywallHTML({ league }) // the members-only card
EpinoiaAccess.joinHref({ leagueSlug, next })   // '<root>join/?l=…&next=…'
EpinoiaAccess.authHeaders()           // {} or { Authorization:'Bearer …' } — only for a
                                      // members-only league the viewer may see, token unexpired
EpinoiaAccess.onChange(fn)            // state changed (load, sign-in, sign-out)
```

Shared components take a flag rather than reading access themselves, so a page
decides once and passes it down:

- `EpinoiaWowy.render({ …, preview: true })` — combinations capped at
  `CATALOGUE.wowyPreviewMax` subjects, with a compact teaser line beneath.
- `EpinoiaWithUI.render({ …, locked: true })` — a compact teaser in place of the
  teammate comparison.
- `EpinoiaShotChart.renderZones({ …, zones: false })` — the court and the makes
  and misses only: no zone tints, labels, chips or table.
- `EpinoiaTable` (fulltable.js) takes `opts.leagueId`; when
  `EpinoiaAccess.analyticsOk(leagueId)` is false it drops premium columns from the
  table, the column drawer, the `*` preset and the CSV export, and shows a preset
  whose every non-id column is premium as locked (clicking it shows the teaser).
  `Table.PRESETS` itself is not changed.

Preview switch for admins and for testing: `localStorage.epinoia_access_sim` =
`'locked'` (behave as a non-member everywhere) or `'member'`. Client-side only —
it changes what the page draws, never what the server returns.

---

## 7. Pages

- `epinoia/join/` — plans and prices for the platform and `?l=` league, what each
  unlocks against what is free, sign-in hand-off (`signin/?next=`), the
  pre-checkout step, checkout redirect, and the `?joined=1` return that waits for
  the webhook to land. The pre-checkout step is where the law lives
  (CCR 2013 reg 14 / Sch 2, DMCCA 2024 Sch 23 when it commences, CMA209):
  - a summary shown apart from the terms: the price per period **including any
    VAT**, that it renews automatically until cancelled, how to cancel online
    (from Your account, any time, in one step), and the 14-day cancellation right
    and when it is lost;
  - checkbox 1 (required): "Start my access now. I understand that access begins
    straight away, so once it has started I lose my 14-day right to cancel." —
    `consent_version` names this wording, e.g. `2026-09-a`;
  - checkbox 2 (required): "I am 18 or over." with a line that a parent or guardian
    can buy for a junior;
  - the order button says what it does and what it costs: "Pay £4.99 a month and join".
- `epinoia/me/` — a Membership section: active plans, renewal or end dates,
  grants, "Manage billing" (portal).
- League console — section **06j Memberships & access**: mode and fixtures,
  plans, members, grants, payouts (Connect), and the list in §2 of what is not
  yet protected.
- Platform console — **Plans** tab: the platform default, platform plans, every
  league's modes and analytics overrides, totals.

---

## 8. As built after review (supersedes the sections above where they differ)

A three-lane adversarial review (SQL, billing, browser) and a fix round landed
before the first deploy. Where this section and §1–§7 disagree, this section is
right.

**The master switch (0117 / 0118, browser, consoles)**

- `memberships_enabled()` (stable, security definer, anon/authenticated/service_role,
  owner postgres) is true only when the `memberships_enabled` setting is the JSON boolean
  `true`; missing, null or any other value is **off**. 0117 seeds it `false`, public.
- While it is off: `can_view_league` and `can_view_league_for` answer true (asked right
  after the open check, so an open league still costs one read); `access_analytics_mode`
  answers `'free'`, so `can_use_analytics` is true; `access_state` adds a top-level
  `memberships_enabled` and reports `can_view` / `analytics_ok` true and `analytics`
  `'free'` for every league while still giving each league's **stored** `access_mode`.
- `access_analytics_configured(p_league)` (service role only; called by the definer
  functions) is the rule as configured. `access_analytics_mode` is it while the switch is
  on and `'free'` while it is off. `league_access_admin()` returns top-level
  `memberships_enabled` and its `analytics_mode` is the **configured** mode;
  `platform_access_admin()` returns `memberships_enabled` and a **configured**
  `analytics_default` — the consoles show and edit what will apply.
- `set_league_access` keeps working while it is off and, when the mode is `members`, warns
  first: "Memberships are switched off for the whole platform, so this league stays open
  until a platform admin switches them on." Setting `open` adds no switch warning (the
  league is open either way). `save_access_plan`, `grant_access` and the rest are unchanged.
- The platform admin flips it with `platform_set_setting('memberships_enabled', true|false)`
  (0044: platform admins only, audited as `platform_setting`). League admins and strangers
  are refused.
- 0118: `any_members_league()` is `memberships_enabled() and exists (members league)`, so
  the once-per-statement fast path in every restrictive policy and in `league_visible`,
  `competition_visible` and `game_visible` also covers "switched off". The inlined read
  policies (`events_read`, `state_read`, `pgs_read`, `tgs_read`, `ls_read`), `can_read_game`
  and `can_read_game_detail` treat `not (select public.memberships_enabled())` like an open
  league; both season views' materialised league CTE does the same; `notify_game_final`
  and `notify_fixtures` skip the per-follower lookup while it is off.
- Self-tests: every block that expects a refusal switches memberships **on** inside its own
  rolled-back block first. With it **off** they prove anon and a signed-in stranger see a
  members-only league (final game, events, clock state, box scores, stints, standings,
  news, suspensions, season views; row by row against `can_read_game_detail`), get
  `access_state` can_view / analytics_ok true with `memberships_enabled` false, get free
  analytics with the platform default and the league both at members, may ask for a reel
  of its game, see its private fixture, and are sent its result and fixture; that
  `set_league_access` warns; that a non-boolean value is off; that only a platform admin
  flips it, audited; and that the setting is `false` again after each migration.
- Browser: `access.js` maps it to `membershipsEnabled` (a payload without the key reads as
  on). A known state with `membershipsEnabled: false` answers `canView` and `analyticsOk`
  true whatever else it carries; the `epinoia_access_sim` preview still wins, so an admin
  can preview the gating before switching on. `authHeaders` ignores the switch on purpose:
  a member's token keeps riding for a members-mode league, so switching on does not empty
  the league for members whose page still holds the switched-off answer. `join.js` and
  `home.js` treat a league as closed only when it is members only **and** the switch is on.
- Consoles: the platform console's Plans tab opens with **Memberships: off / on** and a
  confirm that lists what switching on enforces (members-only leagues by name and count,
  the analytics default, leagues with members-only analytics, and a warning when no
  platform plan can be bought) or that switching off opens everything at once and keeps
  every setting; the Settings tab sends `memberships_enabled` to the Plans tab, as it does
  `analytics_access`. The league console's 06j starts with "Memberships are switched off
  for the whole platform. You can set this league up now; nothing is enforced until a
  platform admin switches memberships on." while it is off.

**Database (0117 / 0118)**

- `access_active(p_status, p_period_end, p_past_due_since)` replaces the two-argument
  version. `active`/`trialing` count while `p_period_end` is null or less than 7 days
  past, so a subscription whose webhooks stopped arriving (a test-mode purchase after
  the switch to live keys, for one) expires on its own. `past_due` counts for 7 days
  from **when it became past due**, not from the period end, which Stripe moves forward
  when it raises the renewal invoice.
- `access_subscriptions` gains `cancel_at`, `livemode`, `synced_at`, `past_due_since`
  and `welcomed_at`.
- **The only writer is `billing_apply_subscription(p_row jsonb, p_fetched_at timestamptz)`**
  (service role). It takes features and league from the plan row. It is a compare-and-set
  on `synced_at`, so an older fetch never overwrites a newer one. It returns the
  transitions `first_active`, `ending_started` and `ended`, which decide the emails.
- `my_access()` and `league_access_admin()` return `cancel_at` and `livemode`;
  `platform_access_admin()` returns each league's `fee_percent`; `access_state()` adds a
  top-level `analytics_ok` (pages with no league) and a per-league `has_league_plans`.
- **Rights:** club managers hold `league` only; league admins may grant only `league`
  (an `analytics` grant needs a platform admin); a league-sold plan containing
  `analytics` must cost more than £0.
- **A pre-existing hole is closed:** `memberships_admin_write` let a league admin
  insert a `platform_admin` row. The policy now refuses it, `is_platform_admin()` and
  `access_features_for` require `scope_type = 'platform'`, and a check constraint pins
  `(role = 'platform_admin') = (scope_type = 'platform')`. The migration refuses to
  apply if live rows break that rule; find them with
  `select * from memberships where (role = 'platform_admin') <> (scope_type = 'platform');`.
- `highlight_jobs_ask` requires `game_visible(game_id)`, so a non-member cannot have a
  members-only game rendered into the public highlights bucket.
- `pgs_read`, `tgs_read` and `ls_read` are inlined the way 0084 inlined `events_read`,
  and both season views filter through a materialised CTE over leagues, so a members-only
  season page checks access once per league rather than once per row.
- `any_members_league()` puts a once-per-statement fast path in front of every
  restrictive policy and visibility helper: while no league is members-only, nothing is
  evaluated per row at all.
- `game_visible` passes the two clubs' managers and the league's admins, as
  `can_read_game` does. `player_ban` hides suspensions in competitions the caller cannot
  view.
- Every helper used inside a policy or view is executable by `anon`, `authenticated` and
  `service_role`, asserted with `has_function_privilege`.
- The self-tests always run the anonymous and signed-in-stranger checks. When the push
  role cannot create `auth.users` rows, they borrow existing role-less profiles inside the
  rolled-back block, and a notice says which half ran.

**Billing function**

- Checkout fetches the Stripe price first and refuses (409) unless amount, currency,
  recurring interval (count 1), type and `tax_behavior = inclusive` match the plan row, so
  the price shown and consented to is the price charged.
- **Test mode:** with a test secret key, only platform admins and the addresses in the
  optional `BILLING_TEST_EMAILS` secret can check out.
- A subscription is treated as ending when `cancel_at_period_end` **or `cancel_at`** is
  set. Checkout sessions default to flexible billing mode on this API version, and a
  portal cancellation there sets `cancel_at`.
- **Emails:** welcome, "will end" and "ended" are sent from the RPC's transitions, so a
  retried or out-of-order delivery neither loses nor repeats one. Payment-failed goes out
  only on the first attempt; the yearly renewal reminder stays event-driven. The welcome
  email quotes the consent wording only when a checkout row for that user and plan
  recorded it.
- Stripe errors that could carry key or account detail reach the browser only as a
  generic sentence; the detail goes to the function log.

**Browser**

- `access.js` renews an expired session itself (the SDK where the page has loaded it;
  otherwise a refresh-token call, written back in the SDK's own storage shape, under a
  cross-tab lock) before asking `access_state`, so a member returning after an hour is
  not drawn the paywall. New exports: `sessionReady()`, `safePath()`, `get().hasLeaguePlans`.
- A failed background re-check never replaces a known answer.
- `next` redirects (join, access, sign-in) accept only same-origin paths under
  `/epinoia/`; control characters, backslashes, `%5c` and `//` are refused.
- The table and strip embeds load `access.js` and send the member's token.
- `data.js` keys its in-flight request sharing on the token as well as the path.
- The player page waits for the access answer before its first league read; its career
  table loads access for every league the player appears in. A game or player with no
  league follows the platform's analytics default through `load({})`.
