// THE SALES PAGES (2026-10-16): membership/ (Epinoia's tiers side by side), reports/ (the report emails, bought on the
// page) and setup-league/ (a private league of one's own), with their rows on the rail. What is held here:
//   * each page exists, is built to the page standard's shell, loads config.js then access.js before its own script,
//     nav.js last, the account words in Japanese and Spanish, and lets the payment window frame its own site;
//   * the rail: membership, reports and set up a league under EPINOIA GO, after the Manager, each lit on its page, and
//     the three are the platform's pages (a stray ?l= never drills the rail into a league);
//   * the membership page works out every column from the matrix (Free: gate 'free'; Signed in: 'free' or 'signin';
//     a tier: those, or its privileges - or, before 0279, its features naming the old gate) and what each adds to the
//     column it builds on;
//   * the reports page carries exactly what billing_provision reads (player_id / team_id, email, name, tz);
//   * the league page makes an address the way the database does (lower-case words, single hyphens, at most 40).
//
//   node supabase/tests/sales-pages.test.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const require = createRequire(import.meta.url);
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const M = require(path.join(ROOT, 'epinoia', 'membership', 'membership.js'));
const R = require(path.join(ROOT, 'epinoia', 'reports', 'reports.js'));
const L = require(path.join(ROOT, 'epinoia', 'setup-league', 'setup.js'));
const A = require(path.join(ROOT, 'epinoia', 'access.js'));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw))); } };
const eq = (what, got, want) => ok(what, JSON.stringify(got) === JSON.stringify(want), { got, want });

/* ------------------------------------------------------------------ the pages --- */
console.log('\nthe three pages');
const PAGES = [['membership', 'membership.js'], ['reports', 'reports.js'], ['setup-league', 'setup.js']];
for (const [dir, js] of PAGES) {
  const f = path.join('epinoia', dir, 'index.html');
  ok(dir + '/ exists, with its script beside it', existsSync(path.join(ROOT, f)) && existsSync(path.join(ROOT, 'epinoia', dir, js)));
  if (!existsSync(path.join(ROOT, f))) continue;
  const html = rd(f);
  const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]);
  const at = s => scripts.indexOf(s);
  ok(dir + '/: config.js, then access.js, then its own script, and nav.js last',
     at('../config.js') >= 0 && at('../config.js') < at('../access.js') && at('../access.js') < at(js) && scripts[scripts.length - 1] === '../nav.js', scripts);
  ok(dir + '/: appmode.js, then i18n.js with the account words, both in the head and blocking',
     /<script src="\.\.\/appmode\.js\?v=\d+"><\/script>\s*<script src="\.\.\/i18n\.js\?v=\d+" data-i18n-packs="account"><\/script>/.test(html.slice(0, html.indexOf('</head>'))));
  ok(dir + '/: on the page standard (a data-std frame, the centred head with its h1 and .pg-sub)',
     /<div class="ep-frame[^"]*"[^>]*\sdata-std[\s>]/.test(html) && /<header class="hero pg-head">[\s\S]*?<h1>[\s\S]*?class="pg-sub"/.test(html));
  const csp = (html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/) || [])[1] || '';
  ok(dir + '/: its CSP lets the payment window frame this site (default-src \'self\', no frame-src of its own) and runs no other site\'s script',
     /default-src 'self'/.test(csp) && !/frame-src/.test(csp) && /script-src 'self';/.test(csp), csp);
  ok(dir + '/: the payment window\'s look (kit/access.css) and the sales pages\' own (kit/sales.css, before sectitle.css)',
     /kit\/access\.css/.test(html) && html.indexOf('kit/sales.css') > html.indexOf('kit/page.css') && html.indexOf('kit/sales.css') < html.indexOf('kit/sectitle.css'));
  ok(dir + '/: its head written by tools/apply-page-heads.py (title, canonical, preview card)',
     /<!-- seo:head -->[\s\S]*<link rel="canonical" href="https:\/\/prophesyscouting\.co\.uk\/epinoia\/[a-z-]+\/">[\s\S]*<!-- \/seo:head -->/.test(html) &&
     new RegExp('"' + dir + '/": \\(').test(rd('tools', 'apply-page-heads.py')));
  ok(dir + '/: in the sitemap', rd('epinoia', 'sitemap.xml').includes('<loc>https://prophesyscouting.co.uk/epinoia/' + dir + '/</loc>'));
}
ok('the setup page loads teamcolour.js before its script (the preview reads the colour picked as a league\'s page would)',
   (h => h.indexOf('../teamcolour.js') > 0 && h.indexOf('../teamcolour.js') < h.indexOf('src="setup.js'))(rd('epinoia', 'setup-league', 'index.html')));
