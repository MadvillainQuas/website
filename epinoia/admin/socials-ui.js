'use strict';
/* ============================================================================
   SOCIALS — the league's Instagram and the four posts it spotlights.

   Two ways to fill the four slots, and the panel is honest about which one a
   league can actually use. Pinning four links works for any account. The
   automatic four newest needs Instagram's Graph API, which needs a business
   or creator account with a linked Facebook page and a long-lived token — so
   the automatic switch explains that rather than silently doing nothing when
   it is turned on without one.

   The token is write-only from here. The database returns whether one is set,
   never the value, so this panel cannot show it back and neither can anything
   that reads the page afterwards.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSocialsUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';

  host.appendChild(el('p', 'empty',
    'Appears under Merchandise on the league’s front page. Posts are embedded ' +
    'in sandboxed frames rather than through Instagram’s script, so nothing ' +
    'third-party runs on the page.'));

  const r1 = el('div', 'row');
  const handle = el('input', 'ep-input grow');
  handle.placeholder = 'instagram handle, or paste the page address';
  const showProfile = el('label', 'sw');
  const spBox = el('input'); spBox.type = 'checkbox'; spBox.checked = true;
  showProfile.append(spBox, document.createTextNode(' show the page link'));
  r1.append(handle, showProfile);
  host.appendChild(r1);

  host.appendChild(el('div', 'fmt-h', 'Spotlight four posts'));
  const pins = [];
  for (let i = 0; i < 4; i++) {
    const row = el('div', 'row');
    const inp = el('input', 'ep-input grow');
    inp.placeholder = 'https://www.instagram.com/p/… (or just the code)';
    row.append(el('span', 'ep-micro', String(i + 1)), inp);
    host.appendChild(row);
    pins.push(inp);
  }

  host.appendChild(el('div', 'fmt-h', 'Or take the four newest automatically'));
  const autoRow = el('div', 'row');
  const autoBox = el('input'); autoBox.type = 'checkbox';
  const autoLab = el('label', 'sw');
  autoLab.append(autoBox, document.createTextNode(' use the four most recent posts'));
  const token = el('input', 'ep-input grow');
  token.type = 'password';
  token.placeholder = 'long-lived access token (leave blank to keep the current one)';
  token.autocomplete = 'new-password';
  const igid = el('input', 'ep-input');
  igid.placeholder = 'IG user id';
  igid.style.flex = '0 0 170px';
  autoRow.append(autoLab);
  const tokRow = el('div', 'row');
  tokRow.append(token, igid);
  host.append(autoRow, tokRow);

  const why = el('p', 'empty',
    'The automatic option uses Instagram’s Graph API, which needs a business ' +
    'or creator account linked to a Facebook page, and a long-lived token from ' +
    'it. Without one, the four pinned above are used — and they stay the ' +
    'fallback if a token ever expires, so the section never goes blank.');
  host.appendChild(why);

  const bar = el('div', 'row');
  const save = el('button', 'ep-btn pri', 'save'); save.type = 'button';
  const clearTok = el('button', 'ep-btn mini', 'forget the token'); clearTok.type = 'button';
  const refresh = el('button', 'ep-btn', 'fetch the newest now'); refresh.type = 'button';
  const state = el('span', 'mt'); state.style.marginLeft = 'auto';
  bar.append(save, refresh, clearTok, state);
  host.appendChild(bar);

  async function load() {
    const res = await o.sb.rpc('league_socials_admin', { p_league: o.league.id });
    if (res.error) return o.say(res.error.message, 'err');
    const s = (res.data || [])[0];
    if (!s) { state.textContent = 'not set up'; return; }
    handle.value = s.instagram || '';
    spBox.checked = !!s.show_profile;
    autoBox.checked = !!s.auto;
    igid.value = s.ig_user_id || '';
    (s.pinned || []).forEach((c, i) => { if (pins[i]) pins[i].value = c; });
    token.placeholder = s.has_token
      ? 'a token is stored — type a new one to replace it'
      : 'long-lived access token';
    const bits = [];
    bits.push(s.has_token ? 'token stored' : 'no token');
    if (s.refreshed_at) bits.push('last fetched ' + new Date(s.refreshed_at).toLocaleString());
    if (s.refresh_error) bits.push('last fetch failed: ' + s.refresh_error);
    state.textContent = bits.join(' · ');
  }

  save.addEventListener('click', async () => {
    save.disabled = true;
    const res = await o.sb.rpc('set_league_socials', {
      p_league: o.league.id,
      p_instagram: handle.value || null,
      p_show_profile: spBox.checked,
      p_pinned: pins.map(p => p.value),
      p_auto: autoBox.checked,
      /* null keeps whatever is stored; only send a value when one was typed,
         so pressing save with the box empty does not wipe a working token */
      p_token: token.value ? token.value : null,
      p_ig_user_id: igid.value || null });
    save.disabled = false;
    if (res.error) return o.say(res.error.message, 'err');
    token.value = '';
    o.say('Socials saved.', 'ok');
    load();
  });

  clearTok.addEventListener('click', async () => {
    if (!confirm('Forget the stored access token? The four pinned posts are used instead.')) return;
    const res = await o.sb.rpc('set_league_socials',
      { p_league: o.league.id, p_token: '' });
    if (res.error) return o.say(res.error.message, 'err');
    o.say('Token forgotten.', 'ok');
    load();
  });

  refresh.addEventListener('click', async () => {
    refresh.disabled = true;
    try {
      const { data: { session } } = await o.sb.auth.getSession();
      const r = await fetch(o.cfg.supabaseUrl + '/functions/v1/socials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   apikey: o.cfg.supabaseAnonKey,
                   Authorization: 'Bearer ' + (session ? session.access_token : '') },
        body: JSON.stringify({ leagueId: o.league.id })
      });
      const j = await r.json().catch(() => ({}));
      refresh.disabled = false;
      if (!r.ok || j.error) return o.say(j.error || ('Refused (' + r.status + ').'), 'err');
      o.say(j.count
        ? j.count + ' post' + (j.count === 1 ? '' : 's') + ' fetched.'
        : 'Instagram returned nothing — the pinned four are still being used.',
        j.count ? 'ok' : 'warn');
      load();
    } catch (e) {
      refresh.disabled = false;
      o.say('Could not reach the server: ' + (e.message || e), 'err');
    }
  });

  load();
}

return { mount };
}));
