/* ============================================================================
   THE CLUB AND PLAYER PAGES IN GROUPS -- epinoia/secgroups.js, kit/secgroups.css (Louie, 2026-10-15): in place of ON
   THIS PAGE, HOME's buttons and cards; tabs on a desktop, HOME's Tabs / Scroll switch on a phone.

     1. the club page's groups, in Louie's order, each holding exactly the sections he named
     2. the player page's groups, the same
     3. secgroups.js: tabs from 721px, HOME's phone key, a group with nothing showing has no button, an address opens its tab
     4. team.js draws the events, the shot zones and the players' table into their own groups
     5. ON THIS PAGE steps aside on these pages; the four keys at the foot step aside wherever the phone's bar of tabs shows
     6. the position breakdown: "position breakdown calculated" and a '?' that says how and where it goes wrong
     7. the phone hero: the court beside the spec panel

     node supabase/tests/profile-groups.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); }
};

/* each group of a page: its key, its name and the headings inside it, in order */
function groupsOf(html) {
  const at = html.indexOf('class="pgrp-root"');
  if (at < 0) return [];
  const body = html.slice(at);
  const starts = [...body.matchAll(/<div class="pgrp-group" data-pgrp-key="([^"]+)" data-pgrp-name="([^"]+)">/g)];
  return starts.map((m, i) => {
    const chunk = body.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : undefined);
    return { key: m[1], name: m[2].replace(/&amp;/g, '&'), heads: [...chunk.matchAll(/<h2>([^<]+)<\/h2>/g)].map(x => x[1].replace(/&amp;/g, '&')),
             ids: [...chunk.matchAll(/ id="([^"]+)"/g)].map(x => x[1]) };
  });
}

