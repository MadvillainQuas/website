// SEND NEXT WEEK'S REPORTS NOW (0226; scripts/report_mailer.mjs nextWeek() and requests(), the console-kick function, the
// platform console's Reports by email). What is held here:
//   * "next week" is the Monday-to-Sunday that begins next Monday at the address's own time, from any day of the week, across
//     a clock change, and it is dated by the Sunday before it, which is the date the Sunday round looks for in the log: a
//     request sent on Wednesday is that Sunday's email, so Sunday morning does not send it again;
//   * the console writes the same week in its confirmation (platform.js weekWords) as the mailer sends;
//   * the mailer takes the console's requests first, claims each one, sends the week the way a Sunday does, keeps and logs
//     it, and leaves the request sent, nothing to send (not logged as the Sunday: the fixtures may yet be announced),
//     failed (the email's failure is the request's, and nothing is logged as sent), or untouched when another run has it;
//     one request does not wait for the rest, and a request nobody took in three hours is given up;
//   * the mailer's answers from PostgREST are read as PostgREST gives them: an insert answers 201 with nothing in it;
//   * the database (PGlite; skipped with a note when it is not installed): who may ask, one open request an address, the
//     paused left out, an old request given up when the next is asked for, the table read by platform administrators only;
//   * console-kick starts the mailer for a queued request as it starts the other workers (its own source, run on stand-ins for
//     Deno, Supabase and GitHub), and the console's buttons.
//
//   node supabase/tests/report-send-now.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 500))); } };
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SERVICE_KEY = 'service-key'; process.env.RESEND_API_KEY = 're_test';
delete process.env.ONLY; delete process.env.DRY;
const M = await import(pathToFileURL(path.join(ROOT, 'scripts', 'report_mailer.mjs')).href);

console.log('\nnext week, asked for on any day');
const LON = 'Europe/London';
{
  const w = M.nextWeek(LON, new Date('2026-10-07T10:00:00Z'));
  ok('on a Wednesday: Monday 12 October 00:00 to Monday 19 October 00:00 at their time (London, still on summer time)',
     w.from.toISOString() === '2026-10-11T23:00:00.000Z' && w.to.toISOString() === '2026-10-18T23:00:00.000Z', [w.from, w.to]);
  ok('...dated by the Sunday before it, 11 October', w.sunday === '2026-10-11', w.sunday);
  const week = [5, 6, 7, 8, 9, 10, 11].map(d => M.nextWeek(LON, new Date(Date.UTC(2026, 9, d, 12))));
  ok('every day from Monday 5 to Sunday 11 October asks for the week that begins Monday 12 October', week.every(x => {
    const f = M.local(LON, x.from), t = M.local(LON, x.to);
    return f.date === '2026-10-12' && f.wd === 'Mon' && f.hour === 0 && t.date === '2026-10-19' && t.wd === 'Mon' && x.sunday === '2026-10-11'; }), week.map(x => x.sunday));
  ok('...a Monday asks for the next week, not the one it is in', M.nextWeek(LON, new Date('2026-10-12T12:00:00Z')).sunday === '2026-10-18');
  const syd = new Date('2026-10-03T21:07:00Z');                         // 08:07 on Sunday 4 October in Sydney, where the clocks went forward that night
  const a = M.nextWeek('Australia/Sydney', syd), b = M.weekAhead('Australia/Sydney', syd);
  ok('pressed on a Sunday it is that Sunday\'s own week ahead, the one the Sunday round sends, dated that Sunday',
     a.from.getTime() === b.from.getTime() && a.to.getTime() === b.to.getTime() && a.sunday === M.local('Australia/Sydney', syd).date && a.sunday === '2026-10-04', [a, b]);
  const c = M.nextWeek(LON, new Date('2026-10-20T10:00:00Z'));
  ok('across the clock change (London, 25 October): Monday 26 October 00:00 GMT to Monday 2 November',
     c.from.toISOString() === '2026-10-26T00:00:00.000Z' && c.to.toISOString() === '2026-11-02T00:00:00.000Z', [c.from, c.to]);
  ok('...and its date is what the Sunday round reads from the clock that morning, so it finds the request done',
     c.sunday === M.local(LON, new Date('2026-10-25T08:37:00Z')).date && w.sunday === M.local(LON, new Date('2026-10-11T07:37:00Z')).date, [c.sunday, w.sunday]);
  const nz = M.nextWeek('Pacific/Auckland', new Date('2026-10-04T22:00:00Z'));   // still Sunday in UTC, already Monday in Auckland
  ok('their own calendar decides the day: Monday in Auckland asks for the week after it',
     nz.from.toISOString() === '2026-10-11T11:00:00.000Z' && nz.sunday === '2026-10-11', [nz.from, nz.sunday]);
}

