'use strict';
/* ============================================================================
   ONE PROGRESS BAR FOR THE CONSOLE'S LONG JOBS: "start a league again" (platform console, 0187) and "fill in
   an older season" (league console, 0135 + 0187). Both are queued rows a worker takes and works through for up
   to an hour; both now carry the step they are on (row.step) and how far along they are (row.detail.pct),
   written by the worker as it goes. So the bar is the database's, not the page's: every administrator sees the
   same one, and it is right again the moment the page is opened, however long it was closed.

     EpinoiaJobBar.draw(row, opts)   the bar and its line, for a row with state / step / detail / claimed_at /
                                     dispatched_at; opts.ahead: how many requests the worker takes before this one
     EpinoiaJobBar.waiting(row, opts) what a queued request is waiting for, in words
     EpinoiaJobBar.kick(sb)    start the worker now (the console-kick function); { started, at } or { started: false, why }
     EpinoiaJobBar.pct(row)    0-100: done is 100, queued is 0
     EpinoiaJobBar.eta(row)    "about 12 min left", once there is enough of the run to be honest about
     EpinoiaJobBar.poll(fn, busy)   run fn now and every 5 s while busy() says a job is live, paused while the
                                    tab is hidden; returns a stop function
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaJobBar = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

function pct(r) {
  if (!r) return 0;
  if (r.state === 'done') return 100;
  if (r.state === 'queued' || r.state === 'cancelled') return 0;
  const p = +(r.detail && r.detail.pct);
  return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
}

/* time left from the rate since the worker took the job; only past 5 % and two minutes, before which any
   figure is a guess */
function eta(r, now) {
  const p = pct(r);
  if (!r || r.state !== 'running' || !r.claimed_at || p < 5 || p >= 100) return '';
  const secs = ((now || Date.now()) - new Date(r.claimed_at).getTime()) / 1000;
  if (!(secs >= 120)) return '';
  const left = secs * (100 - p) / p;
  return left < 90 ? 'about a minute left' : left < 5400 ? 'about ' + Math.round(left / 60) + ' min left'
    : 'about ' + (left / 3600).toFixed(1) + ' h left';
}

/* WHAT A QUEUED REQUEST IS WAITING FOR, AS IT IS (0217). The worker used to be started by its own cron alone, and the
   bar said "it looks every 10 minutes" while GitHub left gaps of up to seven hours. It is now started as soon as
   something is queued (scripts/ingest/console_kick.py, the console-kick function), and the request says when. */
const hhmm = iso => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
function waiting(r, opts) {
  const o = opts || {};
  const n = +o.ahead || 0;
  const ahead = n > 0 ? ' · ' + (n === 1 ? '1 request' : n + ' requests') + ' ahead of it in the queue' : '';
  if (r && r.dispatched_at) return 'Starting: the worker was started at ' + hhmm(r.dispatched_at) + ' and usually begins within a couple of minutes' + ahead + '.';
  return 'Waiting for the worker to be started: usually within a few minutes, at most about an hour' + ahead + '.';
}

function draw(r, opts) {
  const o = opts || {};
  const box = el('div', 'jb jb-' + (r.state || 'queued'));
  const p = pct(r);
  const bar = box.appendChild(el('div', 'jb-bar'));
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(Math.round(p)));
  const fill = bar.appendChild(el('div', 'jb-fill'));
  fill.style.width = p + '%';
  bar.appendChild(el('span', 'jb-pct', Math.round(p) + '%'));
  const line = r.state === 'queued' ? (o.queued || waiting(r, o))
    : r.state === 'running' ? (r.step || 'Starting') + (eta(r) ? ' · ' + eta(r) : '')
    : r.state === 'done' ? (o.done || 'Finished.')
    : r.state === 'failed' ? (o.failed || 'Stopped.') : '';
  if (line) box.appendChild(el('div', 'jb-step', line));
  /* the worker's own log, line by line, for whoever wants to watch it (the run writes its address when it takes the job) */
  const log = r.detail && r.detail.run_url;
  if (log && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(String(log)) && r.state !== 'queued') {
    const a = box.appendChild(el('a', 'jb-log', 'the worker\u2019s log'));
    a.href = log; a.target = '_blank'; a.rel = 'noopener';
  }
  return box;
}

/* START THE WORKER NOW (the console-kick function, 0217): called by a console right after it queues a job. Answers
   { started, at } or { started: false, why }; a function that is not deployed or not set up answers started: false,
   and the live lane starts the worker within a few minutes all the same. Never throws. */
async function kick(sb) {
  try {
    if (!sb || !sb.functions || typeof sb.functions.invoke !== 'function') return { started: false, why: 'no client' };
    const { data, error } = await sb.functions.invoke('console-kick', { body: {} });
    if (error) return { started: false, why: String(error.message || error) };
    return data && typeof data === 'object' ? data : { started: false, why: 'no answer' };
  } catch (e) { return { started: false, why: String((e && e.message) || e) }; }
}

function poll(fn, busy) {
  let t = 0, stopped = false;
  const tick = async () => {
    if (stopped) return;
    if (typeof document !== 'undefined' && document.hidden) { t = setTimeout(tick, 5000); return; }
    try { await fn(); } catch (_) { /* the next tick tries again */ }
    if (!stopped && busy()) t = setTimeout(tick, 5000);
  };
  tick();
  return () => { stopped = true; clearTimeout(t); };
}

return { draw, pct, eta, poll, waiting, kick };
}));
