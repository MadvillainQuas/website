/* GENERATED from epinoia/membership.js by supabase/tests/extract-shared.mjs — do not edit. */
'use strict';
/* ============================================================================
   MEMBERSHIP ADAPTERS — one shape for every federation register.

   Every governing body exposes its membership differently: a REST API with a
   bearer token, a nightly CSV on an SFTP drop, a SOAP endpoint written in 2009,
   a spreadsheet emailed to the league secretary. What none of them differ about
   is what the platform needs from them — who this person is, and whether they
   are allowed to play.

   So an integration is written against this contract and nothing else. The
   awkward part of a federation's API is confined to one file per federation,
   and the rest of the platform never learns that the awkwardness exists.

   ------------------------------------------------------------------ contract

   An adapter is a plain object:

     {
       id:    'basketball-england',        // matches external_sources.id
       label: 'Basketball England',

       // one person, by their membership number
       async member(externalId) -> Member | null

       // everyone a club has registered; `since` lets a nightly run ask for
       // only what changed, and an adapter that cannot may ignore it
       async clubMembers(clubExternalId, { since }) -> Member[]

       // OPTIONAL. Omit it and eligibility comes from the member record's own
       // status, which is what most registers actually offer.
       async eligibility(externalId, { on }) -> Eligibility
     }

   A Member is normalised BEFORE it reaches the platform:

     { externalId, firstName, lastName, birthYear, clubExternalId,
       status: 'eligible'|'suspended'|'lapsed'|'unregistered'|'unknown',
       validFrom, validTo, raw }

   `raw` is whatever the source actually sent, kept verbatim: it is the evidence
   for anything this platform later asserts about a person, and discarding it
   means a disagreement with a club cannot be investigated.

   ------------------------------------------------------- what a sync may do

   The federation owns identity and eligibility. Epinoia owns what happened on
   court. A sync therefore writes names, birth years, club registration and
   licence state — and never touches an event, a box score or a shirt number,
   because the number on the shirt on the night is a fact about the night.

   NAMES ARE PROPOSED, NOT IMPOSED. A rename is applied only when the platform's
   own value is empty or matches on a normalised comparison. Anything else is
   recorded as a conflict for a human, because a club whose players silently
   change name overnight stops trusting the system that did it — and the
   commonest cause is a membership number typed one digit out, which would
   otherwise quietly overwrite the wrong person.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMembership = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const STATUSES = ['eligible', 'suspended', 'lapsed', 'unregistered', 'unknown'];

/* ---------------------------------------------------------- normalising --- */
/* Comparison only — never what gets stored. Folding accents and case makes
   "Nuñez" and "Nunez" the same person for the purpose of deciding whether a
   rename is safe, while the register's own spelling is what is written. */
const fold = s => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const sameName = (a, b) => fold(a) === fold(b);

/* A member record from anywhere, in the one shape the rest of this file uses.
   Written defensively because the input is somebody else's JSON: a field that
   is absent, null, a number where a string was expected, or a date in a format
   nobody documented, must produce a usable record rather than an exception
   halfway through a nightly run. */
function normaliseMember(m, sourceId) {
  if (!m) return null;
  const externalId = String(m.externalId != null ? m.externalId : (m.id != null ? m.id : '')).trim();
  if (!externalId) return null;

  const year = v => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseInt(String(v).slice(0, 4), 10);
    /* A birth year outside living memory is a parse failure wearing a number —
       a date read from the wrong column, or a two-digit year expanded badly. */
    return Number.isFinite(n) && n >= 1900 && n <= new Date().getFullYear() ? n : null;
  };
  const date = v => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  const status = STATUSES.includes(m.status) ? m.status : 'unknown';

  return {
    sourceId,
    externalId,
    firstName: String(m.firstName || m.first_name || '').trim(),
    lastName:  String(m.lastName  || m.last_name  || '').trim(),
    birthYear: year(m.birthYear != null ? m.birthYear : m.birth_year),
    clubExternalId: m.clubExternalId != null ? String(m.clubExternalId).trim() : null,
    status,
    validFrom: date(m.validFrom || m.valid_from),
    validTo:   date(m.validTo   || m.valid_to),
    raw: m.raw != null ? m.raw : m
  };
}