console.log('\nthe console writes the same week');
{
  const src = read('epinoia', 'admin', 'platform', 'platform.js');
  const fn = /function weekWords\(tz, now = new Date\(\)\) \{[\s\S]*?\n\}\n/.exec(src);
  ok('the console\'s weekWords can be read out of platform.js', !!fn);
  const weekWords = new Function(fn[0] + '; return weekWords;')();
  const day = (d, tz) => d.toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
  const zones = ['Europe/London', 'Australia/Sydney', 'Pacific/Auckland', 'America/New_York', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC'];
  const bad = []; let n = 0;
  for (const tz of zones) for (let h = 0; h < 24 * 50; h += 11) {
    const now = new Date(Date.UTC(2026, 8, 25) + h * 36e5), W = M.nextWeek(tz, now), want = day(W.from, tz) + ' to ' + day(new Date(W.to.getTime() - 1), tz), got = weekWords(tz, now);
    n++; if (got !== want) bad.push([tz, now.toISOString(), got, want]);
  }
  ok('...in nine zones, every eleven hours across fifty days with three clock changes in them (' + n + ' times)', !bad.length, bad.slice(0, 2));
  ok('...and a zone it cannot read gives words, not an error', /Monday-to-Sunday week/.test(weekWords('Not/A_Zone')));
}

/* ---------------------------------------------------------------- the mailer, against PostgREST as it answers --- */
const SUB = '5b5b5b5b-0000-4000-8000-000000000001', TEAM = '7e7e7e7e-0000-4000-8000-000000000001';
const club = { id: TEAM, name: 'Illawarra Hawks', colour: '#e01837', leagues: { timezone: LON } };
const sub = (o = {}) => ({ id: SUB, email: 'coach@example.com', name: 'Sam', tz: LON, created_at: '2026-09-01T00:00:00Z', active: true, team_id: TEAM, teams: club, ...o });
const G = (id, h, a, hn, an, at) => ({ id, home_team_id: h, away_team_id: a, home: { name: hn }, away: { name: an }, tipoff_at: at, venue: 'The Arena' });
const GAMES = [
  G('g0', 'P', TEAM, 'South East Melbourne Phoenix', 'Illawarra Hawks', '2026-10-11T12:00:00Z'),    // Sunday 11 October: the week before's
  G('g1', 'P', TEAM, 'South East Melbourne Phoenix', 'Illawarra Hawks', '2026-10-13T18:00:00Z'),    // Tuesday 13 October
  G('g2', TEAM, 'J', 'Illawarra Hawks', 'Tasmania JackJumpers', '2026-10-18T14:00:00Z'),           // Sunday 18 October, 15:00: this week's
  G('g3', TEAM, 'A', 'Illawarra Hawks', 'Adelaide 36ers', '2026-10-19T19:00:00Z')];                // Monday 19 October: the week after's
const NOW = new Date('2026-10-07T10:00:00Z');
const quiet = async f => { const k = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = () => {}; try { return await f(); } finally { Object.assign(console, { log: k.l, error: k.e, warn: k.w }); } };
/* a stand-in for PostgREST, storage and Resend. Inserts answer 201 with an empty body, an update asking for the row back
   answers the rows, one that does not answers 204: as PostgREST does. */
function world(st) {
  const calls = [];
  st.requests ??= []; st.log ??= []; st.games ??= GAMES; st.resend ??= 200;
  const J = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const none = status => new Response(null, { status });
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url), q = u.searchParams, method = opt.method || 'GET', body = typeof opt.body === 'string' && opt.body[0] === '{' ? JSON.parse(opt.body) : null;
    if (u.hostname === 'api.resend.com') {
      const b = JSON.parse(opt.body); calls.push({ k: 'mail', to: b.to[0], subject: b.subject, files: b.attachments.map(a => a.filename), html: b.html });
      return st.resend === 200 ? J({ id: 'm1' }) : new Response('the mail service is down', { status: st.resend });
    }
    if (u.pathname.startsWith('/storage/v1/object/reports/')) { calls.push({ k: 'store', path: u.pathname.replace('/storage/v1/object/reports/', '') }); return J({ Key: 'ok' }); }
    const table = u.pathname.replace('/rest/v1/', '');
    if (table === 'report_mail_requests') {
      if (st.noTable) return new Response(JSON.stringify({ code: 'PGRST205', message: 'Could not find the table' }), { status: 404 });
      if (method === 'GET') return J(st.requests.filter(r => r.state === 'queued').map(r => ({ id: r.id, sub: r.sub })));
      const id = (q.get('id') || '').replace(/^eq\./, ''), r = st.requests.find(x => x.id === id);
      if (!id) { calls.push({ k: 'sweep', state: q.get('state'), before: (q.get('requested_at') || '').replace(/^lt\./, ''), body }); return none(204); }
      if (q.get('state') === 'eq.queued') {
        const got = !!r && r.state === 'queued' && !st.takenElsewhere;
        calls.push({ k: 'claim', id, got, prefer: (opt.headers || {}).Prefer });
        if (got) { r.state = 'running'; return J([{ id }]); }
        return J([]);
      }
      calls.push({ k: 'mark', id, ...body }); Object.assign(r, body); return none(204);
    }
    if (table === 'report_mail_log') {
      if (method === 'GET') return J(st.log);
      calls.push({ k: 'log', ...body }); st.log.push({ ...body, sent_at: new Date().toISOString() }); return none(201);
    }
    if (table === 'games') {
      const [lo, hi] = q.getAll('tipoff_at').map(x => x.replace(/^(gte|lt)\./, ''));
      calls.push({ k: 'games', from: lo, to: hi });
      return J(st.games.filter(g => g.tipoff_at >= lo && g.tipoff_at < hi));
    }
    if (table === 'report_files') { calls.push({ k: 'file', ...body }); return none(201); }
    throw new Error('the test world has no ' + method + ' ' + url);
  };
  M.hooks.pdf = async (p, name) => { calls.push({ k: 'pdf', path: p, name }); return { filename: name + '.pdf', content: Buffer.from('pdf of ' + name).toString('base64') }; };
  return calls;
}
const want = (id, o = {}) => ({ id, state: 'queued', requested_at: '2026-10-07T09:55:00Z', sub: sub(o) });

