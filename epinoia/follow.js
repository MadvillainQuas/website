'use strict';
/* ============================================================================
   Follow — the bell beside a fixture, a club or a player.

   One tap follows; another unfollows. What "follow" means is in the fan's profile
   (fan_prefs, 0106/0107): a followed club brings its results and fixtures, a followed
   player his lines, a followed game its reminder and its score. Signed out, the bell
   leads to sign-in and back here.

   Reads the stored session the way nav.js does (no SDK on public pages), loads the
   fan's row once, and keeps every bell on the page for the same thing in step.
     window.EpinoiaFollow.bell('game' | 'team' | 'player' | 'league', id, { label, name })  -> element

   A LEAGUE IS THE WHOLE LEAGUE (0133): following one brings every game in it, and every
   game of a club that joins it later, because the audience expands the league into its
   clubs when the notices are made rather than when the follow was saved.

   A FOLLOW IS WHEN A PHONE IS WORTH ASKING ABOUT (docs/notifications.md §5). Once a
   follow has saved, push.js is loaded (beside this file, same version stamp) and
   offers to turn notifications on for `name` — "this club" when the bell was not
   given one. push.js itself stays down when they are already on, blocked, not
   possible in this browser, or were turned down in the last fortnight.
   ============================================================================ */
(function () {
  const C = () => window.EPINOIA_CONFIG || {};
  const KEY = { game: 'fav_game_ids', team: 'fav_team_ids', player: 'fav_player_ids',
                league: 'fav_league_ids' };
  const WHAT = { game: 'this game', team: 'this club', player: 'this player',
                 league: 'every game in this league' };
  let prefs = null, loading = null, sess = null;
  /* which follow lists this database actually has. A page asks before it mounts a bell for
     one the database has never heard of, because the write would be quietly ignored and the
     bell would sit there lit, having saved nothing. */
  let cols = null;

  /* THE TOKEN IS RE-READ, NOT REMEMBERED.

     This parsed localStorage once and kept the answer for the life of the page,
     which was fine while nothing else refreshed the session — and stopped being
     fine the moment a page did. access.js trades an expiring refresh token for
     a new one and writes it back to the same key, and Supabase ROTATES on
     refresh: the token this file was still holding is then dead. Every write
     after that 401s, and because a failed follow used to revert in silence, the
     bell simply did nothing for ever.

     It bit the private league first and only, because a private league's page is
     the one that calls sessionReady() — the refresh — before the bell is built
     (home.js resolves the league as the account). Nothing about following a
     private league was ever different; the page around it was.

     Re-reading is one synchronous localStorage hit and a JSON.parse, and the
     parse is skipped while the raw string has not changed, so the common case
     costs a string comparison. `sess` stays as the memo, keyed on that string. */
  let rawSeen = null;
  function session() {
    let raw = null;
    try {
      const m = String(C().supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
      raw = m ? localStorage.getItem('sb-' + m[1] + '-auth-token') : null;
    } catch (_) { return null; }                 // private mode: as before, no session
    if (raw === rawSeen) return sess || null;    // unchanged since we last looked
    rawSeen = raw;
    sess = false;
    try {
      const j = raw && JSON.parse(raw);
      const tok = j && (j.access_token || (j.currentSession && j.currentSession.access_token));
      const exp = j && (j.expires_at || (j.currentSession && j.currentSession.expires_at));
      if (tok && !(exp && Number(exp) * 1000 < Date.now())) sess = { token: tok };
    } catch (_) { sess = false; }
    return sess || null;
  }
  const headers = () => ({ apikey: C().supabaseAnonKey, Authorization: 'Bearer ' + session().token, 'Content-Type': 'application/json' });

  function load() {
    if (prefs) return Promise.resolve(prefs);
    if (loading) return loading;
    if (!session()) return Promise.resolve(null);
    /* fav_league_ids arrived in 0133. A browser holding this file from cache against a
       database that has not taken the migration yet would get a 400 and no bells at all,
       so the column is dropped and the read repeated; a league bell is simply off until
       the migration lands, and every other bell works as it always did. */
    const BLANK = { fav_game_ids: [], fav_team_ids: [], fav_player_ids: [], fav_league_ids: [] };
    const read = cols => fetch(C().supabaseUrl + '/rest/v1/fan_prefs?select=' + cols,
      { cache: 'no-store', headers: headers() }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); });
    loading = read('fav_game_ids,fav_team_ids,fav_player_ids,fav_league_ids')
      .then(rows => { cols = ['fav_game_ids', 'fav_team_ids', 'fav_player_ids', 'fav_league_ids']; return rows; })
      .catch(() => read('fav_game_ids,fav_team_ids,fav_player_ids')
        .then(rows => { cols = ['fav_game_ids', 'fav_team_ids', 'fav_player_ids']; return rows; }))
      .then(rows => { prefs = Object.assign({}, BLANK, rows[0] || {}); return prefs; })
      .catch(() => { prefs = Object.assign({}, BLANK); return prefs; });
    return loading;
  }
  const has = (kind, id) => !!(prefs && (prefs[KEY[kind]] || []).includes(id));

  async function toggle(kind, id, name) {
    await load();
    const k = KEY[kind];
    const cur = new Set(prefs[k] || []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    prefs[k] = [...cur];
    paintAll(kind, id);
    const body = {}; body[k] = prefs[k];
    try {
      const send = () => fetch(C().supabaseUrl + '/rest/v1/rpc/set_fan_prefs',
        { method: 'POST', headers: headers(), body: JSON.stringify({ p: body }) });
      let r = await send();
      /* ONE RETRY ON 401. The token can rotate between the moment this page
         built its headers and the moment the write goes out — another tab
         refreshing, or this page's own access.js doing it. session() re-reads
         the store, so the second attempt carries the new one; a 401 that is
         really "not signed in" fails again immediately and is reported. */
      if (r.status === 401) { rawSeen = null; r = await send(); }
      if (!r.ok) {
        /* THE REASON, NOT JUST THE REVERT. This threw away everything the
           server said and put the bell back, so a follow that would not save
           looked exactly like a bell that ignored the tap — nothing on screen,
           nothing in the console, nothing to report but "it errors". The
           database's own message is the useful part (a full follow list and a
           refused write read completely differently) and it is carried back to
           the caller to show. */
        let why = 'HTTP ' + r.status;
        try {
          const j = await r.json();
          why = (j && (j.message || j.hint || j.details)) || why;
        } catch (_) { /* not JSON; the status stands */ }
        throw new Error(why);
      }
    } catch (e) {
      if (cur.has(id)) cur.delete(id); else cur.add(id);      // put it back
      prefs[k] = [...cur]; paintAll(kind, id);
      return { ok: false, reason: (e && e.message) || 'could not be saved' };
    }
    if (cur.has(id)) offerPush(kind, name);                   // followed, and saved
    return { ok: true, on: cur.has(id) };
  }

  /* push.js, fetched the first time a follow needs it: from beside this file, with
     this file's own ?v= so the two cannot come from different deploys */
  let pushLoading = null;
  function loadPush() {
    if (window.EpinoiaPush) return Promise.resolve(window.EpinoiaPush);
    if (pushLoading) return pushLoading;
    pushLoading = new Promise((resolve, reject) => {
      const me = document.querySelector('script[src*="follow.js"]');
      const src = me ? me.getAttribute('src').replace(/follow\.js(?=[?#]|$)/, 'push.js') : '/epinoia/push.js';
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.addEventListener('load', () => (window.EpinoiaPush ? resolve(window.EpinoiaPush) : reject(new Error('push.js is empty'))));
      s.addEventListener('error', () => { pushLoading = null; reject(new Error('push.js could not be loaded')); });
      document.head.appendChild(s);
    });
    return pushLoading;
  }
  function offerPush(kind, name) {
    loadPush()
      .then(P => P.offer({ name: name || WHAT[kind], kind }))
      .catch(() => { /* the follow saved; the offer is a nicety */ });
  }
  function paint(b) {
    const on = has(b.dataset.kind, b.dataset.id);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    /* A LABELLED BELL SAYS WHICH IT IS. "Follow the league" in a lit pill is a sentence
       arguing with its own colour; a caller that gives both words gets the right one. */
    const sp = b.dataset.labelOn ? b.querySelector('span') : null;
    if (sp) sp.textContent = on ? b.dataset.labelOn : (b.dataset.labelOff || sp.textContent);
    b.title = session() ? ((on ? 'following ' : 'follow ') + WHAT[b.dataset.kind] + (on ? ' — tap to stop' : ' — results and fixtures in your bell'))
                        : 'sign in to follow ' + WHAT[b.dataset.kind];
  }
  function paintAll(kind, id) {
    document.querySelectorAll('.ep-follow[data-kind="' + kind + '"][data-id="' + id + '"]').forEach(paint);
  }

  function bell(kind, id, opts) {
    const o = opts || {};
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ep-follow' + (o.cls ? ' ' + o.cls : '');
    b.dataset.kind = kind; b.dataset.id = id;
    b.setAttribute('aria-label', 'follow ' + WHAT[kind]);
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>' +
                  (o.label ? '<span></span>' : '');
    if (o.label) {
      b.dataset.labelOff = o.label;
      b.dataset.labelOn = o.labelOn || o.label;
      b.querySelector('span').textContent = o.label;
    }
    b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (!session()) {
        const root = (document.querySelector('script[src*="follow.js"]') || {}).getAttribute
          ? document.querySelector('script[src*="follow.js"]').getAttribute('src').replace(/follow\.js.*$/, '') : '';
        location.href = root + 'signin/?next=' + encodeURIComponent(location.pathname + location.search);
        return;
      }
      /* A refusal is SAID, on the bell that was pressed. Reverting in silence is
         indistinguishable from a dead button. */
      toggle(kind, id, o.name).then(res => {
        if (!res || res.ok) return;
        const sp = b.querySelector('span');
        const was = sp ? sp.textContent : '';
        b.title = 'not saved: ' + res.reason;
        b.classList.add('failed');
        if (sp) sp.textContent = 'not saved';
        setTimeout(() => { if (sp) sp.textContent = was; b.classList.remove('failed'); paint(b); }, 3200);
      });
    });
    paint(b);
    load().then(() => paint(b));
    return b;
  }

  /* Does this database hold that follow list? Unknown until the fan's row has been read, so
     a caller awaits load() first; signed out it is unknowable and the answer is no, which is
     right — the bell would lead to sign-in and the answer would be known by then. */
  const supports = kind => !!(cols && cols.indexOf(KEY[kind]) >= 0);

  window.EpinoiaFollow = { bell, load, has, toggle, session, supports };
})();
