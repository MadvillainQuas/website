'use strict';
/* ============================================================================
   PRIVACY — the data-rights request and complaint form (migration 0120;
   docs/replacement/foundations.md 7.6).

   TWO WAYS IN, AS THE CONTRACT SAYS:
     signed in    submit_data_request(p_kind, p_details, p_tenant). The account is
                  the requester and the reply goes to its own address, so there is
                  nothing to type but the details. Their own requests are listed
                  underneath (my_data_requests), with where each one stands.
     signed out   the contact function, which hands the request to
                  intake_data_request with the service key. The form asks for a
                  name and an address; the database limits one address to three
                  signed-out requests a day, and one account to three of its own
                  (a stranger's form posts never block an account).
   The submit RPC takes no capacity, so a signed-in request made for a child or
   someone represented says so in its first line, where the handler reads it.

   WHO HOLDS THE DATA. Epinoia by default. When governing bodies or independent
   leagues are data controllers here (root organisations, 0119), they are
   offered too, each with its own data protection contact if it has published
   one (the dpo_contact tenant setting). Epinoia's own contact is the public
   dpo_contact platform setting.

   Reads use plain fetch with the stored session, as join.js does: this page
   does not load the SDK for a handful of requests.
   ============================================================================ */
(function () {
  const CFG = window.EPINOIA_CONFIG || {};
  const A = window.EpinoiaAccess || null;
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };

  const KIND_WORDS = {
    access: 'See my data', rectification: 'Correct my data', erasure: 'Erase my data',
    restriction: 'Restrict my data', objection: 'Objection', portability: 'Take my data elsewhere',
    complaint: 'Complaint'
  };
  const STATUS_WORDS = {
    received: ['Received', ''],
    awaiting_identity: ['Waiting for proof of who you are (the clock is stopped)', 'wait'],
    awaiting_clarification: ['Waiting for your reply (the clock is stopped)', 'wait'],
    in_progress: ['Being handled', ''],
    completed: ['Completed', 'end'],
    refused: ['Refused: we have written to you with the reasons', 'end'],
    withdrawn: ['Withdrawn', 'end']
  };
  const CAPACITY_LINE = {
    guardian: 'Made as the parent or guardian of the person it is about.',
    representative: 'Made on behalf of someone I represent, with their authority.'
  };
  const MAX = 4000;

  let session = null;

  /* ------------------------------------------------------------ helpers --- */
  const sessNow = async () => {
    if (A && typeof A.sessionReady === 'function') {
      try { return await A.sessionReady(); } catch (_) { /* fall through */ }
    }
    return A && A.session ? A.session() : null;
  };
  const londonDate = iso => iso
    ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  const signinHref = () => (A && A.signinHref ? A.signinHref(location.pathname) : '../signin/?next=' + encodeURIComponent(location.pathname));

  function say(text, kind, link) {
    const m = $('#msg');
    m.textContent = text || '';
    if (link) { m.append(' '); const a = el('a', null, link.text); a.href = link.href; m.appendChild(a); }
    m.className = 'msg ' + (kind || '');
    m.classList.toggle('hide', !text);
    if (text) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function rest(path) {
    try {
      const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, {
        cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey }
      });
      return r.ok ? await r.json() : null;
    } catch (_) {
      return null;
    }
  }

  async function rpc(fn, args) {
    const s = await sessNow();
    const headers = { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' };
    if (s) headers.Authorization = 'Bearer ' + s.token;
    try {
      const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, {
        method: 'POST', cache: 'no-store', headers, body: JSON.stringify(args || {})
      });
      let body = null;
      try { body = await r.json(); } catch (_) { body = null; }
      return r.ok ? { data: body, status: r.status } : { error: body || {}, status: r.status };
    } catch (e) {
      return { error: { message: String((e && e.message) || e) }, status: 0 };
    }
  }

  /* ------------------------------------------------------------ the top --- */
  function paintWho() {
    const host = $('#who');
    host.textContent = '';
    if (session) {
      host.append('Signed in as ' + (session.email || 'your account') + '. A request you make here comes from that account.');
    } else {
      host.append('You are not signed in, and do not need to be. Have an account? ');
      const a = el('a', null, 'Sign in');
      a.href = signinHref();
      host.appendChild(a);
      host.append(' to make the request from it and follow it here.');
    }
    $('#outFields').classList.toggle('hide', !!session);
    const as = $('#asWho');
    as.classList.toggle('hide', !session);
    as.textContent = session
      ? 'The request is made as ' + (session.email || 'your account') + ', and our reply comes to that address.'
      : '';
  }

  /* ----------------------------------------- who holds the data, and contacts --- */
  async function loadContacts() {
    const [setting, roots] = await Promise.all([
      rest('platform_settings?select=value&key=eq.dpo_contact'),
      /* visible roots only, the controllers the database accepts (0120). The
         anon key sees no others today; this keeps it so if the read ever
         carries a platform admin's session */
      rest('organisations?select=id,name,dpo:settings->>dpo_contact&parent_id=is.null&visible=is.true&order=name.asc')
    ]);

    const dpo = Array.isArray(setting) && setting[0] && typeof setting[0].value === 'string' ? setting[0].value.trim() : '';
    const box = $('#dpo');
    box.textContent = '';
    if (dpo) {
      box.append(el('small', null, 'Epinoia’s data protection contact'), document.createTextNode(dpo.slice(0, 200)));
    }
    box.classList.toggle('hide', !dpo);
    $('#dpoNone').classList.toggle('hide', !!dpo);

    const list = Array.isArray(roots) ? roots : [];
    const sel = $('#tenant');
    while (sel.options.length > 1) sel.remove(1);
    list.forEach(o => sel.appendChild(new Option(o.name, o.id)));
    $('#tenantRow').classList.toggle('hide', !list.length);

    const host = $('#tenantContacts');
    host.textContent = '';
    list.filter(o => typeof o.dpo === 'string' && o.dpo.trim()).forEach(o => {
      const c = el('div', 'contact');
      c.append(el('small', null, o.name + ': data protection contact'), document.createTextNode(o.dpo.trim().slice(0, 200)));
      host.appendChild(c);
    });
  }

  /* -------------------------------------------------- their own requests --- */
  async function loadMine() {
    const sec = $('#mineSec');
    if (!session) { sec.classList.add('hide'); return; }
    const res = await rpc('my_data_requests');
    const host = $('#mine');
    host.textContent = '';
    if (res.error) {
      /* not deployed yet, or an expired sign-in: say nothing rather than alarm */
      sec.classList.add('hide');
      return;
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    sec.classList.remove('hide');
    if (!rows.length) {
      host.appendChild(el('p', 'empty', 'Nothing yet. A request you make while signed in appears here, with where it stands and when it is due.'));
      return;
    }
    rows.forEach(r => {
      const row = el('div', 'mine');
      const left = el('div');
      left.appendChild(el('b', null, (KIND_WORDS[r.kind] || r.kind) + ' · ' + r.reference));
      const bits = ['Received ' + londonDate(r.received_at)];
      if (r.organisation) bits.push('about ' + r.organisation);
      left.appendChild(el('small', null, bits.join(' · ')));
      if (!r.closed_at) {
        if (r.ack_due_at && !r.acknowledged_at) left.appendChild(el('small', null, 'Acknowledged by ' + londonDate(r.ack_due_at)));
        left.appendChild(el('small', null, (r.kind === 'complaint' ? 'Aim to resolve by ' : 'Due by ') + londonDate(r.due_at)));
        if (r.extended_until && r.extension_reason) {
          left.appendChild(el('small', null, 'Extended: ' + r.extension_reason));
        }
      } else {
        left.appendChild(el('small', null, 'Closed ' + londonDate(r.closed_at)));
      }
      const [words, cls] = STATUS_WORDS[r.status] || [r.status, ''];
      row.append(left, el('span', 'st' + (cls ? ' ' + cls : ''), words));
      host.appendChild(row);
    });
  }

  /* ---------------------------------------------------------- the form --- */
  const details = $('#details');
  details.addEventListener('input', () => { $('#count').textContent = String(details.value.length); });

  function receipt(out, email) {
    const host = $('#done');
    host.textContent = '';
    host.append(el('div', 'k', 'Your reference'), el('div', 'ref', out.reference || '—'));
    const kind = out.kind || '';
    if (kind === 'complaint') {
      host.appendChild(el('p', null, 'We acknowledge your complaint by ' + londonDate(out.ack_due_at) +
        ' and aim to resolve it by ' + londonDate(out.due_at) + '.'));
    } else {
      host.appendChild(el('p', null, 'The answer is due by ' + londonDate(out.due_at) + '. If we need proof of who you are, ' +
        'or to ask what you mean, we write to you first, and the month runs from your answer.'));
    }
    host.appendChild(el('p', null, 'We write to ' + email + '. Quote the reference if you write to us about it.'));
    host.classList.remove('hide');
    host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function refusal(res) {
    const e = res.error || {};
    const why = typeof e.message === 'string' ? e.message : (typeof e.error === 'string' ? e.error : '');
    if (res.status === 0) return say('The server could not be reached. Check your connection and try again: nothing was sent.', 'err');
    if (res.status === 401 || e.code === '42501') {
      return say('Your sign-in has expired. Sign in again, or sign out and use the form without an account.', 'err',
                 { text: 'Sign in', href: signinHref() });
    }
    if (res.status === 404 || e.code === 'PGRST202') {
      return say('Requests cannot be taken on this page yet. Use the contact form, which reaches the same person.', 'err',
                 { text: 'Contact', href: '../contact/?topic=privacy' });
    }
    say(why ? why.replace(/[.\s]+$/, '').replace(/^./, c => c.toUpperCase()) + '.' : 'That was refused (' + res.status + ').',
        res.status === 429 || e.code === '54000' ? 'warn' : 'err');
  }

  $('#form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    say('');
    $('#done').classList.add('hide');

    const kind = (document.querySelector('input[name="kind"]:checked') || {}).value || '';
    const capacity = $('#capacity').value;
    const tenant = $('#tenant').value || null;
    let text = details.value.trim();
    if (!kind) return say('Choose what you want to do.', 'warn');

    const btn = $('#send');
    const label = btn.textContent;
    const done = () => { btn.disabled = false; btn.textContent = label; };
    btn.disabled = true;
    btn.textContent = 'sending…';

    session = await sessNow();
    paintWho();

    if (session) {
      if (CAPACITY_LINE[capacity]) text = CAPACITY_LINE[capacity] + (text ? '\n\n' + text : '');
      if (text.length > MAX) { done(); details.focus(); return say('Keep the details to 4,000 characters. More can follow once we reply.', 'warn'); }
      const res = await rpc('submit_data_request', { p_kind: kind, p_details: text, p_tenant: tenant });
      done();
      if (res.error) return refusal(res);
      $('#form').reset();
      $('#count').textContent = '0';
      receipt(res.data || {}, session.email || 'your account’s address');
      loadMine();
      return;
    }

    const name = $('#name').value.trim();
    const email = $('#email').value.trim();
    const bad = (node, msg) => { done(); say(msg, 'warn'); node.focus(); };
    if (!name) return bad($('#name'), 'A name, so the reply knows who it is to.');
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) return bad($('#email'), 'That email address does not look right, and the reply goes to it.');
    if (text.length > MAX) return bad(details, 'Keep the details to 4,000 characters. More can follow once we reply.');

    let out = {}, status = 0;
    try {
      const r = await fetch(CFG.supabaseUrl + '/functions/v1/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey },
        body: JSON.stringify({
          name, email, subject: '', body: text,
          website: $('#website').value,         // the honeypot, always empty for a person
          privacy: { kind, capacity, tenant_id: tenant }
        })
      });
      status = r.status;
      out = await r.json().catch(() => ({}));
    } catch (_) {
      status = 0;
    }
    done();
    if (status < 200 || status >= 300) return refusal({ status, error: { message: out.error || '' } });
    if (!out.reference) {
      /* an older contact function took it as an ordinary message: it is stored
         and will be read, but it has no reference or clock of its own */
      return say('Your request was sent and will be read. We reply to ' + email + '.', 'ok');
    }
    $('#form').reset();
    $('#count').textContent = '0';
    receipt(out, email);
  });

  /* ------------------------------------------------------------- start --- */
  async function start() {
    session = await sessNow();
    paintWho();
    loadMine();
  }
  window.addEventListener('epinoia:auth', start);
  loadContacts();
  start();
})();
