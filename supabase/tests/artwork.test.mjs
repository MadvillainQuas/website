/* ============================================================================
   PRINT FILES.

   These become physical objects, which is a different standard of care from a
   page that can be reloaded. The things worth asserting are the ones that cost
   money to discover:

     * a print sheet that is the wrong PHYSICAL SIZE — 300 DPI is not a style
       choice, it is what the factory expects, and a 72 DPI file is a refund
     * a BACKGROUND in the file, which prints as a white slab on a black shirt
     * a design running outside the SAFE AREA, which comes back trimmed
     * a club name long enough to run off the sheet
     * a low-resolution logo going to print without anybody being told
     * an apostrophe in a club's name breaking the XML

   Run: node supabase/tests/artwork.test.mjs
   ============================================================================ */
import A from '../../league/artwork.js';

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.error(`  FAIL ${what}\n       got  ${a}\n       want ${b}`);
};
const ok = (c, what) => { if (c) pass++; else { fail++; console.error(`  FAIL ${what}`); } };

const CLUB = { name: 'East Dock', short_name: 'ED', colour: '#ffd166',
               season: '2025-26', founded: 1996 };

/* --------------------------------------------------------- the dimensions --- */
console.log('physical size');
{
  const t = A.build(CLUB, { kind: 'tee' });
  eq([t.width, t.height], [3600, 4800], 'a tee sheet is 12×16 inches at 300 DPI');
  eq(t.dpi, 300, 'and says so');
  const p = A.build(CLUB, { kind: 'poster' });
  eq([p.width, p.height], [5400, 7200], 'a poster is 18×24 at 300');
  const m = A.build(CLUB, { kind: 'mug' });
  eq([m.width, m.height], [2700, 1110], 'a mug wrap is 9×3.7');
  ok(/width="3600" height="4800"/.test(t.svg), 'the svg carries the pixel size');
  ok(/viewBox="0 0 3600 4800"/.test(t.svg), 'and a matching viewBox');
}

console.log('every product builds');
A.KINDS.forEach(kind => {
  const r = A.build(CLUB, { kind });
  ok(r.svg.startsWith('<?xml'), kind + ': is an xml document');
  ok(r.svg.trim().endsWith('</svg>'), kind + ': is closed');
  ok(r.svg.length > 300, kind + ': has content');
});
eq(A.KINDS.length, 5, 'five products');

/* ------------------------------------------------------------- the sheet --- */
console.log('nothing that would print as a slab');
A.KINDS.forEach(kind => {
  const svg = A.build(CLUB, { kind }).svg;
  /* a full-bleed filled rect is the classic mistake: it prints as a white
     rectangle on the garment. The poster's frame is a stroke, not a fill. */
  ok(!/<rect[^>]*x="0"[^>]*y="0"[^>]*fill="(?!none)/.test(svg),
     kind + ': no full-sheet background fill');
  ok(!/background/i.test(svg), kind + ': no background anywhere');
});

console.log('inside the safe area');
A.KINDS.forEach(kind => {
  const r = A.build(CLUB, { kind });
  const pad = Math.round(Math.min(r.width, r.height) * r.sheet.safe);
  /* every x/y/cx/cy in the file has to sit inside the trimmed box. This is a
     blunt check and that is the point — it catches a design that reaches past
     the margin without needing to understand the design. */
  const nums = [...r.svg.matchAll(/\b(x|y|cx|cy)="(-?[\d.]+)"/g)];
  ok(nums.length > 3, kind + ': has geometry to check');
  const out = nums.filter(m => {
    const v = parseFloat(m[2]);
    const lim = (m[1] === 'x' || m[1] === 'cx') ? r.width : r.height;
    return v < pad - 1 || v > lim - pad + 1;
  });
  ok(!out.length, kind + ': everything is inside the safe area' +
     (out.length ? ' (' + out.slice(0, 3).map(m => m[0]).join(', ') + ')' : ''));
});

