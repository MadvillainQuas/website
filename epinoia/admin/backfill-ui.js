'use strict';
/* ============================================================================
   FILL IN AN OLDER SEASON — the ask, not the import.

   A league arrives on Epinoia in the middle of a season and the site shows one
   season, because that is the one the ingest worker was pointed at. Everything
   needed for the seasons before it is already configured: the source, the
   adapter, the clubs, the matching. Every adapter takes the season it should
   read out of adapter_config["season"] — acb's ?temporada=, B.LEAGUE's ?year=,
   EuroLeague's E<year>, the Czech and Slovak sites' own season lists — so
   filling in 2024-25 is the ordinary pass run with one string changed.

   WHAT NOBODY HAD WAS A WAY TO ASK. This panel is that: it writes a row to
   season_backfills (0135) and says so. THE BUTTON IS NOT AN IMPORT AND MUST
   NOT LOOK LIKE ONE — nothing happens in the browser, nothing happens on the
   press, and a whole season is a few hundred games the worker fetches
   politely, one at a time, over an hour or more. A panel that said "importing
   2024-25…" and then sat there would have somebody pressing it again, and
   again, and mailing about it. So the wording is a request throughout, and
   what the panel shows afterwards is the STATE OF THE REQUEST.

   THE SEASON BEING PLAYED IS NOT OFFERED. It is read every half hour by the
   lane that also carries live games; asking for it here would be a slower,
   blinder copy of something already running. The database refuses it too
   (0135's guard trigger) — this list simply never puts it in front of anybody.

   SEASONS THAT HAVE NO ROW YET ARE STILL OFFERED. The backfill is what CREATES
   the season, its competitions and its tables; restricting the list to seasons
   the platform already knows about would mean only a league that already had
   last season could ask for last season.

   WHAT IT MAY NOT DO. Nothing on this panel decides permission: 0135's RLS
   answers is_league_admin for reading, queueing and cancelling, and the RPC
   authorises its own caller. This file decides what to draw.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaBackfill = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const when = iso => { if (!iso) return ''; try {
  return new Date(iso).toLocaleString('en-GB',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
} catch (_) { return ''; } };

/* HOW MANY SEASONS BACK TO OFFER. Long enough to cover a league's archive as
   its source actually publishes it — Genius clients keep about eight, the
   Czech and Slovak sites rather more — and short enough that the list is a
   list. A season the source does not hold comes back "publishes no 2016-17
   competition", which is an honest answer, not a failure. */
const BACK = 8;

/* The season being played, named the way a person writes one. This is
   scripts/ingest/feedplatform.py season_name_for and public.current_season_name
   (0135), for the third time and for the same reason: a season opens in
   August, and the three places that need to know must not disagree. */
function liveSeason(now) {
  const d = now || new Date();
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return m >= 8 ? y + '-' + String(y + 1).slice(2) : (y - 1) + '-' + String(y).slice(2);
}

function pastSeasons(now, calendar) {
  const out = [];
  /* A CALENDAR-YEAR LEAGUE (CIBACOPA, Liga Ouro, NBL1) names a season by its year ("2026"); the year being
     played is the ordinary pass's, so the list starts at last year. 0187's guard accepts this form. */
  if (calendar) {
    const y = (now || new Date()).getUTCFullYear();
    for (let i = 1; i <= BACK; i++) out.push(String(y - i));
    return out;
  }
  const start = parseInt(liveSeason(now).slice(0, 4), 10);
  for (let i = 1; i <= BACK; i++) out.push((start - i) + '-' + String(start - i + 1).slice(2));
  return out;
}

/* a league whose seasons are all named as a single year runs on the calendar year; null when it has no season
   on the platform yet (NBL1 before its first, CEBL before its import) and so cannot say which it is */
function isCalendar(seasons) {
  const names = (seasons || []).map(s => String(s.name || s));
  if (!names.length) return null;
  return names.every(n => /^\d{4}$/.test(n));
}

/* What each state means to the person who pressed the button — never the word
   in the column, which says nothing about whether to wait or to worry. */
const STATE = {
  queued:  'waiting for the worker',
  running: 'being read now',
  done:    'filled in',
  failed:  'could not be filled in'
};

let current = null;          // the mounted panel, so admin.js can ask for a redraw

function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  current = { host: host, opts: opts, stop: null };
  draw(current);
  return current;
}

/* admin.js calls this after a league switch: the panel is mounted once and the
   chips change the league underneath it. */
function refresh() { if (current) draw(current); }

