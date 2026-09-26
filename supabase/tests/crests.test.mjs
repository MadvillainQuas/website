/* ============================================================================
   CRESTS AT THE SIZE THEY ARE SHOWN (migration 0158).

   The snapshots function copies each crest that is another site's URL into the
   'crests' bucket as crests/<crestKey(url)>, and epinoia/config.js asks Storage's
   image transformation for that object at display size. Neither looks the other
   up, so the two crestKey functions must be the same function: this lifts both
   and compares them, checks that the function copies exactly the URLs the page
   transforms, and runs config.js in a sandbox for the URLs it hands out and the
   fall-back to the original when a copy is missing.

     node supabase/tests/crests.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };
function lift(src, signature) {
  const from = src.indexOf(signature);
  if (from === -1) throw new Error('cannot find ' + signature);
  let depth = 0;
  for (let j = src.indexOf('{', from); j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (!depth) return src.slice(from, j + 1); }
  }
  throw new Error('unbalanced ' + signature);
}
const untype = s => s.replace(/:\s*(any|string|number|Uint8Array)\b/g, '');
/* a top-level function, to the brace that closes it at the start of a line (a brace inside a
   string, like crestSource's '{', would throw a counting lift off) */
function liftTop(src, signature) {
  const from = src.indexOf(signature);
  if (from === -1) throw new Error('cannot find ' + signature);
  const m = /\r?\n\}/.exec(src.slice(from));
  if (!m) throw new Error('no end for ' + signature);
  return src.slice(from, from + m.index + m[0].length);
}

const configjs = rd('epinoia', 'config.js');
const fnts = rd('supabase', 'functions', 'snapshots', 'index.ts');
const pageKey = new Function(lift(configjs, 'function crestKey(s)') + '\nreturn crestKey;')();
const fnKey = new Function(untype(lift(fnts, 'function crestKey(s: string)')) + '\nreturn crestKey;')();
const fnSource = new Function(untype(liftTop(fnts, 'function crestSource(path: any)')) + '\nreturn crestSource;')();
const rasterType = new Function(untype(liftTop(fnts, 'function rasterType(b: Uint8Array)')) + '\nreturn rasterType;')();

console.log('\none name for a crest, on both sides');
const samples = [
  'https://images.statsengine.playbyplay.api.geniussports.com/5a1b2c3d4e5fT1.png',
  'https://www.lnbp.mx/img/equipos/astros.png?v=2',
  'https://cdn.example.com/crests/Ñandú Básquet.webp',
  'https://x.y/' + 'a'.repeat(900)
];
ok('crestKey is the same function in config.js and the snapshots function',
   samples.every(u => pageKey(u) === fnKey(u)), samples.map(u => [pageKey(u), fnKey(u)]));
ok('...distinct URLs get distinct names', new Set(samples.map(pageKey)).size === samples.length);
ok('...and a name is a short, URL-safe word', samples.every(u => /^[0-9a-z]{6,12}$/.test(pageKey(u))), samples.map(pageKey));

console.log('\nconfig.js hands out sized URLs and falls back to the original');
const handlers = [];
const sandbox = { addEventListener: (type, fn, capture) => { if (type === 'error') handlers.push({ fn, capture }); },
                  document: { documentElement: { setAttribute() {} }, querySelector: () => null },
                  localStorage: { getItem: () => null }, matchMedia: () => ({ matches: false }) };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(configjs, sandbox);
const L = sandbox.epinoiaLogoUrl;
/* config.js sets its own config; the URLs are built on its project URL */
const BASE = sandbox.EPINOIA_CONFIG.supabaseUrl;
const ext = 'https://www.lnbp.mx/img/equipos/astros.png?v=2';
/* the SHIPPED config has sizing off (Pro's 100 transformed images a month were exceeded, 2026-09-26): the
   page hands out the stored file until the allowance is raised. The rest of this section exercises the
   sizing code with it switched on. */
ok('the shipped config serves stored files, not transformations',
   sandbox.EPINOIA_CONFIG.crestSizes === false && !L(ext).includes('/render/') && !L('team/9d/logo-a.webp').includes('/render/'));
ok('...another site\'s crest from its copy in "crests" (kept small by shrink_crests.py), a stored upload as it is',
   L(ext) === BASE + '/storage/v1/object/public/crests/' + pageKey(ext) && L('team/9d/logo-a.webp') === BASE + '/storage/v1/object/public/media-public/team/9d/logo-a.webp', L(ext));
