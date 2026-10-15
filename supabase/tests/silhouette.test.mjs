/* ============================================================================
   THE PLAYER WITH NO PHOTOGRAPH YET (epinoia/silhouette.js, kit/silhouette.css).

   What would go wrong quietly:
     1. a player who changes picture from one visit to the next (the variant not fixed by his id)
     2. the wrong figure: a women's league drawn with the men's (or the other way), or the figure
        read from anything but the league (a name, a guess) - opts.gender, set from the league, is
        the only switch, and genderOf(league) reads only the league
     3. a crooked neck: a head turn that shears the jaw or the neck off the centre line, a neck
        that is not one straight column under the head
     4. the club's colour lost (the mint default on every club) or unreadable: a yellow trim on a
        light figure, a navy one on a dark figure, a figure (or any shade of it) that melts into its screen
     5. the theme ignored: the same screen in light and dark
     6. a picture that is not one: no role, no label, a script, a network request
     7. the pages that show it not loading it, or not telling it the league's figure, or the canvas
        drawing it differently from the svg

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
const strip = s => s.replace(/silg[0-9a-z]+/g, 'ID');
const same = (a, b) => Buffer.compare(Buffer.from(a.cells), Buffer.from(b.cells)) === 0;
/* every template a figure has: its hair styles x headband x neckline x turn */
const templates = g => {
  const out = [];
  for (const hair of S.HAIR[g]) for (const band of [0, 1]) for (const neck of [0, 1]) for (const turn of [-1, 0, 1]) out.push({ gender: g, hair, band, neck, turn });
  return out;
};

console.log('\n1. the same player, the same picture');
{
  const v = S.variant(BEN);
  ok('his variant is fixed by his id', JSON.stringify(S.variant(BEN)) === JSON.stringify(v) && JSON.stringify(S.variant(String(BEN))) === JSON.stringify(v));
  ok('...in a women\'s league too', JSON.stringify(S.variant(BEN, 'women')) === JSON.stringify(S.variant(BEN, 'women')));
  const a = S.svg({ seed: BEN, teamColour: CLUBS.orange, theme: 'dark' }), b = S.svg({ seed: BEN, teamColour: CLUBS.orange, theme: 'dark' });
  ok('...and so is the whole picture (bar its gradient\'s unique id)', strip(a) === strip(b));
  const w1 = S.svg({ seed: BEN, gender: 'women', teamColour: CLUBS.navy, theme: 'light' }), w2 = S.svg({ seed: BEN, gender: 'women', teamColour: CLUBS.navy, theme: 'light' });
  ok('...the women\'s figure as well', strip(w1) === strip(w2));
  for (const g of ['men', 'women']) {
    const seen = new Set(IDS.map(id => JSON.stringify(S.variant(id, g))));
    ok(`a squad is not one picture copied: all ${templates(g).length} of the ${g}'s templates turn up among 400 ids`, seen.size === templates(g).length, String(seen.size));
    const hairs = {};
    IDS.forEach(id => { const h = S.variant(id, g).hair; hairs[h] = (hairs[h] || 0) + 1; });
    ok(`...each of the ${g}'s hair styles on 15-35% of them`, S.HAIR[g].every(h => hairs[h] > 60 && hairs[h] < 140), JSON.stringify(hairs));
  }
  const bands = IDS.filter(id => S.variant(id).band).length;
  ok('...headbands spread fairly (on 35-65% of them)', bands > 140 && bands < 260, String(bands));
}

