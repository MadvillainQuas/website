/* ============================================================================
   THE PLAYER PROFILE'S SHOT ZONES TABLE (shotchart.js zoneRows / zoneTableHTML, kit/shotchart.css; 2026-10-02).

     node supabase/tests/zone-table.test.mjs

   The table under a player's shot chart was a plain grid of numbers. It now wears the club page's table dress (a
   heading row over each group, the zone's swatch, the share of the shots as a bar) and its FG% and eFG% are pills
   COLOURED AS THE COURT IS: the same diverging scale against the same break-even, with the gap under each. Held here:
     * each row's break-even: its kind's for a zone, the attempt-weighted mix for a cut of several kinds, and the eFG
       one counting a three as one and a half makes (35% from three is 52.5% eFG);
     * the pill's band is the court's (bandAt: grey within two points, three steps a side);
     * a row under the attempt floor is hatched, not coloured; a row with no attempts is a dash;
     * per-game columns where the games are known (the table then lays five figures to a phone line), made and missed
       where they are not; the key and the note say what the colours are;
     * the stylesheet has the pills in the court's own palette, and the cards under 600px of the table's own width.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + JSON.stringify(d).slice(0, 400) : '')); } };
const near = (a, b) => a != null && Math.abs(a - b) < 1e-9;

const SC = require(path.join(ROOT, 'epinoia', 'shotchart.js'));
/* shots on the 1500 x 1400 cm court (x, y as fractions): at the rim, the left corner three, the top of the key */
const shot = (xcm, ycm, three, made) => ({ x: xcm / 1500, y: ycm / 1400, three: !!three, made: !!made });
const shots = [];
for (let i = 0; i < 16; i++) shots.push(shot(750, 170, false, i < 10));          // at the rim: 10 of 16 (62.5%)
for (let i = 0; i < 12; i++) shots.push(shot(30, 100, true, i < 5));             // left corner three: 5 of 12 (41.7%)
for (let i = 0; i < 2; i++) shots.push(shot(750, 700, false, i < 1));            // top mid: 1 of 2
ok('the shots fall in the zones this test means', SC.zoneOf(750, 170, false) === 'ra' && SC.zoneOf(30, 100, true) === 'c3l' && SC.zoneOf(750, 700, false) === 'tm');

console.log('\neach row\'s break-even');
const R = SC.zoneRows(shots, 4);
const row = k => R.groups.concat(R.big).find(r => r.k === k);
ok('a zone holds its kind\'s break-even: the rim 58, top mid 40, corner three 35', row('rim').be === 58 && row('topm').be === 40 && row('c3').be === 35);
ok('...and its eFG break-even counts a three as one and a half makes (52.5), a two as one', row('c3').beE === 52.5 && row('rim').beE === 58);
ok('a cut of several kinds is held to the mix it was shot from: every shot = (16 x 58 + 12 x 35 + 2 x 40) / 30',
   near(row('all').be, (16 * 58 + 12 * 35 + 2 * 40) / 30) && near(row('all').beE, (16 * 58 + 12 * 52.5 + 2 * 40) / 30), [row('all').be, row('all').beE]);
ok('...a cut with no attempts: its kind\'s number where it has one kind, none where it has several',
   row('w3').be === 35 && row('t3').be === 35 && row('right').be === null, [row('w3').be, row('right').be]);
ok('the court\'s band against any break-even: grey within two, then 6 and 12 points a step',
   SC.bandAt(59.9, 58) === 0 && SC.bandAt(62.5, 58) === 1 && SC.bandAt(41.7, 35) === 2 && SC.bandAt(20, 35) === -3 && SC.band(62.5, 'paint') === 1);

console.log('\nthe table');
const H = SC.zoneTableHTML(R, { minAttempts: 3, colour: '#c8102e' });
const tr = label => (H.match(new RegExp('<tr class="r[^"]*"(?: data-k="[a-z]+")?><th class="l" scope="row" data-i18n-ctx="zone">(<i class="scz-sw [^"]+"></i>)?' + label + '</th>.*?</tr>')) || [''])[0];
ok('the club page\'s dress: a heading row over each group, the zone\'s swatch by kind, the share as a bar, in the club\'s colour',
   /<tr class="scz-gh"><th colspan="7">every zone<\/th><\/tr>/.test(H) && /<tr class="scz-gh"><th colspan="7">the larger cuts<\/th><\/tr>/.test(H) &&
   /<i class="scz-sw k-paint"><\/i>at the rim/.test(H) && /<i class="scz-sw k-three"><\/i>corner 3/.test(H) && /class="scz-bar"><i style="width:/.test(H) &&
   /class="scz-wrap" data-i18n-ctx="zonetable" style="--scz-a:#c8102e"/.test(H));
ok('at the rim: 10/16, its FG% a pill a step above its break-even, the gap under it',
   /10\/16/.test(tr('at the rim')) && /<span class="scz-pill bp1" title="break-even 58.0%">62.5<\/span><span class="scz-be"><b>\+4\.5<\/b><span class="scz-bev"> v 58<\/span>/.test(tr('at the rim')), tr('at the rim'));
