/* ============================================================================
   FIVE PHONE REQUESTS OF 2026-09-17, held in place.

     1. news dates on a phone are numbers in the reader's own order (13/9/26 in Britain)
     2. a match report links the game it is about
     3. a league tapped in the phone's menu sheet opens that league (it closed the sheet instead)
     4. the apps call themselves EPINOIΛ (the website's own text says Epinoia, and the match
        report is signed the way it was filed), and the notification picture is the app logo
     5. (the statistics table's scroll fix is held in touchscroll.test.mjs)

     node supabase/tests/phone-fixes.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), 'got  ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));
const L = 'EPINOIΛ';

/* ------------------------------------------------------------------ 1 --- */
console.log('\n-- news dates');
const newsCtx = (phone) => {
  const ctx = { console, Intl, Date, String, Number, isNaN, globalThis: null,
    window: { matchMedia: q => ({ matches: phone && /max-width:820px/.test(q) }) }, document: {} };
  ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(rd('epinoia', 'news.js'), ctx, { filename: 'news.js' });
  return ctx.EpinoiaNews;
};
{
  const N = newsCtx(true);
  const iso = '2026-09-13T15:00:00Z';
  eq('a phone in Britain: 13/9/26 (no leading zero on the month)', N.when(iso, { locale: 'en-GB' }), '13/9/26');
  eq('a phone in the US: 9/13/26', N.when(iso, { locale: 'en-US' }), '9/13/26');
  eq('a phone in Germany: 13.9.26', N.when(iso, { locale: 'de-DE' }), '13.9.26');
  eq('a phone in Japan: 26/9/13', N.when(iso, { locale: 'ja-JP' }), '26/9/13');
  ok('the phone is decided by the 820px breakpoint (no opts)', /^\d{1,2}[/.]\d{1,2}[/.]\d{2}$/.test(N.when(iso)), N.when(iso));
  const W = newsCtx(false);
  eq('a wider screen keeps the written date', W.when(iso, { locale: 'en-GB' }), '13 September 2026');
  eq('no date, or a broken one: nothing', [N.when(''), N.when('not a date')], ['', '']);
  const news = rd('epinoia', 'news.js');
  ok('a byline is printed as it was filed: nothing rewrites the stored name',
     N.byline === undefined && !/byline/.test(news) && /el\('span', 'club-ed', a\.author_name \|\| ''\)/.test(news));
  const page = rd('epinoia', 'news', 'news-page.js');
  ok('the article\'s meta line uses when(), and the author as stored', /N\.when\(a\.published_at\)/.test(page) && /' · by ' \+ a\.author_name/.test(page));
  ok('finalise-game signs new reports Epinoia match report', /author_name: 'Epinoia match report'/.test(rd('supabase', 'functions', 'finalise-game', 'index.ts')));
}

