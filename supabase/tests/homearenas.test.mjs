// Home arenas: the rule for a club's secondary arenas, the team panel that lists them, and the
// console line that lists the clubs using an arena - no network, no browser.
//
//   node supabase/tests/homearenas.test.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const H = require(path.join(here, '..', '..', 'epinoia', 'homearenas.js'));

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw))); } };
const times = (id, n) => Array(n).fill(id);

console.log('-- the rule: at least two home games, at least a tenth of the club\'s home games that name an arena');
ok('two games out of twenty is a tenth: a home', H.qualifies(2, 20));
ok('one game is never a home, however small the club', !H.qualifies(1, 1) && !H.qualifies(1, 5));
ok('two out of twenty-one is not a tenth', !H.qualifies(2, 21));
ok('nothing to divide by', !H.qualifies(3, 0));

console.log('-- a club\'s arenas');
let s = H.split([...times('big', 24), ...times('small', 6), ...times('cup', 1)], 'big');
ok('the recorded arena is the main one, with its count', s.primary === 'big' && s.primaryN === 24 && s.total === 31, s);
ok('a hall used six times is listed; the one cup tie is not', JSON.stringify(s.others) === JSON.stringify([{ id: 'small', n: 6 }]), s.others);
s = H.split([...times('a', 5), ...times('b', 9), ...times('c', 7)], null);
ok('no arena on record: the busiest is the main one', s.primary === 'b', s);
ok('the others follow busiest first', s.others.map(o => o.id).join() === 'c,a', s.others);
s = H.split([...times('a', 3), ...times('b', 3)], null);
ok('a tie is broken the same way every time (by id)', s.primary === 'a' && s.others[0].id === 'b', s);
s = H.split(times('rec', 2).concat(times('x', 12)), 'rec');
ok('the recorded arena stays main even when another is busier (a person or the learner said so)', s.primary === 'rec' && s.others[0].id === 'x', s);
s = H.split([...times('m', 10), ...['a', 'b', 'c', 'd', 'e', 'f'].flatMap(i => times(i, 3))], 'm');
ok('at most four others', s.others.length === H.MAX_OTHERS, s.others.length);
ok('no games: no arenas', H.split([], null).primary === null && H.split(null, 'x').others.length === 0);
ok('a game with no venue is not counted', H.split([null, undefined, '', 'a', 'a'], 'a').total === 2);

console.log('-- the console: clubs using an arena as a secondary home');
const at = [...times('t1', 12), ...times('t2', 2), ...times('t3', 1), ...times('t4', 8)];
const totals = { t1: 14, t2: 30, t3: 1, t4: 10 };
const use = H.clubsUsing(at, totals, ['t4']);
ok('a recorded club is left to its own line', !use.some(c => c.id === 't4'), use);
ok('twelve of fourteen qualifies; two of thirty does not; one game never does', JSON.stringify(use) === JSON.stringify([{ id: 't1', n: 12, total: 14 }]), use);
ok('the same rule as the team profile', H.clubsUsing(times('t', 3), { t: 30 }, []).length === 1 && H.split([...times('p', 27), ...times('q', 3)], 'p').others.length === 1);

console.log('-- the team panel lists them, smaller, busiest first');
class Node_ {
  constructor(tag) { this.tag = tag; this.className = ''; this.children = []; this.text = ''; this.attrs = {}; }
  appendChild(c) { this.children.push(c); return c; }
  append(...c) { c.forEach(x => this.children.push(x)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  set textContent(v) { this.text = v; }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
}
globalThis.document = { createElement: t => new Node_(t), createTextNode: t => Object.assign(new Node_('#text'), { text: t }) };
const V = require(path.join(here, '..', '..', 'epinoia', 't', 'venue.js'));
ok('a club with one arena gets no list', V.otherArenas({ home_arenas: { main: { name: 'A', n: 20 }, others: [], total: 20 } }) === null && V.otherArenas({}) === null);
const box = V.otherArenas({ home_arenas: { main: { name: 'Big Hall', n: 24 }, total: 31, others: [
  { id: 'x', name: 'Regional Arena', city: 'Leon', n: 6, place_id: 'ChIJabc1234567' }, { id: 'y', name: 'Cup Hall', n: 2 }] } });
const rows = box.children.filter(c => c.className === 'varena');
ok('a heading and one row per arena', box.className === 'varenas' && rows.length === 2 && box.children[0].text === 'Also plays home games at');
ok('busiest first, with the count in words', rows[0].children[0].text === 'Regional Arena' && /6 home games/.test(rows[0].textContent) && /2 home games/.test(rows[1].textContent), rows.map(r => r.textContent));
ok('the name is a link to Maps carrying the Google place, and is never translated',
   /google\.com\/maps\/search/.test(rows[0].children[0].href) && /query_place_id=ChIJabc1234567/.test(rows[0].children[0].href) && rows[0].children[0].attrs.translate === 'no', rows[0].children[0].href);
ok('one game is "1 home game", not "1 home games"', /1 home game$/.test(V.otherArenas({ home_arenas: { others: [{ name: 'Zeta', n: 1 }] } }).children[1].textContent));

console.log('-- the two languages read the phrases and the counts, through the real engine');
const I18N = require(path.join(here, '..', '..', 'epinoia', 'i18n.js'));
const dict = code => {
  let d = null;
  vm.runInNewContext(fs.readFileSync(path.join(here, '..', '..', 'epinoia', 'i18n', code + '.js'), 'utf8'),
    { window: { EpinoiaI18n: { register: (c, x, pack) => { if (c === code && !pack) d = x; } } } });
  return I18N.compile(code, d);
};
const J = dict('ja'), E = dict('es');
const tj = s => I18N.translateText(J, s, []), te = s => I18N.translateText(E, s, []);
ok('ja: the heading', tj('Also plays home games at') === 'その他のホームアリーナ', tj('Also plays home games at'));
ok('ja: the main arena caption', tj('Main home arena') === 'メインのホームアリーナ', tj('Main home arena'));
ok('ja: a count', tj('6 home games') === 'ホームゲーム6試合' && tj('1 home game') === 'ホームゲーム1試合', tj('6 home games'));
ok('ja: the console line', tj('(secondary · 12 of 15 home games)') === '（サブ · ホームゲーム15試合中12試合）', tj('(secondary · 12 of 15 home games)'));
ok('es: the heading and the caption', te('Also plays home games at') === 'También juega en casa en' && te('Main home arena') === 'Pabellón principal');
ok('es: a count, one and many', te('1 home game') === '1 partido en casa' && te('6 home games') === '6 partidos en casa', te('6 home games'));
ok('es: the console line', te('(secondary · 12 of 15 home games)') === '(secundario · 12 de 15 partidos en casa)', te('(secondary · 12 of 15 home games)'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
