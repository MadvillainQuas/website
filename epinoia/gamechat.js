'use strict';
/* ============================================================================
   EpinoiaGameChat - a game's live chat (0237), beside its box score on a league's Live tab.

     const room = EpinoiaGameChat.mount(host, gameId, { base });   // -> { stop() }

   READING is for anyone who may see the game: the last eighty messages (game_chat_read), then each new one as it is
   said, on the public broadcast topic chat:<game> (the database sends it as the message is stored: 0237) over the
   small socket rt.js keeps; a message taken down goes as 'hide'. A slow read every 30 s, only while visible, covers a
   socket that has dropped.

   SAYING goes through the edge function `chat`, which checks the poster and has the message read by the moderator
   model before anybody sees it: signed in, a name for the chat, 18 or over, the chat's terms accepted (0250), a league
   with its chat on, a game that is on. What is missing is said before anything is typed (chat_my_status).
   Each message can be reported (three reports take it down); its author and the league's admins can take it down.

   ANY EPINOIA SIGN-IN IS THE CHAT'S (2026-10-07). GO's profile is the same account, so the session is read from
   whatever the page has - access.js, follow.js (HOME loads no access.js), the stored session itself - and a reader
   signed in who has no chat name, has not said they are 18 or over or has not accepted the terms gets ONE pop-up,
   JOIN THE CHAT, that asks for all of it at once (set_username, accept_chat_terms).

   IT FOLDS AWAY: the head's button collapses the chat to its head (remembered on this device); the chat's container
   is told (.chat-min), so a theatre or a Live tab gives the stream the room.
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
    day_full: 'That is today’s limit.', blocked: 'Not posted: the moderator refused it.', terms: 'Accept the chat’s terms first.',
    moderation_off: 'The chat’s moderator is not switched on yet, so nothing can be posted.', moderation_failed: 'The moderator could not read it just now - try again.'
  };

  /* THE READER'S SESSION, from whatever the page has: access.js, follow.js, else the stored session itself */
  async function session() {
    try {
      const A = window.EpinoiaAccess;
      if (A && typeof A.sessionReady === 'function') { const s = await A.sessionReady(); if (s && s.token) return s; }
    } catch (_) { /* the next */ }
    try {
      const F = window.EpinoiaFollow;
      const s = F && typeof F.session === 'function' ? F.session() : null;
      if (s && s.token) return s;
    } catch (_) { /* the next */ }
    try {
      const m = String((window.EPINOIA_CONFIG || {}).supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
      const j = m ? JSON.parse(localStorage.getItem('sb-' + m[1] + '-auth-token') || 'null') : null;
      const tok = j && (j.access_token || (j.currentSession && j.currentSession.access_token));
      const exp = j && (j.expires_at || (j.currentSession && j.currentSession.expires_at));
      if (tok && !(exp && Number(exp) * 1000 < Date.now())) return { token: tok };
    } catch (_) { /* signed out */ }
    return null;
  }
  /* a read or a write as the reader (signed out: as anybody) -> the answer, or { error: status } */
  async function call(name, body) {
    const c = window.EPINOIA_CONFIG, s = await session();
    try {
      const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/' + name, { method: 'POST', cache: 'no-store',
        headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + ((s && s.token) || c.supabaseAnonKey), 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}) });
      if (!r.ok) return { error: r.status };
      return r.status === 204 ? null : r.json();
    } catch (_) { return { error: 0 }; }
  }
  const MIN_KEY = 'epinoia.chat.min';

  function mount(host, gameId, opts) {
    opts = opts || {};
    const el = M().el, tr = M().tr, base = opts.base || M().BASE;
    let stopped = false, lastId = 0, me = null, poll = null, unwatch = [], seen = new Set(), adultTicked = false;
    host.textContent = '';
    const box = el('section', 'ch');
    box.setAttribute('aria-label', tr('Live chat'));
    const head = el('div', 'ch-h');
    const fold = el('button', 'ch-fold');
    fold.type = 'button';
    head.append(el('b', null, tr('LIVE CHAT')), el('span', 'ai', tr('AI-moderated')), fold);
    /* IT FOLDS AWAY to its head; the container is told, so the stream beside it takes the room */
    let min = false;
    try { min = localStorage.getItem(MIN_KEY) === '1'; } catch (_) { min = false; }
    const setMin = on => {
      min = !!on;
      box.classList.toggle('min', min);
      if (host.parentElement) host.parentElement.classList.toggle('chat-min', min);
      host.classList.toggle('is-min', min);
      fold.setAttribute('aria-expanded', String(!min));
      fold.setAttribute('aria-label', tr(min ? 'Open the chat' : 'Fold the chat away'));
      fold.title = fold.getAttribute('aria-label');
      try { localStorage.setItem(MIN_KEY, min ? '1' : '0'); } catch (_) { /* private mode */ }
      if (typeof opts.onFold === 'function') { try { opts.onFold(min); } catch (_) { /* the host's */ } }
    };
    fold.addEventListener('click', () => setMin(!min));
    head.addEventListener('click', e => { if (min && e.target !== fold) setMin(false); });
    const log = el('div', 'ch-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    const form = el('div', 'ch-form');
    box.append(head, log, form);
    host.appendChild(box);
    setMin(min);

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
        const r = await call(fn, { p_id: id });
        if (r && r.error !== undefined) throw new Error(r.error);
        if (fn === 'hide_chat') remove(id);
        else if (btn) { btn.disabled = true; btn.textContent = tr('REPORTED'); }
      } catch (_) { say(tr('That did not work - try again.'), true); }
    }

    async function history() {
      try {
        const rows = await call('game_chat_read', { p_game: gameId, p_after: lastId || null, p_limit: 80 });
        if (!Array.isArray(rows)) throw new Error('read');
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
      if (!me.adult && !adultTicked) {
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
          const s = await session();
          if (!s || !s.token) { say(tr(REASONS.signed_out), true); send.disabled = false; return; }
          const c = window.EPINOIA_CONFIG;
          const r = await fetch(c.supabaseUrl + '/functions/v1/chat', { method: 'POST',
            headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + s.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ gameId, body, adult: !!((adultBox && adultBox.checked) || adultTicked) }) });
          const j = await r.json().catch(() => ({}));
          if (j && j.ok) {
            input.value = '';
            say('');
            if (adultBox) { me.adult = true; adultBox.parentNode.remove(); adultBox = null; }
            if (j.message) add(Object.assign({ mine: true }, j.message), 'mine');
          } else if (j && (j.reason === 'terms' || j.reason === 'username' || j.reason === 'adult')) {
            say(tr(REASONS[j.reason]), true);
            if (j.reason === 'terms') me.terms = false;
            if (j.reason === 'username') me.username = null;
            joinPop();
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
    /* JOIN THE CHAT, ONCE: a name for the chat (when the account has none), 18 or over, the chat's terms */
    const NAME_WHY = { short: 'At least 3 characters.', long: '20 characters at most.', start: 'Start with a letter.',
      characters: 'Letters, numbers and _ only.', reserved: 'That name is kept back - try another.', blocked: 'Try another name.',
      taken: 'That name is taken - try another.', too_soon: 'A name can be changed once a month.' };
    let pop = null;
    function joinPop() {
      if (pop || !me || !me.signed_in) return;
      const ov = el('div', 'ch-pop-ov');
      const card = el('div', 'ch-pop');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', tr('Join the chat'));
      card.append(el('b', 'ch-pop-t', tr('JOIN THE CHAT')),
        el('p', 'ch-pop-p', tr('Your EPINOIA account is all it takes. Once, and you are in for every game.')));
      let nameIn = null;
      if (!me.username) {
        const lab = el('label', 'ch-pop-l', tr('Your name in the chat'));
        nameIn = el('input', 'ch-in');
        nameIn.type = 'text'; nameIn.maxLength = 20; nameIn.autocomplete = 'nickname';
        nameIn.placeholder = tr('3 to 20 letters, numbers or _');
        lab.appendChild(nameIn);
        card.appendChild(lab);
      } else {
        const p = el('p', 'ch-pop-p', tr('You chat as') + ' ');
        p.appendChild(el('b', null, me.username));
        card.appendChild(p);
      }
      const tick = (label, on) => {
        const l = el('label', 'ch-pop-c');
        const c = el('input'); c.type = 'checkbox'; c.checked = !!on; c.disabled = !!on;
        l.append(c, el('span', null, tr(label)));
        card.appendChild(l);
        return c;
      };
      const adult = tick('I am 18 or over', me.adult);
      const rules = el('ul', 'ch-pop-r');
      ['Be respectful: no abuse, hate or harassment of anybody - players, officials or fans.',
       'No links, adverts or spam.',
       'Every message is read by an AI moderator before it is shown; messages can be reported and taken down.',
       'Breaking the rules can end your access to the chat.'].forEach(t => rules.appendChild(el('li', null, tr(t))));
      card.appendChild(rules);
      const terms = tick('I accept the chat’s rules and EPINOIA’s terms', false);
      const more = el('a', 'ch-pop-a', tr('Terms and privacy'));
      more.href = base + 'privacy/'; more.target = '_blank'; more.rel = 'noopener';
      card.appendChild(more);
      const msg = el('div', 'ch-say');
      const go = el('button', 'ep-btn pri', tr('JOIN THE CHAT'));
      go.type = 'button';
      const no = el('button', 'ep-btn', tr('Not now'));
      no.type = 'button';
      const btns = el('div', 'ch-pop-b');
      btns.append(go, no);
      card.append(msg, btns);
      ov.appendChild(card);
      document.body.appendChild(ov);
      pop = ov;
      const close = () => { if (pop) { pop.remove(); pop = null; document.removeEventListener('keydown', onKey); } };
      const onKey = e => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey);
      ov.addEventListener('click', e => { if (e.target === ov) close(); });
      no.addEventListener('click', close);
      (nameIn || (adult.disabled ? terms : adult)).focus();
      go.addEventListener('click', async () => {
        const bad = t => { msg.textContent = tr(t); msg.className = 'ch-say err'; go.disabled = false; };
        if (nameIn && !nameIn.value.trim()) return bad('Choose your name in the chat.');
        if (!adult.checked) return bad(REASONS.adult.replace('Tick ', 'Tick ').replace(' to chat.', ' to join.'));
        if (!terms.checked) return bad('Accept the rules to join.');
        go.disabled = true; msg.textContent = tr('Joining…'); msg.className = 'ch-say';
        if (nameIn) {
          const r = await call('set_username', { p: nameIn.value.trim() });
          if (!r || r.error !== undefined) return bad('Your name could not be saved - try again.');
          if (!r.ok) return bad(NAME_WHY[r.reason] || 'Try another name.');
          me.username = r.username;
        }
        const a = await call('accept_chat_terms', { p_adult: true });
        if (a && a.error === 404) adultTicked = true;            // before 0250: the age goes with the first message
        else if (!a || a.error !== undefined) return bad('That did not work - try again.');
        else if (!a.ok) return bad(REASONS[a.reason] || 'That did not work - try again.');
        me.adult = true; me.terms = true;
        close();
        if (!me.on) return gate(REASONS.not_now);
        composer();
      });
    }
    async function standing() {
      me = await call('chat_my_status', { p_game: gameId });
      if (!me || me.error !== undefined) { me = null; return gate('The chat is not available here yet.'); }
      if (!me.open) return gate('The chat is closed for this league.');
      if (!me.signed_in) return gate('Sign in to chat: your EPINOIA account is all it takes.', base + 'signin/?next=' + encodeURIComponent(location.pathname + location.search + location.hash), 'Sign in');
      if (!me.username || !me.adult || me.terms === false) {
        form.textContent = '';
        const g = el('div', 'ch-gate', tr('One quick step and you are in.') + ' ');
        const b = el('button', 'ep-btn pri mini', tr('JOIN THE CHAT'));
        b.type = 'button';
        b.addEventListener('click', joinPop);
        g.appendChild(b);
        form.appendChild(g);
        return;
      }
      if (!me.on) return gate(REASONS.not_now);
      composer();
    }

    (async () => {
      await standing();
      await history();
      log.scrollTop = log.scrollHeight;
      listen();
    })();
    return { stop() {
      stopped = true; clearInterval(poll); unwatch.forEach(f => { try { f(); } catch (_) {} });
      if (pop) { pop.remove(); pop = null; }
      if (host.parentElement) host.parentElement.classList.remove('chat-min');
    } };
  }

  window.EpinoiaGameChat = { mount };
})();
