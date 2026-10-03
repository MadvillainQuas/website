// THE PROFILE DASHBOARD's browser side (epinoia/profile/dashboard.js, profile/index.html, kit/profile.css), with no
// browser. What is held here:
//   * the head: the fan's title or the page's, the five banners, a banner nobody offers read as the glow;
//   * the reports: their kinds in words, the day in words, the size, NEW until opened, the file's own name;
//   * a club's last result from its own side, a player's line (minutes stored as milliseconds), their latest game;
//   * at a glance: new reports first and lit only when there are some;
//   * the page: built to the standard, every section the dashboard fills present and away until filled, the reports
//     opened through a short signed link and marked, the head saved through 0224 and the follows read from fan_prefs;
//   * the look: the title paints whole (its background has the kit's two layers, the shine and then the colour, so the
//     shine's size and sweep never take the colour off the letters: it once showed as "YOUR DAS"), in the fan's own hue
//     held to a lightness that reads on a light and on a dark page, and the small layout fixes that came with it.
//
//   node supabase/tests/dashboard-ui.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const D = createRequire(import.meta.url)(path.join(ROOT, 'epinoia', 'profile', 'dashboard.js'));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw))); } };

console.log('\nthe head');
ok('no title of their own: the page\'s', D.titleOf({}) === 'Your dashboard' && D.titleOf({ dash_title: '   ' }) === 'Your dashboard' && D.titleOf(null) === 'Your dashboard');
ok('theirs when they chose one', D.titleOf({ dash_title: 'Sam’s scouting desk' }) === 'Sam’s scouting desk');
ok('five banners, as 0224 allows them', D.BANNERS.map(b => b[0]).join() === 'glow,plain,stripes,grid,club');
ok('a banner nobody offers reads as the glow', D.bannerOf({ dash_banner: 'neon' }) === 'glow' && D.bannerOf({ dash_banner: 'club' }) === 'club' && D.bannerOf(null) === 'glow');
ok('an initial for a fan with no picture', D.initialOf('@sam_hoops') === 'S' && D.initialOf('élodie') === 'É' && D.initialOf('') === '·');
ok('/me/\'s swatches, so both pages offer the same colours', readFileSync(path.join(ROOT, 'epinoia', 'me', 'me.js'), 'utf8').includes("const SWATCHES = ['" + D.SWATCHES.join("', '") + "'];"));

console.log('\nthe reports');
ok('each kind in words', D.kindOf('game').label === 'Game analysis' && D.kindOf('opp').label === 'Scouting report' && D.kindOf('team').label === 'Team report' && D.kindOf('x').label === 'Report');
const now = new Date('2026-10-04T12:00:00Z').getTime();
ok('the day in words: today, yesterday, then the date, with the year only when it is not this one',
   D.dayWords('2026-10-04T08:00:00Z', now) === 'Today' && D.dayWords('2026-10-03T09:00:00Z', now) === 'Yesterday' &&
   /2 Oct/.test(D.dayWords('2026-10-02T09:00:00Z', now)) && !/2026/.test(D.dayWords('2026-10-02T09:00:00Z', now)) && /2025/.test(D.dayWords('2025-12-30T09:00:00Z', now)),
   [D.dayWords('2026-10-02T09:00:00Z', now), D.dayWords('2025-12-30T09:00:00Z', now)]);
ok('the size', D.sizeWords(1840000) === '1.8 MB' && D.sizeWords(960000) === '960 KB' && D.sizeWords(0) === '' && D.sizeWords(null) === '');
ok('NEW until it is opened', D.isNew({ seen_at: null }) && !D.isNew({ seen_at: '2026-10-04T10:00:00Z' }));
ok('a download keeps the file\'s own name', D.fileName({ path: 'abc/2026-10-04/scouting-report-sydney-kings.pdf' }) === 'scouting-report-sydney-kings.pdf');

console.log('\nthe follows');
const g = { home: { id: 'H', short_name: 'ILL' }, away: { id: 'A', short_name: 'ADL' }, home_score: 114, away_score: 94 };
const rh = D.resultOf(g, 'H'), ra = D.resultOf(g, 'A');
ok('a result from the club\'s own side: its score first, won or lost, home or away', rh.won && rh.us === 114 && rh.them === 94 && rh.home && rh.opp === 'ADL' &&
   !ra.won && ra.us === 94 && ra.them === 114 && !ra.home && ra.opp === 'ILL');
