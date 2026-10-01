// THE PAGE STANDARD (docs/page-standard.md), held. Every page built to it (its frame carries data-std):
//   * its head is header.hero.pg-head with the page's h1 and a .pg-sub;
//   * every section is .sec with an id, its .sec-h an h2 title and a .note subtitle (short, no full stop), and no
//     number before any title (no .idx, gb-idx or 01-style index);
//   * the standard's sheets in their order - kit/page.css, kit/sectitle.css, then teletext.css, legibility.css last -
//     and no <style> copying their rules;
//   * nav.js last, and nav.js gives a data-std page the teletext line, its keys, ON THIS PAGE and SKIP.
// And from 2026-09-30 on, every page is built to it: an index.html that is not on the list of the pages that came
// before the standard must carry data-std.
//
//   node supabase/tests/page-standard.test.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = path.join(ROOT, 'epinoia');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

/* THE PAGES THAT CAME BEFORE THE STANDARD (2026-09-30). They keep their look until they are next reworked; a page
   reworked to the standard comes off this list. A new page is never added to it. */
const PREDATE = new Set(`admin/index.html admin/platform/index.html android/index.html api/index.html app/index.html
  broadcast/control/index.html broadcast/help/index.html broadcast/index.html clockcam/index.html contact/index.html
  countries/index.html creators/index.html creators/studio/index.html edit/index.html embed/game/index.html embed/index.html
  embed/merch/index.html embed/notify/index.html embed/strip/index.html embed/table/index.html fan/index.html
  fixtures/index.html game/index.html games/index.html go/index.html go/nearby/index.html go/photos/index.html
  go/stamps/index.html home/index.html index.html injuries/index.html invite/index.html ios/index.html join/index.html
  l/index.html learn/index.html me/index.html news/index.html p/index.html privacy/index.html prophesy/index.html
  score/index.html signin/index.html stats/index.html t/index.html
  video/index.html votes/index.html winning/index.html`.split(/\s+/).filter(Boolean));

function pages(dir, rel = '') {
  let out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name), r = rel ? rel + '/' + name : name;
    if (statSync(full).isDirectory()) out = out.concat(pages(full, r));
    else if (name === 'index.html') out.push(r);
  }
  return out;
}
const all = pages(SITE);
const std = all.filter(p => /<div class="ep-frame[^"]*"[^>]*\sdata-std[\s>]/.test(readFileSync(path.join(SITE, p), 'utf8')));

console.log('every page from now on');
const late = all.filter(p => !PREDATE.has(p) && !std.includes(p));
ok('every page not on the list of those that came before the standard is built to it (data-std)', late.length === 0, late);
ok('...and the list names only pages that exist (a page removed comes off it)', [...PREDATE].every(p => all.includes(p)), [...PREDATE].filter(p => !all.includes(p)));
ok('...the Community page is built to it', std.includes('community/index.html'), std);

