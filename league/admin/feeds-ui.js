'use strict';
/* ============================================================================
   SCRAPER KEYS — the automatic feed to RealGM, Eurobasket and anyone else who
   republishes results.

   An API key (the section above) is a pull: somebody has to come and ask. A
   feed is a push, and it exists because the sites that carry league results do
   not want to poll a fixture list at 2am on the off-chance. They want the game
   to arrive the moment it is final, in the shape their importer already reads,
   with something that proves it came from us.

   THE ONE THING THIS SCREEN MUST DO WELL IS PREVIEW. Configuring a feed
   blind — pick CSV, type a field map, hope — is how a league finds out three
   weeks later that every delivery has been rejected. So the exact bytes are
   one button away, before anybody depends on them, and the test send is a real
   recorded delivery rather than a special case that proves nothing about the
   real path.

   THE ENDPOINT AND THE SIGNING SECRET ARE WRITE-ONLY. `data_feeds` has no
   SELECT policy at all, so this page cannot read them back and neither can
   anybody else with a browser — it is told only the HOST, which is enough to
   recognise which partner a row belongs to. A URL that accepts our results is
   worth stealing; the same rule the Discord webhook follows applies here.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideFeeds = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const when = iso => { if (!iso) return 'never';
  try { return new Date(iso).toLocaleString('en-GB',
    { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch (_) { return ''; } };

/* What a feed can carry. `game` and `teams` are on by default because a result
   without them is not a result; play-by-play is off because it is two orders
   of magnitude larger than everything else put together and almost nobody
   wants it. */
const SECTIONS = [
  ['game',       'the fixture, date, venue and final score'],
  ['teams',      'both clubs and their team totals'],
  ['boxscore',   'every player line'],
  ['standings',  'the table as it stands after this game'],
  ['playbyplay', 'every event — large, and rarely wanted']
];

const NAME_STYLES = [
  ['first_last',       'Ada Shaw'],
  ['last_comma_first', 'Shaw, Ada'],
  ['last_first',       'Shaw Ada'],
  ['last_upper',       'Ada SHAW']
];
const DATE_STYLES = [
  ['iso',   '2026-03-04T19:30:00.000Z'],
  ['uk',    '04/03/2026'],
  ['us',    '03/04/2026'],
  ['epoch', '1772652600']
];

