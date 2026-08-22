# Integrating a federation's membership register

Written 2026-08-22. Code: [`epinoia/membership.js`](../epinoia/membership.js),
[`supabase/functions/membership-sync`](../supabase/functions/membership-sync/index.ts),
migration `0077_external_identities.sql`.

---

## The division of authority

This is the whole design, and it is worth agreeing out loud with a federation
before any code is written, because every later argument is a special case of it.

| | owns |
|---|---|
| **The federation** | identity and eligibility — who this person is, how old they are, which club they are registered to, whether their licence is valid on a given date |
| **Epinoia** | what happened on court — every event, every derived figure, the shirt they wore on the night |

Neither writes into the other's half. A sync updates a name and a licence state;
it never touches a box score. A game never writes back a date of birth.

Where the two disagree about identity, the federation wins — but the difference
is **recorded, not silently applied**. A club whose players change name overnight
stops trusting the system that did it, and the commonest cause is a membership
number typed one digit out, which would otherwise quietly overwrite the wrong
person.

---

## What to build for a new federation

One object. Everything awkward about their API lives in it, and nothing else in
the platform learns that the awkwardness exists.

```js
{
  id:    'basketball-england',        // matches external_sources.id
  label: 'Basketball England',

  async member(externalId) -> Member | null
  async clubMembers(clubExternalId, { since }) -> Member[]
  async eligibility(externalId, { on }) -> Eligibility     // OPTIONAL
}
```

A `Member`, normalised before it reaches the platform:

```js
{ externalId, firstName, lastName, birthYear, clubExternalId,
  status: 'eligible'|'suspended'|'lapsed'|'unregistered'|'unknown',
  validFrom, validTo, raw }
```

`raw` is whatever they actually sent, kept verbatim. It is the evidence for
anything the platform later asserts about a person, and discarding it means a
disagreement with a club cannot be investigated.

Two adapters ship already and cover most cases without new code:

- **`restAdapter`** — a JSON API. Paths, auth header and field names come from
  the source's `config`, so a federation whose API is shaped conventionally is a
  database row rather than a deploy.
- **`tableAdapter`** — rows from a spreadsheet. The commonest integration in
  grassroots sport is a file, and refusing to support it means the league keeps
  typing squads by hand, which is the problem the feature exists to remove.

---

## Matching: how a person is recognised

In order, stopping at the first that answers:

1. **The membership number**, through `external_identities`. The only identifier
   both sides agree on.
2. **Name *and* birth year.** Deliberately narrow. This is what lets a league
   that typed its squads in by hand adopt a federation without re-entering
   anybody. Matching on a name alone would merge two players called J Smith the
   first time a register is connected, and unpicking that afterwards means
   unpicking their statistics too. **Two candidates is not a match** — it is a
   question for a person.
3. Otherwise, create — if the source's config permits it.

## Merging: what a sync may change

| field | rule |
|---|---|
| first/last name | taken when ours is blank, or when the two agree apart from accents and case (which restores accents a hand-typed roster dropped). A real disagreement is a **conflict**. |
| birth year | taken when ours is empty. A disagreement is **never** resolved automatically in either direction — an under-18 flag that moves on its own is the one mistake with a real-world cost. |
| eligibility | always taken. It is theirs to decide. |
| anything else | untouched. |

Conflicts are returned in the run report and stored on `membership_syncs`, so
"why is this player called that now" is one query rather than an afternoon.

---

## Running one

```
POST /functions/v1/membership-sync
{ "source": "basketball-england",
  "clubs": ["1234","5678"],     // omit to use every team already linked
  "since": "2026-08-01",
  "dry": true }
```

**Start with `dry: true`, always.** Nothing about a federation's data is knowable
in advance — how their names are cased, whether their club ids match the ones the
league uses, how many of their members this league has never heard of. A dry run
produces exactly the report a real run would and writes nothing, which makes the
first run of an integration a conversation rather than a cleanup.

Authorisation is the service role key or a platform administrator's JWT. A
league administrator **cannot** run it: a sync writes to the player register,
which is platform-wide, and a body governing one league should not be able to
rename a player who also turns out in another.

## Setting a source up

```sql
insert into public.external_sources (id, label, base_url, config) values (
  'basketball-england', 'Basketball England', 'https://api.example.org/v1',
  '{"adapter":"rest",
    "secret_env":"BE_API_KEY",
    "may_create_players":true,
    "eligibility":"advisory",
    "field_map":{"externalId":"membershipNo","lastName":"surname",
                 "firstName":"forename","birthYear":"dob",
                 "clubExternalId":"clubCode","status":"licenceStatus"}}'::jsonb);
```

Then link each club once, so a nightly run knows which registers to ask for:

```sql
insert into public.external_identities (source_id, entity_type, entity_id, external_id)
values ('basketball-england', 'team', '<teams.id>', '1234');
```

A league that has linked nothing syncs nothing, rather than pulling an entire
national register.

`eligibility: "advisory"` means a refusal is shown but does not block a fixture.
Make it blocking only once a federation's feed has proved reliable — a hall full
of people on a Saturday is the wrong place to discover their API was down on
Friday.

## Asking the one question that matters

```sql
select * from public.membership_status('<player-id>', current_date);
```

Returns `eligible` / `suspended` / `lapsed` / `unregistered` / `unknown`.

It answers **`unknown`, never `no`**, when nothing is recorded: a league that has
not connected a federation must not have every player refused.

---

## Privacy

None of these tables is public, and no browser session has an insert or update
policy on any of them. A membership number is personal data about somebody who
never agreed to appear on a results website; the sync log names players by id.
Reads are platform administrators only, writes come from the runner with the
service role.

This is separate from — and does not weaken — the existing rule that players
recorded as minors are withheld from public pages, the API and every partner
feed unless consent is recorded.
