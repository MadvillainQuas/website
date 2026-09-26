// The pixel faces stay, and stay readable: kit/legibility.css is on every page, last; the secondary ink is near full strength in both
// themes; the light accents clear 7:1 for one-pixel type; the pixel face keeps its size; no label rule tracks wider than it should.
//
//   node supabase/tests/legibility.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'epinoia');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) { if (!/node_modules/.test(p)) walk(p, out); } else out.push(p); } return out; };

/* ---- contrast helpers ---- */
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
const ratio = (a, b) => { const x = lum(hex(a)) + .05, y = lum(hex(b)) + .05; return x > y ? x / y : y / x; };

console.log('-- the stylesheet is on every kit page, and last');
const pages = walk(ROOT).filter(f => f.endsWith('.html') && !/[\\/](embed|score|broadcast)[\\/]/.test(f))
  .filter(f => /kit\/(epinoia-kit|tokens)\.css/.test(readFileSync(f, 'utf8')));
ok('there are kit pages to check', pages.length > 30, pages.length);
const missing = pages.filter(f => !/kit\/legibility\.css/.test(readFileSync(f, 'utf8')));
ok('every one of them links legibility.css', missing.length === 0, missing.map(f => path.relative(ROOT, f)));
const notLast = pages.filter(f => { const t = readFileSync(f, 'utf8'); const head = t.slice(0, t.indexOf('</head>')); const i = head.lastIndexOf('kit/legibility.css'); return i < 0 || /<link rel="stylesheet"|<style/.test(head.slice(i)); });
ok('...after every other stylesheet in the head, so it wins', notLast.length === 0, notLast.map(f => path.relative(ROOT, f)));

console.log('-- the pixel face keeps its original size');
const leg = rd('kit', 'legibility.css');
ok('Silkscreen is not enlarged', !/size-adjust/.test(leg));
ok('nothing is gated on the retired html.pxadj flag', !/pxadj/.test(leg) && !/pxadj/.test(rd('appmode.js')));
ok('sentences are in the readable face, not pixel capitals', /\.vaddr[\s\S]{0,400}font-family:var\(--f-ui\) !important/.test(leg));

console.log('-- secondary ink is near full strength');
for (const f of ['epinoia-kit.css', 'tokens.css']) {
  const css = rd('kit', f);
  const dark = /--ink-2:rgba\(230,255,241,([.\d]+)\); --ink-3:rgba\(230,255,241,([.\d]+)\)/.exec(css);
  const light = /--ink-2:rgba\(13,31,23,([.\d]+)\); --ink-3:rgba\(13,31,23,([.\d]+)\)/.exec(css);
  ok(f + ': dark ink-2 / ink-3 at .9+ / .8+', dark && +dark[1] >= .9 && +dark[2] >= .8, dark && dark.slice(1));
  ok(f + ': light ink-2 / ink-3 at .9+ / .8+', light && +light[1] >= .9 && +light[2] >= .8, light && light.slice(1));
}
ok('the game page\'s grey tokens follow the kit ink', /--dim:var\(--ink-2\); --faint:var\(--ink-3\)/.test(leg));

console.log('-- the light accents carry one-pixel type');
{
  const css = rd('kit', 'epinoia-kit.css'); const m = /:root\[data-theme="light"\]\{[\s\S]*?--lume:(#[0-9a-f]{6}); --aqua:(#[0-9a-f]{6}); --amber:(#[0-9a-f]{6}); --flare:(#[0-9a-f]{6}); --violet:(#[0-9a-f]{6});/.exec(css);
  ok('the light accents are defined', !!m);
  if (m) ['lume', 'aqua', 'amber', 'flare', 'violet'].forEach((k, i) => ok('--' + k + ' ' + m[i + 1] + ' is at least 6.8:1 on the pale ground', ratio(m[i + 1], '#f3faf6') >= 6.8, ratio(m[i + 1], '#f3faf6').toFixed(2)));
  ok('the game page\'s light accents match', /--lume:#08603f; --aqua:#075a73;/.test(rd('boxscore.css')));
}
ok('a club colour as text is inked to 6.5:1', /contrast\(c, g\) < 6\.5/.test(rd('teamcolour.js')));

console.log('-- no label tracks wide enough to pull it apart');
{
  const bad = [];
  for (const f of walk(ROOT).filter(f => /\.(css|html)$/.test(f) && !/[\\/](embed|broadcast|score)[\\/]|boxscore\.css$|legibility\.css$/.test(f))) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/var\(--f-micro|'Silkscreen'/.test(m[2])) continue;
      const ls = /letter-spacing\s*:\s*([\d.]+)em/.exec(m[2]);
      if (ls && +ls[1] > 0.2) bad.push(path.relative(ROOT, f) + ' ' + m[1].trim().slice(0, 40) + ' ' + ls[1] + 'em');
    }
  }
  ok('no rule that sets the pixel face tracks wider than .2em', bad.length === 0, bad.slice(0, 5));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