/* opts: { host, sb, league, cfg, say } */
function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  host.textContent = '';
  if (!opts.league) {
    host.appendChild(el('div', 'empty', 'Pick a league to manage its feeds.'));
    return;
  }

  host.appendChild(el('div', 'empty',
    'A feed posts every finalised game to a partner the moment it is published — ' +
    'RealGM, Eurobasket, a club’s own site. Nothing here grants access to ' +
    'anything that is not already on the website; it decides SHAPE and ' +
    'DESTINATION. Under-18 players are withheld from every feed whatever is ' +
    'configured, and the delivery says so rather than leaving the totals ' +
    'unexplained.'));

  /* ---- new feed ---- */
  const mk = el('div', 'row');
  const name = el('input', 'cs-input grow');
  name.placeholder = 'Who receives it? e.g. RealGM';
  name.maxLength = 60;
  const fmt = el('select', 'cs-input');
  fmt.style.flex = '0 0 auto';
  [['json', 'JSON'], ['csv', 'CSV'], ['xml', 'XML']].forEach(([v, l]) => {
    const o = el('option', null, l); o.value = v; fmt.appendChild(o);
  });
  const go = el('button', 'cs-btn pri', 'add feed');
  go.type = 'button';
  mk.append(name, fmt, go);
  host.appendChild(mk);

  const list = el('div', 'list');
  host.appendChild(list);

  go.addEventListener('click', async () => {
    const n = name.value.trim();
    if (!n) return opts.say('Name the feed after whoever receives it.', 'warn');
    go.disabled = true;
    const { error } = await opts.sb.rpc('create_data_feed', {
      p_league: opts.league.id, p_name: n, p_format: fmt.value
    });
    go.disabled = false;
    if (error) return opts.say(error.message, 'err');
    name.value = '';
    opts.say('Feed added — give it an endpoint and it starts delivering.', 'ok');
    load();
  });

  /* ---------------------------------------------------------------- a feed --- */
  function card(f) {
    const wrap = el('div', 'item feedcard');
    if (!f.enabled) wrap.style.opacity = '.55';

    const head = el('div', 'feedhead');
    const title = el('div');
    title.appendChild(el('div', 'nm', f.name));

    /* The state, said plainly. "configured" is not the question anybody has —
       the question is whether last night's game arrived. */
    const bits = [f.format.toUpperCase()];
    bits.push(f.has_endpoint ? '→ ' + (f.endpoint_host || 'set') : 'no endpoint yet');
    bits.push(f.has_secret ? 'signed' : 'UNSIGNED');
    if (!f.enabled) bits.push('PAUSED');
    title.appendChild(el('div', 'mt', bits.join(' · ')));

    const tally = [];
    if (f.sent_count)    tally.push(f.sent_count + ' delivered');
    if (f.failed_count)  tally.push(f.failed_count + ' failed');
    if (f.pending_count) tally.push(f.pending_count + ' waiting');
    tally.push('last attempt ' + when(f.last_sent_at) +
               (f.last_status ? ' (HTTP ' + f.last_status + ')' : ''));
    const st = el('div', 'mt', tally.join(' · '));
    if (f.failed_count) st.style.color = 'var(--flare)';
    title.appendChild(st);
    if (f.last_error) {
      const e = el('div', 'mt feederr', f.last_error);
      title.appendChild(e);
    }
    head.appendChild(title);

    const sp = el('div', 'sp');
    const editBtn = el('button', 'cs-btn mini', 'configure');
    editBtn.type = 'button';
    const prevBtn = el('button', 'cs-btn mini', 'preview');
    prevBtn.type = 'button';
    const testBtn = el('button', 'cs-btn mini', 'test send');
    testBtn.type = 'button';
    testBtn.disabled = !f.has_endpoint;
    if (!f.has_endpoint) testBtn.title = 'There is nowhere to send it yet.';
    const delBtn = el('button', 'cs-btn mini', 'remove');
    delBtn.type = 'button';
    sp.append(editBtn, prevBtn, testBtn, delBtn);
    head.appendChild(sp);
    wrap.appendChild(head);

    const body = el('div', 'feedbody');
    body.hidden = true;
    wrap.appendChild(body);
    const out = el('div', 'feedout');
    out.hidden = true;
    wrap.appendChild(out);

    editBtn.addEventListener('click', () => {
      body.hidden = !body.hidden;
      if (!body.hidden && !body.children.length) buildEditor(body, f);
    });

    prevBtn.addEventListener('click', () => callFn('preview', f, out, prevBtn));
    testBtn.addEventListener('click', () => {
      if (!confirm('Send the most recent finalised game to ' + f.name +
                   ' now? It is recorded as a real delivery.')) return;
      callFn('test', f, out, testBtn);
    });

    delBtn.addEventListener('click', async () => {
      if (!confirm('Remove the "' + f.name + '" feed? Deliveries stop immediately.')) return;
      const { error } = await opts.sb.rpc('delete_data_feed', { p_feed: f.id });
      if (error) return opts.say(error.message, 'err');
      opts.say('Feed removed.', 'ok');
      load();
    });

    return wrap;
  }

  /* ------------------------------------------------------------ the editor --- */
  function buildEditor(body, f) {
    /* --- endpoint and secret. Write-only: the boxes start EMPTY even when
           something is stored, because this page cannot read them back, and a
           box that looks blank but is not would be a lie about the state. --- */
    body.appendChild(el('div', 'flabel', 'Where it goes'));
    const r1 = el('div', 'row');
    const url = el('input', 'cs-input grow');
    url.type = 'url';
    url.placeholder = f.has_endpoint
      ? 'https://… (an endpoint is set — type a new one to replace it)'
      : 'https://partner.example/courtside/results';
    const secret = el('input', 'cs-input');
    secret.type = 'text';
    secret.placeholder = f.has_secret ? 'signing secret set — leave to keep' : 'signing secret';
    secret.style.flex = '0 0 200px';
    const saveUrl = el('button', 'cs-btn', 'save endpoint');
    saveUrl.type = 'button';
    r1.append(url, secret, saveUrl);
    body.appendChild(r1);
    body.appendChild(el('div', 'fhint',
      'Must be https on a real hostname — an IP address or an internal name is ' +
      'refused, because a feed that will fetch any address a person types is a ' +
      'way to reach things only our server can see. Every delivery carries ' +
      'X-Courtside-Signature: an HMAC-SHA256 of the exact body, keyed on the ' +
      'secret. A partner who checks it cannot be fed a forged result.'));

    saveUrl.addEventListener('click', async () => {
      const u = url.value.trim();
      if (!u && !secret.value.trim()) {
        return opts.say('Nothing to save — type an endpoint, or a secret.', 'warn');
      }
      saveUrl.disabled = true;
      const { error } = await opts.sb.rpc('set_data_feed_endpoint', {
        p_feed: f.id, p_url: u || null, p_secret: secret.value.trim() || null
      });
      saveUrl.disabled = false;
      if (error) return opts.say(error.message, 'err');
      url.value = ''; secret.value = '';
      opts.say('Endpoint saved.', 'ok');
      load();
    });

    const clear = el('button', 'cs-btn mini', 'clear endpoint');
    clear.type = 'button';
    clear.addEventListener('click', async () => {
      if (!confirm('Clear the endpoint? Deliveries stop and the secret is forgotten.')) return;
      const { error } = await opts.sb.rpc('set_data_feed_endpoint',
        { p_feed: f.id, p_url: null, p_secret: null });
      if (error) return opts.say(error.message, 'err');
      opts.say('Endpoint cleared.', 'ok');
      load();
    });
    body.appendChild(clear);

    /* --- what to send --- */
    body.appendChild(el('div', 'flabel', 'What it carries'));
    const secs = el('div', 'fsecs');
    const boxes = {};
    SECTIONS.forEach(([k, why]) => {
      const lab = el('label', 'sw');
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = !!(f.sections || {})[k];
      boxes[k] = i;
      lab.append(i, el('span', null, k), el('span', 'fwhy', why));
      secs.appendChild(lab);
    });
    body.appendChild(secs);

    /* --- how it is written --- */
    body.appendChild(el('div', 'flabel', 'How it is written'));
    const r2 = el('div', 'row');
    const fmtSel = el('select', 'cs-input');
    [['json', 'JSON'], ['csv', 'CSV'], ['xml', 'XML']].forEach(([v, l]) => {
      const o = el('option', null, l); o.value = v; fmtSel.appendChild(o);
    });
    fmtSel.value = f.format;
    const nameSel = el('select', 'cs-input');
    NAME_STYLES.forEach(([v, l]) => {
      const o = el('option', null, 'names: ' + l); o.value = v; nameSel.appendChild(o);
    });
    nameSel.value = f.name_style;
    const dateSel = el('select', 'cs-input');
    DATE_STYLES.forEach(([v, l]) => {
      const o = el('option', null, 'dates: ' + l); o.value = v; dateSel.appendChild(o);
    });
    dateSel.value = f.date_style;
    const onBox = el('label', 'sw');
    const onIn = document.createElement('input');
    onIn.type = 'checkbox'; onIn.checked = !!f.enabled;
    onBox.append(onIn, el('span', null, 'enabled'));
    r2.append(fmtSel, nameSel, dateSel, onBox);
    body.appendChild(r2);

    /* --- the field map --- */
    body.appendChild(el('div', 'flabel', 'Their names for our fields'));
    const map = el('textarea', 'cs-input feedmap');
    map.rows = 4;
    map.spellcheck = false;
    map.value = JSON.stringify(f.field_map || {}, null, 0)
      .replace(/^\{\}$/, '');
    map.placeholder = '{"reb":"TRB","fg3a":"3PA","plus_minus":"+/-"}';
    body.appendChild(map);
    body.appendChild(el('div', 'fhint',
      'JSON, one entry per renamed field. It applies everywhere at once — the ' +
      'JSON keys, the CSV header row and the XML element names — so a partner ' +
      'who wants TRB instead of reb says it once. Our own spelling is stable and ' +
      'does not follow the engine’s internals: reb, fg3a, tov, plus_minus.'));

    const save = el('button', 'cs-btn pri', 'save');
    save.type = 'button';
    const row3 = el('div', 'row');
    row3.appendChild(save);
    body.appendChild(row3);

    save.addEventListener('click', async () => {
      let fieldMap = {};
      const raw = map.value.trim();
      if (raw) {
        try { fieldMap = JSON.parse(raw); }
        catch (_) { return opts.say('The field map is not valid JSON.', 'err'); }
        if (typeof fieldMap !== 'object' || Array.isArray(fieldMap)) {
          return opts.say('The field map should be an object: {"reb":"TRB"}.', 'err');
        }
      }
      const sections = {};
      Object.keys(boxes).forEach(k => { sections[k] = boxes[k].checked; });
      save.disabled = true;
      const { error } = await opts.sb.rpc('update_data_feed', {
        p_feed: f.id, p_name: null, p_format: fmtSel.value,
        p_sections: sections, p_field_map: fieldMap,
        p_name_style: nameSel.value, p_date_style: dateSel.value,
        p_enabled: onIn.checked
      });
      save.disabled = false;
      if (error) return opts.say(error.message, 'err');
      opts.say('Saved.', 'ok');
      load();
    });
  }

  /* ------------------------------------------------------ preview / test --- */
  async function callFn(action, f, out, btn) {
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = '…';
    out.hidden = false; out.textContent = '';
    out.appendChild(el('div', 'fhint', action === 'preview'
      ? 'Building the payload…' : 'Sending…'));

    let res, body;
    try {
      const { data: { session } } = await opts.sb.auth.getSession();
      res = await fetch(opts.cfg.supabaseUrl + '/functions/v1/feeds', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: opts.cfg.supabaseAnonKey,
          Authorization: 'Bearer ' + (session ? session.access_token : '')
        },
        body: JSON.stringify({ action, feedId: f.id })
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      btn.disabled = false; btn.textContent = label;
      out.textContent = '';
      out.appendChild(el('div', 'feederr', 'Could not reach the server: ' + (e.message || e)));
      return;
    }
    btn.disabled = false; btn.textContent = label;
    out.textContent = '';

    if (!res.ok || body.error) {
      out.appendChild(el('div', 'feederr', body.error || ('Refused (' + res.status + ').')));
      return;
    }

    if (action === 'preview') {
      out.appendChild(el('div', 'fhint',
        body.format.toUpperCase() + ' · ' + body.bytes.toLocaleString('en-GB') +
        ' bytes · ' + (body.signed ? 'signed' : 'UNSIGNED') +
        ' · built from game ' + body.game_id));
      const pre = el('pre', 'feedpre');
      pre.textContent = body.body;
      out.appendChild(pre);
      return;
    }

    const ok = !!body.ok;
    out.appendChild(el('div', ok ? 'fhint' : 'feederr', ok
      ? 'Delivered — HTTP ' + body.status + ', ' +
        body.bytes.toLocaleString('en-GB') + ' bytes. Recorded in the log.'
      : 'Not accepted — ' + (body.error || 'HTTP ' + body.status) +
        '. Recorded as failed; it can be resent.'));
    load();
  }

  /* ------------------------------------------------------------------ load --- */
  async function load() {
    list.textContent = '';
    const { data, error } = await opts.sb.rpc('list_data_feeds', { p_league: opts.league.id });
    if (error) { list.appendChild(el('div', 'empty', error.message)); return; }
    const rows = data || [];
    if (!rows.length) {
      list.appendChild(el('div', 'empty', 'No feeds yet.'));
      return;
    }
    rows.forEach(f => list.appendChild(card(f)));

    /* one button for everything still owed, across every feed — the answer to
       "they were down last night" */
    const owed = rows.reduce((n, f) => n + (f.failed_count || 0) + (f.pending_count || 0), 0);
    if (owed) {
      const r = el('div', 'row');
      const b = el('button', 'cs-btn', 'resend ' + owed + ' outstanding');
      b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'resending…';
        try {
          const { data: { session } } = await opts.sb.auth.getSession();
          const res = await fetch(opts.cfg.supabaseUrl + '/functions/v1/feeds', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: opts.cfg.supabaseAnonKey,
              Authorization: 'Bearer ' + (session ? session.access_token : '')
            },
            body: JSON.stringify({ action: 'retry', leagueId: opts.league.id })
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || j.error) opts.say(j.error || 'Refused.', 'err');
          else opts.say('Retried ' + j.games + ' game(s).', 'ok');
        } catch (e) {
          opts.say('Could not reach the server: ' + (e.message || e), 'err');
        }
        load();
      });
      r.appendChild(b);
      list.appendChild(r);
    }
  }

  load();
}

return { mount };
}));
