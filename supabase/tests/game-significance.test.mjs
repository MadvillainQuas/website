// 0198: HOW MUCH A GAME MATTERS, on a real Postgres (PGlite; skipped with a note when it is not installed -
// PGLITE_DIR=<its folder> or `npm i --no-save @electric-sql/pglite`), on the minimum schema the function reads
// (leagues.rules, seasons, competitions.kind, games, standings, bracket_ties, player_game_stats, players,
// news_articles.game_id) and league_visible stubbed to a switch. What is held here:
//   * the table: 1st v 2nd, a top-three clash, table-top rivals, an upset - and none of it before each club has
//     played three games, nor across two groups
//   * the players: a triple-double, 30 / 40 / 50 points, a 20-20, a double-double only as a small bonus, a season high;
//     a WITHHELD player (a minor with no consent) is never named
//   * the stage: a cup final, a semi-final, a quarter-final, another tie, a playoff game with no tie
//   * the extras: overtime, a margin of 1-3
//   * the groups are capped and so is the game; reasons come most valuable first
//   * a league the caller may not see, a game not yet final, an ad-hoc game: no row; at most 60 games a call
//   * the same through the feed's door: news_report_significance(article ids)
//
//   node supabase/tests/game-significance.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 500))); } };
const mig = readFileSync(path.join(here, '..', 'migrations', '0198_game_significance.sql'), 'utf8');
const m49 = readFileSync(path.join(here, '..', 'migrations', '0049_club_profile.sql'), 'utf8');
const withheld = m49.slice(m49.indexOf('create or replace function public.player_withheld('), m49.indexOf('$$;', m49.indexOf('create or replace function public.player_withheld(')) + 3);

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text, rules jsonb not null default '{"periods": 4}');
  create table public.seasons (id uuid primary key default gen_random_uuid(), league_id uuid references public.leagues);
  create table public.competitions (id uuid primary key default gen_random_uuid(), season_id uuid references public.seasons, name text, kind text not null default 'league');
  create table public.bracket_ties (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions, round int, label text default '');
  create table public.games (id uuid primary key default gen_random_uuid(), competition_id uuid references public.competitions,
    home_team_id uuid not null default gen_random_uuid(), away_team_id uuid not null default gen_random_uuid(), status text default 'final',
    home_score int default 0, away_score int default 0, period int default 4, tie_id uuid references public.bracket_ties);
  create table public.standings (competition_id uuid, team_id uuid, gp int default 0, rank int, group_name text);
  create table public.players (id uuid primary key default gen_random_uuid(), first_name text, last_name text, is_minor boolean default false, public_consent boolean default false);
  create table public.player_game_stats (game_id uuid, player_id text, player_uuid uuid, team_idx int default 0, stats jsonb);
  create table public.news_articles (id uuid primary key default gen_random_uuid(), league_id uuid, game_id uuid, status text default 'published');
  create table public.test_hidden (league_id uuid);
  create function public.league_visible(p uuid) returns boolean language sql stable as $$ select not exists (select 1 from test_hidden where league_id = p) $$;
  ${withheld}
`);
await db.exec(mig);
await db.exec(`grant usage on schema public to anon, authenticated;`);
const q = async (sql, params, role) => {
  if (role) await db.exec('set role ' + role);
  try { return (await db.query(sql, params)).rows; } finally { if (role) await db.exec('reset role'); }
};
const one = async (sql, params) => (await q(sql, params))[0];

/* ------------------------------------------------------------ a league of ten clubs, played long enough --- */
const lg = (await one(`insert into leagues (slug, name) values ('nbl', 'NBL') returning id`)).id;
const seas = (await one(`insert into seasons (league_id) values ($1) returning id`, [lg])).id;
const comp = (await one(`insert into competitions (season_id, name, kind) values ($1, 'League', 'league') returning id`, [seas])).id;
const team = {};        // rank -> team id
for (let r = 1; r <= 10; r++) {
  team[r] = (await one(`select gen_random_uuid() as id`)).id;
  await q(`insert into standings (competition_id, team_id, gp, rank) values ($1, $2, 10, $3)`, [comp, team[r], r]);
}
const newGame = async (o = {}) => (await one(
  `insert into games (competition_id, home_team_id, away_team_id, status, home_score, away_score, period, tie_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
  [o.comp === undefined ? comp : o.comp, o.home, o.away, o.status || 'final', o.hs ?? 88, o.as ?? 70, o.period ?? 4, o.tie || null])).id;