const sheetOrder = html => [...html.matchAll(/<link rel="stylesheet" href="([^"?]+)/g)].map(m => m[1].replace(/^(\.\.\/)+/, ''));
const scriptList = html => [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1].replace(/^(\.\.\/)+/, ''));
for (const p of std) {
  const html = readFileSync(path.join(SITE, p), 'utf8');
  console.log('\n' + p);
  const head = (html.match(/<header class="hero pg-head"[^>]*>([\s\S]*?)<\/header>/) || [])[1] || '';
  ok('its head: header.hero.pg-head with the page\'s one h1 and what it is for (.pg-sub)',
     /<h1[\s>]/.test(head) && /class="pg-sub"/.test(head) && (html.match(/<h1[\s>]/g) || []).length === 1, head.slice(0, 200));
  const secs = [...html.matchAll(/<section class="sec[^"]*"([^>]*)>([\s\S]*?)<\/section>/g)];
  ok('it is made of sections (.sec), each with an id', secs.length >= 1 && secs.every(m => /\sid="[^"]+"/.test(m[1])), secs.map(m => m[1]));
  const heads = secs.map(m => (m[2].match(/<div class="sec-h">([\s\S]*?)<\/div>/) || [])[1] || '');
  ok('...each titled (.sec-h h2) with a subtitle (.note) under it', heads.every(h => /<h2[\s>][\s\S]*?<\/h2>\s*<p class="note"[^>]*>[^<]{6,}/.test(h)), heads.map(h => h.slice(0, 120)));
  const notes = heads.map(h => ((h.match(/<p class="note"[^>]*>([^<]*)<\/p>/) || [])[1] || '').trim());
  ok('...a subtitle is a short line: 70 characters at most, no full stop at its end', notes.every(n => n.length > 0 && n.length <= 70 && !/\.$/.test(n)), notes);
  ok('no numbered section: no .idx, no gb-idx, no 01 before a title', !/class="(idx|gb-idx)"/.test(html) && !/<h2[^>]*>\s*0\d\b/.test(html));
  const sheets = sheetOrder(html), at = f => sheets.indexOf(f);
  ok('the standard\'s sheets in their order: page.css, sectitle.css, teletext.css, legibility.css last',
     at('kit/page.css') > at('kit/nav.css') && at('kit/sectitle.css') > at('kit/page.css') && at('kit/teletext.css') > at('kit/sectitle.css') &&
     at('kit/legibility.css') === sheets.length - 1 && at('kit/epinoia-kit.css') === 0, sheets);
  const own = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  ok('...and no copy of their rules in the page (.sec, .sec-h, .pg-head)', !/(^|[\s,}])\.(sec|sec-h|pg-head|pg-sub)\s*[{,]/m.test(own), own.slice(0, 200));
  const scripts = scriptList(html);
  ok('nav.js is its last script', scripts[scripts.length - 1] === 'nav.js', scripts);
  if (/\?l=|league/i.test(head + html.slice(0, 3000))) {
    ok('a page about a league loads teamcolour.js for the league\'s colours', scripts.includes('teamcolour.js'), scripts);
  }
}

console.log('\nwhat nav.js and the sheets give such a page');
const nav = readFileSync(path.join(SITE, 'nav.js'), 'utf8');
ok('nav.js takes a data-std frame for a page of the standard: the line, its keys, ON THIS PAGE and SKIP',
   /document\.querySelector\('\.ep-frame\[data-std\]'\) \? \{ kind: 'std' \}/.test(nav) && /\/\^\(home\|league\|team\|player\|std\)\$\/\.test\(p\.kind\)/.test(nav) &&
   /\['news', 'article', 'votes', 'video', 'std'\]\.forEach/.test(nav));
const page = readFileSync(path.join(SITE, 'kit', 'page.css'), 'utf8'), sect = readFileSync(path.join(SITE, 'kit', 'sectitle.css'), 'utf8');
ok('kit/page.css: the centred head, the section base, the subtitle, and the helpers (row, more, empty, switch, narrow)',
   /\.pg-head\{[^}]*align-items:center[^}]*text-align:center/.test(page) && /\.sec-h \.note\{/.test(page) &&
   ['.pg-row', '.pg-more', '.pg-empty', '.pg-seg', '.sec-b.narrow', '.pg-kick', '.pg-sub'].every(c => page.includes(c + '{') || page.includes(c + ' ') || page.includes(c + ',')));
ok('kit/sectitle.css: titles centred, never numbered', /body \.sec-h\{[^}]*justify-content:center[^}]*text-align:center/.test(sect) && /body \.sec-h \.idx\{ display:none \}/.test(sect));
const doc = readFileSync(path.join(ROOT, 'docs', 'page-standard.md'), 'utf8'), claude = readFileSync(path.join(ROOT, 'CLAUDE.md'), 'utf8');
ok('the standard is written down, and the repository\'s notes point every new page at it', /No numbered sections/.test(doc) && /Every section has a subtitle/.test(doc) &&
   /docs\/page-standard\.md/.test(claude));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