console.log('\nthe mailer takes a request');
{
  const st = { requests: [want('R1')] };
  const calls = world(st);
  const failed = await quiet(() => M.requests(NOW));
  ok('one request, sent: nothing failed', failed === 0, failed);
  ok('in order: old requests given up, the request claimed, three reports built and kept, the email, the log, the request marked',
     calls.map(c => c.k).filter(k => k !== 'games').join(' ') === 'sweep claim pdf store file pdf store file pdf store file mail log log mark', calls.map(c => c.k).join(' '));
  const sweep = calls.find(c => c.k === 'sweep');
  ok('...a request still open after three hours is given up first', sweep.state === 'in.(queued,running)' && sweep.before === '2026-10-07T07:00:00.000Z' && sweep.body.state === 'failed' && /three hours/.test(sweep.body.detail), sweep);
  ok('...the claim asks for the row back, so a second run that has it is told', calls.find(c => c.k === 'claim').got === true && /return=representation/.test(calls.find(c => c.k === 'claim').prefer));
  const g = calls.find(c => c.k === 'games');
  ok('...the games asked for are next week\'s: Monday 12 October 00:00 BST to Monday 19 October 00:00', g.from === '2026-10-11T23:00:00.000Z' && g.to === '2026-10-18T23:00:00.000Z', g);
  const pdfs = calls.filter(c => c.k === 'pdf');
  ok('...a scouting report on each opponent that week (one game on the Sunday before and one on the Monday after are not in it), then the club\'s own',
     pdfs.map(p => p.path).join(' ') === `/epinoia/t/?t=P&tab=report /epinoia/t/?t=J&tab=report /epinoia/t/?t=${TEAM}&tab=report`, pdfs.map(p => p.path));
  const stored = calls.filter(c => c.k === 'store').map(c => c.path);
  ok('...kept for the dashboard under the Sunday\'s date, each file once', stored.length === 3 && stored.every(p => p.startsWith(SUB + '/2026-10-11/')) && stored[0].endsWith('/scouting-report-south-east-melbourne-phoenix.pdf'), stored);
  const files = calls.filter(c => c.k === 'file');
  ok('...as rows a Sunday would write (opp: <Sunday>:<club>, team: <Sunday>), so a rerun is the same row', files.map(f => f.kind + ' ' + f.ref).join(' | ') === 'opp 2026-10-11:P | opp 2026-10-11:J | team 2026-10-11' &&
     /^Week of Mon,? 12 Oct 2026 · Illawarra Hawks play them /.test(files[0].subtitle), files.map(f => [f.kind, f.ref, f.subtitle]));
  const mail = calls.find(c => c.k === 'mail');
  ok('...one email to the address with all three attached, the week ahead as it always reads',
     calls.filter(c => c.k === 'mail').length === 1 && mail.to === 'coach@example.com' && mail.files.length === 3 &&
     mail.subject === 'Your week ahead: scouting reports on South East Melbourne Phoenix and Tasmania JackJumpers, plus Illawarra Hawks’ team report' && /from 12 October/.test(mail.html), [mail.subject, mail.files]);
  const logs = calls.filter(c => c.k === 'log');
  ok('...logged as the Sunday before the week (and the club\'s own report as sent), the date the Sunday round looks for',
     logs.map(l => l.kind + ' ' + l.ref).join(' | ') === 'sunday 2026-10-11 | team 2026-10-11' && logs[0].detail === '2 opponent(s) + own', logs);
  const mark = calls.find(c => c.k === 'mark');
  ok('...the request says what went', mark.state === 'sent' && mark.detail === 'Sent the week of Mon 12 Oct: scouting reports on South East Melbourne Phoenix and Tasmania JackJumpers, plus the club’s own team report.' && !!mark.finished_at, mark);
  ok('...an insert answered with nothing in it (201, as PostgREST does) is not a failure', logs.length === 2 && files.length === 3);
  const again = world(st);
  await quiet(() => M.requests(NOW));
  ok('a second run finds nothing to take and sends nothing', again.every(c => c.k === 'sweep'), again.map(c => c.k));
}

