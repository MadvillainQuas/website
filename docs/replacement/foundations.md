# Native foundations: organisations, people, roles and data protection (F1–F5, F8)

Written 2026-09-16. This is the build contract for migrations 0119–0128 and for
every console, Edge Function and import script that uses them. It follows the
roadmap v3 decision (`docs/basketball-england-roadmap.md`): Epinoia becomes a
full replacement for PlayHQ as Basketball England's membership and competition
system, and these are the foundations everything else stands on. Change it here
first.

Numbers assume 0117 and 0118 deploy first. `NNNN:L` means
`supabase/migrations/NNNN_*.sql` line L.

---

## 0. Decision record

### 0.1 What was judged

Three independent designs were written for the same brief:

- **evolve**: grow the existing tables. `players` becomes the person register,
  `memberships` holds both permissions and participant registrations (its
  `role` enum converted to text), and private data sits in a `restricted`
  schema keyed per tenant. Organisation rights are added as extra branches
  inside the hot helpers (`is_league_admin`, `is_team_manager`).
- **registry**: a separate `registry` schema holding 22 tables (its own teams,
  persons per tenant, registrations, credentials, roles). Registry roles are
  **compiled** into `public.memberships` so the hot helpers barely change.
- **migration**: designed from the PlayHQ exports (data-warehouse files, report
  CSVs, API) and the NBL Regulations 2026-27. Persons per tenant live in
  `public` with no SELECT policy. Organisation roles are **projected** into
  `memberships`. It adds licence periods, age bands, registration steps and an
  eligibility-rules layer.

### 0.2 Scores

1 = poor, 10 = excellent.

| criterion | evolve | registry | migration |
|---|---|---|---|
| (a) correct against BE's regulations and NGB requirements | 6 | 8 | **9** |
| (b) safe for the live site (pages, scorer, ingest, finalise-game, API, RLS cost) | 5 | 6 | **7** |
| (c) PlayHQ import and migration fidelity | 6 | 7 | **9** |
| (d) data protection and minors | **8** | **8** | 7 |
| (e) simple enough for one maintainer | **6** | 4 | 5 |
| (f) real value ships early in deployable slices | 7 | 5 | **8** |
| **total** | 38 | 38 | **45** |

**Why each score.**

- **evolve.**
  - (a) Participant registrations share the permission table. There is no dated
    affiliation or accreditation history, no credential status, and guardians
    are a jsonb list.
  - (b) It changes the `role` enum to text on the table every policy reads,
    which needs an ACCESS EXCLUSIVE lock, dropped policies and replaced plpgsql
    bodies. It puts organisation lookups inside `is_league_admin` and
    `is_team_manager`. It also makes the publicly readable (`select=*`)
    `players` table hold every BE member, including coaches, referees and
    volunteers who never play. That feeds false matches to the feed ingest's
    name matcher. **It correctly found that the ingest depends on the
    `memberships` unique key** (see 0.3).
  - (d) Best in class: a schema the browser cannot reach, audited reads of
    minors' contacts, no staff read path to special-category rows at all, and
    the identity lock.
- **registry.**
  - (a) Strong: dated affiliations with accreditation, credentials, guardians as
    persons with parental responsibility, and a season-age function that
    matches Appendix 2.
  - (b) The catalogue test "no policy references the registry" is the right
    guard. But it **replaces the `memberships` unique key with one that
    includes `source`**, and that breaks the ingest silently (0.3). It also
    relaxes `external_identities` uniqueness.
  - (e) 22 tables, two schemas, and a second team model (`registry.teams`)
    beside `public.teams`.
  - (f) Its first slice ships nothing anyone can use, and the complaints queue
    (a legal duty in force now) arrives seventh.
- **migration.**
  - (a) and (c) Best: field-by-field mapping of the real data-warehouse file
    names (verified, 0.3), "Pending until every check passes", blocks scoped by
    organisation for Reg 49.19, the 1 September age bands, and an explicit list
    of what cannot come out of PlayHQ.
  - (b) Keeps both unique keys the live writers upsert on. But its
    `players.hidden` would remove private adults from the scorer's squad load,
    which uses the anon key: the same failure as today's minors gap
    (map_governance §0.7). And its personal tables are protected only by
    "no policy" in `public`.
  - (d) Contacts and special-category data are in `public`, and `import_rows`
    keeps parsed personal fields for 90 days. It is best at not treating
    PlayHQ's `profileVisible` as consent, and at answering claims without
    revealing whether a profile exists.
  - (e) About 25 tables including a rules engine, which is more than the
    foundations need now.

**Decision: migration is the base.** Its scope is trimmed to F1–F5 plus F8. The
licence products and eligibility rules engine wait for R1/R4 (§11). It takes
evolve's data-protection posture and table economy, and registry's schema
separation and catalogue guards. §0.4 lists every point where the designs
disagreed and what this contract does.

### 0.3 Claims checked against the code

| claim | made by | result | evidence |
|---|---|---|---|
| The feed ingest upserts `memberships` on `(user_id, role, scope_type, scope_id)` inside a `try` that only logs | evolve | **true** | `scripts/ingest/feedplatform.py:80-83`. Any change to that unique key makes new feed leagues silently stop being handed to platform admins. registry's `+ source` key would do exactly that |
| `membership-sync` upserts `external_identities` on `source_id,entity_type,external_id` | all | **true** | `supabase/functions/membership-sync/index.ts` (`linkIdentity`). The second unique key `(source_id, entity_type, entity_id)` (0077:71) is not an upsert target, but relaxing it drops a real integrity rule |
| `memberships` uses the enums `role_kind` and `scope_kind`; `grant_role` casts to them | evolve | **true** | 0001:27-38, 0051:380-381. `grant_role` inserts `on conflict do nothing`; `revoke_role` deletes by id (0051:428) |
| `access_features_for` reads `memberships` directly, not through `is_league_admin` | — | **true** | 0117:524-567. A helper-branch design must also rewrite it. A projection reaches it for free |
| Other live direct readers of `memberships` | — | `whoami` (0050), `league_members` (0007), `post_announcement` (0106:237), `platform_overview` / `platform_accounts` / `platform_set_account_banned` (0044), `finalise-game` worker lookup of a platform admin (`index.ts:99`) | a projection keeps every one of them correct without edits, apart from the expiry predicate (§6.5) |
| 0116's games guard must be told to let erasure redact `roster_snapshot` | evolve | **false: not needed** | `games_write_guard` is SECURITY INVOKER and returns immediately unless `current_user` is `authenticated` or `anon` (0116:244-256). Definer functions pass |
| `stamp_player_uuid` can resolve merges | all | **true, with a caveat** | 0011:19-29 stamps only when `player_uuid` is null and the player exists. The change is one `coalesce(merged_into, id)` |
| Foreign keys to `players` | all | all use `on delete cascade`, except `player_game_stats.player_uuid` (set null, 0002:40): `roster_entries` (0001), `season_awards` (0018:358), `player_suspensions` (0045:66), `season_award_overrides`, `toty_candidates`, `toty_votes`, `toty_results` (0047:33/140/150/162), `player_previous_clubs` (0049:99), `membership_eligibility` (0077:84) | a merged player must never be deleted, or cascades destroy history: tombstones stay |
| References to players with no foreign key | — | `player_game_stats.player_id` (text pid, part of the primary key), `game_events.pid`, `games.roster_snapshot`/`starters`, `lineup_stints.player_ids`, `highlight_jobs.player_id` (text, 0109:14), `media.owner_id`, `fan_prefs.fav_player_ids`, `external_identities.entity_id`, `players.external_ids` | a catalogue scan of `pg_constraint` misses all of these, so the reference list must name them (§5.8) |
| `teams_write` lets a manager PATCH any column; `leagues_write` is FOR ALL | migration, evolve | **true** | 0028:29, 0001:379. New link columns need guard triggers |
| `audit_insert` only requires a signed-in user | all | **true** | 0001:465. No browser code inserts audit rows; only `finalise-game` does, with the service role (`index.ts:154,197,486`). So `actor = auth.uid()` is a safe fix |
| No migration creates a schema; the API exposes default schemas only; the Postgres version is not recorded | registry | **true** | there is no `create schema` in any migration, and `config.toml` has no `[api]` or `[db]` section. Whether `create schema` works under the CLI's temporary login role (0115:147-153) is unverified |
| PlayHQ data-warehouse field names | migration | **true** for profiles and registrations | `participantFirstName`, `participantDateOfBirth`, `participantGender`, `participantEmailAddress`, `participantMobilePhone`, `participantSuburb`, `participantPostcode`, `accountHolderEmailAddress`, `accountHolderProfileId`, `emergencyContact{FirstName,LastName,Mobile,EmailAddress,Relationship}`, `profileVisible`, `hasDisability`, `disabilities`, `otherDisabilityDescription`, `additionalDisabilitySupportInformation`, `parentGuardiansBornOverseas`, `atsi`, `wwcNumber`, `wwcExpiryDate`, `wwcStateOfIssue`; `competitionRegisteredToId`, `seasonRegisteredToId`, `teamRegisteredToId`, `teamName`, `registrationDate`, `registrationStatus`, `role`, `source`, `permitFrom`, `permitTo`, `previousRegistrationId`, `participantDateOfBirth`, `optInMarketing`, `schoolYear`; claimed profile `destinationProfileId`. evolve and registry used the webhook's dotted names (`participant.firstName`), which also exist but need a partner agreement |
| `competition_teams` has no id | evolve, migration | **true** | primary key `(competition_id, team_id)`, 0001:94-98 |
| Players hold `birth_year` only; `is_minor` is a manual flag; `leagues.consent_age` defaults to 16 | all | **true** | 0001:104-116, 0049:43-58 |

### 0.4 Contradictions, resolved

| # | question | evolve | registry | migration | **this contract** | why |
|---|---|---|---|---|---|---|
| 1 | Who is the person? | `players` row, private data per tenant | `registry.persons` per tenant, linked to `players` | `persons` per tenant, linked to `players` | **`restricted.persons`, one per human per tenant (data controller), optionally linked to one `players` row** | `players` is read with `select=*` by anonymous pages and matched by name in the feed ingest. 50,000 members who never play do not belong there. Controller boundaries, erasure and export stay per tenant, as PlayHQ keeps profiles per tenant |
| 2 | Where does personal data live? | `restricted` schema | `registry` and `registry_restricted` schemas | `public`, no SELECT policy | **Every table whose rows can name a person lives in schema `restricted`**. Structural tables with no personal data (organisations, role catalogue) stay in `public` | Without USAGE on the schema, PostgREST and GraphQL cannot reach a row even if a policy is later written wrong. One schema, not two, because special-category protection comes from having no read path, not from a second schema |
| 3 | How do organisation roles reach the existing permission checks? | extra branches inside `is_league_admin` / `is_team_manager`, enum changed to text | compiled into `memberships`; unique key gains `source` | projected into `memberships`; unique key kept | **Projected into `memberships` with two new columns, `derived_from` and `valid_until`. The enum and the unique key are unchanged** | Hot helpers keep their SQL and their cost. Every direct reader of `memberships` (0.3) stays correct. The ingest upsert keeps its conflict target |
| 4 | Participant registrations | rows in `memberships` with `person_id` | `registry.registrations` | `registrations` plus steps, periods and products | **`restricted.registrations`**, with `pending_on text[]` in place of a steps table; products and licence periods wait for R1 | One registration per role is PlayHQ's core rule and a different thing from a permission. An array holds "Pending until every check passes" without a second table |
| 5 | How is the hierarchy stored? | `path uuid[]` | closure table | closure table | **`organisations.path uuid[]`** with a GIN index | One table, not two. Ancestors are the row's own path; descendants are `path @> array[x]`. It is readable by eye, and about 1,200 BE organisations make the index trivial |
| 6 | Club parent and inheritance | cascade down the tree | governance tree separate from affiliations; rights inherit only along the tree | club's parent is its local league organiser or region | **Rights inherit only along `parent_id`. Affiliations (club to BE, club to local league, season invites) are dated rows that grant nothing.** A club's default parent is its region; the alternative is open question 3 | Rights stay predictable, and the organisation tree matches BE's regions |
| 7 | League to organisation link | `leagues.organisation_id` | `organisations.league_id unique` | `leagues.organiser_id` | **`leagues.organiser_id`** (nullable, guarded) | One organiser runs many leagues (BE runs the NBL, Junior NBL and Cups). Null means today's behaviour |
| 8 | Club squads | columns on `public.teams` | separate `registry.teams` | columns on `public.teams` | **`teams.club_id`, `teams.age_group`, `teams.gender`; `level` on `competitions`** | One team model. Level moves with grading and regrading each season, so it belongs to the division |
| 9 | Per-season PlayHQ team ids and claimed-profile ids | tombstone keeps the loser's id; `competition_teams.id` | `status` and `season` columns plus a partial unique index | `is_current` plus a partial unique index | **No change to `external_identities` keys.** A per-season team id attaches to `competition_teams.id`; a merged person keeps its PlayHQ id on its tombstone and importers follow `merged_into` | Both unique rules from 0077 stay, and so does the upsert |
| 10 | Guardians | jsonb list of up to 2 contacts | guardian persons | slot rows with an optional person link | **`restricted.guardianships` rows: slot 1/2 contacts, or a link to the guardian's own person; carrying `parental_responsibility`, `may_manage`, `may_consent`** | PlayHQ's `parentGuardian1/2` and `accountHolderProfileId` both import without loss, and consent is only valid from someone with parental responsibility |
| 11 | Consent write path | `players` columns write, a trigger appends history | consents authoritative, projected onto `players` | `consent_records` mirrored onto `players` | **Unlinked players: today's path (`set_player_profile`, portal) stays, and an AFTER trigger appends history. Linked players: `consent_records` is authoritative and projected; the players columns are guarded** | Nothing changes for any current page, and there is never a loop (the projection sets a flag the trigger honours) |
| 12 | Claim responses | masked hints (club, `j***@g***.com`) | masked hints | the same answer whether or not a profile matches | **The same answer every time** | A masked hint confirms a child is registered somewhere. That fails the Children's Code test |
| 13 | Staff reading special-category rows | none | `special.read` with a reason | audited view | **No staff read path to rows.** Subject or guardian through their own RPC; aggregates with cells under 10 suppressed; subject-access export | Equality reporting needs aggregates, never rows |
| 14 | Audit | extend `audit_log` | new `registry.audit_events` | extend `audit_log` | **Extend `audit_log`** (`tenant_id`, `person_id`, unforgeable actor, longer keep for person/role/org/privacy actions) | One log, one prune routine |
| 15 | Merge undo window | 90 days | 30 days | until reverted | **90 days** of snapshot; the merge record kept 6 years | PlayHQ claimed-profile un-merges arrive late |
| 16 | Rewrite `lineup_stints.player_ids` on merge? | no, fold at read | yes | yes | **No.** Anything derived from events keeps the event pid; anything keyed to the person resolves (`player_uuid` via the stamp trigger); pages fold pids through `player_aliases` | Re-finalise regenerates stints from events with the old pid, so a rewrite would be undone the next time a game is corrected |
| 17 | Private adult players | hide only unrostered | projection only | `players.hidden` in `players_read` | **Not projected onto `players` yet.** `persons.visibility` governs registry surfaces now; it reaches `players` after the P0.5 squad RPC (open question 5) | The scorer loads squads with the anon key (`bootstrap.js:944-955`); hiding a rostered adult drops them from the table |
| 18 | Retention schedule | SQL function | table | table | **Table `restricted.retention_schedule`**; a row only acts once `approved_by` is set | The DPO signs off rows; nothing is deleted on a proposal |
| 19 | Organisation roles reference a person or a user? | user or person | person, user via account link | person, user copied by trigger | **Person** (a person row is created on an email grant when needed); user reached through `person_accounts` | One source for "who is this". BE officers must be members anyway |
| 20 | Extensions | `pg_trgm`, `unaccent`, `btree_gist` | avoided | optional | **None required.** `name_key` uses `translate()`; overlaps are refused by trigger; trigram similarity is used only if `pg_trgm` is present | The Postgres version and installed extensions are not recorded in the repo |

