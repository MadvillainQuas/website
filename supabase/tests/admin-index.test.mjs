/* ============================================================================
   THE LEAGUE CONSOLE'S INDEX (epinoia/admin/wsindex.js), with no browser.

     node supabase/tests/admin-index.test.mjs

   What would go wrong quietly:
     1. a section with no anchor, or two with the same one: its link goes nowhere, or to the wrong section
     2. the index offering a section this person cannot see, or missing one that appeared later
     3. the index growing into a wall above the sections: it is a dropdown, shut until asked, the first few
        sections with the rest behind "show more", floating over the page
     4. a shared address to a section landing somewhere else, because the league loaded after the jump
   (the jump itself, the panel fitting the screen and the arrow back are looked at in a browser)
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && extra !== undefined ? '  -> ' + JSON.stringify(extra).slice(0, 300) : ''}`);
};

const html = rd('epinoia', 'admin', 'index.html');
const js = rd('epinoia', 'admin', 'wsindex.js');
const css = rd('epinoia', 'admin', 'graphics.css');

/* ---- 1. every section has its anchor ---------------------------------------------- */
console.log('\n1. every section of the Settings tab can be reached');
{
  const settings = html.slice(html.indexOf('<div id="tabSettings"'), html.indexOf('</div><!-- /#tabSettings -->'));
  /* each section: its opening tag and its heading's opening tag */
  const secs = [...settings.matchAll(/<div class="sec(?: hide)?"( id="([^"]+)")?>\s*(?:<!--[\s\S]*?-->\s*)?<div class="sec-h"( id="([^"]+)")?>/g)]
    .map(m => m[2] || m[4] || null);
  ok('the Settings tab was read (' + secs.length + ' sections)', secs.length >= 30, secs.length);
  ok('every one has an anchor, its own or its heading\'s', secs.every(Boolean), secs);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  ok('no id on the page is used twice', !dup.length, dup);
  ok('the anchors the league pages already link to are kept', ['seasons', 'teams', 'fixtures'].every(x => secs.includes(x)));
  ok('the rest are made from their titles (sec-<title>)', secs.filter(x => /^sec-/.test(x)).length >= 25 &&
     secs.includes('sec-discipline') && secs.includes('sec-api-keys') && secs.includes('sec-team-of-the-year'));
}

/* ---- 2. the index's own rules ---------------------------------------------------------- */
console.log('\n2. what the index lists');
const sandbox = { console, setTimeout, clearTimeout };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.runInContext(js, vm.createContext(sandbox), { filename: 'wsindex.js' });
const W = sandbox.EpinoiaWsIndex;
{
  ok('a title as an anchor: lower case, & as and, apostrophes and accents dropped',
     W.slug('Fans’ vote') === 'fans-vote' && W.slug('Seasons & competitions') === 'seasons-and-competitions' &&
     W.slug('Community: Discord') === 'community-discord' && W.slug('Équipes') === 'equipes', [W.slug('Fans’ vote'), W.slug('Équipes')]);
  /* a stand-in for the few DOM calls entries() makes */
  const node = (o) => Object.assign({ id: '', kids: [], cls: '', text: '' }, o);
  const q1 = (n, sel) => {
    if (sel === ':scope > .sec-h') return n.kids.find(k => k.cls === 'sec-h') || null;
    if (sel === 'h2') return n.kids.find(k => k.cls === 'h2') || null;
    if (sel === '.idx') return n.kids.find(k => k.cls === 'idx') || null;
    return null;
  };
  const sec = (idx, title, o) => {
    const hd = node({ cls: 'sec-h', id: (o && o.hid) || '', kids: [node({ cls: 'idx', text: idx })].concat(title ? [node({ cls: 'h2', text: title })] : []) });
    hd.querySelector = s => q1(hd, s);
    hd.kids.forEach(k => { Object.defineProperty(k, 'textContent', { get: () => k.text }); });
    const s = node({ cls: 'sec', id: (o && o.id) || '', kids: [hd], shown: !(o && o.hidden) });
    s.querySelector = x => q1(s, x);
    return s;
  };
  const secs = [sec('02', 'League'), sec('03', 'Seasons & competitions', { hid: 'seasons' }), sec('04', 'Teams', { hidden: true }),
                sec('05', 'Fixtures', { id: 'fixtures' }), sec('06', ''), sec('06a', 'Discipline')];
  const panel = { querySelectorAll: s => (s === ':scope > .sec' ? secs : []) };
  const taken = new Set(['sec-discipline']);                              // an id already on the page
  const got = W.entries(panel, s => s.shown, id => (taken.has(id) ? {} : null));
  ok('the sections that are showing, in their order, with their number and title',
     JSON.stringify(got.map(x => [x.idx, x.title])) === JSON.stringify([['02', 'League'], ['03', 'Seasons & competitions'], ['05', 'Fixtures'], ['06a', 'Discipline']]),
     got.map(x => [x.idx, x.title]));
  ok('one this person cannot see is not offered, nor one with no title', !got.some(x => x.title === 'Teams' || x.idx === '06'));
  ok('a section\'s own id, else its heading\'s', got[2].id === 'fixtures' && got[1].id === 'seasons');
  ok('one without either is given one from its title, never an id already on the page', got[0].id === 'sec-league' && got[3].id === 'sec-discipline-2' &&
     secs[0].id === 'sec-league', [got[0].id, got[3].id]);
  ok('no panel, no sections', W.entries(null, () => true, () => null).length === 0);
}

