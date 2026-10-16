// A college system's hub, its rail and its conferences' pages (Louie, 2026-10-16). No database: mode.js run against
// real addresses, the markup and the wiring read from the files, the scoped search run against a fake server.
//
//   node supabase/tests/college-hub.test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const EP = path.join(here, '..', '..', 'epinoia');
const rd = (...p) => readFileSync(path.join(EP, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

console.log('-- which page the front page is (mode.js, before the first paint)');
const MODE = rd('mode.js');
function modeFor(url) {
  const u = new URL(url);
  const cls = new Set();
  let went = null;
  const ctx = {
    URLSearchParams, URL,
    document: { documentElement: { classList: { add: (...c) => c.forEach(x => cls.add(x)) } } },
    location: { search: u.search, pathname: u.pathname, href: u.href, replace: h => { went = h; } }
  };
  vm.runInNewContext(MODE, ctx);
  return { cls: [...cls].sort().join(' '), went };
}
const B = 'https://example.test/epinoia/';
let m = modeFor(B + '?l=u-sports');
ok('a system league\'s front page goes to its hub', m.went === B + '?college=u-sports', m);
m = modeFor(B + '?l=ncaa-d2-women&s=2026-27');
ok('...NCAA D2 women\'s to the D2 hub on the women\'s side, the season kept', m.went === B + '?s=2026-27&college=ncaa-d2&g=women', m);
m = modeFor(B + '?l=u-sports&conf=oua');
ok('a conference\'s page is a league page (no redirect)', !m.went && m.cls.includes('m-league') && m.cls.includes('m-leaguepage') && !m.cls.includes('m-college'), m);
m = modeFor(B + '?college=u-sports');
ok('?college= is the hub: m-league (the hub frame) and m-college, never a league page', !m.went && m.cls.includes('m-league') && m.cls.includes('m-college') && !m.cls.includes('m-leaguepage'), m);
m = modeFor(B + '?l=slb-men');
ok('every other league\'s page is as it was', !m.went && m.cls.includes('m-leaguepage'), m);
m = modeFor(B);
ok('and the bare front page still goes to HOME', m.went === B + 'home/', m);
m = modeFor(B + 'news/?l=u-sports');
ok('only the front page redirects (a league\'s other pages take ?l=u-sports as they are)', !m.went, m);

console.log('\n-- the hub\'s markup (index.html) and its script (college.js)');
const LI = rd('index.html'), CJ = rd('college.js'), CSS = rd('kit', 'college.css');
ok('the conferences under MAIN | VIDEO, then the hub\'s groups: Games, Conferences, Table, Leaders',
   LI.indexOf('id="hmModes"') < LI.indexOf('id="cgConfs"') && LI.indexOf('id="cgConfs"') < LI.indexOf('id="cgMain"') &&
   /data-pgrp-key="games" data-pgrp-name="Games"><div id="cgGamesHost">/.test(LI) && /data-pgrp-key="clubs" data-pgrp-name="Conferences"/.test(LI) &&
   /data-pgrp-key="table" data-pgrp-name="Table"/.test(LI) && /data-pgrp-key="leaders" data-pgrp-name="Leaders"/.test(LI));
ok('the hub\'s sections only in college mode, the league page\'s never there',
   /html:not\(\.m-college\) #cgConfs,html:not\(\.m-college\) #cgMain\{display:none\}/.test(LI) && /\.m-college #lgMain,\.m-college #accessSec\{display:none\}/.test(LI));
ok('home.js hands the page to the hub and runs none of a league page\'s sections', /if \(document\.documentElement\.classList\.contains\('m-college'\)\) \{[\s\S]{0,200}EpinoiaCollegeHub\.boot\(\)[\s\S]{0,200}return;/.test(rd('home.js')));
ok('the hub\'s title is the system\'s Main Hub (Louie, 2026-10-16), the name kept in Japanese and Spanish',
  CJ.includes("const title = SYS.name + ' Main Hub';") && CJ.includes('wm.textContent = title;') && CJ.includes("document.title = title + ' · Epinoia';")
  && rd('i18n', 'ja.js').includes("[/^(.+) Main Hub$/, '$1 メインハブ']") && rd('i18n', 'es.js').includes("[/^(.+) Main Hub$/, 'Portada principal de $1']"));
ok('the games section is the league page\'s own, moved in before secgroups picks a first tab', /if \(sec && hostEl\) hostEl\.appendChild\(sec\);/.test(CJ));
ok('the map: the system\'s country, a region a colour, a card with an arrow, the regions as dropdowns', /maps\.js/.test(CJ) && /class', 'cg-callout'|'cg-callout'/.test(CJ)
   && /details', 'ep-acc cg-rrow'/.test(CJ) && /\.cg-callout\[data-arrow="l"\]::before/.test(CSS) && /\.cg-stage\[data-on\] \.cg-g:not\(\.on\) path\{opacity/.test(CSS));
ok('...placed in the stage\'s own CSS pixels (the page is zoomed on a wide screen)', /const z = \(sr\.width \/ \(stage\.offsetWidth \|\| sr\.width\)\) \|\| 1;/.test(CJ));
ok('...and no floating card on a narrow screen: the region\'s dropdown opens instead', /if \(stage\.clientWidth < 560\) \{ card\.hidden = true; return; \}/.test(CJ));
ok('the games\' conference chips read that conference\'s clubs\' games (leaguegames rescope)', /LG\.rescope\(scopeOf\(\)\)/.test(CJ) && /teams = gamesConf \?/.test(CJ));
ok('NCAA D2: one Men\'s | Women\'s for the whole hub, remembered', /const GKEY = 'epinoia_college_g';/.test(CJ) && /localStorage\.setItem\(GKEY/.test(CJ));

console.log('\n-- a set of clubs\' games (globalgames.js, leaguegames.js, the strip)');
const GG = rd('globalgames.js');
const sq = new Function(GG.match(/const UUID = [^;]+;/)[0] + GG.match(/const idList = [^;]+;/)[0] +
  GG.match(/function scopeQuery\(o\) \{[\s\S]*?\n\}/)[0] + 'return scopeQuery;')();
const A = '11111111-1111-4111-8111-111111111111', T1 = '22222222-2222-4222-8222-222222222222', T2 = '33333333-3333-4333-8333-333333333333';
ok('teams: both sides asked of the database, with the league', sq({ only: [A], teams: [T1, T2] }) ===
   '&competitions.seasons.league_id=eq.' + A + '&or=(home_team_id.in.(' + T1 + ',' + T2 + '),away_team_id.in.(' + T1 + ',' + T2 + '))',
   sq({ only: [A], teams: [T1, T2] }));
ok('...and no teams is the read as it always was', sq({ only: [A] }) === '&competitions.seasons.league_id=eq.' + A);
ok('leaguegames: several leagues, a set of clubs, and a rescope for the hub\'s chips', /function rescope\(o\)/.test(rd('leaguegames.js')) && /EpinoiaLeagueGames = \{ mount, rescope, N \}/.test(rd('leaguegames.js')));
const ST = rd('embed', 'strip', 'strip.js');
ok('the strip takes ?teams= (ids only) with ?l=: a conference\'s strip', /const wantTeams = \(qp\.get\('teams'\) \|\| ''\)/.test(ST) && /scopeQ \+= '&or=\(home_team_id\.in\.\('/.test(ST));

console.log('\n-- a conference\'s pages');
const HJ = rd('home.js');
ok('the front page with ?conf=: the conference\'s name and logo, a way back to the hub, its games, strip and fixtures',
   /function conferencePage\(\)/.test(HJ) && /function conferenceHero\(\)/.test(HJ) && /'(?:\\u2190|←) ' \+ S\.name \+ ' hub'/.test(HJ)
   && /scope \+= await confGamesFilter\(\);/.test(HJ) && /'&teams=' \+ SC\.ids\.join\(','\)/.test(HJ));
ok('...and every link out of it carries the conference', /\+ confQuery\(\);\r?\n\}/.test(HJ) && /const table = 'l\/\?l=' \+ slug \+ confQuery\(\);/.test(HJ));
ok('the table page draws the conference alone; its stats open on it', /only: URL_CONF \|\| undefined/.test(rd('l', 'league.js')) && /if \(statConf === null && URL_CONF\)/.test(rd('l', 'league.js')));
ok('the statistics page opens on it', /let urlConf = new URLSearchParams\(location\.search\)\.get\('conf'\);/.test(rd('stats', 'stats.js')));

console.log('\n-- the rail (nav.js)');
const NV = rd('nav.js');
ok('a system is a "country" of its own, its leagues out of their real country', /if \(l && COLLEGE\[l\.slug\]\) return COLLEGE_PREFIX \+ COLLEGE\[l\.slug\];/.test(NV));
ok('its panel: a search of the system, its conferences, its own pages', /async function drawCollege\(code\)/.test(NV) && /searchScope = \{ leagues: ls\.map\(l => l\.slug\), label: S\.name \};/.test(NV)
   && /'grouplbl', 'conferences'/.test(NV) && /\['(?:\\u2302|⌂)', 'hub'/.test(NV));
ok('a conference in the rail is a league: &conf= on every row, its logo and name at the top', /\(rconf && COLLEGE\[s\] \? '&conf=' \+ encodeURIComponent\(rconf\) : ''\)/.test(NV)
   && /A CONFERENCE'S RAIL: its logo and its name at the top/.test(NV));
ok('...its teams are the conference\'s clubs', /const ck = l\.slug \+ \(rconf && COLLEGE\[l\.slug\] \? '\|' \+ rconf : ''\);/.test(NV));
ok('the footer\'s search stays the platform\'s; the hub\'s phone bar searches the system', /searchBtn\.addEventListener\('click', \(\) => \{ searchScope = null; openSearch\(\); \}\);/.test(NV)
   && /searchScope = hubScope\(\); openSearch\(\);/.test(NV) && /function paintHubTabs\(\)/.test(NV));
ok('the college helpers are defined before the bar is painted (they once were not: the whole rail failed)',
   NV.indexOf('const collegeName = ') > 0 && NV.indexOf('const collegeName = ') < NV.indexOf('function paintHubTabs()'));

console.log('\n-- the system\'s search (search.js)');
const SJ = rd('search.js');
const calls = [];
const fakeFetch = async (url, o) => {
  const body = JSON.parse(o.body);
  calls.push(url.split('/rpc/')[1] + ' ' + JSON.stringify(body));
  if (/site_search_in/.test(url)) return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => [
    { kind: 'league', name: 'U SPORTS', slug: 'u-sports', league_slug: 'u-sports' },
    { kind: 'team', name: 'Carleton', slug: 'carleton', league_slug: 'u-sports' },
    { kind: 'team', name: 'Carlton', slug: 'carlton', league_slug: 'nbl1-men' },
    { kind: 'player', name: 'Carl Smith', slug: 'carl', league_slug: 'u-sports' }] };
};
const sctx = { window: {}, fetch: fakeFetch, globalThis: null, document: undefined, localStorage: undefined, sessionStorage: undefined };
sctx.globalThis = sctx; sctx.self = sctx;
vm.runInNewContext(SJ.replace(/\}\(typeof globalThis[\s\S]*$/, '}(globalThis, function(){}));'), sctx);
const askScoped = vm.runInNewContext('(' + SJ.match(/async function askScoped\([\s\S]*?\n\}/)[0] + ')',
  Object.assign(sctx, { LIMIT: 6, scopedRpc: 'unknown' }));
const rows = await askScoped({ supabaseUrl: 'https://db.example', supabaseAnonKey: 'k' }, 'carl', ['u-sports'], false, null);
ok('a database without site_search_in: the site\'s answer, asked for more, cut to the system\'s clubs and players',
   JSON.stringify(rows.map(r => r.slug)) === '["carleton","carl"]' && /site_search \{"p_q":"carl","p_limit":12/.test(calls[1]), [rows, calls]);
ok('...and the system\'s own function is asked first, by league slug', /^site_search_in \{"p_q":"carl","p_leagues":\["u-sports"\]/.test(calls[0]), calls);
ok('the box says whose search it is', /input\.placeholder = sc && sc\.label \? sc\.label \+ ' teams and players'/.test(SJ));
const MIG = readFileSync(path.join(here, '..', 'migrations', '0270_site_search_in.sql'), 'utf8');
ok('0270: teams and players of the leagues named, by the site\'s own rules (withheld players, hidden leagues)',
   /create or replace function public\.site_search_in\(p_q text, p_leagues text\[\]/.test(MIG) && /where l\.slug = any \(lgs\)\)/.test(MIG)
   && /not public\.player_withheld\(pl\.is_minor, pl\.public_consent\)/.test(MIG) && /public\.league_visible\(c\.lid\)/.test(MIG)
   && /grant execute on function public\.site_search_in\(text, text\[\], integer, boolean\) to anon, authenticated, service_role;/.test(MIG));

console.log('\n-- the hub in its logo\'s colours (Louie, 2026-10-16)');
ok('the hub wears its league\'s colours as a league page does (teamcolour.js league()), the last side\'s taken off first',
   /function look\(d\) \{[\s\S]{0,200}TC\.clearLeague\(\);[\s\S]{0,300}TC\.league\(L, \{ keepAccent: !!own \}\)/.test(CJ));
ok('...from the whole league row, so colour_source and theme come with it', CJ.includes("'leagues?slug=eq.' + encodeURIComponent(slug) + '&select=*&limit=1'"));
ok('...painted, with the name\'s logo, as soon as that row arrives (not after the season\'s reads), for the side still chosen',
   /leagueRow\(part\.slug\)\.then\(league => \{\s*if \(part !== PART \|\| !league\) return;\s*heroLogo\(\{ slug: part\.slug, league \}\);\s*look\(\{ slug: part\.slug, league \}\);/.test(CJ)
   && /const league = await leagueRow\(slug\);/.test(CJ));
{
  const NJ = rd('nav.js'), NC = rd('kit', 'nav.css');
  ok('...and the system\'s rail too: its search, conferences row and pages keyed to the league\'s colours, the two inks alternating',
     NJ.includes("el('button', 'item cg-sysearch cg-key')") && NJ.includes("el('a', 'item cg-confsrow cg-key cg-alt')")
     && NJ.includes("el('a', 'item cg-key' + (i % 2 ? ' cg-alt' : '') + (on ? ' on' : ''))")
     && NC.includes('html body.league-themed .ep-nav .item.cg-key{ --kb:var(--league-a); --kink:var(--league-on-a,#fff); --kg:var(--league-a-ink,var(--league-a)) }')
     && NC.includes('html body.league-themed .ep-nav .item.cg-key.cg-alt{ --kg:var(--league-b-ink,var(--league-a-ink)) }'));
}
ok('the games strip goes to the system\'s league as the script loads, never showing every league\'s games under its name',
   /const S0 = root\.EpinoiaConferences && root\.EpinoiaConferences\.system\(new URLSearchParams\(location\.search\)\.get\('college'\)\);\s*if \(S0\) pointStrip\(\{ slug: sidePicked\(S0\)\.slug, league: null \}\);/.test(CJ)
   && /PART = sidePicked\(SYS\);/.test(CJ));
const M71 = readFileSync(path.join(here, '..', 'migrations', '0271_usports_logo_colours.sql'), 'utf8');
ok('0271: U SPORTS is black and its leaf\'s red, chosen by hand so a later logo read keeps them',
   /set colour_a = '#000000', colour_b = '#ff3e2d', colour_source = 'manual'\s+where slug = 'u-sports';/.test(M71));

if (fail) { console.log(`\n${fail} failed, ${pass} passed`); process.exit(1); }
console.log(`\ncollege hub: ${pass} passed - the hub, the map, the rail, a conference's pages and the system's search`);
