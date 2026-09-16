# Epinoia as the engine behind Basketball England — roadmap (v3)

**v3, 2026-09-16: THE GOAL IS TO REPLACE PLAYHQ.** Louie's decision after v2:
"the road ahead is full replacing PlayHQ". v3 keeps v2's evidence (sections 1
and 8 are unchanged) and re-orders the plan around replacement. The modules
PlayHQ lacks are built first, **on Epinoia's own data model**, so they sell now
and become the first pieces of the replacement rather than throwaway
integrations. Parity with everything PlayHQ does follows. Cutover happens at a
contract boundary, one tier at a time.

**v2, 2026-09-16 (same day as v1).** v1 was written from Basketball England's
(BE) own documents and general research on governing-body platforms. It
**underestimated PlayHQ**, the system BE already runs on. v2 rebuilds the plan
from a dedicated PlayHQ pass:

- all 338 public PlayHQ help-centre articles, with dates
- the PlayHQ API specification (37 operations and 58 webhook events) and its
  data-warehouse feed documentation
- PlayHQ's trust centre and newsroom
- the NBL Rules & Regulations 2026-27 and Academy Rules 2026-27, with every link
  in them followed
- BE's 16 live Wufoo forms, its FAQs, and its board and AGM minutes
- mature basketball deployments of PlayHQ (Basketball Victoria and the other
  Australian states)

A skeptic pass then re-opened every source behind a reclassification, and its
corrections are applied below. Anything not confirmed on a primary page is
marked *unverified*. The published Artifact is drawn from this file.
Workstream ids are stable; new ones in v2 are `F6-0`, `F6a/b/c`, `F7`,
`C1a/C1b`, `A1a/A1b` and `R8`.

---

## 1. The situation

### What PlayHQ actually runs for Basketball England

PlayHQ is Australian-founded. In December 2025 it signed a binding agreement to
join Alpine Software Group, which is private-equity backed; completion has not
been announced. BE runs on PlayHQ's separate UK/EU stack (`api.euprod.playhq.com`,
on AWS; region unpublished). PlayHQ holds **ISO/IEC 27001:2022**, with a GDPR
attestation and penetration testing on its trust centre (no SOC 2 or Cyber
Essentials listed). The NBL regulations define it as "the official Basketball
England membership and competition management system". Affiliated clubs and
leagues pay nothing extra for it.

