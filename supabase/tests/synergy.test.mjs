/* ============================================================================
   SYNERGY - a player's play-type export, read for the reports (epinoia/synergy.js).

   A made-up player, Sam Sample, in the scraper's own layout (Side, Play Type, Sub 1..4, POSS, PTS, FG MADE ...,
   and the second, empty set of columns the export carries in another case), small enough to add up by hand:
     - his drives left are a spot-up closeout attacked (20), an isolation's (12 - split 8 from the top and 4 from
       the left, and summed again under "Isolation - Overall") and a pick-and-pop's (2): 34, counted once;
     - the shots under them: TO BASKET is the rim, the DRIBBLE JUMPER's twos mid-range and its threes threes;
     - defence: attacked face-up is every isolation and every drive outside one; post-D is the post-ups.
   The user's own files never come into the repository.

     node supabase/tests/synergy.test.mjs
   ============================================================================ */
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const S = (await import('file://' + path.join(ROOT, 'epinoia', 'synergy.js'))).default;

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + (typeof d === 'string' ? d : JSON.stringify(d)) : '')); } };
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);

const HEAD = 'Player,Player ID,Seasons scraped,Side,Play Type,Sub 1,Sub 2,Sub 3,Sub 4,Seasons with data,POSS,%TIME,%TIME RANK,PTS,PPP,PPP RANK,PPP RATING,FG MADE,FG ATT,EFG%,TO%,2 FG MADE,2 FG ATT,2 FG%,3 FG MADE,3FG ATT,3 FG%,FTA/FGA,Poss,%Time,%Time Rank,Pts,PPP Rank,PPP Rating,FG Made,FG Att,eFG%,2 FG Made,2 FG Att,3 FG Made,3FG Att';
const WHO = 'Sam Sample,abc123,"2026-2027 Leicester - International + 2025-2026 Baylor - College Men"';
/* one row: side, the path, possessions, points, field goals made / attempted, threes made / attempted, TO% */
const R = (side, p, poss, pts, fgm, fga, f3m, f3a, to) => {
  const sub = p.slice(1).concat(['', '', '', '']).slice(0, 4);
  return [WHO, side, p[0], ...sub, 2, poss, '', '', pts, poss ? (pts / poss).toFixed(3) : '', '', '', fgm, fga, '', to, fgm - f3m, fga - f3a, '', f3m, f3a, '', '0.20',
    0, '', '', 0, '', '', 0, 0, '', 0, 0, 0, 0].join(',');
};
const O = 'offense', D = 'defense';
const ROWS = [
  R(O, ['Spot Up'], 100, 100, 40, 90, 20, 50, 5.0),
  R(O, ['Isolation'], 50, 45, 18, 40, 4, 12, 8.0),
  R(O, ['P&R Roll Man'], 10, 12, 5, 8, 0, 0, 10.0),
  R(O, ['Transition'], 40, 50, 20, 30, 3, 9, 10.0),
  R(O, ['Spot Up', 'Drives Left'], 20, 22, 9, 17, 1, 3, 10.0),
  R(O, ['Spot Up', 'Drives Left', 'To Basket'], 10, 12, 6, 10, 0, 0, 0),
  R(O, ['Spot Up', 'Drives Left', 'To Basket', 'Make 2 Pts'], 6, 12, 6, 6, 0, 0, 0),
  R(O, ['Spot Up', 'Drives Left', 'Dribble Jumper'], 8, 8, 3, 7, 1, 3, 0),
  R(O, ['Spot Up', 'Drives Left', 'Dribble Jumper', 'Long/3pt'], 3, 3, 1, 3, 1, 3, 0),
  R(O, ['Spot Up', 'Drives Left', 'Dribble Jumper', 'Short to < 17'], 4, 4, 2, 4, 0, 0, 0),
  R(O, ['Spot Up', 'Drives Left', 'Turnover'], 2, 0, 0, 0, 0, 0, 100),
  R(O, ['Spot Up', 'Drives Right'], 10, 8, 4, 9, 0, 1, 10.0),
  R(O, ['Spot Up', 'Drives Right', 'To Basket'], 4, 4, 2, 4, 0, 0, 0),
  R(O, ['Spot Up', 'Drives Right', 'Dribble Jumper'], 5, 4, 2, 5, 0, 1, 0),
  R(O, ['Spot Up', 'Drives Straight'], 4, 2, 1, 4, 0, 2, 0),
  R(O, ['Spot Up', 'Drives Straight', 'Dribble Jumper'], 4, 2, 1, 4, 0, 2, 0),
  R(O, ['Isolation', 'Isolation - Overall'], 50, 45, 18, 40, 4, 12, 8.0),
  R(O, ['Isolation', 'Isolation - Overall', 'Drives Left'], 12, 10, 4, 10, 0, 2, 16.7),
  R(O, ['Isolation', 'Top', 'Drives Left'], 8, 6, 3, 7, 0, 1, 12.5),
  R(O, ['Isolation', 'Top', 'Drives Left', 'To Basket'], 5, 6, 3, 5, 0, 0, 0),
  R(O, ['Isolation', 'Top', 'Drives Left', 'Dribble Jumper'], 2, 0, 0, 2, 0, 1, 0),
  R(O, ['Isolation', 'Left', 'Drives Left'], 4, 4, 1, 3, 0, 1, 25.0),
  R(O, ['Isolation', 'Left', 'Drives Left', 'To Basket'], 2, 2, 1, 2, 0, 0, 0),
  R(O, ['Isolation', 'Left', 'Drives Left', 'Dribble Jumper'], 1, 0, 0, 1, 0, 1, 0),
  R(O, ['Isolation', 'Isolation - Overall', 'Drives Right'], 6, 9, 4, 5, 1, 1, 0),
  R(O, ['Isolation', 'Right', 'Drives Right'], 6, 9, 4, 5, 1, 1, 0),
  R(O, ['Isolation', 'Right', 'Drives Right', 'To Basket'], 3, 6, 3, 3, 0, 0, 0),
  R(O, ['Isolation', 'Right', 'Drives Right', 'Dribble Jumper'], 2, 3, 1, 2, 1, 1, 0),
  R(O, ['P&R Roll Man', 'Pick and Pops', 'Drives Left'], 2, 2, 1, 2, 0, 0, 0),
  R(O, ['P&R Roll Man', 'Pick and Pops', 'Drives Left', 'To Basket'], 2, 2, 1, 2, 0, 0, 0),
  R(D, ['Isolation'], 30, 27, 10, 25, 2, 6, 6.7),
  R(D, ['Post-Up'], 20, 22, 9, 16, 0, 0, 10.0),
  R(D, ['P&R Ball Handler'], 30, 27, 11, 26, 4, 10, 12.0),
  R(D, ['Spot Up'], 40, 44, 16, 36, 10, 24, 5.0),
  R(D, ['Isolation', 'Isolation - Overall', 'Drives Left'], 6, 5, 2, 5, 0, 1, 0),
  R(D, ['Isolation', 'Top', 'Drives Left'], 6, 5, 2, 5, 0, 1, 0),
  R(D, ['Spot Up', 'Drives Right'], 10, 9, 4, 8, 0, 0, 10.0),
  R(D, ['Spot Up', 'Drives Straight'], 3, 3, 1, 2, 1, 1, 0),
  R(D, ['P&R Roll Man', 'Pick and Pops', 'Drives Left'], 2, 2, 1, 2, 0, 0, 0),
  R(D, ['Post-Up', 'Left Block', 'Face-up', 'Drive Baseline'], 2, 3, 1, 1, 0, 0, 0)
];
const CSV = '﻿' + HEAD + '\r\n' + ROWS.join('\r\n') + '\r\n';