/* admin.js calls this THE INSTANT a league click reassigns `league`, before it awaits anything.
   Redrawing the panel only happens later, inside loadLeague()'s async season fetch — and until
   0187's fix this left the "ask for this season" button wired to the PREVIOUS league for that
   whole await: a click landing in the gap queued a season against the wrong league, silently.
   Blanking the panel here removes the button itself, so there is no instant at which it can be
   pressed for a league it no longer reflects. */
function clear() {
  if (!current) return;
  if (current.stop) { current.stop(); current.stop = null; }
  current.host.textContent = '';
  current.host.appendChild(el('div', 'empty', 'Switching league\u2026'));
}

function draw(panel) {
  const opts = panel.opts;
  const host = panel.host;
  const league = typeof opts.league === 'function' ? opts.league() : opts.league;
  if (panel.stop) { panel.stop(); panel.stop = null; }
  host.textContent = '';
  if (!league) return;

  /* THE LEAGUE IS PINNED HERE, not read again when the button is pressed. The
     chips change the league at once while this panel is redrawn an await or
     two later, and a request queued in that gap would file league A's season
     against league B — the one mistake on this panel that cannot be undone by
     pressing cancel, because by then a worker may have taken it. */
  const lid = league.id;

  host.appendChild(el('div', 'fmt-h', 'Fill in an older season'));
  host.appendChild(el('div', 'empty',
    'Ask for a season before this one to be read in from the same source this ' +
    'league already uses — the games, box scores, tables and player records ' +
    'as they were. THIS IS A REQUEST, NOT AN IMPORT: the button writes it down and starts the worker, ' +
    'which takes it within minutes, with a bar here showing each step it is on. A full season is a few ' +
    'hundred games fetched one at a time, so give it an hour or two before ' +
    'worrying, and do not ask twice — the request stays on this list until it ' +
    'is finished.'));

  const seasonRows = (typeof opts.seasons === 'function' ? opts.seasons() : opts.seasons) || [];
  const known = new Set(seasonRows.map(s => s.name));
  const calendar = isCalendar(seasonRows);
  const row = el('div', 'row');
  const pick = el('select', 'ep-input');
  pick.style.flex = '0 0 auto';
  const add = (into, name) => {
    const o = document.createElement('option');
    o.value = name;
    /* "already here" is not a reason not to ask — a season may hold six games
       of forty — but it changes what the answer will look like, so it is said. */
    o.textContent = name + (known.has(name) ? ' · already on the platform' : '');
    into.appendChild(o);
  };
  /* A LEAGUE WITH NO SEASON YET is offered both ways of naming one: the worker reads a season only in the form its
     source names seasons, and says so on the request if it was asked the other way. */
  if (calendar === null) {
    [['a season across two years', false], ['a calendar year (a league played inside one year)', true]].forEach(([label, cal]) => {
      const g = document.createElement('optgroup');
      g.label = label;
      pastSeasons(undefined, cal).forEach(name => add(g, name));
      pick.appendChild(g);
    });
  } else {
    pastSeasons(undefined, calendar).forEach(name => add(pick, name));
  }
  const go = el('button', 'ep-btn pri', 'ask for this season');
  go.type = 'button';
  row.append(pick, go);
  host.appendChild(row);
  host.appendChild(el('div', 'ep-micro',
    'The season being played (' + (calendar === null ? liveSeason() + ' or ' + new Date().getUTCFullYear()
      : calendar ? String(new Date().getUTCFullYear()) : liveSeason()) +
    ') is not on this list: it is already read by the live feed.'));

  const list = el('div', 'list');
  host.appendChild(list);

  go.addEventListener('click', async () => {
    const name = pick.value;
    go.disabled = true;
    const { error } = await opts.sb.rpc('queue_season_backfill',
      { p_league: lid, p_season: name });
    go.disabled = false;
    /* the league's name goes on the front of a refusal: "already queued" on its own does not say
       for whom, and this panel can be looking at a different league by the time the answer comes back */
    if (error) return opts.say(league.name + ': ' + error.message, 'err');
    opts.say(name + ' is queued; starting the worker\u2026', 'ok');
    restart();
    /* THE WORKER IS STARTED NOW, not at GitHub's next cron slot (0217): the console-kick function where it is set up,
       and the live lane within a few minutes where it is not */
    const k = window.EpinoiaJobBar && window.EpinoiaJobBar.kick ? await window.EpinoiaJobBar.kick(opts.sb) : { started: false };
    opts.say(k.started || k.why === 'already started'
      ? name + ' is queued and the worker has been started: it usually begins within a couple of minutes, and the bar below follows it.'
      : name + ' is queued. The worker will be started within a few minutes (at most about an hour); the bar below follows it.', 'ok');
    restart();
  });

  /* WITH THE WORKER'S OWN PROGRESS (0187): step and detail.pct, drawn by jobbar.js - the same bar as a league
     reset. A database without 0187 has neither column; the list is then read without them, and a request shows
     its words alone, as before. */
  let busy = false, cols = 'id,season,state,step,detail,requested_at,dispatched_at,claimed_at,finished_at,sources_run,games_seen,games_written,error';
  const ahead = new Map();          // a queued request's place in the queue (0217 season_backfill_queue)
  async function load() {
    let { data, error } = await opts.sb.from('season_backfills').select(cols)
      .eq('league_id', lid).order('requested_at', { ascending: false }).limit(12);
    if (error && /dispatched_at/.test(error.message || '')) {          // before 0217
      cols = cols.replace(',dispatched_at', '');
      ({ data, error } = await opts.sb.from('season_backfills').select(cols)
        .eq('league_id', lid).order('requested_at', { ascending: false }).limit(12));
    }
    if (error && /step|detail/.test(error.message || '')) {
      cols = 'id,season,state,requested_at,claimed_at,finished_at,sources_run,games_seen,games_written,error';
      ({ data, error } = await opts.sb.from('season_backfills').select(cols)
        .eq('league_id', lid).order('requested_at', { ascending: false }).limit(12));
    }
    /* how many requests the worker takes before each queued one: the queue runs oldest first across every league */
    await Promise.all((data || []).filter(r => r.state === 'queued').map(async r => {
      try {
        const { data: q } = await opts.sb.rpc('season_backfill_queue', { p_id: r.id });
        if (q && typeof q.ahead === 'number') ahead.set(r.id, q.ahead);
      } catch (_) { /* before 0217: no place said */ }
    }));
    list.textContent = '';
    if (error) { busy = false; list.appendChild(el('div', 'empty', error.message)); return; }
    const rows = data || [];
    if (!rows.length) {
      list.appendChild(el('div', 'empty', 'Nothing has been asked for yet.'));
    }
    rows.forEach(r => list.appendChild(card(r)));

    /* A LIVE REQUEST IS THE ONLY REASON TO KEEP POLLING. Polling a finished list for ever would have every open
       console asking a question with the same answer until the tab is closed. */
    busy = rows.some(r => r.state === 'queued' || r.state === 'running');
  }
  function restart() {
    if (panel.stop) panel.stop();
    panel.stop = window.EpinoiaJobBar ? window.EpinoiaJobBar.poll(load, () => busy) : (load(), null);
  }

  function card(r) {
    const item = el('div', 'item');
    const left = el('div');
    left.appendChild(el('div', 'nm', r.season));
    const bits = [STATE[r.state] || r.state];
    if (r.state === 'done' || r.state === 'failed') {
      bits.push(r.games_written + ' of ' + r.games_seen + ' game' +
                (r.games_seen === 1 ? '' : 's') + ' written');
      if (r.finished_at) bits.push(when(r.finished_at));
    } else if (r.state === 'running') {
      bits.push('since ' + when(r.claimed_at));
    } else {
      bits.push('asked ' + when(r.requested_at));
      if (r.dispatched_at) bits.push('worker started ' + when(r.dispatched_at));
    }
    left.appendChild(el('div', 'mt', bits.join(' · ')));
    /* THE REASON, IN FULL. "failed" with nothing after it is the report nobody
       can act on: the message names the source that has no such season, or the
       adapter that cannot read one. */
    if (r.error) left.appendChild(el('div', 'mt', r.error));
    if (window.EpinoiaJobBar && r.state !== 'done') {
      left.appendChild(window.EpinoiaJobBar.draw(r, { ahead: ahead.get(r.id) || 0, failed: 'Stopped - the reason is above.' }));
    }
    item.appendChild(left);

    const sp = el('div', 'sp');
    if (r.state === 'queued') {
      /* Only a queued request may be taken back — 0135's delete policy says the
         same, because a running row is the worker's lease and removing it would
         let a second worker start the same season. */
      const x = el('button', 'ep-btn mini', 'cancel');
      x.type = 'button';
      x.addEventListener('click', async () => {
        x.disabled = true;
        const { error } = await opts.sb.from('season_backfills').delete().eq('id', r.id);
        if (error) { x.disabled = false; return opts.say(error.message, 'err'); }
        opts.say('Request withdrawn.', 'ok');
        restart();
      });
      sp.appendChild(x);
    }
    item.appendChild(sp);
    return item;
  }

  restart();
}

return { mount: mount, refresh: refresh, clear: clear, liveSeason: liveSeason, pastSeasons: pastSeasons, isCalendar: isCalendar };
}));
