'use strict';
/* ============================================================================
   THE LEAGUE'S STREAM DESTINATION.

   Set once here, and every operator who primes a fixture for broadcast gets it
   pushed into their OBS without anybody retyping a key. The alternative is the
   one this replaces: a stream key emailed round a WhatsApp group and typed in
   by four different volunteers, three of whom will get it wrong once.

   THE KEY IS WRITE-ONLY FROM THIS PAGE. It is never fetched back — the listing
   comes from a function that returns the last four characters and nothing else,
   so the full key is not in the response, not in the network tab, and not in
   any error this page might ever report. Replacing it means typing a new one,
   which is also how every platform's own dashboard behaves and for the same
   reason.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStreamUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* The ingest each platform publishes. RTMPS where it is offered, because a
   stream key travelling in clear over RTMP is a stream key on the hall's wifi. */
const PLATFORMS = {
  youtube:  { label: 'YouTube',  server: 'rtmps://a.rtmps.youtube.com:443/live2',
              help: 'YouTube Studio → Go live → Stream key' },
  twitch:   { label: 'Twitch',   server: 'rtmp://live.twitch.tv/app',
              help: 'Twitch dashboard → Settings → Stream → Primary stream key' },
  facebook: { label: 'Facebook', server: 'rtmps://live-api-s.facebook.com:443/rtmp',
              help: 'Facebook Live producer → Stream key' },
  custom:   { label: 'Somewhere else', server: '', help: 'Your own RTMP ingest URL' }
};

function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const { sb, say } = opts;
  let targets = [];

  async function load() {
    const league = opts.league && opts.league();
    if (!league) { host.innerHTML = ''; return; }
    const { data, error } = await sb.rpc('stream_targets_for_league', { p_league: league.id });
    if (error) {
      /* Before 0081 is applied this function does not exist, and a red error on
         a panel nobody has set up yet is noise. */
      host.innerHTML = '';
      host.appendChild(el('p', 'ep-micro',
        'Streaming destinations need migration 0081.'));
      return;
    }
    targets = data || [];
    render();
  }

  function render() {
    const league = opts.league && opts.league();
    host.innerHTML = '';

    const note = el('p', 'ep-micro');
    note.style.cssText = 'color:var(--ink-3);line-height:1.9;margin:0 0 12px';
    note.innerHTML = 'Where this league&rsquo;s streams go. Set it once and anybody ' +
      'who primes a fixture for broadcast can send it straight to OBS &mdash; ' +
      'no key retyped in a sports hall.<br><br>' +
      '<b>The key is stored, and never shown again.</b> Only this league&rsquo;s ' +
      'administrators can read it, and this page only ever sees the last four ' +
      'characters. To change it, type a new one.';
    host.appendChild(note);

    if (targets.length) {
      const list = el('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:14px';
      targets.forEach(t => {
        const row = el('div', 'glass');
        row.style.cssText = 'padding:10px 12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
        if (!t.active) row.style.opacity = '.5';

        const left = el('div');
        left.style.cssText = 'flex:1 1 220px;min-width:0';
        left.appendChild(el('div', null, t.label));
        const sub = el('div', 'ep-micro');
        sub.style.cssText = 'color:var(--ink-3);margin-top:3px;word-break:break-all';
        sub.textContent = (PLATFORMS[t.platform] || {}).label || t.platform;
        sub.textContent += ' · key ' + t.key_tail;
        left.appendChild(sub);
        row.appendChild(left);

        const del = el('button', 'ep-btn ghost', 'remove');
        del.onclick = async () => {
          if (!confirm('Remove "' + t.label + '"?\n\nThe key is deleted and cannot ' +
                       'be recovered — you would have to fetch a new one from the ' +
                       'platform.')) return;
          del.disabled = true;
          const { error } = await sb.from('league_stream_targets').delete().eq('id', t.id);
          if (error) { say && say(error.message, true); del.disabled = false; return; }
          say && say('Removed.');
          load();
        };
        row.appendChild(del);
        list.appendChild(row);
      });
      host.appendChild(list);
    }

    /* ---- add or replace ---- */
    const form = el('div', 'glass');
    form.style.cssText = 'padding:13px;display:flex;flex-direction:column;gap:10px';

    const r1 = el('div');
    r1.style.cssText = 'display:flex;gap:9px;flex-wrap:wrap;align-items:center';
    const plat = el('select', 'ep-in');
    Object.entries(PLATFORMS).forEach(([k, v]) => {
      const o = el('option', null, v.label); o.value = k; plat.appendChild(o);
    });
    const label = el('input', 'ep-in');
    label.placeholder = 'Main channel'; label.style.cssText = 'flex:1 1 170px';
    r1.append(plat, label);
    form.appendChild(r1);

    const server = el('input', 'ep-in');
    server.placeholder = 'ingest URL';
    server.value = PLATFORMS.youtube.server;
    form.appendChild(server);

    const key = el('input', 'ep-in');
    key.type = 'password';
    key.placeholder = 'stream key';
    key.autocomplete = 'off';
    form.appendChild(key);

    const help = el('div', 'ep-micro');
    help.style.cssText = 'color:var(--ink-3);line-height:1.8';
    const setHelp = () => {
      const p = PLATFORMS[plat.value];
      help.textContent = 'Find it in: ' + p.help;
      if (p.server) server.value = p.server;
      server.readOnly = plat.value !== 'custom';
      server.style.opacity = plat.value === 'custom' ? '1' : '.6';
    };
    plat.onchange = setHelp; setHelp();
    form.appendChild(help);

    const save = el('button', 'ep-btn', 'Save destination');
    save.style.alignSelf = 'flex-start';
    save.onclick = async () => {
      const k = key.value.trim();
      if (!k) { say && say('The stream key is the part that is missing.', true); return; }
      if (!server.value.trim()) { say && say('An ingest URL is needed.', true); return; }
      /* A key pasted with the surrounding quotes, or with the whole "rtmp://…"
         URL in it, is the commonest paste mistake and produces a stream that
         fails to start with no clue why. */
      if (/^rtmps?:\/\//i.test(k)) {
        say && say('That looks like the ingest URL rather than the key — the key ' +
                   'is the shorter string underneath it.', true); return;
      }
      save.disabled = true;
      const { error } = await sb.from('league_stream_targets').insert({
        league_id: league.id,
        label: label.value.trim() || 'Main channel',
        platform: plat.value,
        server: server.value.trim(),
        stream_key: k
      });
      save.disabled = false;
      if (error) { say && say(error.message, true); return; }
      key.value = ''; label.value = '';
      say && say('Saved. Anybody priming a fixture can now send it to OBS.');
      load();
    };
    form.appendChild(save);
    host.appendChild(form);
  }

  load();
  return { reload: load };
}

return { mount, PLATFORMS };
}));
