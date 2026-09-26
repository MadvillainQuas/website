// Editing a club's links from its own page, for platform administrators only (epinoia/linkedit.js, and the gate in
// epinoia/linkswitch.js). No browser, no network: a stand-in for the page and a fake client that answers in the shape the database does
// (0178's platform_link_search / _apply / _remove, whoami). The refusal that matters is the database's (link_require_admin, tested in
// entity-links.test.mjs); this holds that nobody else is shown the editor, or downloads it, or is asked anything.
//
//   node supabase/tests/linkedit.test.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 300))); } };

class N {
  constructor(tag) { this.tag = tag; this.children = []; this.parent = null; this.text = ''; this.attrs = {}; this.handlers = {}; this.style = {}; this.dataset = {}; this._cls = new Set(); this.hidden = false; this.value = ''; this.id = ''; this.focused = false; }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() { const s = this._cls; return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: (c, on) => { (on === undefined ? !s.has(c) : on) ? s.add(c) : s.delete(c); } }; }
  appendChild(c) { if (c.parent) c.parent.children = c.parent.children.filter(x => x !== c); c.parent = this; this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.appendChild(typeof c === 'string' ? Object.assign(new N('#text'), { text: c }) : c)); }
  set textContent(v) { this.children.forEach(c => { c.parent = null; }); this.children = []; this.text = v == null ? '' : String(v); }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.handlers[t] = this.handlers[t] || []).push(f); }
  focus() { this.focused = true; }
  fire(t, e = {}) { (this.handlers[t] = this.handlers[t] || []).forEach(f => f(Object.assign({ preventDefault() {}, stopPropagation() {}, target: this, key: '' }, e))); }
  find(pred, out = []) { if (pred(this)) out.push(this); this.children.forEach(c => c.find(pred, out)); return out; }
  cls(c) { return this.find(n => n._cls.has(c)); }
}
let scripts = 0;
globalThis.document = { createElement: t => { if (t === 'script') scripts++; return new N(t); }, createTextNode: t => Object.assign(new N('#text'), { text: t }), addEventListener() {}, querySelector: () => null, body: new N('body') };
const require = createRequire(import.meta.url);
const E = require(path.join(here, '..', '..', 'epinoia', 'linkedit.js'));
const K = require(path.join(here, '..', '..', 'epinoia', 'linkswitch.js'));
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 600) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await tick(10); } return fn(); };

/* ------------------------------------------------------------------ the data --- */
const cardOf = (id, league, o) => Object.assign({ id, slug: id, name: 'London Lions', league, women: false, youth: false, competitions: [{ season: '2026-27', name: league }, { season: '2025-26', name: league }] }, o);
const HERE = cardOf('a', 'Super League Basketball Men');
const EURO = cardOf('b', 'EuroCup');
const WOMEN = cardOf('c', 'Super League Basketball Women', { women: true });
const GROUPED = { group: 'London Lions', teams: [HERE, EURO, WOMEN] };

/* a client that records what it was asked, and answers for a platform administrator */
function client(state) {
  const calls = [];
  const s = Object.assign({ linked: GROUPED, results: [], fail: null, whoami: { is_platform_admin: true } }, state);
  return { calls, s, sb: { rpc: async (name, args) => {
    calls.push([name, args]);
    if (s.fail && s.fail[name]) return { error: s.fail[name] };
    if (name === 'whoami') return { data: s.whoami };
    if (name === 'platform_link_search') return { data: { rows: typeof s.results === 'function' ? await s.results(args) : s.results, more: !!s.more } };
    if (name === 'platform_link_apply') return { data: { group_id: 'g1', members: 4, auto_players: s.autoPlayers == null ? 6 : s.autoPlayers } };
    if (name === 'platform_link_remove') return { data: s.removed || { removed: true, left: 2 } };
    return { data: null };
  } } };
}
function mounted(state, over) {
  const c = client(state);
  const host = new N('div');
  let changes = 0;
  const api = E.mount(Object.assign({ host, team: { id: 'a', name: 'London Lions' }, sb: c.sb, linked: c.s.linked,
    onChange: async () => { changes++; return c.s.after === undefined ? c.s.linked : c.s.after; } }, over || {}));
  return { c, host, api, changes: () => changes, panel: host.cls('le-panel')[0], input: host.cls('le-search')[0], list: host.cls('le-list')[0], msg: host.cls('le-msg')[0], toggle: host.cls('le-toggle')[0] };
}
const type = async (m, v) => { m.input.value = v; m.input.fire('input'); await until(() => m.c.calls.some(x => x[0] === 'platform_link_search' && x[1].p_q === v.trim()), 800); await tick(15); };