console.log('\n2. the league chooses the figure, the id the rest');
{
  const keys = Object.keys(S.variant(BEN)).sort().join();
  ok('a variant is a figure, its hair, a headband, a neckline and a turn of the head', keys === 'band,gender,hair,neck,turn', keys);
  ok('the men\'s figure unless the league is a women\'s: no gender, or anything but "women", is the men\'s',
    [undefined, null, '', 'men', 'male', 'female', 'w', 'mixed', 'f'].every(g => S.variant(BEN, g).gender === 'men') &&
    S.variant(BEN, 'women').gender === 'women' && S.variant(BEN, 'Women').gender === 'women');
  ok('the men\'s hair on the men\'s figure, the women\'s on the women\'s', IDS.every(id => S.HAIR.men.includes(S.variant(id).hair) && S.HAIR.women.includes(S.variant(id, 'women').hair)) &&
    S.HAIR.men.every(h => !S.HAIR.women.includes(h)));
  const vm = S.variant(BEN), vw = S.variant(BEN, 'women');
  ok('the same id keeps its headband, neckline and turn in either figure', vm.band === vw.band && vm.neck === vw.neck && vm.turn === vw.turn);
  const base = { seed: BEN, teamColour: CLUBS.red, theme: 'dark' };
  const g0 = S.grid(base), gw = S.grid(Object.assign({ gender: 'women' }, base));
  ok('a women\'s league draws a different figure from a men\'s', !same(g0, gw) && gw.variant.gender === 'women' && g0.variant.gender === 'men');
  const like = (extra, g) => same(S.grid(Object.assign({}, base, extra)), g);
  ok('only opts.gender switches it: a name, a sex, a league object, the old keys - none of them does',
    like({ name: 'Maria Garcia' }, g0) && like({ sex: 'f' }, g0) && like({ gender: 'female' }, g0) && like({ league: { slug: 'wbbl', gender: 'women' } }, g0) &&
    like({ leagueSlug: 'slb-women' }, g0) && like({ gender: 'women', name: 'Ben Baker' }, gw));
  const noLabel = s => strip(s).replace(/aria-label="[^"]*"/, '');
  ok('...and so does the svg (a name is only its label)', noLabel(S.svg(Object.assign({ name: 'Maria Garcia', sex: 'f', league: 'wbbl', leagueSlug: 'slb-women' }, base))) === noLabel(S.svg(base)));
  ok('the svg says which figure and hair it drew', /data-sil-figure="women"/.test(S.svg(Object.assign({ gender: 'women' }, base))) &&
    new RegExp('data-sil-hair="' + vw.hair + '"').test(S.svg(Object.assign({ gender: 'women' }, base))));
  /* genderOf: the league's own gender, else its tier's side, else its name; nothing else */
  const prevTiers = globalThis.EPINOIA_LEAGUE_TIERS;
  globalThis.EPINOIA_LEAGUE_TIERS = { 'slb-women': [1, 'w'], 'slb-men': [1, 'm'], 'basketligan-dam': [1, 'w'], 'ladies-cup-men': [1, 'm'] };
  try {
    ok('genderOf: the league\'s own gender first', S.genderOf({ slug: 'slb-men', gender: 'women' }) === 'women' && S.genderOf({ slug: 'slb-women', gender: 'men' }) === 'men');
    ok('...then the side its tier is filed under', S.genderOf({ slug: 'slb-women' }) === 'women' && S.genderOf('basketligan-dam') === 'women' &&
      S.genderOf({ slug: 'ladies-cup-men', name: 'Ladies Cup' }) === 'men');
    ok('...then a women\'s league\'s name', S.genderOf({ slug: 'x', name: 'Liga Femenina Challenge' }) === 'women' && S.genderOf({ name: "Women's National League" }) === 'women' &&
      S.genderOf({ slug: 'naisten-korisliiga' }) === 'women');
    ok('...and a league that says neither (or no league, or a mixed one) is the men\'s', S.genderOf(null) === 'men' && S.genderOf({}) === 'men' &&
      S.genderOf({ slug: 'bbl', name: 'BBL' }) === 'men' && S.genderOf({ gender: 'mixed', slug: 'x' }) === 'men');
  } finally { if (prevTiers === undefined) delete globalThis.EPINOIA_LEAGUE_TIERS; else globalThis.EPINOIA_LEAGUE_TIERS = prevTiers; }
  const src = read('epinoia', 'silhouette.js').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the module reads no person: the name only for the label, no sex, no player field, no league but the one handed to genderOf',
    (src.match(/\bo\.name\b/g) || []).length === (src.match(/label\(o\.name\)/g) || []).length &&
    !/\bo\.(sex|league|leagueSlug|player)\b|first_name|last_name|\bdob\b|birth/.test(src));
  /* the women's build: a narrower neck and shoulder line, never more than that */
  const width = (v, y) => { const g = S.grid({ variant: v, rim: false }); let w = 0; for (let i = 0; i < g.cols; i++) if (g.cells[Math.floor(y) * g.cols + i]) w++; return w; };
  const M = { gender: 'men', hair: 'shaved', band: 0, neck: 0, turn: 0 }, W = { gender: 'women', hair: 'bun', band: 0, neck: 0, turn: 0 };
  ok('the women\'s neck and shoulders a little narrower than the men\'s', width(W, 22) < width(M, 22) && width(W, 33) < width(M, 33) && width(M, 33) - width(W, 33) <= 4,
    [width(W, 22), width(M, 22), width(W, 33), width(M, 33)].join());
}

