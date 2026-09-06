/* ============================================================================
   feed-ui.js — "Connect a league feed" card on the admin console.

   A league administrator pastes the schedule page of the league site (the one
   with ?WHurl=… in it) or the Genius hosted schedule URL, gives the feed's
   short code (SLB, EABL …), and presses Connect. register_feed_source()
   (migration 0097) writes the schedule_sources row the ingest worker polls
   every 30 minutes and the feed_competitions row the analytics app lists.
   From then on the worker creates the clubs, players, rosters and fixtures
   it sees in the feed, turns each finished game into a scored Epinoia game
   (roster snapshot, event log, finalise) and keeps live games moving.

   Same contract as every other panel: mount({host, sb, league, say}); the
   database authorises, this only renders.
   ============================================================================ */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = iso => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

  function guessCode(url, leagueName) {
    const m = String(url || '').match(/geniussports\.com\/(?:embednf\/)?([A-Za-z0-9_]+)\/[a-z]{2}\//);
    if (m) return m[1].toUpperCase();
    return String(leagueName || '').split(/\s+/).map(w => w[0] || '').join('').toUpperCase().slice(0, 6);
  }

  async function mount(o) {
    const host = typeof o.host === 'string' ? $(o.host) : o.host;
    const sb = o.sb, say = o.say || (() => {});
    const league = () => (typeof o.league === 'function' ? o.league() : o.league);
    if (!host) return;
    host.textContent = '';

    const form = el('div');
    form.innerHTML =
      '<div class="row"><input class="ep-input grow" type="url" id="feedUrl" placeholder="Schedule URL — https://www.yourleague.co.uk/competitions/?WHurl=%2Fschedule… or https://hosted.wh.geniussports.com/CODE/en/schedule…"></div>' +
      '<div class="row">' +
        '<input class="ep-input" type="text" id="feedCode" placeholder="CODE (e.g. SLB)" maxlength="12" style="flex:0 0 150px">' +
        '<input class="ep-input grow" type="text" id="feedLabel" placeholder="Label shown in the analytics app">' +
        '<input class="ep-input" type="number" id="feedPoll" value="30" min="5" max="1440" title="poll every N minutes" style="flex:0 0 90px">' +
        '<button type="button" class="ep-btn" id="feedConnect">connect feed</button>' +
      '</div>' +
      '<div class="empty" style="padding:6px 0 10px">Paste the league site\'s schedule page (the URL with ?WHurl=…) or the Genius hosted schedule. Clubs, rosters, fixtures and every finished game then fill in from the worker (every 30 min, 12:00–23:30 UTC).</div>';
    host.appendChild(form);
    const list = el('div', 'list'); host.appendChild(list);

    /* NEW LEAGUE, from nothing but a name and its schedule URLs. One press creates the league,
       the current season, a competition, makes you its administrator and registers the feed;
       the worker does the rest. Platform admins only (the same rule as create_league). */
    const isPlat = () => (typeof o.isPlatformAdmin === 'function' ? o.isPlatformAdmin() : !!o.isPlatformAdmin);
    if (isPlat()) {
      const nl = el('div'); nl.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid color-mix(in oklch,var(--ink-3) 30%,transparent)';
      nl.innerHTML =
        '<div class="note" style="margin:0 0 8px">NEW LEAGUE FROM A SCHEDULE — name it, paste its schedule URL(s), press create. Clubs, players, rosters, fixtures and every finished game arrive from the worker.</div>' +
        '<div class="row">' +
          '<input class="ep-input grow" type="text" id="nlName" placeholder="League name — e.g. British Championship Basketball">' +
          '<input class="ep-input" type="text" id="nlCode" placeholder="CODE (BCB)" maxlength="12" style="flex:0 0 130px">' +
          '<input class="ep-input" type="text" id="nlClient" placeholder="Genius code if different (HBBC)" maxlength="12" style="flex:0 0 220px">' +
        '</div>' +
        '<div class="row"><textarea class="ep-input grow" id="nlUrls" rows="2" placeholder="Schedule URL(s), one per line — the league page with ?WHurl=… or https://hosted.wh.geniussports.com/CODE/en/schedule…" style="resize:vertical"></textarea>' +
          '<button type="button" class="ep-btn" id="nlGo" style="align-self:flex-start">create league</button></div>';
      host.appendChild(nl);
      nl.querySelector('#nlUrls').addEventListener('change', () => { const c = nl.querySelector('#nlCode'); if (!c.value) c.value = guessCode(nl.querySelector('#nlUrls').value.split(/\s+/)[0], nl.querySelector('#nlName').value); });
      nl.querySelector('#nlGo').addEventListener('click', async () => {
        const name = nl.querySelector('#nlName').value.trim(), code = nl.querySelector('#nlCode').value.trim().toUpperCase();
        const client = nl.querySelector('#nlClient').value.trim().toUpperCase() || null;
        const urls = nl.querySelector('#nlUrls').value.split(/\s+/).map(x => x.trim()).filter(x => /^https?:\/\//.test(x));
        if (!name) return say('Give the league a name.', 'bad');
        if (!code) return say('Give the feed a short code (e.g. BCB).', 'bad');
        if (!urls.length) return say('Paste at least one schedule URL.', 'bad');
        const { data, error } = await sb.rpc('create_league_from_feed', { p_name: name, p_code: code, p_urls: urls, p_client: client, p_adapter: 'fiba_livestats', p_poll: 30 });
        if (error) return say(error.message, 'bad');
        say('League created (' + data + '). Reloading…', 'ok');
        setTimeout(() => location.reload(), 900);
      });
    }

    const urlIn = form.querySelector('#feedUrl'), codeIn = form.querySelector('#feedCode'), labelIn = form.querySelector('#feedLabel'), pollIn = form.querySelector('#feedPoll');
    urlIn.addEventListener('change', () => { if (!codeIn.value) codeIn.value = guessCode(urlIn.value, league() && league().name); if (!labelIn.value && league()) labelIn.value = league().name; });

    async function refresh() {
      list.textContent = '';
      const lg = league(); if (!lg) return;
      const { data, error } = await sb.rpc('list_feed_sources', { p_league: lg.id });
      if (error) { list.appendChild(el('div', 'empty', 'Feeds are not available on this database yet (migration 0097).')); return; }
      if (!data || !data.length) { list.appendChild(el('div', 'empty', 'No feed connected. Paste the schedule URL above.')); return; }
      const tbl = el('table'); tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px';
      tbl.innerHTML = '<thead><tr><th>code</th><th>schedule</th><th>games</th><th>last poll</th><th>status</th><th></th></tr></thead>';
      const tb = el('tbody');
      data.forEach(s => {
        const tr = el('tr');
        const status = s.last_error ? 'error: ' + s.last_error : (s.last_run_status || (s.enabled ? 'waiting for first run' : 'paused'));
        tr.innerHTML = '<td><b>' + esc(s.code) + '</b><br><span class="note">' + esc(s.label) + '</span></td>' +
          '<td style="max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(s.schedule_url) + '">' + esc(s.schedule_url) + '</td>' +
          '<td>' + (s.games_final || 0) + ' final / ' + (s.games || 0) + '</td>' +
          '<td>' + ago(s.last_polled_at) + (s.last_ok_at ? '<br><span class="note">ok ' + ago(s.last_ok_at) + '</span>' : '') + '</td>' +
          '<td class="' + (s.last_error ? 'bad' : '') + '">' + esc(status) + '</td><td></td>';
        const cell = tr.lastElementChild;
        const b1 = el('button', 'ep-btn', s.enabled ? 'pause' : 'resume'); b1.type = 'button';
        b1.addEventListener('click', async () => { const { error: e } = await sb.rpc('set_feed_source', { p_source: s.id, p_enabled: !s.enabled }); if (e) return say(e.message, 'bad'); refresh(); });
        const b2 = el('button', 'ep-btn', 'poll next run'); b2.type = 'button'; b2.style.marginLeft = '6px';
        b2.addEventListener('click', async () => { const { error: e } = await sb.rpc('set_feed_source', { p_source: s.id, p_enabled: null, p_poll_now: true }); if (e) return say(e.message, 'bad'); say('Queued — the next worker run picks it up.', 'ok'); refresh(); });
        cell.appendChild(b1); cell.appendChild(b2);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb); list.appendChild(tbl);
    }

    form.querySelector('#feedConnect').addEventListener('click', async () => {
      const lg = league(); if (!lg) return say('Pick a league first.', 'bad');
      const url = urlIn.value.trim(), code = codeIn.value.trim().toUpperCase();
      if (!/^https?:\/\//.test(url)) return say('Paste the full schedule URL (starts with http).', 'bad');
      if (!code) return say('Give the feed a short code (e.g. SLB).', 'bad');
      const { error } = await sb.rpc('register_feed_source', { p_league: lg.id, p_url: url, p_code: code, p_label: labelIn.value.trim() || lg.name, p_adapter: 'fiba_livestats', p_poll: +pollIn.value || 30 });
      if (error) return say(error.message, 'bad');
      say('Feed connected. Clubs, rosters and games fill in from the next worker run.', 'ok');
      urlIn.value = ''; refresh();
    });

    refresh();
  }

  window.EpinoiaFeedUI = { mount };
})();