ok('no score, no result', D.resultOf({ home: { id: 'H' }, away: { id: 'A' } }, 'H') === null);
ok('a line: points, rebounds (both ends), assists, minutes (stored as milliseconds)', D.lineOf({ pts: 28, or: 1, dr: 4, ast: 3, min: 1804000 }) === '28 PTS · 5 REB · 3 AST · 30 MIN');
ok('...minutes already in minutes read as they are; none is left out', D.lineOf({ pts: 9, ast: 2, min: 21 }) === '9 PTS · 2 AST · 21 MIN' && D.lineOf({ pts: 0, or: 0, dr: 1, ast: 1, min: 0 }) === '0 PTS · 1 REB · 1 AST');
const lines = D.latestLines([
  { player_uuid: 'p1', s_pts: 10, games: { tipoff_at: '2026-09-25T09:00Z', status: 'final' } },
  { player_uuid: 'p1', s_pts: 22, games: { tipoff_at: '2026-10-02T09:00Z', status: 'final' } },
  { player_uuid: 'p1', s_pts: 4, games: { tipoff_at: '2026-10-03T09:00Z', status: 'live' } },
  { player_uuid: 'p2', s_pts: 7, games: { tipoff_at: '2026-09-28T09:00Z', status: 'final' } }]);
ok('each player\'s latest final game, never one still being played', lines.p1.s_pts === 22 && lines.p2.s_pts === 7);

ok('a line comes as pieces too (a number and its label), so a narrow screen wraps between them', JSON.stringify(D.lineBits({ pts: 28, or: 1, dr: 4, ast: 3, min: 1804000 })) ===
   JSON.stringify([{ n: '28', k: 'PTS' }, { n: '5', k: 'REB' }, { n: '3', k: 'AST' }, { n: '30', k: 'MIN' }]) && D.lineBits(null).length === 0 && D.lineBits({}).length === 0);

console.log('\nat a glance');
const gl = D.glance({ reports: 4, newReports: 2, leagues: 1, clubs: 2, players: 0 });
ok('new reports first and lit; then the follows, singular where it is one', gl[0].href === '#reports' && gl[0].hot && gl[0].label === 'new reports' &&
   gl[1].label === 'league' && gl[2].label === 'clubs' && gl[3].n === 0 && gl[3].label === 'players');
ok('no reports to have: no reports tile', D.glance({ leagues: 0, clubs: 0, players: 0 }).every(t => t.href !== '#reports'));
ok('all opened: the tile stays, unlit', D.glance({ reports: 3, newReports: 0 })[0].hot === false);

