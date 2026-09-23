# Private leagues

A league that is not advertised: off the front page, out of search, out of the sitemap. You
are in it because somebody sent you a link. Migrations `0139_private_leagues.sql` and
`0140_roles_before_signup.sql`; the tests are `supabase/tests/privateleagues.test.mjs`.

This is the shape the paid-for league takes — somebody pays Epinoia to run a league for them,
gets a `league_admin` link, and from that point does their own clubs, fixtures, scoring and
invitations without asking anybody. Payment itself is not built; everything it would unlock is.

## It is a third thing, not a degree of members-only

| | listed and searchable | on-court content |
|---|---|---|
| **open** (default) | yes | free |
| **members** (`access_mode`, 0117/0118) | yes — the shop window stays open | needs the `league` feature |
| **private** (`visibility`, 0139) | **no** | open to whoever was let in |

They are two columns because they are two questions. A private league is usually
`access_mode = 'open'`: once you are in, everything is free to you. A private league can also
be members-only, and then it is both.

`visibility` is the platform's decision, not the league's. A trigger refuses any write to it
that does not come through `platform_set_league_visibility`, so a league admin cannot put
their own league back on the front page.

## Doing it

**Make a league private** — platform console → Leagues → *make private* on the league. It
comes off every listing immediately. Its own admins, its clubs' managers and anyone already
let in keep their access.

**Hand it to somebody** — the same card, *invite links* → role **runs the league** → one use.
Only a platform admin can mint this kind; it makes them a real `league_admin`, identical to a
console grant. Send them the link.

**Let people watch** — either console, role **can see the league**. A league admin mints
these themselves, from their own console (§18, *Who can see this league*), which is the point
of handing them the league.

A link is `/epinoia/invite/?i=<token>` — 24 CSPRNG characters. It can carry a label, an
expiry and a number of uses. Revoking kills the link and **leaves everybody who already used
it in**; the guests list below it is how you remove a person.

## What it is enforced by

Everything about who may see a league's content already ran through four functions (0118).
0139 changes those and adds nothing to the policies that call them:

    can_view_league(league)     the per-league answer; asks privacy FIRST, before the
                                open-league shortcut, and does not consult the memberships
                                master switch — a private league must not become browsable
                                because Stripe is not configured
    league_visible(league)      \
    competition_visible(comp)    }  what 0118's restrictive read policies call
    game_visible(game)          /

plus `any_members_league()`, the once-per-statement question that switches the whole
apparatus off while nothing is gated. It is now a one-line alias for `any_gated_league()`,
which counts privacy as gating. While no league is private and none is members-only — how the
platform ships — every policy still answers for a whole statement on a constant.

The genuinely new surface is the shop window, which 0118 deliberately left public: `leagues`
(its read policy is no longer `using (true)` — six pages list straight off that table),
`seasons`, `competitions`, `competition_teams`, `teams`, `roster_entries`.

**`players` is deliberately not hidden.** A person may be in one private league and three
public ones; hiding them would break the public leagues. What they did in the private league
is in the game tables, which the four functions above cover.

**The walk from a row to its league happens inside a security definer function**
(`team_open_to_me`, `season_open_to_me`, `comp_open_to_me`). A policy's own expression runs as
the querying role, so a sub-select over `teams` written into the policy text would itself be
filtered by the policy hiding the club, return NULL, and let every roster row through. The
migration's self-test proves this against a real roster row.

## What it does not do

It is a private league, not a secret one. It hides rows from the API. It does not defend
against somebody who was invited, took the data and passed it on, and it does not reach what
0118's header already lists as outside the database's control: public storage buckets, public
Realtime broadcast topics, the broadcast function's anon reads, and anything a public feed
already publishes at source. **A private league fed from a public LiveStats schedule is
private on Epinoia and nowhere else** — say so to whoever is paying for it.

## Appointing people (0140)