---

## 1. Words

Three words already mean something in this codebase, so they are fixed here.

| word | means | lives in |
|---|---|---|
| **permission** | what an account may do in Epinoia (league admin, team manager, statistician, platform admin) | `public.memberships` (the table name is historical) |
| **organisation role** | an appointment in a governing structure: body admin, region admin, registrar, club secretary, welfare officer. Dated, held by a person | `restricted.org_roles`, projected into `memberships` where it implies a permission |
| **registration** | a person's registration for one role at one organisation (BE membership, or a competition registration such as the National Competitions Licence) | `restricted.registrations` |
| **person** | a human as known to one data controller (a tenant) | `restricted.persons` |
| **player** | the on-court sporting record: stats, rosters, public profile | `public.players` |
| **tenant** | a root organisation: a data controller (Basketball England, later Basketball Scotland, or an independent league) | `public.organisations` where `parent_id is null` |
| **organiser** | the organisation that runs a league | `leagues.organiser_id` |
| **in force** | a role not revoked, confirmed, started, not ended (dates in Europe/London) | §6.3 |
| **projection** | the permission rows that organisation roles imply, written into `memberships` by one function | §6.4 |
| **linked player** | a `players` row that at least one active person points at. From 0126 its identity and consent columns are managed from the person | §5.2 |

"Membership" in the BE sense (the £35 participant fee) is a registration of
kind `membership`. The paid fan product stays `access_` (docs/memberships.md §0).

---

## 2. Ground rules every slice obeys

1. **No personal data is added to a table that anonymous pages read.** Personal
   data goes in schema `restricted`, which `anon` and `authenticated` have no
   USAGE on. Browsers reach it only through `public` SECURITY DEFINER functions
   owned by `postgres`.
2. **The hot path never reads `restricted` or `organisations`.** No policy on a
   `public` table and no public view may reference either. Permissions reach the
   existing helpers only through the projection. Every slice asserts this
   against `pg_policies` and `pg_views`.
3. **Every new column defaults to today's behaviour.** A league with no
   organiser, a team with no club, a player no person points at, and a
   membership row with no `derived_from` all behave exactly as now.
4. **Existing names, arguments and unique keys stay**:
   - `memberships (user_id, role, scope_type, scope_id)`
   - both `external_identities` keys
   - every helper's signature