console.log('\nthe page');
{
  const html = readFileSync(path.join(ROOT, 'epinoia', 'profile', 'index.html'), 'utf8');
  const js = readFileSync(path.join(ROOT, 'epinoia', 'profile', 'dashboard.js'), 'utf8');
  const css = readFileSync(path.join(ROOT, 'epinoia', 'kit', 'profile.css'), 'utf8');
  ok('built to the page standard: data-std, the head with its h1 and line', /class="ep-frame" id="profile" data-std/.test(html) && /<header class="hero pg-head" id="dashHead" data-banner="glow">/.test(html));
  ok('every section the dashboard fills is there and away until it is filled', ['reports', 'soon', 'leagues', 'clubs', 'players'].every(id => new RegExp('<section class="sec hide" id="' + id + '"').test(html)));
  ok('...and the public page, the username and the page editor are kept', ['public', 'username', 'fanprofile'].every(id => html.includes('id="' + id + '"')));
  ok('the scripts it reads: the fixture cards, playerMeta, then the dashboard before profile.js, nav.js last',
     ['globalgames.js', 'data.js'].every(s => html.includes(s)) && html.indexOf('src="dashboard.js?') > 0 &&
     html.indexOf('src="dashboard.js?') < html.indexOf('src="profile.js?') && html.indexOf('src="profile.js?') < html.indexOf('src="../nav.js?'));
  ok('a report opens through a five-minute signed link to the private file, then is marked opened',
     /storage\.from\('reports'\)/.test(js) && /createSignedUrl\(f\.path, 300/.test(js) && /rpc\('report_seen', \{ p_ids:/.test(js));
  ok('...the tab opened in the click itself, so no pop-up blocker stops it', /w = root\.open\('', '_blank'\)/.test(js));
  ok('the head is saved through 0224 (title, banner) and the fan\'s own row (colour, look)', /rpc\('set_dashboard', \{ p_title:/.test(js) && /rpc\('set_fan_prefs', \{ p: \{ colour: draft\.colour, theme: draft\.theme \} \}\)/.test(js));
  ok('the follows are fan_prefs\' own lists, checked before they reach a query', /fav_league_ids/.test(js) && /fav_team_ids/.test(js) && /fav_player_ids/.test(js) && /const ids = v => \(Array\.isArray\(v\) \? v : \[\]\)\.filter\(x => UUID\.test/.test(js));
  ok('no address of theirs (or no 0225): no reports section at all', /if \(r\.error \|\| !r\.data \|\| !r\.data\.linked\) return;/.test(js));
  ok('every banner has its look, and the reduced-motion reader gets no pulse', ['glow', 'stripes', 'grid', 'club', 'plain'].every(b => css.includes('#dashHead[data-banner="' + b + '"]')) &&
     /prefers-reduced-motion:reduce\)\{\.rep-new\{animation:none\}/.test(css));
  ok('the banner stays inside the head (no sideways scroll on a phone)', /#dashHead::before\{content:"";position:absolute;inset:0;/.test(css));
}

console.log('\nthe look');
{
  const css = readFileSync(path.join(ROOT, 'epinoia', 'kit', 'profile.css'), 'utf8');
  const tt = readFileSync(path.join(ROOT, 'epinoia', 'kit', 'teletext.css'), 'utf8');
  const html = readFileSync(path.join(ROOT, 'epinoia', 'profile', 'index.html'), 'utf8');
  const js = readFileSync(path.join(ROOT, 'epinoia', 'profile', 'dashboard.js'), 'utf8');
  /* a rule's background-image as the list of its top-level layers */
  const layers = decl => { const body = /background-image:([^;}]*(?:\([^)]*\)[^;}]*)*)/.exec(decl)[1]; let d = 0, cur = '', out = [];
    for (const ch of body) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out.filter(Boolean); };
  const kit = /\.ep-frame > \.hero h1\{\s*background-image:([\s\S]*?);\s*background-size:([^;]*);/.exec(tt);
  const mine = /#dashHead h1\{([\s\S]*?)\}/.exec(css);
  const kitLayers = kit ? layers('background-image:' + kit[1]) : [], myLayers = mine ? layers(mine[1]) : [];
  ok('THE TITLE has as many background layers as the kit\'s title it sits on: a shine, then the colour (one layer took the shine\'s 260% size and was swept off the letters)',
     kitLayers.length === 2 && myLayers.length === kitLayers.length && /^linear-gradient\(104deg,transparent 0 44%/.test(myLayers[0]) && /rgba\(255,255,255,\.78\)/.test(myLayers[0]), [kitLayers.length, myLayers]);
  ok('...the colour layer is the fan\'s, in the ink the page can read, not a hue-sweeping mix', /^linear-gradient\(100deg,var\(--dash-ink\),var\(--dash-ink-2\)\)$/.test(myLayers[1] || '') && !/color-mix\(in oklch,var\(--dash-c\)/.test(css), myLayers[1]);
  ok('...and it does not restyle the size, position or animation the kit gives that title (so the shine still crosses it)', !/#dashHead h1\{[^}]*background-(size|position|repeat)|#dashHead h1\{[^}]*animation/.test(css));
  ok('the ink keeps the hue and holds the lightness: never paler than .52 on a light page, never darker than .76 on a dark one',
     /@supports \(color:oklch\(from red l c h\)\)/.test(css) && /--dash-ink:oklch\(from var\(--dash-c\) max\(l,\.76\) c h\)/.test(css) &&
     /:root\[data-theme="light"\] #dashHead\{--dash-ink:oklch\(from var\(--dash-c\) min\(l,\.52\) c h\)/.test(css));
  ok('...with a fallback for browsers without relative colours (mixed in oklab, which keeps the hue)', /#dashHead\{--dash-ink:color-mix\(in oklab,var\(--dash-c\) 55%,var\(--ink\)\);--dash-ink-2:color-mix\(in oklab,var\(--dash-c\) 32%,var\(--ink\)\)\}/.test(css));
  ok('the text and lines that wear the colour use the ink (the handle, the ring and its letter, the lit tile), the fill keeps the pick',
     /\.pg-kick a\{color:var\(--dash-ink\)\}/.test(css) && /\.dash-av\{[^}]*border:2px solid var\(--dash-ink\)[^}]*color:var\(--dash-ink\)/.test(css) && /\.dash-gl\.hot b\{color:var\(--dash-ink\)\}/.test(css));
  const sub = (/<p class="pg-sub">([^<]*)<\/p>/.exec(html) || [])[1] || '';
  ok('the line under the title is short enough for one line on a desktop, and balances where it wraps', sub.length > 0 && sub.length <= 72 && /#dashHead \.pg-sub\{text-wrap:balance\}/.test(css), sub);
  ok('a section\'s link goes on the line under the subtitle (page.css\'s 70ch cap had let it slip beside it and off-centred the subtitle)', /#profile \.sec-h \.note\{max-width:none\}/.test(css));
  ok('"personalisation" is a button like its neighbour: no underline', /#dashHead \.pg-acts \.ep-btn\{text-decoration:none\}/.test(css));
  ok('a player\'s tile: the line in pieces that wrap whole, then where and when on a line of its own', /el\('span', 'dash-line'\)/.test(js) && /lineBits\(s\)/.test(js) && /el\('span', 'dash-when'/.test(js) &&
     /\.dash-line>span\{white-space:nowrap/.test(css));
  ok('the club banner is a soft wash (a white second colour no longer streaks it grey)', /#dashHead\[data-banner="club"\]::before\{background:linear-gradient\(100deg,color-mix\(in srgb,var\(--dash-c1\) 40%,transparent\),color-mix\(in srgb,var\(--dash-c2\) 22%,transparent\) 70%,transparent\)/.test(css));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