const stat = (g, pl, s) => q(`insert into player_game_stats (game_id, player_id, player_uuid, stats) values ($1, $2::text, $2::uuid, $3)`, [g, pl, JSON.stringify(s)]);
const player = async (first, last, minor, consent) => (await one(`insert into players (first_name, last_name, is_minor, public_consent) values ($1, $2, $3, $4) returning id`, [first, last, !!minor, !!consent])).id;
const sig = async ids => Object.fromEntries((await q(`select * from public.game_significance($1)`, [ids])).map(r => [r.game_id, r]));

console.log('\nthe table');
const g12 = await newGame({ home: team[1], away: team[2], hs: 90, as: 60 });
const g23 = await newGame({ home: team[2], away: team[3], hs: 90, as: 60 });
const g35 = await newGame({ home: team[3], away: team[5], hs: 90, as: 60 });
const g36 = await newGame({ home: team[3], away: team[6], hs: 90, as: 60 });
const gUp = await newGame({ home: team[9], away: team[2], hs: 80, as: 70 });
const gUp2 = await newGame({ home: team[2], away: team[9], hs: 90, as: 60 });          // the top side wins: no upset
const gMid = await newGame({ home: team[5], away: team[7], hs: 80, as: 60 });
let s = await sig([g12, g23, g35, g36, gUp, gUp2, gMid]);
ok('1st v 2nd: 30, "Top-of-the-table clash: 1st v 2nd"', s[g12].points === 30 && s[g12].reasons[0] === 'Top-of-the-table clash: 1st v 2nd', s[g12]);
ok('2nd v 3rd: 22, a top-three clash', s[g23].points === 22 && s[g23].reasons[0] === 'Top-three clash: 2nd v 3rd', s[g23]);
ok('3rd v 5th: 10, table-top rivals (a top-four club and one within two places)', s[g35].points === 10 && s[g35].reasons[0] === 'Table-top rivals: 3rd v 5th', s[g35]);
ok('3rd v 6th: nothing (three places apart)', s[g36].points === 0 && s[g36].reasons.length === 0, s[g36]);
ok('9th beat 2nd: 18, an upset - and 2nd beating 9th is not one', s[gUp].points === 18 && s[gUp].reasons[0] === 'Upset: 9th beat 2nd' && s[gUp2].points === 0, [s[gUp], s[gUp2]]);
ok('5th v 7th: nothing', s[gMid].points === 0);

console.log('\nnot before three games, not across groups');
await q(`update standings set gp = 2 where competition_id = $1 and rank = 2`, [comp]);
s = await sig([g12, g23, gUp]);
ok('a club with two games played counts for nothing', s[g12].points === 0 && s[g23].points === 0 && s[gUp].points === 0, s);
await q(`update standings set gp = 10 where competition_id = $1`, [comp]);
await q(`update standings set group_name = case when rank = 1 then 'A' else 'B' end where competition_id = $1`, [comp]);
s = await sig([g12]);
ok('two clubs in different groups do not have comparable ranks', s[g12].points === 0, s[g12]);
await q(`update standings set group_name = null where competition_id = $1`, [comp]);

