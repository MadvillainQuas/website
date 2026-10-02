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
  setAttribute(k, v) { this[k] = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  append(...cs) { cs.forEach(c => this.children.push(c)); }
  set textContent(v) { this.own = String(v); this.children = []; }
  get textContent() { return this.own + this.children.map(c => c.textContent).join(''); }
  addEventListener(t, f) { this.on[t] = f; }
  all(tag) { return [].concat(this.tag === tag ? [this] : [], ...this.children.map(c => c.all ? c.all(tag) : [])); }
}
const chain = { select() { return this; }, eq() { return this; }, order() { return this; },
  limit() { return Promise.resolve({ data: [], error: null }); } };
const sandbox = { console, module: undefined, window: {}, setTimeout, clearTimeout, document: { createElement: t => new Node(t), querySelector: () => null } };
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

/* ---------------------------------------------------- started at once, and saying so (2026-10-02, 0217) --- */
console.log('\nthe worker is started when the season is asked for, and the request says where it stands');
vm.runInContext(fs.readFileSync(path.join(ROOT, 'epinoia/admin/jobbar.js'), 'utf8'), vm.createContext(sandbox), { filename: 'jobbar.js' });
const JB = sandbox.EpinoiaJobBar;
sandbox.window.EpinoiaJobBar = JB;
{
  const q = { state: 'queued' };
  ok('a request nobody has started yet: waiting for the worker to be started, within minutes, an hour at most',
     /^Waiting for the worker to be started: usually within a few minutes, at most about an hour\.$/.test(JB.waiting(q)));
  ok('...one started: when, and that it usually begins within a couple of minutes',
     /^Starting: the worker was started at .+ and usually begins within a couple of minutes\.$/.test(JB.waiting({ state: 'queued', dispatched_at: '2026-10-02T14:02:00Z' })));
  ok('...and how many requests are ahead of it', /· 2 requests ahead of it in the queue\.$/.test(JB.waiting(q, { ahead: 2 })) &&
     /· 1 request ahead of it in the queue\.$/.test(JB.waiting(q, { ahead: 1 })) && !/ahead/.test(JB.waiting(q, { ahead: 0 })));
  /* what a reader is shown: every string in the three files (comments may tell the history) */
  const shown = ['epinoia/admin/jobbar.js', 'epinoia/admin/backfill-ui.js', 'epinoia/admin/platform/reset-ui.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')).join('\n');
  ok('nothing a reader is shown says "every 10 minutes" any more', !/10 minutes|ten minutes|10 min\b/.test(shown));
  const run = { state: 'running', step: 'ABA: game 4 of 240', detail: { pct: 3, run_url: 'https://github.com/owner/site/actions/runs/123' } };
  const box = JB.draw(run);
  const links = box.all('a');
  ok('a running request links to its worker\'s log', links.length === 1 && links[0].href === 'https://github.com/owner/site/actions/runs/123' &&
     links[0].target === '_blank' && /ABA: game 4 of 240/.test(box.textContent));
  ok('...only a GitHub run\'s address, and never on a queued one',
     JB.draw(Object.assign({}, run, { detail: { pct: 3, run_url: 'https://evil.example/x' } })).all('a').length === 0 &&
     JB.draw({ state: 'queued', detail: { run_url: 'https://github.com/owner/site/actions/runs/1' } }).all('a').length === 0);
}
{
  /* kick: the console-kick function, answered, refused, or not there at all */
  const asked = [];
  const sb = answer => ({ functions: { invoke: async (name, o) => { asked.push([name, o]); return answer; } } });
  const a = await JB.kick(sb({ data: { started: true, at: 't' }, error: null }));
  const b = await JB.kick(sb({ data: null, error: { message: 'Function not found' } }));
  const c = await JB.kick({});
  ok('kick asks console-kick with nothing in the body, and hands back its answer', a.started === true && asked[0][0] === 'console-kick' &&
     JSON.stringify(asked[0][1]) === '{"body":{}}');
  ok('...a function that is not there, or a client without functions, is "not started", never an error', b.started === false && /not found/.test(b.why) && c.started === false);
}
{
  /* the press: queued, then started, and the list asks where each queued request stands */
  const said = [], rpcs = [], invoked = [];
  const rows = [{ id: 'q1', season: '2024-25', state: 'queued', requested_at: '2026-10-02T14:00:00Z', dispatched_at: '2026-10-02T14:01:00Z', detail: {} }];
  const listChain = { select() { return this; }, eq() { return this; }, order() { return this; }, limit: async () => ({ data: rows, error: null }) };
  const sb = {
    from: () => listChain,
    rpc: async (fn, args) => { rpcs.push([fn, args]); return fn === 'season_backfill_queue' ? { data: { state: 'queued', ahead: 2, running: 1 } } : { error: null }; },
    functions: { invoke: async name => { invoked.push(name); return { data: { started: true, at: '2026-10-02T14:01:00Z' }, error: null }; } }
  };
  const host = new Node('div');
  BF.mount({ host, sb, say: (m, k) => said.push(m), league: { id: 'L1', name: 'A league' }, seasons: [{ name: '2025-26' }] });
  const sel = host.all('select')[0], go = host.all('button').find(b => /ask for this season/.test(b.textContent));
  sel.value = '2024-25';
  await go.on.click();
  await new Promise(r => setTimeout(r, 20));
  ok('pressing it queues the season, then starts the worker', rpcs[0][0] === 'queue_season_backfill' && rpcs[0][1].p_season === '2024-25' && invoked[0] === 'console-kick');
  ok('...and says the worker has been started', /2024-25 is queued and the worker has been started/.test(said[said.length - 1]), said);
  const text = host.textContent;
  ok('the queued request says when its worker was started, and how many are ahead of it',
     rpcs.some(([fn, a]) => fn === 'season_backfill_queue' && a.p_id === 'q1') && /worker started/.test(text) && /2 requests ahead of it in the queue/.test(text), text.slice(0, 400));
  BF.clear();
}
{
  /* a kick that is not set up still leaves the request in good hands, and says so */
  const said = [];
  const sb = { from: () => chain, rpc: async () => ({ error: null }), functions: { invoke: async () => ({ data: { started: false, why: 'not set up' }, error: null }) } };
  const host = new Node('div');
  BF.mount({ host, sb, say: m => said.push(m), league: { id: 'L1', name: 'A league' }, seasons: [{ name: '2025-26' }] });
  host.all('select')[0].value = '2023-24';
  await host.all('button').find(b => /ask for this season/.test(b.textContent)).on.click();
  ok('...without the function: queued, and the worker will be started within a few minutes (an hour at most)',
     /2023-24 is queued\. The worker will be started within a few minutes \(at most about an hour\)/.test(said[said.length - 1]), said);
  BF.clear();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
