/* ============================================================================
   FEEDS — what a partner actually receives.

   These are the bytes RealGM and Eurobasket would republish as fact, so the
   things worth asserting are the ones that would be wrong QUIETLY:

     * a minor appearing in a feed (RLS does not protect the dispatcher — the
       service role sees everything, so the filter is code, and code can be
       deleted by accident)
     * team totals disagreeing with the lines above them
     * a field map renaming a key in JSON but not in the CSV header
     * a field map producing XML no parser will read
     * `reb` meaning offensive rebounds because the engine spells them `or`

   Run: node supabase/tests/feeds.test.mjs
   ============================================================================ */
import {
  mmss, fmtDate, fmtName, playerLine, shapeGame, applyFieldMap,
  toCSV, toXML, xmlName, render, sign
} from '../functions/_shared/feeds.js';

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.error(`  FAIL ${what}\n       got  ${a}\n       want ${b}`);
};
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.error(`  FAIL ${what}`); } };

/* --------------------------------------------------------------- fixture --- */
/* One tiny game: two players a side, one of them a minor, so every rule this
   file cares about has something to bite on. */
const P = (o) => ({ pts: 0, p2m: 0, p2a: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0, or: 0, dr: 0,
                    ast: 0, stl: 0, blk: 0, to: 0, pf: 0, fd: 0, pm: 0, min: 0, ...o });

const loaded = {
  g: {
    id: 'g-1', tipoff_at: '2026-03-04T19:30:00.000Z', finalised_at: '2026-03-04T21:22:00.000Z',
    status: 'final', venue: 'Copper Box Arena', period: 4,
    home_score: 61, away_score: 44,
    home: { id: 't-h', name: 'East Dock', short_name: 'EDK', slug: 'east-dock' },
    away: { id: 't-a', name: 'Neon City', short_name: 'NCY', slug: 'neon-city' },
    roster_snapshot: {
      teams: [
        { name: 'east dock', players: [{ id: 'p1', num: '7', name: 'ada shaw' },
                                       { id: 'p2', num: '12', name: 'kit brand' }] },
        { name: 'neon city', players: [{ id: 'p3', num: '4', name: 'sol maddox' },
                                       { id: 'p4', num: '9', name: 'young player' }] }
      ],
      starters: [['p1'], ['p3']]
    }
  },
  comp: { name: 'Regular Season', kind: 'league' },
  season: { name: '2025-26' },
  league: { name: 'Demo League', slug: 'demo-league' },
  tstats: [
    { team_idx: 0, stats: { score: 61, teamRebO: 2, teamRebD: 3, toTot: 9, foulTot: 15,
                            paint: 24, fast: 8, sc: 6, pot: 11, bench: 14, lead: 19,
                            perQ: [18, 12, 16, 15] } },
    { team_idx: 1, stats: { score: 44, teamRebO: 1, teamRebD: 1, toTot: 14, foulTot: 18,
                            perQ: [9, 13, 11, 11] } }
  ],
  pstats: [
    { player_id: 'p1', team_idx: 0,
      stats: P({ pts: 21, p2m: 6, p2a: 11, p3m: 2, p3a: 5, ftm: 3, fta: 4,
                 or: 2, dr: 5, ast: 4, stl: 2, blk: 1, to: 3, pf: 2, fd: 5,
                 pm: 14, min: 1_842_000 }) },
    { player_id: 'p2', team_idx: 0,
      stats: P({ pts: 8, p2m: 4, p2a: 9, or: 1, dr: 3, ast: 1, to: 2, pf: 4,
                 pm: -2, min: 1_260_000 }) },
    { player_id: 'p3', team_idx: 1,
      stats: P({ pts: 15, p2m: 3, p2a: 8, p3m: 3, p3a: 7, or: 0, dr: 6, ast: 5,
                 to: 4, pf: 3, pm: -9, min: 2_040_000 }) },
    // the minor. Nothing about them may leave.
    { player_id: 'p4', team_idx: 1,
      stats: P({ pts: 12, p2m: 5, p2a: 8, ftm: 2, fta: 2, or: 3, dr: 1, ast: 2,
                 to: 1, pf: 1, pm: 4, min: 900_000 }) }
  ],
  people: [
    { id: 'p1', first_name: 'Ada',   last_name: 'Shaw',   slug: 'ada-shaw',   is_minor: false },
    { id: 'p2', first_name: 'Kit',   last_name: 'Brand',  slug: 'kit-brand',  is_minor: false },
    { id: 'p3', first_name: 'Sol',   last_name: 'Maddox', slug: 'sol-maddox', is_minor: false },
    { id: 'p4', first_name: 'Young', last_name: 'Player', slug: 'young',      is_minor: true }
  ],
  events: [
    { seq: 1, t: 'made2', team: 0, pid: 'p1', period: 1, clock: '09:41', payload: { pts: 2 } },
    { seq: 2, t: 'made2', team: 1, pid: 'p4', period: 1, clock: '09:12', payload: { pts: 2 } }
  ],
  standings: [
    { rank: 1, group_name: null, gp: 10, w: 8, l: 2, pts_for: 812, pts_against: 701,
      diff: 111, league_points: 18, streak: 'W3', teams: { name: 'East Dock', slug: 'east-dock' } }
  ]
};