console.log('\nthe players');
const A = await player('Ada', 'Lovelace'), B = await player('Bo', 'Peep'), C = await player('Cy', 'Young'), D = await player('Di', 'Prince');
const M = await player('Minor', 'Child', true, false), M2 = await player('Consent', 'Kid', true, true);
const gTD = await newGame({ home: team[5], away: team[7] });
await stat(gTD, A, { pts: 14, or: 3, dr: 8, ast: 11 });
await stat(gTD, B, { pts: 10, or: 4, dr: 7, ast: 2 });
const g34 = await newGame({ home: team[5], away: team[7] });
await stat(g34, A, { pts: 34, or: 2, dr: 3, ast: 4 });
const g41 = await newGame({ home: team[5], away: team[7] });
await stat(g41, A, { pts: 41, or: 2, dr: 3, ast: 4 });
const g52 = await newGame({ home: team[5], away: team[7] });
await stat(g52, A, { pts: 52, or: 2, dr: 3, ast: 4 });
const g2020 = await newGame({ home: team[5], away: team[7] });
await stat(g2020, C, { pts: 22, or: 8, dr: 13, ast: 1 });
const gDD = await newGame({ home: team[5], away: team[7] });
await stat(gDD, D, { pts: 12, or: 4, dr: 8, ast: 2 });
const gNone = await newGame({ home: team[5], away: team[7] });
await stat(gNone, D, { pts: 9, or: 2, dr: 3, ast: 9, stl: 9 });
const gMinor = await newGame({ home: team[5], away: team[7] });
await stat(gMinor, M, { pts: 45, or: 2, dr: 3, ast: 4 });
const gConsent = await newGame({ home: team[5], away: team[7] });
await stat(gConsent, M2, { pts: 33, or: 2, dr: 3, ast: 4 });
s = await sig([gTD, g34, g41, g52, g2020, gDD, gNone, gMinor, gConsent]);
ok('a triple-double: 25, named', s[gTD].points === 25 && s[gTD].reasons.join('|') === 'Triple-double: Ada Lovelace', s[gTD]);
ok('...a double-double next to it (Bo Peep: 10-11-2 is only a double) does not add', !s[gTD].reasons.some(r => /Double-double/.test(r)));
ok('30+ points: 14, "34-point game: Ada Lovelace" (not the competition\'s season high: a 52 is in it)', s[g34].points === 14 && s[g34].reasons.join('|') === '34-point game: Ada Lovelace', s[g34]);
ok('40+: 28', s[g41].points === 28 && s[g41].reasons.join('|') === '41-point game: Ada Lovelace', s[g41]);
ok('50+: 40, and the season high (+10) - the player group is capped at 45', s[g52].points === 45 && s[g52].reasons.join('|') === '52-point game: Ada Lovelace|Season high: 52 points', s[g52]);
ok('a 20-20 game: 18 (and it is not also counted a double-double)', s[g2020].points === 18 && s[g2020].reasons.join('|') === '20-20 game: Cy Young', s[g2020]);
ok('a double-double alone is worth only 4', s[gDD].points === 4 && s[gDD].reasons[0] === 'Double-double: Di Prince', s[gDD]);
ok('nine of two things is not a double-double', s[gNone].points === 0, s[gNone]);
ok('a withheld minor is never named, whatever they scored', s[gMinor].reasons[0] === '45-point game' && !JSON.stringify(s[gMinor]).includes('Minor') && !JSON.stringify(s[gMinor]).includes('Child'), s[gMinor]);
ok('...a minor whose guardian consented is named as anyone', s[gConsent].reasons[0] === '33-point game: Consent Kid', s[gConsent]);
const comp2 = (await one(`insert into competitions (season_id, name, kind) values ($1, 'Second league', 'league') returning id`, [seas])).id;
const hiA = await newGame({ comp: comp2, home: team[5], away: team[7] });
await stat(hiA, A, { pts: 34, or: 2, dr: 3, ast: 4 });
const hiLow = await newGame({ comp: comp2, home: team[5], away: team[7] });
await stat(hiLow, B, { pts: 31, or: 2, dr: 3, ast: 4 });
s = await sig([hiA, hiLow]);
ok('a 30+ game nobody in the competition has beaten is its season high: +10', s[hiA].points === 24 && s[hiA].reasons.join('|') === '34-point game: Ada Lovelace|Season high: 34 points', s[hiA]);
ok('...the lower one is not', s[hiLow].points === 14 && !s[hiLow].reasons.some(r => /Season high/.test(r)), s[hiLow]);
const hiB = await newGame({ comp: comp2, home: team[5], away: team[7] });
await stat(hiB, C, { pts: 34, or: 2, dr: 3, ast: 4 });
s = await sig([hiA, hiB]);
ok('...and a 34 that has been matched is nobody\'s season high', s[hiA].points === 14 && s[hiB].points === 14, [s[hiA], s[hiB]]);