console.log('\n3. a straight neck under a centred head (no crooked necks)');
{
  /* from the jaw (below the ears) down over the shoulders, everything but the hair behind the neck is
     mirror-symmetric about the centre line, for every template at every size it is drawn at */
  const sizes = [['portrait', 32], ['portrait', 64], ['portrait', 24], ['square', 30], ['square', 20]];
  let bad = [];
  for (const g of ['men', 'women']) for (const v of templates(g)) for (const [shape, res] of sizes) {
    const gr = S.grid({ variant: v, shape, res, theme: 'dark' });
    const step = (shape === 'square' ? 30 : 32) / res, y0 = shape === 'square' ? 5 : 0;
    for (let j = 0; j < gr.rows; j++) {
      const y = y0 + (j + 0.5) * step;
      if (y < 17.6 || y > 27) continue;
      const occ = []; for (let i = 0; i < gr.cols; i++) { const c = gr.cells[j * gr.cols + i]; occ.push(c && c !== 9 && c !== 10 ? 1 : 0); }
      if (occ.join() !== occ.slice().reverse().join()) bad.push(JSON.stringify(v) + ' ' + shape + res + ' y' + y);
    }
  }
  ok('jaw, chin, neck and shoulders symmetric about the centre for all ' + (templates('men').length + templates('women').length) + ' templates at 5 sizes', !bad.length, bad.slice(0, 3).join(' | '));
  /* the neck is one straight column: the same width every row between the chin and the shoulders */
  for (const g of ['men', 'women']) {
    const widths = new Set();
    for (const v of templates(g)) {
      const gr = S.grid({ variant: v, rim: false });
      for (const y of [21, 22]) { let w = 0; for (let i = 0; i < gr.cols; i++) { const c = gr.cells[y * gr.cols + i]; if (c && c !== 9 && c !== 10) w++; } widths.add(w); }
    }
    ok(`the ${g}'s neck one straight column (the same width under the chin in every template)`, widths.size === 1, [...widths].join());
  }
  /* a turn moves the ears and the light, not the head: the outline above the jaw differs only by an ear */
  for (const g of ['men', 'women']) {
    const rowsOf = turn => { const gr = S.grid({ variant: { gender: g, hair: g === 'men' ? 'shaved' : 'bun', band: 0, neck: 0, turn }, rim: false }); const r = [];
      for (let j = 0; j < 22; j++) { let w = 0; for (let i = 0; i < gr.cols; i++) if (gr.cells[j * gr.cols + i] && gr.cells[j * gr.cols + i] !== 9 && gr.cells[j * gr.cols + i] !== 10) w++; r.push(w); } return r; };
    const r0 = rowsOf(0), rl = rowsOf(-1), rr = rowsOf(1);
    ok(`the ${g}'s head turned either way keeps its outline, bar an ear (a pixel a row at most)`,
      r0.every((w, j) => Math.abs(rl[j] - w) <= 1 && Math.abs(rr[j] - w) <= 1) && rl.join() === rr.join(), [r0, rl, rr].map(r => r.join('')).join(' | '));
  }
  /* the jaw is wider than the neck, so the neck sits under the head and not beside it */
  for (const g of ['men', 'women']) {
    const gr = S.grid({ variant: { gender: g, hair: S.HAIR[g][1], band: 0, neck: 0, turn: 0 }, rim: false });
    const w = j => { let n = 0; for (let i = 0; i < gr.cols; i++) if (gr.cells[j * gr.cols + i]) n++; return n; };
    ok(`the ${g}'s jaw wider than the neck under it`, w(18) >= w(22) + 2, w(18) + ' / ' + w(22));
  }
}