console.log('\n1. the club page');
const TI = rd('epinoia', 't', 'index.html');
{
  const g = groupsOf(TI);
  const want = [
    ['Main stats', ['Team statistics', 'Clutch time']],                          // the four factors and the season line are team statistics' cards
    ['Events', ['Events']],
    ['Players', ['Player statistics', 'Roster']],
    ['Shot chart', ['Shot chart', 'Shot zones']],
    ['Depth chart', ['Depth chart', 'Rotations']],
    ['Results & fixtures', ['Results & fixtures']],
    ['Lineups', ['With or without', 'Lineup filter', 'Most-used lineups', 'Every lineup']],
    ['Shot clock analysis', ['Shot clock analysis']],
    ['Home venue & contact', ['Home venue & contact']]
  ];
  ok('nine groups, in Louie\'s order', JSON.stringify(g.map(x => x.name)) === JSON.stringify(want.map(w => w[0])), g.map(x => x.name).join(' / '));
  want.forEach(([n, heads], i) => ok(n + ': ' + heads.join(', '), g[i] && JSON.stringify(g[i].heads) === JSON.stringify(heads), g[i] && g[i].heads.join(' / ')));
  ok('the profile\'s body is the groups\' root, so the Video, report and Front office tabs still hide it', /<div id="tbody" class="pgrp-root" data-pgrp="t">/.test(TI) &&
     /body\.vtab #tbody\{display:none\}/.test(TI));
  const every = ['teamstats', 'clutchHdr', 'teamclutch', 'teamevents', 'teamplayers', 'roster', 'teamshots', 'teamzones', 'teamdepth', 'teamrot', 'games',
    'wowy', 'lufilter', 'lucards', 'lulist', 'teamclock', 'venue'];
  ok('every section team.js draws into is in a group', every.every(id => g.some(x => x.ids.includes(id))), every.filter(id => !g.some(x => x.ids.includes(id))).join(','));
}

console.log('\n2. the player page');
const PI = rd('epinoia', 'p', 'index.html');
{
  const g = groupsOf(PI);
  const want = [
    ['Full advanced stats', ['League percentile', 'Clutch time']],             // first, and the default tab (Louie, 2026-10-15)
    ['Career stats', ['Career stats']],
    ['Events', ['Events']],
    ['Game log', ['Game log']],
    ['Shot chart', ['Shot chart']],
    ['On the floor with', ['On the floor with']]
  ];
  ok('six groups, in Louie\'s order', JSON.stringify(g.map(x => x.name)) === JSON.stringify(want.map(w => w[0])), g.map(x => x.name).join(' / '));
  want.forEach(([n, heads], i) => ok(n + ': ' + heads.join(', '), g[i] && JSON.stringify(g[i].heads) === JSON.stringify(heads), g[i] && g[i].heads.join(' / ')));
  ok('Full advanced stats opens first: the first group is the default, and the page\'s version sets aside a tab chosen before',
     g[0] && g[0].key === 'advanced' && /<div id="pbody" class="pgrp-root" data-pgrp="p" data-pgrp-v="2">/.test(PI) &&
     /const TAB_KEY = 'pgrp_tab_' \+ kind \+ \(ver \? '_v' \+ ver : ''\)/.test(rd('epinoia', 'secgroups.js')) &&
     /if \(!vis\.some\(x => x\.key === k\)\) k = vis\.length \? vis\[0\]\.key : null;/.test(rd('epinoia', 'secgroups.js')));
  ok('the video and report panels stay outside the groups, and their tabs hide the grouped body',
     PI.indexOf('id="videosec"') < PI.indexOf('class="pgrp-root"') && PI.indexOf('id="reportsec"') < PI.indexOf('class="pgrp-root"') &&
     /body\.vtab #pbody, body\.rptab #pbody\{display:none\}/.test(PI));
}

console.log('\n3. secgroups.js');
const SG = rd('epinoia', 'secgroups.js'), SC = rd('epinoia', 'kit', 'secgroups.css');
{
  ok('a desktop is tabs from 721px, as HOME is', /matchMedia\('\(min-width: 721px\)'\)/.test(SG) && /@media \(min-width:721px\)\{\s*html\.pgrp-tabs \.pgrp-group\.pgrp-off\{display:none !important\}/.test(SC));
  ok('a phone has HOME\'s Tabs / Scroll switch and HOME\'s choice (one for the whole site), Scroll until chosen',
     /const MODE_KEY = 'hm_phone_mode';/.test(SG) && /\[\['tabs', 'Tabs'\], \['scroll', 'Scroll'\]\]/.test(SG) && /let phoneTabs = get\(MODE_KEY\) === 'tabs';/.test(SG) &&
     /\.pgrp-mode\{display:none\}\s*@media \(max-width:720px\)\{\s*\.pgrp-mode\{display:inline-flex/.test(SC));
  ok('a group with no heading showing has no button and no head; a folded one is measured unfolded', /x\.btn\.hidden = !x\.on/.test(SG) && /x\.head\.hidden = !x\.on/.test(SG) &&
     /if \(folded\) x\.g\.classList\.remove\('pgrp-folded'\);/.test(SG));
  ok('an address naming a section opens the tab that holds it', /function fromHash\(go\)/.test(SG) && /x\.g\.contains\(t\)/.test(SG));
  ok('a tab change tells the SKIP key (epinoia:sections) and lets charts measure again (resize)', /new Event\('epinoia:sections'\)/.test(SG) && /new Event\('resize'\)/.test(SG));
  ok('its own prefix: the suggest-an-edit sheet owns sg-', !/\bsg-/.test(SG.replace(/\/\*[\s\S]*?\*\//g, '')) && !/\.sg-/.test(SC));
  ok('both pages load the sheet and the script', [TI, PI].every(h => /href="\.\.\/kit\/secgroups\.css\?v=\d+"/.test(h) && /src="\.\.\/secgroups\.js\?v=\d+" defer/.test(h)));
}

console.log('\n4. team.js');
const TJ = rd('epinoia', 't', 'team.js');
{
  const ts = TJ.slice(TJ.indexOf('async function teamStats('), TJ.indexOf('async function zoneStats('));
  ok('the events, the shot zones and the players\' table each draw into their own section', /const STAT_PARTS = \[\['#teamevents', '#teameventsSec'\], \['#teamzones', '#teamzonesSec'\], \['#teamplayers', '#teamplayersSec'\]\];/.test(TJ) &&
     /const evHost = statPart\(0\)/.test(ts) && /const zh = statPart\(1\);/.test(ts) && /\(statPart\(2\) \|\| host\)\.appendChild\(sub\);/.test(ts));
  ok('each emptied and hidden at every draw, and shown once it has something', /STAT_PARTS\.forEach\(\(\[h, s\]\) => \{ const n = \$\(h\), w = \$\(s\); if \(n\) n\.textContent = ''; if \(w\) w\.hidden = true; \}\);/.test(ts) &&
     /if \(sec\) sec\.hidden = false;/.test(TJ));
  ok('a failed load empties them too', /\['#roster', '#games', '#teamstats', '#teamevents', '#teamzones', '#teamplayers'\]/.test(TJ));
}

console.log('\n5. one index, one bar');
{
  ok('ON THIS PAGE steps aside where the groups are', /html\.pgrp-page \.tt-index\{display:none !important\}/.test(SC));
  const TT = rd('epinoia', 'kit', 'teletext.css'), NAV = rd('epinoia', 'kit', 'nav.css');
  ok('the four keys at the foot are not drawn where the phone\'s bar of tabs shows (820px and under)',
     /@media \(max-width:820px\)\{ \.tt-fast\{ display:none \} \}/.test(TT) && /@media \(max-width:820px\)\{[\s\S]{0,80}\.ep-nav \.ep-tabbar\{ display:flex/.test(NAV));
}

console.log('\n6. the position breakdown');
const PJ = rd('epinoia', 'p', 'player.js');
{
  ok('"position breakdown calculated", and a \'?\' beside it', /el\('span', null, 'position breakdown calculated'\)/.test(PJ) && /el\('button', 'ip-q', '\?'\)/.test(PJ));
  const why = PJ.slice(PJ.indexOf('const POS_WHY = ['), PJ.indexOf('];', PJ.indexOf('const POS_WHY = [')));
  ok('the card says it is the BPM position estimate, worked out again each time, and when it goes wrong',
     /BPM model estimates/.test(why) && /worked out again/.test(why) && /When it can be wrong/.test(why) && /a guide, not a record/.test(why));
  ok('in words that fit a women\'s league\'s profile too: no he, his or him', !/\b(he|his|him)\b/i.test(why), (why.match(/.{20}\b(he|his|him)\b.{10}/i) || [''])[0]);
  ok('a hover opens it where there is a mouse; a press pins it; a press elsewhere or Escape closes it',
     /\(hover: hover\) and \(pointer: fine\)/.test(PJ) && /q\.addEventListener\('mouseenter'/.test(PJ) && /if \(pinned\) \{ pinned = false; over = false; \} else pinned = true;/.test(PJ) &&
     /e\.key === 'Escape' && POS_WHY_OPEN/.test(PJ));
  ok('open, the hero sits above what follows it', /\.idband:has\(\.ip-why:not\(\[hidden\]\)\)\{position:relative;z-index:40\}/.test(PI));
  const I = ['ja', 'es'].map(c => rd('epinoia', 'i18n', c + '.js'));
  ok('Japanese and Spanish carry the label and the card', I.every(s => s.includes("'position breakdown calculated':") && s.includes("'When it can be wrong':") &&
     s.includes("'Main stats':") && s.includes("'Full advanced stats':") && s.includes("'Player statistics':")));
}

console.log('\n7. the phone hero');
{
  const PH = rd('epinoia', 'kit', 'playerhero.css');
  const phone = PH.slice(PH.indexOf('@media (max-width:640px){'));
  ok('three columns: the portrait, the name, the court', /\.idband\{grid-template-columns:104px minmax\(0,1fr\) clamp\(128px,40vw,172px\)/.test(phone));
  ok('the court beside the spec panel and the season, not under everything', /\.idband > \.idpos\{grid-column:3;grid-row:3 \/ span 2/.test(phone) &&
     /\.idmeta \.vitals\{grid-column:1 \/ 3;grid-row:3/.test(phone) && /\.idmeta \.idseason\{grid-column:1 \/ 3;grid-row:4/.test(phone));
  ok('the spec panel two by two; three figures put the third across', /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(phone) &&
     /\.idmeta \.vitals:not\(:has\(> \.vit:nth-child\(4\)\)\) > \.vit:nth-child\(3\)\{grid-column:1 \/ -1\}/.test(phone));
  ok('no court: the panel takes the width', /\.idband:not\(:has\(> \.idpos:not\(\[hidden\]\)\)\) \.idmeta \.vitals\{grid-column:1 \/ -1/.test(phone));
  ok('the old stacked rule is gone', !/@media \(max-width:640px\)\{ \.idband > \.idpos\{grid-column:1 \/ -1/.test(PI));
}

console.log('\n8. a league\'s front page (Louie, 2026-10-15)');
{
  const LI = rd('epinoia', 'index.html');
  const at = LI.indexOf('class="pgrp-root"');
  const body = LI.slice(at);
  const starts = [...body.matchAll(/<div class="pgrp-group" data-pgrp-key="([^"]+)" data-pgrp-name="([^"]+)">/g)];
  const g = starts.map((m, i) => {
    const chunk = body.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : undefined);
    return { key: m[1], name: m[2].replace(/&amp;/g, '&'), secs: [...chunk.matchAll(/<(?:div|section) class="sec[^"]*" id="([^"]+)"/g)].map(x => x[1]) };
  });
  const want = [
    ['Games', ['lgGamesSec']],
    ['Feed & video', ['newsSec', 'storySec', 'videoSec', 'creatorsSec']],
    ['Clubs', ['clubsSec']],
    ['Stars', ['totySec', 'fvSec', 'starsSec']],
    ['Records', ['recordsSec']],
    ['Fixtures', ['gamesSec']],
    ['Table & leaders', ['seasonSec']],
    ['Take part', ['takepartSec', 'merchSec', 'socialSec']]
  ];
  ok('eight groups, in Louie\'s order', JSON.stringify(g.map(x => x.name)) === JSON.stringify(want.map(w => w[0])), g.map(x => x.name).join(' / '));
  want.forEach(([n, ids], i) => ok(n + ': ' + ids.join(', '), g[i] && JSON.stringify(g[i].secs) === JSON.stringify(ids), g[i] && g[i].secs.join(',')));
  ok('only on a league\'s page: the platform\'s splash shares the document', /<div class="pgrp-root" id="lgMain" data-pgrp="l" data-pgrp-if="m-league">/.test(LI) &&
     /data-pgrp-if/.test(SG) && /doc\.documentElement\.classList\.contains\(c\)/.test(SG));
  ok('the old live and recent list is the Fixtures group\'s, headed so', /<h2>Fixtures<\/h2>/.test(LI) && !/<h2>Games<\/h2>/.test(LI));

  /* the strip */
  const strip = LI.slice(LI.indexOf('<nav class="hm-modes"'), LI.indexOf('</nav>', LI.indexOf('<nav class="hm-modes"')));
  ok('HOME\'s MAIN | VIDEO strip, MAIN and VIDEO only, marked as a league\'s', /<nav class="hm-modes" id="hmModes" aria-label="Main or video" data-scope="league">/.test(LI) &&
     /data-mode="main" aria-selected="true"/.test(strip) && /data-mode="video"/.test(strip) && !/data-mode="manager"/.test(strip) &&
     /<div class="vh" id="videoHub" role="tabpanel" aria-label="Video" hidden><\/div>/.test(LI));
  ok('under the games strip, above the groups', LI.indexOf('id="strip"') < LI.indexOf('id="hmModes"') && LI.indexOf('id="hmModes"') < LI.indexOf('id="lgMain"'));
  ok('the strip\'s sheet is shared with HOME (kit/modes.css), and both pages load it', /\.hm-modes\{/.test(rd('epinoia', 'kit', 'modes.css')) &&
     !/\.hm-modes\{/.test(rd('epinoia', 'kit', 'home.css')) && /href="kit\/modes\.css\?v=\d+"/.test(LI) && /href="\.\.\/kit\/modes\.css\?v=\d+"/.test(rd('epinoia', 'home', 'index.html')));
  const VM = rd('epinoia', 'home', 'vhmode.js'), VH = rd('epinoia', 'home', 'videohub.js'), HJ = rd('epinoia', 'home.js');
  ok('one switcher for both pages: its paths are its own folder\'s, and a league\'s strip hands VIDEO the league', /const withStamp = p => new URL\(p, DIR\)\.href/.test(VM) &&
     /api\.open\(hub, \{ base: ROOT, league: leagueOf\(\) \}\)/.test(VM) && /strip\.dataset\.scope !== 'league'/.test(VM) && /src="home\/vhmode\.js\?v=\d+" defer/.test(LI));
  ok('home.js puts the league on the strip once it knows it', /modes\.dataset\.league = JSON\.stringify\(\{ id: LEAGUE\.id, slug: LEAGUE\.slug, name: LEAGUE\.name \}\)/.test(HJ));
  ok('VIDEO, a league\'s: only its games live and scheduled, only its videos, no leagues\' strip', /const fixedLg = !team && opts && opts\.league/.test(VH) &&
     /\(!team \|\| isTeam\(g\)\) && inLg\(g\)\) : \[\]/.test(VH) && /g\.status === 'scheduled' && \(!team \|\| isTeam\(g\)\) && inLg\(g\)/.test(VH) &&
     /league = fixedLg, followedLg/.test(VH) && /if \(!STRIP\[k\] \|\| team \|\| fixedLg\) \{ lgs\.hidden = true; return; \}/.test(VH));
  ok('the LIVE mark on a league\'s strip counts its own streams', /setLive\(lg \? all\.filter\(g => g && g\.league/.test(VM));

  /* the games */
  const LG = rd('epinoia', 'leaguegames.js'), LC = rd('epinoia', 'kit', 'leaguegames.css');
  ok('GAMES: HOME\'s live, upcoming and results for the league alone, eight cards', /G = GG\.scoped \? GG\.scoped\(\{ only: \[league\.id\] \}\) : GG;/.test(LG) &&
     /const N = 8,/.test(LG) && /G\.card\(g, \{ base: '', now: data\.now, state: data\.state\[g\.id\], badge: false \}\)/.test(LG) &&
     /data-fx="live"[^>]*hidden/.test(LI) && /data-fx="up"/.test(LI) && /data-fx="res"/.test(LI));
  ok('...two rows of four on a desktop, HOME\'s strip on a phone', /@container lgg \(min-width:616px\)\{ \.lgg \.fxc-rail\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\} \}/.test(LC) &&
     /@media \(min-width:721px\)\{\s*\.lgg \.lg-mount\{container:lgg \/ inline-size\}/.test(LC));
  ok('...SHOW ALL GAMES is the league\'s fixtures page', /all\.href = 'fixtures\/\?l=' \+ encodeURIComponent\(league\.slug\)/.test(LG) && /id="lgGamesAll" href="fixtures\/">show all games →</.test(LI));
  ok('...started by home.js once it knows the league, and hidden with the fixtures behind a wall', /window\.EpinoiaLeagueGames\.mount\(\{ league: LEAGUE \}\)/.test(HJ) &&
     /const lg = \$\('#lgGamesSec'\); if \(lg\) lg\.classList\.add\('hide'\);/.test(HJ));
  ok('the page loads what the groups and the games need', ['kit/fxc.css', 'kit/leaguegames.css', 'kit/secgroups.css'].every(h => LI.includes('href="' + h + '?v=')) &&
     ['globalgames.js', 'leaguegames.js', 'secgroups.js'].every(s => LI.includes('src="' + s + '?v=')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
