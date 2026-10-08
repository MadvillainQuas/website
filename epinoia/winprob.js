'use strict';
/* ============================================================================
   EPINOIΛ'S WIN PROBABILITY (Louie, 2026-10-08): the What wins model's chance for each side of a game
   (epinoia/winodds.js, run hourly by tools/build-odds.mjs, kept in model_picks, 0253), on the preview card (gamepeek.js,
   under the leading players) and the game's preview (game/preview.js, after the key players).

     EpinoiaWinProb.mount(host, gameId, { home, away, status, homeScore, awayScore })   fills host; empty when nothing to say

   Read through game_forecast (0253), which decides who sees it: signed in now, and a member once memberships gate the
   What wins model (gate_open 'model'). It answers one of:
     { locked: 'signin' }     signed out: a line asking them to sign in
     { locked: 'members' }    memberships on and not a member: a line to join
     { none: true }           no pick: both clubs have not yet played three games this season
     { p_home, pick, n, margin, model, record }   the bar in the two clubs' colours, the margin, the games behind it,
                              its record in the league; on a finished game, whether its pick came off
   Before 0253 is applied (404), and for a league the reader cannot see (null), nothing shows.
   Every text goes in as text. One read a game a page, kept a minute.
   ============================================================================ */
(function (root) {
  const C = () => root.EPINOIA_CONFIG || {};
  const BASE = (() => { try { return new URL('.', document.currentScript.src).href; } catch (_) { return '/epinoia/'; } })();
  const memo = new Map();          // game id -> { at, p }

  /* the session as predict.js has it: access.js refreshes a token that ran out; without it, the stored token */
  function stored() {
    try {
      const m = String(C().supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
      const raw = m ? localStorage.getItem('sb-' + m[1] + '-auth-token') : null;
      const j = raw && JSON.parse(raw);
      const tok = j && (j.access_token || (j.currentSession && j.currentSession.access_token));
      const exp = j && (j.expires_at || (j.currentSession && j.currentSession.expires_at));
      return tok && !(exp && exp * 1000 < Date.now()) ? tok : null;
    } catch (_) { return null; }
  }
  async function token() {
    const A = root.EpinoiaAccess;
    if (A && typeof A.sessionReady === 'function') {
      try { const s = await A.sessionReady(); if (s && s.token) return s.token; } catch (_) { /* below */ }
    }
    return stored();
  }
  async function read(id) {
    const t = await token();
    const h = { apikey: C().supabaseAnonKey, 'Content-Type': 'application/json' };
    if (t) h.Authorization = 'Bearer ' + t;
    const go = () => fetch(C().supabaseUrl + '/rest/v1/rpc/game_forecast', { method: 'POST', headers: h, body: JSON.stringify({ p_game: id }) });
    let r = await go();
    if (r.status === 401 && t) { delete h.Authorization; r = await go(); }
    if (r.status === 404) return null;                 // before 0253: nothing to show
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  function get(id) {
    const m = memo.get(id);
    if (m && Date.now() - m.at < 60000) return m.p;
    const p = read(id).catch(() => null);
    memo.set(id, { at: Date.now(), p });
    return p;
  }

  /* ------------------------------------------------------------- drawing --- */
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const nm = t => (t && (t.short_name || t.name)) || '';
  const hex = c => (/^#?[0-9a-f]{6}$/i.test(String(c || '')) ? (String(c)[0] === '#' ? c : '#' + c) : null);
  const here = () => location.pathname + location.search;
  const signin = () => { const A = root.EpinoiaAccess; return A && A.signinHref ? A.signinHref() : BASE + 'signin/?next=' + encodeURIComponent(here()); };
  const join = () => { const A = root.EpinoiaAccess; return A && A.joinHref ? A.joinHref({}) : BASE + 'join/?next=' + encodeURIComponent(here()); };
  const mark = () => { const b = el('b', 'wp-mk epinoia-mark', 'EPINOIΛ'); b.setAttribute('translate', 'no'); return b; };
  const pc = p => Math.round(100 * p);

  function draw(d, o) {
    const box = el('div', 'wp');
    const head = el('div', 'wp-k');
    head.appendChild(el('span', null, 'win probability'));
    head.appendChild(mark());
    box.appendChild(head);
    if (d.locked) {
      box.classList.add('wp-lock');
      const p = el('p', 'wp-say', d.locked === 'members' ? 'Members see the model’s chance for each side.' : 'Sign in to see the model’s chance for each side.');
      const a = el('a', 'wp-go', d.locked === 'members' ? 'become a member' : 'sign in');
      a.href = d.locked === 'members' ? join() : signin();
      box.append(p, a);
      return box;
    }
    if (d.none) {
      box.classList.add('wp-none');
      box.appendChild(el('p', 'wp-say', 'Once both clubs have played three games this season.'));
      return box;
    }
    const ph = Math.max(0, Math.min(1, +d.p_home)), h = pc(ph), a = 100 - h;
    const ch = hex(o.home && o.home.colour), ca = hex(o.away && o.away.colour);
    if (ch) box.style.setProperty('--wh', ch);
    if (ca) box.style.setProperty('--wa', ca);
    const nums = el('div', 'wp-nums');
    /* the favourite: wp-fav, not .fav (the favourites panel's class, styled site-wide) */
    const side = (t, v, k, fav) => { const s = el('span', 'wp-s ' + k + (fav ? ' wp-fav' : '')); s.appendChild(el('small', null, nm(t))); s.appendChild(el('b', null, v + '%')); return s; };
    const favH = ph >= 0.5;
    nums.appendChild(side(o.home, h, 'h', favH));
    const by = Math.abs(+d.margin);
    nums.appendChild(el('span', 'wp-by', isFinite(by) && by >= 0.5 ? nm(favH ? o.home : o.away) + ' by ' + by.toFixed(1) : 'a toss-up'));
    nums.appendChild(side(o.away, a, 'a', !favH));
    box.appendChild(nums);
    const bar = el('div', 'wp-bar');
    bar.setAttribute('role', 'img');
    bar.setAttribute('aria-label', nm(o.home) + ' ' + h + '%, ' + nm(o.away) + ' ' + a + '%');
    const uh = el('u', 'h'); uh.style.width = h + '%';
    const ua = el('u', 'a'); ua.style.width = a + '%';
    bar.append(uh, ua);
    box.appendChild(bar);
    const cap = [];
    const done = o.status === 'final' && o.homeScore != null && o.awayScore != null && +o.homeScore !== +o.awayScore;
    if (done) cap.push('picked ' + nm(favH ? o.home : o.away) + ' ' + (((+o.homeScore > +o.awayScore) === favH) ? '✓' : '✗'));
    else if (d.kind === 'record') cap.push('worked out from the games before it');
    if (Array.isArray(d.n) && d.n[0] != null) cap.push('after ' + d.n[0] + ' and ' + d.n[1] + ' games');
    const rec = d.record || {};
    if (+rec.decided > 0) cap.push(rec.right + ' of ' + rec.decided + ' right in this league');
    if (cap.length) box.appendChild(el('p', 'wp-cap' + (done ? (((+o.homeScore > +o.awayScore) === favH) ? ' hit' : ' miss') : ''), cap.join(' · ')));
    return box;
  }

  /* fills host (the caller's empty element); leaves it empty and hidden when there is nothing to say */
  async function mount(host, id, o) {
    if (!host || !id) return null;
    host.hidden = true;
    const d = await get(id);
    if (!host.isConnected) return d;
    host.textContent = '';
    if (!d || typeof d !== 'object') return d;
    host.appendChild(draw(d, o || {}));
    host.hidden = false;
    return d;
  }

  root.EpinoiaWinProb = { mount, get, _draw: draw };
})(typeof window !== 'undefined' ? window : globalThis);