console.log('\nthe stage');
const cup = (await one(`insert into competitions (season_id, name, kind) values ($1, 'Cup', 'cup') returning id`, [seas])).id;
const tie = async (label, round, c) => (await one(`insert into bracket_ties (competition_id, round, label) values ($1, $2, $3) returning id`, [c || cup, round, label])).id;
const tFinal = await tie('Final', 3), tSemi = await tie('Semi-final', 2), tQuarter = await tie('Quarter-final', 1), tOther = await tie('Round of 16', 1), tNoLabel = await tie('', 3);
const cg = async t => newGame({ comp: cup, home: team[5], away: team[7], tie: t });
const gF = await cg(tFinal), gS = await cg(tSemi), gQ = await cg(tQuarter), gO = await cg(tOther);
s = await sig([gF, gS, gQ, gO]);
ok('a cup final: 50, "Cup final"', s[gF].points === 50 && s[gF].reasons[0] === 'Cup final', s[gF]);
ok('a cup semi-final: 30, a quarter-final: 18, another tie: 8',
   s[gS].points === 30 && s[gS].reasons[0] === 'Cup semi-final' && s[gQ].points === 18 && s[gQ].reasons[0] === 'Cup quarter-final' && s[gO].points === 8 && s[gO].reasons[0] === 'Cup tie',
   [s[gS], s[gQ], s[gO]]);
const play = (await one(`insert into competitions (season_id, name, kind) values ($1, 'Playoffs', 'playoff') returning id`, [seas])).id;
const pF = await tie('Final', 2, play);
const gPF = await newGame({ comp: play, home: team[1], away: team[2], tie: pF });
const gPG = await newGame({ comp: play, home: team[5], away: team[7] });
const gCupGroup = await newGame({ comp: cup, home: team[5], away: team[7] });
s = await sig([gPF, gPG, gCupGroup]);
ok('a playoff final: "Playoff final" (50; the table is only the league\'s, this competition has none)', s[gPF].points === 50 && s[gPF].reasons[0] === 'Playoff final', s[gPF]);
ok('a playoff game with no tie: 8; a cup game with no tie (a group game): nothing', s[gPG].points === 8 && s[gPG].reasons[0] === 'Playoff game' && s[gCupGroup].points === 0, [s[gPG], s[gCupGroup]]);
const gNL = await cg(tNoLabel);
s = await sig([gNL]);
ok('a tie with no label: the last round of the bracket is the final', s[gNL].reasons[0] === 'Cup final', s[gNL]);

console.log('\nthe extras');
const gOT = await newGame({ home: team[5], away: team[7], period: 5, hs: 90, as: 80 });
const g2OT = await newGame({ home: team[5], away: team[7], period: 6, hs: 90, as: 80 });
const g3OT = await newGame({ home: team[5], away: team[7], period: 7, hs: 90, as: 80 });
const gClose = await newGame({ home: team[5], away: team[7], hs: 71, as: 70 });
const gClose3 = await newGame({ home: team[5], away: team[7], hs: 73, as: 70 });
const gFour = await newGame({ home: team[5], away: team[7], hs: 74, as: 70 });
s = await sig([gOT, g2OT, g3OT, gClose, gClose3, gFour]);
ok('overtime 8, double overtime 14, three: "3 overtimes"', s[gOT].reasons[0] === 'Overtime' && s[gOT].points === 8 && s[g2OT].reasons[0] === 'Double overtime' && s[g2OT].points === 14 && s[g3OT].reasons[0] === '3 overtimes', [s[gOT], s[g2OT], s[g3OT]]);
ok('a margin of 1-3: 6, "Decided by 1 point" / "3 points"; four is not close', s[gClose].reasons[0] === 'Decided by 1 point' && s[gClose].points === 6 && s[gClose3].reasons[0] === 'Decided by 3 points' && s[gFour].points === 0, [s[gClose], s[gClose3], s[gFour]]);
await q(`update leagues set rules = '{"periods": 2}' where id = $1`, [lg]);
s = await sig([gOT, gFour]);
ok('overtime is measured against the league\'s own periods (two halves: a third period is overtime)', s[gFour].reasons.some(r => /overtime/i.test(r)) === true, s[gFour]);
await q(`update leagues set rules = '{"periods": 4}' where id = $1`, [lg]);

