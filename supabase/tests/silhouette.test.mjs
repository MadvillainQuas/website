/* ============================================================================
   THE PLAYER WITH NO PHOTOGRAPH YET (epinoia/silhouette.js, kit/silhouette.css).

   What would go wrong quietly:
     1. a player who changes picture from one visit to the next (the variant not fixed by his id)
     2. a picture that says something about the player: a variant read from anything but the id
        (a league, a gender), or a head, neck or shoulders that differ between variants
     3. the club's colour lost (the mint default on every club) or unreadable: a yellow trim on a
        light figure, a navy one on a dark figure, a figure that melts into its screen
     4. the theme ignored: the same screen in light and dark
     5. a picture that is not one: no role, no label, a script, a network request
     6. the pages that show it not loading it, or the canvas drawing it differently from the svg

       node supabase/tests/silhouette.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const EP = path.join(ROOT, 'epinoia');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const S = require(path.join(EP, 'silhouette.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

const IDS = Array.from({ length: 400 }, (_, i) => 'a562e24d-dc04-48c1-8851-' + String(100000000000 + i * 7919).slice(-12));
const BEN = 'a562e24d-dc04-48c1-8851-b7d294786941';
const CLUBS = { yellow: '#fcde01', navy: '#121e35', red: '#e21836', white: '#ffffff', black: '#000000', mint: '#93f2bf', orange: '#cf773f' };

console.log('\n1. the same player, the same picture');
{
  const v = S.variant(BEN);
  ok('his variant is fixed by his id', JSON.stringify(S.variant(BEN)) === JSON.stringify(v) && JSON.stringify(S.variant(String(BEN))) === JSON.stringify(v));
  const a = S.svg({ seed: BEN, teamColour: CLUBS.orange, theme: 'dark' }), b = S.svg({ seed: BEN, teamColour: CLUBS.orange, theme: 'dark' });
  const strip = s => s.replace(/silg[0-9a-z]+/g, 'ID');
  ok('...and so is the whole picture (bar its gradient\'s unique id)', strip(a) === strip(b));
  const seen = new Set(IDS.map(id => JSON.stringify(S.variant(id))));
  ok('a squad is not one picture copied: all twelve variants turn up among 400 ids', seen.size === 12, [...seen].join(' '));
  const bands = IDS.filter(id => S.variant(id).band).length;
  ok('...spread fairly (headbands on 35-65% of them)', bands > 140 && bands < 260, String(bands));
}

console.log('\n2. nothing in it says who the player is');
{
  const keys = Object.keys(S.variant(BEN)).sort().join();
  ok('a variant is only a headband, a neckline and a turn of the head', keys === 'band,neck,turn', keys);
  const base = { seed: BEN, teamColour: CLUBS.red, theme: 'dark' };
  const g0 = S.grid(base);
  const same = extra => Buffer.compare(Buffer.from(S.grid(Object.assign({}, base, extra)).cells), Buffer.from(g0.cells)) === 0;
  ok('the variant ignores gender, league and name: only the id chooses it',
    same({ gender: 'female' }) && same({ gender: 'male' }) && same({ sex: 'f' }) && same({ league: { slug: 'wbbl', gender: 'women' } }) &&
    same({ leagueSlug: 'bcb' }) && same({ name: 'Anyone Else' }));
  const strip = s => s.replace(/silg[0-9a-z]+/g, 'ID');
  ok('...and so does the svg', strip(S.svg(Object.assign({ gender: 'female', league: 'wbbl' }, base))) === strip(S.svg(base)));
  /* every variant: the same neck and the same shoulders, row for row, below the head */
  const shape = v => { const g = S.grid({ variant: v }); const rows = [];
    for (let j = 23; j < g.rows; j++) { let w = 0; for (let i = 0; i < g.cols; i++) if (g.cells[j * g.cols + i]) w++; rows.push(w); } return rows.join(); };
  const all = [];
  for (const band of [0, 1]) for (const neck of [0, 1]) for (const turn of [-1, 0, 1]) all.push(shape({ band, neck, turn }));
  ok('one neck and one pair of shoulders for every variant (the same width, row for row)', new Set(all).size === 1, [...new Set(all)].join(' | '));
  const head = v => { const g = S.grid({ variant: v, rim: false }); let n = 0; for (let j = 0; j < 21; j++) for (let i = 0; i < g.cols; i++) if (g.cells[j * g.cols + i]) n++; return n; };
  const sizes = [head({ band: 0, neck: 0, turn: 0 }), head({ band: 1, neck: 0, turn: 0 }), head({ band: 0, neck: 0, turn: 1 }), head({ band: 0, neck: 0, turn: -1 })];
  ok('one head outline: no hair, the headband drawn on it rather than added to it, a turn moving it by no more than an ear',
    sizes[0] === sizes[1] && Math.abs(sizes[2] - sizes[0]) <= 4 && sizes[2] === sizes[3], sizes.join());
  const src = read('epinoia', 'silhouette.js');
  ok('the module reads nothing about a person but the id', !/gender|\bsex\b|female|women|ponytail|beard|bun\b/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
}

