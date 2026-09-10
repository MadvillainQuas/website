'use strict';
/* ============================================================================
   Follow — the bell beside a fixture, a club or a player.

   One tap follows; another unfollows. What "follow" means is in the fan's profile
   (fan_prefs, 0106/0107): a followed club brings its results and fixtures, a followed
   player his lines, a followed game its reminder and its score. Signed out, the bell
   leads to sign-in and back here.

   Reads the stored session the way nav.js does (no SDK on public pages), loads the
   fan's row once, and keeps every bell on the page for the same thing in step.
     window.EpinoiaFollow.bell('game' | 'team' | 'player', id, { label })  -> element
   ============================================================================ */
(function () {
  const C = () => window.EPINOIA_CONFIG || {};
  const KEY = { game: 'fav_game_ids', team: 'fav_team_ids', player: 'fav_player_ids' };
  const WHAT = { game: 'this game', team: 'this club', player: 'this player' };
  let prefs = null, loading = null, sess = null;

  function session() {
    if (sess !== null) return sess || null;
    sess = false;
    try {
      const m = String(C().supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
      const raw = m && localStorage.getItem('sb-' + m[1] + '-auth-token');
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
    loading = fetch(C().supabaseUrl + '/rest/v1/fan_prefs?select=fav_game_ids,fav_team_ids,fav_player_ids', { cache: 'no-store', headers: headers() })
      .then(r => r.ok ? r.json() : [])
      .then(rows => { prefs = rows[0] || { fav_game_ids: [], fav_team_ids: [], fav_player_ids: [] }; return prefs; })
      .catch(() => { prefs = { fav_game_ids: [], fav_team_ids: [], fav_player_ids: [] }; return prefs; });
    return loading;
  }
  const has = (kind, id) => !!(prefs && (prefs[KEY[kind]] || []).includes(id));

  async function toggle(kind, id) {
    await load();
    const k = KEY[kind];
    const cur = new Set(prefs[k] || []);
    if (cur.has(id)) cur.delete(id); else cur.add(id);
    prefs[k] = [...cur];
    paintAll(kind, id);
    const body = {}; body[k] = prefs[k];
    try {
      const r = await fetch(C().supabaseUrl + '/rest/v1/rpc/set_fan_prefs', { method: 'POST', headers: headers(), body: JSON.stringify({ p: body }) });
      if (!r.ok) throw new Error(String(r.status));
    } catch (_) {
      if (cur.has(id)) cur.delete(id); else cur.add(id);      // put it back
      prefs[k] = [...cur]; paintAll(kind, id);
    }
  }
  function paint(b) {
    const on = has(b.dataset.kind, b.dataset.id);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
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
                  (o.label ? '<span>' + o.label + '</span>' : '');
    b.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (!session()) {
        const root = (document.querySelector('script[src*="follow.js"]') || {}).getAttribute
          ? document.querySelector('script[src*="follow.js"]').getAttribute('src').replace(/follow\.js.*$/, '') : '';
        location.href = root + 'signin/?next=' + encodeURIComponent(location.pathname + location.search);
        return;
      }
      toggle(kind, id);
    });
    paint(b);
    load().then(() => paint(b));
    return b;
  }

  window.EpinoiaFollow = { bell, load, has, toggle, session };
})();