sandbox.EPINOIA_CONFIG.crestSizes = true;
const sized = L(ext);
ok('another site\'s crest: its copy in "crests", through the image transformation, at 128',
   sized === BASE + '/storage/v1/render/image/public/crests/' + pageKey(ext) +
             '?width=128&height=128&resize=contain', sized);
ok('...at the size asked for, within 32-512', L(ext, 256).includes('width=256&height=256') && L(ext, 4000).includes('width=512') && L(ext, 3).includes('width=32'));
ok('...the same key the function copies it under', fnSource(ext) === ext);
ok('an upload of our own: the same, from media-public',
   L('team/9d/logo-a.webp') === BASE + '/storage/v1/render/image/public/media-public/team/9d/logo-a.webp?width=128&height=128&resize=contain',
   L('team/9d/logo-a.webp'));
ok('the JSON blob an early worker wrote is read for its url', L('{"url":"' + ext + '"}') === sized && fnSource('{"url":"' + ext + '"}') === ext);
ok('an SVG is drawn as it is, and never copied', L('https://a.b/crest.svg') === 'https://a.b/crest.svg' && fnSource('https://a.b/crest.svg') === null);
ok('http:// is still refused (mixed content)', L('http://a.b/c.png') === null && fnSource('http://a.b/c.png') === null);
ok('a stored upload is not the function\'s to copy', fnSource('team/9d/logo-a.webp') === null);

ok('one listener, on the window, in the capture phase', handlers.length === 1 && handlers[0].capture === true);
const fire = img => { let stopped = false; handlers[0].fn({ target: img, stopImmediatePropagation: () => { stopped = true; } }); return stopped; };
const a = { tagName: 'IMG', src: sized, currentSrc: sized }, b = { tagName: 'IMG', src: sized, currentSrc: sized };
const stoppedA = fire(a), stoppedB = fire(b);
ok('a copy that is not there: the image goes back to its original URL', a.src === ext && b.src === ext);
ok('...before the image\'s own error handler can give up on it', stoppedA && stoppedB);
const c = { tagName: 'IMG', src: ext, currentSrc: ext };
ok('the original failing too is left to the page (initials, monogram)', fire(c) === false && c.src === ext);
const d = { tagName: 'IMG', src: 'https://elsewhere/x.png', currentSrc: 'https://elsewhere/x.png' };
ok('any other image is none of its business', fire(d) === false && d.src === 'https://elsewhere/x.png');

sandbox.EPINOIA_CONFIG.crestSizes = false;
ok('crestSizes:false in the config turns it off: the stored copy, no transformation', L(ext) === BASE + '/storage/v1/object/public/crests/' + pageKey(ext) &&
   L('team/9d/logo-a.webp') === BASE + '/storage/v1/object/public/media-public/team/9d/logo-a.webp');
const copyUrl = L(ext), e = { tagName: 'IMG', src: copyUrl, currentSrc: copyUrl };
ok('...and a copy that is not there yet still falls back to the original', fire(e) === true && e.src === ext);
ok('...an SVG and a refused http:// are unchanged with sizing off', L('https://a.b/crest.svg') === 'https://a.b/crest.svg' && L('http://a.b/c.png') === null);

console.log('\nthe function copies only what it can prove is a raster image');
const bytes = (...xs) => new Uint8Array([...xs, ...new Array(16).fill(0)]);
const txt = s => new Uint8Array([...Buffer.from(s), ...new Array(8).fill(0)]);
ok('PNG, JPEG, GIF, WebP and AVIF by their bytes',
   rasterType(bytes(0x89, 0x50, 0x4e, 0x47)) === 'image/png' && rasterType(bytes(0xff, 0xd8, 0xff)) === 'image/jpeg' &&
   rasterType(bytes(0x47, 0x49, 0x46, 0x38)) === 'image/gif' && rasterType(txt('RIFF\0\0\0\0WEBPVP8 ')) === 'image/webp' &&
   rasterType(txt('\0\0\0\x1cftypavif')) === 'image/avif');
ok('an HTML page served as the crest (a dead host) is refused', rasterType(txt('<!doctype html><html>')) === null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