console.log('\n...and the other ways a request ends');
{
  /* the club's own report went three days ago and no game is in the week: nothing to send, and not the Sunday's email */
  const st = { requests: [want('R2')], games: [], log: [{ sub_id: SUB, kind: 'team', ref: '2026-10-04', sent_at: new Date(Date.now() - 3 * 864e5).toISOString() }] };
  const calls = world(st);
  await quiet(() => M.requests(NOW));
  const mark = calls.find(c => c.k === 'mark');
  ok('no game that week and the team report not due: nothing is built or sent', !calls.some(c => ['pdf', 'mail', 'store', 'file'].includes(c.k)), calls.map(c => c.k));
  ok('...the request says so, and the Sunday is not logged (the fixtures may yet be announced, and Sunday morning looks again)',
     mark.state === 'nothing' && /^No games in the week of Mon 12 Oct and no team report due: nothing to send\.$/.test(mark.detail) && !calls.some(c => c.k === 'log'), [mark, calls.map(c => c.k)]);
}
{
  /* no game that week, but it is the club's fortnight: its own report alone, as on a Sunday */
  const st = { requests: [want('R3')], games: [] };
  const calls = world(st);
  await quiet(() => M.requests(NOW));
  const mark = calls.find(c => c.k === 'mark'), mail = calls.find(c => c.k === 'mail');
  ok('no game but the fortnight\'s own report due: it goes alone, as on a Sunday', mark.state === 'sent' && mark.detail === 'Sent the week of Mon 12 Oct: the club’s own team report.' &&
     mail.files.length === 1 && mail.subject === 'Illawarra Hawks’ fortnightly team report', [mark, mail && mail.subject]);
}
{
  const st = { requests: [want('R4')], resend: 500 };
  const calls = world(st);
  const failed = await quiet(() => M.requests(NOW));
  const mark = calls.find(c => c.k === 'mark');
  ok('the email service refusing: the request is failed with its words, the run counts it, and nothing is logged as sent',
     failed === 1 && mark.state === 'failed' && /resend 500/.test(mark.detail) && !calls.some(c => c.k === 'log'), [failed, mark]);
  ok('...the reports are kept for the dashboard all the same (kept before the email goes)', calls.filter(c => c.k === 'file').length === 3);
}
{
  const st = { requests: [want('R5', { active: false })] };
  const calls = world(st);
  await quiet(() => M.requests(NOW));
  const mark = calls.find(c => c.k === 'mark');
  ok('an address paused since it was asked for: nothing is sent, and the request says so', mark.state === 'nothing' && /paused/.test(mark.detail) && !calls.some(c => ['pdf', 'mail'].includes(c.k)), mark);
}
{
  const st = { requests: [want('R6')], takenElsewhere: true };
  const calls = world(st);
  await quiet(() => M.requests(NOW));
  ok('a request another run has already claimed is left to it: nothing built, sent or marked', !calls.some(c => ['pdf', 'mail', 'mark', 'log'].includes(c.k)) && calls.some(c => c.k === 'claim' && !c.got), calls.map(c => c.k));
}
{
  process.env.ONLY = 'someone@else.com';
  const st = { requests: [want('R7')] };
  const calls = world(st);
  await quiet(() => M.requests(NOW));
  delete process.env.ONLY;
  ok('ONLY (a run by hand for one address) leaves the other addresses\' requests alone', !calls.some(c => ['claim', 'pdf', 'mail', 'mark'].includes(c.k)), calls.map(c => c.k));
}
{
  const st = { requests: [want('R8'), want('R9', { id: '5b5b5b5b-0000-4000-8000-000000000002', email: 'second@example.com' })], resend: 500 };
  const calls = world(st);
  const failed = await quiet(() => M.requests(NOW));
  ok('one address failing does not stop the next: both are tried, both marked', failed === 2 && calls.filter(c => c.k === 'mark').map(c => c.id).join() === 'R8,R9', [failed, calls.filter(c => c.k === 'mark')]);
}
{
  const st = { requests: [], noTable: true };
  world(st);
  let said = null;
  await quiet(async () => { try { await M.requests(NOW); } catch (e) { said = e.message; } });
  ok('before 0226 is applied the table is away and the call says so', /404 on report_mail_requests/.test(said || ''), said);
  const src = read('scripts', 'report_mailer.mjs');
  ok('...which the run catches: the rounds go on without it, and that is not a failed run', /try \{ failed \+= await requests\(\); \} catch \(e\) \{ console\.warn\('send-now requests skipped:'/.test(src));
  ok('...the requests come before the rounds, so on a Sunday morning the request is already in the log when the Sunday round reads it',
     src.indexOf('failed += await requests()') < src.indexOf('await one(s, s.teams'));
  ok('...and the Sunday round still skips a Sunday that is in the log (a request\'s date is the Sunday\'s)', /if \(L\.wd !== 'Sun' \|\| L\.hour < 8 \|\| has\('sunday', L\.date\)\) return;/.test(src));
  ok('...it logs "nothing this week" for the Sunday itself, a request does not', /if \(!\(await sendWeek\(sub, team, tz, sent, W, L\.date\)\)\) await log\(sub, 'sunday', L\.date, 'nothing this week'\);/.test(src) &&
     !/sendWeek[^\n]*\n[^\n]*log\(s, 'sunday'/.test(src));
}

console.log('\nthe request, as the line the console shows');
{
  const W = M.nextWeek(LON, NOW);
  ok('sent: the week, the opponents, and the club\'s own report when it went', M.requestLine(W, LON, { names: ['A', 'B', 'C'], own: true }) === 'Sent the week of Mon 12 Oct: scouting reports on A, B and C, plus the club’s own team report.' &&
     M.requestLine(W, LON, { names: ['A'], own: false }) === 'Sent the week of Mon 12 Oct: scouting report on A.');
  ok('nothing to send says why', M.requestLine(W, LON, null) === 'No games in the week of Mon 12 Oct and no team report due: nothing to send.');
}

/* ---------------------------------------------------------------- the database --- */
console.log('\nthe database');
{
  let PGlite;
  try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
  catch { console.log('  SKIP  the database part: @electric-sql/pglite is not installed'); PGlite = null; }
  const M26 = read('supabase', 'migrations', '0226_report_send_now.sql');
  if (PGlite) {
    const db = new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
      create table public.teams (id uuid primary key, name text);
      create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.padmin', true), 'no') = 'yes' $$;
      grant usage on schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated, service_role;
      grant select on public.teams to anon, authenticated;
    `);
    let applied = true;
    try { for (let i = 0; i < 2; i++) { await db.exec(read('supabase', 'migrations', '0221_report_mail.sql')); await db.exec(M26); } } catch (e) { applied = e.message; }
    ok('0226 applies on 0221, twice', applied === true, applied);
    const ADMIN = '00000000-0000-0000-0000-0000000000a1', FAN = '00000000-0000-0000-0000-0000000000f1';
    const S1 = '00000000-0000-0000-0000-0000000000b1', S2 = '00000000-0000-0000-0000-0000000000b2', S3 = '00000000-0000-0000-0000-0000000000b3';
    const T1 = '00000000-0000-0000-0000-0000000000c1';
    await db.exec(`
      insert into auth.users values ('${ADMIN}'), ('${FAN}');
      insert into public.teams values ('${T1}', 'Illawarra Hawks');
      insert into public.report_mail_subs (id, email, team_id, active) values ('${S1}', 'a@example.com', '${T1}', true), ('${S2}', 'b@example.com', '${T1}', true), ('${S3}', 'c@example.com', '${T1}', false);
    `);
    const as = async (uid, sql, o = {}) => {
      await db.exec(`reset role; set test.uid = '${uid || ''}'; set test.padmin = '${o.padmin || 'no'}';` + (o.role ? ` set role ${o.role};` : ' set role authenticated;'));
      try { return (await db.query(sql)).rows; } finally { await db.exec('reset role'); }
    };
    const asAdmin = sql => as(ADMIN, sql, { padmin: 'yes' });
    const err = async (uid, sql, o) => { try { await as(uid, sql, o); return null; } catch (e) { return e.message; } };
    const n = async sql => (await asAdmin(sql))[0].n;

    ok('asking for everyone queues the active addresses, not the paused one', (await asAdmin(`select public.request_report_send(null) n`))[0].n === 2 &&
       (await asAdmin(`select string_agg(sub_id::text, ',' order by sub_id) s from public.report_mail_requests`))[0].s === S1 + ',' + S2);
    ok('...asking again while they are on their way queues nothing more (pressing twice sends once)', (await asAdmin(`select public.request_report_send(null) n`))[0].n === 0 &&
       await n(`select count(*)::int n from public.report_mail_requests`) === 2);
    ok('...a request is queued, with who asked and when', (await asAdmin(`select state, requested_by, requested_at is not null as at, started_at, finished_at, dispatched_at from public.report_mail_requests limit 1`))
       .every(r => r.state === 'queued' && r.at && r.started_at === null && r.finished_at === null && r.dispatched_at === null));
    await db.exec(`update public.report_mail_requests set state = 'sent', finished_at = now(), detail = 'Sent' where sub_id = '${S1}'`);
    ok('one address, once its last request is done: queued again; another with one open is not', (await asAdmin(`select public.request_report_send('${S1}') n`))[0].n === 1 &&
       (await asAdmin(`select public.request_report_send('${S2}') n`))[0].n === 0);
    ok('a paused address is not queued', (await asAdmin(`select public.request_report_send('${S3}') n`))[0].n === 0);
    ok('a request that has been open more than three hours is given up when the next is asked for, and the address is free again', await (async () => {
      await db.exec(`update public.report_mail_requests set state = 'sent', finished_at = now() where sub_id = '${S2}'`);
      await db.exec(`insert into public.report_mail_requests (sub_id, state, requested_at) values ('${S2}', 'running', now() - interval '4 hours')`);
      const q = (await asAdmin(`select public.request_report_send('${S2}') n`))[0].n;
      const old = await asAdmin(`select state, detail from public.report_mail_requests where sub_id = '${S2}' and requested_at < now() - interval '3 hours'`);
      return q === 1 && old.length === 1 && old[0].state === 'failed' && /three hours/.test(old[0].detail) && await n(`select count(*)::int n from public.report_mail_requests where sub_id = '${S2}' and state in ('queued','running')`) === 1;
    })());
    ok('only platform administrators may ask', /platform administrators only/.test(await err(FAN, `select public.request_report_send(null)`) || ''));
    ok('...a signed-out reader cannot call it at all; a signed-in one may (the function checks who)',
       (await asAdmin(`select has_function_privilege('anon', 'public.request_report_send(uuid)', 'execute') a, has_function_privilege('authenticated', 'public.request_report_send(uuid)', 'execute') b`))
         .every(r => r.a === false && r.b === true));
    ok('the requests are read by platform administrators only', (await as(FAN, `select count(*)::int n from public.report_mail_requests`))[0].n === 0 &&
       await n(`select count(*)::int n from public.report_mail_requests`) >= 3);
    ok('...and written by the service role alone: a signed-in reader cannot change one', /permission denied/.test(await err(ADMIN, `update public.report_mail_requests set state = 'sent'`, { padmin: 'yes' }) || ''));
    ok('...the mailer\'s role may', (await as(null, `update public.report_mail_requests set detail = 'x' where sub_id = '${S1}' returning 1 as n`, { role: 'service_role' })).length >= 1);
    const dup = async sql => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };
    ok('the database keeps one open request an address, whoever writes it', /duplicate key/.test(await dup(`insert into public.report_mail_requests (sub_id) values ('${S1}')`) || ''));
    ok('...a state is one of five, and a detail stays short', /check constraint/.test(await dup(`update public.report_mail_requests set state = 'done' where sub_id = '${S1}'`) || '') &&
       /check constraint/.test(await dup(`update public.report_mail_requests set detail = '${'x'.repeat(401)}' where sub_id = '${S1}'`) || ''));
    await db.exec(`delete from public.report_mail_subs where id = '${S1}'`);
    ok('removing an address removes its requests', await n(`select count(*)::int n from public.report_mail_requests where sub_id = '${S1}'`) === 0);
  }
}

console.log('\nthe worker is started when the button is pressed');
{
  const FN = read('supabase', 'functions', 'console-kick', 'index.ts');
  ok('console-kick starts the mailer (report-mail.yml) for a queued request, and the other workers as before',
     /\{ workflow: 'report-mail\.yml', tables: \['report_mail_requests'\] \}/.test(FN) && /\{ workflow: 'console-jobs\.yml', tables: \['season_backfills', 'league_resets'\] \}/.test(FN) &&
     /actions\/workflows\/\$\{job\.workflow\}\/dispatches/.test(FN));
  ok('...each worker is judged on its own queues: nothing queued for it, nothing started; started in the last three minutes, not again',
     /for \(const job of JOBS\)/.test(FN) && /if \(!seen\.length\) continue;/.test(FN) && /const AGAIN_MS = 3 \* 60 \* 1000;/.test(FN) && /why = 'already started'/.test(FN));
  ok('...what it answers is as it was: started with the time, or why not', /return json\(\{ started: true, at \}\);/.test(FN) && /return json\(\{ started: false, why, \.\.\.\(again \? \{ at: again \} : \{\}\) \}, status\);/.test(FN) &&
     /why = 'nothing queued'/.test(FN) && /why = 'GitHub answered ' \+ gh\.status; status = 502/.test(FN));
  ok('...and a platform administrator is the only one who can see a request, so the only one who can start the mailer', /report_mail_requests_admin on public\.report_mail_requests for select using \(public\.is_platform_admin\(\)\)/.test(read('supabase', 'migrations', '0226_report_send_now.sql')));
  /* the function itself, run: its source with the types stripped, on stand-ins for Deno, Supabase and GitHub */
  const nodeModule = await import('node:module');
  if (typeof nodeModule.stripTypeScriptTypes !== 'function') console.log('  SKIP  running console-kick: this Node cannot strip types (22.13 or newer can)');
  else {
    const js = nodeModule.stripTypeScriptTypes(FN.replace(/^import \{ createClient \} from 'jsr:@supabase\/supabase-js@2';/m, 'const createClient = (...a) => globalThis.__createClient(...a);'));
    let seq = 0;
    const load = async env => {
      let handler = null;
      globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
      await import('data:text/javascript;base64,' + Buffer.from(js + '\n//' + (++seq)).toString('base64'));
      return handler;
    };
    const dispatched = [], stamped = [], realFetch = globalThis.fetch;
    const world = ({ queued = {}, gh = 204 }) => {
      dispatched.length = 0; stamped.length = 0;
      globalThis.__createClient = () => ({ from: table => ({
        select: () => ({ eq: async () => ({ data: queued[table] || null, error: queued[table] ? null : { message: 'no such table' } }) }),
        update: v => ({ in: (c, ids) => ({ eq: async () => { stamped.push(table + ':' + ids.join('+')); return { error: null }; } }) }) }) });
      globalThis.fetch = async url => { dispatched.push(String(url).replace(/.*workflows\//, '').replace('/dispatches', '')); return new Response(null, { status: gh }); };
    };
    const ENV = { SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's', GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r' };
    const ask = async h => { const r = await h(new Request('http://f/', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer u' } })); return { status: r.status, ...(await r.json()) }; };
    const kick = await load(ENV);
    let a;
    world({ queued: { report_mail_requests: [{ id: 'q1' }] } }); a = await ask(kick);
    ok('a queued report request starts report-mail.yml, and only that, noting when on the request', a.started === true && dispatched.join() === 'report-mail.yml' && stamped.join() === 'report_mail_requests:q1', [a, dispatched, stamped]);
    world({ queued: { season_backfills: [{ id: 'b1' }], report_mail_requests: [] } }); a = await ask(kick);
    ok('...a queued backfill starts console-jobs.yml as before, and not the mailer', a.started === true && dispatched.join() === 'console-jobs.yml' && stamped.join() === 'season_backfills:b1', [a, dispatched, stamped]);
    world({ queued: { season_backfills: [{ id: 'b1' }], league_resets: [{ id: 'l1' }], report_mail_requests: [{ id: 'q1' }, { id: 'q2' }] } }); a = await ask(kick);
    ok('...both together start both, each noted on its own rows', a.started === true && dispatched.join() === 'console-jobs.yml,report-mail.yml' &&
       stamped.join() === 'season_backfills:b1,league_resets:l1,report_mail_requests:q1+q2', [a, dispatched, stamped]);
    world({ queued: { season_backfills: [], league_resets: [], report_mail_requests: [] } }); a = await ask(kick);
    ok('nothing queued (or nothing the caller may see), nothing started', a.started === false && a.why === 'nothing queued' && !dispatched.length, [a, dispatched]);
    const at = new Date(Date.now() - 60000).toISOString();
    world({ queued: { report_mail_requests: [{ id: 'q1', dispatched_at: at }] } }); a = await ask(kick);
    ok('a request started a minute ago is not started again, and the answer says when', a.started === false && a.why === 'already started' && a.at === at && !dispatched.length, [a, dispatched]);
    world({ queued: { season_backfills: [{ id: 'b1' }], report_mail_requests: [{ id: 'q1', dispatched_at: at }] } }); a = await ask(kick);
    ok('...each worker is judged on its own: a fresh backfill starts while the mailer waits', a.started === true && dispatched.join() === 'console-jobs.yml' && stamped.join() === 'season_backfills:b1', [a, dispatched, stamped]);
    world({ queued: { report_mail_requests: [{ id: 'q1' }] }, gh: 422 }); a = await ask(kick);
    ok('GitHub refusing is said, and nothing is noted as started', a.started === false && a.why === 'GitHub answered 422' && a.status === 502 && !stamped.length, [a, stamped]);
    world({ queued: { report_mail_requests: null } }); a = await ask(kick);
    ok('before 0226 is applied (no such table) the function carries on: nothing queued', a.started === false && a.why === 'nothing queued', a);
    const bare = await load({ ...ENV, GITHUB_DISPATCH_TOKEN: '' });
    world({ queued: { report_mail_requests: [{ id: 'q1' }] } }); a = await ask(bare);
    ok('without its GitHub token it says it is not set up, and tries nothing', a.started === false && a.why === 'not set up' && !dispatched.length, [a, dispatched]);
    globalThis.fetch = realFetch; delete globalThis.Deno; delete globalThis.__createClient;
  }
  const yml = read('.github', 'workflows', 'report-mail.yml');
  ok('the mailer\'s workflow can be started by hand, which is how it is started (and no input is needed)', /workflow_dispatch:/.test(yml) && !/required: true/.test(yml));
}

console.log('\nthe console');
{
  const js = read('epinoia', 'admin', 'platform', 'platform.js'), html = read('epinoia', 'admin', 'platform', 'index.html');
  ok('each active address has "send next week\'s reports now", and with more than one there is one for everyone above the list', /'send next week’s reports now'/.test(js) && /'send everyone next week’s reports now'/.test(js) && /if \(live\.length > 1\)/.test(js) && /if \(x\.active\) \{/.test(js));
  ok('...it says what will go before it asks: the week in their time, what is in it, that it counts as the Sunday\'s, how long it takes (and asks again before everyone)',
     /confirm\('Send ' \+ x\.email \+ ' next week’s reports now\?[\s\S]*weekWords\(x\.tz\)[\s\S]*That counts as that Sunday’s email, so Sunday morning will not send it again\. It takes a few minutes\./.test(js) &&
     /confirm\('Send next week’s reports now to all ' \+ live\.length \+ ' active addresses\?/.test(js));
  ok('...it queues through request_report_send, then starts the mailer (console-kick), and says which happened',
     /rpc\('request_report_send', \{ p_sub: sub \}\)/.test(js) && /window\.EpinoiaJobBar\.kick\(sb\)/.test(js) && /the mailer has been started: the reports go out in a few minutes/.test(js) &&
     /next half-hourly run, within 30 minutes/.test(js) && /Already on its way, or paused: nothing new was queued\./.test(js));
  ok('...each address shows where its request stands (queued, sending, sent, nothing to send, failed) and the button waits while one is open',
     /from\('report_mail_requests'\)\.select\('sub_id,state,requested_at,dispatched_at,finished_at,detail'\)/.test(js) && /'Queued: '/.test(js) && /'Sending now: /.test(js) &&
     /'Failed '/.test(js) && /\(r\.detail \|\| \(r\.state === 'sent' \? 'Sent\.' : 'Nothing was sent\.'\)\)/.test(js) && /now\.disabled = mailOpen\(ask\);/.test(js));
  ok('...read again every 15 seconds while a request is open, and not at all once none is (one timer, cleared at each draw)',
     /\.some\(mailOpen\)\) mailTimer = setTimeout\(/.test(js) && /clearTimeout\(mailTimer\);/.test(js) && /, 15000\)/.test(js));
  ok('...a day-old outcome is not shown (the address\'s "last sent" is the record)', /> 864e5\) return '';/.test(js));
  ok('the page says it, beside the rest of Reports by email', /Send next week&rsquo;s reports now/.test(html) && /does not send it again \(0226\)/.test(html));
  ok('...and the console already loads the button that starts workers (jobbar.js) before platform.js', html.indexOf('../jobbar.js') > 0 && html.indexOf('../jobbar.js') < html.indexOf('platform.js?v='));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