5. **No FOR ALL policies on anything new.** Writes go through definer RPCs.
   Where an existing policy lets a browser PATCH a row that gains a sensitive
   column, a guard trigger refuses the change unless a transaction-local setting
   is on. Only the owning RPC sets it (0117's `leagues_access_guard` pattern).
   The guard refuses only when a value actually changes.
6. **One reference list** (`restricted.person_references()`, §5.8) drives merge,
   subject-access export and erasure. From 0124 every slice asserts
   `restricted.person_reference_gaps()` returns no rows.
7. **Self-tests follow the 0115 P0115 pattern:**
   - seed rows with the migration's own rights first;
   - impersonate with `set local role` plus `request.jwt.claims`, never
     `RESET ROLE`;
   - assert inside a block that ends by raising a private code, and swallow
     only that code;
   - catch only `insufficient_privilege` for write refusals;
   - check afterwards that the test rows are gone.

   Every plpgsql function is called on its success path and on at least one
   refusal path, because plpgsql is not type-checked at creation. Grants are
   asserted with `has_function_privilege`; owners are pinned to `postgres`.
8. **Retention never deletes on a proposal.** Only schedule rows the controller's
   DPO has approved act.
9. **Calendar:**
   - Nothing that touches permissions or the finalise path ships in the first
     month of a season, on a Saturday, or in a BE match week's Friday
     evening–Sunday window.
   - Nothing that touches registrations goes live for a BE tier after early July
     for that season. A pilot organisation may use them at any time.

---

## 3. Entity model

### 3.1 Public structural tables (no personal data)

```sql
-- 0119 -------------------------------------------------------------------------
create table public.organisations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null,                     -- the root; = id for a root. Set by trigger
  parent_id     uuid references public.organisations on delete restrict,
  path          uuid[] not null,                   -- root..self. Set by trigger
  kind          text not null check (kind in
                  ('national_body','region','association','club','school','partner')),
  name          text not null check (char_length(btrim(name)) between 2 and 120),
  short_name    text not null default '' check (char_length(short_name) <= 40),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  status        text not null default 'active'
                  check (status in ('pending','active','suspended','lapsed','dissolved','merged')),
  merged_into   uuid references public.organisations on delete restrict,
  visible       boolean not null default true,     -- PlayHQ visible / includeInFinder
  country       char(2) not null default 'GB',
  home_nation   text check (home_nation in ('ENG','SCO','WAL','NIR')),
  time_zone     text not null default 'Europe/London',
  website       text check (website is null or website ~ '^https://'),
  logo_path     text,
  registered_no text check (char_length(registered_no) <= 40),  -- company / charity / CASC: public registers
  settings      jsonb not null default '{}'::jsonb,              -- roots only; keys in §4.4
  created_by    uuid references auth.users on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint org_tenant_fk      foreign key (tenant_id) references public.organisations
                                deferrable initially deferred,
  constraint org_root_ck        check ((parent_id is null) = (tenant_id = id)),
  constraint org_root_kind_ck   check (parent_id is not null or kind in ('national_body','association')),
  constraint org_settings_ck    check (parent_id is null or settings = '{}'::jsonb),
  constraint org_merged_ck      check ((status = 'merged') = (merged_into is not null))
);
create index organisations_parent on public.organisations (parent_id);
create index organisations_path   on public.organisations using gin (path);
create index organisations_kind   on public.organisations (tenant_id, kind);
-- RLS: org_read FOR SELECT USING (visible or (select public.is_platform_admin())). No write policy.

create table public.org_affiliations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organisations on delete cascade,  -- the club or association joining
  to_org_id     uuid not null references public.organisations on delete cascade,  -- BE, a region, a local league body
  kind          text not null check (kind in ('governing_body','league_member','season_invite')),
  season_label  text not null check (season_label ~ '^[0-9]{4}/[0-9]{2}$'),
  season_id     uuid references public.seasons on delete cascade,                 -- season_invite only
  valid_from    date not null,
  valid_to      date,
  status        text not null default 'pending'
                  check (status in ('pending','active','lapsed','suspended','refused','withdrawn')),
  reference     text check (char_length(reference) <= 40),                         -- affiliation number
  accreditation text not null default 'none' check (accreditation in ('none','level_1','level_2')),
  decided_by    uuid references auth.users on delete set null,
  decided_at    timestamptz,
  note          text not null default '' check (char_length(note) <= 400),
  created_at    timestamptz not null default now(),
  constraint aff_distinct_ck check (org_id <> to_org_id),
  constraint aff_invite_ck   check ((kind = 'season_invite') = (season_id is not null)),
  constraint aff_dates_ck    check (valid_to is null or valid_to >= valid_from),
  constraint aff_accred_ck   check (accreditation = 'none' or kind = 'governing_body'),
  unique (org_id, to_org_id, kind, season_label)
);
-- RLS on, no policy. Staff read through organisation_admin(); the public sees
-- "affiliated" and the accreditation level through org_tree().

-- 0123 -------------------------------------------------------------------------
create table public.role_types (
  code              text primary key check (code ~ '^[a-z_]{3,40}$'),
  label             text not null,
  org_kinds         text[] not null,
  perms             text[] not null default '{}',
  projects          text[] not null default '{}'
                      check (projects <@ array['league_admin','team_manager','statistician']),
  inherits          boolean not null default false,  -- applies to descendants along parent_id
  root_grant_only   boolean not null default false,  -- only org.manage at the tenant root may grant it
  position_of_trust boolean not null default false,  -- adult only; credential checks from 0125
  public_listing    boolean not null default false   -- may be shown on a club page
);
-- RLS: role_types_read FOR SELECT USING (true). No write policy: seeded by migration only.
```

**Why `organisations` is public.** It holds names, kinds and structure, the same
things PlayHQ's public API and BE's own regions page publish. It carries no
contact details. Club contacts stay on 0036's closed `team_contacts`, because a
club's contact is usually a volunteer's own email.

**The tree trigger.** `organisations_tree` is a BEFORE INSERT OR UPDATE OF
`parent_id` trigger. It:

- sets `tenant_id` and `path` from the parent (a root gets `tenant_id = id`,
  `path = array[id]`);
- refuses a cycle (`new.id = any(parent.path)`);
- refuses a dissolved or merged parent;
- refuses a parent kind not in the table below.

An AFTER UPDATE OF `parent_id` trigger rewrites the path of every descendant
(`where path @> array[new.id]`). From 0122 the BEFORE trigger also refuses a
change of `tenant_id` while the subtree holds persons, registrations or
organisation roles. Moving people between controllers is a deliberate procedure,
never a side effect (open question 11).

| kind | may have as parent |
|---|---|
| `national_body` | none (a tenant) |
| `region` | `national_body` |
| `association` (a local league body, or an independent league's organiser) | none (a tenant), `national_body`, `region` |
| `club`, `school` | `national_body`, `region`, `association` |
| `partner` (AoC Sport and similar) | `national_body` |

### 3.2 Columns added to the competition layer (0119)

```sql
alter table public.leagues
  add column organiser_id uuid references public.organisations on delete restrict;   -- guarded
create index leagues_organiser on public.leagues (organiser_id) where organiser_id is not null;

alter table public.teams
  add column club_id   uuid references public.organisations on delete restrict,     -- guarded
  add column age_group text check (age_group is null or age_group ~ '^(U[0-9]{1,2}|senior|masters|open)$'),  -- guarded
  add column gender    text check (gender is null or gender in ('men','women','boys','girls','mixed','open')); -- guarded
create index teams_club on public.teams (club_id) where club_id is not null;

alter table public.competitions
  add column age_group text check (age_group is null or age_group ~ '^(U[0-9]{1,2}|senior|masters|open)$'),
  add column gender    text check (gender is null or gender in ('men','women','boys','girls','mixed','open')),
  add column level     text check (level is null or char_length(level) <= 40),  -- 'premier','conference','D1'
  add column born_from date,
  add column born_to   date,
  add constraint competitions_born_ck check (born_from is null or born_to is null or born_from <= born_to);

alter table public.competition_teams
  add column id uuid not null default gen_random_uuid();   -- rewrites a small table
create unique index competition_teams_id on public.competition_teams (id);

-- external_identities: widen the inline entity_type check (found by name in pg_constraint)
--   to ('player','team','competition','venue','person','organisation','league','season',
--       'competition_team','registration')
alter table public.external_identities
  add constraint ext_ident_personal_payload_ck
  check (entity_type not in ('person','registration') or payload = '{}'::jsonb);
```

- **Guards.** `org_links_guard` is a BEFORE INSERT OR UPDATE OF `organiser_id`
  trigger on `leagues`, and of `club_id, age_group, gender` on `teams`. It raises
  42501 when a value changes (or an insert sets one) unless `epinoia.org_rpc` is
  `'on'`. Only `set_league_organiser` and `set_team_club` set it. Without the
  guards, `leagues_write` (0001:379) and `teams_write` (0028:29) would let a
  league admin or club manager move themselves into an organisation's
  inheritance.
- **Why `competition_teams.id`.** A PlayHQ team id is one season's entry in one
  division, not a club side (research_basketball §3.2). It needs a row of its
  own to hang an external identity on, which leaves 0077's one-id-per-entity
  rule intact.
- **Why the payload check.** `external_identities.payload` is "kept verbatim"
  (0077:58). A PlayHQ profile payload carries guardians, emergency contacts and
  disability answers. Person and registration identities store the id only.
- **Age functions** (immutable, granted to anon):
  - `public.season_age(p_dob date, p_start_year int, p_cutoff text default '09-01') returns int`:
    age on the day before the cut-off in the season's start year.
  - `public.age_band_born(p_band int, p_start_year int, p_cutoff text default '09-01') returns daterange`:
    from the cut-off day and month in year `p_start_year - p_band`, to the day
    before the cut-off in year `p_start_year - p_band + 2` (with the default
    `09-01`: `make_date(y - band, 9, 1)` to `make_date(y - band + 2, 9, 1) - 1`).
  - The 0119 self-test asserts that U18 in 2026/27 is 2008-09-01 to 2010-08-31,
    the dates Appendix 2 quotes.

### 3.3 The restricted schema (0120)

```sql
create schema if not exists restricted;
revoke all on schema restricted from public, anon, authenticated;
grant usage on schema restricted to service_role;
```

Every table in it has:

- RLS enabled with **no policy**;
- `revoke all ... from public, anon, authenticated`;
- `owner to postgres` (asserted).

Every function in it is revoked from `public, anon, authenticated`. PostgREST
does not expose the schema at all, so Edge Functions and the Python import
script reach it through `public` RPCs granted to `service_role`.

**If `create schema` is refused** under the CLI's temporary login role, 0120
fails harmlessly on push. The fallback keeps the same design:

- tables named `restricted_*` in `public`, with `revoke all from anon, authenticated`;
- the catalogue test matches the prefix instead of the schema.

This is why the schema is first created in the smallest slice, this month.

### 3.4 People (0122)

```sql
create table restricted.persons (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.organisations on delete restrict,
  given_name           text not null check (char_length(btrim(given_name)) between 1 and 80),
  family_name          text not null default '' check (char_length(family_name) <= 80),
  preferred_name       text check (char_length(preferred_name) <= 80),
  name_key             text not null,        -- folded given||' '||family: lower, diacritics via translate(), no spaces/hyphens/apostrophes. Trigger
  date_of_birth        date,
  birth_year           smallint check (birth_year between 1900 and 2100),
  dob_source           text check (dob_source in ('self','guardian','club','import','document_seen','id_verified')),
  gender               text not null default 'not_stated'
                         check (gender in ('female','male','non_binary','not_stated')),
  nationalities        text[] not null default '{}',   -- ISO alpha-2, trigger-validated; quotas and clearance only
  identity_verified_at timestamptz,
  identity_method      text check (identity_method in ('stripe_identity','in_person','migration')),
  identity_verified_by uuid references auth.users on delete set null,
  visibility           text not null default 'private' check (visibility in ('public','private')),
  player_id            uuid references public.players on delete set null,
  status               text not null default 'active' check (status in ('active','merged','restricted','erased')),
  merged_into          uuid references restricted.persons on delete restrict,
  last_active_on       date,                 -- latest end of any registration or role here; retention anchor
  source               text not null default 'epinoia'
                         check (source in ('epinoia','self','registration','role_grant','import_playhq')),
  created_by           uuid references auth.users on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint persons_dob_year_ck check (date_of_birth is null or birth_year = extract(year from date_of_birth)),
  constraint persons_merge_ck    check ((status = 'merged') = (merged_into is not null)),
  constraint persons_self_ck     check (merged_into is null or merged_into <> id)
);
create index persons_match on restricted.persons (tenant_id, name_key, date_of_birth);
create index persons_player on restricted.persons (player_id) where player_id is not null;
create unique index persons_one_per_player_per_tenant
  on restricted.persons (tenant_id, player_id) where player_id is not null and status = 'active';

create table restricted.person_contacts (            -- 1:1; never loaded with lists or cards
  person_id              uuid primary key references restricted.persons on delete cascade,
  tenant_id              uuid not null,
  email                  text check (email is null or email = lower(btrim(email))),
  email_verified_at      timestamptz,
  mobile_e164            text check (mobile_e164 is null or mobile_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  address_line1          text, address_line2 text, town text, postcode text,
  country                char(2),
  emergency_name         text, emergency_mobile text, emergency_relationship text,  -- no emergency email: not needed
  updated_by             uuid references auth.users on delete set null,
  updated_at             timestamptz not null default now()
);
create index person_contacts_email on restricted.person_contacts (tenant_id, email) where email is not null;

create table restricted.person_accounts (            -- a login is "self" for at most one person per tenant
  id              uuid primary key default gen_random_uuid(),
  person_id       uuid not null references restricted.persons on delete cascade,
  tenant_id       uuid not null,
  user_id         uuid not null references auth.users on delete cascade,
  method          text not null check (method in ('email_match','code','staff_review','guardian_handover','role_grant')),
  linked_at       timestamptz not null default now(),
  unlinked_at     timestamptz,
  unlinked_reason text check (unlinked_reason in ('user','staff','dispute','merged','erased'))
);
create unique index person_accounts_one_owner on restricted.person_accounts (person_id) where unlinked_at is null;
create unique index person_accounts_one_self  on restricted.person_accounts (user_id, tenant_id) where unlinked_at is null;
create index        person_accounts_user      on restricted.person_accounts (user_id) where unlinked_at is null;

create table restricted.guardianships (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null,
  child_id                uuid not null references restricted.persons on delete cascade,
  guardian_person_id      uuid references restricted.persons on delete set null,
  slot                    smallint check (slot in (1,2)),                 -- PlayHQ parentGuardian1 / 2
  given_name text, family_name text, email text, mobile_e164 text,       -- when the guardian is not a person
  relationship            text not null check (relationship in
                            ('parent','legal_guardian','carer','account_holder','other')),
  parental_responsibility boolean not null default false,
  may_manage              boolean not null default true,
  may_consent             boolean not null default false,
  verification            text not null default 'declared'
                            check (verification in ('declared','email_match','club_verified','imported','document_seen')),
  starts_on               date not null default ((now() at time zone 'Europe/London')::date),
  ends_on                 date,
  ended_reason            text check (ended_reason in ('age_of_majority','revoked','court_order','merged','erased')),
  created_by              uuid references auth.users on delete set null,
  created_at              timestamptz not null default now(),
  constraint guard_who_ck     check (guardian_person_id is not null or given_name is not null),
  constraint guard_self_ck    check (guardian_person_id is null or guardian_person_id <> child_id),
  constraint guard_consent_ck check (not may_consent or parental_responsibility)
);
create unique index guardianships_live_person on restricted.guardianships (child_id, guardian_person_id)
  where ends_on is null and guardian_person_id is not null;
create unique index guardianships_live_slot on restricted.guardianships (child_id, slot)
  where ends_on is null and slot is not null;
create index guardianships_guardian on restricted.guardianships (guardian_person_id) where ends_on is null;

create table restricted.consent_records (            -- append-only (trigger refuses update/delete except erasure)
  id             bigserial primary key,
  tenant_id      uuid references public.organisations on delete restrict,
  person_id      uuid references restricted.persons on delete cascade,
  player_id      uuid references public.players on delete cascade,      -- history for unlinked players (0049/0052)
  league_id      uuid references public.leagues on delete set null,     -- whose consent_age applied (legacy)
  purpose        text not null check (purpose in ('publish_profile','publish_photo','marketing',
                   'equality_monitoring','video_streaming','privacy_notice','terms')),
  granted        boolean not null,
  given_by       text not null check (given_by in ('self','guardian','staff_on_evidence','import','legacy')),
  guardianship_id uuid references restricted.guardianships on delete set null,
  given_by_name  text check (char_length(given_by_name) <= 120),
  method         text not null check (method in ('online','paper','email','import','legacy')),
  notice_version text check (char_length(notice_version) <= 40),
  evidence       text check (char_length(evidence) <= 400),
  recorded_by    uuid references auth.users on delete set null,
  recorded_at    timestamptz not null default now(),
  constraint consent_subject_ck check (num_nonnulls(person_id, player_id) >= 1)
);
create index consent_person on restricted.consent_records (person_id, purpose, recorded_at desc);
create index consent_player on restricted.consent_records (player_id, purpose, recorded_at desc) where player_id is not null;

create table restricted.legal_holds (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.organisations on delete restrict,
  person_id    uuid references restricted.persons on delete restrict,   -- a held person cannot be deleted
  player_id    uuid references public.players on delete restrict,       -- platform-level holds (existing leagues)
  org_id       uuid references public.organisations on delete restrict,
  scope        text not null check (scope in ('discipline','safeguarding','anti_doping','litigation',
                 'insurance','regulator','data_request')),
  reference    text not null check (char_length(reference) between 1 and 120),  -- case id held elsewhere (MyConcern, F7)
  review_on    date not null,
  placed_by    uuid references auth.users on delete set null,
  placed_at    timestamptz not null default now(),
  released_by  uuid references auth.users on delete set null,
  released_at  timestamptz,
  release_note text check (char_length(release_note) <= 400),
  constraint hold_subject_ck check (num_nonnulls(person_id, player_id, org_id) >= 1)
);
create index legal_holds_live on restricted.legal_holds (person_id) where released_at is null;

alter table restricted.data_requests
  add column person_id uuid references restricted.persons on delete set null;
alter table public.team_staff       add column person_id uuid;   -- no FK across into restricted from a manager-writable table; validated by RPC
alter table public.league_officials add column person_id uuid;   -- same
```

**Why `team_staff.person_id` and `league_officials.person_id` have no foreign
key.** Both tables are written directly by managers and league admins
(0036:155, 0078:64). A foreign key into `restricted` would make those writers
check a table they cannot see. The columns are set only by `link_staff_person`
and `link_official_person`, and the guard trigger from §3.2 is extended to them.
The reference list covers both.

### 3.5 Organisation roles and the projection (0123)

```sql
create table restricted.org_roles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organisations on delete restrict,
  org_id       uuid not null references public.organisations on delete restrict,
  person_id    uuid not null references restricted.persons on delete restrict,
  role         text not null references public.role_types on delete restrict,
  starts_on    date not null default ((now() at time zone 'Europe/London')::date),
  ends_on      date,
  confirmed_at timestamptz default now(),          -- null = pending (imported PlayHQ admins wait here)
  confirmed_by uuid references auth.users on delete set null,
  revoked_at   timestamptz,                        -- immediate end
  revoked_by   uuid references auth.users on delete set null,
  end_reason   text check (char_length(end_reason) <= 200),
  granted_by   uuid references auth.users on delete set null,
  granted_at   timestamptz not null default now(),
  source       text not null default 'epinoia' check (source in ('epinoia','import_playhq','backfill')),
  note         text not null default '' check (char_length(note) <= 400),
  constraint org_roles_dates_ck check (ends_on is null or ends_on >= starts_on)
);
create index org_roles_person on restricted.org_roles (person_id) where revoked_at is null;
create index org_roles_org    on restricted.org_roles (org_id, role) where revoked_at is null;
-- trigger org_roles_no_overlap: refuses a second unrevoked row for the same (person, org, role)
-- whose date range overlaps. Written as a trigger so btree_gist is not needed.

alter table public.memberships
  add column derived_from uuid references restricted.org_roles on delete cascade,  -- null = granted directly, as today
  add column valid_until  timestamptz;                                            -- null = no end, as today
create index memberships_derived on public.memberships (derived_from) where derived_from is not null;
-- trigger memberships_derived_guard (§6.4). The unique key, enums and 0117 constraint are unchanged.
```

### 3.6 Registrations and credentials (0125)

```sql
create table restricted.registrations (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.organisations on delete restrict,
  person_id         uuid not null references restricted.persons on delete restrict,
  kind              text not null check (kind in ('membership','competition')),
  role              text not null check (role in ('player','coach','assistant_coach','team_manager',
                      'bench_personnel','referee','referee_coach','table_official','statistician',
                      'volunteer','supporter')),
  source            text not null default 'registration'
                      check (source in ('registration','season_permit','game_permit','transfer','import')),
  product           text check (char_length(product) <= 60),   -- 'participant','performance_national' …; priced in R1
  org_id            uuid not null references public.organisations on delete restrict,  -- organisationRegisteredToId
  league_id         uuid references public.leagues on delete set null,                -- competitionRegisteredToId
  season_id         uuid references public.seasons on delete set null,                -- seasonRegisteredToId
  team_id           uuid references public.teams on delete set null,                  -- teamRegisteredToId, resolved
  team_name_raw     text check (char_length(team_name_raw) <= 120),                   -- teamName when unresolved
  season_label      text check (season_label ~ '^[0-9]{4}/[0-9]{2}$'),
  valid_from        date,                  -- season start, permitFrom, or membership start
  valid_to          date,                  -- season end, permitTo, or +365 days
  status            text not null default 'pending'
                      check (status in ('pending','active','blocked','cancelled','expired','transferred')),
  pending_on        text[] not null default '{}'
                      check (pending_on <@ array['approval','id_check','dbs','course','clearance','visa','age','payment']),
  status_reason     text check (char_length(status_reason) <= 200),                   -- PlayHQ block reason limit
  blocked_at_org    uuid references public.organisations on delete set null,
  block_locks_below boolean not null default false,
  previous_id       uuid references restricted.registrations on delete set null,       -- previousRegistrationId
  submitted_at      timestamptz not null default now(),                                -- registrationDate
  submitted_by      uuid references auth.users on delete set null,
  decided_by        uuid references auth.users on delete set null,
  decided_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint reg_dates_ck  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  constraint reg_block_ck  check (status <> 'blocked' or (status_reason is not null and blocked_at_org is not null)),
  constraint reg_active_ck check (status <> 'active' or pending_on = '{}'),
  constraint reg_permit_ck check (source not in ('season_permit','game_permit') or (valid_from is not null and valid_to is not null))
);
create unique index registrations_one_per_role on restricted.registrations
  (person_id, kind, role, org_id,
   coalesce(team_id,   '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status in ('pending','active','blocked');
create index registrations_org    on restricted.registrations (org_id, status);
create index registrations_person on restricted.registrations (person_id);
create index registrations_team   on restricted.registrations (team_id) where team_id is not null;

create table restricted.credentials (                 -- STATUS ONLY: never a certificate, number, document or image
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organisations on delete restrict,
  person_id   uuid not null references restricted.persons on delete cascade,
  kind        text not null check (kind in ('dbs_enhanced','safeguarding_course','welfare_officer_course',
                'coach_award','referee_award','table_official_award','statistician_award',
                'id_verification','right_to_work','international_clearance','non_national_type')),
  level       text check (char_length(level) <= 40),                  -- 'L2', 'type_1'
  status      text not null check (status in ('valid','pending','expired','not_valid','not_required',
                'check_required','cleared_in','cleared_out','not_applicable','action_required')),
  issued_on   date,
  expires_on  date,
  provider    text not null check (provider in ('know_your_people','learning_nexus','sport_structures',
                'stripe_identity','fiba_map','staff','import_playhq','import_csv')),
  reference   text check (char_length(reference) <= 120),              -- the provider's case reference
  note        text not null default '' check (char_length(note) <= 400),
  set_by      uuid references auth.users on delete set null,
  set_at      timestamptz not null default now(),
  unique (person_id, kind, provider)
);
-- history: audit_log action 'credential.set' with old and new status (never the reference)

alter table public.roster_entries add column registration_id uuid;  -- no FK into restricted (roster_write is a manager policy);
                                                                    -- set only by RPC; org_links_guard is extended to refuse a direct change
```

### 3.7 Claims and merges (0127)

```sql
create table restricted.person_claims (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  person_id            uuid not null references restricted.persons on delete cascade,
  user_id              uuid not null references auth.users on delete cascade,
  relation             text not null check (relation in ('self','guardian')),
  method               text not null check (method in ('email_match','code','staff_review')),
  code_hash            text,                        -- sha256(code || id); never the code
  sent_to              text check (sent_to in ('email','mobile')),
  attempts             smallint not null default 0 check (attempts between 0 and 5),
  expires_at           timestamptz,                 -- 60 minutes for a code
  guardian_approved_at timestamptz,                 -- 13–17 self claims
  guardian_approved_by uuid references auth.users on delete set null,
  evidence             text check (char_length(evidence) <= 600),   -- staff route: old email, last club
  outcome              text not null default 'pending' check (outcome in ('pending','approved','refused','expired')),
  decided_by           uuid references auth.users on delete set null,
  decided_at           timestamptz,
  created_at           timestamptz not null default now()
);
create index person_claims_user on restricted.person_claims (user_id, created_at desc);

create table restricted.person_merges (                -- dedupe proposals, decisions, merges, undo data
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('person','player')),
  tenant_id      uuid references public.organisations on delete restrict,   -- null for player merges
  survivor_id    uuid not null,                     -- persons.id or players.id by kind; checked by the functions
  merged_id      uuid not null,
  status         text not null check (status in ('proposed','dismissed','merged','undone')),
  source         text not null check (source in ('dedupe_scan','registrar','claim','import_playhq','platform')),
  score          numeric(4,3),
  matched_fields text[] not null default '{}',
  conflicts      jsonb not null default '{}'::jsonb,   -- differing values by field NAME
  moved          jsonb not null default '{}'::jsonb,   -- {"restricted.registrations":[ids], "public.roster_entries":[ids]}
  snapshot       jsonb,                             -- merged side before the merge; excludes person_sensitive; nulled at 90 days
  external_ref   text,                              -- PlayHQ claimed-profile id
  reason         text check (char_length(reason) <= 400),
  decided_by     uuid references auth.users on delete set null,
  decided_at     timestamptz,
  undone_by      uuid references auth.users on delete set null,
  undone_at      timestamptz,
  created_at     timestamptz not null default now(),
  constraint merge_distinct_ck check (survivor_id <> merged_id),
  constraint merge_tenant_ck   check ((kind = 'person') = (tenant_id is not null))
);
create unique index person_merges_open_pair on restricted.person_merges
  (kind, least(survivor_id, merged_id), greatest(survivor_id, merged_id))
  where status in ('proposed','dismissed');

alter table public.players
  add column merged_into uuid references public.players on delete restrict,
  add constraint players_not_self_merged check (merged_into is null or merged_into <> id);
create index players_merged on public.players (merged_into) where merged_into is not null;
```

### 3.8 Data protection tables (0120, 0124)

```sql
-- 0120 -------------------------------------------------------------------------
create table restricted.data_requests (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid references public.organisations on delete restrict,   -- null = Epinoia is the controller
  kind                  text not null check (kind in ('access','erasure','rectification','restriction',
                          'objection','portability','complaint')),
  requester_user        uuid references auth.users on delete set null,
  requester_name        text not null check (char_length(btrim(requester_name)) between 1 and 120),
  requester_email       text not null check (requester_email = lower(btrim(requester_email))),
  capacity              text not null default 'self' check (capacity in ('self','guardian','representative')),
  details               text not null default '' check (char_length(details) <= 4000),
  received_at           timestamptz not null default now(),
  ack_due_at            timestamptz,                -- complaints: received_at + 30 days
  acknowledged_at       timestamptz,
  identity_confirmed_at timestamptz,
  paused_at             timestamptz,                -- "stop the clock" while identity or scope is clarified
  paused_days           int not null default 0 check (paused_days >= 0),
  extended_until        timestamptz,
  extension_reason      text check (char_length(extension_reason) <= 400),
  due_at                timestamptz not null,       -- trigger
  status                text not null default 'received' check (status in ('received','awaiting_identity',
                          'awaiting_clarification','in_progress','completed','refused','withdrawn')),
  assigned_to           uuid references auth.users on delete set null,
  outcome               text check (char_length(outcome) <= 2000),
  export_path           text,                       -- private bucket object; signed URL only
  closed_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index data_requests_queue on restricted.data_requests (tenant_id, status, due_at);

create table restricted.retention_schedule (
  id           serial primary key,
  tenant_id    uuid references public.organisations on delete cascade,   -- null = platform default
  record_class text not null,
  keep_for     interval not null,
  anchor       text not null check (anchor in ('last_active','ended','closed','created','expires','released','applied')),
  action       text not null check (action in ('delete','anonymise','null_fields','review')),
  basis        text not null,
  approved_by  text,                                -- null = proposed; run_retention ignores it
  approved_on  date
);
create unique index retention_one on restricted.retention_schedule
  (record_class, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.audit_log add column tenant_id uuid, add column person_id uuid;
create index audit_log_person on public.audit_log (person_id, created_at desc) where person_id is not null;
create index audit_log_tenant on public.audit_log (tenant_id, created_at desc) where tenant_id is not null;
-- audit_log.actor: the FK becomes ON DELETE SET NULL (added NOT VALID, then validated) — P0.7
-- policy audit_insert: WITH CHECK (actor = auth.uid()) — P0.4

-- 0124 -------------------------------------------------------------------------
create table restricted.person_sensitive (            -- special category. No staff read path to rows
  person_id         uuid primary key references restricted.persons on delete cascade,
  tenant_id         uuid not null,
  ethnicity         text check (char_length(ethnicity) <= 60),     -- ONS 2021 category codes
  disability        text check (disability in ('yes','no','prefer_not_to_say')),
  disability_detail text[],
  religion          text check (char_length(religion) <= 60),
  sexual_orientation text check (char_length(sexual_orientation) <= 60),
  gender_identity_same_as_birth text check (gender_identity_same_as_birth in ('yes','no','prefer_not_to_say')),
  condition         text not null check (condition in ('explicit_consent','dpa2018_sch1_para8')),
  collected_from    text not null check (collected_from in ('self','guardian','import')),
  consent_record_id bigint references restricted.consent_records on delete set null,
  collected_at      timestamptz not null default now()
);
-- a trigger nulls every column not listed in the tenant's settings.sensitive_fields
```

### 3.9 Import staging (0121)

```sql
create table restricted.import_batches (
  id           uuid primary key default gen_random_uuid(),
  source_id    text not null references public.external_sources on delete restrict,   -- 'playhq-be'
  tenant_id    uuid references public.organisations on delete restrict,
  file_kind    text not null check (file_kind in ('dwh_organisations','dwh_competitions','dwh_competition_seasons',
                 'dwh_club_invites','dwh_profiles','dwh_claimed_profiles','dwh_competition_registrations',
                 'api_grades','api_teams','csv_competition_participants','csv_games_played','csv_fill_in',
                 'csv_suspensions','admin_roles')),
  file_name    text not null,
  file_sha256  text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  row_count    int,
  status       text not null default 'staged' check (status in ('staged','validated','applied','failed','discarded')),
  report       jsonb not null default '{}'::jsonb,   -- counts, messages, ids and field NAMES only
  uploaded_by  uuid references auth.users on delete set null,
  uploaded_at  timestamptz not null default now(),
  applied_at   timestamptz,
  purge_after  date not null default (current_date + 90),
  unique (source_id, file_kind, file_sha256)
);

create table restricted.import_rows (
  batch_id    uuid not null references restricted.import_batches on delete cascade,
  row_no      int not null,
  external_id text,
  fields      jsonb,                              -- parsed and minimised; nulled at apply or after 14 days
  dropped     text[] not null default '{}',       -- NAMES of fields dropped at parse, never values
  action      text check (action in ('create','update','link','unchanged','conflict','skip','error')),
  target_type text,
  target_id   uuid,
  message     text check (char_length(message) <= 400),
  primary key (batch_id, row_no)
);
```

### 3.10 What that adds up to

- **3 new public tables**: `organisations`, `org_affiliations`, `role_types`.
- **16 restricted tables**: `data_requests`, `retention_schedule`,
  `import_batches`, `import_rows`, `persons`, `person_contacts`,
  `person_accounts`, `guardianships`, `consent_records`, `legal_holds`,
  `org_roles`, `person_sensitive`, `registrations`, `credentials`,
  `person_claims`, `person_merges`.
- **11 grown tables**: `leagues`, `teams`, `competitions`, `competition_teams`,
  `external_identities`, `memberships`, `players`, `roster_entries`,
  `team_staff`, `league_officials`, `audit_log`.

That is 19 new tables, against migration's 25 and registry's 22. evolve's 8 were
fewer because it overloaded `players` and `memberships`, which is exactly what
§0.4 rows 1 and 4 refuse.

---

## 4. Hierarchy and tenancy

### 4.1 Basketball England

```
Basketball England                       organisations(kind national_body) — tenant, controller
 ├─ 10 regions                           kind region, parent BE
 │    ├─ local league bodies (69)        kind association, parent region; organiser of their leagues
 │    └─ clubs                           kind club, parent region (default; open question 3)
 │         └─ public.teams               club_id → the club; age_group, gender; one row per league as today
 ├─ AoC Sport                            kind partner, parent BE (holds roles on EABL/WEABL)
 └─ schools (Dynamik Schools entrants)   kind school
leagues: NBL, Junior NBL, National Cups  organiser_id = BE
leagues: each local league               organiser_id = its association
```

**How PlayHQ's structure maps.** PlayHQ's structure (tenant → administrative
body → association → club → team; competition → season → division) maps like
this:

| PlayHQ | Epinoia |
|---|---|
| ADMINISTRATIVE_BODY without a parent | `national_body` |
| ADMINISTRATIVE_BODY with a parent | `region` |
| ASSOCIATION | `association` |
| CLUB | `club` |
| Competition | `leagues` (`CompetitionOwnerId` → `organiser_id`) |
| Competition Season | `seasons` |
| Grade / Division | `competitions` (age, gender, level, `born_from`/`born_to`) |
| Team (one season's entry) | a `competition_teams` row (its `id` holds the PlayHQ team id) plus the `teams` row it belongs to |

### 4.2 What the tree decides and what it does not

- **Rights inherit only along `parent_id`, and only for role types with
  `inherits`.** A region admin inherits over the region's associations and
  clubs. A local league body's admins get league-admin rights over the leagues
  it organises, but no person rights over clubs parented to the region.
- **They manage those clubs' entries in their league as they do today.**
  `is_team_manager` already includes league admins of `teams.league_id`
  (0001:297).
- **Affiliations are records, not rights.**
  - The £120 annual affiliation and Level 1/2 accreditation are
    `org_affiliations(kind 'governing_body')`.
  - A club's membership of a local league is `kind 'league_member'`.
  - PlayHQ's "club accepted season invite" is `kind 'season_invite'`.
- **A club in the NBL and in a local league** is one organisation with two
  `teams` rows (one per league, as 0028's trigger requires). Both carry the same
  `club_id`, `age_group` and `gender`, which is what lets later eligibility
  rules (R4) see them as one squad.
- **Team entry** stays `competition_teams`. Entry status, surety and invitations
  are C2 and will be columns there. 0119 adds only `id`.

### 4.3 A league not under a national body

- **Today's leagues:** `organiser_id is null`. Nothing in this contract is
  reached:
  - no persons, roles or registrations;
  - `can_view_league` and every 0118 policy untouched;
  - feed-created leagues unchanged.
- **An independent league that wants clubs, officers or registrations** gets a
  root `organisations` row of kind `association`. It becomes its own tenant and
  controller, with its own settings and DPO role.
- **If it later affiliates to BE**, that is an `org_affiliations` row. BE sees
  the affiliation, not the people.
- **Bringing it under BE's tree changes the controller.** That needs its own
  procedure: both DPOs, a member notice, and dedupe against BE's persons. It is
  not in this contract (open question 11), and the tree trigger refuses it while
  people exist.
- **Other national bodies** (Basketball Scotland, Basketball Wales) are further
  roots, running the same code.

### 4.4 Tenant settings (root `settings` jsonb, validated by trigger)

| key | default | used by |
|---|---|---|
| `minor_age` | 18 | `is_minor` projection, guardianship end |
| `own_login_min_age` | 13 | account linking and claims (UK GDPR Art. 8 age) |
| `publication_consent_age` | 16 (as `leagues.consent_age`) | who may give `publish_profile` / `publish_photo` |
| `age_cutoff` | `"09-01"` | `season_age`, `age_band_born` |
| `merge_min_fields` | 3 | merge rule (PlayHQ parity) |
| `import_special_category` | false | import parser |
| `sensitive_fields` | `[]` | which `person_sensitive` columns may hold values |
| `equality_condition` | `"explicit_consent"` | or `"dpa2018_sch1_para8"` once the controller's policy document exists |
| `dpo_contact` | null | shown on privacy pages and request acknowledgements |

---

## 5. The person record

### 5.1 Fields and where they live

| data | table | who reads it |
|---|---|---|
| names, `name_key`, visibility, status, tenant | `persons` | people with `people.read` in scope; self; managing guardian |
| date of birth, gender, nationalities, identity verification | `persons` | same, through RPCs only; never projected except `birth_year` and `is_minor` |
| email, mobile, address, emergency contact | `person_contacts` | `people.contacts` in scope, self, managing guardian; **every staff read audited** |
| guardians | `guardianships` | the same readers as contacts |
| login link | `person_accounts` | self; registrars (`people.read`) |
| ethnicity, disability, religion, orientation, gender identity | `person_sensitive` | self and a guardian with `may_consent`; nobody else by row |
| registrations, credentials | `registrations`, `credentials` | `people.read` / `credentials.read` in scope |

**Locked identity.** Once `identity_verified_at` is set:

- names, date of birth and gender change only through
  `correct_identity(p_person, p_fields jsonb, p_reason text)`, which needs
  `people.edit` at the tenant root;
- every correction is audited as `person.identity_correct`.

This is PlayHQ's locked name and date of birth. Documents are never stored:
Stripe Identity holds them, and a visa share code is checked once and its result
recorded as a credential.

### 5.2 Date of birth, `birth_year`, `is_minor`, and the players projection

**Why a full date of birth now.** 0001 chose birth year only, which was right
for a results site. A governing body needs the date:

- BE age groups turn on 1 September;
- PlayHQ matches and claims on date of birth;
- merges need it.

The date lives only in `restricted.persons`. The competition layer keeps seeing
`players.birth_year`, `is_minor` and the consent columns. This needs a DPIA
before 0122 holds real data (open question 8).

**The projection (0126).** `restricted.project_player(p_player uuid)` runs for
a player that at least one active person links to:

- **`is_minor`** is true if any linked active person is a minor:
  - known date of birth: `date_of_birth > today − minor_age years`;
  - year only: `current year − birth_year <= 18` (fail closed);
  - neither known: the existing value stays.

  It is false only when every linked person is known to be an adult.
  Disagreement between tenants errs towards "minor".
- **`birth_year`** is filled only when it is null. A conflict with a linked
  person is written to the registrar's conflicts list, never applied: the
  "propose, never overwrite" rule of `epinoia/membership.js`.
- **`first_name` and `last_name`** are projected only from an
  identity-verified person, when exactly one is linked. Otherwise differences
  are reported.
- **Consent, while the player is a minor:**
  - `public_consent` is true only when every linked minor person has a current
    `publish_profile` grant from a valid giver: a guardian with `may_consent`
    below `publication_consent_age`, or the person themselves at or above it;
  - `consent_guardian`, `consent_at` and `consent_by` come from the latest such
    grant;
  - `photo_consent` works the same way from `publish_photo`.

  Once the player is an adult, the values are left as they are:
  `player_withheld` (0049:65) no longer reads them.

**Registry-managed players.**

- **The flag.** `players.registry_managed boolean not null default false` (0126)
  is set only by `link_person_player` and `unlink_person_player`.
- **The guard.** `players_person_guard` is a SECURITY INVOKER BEFORE UPDATE
  trigger. It does nothing for a row whose old and new `registry_managed` are
  both false, so unlinked players cost nothing. When a protected column changes
  (names, `birth_year`, `is_minor`, the consent and photo-consent columns,
  `registry_managed`) and `epinoia.person_projection` is not `'on'`:
  - **`service_role`** (feed ingest, `membership-sync`): the old values are
    silently restored and `audit_log('player.projection_kept')` is written, so
    the ingest never fails;
  - **anyone else**, including definer RPCs such as `set_player_profile`,
    `admin_update_player` and `anonymise_player` (which run as `postgres`),
    gets 42501: "this player's identity and consent are managed through their
    registration".
- **Why a column rather than a lookup.** The guard needs no read of
  `restricted`, which browser roles cannot see. The column tells the public only
  that a player is registered with a governing body, which PlayHQ's public pages
  already show.
- **The daily tick.** `restricted.refresh_person_flags()` re-projects players
  whose linked persons turn 18 today or cross a year boundary, and ends
  guardianships at the age of majority. The ingest runner calls it daily, the
  way it already calls `notify_fixtures` (map_governance §9). If the tick stops,
  minors stay withheld longer, never shorter.

**What does not change.** `players_read` (0049:73) and `prev_clubs_read` are
untouched by every slice. Private adult profiles are §0.4 row 17.

### 5.3 Guardians and dependants

**The account model is PlayHQ's.** An account holder, the parent, is a person
with a login (`person_accounts`). A dependant is a person with a
`guardianships` row naming the holder (`guardian_person_id`,
`relationship 'account_holder'` or `'parent'`, `may_manage`).
`public.my_people()` returns self plus every live managed dependant, per tenant.

**Contact-only guardians.** PlayHQ's `parentGuardian1/2` import as slot 1 and
slot 2 rows with contact fields. A slot is linked to the holder's person when its
email matches. A guardian becomes a person only if they log in, hold a role or
register themselves. That keeps thousands of parents out of dedupe work.

**Consent needs parental responsibility.** `may_consent` requires
`parental_responsibility` (constraint `guard_consent_ck`), so:

- **imported guardians** start `may_consent = false`;
- **an account holder** confirms "I have parental responsibility" in the UI,
  which sets `verification 'declared'`;
- **a club** can record `club_verified`.

**Age bands** (from tenant settings):

- **Under `own_login_min_age` (13).**
  - No `person_accounts` self link.
  - `person_contacts` refuses the child's own email and mobile.
  - An imported child email that equals a guardian's email is recorded on the
    guardianship instead.
- **13 to 17.**
  - A self link needs `approve_child_login` from a managing guardian, and a
    child email different from every guardian's email (the RFU pattern).
  - The guardian keeps `may_manage` until 18.
  - Publication consent follows `publication_consent_age`.
  - Registration stays guardian-led: BE requires a parent to request an
    under-18's transfer (Reg 17.10.2a).
- **At 18.** The daily tick ends minor guardianships
  (`ended_reason 'age_of_majority'`). An adult who wants another adult to manage
  them creates a new `account_holder` link, confirmed by themselves.

### 5.4 Contact data

Contact data is only ever returned by RPCs:

- `person_contact_view(p_person uuid, p_purpose text)`: `people.contacts` in
  scope, or self, or a managing guardian. `p_purpose` is one of `registration`,
  `safeguarding`, `match_day`, `data_request`, `other`.
- Every staff call writes `audit_log(action 'person.read_contacts', tenant_id,
  person_id, detail {purpose})`. That answers "who looked at this child's
  details". PlayHQ keeps an access log only for admin grants.
- Lists (`org_people`, the registrations list) never include contact columns.

Nothing on the scorer, public pages, the API or feeds needs contact data.

### 5.5 Linking an account, and claiming

**Same verified email** (`claim_by_email()`, 0122). The caller's
`auth.users.email` (with `email_confirmed_at` set) is matched against
`person_contacts.email` within each tenant.

- **Exactly one adult person matches**, with no live owner and no admin-type
  role ever held: a self link (`method 'email_match'`).
- **The email is on a guardianship, or on a minor's contact row** (parents often
  put their own email on a child's profile): the account is linked as that
  child's guardian. The guardian person is created if missing
  (`verification 'email_match'`, `may_consent false`). The account is never made
  "self" for a child.
- **Several adults share the email:** no link; the staff route is offered.

**A different email** (`claim` Edge Function plus service RPCs, 0127):

1. The browser posts `{tenant, given, family, dob}` with its JWT.
2. The function calls `claim_prepare(user, tenant, given, family, dob)`. That
   matches `name_key` and date of birth in the tenant, refuses the cases below,
   and creates a `person_claims` row holding `code_hash`, with a 60-minute
   expiry.
3. The function emails the code to the matched person's stored email, or its
   mobile once SMS exists.
4. **The browser always receives the same sentence:** "If a record matches, we
   have sent a code to the contact details on it." That holds whether or not a
   profile matched.
5. `confirm_claim(p_code)` checks the hash, allows 5 attempts, and links (a self
   link, or a guardian link if the matched person is under 13).
6. **Limits:** 3 prepare calls per user per day, and 3 per target person per
   day, counted from `person_claims`.

**Refused by code, sent to staff review instead:**

- a person who has ever held an organisation role with `org.manage` or
  `roles.grant` (PlayHQ refuses claims on profiles that ever had admin access);
- a person with a live account owner;
- a person whose owner link ended in `dispute`.

**Dead email.** `request_claim_review(p_tenant, p_given, p_family, p_dob,
p_evidence)` creates a `staff_review` claim carrying the old email and last
club, for the tenant's registrars. That is BE's current practice.

### 5.6 Privacy defaults for minors (ICO Children's Code)

- **Minors are always private.** A person under 18 is inserted as
  `visibility 'private'`, whatever the source said. A PlayHQ
  `profileVisible = TRUE` on a minor is recorded as evidence
  (`consent_records(given_by 'import', method 'import')`) but **never relied on
  to publish** (open question 4).
- **Publishing a minor** needs a `publish_profile` grant from the right giver
  (§5.2). Withdrawal is a new row and projects at once.
- **Unchanged:** the existing protections (`player_withheld`, the photo-consent
  triggers 0001:497 and 0016, fan search and notifications excluding minors, the
  API's `is_minor` filters).
- **No geolocation** is collected for persons.
- **Turning 18 publishes nothing by itself.**

### 5.7 Dedupe

`restricted.person_duplicates(p_tenant, p_limit)` runs from the import and
nightly, and never merges anything.

- **Blocks:** `(tenant_id, name_key, date_of_birth)`. For people with no date:
  `(tenant_id, birth_year, left(family key, 3))`.
- **Score:** name similarity (trigram when `pg_trgm` exists, otherwise exact
  `name_key`), then equal email, mobile, postcode and external id.
- **Output:** `person_merges(status 'proposed')`. A `dismissed` pair is never
  proposed again, which matters for twins.

### 5.8 Merge

**The single reference list.** `restricted.person_references()` returns one row
per `(table, column, shape, merge action, export, erase action)`. Shape is one of
`fk`, `array`, `text_pid`, `owner_id`, `json` or `id_only`.
`restricted.person_reference_gaps()` compares it with:

- every `pg_constraint` foreign key referencing `restricted.persons` or
  `public.players`;
- every column named `person_id`, `player_id`, `player_uuid`, `player_ids`,
  `fav_player_ids` or `pid`.

A future table added without extending the list fails its own migration's
self-test. Merge, export and erasure all read this one list.

**`merge_persons(p_survivor, p_merged, p_reason)`** needs `people.merge` at an
organisation containing every registration and role of both persons, or at the
tenant root.

It refuses when:

- the two persons are in different tenants, or either is not `active`;
- fewer than `merge_min_fields` of given name, family name, date of birth,
  gender, mobile and postcode match (PlayHQ's six), unless the reason starts
  `override:` and the caller holds `people.merge` at the tenant root, or the
  source is `playhq_profile_claimed`;
- the two have different live account owners;
- a guardianship links them;
- they link to two different players who both have `player_game_stats` in the
  same game (they are two people).

It locks both rows `for update`, then re-points everything in the reference
list, recording every moved id in `moved`:

- `person_contacts`: the survivor's values win; the merged row only fills blanks.
  Conflicts go to `conflicts` by field name.
- `person_accounts`: the merged owner is re-linked only if the survivor has none;
  otherwise unlinked with `merged`.
- `guardianships`: both columns; self-loops and duplicates are ended with
  `merged`.
- `consent_records`, `legal_holds`, `data_requests.person_id`.
- `org_roles`, followed by a recompile for the affected users.
- `registrations`: a collision on the one-per-role key cancels the merged row
  with the note "merged duplicate".
- `credentials`: the later `set_at` wins per `(kind, provider)`. For
  `international_clearance` the status with the later `issued_on` wins
  (PlayHQ's rule).
- `person_sensitive`: the survivor's row wins; the merged row is deleted, **not**
  snapshotted.
- `team_staff.person_id`, `league_officials.person_id`, `person_claims`
  (pending ones refused).
- `external_identities(entity_type 'person')`: **not moved.** The id stays on
  the tombstone, and importers follow `merged_into`.

Finally:

- the merged person becomes `status 'merged'` and `merged_into` is set;
- chains are flattened (`update persons set merged_into = survivor where
  merged_into = merged`), so resolution is always one hop;
- if the two persons link to different players, a `kind 'player'` proposal is
  opened for a platform admin. Player merges are never automatic.

**`merge_players(p_survivor, p_merged, p_reason)`** needs a platform admin,
because statistics are platform-wide. It refuses players who share a game.

It re-points, recording ids:

- `roster_entries` (a duplicate active row at the same team is deactivated);
- `player_suspensions`, `player_previous_clubs`;
- `season_awards`, `season_award_overrides`;
- `toty_candidates`, `toty_votes`, `toty_results` (unique conflicts resolved to
  the survivor);
- `membership_eligibility` (newest `checked_at` wins its unique key);
- `player_game_stats.player_uuid`;
- `highlight_jobs.player_id`;
- `media` with `owner_type 'player'`, and `players.photo_media_id` only if the
  survivor has none;
- `fan_prefs.fav_player_ids` (replace, then de-duplicate);
- `persons.player_id` and `consent_records.player_id`.

It deliberately does **not** rewrite:

- `game_events.pid` (append-only by trigger, 0001);
- `games.roster_snapshot` and `starters` (history);
- `player_game_stats.player_id` (the pid, part of the primary key);
- `lineup_stints.player_ids` (regenerated from events at re-finalise, §0.4
  row 16);
- `audit_log`.

**How old ids still resolve:**

- `stamp_player_uuid` (0011) becomes
  `new.player_uuid := (select coalesce(p.merged_into, p.id) from players p where p.id = new.player_id::uuid)`,
  so a re-finalise lands on the survivor;
- `player_redirect(p_slug)` (anon) sends old profile links to the survivor;
- `player_aliases(p_ids uuid[])` (anon) returns merged-to-survivor pairs, only
  where the survivor is publicly readable under `players_read`'s rule, so
  `data.js` can fold pids in lineups and play-by-play.

The tombstone player row is never deleted (§0.3: cascades). It drops out of
rosters, season tables and fan search by itself, because those read the
re-pointed rows.

### 5.9 Undo

`unmerge(p_merge uuid)` is allowed for 90 days, while `snapshot` exists:

- the same authority as the merge;
- it moves exactly the ids in `moved` back and restores the snapshot;
- a row changed since the merge is reported in the result, never guessed;
- rows created on the survivor after the merge stay.

PlayHQ's claimed-profile file with `deleted = TRUE`, and the `PROFILE.CLAIMED`
event, call `unmerge` for the merge carrying that `external_ref`.

---

## 6. Roles and permissions

### 6.1 Permission vocabulary

| perm | allows |
|---|---|
| `org.read` | see an organisation's people lists, affiliations and roles (read only) |
| `org.manage` | edit organisations below; record affiliations |
| `competitions.manage` | set league organisers inside scope; (C-workstreams later) |
| `people.read` | person names, dates of birth, registrations, roles |
| `people.contacts` | contact and guardian details (audited per read) |
| `people.edit` | create and edit persons, submit registrations |
| `people.merge` | merge and unmerge persons; decide dedupe proposals |
| `registrations.approve` | approve, cancel, clear pending items |
| `blocks.set` | block and unblock registrations |
| `credentials.read` / `credentials.decide` | see / set or override credential status |
| `roles.grant` | grant and end organisation roles (subset rule, §6.7) |
| `audit.read` | the organisation's audit rows |
| `data_rights.handle` | the requests and complaints queue, export, erasure, holds |
| `equality.aggregate` | suppressed equality summaries |
| `discipline.manage`, `officials.appoint` | reserved for F7/C7 and O2 |

### 6.2 Seeded role types

| code | held at | inherits | projects | perms | PlayHQ equivalent |
|---|---|---|---|---|---|
| `body_admin` | national_body | yes | league_admin | org.read, org.manage, competitions.manage, people.read, people.contacts, people.edit, people.merge, registrations.approve, blocks.set, roles.grant, audit.read | SUPER_ADMIN |
| `region_admin` | region | yes | league_admin | org.read, org.manage, competitions.manage, people.read, registrations.approve, roles.grant, audit.read | ADMIN_BODY |
| `association_admin` | association | yes | league_admin | org.read, org.manage, competitions.manage, people.read, people.edit, registrations.approve, roles.grant | AFFILIATE_ADMIN |
| `org_admin` | any | **no** | league_admin at an organiser; team_manager at a club | org.read, org.manage, people.read, people.edit, registrations.approve, roles.grant | FULL_ACCESS, CLUB_ADMIN |
| `competitions_officer` | national_body, region, association | yes | league_admin | competitions.manage | — |
| `escore_admin` | national_body, region, association | yes | statistician | — | ELECTRONIC_SCORING_ADMIN |
| `registrar` | any | yes | — | org.read, people.read, people.contacts, people.edit, registrations.approve | — (BE Regional Registrar) |
| `read_only` | any | yes | — | org.read, people.read | none: "a true read-only role doesn't exist yet" |
| `club_secretary` | club | no | team_manager | org.read, org.manage, people.read, people.contacts, people.edit, registrations.approve, roles.grant | — |
| `club_chair`, `club_treasurer` | club | no | — | org.read (public listing) | — |
| `welfare_officer` | club, region, national_body | at region/body | — | people.read, people.contacts, credentials.read (position of trust) | — |
| `compliance_officer` | national_body | yes | — | people.read, credentials.read, credentials.decide, registrations.approve, blocks.set | "only BE compliance can override" |
| `discipline_officer`, `appointments_officer` | national_body, region, association | yes | — | people.read, discipline.manage / officials.appoint | — |
| `data_protection_officer` | national_body, association (root only) | yes | — | data_rights.handle, people.read, people.contacts, audit.read (root grant only) | — |
| `edi_officer` | national_body (root only) | yes | — | equality.aggregate (root grant only) | — |

- **What PlayHQ lacks.** Its roles are coarse and permanent. Time-bound roles,
  named functional roles and a read-only role are absent from all 338 help
  articles (research_helpcentre §3).
- **Project, don't grant.** The body, region and association admin roles project
  `league_admin` only. `is_team_manager` already covers every team in a league
  its admins run (0001:297), so projecting `team_manager` for 1,114 NBL teams
  would add rows and nothing else.
- **No club-level scoring role.** `escore_admin` is not offered at club level,
  because Epinoia has no club-scoped scoring right (`may_score_game` ignores
  club-scoped statisticians, map_governance §12). Club scoring stays per game
  (`game_officials`).

### 6.3 In force

A role is in force on London date `d` when all of these hold:

- `revoked_at is null`;
- `confirmed_at is not null`;
- `starts_on <= d`;
- `ends_on is null or ends_on >= d`;
- the holder's person is `active`.

A projected permission row is in force when `valid_until is null or valid_until > now()`.

### 6.4 The projection

**The function.** `restricted.compile_user_grants(p_user uuid) returns int`
(definer, idempotent) runs with `epinoia.grants_compile = 'on'`. It:

1. Deletes that user's `memberships` rows where `derived_from is not null`.
2. For every in-force role of every person the user is linked to (live
   `person_accounts`) whose type projects something, collects scopes:
   - `league_admin` and `statistician`: every league whose `organiser_id` is an
     organisation `o` with `o.path @> array[role.org_id]`, and either
     `type.inherits` or `o.id = role.org_id`;
   - `team_manager`: every team whose `club_id` is such an organisation.
3. Keeps one row per `(role, scope)`, choosing the latest `valid_until`, where
   no end counts as the latest of all. `valid_until = ((ends_on + 1)::timestamp at time zone 'Europe/London')`,
   or null.
4. Inserts
   `(user_id, role, scope_type, scope_id, derived_from, valid_until) ... on conflict (user_id, role, scope_type, scope_id) do nothing`.
   **A direct grant always wins**, and the ingest's upsert target is untouched.

**What calls it** (each AFTER trigger has a `when` clause, so ordinary edits cost
nothing):

- `org_roles` insert or update: the users linked to that person;
- `person_accounts` link or unlink: that user;
- `organisations` update of `parent_id`: users with in-force roles on any
  organisation in the old or new path;
- `leagues` update of `organiser_id`, and `teams` update of `club_id`: users with
  in-force roles on any organisation in the old or new organiser's or club's
  path;
- `revoke_role` after it deletes a direct row: that user, so a projected row can
  take its place;
- `restricted.compile_all_grants()` nightly from the ingest runner, for roles
  that start in the future and as a self-heal.

`restricted.grants_drift()` returns stored rows that differ from a recompute.
The self-test asserts it is empty, and the platform console shows it.

**The guard.** `memberships_derived_guard` is a BEFORE trigger on `memberships`.
Unless `epinoia.grants_compile = 'on'`, it refuses:

- an insert that sets `derived_from`;
- an update that changes any column of a derived row (a no-op upsert passes);
- a delete of a derived row, unless `pg_trigger_depth() > 1` (a cascade from
  `auth.users` or `org_roles`).

**Expiry fails closed.** Expiry is enforced by the `valid_until` predicate in
the helpers, so a dead nightly job cannot keep an ended role alive. It can only
delay a role that starts in the future.

### 6.5 Existing helpers: exactly what changes

| object | latest definition | change | slice |
|---|---|---|---|
| `is_platform_admin()` | 0117:95 | **none**. `platform_admin` is never projected; a national-body admin is not a platform admin | — |
| `is_league_admin(uuid)` | 0001:289 | memberships branch gains `and (m.valid_until is null or m.valid_until > now())` | 0123 |
| `is_team_manager(uuid)` | 0001:297 (granted 0080:21) | same predicate on its memberships branch | 0123 |
| `is_league_statistician(uuid)` | 0072:26 | same predicate | 0123 |
| `may_score_game`, `can_score`, `can_read_game`, `can_read_game_detail`, the inlined 0084/0118 policies, `may_edit_player`, `is_competition_admin`, `is_league_writer`, `can_manage_game`, `can_view_league` | 0072, 0068, 0118, 0052, 0007, 0051 | **none**: they call the helpers above | — |
| `access_features_for(uuid, uuid)` | 0117:524 | predicate on its league_admin/statistician and team_manager branches. The platform branch is unchanged | 0123 |
| `whoami()` | 0050:27 | predicate; `via 'organisation'` on leagues and teams held through `derived_from`; new key `orgs: [{org_id, slug, name, kind, role, starts_on, ends_on}]`. Existing keys are unchanged for users with no organisation roles | 0123 |
| `league_members`, `post_announcement` | 0007, 0106:208 | predicate; `league_members` adds `via` | 0123 |
| `grant_role(text,text,text,uuid)` | 0051:372 | when the conflicting row is derived, converts it to direct (`derived_from = null, valid_until = null`, under the compile flag). Otherwise `on conflict do nothing` as today | 0123 |
| `revoke_role(uuid)` | 0051:428 | refuses a derived row: "this comes from {role} at {organisation}; end it there". Recompiles the user after deleting a direct row | 0123 |
| policy `memberships_admin_write` | 0117:87 | `and derived_from is null` in USING and WITH CHECK | 0123 |
| `membership_status(uuid, date)` | 0077:162 | adds one row per tenant for linked players with native registrations (`source_id 'registry:' \|\| tenant slug`; active→eligible, pending→unregistered, blocked→suspended, expired→lapsed). Output is identical for every unlinked player | 0125 |
| `stamp_player_uuid()` | 0011:19 | follows `players.merged_into` | 0127 |
| `prune_audit_log()` | 0001:548 | keeps `person.*`, `role.*`, `org.*`, `privacy.*`, `merge.*`, `credential.*` rows for 6 years | 0120 |
| `anonymise_player(uuid,text)` | 0001:527 | unchanged; `erase_person` calls it under the projection flag | 0124/0126 |
| `set_player_profile`, `admin_update_player`, portal PATCHes | 0052:27, 0045 | unchanged; refused only for registry-managed players (§5.2) | 0126 |

**Catalogue assertion (0123).** Every `public` function whose `prosrc`
references `memberships` either contains `valid_until` or appears on an explicit
allow-list with a reason. The allow-list is the counting and platform-admin
functions of 0044, `is_platform_admin`, and the `finalise-game` worker lookup
(Edge Function, platform admin only). A later function that reads
`memberships` without the predicate fails its migration.

### 6.6 Helpers for the new tables

All live in `restricted`, are `stable security definer set search_path =
public, restricted`, are owned by `postgres`, and are not callable by browser
roles. Only `public` RPCs call them, and **no policy ever does**.

```sql
restricted.today() returns date                          -- (now() at time zone 'Europe/London')::date
restricted.user_org_scope(p_user uuid, p_perm text) returns setof uuid
  -- organisations o where the user holds an in-force role r granting p_perm and
  -- o.path @> array[r.org_id] and (t.inherits or o.id = r.org_id). Uses the GIN index on path.
restricted.can_org(p_perm text, p_org uuid) returns boolean
  -- public.is_platform_admin() or p_org in (select restricted.user_org_scope(auth.uid(), p_perm))
restricted.person_orgs(p_person uuid) returns setof uuid
  -- org_id of registrations not cancelled (or ended within 400 days) and of org_roles
restricted.can_person(p_perm text, p_person uuid) returns boolean
  -- platform admin, or person_orgs ∩ user_org_scope is non-empty,
  -- or (p_perm = 'people.read' and a linked player is on an active roster of a team the caller manages)
restricted.my_person_ids() returns setof uuid
  -- self persons (live person_accounts) plus dependants with live may_manage guardianships to them
restricted.tenant_setting(p_tenant uuid, p_key text) returns jsonb   -- with the §4.4 defaults
```

**List RPCs compute scope once per statement.** They filter with
`r.org_id = any (array(select restricted.user_org_scope(auth.uid(), 'people.read')))`,
never a per-row `can_person` call. That is the 0084 lesson (0.82 s against
0.23 s per 1,000 rows).

### 6.7 Delegation

**`grant_org_role(p_person, p_org, p_role, p_starts_on, p_ends_on, p_note)`**
refuses unless every one of these holds:

- the role type lists the organisation's kind;
- the caller holds `roles.grant` in force at the organisation or an inheriting
  ancestor, or is a platform admin;
- the role's perms are a subset of the union of the caller's in-force perms at
  that organisation, including inherited ones;
- the grant is not to a person linked to the caller;
- for `root_grant_only` roles, and for any role at a tenant root, the caller
  holds `org.manage` at the root, or is a platform admin;
- for `position_of_trust` roles, the person is an adult. From 0125, missing
  `dbs_enhanced`, `safeguarding_course` or `welfare_officer_course` credentials
  produce a warning, which becomes blocking later (open question 15).

**`grant_org_role_by_email(p_email, ...)`** does the same. When the account has
no linked person in that tenant, it creates a minimal one from the profile's
display name (`source 'role_grant'`, no date of birth) and a
`person_accounts(method 'role_grant')` link.

**`end_org_role(p_role_id, p_ends_on default today, p_reason)`** needs the same
authority. It sets `revoked_at` when ending today. It refuses to end the last
in-force `body_admin` of a tenant unless the caller is a platform admin, as
`revoke_role` protects the last platform admin.

Every grant, end and confirmation is audited (`role.grant`, `role.end`,
`role.confirm`) with `tenant_id` and `person_id`.

### 6.8 Performance on hot paths

- **Anonymous requests:** `auth.uid()` is null, so the extra predicate never
  runs. The cost is exactly today's.
- **Signed-in requests:** one more condition on rows already fetched through
  `memberships (user_id)`. Public final games are still decided by the first
  branch of the inlined 0118 predicates.
- **No new function call per row** on `game_events`, `game_state` or the three
  stats tables. No new join inside any policy.
- **Measured, not assumed.** 0123's self-test runs `EXPLAIN (ANALYZE, BUFFERS)`
  on a 1,000-row `game_events` page and a season `player_game_stats` read as a
  signed-in league admin, before and after. It fails if either is more than 10%
  slower. The baseline is 0084's 0.23 s.

---

## 7. Data protection

### 7.1 Special-category data

- **Where it is held:** only in `restricted.person_sensitive`.
- **Which columns can hold values:** only those listed in the tenant's
  `sensitive_fields`, enforced by trigger.
- **Legal condition:** explicit consent (`consent_records` purpose
  `equality_monitoring`, granted), or the DPA 2018 Sch. 1 para. 8 condition once
  the controller records it in `equality_condition`.
- **Read paths:**
  - the person, or a guardian with `may_consent`:
    `my_equality_data(p_person)` and `set_my_equality_data(p_person, p_fields jsonb)`;
  - the `edi_officer`: `equality_summary(p_org, p_dimension)`, which counts
    across the organisation's subtree, suppresses every cell under 10, and is
    audited;
  - `subject_access_export`, for a confirmed request.

  **There is no staff path to rows.**
- **Withdrawing consent** deletes the row at once.
- **Audit rows, import reports and notifications** never contain the values,
  only field names.
- **Never collected:** health or medical data; PlayHQ's `atsi`,
  `parentGuardiansBornOverseas`, `parentGuardian1CountryOfBirth`,
  `parentGuardian2CountryOfBirth` and `wwc*`; school ids.
- **DBS status** is criminal-offence-adjacent (UK GDPR Art. 10).
  `credentials` holds status, dates, provider and the provider's reference only.
  Readers need `credentials.read`; registrars see only the `pending_on` item.

### 7.2 Retention schedule

These are proposals. 0120 seeds them with `approved_by = null`, and
`run_retention` ignores a row until the controller's DPO approves it.

| record class | keep | anchor | action | basis |
|---|---|---|---|---|
| `person_contacts` (address, email, mobile) | 24 months | last_active | delete | contract / legitimate interests |
| emergency contact fields | 90 days after the last registration ends | ended | null_fields | vital interests while active |
| `persons` identity (DOB, gender, nationalities, verification) | 6 years, and not before the 22nd birthday | last_active | anonymise (names cleared, DOB null, status `erased`) | Limitation Act: 6 years contract; injury 3 years from 18 |
| `registrations` | 6 years | ended | kept, pointing at the anonymised person | contract, insurance |
| `org_roles` and role audit | 6 years | ended | delete | accountability, safeguarding audit |
| `guardianships` (ended) | 12 months | ended | delete | — (consent evidence is kept separately) |
| `consent_records` | 6 years after being superseded or the person anonymised | ended | delete | Art. 7(1) accountability |
| `person_sensitive` | 24 months, or at withdrawal | last_active | delete | consent / Sch. 1 para. 8 |
| `credentials` | 2 years | expires | delete | safer-recruitment audit (DPO to confirm) |
| `person_claims` | 90 days | created | delete | — |
| `person_merges.snapshot` / the merge record | 90 days / 6 years | created | null_fields / delete | undo window / accountability |
| `data_requests` | 6 years | closed | delete | defence of claims |
| `legal_holds` (released) | 6 years | released | delete | — |
| `import_rows.fields` / batches and rows | at apply or 14 days / 90 days | applied or created | null_fields / delete | minimisation |
| export files (private bucket) | 7 days | created | delete (bucket lifecycle) | — |
| `audit_log` | 2 years; `person.*`, `role.*`, `org.*`, `privacy.*`, `merge.*`, `credential.*` 6 years | created | delete | security, accountability |
| names and statistics in the sporting record | kept | — | anonymised on erasure | legitimate interests (needs an assessment, open question 8) |

`restricted.run_retention(p_apply boolean default false)`:

- is called by the nightly runner, in report mode for the first season;
- skips any subject with an unreleased `legal_holds` row;
- writes one `audit_log('privacy.retention')` row per class, with counts, never
  names.

Point-in-time recovery backups keep erased data until the backup window expires.
The privacy notice must say so ("beyond use").

### 7.3 Subject-access export

`subject_access_export(p_request uuid) returns jsonb` needs `data_rights.handle`
in the request's tenant (or a platform admin when `tenant_id` is null), a request
of kind `access` or `portability`, and `identity_confirmed_at` set.

**What it reads:** every row the reference list names for the person, plus:

- `audit_log where person_id`, with actors reduced to role labels;
- merges involving the person;
- the linked player's public record (profile, rosters, season lines,
  suspensions, media paths);
- for the account holder, Epinoia's own account data (`profiles`, `fan_prefs`,
  `notifications`, `access_subscriptions`);
- guardianships, naming the other party only.

**Output:** the `export` Edge Function (service role) writes the file to a
private bucket, stores `export_path`, and hands out a signed URL that expires in
7 days.

`my_data_export()` gives a signed-in person the same export about themselves and
their managed dependants, without a request. It is audited as `privacy.self_export`.

### 7.4 Erasure, restriction and legal holds

`erase_person(p_request uuid)` needs `data_rights.handle` and an `in_progress`
erasure request.

It refuses while any unreleased hold names the person, their linked player, or
an organisation where they hold a registration. It names the hold's scope and
reference only.

Otherwise it:

1. deletes `person_contacts`, `person_sensitive`, `credentials` and
   `person_claims`;
2. ends guardianships and account links (`erased`);
3. deletes every `consent_records` row except one withdrawal record;
4. anonymises the person: names become "Erased person" and `''`, date and year
   are null, status `erased`;
5. deletes `external_identities` for the person;
6. **only if no other active person links the same player** and no hold names
   it, calls `anonymise_player` under the projection flag. It then also strips
   the id from `fan_prefs`, deletes `player_previous_clubs`, and redacts the name
   in `games.roster_snapshot`. The 0116 guard does not judge definer functions
   (§0.3). Otherwise the outcome records a partial erasure and why;
7. keeps statistics rows, which are keyed by uuid;
8. writes `audit_log('privacy.erase')` with counts.

`restrict_person(p_request)` sets `status 'restricted'`: contacts deleted,
identity kept, no processing but storage while a hold or dispute stands.

`place_hold` and `release_hold` need `data_rights.handle`, or
`discipline.manage` for a `discipline` hold. Both are audited. The nightly
runner lists holds past `review_on`.

### 7.5 Consent history

- **Append-only.** `consent_records` refuses update and delete by trigger,
  except inside `erase_person`. Withdrawal is a new row with `granted = false`.
  The current state is the latest row per (person or player, purpose).
- **Unlinked players (0122).** An AFTER UPDATE OF `public_consent`,
  `photo_consent` trigger on `players` (definer, owner `postgres`) appends a row:
  `given_by 'guardian'` when `consent_guardian` is set, `method 'online'`,
  `recorded_by auth.uid()`. It is skipped when `epinoia.person_projection` is on.
  It catches every path: `set_player_profile`, `admin_update_player`, and a
  manager's direct PATCH.
- **Backfill.** 0122 writes one `legacy` row for every player whose consent is
  already recorded.
- **Registration.** Registration itself rests on contract and legitimate
  interests, not consent. Withdrawing an optional consent never cancels a
  registration.

### 7.6 Requests and complaints queue

**Timers**, set by a trigger on `data_requests`:

- `due_at = coalesce(identity_confirmed_at, received_at) + interval '1 month' + paused_days`.
- `extended_until` may be at most 2 further months (UK GDPR Art. 12(3)), with a
  reason. When set, `due_at` becomes that date.
- Moving into `awaiting_identity` or `awaiting_clarification` sets `paused_at`;
  leaving adds the whole days to `paused_days`. This is the "stop the clock" of
  the Data (Use and Access) Act 2025.
- **Complaints:** `ack_due_at = received_at + 30 days`. The Act's
  complaints-handling duty has been in force since 19 June 2026, per the
  research. `due_at = received_at + 3 months`, an internal target, not
  statutory.

**Intake:**

- `submit_data_request(p_kind, p_details, p_tenant)`, signed in;
- `intake_data_request(p jsonb)`, service role, called by the existing `contact`
  Edge Function for people without an account; rate-limited per email.

**Handling:**

- `privacy_queue(p_tenant)` needs `data_rights.handle`. A platform admin handles
  `tenant_id is null`, where Epinoia is the controller for fan accounts.
- `update_data_request(p_id, p_action, p jsonb)`: acknowledge, confirm identity,
  pause, resume, extend, assign, close.

The nightly runner notifies the assignee 7 days before `ack_due_at` and
`due_at`, and on each overdue day.

### 7.7 Audit

- **P0.4:** `audit_insert` becomes `with check (actor = auth.uid())`. Definer
  functions and `finalise-game` (service role) are unaffected.
- **P0.7 (part):** `audit_log.actor` becomes `on delete set null`.
- **New columns:** `tenant_id` and `person_id`.
- **League-readable audit** (`league_audit`, P0.4) and organisation audit
  (`org_audit(p_org)`, needs `audit.read`) read those columns.

---

## 8. Mapping

### 8.1 From the current schema

| today | becomes | how |
|---|---|---|
| `players` | the on-court sporting record, unchanged in meaning | `persons.player_id` links it (only by `link_person_player`: import match, claim or registrar, never bulk guessing); `registry_managed` and the guard (0126); `merged_into` (0127). `players_read` unchanged |
| `teams` (club = team) | a team in one league, optionally belonging to a club | `club_id`, `age_group`, `gender` (0119). `adopt_clubs(p_league)` proposes one club organisation per unlinked team, taking name, slug and crest, for a platform admin to confirm |
| `memberships` | permissions, direct or projected | `derived_from`, `valid_until` (0123); enums, unique key and 0117 constraint unchanged |
| `roster_entries` | the squad and team sheet | `registration_id` (0125), set by RPC, not enforced. A league opt-in to require it is R4 |
| `profiles` | account display name | a person link is `person_accounts` |
| `external_identities` | the single external-id store | more entity types; person and registration rows carry no payload (0119) |
| `league_officials`, `team_staff` | the officials and staff lists the scorer and public views read | `person_id` (0122), set by RPC. Names stay for the scorer dropdown and `team_staff_public` |
| `fan_prefs` | Epinoia account data | unchanged; merge rewrites `fav_player_ids` |
| `membership_eligibility`, `membership_status()` | a cache for sources outside Epinoia | `membership_status` adds native rows for linked players (0125) |
| `player_suspensions`, `team_sanctions` | competition discipline | unchanged; merge re-points. `person_id` so a ban follows a club move is C7 (outstanding #67) |
| `leagues`, `competitions`, `competition_teams` | competition structure | `organiser_id`; age, gender, level and born window; `id` (0119) |
| `player_withheld`, `consent_age`, `anonymise_player` | kept | wrapped by §5.2 and §7.4 |
| `audit_log` | the one audit trail | `tenant_id`, `person_id`, unforgeable actor (0120) |

### 8.2 From PlayHQ data-warehouse files (the primary source)

Profile and registration field names were checked against the saved DWH pages
(§0.3). Organisation, competition and season names come from the migration
design's reading of `dwh-integration__{organisations,competitions,competition-season,competition-club-accepts-invite}`.
**Confirm them against the first real file**; the UK tenant's payload may differ
from the Australian examples.

**Organisations** (`dwh_organisations`)

| field | target |
|---|---|
| `id` | `external_identities(organisation)` |
| `name` | `name` |
| `type` + `parentOrganisationId` | `kind` (§4.1) and `parent_id` |
| `url` | `website` |
| `visible`, `includeInFinder` | `visible` (both must be true) |
| `taxStatus` | `registered_no` when it parses; otherwise reported |
| `orgDefaultTimeZone` | `time_zone` |
| `email`, `contactNumber*`, `address`, `suburb`, `postcode`, `state`, `latitude`, `longitude`, `orgDescription` | **not imported**: an organisation's contact is often a volunteer's personal detail (0036), and venues are C1. Counted in `dropped` |

**Competitions, seasons, divisions, teams, invites**

| field | target |
|---|---|
| Competition `id`, `name` | `external_identities(league)`, `leagues.name` (matched or created; open question 2) |
| Competition `CompetitionOwnerId` | `leagues.organiser_id` |
| Competition `type`, `CompetitionFormat` | reported only |
| Season `id`, `competitionId`, `name`, `startDate`, `endDate` | `external_identities(season)`, `seasons` |
| Season `hasAgeLimit`, `ageLimitDateFrom`, `ageLimitDateTo` | `competitions.born_from` / `born_to` of that season's divisions; compared with `age_band_born` |
| Season `visible` | reported (Epinoia has no hidden season) |
| Club invite `seasonId`, `organisationId` | `org_affiliations(kind 'season_invite')` |
| API `/v1/seasons/{id}/grades` (the DWH has no grade file) | `competitions` + `external_identities(competition)`; age, gender and level |
| API `/v1/seasons/{id}/teams` `id`, `club.id`, `grade.id` | `external_identities(competition_team)` on `competition_teams.id`; `teams.club_id`; the division |
| API `/v2/games/{id}/summary` appearance `isFillIn` | not a person field: M1+R4 audit input |

**Profiles** (`dwh_profiles`)

| field | target |
|---|---|
| `id` | `external_identities(person)` (no payload) |
| `participantFirstName`, `participantLastName` | `given_name`, `family_name` |
| `participantDateOfBirth` (dd/mm/yyyy, parsed strictly; an impossible date is an error) | `date_of_birth`, `dob_source 'import'` |
| `participantGender` (Female / Male / Non-Binary) | `gender` |
| `profileVisible` | adults: `visibility`. Minors: private, plus an evidence-only consent row (§5.6) |
| `accountHolder`, `accountHolderProfileId` | when `accountHolder` is false: `guardianships(guardian_person_id → holder, relationship 'account_holder', verification 'imported', may_consent false)` |
| `accountHolderEmailAddress`, `accountHolderMobile` | the holder's `person_contacts` if empty; seeds `claim_by_email` |
| `participantEmailAddress`, `participantMobilePhone`, `participantAddress`, `participantSuburb` (→ `town`), `participantPostcode`, `participantCountry` | `person_contacts`. Under 13: email and mobile dropped unless equal to a guardian's. `participantState` dropped |
| `parentGuardian1FirstName` / `LastName` / `EmailAddress` / `MobileNumber` (and `…2…`) | `guardianships` slots 1 and 2, linked to the holder's person when the email matches. Guardian addresses are dropped |
| `emergencyContactFirstName` + `LastName`, `emergencyContactMobile`, `emergencyContactRelationship` | `emergency_name`, `emergency_mobile`, `emergency_relationship` |
| `emergencyContactEmailAddress` | dropped |
| `hasDisability`, `disabilities`, `otherDisabilityDescription` | `person_sensitive` **only if** `import_special_category` is true and the field is in `sensitive_fields`; otherwise dropped and counted |
| `additionalDisabilitySupportInformation` | dropped (health data; open question 9) |
| `atsi`, `wwcNumber`, `wwcExpiryDate`, `wwcStateOfIssue`, `parentGuardiansBornOverseas`, `parentGuardian1CountryOfBirth`, `parentGuardian2CountryOfBirth`, `accountHolderExternalAccountId` | always dropped; names counted |
| `createdAt`, `updatedAt` | the batch report only |

**Claimed profiles** (`dwh_claimed_profiles`)

| field | target |
|---|---|
| `id`, `destinationProfileId` | `merge_persons(survivor = destination, merged = id, source 'import_playhq', reason 'playhq_profile_claimed')`, `external_ref = id` |
| `deleted = TRUE` | `unmerge` of that merge |

**Competition registrations** (`dwh_competition_registrations`)

| field | target |
|---|---|
| `id` | `external_identities(registration)` (no payload) |
| `participantProfileId` | `person_id` (through the person's external id; follows `merged_into`) |
| `organisationRegisteredToId` | `org_id` |
| `competitionRegisteredToId`, `seasonRegisteredToId` | `league_id`, `season_id` |
| `competitionSeasonName`, `competitionSeasonStartDate`, `competitionSeasonEndDate` | `season_label`; `valid_from`/`valid_to` unless a permit; validated against the season |
| `teamRegisteredToId`, `teamName` | `team_id` when the id resolves through `competition_team`; otherwise a name match within club and league, with `team_name_raw` kept (PlayHQ's own documentation says team data is not always sent) |
| `registrationDate` | `submitted_at` |
| `role` (Player, Coach, Assistant Coach, Team Manager, Official, Coach Of Match Official, Table Official, Statistician, Bench Personnel, Volunteer, Supporter) | `role` (Official → `referee`, Coach Of Match Official → `referee_coach`); unknown → conflict row |
| `registrationStatus` PENDING_ACTIVATION / REGISTERED / CANCELLED | `pending` (with `pending_on '{approval}'`) / `active` / `cancelled` |
| `source` Registration / Season Permit | `source 'registration'` / `'season_permit'` |
| `permitFrom`, `permitTo` | `valid_from`, `valid_to` |
| `previousRegistrationId` | `previous_id` |
| `participantDateOfBirth`, `participantGender` | compared with the person; conflicts reported, never applied |
| `optInMarketing` | `consent_records(purpose 'marketing', given_by 'import', method 'import')` |
| `schoolID`, `schoolYear` | dropped |

### 8.3 From PlayHQ webhooks (only if a partner agreement ever exists, F6b)

- **Same targets as the DWH.** The dotted names map to the same targets as §8.2:
  `participant.firstName`, `participant.dateOfBirth`,
  `participant.emailAddress`, `parentGuardians[].firstName`,
  `emergencyContact.mobile`, `registration.registrationStatus`.
- **Profile events.** `PROFILE.CLAIMED {claimedProfileId, destinationProfileId, deleted}`
  → merge or unmerge.
- **Admin events.** `ADMIN.INVITED` / `REVOKED {email, role, organisation.id}`
  → `org_roles` created **unconfirmed** (`confirmed_at null`) through
  `grant_org_role_by_email` run as the import. A body admin must confirm before
  anything projects:

  | PlayHQ role | Epinoia role |
  |---|---|
  | SUPER_ADMIN | `body_admin` |
  | ADMIN_BODY | `region_admin` |
  | AFFILIATE_ADMIN | `association_admin` |
  | FULL_ACCESS, CLUB_ADMIN | `org_admin` |
  | ELECTRONIC_SCORING_ADMIN | `escore_admin` at an organiser; nothing at a club (§6.2) |

  The same mapping applies to an `admin_roles` CSV that BE could provide
  instead.

### 8.4 From PlayHQ report CSVs

| report | columns relied on | target |
|---|---|---|
| Competition Participants | status; **Restriction**; coaching level; management access | registration status; `status 'blocked'`, `status_reason 'PlayHQ restriction'`, `blocked_at_org` = the tenant root; `credentials(coach_award, provider 'import_csv')`; management access **not** imported (re-granted natively) |
| Games Played | Eligible / Reason | M1+R4 audit input (not stored by these slices) |
| Fill-in | — | M1+R4 audit input |
| Suspensions | start and end dates, games or weeks (free text) | `player_suspensions` for linked players (games parsed when numeric; text kept in `reason`) |
| Incidents | — | F7 case history (not these slices) |

### 8.5 What cannot come out of PlayHQ

| data | must come from |
|---|---|
| DBS status and dates | Know Your People |
| course status | Learning Nexus (confirm Sport Structures' role) |
| ID verification | Stripe Identity or BE |
| international clearance status | BE (Super Admin statuses are not exported) |
| temporary blocks and suspensions beyond the CSVs | BE |
| membership product, expiry and fees | BE finance |

---

## 9. Migration slices

> **Numbers are provisional from 0121 on.** 0119 and 0120 shipped as written.
> `0121` was taken on 2026-09-17 by notifications v2 (`docs/notifications.md`), so
> each slice below takes the next free number when it is built; its name, not its
> number, is the reference.

Each slice lists its purpose, objects, what it guarantees not to break, its
self-test, what it lets a browser or console do, its size (roadmap scale:
S days, M 1–3 weeks, L 1–2 months) and its calendar. Every slice also runs:

- the §2 rule 7 self-test pattern;
- the "no policy or public view references `restricted`" assertion;
- `supabase/tests/rls.test.mjs` and `authed.test.mjs` before push;
- from 0124, the `person_reference_gaps()` assertion.

### 0119_organisations — **this month (September 2026)**

- **Purpose:** the hierarchy exists and competitions can point at it. Nothing
  uses it for permissions yet.
- **Objects:**
  - `organisations` with its tree and path triggers; `org_affiliations`;
  - `leagues.organiser_id`; `teams.club_id`, `age_group`, `gender`;
    `competitions` age, gender, level and born window; `competition_teams.id`;
  - the widened `external_identities` check and the payload check;
    `org_links_guard`;
  - `season_age`, `age_band_born`;
  - RPCs: `platform_save_organisation`, `platform_move_organisation`,
    `set_league_organiser`, `set_team_club`, `record_affiliation`,
    `adopt_clubs` (all platform admin only until 0123), `organisation_admin`,
    `org_tree` (anon);
  - audit actions `org.*`.
- **Must not break:**
  - `select=*` on `leagues`, `teams`, `competitions`, `competition_teams`;
  - a league admin renaming their league (with 0117's guard);
  - a manager saving their team;
  - `adm/admin.js` enter and withdraw on `competition_teams`;
  - `formats-ui.js`;
  - ingest league and team creation;
  - `membership-sync` upserts;
  - existing PostgREST embeds (no new foreign-key path between existing
    tables).
- **Self-test:**
  - a three-level tree builds the right paths; a cycle, a region under a club,
    and a cross-tenant parent are refused;
  - moving a region rewrites its clubs' paths;
  - a league admin PATCHing `organiser_id`, and a manager PATCHing `club_id` or
    `gender`, get 42501, while the same PATCH with unchanged values succeeds;
  - anon reads visible organisations and cannot write;
  - U18 2026/27 equals 2008-09-01 to 2010-08-31;
  - a `competition_teams` insert without an id works;
  - an `external_identities` person row with a payload is refused;
  - anonymous row counts of `teams` and `leagues` are identical before and
    after.
- **Surfaces:**
  - a platform console **Organisations** tab: build BE's tree, link leagues and
    clubs, record affiliations and accreditation;
  - a public club directory can read `org_tree`.
- **Size:** M.

### 0120_data_rights — **this month (September 2026)**

- **Purpose:** the complaints and subject-rights queue, for Epinoia as controller
  today (the 30-day complaint acknowledgement duty already applies). It also
  creates the `restricted` schema in the smallest possible slice, to settle the
  CLI-role question (§3.3).
- **Objects:**
  - schema `restricted`; `data_requests` with its timer trigger;
    `retention_schedule` (seeded, unapproved);
  - `audit_log.tenant_id` and `person_id`, the actor FK set null, the
    `audit_insert` actor rule, the `prune_audit_log` classes;
  - RPCs `submit_data_request`, `intake_data_request` (service role),
    `privacy_queue`, `update_data_request` (platform admin until the DPO role
    exists in 0123).
- **Must not break:**
  - the `contact` Edge Function;
  - every definer function that writes `audit_log` (they insert `auth.uid()`);
  - `finalise-game`'s service-role audit rows;
  - `platform_audit` reads.
- **Self-test:**
  - anon and authenticated lack USAGE on `restricted`
    (`has_schema_privilege`);
  - a signed-in user submits and can read only their own request through the
    RPC;
  - a complaint gets `ack_due_at` exactly 30 days out;
  - a pause of 5 days moves `due_at` 5 days; an extension beyond 3 months is
    refused;
  - a forged `audit_log` insert with another actor gets 42501;
  - `run_retention(false)` reports and changes 0 rows.
- **Surfaces:**
  - `/epinoia/privacy/`: a request and complaint form with the DPO contact;
  - a platform console **Privacy** tab (queue, timers, actions);
  - the contact form's "privacy request" option;
  - nightly reminders.
- **Size:** S–M.

### 0121_import_staging — October 2026

- **Purpose:** F8 rehearsal step 1. Stage a pilot or BE export and see exactly
  what would happen, without applying anything. It answers open question 2 with
  real data.
- **Objects:**
  - `import_batches`, `import_rows`;
  - `external_sources` row `playhq-be` with `enabled = false` (so
    `membership_status` is unaffected);
  - `playhq_date(text)`;
  - service-role RPCs `import_stage(batch jsonb, rows jsonb)` (500 rows per
    call, allow-list per `file_kind`, minimised at parse) and
    `import_dry_run(p_batch)` for organisations, competitions, seasons, invites,
    grades and teams;
  - `scripts/import/playhq.py` (reads DWH CSV/JSON files, computes sha256,
    calls the RPCs with the service key).
- **Must not break:** nothing public is touched.
- **Self-test:**
  - a re-upload of the same sha is refused;
  - `27/04/2015` parses and `31/02/2015` is an error row;
  - a synthetic profile row carrying `hasDisability`, `atsi`, `wwcNumber` and
    `parentGuardian1CountryOfBirth` stores none of their values anywhere (every
    jsonb column the slice writes is scanned) and lists their names in
    `dropped`;
  - `authenticated` cannot execute the RPCs.
- **Surfaces:** a platform console **Imports** tab with dry-run reports (counts,
  conflicts, dropped field names).
- **Size:** M.

### 0122_persons — October–November 2026

- **Purpose:** the person record, guardians, account links and consent history.
  Only test and staff-entered data until 0124 ships (§7).
- **Objects:**
  - `persons`, `person_contacts`, `person_accounts`, `guardianships`,
    `consent_records` (append-only trigger), `legal_holds`;
  - `data_requests.person_id`; `team_staff.person_id`,
    `league_officials.person_id` (guarded);
  - triggers: `name_key`, minors private on insert, DOB → `birth_year`,
    tenant-move refusal on `organisations`, the players consent-history trigger
    plus its legacy backfill;
  - `restricted.today`, `tenant_setting`, `my_person_ids`;
  - RPCs `save_person` and `link_guardian` (platform admin until 0123),
    `my_people`, `person_contact_view` (audited), `record_consent`,
    `claim_by_email`, `approve_child_login`, `place_hold`, `release_hold`,
    `link_staff_person`, `link_official_person`.
- **Must not break:**
  - `players_read` (unchanged);
  - `set_player_profile` and a manager's consent PATCH still succeed, now
    leaving one history row;
  - scorer squad loads;
  - `team_staff_public`;
  - `officials_for_game`.
- **Self-test:**
  - anon, a signed-in stranger and a league admin reach no person row through
    any RPC;
  - a guardian sees a dependant through `my_people`, and a stranger does not;
  - an under-13 child's own email is refused;
  - a 15-year-old inserted as public becomes private;
  - an update to `consent_records` is refused;
  - `set_player_profile(consent true)` appends exactly one record;
  - a staff contact read writes one `person.read_contacts` audit row;
  - `claim_by_email` links an adult and refuses to make a minor "self";
  - `player_withheld` answers identically for every real player before and
    after.
- **Surfaces:**
  - `/epinoia/me/` **My people** (self, dependants, consents);
  - a platform console **People** search per tenant.
- **Size:** M.

### 0123_org_roles — first weekday after 8 October 2026, not a Friday–Sunday of a BE match week

- **Purpose:** time-bound organisation roles that reach every existing
  permission check.
- **Objects:**
  - `role_types` (seeded), `org_roles` (overlap trigger);
  - `memberships.derived_from` and `valid_until`; `memberships_derived_guard`;
  - `compile_user_grants`, `compile_all_grants`, `grants_drift` and their
    triggers;
  - the §6.5 helper, RPC and policy changes;
  - `user_org_scope`, `can_org`, `person_orgs`, `can_person`;
  - `grant_org_role`, `grant_org_role_by_email`, `end_org_role`,
    `confirm_org_role`, `org_people`, `org_audit`;
  - existing RPCs from 0119, 0120 and 0122 widened from platform admin to the
    matching perm;
  - the catalogue assertion over `memberships` readers.
- **Must not break:**
  - every policy and RPC calling the helpers; the inlined 0084/0118 policies;
  - scorer upserts under restrictive policies;
  - the ingest upsert on `(user_id, role, scope_type, scope_id)`;
  - `finalise-game`'s platform-admin lookup;
  - 0117's scope constraint;
  - `grant_role` and `revoke_role` from the consoles;
  - `access_state`.
- **Self-test:**
  - old helper bodies kept as `pg_temp` functions give identical answers for
    every (membership user × league) and (× team) pair, plus 200 random pairs,
    while no organisation role exists;
  - the ingest-shaped upsert succeeds twice;
  - a synthetic region above a real league gives a role-less existing user
    `is_league_admin = true` and `access_features_for` staff features; ending
    the role today makes both false immediately; setting `valid_until` in the
    past makes them false with no recompile;
  - a sibling region's admin gets nothing;
  - `revoke_role` on a projected row and a REST delete of it are refused;
  - `grant_role` on a projected scope converts it to direct, and it survives
    the organisation role ending;
  - a club secretary cannot grant `body_admin`, cannot grant to themselves, and
    cannot grant a role with a perm they lack;
  - the last `body_admin` cannot be ended by a non-platform admin;
  - `grants_drift()` is empty;
  - the `EXPLAIN` timings stay within 10%.
- **Surfaces:**
  - an **Organisation roles** panel in the league console and a new
    organisation console (`/epinoia/admin/org/`: people, roles, affiliations,
    audit);
  - `whoami.orgs` drives navigation;
  - a read-only role for BE staff.
- **Size:** M–L.

### 0124_subject_rights — November 2026

- **Purpose:** the full data-subject toolkit, **before any real third-party
  personal data enters `restricted`** (pilot registrations or imports).
- **Objects:**
  - `person_sensitive` (field-list trigger);
  - `my_equality_data`, `set_my_equality_data`, `equality_summary`;
  - `person_references`, `person_reference_gaps`;
  - `subject_access_export`, `my_data_export`, the `export` Edge Function and a
    private bucket with a 7-day lifecycle;
  - `erase_person`, `restrict_person`, `run_retention` (report mode).
- **Must not break:** `anonymise_player` callers; statistics rows; the 0116
  games guard (erasure runs as definer).
- **Self-test:**
  - no staff path returns a `person_sensitive` row;
  - a summary with a cell of 9 is suppressed;
  - withdrawal deletes the row;
  - the export contains every section and no other person's contacts;
  - a hold blocks erasure, which succeeds after release;
  - a player linked from two tenants gets a partial erasure;
  - the reference gaps are empty;
  - a report-mode retention run changes 0 rows.
- **Surfaces:**
  - **Download my data** on `/epinoia/me/`;
  - Privacy tab actions (export, erase, restrict, holds);
  - an equality dashboard for the EDI officer.
- **Size:** M.

### 0125_registrations — December 2026–January 2027

- **Purpose:** one registration per role, blocks and credential status. This is
  what a pilot organisation registers people on.
- **Objects:**
  - `registrations`, `credentials`, `roster_entries.registration_id`;
  - RPCs `submit_registration`, `decide_registration`,
    `block_registration` / `unblock_registration` (respecting
    `block_locks_below`), `set_credential`, `registration_status(p_person,
    p_org, p_on)`, `org_registrations`;
  - the `membership_status` extension; reference-list additions;
    position-of-trust warnings in `grant_org_role`.
- **Must not break:**
  - portal, CSV and ingest roster writes (`registration_id` is nullable and not
    enforced);
  - the scorer's squad load;
  - `membership_status` output for every unlinked player.
- **Self-test:**
  - a duplicate role registration is refused;
  - pending and blocked are not active, and active with `pending_on` is
    refused;
  - a block reason over 200 characters is refused;
  - a region-level block with `block_locks_below` cannot be lifted by the club;
  - a season permit without dates is refused;
  - a club registrar sees only their club's registrations; a sibling club's
    sees none;
  - a credential reference never appears in audit detail.
- **Surfaces:** club and association consoles: **Registrations** (list,
  approve, block), credential status per person, a pilot registration form.
- **Size:** M.
- **Calendar:** live for a BE tier only before early July; a pilot any time.

### 0126_player_link — January 2027 (weekday)

- **Purpose:** connect persons to the sporting record. `is_minor`, consent and
  verified names come from the person.
- **Objects:**
  - `players.registry_managed`;
  - `link_person_player`, `unlink_person_player`, `project_player`,
    `refresh_person_flags`;
  - `players_person_guard`;
  - `erase_person` extended to linked players.
- **Must not break:**
  - every write to unlinked players (portal, CSV, `set_player_profile`,
    `admin_update_player`, ingest, `membership-sync`);
  - `players_read`; fan search; the photo-consent triggers.
- **Self-test:**
  - an unlinked player edits exactly as before;
  - linking a person with a DOB 15 years ago sets `is_minor`, and a manager's
    PATCH back to false gets 42501;
  - a service-role rename of a verified linked player keeps the projected name
    and writes an audit row;
  - two tenants' persons where one is a minor project minor;
  - an 18th birthday flips on the tick and ends the guardianship;
  - the set of anon-visible player ids is identical for every unlinked player.
- **Surfaces:** People: **Link to player record**; the club portal shows a lock
  on managed fields with "change it in the registration".
- **Size:** S–M.

### 0127_claim_merge — February 2027 (weekday, not a Saturday)

- **Purpose:** claiming, dedupe, reversible merges of persons and players.
- **Objects:**
  - `person_claims`, `person_merges`, `players.merged_into`;
  - `claim_prepare` / `confirm_claim` / `request_claim_review` and the `claim`
    Edge Function (Resend);
  - `person_duplicates`, `merge_persons`, `merge_players`, `unmerge`;
  - the `stamp_player_uuid` change; `player_redirect`, `player_aliases`;
  - `data.js` alias folding (browser, same release).
- **Must not break:**
  - `finalise-game` re-finalise (the trigger does one primary-key probe);
  - season views; player pages; ingest lookup by `external_ids`.
- **Self-test:**
  - a synthetic duplicate pair with registrations, consents, a guardianship,
    a suspension and stat lines merges with every count moved; `unmerge`
    restores exactly;
  - a merge with a synthetic unhandled FK present raises;
  - fewer than 3 matching fields, cross-tenant, and same-game players are
    refused;
  - a re-inserted `player_game_stats` row for the merged pid stamps the
    survivor;
  - a code claim links;
  - an admin-role profile and a sixth attempt are refused;
  - `claim_prepare` returns the same browser answer for a match and a
    non-match.
- **Surfaces:**
  - **Find my profile** on sign-in;
  - a registrar **Duplicates** queue;
  - platform **Player merges**;
  - old player links redirect.
- **Size:** M–L.

### 0128_playhq_people_import — March–April 2027

- **Purpose:** F8 rehearsal end to end on a pilot organisation's export: apply
  structure, profiles, guardians, registrations, claimed profiles, admin roles
  and the participants CSV.
- **Objects:**
  - `import_apply(p_batch)` per `file_kind` (service role; idempotent through
    `external_identities`);
  - admin roles created unconfirmed;
  - the purge of `import_rows.fields` at apply;
  - the dedupe scan after apply.
- **Must not break:** `membership-sync` (`playhq-be` stays disabled for
  eligibility); existing players (the import never creates or edits `players`;
  links are §8.1).
- **Self-test:**
  - the documented example payloads apply twice with identical row counts;
  - a minor gets a guardianship and stays private whatever `profileVisible`
    says;
  - special-category fields never land when the tenant has not opted in;
  - an unknown role becomes a conflict row, not a crash;
  - `deleted = TRUE` in claimed profiles un-merges;
  - imported admins project nothing until confirmed;
  - `authenticated` cannot execute.
- **Surfaces:** Imports tab **Apply** with a before-and-after report; a pilot
  organisation's people appear in its console.
- **Size:** M.

**Dependencies:**

- 0119 → 0121
- 0120 → 0122 → 0123 → 0124 → 0125 → 0126 → 0127 → 0128
- 0121 → 0128

0120 needs 0119 only for the `organisations` table its nullable `tenant_id`
references; nothing in 0120 reads the tree.

---

## 10. Open questions for Louie

Some of these can only be answered by BE; they are marked.

1. **Analytics given away through projection.**
   - **Issue:** a projected `league_admin` counts as staff in 0117, so every BE,
     region and association admin gets Epinoia's analytics free in every league
     below them.
   - **Default:** yes, because staff need what they administer.
   - **Alternative:** a one-row change removes `league_admin` from the
     role's `projects`, and a narrower grant takes its place.
2. **PlayHQ competition to Epinoia league.**
   - **Issue:** is one PlayHQ Competition one Epinoia league (for example
     "Junior NBL" with every division as a competition)?
   - **Plan:** 0121's dry run answers this from a real `CompetitionOwnerId` and
     grade list before anything is applied.
3. **Club parenting and cascade reach** *(BE)*.
   - **Default:** clubs sit under their region.
   - **Alternative:** a club that plays only in a local league could sit under
     that league's association, which is PlayHQ's Affiliate Admin model. Its
     association admins would then get person rights over it.
   - **Also needed:** should local leagues be able to opt out of BE and region
     admins becoming their league admins?
4. **PlayHQ `profileVisible` for minors** *(BE)*. Treat it as evidence only
   (default: profiles BE shows today become private until re-consented), or
   accept it as consent given under PlayHQ's notice?
5. **Private adult profiles.** They need the P0.5 squad RPC so the scorer stops
   loading squads with the anon key. Schedule P0.5 before 0126, or accept that
   `visibility` does not reach `players` until 2027/28?
6. **Registered coaches and team managers.** Should a `coach` or `team_manager`
   registration project `team_manager` for its team (PlayHQ gives team staff
   management access by default)? Default: no; a club secretary grants it.
7. **The `restricted` schema under the CLI role.** It is proved or disproved on
   0120's first push. Confirm you are happy with the prefixed-table fallback.
8. **DPIA, legitimate interests assessment and retention sign-off.** Who signs
   for Epinoia now, and for BE later? Full dates of birth reverse 0001's
   founding rule and raise the impact of a breach: a DPIA is needed before 0122
   holds real data.
9. **Disability support information** *(BE)*.
   `additionalDisabilitySupportInformation` can matter for a coach's duty of
   care. Drop it (default), or import it to a separate, welfare-officer-only
   field after a DPIA?
10. **The pilot organisation.** Which one, and is it its own tenant (an
    independent league as root `association`) or a region inside a BE tenant?
    Everything from 0125 on is rehearsed on it.
11. **Changing controller.** How does an independent league's people move into
    BE's tenant later (legal basis, member notice, dedupe)? It is not designed
    here; the tree trigger refuses it while people exist.
12. **Ages** *(BE)*. Own login from 13 and self-consent to publication from 16
    are the defaults. Does BE want 18 for publication, as some bodies use?
13. **`pg_trgm` availability** on the production project. It is optional, and
    dedupe is weaker without it.
14. **Two clocks for "registered on this date"** *(BE)*. Rolling 365-day
    membership against per-season competition licences: must both be active?
    `registration_status` reports each separately until this is decided.
15. **Position-of-trust gating** *(BE)*. Should a welfare officer or coach role
    be refused without valid DBS and course credentials (with a compliance
    override), or only warned? Default: warn until R6 re-integrates Know Your
    People and Learning Nexus.
16. **Hosting the import script.** `scripts/import/playhq.py` runs on your
    machine with the service key, like the ingest runner. Agree it never runs
    in CI, and that export files are deleted locally after staging.

---

## 11. Deliberately not in this contract, and where it attaches

| later work | attaches to |
|---|---|
| R1 products, fees, family caps, the "most expensive licence only" rule; R2 payments | `registrations.product`; a `licence_products` table keyed by tenant and season |
| M1+R4 eligibility rules (normality 50%, U18 two teams, Type 1 quotas, nursery, coach levels, fill-ins) | `teams.club_id` / `age_group` / `gender`, `competitions` born window and level, `registrations`, `credentials`; rules start advisory |
| R6 credential gating (Know Your People, Learning Nexus, Stripe Identity) | `credentials`, `registrations.pending_on`, `role_types.position_of_trust` |
| C9 transfers and permits workflow | `registrations.source`, `previous_id`, `valid_from` / `valid_to` |
| C2 team entry | `competition_teams.id` (status, surety and invitation columns later) |
| C7 discipline, F7 cases | `legal_holds`, `player_suspensions` (+ `person_id`), `discipline.manage` |
| O2 appointments | `league_officials.person_id`, `officials.appoint` |
| R5 accreditation checklists | `org_affiliations.accreditation`, `club_*` and `welfare_officer` roles |
| Private adult profiles | P0.5 squad RPC, then `persons.visibility` projected (open question 5) |
| F6b partner webhooks | §8.3 |
