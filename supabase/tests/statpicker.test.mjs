/* ============================================================================
   THE GRAPHICS TAB'S STAT PICKER (epinoia/admin/statpicker.js), with a small DOM of its own.

     node supabase/tests/statpicker.test.mjs

   Held here:
     * the pure parts: a key added at the end (never twice, never past the most), removed (never below the least), moved to
       a place (clamped), and what the add box offers (what is not chosen, every word of the search found, by group);
     * the control: the chosen as chips in their order, numbered; x removes, Backspace / Delete on a chip removes it and the
       focus goes to the next; the arrow keys move a chip (and keep the focus on it), Home / End to the ends, the arrow
       buttons do the same; dragging with a pointer (a finger as a mouse: pointer events, captured) puts a chip where it is
       let go, and a press that does not move is not a drag; the add box lists only what is not chosen, by group, searched,
       arrow keys and Enter or a click add; at the most it says so and offers nothing, at the least x is put away and the
       key says why; reset goes back to the default; every change is handed to set() at once (the preview redraws);
     * the Graphics tab uses it for every list of stats (a star's, the week's, the month's, a table's columns, a final's team
       stats and leaders' lines, the leaders' categories), and the console loads it before the tab.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

/* ------------------------------------------------------------- DOM stub --- */
const DOC = { activeElement: null };
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this._t = ''; this.attrs = {}; this.listeners = {};
    this._cls = new Set(); this.dataset = {}; this.hidden = false; this.disabled = false; this.value = ''; this.style = {};
    const self = this;
    this.classList = { add: c => self._cls.add(c), remove: c => self._cls.delete(c), contains: c => self._cls.has(c),
      toggle: (c, f) => { const on = f === undefined ? !self._cls.has(c) : !!f; if (on) self._cls.add(c); else self._cls.delete(c); return on; } };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get textContent() { return this._t + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._t = String(v); }
  get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  appendChild(n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(n)); }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n);
    n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t, e) { const ev = Object.assign({ type: t, target: this, preventDefault() { ev.prevented = true; }, stopPropagation() {} }, e || {}); (this.listeners[t] || []).forEach(f => f(ev)); return ev; }
  focus() { DOC.activeElement = this; this.fire('focus'); }
  click() { if (!this.disabled) this.fire('click'); }
  setPointerCapture(id) { this.captured = id; }
  scrollIntoView() {}
  all(pred, out = []) { this.children.forEach(c => { if (pred(c)) out.push(c); c.all(pred, out); }); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    let m = /^\[data-k="(.+)"\]$/.exec(sel);
    if (m) return this.all(n => n.dataset.k === m[1]);
    m = /^\.([\w-]+)$/.exec(sel);
    if (m) return this.all(n => n._cls.has(m[1]));
    throw new Error('stub selector: ' + sel);
  }
  /* the chips laid out in a row, 100px each, so a drag can be aimed */
  getBoundingClientRect() { const i = this.parentNode ? this.parentNode.children.indexOf(this) : 0; return { left: i * 100, right: i * 100 + 90, top: 0, bottom: 30, width: 90, height: 30 }; }
}
const root = { document: { createElement: t => new El(t), get activeElement() { return DOC.activeElement; } }, setTimeout: f => f() };
globalThis.document = root.document;
const SP = require(path.join(ROOT, 'epinoia', 'admin', 'statpicker.js'));

