// The console's Links tab and the public pages' switchers (epinoia/admin/platform/links-ui.js, epinoia/linkswitch.js). No browser,
// no network: a small stand-in for the page, and fake answers in the shape the database gives (0178).
//
//   node supabase/tests/links-ui.test.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };

/* ---------------------------------------------------------------- a stand-in page --- */
class N {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.text = ''; this.attrs = {}; this.handlers = {}; this.style = {}; this._cls = new Set(); this.hidden = false; this.value = ''; }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() { const s = this._cls; return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => { (on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c); } }; }
  appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter(x => x !== c); c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(typeof c === 'string' ? Object.assign(new N('#text'), { text: c }) : c)); }
  set textContent(v) { this.children.forEach(c => { c.parent = null; }); this.children = []; this.text = v == null ? '' : String(v); }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  fire(t, e = {}) { (this.handlers[t] || []).forEach(f => f(Object.assign({ preventDefault() {}, stopPropagation() {}, target: this, key: '' }, e))); }
  find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.find(pred, out)); return out; }
  cls(c) { return this.find(n => n._cls.has(c)); }
}
const docHandlers = {};
globalThis.document = {
  createElement: t => new N(t), createTextNode: t => Object.assign(new N('#text'), { text: t }),
  addEventListener: (t, f) => { (docHandlers[t] = docHandlers[t] || []).push(f); },
  querySelector: () => null, body: new N('body')
};
globalThis.window = {};
const require = createRequire(import.meta.url);
const L = require(path.join(here, '..', '..', 'epinoia', 'admin', 'platform', 'links-ui.js'));
const K = require(path.join(here, '..', '..', 'epinoia', 'linkswitch.js'));
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------- the console: pure --- */
console.log('-- the flagged possibilities');
const sug = [{ confidence: 'low' }, { confidence: 'high' }, { confidence: 'medium' }, { confidence: 'high' }];
ok('the tally counts each confidence', JSON.stringify(L.tally(sug)) === JSON.stringify({ high: 2, medium: 1, low: 1 }));
ok('narrowing keeps one confidence, "all" keeps every one', L.narrowed(sug, 'high').length === 2 && L.narrowed(sug, 'all').length === 4 && L.narrowed(sug, 'low').length === 1);
ok('the most sure sort first', sug.slice().sort(L.bySureness).map(r => r.confidence).join() === 'high,high,medium,low');
ok('each confidence says what it means', ['high', 'medium', 'low'].every(k => L.CONF_HELP[k].length > 10));
ok('every kind of player match has a word, the ambiguous initial included', ['exact', 'core', 'short', 'ambiguous'].every(k => L.KIND_WORD[k]));
const team = { id: 't1', slug: 'london-lions', name: 'London Lions', competitions: [{ season: '2026-27', name: 'A' }, { season: '2026-27', name: 'B' }, { season: '2025-26', name: 'A' }] };
ok('a team\'s seasons are listed once each, newest first', JSON.stringify(L.seasonsOf(team)) === JSON.stringify(['2026-27', '2025-26']));
const pcard = { spells: [{ team: 'Newcastle', league: 'SLB', season: '2026-27' }, { team: 'Newcastle', league: 'SLB', season: '2026-27' }, { team: 'Bourg', league: 'Elite', season: '2025-26' }, { team: 'X', league: 'Y', season: '2024-25' }, { team: 'Z' }] };
const sp = L.spellLines(pcard, 3);
ok('a player\'s places, without repeats, capped, the rest counted', sp.shown.length === 3 && sp.more === 1 && sp.shown[0] === 'Newcastle · SLB · 2026-27', sp);
ok('a link to the public page opens the team by slug and the player by id', L.publicHref('team', team) === '../../t/?t=london-lions' && L.publicHref('player', { id: 'abc' }) === '../../p/?p=abc');

/* ---------------------------------------------------------------- the dropdown --- */
console.log('-- the dropdown');
{
  const asked = []; const picked = [];
  let release = null;
  const C = L.combo({
    placeholder: 'find', delay: 0,
    fetch: q => { asked.push(q); if (q === 'slow') return new Promise(r => { release = () => r([{ id: 'old' }]); }); return Promise.resolve({ rows: [{ id: q + '1' }, { id: q + '2' }], more: q === 'many' }); },
    render: (r, li) => { li.textContent = r.id; },
    pick: r => picked.push(r.id)
  });
  const input = C.input, list = C.root.cls('lk-list')[0];
  const type = async v => { input.value = v; input.fire('input'); await tick(15); };
  await type('ab');
  ok('typing asks the server, and the list shows what came back', asked[asked.length - 1] === 'ab' && list.hidden === false && list.cls('lk-opt').length === 2, asked);
  ok('the first result is highlighted', list.children[0].classList.contains('on'));
  input.fire('keydown', { key: 'ArrowDown' });
  ok('the arrow key moves down', list.children[1].classList.contains('on') && !list.children[0].classList.contains('on'));
  input.fire('keydown', { key: 'Enter' });
  ok('Enter picks the highlighted one, closes the list and clears the box', picked.join() === 'ab2' && list.hidden === true && input.value === '', picked);
  await type('many');
  ok('a query with more behind it says so', list.children[list.children.length - 1].textContent.includes('more matches'));
  input.fire('keydown', { key: 'Escape' });
  ok('Escape closes the list', list.hidden === true);
  await type('slow');                                    // an answer that has not come back yet...
  await type('fast');                                    // ...is overtaken by a later question
  release();
  await tick(15);
  ok('a slow answer to an old question does not replace a newer one', list.cls('lk-opt').map(li => li.textContent).join() === 'fast1,fast2', list.cls('lk-opt').map(li => li.textContent));
  list.cls('lk-opt')[0].fire('pointerdown');
  ok('pressing a result picks it', picked[picked.length - 1] === 'fast1');
  await type('');
  ok('an empty box shows nothing (minChars 1)', list.hidden === true);
}