Related, and the reason "it bugs out when they log in" was never a bug in logging in.
`grant_role` and `grant_league_writer` used to refuse an address with no account and tell the
admin to come back once that person had signed in. The coming back is the step that gets
forgotten, and to the new league admin the result is indistinguishable from being locked out.

An unknown address is now stored in `pending_roles` and applied **when that address confirms
its email** — not at sign-up, because Supabase creates the `auth.users` row when an OTP is
*requested*, so an insert-time trigger would hand a league to whoever typed the address first.
Both consoles list what is waiting and can take one back.

Three things fixed on the way past, each in `0140`:

* `memberships`'s unique constraint never fired for a platform-admin grant, because
  `scope_id` is NULL and two NULLs are not equal — so one person could hold several rows.
  Now a partial unique index, with the existing duplicates folded down first.
* `revoke_role`'s "never leave the platform with no administrator" counted rows, so two
  duplicate rows for one person read as two administrators and the guard would have let the
  last real one go. It counts people now.
* `grant_role` took the caller's word for a platform admin's scope. A platform admin scoped to
  a league is not a thing; it is forced to platform scope whatever is sent.

## Edge functions read with the service role, which bypasses RLS

Every function above enforces privacy inside the database, through policies that run AS the
querying role. The service role is not the querying role in an Edge Function — it is Postgres's
own bypass-everything role, used because the functions below need to read across leagues (a fan
notification, a partner feed) in ways RLS would never allow a browser to. That means each one has
to repeat, in code, the check RLS is doing for everyone else. Audited 2026-09-23:

* **`api`** (`supabase/functions/api/index.ts`) — `membersOnly` only asked about `access_mode`,
  so a platform-wide key (`api_keys.league_id` null) could list a private league, read its
  overview/standings/games/players by slug, and read a private-league game's box score by id.
  Fixed: a private league now behaves like an unknown one to any key not scoped to it —
  `/v1/leagues` omits it, `/v1/leagues/{slug}/...` and `/v1/games/{id}` answer 404 (never 403,
  so the response does not confirm the league exists). A key scoped to the league (`leagueScope
  === league.id`) still reads it, same as it already could for a members-only league.
* **`feeds`** (`supabase/functions/feeds/index.ts`) — the `preview` and `test` actions rendered
  `body.gameId` through `loadGame` without checking it belonged to `feed.league_id`, so the
  admin of any league with a data feed could preview (and send) another league's game, private
  or members-only. Fixed: a caller-supplied `gameId` is now rejected with 404 unless its
  competition's season's league matches the feed's own league.
* **`requeue_feed_delivery`** (migration `0037`, re-created in `0146`) — the same gap one layer
  down: it checked that the caller administers the feed's league and never checked that
  `p_game` belonged to it, so it could queue an arbitrary game (any league, private or not) for
  delivery to a feed the caller merely administers. Fixed in `0146_feed_game_league_scope.sql`.
* **`finalise-game`** queues every finalised game into `publish_queue` (a static page plus an OG
  image) unconditionally. Its consumer — whatever job commits those pages — is not in this
  repository, so it could not be audited or fixed here. **Before that job is pointed at a
  server that publishes to the open web, it needs its own check that the game's league is not
  `visibility = 'private'`,** or a private league's results end up statically published outside
  Epinoia entirely, which no RLS policy or Edge Function guard can then undo.
* **`contact`** answered a plain 404 for an unknown `team_id` but, for a real one, always
  disclosed the club's name and whether its form was open — including a private league's club,
  which the service-role lookup sees exactly like any other. Fixed: a team belonging to a
  private league now gets the identical 404 a missing team does, so the response never confirms
  the league or the club exists.

**Not fixed, by design — recorded rather than closed (see "What it does not do" above):**
`ics` and `broadcast` read with the anon key, so 0139/0147's RLS already hides a private
league's rows from them exactly as it does from a signed-out browser. The consequence is that it
hides them from an INVITED user too: a private league's calendar subscriptions and broadcast
overlays do not work for anyone, member or not, until those two are rewritten to check
`league_invited()` for the requesting user rather than reading anonymously.