ok('the corner three: two steps above 35 on FG%, and its eFG% (62.5) against 52.5',
   /<span class="scz-pill bp2" title="break-even 35.0%">41\.7<\/span>/.test(tr('corner 3')) && /<span class="scz-pill bp2" title="break-even 52.5%">62\.5<\/span>/.test(tr('corner 3')), tr('corner 3'));
ok('top mid, 1 of 2: under the floor, hatched and not rated', /<span class="scz-pill few" title="fewer than 3 attempts: too few to rate">50\.0<\/span>/.test(tr('top mid')) &&
   !/scz-be/.test(tr('top mid')), tr('top mid'));
ok('a zone nobody shot from: dimmed, its percentages a dash', /<tr class="r none"/.test(tr('wing 3')) && /<span class="scz-pill nil">—<\/span>/.test(tr('wing 3')));
ok('every shot is the total row', /<tr class="r tot">/.test(tr('every shot')));
ok('with the games known: per-game columns, and the table says so for the phone layout',
   /<table class="scz pg">/.test(H) && /<th>att \/ g<\/th><th>made \/ g<\/th>/.test(H) && /per game over 4 games/.test(H));
const H0 = SC.zoneTableHTML(SC.zoneRows(shots, 0), { minAttempts: 3 });
ok('...without them: made and missed, no per-game columns, five columns of heading', /<table class="scz">/.test(H0) && /<th>missed<\/th>/.test(H0) &&
   !/att \/ g/.test(H0) && /colspan="6"/.test(H0) && !/--scz-a/.test(H0));
ok('the key and the note say what the colours are', /class="scz-key"><span class="rl">below break-even<\/span><i class="bm3"><\/i>/.test(H) &&
   /fewer than 3 attempts/.test(H) && /coloured as the court is: against the zone’s break-even \(paint 58%, mid-range 40%, three 35%\)/.test(H));
ok('the player page draws it with the chart\'s own floor and colour', /zoneTableHTML\(zoneRows\(all, games\), \{ minAttempts: o\.minAttempts, colour: o\.colour \}\)/.test(rd('epinoia', 'shotchart.js')));

