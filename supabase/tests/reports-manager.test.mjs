// THE REPORTS MANAGER AND THE PLAYERS' REPORTS (2026-10-04; epinoia/admin/platform/reports-manager.js, scripts/report_mailer.mjs,
// 0228). What is held here, with no database and no mail:
//   * a Synergy file's players are matched to the CLUBS THE REPORTS ARE ON, never the whole site: every club an active
//     address is sent reports of, and every club those play in the next two weeks; a paused address's clubs and a game
//     further off are not in it; a club can be added by hand; a player on two of them is one player; the suggestion is
//     made from those squads alone (the same name at a club outside them is not taken);
//   * the console opens the manager (Accounts > Reports by email), and the manager's PRIME REPORT opens a report primed;
//   * the ZIP the mailer writes is a ZIP (read back here: names, CRC, the files whole, deflated only when that is smaller);
//   * whose reports go in it: who played for the club this season at 10 minutes a game or more, the released left out;
//   * the reply: under the Sunday email (Re: its subject, In-Reply-To / References its Message-ID), one ZIP a club whose
//     report went, each player's report drawn once, logged as 'players'; an address that turned it off, or a database
//     before 0228, gets the Sunday email alone;
//   * every report the mailer draws is primed with the Synergy numbers the admins kept, and RAPM it worked out is kept.
//
//   node supabase/tests/reports-manager.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 500))); } };
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SERVICE_KEY = 'service-key'; process.env.RESEND_API_KEY = 're_test';
process.env.REPORTS_FROM = 'Epinoia <reports@prophesyscouting.co.uk>';
delete process.env.ONLY; delete process.env.DRY;
const M = await import(pathToFileURL(path.join(ROOT, 'scripts', 'report_mailer.mjs')).href);
const S = (await import(pathToFileURL(path.join(ROOT, 'epinoia', 'synergy.js')).href)).default;