console.log('the file');
{
  const t = S.parseCSV('a,b,c\r\n1,"two, and ""three""",3\n\n4,5,6\n');
  ok('a quoted field keeps its commas and its doubled quotes; CRLF and LF lines, a blank line skipped', t.length === 2 && t[0].b === 'two, and "three"' && t[1].c === '6', t);
  const ps = S.read(CSV);
  ok('one player, every row read (the byte-order mark and the second, empty set of columns ignored)', ps.length === 1 && ps[0].name === 'Sam Sample' && ps[0].id === 'abc123' && ps[0].rows.length === ROWS.length);
  ok('...the seasons the file covers, each with its club and level; the span of them', JSON.stringify(ps[0].seasons) === JSON.stringify([{ season: '2026-27', team: 'Leicester', level: 'International' }, { season: '2025-26', team: 'Baylor', level: 'College Men' }])
     && S.span(ps[0].seasons) === '2025-26 to 2026-27', ps[0].seasons);
  const row = ps[0].rows.find(r => r.path.join('>') === 'Spot Up>Drives Left');
  ok('...a row: its side, its path, its counts; turnovers from TO% x possessions', row.side === 'offense' && row.poss === 20 && row.pts === 22 && row.fga === 17 && row.fg3a === 3 && row.fg2a === 14 && row.to === 2, row);
}