/* ------------------------------------------------------------ the crest --- */
console.log('logo or monogram');
{
  eq(A.monogram({ short_name: 'ED' }), 'ED', 'a short name is the monogram');
  eq(A.monogram({ name: 'East Dock' }), 'ED', 'or the initials of two words');
  eq(A.monogram({ name: 'Harbourbay' }), 'HAR', 'or three letters of one word');
  eq(A.monogram({}), '?', 'and something rather than nothing');

  const plain = A.build(CLUB, { kind: 'tee' });
  ok(/<circle/.test(plain.svg) && />ED</.test(plain.svg),
     'no logo on file prints the monogram');
  ok(plain.warnings.some(w => /No approved logo/.test(w.text)),
     'and says so, rather than looking finished');

  const withLogo = A.build({ ...CLUB, logoDataUri: 'data:image/png;base64,AAA',
                             logoWidth: 2000, logoHeight: 2000 }, { kind: 'tee' });
  ok(/<image[^>]+href="data:image\/png;base64,AAA"/.test(withLogo.svg),
     'an approved logo is embedded, not linked — a print file cannot fetch');
  ok(!/<circle/.test(withLogo.svg), 'and replaces the monogram entirely');
  eq(withLogo.warnings.filter(w => w.level !== 'info').length, 0,
     'a 2000px logo prints clean');
}

console.log('resolution is arithmetic, not opinion');
{
  const small = A.build({ ...CLUB, logoDataUri: 'data:,x', logoWidth: 300, logoHeight: 300 },
                        { kind: 'poster' });
  const w = small.warnings.find(x => /DPI/.test(x.text));
  ok(w, 'a 300px logo on an 18×24 print is flagged');
  eq(w.level, 'bad', 'and flagged as bad, not as a note');
  ok(/soft/.test(w.text), 'in words somebody can act on');

  const okish = A.build({ ...CLUB, logoDataUri: 'data:,x', logoWidth: 1400, logoHeight: 1400 },
                        { kind: 'tee' });
  const w2 = okish.warnings.find(x => /DPI/.test(x.text));
  ok(w2 && w2.level === 'warn', 'a middling logo is a warning, not a refusal');

  eq(A.checkResolution({ width: 4000, height: 4000 }, 6), null, 'a big logo says nothing');
  eq(A.checkResolution(null, 6), null, 'and no logo is not a resolution problem');
}

/* --------------------------------------------------------------- safety --- */
console.log('names that would break the file');
{
  const r = A.build({ name: 'St. Mary\'s <Harriers> & Co', short_name: 'SM' }, { kind: 'tee' });
  ok(!/<Harriers>/.test(r.svg), 'angle brackets in a club name are escaped');
  ok(/&amp;/.test(r.svg), 'and ampersands');
  ok(/&apos;|&#39;/.test(r.svg) || !/'/.test(r.svg.split('<text')[1] || ''),
     'and apostrophes');

  const long = A.build({ name: 'Kingston upon Thames Metropolitan Basketball Club',
                         short_name: 'KUT' }, { kind: 'tee' });
  ok(/textLength=/.test(long.svg),
     'a name too long for the sheet is squeezed to fit rather than running off');

  const none = A.build({}, { kind: 'tee' });
  ok(none.svg.length > 200, 'a club with nothing on file still gets a print file');
  ok(none.warnings.some(w => /no name/i.test(w.text)), 'and is told what is missing');
}

console.log('the ink');
{
  const d = A.build(CLUB, { kind: 'tee' });
  ok(/#FFFFFF/.test(d.svg),
     'white by default — the garments are dark, and a dark crest on a dark shirt is nothing');
  const c = A.build(CLUB, { kind: 'tee', ink: '#ffd166' });
  ok(/#ffd166/.test(c.svg) && !/#FFFFFF/.test(c.svg), 'and overridable for a light garment');
}

console.log('unknown products');
{
  let threw = false;
  try { A.build(CLUB, { kind: 'hovercraft' }); } catch (_) { threw = true; }
  ok(threw, 'an unknown product is an error, not an empty file that goes to print');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