console.log('\nthe pure parts');
ok('add: at the end, never twice, never past the most', SP.addKey(['a', 'b'], 'c', 3).join() === 'a,b,c' && SP.addKey(['a', 'b'], 'a', 3).join() === 'a,b' && SP.addKey(['a', 'b', 'c'], 'd', 3).join() === 'a,b,c');
ok('remove: never below the least', SP.removeKey(['a', 'b', 'c'], 'b', 1).join() === 'a,c' && SP.removeKey(['a'], 'a', 1).join() === 'a' && SP.removeKey(['a'], 'a', 0).length === 0 && SP.removeKey(['a'], 'z', 0).join() === 'a');
ok('move: to a place, clamped at both ends', SP.moveKey(['a', 'b', 'c'], 'c', 0).join() === 'c,a,b' && SP.moveKey(['a', 'b', 'c'], 'a', 9).join() === 'b,c,a' && SP.moveKey(['a', 'b', 'c'], 'b', -3).join() === 'b,a,c');
const ITEMS = [
  { id: 'pts', label: 'PTS', title: 'points', group: 'own', groupLabel: 'This graphic\'s own' }, { id: 'reb', label: 'REB', title: 'rebounds', group: 'own', groupLabel: 'This graphic\'s own' },
  { id: 'ast', label: 'AST', title: 'assists', group: 'own', groupLabel: 'This graphic\'s own' }, { id: 'stl', label: 'STL', title: 'steals', group: 'own', groupLabel: 'This graphic\'s own' },
  { id: 'c:bpm', label: 'BPM', title: 'Box plus/minus', group: 'advanced', groupLabel: 'Advanced' }, { id: 'c:vorp', label: 'VORP', title: 'Value over replacement', group: 'advanced', groupLabel: 'Advanced' },
  { id: 'c:ts', label: 'TS%', title: 'True shooting', group: 'shooting', groupLabel: 'Shooting' }
];
const off = SP.offered(ITEMS, ['pts', 'c:bpm'], '');
ok('offered: what is not chosen, by group in order', off.map(g => g.label + ':' + g.items.map(i => i.id).join('/')).join() === 'This graphic\'s own:reb/ast/stl,Advanced:c:vorp,Shooting:c:ts', off.map(g => g.items.map(i => i.id)));
ok('...searched by label, longer name, key or group, every word', SP.offered(ITEMS, [], 'value replacement').map(g => g.items[0].id).join() === 'c:vorp' && SP.offered(ITEMS, [], 'shooting').length === 1 && SP.offered(ITEMS, [], 'zz').length === 0);

