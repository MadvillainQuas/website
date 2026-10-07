/* ============================================================================
   THE REPORT'S PDF CAN BE FOUND YOUR WAY ROUND (2026-10-07; raster.js, report.js), AND ITS PLACES ARE THIS SEASON'S
   (report-teampages.js).

     node supabase/tests/report-pdf-links.test.mjs

   What would go wrong quietly:
     1. a link or a bookmark object written without its place in the cross-reference table: a reader that is strict
        about it (Acrobat) calls the file damaged
     2. a link put upside down (PDF counts from the bottom of the page) or onto the wrong page
     3. a bookmark's title losing its accents and dots ('Shot clock · defence', a player's name)
     4. the contents and the page numbers not marked as links, or the PDF not handed the bookmarks
     5. "4th of 38": a place counted among every season's clubs where it should be among this season's
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + JSON.stringify(detail).slice(0, 400) : '')); }
};

const X = require(path.join(ROOT, 'epinoia', 'raster.js'));
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const pages = [
  { bytes: jpeg, w: 794, h: 1123, links: [{ x: 0.5, y: 0.1, w: 0.4, h: 0.02, page: 2 }, { x: 0.5, y: 0.2, w: 0.4, h: 0.02, page: 3 }, { x: 0, y: 0, w: 0.1, h: 0.1, page: 9 }] },
  { bytes: jpeg, w: 794, h: 1123, links: [{ x: 0.9, y: 0.97, w: 0.05, h: 0.01, page: 1 }] },
  { bytes: jpeg, w: 794, h: 1123 }
];
const outline = [{ title: 'Cover and contents', page: 1 },
  { title: 'Combinations', page: 2, kids: [{ title: 'Shot clock · defence', page: 2 }, { title: 'Zoë Müller', page: 3 }] },
  { title: 'Legend', page: 3 }, { title: 'Nowhere', page: 12 }];
const b = X.pdfFromJpegs(pages, { title: 'Report', date: new Date(Date.UTC(2026, 9, 7)), outline });
const s = Buffer.from(b).toString('latin1');

console.log('\n1. every object in the cross-reference table');
const sx = +/startxref\n(\d+)/.exec(s)[1];
const m = /^xref\n0 (\d+)\n/.exec(s.slice(sx));
const n = +m[1];
const ents = s.slice(sx + m[0].length).split('\n').slice(0, n);
const objs = {};
let bad = [];
for (let k = 1; k < n; k++) {
  const off = +ents[k].slice(0, 10);
  if (!s.startsWith(k + ' 0 obj', off)) bad.push(k);
  else objs[k] = s.slice(off, s.indexOf('endobj', off));
}
ok('each entry points at its own object', !bad.length, bad);
ok('the trailer\'s size is the table\'s', new RegExp('/Size ' + n + ' ').test(s));
ok('the catalog names the bookmarks and opens them', /\/Outlines \d+ 0 R \/PageMode \/UseOutlines/.test(objs[1]), objs[1]);

console.log('\n2. the links');
const kids = /\/Kids \[([^\]]*)\]/.exec(objs[2])[1].split(' 0 R').map(x => x.trim()).filter(Boolean).map(Number);
const pageOf = id => kids.indexOf(id) + 1;
const annotsOf = p => { const a = /\/Annots \[([^\]]*)\]/.exec(objs[kids[p - 1]]); return a ? a[1].split(' 0 R').map(x => x.trim()).filter(Boolean).map(Number) : []; };
const dests = p => annotsOf(p).map(id => pageOf(+/\/Dest \[(\d+) 0 R/.exec(objs[id])[1]));
ok('the cover\'s two lines go to pages 2 and 3 (a link to a page the file has not got is left out)', JSON.stringify(dests(1)) === '[2,3]', dests(1));
ok('page 2\'s number goes back to page 1', JSON.stringify(dests(2)) === '[1]', dests(2));
ok('a page with no links has no /Annots', annotsOf(3).length === 0);
const rect = /\/Rect \[([^\]]*)\]/.exec(objs[annotsOf(1)[0]])[1].split(' ').map(Number);
ok('a link near the top of the page is near the top in PDF terms (counted from the bottom)', rect[3] > 740 && rect[1] < rect[3] && Math.abs(rect[0] - 297.64) < 1, rect);
ok('links are borderless', /\/Border \[0 0 0\]/.test(objs[annotsOf(1)[0]]));

console.log('\n3. the bookmarks');
const items = Object.entries(objs).filter(([, v]) => /\/Title </.test(v) && /\/Parent/.test(v));
const title = v => { const h = /\/Title <FEFF([0-9A-F]*)>/.exec(v)[1]; let t = ''; for (let i = 0; i < h.length; i += 4) t += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return t; };
const T = items.map(([, v]) => title(v));
ok('every section and heading, and none for a page the file has not got', T.length === 5 && T.indexOf('Nowhere') < 0, T);
ok('titles keep their dots and accents', T.indexOf('Shot clock · defence') >= 0 && T.indexOf('Zoë Müller') >= 0, T);
const comb = items.find(([, v]) => title(v) === 'Combinations')[1];
ok('a section holds its headings, folded', /\/First \d+ 0 R \/Last \d+ 0 R \/Count -2/.test(comb), comb);
const root = /\/Outlines (\d+) 0 R/.exec(objs[1])[1];
ok('the outline counts its open items', new RegExp('/Count 3').test(objs[root]), objs[root]);
const pdfNo = X.pdfFromJpegs(pages.map(p => ({ bytes: p.bytes, w: p.w, h: p.h })), { title: 'Report' });
ok('without links or bookmarks the file is as before', !/\/Outlines|\/Annots/.test(Buffer.from(pdfNo).toString('latin1')));

console.log('\n4. the report marks its links and hands over the bookmarks');
const R = rd('epinoia', 'report.js'), RS = rd('epinoia', 'raster.js');
ok('the contents\' lines carry data-goto', /<li data-goto="' \+ n \+ '"/.test(R));
ok('every page\'s number goes back to the contents', /n\.setAttribute\('data-goto', '1'\)/.test(R));
ok('both PDFs (download, PRIME REPORT) are handed the bookmarks', (R.match(/outline: state\.outline \|\| null/g) || []).length === 2);
ok('each block is told its section', /setAttribute\('data-mod', m\.page \|\| m\.title\)/.test(R));
ok('raster.js reads the links off each page before drawing it', /const links = linksOf\(nodes\[i\]\)/.test(RS));

console.log('\n5. places among this season\'s clubs; half-court AST% a bar among them');
const TP = rd('epinoia', 'report-teampages.js');
ok('rankOf leaves earlier seasons out of the count', /filter\(t => !t\.__prior && t\[k\] != null/.test(TP));
ok('a unit\'s place is among this season\'s ratings', /LGRnow\[k\] = teams\.filter\(r => !r\.__prior\)/.test(TP));
ok('the field named is this season\'s clubs', /const N = teams\.filter\(r => !r\.__prior\)\.length/.test(TP));
ok('half-court AST% is ranked (not the gap to all baskets)', /tm_hc_ast_pct: \{ l: 'HALF-COURT AST%', dp: 1, style: true \}/.test(TP));
ok('every club\'s half-court AST% from the scope\'s games', /async function hcTeams\(games\)/.test(TP) && /await hcTeams\(S\.games\)/.test(TP));
const RJ = require(path.join(ROOT, 'epinoia', 'report.js'));
const rk = RJ.ranker([{ id: 'a', x: 1 }, { id: 'b', x: 2 }, { id: 'c@0', x: 3, __prior: true }], ['x']);
ok('a ranker counts the season shown apart (nNow)', rk.n === 3 && rk.nNow === 2, [rk.n, rk.nNow]);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
