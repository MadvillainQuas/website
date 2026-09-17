/* ============================================================================
   THE GLOBAL SCOUTING PAGE — epinoia/scouting/index.html and scouting.js.

   What goes wrong quietly on this page:
   - the head loses its order: appmode.js no longer first (the app flashes the
     wrong page), or a script runs before the module it reads;
   - an inline script or handler creeps in and the CSP silently drops it;
   - the page forgets an option, and the table it draws is the one-league
     Statistics table (no LEAGUE column, RAPM offered across leagues, every
     row at once on a phone);
   - the page claims a league (__CS_LEAGUE_SLUG) and paints itself in one
     league's colours;
   - the URL state does not come back as it went out, so a shared filtered
     view opens as the default table;
   - the comparison offers a locked column, or RAPM, or more than eight stats;
   - rows arriving league by league redraw the table from scratch, losing the
     sort and the picks.

   scouting.js is run for real: its pure parts through require, and boot()
   against a small DOM stub with stand-ins for global.js, fulltable.js,
   access.js and compare.js that record what they were asked.

     node supabase/tests/scouting-page.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, 'got  ' + g + '\n          want ' + w);
};

const HTML = rd('epinoia', 'scouting', 'index.html');
const JS = rd('epinoia', 'scouting', 'scouting.js');
/* The page's own stamp (stamp-assets.py bumps every file together, and --check keeps them equal),
   so a stamp bump never breaks this test. */
const V = (/\?v=(\d+)/.exec(HTML) || [])[1] || 'unstamped';

