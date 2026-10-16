// REPORTS BY EMAIL (scripts/report_mailer.mjs, 0221, report-mail.yml). What is held here, with no database and no mail:
//   * the week ahead of a Sunday is Monday to Sunday at the reader's own time, across a clock change, and the Sundays
//     tile (one ends where the next begins), so a game is in one email and never two; an address's first Sunday
//     starts at once, for a game later that day;
//   * the week's opponents, one report a club however often it is met;
//   * the emails: their subjects, the result, the next fixture, the fixtures, the fortnightly report, the off week;
//   * an email that would pass the size limit goes in parts, each whole;
//   * the schedule (every half hour, a dry run by hand), the secrets, and 0221's tables.
//
//   node supabase/tests/report-mailer.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const M = await import(pathToFileURL(path.join(ROOT, 'scripts', 'report_mailer.mjs')).href);

console.log('\nthe week ahead');
{
  /* Sydney's clocks go forward at 2 am on Sunday 4 October 2026: the email at 08:07 that morning */
  const now = new Date('2026-10-03T21:07:00Z');
  const W = M.weekAhead('Australia/Sydney', now);
  ok('Sunday 4 October in Sydney: Monday 5 October 00:00 (AEDT) to Monday 12 October 00:00',
    W.from.toISOString() === '2026-10-04T13:00:00.000Z' && W.to.toISOString() === '2026-10-11T13:00:00.000Z', [W.from, W.to]);
  const F = M.weekAhead('Australia/Sydney', now, true);
  ok('...an address\'s first Sunday starts now, so a game later that day is in it', F.from.getTime() === now.getTime() && F.to.getTime() === W.to.getTime());
  const next = M.weekAhead('Australia/Sydney', new Date(now.getTime() + 7 * 864e5));
  ok('...and the next Sunday\'s week begins where this one ends: no game in two emails, none missed', next.from.getTime() === W.to.getTime());
  const L = M.weekAhead('Europe/London', new Date('2026-10-25T07:07:00Z'));
  ok('London, the Sunday the clocks go back: Monday 26 October 00:00 GMT to Monday 2 November', L.from.toISOString() === '2026-10-26T00:00:00.000Z' && L.to.toISOString() === '2026-11-02T00:00:00.000Z', [L.from, L.to]);
  const loc = M.local('Australia/Sydney', now);
  ok('the reader\'s own day and hour decide the Sunday (08:07 on Sunday 4 October in Sydney, still Saturday in UTC)', loc.wd === 'Sun' && loc.hour === 8 && loc.date === '2026-10-04', loc);
}