console.log('\n4. the club\'s colour, readable');
{
  const L = (a, b) => S.contrast(a, b);
  for (const theme of ['dark', 'light']) {
    for (const [club, hex] of Object.entries(CLUBS)) {
      const p = S.palette({ teamColour: hex, theme });
      const tones = ['shade', 'light', 'hair', 'sheen', 'vest', 'fold', 'rim', 'edge'];
      const worst = tones.reduce((m, k) => Math.min(m, L(p[k], p.screen)), 99);
      const under = ['figure', 'shade', 'light', 'vest', 'fold'];
      const trimWorst = under.reduce((m, k) => Math.min(m, L(p.trim, p[k])), 99);
      ok(`${theme}, ${club}: figure ${L(p.figure, p.screen).toFixed(1)}:1 on the screen, every other tone ${worst.toFixed(1)} at worst, trim ${trimWorst.toFixed(1)} on the skin and vest at worst, bezel ${L(p.frame, p.screen).toFixed(1)}`,
        L(p.figure, p.screen) >= 7 && worst >= 4.5 && trimWorst >= 3 && L(p.frame, p.screen) >= 3);
      ok(`${theme}, ${club}: the hair stands off the skin (${L(p.hair, p.figure).toFixed(2)}:1), the shadow and the light show (${L(p.shade, p.figure).toFixed(2)}, ${L(p.light, p.figure).toFixed(2)}), the vest's fold too (${L(p.fold, p.vest).toFixed(2)})`,
        L(p.hair, p.figure) >= 1.6 && L(p.shade, p.figure) >= 1.25 && L(p.light, p.figure) >= 1.25 && L(p.fold, p.vest) >= 1.2);
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
  const ed = S.svg({ seed: BEN, teamColour: CLUBS.red, theme: 'light', variant: { gender: 'men', hair: 'crop', band: 0, neck: 0, turn: 0 } });
  ok('the shadow, the light, the hair and the club\'s edge are all drawn', ['sil-shade', 'sil-light', 'sil-hair', 'sil-edge', 'sil-fold'].every(c => ed.includes('class="' + c + '"')));
}

console.log('\n5. both themes');
{
  const d = S.palette({ teamColour: CLUBS.red, theme: 'dark' }), l = S.palette({ teamColour: CLUBS.red, theme: 'light' });
  const lum = h => S.contrast(h, '#000000');
  ok('dark: a dark screen and a light figure', lum(d.screen) < 2 && lum(d.figure) > 7);
  ok('light: a light screen and a dark figure', lum(l.screen) > 15 && lum(l.figure) < 2);
  ok('the hair is the darkest of the figure\'s tones in both', lum(d.hair) < lum(d.shade) && lum(d.shade) < lum(d.figure) && lum(l.hair) < lum(l.shade) && lum(l.shade) < lum(l.figure));
  ok('the svg says which it drew', /data-sil-theme="dark"/.test(S.svg({ theme: 'dark' })) && /data-sil-theme="light"/.test(S.svg({ theme: 'light' })));
  ok('"auto" with no page is the dark screen (the canvas\'s and the tests\' default)', S.palette({ theme: 'auto' }).theme === 'dark');
  const prevDoc = globalThis.document;
  globalThis.document = { documentElement: { getAttribute: k => (k === 'data-theme' ? 'light' : null) } };
  try { ok('"auto" follows the page\'s data-theme, as appmode.js sets it', S.palette({ theme: 'auto' }).theme === 'light'); }
  finally { if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc; }
}

console.log('\n6. a picture, and only a picture');
{
  const s = S.svg({ seed: BEN, teamColour: CLUBS.orange, theme: 'light', label: S.label('Ben Baker') });
  ok('role="img" with the player\'s name and "no photograph yet"', /role="img"/.test(s) && /aria-label="Ben Baker — no photograph yet"/.test(s));
  ok('a name is escaped into the label', /aria-label="O&#39;Neil &lt;b&gt; — no photograph yet"/.test(S.svg({ name: "O'Neil <b>" })));
  ok('no script, no event handler, no link out (CSP, and no request)', !/<script|\son[a-z]+=|href=|xlink|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(s));
  ok('...and nothing in the module asks the network', !/fetch\(|XMLHttpRequest|import\(|new Image|\.src\s*=/.test(read('epinoia', 'silhouette.js')));
  ok('crisp pixels', /shape-rendering="crispEdges"/.test(s) && /image-rendering:pixelated/.test(read('epinoia', 'kit', 'silhouette.css')));
  ok('nothing animates', !/<animate|@keyframes|animation/.test(s + read('epinoia', 'kit', 'silhouette.css')));
  const es = read('epinoia', 'i18n', 'es.js'), ja = read('epinoia', 'i18n', 'ja.js');
  ok('the label\'s words are in Spanish and Japanese', /'no photograph yet':/.test(es) && /'no photograph yet':/.test(ja));
  ok('a square for a disc, a portrait for the profile', S.grid({ shape: 'square' }).rows === S.grid({ shape: 'square' }).cols && S.grid({}).rows / S.grid({}).cols === 1.25);
  for (const g of ['men', 'women']) {
    const c = S.grid({ shape: 'square', res: 16, gender: g, variant: { gender: g, hair: S.HAIR[g][0], band: 0, neck: 0, turn: 0 } });
    ok(`...a coarse grid still has a head, a vest and its trim (${g})`, [1, 2, 5].every(k => c.cells.includes(k)));
  }
}

console.log('\n7. the canvas draws the same picture');
{
  const log = [];
  const ctx = { fillStyle: '', globalAlpha: 1, save() {}, restore() {}, fillRect(x, y, w, h) { log.push([this.fillStyle, x, y, w, h]); },
    createRadialGradient() { return { addColorStop() {} }; } };
  const p = S.palette({ teamColour: CLUBS.navy, theme: 'light' });
  const g = S.draw(ctx, 0, 0, 300, 300, { seed: BEN, teamColour: CLUBS.navy, theme: 'light', shape: 'square', res: 30 });
  ok('the screen first, filling the box', log[0][0] === p.screen && log[0][3] === 300 && log[0][4] === 300);
  ok('the figure, its shadow, the vest and the trim in the svg\'s colours', [p.figure, p.shade, p.vest, p.trim].every(c => log.some(e => e[0] === c)));
  ok('the same grid as the svg', g.cols === 30 && g.rows === 30 && same(g, S.grid({ seed: BEN, teamColour: CLUBS.navy, theme: 'light', shape: 'square', res: 30 })));
  const lw = []; const cw = Object.assign({}, ctx, { fillRect(x, y, w, h) { lw.push(this.fillStyle); } });
  S.draw(cw, 0, 0, 300, 300, { seed: BEN, gender: 'women', teamColour: CLUBS.navy, theme: 'light', shape: 'square', res: 30 });
  ok('...the women\'s figure on the canvas too (her hair drawn)', lw.includes(p.hair));
}

console.log('\n8. where it is drawn');
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
  ok('...the figure chosen by his league (the roster entry\'s club\'s league)', /gender: SIL\.genderOf \? SIL\.genderOf\(team && team\.leagues\)/.test(player));
  ok('...and when a photograph fails to load', /addEventListener\('error', \(\) => \{ img\.remove\(\); standIn\(\); \}\)/.test(player));
  const stars = read('epinoia', 'stars.js');
  ok('a star card mounts it in the disc, seeded by the player\'s id', /SIL\.mount\(disc, \{ seed: p\.id/.test(stars));
  ok('...the figure chosen by the row\'s league, else the page\'s (the league page passes its own)',
    /gender: SIL\.genderOf \? SIL\.genderOf\(league \|\| o\.pageLeague\)/.test(stars) && /pageLeague: o\.pageLeague/.test(stars) &&
    /ST\.render\(sec\.querySelector\('#stars'\), rows, \{ base: '', pageLeague: LEAGUE \}\)/.test(read('epinoia', 'home.js')));
  const sc = read('epinoia', 'socialcard.js');
  ok('the graphics\' discs draw it where there is no photo', /SIL\.draw\(ctx, cx - rad, cy - rad, 2 \* rad, 2 \* rad/.test(sc));
  ok('...the row\'s own figure where it says, else the graphic\'s league\'s', /SIL\.genderOf\(league\)/.test(sc) && (sc.match(/starDisc\([^\n]*m\.league\)/g) || []).length === 5);
  ok('...a head to head across leagues gives each player his own league\'s figure', /SIL\.genderOf\(\{ slug: p\.leagueSlug \}\)/.test(read('epinoia', 'compare.js')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