/* -------------------------------------------------------------------- pure --- */
console.log('-- the words');
ok('seasons of a card, newest first', JSON.stringify(E.seasonsOf(HERE)) === JSON.stringify(['2026-27', '2025-26']) && E.seasonsOf({}).length === 0);
ok('a link says the team, its league, how many are linked now and the players brought with it',
   E.linkedWords({ name: 'Newcastle Eagles', league: 'SLB' }, { members: 4, auto_players: 6 }) === 'Linked Newcastle Eagles (SLB) to this club: 4 teams are linked now. 6 players at those clubs were linked automatically.', E.linkedWords({ name: 'Newcastle Eagles', league: 'SLB' }, { members: 4, auto_players: 6 }));
ok('...one player, and none, in the right words', /1 player at those clubs was linked/.test(E.linkedWords({ name: 'X' }, { members: 2, auto_players: 1 })) && !/player/.test(E.linkedWords({ name: 'X' }, { members: 2, auto_players: 0 })));
ok('an unlink says which, and when it left one team the link is gone', E.unlinkedWords({ name: 'LL', league: 'EuroCup' }, { removed: true, left: 1 }) === 'Unlinked EuroCup. That left one team, so the link is gone.'
   && E.unlinkedWords({ name: 'LL', league: 'EuroCup' }, { removed: true, left: 2 }) === 'Unlinked EuroCup.' && /was not linked/.test(E.unlinkedWords({ name: 'LL' }, { removed: false })));
ok('a refusal is said plainly, a missing function says the migration', /only platform administrators/.test(E.errorWords({ code: '42501', message: 'platform administrators only' }))
   && /migration 0178/.test(E.errorWords({ code: 'PGRST202', message: 'Could not find the function' })) && E.errorWords({ message: 'boom' }) === 'boom');

/* ------------------------------------------------------------------- the panel --- */
console.log('-- the panel');
{
  const m = mounted();
  ok('it mounts a button and a shut panel into the host', m.host.children.length === 1 && !!m.toggle && m.toggle.textContent === '✎ edit links' && m.panel.hidden === true && m.toggle.attrs['aria-expanded'] === 'false');
  ok('the whole thing is left out of the translator', m.host.children[0].attrs['data-i18n'] === 'off');
  m.toggle.fire('click');
  ok('the button opens it, and puts the cursor in the search bar', m.panel.hidden === false && m.toggle.attrs['aria-expanded'] === 'true' && m.input.focused === true);
  const rows = m.host.cls('le-mem');
  ok('it lists the linked teams, this page first and marked', rows.length === 3 && rows[0].classList.contains('here') && rows[0].cls('le-here').length === 1 && rows[1].classList.contains('here') === false, rows.map(r => r.textContent));
  ok('...each with its league, the women\'s side chipped, and its seasons', rows[2].cls('le-chip')[0].textContent === 'women' && /2026-27 · 2025-26/.test(rows[1].cls('le-sub')[0].textContent) && rows[1].cls('le-name')[0].textContent === 'EuroCup');
  ok('...each a link to that side\'s page', rows.map(r => r.cls('le-name')[0].href).join() === './?t=a,./?t=b,./?t=c', rows.map(r => r.cls('le-name')[0].href));
  ok('...and the group\'s name', m.host.cls('le-g')[0].textContent === 'London Lions');
  ok('every row has an unlink button', rows.every(r => r.cls('le-x').length === 1));
  m.toggle.fire('click');
  ok('the button shuts it again', m.panel.hidden === true && m.toggle.attrs['aria-expanded'] === 'false');
  const alone = mounted({ linked: null });
  alone.toggle.fire('click');
  ok('a team linked to nothing says so and asks for a search', alone.host.cls('le-mem').length === 0 && /Not linked to any other team yet/.test(alone.host.cls('le-mems')[0].textContent));
}