ok('access.js sends a reader to the membership page for Epinoia\'s tiers once the matrix is there',
   /\? 'join\/' : 'membership\/'/.test(rd('epinoia', 'access.js')));

/* -------------------------------------------------------------------- the rail --- */
console.log('\nthe rail');
const nav = rd('epinoia', 'nav.js');
ok('three rows made with platformRow: membership, reports and set up a league, each lit on its own page',
   /platformRow\('✦', 'membership', 'membership\/', \/\\\/epinoia\\\/membership\\\/\//.test(nav) &&
   /platformRow\('✉︎', 'reports', 'reports\/', \/\\\/epinoia\\\/reports\\\/\//.test(nav) &&
   /platformRow\('⊕', 'set up a league', 'setup-league\/', \/\\\/epinoia\\\/setup-league\\\/\//.test(nav));
ok('...under EPINOIA GO, after the Manager row',
   /sec\('EPINOIA GO'\), goRow, managerRow,\s*membershipRow, reportsRow, setupRow\);/.test(nav));
ok('...and the three pages are the platform\'s, never a league\'s', /const PLATFORM_PAGE = \/\\\/epinoia\\\/\(home\|games\|scouting\|go\|membership\|reports\|setup-league\)\\\/\/;/.test(nav));
ok('the rail\'s words for them in Japanese and Spanish (the nav context; "membership" is the core word)',
   ['ja', 'es'].every(code => { const s = rd('epinoia', 'i18n', code + '.js'); const n = s.slice(s.indexOf('nav: {'), s.indexOf('}', s.indexOf('nav: {')));
     return /'reports':/.test(n) && /'set up a league':/.test(n) && /'Membership':/.test(s); }));

/* ------------------------------------------------------------ the matrix -> cards --- */
console.log('\nmembership: every column worked out from the matrix');
const gates = {
  gameFlow: { gate: 'free', category: 'analytics', sort: 21 },
  lineups: { gate: 'signin', category: 'analytics', sort: 14 },
  events: { gate: 'tiers', category: 'analytics', sort: 10 },
  shotZones: { gate: 'tiers', category: 'analytics', sort: 11 },
  model: { gate: 'tiers', category: 'analytics', sort: 19 },
  playerReport: { gate: 'tiers', category: 'reports', sort: 200 },
  clubReport: { gate: 'tiers', category: 'reports', sort: 201 },
  frontOffice: { gate: 'tiers', category: 'club', sort: 300 },
  manager: { gate: 'free', category: 'manager', sort: 400 }
};
const locks = { events: { gate: 'analytics', label: 'Events stats', what: 'The events splits' }, model: { gate: 'analytics', label: 'What wins model', what: 'What wins (docs/what-wins-model.md §10.3)' } };
const rows = M.rowsOf(gates, locks, true);
eq('the rows: by category (analytics, reports, club, manager), then their sort', rows.map(r => r.key),
   ['events', 'shotZones', 'lineups', 'model', 'gameFlow', 'playerReport', 'clubReport', 'frontOffice', 'manager']);
ok('...with the catalogue\'s label, a readable one for a key it does not know, and no maintainer\'s note in the line under it',
   rows.find(r => r.key === 'events').label === 'Events stats' && rows.find(r => r.key === 'shotZones').label === 'Shot zones' &&
   rows.find(r => r.key === 'model').what === 'What wins', rows.find(r => r.key === 'model'));
const pro = { id: 't1', name: 'Pro', privileges: ['events', 'shotZones', 'playerReport'] };
const suite = { id: 't2', name: 'Team analytics suite', privileges: ['events', 'shotZones', 'playerReport', 'model', 'clubReport', 'frontOffice'] };
const cols = M.columns(rows, [pro, suite]);
eq('the columns: Free, Signed in, then each tier in its order', cols.map(c => c.name), ['Free', 'Signed in', 'Pro', 'Team analytics suite']);
eq('Free: the sections ticked free', cols[0].has, ['gameFlow', 'manager']);
eq('Signed in: free and signed-in sections', cols[1].has, ['lineups', 'gameFlow', 'manager']);
eq('a tier: those, and what its privileges name', cols[2].has, ['events', 'shotZones', 'lineups', 'gameFlow', 'playerReport', 'manager']);
eq('what each adds: Free all of its own, Signed in on Free, Pro on Signed in, the suite on Pro',
   cols.map(c => [c.base, c.fresh]), [[null, ['gameFlow', 'manager']], [0, ['lineups']], [1, ['events', 'shotZones', 'playerReport']], [2, ['model', 'clubReport', 'frontOffice']]]);
{
  /* a dearer tier that does not hold all of the one before it builds on the nearest column it does hold */
  const odd = M.columns(rows, [pro, { id: 't3', name: 'Club', privileges: ['clubReport', 'frontOffice'] }]);
  eq('a tier that does not hold all of the one before it says "everything in" the nearest column it does', [odd[3].base, odd[3].fresh], [1, ['clubReport', 'frontOffice']]);
}
eq('the new sections of a card, grouped by category for its list', M.grouped(cols[3].fresh, rows).map(g => [g.label, g.keys]),
   [['Analytics', ['model']], ['Reports', ['clubReport']], ['For clubs (front office)', ['frontOffice']]]);
{
  /* a database before 0279: the old gates, no categories, plans that name features */
  const old = M.rowsOf({ events: { gate: 'analytics', category: 'analytics', sort: 100 }, clubReport: { gate: 'club_report', category: 'analytics', sort: 100 } }, {}, false);
  ok('before 0279: a report\'s category comes from its key, not the wall\'s default', old.find(r => r.key === 'clubReport').category === 'reports');
  eq('...and a plan opens a section when its features name the section\'s old gate', M.columns(old, [{ id: 'x', name: 'Analytics', features: ['analytics'] }])[2].has, ['events']);
}
eq('the tiers from the price list: Epinoia\'s tiers only (and every plan from before 0279), in their order',
   M.tiersFrom([{ id: 'b', kind: 'tier', sort: 20 }, { id: 'a', kind: 'tier', sort: 10 }, { id: 'm', kind: 'manager', sort: 1 }, { id: 'l', kind: 'tier', league_id: 'x', sort: 1 }, { id: 'o', sort: 30 }], []).map(t => t.id),
   ['a', 'b', 'o']);
eq('...and the wall\'s privileges fill in where the list has none', M.tiersFrom([{ id: 'a', kind: 'tier' }], [{ id: 'a', privileges: ['events'] }])[0].privileges, ['events']);
ok('the page\'s catalogue rows are the site\'s locks: every one gets a label', M.rowsOf({}, A.CATALOGUE.locks, false).every(r => r.label && r.what === r.what.trim()));

/* ------------------------------------------------------------- the report emails --- */
console.log('\nreports: what the checkout carries');
const PID = '11111111-2222-4333-8444-555555555555';
eq('a player\'s: player_id, the address (lower case), the first name, the time zone',
   R.detailsFor('player_mail', { id: PID }, { email: ' Coach@Example.com ', name: '  Sam  ', tz: 'Europe/London' }),
   { player_id: PID, email: 'coach@example.com', name: 'Sam', tz: 'Europe/London' });
eq('a club\'s: team_id; no address means the account\'s own, no name none, a time zone the database would refuse is UTC',
   R.detailsFor('team_mail', { id: PID }, { email: '', name: '', tz: 'Not a zone!' }), { team_id: PID, tz: 'UTC' });
ok('nothing to buy until somebody is picked, nor with an address that is not one, nor for another kind',
   R.detailsFor('player_mail', null, { tz: 'UTC' }) === null && R.detailsFor('player_mail', { id: 'nope' }, {}) === null &&
   R.detailsFor('player_mail', { id: PID }, { email: 'not-an-address' }) === null && R.detailsFor('tier', { id: PID }, {}) === null);
ok('a first name is kept to the database\'s 60 characters', R.detailsFor('player_mail', { id: PID }, { name: 'x'.repeat(80) }).name.length === 60);
ok('the time zone rule is billing_provision\'s', rd('supabase', 'migrations', '0279_tiers_and_products.sql').includes("'^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'") &&
   R.detailsFor('player_mail', { id: PID }, { tz: 'America/Argentina/Buenos_Aires' }).tz === 'America/Argentina/Buenos_Aires');
ok('...and every key it sends is one billing_provision reads', ['player_id', 'team_id', 'email', 'name', 'tz'].every(k => rd('supabase', 'migrations', '0279_tiers_and_products.sql').includes("d->>'" + k + "'")));
eq('what the payment window says over the price', [R.whatFor('player_mail', 'Sam Okafor', 'a@b.co'), R.whatFor('team_mail', 'Leicester Riders', '')],
   ['Weekly reports on Sam Okafor to a@b.co', 'Reports on Leicester Riders to your account’s address']);
eq('each email a tier sends, in words, in order', R.mailLines(['matchups', 'weekly']),
   ['The player report every Monday morning, with the week’s games', 'Potential match-up reports for the week ahead']);
ok('...every mail kind the database allows has its line', ['games', 'opponents', 'own', 'zip', 'weekly', 'matchups'].every(k => R.mailLines([k]).length === 1));
eq('the tiers of one kind, in their order, cheapest first among equals',
   R.plansOf([{ id: 'b', kind: 'team_mail', sort: 10, price_pennies: 900 }, { id: 'a', kind: 'team_mail', sort: 10, price_pennies: 500 }, { id: 'p', kind: 'player_mail' }, { id: 'c', kind: 'team_mail', sort: 5 }], 'team_mail').map(p => p.id),
   ['c', 'a', 'b']);
ok('a subscription\'s state in the account page\'s words', R.subState({ status: 'active', current_period_end: 'X' }, d => d).text === 'Renews on X.' &&
   R.subState({ status: 'active', cancel_at: 'Y' }, d => d).text === 'Cancelled. Your access ends on Y.' && R.subState({ status: 'canceled' }).live === false);

/* ------------------------------------------------------------- a league's address --- */
console.log('\nsetting up a league: its address');
/* the database's own rule (billing_provision), for a name with nothing but ASCII in it */
const dbSlug = n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
for (const n of ['Northside Sunday League', '  Under-14s -- Girls!! ', 'BBL 2026/27', 'a  b', '3x3 Summer Cup'])
  eq('"' + n + '" as the database makes it', L.slugify(n), dbSlug(n));
eq('lower-case words, single hyphens, none at either end', L.slugify('--The  Big   League--'), 'the-big-league');
eq('accents folded rather than cut ("Liga Española")', L.slugify('Liga Española Élite'), 'liga-espanola-elite');
{
  const long = L.slugify('The Greater Northside And Riverside Amateur Basketball Association Sunday League');
  ok('at most 40 characters, never ending on a hyphen', long.length <= 40 && !/-$/.test(long) && L.slugOk(long), long);
}
ok('an address the database accepts: 2 to 40, lower-case words and single hyphens', L.slugOk('ab') && !L.slugOk('a') && !L.slugOk('a--b') && !L.slugOk('Ab') && !L.slugOk('x'.repeat(41)) && !L.slugOk('-ab'));
ok('league_slug_free asks the same of an address', rd('supabase', 'migrations', '0279_tiers_and_products.sql').includes("~ '^[a-z0-9]+(-[a-z0-9]+)*$'"));
ok('a name is 2 to 60 characters', L.nameOk('AB') && !L.nameOk(' A ') && !L.nameOk('x'.repeat(61)));
eq('how each of your leagues stands', [{ problem: 'x' }, { active: false, slug: 's', league_id: 'i' }, { active: true }, { active: true, slug: 's', league_id: 'i' }].map(r => L.leagueState(r).key),
   ['problem', 'lapsed', 'building', 'live']);
ok('the way into a league: the console on that league (admin/?l=<slug>, which admin.js opens on)',
   /'\.\.\/admin\/\?l=' \+ encodeURIComponent\(r\.slug\)/.test(rd('epinoia', 'setup-league', 'setup.js')) && /get\('l'\)/.test(rd('epinoia', 'admin', 'admin.js')));
ok('after a payment the page asks again every 3 seconds, for up to a minute', /setTimeout\(tick, 3000\)/.test(rd('epinoia', 'setup-league', 'setup.js')) && /Date\.now\(\) \+ 60000/.test(rd('epinoia', 'setup-league', 'setup.js')));

/* ------------------------------------------------------------------- the words --- */
console.log('\nthe words in Japanese and Spanish');
{
  const vm = await import('node:vm');
  const core = require(path.join(ROOT, 'epinoia', 'i18n.js'));
  const run = f => { let d = null; vm.runInNewContext(rd(...f), { window: { EpinoiaI18n: { register: (c, x) => { d = x; } } } }); return d; };
  const wants = ['Choose your tier', 'Every section, tier by tier', 'Everything in Free, plus:', '3 months free for new members', 'Comes with Pro membership',
    'A player’s report, every week', 'Weekly reports on Sam Okafor to a@b.co', 'Set up a league', 'Northside, a private league', 'We’re building it: if this stays, contact us',
    ...R.MAIL.map(m => m[1]), ...M.CATEGORIES.map(c => c[1])];
  for (const code of ['ja', 'es']) {
    const D = core.compile(code, core.merge([run(['epinoia', 'i18n', code + '.js']), run(['epinoia', 'i18n', code, 'account.js'])]));
    const miss = wants.filter(s => core.translateText(D, s, []) == null);
    ok(code + ': the pages\' words, and the sentences built around a name, translate', !miss.length, miss);
    ok(code + ': a name inside a sentence stays as it is', (core.translateText(D, 'Weekly reports on Sam Okafor to a@b.co', []) || '').includes('Sam Okafor'));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
