# What Genius Sports does that Epinoia does not

Written 2026-08-22, against the platform as it stands at commit `e4233f2`.

Genius Sports is not one product. It is five businesses sold together —
capture, competition management, media, data distribution, and betting — and
only three of them are a fair comparison for what Epinoia is. This note works
through all five anyway, because knowing which parts are *deliberately* absent
is worth as much in a sales conversation as knowing which are missing.

Everything below was checked against the repository rather than remembered, so
"already have" means a table, a function or a page was found, not that it was
on a roadmap.

---

## The short version

Epinoia is **at or ahead of parity on capture, competition management, data
distribution and analytics** for the grassroots-to-national market. It is
behind in four places that a league will actually ask about in a first meeting,
three of which are cheap to close:

| Gap | Why a league asks | Effort |
|---|---|---|
| **Official scoresheet (PDF)** | It is the legal record of the match. Federations require one signed. | Low |
| **Referees on the game record** | Every federation result page names the officials. `game_officials` only carries statisticians. | Low |
| **Fixture notifications** | "Will my clubs be told when their game moves?" Resend is already wired for the contact form. | Low–medium |
| **Video tied to the play-by-play** | The single biggest thing Genius sells. A cheap version is very achievable. | Medium |

And two that should be **declined on purpose**, with a straight answer ready:
optical player tracking, and betting/integrity feeds.

---

## 1. Data capture

**Genius:** LiveStats (they own the FIBA scoring app), GeniusLive, and optical
capture through Second Spectrum — computer vision generating tracking data from
fixed or broadcast cameras.

**Epinoia already has:** a browser scoring app that is local-first and survives
a hall with no signal; an append-only event log with retraction-based
correction; FIBA LiveStats and CSV import producing records indistinguishable
downstream from a game scored in-app; a shared engine executed identically in
the app, on the site and on the server.

For a league scoring its own games this is parity, and the offline behaviour and
the gesture-driven UI are arguably better suited to a volunteer statistician on
a phone than LiveStats is.

### Gap 1.1 — the official scoresheet — **build, low effort**

The scorer exports JSON. A competition governed by a federation needs a
**scoresheet as the legal record of the match**: the FIBA-format A3 sheet, with
running score, fouls by period, timeouts, signatures. It is what gets referred
to in a protest.

This is a rendering problem, not a data problem — every figure on the sheet is
already derived. A print stylesheet over a generated layout, `window.print()` to
PDF, would cover most of it without a PDF library.

Worth flagging: this is the single most common reason a federation says "we
can't move off our current system".

### Gap 1.2 — referees on the record — **build, low effort**

`game_officials` exists but carries `role text default 'statistician'`. There is
no referee, crew chief or umpire, and none appear on a box score. Every
federation results page names the officials, and referee societies expect their
appointments to be visible.

The table already supports it; what is missing is the role vocabulary, an
appointment UI and a line on the box score.

---

## 2. Competition and event management

**Genius:** competition and event management, registration and membership
platforms for national federations, officials appointment, discipline.

**Epinoia already has:** seasons and competitions, groups, round-robin and
double-round fixture generation with date assignment and home/away balancing,
cups and knockout brackets, standings with **configurable tiebreakers**
(`points`, `h2h`, `h2h_diff`, `diff`, `scored`), team sanctions (points and wins
deductions), player suspensions with games-served tracking and appeal lifting,
season awards and a Team of the Year ballot.

That is a genuinely strong competition module — the tiebreaker configuration and
the suspension-served logic in particular are things smaller platforms skip.

### Gap 2.1 — registration and eligibility — **build, medium effort, high sales value**

There is no player registration workflow. `players.birth_year` exists "for
eligibility only" and `player_previous_clubs` records history, but there is
nothing that models:

- a club registering a player, and a league approving or rejecting it
- registration and transfer **windows** with dates the system enforces
- dual registration (a player turning out for two teams legitimately)
- age-group eligibility, or overage limits
- a player being flagged ineligible *before* they appear in a box score

The governance module can sanction a team retrospectively for fielding an
ineligible player — `0045_league_governance.sql` has exactly that test — but
nothing prevents it at the point of scoring, which is what a registrar wants.

For a federation this is often the *primary* system of record and the reason
they buy. It is a bigger piece of work than anything else on this list.

### Gap 2.2 — officials appointment — **build, medium effort**

No availability calendar, no appointment of referees to fixtures, no fees or
expenses. Referee assignment is a weekly administrative job in every league of
any size, and it is currently done in a spreadsheet by somebody who would rather
not.

### Gap 2.3 — venue and slot conflict detection — **build, low effort**

`games.venue` is a free-text column. The scheduler generates rounds and assigns
dates but does not know that two fixtures have been put in the same hall at the
same time, or that a team is playing twice on one day. A conflict check at
generation time is a small piece of work with a visible payoff on the first
season a league schedules.

### Gap 2.4 — payments — **partner, do not build**