console.log('\nthe control');
const make = (start, o) => {
  let list = start.slice(); const sets = [];
  const node = SP.create(Object.assign({ title: 'Stat lines', items: ITEMS, current: () => list, set: v => { list = v.slice(); sets.push(v.slice()); }, def: ['pts', 'reb', 'ast'], min: 3, max: 5 }, o || {}));
  return { node, get list() { return list; }, sets, chips: () => node.querySelectorAll('.gx-chip'), q: node.all(n => n.tagName === 'INPUT')[0], say: () => node.querySelector('.gx-pick-say').textContent };
};
{
  const P = make(['pts', 'reb', 'ast', 'c:bpm']);
  ok('the chosen are chips in their order, each with its label, a count of the most', P.chips().map(c => c.dataset.k).join() === 'pts,reb,ast,c:bpm' && P.chips()[3].textContent.includes('BPM') && P.node.querySelector('.gx-pick-n').textContent === '4 of 5');
  ok('...each chip can take the focus and says how to move it', P.chips().every(c => c.tabIndex === 0) && /2 of 4\. Arrow keys move it, Delete removes it/.test(P.chips()[1].getAttribute('aria-label')));
  const btn = (chip, c) => chip.querySelector('.' + c);
  ok('...the first chip cannot go earlier, the last not later', btn(P.chips()[0], 'gx-up').disabled && btn(P.chips()[3], 'gx-dn').disabled && !btn(P.chips()[1], 'gx-up').disabled);
  btn(P.chips()[3], 'gx-x').click();
  ok('x removes a stat, and set() hears it at once', P.list.join() === 'pts,reb,ast' && P.sets.length === 1 && /BPM removed/.test(P.say()));
  ok('...at the least (three), x is put away', P.chips().every(c => btn(c, 'gx-x').disabled));
  P.chips()[1].fire('keydown', { key: 'Delete' });
  ok('...and Delete on a chip says why it cannot go', P.list.join() === 'pts,reb,ast' && /At least 3/.test(P.say()));
}
{
  const P = make(['pts', 'reb', 'ast', 'stl', 'c:ts']);
  const chip = k => P.chips().find(c => c.dataset.k === k);
  chip('reb').fire('keydown', { key: 'Backspace' });
  ok('Backspace on a chip removes it, the focus to the one after', P.list.join() === 'pts,ast,stl,c:ts' && DOC.activeElement && DOC.activeElement.dataset.k === 'ast');
  chip('c:ts').fire('keydown', { key: 'ArrowLeft' });
  ok('the left arrow moves a chip earlier and keeps the focus on it', P.list.join() === 'pts,ast,c:ts,stl' && DOC.activeElement.dataset.k === 'c:ts' && /TS% moved to 3 of 4/.test(P.say()));
  chip('c:ts').fire('keydown', { key: 'ArrowUp' });
  chip('pts').fire('keydown', { key: 'ArrowDown' });
  ok('...up is earlier, down and right later', P.list.join() === 'c:ts,pts,ast,stl', P.list);
  chip('stl').fire('keydown', { key: 'Home' });
  chip('c:ts').fire('keydown', { key: 'End' });
  ok('...Home to the front, End to the back', P.list.join() === 'stl,pts,ast,c:ts', P.list);
  chip('ast').querySelector('.gx-dn').click();
  ok('the arrow buttons move it too', P.list.join() === 'stl,pts,c:ts,ast');
}
{
  const P = make(['pts', 'reb', 'ast', 'stl']);
  const chip = k => P.chips().find(c => c.dataset.k === k);
  /* a finger drags STL (at x 300..390) to the front: pointer down, past the threshold, over the first chip, up */
  const c0 = chip('stl');
  c0.fire('pointerdown', { button: 0, pointerId: 7, clientX: 340, clientY: 15 });
  ok('a press captures the pointer (so the drag follows a finger off the chip)', c0.captured === 7);
  c0.fire('pointermove', { pointerId: 7, clientX: 300, clientY: 15 });
  c0.fire('pointermove', { pointerId: 7, clientX: 20, clientY: 15 });
  ok('...dragging shows the chip moving among the others before it is let go', P.node.classList.contains('sorting') && P.chips()[0] === c0 && P.list.join() === 'pts,reb,ast,stl');
  c0.fire('pointerup', { pointerId: 7, clientX: 20, clientY: 15 });
  ok('...and let go, the order is set', P.list.join() === 'stl,pts,reb,ast' && !P.node.classList.contains('sorting') && /STL moved to 1 of 4/.test(P.say()), P.list);
  const c1 = chip('pts');
  c1.fire('pointerdown', { button: 0, pointerId: 8, clientX: 140, clientY: 15 });
  c1.fire('pointermove', { pointerId: 8, clientX: 290, clientY: 15 });
  c1.fire('pointerup', { pointerId: 8 });
  ok('...dragged to the right, after the chip it is let go past', P.list.join() === 'stl,reb,pts,ast', P.list);
  const n = P.sets.length, c2 = chip('reb');
  c2.fire('pointerdown', { button: 0, pointerId: 9, clientX: 140, clientY: 15 });
  c2.fire('pointermove', { pointerId: 9, clientX: 142, clientY: 16 });
  c2.fire('pointerup', { pointerId: 9 });
  ok('a press that hardly moves is not a drag (nothing changes)', P.sets.length === n && P.list.join() === 'stl,reb,pts,ast');
}
{
  const P = make(['pts', 'reb', 'ast']);
  P.q.focus();
  const menu = P.node.querySelector('.gx-menu'), opts = () => menu.querySelectorAll('.gx-opt').map(o => o.dataset.k);
  ok('the add box opens on focus and offers only what is not chosen, by group', !menu.hidden && opts().join() === 'stl,c:bpm,c:vorp,c:ts' && menu.querySelectorAll('.gx-menu-g').map(g => g.textContent).join() === 'This graphic\'s own,Advanced,Shooting');
  P.q.value = 'vorp'; P.q.fire('input');
  ok('...the search narrows it', opts().join() === 'c:vorp');
  P.q.fire('keydown', { key: 'Enter' });
  ok('...Enter adds the one found, at the end', P.list.join() === 'pts,reb,ast,c:vorp' && P.q.value === '' && /VORP added, 4 of 5/.test(P.say()));
  P.q.fire('keydown', { key: 'ArrowDown' }); P.q.fire('keydown', { key: 'ArrowDown' });
  ok('...the arrow keys walk the list (aria-activedescendant)', menu.querySelectorAll('.gx-opt')[1].classList.contains('on') && P.q.getAttribute('aria-activedescendant') === menu.querySelectorAll('.gx-opt')[1].id);
  menu.querySelectorAll('.gx-opt').find(o => o.dataset.k === 'c:ts').click();
  ok('...a click adds', P.list.join() === 'pts,reb,ast,c:vorp,c:ts');
  ok('at the most, the box says so and offers nothing', menu.querySelectorAll('.gx-opt').length === 0 && /At most 5: remove one to add another/.test(menu.textContent) && P.node.classList.contains('full'));
  P.q.fire('keydown', { key: 'Backspace' });
  ok('Backspace in an empty search box goes to the last chip', DOC.activeElement === P.chips()[4]);
  P.q.fire('keydown', { key: 'Escape' });
  ok('Escape shuts the list', menu.hidden && P.q.getAttribute('aria-expanded') === 'false');
  const reset = P.node.all(n => n.tagName === 'BUTTON' && n.textContent === 'reset to default')[0];
  reset.click();
  ok('reset to default: the template\'s own, and the button rests while nothing differs', P.list.join() === 'pts,reb,ast' && reset.disabled);
}
{
  const P = make([], { min: 0, max: 6, def: [] });
  ok('none chosen: says so, and nothing to remove', P.node.textContent.includes('None chosen') && P.chips().length === 0);
}