console.log('\n3. the club\'s colour, readable');
{
  const L = (a, b) => S.contrast(a, b);
  for (const theme of ['dark', 'light']) {
    for (const [club, hex] of Object.entries(CLUBS)) {
      const p = S.palette({ teamColour: hex, theme });
      ok(`${theme}, ${club}: figure ${L(p.figure, p.screen).toFixed(1)}:1 on the screen, vest ${L(p.vest, p.screen).toFixed(1)}, trim ${L(p.trim, p.figure).toFixed(1)} on the figure / ${L(p.trim, p.vest).toFixed(1)} on the vest, bezel ${L(p.frame, p.screen).toFixed(1)}`,
        L(p.figure, p.screen) >= 7 && L(p.vest, p.screen) >= 4.5 && L(p.trim, p.figure) >= 3 && L(p.trim, p.vest) >= 3 && L(p.frame, p.screen) >= 3);
    }
  }
  const red = S.svg({ seed: BEN, teamColour: CLUBS.red, theme: 'dark' });
  ok('the club\'s own colour is the glow behind the head', /stop-color="#e21836"/.test(red));
  const t = S.palette({ teamColour: CLUBS.red, theme: 'dark' }).trim;
  ok('...and the vest\'s trim is drawn in it (made safe)', red.includes('class="sil-trim" fill="' + t + '"'));
  ok('a club with no colour falls back to the site\'s mint, not to nothing', S.palette({ theme: 'dark' }).glow === '#93f2bf' && S.palette({ teamColour: 'nonsense', theme: 'dark' }).glow === '#93f2bf');
  const yl = S.palette({ teamColour: CLUBS.yellow, theme: 'light' }), yd = S.palette({ teamColour: CLUBS.yellow, theme: 'dark' });
  ok('a yellow club keeps its yellow trim on the dark figure, and darkens it on the light one', yl.trim === '#fcde01' && yd.trim !== '#fcde01');
  const nl = S.palette({ teamColour: CLUBS.navy, theme: 'light' });
  ok('a navy club\'s trim is lifted off the dark figure', nl.trim !== '#121e35' && L(nl.trim, nl.figure) >= 3);
}

console.log('\n4. both themes');
{
  const d = S.palette({ teamColour: CLUBS.red, theme: 'dark' }), l = S.palette({ teamColour: CLUBS.red, theme: 'light' });
  const lum = h => S.contrast(h, '#000000');
  ok('dark: a dark screen and a light figure', lum(d.screen) < 2 && lum(d.figure) > 7);
  ok('light: a light screen and a dark figure', lum(l.screen) > 15 && lum(l.figure) < 2);
  ok('the svg says which it drew', /data-sil-theme="dark"/.test(S.svg({ theme: 'dark' })) && /data-sil-theme="light"/.test(S.svg({ theme: 'light' })));
  ok('"auto" with no page is the dark screen (the canvas\'s and the tests\' default)', S.palette({ theme: 'auto' }).theme === 'dark');
  const prevDoc = globalThis.document;
  globalThis.document = { documentElement: { getAttribute: k => (k === 'data-theme' ? 'light' : null) } };
  try { ok('"auto" follows the page\'s data-theme, as appmode.js sets it', S.palette({ theme: 'auto' }).theme === 'light'); }
  finally { if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc; }
}

