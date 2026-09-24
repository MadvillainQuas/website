/* ============================================================================
   epinoia/glyphs.js: a letter the display face cannot draw is transliterated, nothing else is.

   Jersey 25 and Silkscreen are subset to Latin-1, so "1 LIGA MĘŻCZYZN" drew Ę and Ż in a fallback
   font. Under those two faces such a letter becomes its plain form; a letter the face has (Ó, É, Ñ)
   stays, and a script with no Latin form (Japanese) is left alone. Every page that loads the
   language engine loads this too.

     node supabase/tests/glyphs.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = fs.readFileSync(path.join(ROOT, 'epinoia', 'glyphs.js'), 'utf8');
const win = {};
vm.runInNewContext(src, { window: win });
const G = win.EpinoiaGlyphs;
let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want)); }
};

console.log('\n-- under the display faces');
for (const face of ['Jersey25', 'Silkscreen']) {
  eq(face + ': Polish', G.transliterate('1 LIGA MĘŻCZYZN', face), '1 LIGA MEZCZYZN');
  eq(face + ': Ł has no decomposition and is mapped', G.transliterate('Łódź Łańcut', face), 'Lódz Lancut');
  eq(face + ': Czech, Croatian', G.transliterate('Kooperativa NBL · Šibenik · Đakovo', face), 'Kooperativa NBL · Sibenik · Dakovo');
  eq(face + ': Turkish and Hungarian', G.transliterate('Beşiktaş · Győr', face), 'Besiktas · Gyor');
  eq(face + ': a letter the face has is kept', G.transliterate('Liga Endesa · MÜNCHEN · Coruña · Élite', face), 'Liga Endesa · MÜNCHEN · Coruña · Élite');
  eq(face + ': Japanese is left for the fallback font', G.transliterate('Bリーグ 2026-27', face), 'Bリーグ 2026-27');
  eq(face + ': plain text is returned as it came', G.transliterate('ORLEN Basket Liga', face), 'ORLEN Basket Liga');
}
eq('Jersey25 has Ó and keeps it', G.transliterate('KRAKÓW', 'Jersey25'), 'KRAKÓW');

console.log('\n-- anywhere else');
eq('Archivo (names, prose) keeps the real spelling', G.transliterate('Mężczyzn', 'Archivo'), 'Mężczyzn');
eq('an unknown face is never touched', G.transliterate('Mężczyzn', 'Georgia'), 'Mężczyzn');

console.log('\n-- the table and the pages');
eq('the coverage table names both display faces', Object.keys(G.COVER).sort().join(','), 'Jersey25,Silkscreen');
eq('the table is generated, not typed', /coverage:begin \(tools\/font-coverage\.py\)/.test(src), true);
const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.html')) pages.push(p);
  }
})(path.join(ROOT, 'epinoia'));
const missing = pages.filter(p => { const s = fs.readFileSync(p, 'utf8'); return /i18n\.js\?v=/.test(s) && !/glyphs\.js\?v=\d+" defer/.test(s); });
eq('every page with the language engine loads glyphs.js', missing.map(p => path.relative(ROOT, p)).join(', '), '');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