/* ---------------------------------------------------------------- the manager: the clubs the reports are on --- */
console.log('\nthe clubs a Synergy file is matched to');
const DAY = 864e5, now = Date.now(), at = d => new Date(now + d * DAY).toISOString();
const T = {
  report_mail_subs: [
    { id: 's1', email: 'coach@club.test', name: 'Sam', tz: 'Europe/London', active: true, team_id: 'tA', teams: { id: 'tA', name: 'Alpha Riders' } },
    { id: 's2', email: 'coach@club.test', name: 'Sam', tz: 'Europe/London', active: true, team_id: 'tB', teams: { id: 'tB', name: 'Beta Lions' } },
    { id: 's4', email: 'gm@club.test', name: null, tz: 'Europe/London', active: true, team_id: 'tA', teams: { id: 'tA', name: 'Alpha Riders' } },
    { id: 's3', email: 'paused@club.test', name: null, tz: 'Europe/London', active: false, team_id: 'tC', teams: { id: 'tC', name: 'Gamma Kings' } }],
  games: [
    { home_team_id: 'tA', away_team_id: 'tO', status: 'scheduled', tipoff_at: at(3), home: { name: 'Alpha Riders' }, away: { name: 'Omega Flyers' } },
    { home_team_id: 'tP', away_team_id: 'tB', status: 'scheduled', tipoff_at: at(9), home: { name: 'Pi Giants' }, away: { name: 'Beta Lions' } },
    { home_team_id: 'tA', away_team_id: 'tB', status: 'scheduled', tipoff_at: at(5), home: { name: 'Alpha Riders' }, away: { name: 'Beta Lions' } },
    { home_team_id: 'tA', away_team_id: 'tZ', status: 'scheduled', tipoff_at: at(30), home: { name: 'Alpha Riders' }, away: { name: 'Zeta Far' } },
    { home_team_id: 'tA', away_team_id: 'tF', status: 'final', tipoff_at: at(-2), home: { name: 'Alpha Riders' }, away: { name: 'Phi Past' } },
    { home_team_id: 'tC', away_team_id: 'tQ', status: 'scheduled', tipoff_at: at(2), home: { name: 'Gamma Kings' }, away: { name: 'Quo Paused' } }],
  roster_entries: [
    { team_id: 'tA', active: true, players: { id: 'pA1', first_name: 'Jaylon', last_name: 'White' } },
    { team_id: 'tO', active: true, players: { id: 'pO1', first_name: 'Sam', last_name: 'Sample' } },
    { team_id: 'tO', active: true, players: { id: 'pA1', first_name: 'Jaylon', last_name: 'White' } },
    { team_id: 'tP', active: true, players: { id: 'pP1', first_name: 'Bernard', last_name: 'Pelote' } },
    { team_id: 'tZ', active: true, players: { id: 'pZ1', first_name: 'Sam', last_name: 'Sample' } },
    { team_id: 'tQ', active: true, players: { id: 'pQ1', first_name: 'Quinn', last_name: 'Paused' } },
    { team_id: 'tE', active: true, players: { id: 'pE1', first_name: 'Extra', last_name: 'Man' } },
    { team_id: 'tO', active: false, players: { id: 'pO9', first_name: 'Gone', last_name: 'Before' } }]
};
const asked = [];
function from(table) {
  const f = [];
  const api = {
    select() { return api; }, order() { return api; }, limit() { return api; },
    eq(k, v) { f.push(r => r[k] === v); return api; },
    in(k, v) { asked.push([table, 'in', k, v]); f.push(r => v.includes(r[k])); return api; },
    gte(k, v) { f.push(r => r[k] >= v); return api; }, lt(k, v) { f.push(r => r[k] < v); return api; },
    or(s) { asked.push([table, 'or', s]); const ids = /home_team_id\.in\.\(([^)]*)\)/.exec(s)[1].split(','); f.push(r => ids.includes(r.home_team_id) || ids.includes(r.away_team_id)); return api; },
    then(res, rej) { return Promise.resolve({ data: (T[table] || []).filter(r => f.every(fn => fn(r))), error: null }).then(res, rej); }
  };
  return api;
}
const win = { EpinoiaSynergy: S };
new Function('window', 'document', read('epinoia', 'admin', 'platform', 'reports-manager.js'))(win, undefined);
const RM = win.EpinoiaReportsManager;
ok('the manager loads on its own (it touches the page only when it is opened)', RM && typeof RM.open === 'function' && RM._t && typeof RM._t.reportedClubs === 'function');
RM._t.use({ from });
{
  const { clubs, people } = await RM._t.reportedClubs();
  const ids = [...clubs.keys()].sort();
  ok('each club an active address is sent reports of, and each club those play in the next two weeks', ids.join(' ') === 'tA tB tO tP', ids);
  ok('...a paused address\'s club and its opponent are not in it, nor a club met in 30 days, nor one already played', !clubs.has('tC') && !clubs.has('tQ') && !clubs.has('tZ') && !clubs.has('tF'));
  ok('...each says why: whom its reports go to, or whom it plays and when', clubs.get('tA').own && clubs.get('tA').emails.join() === 'coach@club.test,gm@club.test' &&
     !clubs.get('tO').own && /^Alpha Riders /.test(clubs.get('tO').plays[0]) && /^Beta Lions /.test(clubs.get('tP').plays[0]), [clubs.get('tA'), clubs.get('tO')]);
  ok('...two subscribed clubs that meet each other are both its own, not each other\'s opponents', clubs.get('tB').own && !clubs.get('tB').plays.length);
  const games = asked.find(a => a[0] === 'games' && a[1] === 'or');
  ok('...the schedule read is of those clubs\' games', /home_team_id\.in\.\(tA,tB\)/.test(games[2]) && /away_team_id\.in\.\(tA,tB\)/.test(games[2]), games);
  const st = asked.find(a => a[0] === 'games' && a[1] === 'in' && a[2] === 'status');
  ok('...the games still to be played', st && st[3].join() === 'scheduled,live', st);
  ok('their squads, a player once however many of them list him (with each of them), the inactive left out', people.map(p => p.id).sort().join(' ') === 'pA1 pO1 pP1' &&
     people.find(p => p.id === 'pA1').club === 'Alpha Riders' && people.find(p => p.id === 'pA1').teams.join() === 'tA,tO', people);
  const x = { p: { name: 'Sam Sample' } };
  RM._t.suggest(x, people);
  ok('a file\'s player is suggested from those squads: the Sam Sample of the opponent, not the one of a club met in 30 days', x.pick && x.pick.id === 'pO1' && /same name, Omega Flyers/.test(x.hint), x);
  const y = { p: { name: 'Extra Man' } };
  RM._t.suggest(y, people);
  ok('...a player not in them is not matched, and the manager says to pick him or add his club', !y.pick && /not in these clubs/.test(y.hint), y);
  RM._t.EXTRA.set('tE', { id: 'tE', name: 'Epsilon Extra', own: false, emails: [], plays: [] });
  const more = await RM._t.reportedClubs();
  RM._t.suggest(y, more.people);
  ok('a club added by hand joins them, and its players are then suggested', more.clubs.has('tE') && y.pick && y.pick.id === 'pE1', [...more.clubs.keys()]);
  const z = { p: { name: 'J. White' } };
  RM._t.suggest(z, people);
  ok('...a surname and first initial that is one player of them is suggested, to check', z.pick && z.pick.id === 'pA1' && /check it/.test(z.hint), z);

  /* A CLUB'S OWN FILES, AS MANY AS ARE CHOSEN: matched to its squad alone */
  const HEAD = 'Player,Player ID,Seasons scraped,Side,Play Type,Sub 1,Sub 2,Sub 3,Sub 4,Seasons with data,POSS,%TIME,%TIME RANK,PTS,PPP,PPP RANK,PPP RATING,FG MADE,FG ATT,EFG%,TO%,2 FG MADE,2 FG ATT,2 FG%,3 FG MADE,3FG ATT,3 FG%,FTA/FGA';
  const csv = (...who) => [HEAD].concat(...who.map(([n, id]) => [
    [n, id, '"2026-2027 Somewhere - International"', 'offense', 'Spot Up', '', '', '', '', 1, 50, '', '', 50, '1.000', '', '', 20, 45, '', 5, 12, 25, '', 8, 20, '', '0.20'].join(','),
    [n, id, '"2026-2027 Somewhere - International"', 'offense', 'Spot Up', 'Drives Left', '', '', '', 1, 10, '', '', 11, '1.100', '', '', 5, 9, '', 10, 5, 8, '', 0, 1, '', '0.20'].join(',')])).join('\n');
  const file = (name, text) => ({ name, text: async () => text });
  RM._t.PENDING.length = 0;
  const n = await RM._t.readFiles([file('synergy_playtypes_Sam_Sample_accumulated.csv', csv(['Sam Sample', 's1'])), file('two.csv', csv(['Jaylon White', 'j1'], ['Bernard Pelote', 'b1'])), file('empty.csv', HEAD)], people, { id: 'tO', name: 'Omega Flyers' });
  const P = RM._t.PENDING;
  ok('a club\'s own files, several at once: every player of every file read (one a file, or more), an empty file passed over', n === 3 && P.length === 3 && P.every(x => x.club === 'tO'), P.map(x => [x.p.name, x.file]));
  ok('...each matched to that club\'s squad alone: its Sam Sample, and its Jaylon White (listed by two of the clubs, one player)', P[0].pick && P[0].pick.id === 'pO1' && P[1].pick && P[1].pick.id === 'pA1', P.map(x => x.pick && x.pick.id));
  ok('...a player not in it is not taken from another club: picked by hand', !P[2].pick && /not in Omega Flyers\u2019 squad: pick him/.test(P[2].hint), P[2].hint);
  RM._t.PENDING.length = 0;
  await RM._t.readFiles([file('a.csv', csv(['Sam Sample', 's1']))], people, { id: 'tA', name: 'Alpha Riders' });
  ok('...the same name filed under another club is not matched to the first club\'s player', !RM._t.PENDING[0].pick && /Alpha Riders/.test(RM._t.PENDING[0].hint), RM._t.PENDING[0]);
  RM._t.PENDING.length = 0;
  await RM._t.readFiles([file('a.csv', csv(['Sam Sample', 's1'])), file('b.csv', csv(['Bernard Pelote', 'b1']))], people, null);
  ok('the drop box for all the clubs takes several files too, each player matched among all their squads', RM._t.PENDING.length === 2 && RM._t.PENDING[0].pick.id === 'pO1' && RM._t.PENDING[1].pick.id === 'pP1', RM._t.PENDING.map(x => x.pick && x.pick.id));
  RM._t.PENDING.length = 0;
}
{
  const src = read('epinoia', 'admin', 'platform', 'reports-manager.js');
  ok('the manager never searches the whole site for a match (no site_search)', !/site_search|rpc\(/.test(src));
  ok('every file input takes any number of CSVs at once: the manager\'s (each club\'s and the drop box) and the report tab\'s',
     /inp\.type = 'file'; inp\.accept = '\.csv,text\/csv'; inp\.multiple = true;/.test(src) && (src.match(/filesButton\(/g) || []).length >= 3 &&
     /createTextNode\('Add Synergy CSVs'\)/.test(read('epinoia', 'report.js')) && /inp\.type = 'file'; inp\.accept = '\.csv,text\/csv'; inp\.multiple = true; inp\.hidden = true;/.test(read('epinoia', 'report.js')));
  ok('...a match by hand is typed or picked from those squads', /people\.filter\(z => S\.normName\(z\.name\)\.includes\(q\)\)/.test(src) && /pick from a club\\u2019s squad|pick from a club’s squad/.test(src));
  ok('...kept one a player (a new file replaces the old), the numbers only', /from\('synergy_profiles'\)\.upsert\(\{ player_id: x\.pick\.id, profile: S\.pack\(S\.profile\(x\.p\)\)/.test(src) && /onConflict: 'player_id'/.test(src));
  ok('PRIME REPORT opens the club\'s or the player\'s report primed (report.js ?prime=1)', /t\/\?t=' \+ encodeURIComponent\(r\.team_id\) \+ '&tab=report&prime=1'/.test(src) &&
     /t\/\?t=' \+ encodeURIComponent\(c\.id\) \+ '&tab=report&prime=1'/.test(src) && /p\/\?p=' \+ encodeURIComponent\(r\.player_id\) \+ '&tab=report&prime=1'/.test(src));
  ok('an address with all its clubs: one club or several added at once, another added to it, the ZIP switched for the address',
     /\[\.\.\.picked\.keys\(\)\]\.map\(team_id => \(\{ email: e, team_id/.test(src) && /onConflict: 'email,team_id'/.test(src) && /update\(\{ player_zip: cb\.checked \}\)\.in\('id', list\.map\(r => r\.id\)\)/.test(src));
  const html = read('epinoia', 'admin', 'platform', 'index.html'), js = read('epinoia', 'admin', 'platform', 'platform.js');
  ok('the console opens it from Reports by email, with the Synergy reader on the page', /id="mailManage"/.test(html) && /<script src="\.\.\/\.\.\/synergy\.js\?v=\d+" defer><\/script>/.test(html) &&
     /<script src="reports-manager\.js\?v=\d+" defer><\/script>/.test(html) && /EpinoiaReportsManager\.open\(sb, \{ say, oops, sendNow, sendLine, reload: loadMail \}\)/.test(js));
}

/* ---------------------------------------------------------------- the ZIP --- */
console.log('\nthe ZIP');
function unzip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(eocd + 10), out = [];
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < n; i++) {
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), loc = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8'), start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    const raw = buf.slice(start, start + csize), data = method === 8 ? inflateRawSync(raw) : raw;
    out.push({ name, method, data, whole: buf.readUInt32LE(loc) === 0x04034b50 && M.crc32(data) === crc && data.length === usize && buf.readUInt32LE(loc + 14) === crc });
    p += 46 + nlen + elen + clen;
  }
  return { n, out };
}
{
  ok('CRC-32 is the standard one (the check value of "123456789")', M.crc32(Buffer.from('123456789')) === 0xcbf43926);
  const text = Buffer.from('rim mid three '.repeat(400)), noise = Buffer.alloc(4000);
  let s = 7; for (let i = 0; i < noise.length; i++) { s = (s * 1103515245 + 12345) >>> 0; noise[i] = s >>> 24; }
  const z = M.zipOf([{ name: 'player-report-sam-sample.pdf', data: text }, { name: 'player-report-ja-white.pdf', data: noise }, { name: 'café.pdf', data: Buffer.from('x') }], new Date(2026, 9, 4, 9, 30, 12));
  const u = unzip(z);
  ok('three files in, three out, in order, whole (CRC and size), the names as given (UTF-8)', u.n === 3 && u.out.map(f => f.name).join('|') === 'player-report-sam-sample.pdf|player-report-ja-white.pdf|café.pdf' &&
     u.out.every(f => f.whole) && u.out[0].data.equals(text) && u.out[1].data.equals(noise), u.out.map(f => [f.name, f.method, f.whole]));
  ok('...deflated when that is smaller, stored when it is not (a PDF\'s pages are compressed already)', u.out[0].method === 8 && u.out[1].method === 0 && z.length < text.length + noise.length);
  ok('...the time it was made, as a ZIP keeps it', z.readUInt16LE(12) === (((2026 - 1980) << 9) | (10 << 5) | 4) && z.readUInt16LE(10) === ((9 << 11) | (30 << 5) | 6));
}

/* ---------------------------------------------------------------- whose reports go in --- */
console.log('\nwhose reports go in');
{
  const m = x => x * 60000;
  const rows = [
    { pid: 'a', team: 'T', min: m(30) }, { pid: 'a', team: 'T', min: m(28) },
    { pid: 'b', team: 'T', min: m(9) }, { pid: 'b', team: 'T', min: m(10.5) },           // 9.75 a game
    { pid: 'c', team: 'T', min: m(25) },                                                   // released
    { pid: 'd', team: 'T', min: 0 }, { pid: 'd', team: 'T', min: m(12) },                  // a DNP does not count as a game
    { pid: 'e', team: 'X', min: m(40) },                                                   // the other side of the game
    { pid: 'f', team: 'T', min: m(10) }];                                                  // exactly ten
  const got = M.zipPlayers(rows, 'T', new Set(['c']));
  ok('everyone who played for the club at 10 minutes a game or more, the most minutes first', got.map(p => p.id).join(' ') === 'a d f' && got[0].mpg === 29 && got[1].games === 1, got);
  ok('...under 10 a game left out (9.75), the released left out, the other side\'s players left out', !got.some(p => ['b', 'c', 'e'].includes(p.id)));
  ok('...the threshold is 10', M.MIN_MPG === 10);
}

/* ---------------------------------------------------------------- the reply --- */
console.log('\nthe reply with the players\' reports');
const LON = 'Europe/London', SUB = '5b5b5b5b-0000-4000-8000-000000000001', TEAM = '7e7e7e7e-0000-4000-8000-000000000001';
const club = { id: TEAM, name: 'Illawarra Hawks', colour: '#e01837', leagues: { timezone: LON } };
const sub = (o = {}) => ({ id: SUB, email: 'coach@example.com', name: 'Sam', tz: LON, created_at: '2026-09-01T00:00:00Z', active: true, team_id: TEAM, teams: club, ...o });
const G = (id, h, a, hn, an, t) => ({ id, home_team_id: h, away_team_id: a, home: { name: hn }, away: { name: an }, tipoff_at: t, venue: 'The Arena' });
const WEEK = [G('w1', 'P', TEAM, 'South East Melbourne Phoenix', 'Illawarra Hawks', '2026-10-13T18:00:00Z'), G('w2', TEAM, 'J', 'Illawarra Hawks', 'Tasmania JackJumpers', '2026-10-18T14:00:00Z')];
const FINALS = [{ id: 'f1', home_team_id: 'P', away_team_id: 'X' }, { id: 'f2', home_team_id: 'Y', away_team_id: 'P' }, { id: 'f3', home_team_id: 'J', away_team_id: TEAM }, { id: 'f4', home_team_id: TEAM, away_team_id: 'Z' }];
const min = x => x * 60000;
const PGS = [
  { game_id: 'f1', player_uuid: 'pP1', team_idx: 0, min: min(31) }, { game_id: 'f2', player_uuid: 'pP1', team_idx: 1, min: min(29) },
  { game_id: 'f1', player_uuid: 'pP2', team_idx: 0, min: min(8) }, { game_id: 'f2', player_uuid: 'pP2', team_idx: 1, min: min(7) },
  { game_id: 'f1', player_uuid: 'pP3', team_idx: 0, min: min(27) },
  { game_id: 'f1', player_uuid: 'pP4', team_idx: 0, min: 0 }, { game_id: 'f2', player_uuid: 'pP4', team_idx: 1, min: min(12) },
  { game_id: 'f1', player_uuid: 'pX1', team_idx: 1, min: min(36) },
  { game_id: 'f3', player_uuid: 'pJ1', team_idx: 0, min: min(25) }, { game_id: 'f3', player_uuid: 'pT1', team_idx: 1, min: min(22) },
  { game_id: 'f4', player_uuid: 'pT1', team_idx: 0, min: min(18) }, { game_id: 'f4', player_uuid: 'pT2', team_idx: 0, min: min(9.9) }];
const NAMES = { pP1: ['Mitch', 'Creek'], pP4: ['Owen', 'Foxwell'], pJ1: ['Milton', 'Doyle'], pT1: ['Tyler', 'Harvey'] };
const NOW = new Date('2026-10-07T10:00:00Z');
const quiet = async f => { const k = { l: console.log, e: console.error, w: console.warn }; console.log = console.error = console.warn = () => {}; try { return await f(); } finally { Object.assign(console, { log: k.l, error: k.e, warn: k.w }); } };
const inList = v => (v || '').replace(/^in\.\(|\)$/g, '').split(',');
function world(st) {
  const calls = [];
  st.requests ??= [{ id: 'R1', state: 'queued', requested_at: '2026-10-07T09:55:00Z', sub: sub() }]; st.log ??= []; st.zip ??= true;
  const J = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const none = status => new Response(null, { status });
  globalThis.fetch = async (url, opt = {}) => {
    const u = new URL(url), q = u.searchParams, method = opt.method || 'GET', body = typeof opt.body === 'string' && opt.body[0] === '{' ? JSON.parse(opt.body) : null;
    if (u.hostname === 'api.resend.com') { const b = JSON.parse(opt.body); calls.push({ k: 'mail', subject: b.subject, headers: b.headers || null, files: b.attachments, html: b.html }); return J({ id: 'm' + calls.length }); }
    if (u.pathname.startsWith('/storage/v1/object/reports/')) { calls.push({ k: 'store' }); return J({ Key: 'ok' }); }
    const table = u.pathname.replace('/rest/v1/', '');
    if (table === 'report_mail_requests') {
      if (method === 'GET') return J(st.requests.filter(r => r.state === 'queued').map(r => ({ id: r.id, sub: r.sub })));
      const id = (q.get('id') || '').replace(/^eq\./, ''), r = st.requests.find(x => x.id === id);
      if (!id) return none(204);
      if (q.get('state') === 'eq.queued') { r.state = 'running'; return J([{ id }]); }
      calls.push({ k: 'mark', ...body }); Object.assign(r, body); return none(204);
    }
    if (table === 'report_mail_log') { if (method === 'GET') return J(st.log); calls.push({ k: 'log', ...body }); return none(201); }
    if (table === 'report_files') return none(201);
    if (table === 'report_mail_subs') {
      calls.push({ k: 'zip?', select: q.get('select') });
      if (st.before0228) return J({ code: '42703', message: 'column report_mail_subs.player_zip does not exist' }, 400);
      return J([{ player_zip: st.zip }]);
    }
    if (table === 'games') {
      if (q.get('status') === 'eq.final') {
        const t = /home_team_id\.eq\.([^,)]+)/.exec(q.get('or'))[1];
        calls.push({ k: 'season', team: t, comps: q.get('competition_id') });
        return J(FINALS.filter(g => g.home_team_id === t || g.away_team_id === t));
      }
      const [lo, hi] = q.getAll('tipoff_at').map(x => x.replace(/^(gte|lt)\./, ''));
      return J(WEEK.filter(g => g.tipoff_at >= lo && g.tipoff_at < hi));
    }
    if (table === 'teams') return J([{ league_id: 'L1' }]);
    if (table === 'seasons') { calls.push({ k: 'seasons', order: q.get('order') }); return J([{ id: 'S1' }]); }
    if (table === 'competitions') return J([{ id: 'C1' }, { id: 'C2' }]);
    if (table === 'player_game_stats') { const ids = inList(q.get('game_id')); calls.push({ k: 'pgs', select: q.get('select'), limit: q.get('limit') }); return J(PGS.filter(r => ids.includes(r.game_id))); }
    if (table === 'player_releases') return J(q.get('team_id') === 'eq.P' ? [{ player_id: 'pP3' }] : []);
    if (table === 'players') return J(inList(q.get('id')).filter(id => NAMES[id]).map(id => ({ id, first_name: NAMES[id][0], last_name: NAMES[id][1] })));
    throw new Error('the test world has no ' + method + ' ' + url);
  };
  M.hooks.pdf = async (p, name) => { calls.push({ k: 'pdf', path: p, name }); return { filename: name + '.pdf', content: Buffer.from('%PDF-1.7 ' + name).toString('base64') }; };
  return calls;
}
{
  const calls = world({});
  const failed = await quiet(() => M.requests(NOW));
  const mails = calls.filter(c => c.k === 'mail');
  ok('a Sunday email, and a second one after it: the reply', failed === 0 && mails.length === 2, mails.map(m => m.subject));
  const [sun, re] = mails;
  ok('the Sunday email carries a Message-ID of its own, on the sender\'s domain', /^<sunday-2026-10-11-[a-z0-9]+\.5b5b5b5b-0000-4000-8000-000000000001@prophesyscouting\.co\.uk>$/.test(sun.headers && sun.headers['Message-ID']), sun.headers);
  ok('the reply is "Re:" its subject, In-Reply-To and References its Message-ID: one thread', re.subject === 'Re: ' + sun.subject &&
     re.headers['In-Reply-To'] === sun.headers['Message-ID'] && re.headers.References === sun.headers['Message-ID'] && !re.headers['Message-ID'], re.headers);
  ok('...one ZIP a club whose report went: the two opponents and the club\'s own', re.files.map(f => f.filename).join(' ') === 'south-east-melbourne-phoenix-player-reports.zip tasmania-jackjumpers-player-reports.zip illawarra-hawks-player-reports.zip', re.files.map(f => f.filename));
  const zips = re.files.map(f => unzip(Buffer.from(f.content, 'base64')));
  ok('...each a ZIP of player reports, whole: Phoenix\'s two, the released and the under-10 left out', zips[0].out.map(f => f.name).join(' ') === 'player-report-mitch-creek.pdf player-report-owen-foxwell.pdf' &&
     zips.every(z => z.out.every(f => f.whole)) && zips[0].out[0].data.toString() === '%PDF-1.7 player-report-mitch-creek', zips.map(z => z.out.map(f => f.name)));
  ok('...the JackJumpers\' one, the club\'s own one (a 9.9 a game player left out)', zips[1].out.map(f => f.name).join() === 'player-report-milton-doyle.pdf' && zips[2].out.map(f => f.name).join() === 'player-report-tyler-harvey.pdf');
  const pdfs = calls.filter(c => c.k === 'pdf').map(c => c.path);
  ok('each player\'s report is the player page\'s own (p/?p=<id>&tab=report)', pdfs.filter(p => p.startsWith('/epinoia/p/')).join(' ') === '/epinoia/p/?p=pP1&tab=report /epinoia/p/?p=pP4&tab=report /epinoia/p/?p=pJ1&tab=report /epinoia/p/?p=pT1&tab=report', pdfs);
  ok('...drawn after the Sunday email went (it never waits on them)', calls.findIndex(c => c.k === 'mail') < calls.findIndex(c => c.k === 'pdf' && c.path.startsWith('/epinoia/p/')));
  ok('the season is the club\'s league\'s newest, its final games in that season\'s competitions', calls.some(c => c.k === 'seasons' && c.order === 'starts_on.desc') && calls.filter(c => c.k === 'season').every(c => c.comps === 'in.(C1,C2)'));
  ok('...the minutes read lean (min out of the stats) and a page at a time', calls.filter(c => c.k === 'pgs').every(c => /min:stats->min/.test(c.select) && c.limit === '1000'));
  ok('the reply names each club\'s players and their minutes, and says who is left out', /Mitch Creek <span[^>]*>\(30\.0 mpg\)/.test(re.html) && /released and those averaging under 10 minutes a game/.test(re.html) &&
     /Every player’s report: South East Melbourne Phoenix, Tasmania JackJumpers and Illawarra Hawks/.test(re.html) && />ZIP<\/span>South East Melbourne Phoenix: 2 player reports/.test(re.html));
  ok('...and does not say they are kept in the dashboard (only the club reports are)', /these player reports come in this email/.test(re.html) && !/Every report is also kept/.test(re.html) && /Every report is also kept/.test(sun.html));
  const logs = calls.filter(c => c.k === 'log');
  ok('logged as the players\' reports of that Sunday, after the Sunday and the team report', logs.map(l => l.kind + ' ' + l.ref).join(' | ') === 'sunday 2026-10-11 | team 2026-10-11 | players 2026-10-11' &&
     logs[2].detail === 'South East Melbourne Phoenix: 2, Tasmania JackJumpers: 1, Illawarra Hawks: 1', logs);
  ok('...and the console\'s request says so', calls.find(c => c.k === 'mark').detail === 'Sent the week of Mon 12 Oct: scouting reports on South East Melbourne Phoenix and Tasmania JackJumpers, plus the club’s own team report; and 4 player reports in a reply.', calls.find(c => c.k === 'mark'));
  const again = world({});
  await quiet(() => M.requests(NOW));
  ok('a player\'s report is drawn once a run: asked again, it is not drawn again', again.filter(c => c.k === 'pdf' && c.path.startsWith('/epinoia/p/')).length === 0 && again.filter(c => c.k === 'mail').length === 2);
}
{
  const calls = world({ zip: false });
  await quiet(() => M.requests(NOW));
  ok('an address that turned it off gets the Sunday email alone', calls.filter(c => c.k === 'mail').length === 1 && !calls.some(c => c.k === 'season') && calls.find(c => c.k === 'mark').state === 'sent');
}
{
  const calls = world({ before0228: true });
  const failed = await quiet(() => M.requests(NOW));
  ok('a database before 0228: the Sunday email as before, no reply, nothing failed', failed === 0 && calls.filter(c => c.k === 'mail').length === 1 &&
     calls.filter(c => c.k === 'log').map(l => l.kind).join() === 'sunday,team' && /^Sent the week of Mon 12 Oct: .*team report\.$/.test(calls.find(c => c.k === 'mark').detail));
}

/* ---------------------------------------------------------------- every report primed --- */
console.log('\nevery report the mailer draws');
{
  const src = read('scripts', 'report_mailer.mjs');
  const pdf = src.slice(src.indexOf('export async function pdfOf('), src.indexOf('/* the attachments in parts'));
  ok('is primed, with the Synergy numbers the admins kept, when 0228 is there', /window\.EPINOIA_RP_BOT = true; if \(s\) \{ window\.EPINOIA_RP_PRIME = true; window\.EPINOIA_SYNERGY = s; \}/.test(pdf) &&
     /synergy_profiles\?select=player_id,profile&order=player_id&limit=1000&offset=/.test(src));
  ok('...waits until it is built and done priming, RAPM included', /window\.__rpBuilt > 0 && !window\.__rpBusy/.test(pdf) && /timeout: 600000/.test(pdf));
  ok('...and keeps RAPM it worked out, for the next report of that league and season', /keepRapm\(await page\.evaluate\(\(\) => window\.__rpRapm \|\| null\)/.test(pdf) && /report_rapm\?on_conflict=key/.test(src));
  const rp = read('epinoia', 'report.js');
  ok('report.js primes when the mailer asks, without downloading, and says when it is busy', /const primeNow = q\.get\('prime'\) === '1' \|\| !!root\.EPINOIA_RP_PRIME;/.test(rp) &&
     /prime\(q\.get\('prime'\) === '1' && !root\.EPINOIA_RP_BOT\)/.test(rp) && /root\.__rpBusy = Math\.max\(0/.test(rp) && /root\.__rpRapm = \{ key, games, m \}/.test(rp));
  ok('...and never waits on priming for ever: past four minutes the mailer\'s copy is drawn with what is there', /const PRIME_CAP_MS = 240000;/.test(rp) &&
     /await \(root\.EPINOIA_RP_BOT \? Promise\.race\(\[primers, new Promise\(r => setTimeout\(r, PRIME_CAP_MS\)\)\]\) : primers\);/.test(rp));
  ok('the workflow has the time for it', /timeout-minutes: 120/.test(read('.github', 'workflows', 'report-mail.yml')));
  const sql = read('supabase', 'migrations', '0228_reports_manager.sql');
  ok('0228: the address\'s switch, on by default, and a log kind of its own', /add column if not exists player_zip boolean not null default true/.test(sql) && /'players'\)\)/.test(sql));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