/* ---------------------------------------------------------------- the public pages --- */
console.log('-- the public pages: switchers');
const CARDS = [
  { id: 'a', slug: 'london-lions', name: 'London Lions', league: 'Super League Basketball Men', women: false, competitions: [{ season: '2026-27', name: 'SLB' }, { season: '2026-27', name: 'Cup' }, { season: '2025-26', name: 'SLB' }] },
  { id: 'b', slug: 'london-lions-eurocup', name: 'London Lions', league: 'EuroCup', women: false, competitions: [{ season: '2025-26', name: 'EuroCup' }] },
  { id: 'c', slug: 'london-lions-women', name: 'London Lions', league: 'Super League Basketball Women', women: true, competitions: [{ season: '2026-27', name: 'Championship' }] }
];
ok('seasons across a club\'s teams, newest first', JSON.stringify(K.seasonsAcross(CARDS)) === JSON.stringify(['2026-27', '2025-26']));
ok('a team\'s competitions by season, optionally one season', JSON.stringify(K.bySeason(CARDS[0], null).map(g => g.season)) === JSON.stringify(['2026-27', '2025-26'])
   && K.bySeason(CARDS[0], '2025-26').length === 1 && K.bySeason(CARDS[0], '2026-27')[0].names.join() === 'SLB,Cup');
ok('a player\'s link group: every id, himself first if missing', K.playerIds({ players: [{ id: 'x' }, { id: 'y' }] }, 'me').join() === 'me,x,y' && K.playerIds(null, 'me').join() === 'me'
   && K.playerIds({ players: [{ id: 'me' }, { id: 'y' }] }, 'me').join() === 'me,y');
ok('a club linked to nothing gets no switcher; one alone neither', K.teamSwitcher(null, 'a') === null && K.teamSwitcher({ teams: [CARDS[0]] }, 'a') === null);
{
  const sw = K.teamSwitcher({ group: 'London Lions', teams: CARDS }, 'a');
  ok('a linked club gets a button that counts its sides', sw && sw.cls('ls-btn')[0] && sw.cls('ls-btn-n')[0].textContent === '3');
  const items = () => sw.cls('ls-item');
  ok('it lists every side, linking to that side\'s page', items().length === 3 && items().map(i => i.href).join() === './?t=london-lions,./?t=london-lions-eurocup,./?t=london-lions-women', items().map(i => i.href));
  ok('the page you are on is marked', items()[0].classList.contains('on') && items()[0].cls('ls-here').length === 1 && !items()[1].classList.contains('on'));
  ok('the women\'s side carries the indicator', items()[2].cls('ls-women').length === 1 && items()[0].cls('ls-women').length === 0);
  ok('each side lists its seasons with the competitions of each', items()[0].cls('ls-row').length === 2 && items()[0].cls('ls-c')[0].textContent === 'SLB · Cup');
  const sel = sw.cls('ls-season')[0];
  ok('with two seasons there is a season filter', !!sel && sel.children.length === 3);
  sel.value = '2025-26'; sel.fire('change');
  ok('choosing a season keeps only the sides that played it', items().length === 2 && items().every(i => i.cls('ls-s').every(s => s.textContent === '2025-26')), items().length);
  sel.value = '2026-27'; sel.fire('change');
  ok('...and another season, another set', items().length === 2 && items().some(i => i.cls('ls-women').length === 1));
  const btn = sw.cls('ls-btn')[0], pop = sw.cls('ls-pop')[0];
  ok('the panel starts shut and the button opens and shuts it', pop.hidden === true && (btn.fire('click'), pop.hidden === false) && (btn.fire('click'), pop.hidden === true));
  btn.fire('click');
  (docHandlers.keydown || []).forEach(f => f({ key: 'Escape' }));
  ok('Escape shuts it', pop.hidden === true);
}
{
  const PL = { group: 'Deane Williams', players: [
    { id: 'p1', slug: 'deane-williams', name: 'Deane Williams', spells: [{ team: 'London Lions', league: 'SLB', season: '2026-27' }] },
    { id: 'p2', slug: 'd-williams', name: 'D Williams', spells: [{ team: 'London Lions', league: 'EuroCup', season: '2026-27' }, { team: 'London Lions Women', league: 'SLBW', season: '2025-26', women: true }] }] };
  const sw = K.playerSwitcher(PL, 'p1');
  ok('a linked player gets "other profiles" counting the others', sw && sw.cls('ls-btn-n')[0].textContent === '1');
  const items = sw.cls('ls-item');
  ok('each profile is a link, the current one marked, with where he played', items.length === 2 && items[0].classList.contains('on') && items[1].href === './?p=d-williams' && items[1].cls('ls-row').length === 2, items.map(i => i.href));
  ok('a spell at a women\'s side says so', items[1].cls('ls-women').length === 1 && items[0].cls('ls-women').length === 0);
  ok('a player linked to nothing gets none', K.playerSwitcher(null, 'p1') === null && K.playerSwitcher({ players: [PL.players[0]] }, 'p1') === null);
}
ok('a name is never translated (club, league, player names carry translate="no")', (() => {
  const sw = K.teamSwitcher({ group: 'G', teams: CARDS }, 'a');
  return sw.find(n => n.attrs.translate === 'no').length !== 0;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