/* ------------------------------------------------------- the merge policy -- */
/* Given what we hold and what the register says, decide field by field. The
   return is a PLAN — nothing is written here — so the same function serves the
   dry run and the real one, and the dry run cannot drift from what will happen.

   `existing` is the platform's player row (or null for somebody new). */
function planMerge(existing, member, config) {
  const cfg = Object.assign(
    { may_create_players: true, eligibility: 'advisory', name_case: 'as-given' },
    config || {});

  if (!existing) {
    return cfg.may_create_players
      ? { action: 'create', fields: {
            first_name: member.firstName, last_name: member.lastName,
            birth_year: member.birthYear },
          conflicts: [] }
      : { action: 'skip', reason: 'this source may not create players', conflicts: [] };
  }

  const fields = {}, conflicts = [];

  /* A name is taken when ours is blank, or when the two already agree apart
     from accents and case — in which case taking theirs restores the accents
     a hand-typed roster dropped. A genuine disagreement is a conflict. */
  const consider = (key, ours, theirs, label) => {
    if (!theirs) return;
    if (!ours) { fields[key] = theirs; return; }
    if (sameName(ours, theirs)) { if (ours !== theirs) fields[key] = theirs; return; }
    conflicts.push({ field: label, ours, theirs, externalId: member.externalId });
  };
  consider('first_name', existing.first_name, member.firstName, 'first name');
  consider('last_name',  existing.last_name,  member.lastName,  'last name');

  /* A birth year decides eligibility and safeguarding, so a disagreement is
     never resolved automatically in either direction — an under-18 flag that
     moves on its own is the one mistake with a real-world cost. */
  if (member.birthYear != null) {
    if (existing.birth_year == null) fields.birth_year = member.birthYear;
    else if (existing.birth_year !== member.birthYear) {
      conflicts.push({ field: 'birth year', ours: existing.birth_year,
                       theirs: member.birthYear, externalId: member.externalId });
    }
  }

  return { action: Object.keys(fields).length ? 'update' : 'unchanged', fields, conflicts };
}

/* Eligibility, in the shape membership_eligibility stores. An adapter without
   an eligibility() call still produces one of these from the member's own
   status, which is what most registers actually offer. */
function eligibilityOf(member, extra) {
  const e = extra || {};
  return {
    status:    STATUSES.includes(e.status) ? e.status : member.status,
    validFrom: e.validFrom || member.validFrom || null,
    validTo:   e.validTo   || member.validTo   || null,
    reason:    String(e.reason || '')
  };
}