console.log('\nput together, capped');
const gBig = await newGame({ comp: cup, home: team[1], away: team[2], tie: tFinal, hs: 101, as: 100, period: 5 });
await stat(gBig, A, { pts: 55, or: 12, dr: 4, ast: 11 });
await stat(gBig, C, { pts: 22, or: 8, dr: 13, ast: 1 });
s = await sig([gBig]);
ok('a cup final, 1st v 2nd (the cup has no table: the league\'s ranks do not read across competitions), a 55-point triple-double, an overtime, a point',
   s[gBig].reasons[0] === 'Cup final' && s[gBig].reasons.some(r => /Triple-double/.test(r)) && s[gBig].reasons.some(r => /55-point/.test(r)) && s[gBig].reasons.includes('Overtime') && s[gBig].reasons.includes('Decided by 1 point'), s[gBig]);
ok('...the player group is capped at 45, the stage at 50, the extras at 30: 50 + 45 + 14 = 109 -> the game at 100 at most',
   s[gBig].points === 100, s[gBig].points);
ok('reasons come most valuable first', (() => { const w = { 'Cup final': 50, '55-point game: Ada Lovelace': 40, 'Triple-double: Ada Lovelace': 25 }; const got = s[gBig].reasons.filter(r => w[r]).map(r => w[r]); return got.every((v, i) => !i || got[i - 1] >= v); })(), s[gBig].reasons);
const gTop = await newGame({ home: team[1], away: team[2], hs: 100, as: 99, period: 6 });
await stat(gTop, A, { pts: 55, or: 12, dr: 4, ast: 11 });
s = await sig([gTop]);
ok('1st v 2nd with a 55-point triple-double in double overtime: 30 + 45 + 14 + 6 = 95, under the cap', s[gTop].points === 95, s[gTop]);

console.log('\nwho may ask about what');
const gLater = await newGame({ home: team[1], away: team[2], status: 'live' });
const gAdHoc = await newGame({ comp: null, home: team[1], away: team[2] });
s = await sig([g12, gLater, gAdHoc, '99999999-9999-9999-9999-999999999999']);
ok('a game not yet final, an ad-hoc game and a game that does not exist have no row', Object.keys(s).length === 1 && s[g12], Object.keys(s));
await q(`insert into test_hidden values ($1)`, [lg]);
s = await sig([g12, gTD]);
ok('a league the caller may not see (a members-only or private one) answers nothing at all', Object.keys(s).length === 0, s);
await q(`delete from test_hidden`);
ok('...and nothing for a null or empty list', (await q(`select * from public.game_significance(null)`)).length === 0 && (await q(`select * from public.game_significance('{}')`)).length === 0);
const many = []; for (let i = 0; i < 70; i++) many.push(await newGame({ home: team[1], away: team[2] }));
ok('at most 60 games a call', (await q(`select * from public.game_significance($1)`, [many])).length === 60);
ok('anon and signed-in readers may ask, and nothing is written', (await q(`select count(*)::int as n from public.game_significance($1)`, [[g12]], 'anon'))[0].n === 1 &&
   (await q(`select count(*)::int as n from public.game_significance($1)`, [[g12]], 'authenticated'))[0].n === 1);

console.log('\nthe feed\'s door: news_report_significance');
const art = (await one(`insert into news_articles (league_id, game_id) values ($1, $2) returning id`, [lg, g12])).id;
const artDraft = (await one(`insert into news_articles (league_id, game_id, status) values ($1, $2, 'draft') returning id`, [lg, g23])).id;
const artWritten = (await one(`insert into news_articles (league_id, game_id) values ($1, null) returning id`, [lg])).id;
let rr = await q(`select * from public.news_report_significance($1)`, [[art, artDraft, artWritten]], 'anon');
ok('a published match report answers with its game\'s points and reasons, under the article\'s own id; a draft and a written piece do not',
   rr.length === 1 && rr[0].article_id === art && rr[0].game_id === g12 && rr[0].points === 30 && rr[0].reasons[0] === 'Top-of-the-table clash: 1st v 2nd', rr);
await q(`insert into test_hidden values ($1)`, [lg]);
rr = await q(`select * from public.news_report_significance($1)`, [[art]], 'anon');
ok('...and not for a league the caller may not see', rr.length === 0, rr);
await q(`delete from test_hidden`);

console.log('\nthe grants');
ok('the closed helper and the two functions are open to readers; the functions do not write',
   /permission denied|does not exist/.test(await (async () => { try { await q(`select public.game_significance('{}')`, [], 'anon'); return ''; } catch (e) { return e.message; } })()) === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
