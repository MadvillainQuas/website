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

function pastSeasons(now) {
  const start = parseInt(liveSeason(now).slice(0, 4), 10);
  const out = [];
  for (let i = 1; i <= BACK; i++) out.push((start - i) + '-' + String(start - i + 1).slice(2));
  return out;
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
  current = { host: host, opts: opts, timer: null };
  draw(current);
  return current;
}

/* admin.js calls this after a league switch: the panel is mounted once and the
   chips change the league underneath it. */
function refresh() { if (current) draw(current); }

function draw(panel) {
  const opts = panel.opts;
  const host = panel.host;
  const league = typeof opts.league === 'function' ? opts.league() : opts.league;
  if (panel.timer) { clearInterval(panel.timer); panel.timer = null; }
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
    'as they were. THIS IS A REQUEST, NOT AN IMPORT: the button writes it down, ' +
    'and the ingest worker picks it up on its next run. A full season is a few ' +
    'hundred games fetched one at a time, so give it an hour or two before ' +
    'worrying, and do not ask twice — the request stays on this list until it ' +
    'is finished.'));

  const known = new Set(((typeof opts.seasons === 'function' ? opts.seasons() : opts.seasons) || [])
    .map(s => s.name));
  const row = el('div', 'row');
  const pick = el('select', 'ep-input');
  pick.style.flex = '0 0 auto';
  pastSeasons().forEach(name => {
    const o = document.createElement('option');
    o.value = name;
    /* "already here" is not a reason not to ask — a season may hold six games
       of forty — but it changes what the answer will look like, so it is said. */
    o.textContent = name + (known.has(name) ? ' · already on the platform' : '');
    pick.appendChild(o);
  });
  const go = el('button', 'ep-btn pri', 'ask for this season');
  go.type = 'button';
  row.append(pick, go);
  host.appendChild(row);
  host.appendChild(el('div', 'ep-micro',
    'The season being played (' + liveSeason() + ') is not on this list: it is already read every ' +
    'half hour by the live feed.'));

  const list = el('div', 'list');
  host.appendChild(list);

  go.addEventListener('click', async () => {
    const name = pick.value;
    go.disabled = true;
    const { error } = await opts.sb.rpc('queue_season_backfill',
      { p_league: lid, p_season: name });
    go.disabled = false;
    if (error) return opts.say(error.message, 'err');
    opts.say(name + ' is queued — the worker fills it in on its next run.', 'ok');
    load();
  });

  async function load() {
    const { data, error } = await opts.sb.from('season_backfills')
      .select('id,season,state,requested_at,claimed_at,finished_at,sources_run,games_seen,games_written,error')
      .eq('league_id', lid)
      .order('requested_at', { ascending: false })
      .limit(12);
    list.textContent = '';
    if (error) { list.appendChild(el('div', 'empty', error.message)); return; }
    const rows = data || [];
    if (!rows.length) {
      list.appendChild(el('div', 'empty', 'Nothing has been asked for yet.'));
    }
    rows.forEach(r => list.appendChild(card(r)));

    /* A LIVE REQUEST IS THE ONLY REASON TO KEEP A TIMER. Polling a finished
       list for ever would have every open console asking a question with the
       same answer until the tab is closed. */
    if (panel.timer) { clearInterval(panel.timer); panel.timer = null; }
    if (rows.some(r => r.state === 'queued' || r.state === 'running')) {
      panel.timer = setInterval(load, 20000);
    }
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
    }
    left.appendChild(el('div', 'mt', bits.join(' · ')));
    /* THE REASON, IN FULL. "failed" with nothing after it is the report nobody
       can act on: the message names the source that has no such season, or the
       adapter that cannot read one. */
    if (r.error) left.appendChild(el('div', 'mt', r.error));
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
        load();
      });
      sp.appendChild(x);
    }
    item.appendChild(sp);
    return item;
  }

  load();
}

return { mount: mount, refresh: refresh, liveSeason: liveSeason, pastSeasons: pastSeasons };
}));