console.log('\nthe emails');
const team = { id: 'T', name: 'Illawarra Hawks', colour: '#e01837' }, sub = { name: 'Sam', email: 'coach@example.com' }, tz = 'Australia/Sydney';
const G = (id, h, a, hn, an, at, venue) => ({ id, home_team_id: h, away_team_id: a, home: { name: hn }, away: { name: an }, tipoff_at: at, venue });
{
  const games = [G('1', 'P', 'T', 'South East Melbourne Phoenix', 'Illawarra Hawks', '2026-10-04T04:00:00Z', 'John Cain Arena'),
    G('2', 'T', 'J', 'Illawarra Hawks', 'Tasmania JackJumpers', '2026-10-09T08:30:00Z', 'WIN Entertainment Centre'),
    G('3', 'T', 'P', 'Illawarra Hawks', 'South East Melbourne Phoenix', '2026-10-11T06:00:00Z', 'WIN Entertainment Centre')];
  const O = M.opponentsOf(team, games);
  ok('the week\'s opponents: one report a club, however often it is met', O.opps.length === 3 && O.uniq.map(o => o.oname).join('|') === 'South East Melbourne Phoenix|Tasmania JackJumpers');
  const E = M.sundayEmail({ sub, team, games, ownDue: true, tz, monday: new Date('2026-10-04T13:00:00Z') });
  ok('Sunday: the subject names the opponents and the fortnightly report',
    E.subject === 'Your week ahead: scouting reports on South East Melbourne Phoenix and Tasmania JackJumpers, plus Illawarra Hawks’ team report', E.subject);
  ok('...each fixture at the reader\'s time, home or away, at its venue', /Sun 4 Oct<\/b> · 15:00/.test(E.html) && /Fri 9 Oct<\/b> · 19:30/.test(E.html) && /Away · John Cain Arena/.test(E.html) && /three games/.test(E.html));
  ok('...the attachments named, the fortnightly note, a greeting by name', /Scouting report: Tasmania JackJumpers/.test(E.html) && /Team report: Illawarra Hawks \(fortnightly\)/.test(E.html) &&
    /fortnightly report week/.test(E.html) && /Hi Sam,/.test(E.html));
  const off = M.sundayEmail({ sub: {}, team, games: [], ownDue: true, tz });
  ok('an off week sends the fortnightly report alone, and says so', off.subject === 'Illawarra Hawks’ fortnightly team report' && /no games for Illawarra Hawks/.test(off.html) && /Hello,/.test(off.html));
  /* a club that has not played this season: no club report on it (the game stays in the email, said to have none) */
  const nr = M.sundayEmail({ sub, team, games, ownDue: false, tz, monday: new Date('2026-10-04T13:00:00Z'), noReport: ['J'] });
  ok('an opponent that has not played: no report on it, the subject names only the one there is, the email says why',
    nr.subject === 'Your week ahead: scouting report on South East Melbourne Phoenix' && !/Scouting report: Tasmania JackJumpers/.test(nr.html) &&
    /No scouting report on Tasmania JackJumpers yet: they have not played a game this season/.test(nr.html) && /three games/.test(nr.html), nr.subject);
  const onlyOwn = M.sundayEmail({ sub, team, games: [games[1]], ownDue: true, tz, noReport: ['J'] });
  ok('...and when it is the only opponent, the own report goes alone, saying there is no scouting report this week',
    !/Scouting report:/.test(onlyOwn.html) && /Tasmania JackJumpers, who has not played a game this season yet, so there is no scouting report this week/.test(onlyOwn.html), onlyOwn.html.slice(0, 300));
  const src = readFileSync(path.join(ROOT, 'scripts', 'report_mailer.mjs'), 'utf8');
  ok('the mailer asks hasPlayed of every opponent and of the club itself before its own report',
    /if \(await hasPlayed\(o\.oid\)\) played\.push\(o\)/.test(src) && /const ownDue = choice\.own && await hasPlayed\(team\.id\)/.test(src) && /status=eq\.final&competition_id=in\./.test(src));
  ok('three or more opponents read as a list', M.listOf(['A', 'B', 'C']) === 'A, B and C' && M.possessive('Adelaide 36ers') === 'Adelaide 36ers’' && M.possessive('Cairns') === 'Cairns’');
  const g = Object.assign(G('9', 'T', 'A', 'Illawarra Hawks', 'Adelaide 36ers', '2026-10-02T09:30:00Z', 'WIN Entertainment Centre'), { home_score: 114, away_score: 94,
    competitions: { name: 'NBL', seasons: { leagues: { name: 'NBL' } } } });
  const GE = M.gameEmail({ sub, team, g, side: 0, next: games[0], tz });
  ok('after a game: the subject is the result, from the club\'s side', GE.subject === 'Game analysis: Illawarra Hawks 114–94 Adelaide 36ers (NBL)', GE.subject);
  ok('...the win, the day and venue, both teams side by side, and the next fixture', /114–94 win over Adelaide 36ers on Friday 2 October at WIN Entertainment Centre/.test(GE.html) &&
    /both teams, side by side/.test(GE.html) && /Next up:<\/b> Sunday 4 October, 15:00 · at South East Melbourne Phoenix \(John Cain Arena\)/.test(GE.html));
  const ga = Object.assign(G('8', 'K', 'T', 'Sydney Kings', 'Illawarra Hawks', '2026-09-27T08:00:00Z', 'Afterpay Arena'), { home_score: 121, away_score: 100, competitions: { name: 'NBL' } });
  const away = M.gameEmail({ sub, team, g: ga, side: 1, tz });
  ok('...away and beaten: the club\'s score first, a loss, the headline as the scoreboard reads',
    away.subject === 'Game analysis: Illawarra Hawks 100–121 Sydney Kings (NBL)' && /100–121 loss to Sydney Kings/.test(away.html) && /Sydney Kings 121–100 Illawarra Hawks/.test(away.html), away.subject);
  ok('the email is built as email is: tables, inline styles, the club\'s colour, how to stop it', /<table role="presentation"/.test(E.html) && /background:#e01837/.test(E.html) && /reply to this email/.test(E.html) && !/<style/.test(E.html));
  ok('...and where the reports are kept: the dashboard, for the account with this address', /href="https:\/\/prophesyscouting\.co\.uk\/epinoia\/profile\/#reports"/.test(E.html) && /sign in with this address/.test(GE.html));
}

console.log('\nsize');
{
  const f = n => ({ filename: n + '.pdf', content: 'x'.repeat(12e6) });
  const parts = M.partsOfFiles([f('a'), f('b'), f('c'), f('d')]);
  ok('reports past the limit go in parts, each whole, in order', parts.length === 2 && parts[0].map(a => a.filename).join() === 'a.pdf,b.pdf' && parts[1].map(a => a.filename).join() === 'c.pdf,d.pdf');
  ok('...under it, one email', M.partsOfFiles([f('a'), f('b')]).length === 1);
}

console.log('\nkept for the dashboard (0225)');
{
  const sub = { id: '00000000-0000-0000-0000-0000000000b1', email: 'coach@example.com' };
  ok('a report is kept at <address>/<day>/<file>, the name made safe', M.reportPath(sub.id, '2026-10-04T08:00:00Z', 'scouting-report-sydney kings/../x.pdf') ===
     sub.id + '/2026-10-04/scouting-report-sydney-kings-..-x.pdf' && /^[0-9a-f-]{36}\/[A-Za-z0-9._\/-]{1,200}\.pdf$/.test(M.reportPath(sub.id, '2026-10-04', 'game-analysis-a-v-b.pdf')));
  const row = M.fileRow({ sub, kind: 'opp', ref: '2026-10-04:T2', title: 'Sydney Kings', subtitle: 'Week of Mon 5 Oct 2026', path: 'p.pdf', bytes: 1200 });
  ok('...with a row saying what it is, for whom, and how big', row.sub_id === sub.id && row.kind === 'opp' && row.ref === '2026-10-04:T2' && row.title === 'Sydney Kings' &&
     row.subtitle === 'Week of Mon 5 Oct 2026' && row.bytes === 1200 && !('seen_at' in row) && !('made_at' in row));
  const src = readFileSync(path.join(ROOT, 'scripts', 'report_mailer.mjs'), 'utf8');
  const one = src.slice(src.indexOf('async function sendGame('), src.indexOf('async function one('));   // a game's email, after a final and in send now (pick.games)
  const week = src.slice(src.indexOf('async function sendWeek('), src.indexOf('async function sendGame('));     // the Sunday email, which a "send next week's reports now" shares (0226)
  ok('every report is kept before its email goes (a failed email still leaves it in the dashboard)',
     one.indexOf("kind: 'game'") >= 0 && one.indexOf("kind: 'game'") < one.indexOf('await send(sub.email, E.subject, E.html, [pdf])') &&
     week.indexOf("kind: 'opp'") >= 0 && week.indexOf("kind: 'opp'") < week.lastIndexOf('await send(') && week.indexOf("kind: 'team'") >= 0 && week.indexOf("kind: 'team'") < week.lastIndexOf('await send('));
  ok('...a rerun writes the same row (sub, kind, ref), so an opened report stays opened', /report_files\?on_conflict=sub_id,kind,ref/.test(src) && /resolution=merge-duplicates/.test(src) && /'x-upsert': 'true'/.test(src));
  ok('...and keeping it failing never stops the email', /catch \(e\) \{ console\.warn\('\[' \+ sub\.email \+ '\] not kept for the dashboard/.test(src));
}

console.log('\nthe schedule and the tables');
{
  const yml = readFileSync(path.join(ROOT, '.github', 'workflows', 'report-mail.yml'), 'utf8');
  ok('every half hour, and by hand with a dry run and one address', /cron: '7,37 \* \* \* \*'/.test(yml) && /dry_run:/.test(yml) && /only:/.test(yml));
  ok('...with the secrets it needs, the site served from the checkout', ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'RESEND_API_KEY', 'REPORTS_FROM'].every(k => yml.includes('secrets.' + k)) && /http\.server 8765/.test(yml));
  const sql = readFileSync(path.join(ROOT, 'supabase', 'migrations', '0221_report_mail.sql'), 'utf8');
  ok('0221: an address and a club once each, a log that keeps each email once, platform admins only',
    /unique \(email, team_id\)/.test(sql) && /unique \(sub_id, kind, ref\)/.test(sql) && /is_platform_admin\(\)/.test(sql));
  const js = readFileSync(path.join(ROOT, 'epinoia', 'admin', 'platform', 'platform.js'), 'utf8');
  ok('the console sets the time zone to the club\'s league\'s when the club is picked', /leagues\(name,timezone\)/.test(js) && /MAIL_TZ\.set\(label, t\.leagues\.timezone\)/.test(js));
  const rp = readFileSync(path.join(ROOT, 'epinoia', 'report.js'), 'utf8');
  ok('the mailer\'s copy of a report is drawn at email weight', /scale: bot \? 2 : 3, quality: bot \? 0\.84 : 0\.9/.test(rp));
}

console.log('\nan opponent playing on the Sunday: the email waits for it');
{
  const tz = 'Europe/London', cut = M.sundayCutoff(tz, new Date('2026-10-11T07:30:00Z'));
  ok('the cut-off is 23:30 of that Sunday at the reader\'s time (BST: 22:30Z)', cut.toISOString() === '2026-10-11T22:30:00.000Z', cut);
  const B = M.sundayBounds(tz, new Date('2026-10-11T07:30:00Z'));
  ok('the Sunday runs from local midnight to the next', B.from.toISOString() === '2026-10-10T23:00:00.000Z' && B.to.toISOString() === '2026-10-11T23:00:00.000Z', [B.from, B.to]);
  const at = iso => new Date(iso);
  ok('no opponent plays that day: nothing to wait for', !M.sundayHold([], at('2026-10-11T07:30:00Z'), cut).wait);
  ok('an opponent\'s game still to play (or live): wait', M.sundayHold([{ status: 'scheduled' }], at('2026-10-11T07:30:00Z'), cut).wait && M.sundayHold([{ status: 'live' }], at('2026-10-11T15:00:00Z'), cut).wait);
  const fin = { status: 'final', finalised_at: '2026-10-11T15:00:00Z' };
  ok('...finished 40 minutes ago: still wait, the hour is not up', M.sundayHold([fin], at('2026-10-11T15:40:00Z'), cut).wait);
  ok('...finished an hour ago: go', !M.sundayHold([fin], at('2026-10-11T16:00:00Z'), cut).wait);
  ok('two opponents: the LAST game decides', M.sundayHold([fin, { status: 'final', finalised_at: '2026-10-11T17:30:00Z' }], at('2026-10-11T18:00:00Z'), cut).wait);
  ok('a game that never finalises does not hold the email past the cut-off', !M.sundayHold([{ status: 'live' }], at('2026-10-11T22:31:00Z'), cut).wait);
  ok('a game still live five hours after its tip-off is one the feed lost: not waited for', !M.sundayHold([{ status: 'live', tipoff_at: '2026-10-11T09:00:00Z' }], at('2026-10-11T15:00:00Z'), cut).wait);
  ok('...but a game that tipped off two hours ago is', M.sundayHold([{ status: 'live', tipoff_at: '2026-10-11T13:00:00Z' }], at('2026-10-11T15:00:00Z'), cut).wait);
  const src = readFileSync(path.join(ROOT, 'scripts', 'report_mailer.mjs'), 'utf8');
  ok('the Sunday round asks it before sending, and says so in the log', src.includes('sundayHold(today, new Date(), sundayCutoff(tz))') && src.includes('waiting,'));
}

/* A TIMESTAMP FROM THE DATABASE IN AN ADDRESS IS ENCODED (2026-10-06): a game's tipoff_at comes back as
   "2025-12-12T19:30:00+00:00", and a bare '+' in a query string is a space, which PostgREST refuses (22007): every run failed
   for the addresses with a game that had one. Only toISOString() ('…Z', nothing to encode) may go in bare. */
{
  const src = readFileSync(path.join(ROOT, 'scripts', 'report_mailer.mjs'), 'utf8');
  const bare = [...src.matchAll(/=(?:gt|gte|lt|lte|eq)\.\$\{([^}]*(?:_at|tipoff)[^}]*)\}/g)].map(m => m[1])
    .filter(x => !/^encodeURIComponent\(/.test(x) && !/^[\w.]+\.toISOString\(\)$/.test(x) && x !== 'since');
  ok('no database timestamp goes into a query address unencoded', bare.length === 0, bare.join(' | '));
}

/* ---------------------------------------------------------------- 2026-10-14: what goes, and nothing missed --- */
console.log('\nwhat goes: the address\'s kinds, the week\'s ticks, send-now\'s ticks (0263)');
{
  const o = id => ({ oid: id, oname: 'Club ' + id });
  const opps = [o('a'), o('b'), o('c')];
  const ids = c => c.opps.map(x => x.oid).join('');
  let c = M.weekChoice({ sub: { player_zip: true }, opps, ownDue: true, pick: null });
  ok('before 0263 (no kinds, no picks): every opponent, the own report when due, the players\' ZIP', ids(c) === 'abc' && c.own && c.players, c);
  ok('...and before 0228 (no player_zip column) no ZIP, as then', !M.weekChoice({ sub: {}, opps, ownDue: true, pick: null }).players);
  c = M.weekChoice({ sub: {}, opps, ownDue: false, pick: null });
  ok('...the own report only when due', !c.own);
  c = M.weekChoice({ sub: { send_opponents: false, send_own: false, player_zip: false }, opps, ownDue: true, pick: null });
  ok('an address with its kinds unticked: no opponents, no own report, no ZIP', ids(c) === '' && !c.own && !c.players, c);
  c = M.weekChoice({ sub: {}, opps, ownDue: true, pick: { skip: ['b'], own: false, players: false } });
  ok('the week\'s ticks: an opponent left out, the own report held back, no ZIP', ids(c) === 'ac' && !c.own && !c.players, c);
  c = M.weekChoice({ sub: { send_own: false }, opps, ownDue: false, pick: { own: true } });
  ok('...the own report ticked goes even out of its fortnight and with the kind off', c.own);
  c = M.weekChoice({ sub: { send_opponents: false }, opps, ownDue: false, pick: { opps: ['c', 'zz'] } });
  ok('send-now\'s ticks: only the opponents ticked (one ticked by hand goes with the kind off; one not in the week is ignored)', ids(c) === 'c', c);
  c = M.weekChoice({ sub: { player_zip: true }, opps, ownDue: true, pick: { opps: [], own: null, players: null } });
  ok('...none ticked: no opponents, the own report and ZIP as the address has them', ids(c) === '' && c.own && c.players, c);
}
console.log('\nthe own report\'s fortnight, in Sundays');
{
  const L = (...refs) => refs.map(r => ({ kind: 'team', ref: r, sent_at: '2026-10-05T23:59:00Z' }));
  ok('never sent: due', M.ownDueOn([], '2026-10-18'));
  ok('sent for 4 Oct: not due 11 Oct, due 18 Oct', !M.ownDueOn(L('2026-10-04'), '2026-10-11') && M.ownDueOn(L('2026-10-04'), '2026-10-18'));
  ok('a send-now for next Sunday counts as that Sunday\'s', !M.ownDueOn(L('2026-10-04', '2026-10-11'), '2026-10-18') && M.ownDueOn(L('2026-10-11'), '2026-10-25'));
  ok('other kinds of row are not the own report', M.ownDueOn([{ kind: 'sunday', ref: '2026-10-11' }, { kind: 'game', ref: 'x' }], '2026-10-18'));
}
console.log('\na Sunday missed is caught up');
{
  const LON = 'Europe/London', sub = { created_at: '2026-09-01T00:00:00Z' };
  const mon = new Date('2026-10-12T06:07:00Z');                                   // Monday 12 Oct, 07:07 in London
  const C = M.catchUpWeek(LON, mon, sub, []);
  ok('Monday with no email for Sunday 11 Oct: caught up, dated 11 Oct, for the week Mon 12 to Mon 19', C && C.day === '2026-10-11' &&
    C.W.from.toISOString() === '2026-10-11T23:00:00.000Z' && C.W.to.toISOString() === '2026-10-18T23:00:00.000Z', C);
  ok('...and on the Tuesday', (M.catchUpWeek(LON, new Date('2026-10-13T20:00:00Z'), sub, []) || {}).day === '2026-10-11');
  ok('...not on the Wednesday (the week is half gone; the next Sunday has it)', M.catchUpWeek(LON, new Date('2026-10-14T09:00:00Z'), sub, []) === null);
  ok('...not when the Sunday is in the log (sent, or nothing that week)', M.catchUpWeek(LON, mon, sub, [{ kind: 'sunday', ref: '2026-10-11' }]) === null);
  ok('...not on a Sunday (the Sunday round has it)', M.catchUpWeek(LON, new Date('2026-10-11T22:30:00Z'), sub, []) === null);
  ok('...not for an address added after that Sunday\'s 8 am', M.catchUpWeek(LON, mon, { created_at: '2026-10-11T09:00:00Z' }, []) === null &&
    M.catchUpWeek(LON, mon, { created_at: '2026-10-11T06:00:00Z' }, []) !== null);
  ok('...at the address\'s own time: just past midnight on Monday in Sydney is still Sunday in London', (M.catchUpWeek('Australia/Sydney', new Date('2026-10-11T13:30:00Z'), sub, []) || {}).day === '2026-10-11' &&
    M.catchUpWeek(LON, new Date('2026-10-11T13:30:00Z'), sub, []) === null);
  const src = readFileSync(path.join(ROOT, 'scripts', 'report_mailer.mjs'), 'utf8');
  ok('the round sends it, dated by that Sunday, before the Sunday check', /const late = catchUpWeek\(tz, new Date\(\), sub, sent\);[\s\S]{0,200}sendWeek\(sub, team, tz, sent, late\.W, late\.day\)/.test(src) &&
    src.indexOf('catchUpWeek(tz, new Date()') < src.indexOf("if (L.wd !== 'Sun'"));
}
console.log('\nthe Sunday hold, and the rest of the round');
{
  const src = readFileSync(path.join(ROOT, 'scripts', 'report_mailer.mjs'), 'utf8').replace(/\r\n/g, '\n');
  ok('the opponents waited for are those from next Monday (an address\'s first Sunday does not wait for that day\'s own opponent)',
    /const nextMon = weekAhead\(tz, new Date\(\), false\)\.from;/.test(src) && /tipoff_at=gte\.\$\{nextMon\.toISOString\(\)\}/.test(src));
  ok('...and the club itself when its own report goes in the email (not on its first Sunday)', /const ownToday = !first && weekChoice/.test(src) && /concat\(ownToday \? \[team\.id\] : \[\]\)/.test(src));
  ok('...the opponents unticked for the week are not waited for', /weekChoice\(\{ sub, opps: opponentsOf\(team, ahead\)\.uniq, ownDue: false, pick \}\)\.opps/.test(src));
  ok('one game that cannot be drawn does not stop the rest: each in its own try, given up after 36 hours', /if \(has\('game', g\.id\)\) continue;\n[\s\S]{0,400}?\n    try \{\n      await sendGame\(sub, team, g, tz\);\n    \} catch \(e\) \{/.test(src) &&
    M.GAME_GIVE_UP_MS === 36 * 36e5 && /'not sent: '/.test(src));
  ok('the game emails follow the address\'s kind', /sub\.send_games === false \? \[\] : games/.test(src));
  ok('the log is written up to three times', /if \(i >= 2\) throw e;/.test(src));
  ok('a zone that cannot be read: the league\'s, then UTC', M.okZone('Mars/Olympus', 'Europe/London') === 'Europe/London' && M.okZone('', null) === 'UTC' &&
    M.okZone('Australia/Perth', 'Europe/London') === 'Australia/Perth');
}
console.log('\nthe email when an opponent is left out');
{
  const team = { id: 'T', name: 'Illawarra Hawks', colour: '#c00' }, tz = 'Australia/Sydney';
  const G2 = (id, h, a, hn, an, t) => ({ id, home_team_id: h, away_team_id: a, home: { name: hn }, away: { name: an }, tipoff_at: t, venue: 'V' });
  const games = [G2('1', 'T', 'A', 'Illawarra Hawks', 'Adelaide 36ers', '2026-10-06T08:30:00Z'), G2('2', 'B', 'T', 'Brisbane Bullets', 'Illawarra Hawks', '2026-10-09T09:30:00Z')];
  const E = M.sundayEmail({ sub: { name: 'Sam' }, team, games, ownDue: false, tz, monday: new Date('2026-10-04T13:00:00Z'), noReport: [], picked: ['A'] });
  ok('only the ticked opponent\'s report is named; both games are still in the fixtures', E.subject === 'Your week ahead: scouting report on Adelaide 36ers' && /Brisbane Bullets/.test(E.html) && !/Scouting report: Brisbane/.test(E.html), E.subject);
  const O = M.sundayEmail({ sub: {}, team, games, ownDue: true, tz, monday: new Date('2026-10-04T13:00:00Z'), noReport: [], picked: [] });
  ok('...none ticked, the own report alone, not said to be for want of games played', /team report only/.test(O.html) && !/not played a game/.test(O.html));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
