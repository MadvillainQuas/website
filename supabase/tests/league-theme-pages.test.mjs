/* ============================================================================
   EVERY PAGE ABOUT A LEAGUE WEARS THE LEAGUE'S COLOURS.

   The front page and the hub paint the league's colours themselves (home.js,
   l/league.js). Everything else about one league — its fixtures, statistics,
   WOWY, news, a game, joining it — is painted by nav.js, the one script they
   all load, once the page's league and the league's row are both known. A
   club's page and a player's page wear their CLUB's colours instead, and the
   platform's own tools stay the platform's.

   What fails quietly, and is pinned here:
     * a page added under a league that nav.js does not know is a league page;
     * a club or player profile painted over with the league's colours;
     * a page that works its league out from the network (no ?l=) never painted,
       because it never tells nav.js which league it is;
     * a page that changes league keeping the last league's colours;
     * a league's own accent from Appearance lost under the logo's colour;
     * the league row read without colour_source or theme, so nothing paints.
   Run: node supabase/tests/league-theme-pages.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
/* line endings as git stores them: a Windows checkout has CRLF */
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + d : '')); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), 'got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

const nav = read('epinoia', 'nav.js');

/* ------------------------------------------------------- which pages --- */
console.log('\n-- which pages nav.js paints');
const PAGE_RE = new RegExp((/const LEAGUE_PAGE = \/(.+)\/;/.exec(nav) || [])[1] || 'x^');
const CLUB_RE = new RegExp((/const CLUB_PAGE = \/(.+)\/;/.exec(nav) || [])[1] || 'x^');
const paints = p => PAGE_RE.test(p) && !CLUB_RE.test(p);
eq('fixtures, statistics, WOWY, news, a game, the video hub and joining are league pages',
   ['/epinoia/fixtures/', '/epinoia/stats/', '/epinoia/stats/wowy/', '/epinoia/news/', '/epinoia/game/', '/epinoia/video/', '/epinoia/join/'].map(paints),
   [true, true, true, true, true, true, true]);
eq('a club\'s page and a player\'s page are not (they wear the club\'s colours)', ['/epinoia/t/', '/epinoia/p/'].map(paints), [false, false]);
eq('the front page and the hub paint themselves, so nav.js leaves them', ['/epinoia/', '/epinoia/l/'].map(paints), [false, false]);
eq('the platform\'s own tools stay the platform\'s',
   ['/epinoia/admin/', '/epinoia/admin/platform/', '/epinoia/score/', '/epinoia/broadcast/', '/epinoia/me/', '/epinoia/app/', '/epinoia/embed/', '/epinoia/privacy/'].map(paints),
   [false, false, false, false, false, false, false, false]);
