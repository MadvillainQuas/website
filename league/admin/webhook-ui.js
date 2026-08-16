'use strict';
/* ============================================================================
   WHERE RESULTS GET ANNOUNCED.

   Most clubs already have a Discord. Posting the final score there the moment
   a game is final is the cheapest reach this platform can buy, and it needs no
   infrastructure beyond a URL.

   That URL is a SECRET — anyone holding a Discord webhook can post to that
   channel as the app — so the design here is write-only. The value is stored
   on a table with no RLS policy at all, meaning nobody can read it back: not
   the anon key, not the admin who typed it, not this page. What can be read is
   whether one is configured and how the last delivery went, which is all
   anyone needs to manage it.

   So the field is never populated with the existing value, and that is stated
   rather than left to look like a bug.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideWebhook = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const when = iso => { if (!iso) return 'never';
  try { return new Date(iso).toLocaleString('en-GB',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return ''; } };

/* opts: { host, sb, league, say } */
function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  host.textContent = '';
  if (!opts.league) {
    host.appendChild(el('div', 'empty', 'Pick a league first.'));
    return;
  }

  host.appendChild(el('div', 'empty',
    'When a game is finalised, the result is posted to this channel with the ' +
    'leading scorers and a link to the box score. Create a webhook in Discord ' +
    'under Server Settings → Integrations → Webhooks, and paste its URL here.'));

  const status = el('div', 'wh-status');
  host.appendChild(status);

  const row = el('div', 'row');
  const url = el('input', 'cs-input grow');
  url.type = 'url';
  url.placeholder = 'https://discord.com/api/webhooks/…';
  url.autocomplete = 'off';
  const kind = el('select', 'cs-input');
  kind.style.flex = '0 0 auto';
  [['discord', 'Discord'], ['slack', 'Slack']].forEach(([v, l]) => {
    const o = el('option', null, l); o.value = v; kind.appendChild(o);
  });
  const save = el('button', 'cs-btn pri', 'save');
  save.type = 'button';
  row.append(url, kind, save);
  host.appendChild(row);

  host.appendChild(el('div', 'empty',
    'The URL is stored where nothing can read it back — not this page, and not ' +
    'anyone with the site’s public key. That is why the box is always empty: ' +
    'saving replaces whatever is there, and leaving it blank removes it entirely.'));

  save.addEventListener('click', async () => {
    const v = url.value.trim();
    if (!v && !confirm('Leave it blank to stop posting results for this league?')) return;
    save.disabled = true;
    const { error } = await opts.sb.rpc('set_league_webhook', {
      p_league: opts.league.id, p_url: v || null, p_kind: kind.value
    });
    save.disabled = false;
    if (error) return opts.say(error.message, 'err');
    url.value = '';
    opts.say(v ? 'Webhook saved — the next finalised game will be posted.'
               : 'Webhook removed.', 'ok');
    load();
  });

  async function load() {
    status.textContent = '';
    const { data, error } = await opts.sb.rpc('league_webhook_status',
      { p_league: opts.league.id });
    if (error) { status.appendChild(el('div', 'empty', error.message)); return; }
    const s = Array.isArray(data) ? data[0] : data;
    if (!s || !s.configured) {
      status.appendChild(el('span', 'wh-pill off', 'not configured'));
      return;
    }
    status.appendChild(el('span', 'wh-pill on', (s.kind || 'discord') + ' · active'));

    /* The last delivery is the only way to tell a working webhook from one
       that was revoked in Discord six weeks ago, since we cannot test one
       without posting to somebody's channel. */
    const bits = ['last sent ' + when(s.last_sent_at)];
    if (s.last_status) bits.push('HTTP ' + s.last_status);
    status.appendChild(el('span', 'wh-note', bits.join(' · ')));
    if (s.last_error) {
      status.appendChild(el('div', 'wh-err', 'last delivery failed: ' + s.last_error));
    }
  }

  load();
}

return { mount };
}));