const FEED = (o = {}) => ({
  id: 'f-1', name: 'RealGM', slug: 'realgm', format: 'json',
  sections: { game: true, teams: true, players: true, boxscore: true,
              standings: false, playbyplay: false },
  field_map: {}, name_style: 'first_last', date_style: 'iso', ...o
});

/* ----------------------------------------------------------- formatting --- */
console.log('formatting');
eq(mmss(1_842_000), '30:42', 'mmss rounds ms to mm:ss');
eq(mmss(0), '00:00', 'mmss of nothing');
eq(mmss(59_600), '01:00', 'mmss rounds to the nearest second, not down');

eq(fmtDate('2026-03-04T19:30:00.000Z', 'iso'), '2026-03-04T19:30:00.000Z', 'iso date');
eq(fmtDate('2026-03-04T19:30:00.000Z', 'uk'), '04/03/2026', 'uk date');
eq(fmtDate('2026-03-04T19:30:00.000Z', 'us'), '03/04/2026', 'us date');
eq(fmtDate('2026-03-04T19:30:00.000Z', 'epoch'), 1772652600, 'epoch date');
eq(fmtDate(null, 'iso'), null, 'no date stays no date');
eq(fmtDate('not a date', 'uk'), 'not a date', 'an unparseable date is passed through, not invented');

eq(fmtName('Ada', 'Shaw', 'first_last'), 'Ada Shaw', 'first_last');
eq(fmtName('Ada', 'Shaw', 'last_comma_first'), 'Shaw, Ada', 'last_comma_first');
eq(fmtName('Ada', 'Shaw', 'last_first'), 'Shaw Ada', 'last_first');
eq(fmtName('Ada', 'Shaw', 'last_upper'), 'Ada SHAW', 'last_upper');
eq(fmtName('Pelé', '', 'last_comma_first'), 'Pelé', 'a one-name player is not turned into ", Pelé"');

/* --------------------------------------------------------- a player line --- */
console.log('the player line');
const line = playerLine(loaded.pstats[0].stats);
eq(line.fgm, 8, 'fgm is twos plus threes');
eq(line.fga, 16, 'fga is twos plus threes');
eq(line.reb, 7, 'reb is offensive plus defensive — NOT the engine\'s `or`');
eq(line.oreb, 2, 'oreb');
eq(line.tov, 3, 'tov comes from the engine\'s `to`');
eq(line.plus_minus, 14, 'plus_minus comes from the engine\'s `pm`');
eq(line.minutes, '30:42', 'minutes as mm:ss');
eq(line.minutes_decimal, 30.7, 'minutes also as a decimal, for a spreadsheet');

/* ------------------------------------------------------------- shaping --- */
console.log('shaping');
const shaped = shapeGame(loaded, FEED());
eq(shaped.game.home_score, 61, 'the score survives');
eq(shaped.game.venue, 'Copper Box Arena', 'the venue is carried');
eq(shaped.teams.length, 2, 'both teams');
eq(shaped.teams[0].name, 'East Dock', 'team name comes from the teams table, properly cased');
eq(shaped.teams[1].name, 'Neon City', 'away team too');
eq(shaped.teams[0].period_scores, [18, 12, 16, 15], 'period scores');

const home = shaped.teams[0], away = shaped.teams[1];
eq(home.players.map((p) => p.player), ['Ada Shaw', 'Kit Brand'], 'home box, in jersey order');
eq(home.players[0].jersey, '7', 'jersey from the snapshot');
eq(home.players[0].starter, true, 'starters are marked');
eq(home.players[1].starter, false, 'and non-starters are not');

/* the rule that matters most */
console.log('safeguarding');
eq(away.players.map((p) => p.player), ['Sol Maddox'], 'the minor is absent from the box score');
ok(!JSON.stringify(shaped).includes('Young'), 'the minor\'s name appears nowhere in the payload');
ok(!JSON.stringify(shaped).includes('p4'), 'nor their id');
ok(/under-18/.test(shaped.notice || ''), 'and the withholding is stated rather than hidden');

/* totals */
console.log('totals');
eq(home.totals.pts, 61, 'team points are the recorded score');
eq(home.totals.fgm, 12, 'team fgm is the sum of the lines');
eq(home.totals.oreb, 3 + 2, 'team oreb adds the team rebounds nobody owns');
eq(home.totals.reb, 11 + 5, 'team reb likewise');
eq(home.totals.tov, 9, 'team turnovers come from the team line — players do not own team TOs');
eq(away.totals.pts, 44, 'the away score still includes the withheld player\'s points');
eq(away.totals.ast, 5, 'but the summed lines do not double-count them');