const P = S.fromText(CSV);
console.log('\ndrives');
{
  const L = P.offense.drives.left, Rt = P.offense.drives.right, St = P.offense.drives.straight;
  ok('his possessions: the play types\' totals (200), not their splits', P.offense.poss === 200, P.offense.poss);
  ok('drives left: the spot-up 20 + the isolation 12 (its total, not its split again) + the pick-and-pop 2 = 34, 34 points, 14 of 29, one three, 4 turnovers',
     L.poss === 34 && L.pts === 34 && L.fgm === 14 && L.fga === 29 && L.fg3m === 1 && L.to === 4, L);
  ok('...PPP 1.000, eFG% 50.0, TO% 11.8, 17.0% of his possessions and 63.0% of his drives', L.ppp.toFixed(3) === '1.000' && r1(L.efg) === 50 && r1(L.toPct) === 11.8 && r1(L.pctPoss) === 17 && r1(L.share) === 63, [L.ppp, L.efg, L.toPct, L.pctPoss, L.share]);
  ok('...its shots from the split (the Overall row has none): rim 11 of 19, mid-range 2 of 5, threes 1 of 5 - the dribble jumper\'s own children not counted again',
     L.shots.rim.m === 11 && L.shots.rim.a === 19 && L.shots.mid.m === 2 && L.shots.mid.a === 5 && L.shots.three.m === 1 && L.shots.three.a === 5 && L.att === 29, L.shots);
  ok('...FG% and share of the attempts for each kind: rim 57.9% on 65.5%, mid 40.0% on 17.2%, three 20.0% on 17.2%',
     r1(L.rimFg) === 57.9 && r1(L.rimAtt) === 65.5 && r1(L.midFg) === 40 && r1(L.midAtt) === 17.2 && r1(L.threeFg) === 20 && r1(L.threeAtt) === 17.2, [L.rimFg, L.rimAtt, L.midFg, L.midAtt, L.threeFg, L.threeAtt]);
  ok('drives right: 16, 17 points, 8 of 14, PPP 1.063, eFG% 60.7, TO% 6.3; rim 5 of 7, mid 2 of 5, threes 1 of 2',
     Rt.poss === 16 && Rt.pts === 17 && Rt.fgm === 8 && Rt.fga === 14 && Rt.ppp.toFixed(3) === '1.063' && r1(Rt.efg) === 60.7 && r1(Rt.toPct) === 6.3
     && Rt.shots.rim.a === 7 && Rt.shots.rim.m === 5 && Rt.shots.mid.a === 5 && Rt.shots.three.a === 2, Rt);
  ok('drives straight: 4, no rim attempt - a rim FG% of nothing is null, not 0', St.poss === 4 && St.rimFg === null && St.rimAtt === 0 && r1(St.efg) === 25, St);
  ok('the drives\' shares of his drives add up to 100', Math.abs(L.share + Rt.share + St.share - 100) < 1e-9 && P.offense.drivePoss === 54);
  const lL = S.lean(L), lS = S.lean(St);
  ok('the lean of a side, for its PPP\'s colour: left leans on the rim, by 0.31 (19 rim shots to 10 jumpers), half its jumpers threes',
     lL.kind === 'rim' && r1(lL.by) === 0.3 && lL.threes === 0.5, lL);
  ok('...straight is all jumpers (by 1), half of them threes; a side with no shots has no lean', lS.kind === 'jumper' && lS.by === 1 && lS.threes === 0.5 && S.lean({ att: 0 }) === null && S.lean(null) === null, lS);
}

