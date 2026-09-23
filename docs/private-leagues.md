# Private leagues

A league that is not advertised: off the front page, out of search, out of the sitemap. You
are in it because somebody sent you a link. Migrations `0139_private_leagues.sql`,
`0140_roles_before_signup.sql` and `0147_private_league_games.sql`. The tests are in
`supabase/tests/privateleagues.test.mjs`.

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
is in the game tables, which the rules in the next section cover — *not* the four functions
above. This page said otherwise until 0147, and it was wrong.

**The walk from a row to its league happens inside a security definer function**
(`team_open_to_me`, `season_open_to_me`, `comp_open_to_me`). A policy's own expression runs as
the querying role, so a sub-select over `teams` written into the policy text would itself be
filtered by the policy hiding the club, return NULL, and let every roster row through. The
migration's self-test proves this against a real roster row.

## The game tables (0147)

The game tables never went through the four gates. They answer to three older rules, and
the notifications to four fan-outs of their own:

| what | answered by |
|---|---|
| `games`, `game_officials`, and the anon RPCs `game_tip_wallclock`, `league_channel_for_game` | `can_read_game` |
| `game_events`, `game_state`, `player_game_stats`, `team_game_stats`, `lineup_stints` | `can_read_game_rows` (0136) |
| `player_season_stats`, `team_season_stats` (owner-rights views, which no policy reaches) | the views' own `vis` CTE |
| result, player line, half-time, lineups and fixture notifications | `notify_game_final`, `notify_halftime`, `notify_lineups`, `notify_fixture_windows` |
| standings, awards, brackets, news, suspensions, TOTY, advanced stats, video and video jobs, highlight jobs, external games | 0118's restrictive policies → the four gates above (0139 already covered these) |

`can_read_game_detail` is the reference version of the detail rule, which the 0084/0118 tests
compare against. No policy has called it since 0136, and it gets the same change.

Each of the rules had 0118's shortcut: `access_mode = 'open'`, or memberships switched off,
→ `true`, before `can_view_league` (the only part that knows about privacy) was asked. A
private league is `access_mode = 'open'`, so it took the shortcut. Until 0147, a signed-out
visitor could list a private league's finished games and read their play-by-play, box scores,
stints and season totals, while the league row itself was correctly hidden. Nothing was
exposed in practice, because no private league had a game yet.

0147 puts one line in front of each shortcut:

    and (l.visibility is distinct from 'private' or public.league_invited(l.id))

Privacy is asked first, and then the paywall exactly as before. A public league, and a game
with no league, answer on their own row and get exactly the answer they got before. Somebody
who is invited meets the league the way the public meets a public one: all of an open private
league; in a members-only one, the fixtures while the league keeps them public, and the rest
with the `league` feature (or all of it while memberships are switched off). The staff
branches are untouched. The two clubs' managers, the game's officials and the league's
admins still see the game, so a visiting club's manager still sees their own cup tie.

The fan-outs get the same line through `league_invited_for`. A follower hears about a private
league's game only if they were let in. **A phone that followed through a league website's
notification button (`push_devices`) has no account, so it is never "let in", and it is never
told about a private league's games.** This includes someone who follows a *player*: players
are never hidden, and one may be followed from a public league.

Every definition 0147 restates is its predecessor plus lines tagged `-- 0147`.
`privateleagues.test.mjs` §24 checks that. It also checks that the **latest** definition of
each rule and fan-out, in any migration after 0147, still asks about privacy. A later file
that copies one of these from an older version would quietly undo the fix, which is how 0137
undid 0127.

## What it does not do

It is a private league, not a secret one. It hides rows from the API. It does not defend
against somebody who was invited, took the data and passed it on, and it does not reach what
0118's header already lists as outside the database's control: public storage buckets, public
Realtime broadcast topics, the broadcast function's anon reads, and anything a public feed
already publishes at source. **A private league fed from a public LiveStats schedule is
private on Epinoia and nowhere else** — say so to whoever is paying for it.

Nor does it reach the Edge Functions that read with the service role. They bypass RLS, so
each one has to ask about privacy itself. As of 0147, the JSON API (`functions/api`) checks
only `access_mode`, so a platform-wide API key can list a private league and read its box
scores. League-scoped keys are limited to their own league.

**Known gaps, found while fixing 0147 and not yet closed:**

- `announcements` is readable signed out, and `post_announcement` tells every follower of the
  league's clubs.
- `team_staff_public`, `team_socials`, `embed_sites`, `feed_competitions`, published
  `merch_designs` and active `access_plans` list a private league's rows to anyone.
  `league_officials` lists them to any signed-in account.
- `game_report_target(game)` (callable signed out) returns a private league's name for a
  game id.
- `notify_device_follow` names a private league in its error message ("this website is not
  set up for <name> notifications") to anyone who guesses its slug.
- The `feeds` Edge Function renders whatever `gameId` it is sent, and never checks that the
  game belongs to the feed's league. So the admin of any league with a feed can `preview` any
  other league's game, private or members-only, and read back the whole payload.

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