/* ------------------------------------------------------------------ 2 --- */
console.log('\n-- a match report links its game');
{
  const page = rd('epinoia', 'news', 'news-page.js');
  ok('the game id is read from the published article row, with the member\'s token as every call here',
     /api\('news_articles\?select=game_id&league_id=eq\.' \+ encodeURIComponent\(league\.id\) \+\s*'&slug=eq\.' \+ encodeURIComponent\(a\.slug\) \+ '&limit=1'\)/.test(page));
  ok('...the fixture line from the game itself', /api\('games\?select=id,status,home_score,away_score,tipoff_at,' \+\s*'home:home_team_id\(name\),away:away_team_id\(name\)&id=eq\./.test(page));
  ok('the card goes under the standfirst, and "the game →" beside "all news →"',
     /gameSlot\.appendChild\(gameCard\(g\)\)/.test(page) && /el\('a', 'ep-chip', 'the game →'\)/.test(page) && /foot\.insertBefore\(chip, link\)/.test(page));
  ok('both open the box score', /const gameHref = id => '\.\.\/game\/\?g=' \+ encodeURIComponent\(id\) \+ '&mode=supabase';/.test(page));
  ok('a written article (no game) gets nothing', /if \(!id\) return null;/.test(page) && /if \(!g\) return;/.test(page));
  const css = rd('epinoia', 'kit', 'news.css');
  ok('news.css styles the card, and an empty slot takes no room', /\.art-game\{/.test(css) && /\.art-game-slot:empty\{display:none\}/.test(css));
}

/* ------------------------------------------------------------------ 3 --- */
console.log('\n-- a league tapped in the phone menu');
{
  const nav = rd('epinoia', 'nav.js');
  const at = nav.indexOf('function drawLeagues()');
  const body = nav.slice(at, nav.indexOf("setView('league', true);", at));
  ok('in the open sheet the row is left to be the link it is (the league\'s front page)',
     /if \(nav\.classList\.contains\('drawer-open'\)\) return;\s*e\.preventDefault\(\);/.test(body), body.slice(0, 400));
  ok('...and it still links there', /a\.href = root \+ '\?l=' \+ encodeURIComponent\(l\.slug\);/.test(body));
}

/* ------------------------------------------------------------------ 4 --- */
console.log('\n-- EPINOIΛ, and its logo on notifications');
{
  const man = JSON.parse(rd('epinoia', 'manifest.webmanifest'));
  eq('the web app is called EPINOIΛ', [man.name, man.short_name], [L, L]);
  ok('...and wears the app logo, any and maskable, at 192 and 512', ['192', '512'].every(s =>
    man.icons.some(i => i.src === '/epinoia/brand/epinoia-app-' + s + '.png' && i.purpose === 'any') &&
    man.icons.some(i => i.src === '/epinoia/brand/epinoia-app-' + s + '-maskable.png' && i.purpose === 'maskable')));
  ok('...every icon it names is a real file', man.icons.concat(...man.shortcuts.map(s => s.icons)).every(i => fs.existsSync(path.join(ROOT, i.src.replace(/^\//, '')))));
  const strings = rd('android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  ok('the Android app\'s label is EPINOIΛ, and no string still says Epinoia', /<string name="app_name">EPINOIΛ<\/string>/.test(strings) && !/>[^<]*\bEpinoia\b/.test(strings));
  const pages = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.html')) pages.push(p);
    }
  })(path.join(ROOT, 'epinoia'));
  const bad = pages.filter(p => {
    const s = fs.readFileSync(p, 'utf8');
    return /apple-mobile-web-app-title" content="Epinoia"/.test(s) || /apple-touch-icon" href="[^"]*epinoia-mark-180/.test(s);
  });
  ok('every page\'s Home Screen name is EPINOIΛ and its Home Screen icon the app logo', bad.length === 0, bad.map(p => path.relative(ROOT, p)).join(', '));
  const sw = rd('epinoia', 'sw.js');
  ok('sw.js: the notification picture is the app logo, and a notice with no title says EPINOIΛ',
     /const ICON = '\/epinoia\/brand\/epinoia-app-192\.png';/.test(sw) && /return \{ title: 'EPINOIΛ', body: t \};/.test(sw));
  ok('...a new worker version, so phones take it', /const SW_VERSION = 'notifications-v2-2026-09-17-offline';/.test(sw));
  const png = fs.readFileSync(path.join(ROOT, 'epinoia', 'brand', 'epinoia-app-192.png'));
  eq('the app logo for notifications is a 192px PNG', [png.readUInt32BE(16), png.readUInt32BE(20)], [192, 192]);
  const nav = rd('epinoia', 'nav.js');
  ok('the app\'s offers on the site say EPINOIΛ', /'Get the EPINOIΛ app for Android'/.test(nav) && /'Update the EPINOIΛ app'/.test(nav) && /title: 'Get the EPINOIΛ app'/.test(nav));
  ok('the screen-reader name of the rail stays "Epinoia" (a word, not letters)', /nav\.setAttribute\('aria-label', 'Epinoia'\)/.test(nav));
  const ver = JSON.parse(rd('epinoia', 'android', 'version.json'));
<<<<<<< HEAD
  /* THE POINT IS THAT THE RENAME SHIPPED, not which build it shipped in. Pinned to the exact
     build it went out in (1.0.2, code 3) this went red the moment the next release raised it,
     which is a normal thing to do and not a regression: it is the FLOOR that matters. */
  ok('the renamed Android app is at least the build the rename shipped in (1.0.2, code 3)',
     ver.versionCode >= 3 && ver.versionName >= '1.0.2',
     'versionCode ' + ver.versionCode + ', versionName ' + ver.versionName);
=======
  /* A FLOOR, NOT A VALUE. What this is for is that the rename shipped as its own build — a phone
     only takes a new name and a new icon when the versionCode moves. Pinning the exact number
     meant every release after it turned this suite red for doing the very thing the suite asks
     for: 1.0.3 (code 4) carried the drawn logo onto the icon and broke it. */
  const [maj, min, pat] = String(ver.versionName || '').split('.').map(Number);
  ok('the renamed Android app shipped as its own build (at least 1.0.2, code 3)',
     ver.versionCode >= 3 && maj >= 1 && (maj > 1 || min > 0 || pat >= 2),
     ver.versionName + ' / ' + ver.versionCode);
>>>>>>> 73f3cfec (the app version test is a floor, not a value)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
