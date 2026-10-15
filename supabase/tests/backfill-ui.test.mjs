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
  append(...cs) { cs.forEach(c => this.children.push(typeof c === 'string' ? { textContent: c } : c)); }
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
ok('split: the season being played and the eight before it, newest first (0261)', BF.pastSeasons(at, false).join() ===
   '2026-27,2025-26,2024-25,2023-24,2022-23,2021-22,2020-21,2019-20,2018-19');
ok('calendar: this year and the eight before it (0261: NBL1 2026)', BF.pastSeasons(at, true).join() === '2026,2025,2024,2023,2022,2021,2020,2019,2018');

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
  ok('...two years each in the first', groups[0] && opts(groups[0]).length === 9 && opts(groups[0]).every(v => /^\d{4}-\d{2}$/.test(v)));
  ok('...single years in the second, named as a league played inside one year', groups[1] && opts(groups[1]).length === 9
     && opts(groups[1]).every(v => /^\d{4}$/.test(v)) && /calendar year/.test(groups[1].label));
  ok('...and the season being played named both ways, as one that can be asked for', /can be asked for too/.test(host.textContent) &&
     /\d{4}-\d{2} or \d{4}\)/.test(host.textContent));
}
{
  const host = draw([{ name: '2026' }]);
  const vals = host.all('option').map(o => o.value);
  ok('a calendar-year league: years only, no groups', host.all('optgroup').length === 0 && vals.length === 9 && vals.every(v => /^\d{4}$/.test(v)));
  const thisYear = host.all('option').find(o => o.value === String(new Date().getUTCFullYear()));
  ok('...this year among them, said to read its finished games', !!thisYear && /being played: its finished games/.test(thisYear.textContent));
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

/* WHAT THE SOURCE HOLDS (backfill-coverage.js, written by backfill_audit.py --coverage): said before anybody asks */
console.log('\nwhat the source holds');
const SPLIT6 = ['2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26'];
const seasonsOf = (codes) => Object.fromEntries(SPLIT6.map((s, i) => [s, codes[i]]));
ok('runs: consecutive seasons as one, oldest first', JSON.stringify(BF.runs(['2023-24', '2020-21', '2021-22'], SPLIT6))
   === JSON.stringify(['2020-21 – 2021-22', '2023-24']));
{
  const s = BF.summary({ checked: '2026-10-14', seasons: seasonsOf(['full', 'full', 'full', 'full', 'full', 'full']) });
  ok('every season whole: "every season, 2020-21 – 2025-26", nothing else said',
     s.can.every && s.can.range === '2020-21 – 2025-26' && !s.can.apart.length && !s.lines.length, JSON.stringify(s.can));
}
{
  const s = BF.summary({ seasons: seasonsOf(['full', 'none', 'full', 'full', 'full', 'full']) });
  ok('one season missing in the middle: every season apart from 2021-22',
     s.can.every && s.can.range === '2020-21 – 2025-26' && s.can.apart.join() === '2021-22', JSON.stringify(s.can));
  ok('...and it is said not to be held', s.lines.length === 1 && s.lines[0].kind === 'none' && s.lines[0].parts[0].seasons === '2021-22');
}
{
  const s = BF.summary({ seasons: seasonsOf(['none', 'none', 'full', 'full', 'box', 'box']), why: { '2020-21': 'not-yet', '2021-22': 'not-yet' } });
  ok('a league that began later: 2022-23 – 2025-26, not "every season"', !s.can.every && s.can.range === '2022-23 – 2025-26'
     && !s.can.apart.length, JSON.stringify(s.can));
  const box = s.lines.find(l => l.kind === 'box'), none = s.lines.find(l => l.kind === 'none');
  ok('...its box-score-only seasons as one run', box && box.parts[0].seasons === '2024-25 – 2025-26');
  ok('...and the seasons before it with their reason', none && none.parts.length === 1 && none.parts[0].seasons === '2020-21 – 2021-22'
     && /before the league or competition began/.test(none.parts[0].why));
}
{
  const s = BF.summary({ seasons: seasonsOf(['full', 'none', 'full', 'none', 'full', 'none']) });
  ok('scattered seasons: listed as runs, nothing "apart from"', s.can.range === '2020-21, 2022-23, 2024-25' && !s.can.apart.length, JSON.stringify(s.can));
}
{
  const s = BF.summary({ seasons: seasonsOf(['results', 'results', 'none', 'none', 'none', 'none']) });
  ok('nothing that can be filled: no range at all', s.can === null && s.lines.map(l => l.kind).join() === 'results,none');
}
ok('a league never checked: nothing said', BF.summary(null) === null && BF.summary({ seasons: {} }) === null);
{
  sandbox.EPINOIA_BACKFILL_COVERAGE = { checked: '2026-10-14', leagues: { 'the-league': { checked: '2026-10-14',
    seasons: seasonsOf(['none', 'part', 'full', 'box', 'full', 'full']), why: { '2020-21': 'not-yet' } } } };
  const host = new Node('div');
  BF.mount({ host, sb: { from: () => chain, rpc: async () => ({}) }, say: () => {}, league: { id: 'L1', slug: 'the-league', name: 'A league' },
             seasons: [{ name: '2025-26' }] });
  const text = host.textContent;
  ok('the panel says what the source holds, with a chip a season', /What the source holds/.test(text) && host.all('span')
     .filter(n => /bf-chip/.test(n.className)).length === 6);
  ok('...a chip coloured by what it holds', host.all('span').some(n => n.className === 'bf-chip bf-box' && n.textContent === '2023-24'));
  ok('...which seasons can be filled in', /Can be filled in: 2021-22 – 2025-26/.test(text), text.slice(0, 400));
  ok('...and why one cannot', /Not held by the source: 2020-21 \(before the league or competition began\)/.test(text));
  const opt = v => host.all('option').find(o => o.value === v);
  ok('the list marks each season: box scores only, some games missing, not held, nothing on a whole one',
     /· box scores only/.test(opt('2023-24').textContent) && /· some games missing/.test(opt('2021-22').textContent)
     && /· not held by the source/.test(opt('2020-21').textContent) && opt('2024-25').textContent === '2024-25');
  ok('...and a season older than the check as not checked', /· not checked/.test(opt('2019-20').textContent));
  const sel = host.all('select')[0], note = host.all('div').find(n => /bf-note/.test(n.className));
  sel.value = '2020-21'; sel.on.change();
  ok('picking a season the source never held says so before the button', /2020-21: not held by the source \(before the league or competition began\)\. A request for it will come back empty\./.test(note.textContent), note.textContent);
  sel.value = '2024-25'; sel.on.change();
  ok('...and a whole one says nothing', note.textContent === '');
  BF.clear();
  delete sandbox.EPINOIA_BACKFILL_COVERAGE;
}
{
  /* the file the audit writes loads the way the page loads it */
  const cov = path.join(ROOT, 'epinoia/admin/backfill-coverage.js');
  if (fs.existsSync(cov)) {
    const box = { console }; box.self = box; box.globalThis = box;
    vm.runInContext(fs.readFileSync(cov, 'utf8'), vm.createContext(box), { filename: 'backfill-coverage.js' });
    const d = box.EPINOIA_BACKFILL_COVERAGE;
    const codes = new Set(Object.values((d && d.leagues) || {}).flatMap(l => Object.values(l.seasons)));
    const whys = new Set(Object.values((d && d.leagues) || {}).flatMap(l => Object.values(l.why || {})));
    ok('backfill-coverage.js: loads, and every state and reason in it is one the panel can say',
       d && Object.keys(d.leagues).length > 0 && [...codes].every(c => BF.COVER[c]) && [...whys].every(w => BF.WHY[w]),
       [...codes, ...whys].join());
  }
}

/* ---------------------------------------------------------------- the platform's BACKFILL WORKER tab (2026-10-15) --- */
console.log('\nthe backfill worker tab (epinoia/admin/platform/backfill-worker-ui.js)');
{
  const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
  const box = { window: {} };
  vm.runInNewContext(read('epinoia', 'admin', 'platform', 'backfill-worker-ui.js'), box);
  const W = box.window.EpinoiaBackfillWorker;
  ok('it loads with no page, and says what it is', !!W && typeof W.open === 'function' && typeof W.details === 'function');
  ok('spans read as a person says them', W.span(40) === '40 s' && W.span(720) === '12 min' && W.span(9170) === '2 h 33 min' && W.span(null) === '');
  const now = Date.parse('2026-10-15T11:00:00Z');
  const run = { state: 'running', claimed_at: '2026-10-15T07:30:00Z', heartbeat_at: '2026-10-15T10:59:40Z',
    detail: { phase: 'games', src: 1, srcs: 3, label: 'NBL1 Men', done: 451, of: 716, written: 449, failed: 2, waiting: 0, per_game_s: 34.6, eta_s: 9170,
              last: 'Rockingham Flames 88-80 East Perth Eagles' } };
  const lines = Object.fromEntries(W.details(run, now).map(([k, v, c]) => [k, (c ? c + ':' : '') + v]));
  ok('a running request in detail: the source of several, the games read and left, written and failed, pace, time left, last game',
     lines.Source === 'NBL1 Men (1 of 3)' && lines.Games === '451 of 716 read' && lines.Written === '449 · 2 could not be read' &&
     lines.Pace === '35 s a game' && lines['Time left'] === 'about 2 h 33 min on this source' && lines['Last game written'] === 'Rockingham Flames 88-80 East Perth Eagles' &&
     lines['Running for'].startsWith('3 h 30 min') && lines['Last heard from'] === '20 s ago', JSON.stringify(lines));
  const quiet = Object.fromEntries(W.details(Object.assign({}, run, { heartbeat_at: '2026-10-15T10:40:00Z' }), now).map(([k, v, c]) => [k, (c ? c + ':' : '') + v]));
  ok('...a worker quiet for more than five minutes is marked', quiet['Last heard from'] === 'warn:20 min ago', quiet['Last heard from']);
  const fx = Object.fromEntries(W.details({ state: 'running', detail: { phase: 'fixtures', label: 'NBL1 Men', src: 1, srcs: 1, fixtures: 716, fixtures_done: 340 } }, now));
  ok('...and the fixtures phase is counted, a lone source not numbered', fx.Fixtures === '340 of 716 written to the schedule' && fx.Source === 'NBL1 Men', JSON.stringify(fx));
  const js = read('epinoia', 'admin', 'platform', 'platform.js'), html = read('epinoia', 'admin', 'platform', 'index.html');
  ok('the platform console has the tab, its pane and its scripts, and opens it on first sight',
     /data-p="bfw"[^>]*>Backfill worker</.test(html) && /id="pane-bfw"[^>]*><div id="bfwHost">/.test(html) &&
     /<script src="\.\.\/backfill-coverage\.js\?v=\d+" defer>/.test(html) && /<script src="\.\.\/backfill-ui\.js\?v=\d+" defer>/.test(html) &&
     /<script src="backfill-worker-ui\.js\?v=\d+" defer>/.test(html) && /bfw: loadBackfillWorker/.test(js));
  const src = read('epinoia', 'admin', 'platform', 'backfill-worker-ui.js');
  ok('it queues through queue_season_backfill (one request a season), starts the worker, and withdraws only a waiting request',
     /sb\.rpc\('queue_season_backfill', \{ p_league: league, p_season: s \}\)/.test(src) && /JB\(\)\.kick\(sb\)/.test(src) &&
     /\.delete\(\)\.eq\('id', r\.id\)\.eq\('state', 'queued'\)/.test(src));
  const py = read('scripts', 'ingest', 'run_ingest.py');
  ok('the worker reports what the tab draws: the phase, the counts, the pace, the time left and the last game',
     /"phase": "games"/.test(py) && /"per_game_s":/.test(py) && /"eta_s":/.test(py) && /"last": last_game/.test(py) && /"phase": "fixtures"/.test(py));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