ok('the rail reads each league\'s colour source and theme with its colours',
   /\/rest\/v1\/leagues\?select=[^']*colour_a,colour_b,colour_source,theme/.test(nav));
ok('it paints once the leagues arrive, and again whenever a page names its league',
   /drawLeagues\(\);\s*themeLeague\(\);/.test(nav) && /applyAuth\(\);[^\n]*\n\s*themeLeague\(\);/.test(nav));

/* ----------------------------------------------- pages name their league --- */
console.log('\n-- every league page tells nav.js which league it is');
[['fixtures/fixtures.js', /window\.__CS_LEAGUE_SLUG = LEAGUE\.slug/], ['stats/stats.js', /window\.__CS_LEAGUE_SLUG = league\.slug/],
 ['stats/wowy/wowy.js', /window\.__CS_LEAGUE_SLUG = league\.slug/], ['news/news-page.js', /window\.__CS_LEAGUE_SLUG = league\.slug/],
 ['game/game.js', /window\.__CS_LEAGUE_SLUG = league\.slug/], ['join/join.js', /window\.__CS_LEAGUE_SLUG = SLUG/],
 /* the video hub keeps its league in a `root` alias, being a UMD module */
 ['video/videohub.js', /root\.__CS_LEAGUE_SLUG = league\.slug/]]
  .forEach(([f, re]) => ok(f + ' names its league once it knows it', re.test(read('epinoia', ...f.split('/')))));
['fixtures/index.html', 'stats/index.html', 'stats/wowy/index.html', 'news/index.html', 'game/index.html',
 'video/index.html', 'join/index.html']
  .forEach(f => ok(f + ' loads nav.js', /<script src="(\.\.\/)+nav\.js\?v=\d+" defer><\/script>/.test(read('epinoia', ...f.split('/')))));

/* --------------------------------------------------- nav.js's painter --- */
console.log('\n-- the painter');
const start = nav.indexOf('  const LEAGUE_PAGE = ');
const end = nav.indexOf('\n  }\n', nav.indexOf('  function themeLeague()')) + 4;
ok('nav.js carries the painter', start > 0 && end > start);
function painter(o) {
  const calls = { scripts: [], clear: 0, league: [] };
  const vars = {};
  const TC = {
    clearLeague: () => { calls.clear++; },
    league: (row, opts) => { calls.league.push([row.slug, opts]); return Promise.resolve(true); }
  };
  const ctx = {
    console, Promise, setTimeout,
    here: o.here, root: '../', stamp: '?v=266',
    pageLeague: o.pageLeague || '',
    leagues: o.leagues || [],
    window: o.preloaded ? { EpinoiaTeamColour: TC } : {},
    document: {
      head: { appendChild: s => { calls.scripts.push(s.src); setTimeout(() => { ctx.window.EpinoiaTeamColour = TC; s.onload(); }, 1); } },
      createElement: () => ({}),
      documentElement: { style: { setProperty: (k, v) => { vars[k] = v; } } }
    }
  };
  vm.createContext(ctx);
  vm.runInContext('var here = this.here, root = this.root, stamp = this.stamp;' +
                  'var leagues = this.leagues, pageLeague = this.pageLeague;' +
                  nav.slice(start, end).replace(/\n  const /g, '\n  var ').replace(/\n  let /g, '\n  var ') +
                  '\nthis.themeLeague = themeLeague; this.set = (k, v) => { if (k === "pageLeague") pageLeague = v; };', ctx);
  return { ctx, calls, vars };
}
const SLB = { slug: 'slb-men', colour_a: '#f2594c', colour_b: '#000000', colour_source: 'logo', theme: {} };
const OWN = { slug: 'own-accent', colour_a: '#123456', colour_b: '#abcdef', colour_source: 'manual', theme: { accent: '#ff00aa' } };
{
  const P = painter({ here: '/epinoia/stats/wowy/', pageLeague: 'slb-men', leagues: [SLB] });
  P.ctx.themeLeague();
  await tick(10);
  eq('a league page with teamcolour.js absent loads it, at nav.js\'s own stamp', P.calls.scripts, ['../teamcolour.js?v=266']);
  eq('...then clears whatever was painted and paints the page\'s league', [P.calls.clear, P.calls.league.map(c => c[0])], [1, ['slb-men']]);
  eq('...keeping the logo\'s accent when the league chose none', P.calls.league[0][1], { keepAccent: false });
  P.ctx.themeLeague();
  await tick(10);
  eq('asked again for the same league, it does nothing', P.calls.league.length, 1);
}
{
  const P = painter({ here: '/epinoia/fixtures/', pageLeague: 'own-accent', leagues: [OWN], preloaded: true });
  P.ctx.themeLeague();
  await tick(10);
  eq('a league that picked its own accent keeps it (the logo\'s colours never replace it)', [P.calls.league[0][1], P.vars['--lume'], P.calls.scripts.length],
     [{ keepAccent: true }, '#ff00aa', 0]);
}
{
  const P = painter({ here: '/epinoia/game/', pageLeague: '', leagues: [SLB], preloaded: true });
  P.ctx.themeLeague();
  await tick(10);
  eq('a page that has not named its league yet paints nothing', P.calls.league.length, 0);
  P.ctx.set('pageLeague', 'slb-men');
  P.ctx.themeLeague();
  await tick(10);
  eq('...and paints the moment it does', P.calls.league.map(c => c[0]), ['slb-men']);
  P.ctx.set('pageLeague', 'somewhere-else');
  P.ctx.themeLeague();
  await tick(10);
  eq('a page that moves to a league with no row takes the last league\'s colours off', [P.calls.clear, P.calls.league.length], [2, 1]);
}
{
  const P = painter({ here: '/epinoia/t/', pageLeague: 'slb-men', leagues: [SLB], preloaded: true });
  P.ctx.themeLeague();
  const Q = painter({ here: '/epinoia/p/', pageLeague: 'slb-men', leagues: [SLB] });
  Q.ctx.themeLeague();
  await tick(10);
  eq('a club\'s and a player\'s page are never painted, nor is teamcolour.js loaded for them', [P.calls.league.length, P.calls.clear, Q.calls.scripts.length], [0, 0, 0]);
}

/* ---------------------------------------------- teamcolour.js clearLeague --- */
console.log('\n-- teamcolour.js takes a league\'s colours off again');
{
  const vars = {}, classes = new Set();
  const ctx = {
    console, setTimeout,
    document: {
      documentElement: { style: { setProperty: (k, v) => { vars[k] = v; }, removeProperty: k => { delete vars[k]; } }, getAttribute: () => null },
      body: { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) } },
      querySelector: () => null, createElement: () => ({ getContext: () => null }), readyState: 'complete'
    },
    Image: function () {}
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('epinoia', 'teamcolour.js'), ctx);
  const TC = ctx.EpinoiaTeamColour;
  await TC.league({ colour_source: 'logo', colour_a: '#f2594c', colour_b: '#000000' });
  ok('painted: the class and the league\'s variables are on', classes.has('league-themed') && !!vars['--league-a'] && !!vars['--lume']);
  eq('clearLeague takes the class, all six variables and the accent off, and says it did', [TC.clearLeague(), classes.has('league-themed'), Object.keys(vars)], [true, false, []]);
  vars['--lume'] = '#ff00aa';
  eq('...and on a page that was never painted it leaves an accent it did not set', [TC.clearLeague(), vars['--lume']], [false, '#ff00aa']);
}

/* ------------------------------------------------------------ the look --- */
console.log('\n-- each page\'s heading');
{
  const kit = read('epinoia', 'kit', 'epinoia-kit.css');
  ok('the kit trims a league page\'s .hero: the wash, the three-part stripe, the title in the league\'s inks',
     /body\.league-themed \.hero\{[^}]*color-mix\(in srgb,var\(--league-a\)/.test(kit) &&
     /body\.league-themed \.hero::after\{[^}]*var\(--league-a\) 0 72%,var\(--league-b\) 72% 88%/.test(kit) &&
     /body\.league-themed \.hero h1\{ background-image:linear-gradient\(100deg,var\(--league-a-ink\),var\(--league-b-ink\)\) \}/.test(kit));
  ['fixtures/index.html', 'stats/wowy/index.html', 'news/index.html', 'video/index.html', 'join/index.html']
    .forEach(f => ok(f + ' opens with a .hero the kit trims', /class="hero"/.test(read('epinoia', ...f.split('/')))));
  const stats = read('epinoia', 'stats', 'index.html');
  ok('the statistics page, which has no .hero, trims its heading itself', /body\.league-themed \.ep-frame > \.ep-hdr\{/.test(stats) &&
     /body\.league-themed #title\{color:var\(--league-a-ink\)\}/.test(stats));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
