/* ============================================================================
   The console's fixture list (epinoia/admin/admin.js loadFixtures / drawFixtures /
   buildFixtureRows / fixtureRow), run for real against a fake page and a fake
   database.

   What it pins, each a way the list used to come out wrong or could again:
     * two loads overlapping draw the list once, not twice;
     * an empty competition (or none) still rebuilds the import and "Generate a
       season" panels, so they never stay pointed at the competition before;
     * a club from another league is named, not "—";
     * a competition of more than a thousand games is read in pages, all of it;
     * the list is folded into one row that starts closed, and builds no rows
       until it is opened;
     * opened, it draws thirty games and "Show 30 more", keeps how far it was
       opened across a reload, and starts again at thirty for another filter or
       another competition;
     * "select all shown" ticks only the rows drawn.
   Run: node supabase/tests/admin-fixtures.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = fs.readFileSync(process.env.ADMIN_JS || path.join(ROOT, 'epinoia', 'admin', 'admin.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want));

/* ------------------------------------------------------------ a fake page --- */
class Ev { constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); this.target = null; } }
class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = '';
    this.className = ''; this.dataset = {}; this.attrs = {}; this.listeners = {};
    this.checked = false; this.disabled = false; this.value = ''; this.type = ''; this.title = ''; this.href = ''; this.target = ''; this.rel = '';
    this._open = false;
  }
  get classList() {
    const self = this, list = () => self.className.split(/\s+/).filter(Boolean);
    return {
      contains: c => list().includes(c),
      add: c => { if (!list().includes(c)) self.className = list().concat(c).join(' '); },
      remove: c => { self.className = list().filter(x => x !== c).join(' '); },
      toggle: (c, on) => { const has = list().includes(c); const want = on === undefined ? !has : !!on;
        if (want && !has) self.className = list().concat(c).join(' '); if (!want && has) self.className = list().filter(x => x !== c).join(' '); return want; }
    };
  }
  appendChild(n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  dispatchEvent(ev) { if (!ev.target) ev.target = this; let n = this; while (n) { (n.listeners[ev.type] || []).slice().forEach(fn => fn(ev)); n = ev.bubbles ? n.parentNode : null; } return true; }
  get open() { return this._open; }
  set open(v) { const was = this._open; this._open = !!v; if (this.tagName === 'DETAILS' && was !== this._open) this.dispatchEvent(new Ev('toggle')); }
  click() { this.dispatchEvent(new Ev('click', { bubbles: true })); }
  matches(sel) {
    return sel.split(',').some(one => {
      const m = /^([a-z]+)?((?:\.[\w-]+)*)(:checked)?$/i.exec(one.trim());
      if (!m) throw new Error('fake DOM cannot match ' + one);
      if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
      if (m[2] && !m[2].split('.').filter(Boolean).every(c => this.classList.contains(c))) return false;
      if (m[3] && !this.checked) return false;
      return true;
    });
  }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => n.children.forEach(c => { if (c instanceof El) { if (c.matches(sel)) out.push(c); walk(c); } });
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const visibleRows = host => host.querySelectorAll('.fxrow');
const textOf = n => n.textContent.replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------- a fake database --- */
function fakeSb(db, opts = {}) {
  const calls = [];
  const delays = opts.delays || [];
  return {
    calls,
    from(table) {
      const q = { table, eqs: [], ids: null, from: 0, to: Infinity };
      const b = {
        select() { return b; },
        eq(col, val) { q.eqs.push([col, val]); return b; },
        order() { return b; },
        range(a, z) { q.from = a; q.to = z; return b; },
        in(col, ids) { q.ids = ids; return b; },
        then(resolve) {
          const delay = delays.length ? delays.shift() : 0;
          setTimeout(() => {
            calls.push({ table, eqs: q.eqs, ids: q.ids, from: q.from, to: q.to });
            let rows = (db[table] || []).filter(r => q.eqs.every(([c, v]) => r[c] === v));
            if (q.ids) rows = rows.filter(r => q.ids.includes(r.id));
            resolve({ data: rows.slice(q.from, q.to === Infinity ? undefined : q.to + 1), error: null });
          }, delay);
        }
      };
      return b;
    }
  };
}

/* ------------------------------------------------ the functions under test --- */
const start = src.indexOf('let fxSeq = 0;');
const end = src.indexOf('/* teams is an array here and the governance module wants a lookup');
ok('admin.js carries the fixture list functions', start > 0 && end > start);
const slice = src.slice(start, end);

function page(o = {}) {
  const nodes = { '#fxList': new El('div'), '#fxNote': new El('span') };
  const counts = { import: 0, gen: 0, oops: [] };
  const ctx = vm.createContext({
    document: { createElement: t => new El(t), createTextNode: t => new Text(t) },
    Event: Ev, setTimeout, console,
    window: { EpinoiaGovernance: { fixtureActions: () => [] } },
    confirm: () => true
  });
  vm.runInContext(`
    var sb = null, comp = null, comps = [], teams = [], fixtures = [], enteredRows = [];
    var $ = s => __nodes[s];
    var el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
    var say = () => {}, officials = () => {}, loadStandingsDependents = async () => {}, byIdObj = () => ({});
    var oops = e => __counts.oops.push(e);
    var mountImport = () => { __counts.import++; };
    var mountFixtureGen = () => { __counts.gen++; };
  `, Object.assign(ctx, { __nodes: nodes, __counts: counts }));
  vm.runInContext(slice, ctx, { filename: 'admin.js (fixtures)' });
  const set = (k, v) => { ctx.__v = v; vm.runInContext(k + ' = __v;', ctx); };
  const get = k => vm.runInContext(k, ctx);
  return { ctx, nodes, counts, set, get, load: () => vm.runInContext('loadFixtures()', ctx) };
}
const settle = ms => new Promise(r => setTimeout(r, ms));

/* a season: 214 games in one competition, 64 played, and a cup tie against a club from another league */
const COMP = { id: 'c-league', name: 'Championship', kind: 'league' };
const CUP = { id: 'c-cup', name: 'Trophy', kind: 'cup' };
const TEAMS = Array.from({ length: 10 }, (_, i) => ({ id: 't' + i, name: 'Club ' + i }));
const OTHER = { id: 'x-away', name: 'Visitors From Elsewhere' };
function season(n = 214, played = 64) {
  const games = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 8, 20) + i * 86400000 / 2);
    games.push({ id: 'g' + String(i).padStart(4, '0'), competition_id: COMP.id, tipoff_at: d.toISOString(), venue: null,
                 status: i < played ? 'final' : 'scheduled', home_score: i < played ? 80 : 0, away_score: i < played ? 70 : 0,
                 home_team_id: TEAMS[i % 10].id, away_team_id: i === 5 ? OTHER.id : TEAMS[(i + 1) % 10].id, roster_snapshot: null });
  }
  return games;
}