console.log('\n5. a picture, and only a picture');
{
  const s = S.svg({ seed: BEN, teamColour: CLUBS.orange, theme: 'light', label: S.label('Ben Baker') });
  ok('role="img" with the player\'s name and "no photograph yet"', /role="img"/.test(s) && /aria-label="Ben Baker — no photograph yet"/.test(s));
  ok('a name is escaped into the label', /aria-label="O&#39;Neil &lt;b&gt; — no photograph yet"/.test(S.svg({ name: "O'Neil <b>" })));
  ok('no script, no event handler, no link out (CSP, and no request)', !/<script|\son[a-z]+=|href=|xlink|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(s));
  ok('crisp pixels', /shape-rendering="crispEdges"/.test(s) && /image-rendering:pixelated/.test(read('epinoia', 'kit', 'silhouette.css')));
  ok('nothing animates', !/<animate|@keyframes|animation/.test(s + read('epinoia', 'kit', 'silhouette.css')));
  const es = read('epinoia', 'i18n', 'es.js'), ja = read('epinoia', 'i18n', 'ja.js');
  ok('the label\'s words are in Spanish and Japanese', /'no photograph yet':/.test(es) && /'no photograph yet':/.test(ja));
  ok('a square for a disc, a portrait for the profile', S.grid({ shape: 'square' }).rows === S.grid({ shape: 'square' }).cols && S.grid({}).rows / S.grid({}).cols === 1.25);
  const g = S.grid({ shape: 'square', res: 16 });
  ok('...a coarse grid still has a head, a vest and its trim', [1, 2, 5].every(c => g.cells.includes(c)));
}

console.log('\n6. the canvas draws the same picture');
{
  const log = [];
  const ctx = { fillStyle: '', globalAlpha: 1, save() {}, restore() {}, fillRect(x, y, w, h) { log.push([this.fillStyle, x, y, w, h]); },
    createRadialGradient() { return { addColorStop() {} }; } };
  const p = S.palette({ teamColour: CLUBS.navy, theme: 'light' });
  const g = S.draw(ctx, 0, 0, 300, 300, { seed: BEN, teamColour: CLUBS.navy, theme: 'light', shape: 'square', res: 30 });
  ok('the screen first, filling the box', log[0][0] === p.screen && log[0][3] === 300 && log[0][4] === 300);
  ok('the figure, the vest and the trim in the svg\'s colours', [p.figure, p.vest, p.trim].every(c => log.some(e => e[0] === c)));
  ok('the same grid as the svg', g.cols === 30 && g.rows === 30);
}

console.log('\n7. where it is drawn');
{
  const pages = [['p', 'index.html'], ['index.html'], ['home', 'index.html']];
  for (const pg of pages) {
    const h = read('epinoia', ...pg);
    const sj = h.indexOf('silhouette.js'), css = h.indexOf('kit/silhouette.css'), leg = h.indexOf('kit/legibility.css');
    ok(pg.join('/') + ' loads the module and its sheet (before legibility.css)', sj > 0 && css > 0 && css < leg);
  }
  for (const pg of [['admin', 'index.html'], ['stats', 'index.html'], ['creators', 'hub', 'index.html']]) {
    const h = read('epinoia', ...pg);
    const at = f => h.search(new RegExp('<script src="[./]*' + f.replace('.', '\\.')));
    ok(pg.join('/') + ' loads it before socialcard.js', at('silhouette.js') > 0 && at('silhouette.js') < at('socialcard.js'));
  }
  ok('the compare sheet fetches it with the graphics', /loadScript\('silhouette\.js'\)/.test(read('epinoia', 'compare.js')));
  const player = read('epinoia', 'p', 'player.js');
  ok('the profile mounts it on the photo box, seeded by the player\'s id, in his club\'s colour', /SIL\.mount\(box, \{ seed: pl\.id, teamColour: team && team\.colour/.test(player));
  ok('...and when a photograph fails to load', /addEventListener\('error', \(\) => \{ img\.remove\(\); standIn\(\); \}\)/.test(player));
  ok('a star card mounts it in the disc, seeded by the player\'s id', /SIL\.mount\(disc, \{ seed: p\.id/.test(read('epinoia', 'stars.js')));
  ok('the graphics\' discs draw it where there is no photo', /SIL\.draw\(ctx, cx - rad, cy - rad, 2 \* rad, 2 \* rad/.test(read('epinoia', 'socialcard.js')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