| area | what PlayHQ does for BE (confirmed) |
|---|---|
| people | account holder plus dependants; name and date of birth locked; one registration per role; profile claiming; admin merges (need three or more matching fields, irreversible); **Stripe Identity** ID checks for national-league players (under-16s checked by hand); visa share code |
| membership | rolling 365-day memberships with grace period and renewal prompt; fee variants, vouchers, family discounts, custom questions; new-player approval |
| compliance gating | **Know Your People DBS status flows into PlayHQ automatically** and holds a registration at Pending; **Learning Nexus** course status gates registration; only BE compliance can override; safeguarding self-declarations are now registration questions (three sensitive ones are BE-only; the rest are visible to BE, league and club) |
| clearances, blocks, permits | **International clearance** statuses (live 7–8 Sep 2026; Super Admin only; automatic block; *no FIBA integration*); **temporary registration blocks** (Jul 2026); **season permits** for basketball (Oct 2025; used for the narrow NBL 17.5 junior exemption); game permits where enabled |
| transfers | a transfers module (player-initiated; current club → association → new club; basketball local timeouts auto-approve). **BE's use is unverified**: Reg 21 still cites the "membership portal" that closed in Aug 2025 |
| discipline | incidents with outcomes warning / fine / suspension (free-text length plus dates); suspensions block line-ups **tenant-wide**; T/U/D counts; reports. Automatic suspension is football-only, with "other sports" promised. **BE's use is unverified**, though BE's FAQ markets "automate fines, suspensions". Tenant-wide scope conflicts with NBL 49.19 (national competitions only) |
| competitions | organisations → seasons → divisions ("Grades" renamed Jul 2026); conferences (May 2026); **AI grading** (Jun 2026); fixture generation with slots, byes and exception dates; venues and courts with clash warnings across associations; results types Final (including forfeits and disqualification) / Cancelled / Abandoned with ladder effects; manual ladder adjustments; up to five ranking priorities including a head-to-head mini-ladder that restarts |
| team entry | NBL entry through PlayHQ with mid-May invitations (1,092 entries in Jul 2025, invoiced through the shop in three instalments); new clubs use a Wufoo form |
| fixture changes | **game change requests used by BE** (NBL 25.4, and academy 6.14.2): a 1–28-day window, association override, history. Requests **expire** rather than auto-accept, and **carry no fee**, so BE applies its 2 September auto-accept and its £15/£25/£100 fees outside the system |
| eScoring | mandatory across the NBL (31.1); PIN sessions, seven-day offline download, device locked to a court, offline sync by 23:59. BE-specific builds: named Crew Chief and Scorer mandatory, **digital signature from every named official** before submission, coach line-up sign-off (beta). Officials' names are **free text**. **Fill-in players** are allowed by the software and banned by BE's rules (31.1.4), so BE checks after the game; PlayHQ already turns fill-ins off for Basketball NSW and Tasmania, so it can do the same per tenant |
| statistics | basketball stats in PlayHQ are **GP, F, 1PT, 2PT, 3PT and PTS only** (no attempts, rebounds, assists, turnovers or minutes); no LiveStats, Genius or Synergy integration |
| payments | one checkout split between BE and club (payouts via Stripe and Hyperwallet; UK clubs onboard through PayPal approval); clubs pay **1.8%** on the fees they collect; participants pay a separate, **non-refundable PlayHQ platform service fee** (UK rate unpublished); card, PayPal Pay in 4, Apple/Google Pay, Click to Pay; **club-fee instalments** (Jul 2026, which delivers BE's promise of monthly *club* payments; national and membership fees stay upfront); Payment Requests (public pay links, including "incident fines"); Xero. In-platform refund flows are Rugby Canada only; BE is on the "Limited Access – Refunds" beta. No Direct Debit found |
| engagement and data | HoopsHQ app (live scores, play-by-play, leaderboards, **offline digital licence cards**, a Player IDs page for team staff; rated 4.6 in the UK App Store, where the most common complaint is shallow stats); posts and push; Mailchimp; **websites at £245/yr** (paid to PlayHQ at checkout); AnalyticsHQ (including churn prediction) and Report Builder 2.0 with uploaded datasets; admin access audit log; MFA enabled for BE admins (SMS codes work only for Australian/NZ numbers, so UK admins probably use an authenticator app) |
| API | a **public tier** (GET only, `x-api-key` + tenant): fixtures, ladders, game summaries (including `isFillIn`) and grade stats. A **partner tier**, needing a formal agreement: registration and profile webhooks, game events, referee linking, live-streaming links, a signed results URL. A **data-warehouse file feed**: profiles, competition registrations (with season-permit dates and a previous-registration link for transfers) and claimed profiles. Webhooks are set up by hand; rate limits are unpublished. **Not exposed anywhere:** membership expiry, DBS, ID check, accreditation, clearance, block or suspension state. Registration status is only PENDING_ACTIVATION / REGISTERED / CANCELLED. **No write access** for results, fixtures, sanctions or statuses. Live-game webhooks: the help centre says cricket and AFL only; the spec says all sports (*unresolved*) |

**PlayHQ ships for BE almost monthly.** Since September 2025 it has delivered, by
name for BE:

- offline cards
- a by-month fixture view for participants
- officials' digital signatures and coach line-up sign-off (beta)
- season permits
- conferences
- AI grading
- temporary blocks
- international clearance
- Limited Access admins (beta)

**Any feature-level gap may close within a season.**

**BE's board record on PlayHQ is positive.**

- **October 2025:** "well received, with improved e-scoring and calendar
  integration", while "challenges remain with manual processes and system
  alignment".
- **December 2025:** positive progress on adoption.
- **February 2026 AGM:** feedback positive.

"Dysfunctional and problematic" was the AGM's word in January 2025 for the
portal *before* PlayHQ. In the 2025 transition, the minutes call the payment
system transition "smooth"; there were also two weeks of payout problems and
phone support cut to 11:00–15:00. The PlayHQ contract term is not public. A
search summary claiming a December 2025 PlayHQ "renewal" is wrong: that minute
renewed the Wilson ball deal.

### What still runs outside PlayHQ — verified

**Sixteen live BE Wufoo forms:**

| form | rule |
|---|---|
| new club registration | club standards |
| Level 1 and Level 2 club accreditation (two forms) | club standards |
| NBL new club entry | 10.1.3 |
| NBL facility form | 33.2 |
| NBL scoresheet submission (paper fallback, by 23:59) | 31.1.2 |
| disciplinary report (crew chief / umpire) | 49 |
| abandonment report | 25 |
| officials performance feedback (club reports on referees) | 42.11 |
| officials late payment | 41.5.3 |
| NBL/WNBL handbook club update (fixture secretary and similar changes) | — |
| internal club transfer | 22 |
| player exemption | — |
| notice of intention to appeal | 49.5.1 |
| full appeal (£250 / £100 deposit) | 49.5.2 |
| protest and dispute, one form (£100; with a "captain signed under protest" box) | 50.5, 51.1 |

**Everything else outside PlayHQ:**

- the International Clearance Request Form still required alongside PlayHQ's
  clearance status (17.10.2b)
- passport and visa documents through BE's Contact Us form, alongside Stripe ID
- postponements agreed "in writing" between clubs (25.6)
- change-request auto-accept and fees applied by hand
- the 49.16 fixed-penalty schedule
- **referee appointments**: BE appoints D1/D2 referees on **Who's The Ref**
  (WEBBA has also moved its senior appointments there); home clubs appoint D3
  and Junior NBL referees and all table officials and statisticians, with no
  evidenced system
- officials paid by **BACS** (41.5.2)
- **FIBA LiveStats** mandatory for D1 (31.4–31.6) and for EABL/WEABL (academy
  6.8); BE's NBL stats page **links out** to Genius Sports
- webcasts under BE's Live Streaming Policy
- **Synergy** video uploads
- **MyConcern** for safeguarding cases
- **Sport Structures** for coaching courses (whether results reach PlayHQ is
  unverified)
- academy leagues:
  - all academy players registered in **AoC Sport's SportLomo** (3.8)
  - **CBL** on paper, with results in SportLomo
  - EABL/WEABL results into PlayHQ within 6 hours, with WhatsApp only as a
    fallback for games with neither LiveStats nor eScoring

**BE scale and calendar (unchanged from v1):**

- ~43,000–50,000 members
- 1,114 NBL teams in 2026/27
- ~9,000 fixtures
- 10 regions
- 69 affiliated local leagues
- membership opens early July; the season opens early September; 31 January is
  the licence and transfer deadline; team entry invitations go out mid-May
- the GB governance consultation closes March 2027
- Sport England's funding cycle ends 2027
- new CEO since May 2026
- Strategy 2025-29 targets 100,000 members and £1.5m non-grant revenue

### Epinoia today

Unchanged from v1 in substance:

- **Ahead of the field:** statistics, analytics, video, broadcast and the FIBA
  LiveStats ingest.
- **Built:** live scoring, fans and notifications.
- **Just built:** paid access (supporter subscriptions, members-only leagues).
- **Partial:** fixtures, standings and officials.
- **Dormant:** discipline.
- **Absent:** people, clubs, registration and payments for fees.

**One structural fact v1 missed: Epinoia is not at the table for NBL games.**
PlayHQ eScoring is mandatory there. Epinoia's route into NBL match data is the
LiveStats feed it already ingests (D1 and EABL/WEABL), and PlayHQ's public API
for the rest.

**Security found in this work:**

- the finalise-game reopen hole: **fixed and pushed** (migration 0116)
- a **league admin could promote themselves to platform admin** through the
  roles table: fixed in the membership migration (0117), not yet deployed

---

## 2. Strategy (v3: replace PlayHQ)

### The decision and what follows from it

**Replacement is the goal.** v2's "Route A" is no longer the destination. It
becomes **stage 1 of the replacement**: the modules below are built natively
(persons, organisations, registrations and competitions in Epinoia's own model)
and run *alongside* PlayHQ only until the cutover.

1. **Build natively, integrate lightly.** Every stage-1 module uses Epinoia's
   own foundations (F1–F5), with PlayHQ's public API and BE's CSV exports as
   *seed and reconciliation data*. Nothing waits on a PlayHQ partner agreement,
   which a declared competitor is unlikely to get and should not depend on.
2. **Earn the right to replace.** Stage 1 wins BE's trust where PlayHQ is
   absent: statistics compliance, casework, officials. Stage 2 builds parity
   (R8 is the acceptance checklist). Stage 3 migrates at the contract boundary.
3. **Assurance early, not last.** ISO 27001 is PlayHQ's baseline. Cyber
   Essentials Plus, a DPIA and a WCAG 2.2 AA statement land in 2026/27;
   ISO 27001 before any tender.
4. **Portability is a first-class workstream.** Everything PlayHQ holds that BE
   needs back (people, registrations, qualifications, DBS dates, discipline
   including carried-over suspensions, history) must be extractable. Prove the
   path early with a pilot organisation's data, and put BE's exit and
   data-return terms on the table.
5. **Key-person risk is the first procurement objection.** Company, insurance,
   runbooks, escrow and a contractor bench are prerequisites for a tender, not
   polish.

### Stage 1 — the gaps, built as the first pieces of the replacement

*(v2's Route A, re-based on native foundations.)* What follows is v2's analysis,
still accurate about what PlayHQ does and does not do.

### Route A — alongside PlayHQ (v2 text, now stage 1)

PlayHQ stays the system of record for:

- people and registrations
- eligibility gating
- fixtures, eScoring and standings

Epinoia runs what PlayHQ does not:

- statistics and broadcast compliance
- the discipline, appeals, protest, postponement and accreditation casework BE
  runs on Wufoo forms
- a post-game audit of the BE-specific eligibility rules PlayHQ does not encode
- the fines ledger behind all of it
- officials' appointments, claims and assessments where BE has no system

How the data moves:

- **Competition data:** read through PlayHQ's public API.
- **People data:** needs a PlayHQ partner agreement.
- **Eligibility data:** comes from PlayHQ report exports and the data-warehouse
  feed.
- **Decisions that must be enforced in PlayHQ** (a suspension, a date change, a
  clearance status): re-keyed there by BE staff, so every module outputs a
  decision plus an "apply in PlayHQ" step.

**What drops out of v1's alongside pitch:**

- fixture change requests
- result sign-off and table-side eligibility for NBL games
- results types and standings
- team entry and scheduling
- domestic transfers
- clearance *status*
- membership products, payments, licences and credential gating
- reporting, the app and websites
- "academy leagues off WhatsApp" (LiveStats is already mandatory there, and the
  EABL/WEABL fallback is PlayHQ)

### The sharpest wedge

**Match-day compliance and casework:**

- **Statistics and webcast compliance (M5)** is the zero-integration proof
  point. PlayHQ has no LiveStats, Genius or Synergy link, and Epinoia already
  ingests LiveStats.
- It leads into **one case engine (F7)** replacing the discipline, appeal,
  protest, postponement, accreditation and referee-report forms.
- The case engine feeds a **fines and fees ledger (R7)**.

Why this wedge:

- Every piece is confirmed absent from PlayHQ's public help centre and API.
- PlayHQ only records a tribunal's *outcome*, and Basketball Victoria (PlayHQ's
  most mature basketball customer) handles tribunal paperwork outside it.
- It needs no write API.

**Officials are the bigger prize but a harder fight.** The rival there is Who's
The Ref, a vendor BE chose, not PlayHQ. The unclaimed space is the officials
home clubs appoint.

### Route B — instead of PlayHQ (v2 text; v3 chooses it)

v2 judged B **less credible than v1 implied**, and v3 accepts that assessment as
the list of obstacles to clear. It does not reverse the decision:

- the incumbent is ISO 27001-certified
- it ships BE-specific builds monthly
- BE's board is positive about it
- nothing in its API allows bulk extraction of eligibility, discipline or DBS
  history

Stating B as a goal also **works against** a PlayHQ partner agreement, so v3
does not depend on one. The answers:

- **ISO 27001:** start the ISMS in 2027.
- **Monthly shipping:** out-ship PlayHQ on the modules BE runs by hand.
- **The board's view:** win it with stage 1.
- **Extraction:** negotiate data return and prove migration with pilot data.

---

## 3. Workstreams

Sizes (one developer with Claude): **S** days · **M** 1–3 weeks · **L** 1–2
months · **XL** a quarter or more.

**How to read the "PlayHQ" column:**

- **yes**: runs for BE.
- **exists**: in PlayHQ, BE use unverified.
- **partial**: some of it is in PlayHQ.
- **no**: absent from PlayHQ's public sources.

### P0 — Make the house safe (now)

| id | work | size | state |
|---|---|---|---|
| P0.1 | finalise-game reopen/finalise authorisation | S | **done, pushed** (0116) |
| P0.2 | standings-recompute guard; games row write guard (incl. competition moves) | S | **done, pushed** (0116) |
| P0.2b | league admin → platform admin escalation through `memberships` | S | fixed in 0117, not deployed |
| P0.3 | `players_write` DELETE; protected minor/consent flags | S | open |
| P0.4 | audit log unforgeable and league-readable | M | open |
| P0.5 | minors in the API and season views; enforce `youth_protected`; officials' licence numbers staff-only | S | open |
| P0.6 | private realtime channels | M | open |
| P0.7 | account deletion, season export, same-day suspension count | S | open |
| P0.8 | MFA for admin roles; restore-tested backups | M | open |

### Stage 1 — the gaps (sold alongside PlayHQ, built on native foundations)

**v3 changes to the tables below:**

- **Foundations.** F1–F4 are built **natively** now (org hierarchy, person
  record, dedupe and claim, roles), no longer as a mirror of PlayHQ ids. The
  mirror row stays only as the *reconciliation* layer: external ids stored in
  `external_identities`.
- **PlayHQ access.** F6b (the partner tier) is optional and is not relied on.
  F6a and F6c remain, as seed data and as rehearsal for migration.
- **Writing back to PlayHQ.** Every "apply in PlayHQ" step lasts only as long
  as PlayHQ does. The same decisions are enforced directly by Epinoia once the
  organisation is on Epinoia.
- **New stage-1 rows:**
  - **F8**: a portability study plus a migration rehearsal on a pilot
    organisation's export.
  - **M2-BE**: the Epinoia scorer made BE-grade. Crew-chief finalise, every
    official's signature, the captain's protest signature, period-end
    confirmation, fill-in policy, a hashed PDF archive, and a device/PIN
    offline model. This is what replaces PlayHQ eScoring, and it is Epinoia's
    strongest existing asset.

**A-0 · PlayHQ access and data protection (first)**

| id | work | PlayHQ | size |
|---|---|---|---|
| F6-0 | ask BE to request a **public API key** for the EU host; open a **partner conversation** with PlayHQ (as a referee-management or stats-and-streaming partner, the categories PlayHQ names); agree a CSV routine with BE (Competition Participants with Restriction column, Incidents, Suspensions, Fill-in, Games Played) and ask for the **data-warehouse feed** | — | S |
| F6a | public-tier read: fixtures, results, ladders, game summaries (`isFillIn`), grade stats | public API | M |
| F6c | CSV and data-warehouse import as the **primary** source of eligibility data (including season permits and previous-registration transfer links) | reports / DWH | M |
| F6b | partner-tier registration and profile webhooks and game events — **only once an agreement exists** | partner API | M |
| F5-min | before any partner data arrives: minimise at ingest (the webhooks carry guardians, emergency contacts, disability answers), DPIA, data processing agreement | no tooling in PlayHQ | S |
| A1a | Cyber Essentials Plus; UK/EU residency statement; WCAG statement | PlayHQ has ISO 27001 | M |
| F1–F4 | **native foundations (v3)**: organisation hierarchy (national body → region → league/organiser → club → team by age/gender/level), one person record across roles with guardians, dedupe/merge/claim with audit, time-bound functional roles — with PlayHQ organisation/team/profile ids held as external identities for reconciliation and migration | yes (parity) | XL |
| F8 | **portability and migration rehearsal (v3)**: map every PlayHQ export/DWH field to the native model; rehearse a pilot organisation's import end to end; list what cannot come out (DBS/accreditation history → Know Your People and Learning Nexus directly) | — | M |
| M2-BE | **the scorer made BE-grade (v3)**: crew-chief finalise, all officials' signatures, captain's protest signature, period-end confirmation, fill-in policy (off by default), hashed and archived scoresheet PDF, device/PIN offline sessions, coach line-up sign-off — the piece that replaces PlayHQ eScoring | yes (parity) | L |

**A-1 · Match-day compliance**

| id | work | PlayHQ | size |
|---|---|---|---|
| **M5** | **Statistics, webcast and video compliance** for D1 and EABL/WEABL: LiveStats coverage (two licensed statisticians, League Licence Code, Match Key retrospective by 09:00 Monday, £55 fee), webcast presence, Synergy upload within 48 h — fixtures from F6a, coverage from Epinoia's LiveStats ingest and video tables, fixed penalties proposed into R7 | **no** | M |
| M8 | a referral feed from game events — disqualifications, and the junior coach bench-technical rule for illegal zone/press — into C7 (partner game-events endpoint, or Epinoia's LiveStats ingest where covered) | no | S–M |
| M1+R4 | **post-game eligibility audit**: fill-ins (public `isFillIn` + Fill-in report) and the BE rules PlayHQ does not encode — the 50% "normality" lock, nursery/principal teams and U23 play-up, U18 two-team limit, Type 1 non-national quotas (1 per match, 3 per season), one non-national coach, coach levels by division. Nationality and coach levels come from CSV or BE-maintained lists. *Risk:* BE could simply ask PlayHQ to turn fill-ins off, so the BE rules are the core | partial | M |
| M6 | academy **statistics** (EABL/WEABL from LiveStats) and **CBL** with AoC Sport and SportLomo | partial | M |

**A-2 · The case engine — replacing the Wufoo estate**

| id | work | PlayHQ | size |
|---|---|---|---|
| **F7** | one case object: intake form, parties, deadline timers, deposit, documents, reviewer or panel, outcome, publication, an "apply in PlayHQ" checklist, audit trail | — | M–L |
| **C8** | appeals (72 h notice, full appeal 48 h / 7 days, £250/£100 deposit), protests (72 h, 24 h for cups/playoffs, £100, captain's signature), disputes (£100, Competitions Review Panel), hearings, publication | **no** | M |
| C7 | discipline **workflow around** the sanction: referee-report intake (48 h / 12:00 Tuesday), referral from M8, the incident tariff, repeat-disqualification escalation (+1 game & £75, +2 games & £150), the 14-day start, carry-over, "suspended until fines paid", games-served → end date from the fixture list, notices. The enforceable record stays a PlayHQ suspension or block keyed by BE. Flag Reg 49.19 vs tenant-wide suspensions. *Risk:* PlayHQ promises disciplinary features for other sports | exists (records only) | L |
| C5 | postponements (7 days' notice, two dates within 5 days, escalation, BE sets after 14) and abandonment reports as case types; the date change itself is a manual PlayHQ edit | no | M |
| R5 | club registration, Level 1/2 accreditation checklists with expiring documents and reviewer sign-off, officer register (secretary, chair, treasurer, welfare officer) | partial (club = PlayHQ organisation) | M |
| O4 | club reports on referees; assessments and grading (check overlap with Learning Nexus first) | no | M |
| M4 | paper-scoresheet upload and late-result/late-sync breaches (31.1.3, 31.2) | result entry: yes | S |
| C9 (A) | intra-club transfers (twice a season, never at weekends, closing 31 Jan) and player exemptions; the team move itself happens in PlayHQ | partial | S |
| C10 (A) | international clearance **case file**: MAP reference, 6/3/7-day timers, CHF 250, evidence, ending in a Super Admin status change in PlayHQ | status: yes | S |
| C1a | facility-standards register (Appendix 6) keyed to PlayHQ venue ids — replaces the facility form | partial (venues, no specs) | S–M |

**A-3 · Money and officials**

| id | work | PlayHQ | size |
|---|---|---|---|
| **R7** | **fines and fees ledger** behind A-1 and A-2: the 49.16 schedule, deposits, change-request fees, forfeit fees, "suspended until paid", statements; collection through Stripe Connect or PlayHQ Payment Request links; never hold funds | partial (pay links only) | L |
| O2 | appointments — start with **home-club appointments** (D3 and Junior NBL referees, table officials, statisticians); D1/D2 stays on Who's The Ref unless BE wants to move | no | L |
| O3 | fees and mileage claims (Appendix 4, 45p/mile, junior £37 cap, two-games-a-day split, Monday 09:00 claims, BACS by the second Tuesday, £25 per unpaid official) — calculate and track; clubs keep paying | no | M |
| O1 | officials integration: partner referee webhook (Official, Coach of Match Official) and `POST /partner/v1/referees/link`; CSV for table officials, statisticians and levels | partial | M |

**A-4 · Supporter value**

| id | work | PlayHQ | size |
|---|---|---|---|
| S1 | **supporter analytics as Epinoia's own subscription**, with a revenue share to BE: the membership framework built in this session (plans, members-only leagues, Stripe). The demand signal is HoopsHQ's most common review complaint — shallow stats | no | built |

### Stage 2 — parity with PlayHQ (the replacement core)

Everything PlayHQ already provides is **parity work**. It must match PlayHQ
before a cutover, and R8 is the acceptance checklist. v3 starts it in 2027/28,
not after a 2028/29 decision.

### Stage 3 — cutover

At the contract boundary, one tier at a time: local leagues → regional leagues →
Junior NBL conferences → Junior NBL premier → NBL. Each tier runs in parallel
for one registration window. Supporting work:

- training before access
- a support desk covering weekend game days
- a rollback plan per tier

| ids | parity scope |
|---|---|
| F1–F4 native | hierarchy, person record, dedupe/merge/claim, roles (Epinoia's edge: fine-grained and time-bound roles; PlayHQ's are coarse, with no read-only role yet) |
| F5 full | the data-protection toolkit PlayHQ does not publish |
| M1 table, M2, M3, M7 | table-side eligibility, sign-off, results types, standings (plus cross-division seeding and a random-draw tie-break, which PlayHQ lacks) |
| C1b, C2, C3, C4, C6 | slots and clashes, team entry with surety and refund ladder, scheduling, change requests with BE's auto-accept and fees, brackets |
| C9 domestic | the 7-day / day-8 release, contract holds |
| R1, R2, R3, R6 | products, split payments (+ Direct Debit, VAT lines, which PlayHQ lacks), licences and cards, credential gating (re-integrating Know Your People, Learning Nexus and Stripe Identity) |
| X1–X5 | comms, reporting, app, websites, integrations |
| **R8** | **the parity inventory v1 never listed:** Stripe Identity flow and under-16 path; new-player approval; private profiles; temporary blocks with lock-out; season and game permits; fill-in policy and report; conferences; AI grading and regrading; the by-month fixture view; eScoring device model (PINs, seven-day offline, court lock, temporary scorer links, coach sign-off, PDF team sheets); vouchers, family discounts, caps, fee rollover, global questions; PayPal Pay in 4 and Click to Pay; club-fee instalments and deferred payments; Payment Requests; multiple bank accounts; UK payment onboarding including CASC; Xero; club-run programmes and camps; posts, push, Mailchimp, player availability; AnalyticsHQ churn prediction and Report Builder; the data-warehouse feed; public API and webhooks; website builder; admin training before access; ISO 27001 |
| A1b, A4, A5 | ISO 27001; registration-peak load; migration — **preceded by a data-portability study and BE's exit and data-return terms** (admin merges are irreversible, but claimed-profile un-merges happen; DBS and accreditation history must come from Know Your People and Learning Nexus directly) |

---

## 4. Season plan (v3)

| season | stage 1 — sold alongside PlayHQ | stage 2/3 — replacement build |
|---|---|---|
| **2026/27** | P0 · **M5** stats/webcast compliance · **F7 + C8 + C7** for one NBL discipline cycle · **S1** supporter analytics | **F1–F5 native foundations** · **M2-BE** scorer · F6a, F6c · F8 portability study · A1a Cyber Essentials Plus + DPIA + WCAG statement · company, insurance, runbooks |
| **2027/28** | eligibility audit (M1+R4) · R7 ledger · C5 postponements · R5 accreditation · officials (O1–O4) · CBL with AoC Sport | **competition parity** C1–C6, M3, M7, C9 domestic · **R4 eligibility engine at the table** · ISO 27001 ISMS started · a non-PlayHQ pilot organisation (an unaffiliated or new league, or AoC's CBL) running **entirely** on Epinoia |
| **2028/29** | regional scale-up | **registration and money parity** R1–R3, R5, R6 (Know Your People, Learning Nexus, Stripe Identity), R2 split payments + Direct Debit · X1–X5 · **ISO 27001 certified** · load test at 2× peak · migration rehearsal on a real regional export |
| **2029/30** | — | **tender / replacement offer** at the contract boundary · A5 cutover by tier with parallel running |

The dates move with PlayHQ's contract term. **Finding that date is the most
important unknown (BE question 1).**

**Hard constraints:**

- Nothing that touches registrations goes live after early July for that season.
- Nothing match-day goes live in the first month of a season or on a Saturday.
- F7 and M5 are not match-day features, so they are not blocked.

---

## 5. Commercial shape

- **v3, replacement pricing:** match or beat what members already see (PlayHQ
  charges clubs 1.8% on their fees, plus a participant service fee), or fund the
  platform through affiliation as the FA's Whole Game System does. Stage-1
  modules are priced as a central BE licence per module until the cutover.
- **No member money flows through Epinoia on Route A.** PlayHQ is included in BE
  affiliation at no extra cost to clubs and affiliated leagues, so the 1.8%
  comparison does not apply. Price Route A as **a central BE licence per
  module** (compliance, casework, officials), not per transaction.
- **Revenue BE wants:** supporter analytics as Epinoia's own subscription with a
  revenue share (BE's non-grant revenue target), broadcast and statistics
  packages.
- **Do not sell club websites.** BE promotes PlayHQ's £245/yr sites, and
  competing costs partner goodwill (the subscription is paid to PlayHQ, not
  shown to be BE revenue).
- **Proof points:**
  - (a) D1 and EABL/WEABL statistics and webcast compliance
  - (b) NBL discipline, appeals and protests in one case system with the 49.16
    fines schedule
  - (c) one region's club-appointed officials and expense claims
  - (d) CBL with AoC Sport

## 6. Risks

1. **PlayHQ velocity.** Feature gaps close within a season. Pick structural
   gaps (appeals and hearings, officials, advanced statistics). Re-check
   PlayHQ's release notes every quarter through its help-centre API.
2. **Access dependency.** PlayHQ controls partner access, sets up webhooks by
   hand, publishes no rate limits and offers no write API. That means double
   keying, and access could be withdrawn. Design CSV-first; use only the public
   tier for anything customer-critical.
3. **BE can ask PlayHQ instead.** Change-request auto-accept and fees, the
   captain's protest signature, fill-ins off, and suspension scope vs 49.19 are
   all things PlayHQ could build on request, as it did officials' signatures.
4. **A different competitor per module:** Who's The Ref (officials), Genius
   Sports (stats display), AoC Sport/SportLomo (academy), Learning Nexus
   (officials' tests, CPD).
5. **Migration fatigue and a positive incumbent record** make Route B hard. v3
   mitigates by winning stage 1 first, proving migration on pilot data, and
   cutting over one tier at a time with parallel running.
5a. **Contract lock-in (v3).** The PlayHQ term, exclusivity and exit terms are
   unknown. The sequence depends on them.
5b. **Parity is a moving target (v3).** PlayHQ ships monthly for BE. Keep R8
   current by re-checking release notes quarterly, and budget the gap.
6. **Children's and safeguarding data.** Partner webhooks carry guardians,
   emergency contacts and disability answers. Minimise and document before
   ingest; never store DBS certificates.
7. **Key-person risk.** One developer (company, insurance, runbooks, escrow).
8. **Payments regulation.** Stripe Connect or PlayHQ pay links only, never
   collect-and-forward. VAT on platform-supplied memberships needs an
   accountant's view.
9. **FIBA MAP has no API** — a gap for both platforms, not an advantage to either.
10. **Ownership change** (*low confidence*). PlayHQ's move into Alpine Software
    Group could change its pricing or partner policy at BE's renewal.

## 7. Decisions for Louie

**Decided 2026-09-16:** full replacement of PlayHQ is the goal (decision 6
below). Stage 1 is the route to it; the partner agreement is not relied on
(decisions 1 and 7 are now optional tactics). Open:

- the pilot organisation that runs entirely on Epinoia in 2027/28
- company and insurance
- when to raise the contract term with BE

v2's list, kept for reference:

1. **Route A, narrowed** to compliance, casework and officials: seek a PlayHQ
   partner agreement first, or approach BE first with a public-API + CSV
   product?
2. **Pilot:** (a) D1/academy stats and webcast compliance · (b) NBL discipline,
   appeals and protests · (c) one region's club-appointed officials and claims ·
   (d) CBL with AoC Sport. (v1's "local league scoring on Epinoia" is dropped:
   PlayHQ is free to affiliated leagues and is BE's affiliation incentive.)
3. Company and insurance structure before any BE conversation.
4. Supporter analytics as Epinoia's own subscription with a revenue share.
5. Finish P0 before anything is shown to BE.
6. **Keep Route B as a stated goal at all?** It undermines the partner
   relationship Route A needs.
7. **Ask BE for the public API key now?** It is cheap and needs no PlayHQ
   agreement.

## 8. Questions only BE or PlayHQ can answer

**Basketball England**

1. PlayHQ contract term, renewal and break dates; any exclusivity over
   discipline, officials or stats modules; data-return and exit terms.
2. Are PlayHQ Incidents and Suspensions used for NBL discipline, and who keys
   them in? Temporary blocks instead of tenant-wide suspensions, given 49.19?
3. Are transfers switched on in 2026/27 competitions, with what timeout? What
   does "membership portal" in Reg 21 now mean?
4. How are the 25.4.1 auto-accept and change-request fees applied?
5. How does a captain sign under protest (50.5) on an eScored game?
6. Can fill-ins be turned off for BE? How many were flagged in 2025/26?
7. Is Who's The Ref integrated with PlayHQ? How do officials reach licence
   cards for their games? What system do home clubs use for D3/Junior NBL
   referees and table officials?
8. Do Sport Structures coaching results reach PlayHQ, or only Learning Nexus?
9. How are fines invoiced and collected; how are appeal and protest deposits
   taken?
10. Is the £120 affiliation fee paid in PlayHQ? Are club-fee instalments live?
11. Where is the Supporter membership sold, and how are its benefits delivered?
12. Would BE request a public API key for Epinoia, and consent to partner-tier
    sharing with a third-party processor?
13. Season volumes: appeals, protests, disputes, disciplinary reports,
    clearance cases. Is the Wufoo estate felt as a problem?
14. Does AoC Sport own the CBL process, and would it move off SportLomo?
15. Passport and visa documents: both routes current (Stripe ID and Contact Us)
    — which is intended to remain?

**PlayHQ**

1. Partner-agreement terms, fees and data-usage guidelines; is a stats,
   officials and casework vendor eligible?
2. Will eligibility state (membership expiry, DBS, ID, accreditation,
   clearance, block, suspension, permit, transfer) reach the API, webhooks or
   data-warehouse feed? Does the UK registration webhook differ from Australia's?
3. Write endpoints planned for incidents/suspensions, fixture changes or results?
4. Is `LIVE_GAME.EVENT` live for basketball? Any integration fee?
5. Rate limits; data-warehouse delivery mechanism and availability for BE's
   tenant.
6. Which AWS region hosts euprod; a data-residency statement?
7. Roadmap for officials/appointments, tribunals and appeals, basketball
   auto-suspensions and games-served counting, refunds for BE, a read-only role,
   UK SMS MFA.
8. Fill-ins per tenant or division; organisation-level auto-approve for
   basketball transfers.
9. Has the Alpine Software Group transaction completed, and does it change the
   partner programme?

## Sources

- **PlayHQ**
  - help centre, support.playhq.com (338 articles read through the Zendesk help
    centre API; ids cited in the research files)
  - API specification and data-warehouse docs, docs.playhq.com/tech
  - trust centre, trust.playhq.com
  - newsroom: joins Basketball England; eScoring in England; joining Alpine
    Software Group
  - partner pages
- **Basketball England**
  - NBL Rules & Regulations 2026-27; Academy Rules & Regulations 2026-27
  - PlayHQ & membership FAQs; NBL FAQs; club standards; officials pre-season
    information; NBL stats page
  - news: websites (14 May 2026), Sport Structures (26 Nov 2025), club readiness
    (15 Aug 2025)
  - board minutes 16 Jul 2025, 16 Oct 2025, 11 Dec 2025, 26 Feb 2026; AGM
    minutes 29 Jan 2025 and 12 Feb 2026
  - 16 Wufoo forms at basketballengland.wufoo.com
  - Strategy 2025-29
- **Others**
  - WEBBA officials page
  - Basketball Victoria tribunal documents
  - HoopsHQ App Store listing (UK)
  - FIBA Internal Regulations Book 3
- **UK law**
  - Consumer Contracts Regulations 2013; DMCCA 2024
  - Data (Use and Access) Act 2025; ICO Children's Code
  - Payment Services Regulations 2017