console.log('\nthe fixture list');
{
  const db = { games: season(), teams: TEAMS.concat(OTHER) };
  const P = page();
  P.set('sb', fakeSb(db)); P.set('comp', COMP); P.set('comps', [COMP]); P.set('teams', TEAMS);
  await P.load();
  const host = P.nodes['#fxList'];
  const box = host.querySelector('details.fxbox');
  eq('the note counts every fixture, to play and played', textOf(P.nodes['#fxNote']), '214 fixtures · 150 to play · 64 played');
  ok('one folded row, closed on arrival', !!box && host.querySelectorAll('details.fxbox').length === 1 && box.open === false);
  ok('...saying how many are inside', /All 214 fixtures/.test(textOf(box.querySelector('summary'))), textOf(box.querySelector('summary')));
  eq('...and no row is built while it is closed', visibleRows(host).length, 0);
  eq('the import and generator panels are rebuilt with the list', [P.counts.import, P.counts.gen], [1, 1]);

  box.open = true;
  eq('opened: thirty games', visibleRows(host).length, 30);
  ok('...under month headings', host.querySelectorAll('.fxmonth').length >= 1 && /September 2026/.test(textOf(host.querySelector('.fxmonth'))));
  const more = host.querySelector('button.fxmore');
  ok('...with "Show 30 more" and how many are shown', more && !more.classList.contains('hide') && textOf(more) === 'Show 30 more' &&
     /30 of 214 shown/.test(textOf(host.querySelector('.fxfoot'))), more && textOf(host.querySelector('.fxfoot')));
  const cupRow = visibleRows(host).find(r => /Visitors From Elsewhere/.test(textOf(r)));
  ok('a club from another league is named, not "—"', !!cupRow && P.ctx.__counts && true);
  ok('...its name read with the fixtures', db.teams && JSON.stringify(P.get('fxOtherTeams').map(t => t.id)) === '["x-away"]');

  more.click();
  eq('"Show 30 more" draws the next thirty under them', visibleRows(host).length, 60);
  ok('...without redrawing the first thirty', /60 of 214 shown/.test(textOf(host.querySelector('.fxfoot'))));
  for (let i = 0; i < 10; i++) { const m = host.querySelector('button.fxmore'); if (m.classList.contains('hide')) break; m.click(); }
  eq('...until every game is drawn', visibleRows(host).length, 214);
  ok('...and the button goes', host.querySelector('button.fxmore').classList.contains('hide'));

  /* a reload (a move or an edit) keeps it open and as far down as it was */
  P.set('fxLimit', 90);
  await P.load();
  const box2 = host.querySelector('details.fxbox');
  ok('a reload keeps the row open', box2 && box2.open === true);
  eq('...and as far down as it was opened', visibleRows(host).length, 90);

  /* filters */
  const chip = k => host.querySelectorAll('button.ep-chip').find(b => b.dataset.k === k);
  chip('toplay').click();
  let rows = visibleRows(host);
  eq('"to play": thirty again, none of them played', [rows.length, rows.some(r => / 80–70 /.test(' ' + textOf(r) + ' '))], [30, false]);
  ok('...and the chip says it is pressed', chip('toplay').getAttribute('aria-pressed') === 'true' && chip('all').getAttribute('aria-pressed') === 'false');
  ok('...counting what the filter holds', /30 of 150 shown/.test(textOf(host.querySelector('.fxfoot'))));
  chip('played').click();
  rows = visibleRows(host);
  eq('"played": only played games', [rows.length, rows.every(r => /80–70/.test(textOf(r)))], [30, true]);
  host.querySelector('button.fxmore').click(); host.querySelector('button.fxmore').click();
  eq('...all 64 of them after two pages more', visibleRows(host).length, 64);

  /* another competition starts at the top */
  const other = { id: 'c-two', name: 'Second', kind: 'league' };
  db.games = db.games.concat(season(40, 0).map(g => ({ ...g, id: 'h' + g.id, competition_id: other.id })));
  P.set('comp', other);
  await P.load();
  const box3 = host.querySelector('details.fxbox');
  eq('another competition: still open, thirty rows, filter back to all', [box3.open, visibleRows(host).length, P.get('fxShow')], [true, 30, 'all']);
}