League fees, match fees, fines, referee payments. Genius does this; so does
every grassroots competitor (LeagueApps, SportsEngine, PlayHQ). Building
payments means handling money, refunds and disputes, which is a business
decision rather than an engineering one. If it is ever needed, integrate Stripe
rather than implement it.

---

## 3. Media and fan engagement

**Genius:** federation websites and CMS, automated OTT streaming from fixed
courtside cameras, highlight and clip automation, fan data products.

**Epinoia already has:** a hosted competition site, club portals with
self-service rosters and crests, news with an approval workflow and AI-assisted
match reports, merchandise generated from club crests, social account links,
embeddable widgets, and a partner feed.

### Gap 3.1 — video — **the real differentiator, and a cheap version exists**

There is no video anywhere in the platform: no stream URL on a fixture, no
clips, no highlights.

Genius's expensive version — automated cameras, AI production, OTT delivery —
is not a solo-developer project and should not be attempted. But there is a
version that is, and it is disproportionately valuable:

1. A **stream URL on a fixture** (YouTube, Facebook, a club's own player), shown
   on the game page and in the ticker while live. Effort: hours.
2. **Play-by-play timestamps mapped onto the video.** The event log already
   stores a game clock on every event, and the scorer knows when the stream
   started. Given those two things, every row of the play-by-play becomes a link
   that jumps the video to that moment — click a made three, watch it.

Point 2 is a feature that Synergy and Hudl charge four figures a season for, and
Epinoia is one timestamp offset away from it because the event log already
carries what it needs. **This is the highest-leverage thing on this document.**

3. Clip export per player or per action type falls out of (2) almost free.

### Gap 3.2 — notifications — **build, low–medium effort**

Nothing tells anybody anything. No email when a fixture moves, no result summary
to a club secretary, no "your team plays tomorrow", no push subscription for a
fan following a team.

Resend is already wired up for the contact form
(`supabase/functions/contact/index.ts`), so the transport exists and the work is
the triggers, the templates and a preferences table.

This is the kind of gap a league does not think to ask about in the demo and
complains about in month two.

### Gap 3.3 — internationalisation — **defer**

The platform is English only (`<html lang="en">`, no translation layer). Only
worth doing if a non-UK federation is a real prospect; it is a large, invasive
change to retrofit and premature before then.

---

## 4. Data distribution

**Genius:** official data rights, sportsbook feeds, in-play trading data,
integrity monitoring.

**Epinoia already has:** a read-only JSON API with per-consumer keys, rate-limit
headers and pagination echoed on every response; per-partner push on
finalisation in JSON, CSV or XML with configurable sections, name order and date
format; outbound webhooks; usage accounting (`api_usage`); and an audit log.

For the market Epinoia sells into, this is **ahead** of what most competitors
offer — grassroots platforms typically have no API at all.

### Gap 4.1 — betting feeds and integrity — **decline deliberately**

Official data rights, sportsbook distribution and bet-monitoring are a
regulated business built on exclusive rights deals with federations. It is not a
feature that can be added; it is a different company. Worth having a one-line
answer ready, because a national federation may ask.

### Gap 4.2 — bulk season export — **build, low effort, high trust value**

Games export individually and the API pages through everything, but there is no
"download this entire competition". The question *"what happens to our data if
we leave you?"* comes up in every platform sale, and the strongest possible
answer is a button that hands over the season — event logs included — in one
file.

Cheap to build, and it makes a fear into a selling point.

### Gap 4.3 — the audit log is not visible — **build, low effort**

`public.audit_log` is written to but no admin screen reads it. A league
administrator cannot currently see who changed a result, who lifted a
suspension, or who deleted a fixture. The data is already being captured; it
needs a page.

---

## 5. Analytics

**Genius:** tracking-derived analytics through Second Spectrum — shot quality
from defender distance, player movement, automated tagging.

**Epinoia already has:** box scores, play-by-play, lineup stints, with-or-without
analysis, on/off, four factors, shot charts binned by area, and BPM. For a
league below the professional tier this is well ahead of the field — most
competitors stop at points, rebounds and assists.

### Gap 5.1 — optical tracking — **decline deliberately**

Requires camera hardware in every venue and a computer-vision pipeline. Not a
gap to close; a category not to enter.

---

## Suggested order

If the aim is the strongest possible answer in a sales meeting for the least
work:

1. **Scoresheet PDF** — removes the commonest objection from governed leagues.
2. **Referees on the game record** — small, and conspicuous by its absence.
3. **Bulk season export** — turns a standard buyer fear into a differentiator.
4. **Audit log screen** — the data is already there.
5. **Venue and double-booking conflict checks** — visible on first use.
6. **Fixture and result notifications** — the transport is already wired.
7. **Video: stream URL on a fixture, then play-by-play timestamps into it** —
   the one genuinely differentiating feature on this list, and closer than it
   looks because the event log already carries the clock.

Registration and eligibility is the largest item and the one that decides
whether a federation can move across at all — worth starting only once a
specific federation is in the conversation, because the rules differ enough
between them that building it speculatively risks building the wrong one.
