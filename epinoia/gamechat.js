'use strict';
/* ============================================================================
   EpinoiaGameChat - a game's live chat (0237), beside its box score on a league's Live tab.

     const room = EpinoiaGameChat.mount(host, gameId, { base });   // -> { stop() }

   READING is for anyone who may see the game: the last eighty messages (game_chat_read), then each new one as it is
   said, on the public broadcast topic chat:<game> (the database sends it as the message is stored: 0237) over the
   small socket rt.js keeps; a message taken down goes as 'hide'. A slow read every 30 s, only while visible, covers a
   socket that has dropped.

   SAYING goes through the edge function `chat`, which checks the poster and has the message read by the moderator
   model before anybody sees it: signed in, an EPINOIA GO username, 18 or over (ticked once, as for GO's photographs),
   a league with its chat on, a game that is on. What is missing is said before anything is typed (chat_my_status).
   Each message can be reported (three reports take it down); its author and the league's admins can take it down.
   ============================================================================ */
(function () {
  if (window.EpinoiaGameChat) return;
  const M = () => window.EpinoiaMedia;
  const POLL_MS = 30000;
  const REASONS = {
    signed_out: 'Sign in to chat.', banned: 'This account cannot chat.', username: 'Choose a username first.',
    adult: 'Tick "I am 18 or over" to chat.', closed: 'The chat is closed for this league.',
    not_now: 'The chat opens half an hour before tip-off and closes after the game.', empty: 'Say something first.',
    long: '280 characters at most.', words: 'That word is not allowed here.', link: 'Links are not allowed in the chat.',
    slow: 'Slow down a little - one message every few seconds.', muted: 'Your last messages were refused, so please wait ten minutes.',
    day_full: 'That is today’s limit.', blocked: 'Not posted: the moderator refused it.',
    moderation_off: 'The chat’s moderator is not switched on yet, so nothing can be posted.', moderation_failed: 'The moderator could not read it just now - try again.'
  };

  function mount(host, gameId, opts) {
    opts = opts || {};
    const el = M().el, tr = M().tr, base = opts.base || M().BASE;
    let stopped = false, lastId = 0, me = null, poll = null, unwatch = [], seen = new Set();
    host.textContent = '';
    const box = el('section', 'ch');
    box.setAttribute('aria-label', tr('Live chat'));
    const head = el('div', 'ch-h');
    head.append(el('b', null, tr('LIVE CHAT')), el('span', 'ai', tr('AI-moderated')));
    const log = el('div', 'ch-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    const form = el('div', 'ch-form');
    box.append(head, log, form);
    host.appendChild(box);

    const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    function add(m, fresh) {
      if (seen.has(m.id)) return;
      seen.add(m.id);
      lastId = Math.max(lastId, m.id);
      const stick = atBottom();
      const row = el('div', 'ch-msg' + (m.mine ? ' mine' : ''));
      row.dataset.id = m.id;
      const av = el('span', 'ch-av');
      if (m.avatar_url && /^https:\/\//.test(m.avatar_url)) { const i = el('img'); i.src = m.avatar_url; i.alt = ''; i.loading = 'lazy'; av.appendChild(i); }
      else av.textContent = (m.username || '?').slice(0, 1).toUpperCase();
      const txt = el('div');
      const u = el('a', 'ch-u', m.username);
      u.href = base + 'fan/?u=' + encodeURIComponent(m.username);
      u.setAttribute('translate', 'no');
      const b = el('span', 'ch-b', m.body);
      txt.append(u, b);
      const act = el('div', 'ch-act');
      if (me && me.signed_in) {
        if (m.mine || me.admin) {
          const x = el('button', null, tr(m.mine ? 'DELETE' : 'HIDE'));
          x.type = 'button';
          x.title = tr('Take this message down');
          x.addEventListener('click', () => takeDown(m.id, 'hide_chat'));
          act.appendChild(x);
        }
        if (!m.mine) {
          const r = el('button', null, tr('REPORT'));
          r.type = 'button';
          r.title = tr('Report this message: three reports take it down');
          r.addEventListener('click', () => takeDown(m.id, 'report_chat', r));
          act.appendChild(r);
        }
      }
      row.append(av, txt, act);
      log.appendChild(row);
      if (stick || fresh === 'mine') log.scrollTop = log.scrollHeight;
    }
    function remove(id) {
      const row = log.querySelector('.ch-msg[data-id="' + Number(id) + '"]');
      if (row) row.remove();
    }
    async function takeDown(id, fn, btn) {
      try {
        const s = window.EpinoiaAccess && window.EpinoiaAccess.sessionReady ? await window.EpinoiaAccess.sessionReady() : null;
        const c = window.EPINOIA_CONFIG;
        const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST',
          headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + ((s && s.token) || c.supabaseAnonKey), 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_id: id }) });
        if (!r.ok) throw new Error(r.status);
        if (fn === 'hide_chat') remove(id);
        else if (btn) { btn.disabled = true; btn.textContent = tr('REPORTED'); }
      } catch (_) { say(tr('That did not work - try again.'), true); }
    }

    async function history() {
      try {
        const rows = await M().rpc('game_chat_read', { p_game: gameId, p_after: lastId || null, p_limit: 80 }, { auth: true });
        rows.forEach(m => add(m));
        if (!lastId && !rows.length) log.appendChild(el('div', 'ch-sys', tr('No messages yet. Say the first thing.')));
      } catch (_) { /* before 0237, or a blip: the socket still brings new ones */ }
    }
    function listen() {
      M().load('rt.js', 'EpinoiaRT').then(RT => {
        if (stopped || !RT) return;
        const c = window.EPINOIA_CONFIG;
        const rt = (window.__epinoiaMediaRT = window.__epinoiaMediaRT || RT.create({ url: c.supabaseUrl, key: c.supabaseAnonKey }));
        unwatch.push(rt.watch('chat:' + gameId, (f, name) => {
          if (!f) return;
          if (name === 'hide') return remove(f.id);
          if (name === 'msg') {
            const sys = log.querySelector('.ch-sys'); if (sys) sys.remove();
            add({ id: f.id, username: f.u, avatar_url: f.a, body: f.b, created_at: f.at, mine: !!(me && me.username && f.u === me.username) });
          }
        }));
      }).catch(() => {});
      poll = setInterval(() => { if (!document.hidden) history(); }, POLL_MS);
    }

    /* ---- the box to type in, or what is missing first ---- */
    const sayEl = el('div', 'ch-say');
    function say(t, err) { sayEl.textContent = t || ''; sayEl.className = 'ch-say' + (err ? ' err' : ''); }
    function gate(msg, link, label) {
      form.textContent = '';
      const g = el('div', 'ch-gate', tr(msg) + ' ');
      if (link) { const a = el('a', null, tr(label)); a.href = link; g.appendChild(a); }
      form.appendChild(g);
    }
    function composer() {
      form.textContent = '';
      const rowEl = el('div', 'ch-row');
      const input = el('input', 'ch-in');
      input.type = 'text'; input.maxLength = 280; input.placeholder = tr('Say something about the game…');
      input.setAttribute('aria-label', tr('Your message'));
      input.setAttribute('enterkeyhint', 'send');
      const send = el('button', 'ep-btn pri', tr('SEND'));
      send.type = 'button';
      rowEl.append(input, send);
      form.appendChild(rowEl);
      let adultBox = null;
      if (!me.adult) {
        const lab = el('label', 'ch-say');
        adultBox = el('input'); adultBox.type = 'checkbox';
        lab.append(adultBox, document.createTextNode(' ' + tr('I am 18 or over')));
        form.appendChild(lab);
      }
      form.appendChild(sayEl);
      const post = async () => {
        const body = input.value.trim();
        if (!body) return;
        if (adultBox && !adultBox.checked) return say(tr(REASONS.adult), true);
        send.disabled = true; say(tr('Checking…'));
        try {
          const s = window.EpinoiaAccess && window.EpinoiaAccess.sessionReady ? await window.EpinoiaAccess.sessionReady() : null;
          if (!s || !s.token) { say(tr(REASONS.signed_out), true); send.disabled = false; return; }
          const c = window.EPINOIA_CONFIG;
          const r = await fetch(c.supabaseUrl + '/functions/v1/chat', { method: 'POST',
            headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId, body, adult: !!(adultBox && adultBox.checked) }) });
          const j = await r.json().catch(() => ({}));
          if (j && j.ok) {
            input.value = '';
            say('');
            if (adultBox) { me.adult = true; adultBox.parentNode.remove(); adultBox = null; }
            if (j.message) add(Object.assign({ mine: true }, j.message), 'mine');
          } else {
            say(tr(REASONS[j && j.reason] || 'Not posted.'), true);
          }
        } catch (_) { say(tr('Not posted - check the connection.'), true); }
        send.disabled = false;
        input.focus();
      };
      send.addEventListener('click', post);
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } });
    }
    async function standing() {
      try { me = await M().rpc('chat_my_status', { p_game: gameId }, { auth: true }); } catch (_) { me = null; }
      if (!me) return gate('The chat is not available here yet.');
      if (!me.open) return gate('The chat is closed for this league.');
      if (!me.signed_in) return gate('Sign in with your EPINOIA GO profile to chat.', base + 'signin/?next=' + encodeURIComponent(location.pathname + location.search + location.hash), 'Sign in');
      if (!me.username) return gate('Choose a username to chat.', base + 'profile/', 'Choose a username');
      if (!me.on) return gate(REASONS.not_now);
      composer();
    }

    (async () => {
      await standing();
      await history();
      log.scrollTop = log.scrollHeight;
      listen();
    })();
    return { stop() { stopped = true; clearInterval(poll); unwatch.forEach(f => { try { f(); } catch (_) {} }); } };
  }

  window.EpinoiaGameChat = { mount };
})();