console.log('\nthe Graphics tab uses it');
{
  const ui = rd('epinoia', 'admin', 'graphics-ui.js');
  const uses = ['stats', 'cols', 'teamstats', 'leadstats', 'leadcats'].filter(h => new RegExp("picker\\('" + h + "'").test(ui));
  ok('every list of stats is a picker: a star\'s, the week\'s, the month\'s, the table\'s columns, a final\'s team stats and leader lines, the leaders\' categories', uses.length === 5 && (ui.match(/picker\('stats'/g) || []).length === 3, uses);
  ok('...the old boxes of ticks are gone for stats (the folded catalogue list too)', !/catBox\(/.test(ui) && !/checks\('stats'|checks\('cols'|checks\('teamstats'|checks\('leadstats'/.test(ui));
  ok('...each stars template keeps its own list (the month\'s the site\'s only)', /M\.weekKeys/.test(ui) && /M\.monthKeys/.test(ui) && /tpl === 'monthstars' \? \(catOf\(m\.monthKeys\)/.test(ui));
  const page = rd('epinoia', 'admin', 'index.html');
  ok('the console loads statpicker.js before graphics-ui.js', /statpicker\.js\?v=\d+" defer><\/script>\s*<script src="graphics-ui\.js/.test(page));
  const css = rd('epinoia', 'admin', 'graphics.css');
  ok('a chip is not a scroll gesture on a phone (touch-action: none), and its buttons are a finger\'s size', /\.gx-chip\{[^}]*touch-action:none/.test(css) && /\.gx-cb\{[^}]*width:26px;height:26px/.test(css) && /\.gx-chip\{[^}]*min-height:34px/.test(css));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