/* sections */
console.log('sections');
const bare = shapeGame(loaded, FEED({ sections: { game: true, teams: true, boxscore: false } }));
ok(bare.teams[0].totals, 'totals present when asked for');
ok(!('players' in bare.teams[0]), 'a section not asked for is ABSENT, not empty');
const withExtras = shapeGame(loaded, FEED({
  sections: { game: true, teams: true, boxscore: true, standings: true, playbyplay: true } }));
eq(withExtras.standings.length, 1, 'standings when asked for');
eq(withExtras.play_by_play.length, 1, 'play-by-play, with the minor\'s event dropped');
eq(withExtras.play_by_play[0].team, 'home', 'team index becomes home/away');

/* ------------------------------------------------------------ field map --- */
console.log('the field map');
const mapped = applyFieldMap({ a: 1, deep: [{ reb: 4, keep: 5 }] }, { reb: 'TRB', a: 'A' });
eq(mapped, { A: 1, deep: [{ TRB: 4, keep: 5 }] }, 'leaf keys renamed at every depth');
eq(applyFieldMap({ reb: 1 }, {}), { reb: 1 }, 'an empty map changes nothing');

/* --------------------------------------------------------------- render --- */
console.log('render — JSON');
const j = render(shaped, FEED({ field_map: { reb: 'TRB' } }));
ok(j.contentType.startsWith('application/json'), 'json content type');
const jp = JSON.parse(j.body);
eq(jp.teams[0].players[0].TRB, 7, 'the field map reaches nested player rows');
ok(!('reb' in jp.teams[0].players[0]), 'and the original key is gone');

console.log('render — CSV');
const c = render(shaped, FEED({ format: 'csv', field_map: { reb: 'TRB' } }));
ok(c.contentType.startsWith('text/csv'), 'csv content type');
const rows = c.body.trim().split('\r\n');
eq(rows.length, 1 + 2 + 1 + 1 + 1, 'header + 2 home players + home TEAM + 1 away player + away TEAM');
ok(rows[0].includes('TRB'), 'the field map renames the CSV HEADER too');
ok(!/\breb\b/.test(rows[0]), 'and the original header is gone');
ok(rows.filter((r) => r.includes(',TEAM,')).length === 2, 'one TEAM row per side');
ok(!c.body.includes('Young'), 'the minor is not in the CSV either');
ok(rows[1].startsWith('g-1,'), 'game identity is repeated on every row');
ok(rows[1].includes('East Dock') && rows[1].includes('Neon City'),
   'a row names both the team and the opponent, so it stands alone');
ok(c.body.endsWith('\r\n'), 'CRLF line endings, per RFC 4180');

console.log('render — CSV quoting');
const comma = shapeGame({ ...loaded,
  g: { ...loaded.g, venue: 'Ponds Forge, Sheffield' } }, FEED({ format: 'csv' }));
const cq = toCSV(comma, {});
ok(cq.includes('"Ponds Forge, Sheffield"'), 'a value containing a comma is quoted');
eq(toCSV({ game: {}, teams: [] }, {}).trim().split('\r\n').length, 1,
   'a game with no teams still renders a header rather than nothing');
ok(toCSV({ teams: [{ name: 'a"b', side: 'home', players: [{ player: 'X' }] }] }, {})
     .includes('"a""b"'),
   'an embedded quote is doubled');

console.log('render — XML');
const x = render(shaped, FEED({ format: 'xml', field_map: { reb: 'Total Rebounds' } }));
ok(x.contentType.startsWith('application/xml'), 'xml content type');
ok(x.body.startsWith('<?xml version="1.0"'), 'declaration first');
ok(x.body.includes('<Total_Rebounds>'), 'an illegal element name is made legal rather than emitted broken');
ok(x.body.includes('<player>'), 'a plural container names its children in the singular');
ok(!x.body.includes('Young'), 'the minor is not in the XML either');
eq(xmlName('3pt'), '_3pt', 'a name cannot begin with a digit');
eq(xmlName('a b&c'), 'a_b_c', 'spaces and ampersands are replaced');
ok(toXML({ v: 'a < b & "c"' }, 'r').includes('a &lt; b &amp; &quot;c&quot;'), 'values are escaped');

/* ------------------------------------------------------------ signature --- */
console.log('signature');
const known = await sign('key', 'The quick brown fox jumps over the lazy dog');
eq(known, 'sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
   'HMAC-SHA256 matches the published test vector');
const s1 = await sign('secret', j.body);
const s2 = await sign('secret', j.body + ' ');
ok(s1 !== s2, 'a single changed byte changes the signature');

/* --------------------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
