'use strict';
/* ============================================================================
   ROUND-ROBIN SCHEDULING.

   Everybody plays everybody. The circle method: fix one team, rotate the rest,
   and every round pairs the two ends of the circle. N teams give N−1 rounds of
   N/2 games, and an odd N gets a phantom team whose opponent sits out that
   round — which is what a bye IS, rather than something to apologise for.

   Two things that matter more than the pairing, because they are what a league
   secretary actually complains about:

     HOME AND AWAY MUST BE SHARED OUT. The circle method fixes one team at the
     same end of every pairing, so it collects every game at home unless
     something intervenes. Pairing and orientation are therefore separate
     steps: pairsFor decides who plays whom, orient decides who is at home by
     giving each game to whichever side is currently more away.

     That lands every team within ONE game of an even split for an even team
     count — the best that exists, since each plays an odd number of games —
     and within two for an odd count. It is a heuristic, not an optimum, so
     the generator REPORTS the split it produced rather than claiming it
     solved the problem.

     GROUPS ARE SCHEDULED SEPARATELY. Teams in Group A do not play Group B, so
     a competition with groups is several small round-robins rather than one
     big one with most of the fixtures deleted.

   No dates here. Dates are a presentation concern and the caller knows the
   league's slot pattern; this returns rounds, and the caller lays them out.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideSchedule = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const BYE = null;

/* ----------------------------------------------------------------- pairs ---
   The circle method, unoriented: who plays whom, in rounds. Which of them is
   at home is a separate decision, made below, because the pairing and the
   fairness are different problems and solving them together is what produces
   a team with every game at home. */
function pairsFor(teams) {
  const list = (teams || []).slice();
  if (list.length < 2) return [];

  /* an odd count gets a phantom, whose opponent has the round off */
  if (list.length % 2 === 1) list.push(BYE);

  const n = list.length;
  const rounds = [];
  let rot = list.slice(1);                  // the first team stays put

  for (let r = 0; r < n - 1; r++) {
    const order = [list[0]].concat(rot);
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i], b = order[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      games.push([a, b]);
    }
    rounds.push(games);
    rot.unshift(rot.pop());
  }
  return rounds;
}

/* ----------------------------------------------------------------- orient ---
   Decide who is at home, greedily: in each game the team currently MORE at
   home goes away.

   The obvious approach — flip the orientation on alternate rounds — leaves the
   fixed team of the circle with every game at home, because it occupies the
   same end of every pairing. Greedy balancing has no such blind spot, is
   deterministic, and keeps every team within one game of an even split for a
   single round-robin, which is the best that exists when each team plays an
   odd number of games. */
function orient(rounds) {
  const diff = new Map();                   // home minus away, so far
  const d = id => (diff.get(id) || 0);
  let tie = 0;                              // alternates when the diffs are level
  return rounds.map(round => round.map(([a, b]) => {
    /* The team with the bigger surplus of home games gives this one up.

       Ties must ALTERNATE rather than always falling to the first team: the
       circle method puts the fixed team at position 0 of every round, so a
       stable tie-break hands it the home game every time the diffs are level,
       and it ends the season three games out. */
    let home;
    if (d(a) < d(b)) home = a;
    else if (d(b) < d(a)) home = b;
    else home = (tie++ % 2 === 0) ? a : b;
    const away = home === a ? b : a;
    diff.set(home, d(home) + 1);
    diff.set(away, d(away) - 1);
    return { home, away };
  }));
}

function roundRobin(teams) {
  return orient(pairsFor(teams));
}

/* --------------------------------------------------------------- doubles ---
   A second half where every fixture is reversed, so each pair meets once at
   each end and every team's split is exactly even. Appended rather than
   interleaved, which is how nearly every league runs. */
function doubleRound(teams) {
  const first = roundRobin(teams);
  const second = first.map(r => r.map(g => ({ home: g.away, away: g.home })));
  return first.concat(second);
}

/* ---------------------------------------------------------------- groups ---
   entries: [{ team_id, group_name }]. Ungrouped teams are one group.
   Rounds are merged across groups by index, so round 1 of every group is
   played on the same date rather than the groups running one after another. */
function forCompetition(entries, opts) {
  const o = opts || {};
  const double = !!o.double;

  const byGroup = new Map();
  (entries || []).forEach(e => {
    const k = e.group_name || '';
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(e.team_id);
  });

  const perGroup = [...byGroup.entries()].map(([name, ids]) => ({
    name, rounds: double ? doubleRound(ids) : roundRobin(ids)
  }));

  const most = perGroup.reduce((n, g) => Math.max(n, g.rounds.length), 0);
  const rounds = [];
  for (let i = 0; i < most; i++) {
    const games = [];
    perGroup.forEach(g => {
      (g.rounds[i] || []).forEach(x => games.push(Object.assign({ group: g.name || null }, x)));
    });
    rounds.push(games);
  }
  return rounds;
}

/* ------------------------------------------------------------------ dates ---
   Lay rounds onto a calendar: a start date, a gap in days between rounds, and
   optional kick-off times cycled within a round so two games at one venue do
   not collide. Returns a flat fixture list.

   Times are built in LOCAL time and converted at the end, because a league
   secretary means "seven thirty on the Tuesday" and not an instant in UTC —
   and across a British season that distinction is one hour for half the year. */
function withDates(rounds, opts) {
  const o = opts || {};
  const start = o.start ? new Date(o.start + 'T00:00:00') : new Date();
  const everyDays = o.everyDays == null ? 7 : o.everyDays;
  const times = (o.times && o.times.length) ? o.times : ['19:30'];

  const out = [];
  rounds.forEach((games, ri) => {
    const day = new Date(start.getTime());
    day.setDate(day.getDate() + ri * everyDays);
    games.forEach((g, gi) => {
      const [hh, mm] = String(times[gi % times.length]).split(':').map(Number);
      const when = new Date(day.getTime());
      when.setHours(hh || 0, mm || 0, 0, 0);
      out.push({
        round: ri + 1, group: g.group || null,
        home: g.home, away: g.away,
        tipoff_at: when.toISOString()
      });
    });
  });
  return out;
}

/* -------------------------------------------------------------- reporting ---
   How many home and away games each team ends up with. The generator does not
   promise balance, so it shows the reader what it produced — an imbalance you
   can see is a decision; one you cannot is a bug report six weeks later. */
function balance(fixtures) {
  const m = new Map();
  const get = id => {
    if (!m.has(id)) m.set(id, { team_id: id, home: 0, away: 0 });
    return m.get(id);
  };
  (fixtures || []).forEach(f => { get(f.home).home++; get(f.away).away++; });
  return [...m.values()].map(r => Object.assign(r, {
    games: r.home + r.away, diff: r.home - r.away
  }));
}

/* every pair meets exactly the expected number of times — the property that
   makes this a round-robin rather than a pile of fixtures */
function pairCounts(fixtures) {
  const m = new Map();
  (fixtures || []).forEach(f => {
    const k = [f.home, f.away].sort().join('|');
    m.set(k, (m.get(k) || 0) + 1);
  });
  return m;
}

return { roundRobin, doubleRound, forCompetition, withDates, balance, pairCounts,
         pairsFor, orient };
}));