console.log('\nthe table in parts (2026-10-03)');
{
  const names = list => list.map(p => (p.title || '-') + ':' + p.rows.map(r => r.k).join('+')).join(' | ');
  ok('every zone is cut into rim & paint, mid-range and threes, each kind its zones in order',
     names(SC.parts(R.groups, 'groups')) === 'rim & paint:rim+paint | mid-range:base+topm | threes:c3+w3+t3', names(SC.parts(R.groups, 'groups')));
  ok('the larger cuts are cut into the sides, the kinds of shot, and every shot alone under no heading',
     names(SC.parts(R.big, 'big')) === 'by side of the floor:left+centre+right | by kind of shot:atrim+jump+mid+three | -:all', names(SC.parts(R.big, 'big')));
  ok('the kinds colour their parts: paint, mid and three on the zone parts; the cuts\' parts have none',
     SC.parts(R.groups, 'groups').map(p => p.kind).join() === 'paint,mid,three' && SC.parts(R.big, 'big').every(p => p.kind === null));
  ok('a row the parts do not name goes last under no heading; a part with none of its rows is left out; no list gives none',
     names(SC.parts(R.groups.concat([{ k: 'odd' }]), 'groups')).endsWith('| -:odd') && names(SC.parts(R.groups.filter(r => r.k !== 'topm' && r.k !== 'base'), 'groups')) === 'rim & paint:rim+paint | threes:c3+w3+t3'
     && SC.parts(null, 'groups').length === 0 && SC.parts(R.groups, 'nothing').map(p => p.rows.length).join() === String(R.groups.length));
  ok('the three cuts that are a kind of shot wear it (rim & paint, all mid-range, all threes), so the swatch and the bar tie them to the zones above',
     row('atrim').kind === 'paint' && row('mid').kind === 'mid' && row('three').kind === 'three' && row('jump').kind === null && row('left').kind === null && row('all').kind === null);
  const kh = (H.match(/<tr class="scz-kh"[^>]*>.*?<\/tr>/g) || []);
  ok('the table has a heading row for each part, spanning the table, with the kind\'s swatch where it has a kind',
     kh.length === 5 && /^<tr class="scz-kh" data-k="paint"><th colspan="7" data-i18n-ctx="zone"><i class="scz-sw k-paint"><\/i>rim &amp; paint<\/th><\/tr>$/.test(kh[0].replace('rim & paint', 'rim &amp; paint')) &&
     /<tr class="scz-kh" data-k="mid"><th colspan="7" data-i18n-ctx="zone"><i class="scz-sw k-mid"><\/i>mid-range/.test(kh[1]) && /<tr class="scz-kh" data-k="three">.*threes/.test(kh[2]) &&
     /<tr class="scz-kh"><th colspan="7" data-i18n-ctx="zone">by side of the floor<\/th><\/tr>/.test(kh[3]) && /by kind of shot/.test(kh[4]), kh);
  ok('the headings are in order: every zone, its three parts, the larger cuts, its two',
     H.indexOf('every zone') < H.indexOf('rim &') && H.indexOf('rim &') < H.indexOf('>mid-range') && H.indexOf('>mid-range') < H.indexOf('threes') && H.indexOf('threes') < H.indexOf('the larger cuts') &&
     H.indexOf('the larger cuts') < H.indexOf('by side of the floor') && H.indexOf('by side of the floor') < H.indexOf('by kind of shot'));
  ok('every zone row carries its kind, so it sits on its colour\'s bar; every shot and the sides carry none',
     /<tr class="r" data-k="paint"><th class="l" scope="row" data-i18n-ctx="zone"><i class="scz-sw k-paint"><\/i>at the rim/.test(H) && /<tr class="r" data-k="three"><th class="l" scope="row" data-i18n-ctx="zone"><i class="scz-sw k-three"><\/i>corner 3/.test(H)
     && /<tr class="r tot"><th class="l"/.test(H) && /<tr class="r"><th class="l" scope="row" data-i18n-ctx="zone">left side/.test(H));
  ok('the table\'s rows are all still there, once (seven zones, eight cuts)', (H.match(/<tr class="r[ "]/g) || []).length === 15, (H.match(/<tr class="r[ "]/g) || []).length);
  const CSSp = rd('epinoia', 'kit', 'shotchart.css');
  ok('the stylesheet: the heading band with its wash, the kinds\' colours (the club\'s, 62%, 34% of it towards white), the bar on each row, and cards under 600px',
     /table\.scz \.scz-kh th\{/.test(CSSp) && /table\.scz tr\[data-k="mid"\]\{ --kc:color-mix\(in srgb,var\(--scz-a\) 62%,#fff\) \}/.test(CSSp) && /table\.scz tr\[data-k="three"\]\{ --kc:color-mix\(in srgb,var\(--scz-a\) 34%,#fff\) \}/.test(CSSp)
     && /table\.scz tr\.r\[data-k\] > th\.l\{ box-shadow:inset 3px 0 0 var\(--kc\) \}/.test(CSSp) && /table\.scz tr\.r\[data-k\]\{ box-shadow:inset 4px 0 0 var\(--kc\) \}/.test(CSSp));
  const team = rd('epinoia', 't', 'team.js'), CSSt = rd('epinoia', 'kit', 'clubstats.css');
  ok('the club page\'s zone table is cut by the same parts (SC.parts), with its own heading row and the club\'s colour on the bars',
     /SC\.parts\(groups, which\)/.test(team) && /block\('every zone', SC\.GROUPS, 'groups'\) \+ block\('the larger cuts', SC\.BIG, 'big'\)/.test(team) && /<tr class="czt-kh"/.test(team) && /data-k="' \+ g\.kind/.test(team)
     && /table\.czt \.czt-kh th\{/.test(CSSt) && /table\.czt tr\[data-k="paint"\]\{--kc:var\(--xc-a,var\(--lume\)\)\}/.test(CSSt) && /table\.czt tr\.r\[data-k\]\{box-shadow:inset 4px 0 0 var\(--kc\)\}/.test(CSSt));
  const rb = rd('epinoia', 't', 'team.js');
  ok('what became of every shot attempt is left as it was: its rows are the kinds already, one each', /const ZS = \[\['rim', 'at the rim', 'rim'\], \['mid', 'mid-range', 'mid'\], \['three', 'threes', 'three'\], \['all', 'every shot', ''\]\];/.test(rb));
}

console.log('\nthe stylesheet');
const CSS = rd('epinoia', 'kit', 'shotchart.css');
ok('the pills in the court\'s own palette, every step', ['bm3', 'bm2', 'bm1', 'b0', 'bp1', 'bp2', 'bp3'].every(b => CSS.indexOf('.scz-pill.' + b + '{ background:var(--sc-' + b + ') }') >= 0));
ok('the hatch for a thin row, the club\'s colour on the bar and the swatches', /\.scz-pill\.few\{/.test(CSS) && /\.scz-bar i\{[^}]*background:var\(--scz-a\)/.test(CSS) &&
   /\.scz-sw\.k-paint\{ background:var\(--scz-a\) \}/.test(CSS));
ok('a narrow table (its own width, a container query) is cards: four figures a line, five with the per-game columns',
   /\.scz-wrap\{[^}]*container:scz \/ inline-size/.test(CSS) && /@container scz \(max-width:600px\)\{/.test(CSS) &&
   /table\.scz\.pg tr\.r\{ grid-template-columns:repeat\(5,minmax\(0,1fr\)\) \}/.test(CSS));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
