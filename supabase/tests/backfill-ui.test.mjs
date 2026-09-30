/* ============================================================================
   THE CONSOLE'S "FILL IN AN OLDER SEASON" LIST (epinoia/admin/backfill-ui.js), with no browser.

     node supabase/tests/backfill-ui.test.mjs

   The list offers a season the way the league names its seasons, because the worker reads a season only in that
   form (run_ingest.backfill_sources skips the other, and says so on the request). What is held here:
     * a league whose seasons are all single years is a calendar-year league, one with split seasons is not, and a
       league with no season on the platform yet cannot say which (null);
     * that last kind (NBL1 before its first season, CEBL before its import) is offered both forms, in two groups,
       so it can be asked for at all; the other two get their own form only, the season being played left out.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

/* just enough of a DOM for the panel: elements that hold children, text, a style and listeners */
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this.own = ''; this.style = {}; this.on = {}; }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.children.push(c)); }
  set textContent(v) { this.own = String(v); this.children = []; }
  get textContent() { return this.own + this.children.map(c => c.textContent).join(''); }
  addEventListener(t, f) { this.on[t] = f; }
  all(tag) { return [].concat(this.tag === tag ? [this] : [], ...this.children.map(c => c.all ? c.all(tag) : [])); }
}
const chain = { select() { return this; }, eq() { return this; }, order() { return this; },
  limit() { return Promise.resolve({ data: [], error: null }); } };
const sandbox = { console, module: undefined, window: {}, document: { createElement: t => new Node(t), querySelector: () => null } };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'epinoia/admin/backfill-ui.js'), 'utf8'), vm.createContext(sandbox), { filename: 'backfill-ui.js' });
const BF = sandbox.EpinoiaBackfill;

console.log('\nwhat kind of league');
ok('single years: a calendar-year league', BF.isCalendar([{ name: '2026' }, { name: '2025' }]) === true);
ok('split seasons: not', BF.isCalendar([{ name: '2025-26' }]) === false);
ok('a mix: not (only a league of single years is one)', BF.isCalendar([{ name: '2026' }, { name: '2025-26' }]) === false);
ok('no season yet: cannot say', BF.isCalendar([]) === null && BF.isCalendar(null) === null);

console.log('\nwhat is offered');
const at = new Date(Date.UTC(2026, 8, 30));
ok('split: the eight before the season being played, newest first', BF.pastSeasons(at, false).join() ===
   '2025-26,2024-25,2023-24,2022-23,2021-22,2020-21,2019-20,2018-19');
ok('calendar: the eight years before this one', BF.pastSeasons(at, true).join() === '2025,2024,2023,2022,2021,2020,2019,2018');

function draw(seasons) {
  const host = new Node('div');
  BF.mount({ host, sb: { from: () => chain, rpc: async () => ({}) }, say: () => {}, league: { id: 'L1', name: 'A league' }, seasons });
  return host;
}
{
  const host = draw([]);
  const groups = host.all('optgroup');
  const opts = g => g.all('option').map(o => o.value);
  ok('a league with no season yet: two groups', groups.length === 2, groups.map(g => g.label).join(' | '));
  ok('...two years each in the first', groups[0] && opts(groups[0]).length === 8 && opts(groups[0]).every(v => /^\d{4}-\d{2}$/.test(v)));
  ok('...single years in the second, named as a league played inside one year', groups[1] && opts(groups[1]).length === 8
     && opts(groups[1]).every(v => /^\d{4}$/.test(v)) && /calendar year/.test(groups[1].label));
  ok('...and the season being played named both ways', /is not on this list/.test(host.textContent) &&
     /\d{4}-\d{2} or \d{4}\)/.test(host.textContent));
}
{
  const host = draw([{ name: '2026' }]);
  const vals = host.all('option').map(o => o.value);
  ok('a calendar-year league: years only, no groups', host.all('optgroup').length === 0 && vals.length === 8 && vals.every(v => /^\d{4}$/.test(v)));
  ok('...this year not among them', !vals.includes(String(new Date().getUTCFullYear())));
}
{
  const host = draw([{ name: '2025-26' }, { name: '2024-25' }]);
  const opts = host.all('option');
  ok('a split-season league: two years only', host.all('optgroup').length === 0 && opts.every(o => /^\d{4}-\d{2}$/.test(o.value)));
  ok('...a season already on the platform says so', opts.some(o => /already on the platform/.test(o.textContent)));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