{
  /* two loads overlapping: the first one answers last */
  const db = { games: season(), teams: TEAMS };
  const P = page();
  P.set('sb', fakeSb(db, { delays: [60, 5] })); P.set('comp', COMP); P.set('comps', [COMP]); P.set('teams', TEAMS); P.set('fxOpen', true);
  const a = P.load(), b = P.load();
  await Promise.all([a, b]); await settle(80);
  const host = P.nodes['#fxList'];
  eq('two overlapping loads draw one list, once', [host.querySelectorAll('details.fxbox').length, visibleRows(host).length], [1, 30]);
  eq('...and rebuild the panels once, for the newest', [P.counts.import, P.counts.gen], [1, 1]);
}
{
  /* the competition changes while its list is loading: the older, slower load must not draw last */
  const second = { id: 'c-second', name: 'Second', kind: 'league' };
  const db = { games: season(214, 64).concat(season(12, 0).map(g => ({ ...g, id: 'z' + g.id, competition_id: second.id, away_team_id: TEAMS[3].id }))), teams: TEAMS };
  const P = page();
  P.set('sb', fakeSb(db, { delays: [80, 5] })); P.set('comp', COMP); P.set('comps', [COMP, second]); P.set('teams', TEAMS); P.set('fxOpen', true);
  const a = P.load();
  P.set('comp', second);
  const b = P.load();
  await Promise.all([a, b]); await settle(120);
  eq('switching competition mid-load: the list is the competition now picked', [textOf(P.nodes['#fxNote']), P.get('fixtures.length')], ['12 fixtures · 12 to play · 0 played', 12]);
  ok('...its rows are that competition\'s', visibleRows(P.nodes['#fxList']).length === 12);
}

{
  /* an empty competition, and none */
  const db = { games: [], teams: TEAMS };
  const P = page();
  P.set('sb', fakeSb(db)); P.set('comp', COMP); P.set('comps', [COMP]); P.set('teams', TEAMS);
  await P.load();
  ok('an empty competition says so', /No fixtures yet/.test(textOf(P.nodes['#fxList'])) && textOf(P.nodes['#fxNote']) === 'no fixtures yet');
  eq('...and still rebuilds the import and generator panels for it', [P.counts.import, P.counts.gen], [1, 1]);
  P.set('comp', null);
  await P.load();
  eq('no competition picked: says so, and the panels are rebuilt to say pick one', [textOf(P.nodes['#fxNote']), P.counts.import, P.counts.gen], ['pick a competition', 2, 2]);
}

{
  /* more than a thousand games: read in pages */
  const db = { games: season(2150, 2000), teams: TEAMS };
  const sb = fakeSb(db);
  const P = page();
  P.set('sb', sb); P.set('comp', COMP); P.set('comps', [COMP]); P.set('teams', TEAMS);
  await P.load();
  eq('2,150 games: all of them, read a thousand at a time', [P.get('fixtures.length'), sb.calls.filter(c => c.table === 'games').map(c => c.from)], [2150, [0, 1000, 2000]]);
}

{
  /* select all shown, with somewhere to move games to */
  const db = { games: season(), teams: TEAMS };
  const P = page();
  P.set('sb', fakeSb(db)); P.set('comp', COMP); P.set('comps', [COMP, CUP]); P.set('teams', TEAMS); P.set('fxOpen', true);
  await P.load();
  const host = P.nodes['#fxList'];
  const allBox = host.querySelector('label.fxbulk-all').children.find(c => c.tagName === 'INPUT');
  allBox.checked = true; allBox.dispatchEvent(new Ev('change', { bubbles: true }));
  eq('"select all shown" ticks the thirty drawn rows, not the 184 below', host.querySelectorAll('input.fxpick:checked').length, 30);
  ok('...and says so', /30 ticked/.test(textOf(host.querySelector('.fxbulk'))));
  host.querySelector('button.fxmore').click();
  eq('drawing thirty more leaves the new ones unticked', host.querySelectorAll('input.fxpick:checked').length, 30);
  host.querySelectorAll('button.ep-chip').find(b => b.dataset.k === 'toplay').click();
  eq('changing the filter clears the ticks (the rows are drawn again)', host.querySelectorAll('input.fxpick:checked').length, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
