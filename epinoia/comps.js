'use strict';
/* ============================================================================
   WHO PLAYS IN WHICH COMPETITION — and whether a reader needs to be asked.

   A league is not one field of clubs. BCB's Trophy is drawn from twenty sides;
   its Championship is fourteen of them. Put all twenty in one Clubs grid and
   six of them have no record, no table position and no home fixture anybody
   can go to — they look like clubs that have stopped playing.

   WHERE MEMBERSHIP COMES FROM: `competition_teams`, which has held it since
   0001 and is world-readable. It is written by the admin console's enter /
   withdraw buttons AND by the ingest every time it files a fixture, and
   set_fixture (0045) refuses a game whose sides are not entered — so it is
   maintained by the act of running the competition rather than by anybody
   remembering to maintain it. Nothing here needs a new table, a new write, or
   an administrator doing anything they are not already doing.

   A COMPETITION MUST HAVE FIXTURES TO BE OFFERED. Entries alone are not
   enough: BCB carries a second, duplicate "British Championship Basketball"
   competition with twenty entries and not one game, left behind by an earlier
   feed. Offering it would hand the reader a button leading to a phantom.
   Entries say WHO, fixtures say WHETHER — this file needs both.

   WHEN TO SPLIT THE CLUBS LIST AT ALL — the rule this file exists for:

       a competition earns its own list when it brings clubs the main
       competition does not have.

   SLB Men's Cup has the Championship's ten; the Betty Codona Cup has the
   women's Championship's ten. Same clubs, so one list and no buttons — being
   asked "Championship or Cup?" and getting the same ten names either way is
   worse than not being asked. The BCB Trophy has six sides that play nowhere
   else, so BCB gets two lists. Comparing the sets for equality would get the
   Cup wrong the moment one entry is added late; comparing sizes would get it
   wrong twice over. What matters is whether anybody would be MISSING from the
   main list, and that is what is measured.

   THE MAIN COMPETITION is the one with the most games, preferring a `league`
   kind over a cup or a trophy — a season's actual programme rather than
   whichever competition happens to sort first.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaComps = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* Kinds that are a season rather than a knockout. `trophy` and `friendly` are
   both in the wild (the ingest writes them); neither is the main programme. */
const MAIN_KIND = { league: true };

function idsOf(list, key) {
  const out = [];
  (list || []).forEach(r => { const v = r && r[key]; if (v && out.indexOf(v) < 0) out.push(v); });
  return out;
}

/* -------------------------------------------------------------- the read ---
   comps    competition rows  {id, name, kind}
   entries  competition_teams rows {competition_id, team_id}
   games    game rows {competition_id, home_team_id, away_team_id} — used to
            know which competitions are actually being played, and as a
            safety net for a club that has a fixture but somehow no entry. */
function read(o) {
  const comps = (o && o.comps) || [];
  const entries = (o && o.entries) || [];
  const games = (o && o.games) || [];

  const byId = new Map();
  comps.forEach(c => {
    if (c && c.id) byId.set(c.id, { id: c.id, name: c.name || '', kind: c.kind || '',
                                    teams: new Set(), games: 0 });
  });

  entries.forEach(e => {
    const c = e && byId.get(e.competition_id);
    if (c && e.team_id) c.teams.add(e.team_id);
  });

  games.forEach(g => {
    const c = g && byId.get(g.competition_id);
    if (!c) return;
    c.games += 1;
    /* A side with a fixture is in the competition whatever the entry table
       says. The two agree today; if they ever disagree the fixture wins,
       because it is the thing the reader can see. */
    if (g.home_team_id) c.teams.add(g.home_team_id);
    if (g.away_team_id) c.teams.add(g.away_team_id);
  });

  const played = [...byId.values()].filter(c => c.games > 0);
  const main = played.length
    ? played.slice().sort((a, b) =>
        ((MAIN_KIND[b.kind] ? 1 : 0) - (MAIN_KIND[a.kind] ? 1 : 0)) ||
        (b.games - a.games) || (b.teams.size - a.teams.size) ||
        String(a.name).localeCompare(String(b.name)))[0]
    : null;

  const groups = [];
  if (main) {
    groups.push({ id: main.id, name: main.name, kind: main.kind,
                  teams: [...main.teams], extra: 0 });
    played.forEach(c => {
      if (c.id === main.id) return;
      let extra = 0;
      c.teams.forEach(t => { if (!main.teams.has(t)) extra++; });
      if (extra) {
        groups.push({ id: c.id, name: c.name, kind: c.kind,
                      teams: [...c.teams], extra });
      }
    });
  }

  return {
    main,
    groups,
    split: groups.length > 1,
    all: played,
    teamsOf(id) {
      const c = played.find(x => x.id === id);
      return c ? c.teams : new Set();
    },
    /* Every club that plays anywhere this season — what a list falls back to
       when there is nothing to split by. */
    everyTeam() {
      const out = new Set();
      played.forEach(c => c.teams.forEach(t => out.add(t)));
      return out;
    }
  };
}

/* ------------------------------------------------------------------ load ---
   One request. `api` is the page's own REST helper (data.js's `all`/`get`),
   so this inherits whatever key and access token the page is already using.
   An older database without the table, or a refusal, yields no entries rather
   than an error: every caller can still fall back to the fixtures. */
async function entriesFor(api, competitionIds) {
  const ids = (competitionIds || []).filter(Boolean);
  if (!ids.length || typeof api !== 'function') return [];
  try {
    return await api('competition_teams?competition_id=in.(' + ids.join(',') + ')' +
                     '&select=competition_id,team_id') || [];
  } catch (_) { return []; }
}

return { read, entriesFor, idsOf };
}));