console.log('\ndefence');
{
  const F = P.defense.faceUp, Po = P.defense.post;
  ok('attacked face-up: every isolation (10 of 25, 2 threes) and every drive outside one (spot-up right 4 of 8, straight 1 of 2 with a three, a pick-and-pop\'s 1 of 2): 16 of 37, eFG% 47.3',
     F.fgm === 16 && F.fga === 37 && F.fg3m === 3 && r1(F.efg) === 47.3 && F.poss === 45, F);
  ok('...an isolation\'s own drives are not counted twice, nor a post-up\'s face-up drive', F.poss === 30 + 10 + 3 + 2);
  ok('post-D: the post-ups, 9 of 16 - eFG% 56.3', Po.fgm === 9 && Po.fga === 16 && r1(Po.efg) === 56.3, Po);
  const Sc = P.defense.screen;
  ok('screen D: the defensive P&R ball-handler plays, 11 of 26 with 4 threes - eFG% 50.0', Sc && Sc.fgm === 11 && Sc.fga === 26 && r1(Sc.efg) === 50, Sc);
  const noDef = S.fromText(HEAD + '\n' + ROWS.filter(r => r.includes(',offense,')).join('\n'));
  ok('a file with no defence: no face-up, no post-D (null), and it says so', noDef.hasDefense === false && noDef.defense.faceUp === null && noDef.defense.post === null && noDef.hasOffense === true);
}

console.log('\nthe older export');
{
  const old = 'Player Name,Season,Play Type,Sub Category 1,Sub Category 2,POSS,PTS,FG ATT,FG MADE,3FG ATT,3 FG MADE,2 FG ATT,2 FG MADE,TO%,FTA/FGA\n'
    + 'Old Timer,2024-25,Spot Up,N/A,N/A,30,30,25,11,10,4,15,7,5.0,0.2\n'
    + 'Old Timer,2024-25,Spot Up,Drives Left,N/A,10,12,8,5,0,0,8,5,10.0,0.3\n'
    + 'Old Timer,2024-25,Spot Up,Drives Left,To Basket,8,10,6,4,0,0,6,4,0,0.3\n';
  const p = S.fromText(old);
  ok('"Sub Category" columns, N/A for an empty level, no Side column (offense): the same profile', p && p.name === 'Old Timer' && p.offense.poss === 30 && p.offense.drives.left.poss === 10 && p.offense.drives.left.shots.rim.a === 6, p && p.offense.drives.left);
}

console.log('\nnames and keeping');
{
  ok('a name as a person would match it: J.J. White is JJ White, accents and case aside', S.normName('J.J. White') === 'jj white' && S.normName('JJ White') === 'jj white' && S.normName('J J White') === 'jj white' && S.normName('Ömer  Yurtseven') === 'omer yurtseven');
  ok('fromText picks the one player, or the one named; a name not in the file is nobody', S.fromText(CSV, 'sam sample').name === 'Sam Sample' && S.fromText(CSV, 'Nobody') === null);
  const k = S.pack(P);
  ok('a profile is kept as numbers only, versioned, and read back as one', k.v === S.VERSION && S.ok(JSON.parse(JSON.stringify(k))) && !S.ok({ v: 0 }) && !S.ok(null) && !('rows' in k));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