/* ---- 3. a dropdown, not a wall --------------------------------------------------------- */
console.log('\n3. a dropdown, not a wall');
{
  ok('it sits under the Settings / Graphics tabs', /<\/div>\s*<\/div>\s*<!-- THE INDEX[^>]*-->\s*<nav class="wsindex" id="wsIndex" aria-label="On this page" hidden><\/nav>/.test(html) &&
     html.indexOf('id="wsIndex"') > html.indexOf('id="wsTabs"') && html.indexOf('id="wsIndex"') < html.indexOf('id="tabSettings"'));
  ok('...and is drawn after the tabs\' own script (it asks which tab is open)', html.indexOf('wsindex.js?v=') > html.indexOf('wstabs.js?v='));
  ok('shut until it is asked for: a <details> that is never opened by itself, and nothing remembered',
     /const fold = el\('details', 'wsix'\);/.test(js) && !/fold\.open = (true|open)\b(?![\s\S]{0,40}sec-top)/.test(js.replace(/go\(box, null\);\s*fold\.open = true;/, '')) && !/localStorage/.test(js));
  ok('the first eight sections, the rest behind "show more" (and behind it again when it shuts)',
     /const FIRST = 8;/.test(js) && /el\('li', i >= FIRST \? 'x' : null\)/.test(js) && /'Show more \(' \+ rest\.length \+ '\)'/.test(js) &&
     /if \(all\) \{ all = false; drawMore\(\); \}/.test(js));
  ok('it floats over the page rather than pushing the sections down, and scrolls inside when it is long',
     /\.wsix-pop\{position:absolute;z-index:40;/.test(css) && /overflow:auto/.test(css.slice(css.indexOf('.wsix-pop{'))));
  ok('...fitted to the room under it on screen, whatever zoom the kit draws the page at', /const room = \(root\.innerHeight - r\.top - 12\) \/ \(r\.height \/ h\);/.test(js));
  ok('picking a section, Esc or a click elsewhere shuts it', /e\.preventDefault\(\);\s*fold\.open = false;\s*go\(/.test(js) &&
     /e\.key === 'Escape' && fold\.open/.test(js) && /if \(fold\.open && !fold\.contains\(e\.target\)\) fold\.open = false;/.test(js));
  ok('a jump glides (at once for less motion), takes the address and hands the keyboard to the section',
     /behavior: reduced\(\) \? 'auto' : 'smooth'/.test(js) && /history\.replaceState\(root\.history\.state, '', hash\)/.test(js) && /focus\(\{ preventScroll: true \}\)/.test(js));
  ok('every indexed heading has an arrow back, which opens it again', /el\('a', 'sec-top', '(\u2191|\\u2191)'\)/.test(js) && /go\(box, null\);\s*fold\.open = true;/.test(js));
  ok('the open tab\'s sections, redrawn as sections show and hide or the tab changes; under two, no index',
     /doc\.addEventListener\('epinoia-tab'/.test(js) && /attributeFilter: \['class', 'hidden'\]/.test(js) && /box\.hidden = list0\.length < 2;/.test(js));
}

/* ---- 4. an address from outside ---------------------------------------------------------- */
console.log('\n4. a section\'s address, sent to someone');
{
  const admin = rd('epinoia', 'admin', 'admin.js');
  ok('lands once the league has loaded, for any section of the Settings tab (not just #fixtures)',
     /const target = location\.hash === '#backfill' \? 'backfillPanel' : location\.hash\.replace\(\/\^#\/, ''\);/.test(admin) &&
     /if \(sec && inSettings && inSettings\.contains\(sec\)\)/.test(admin));
  ok('#graphics stays the Graphics tab\'s (wstabs.js), and its one section has no anchor of its own', /if \(h === 'graphics'\) return 'graphics';/.test(rd('epinoia', 'admin', 'wstabs.js')) &&
     !/id="sec-graphics"/.test(html));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