/* ---------------------------------------------------------------- the search --- */
console.log('-- the search bar');
{
  const R1 = cardOf('d', 'Betclic ELITE', { name: 'Bourg-en-Bresse', competitions: [{ season: '2026-27', name: 'Betclic ELITE' }] });
  const R2 = cardOf('e', 'Pro B', { name: 'Bourg en Bresse BC', group: 'Bourg', competitions: [] });
  const m = mounted({ results: [R1, R2], more: true });
  m.toggle.fire('click');
  await type(m, 'bourg');
  const ask = m.c.calls.find(x => x[0] === 'platform_link_search');
  ok('typing asks the console\'s own search: teams, the words, a short page', ask && ask[1].p_kind === 'team' && ask[1].p_q === 'bourg' && ask[1].p_limit === 8, ask);
  ok('...leaving out this team and the ones already linked to it', JSON.stringify(ask[1].p_exclude.slice().sort()) === JSON.stringify(['a', 'b', 'c']), ask[1].p_exclude);
  const opts = m.list.cls('le-opt');
  ok('the results are listed under the box, the first highlighted', m.list.hidden === false && opts.length === 2 && opts[0].classList.contains('on') && !opts[1].classList.contains('on') && m.input.attrs['aria-expanded'] === 'true');
  ok('...each with its league and seasons', opts[0].cls('le-name')[0].textContent === 'Bourg-en-Bresse' && opts[0].cls('le-lg')[0].textContent === 'Betclic ELITE' && /2026-27/.test(opts[0].cls('le-sub')[0].textContent));
  ok('...a team already in a group of its own says the whole group comes with it', /in the group "Bourg": the whole group is linked/.test(opts[1].textContent) && !/whole group/.test(opts[0].textContent));
  ok('...and says when there are more', m.list.cls('le-more').length === 1);
  m.input.fire('keydown', { key: 'ArrowDown' });
  ok('the arrow keys move the highlight', opts[1].classList.contains('on') && !opts[0].classList.contains('on'));
  m.input.fire('keydown', { key: 'ArrowDown' });
  ok('...round the list', opts[0].classList.contains('on'));
  m.input.fire('keydown', { key: 'ArrowUp' });
  ok('...and back', opts[1].classList.contains('on'));
  m.input.fire('keydown', { key: 'Escape' });
  ok('Escape shuts the list first', m.list.hidden === true && m.panel.hidden === false);
  m.input.fire('keydown', { key: 'Escape' });
  ok('...then clears the words', m.input.value === '' && m.panel.hidden === false);
  m.input.fire('keydown', { key: 'Escape' });
  ok('...then shuts the panel', m.panel.hidden === true);
}
{
  const m = mounted({ results: [] });
  m.toggle.fire('click');
  await type(m, 'zzzz');
  ok('a search that finds nothing says so, with the words', m.list.cls('le-opt').length === 0 && /No team matches "zzzz"/.test(m.list.textContent));
  m.input.value = '  ';
  m.input.fire('input'); await tick(260);
  ok('nothing typed asks nothing and shuts the list', m.list.hidden === true && m.c.calls.filter(x => x[0] === 'platform_link_search').length === 1);
}
{
  /* a slow answer to an old question never replaces a newer one */
  let release = null;
  const R = cardOf('n', 'New answer', { name: 'Newer' });
  const m = mounted({ results: args => args.p_q === 'ol' ? new Promise(res => { release = () => res([cardOf('o', 'Old answer', { name: 'Older' })]); }) : [R] });
  m.toggle.fire('click');
  m.input.value = 'ol'; m.input.fire('input'); await tick(260);
  await type(m, 'new');
  release(); await tick(20);
  ok('a slow answer to an old question is dropped', m.list.cls('le-opt').length === 1 && m.list.cls('le-opt')[0].cls('le-name')[0].textContent === 'Newer', m.list.textContent);
}

