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
  const one = src.slice(src.indexOf('async function one('));
  const week = src.slice(src.indexOf('async function sendWeek('), src.indexOf('async function one('));     // the Sunday email, which a "send next week's reports now" shares (0226)
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
