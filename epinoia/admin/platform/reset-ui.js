'use strict';
/* ============================================================================
   START A LEAGUE AGAIN - the platform console's front door to scripts/ingest/reset_league.py (migration 0187).

   Pick a league, see what would go and what stays, type its slug to confirm, and the request is queued. The
   worker (.github/workflows/console-jobs.yml, every ten minutes) takes it, deletes the league's games and
   players in small paced batches - clubs, crests, colours, venues and competitions are kept - and reads the
   league again from its feed. Nothing happens in the browser.

   THE BAR IS THE DATABASE'S, NOT THE PAGE'S. The worker writes how far along it is to the request's row
   (league_resets.detail.pct, .phase, .done, .total, and a sentence in .step) every few seconds, so the bar is
   the same for every administrator, survives closing the tab, and picks up where it is when the page is opened
   again. The page polls while anything is queued or running, and stops when the tab is hidden.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaResetUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };

const LABEL = { queued: 'queued', running: 'running', done: 'done', failed: 'failed', cancelled: 'withdrawn' };
const PILL = { queued: 'pa', running: 'tm', done: 'la', failed: 'off', cancelled: '' };

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return Math.round(s) + ' s ago';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  return Math.round(s / 3600) + ' h ago';
}

function row(r, o, redraw) {
  const card = el('div', 'rs-job rs-' + r.state);
  const head = card.appendChild(el('div', 'rs-head'));
  head.appendChild(data('strong', 'rs-lg', (r.leagues && r.leagues.name) || r.league_id));
  head.appendChild(el('span', 'pill ' + (PILL[r.state] || ''), LABEL[r.state] || r.state));
  head.appendChild(el('span', 'rs-when', r.state === 'queued' ? 'asked ' + ago(r.requested_at) + ' - waiting for the worker (checks every 10 min)'
    : r.finished_at ? 'finished ' + ago(r.finished_at) : 'started ' + ago(r.claimed_at)));

  /* the shared bar (../jobbar.js), the same one the league console's backfills draw */
  if (window.EpinoiaJobBar) card.appendChild(window.EpinoiaJobBar.draw(r, { done: 'Finished.' }));
  const c = r.detail && r.detail.counts;
  if (c && r.state === 'done') {
    card.appendChild(el('div', 'rs-counts',
      `Deleted ${c.games} games, ${c.players} players and ${c.roster_entries} roster entries; kept ${c.clubs} clubs, ` +
      `${c.competitions} competitions and ${c.players_kept} players who also play elsewhere. The league has been read again.`));
  }
  if (r.error) card.appendChild(el('div', 'rs-err', r.error));
  if (r.state === 'queued') {
    const x = card.appendChild(el('button', 'ep-btn mini', 'withdraw'));
    x.type = 'button';
    x.addEventListener('click', async () => {
      const { error } = await o.sb.rpc('cancel_league_reset', { p_id: r.id });
      if (error) return o.oops(error);
      o.say('Withdrawn.');
      redraw();
    });
  }
  return card;
}

let stopPoll = null;