/* ---------------------------------------------------------------- linking --- */
console.log('-- linking');
{
  const R1 = cardOf('d', 'Betclic ELITE', { name: 'Bourg-en-Bresse' });
  const after = { group: 'London Lions', teams: [HERE, EURO, WOMEN, R1] };
  const m = mounted({ results: [R1], after });
  m.toggle.fire('click');
  await type(m, 'bourg');
  m.input.fire('keydown', { key: 'Enter' });
  await until(() => m.c.calls.some(x => x[0] === 'platform_link_apply'));
  await until(() => m.changes() === 1);
  const ap = m.c.calls.find(x => x[0] === 'platform_link_apply');
  ok('Enter links the highlighted team to this one: this team and the pick', ap && ap[1].p_kind === 'team' && JSON.stringify(ap[1].p_ids) === JSON.stringify(['a', 'd']) && ap[1].p_label === null, ap);
  ok('...and says what it did, with the players brought along', /Linked Bourg-en-Bresse \(Betclic ELITE\) to this club: 4 teams are linked now\. 6 players at those clubs were linked automatically\./.test(m.msg.textContent) && m.msg.classList.contains('ok'), m.msg.textContent);
  ok('...the league buttons are drawn again (onChange) and the list shows the new member', m.changes() === 1 && m.host.cls('le-mem').length === 4 && m.host.cls('le-mem')[3].cls('le-name')[0].textContent === 'Betclic ELITE');
  ok('...the search box is emptied, the list shut, the panel left open', m.input.value === '' && m.list.hidden === true && m.panel.hidden === false);
  const later = m.c.calls.length;
  await type(m, 'bo');
  ok('the next search leaves out the new member too', JSON.stringify(m.c.calls.filter(x => x[0] === 'platform_link_search').pop()[1].p_exclude.slice().sort()) === JSON.stringify(['a', 'b', 'c', 'd']));
}
{
  const R1 = cardOf('d', 'Betclic ELITE', { name: 'Bourg-en-Bresse' });
  const m = mounted({ results: [R1] });
  m.toggle.fire('click');
  await type(m, 'bourg');
  m.list.cls('le-opt')[0].fire('pointerdown');
  await until(() => m.c.calls.some(x => x[0] === 'platform_link_apply'));
  ok('pressing a result links it, as Enter does', m.c.calls.filter(x => x[0] === 'platform_link_apply').length === 1);
}
{
  const R1 = cardOf('d', 'Betclic ELITE', { name: 'Bourg-en-Bresse' });
  const m = mounted({ results: [R1], fail: { platform_link_apply: { code: '42501', message: 'platform administrators only' } } });
  m.toggle.fire('click');
  await type(m, 'bourg');
  m.input.fire('keydown', { key: 'Enter' });
  await until(() => m.msg.classList.contains('err'));
  ok('a refusal is shown in the panel, the list is unchanged, nothing was redrawn', /Refused: only platform administrators can edit links\./.test(m.msg.textContent) && m.changes() === 0 && m.host.cls('le-mem').length === 3, m.msg.textContent);
  const m2 = mounted({ fail: { platform_link_search: { code: 'PGRST202', message: 'Could not find the function public.platform_link_search in the schema cache' } } });
  m2.toggle.fire('click');
  m2.input.value = 'x1'; m2.input.fire('input'); await until(() => m2.msg.classList.contains('err'), 900);
  ok('a database without the functions says so', /migration 0178/.test(m2.msg.textContent), m2.msg.textContent);
}

/* --------------------------------------------------------------- unlinking --- */
console.log('-- unlinking');
{
  const after = { group: 'London Lions', teams: [HERE, WOMEN] };
  const m = mounted({ after, removed: { removed: true, left: 2 } });
  m.toggle.fire('click');
  m.host.cls('le-mem')[1].cls('le-x')[0].fire('click');
  await until(() => m.changes() === 1);
  const rm = m.c.calls.find(x => x[0] === 'platform_link_remove');
  ok('unlink takes that one team out of the link', rm && rm[1].p_kind === 'team' && rm[1].p_id === 'b', rm);
  ok('...says which, and shows the shorter list', m.msg.textContent === 'Unlinked EuroCup.' && m.host.cls('le-mem').length === 2, [m.msg.textContent, m.host.cls('le-mem').length]);
}
{
  const m = mounted({ after: null, removed: { removed: true, left: 1 } });
  m.toggle.fire('click');
  m.host.cls('le-mem')[0].cls('le-x')[0].fire('click');
  await until(() => m.changes() === 1);
  ok('unlinking this page\'s own team from a pair dissolves the link: the panel says so and asks for a new search', /That left one team, so the link is gone\./.test(m.msg.textContent) && m.host.cls('le-mem').length === 0 && /Not linked to any other team yet/.test(m.host.cls('le-mems')[0].textContent), m.msg.textContent);
}
{
  const m = mounted({ fail: { platform_link_remove: { message: 'boom' } } });
  m.toggle.fire('click');
  m.host.cls('le-mem')[1].cls('le-x')[0].fire('click');
  await until(() => m.msg.classList.contains('err'));
  ok('a failed unlink says why and changes nothing', m.msg.textContent === 'boom' && m.changes() === 0 && m.host.cls('le-mem').length === 3);
  const busy = mounted();
  busy.toggle.fire('click');
  const xs = busy.host.cls('le-x');
  xs[1].fire('click'); xs[2].fire('click');
  await until(() => busy.changes() >= 1); await tick(20);
  ok('a second click while one edit is under way does nothing', busy.c.calls.filter(x => x[0] === 'platform_link_remove').length === 1);
}