/* ----------------------------------------------------------- the runner --- */
/* Pure: it takes an adapter and a store, and returns a report. The store is an
   interface rather than a database handle so this runs identically in the edge
   function, in a test with an in-memory store, and in a dry run that writes
   nothing at all.

     store = {
       async playerByExternalId(sourceId, externalId) -> player|null
       async playerByName(firstName, lastName, birthYear) -> player|null
       async createPlayer(fields) -> player
       async updatePlayer(id, fields) -> void
       async linkIdentity(sourceId, entityType, entityId, externalId, payload)
       async setEligibility(sourceId, playerId, eligibility)
     }
*/
async function runSync(opts) {
  const { adapter, store, clubExternalIds, since, config, dryRun } = opts;
  const report = { seen: 0, created: 0, updated: 0, skipped: 0, unchanged: 0,
                   conflicts: [], errors: [] };

  const clubs = clubExternalIds && clubExternalIds.length ? clubExternalIds : [null];

  for (const club of clubs) {
    let raw;
    try {
      raw = club == null ? [] : await adapter.clubMembers(club, { since: since || null });
    } catch (err) {
      report.errors.push({ club, message: String((err && err.message) || err) });
      continue;                       // one club's outage is not the whole run
    }

    for (const r of (raw || [])) {
      const member = normaliseMember(r, adapter.id);
      if (!member) { report.skipped++; continue; }
      report.seen++;

      try {
        /* Match on the membership number first — it is the only identifier
           both sides agree on. Falling back to a name match is what lets a
           league that typed its squads in by hand adopt a federation without
           re-entering anybody, and it is deliberately narrow: name AND birth
           year, so two players called J Smith are not merged into one. */
        let player = await store.playerByExternalId(adapter.id, member.externalId);
        let matchedBy = player ? 'membership number' : null;
        if (!player && member.birthYear != null) {
          player = await store.playerByName(member.firstName, member.lastName, member.birthYear);
          if (player) matchedBy = 'name and birth year';
        }

        const plan = planMerge(player, member, config);
        plan.conflicts.forEach(c => report.conflicts.push(
          Object.assign({ matchedBy: matchedBy }, c)));

        if (plan.action === 'skip') { report.skipped++; continue; }

        if (plan.action === 'create') {
          if (!dryRun) player = await store.createPlayer(plan.fields);
          report.created++;
        } else if (plan.action === 'update') {
          if (!dryRun) await store.updatePlayer(player.id, plan.fields);
          report.updated++;
        } else {
          report.unchanged++;
        }

        if (!dryRun && player) {
          await store.linkIdentity(adapter.id, 'player', player.id, member.externalId, member.raw);

          let extra = null;
          if (typeof adapter.eligibility === 'function') {
            try { extra = await adapter.eligibility(member.externalId, { on: new Date() }); }
            catch (err) { report.errors.push({ externalId: member.externalId,
                                               message: 'eligibility: ' + ((err && err.message) || err) }); }
          }
          await store.setEligibility(adapter.id, player.id, eligibilityOf(member, extra));
        }
      } catch (err) {
        report.errors.push({ externalId: member.externalId,
                             message: String((err && err.message) || err) });
      }
    }
  }
  return report;
}

/* ------------------------------------------------- two reference adapters -- */
/* A REST register. Most federation APIs are a shape like this one, and the
   parts that differ — the paths, the auth header, the field names — are the
   parts a real adapter overrides. */
function restAdapter(cfg) {
  const {
    id, label, baseUrl, headers,
    memberPath = eid => '/members/' + encodeURIComponent(eid),
    clubPath   = cid => '/clubs/' + encodeURIComponent(cid) + '/members',
    map        = x => x,
    fetchImpl
  } = cfg;
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);

  const get = async path => {
    if (!doFetch) throw new Error('no fetch available');
    const r = await doFetch(baseUrl.replace(/\/$/, '') + path,
      { headers: Object.assign({ Accept: 'application/json' }, headers || {}) });
    if (!r.ok) throw new Error(r.status + ' from ' + path);
    return r.json();
  };

  return {
    id, label,
    async member(externalId) {
      const raw = await get(memberPath(externalId));
      return raw ? map(raw) : null;
    },
    async clubMembers(clubExternalId, o) {
      const raw = await get(clubPath(clubExternalId) +
        (o && o.since ? '?since=' + encodeURIComponent(o.since) : ''));
      const list = Array.isArray(raw) ? raw : (raw && raw.members) || [];
      return list.map(map);
    }
  };
}

/* A register that arrives as a file. The commonest integration in grassroots
   sport is a spreadsheet, and refusing to support it means the league keeps
   typing squads in by hand — which is the problem the whole feature exists to
   remove. Takes rows already parsed from CSV. */
function tableAdapter(cfg) {
  const { id, label, rows, map = x => x } = cfg;
  const all = () => (rows || []).map(map).filter(Boolean);
  return {
    id, label,
    async member(externalId) {
      return all().find(m => String(m.externalId) === String(externalId)) || null;
    },
    async clubMembers(clubExternalId) {
      return clubExternalId == null ? all()
        : all().filter(m => String(m.clubExternalId) === String(clubExternalId));
    }
  };
}

return { STATUSES, fold, sameName, normaliseMember, planMerge, eligibilityOf,
         runSync, restAdapter, tableAdapter, VERSION: '1.0.0' };
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaMembership;
export const { STATUSES, fold, sameName, normaliseMember, planMerge, eligibilityOf, runSync, restAdapter, tableAdapter } = __api;
export default __api;
