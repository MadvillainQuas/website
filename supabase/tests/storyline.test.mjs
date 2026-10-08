/* ============================================================================
   THE STORYLINES DRAWER'S PLAYERS ARE LINKS (storyline.js, 2026-10-08).

     * every player named - the leading scorers, the BPM list, a run's scorers, a streak - links to his profile
       (epinoia/p/?p=<id>, found from storyline.js's own address), in a new tab so the video keeps playing;
     * a player with no profile id (not a UUID) stays plain text; a page may say where profiles are (playerHref);
     * names are escaped; the box score frame (embed/game storyOf) sends each named player's id and full name.

     node supabase/tests/storyline.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

const SRC = rd('epinoia', 'storyline.js');
const load = src => {
  const ctx = { window: {}, document: { currentScript: src ? { src } : null }, URL, console };
  vm.runInNewContext(SRC, ctx);
  return ctx.window.EpinoiaStoryline;
};
const A = '11111111-2222-4333-8444-555555555555', B = '66666666-7777-4888-8999-aaaaaaaaaaaa', C = '99999999-0000-4111-8222-333333333333';
const story = {
  v: 1, live: true, score: [40, 30],
  teams: [{ name: 'Tortona', short: 'TRT', ink: '#ff0000' }, { name: 'Le Mans', short: 'LEM', ink: '#0000ff' }],
  leaders: [[{ id: A, name: 'Christian Gorham', short: 'Gorham', side: 0, pts: 22, fgm: 8, fga: 13, p3m: 0, reb: 8, ast: 2 }],
            [{ id: 'feed-17', name: 'No Profile', short: 'Nobody', side: 1, pts: 18, fgm: 7, fga: 12, p3m: 2, reb: 5, ast: 2 },
             { id: C, name: "D'Angelo <Wood>", short: '<Wood>', side: 1, pts: 11, fgm: 4, fga: 10, p3m: 2, reb: 3, ast: 0 }]],
  bpm: [{ id: B, name: 'Jordan Hubb', short: 'Hubb', side: 0, bpm: 18.5 }],
  run: { side: 0, n: 11, since: 'Q1 7:37', from: 100, scorers: [{ id: A, name: 'Christian Gorham', short: 'Gorham', pts: 7 }, { id: B, name: 'Jordan Hubb', short: 'Hubb', pts: 4 }] },
  streak: { id: B, name: 'Jordan Hubb', short: 'Hubb', side: 0, n: 7, since: 'Q1 6:00' },
  flow: { pts: [[0, 0], [60, 2]], len: 2400, now: 60, lead: [11, 2], changes: 1 }
};

console.log('a player is his profile');
const SL = load('https://epinoia.example/epinoia/storyline.js?v=7');
ok('storyline.js loads in node with its cards', SL && typeof SL.cards === 'function' && typeof SL.mount === 'function');
const K = SL.cards(s => s);
const lead = K.leaders(story), bpm = K.bpm(story), runs = K.runs(story);
const href = id => 'href="https://epinoia.example/epinoia/p/?p=' + id + '"';
ok('the leading scorers: each with a profile links to it, beside storyline.js (epinoia/p/)', lead.includes(href(A)) && lead.includes(href(C)), lead);
ok('...in a new tab, without the opener, his full name on hover', /<a class="sl-pl" href="[^"]+" target="_blank" rel="noopener" title="Christian Gorham">Gorham<\/a>/.test(lead), lead);
ok('...a player with no profile stays plain text', lead.includes('>Nobody<') && !/<a[^>]*>Nobody</.test(lead) && !lead.includes('feed-17'), lead);
ok('...names are escaped, in the link and its title', lead.includes('>&lt;Wood&gt;</a>') && lead.includes('title="D\'Angelo &lt;Wood&gt;"') && !lead.includes('<Wood>'), lead);
ok('the BPM list links its players', bpm.includes(href(B)) && /<span class="sl-nm" translate="no"><a class="sl-pl"/.test(bpm), bpm);
ok("a run's scorers link to theirs", /<small class="sl-run-by" translate="no"><a class="sl-pl" href="[^"]+p\/\?p=11111111[^"]*"[^>]*>Gorham<\/a> 7 · <a class="sl-pl"[^>]*>Hubb<\/a> 4<\/small>/.test(runs), runs);
ok('...and the streak its player', /<div class="sl-streak"[^>]*><b>7<\/b><span translate="no"><a class="sl-pl" href="[^"]+p\/\?p=66666666/.test(runs), runs);
const past = K.runs(Object.assign({}, story, { live: false, run: null, streak: null, bestRun: { side: 1, n: 8, since: 'Q2 3:00' },
  bestStreak: { id: C, name: 'X', short: 'Wood', side: 1, n: 9 } }));
ok("...a finished game's best streak too", past.includes(href(C)), past);

console.log('\nwhere profiles are');
const K2 = load(null).cards(s => s);
ok('with no address of its own: one level up from the page (../p/)', K2.leaders(story).includes('href="../p/?p=' + A + '"'));
const K3 = SL.cards(s => s, p => '/somewhere/' + p.short);
ok("a page's own playerHref decides, even for a player with no UUID", K3.leaders(story).includes('href="/somewhere/Nobody"') && K3.leaders(story).includes('href="/somewhere/Gorham"'));
const K4 = SL.cards(s => s, () => { throw new Error('no'); });
ok('...and one that fails leaves the names as text', !K4.leaders(story).includes('<a '));

console.log('\nthe box score frame sends the ids');
const G = rd('epinoia', 'embed', 'game', 'game.js');
ok("a run's scorers carry id and full name", /const scorers = r => Object\.keys\(r\.by\)\.filter\(id => who\[id\]\)\.map\(id => \(\{ id, name: who\[id\]\.name, short: who\[id\]\.short, pts: r\.by\[id\] \}\)\)/.test(G));
ok('...the streak and the best streak too', /\{ id: streak\.pid, name: who\[streak\.pid\]\.name, short:/.test(G) && /\{ id: bestStreak\.pid, name: who\[bestStreak\.pid\]\.name, short:/.test(G));
ok('...the leaders and BPM rows are built from who[] (id, name)', /who\[p\.id\] = \{ id: p\.id, name: p\.name, short: surname\(p\.name\)/.test(G) && /const line = \(id, s\) => Object\.assign\(\{\}, who\[id\]/.test(G));
const css = rd('epinoia', 'kit', 'storyline.css');
ok('the link reads as the name and underlines under the pointer', /\.sl-pl\{color:inherit;text-decoration:none/.test(css) && /\.sl-pl:hover\{text-decoration:underline/.test(css));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