/* --------------------------------------------------- who gets it: linkswitch --- */
console.log('-- who is shown it');
{
  const team = { id: 'a', name: 'London Lions' };
  const mountCalls = [];
  const fakeEditor = { mount: o => { mountCalls.push(o); return {}; } };
  const setup = (over) => {
    const c = client(over.state || {});
    globalThis.epinoiaMaybeSignedIn = over.maybe === undefined ? () => true : over.maybe;
    globalThis.epinoiaClientReady = over.ready === undefined ? async () => c.sb : over.ready;
    if (over.editor === false) delete globalThis.EpinoiaLinkEdit; else globalThis.EpinoiaLinkEdit = fakeEditor;
    mountCalls.length = 0; scripts = 0;
    let attached = 0;
    return { c, ctx: { host: new N('div'), linked: GROUPED, attach: () => { attached++; }, redraw: async () => null }, attached: () => attached };
  };
  let s = setup({ maybe: () => false });
  ok('a signed-out reader is asked nothing: no client, no whoami, no editor', await K.adminEditor(team, s.ctx) === null && s.c.calls.length === 0 && mountCalls.length === 0);
  s = setup({ maybe: null });
  ok('a page without the sign-in helper gets nothing either', await K.adminEditor(team, s.ctx) === null && mountCalls.length === 0);
  s = setup({ state: { whoami: { is_platform_admin: false, leagues: [{ slug: 'slb' }] } } });
  ok('a signed-in league administrator is not shown it (one whoami, nothing more)', await K.adminEditor(team, s.ctx) === null && s.c.calls.map(x => x[0]).join() === 'whoami' && mountCalls.length === 0 && scripts === 0);
  s = setup({ state: { whoami: { is_platform_admin: 'yes' } } });
  ok('...and only a real true counts', await K.adminEditor(team, s.ctx) === null && mountCalls.length === 0);
  s = setup({ state: { whoami: null } });
  ok('...a whoami that answers nothing is not a yes', await K.adminEditor(team, s.ctx) === null && mountCalls.length === 0);
  s = setup({ ready: async () => null });
  ok('...nor a client that could not load', await K.adminEditor(team, s.ctx) === null && mountCalls.length === 0);
  s = setup({});
  s.c.sb.rpc = async () => ({ error: { message: 'jwt expired' } });
  ok('...nor a whoami that failed', await K.adminEditor(team, s.ctx) === null && mountCalls.length === 0);
  s = setup({});
  const r = await K.adminEditor(team, s.ctx);
  ok('a platform administrator gets the editor, on their session, for this team, with the links the page has', r && mountCalls.length === 1 && mountCalls[0].team === team && mountCalls[0].sb === s.c.sb && mountCalls[0].linked === GROUPED && mountCalls[0].host === s.ctx.host, mountCalls);
  ok('...and the page makes room for it first (a club with no links has no league buttons to bring the host along)', s.attached() === 1);
  ok('...and onChange is the page\'s own redraw', typeof mountCalls[0].onChange === 'function');
  s = setup({ editor: false });
  ok('with no editor loaded and nowhere to fetch it from, nothing breaks', await K.adminEditor(team, s.ctx) === null && s.attached() === 0);
  ok('the editor is fetched from beside linkswitch.js, with its own ?v= stamp', K.editorUrl('https://x.test/epinoia/linkswitch.js?v=438') === 'https://x.test/epinoia/linkedit.js?v=438' && K.editorUrl('../linkswitch.js') === '../linkedit.js');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
