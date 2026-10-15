'use strict';
/* ============================================================================
   THE BACKFILL WORKER (platform console tab, Louie 2026-10-15): every league's "fill in an older season" in one
   place. The league console's panel (../backfill-ui.js) asks for one league's seasons, one at a time, and shows only
   that league's requests; this is the platform's view of the one worker they all share:

     THE WORKER     what it is doing now, in detail: the league and season, the bar, the phase (schedule, fixtures,
                    games), the games read and left, written and failed, the pace and the time left, the last game
                    written, when it was last heard from, and its log. All of it is the worker's own report
                    (season_backfills.step / detail, written by scripts/ingest/run_ingest.py beat()).
     THE QUEUE      every league's waiting requests in the order the worker takes them (oldest first), each one
                    withdrawable while it waits.
     QUEUE SEASONS  any league, several seasons at once, each marked with what its source holds
                    (../backfill-coverage.js) and whether it is already in or on its way.
     FINISHED       the latest requests done or failed, with what each wrote, how long it took and why it stopped;
                    a failed one can be asked for again with one press.

   Nothing here decides permission: 0135's RLS and queue_season_backfill answer is_league_admin, which is true for a
   platform administrator over every league.
   ============================================================================ */
(function () {
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const btn = (t, cls, fn) => { const b = el('button', 'ep-btn ' + (cls || ''), t); b.type = 'button'; if (fn) b.addEventListener('click', fn); return b; };
const BF = () => window.EpinoiaBackfill;
const JB = () => window.EpinoiaJobBar;

let sb = null, H = {}, host = null, stop = null, busy = false, LEAGUES = [], BYID = new Map(), picked = null;

/* ------------------------------------------------------------------ words --- */
const STATE = { queued: 'waiting', running: 'being read now', done: 'filled in', failed: 'could not be filled in' };
const at = iso => { if (!iso) return ''; try { return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
/* a span of seconds as a person says it: 40 s, 12 min, 2 h 35 min */
function span(s) {
  if (s == null || !Number.isFinite(+s)) return '';
  s = Math.max(0, Math.round(+s));
  if (s < 90) return s + ' s';
  const m = Math.round(s / 60);
  if (m < 90) return m + ' min';
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}
const ago = iso => iso ? span((Date.now() - Date.parse(iso)) / 1000) + ' ago' : '';
const nameOf = id => (BYID.get(id) || {}).name || 'a league';
/* QUIET FOR LONG: the worker writes at least once a minute while it runs; 0135 puts a request back in the queue after
   90 minutes without a word. Past five minutes the tab says so, plainly. */
const QUIET_S = 300;

/* WHAT THE WORKER IS DOING, AS LINES (pure, for the test): from a running row's step and detail */
function details(r, now) {
  const d = (r && r.detail) || {}, out = [];
  const t = now || Date.now();
  if (d.label) out.push(['Source', d.label + (d.srcs > 1 ? ' (' + d.src + ' of ' + d.srcs + ')' : '')]);
  if (d.phase === 'fixtures' && d.fixtures) out.push(['Fixtures', (d.fixtures_done || 0) + ' of ' + d.fixtures + ' written to the schedule']);
  if (d.phase === 'games' && d.of != null) {
    out.push(['Games', d.done + ' of ' + d.of + ' read' + (d.waiting ? ' · ' + d.waiting + ' not finished yet, left to the live feed' : '')]);
    out.push(['Written', String(d.written || 0) + (d.failed ? ' · ' + d.failed + ' could not be read' : '')]);
    if (d.per_game_s) out.push(['Pace', span(d.per_game_s) + ' a game']);
    if (d.eta_s != null && d.of > d.done) out.push(['Time left', 'about ' + span(d.eta_s) + (d.srcs > 1 && d.src < d.srcs ? ' on this source' : '')]);
    if (d.last) out.push(['Last game written', d.last]);
  }
  if (r && r.claimed_at) out.push(['Running for', span((t - Date.parse(r.claimed_at)) / 1000) + ' (since ' + at(r.claimed_at) + ')']);
  if (r && r.heartbeat_at) {
    const q = (t - Date.parse(r.heartbeat_at)) / 1000;
    out.push(['Last heard from', span(q) + ' ago', q > QUIET_S ? 'warn' : '']);
  }
  return out;
}

/* THE BAR FROM THE PLATFORM ITSELF (2026-10-15): a worker that is not reporting its progress (one started before its
   reporting was there, or one whose progress writes fail) left the bar at 0% for hours while its games were being written
   - NBL1 2026 sat at "writing 716 fixture(s)" all morning. So the tab also counts the season's games on the platform, final
   of all, and draws that when the worker's own figure says less. Pure, for the test: the row as the bar should draw it. */
function withCount(r, c) {
  if (!r || !c || !c.all) return r;
  const own = +(r.detail && r.detail.pct) || 0, theirs = Math.min(100, 100 * c.final / c.all);
  if (own >= theirs) return r;
  return Object.assign({}, r, { detail: Object.assign({}, r.detail || {}, { pct: Math.round(theirs * 10) / 10 }) });
}
const COUNTS = new Map();        // request id -> { final, all, at }
async function countOf(r) {
  const was = COUNTS.get(r.id);
  if (was && Date.now() - was.at < 20000) return was;
  try {
    const { data: ss } = await sb.from('seasons').select('id,competitions(id)').eq('league_id', r.league_id).eq('name', r.season);
    const comps = (ss || []).flatMap(x => (x.competitions || []).map(c => c.id));
    if (!comps.length) return null;
    const head = st => { let q = sb.from('games').select('id', { count: 'exact', head: true }).in('competition_id', comps); return st ? q.eq('status', st) : q; };
    const [f, a] = await Promise.all([head('final'), head(null)]);
    const c = { final: f.count || 0, all: a.count || 0, at: Date.now() };
    COUNTS.set(r.id, c);
    return c;
  } catch (_) { return null; }
}

/* ------------------------------------------------------------------ style --- */
function style() {
  if (document.getElementById('bfw-style')) return;
  const s = el('style'); s.id = 'bfw-style';
  s.textContent = `
.bfw{display:grid;gap:calc(var(--u)*3)}
.bfw-box{border:1px solid var(--rule);border-radius:10px;padding:calc(var(--u)*2) calc(var(--u)*3)}
.bfw-box>h3{margin-top:0}
.bfw-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 8px}
.bfw-top .sp{margin-left:auto}
.bfw-run{border-top:1px solid var(--rule);padding:10px 0}
.bfw-run:first-of-type{border-top:0}
.bfw-run .nm{font-family:var(--f-ui);font-weight:700;font-size:15px}
.bfw-grid{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:3px 14px;margin:8px 0 0;font-family:var(--f-ui);font-size:12.5px}
.bfw-grid dt{color:var(--ink-3)} .bfw-grid dd{margin:0;color:var(--ink);overflow-wrap:anywhere}
.bfw-grid dd.warn{color:var(--amber)}
.bfw-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:4px 10px;padding:7px 0;border-top:1px solid var(--rule);font-family:var(--f-ui);font-size:13px}
.bfw-row:first-child{border-top:0}
.bfw-row .n{font-family:var(--f-score);font-size:15px;text-align:center;color:var(--ink-3)}
.bfw-row small{display:block;color:var(--ink-3);font-size:11.5px}
.bfw-row .err{color:var(--flare)}
.bfw-done .n{font-size:11px}
.bfw-pick{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.bfw-pick input[list]{min-width:min(340px,100%)}
.bfw-seasons{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
.bfw-s{display:inline-flex;align-items:center;gap:6px;padding:5px 9px;border:1px solid var(--rule-2);border-radius:6px;font-family:var(--f-ui);font-size:12.5px;cursor:pointer}
.bfw-s input{margin:0}
.bfw-s i{font-style:normal;font-size:11px;color:var(--ink-3)}
.bfw-s.full{background:color-mix(in oklch,var(--good) 14%,transparent)}
.bfw-s.part{background:color-mix(in oklch,var(--amber) 14%,transparent)}
.bfw-s.no{border-style:dashed;opacity:.75}
.bfw-s.busy{opacity:.55;cursor:default}
.bfw-cov{font-family:var(--f-ui);font-size:12px;color:var(--ink-3);margin:6px 0 0}
.bfw-idle{font-family:var(--f-ui);font-size:13px;color:var(--ink-3)}
@media (max-width:640px){.bfw-grid{grid-template-columns:1fr} .bfw-grid dt{margin-top:4px}}`;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ data --- */
const COLS = 'id,league_id,season,state,step,detail,requested_at,dispatched_at,claimed_at,heartbeat_at,finished_at,games_seen,games_written,sources_run,error,worker';
async function rows() {
  const [open, done] = await Promise.all([
    sb.from('season_backfills').select(COLS).in('state', ['queued', 'running']).order('requested_at', { ascending: true }).limit(200),
    sb.from('season_backfills').select(COLS).in('state', ['done', 'failed']).order('finished_at', { ascending: false }).limit(25)
  ]);
  if (open.error) throw open.error;
  if (done.error) throw done.error;
  return { open: open.data || [], done: done.data || [] };
}
async function leagues() {
  const { data, error } = await sb.from('leagues').select('id,name,slug,seasons(name)').order('name');
  if (error) throw error;
  LEAGUES = data || [];
  BYID = new Map(LEAGUES.map(l => [l.id, l]));
}

/* ------------------------------------------------------------------ the tab --- */
async function open(client, hooks) {
  sb = client; H = hooks || {};
  host = document.getElementById('bfwHost');
  if (!host) return;
  style();
  if (!host.dataset.built) {
    host.dataset.built = '1';
    host.textContent = '';
    host.appendChild(el('p', 'lead', 'One worker fills in older seasons for every league, one request at a time, oldest first. ' +
      'Queue seasons for any league here and follow the worker as it reads them. A request is never an import on the press: ' +
      'the worker takes it within minutes and reads a season game by game, which for a full season is an hour or several. ' +
      'A season longer than one run (about five hours) goes back in the queue and the next run goes on from where it stopped.'));
    const wrap = el('div', 'bfw');
    wrap.append(el('div', 'bfw-box bfw-now'), el('div', 'bfw-box bfw-queue'), el('div', 'bfw-box bfw-ask'), el('div', 'bfw-box bfw-done'));
    host.appendChild(wrap);
  }
  try { await leagues(); } catch (e) { return oops(e); }
  drawAsk();
  restart();
}
const say = (t, k) => (H.say ? H.say(t, k) : null);
const oops = e => (H.oops ? H.oops(e) : say(String((e && e.message) || e), 'err'));
const part = c => host.querySelector('.bfw-' + c);

function restart() {
  if (stop) stop();
  stop = JB() ? JB().poll(load, () => busy && !!host && host.offsetParent !== null) : (load(), null);
}

let LAST = { open: [], done: [] };
async function load() {
  let r;
  try { r = await rows(); } catch (e) { busy = false; part('now').textContent = ''; part('now').appendChild(el('p', 'bfw-idle', 'Could not read the requests: ' + (e.message || e))); return; }
  LAST = r;
  busy = r.open.length > 0;
  const running = r.open.filter(x => x.state === 'running');
  const counts = new Map(await Promise.all(running.map(async x => [x.id, await countOf(x)])));
  drawNow(running, r.open.filter(x => x.state === 'queued'), counts);
  drawQueue(r.open.filter(x => x.state === 'queued'));
  drawDone(r.done);
  if (picked) drawSeasons(picked);
}

/* THE WORKER, NOW */
function drawNow(running, queued, counts) {
  const box = part('now'); box.textContent = '';
  const top = el('div', 'bfw-top');
  top.appendChild(el('h3', null, 'The worker'));
  const sp = el('span', 'sp');
  sp.appendChild(btn('refresh', 'mini', () => restart()));
  top.appendChild(sp);
  box.appendChild(top);
  if (!running.length) {
    box.appendChild(el('p', 'bfw-idle', queued.length
      ? 'Not reading anything yet: ' + queued.length + (queued.length === 1 ? ' request is' : ' requests are') + ' waiting for it to start.'
      : 'Idle: nothing is being read and nothing is waiting.'));
    if (queued.length) box.appendChild(btn('start the worker now', 'mini', kick));
    return;
  }
  running.forEach(r => {
    const card = el('div', 'bfw-run');
    card.appendChild(el('div', 'nm', nameOf(r.league_id) + ' · ' + r.season));
    const c = counts && counts.get(r.id);
    if (JB()) card.appendChild(JB().draw(withCount(r, c), {}));
    const dl = el('dl', 'bfw-grid');
    details(r).forEach(([k, v, cls]) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', cls || null, v)); });
    if (c && c.all) { dl.appendChild(el('dt', null, 'On the platform')); dl.appendChild(el('dd', null, c.final + ' of ' + c.all + ' games of ' + r.season + ' final')); }
    card.appendChild(dl);
    const q = r.heartbeat_at ? (Date.now() - Date.parse(r.heartbeat_at)) / 1000 : 0;
    if (q > QUIET_S) card.appendChild(el('p', 'bfw-cov', 'The worker has not reported for ' + span(q) + '. It may have stopped: ' +
      '90 minutes after its last word the request goes back in the queue by itself, and the next run goes on from the games already written.'));
    box.appendChild(card);
  });
}

/* THE QUEUE, IN THE WORKER'S ORDER */
function drawQueue(queued) {
  const box = part('queue'); box.textContent = '';
  const top = el('div', 'bfw-top');
  top.appendChild(el('h3', null, 'The queue' + (queued.length ? ' (' + queued.length + ')' : '')));
  if (queued.length) { const sp = el('span', 'sp'); sp.appendChild(btn('start the worker now', 'mini', kick)); top.appendChild(sp); }
  box.appendChild(top);
  if (!queued.length) { box.appendChild(el('p', 'bfw-idle', 'Nothing is waiting.')); return; }
  const list = el('div');
  queued.forEach((r, i) => {
    const row = el('div', 'bfw-row');
    row.appendChild(el('span', 'n', String(i + 1)));
    const mid = el('div');
    mid.appendChild(el('b', null, nameOf(r.league_id) + ' · ' + r.season));
    mid.appendChild(el('small', null, 'asked ' + at(r.requested_at) + (r.dispatched_at ? ' · worker started ' + at(r.dispatched_at) : '') +
      (r.error ? ' · ' + r.error : '') + (r.step && /still to read/.test(r.step) ? ' · ' + r.step : '')));
    row.appendChild(mid);
    row.appendChild(btn('cancel', 'mini', async e => {
      e.target.disabled = true;
      const { error } = await sb.from('season_backfills').delete().eq('id', r.id).eq('state', 'queued');
      if (error) { e.target.disabled = false; return oops(error); }
      say(nameOf(r.league_id) + ' ' + r.season + ': withdrawn.', 'ok');
      restart();
    }));
    list.appendChild(row);
  });
  box.appendChild(list);
}

/* FINISHED, latest first */
function drawDone(done) {
  const box = part('done'); box.textContent = '';
  box.appendChild(el('h3', null, 'Finished lately'));
  if (!done.length) { box.appendChild(el('p', 'bfw-idle', 'Nothing has finished yet.')); return; }
  const list = el('div', 'bfw-done');
  done.forEach(r => {
    const row = el('div', 'bfw-row');
    row.appendChild(el('span', 'n', r.state === 'done' ? '✓' : '!'));
    const mid = el('div');
    mid.appendChild(el('b', null, nameOf(r.league_id) + ' · ' + r.season));
    const took = r.claimed_at && r.finished_at ? ' · took ' + span((Date.parse(r.finished_at) - Date.parse(r.claimed_at)) / 1000) : '';
    mid.appendChild(el('small', null, STATE[r.state] + ' · ' + (r.games_written || 0) + ' of ' + (r.games_seen || 0) + ' games written · ' + at(r.finished_at) + took));
    if (r.error) mid.appendChild(el('small', r.state === 'failed' ? 'err' : null, r.error));
    row.appendChild(mid);
    row.appendChild(r.state === 'failed' ? btn('ask again', 'mini', () => queue(r.league_id, [r.season])) : el('span'));
    list.appendChild(row);
  });
  box.appendChild(list);
}

/* ------------------------------------------------------------------ asking --- */
function drawAsk() {
  const box = part('ask'); box.textContent = '';
  box.appendChild(el('h3', null, 'Queue seasons'));
  const row = el('div', 'bfw-pick');
  const inp = el('input', 'ep-input'); inp.setAttribute('list', 'bfwLeagues'); inp.placeholder = 'league: type to find';
  const dl = el('datalist'); dl.id = 'bfwLeagues';
  const cov = window.EPINOIA_BACKFILL_COVERAGE && window.EPINOIA_BACKFILL_COVERAGE.leagues || {};
  const label = l => l.name + (cov[l.slug] ? '' : ' (no source check on file)');
  LEAGUES.forEach(l => { const o = el('option'); o.value = label(l); dl.appendChild(o); });
  const byLabel = new Map(LEAGUES.map(l => [label(l), l]));
  inp.addEventListener('change', () => { const l = byLabel.get(inp.value.trim()); if (l) { picked = l; drawSeasons(l); } });
  inp.addEventListener('input', () => { const l = byLabel.get(inp.value.trim()); if (l) { picked = l; drawSeasons(l); } });
  row.append(inp, dl);
  box.appendChild(row);
  box.appendChild(el('div', 'bfw-for'));
}

/* a league's seasons, each a tickbox marked with what its source holds and whether it is already in or on its way */
function drawSeasons(l) {
  const box = part('ask').querySelector('.bfw-for'); if (!box) return;
  const ticked = new Set([...box.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value));
  box.textContent = '';
  if (!BF()) { box.appendChild(el('p', 'bfw-idle', 'The season list has not loaded: reload the page.')); return; }
  const seasonRows = (l.seasons || []);
  const known = new Set(seasonRows.map(s => s.name));
  const calendar = BF().isCalendar(seasonRows);
  const cov = BF().coverageOf(l.slug);
  const sum = cov ? BF().summary(cov) : null;
  if (sum && sum.can) box.appendChild(el('p', 'bfw-cov', 'Its source can fill in ' + (sum.can.every ? 'every season, ' : '') + sum.can.range +
    (sum.can.apart.length ? ' apart from ' + sum.can.apart.join(', ') : '') + ' (checked ' + sum.checked + ').'));
  else if (!cov) box.appendChild(el('p', 'bfw-cov', 'No check of this league’s source is on file: a request may come back empty if its source does not keep that season.'));
  const open = new Map(LAST.open.filter(r => r.league_id === l.id).map(r => [r.season, r.state]));
  const filled = new Set(LAST.done.filter(r => r.league_id === l.id && r.state === 'done').map(r => r.season));
  const names = calendar === null ? BF().pastSeasons(undefined, false).concat(BF().pastSeasons(undefined, true)) : BF().pastSeasons(undefined, calendar);
  const wrap = el('div', 'bfw-seasons');
  names.forEach(n => {
    const k = cov && cov.seasons[n], C = (BF().COVER || {})[k];
    const state = open.get(n);
    const lab = el('label', 'bfw-s ' + (state ? 'busy' : !C ? '' : k === 'full' ? 'full' : C.fill ? 'part' : 'no'));
    const cb = el('input'); cb.type = 'checkbox'; cb.value = n; cb.disabled = !!state; cb.checked = !state && ticked.has(n);
    const notes = [];
    if (state) notes.push(state === 'running' ? 'being read now' : 'queued');
    else {
      if (C && C.tag) notes.push(C.tag);
      if (cov && !k) notes.push('not checked');
      if (filled.has(n)) notes.push('filled in lately');
      else if (known.has(n)) notes.push('on the platform');
    }
    lab.title = C ? C.says : '';
    lab.append(cb, el('span', null, n));
    if (notes.length) lab.appendChild(el('i', null, notes.join(' · ')));
    wrap.appendChild(lab);
  });
  box.appendChild(wrap);
  const go = btn('queue the ticked seasons', 'pri', async () => {
    const want = [...wrap.querySelectorAll('input:checked')].map(c => c.value);
    if (!want.length) return say('Tick a season or more first.', 'warn');
    go.disabled = true;
    await queue(l.id, want);
    go.disabled = false;
  });
  box.appendChild(go);
}

/* queue seasons of a league, one request each, then start the worker */
async function queue(league, seasons) {
  const ok = [], bad = [];
  for (const s of seasons) {
    const { error } = await sb.rpc('queue_season_backfill', { p_league: league, p_season: s });
    if (error) bad.push(s + ': ' + error.message); else ok.push(s);
  }
  if (ok.length) {
    const k = JB() && JB().kick ? await JB().kick(sb) : { started: false };
    say(nameOf(league) + ': ' + ok.join(', ') + ' queued' + (k.started || k.why === 'already started' ? ', and the worker has been started.' : '. The worker starts within a few minutes.') +
      (bad.length ? ' Not queued: ' + bad.join('; ') : ''), bad.length ? 'warn' : 'ok');
  } else if (bad.length) say(nameOf(league) + ': ' + bad.join('; '), 'err');
  restart();
}

async function kick() {
  const k = JB() && JB().kick ? await JB().kick(sb) : { started: false, why: 'no job bar' };
  say(k.started ? 'The worker has been started: it begins within a couple of minutes.'
    : k.why === 'already started' ? 'The worker was started a moment ago: it begins within a couple of minutes.'
    : 'The worker could not be started from here (' + (k.why || 'no answer') + '): the live lane starts it within a few minutes.', k.started || k.why === 'already started' ? 'ok' : 'warn');
  restart();
}

window.EpinoiaBackfillWorker = { open, details, span, withCount };
})();
