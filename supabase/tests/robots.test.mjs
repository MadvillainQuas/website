/* ============================================================================
   ROBOTS.TXT: SLOW, POLITE, AND STILL POSSIBLE (2026-09-26).

   Crawlers read /robots.txt at the DOMAIN ROOT only. This site's file used to be /epinoia/robots.txt,
   which no crawler ever asked for, so nothing here was in force. This pins the root file:
     * it is published (tools/build-site.py copies it to the site root) and the dead one is gone;
     * every crawler is asked to wait (Crawl-delay), and the delay is neither zero nor so long that
       the public section is unreachable;
     * the public pages are open, and every tool, console, embed widget, the 900 MB of data files and
       the licence-gated analytics apps are not;
     * the wildcard rules behave as a crawler reads them (longest match wins, Allow beats Disallow
       on a tie), checked with a small reader of the same rules;
     * the sitemap it names exists.

     node supabase/tests/robots.test.mjs
   ============================================================================ */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

/* the Robots Exclusion Protocol as Google and Bing read it: groups by user-agent, the most specific
   (longest) matching rule wins, Allow wins a tie; * matches anything, $ ends the address */
function parse(text) {
  const groups = []; let cur = null, lastWasAgent = false;
  const sitemaps = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue;
    }
    lastWasAgent = false;
    if (k === 'sitemap') sitemaps.push(v);
    else if (cur && (k === 'allow' || k === 'disallow')) cur.rules.push({ allow: k === 'allow', pat: v });
    else if (cur && k === 'crawl-delay') cur.delay = Number(v);
  }
  return { groups, sitemaps };
}
const toRe = pat => new RegExp('^' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
function groupFor(R, agent) {
  const a = agent.toLowerCase();
  const hit = R.groups.find(g => g.agents.some(x => x !== '*' && a.includes(x)));
  return hit || R.groups.find(g => g.agents.includes('*'));
}
function allowed(R, agent, url) {
  const g = groupFor(R, agent);
  let best = null;
  for (const r of g.rules) {
    if (!r.pat) continue;                         // "Disallow:" with nothing allows everything
    if (!toRe(r.pat).test(url)) continue;
    if (!best || r.pat.length > best.pat.length || (r.pat.length === best.pat.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

console.log('the file, and where it is');
const txt = rd('robots.txt');
const R = parse(txt);
ok('a robots.txt at the repository root, which is the domain root once published', existsSync(path.join(ROOT, 'robots.txt')));
ok('...and the build copies it to the site root', /PUBLIC_FILES\s*=\s*\[[^\]]*"robots\.txt"/s.test(rd('tools', 'build-site.py')));
ok('...and the copy under /epinoia/ that no crawler ever read is gone', !existsSync(path.join(ROOT, 'epinoia', 'robots.txt')));

console.log('\nslow');
const star = R.groups.find(g => g.agents.includes('*'));
ok('every crawler is asked to wait between requests', star && star.delay > 0, star && star.delay);
ok('...between 5 and 30 seconds: slow, and the public section still gets read in a day or two', star.delay >= 5 && star.delay <= 30, star.delay);

console.log('\npossible: the public pages are open');
const open = ['/', '/epinoia/', '/epinoia/home/', '/epinoia/games/', '/epinoia/stats/', '/epinoia/stats/wowy/', '/epinoia/scouting/', '/epinoia/video/',
  '/epinoia/learn/', '/epinoia/embed/', '/epinoia/api/', '/epinoia/l/?l=slb', '/epinoia/t/?t=brisbane-bullets', '/epinoia/game/?g=569d4acb-6a79-439f-95a0-1f208b63e557',
  '/epinoia/p/?p=someone', '/epinoia/news/', '/epinoia/privacy/', '/epinoia/sitemap.xml', '/epinoia/kit/home.css', '/epinoia/vendor/supabase.js', '/epinoia/i18n/ja.js'];
for (const agent of ['Googlebot', 'bingbot', 'DuckDuckBot', 'SomeOtherCrawler/1.0']) {
  const shut = open.filter(u => !allowed(R, agent, u));
  ok(agent + ' may read the public pages and the styles and scripts they need to render', shut.length === 0, shut);
}

console.log('\npolite: what is not for a crawler');
const closed = ['/epinoia/admin/', '/epinoia/admin/platform/', '/epinoia/app/', '/epinoia/score/', '/epinoia/broadcast/control/', '/epinoia/clockcam/', '/epinoia/edit/',
  '/epinoia/me/', '/epinoia/signin/', '/epinoia/join/', '/epinoia/go/photos/', '/epinoia/invite/?t=secret', '/epinoia/devfeed.html',
  '/epinoia/embed/table/', '/epinoia/embed/strip/', '/epinoia/embed/game/', '/epinoia/embed/notify/', '/epinoia/embed/merch/',
  '/data/data_2026-05-09T15-59_SLB/player_stats.csv', '/data/README.md', '/config/ingest-sources.json',
  '/index_9.html', '/allstats.html', '/admin.html', '/lineup.html', '/pitch.html', '/gamevis.html', '/player_stats_viewer_pro.html',
  '/basketball-analyzer-profiles_9.html', '/GAMEVIS_with_ShotChart_v2_6.html', '/transfermatrix/', '/league/admin/', '/league/api/', '/league/app/',
  '/epinoia/home/?lang=ja', '/epinoia/game/?g=569d4acb&mode=supabase', '/epinoia/l/?l=slb&lang=es'];
const open2 = closed.filter(u => allowed(R, 'Googlebot', u));
ok('tools, consoles, widgets, data files, the licence-gated apps and duplicate-language addresses are all closed', open2.length === 0, open2);
ok('...and the same for a crawler no rule names', closed.every(u => !allowed(R, 'SomethingNew/2', u)));
ok('the one address that opens a game is not shut by the language and mode rules', allowed(R, 'Googlebot', '/epinoia/game/?g=569d4acb-6a79-439f-95a0-1f208b63e557'));

console.log('\nthe crawlers that only sell a listing of the site');
for (const b of ['AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'PetalBot', 'BLEXBot', 'DataForSeoBot', 'serpstatbot']) {
  ok(b + ' is asked to stay out', !allowed(R, b, '/epinoia/home/') && !allowed(R, b, '/'));
}
ok('...and the ones that send readers are not among them', ['Googlebot', 'bingbot', 'DuckDuckBot', 'YandexBot', 'Applebot'].every(b => allowed(R, b, '/epinoia/home/')));

console.log('\nthe sitemap');
ok('it names the sitemap, on this site’s own domain', R.sitemaps.length === 1 && R.sitemaps[0] === 'https://' + rd('CNAME').trim() + '/epinoia/sitemap.xml', R.sitemaps);
ok('...and that sitemap exists', existsSync(path.join(ROOT, 'epinoia', 'sitemap.xml')));
ok('no line of the file is one the crawlers would misread (a rule before any user-agent)', R.groups.every(g => g.agents.length > 0) && /^[^#\s]*User-agent/im.test(txt));

console.log('\n%d passed, %d failed', pass, fail);
process.exit(fail ? 1 : 0);
