'use strict';
/* ============================================================================
   API KEYS.

   The data the API serves is already public — the pages hand the same rows to
   anonymous visitors — so a key is not a gate. It is an identity: it lets a
   league see who is pulling what, stop one runaway script without taking the
   API down for everyone, and know whom to tell when something changes.

   The interface has one job that is easy to get wrong: A KEY IS SHOWN ONCE.
   The database stores only its hash, so there is no "reveal" button to build
   and no way to recover it later. That has to be obvious at the moment of
   creation rather than discovered afterwards, which is why the new key gets a
   panel of its own, a copy button, and a warning that does not go away until
   it is dismissed.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideKeys = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const when = iso => { if (!iso) return 'never';
  try { return new Date(iso).toLocaleDateString('en-GB',
    { day: '2-digit', month: 'short', year: '2-digit' }); } catch (_) { return ''; } };

/* opts: { host, sb, league, say } */
function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  host.textContent = '';
  if (!opts.league) {
    host.appendChild(el('div', 'empty', 'Pick a league to manage its keys.'));
    return;
  }

  host.appendChild(el('div', 'empty',
    'A key lets somebody read this league’s public data as JSON — the table, ' +
    'fixtures, season statistics, box scores. It grants nothing that is not ' +
    'already on the website; it exists so usage can be attributed and limited.'));

  const mk = el('div', 'row');
  const name = el('input', 'cs-input grow');
  name.placeholder = 'What is it for? e.g. club website';
  name.maxLength = 60;
  const rate = el('select', 'cs-input');
  rate.style.flex = '0 0 auto';
  [[120, '120 / hour'], [1000, '1,000 / hour'], [5000, '5,000 / hour']]
    .forEach(([v, label]) => { const o = el('option', null, label); o.value = String(v);
      rate.appendChild(o); });
  rate.value = '1000';
  const go = el('button', 'cs-btn pri', 'issue key');
  go.type = 'button';
  mk.append(name, rate, go);
  host.appendChild(mk);

  const fresh = el('div');
  host.appendChild(fresh);
  const list = el('div', 'list');
  host.appendChild(list);

  go.addEventListener('click', async () => {
    const n = name.value.trim();
    if (!n) return opts.say('Give the key a name, so it can be told from the others.', 'warn');
    go.disabled = true;
    const { data, error } = await opts.sb.rpc('issue_api_key', {
      p_league: opts.league.id, p_name: n, p_rate: parseInt(rate.value, 10)
    });
    go.disabled = false;
    if (error) return opts.say(error.message, 'err');
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !row.api_key) return opts.say('The key was not returned — nothing was created.', 'err');
    name.value = '';
    showOnce(row.api_key);
    load();
  });

  /* the one moment the key exists in readable form */
  function showOnce(key) {
    fresh.textContent = '';
    const card = el('div', 'keycard');
    card.appendChild(el('div', 'keyh', 'Copy this now — it cannot be shown again'));
    const box = el('div', 'keyrow');
    const code = el('code', 'keyval', key);
    const copy = el('button', 'cs-btn mini', 'copy');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(key);
        copy.textContent = 'copied';
        setTimeout(() => { copy.textContent = 'copy'; }, 1800);
      } catch (_) {
        /* clipboard is refused in some contexts; selecting the text is the
           fallback that always works */
        const r = document.createRange();
        r.selectNodeContents(code);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
        copy.textContent = 'press ⌘/Ctrl+C';
      }
    });
    box.append(code, copy);
    card.appendChild(box);
    card.appendChild(el('div', 'keynote',
      'Only a hash is stored, so nobody — including you, and including us — can ' +
      'look this up later. If it is lost, revoke it and issue another.'));
    const done = el('button', 'cs-btn mini', 'I have saved it');
    done.type = 'button';
    done.addEventListener('click', () => { fresh.textContent = ''; });
    card.appendChild(done);
    fresh.appendChild(card);
  }

  async function load() {
    list.textContent = '';
    const { data, error } = await opts.sb.rpc('api_key_list', { p_league: opts.league.id });
    if (error) { list.appendChild(el('div', 'empty', error.message)); return; }
    const rows = data || [];
    if (!rows.length) {
      list.appendChild(el('div', 'empty', 'No keys yet.'));
      return;
    }
    rows.forEach(k => {
      const row = el('div', 'item');
      const box = el('div');
      box.appendChild(el('div', 'nm', k.name));
      const bits = [k.prefix + '…',
                    k.rate_limit.toLocaleString('en-GB') + '/hour',
                    'used ' + k.used_this_hour + ' this hour',
                    'last used ' + when(k.last_used_at)];
      if (k.revoked_at) bits.push('REVOKED ' + when(k.revoked_at));
      box.appendChild(el('div', 'mt', bits.join(' · ')));
      row.appendChild(box);
      if (k.revoked_at) row.style.opacity = '.5';

      const sp = el('div', 'sp');
      if (!k.revoked_at) {
        const rv = el('button', 'cs-btn mini', 'revoke');
        rv.type = 'button';
        rv.addEventListener('click', async () => {
          if (!confirm('Revoke "' + k.name + '"? Anything using it stops working immediately.')) return;
          const { error: e2 } = await opts.sb.rpc('revoke_api_key', { p_key_id: k.id });
          if (e2) return opts.say(e2.message, 'err');
          opts.say('Key revoked.', 'ok');
          load();
        });
        sp.appendChild(rv);
      }
      row.appendChild(sp);
      list.appendChild(row);
    });
  }

  load();
}

return { mount };
}));