async function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  const { sb, say, oops } = o;
  if (stopPoll) stopPoll();
  host.textContent = '';

  const lead = host.appendChild(el('p', 'lead'));
  lead.textContent = 'Deletes every game and player in one league and reads it again from its feed - for a league whose ' +
    'players have been filed wrongly. Kept: the league, its seasons and competitions, the clubs with their crests, ' +
    'colours and home arenas, and every venue with its map pin. Players who also play in another league are kept. ' +
    'It runs on the server, politely, and can take an hour for a big league; this page shows how far it has got ' +
    'whenever you open it.';

  const form = host.appendChild(el('div', 'row rs-form'));
  const pick = form.appendChild(el('select', 'ep-input rs-pick'));
  pick.appendChild(el('option', '', 'choose a league…')).value = '';
  const prev = host.appendChild(el('div', 'rs-prev'));
  const conf = host.appendChild(el('div', 'row rs-conf hide'));
  const typed = conf.appendChild(el('input', 'ep-input'));
  typed.placeholder = 'type the league’s slug to confirm';
  typed.setAttribute('autocomplete', 'off'); typed.setAttribute('spellcheck', 'false');
  const go = conf.appendChild(el('button', 'ep-btn pri', 'start this league again'));
  go.type = 'button'; go.disabled = true;
  const list = host.appendChild(el('div', 'rs-list'));

  const { data: leagues, error: lerr } = await sb.from('leagues').select('id,slug,name').order('name');
  if (lerr) return oops(lerr);
  const bySlug = {};
  (leagues || []).forEach(l => {
    bySlug[l.id] = l;
    const op = pick.appendChild(el('option', '', l.name + '  (' + l.slug + ')'));
    op.value = l.id;
  });

  pick.addEventListener('change', async () => {
    prev.textContent = ''; typed.value = ''; go.disabled = true;
    conf.classList.toggle('hide', !pick.value);
    if (!pick.value) return;
    prev.appendChild(el('div', 'empty', 'Counting…'));
    const { data: p, error } = await sb.rpc('league_reset_preview', { p_league: pick.value });
    prev.textContent = '';
    if (error) return oops(error);
    const g = prev.appendChild(el('div', 'rs-grid'));
    const kv = (k, v, cls) => { const b = g.appendChild(el('div', 'rs-kv ' + (cls || ''))); b.appendChild(el('b', '', String(v))); b.appendChild(el('span', '', k)); };
    kv('games go', p.games, 'go'); kv('players go', p.players, 'go'); kv('roster entries go', p.roster_entries, 'go');
    kv('clubs kept', p.clubs, 'keep'); kv('competitions kept', p.competitions, 'keep'); kv('venues kept', p.venues, 'keep');
    kv('players kept (also elsewhere)', p.players_kept, 'keep');
  });
  typed.addEventListener('input', () => {
    const l = bySlug[pick.value];
    go.disabled = !(l && typed.value.trim() === l.slug);
  });
  go.addEventListener('click', async () => {
    const l = bySlug[pick.value];
    if (!l || typed.value.trim() !== l.slug) return;
    go.disabled = true;
    const { error } = await sb.rpc('request_league_reset', { p_league: l.id });
    if (error) { go.disabled = false; return oops(error); }
    say(l.name + ' is queued. The worker takes it within ten minutes; the bar below follows it.');
    pick.value = ''; typed.value = ''; prev.textContent = ''; conf.classList.add('hide');
    restart();
  });

  let busy = false;
  async function draw() {
    if (!host.isConnected) { busy = false; return; }
    const { data: rows, error } = await sb.from('league_resets')
      .select('id,league_id,state,step,detail,error,requested_at,claimed_at,finished_at,leagues(name,slug)')
      .order('requested_at', { ascending: false }).limit(12);
    if (error) {
      busy = false;
      list.textContent = '';
      if (error.code === '42P01' || /league_resets|schema cache/i.test(error.message || '')) {
        list.appendChild(el('div', 'empty', 'Not on the server yet: migration 0187 needs pushing.'));
        return;
      }
      return oops(error);
    }
    list.textContent = '';
    if (!rows || !rows.length) list.appendChild(el('div', 'empty', 'No league has been started again yet.'));
    (rows || []).forEach(r => list.appendChild(row(r, o, restart)));
    busy = (rows || []).some(r => r.state === 'queued' || r.state === 'running');
  }
  /* polled every 5 s while a reset is queued or running, paused while the tab is hidden (../jobbar.js) */
  function restart() {
    if (stopPoll) stopPoll();
    stopPoll = window.EpinoiaJobBar ? window.EpinoiaJobBar.poll(draw, () => busy) : (draw(), null);
  }
  restart();
}

return { mount };
}));
