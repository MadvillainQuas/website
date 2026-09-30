// The stat explainers and the popup's label placement (epinoia/statinfo.js, epinoia/statpop.js).
//   node supabase/tests/statpop.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'epinoia');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };

const SI = require(path.join(ROOT, 'statinfo.js'));
const SP = require(path.join(ROOT, 'statpop.js'));
const player = readFileSync(path.join(ROOT, 'p', 'player.js'), 'utf8');

console.log('-- every bar of the League percentile section is explained');
const sec = player.slice(player.indexOf('const BAR_SECTIONS = ['), player.indexOf('const BAR_GROUPS'));
const keys = [...sec.matchAll(/\[\s*'([a-z0-9_]+)'\s*,\s*'[^']*'\s*\]/g)].map(m => m[1]);
ok('BAR_SECTIONS was parsed (' + keys.length + ' keys)', keys.length > 40, keys.length);
const lowText = (player.match(/const BAR_LOW = \[([\s\S]*?)\];/) || [, ''])[1];
const barLow = [...lowText.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]);
for (const k of keys) {
  const i = SI.info(k);
  ok(k + ' has a title, what, formula and read', !!i && ['title', 'what', 'formula', 'read'].every(f => typeof i[f] === 'string' && i[f].length > 3), i);
  if (i) ok(k + ': low matches BAR_LOW', i.low === (barLow.indexOf(k) !== -1), [i.low, barLow.indexOf(k)]);
}
console.log('-- the club page and the help panel');
for (const k of SI.TEAM_KEYS) ok('team stat ' + k + ' is explained', !!SI.info(k, 'team'));
for (const g of SI.groups.concat(SI.teamGroups)) for (const k of g.keys) ok('help group ' + g.key + ' / ' + k + ' resolves', !!SI.info(k));
ok('a club reads assist % its own way', SI.info('ast_pct', 'team').what !== SI.info('ast_pct').what);
ok('an unknown key is null', SI.info('nope') === null);

console.log('-- label placement never overlaps');
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
let bad = 0, labelled = 0, trials = 300;
for (let t = 0; t < trials; t++) {
  const W = 260 + Math.floor(rnd() * 400), H = 240 + Math.floor(rnd() * 160);
  const cx = rnd() * W, cy = rnd() * H, n = 4 + Math.floor(rnd() * 20);
  const pts = [];
  for (let i = 0; i < n; i++) {
    // half of them clustered around one spot, to make it hard
    const x = i % 2 ? cx + (rnd() - 0.5) * 40 : rnd() * W, y = i % 2 ? cy + (rnd() - 0.5) * 40 : rnd() * H;
    pts.push({ id: 'p' + i, x, y, r: i === 0 ? 13 : 10, w: 30 + Math.floor(rnd() * 60), h: 14, must: i === 0 });
  }
  const out = SP.placeLabels(pts, { width: W, height: H, gap: 3, max: 6 });
  labelled += out.length;
  const byId = new Map(pts.map(p => [p.id, p]));
  if (out.filter(o => !byId.get(o.id).must).length > 6) bad++;
  const markers = pts.map(p => ({ x: p.x - p.r, y: p.y - p.r, w: 2 * p.r, h: 2 * p.r }));
  for (let i = 0; i < out.length; i++) {
    const b = out[i].box;
    if (b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H) bad++;
    if (markers.some(m => hit(b, m))) bad++;
    for (let j = i + 1; j < out.length; j++) if (hit(b, out[j].box)) bad++;
  }
}
ok('no overlaps, no escapes, at most six others across ' + trials + ' random layouts (' + labelled + ' labels placed)', bad === 0, bad);
ok('an empty list places nothing', SP.placeLabels([], { width: 100, height: 100 }).length === 0);
const lone = SP.placeLabels([{ id: 'a', x: 50, y: 50, r: 10, w: 40, h: 14, must: true }], { width: 200, height: 100 });
ok('a lone subject is labelled', lone.length === 1 && lone[0].side === 'r', lone);

console.log(fail ? '\n' + fail + ' FAILED' : '\nall ' + pass + ' passed');
process.exit(fail ? 1 : 0);