/* ------------------------------------------------------------------ the head --- */
console.log('\nthe page');
{
  const head = HTML.slice(0, HTML.indexOf('</head>'));
  const firstScript = /<script\b[^>]*>/i.exec(head);
  ok('appmode.js is the first script, in <head>', !!firstScript && firstScript[0].includes('src="../appmode.js?v=' + V + '"'));
  ok('appmode.js is blocking (no defer, no async)', !!firstScript && !/\b(defer|async)\b/.test(firstScript[0]));
  ok('appmode.js comes before any stylesheet or meta tag that paints',
     head.indexOf('appmode.js') < head.indexOf('<link'));
  ok('the manifest is linked', /<link rel="manifest" href="\/epinoia\/manifest\.webmanifest">/.test(head));

  const csp = (/Content-Security-Policy"\s+content="([^"]+)"/.exec(head) || [])[1] || '';
  ok('CSP: scripts from self only', /script-src 'self'(;|$)/.test(csp) && !/script-src[^;]*unsafe/.test(csp), csp);
  ok('CSP: connects to supabase over https and wss', /connect-src[^;]*https:\/\/\*\.supabase\.co/.test(csp) && /connect-src[^;]*wss:\/\/\*\.supabase\.co/.test(csp), csp);

  const css = [...head.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m => m[1]);
  ['epinoia-kit.css', 'nav.css', 'card.css', 'table.css', 'compare.css'].forEach(f =>
    ok('stylesheet ' + f + ' at ?v=' + V, css.includes('../kit/' + f + '?v=' + V), css.join(' ')));
  const at = f => css.indexOf('../kit/' + f + '?v=' + V);
  ok('the kit comes before the table and compare sheets',
     at('epinoia-kit.css') > -1 && at('epinoia-kit.css') < at('table.css') && at('table.css') < at('compare.css'));

  const scripts = [...HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  ok('no inline script: every <script> has a src and no body', scripts.every(m => /\bsrc="/.test(m[1]) && !m[2].trim()));
  ok('no inline event handlers', !/\son[a-z]+\s*=/i.test(HTML));

  const body = HTML.slice(HTML.indexOf('</head>'));
  const deferred = [...body.matchAll(/<script src="([^"]+)" defer><\/script>/g)].map(m => m[1].replace('?v=' + V, ''));
  eq('deferred scripts, in order', deferred,
     ['../config.js', '../access.js', '../season.js', '../bpm.js', '../data.js', '../global.js',
      '../fulltable.js', '../compare.js', 'scouting.js', '../nav.js', '../xscroll.js']);
  ok('every deferred script is stamped ?v=' + V, [...body.matchAll(/<script src="([^"]+)"/g)].every(m => m[1].endsWith('?v=' + V)));

  /* EVERY LOCAL FILE THE PAGE ASKS FOR IS IN THE REPO. appmode.js and home/ are Phase 1's (R2),
     which the roadmap releases before this page (R4, §5); on a branch without them they are
     named here rather than passed silently, and once they land the check is strict for them too. */
  {
    const here = path.join(ROOT, 'epinoia', 'scouting');
    const refs = [...HTML.matchAll(/\b(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)].map(m => m[1])
      .filter(u => !/^\/\//.test(u) && u !== '' && !u.startsWith('mailto'));
    const WAITS_ON_R2 = new Set(['../appmode.js', '../home/']);
    const missing = [];
    refs.forEach(u => {
      const abs = u.startsWith('/') ? path.join(ROOT, u) : path.join(here, u);
      let found = false;
      try { readFileSync(u.endsWith('/') ? path.join(abs, 'index.html') : abs); found = true; } catch (_) { /* missing */ }
      if (found) return;
      if (WAITS_ON_R2.has(u)) console.log('  NOTE  ' + u + ' is not on this branch: it arrives with Phase 1 (R2), which must merge first');
      else missing.push(u);
    });
    ok('every script, stylesheet and link the page references exists (Phase 1 files aside)', refs.length > 10 && !missing.length, missing.join(' '));
  }

  ok('the EPINOIΛ wordmark links to HOME',/<a href="\.\.\/home\/"[^>]*>\s*<span[^>]*epinoia-mark[^>]*>EPINOIΛ<\/span><\/a>/.test(HTML));
  ok('the header says Global scouting', /<h2 id="title">Global scouting<\/h2>/.test(HTML));
  ok('the header line mentions every league and the top 50', /every league/i.test(HTML) && /top 50/i.test(HTML));
  ok('a loading skeleton sits in the table host before any script runs', /<div id="tbl"><div class="sc-skel"/.test(HTML));
  ok('a status line announced politely', /id="status"[^>]*role="status"[^>]*aria-live="polite"/.test(HTML));
  ok('a desktop compare panel above the table', HTML.indexOf('id="cmpPanel"') > -1 && HTML.indexOf('id="cmpPanel"') < HTML.indexOf('id="tbl"'));
  ok('the page never claims a league (__CS_LEAGUE_SLUG)', !/__CS_LEAGUE_SLUG\s*=/.test(JS) && !/__CS_LEAGUE_SLUG/.test(HTML));
  ok('the sitemap lists /epinoia/scouting/', rd('epinoia', 'sitemap.xml').includes('<loc>https://prophesyscouting.co.uk/epinoia/scouting/</loc>'));
}

/* ------------------------------------------------ fulltable still takes these --- */
console.log('\nthe options exist in fulltable.js');
{
  const FT = rd('epinoia', 'fulltable.js');
  ['leagueColumn', 'leagueSelect', 'rankWithinLeague', 'locked', 'filters', 'selectable', 'onCompare',
   'noRapm', 'searchLeagues', 'state', 'onState', 'pageSize'].forEach(k =>
    ok('fulltable reads opts.' + k, new RegExp('opts\\.' + k + '\\b').test(FT)));
  ['getRanks', 'getSelected', 'setRows', 'getState'].forEach(k =>
    ok('render returns ' + k, new RegExp('\\b' + k + '\\b').test(FT)));
}

const S = require(path.join(ROOT, 'epinoia', 'scouting', 'scouting.js'));

/* --------------------------------------------------------------- URL state --- */
console.log('\nURL state');
{
  eq('an empty query is the defaults', S.readState(''), Object.assign({}, S.DEFAULTS, { filters: [] }));
  eq('the defaults write nothing', S.writeState(S.DEFAULTS, ''), '');
  eq('parameters the page does not own are kept', S.writeState(S.DEFAULTS, '?source=pwa'), '?source=pwa');

  const st = {
    sort: 'bpm', dir: 1, preset: 'shooting', search: 'Leicester',
    filters: [{ k: 'p3_pct', op: 'ge', mode: 'pct', x: 80 }, { k: 'p3a_pg', op: 'ge', mode: 'val', x: 3 },
              { k: 'topg', op: 'le', mode: 'val', x: 1.5 }],
    league: '6f1c0f7e-1111-4a2b-9c3d-000000000001', team: '42', withinLeague: false, page: 3, qualified: false
  };
  const qs = S.writeState(st, '?source=pwa');
  ok('the written query keeps source=pwa', new URLSearchParams(qs).get('source') === 'pwa', qs);
  eq('a full state round trips through the URL', S.readState(qs), st);

  const st2 = Object.assign({}, S.DEFAULTS, { sort: 'ts', filters: [] });
  eq('a state differing only in sort round trips', S.readState(S.writeState(st2, '')), st2);
  ok('only the sort is written for it', S.writeState(st2, '') === '?s=ts');

  eq('a malformed filter line is dropped, the good one kept',
     S.decodeFilters('p3_pct:ge:pct:80,bad,ts:gt:val:5,ts:ge:val:abc,efg:le:val:'),
     [{ k: 'p3_pct', op: 'ge', mode: 'pct', x: 80 }]);
  eq('a filter line with no number is not written', S.encodeFilters([{ k: 'ts', op: 'ge', mode: 'val', x: null }]), '');
  ok('an injected key is refused', S.decodeFilters('ts%3Cscript:ge:val:1').length === 0 && S.readState('?s=<img>').sort === 'ppg');
  eq('page is floored to 1', S.readState('?pg=0').page, 1);
  eq('dir=asc reads as ascending', S.readState('?dir=asc').dir, 1);
}

/* ---------------------------------------------------------- render options --- */
console.log('\nthe table options');
{
  const lockedFn = k => k === 'z_rim_att';
  const onState = () => {}, onCompare = () => {};
  const o = S.tableOptions({ host: 'H', rows: [1], locked: lockedFn, state: { sort: 'ppg' }, onState, onCompare });
  ok('player table', o.kind === 'player');
  ok('LEAGUE column', o.leagueColumn === true);
  ok('league select', o.leagueSelect === true);
  ok('rank within league, on', o.rankWithinLeague === true);
  ok('no RAPM', o.noRapm === true);
  ok('search matches leagues', o.searchLeagues === true);
  ok('stat filters drawer', !!o.filters);
  eq('pick up to five', o.selectable, { max: 5 });
  ok('fifty rows with show more, at every width', o.pageSize === 50);
  ok('sorted by PPG by default', o.sortKey === 'ppg');
  ok('the page lock is passed through', o.locked === lockedFn);
  ok('state, onState and onCompare are passed through', o.state.sort === 'ppg' && o.onState === onState && o.onCompare === onCompare);
  ok('no rapm function is handed over', o.rapm == null);
  eq('the player link uses playerId, not the league-scoped id',
     o.playerHref({ id: 'L1:p 9', playerId: 'p 9' }), '../p/?p=p%209');
  ok('no qualified override: the table switches it on by default', !('qualified' in o));
}

/* ----------------------------------------------------------- compare input --- */
console.log('\nthe comparison');
const COLS = [
  { k: 'rank', l: '#', g: ['id'] }, { k: 'name', l: 'PLAYER', g: ['id'] },
  { k: 'gp', l: 'GP', g: ['basic'], fmt: r => String(r.gp) },
  { k: 'ppg', l: 'PPG', heat: 1, fmt: r => r.ppg.toFixed(1) },
  { k: 'rpg', l: 'RPG', heat: 1, fmt: r => r.rpg.toFixed(1) },
  { k: 'apg', l: 'APG', heat: 1, fmt: r => r.apg.toFixed(1) },
  { k: 'spg', l: 'SPG', heat: 1, fmt: r => r.spg.toFixed(1) },
  { k: 'bpg', l: 'BPG', heat: 1, fmt: r => r.bpg.toFixed(1) },
  { k: 'topg', l: 'TOPG', heat: 1, low: 1, fmt: r => r.topg.toFixed(1) },
  { k: 'ts', l: 'TS%', heat: 1, fmt: r => r.ts.toFixed(1) },
  { k: 'efg', l: 'eFG%', heat: 1, fmt: r => r.efg.toFixed(1) },
  { k: 'p3_pct', l: '3P%', heat: 1, fmt: r => r.p3_pct.toFixed(1) },
  { k: 'usg', l: 'USG%', heat: 1, fmt: r => r.usg.toFixed(1) },
  { k: 'bpm', l: 'BPM', heat: 1, fmt: r => (r.bpm > 0 ? '+' : '') + r.bpm.toFixed(1) },
  { k: 'rapm', l: 'RAPM', heat: 1, fmt: r => String(r.rapm) },
  { k: 'z_rim_att', l: 'RIM ATT', heat: 1, fmt: r => String(r.z_rim_att) },
  { k: 'efg_vs', l: 'eFG vs EXP', heat: 1, signed: 1, fmt: r => String(r.efg_vs) }
];
{
  const locked = k => k === 'z_rim_att';
  const preset = ['ppg', 'rpg', 'apg', 'spg', 'bpg', 'topg', 'ts', 'efg', 'p3_pct', 'rapm', 'z_rim_att'];
  const cs = S.compareStats(preset, COLS, locked);
  eq('default stats: the visible preset, at most eight, no RAPM, nothing locked, turnovers behind', cs.keys,
     ['ppg', 'rpg', 'apg', 'spg', 'bpg', 'ts', 'efg', 'p3_pct']);
  ok('...and a demoted stat is still a chip', cs.pool.includes('topg'));
  {
    /* the per-game preset as the table hands it over: MPG, TOPG and PFPG are not among the
       eight defaults */
    const perGame = ['mpg', 'ppg', 'rpg', 'apg', 'spg', 'bpg', 'topg', 'pfpg', 'fg_pct', 'p3_pct', 'ft_pct', 'pm'];
    const PG = COLS.concat(['mpg', 'pfpg', 'fg_pct', 'ft_pct', 'pm'].map(k => ({ k, l: k.toUpperCase(), heat: 1 })));
    const d = S.compareStats(perGame, PG, locked);
    eq('per-game defaults leave out minutes, fouls and turnovers', d.keys,
       ['ppg', 'rpg', 'apg', 'spg', 'bpg', 'fg_pct', 'p3_pct', 'ft_pct']);
    ok('...which stay chips', ['mpg', 'pfpg', 'topg'].every(k => d.pool.includes(k)));
    eq('a short preset keeps its minor stats, behind the rest',
       S.compareStats(['topg', 'apg', 'ast_pct'], COLS.concat([{ k: 'ast_pct', l: 'AST%', heat: 1 }]), locked).keys,
       ['apg', 'ast_pct', 'topg']);
  }
  ok('the chips offer no locked stat and no RAPM', !cs.pool.includes('z_rim_att') && !cs.pool.includes('rapm'));
  ok('the chips add the core stats to the preset', cs.pool.includes('usg') && cs.pool.includes('bpm') && cs.pool.includes('p3_pct'));
  eq('minutes per game goes behind the rest of the preset in the defaults',
     S.compareStats(['mpg', 'ppg', 'rpg'], COLS.concat([{ k: 'mpg', l: 'MPG', heat: 1 }]), locked).keys, ['ppg', 'rpg', 'mpg']);
  eq('a preset of nothing usable falls back to the core stats', S.compareStats(['rapm', 'z_rim_att'], COLS, locked).keys.slice(0, 3), ['ppg', 'rpg', 'apg']);

  const rows = [
    { id: 'L1:a', playerId: 'a', name: 'Ann', leagueShort: 'BCB', ppg: 20.25, rpg: 5, apg: 3, spg: 1, bpg: 0.2, topg: 2, ts: 61, efg: 55, p3_pct: null, usg: 25, bpm: 3.2, rapm: 1, z_rim_att: 9 },
    { id: 'L2:a', playerId: 'a', name: 'Ann', leagueShort: 'SLB W', ppg: 11, rpg: NaN, apg: 1, spg: 2, bpg: 1, topg: 1, ts: 50, efg: 48, p3_pct: 33, usg: 18, bpm: -1.5 },
    { id: 'L1:b', playerId: 'b', name: 'Bo', leagueShort: 'BCB', ppg: 8, rpg: 9, apg: 0.5, spg: 0.3, bpg: 2, topg: 0.8, ts: 58, efg: 57, p3_pct: 20, usg: 14, bpm: 0 }
  ];
  const ranks = new Map([['ppg', new Map([['L1:a', 90], ['L2:a', 60], ['L1:b', 10]])],
                         ['z_rim_att', new Map([['L1:a', 99]])]]);
  const o = S.compareInput(rows, preset, COLS, ranks, { locked, withinLeague: true });
  eq('players keyed by the league-scoped id, with their league', o.players,
     [{ id: 'L1:a', name: 'Ann', league: 'BCB' }, { id: 'L2:a', name: 'Ann', league: 'SLB W' }, { id: 'L1:b', name: 'Bo', league: 'BCB' }]);
  ok('the same player in two leagues keeps two value sets', o.values['L1:a'].ppg === 20.25 && o.values['L2:a'].ppg === 11);
  ok('percentiles come from getRanks by row id', o.pcts['L1:a'].ppg === 90 && o.pcts['L1:b'].ppg === 10);
  ok('a stat with no rank is null, never NaN', o.pcts['L1:a'].rpg === null);
  ok('a missing or non-finite value is null', o.values['L1:a'].p3_pct === null && o.values['L2:a'].rpg === null);
  ok('no locked stat reaches the chart data', !('z_rim_att' in o.values['L1:a']) && !('z_rim_att' in o.pcts['L1:a']));
  ok('percentile mode by default', o.mode === 'pct');
  ok('the note says within own league', /within each player/.test(o.note));
  ok('the note says across leagues when the toggle is off',
     /across every league/.test(S.compareInput(rows, preset, COLS, ranks, { locked, withinLeague: false }).note));
  const ppg = o.stats.find(s => s.key === 'ppg');
  ok('a stat formats through the table column', ppg.fmt(20.25) === '20.3' && ppg.label === 'PPG');
  ok('a null formats as a dash', ppg.fmt(null) === '—');
  ok('a signed column stays signed', S.compareInput(rows, ['efg_vs'], COLS, ranks, {}).stats[0].signed === true);
  ok('at most five players', S.compareInput(rows.concat(rows, rows), preset, COLS, ranks, {}).players.length === 5);

  /* and the real chart draws it: 3 players x 6 stats = 18 bars, nothing NaN */
  const C = require(path.join(ROOT, 'epinoia', 'compare.js'));
  const six = S.compareInput(rows, ['ppg', 'rpg', 'apg', 'ts', 'p3_pct', 'bpm'], COLS, ranks, {});
  const svg = C.html(Object.assign({}, six, { width: 375 }));
  const bars = (svg.match(/<rect[^>]*class="cmp-bar[^"]*"/g) || []).length;
  ok('the real chart: 3 players x 6 stats = 18 bars at 375px', bars === 18, 'bars ' + bars);
  ok('the real chart prints no NaN, in either mode', !/NaN/.test(svg) && !/NaN/.test(C.html(Object.assign({}, six, { width: 375, mode: 'value' }))));

  eq('progress while loading', S.progressText([{ short: 'BCB' }, { short: 'SLB M' }], false), 'BCB · SLB M · …');
  eq('progress once done', S.progressText([{ short: 'BCB' }, { short: 'SLB M' }], true), 'BCB · SLB M');
  eq('members-only note', S.excludedText([{ id: 1 }, { id: 2 }]), '2 members-only leagues not included');
  eq('one members-only league', S.excludedText([{ id: 1 }]), '1 members-only league not included');
  eq('no note when none are left out', S.excludedText([]), '');
}

/* ------------------------------------------------------------------- boot --- */
class Node_ {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
    this._text = ''; this.className = ''; this.hidden = false; this.attrs = {}; this.listeners = {}; this.title = ''; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(n)); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(t) { (this.listeners[t] || []).forEach(fn => fn({})); }
  scrollIntoView() { this.scrolled = true; }
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const f = c.find && c.find(pred); if (f) return f; } return null; }
}
const tick = () => new Promise(r => setTimeout(r, 0));

async function bootWith({ search = '', phone = false, leagues, excluded = [], failed = [], reject = null, states = {}, onAccess = false }) {
  const nodes = { '#tbl': new Node_('div'), '#status': new Node_('div'), '#cmpPanel': new Node_('section') };
  nodes['#cmpPanel'].hidden = true;
  const log = { renders: [], setRows: [], urls: [], opened: [], panels: [], reloads: 0, onChange: null };
  const table = {
    getState: () => ({ withinLeague: true }),
    getRanks: keys => { log.rankKeys = keys; return new Map([['ppg', new Map([['L1:a', 70]])]]); },
    setRows: rows => log.setRows.push(rows.length)
  };
  const g = globalThis;
  g.document = {
    querySelector: s => nodes[s] || null,
    createElement: t => new Node_(t),
    createTextNode: t => { const n = new Node_('#text'); n._text = String(t); return n; }
  };
  g.location = { search, pathname: '/epinoia/scouting/', hash: '', reload: () => { log.reloads++; } };
  g.history = { state: null, replaceState: (s, t, u) => log.urls.push(u) };
  g.matchMedia = q => ({ matches: phone && /max-width/.test(q) });
  g.EpinoiaData = {};
  g.EpinoiaTable = { PHONE_MQ: '(max-width:820px)', PLAYER_COLS: COLS,
    render: o => { log.renders.push(o); log.lockedAtRender = o.locked('z_rim_att'); log.urlsAtRender = log.urls.length; return table; } };
  g.EpinoiaAccess = { get: id => states[id] || { known: true, canView: true, analyticsOk: true },
    canView: () => true, onChange: fn => { log.onChange = fn; } };
  g.EpinoiaCompare = { open: o => { log.opened.push(o); return {}; },
    render: (host, o) => { log.panels.push(o); return { destroy () {} }; } };
  g.EpinoiaGlobal = {
    lockedColumns: sts => new Set(sts.some(s => s && s.analyticsOk === false) ? ['z_rim_att'] : []),
    players: async ({ onLeague, onAccess: announce }) => {
      if (reject) throw reject;
      if (onAccess && announce) { await tick(); announce(new Map(), leagues.map(x => x[0]), excluded); }
      for (const [L, rows] of leagues) { await tick(); onLeague(rows, L); log['status_' + L.short] = nodes['#status'].textContent; }
      return { rows: leagues.flatMap(x => x[1]), leagues: leagues.map(x => x[0]), excluded, failed, access: new Map() };
    }
  };
  S.boot();
  for (let i = 0; i < 12; i++) await tick();
  return { nodes, log, table };
}

console.log('\nthe page boots');
{
  const bcb = { id: 'L1', short: 'BCB', name: 'British Collegiate Basketball' };
  const slbm = { id: 'L2', short: 'SLB M', name: 'Super League Basketball' };
  const slbw = { id: 'L3', short: 'SLB W', name: 'Super League Basketball Women' };
  const rowsA = [{ id: 'L1:a', playerId: 'a', name: 'Ann', leagueId: 'L1', leagueShort: 'BCB', ppg: 20 },
                 { id: 'L1:b', playerId: 'b', name: 'Bo', leagueId: 'L1', leagueShort: 'BCB', ppg: 9 }];
  const rowsB = [{ id: 'L3:c', playerId: 'c', name: 'Cy', leagueId: 'L3', leagueShort: 'SLB W', ppg: 14 }];
  const skeleton = 'sc-skel';

  const { nodes, log } = await bootWith({
    search: '?source=pwa&s=bpm&f=p3_pct:ge:pct:80&wl=0',
    leagues: [[slbm, []], [bcb, rowsA], [slbw, rowsB]],
    excluded: [{ id: 'L9', name: 'Closed League', reason: 'members' }],
    states: { L3: { known: true, canView: true, analyticsOk: false } }
  });
  ok('an empty first league does not draw the table', log['status_SLB M'] && /SLB M 0 · …/.test(log['status_SLB M']), log['status_SLB M']);
  ok('the table is rendered once, on the first rows', log.renders.length === 1);
  ok('later leagues arrive through setRows', log.setRows.length >= 1 && log.setRows[log.setRows.length - 1] === 3, JSON.stringify(log.setRows));
  const o = log.renders[0];
  ok('the render got the table host', o.host === nodes['#tbl']);
  ok('the render got the cross-league options', o.leagueColumn && o.leagueSelect && o.rankWithinLeague && o.noRapm &&
     o.searchLeagues && o.filters && o.selectable.max === 5 && o.pageSize === 50 && o.sortKey === 'ppg');
  eq('the render got the state from the URL', [o.state.sort, o.state.withinLeague, o.state.filters], ['bpm', false, [{ k: 'p3_pct', op: 'ge', mode: 'pct', x: 80 }]]);
  ok('the first league drew with its own rows', o.rows.length === 2);
  ok('a league that locks analytics locks the column for the page', o.locked('z_rim_att') === true && o.locked('ppg') === false);
  const st = nodes['#status'].textContent;
  ok('the status line names each league with its count', /SLB M 0 · BCB 2 · SLB W 1/.test(st), st);
  ok('the status line is finished (no trailing …)', !/…/.test(st), st);
  ok('the members-only note is shown', /1 members-only league not included/.test(st), st);
  ok('...in its own class, not the kit’s 9px centred .sc-note',
     !!nodes['#status'].find(n => n.className === 'sc-excl') && !nodes['#status'].find(n => n.className === 'sc-note') &&
     /\.sc-excl\{/.test(HTML) && !/\.sc-note\{/.test(HTML));
  ok('without onAccess (an older loader) the lock still comes from the arrived leagues', log.lockedAtRender === false && o.locked('z_rim_att') === true);
  ok('the URL is written back from the state the table drew', log.urls.length > log.urlsAtRender);
  ok('the skeleton is gone', !nodes['#tbl'].find(n => n.className === skeleton));

  o.onState({ sort: 'ts', dir: -1, preset: 'basic', search: '', filters: [{ k: 'ts', op: 'ge', mode: 'pct', x: 75 }],
    league: 'L1', team: '', withinLeague: true, page: 2, qualified: true });
  const url = log.urls[log.urls.length - 1] || '';
  ok('onState writes the URL with replaceState', url.startsWith('/epinoia/scouting/?'), url);
  eq('and the URL reads back as that state', S.readState(url.slice(url.indexOf('?'))),
     { sort: 'ts', dir: -1, preset: 'basic', search: '', filters: [{ k: 'ts', op: 'ge', mode: 'pct', x: 75 }],
       league: 'L1', team: '', withinLeague: true, page: 2, qualified: true });
  ok('source=pwa survives', /source=pwa/.test(url), url);

  o.onCompare([rowsA[0], rowsA[1]], ['ppg', 'rpg', 'z_rim_att', 'rapm']);
  ok('desktop: the comparison opens in the panel, not a sheet', log.panels.length === 1 && log.opened.length === 0 && nodes['#cmpPanel'].hidden === false);
  ok('the panel scrolls into view', nodes['#cmpPanel'].scrolled === true);
  ok('getRanks is asked for no locked or RAPM stat', !log.rankKeys.includes('z_rim_att') && !log.rankKeys.includes('rapm'), JSON.stringify(log.rankKeys));
  ok('the panel chart has the percentiles', log.panels[0].pcts['L1:a'].ppg === 70);
  const close = nodes['#cmpPanel'].find(n => n.className === 'sc-cmp-close');
  close.fire('click');
  ok('the close button hides the panel', nodes['#cmpPanel'].hidden === true);
  o.onCompare([rowsA[0]], ['ppg']);
  ok('one pick opens nothing', log.panels.length === 1 && log.opened.length === 0);
}
{
  const bcb = { id: 'L1', short: 'BCB', name: 'BCB' };
  const rows = [{ id: 'L1:a', playerId: 'a', name: 'Ann', leagueId: 'L1', ppg: 20 }, { id: 'L1:b', playerId: 'b', name: 'Bo', leagueId: 'L1', ppg: 2 }];
  const { log } = await bootWith({ phone: true, leagues: [[bcb, rows]] });
  log.renders[0].onCompare(rows, ['ppg', 'rpg']);
  ok('phone: the comparison opens as a sheet', log.opened.length === 1 && log.panels.length === 0);
  eq('phone: default stats are the visible preset', log.opened[0].stats.map(s => s.key), ['ppg', 'rpg']);
}
{
  /* onAccess: every included league's access is known before the first rows, so a locking
     league that arrives LAST still locks the table from its very first draw */
  const bcb = { id: 'L1', short: 'BCB', name: 'BCB' };
  const slbw = { id: 'L3', short: 'SLB W', name: 'SLB W' };
  const { log, nodes } = await bootWith({ onAccess: true,
    leagues: [[bcb, [{ id: 'L1:a', playerId: 'a', name: 'Ann', leagueId: 'L1', ppg: 20 }]], [slbw, [{ id: 'L3:c', playerId: 'c', name: 'Cy', leagueId: 'L3', ppg: 9 }]]],
    excluded: [{ id: 'L9', name: 'Closed', reason: 'members' }],
    states: { L3: { known: true, canView: true, analyticsOk: false } } });
  ok('onAccess: the premium column is locked on the first draw, before the locking league’s rows',
     log.renders.length === 1 && log.lockedAtRender === true, String(log.lockedAtRender));
  ok('onAccess: the members-only note shows while loading', /1 members-only league not included/.test(nodes['#status'].textContent));
}
{
  const { nodes, log } = await bootWith({ leagues: [[{ id: 'L2', short: 'SLB M', name: 'SLB' }, []]] });
  ok('no rows anywhere: no table', log.renders.length === 0);
  ok('no rows anywhere: an empty state, not a skeleton', /No statistics yet/.test(nodes['#tbl'].textContent));
}
{
  const { nodes, log } = await bootWith({ leagues: [], excluded: [{ id: 'L9', name: 'X' }] });
  ok('only members-only leagues: says so', /members-only/.test(nodes['#tbl'].textContent) && log.renders.length === 0);
}
{
  const { nodes } = await bootWith({ leagues: [], reject: new Error('boom') });
  ok('a failure: an error state with the reason', /Could not load the scouting table: boom/.test(nodes['#tbl'].textContent));
  const retry = nodes['#tbl'].find(n => n.tagName === 'BUTTON');
  ok('a failure: a try again button', !!retry && /try again/.test(retry.textContent));
}
{
  const bcb = { id: 'L1', short: 'BCB', name: 'BCB' };
  const rows = [{ id: 'L1:a', playerId: 'a', name: 'Ann', leagueId: 'L1', ppg: 20 }];
  const states = { L1: { known: true, canView: true, analyticsOk: true } };
  const { log } = await bootWith({ leagues: [[bcb, rows]], failed: [], states });
  const before = log.setRows.length;
  log.onChange({ reason: 'load' });
  ok('an access answer that changes nothing does not redraw', log.setRows.length === before);
  states.L1.analyticsOk = false;
  log.onChange({ reason: 'load' });
  ok('an access answer that locks a column redraws with the lock', log.setRows.length === before + 1 && log.renders[0].locked('z_rim_att'));
}
{
  const { nodes } = await bootWith({ leagues: [[{ id: 'L1', short: 'BCB', name: 'BCB' }, [{ id: 'L1:a', name: 'A', leagueId: 'L1' }]]],
    failed: [{ id: 'L4', name: 'Broken League', error: 'x' }] });
  ok('a league that failed is named in the status line', /Could not load Broken League/.test(nodes['#status'].textContent));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
