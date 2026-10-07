'use strict';
/* ============================================================================
   PREDICTIONS — pick the winner (0239).

   A strip that hangs under a fixture card, and a larger one on a game's preview: the two clubs either side,
   each with the share of fans who picked them, over a bar split in the clubs' colours. A tap on a side picks
   it; a tap on the side already picked takes the pick back; the other side changes it. Picks close at
   tip-off. Afterwards the strip says whether the fan's pick was right.

     EpinoiaPredict.strip(game, { big, codes:[home, away] })  -> element (the card's strip, or the preview's)
     EpinoiaPredict.refresh()                                 -> ask again for every strip on the page

   ONE REQUEST FOR A PAGE OF CARDS. Each strip asks for its game; the asks are gathered for a moment and sent
   as one prediction_tally call (200 games at most), and every strip for that game — HOME can show the same
   game twice — is painted from the answer.

   SIGNED OUT, a tap asks to sign in (a small card under the strip), and the pick is remembered for fifteen
   minutes: back from sign-in, it is made for them.

   INSIDE A LINK. The card strip sits inside the fixture card's <a>, so every press on it is stopped there:
   only its two buttons act, and the space between them is not a way into the game.
   ============================================================================ */
(function (root) {
  const C = () => root.EPINOIA_CONFIG || {};
  const PENDING = 'epinoia.pred.pending';
  const tally = new Map();        // game id -> { home, away, mine, open }
  const want = new Set();
  let timer = 0;

  /* ------------------------------------------------------------- session --- */
  function stored() {
    try {
      const m = String(C().supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
      const raw = m ? localStorage.getItem('sb-' + m[1] + '-auth-token') : null;
      const j = raw && JSON.parse(raw);
      const tok = j && (j.access_token || (j.currentSession && j.currentSession.access_token));
      const exp = j && (j.expires_at || (j.currentSession && j.currentSession.expires_at));
      return tok ? { token: tok, exp: Number(exp) || 0 } : null;
    } catch (_) { return null; }
  }
  /* access.js, where the page has it, refreshes a token that has run out; without it an expired token is
     simply signed out, as follow.js has it */
  async function token() {
    const A = root.EpinoiaAccess;
    if (A && typeof A.sessionReady === 'function') {
      try { const s = await A.sessionReady(); if (s && s.token) return s.token; } catch (_) { /* below */ }
    }
    const s = stored();
    return s && !(s.exp && s.exp * 1000 < Date.now()) ? s.token : null;
  }

  async function rpc(fn, body) {
    const t = await token();
    const h = { apikey: C().supabaseAnonKey, 'Content-Type': 'application/json' };
    if (t) h.Authorization = 'Bearer ' + t;
    let r = await fetch(C().supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', headers: h, body: JSON.stringify(body) });
    if (r.status === 401 && t) {                       // a token refused: the read again, signed out
      delete h.Authorization;
      r = await fetch(C().supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', headers: h, body: JSON.stringify(body) });
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /* ---------------------------------------------------------------- tally --- */
  function ask(id) {
    if (!id) return;
    want.add(id);
    clearTimeout(timer);
    timer = setTimeout(flush, 60);
  }
  function flush() {
    const ids = [...want].slice(0, 200);
    ids.forEach(id => want.delete(id));
    if (want.size) timer = setTimeout(flush, 60);
    if (!ids.length || !C().supabaseUrl) return;
    rpc('prediction_tally', { p_games: ids }).then(rows => {
      (rows || []).forEach(r => tally.set(r.game_id, { home: +r.home || 0, away: +r.away || 0, mine: r.mine || null, open: !!r.open }));
      ids.forEach(id => { paintAll(id); applyPending(id); });
    }).catch(() => {
      /* not deployed yet (404), or the network: the strips stay as drawn, quiet */
      ids.forEach(id => document.querySelectorAll('[data-pred-game="' + id + '"]').forEach(el => el.classList.add('pr-off')));
    });
  }

  /* -------------------------------------------------------------- drawing --- */
  const node = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  function pcts(t) {
    const n = t.home + t.away;
    if (!n) return null;
    const h = Math.round(100 * t.home / n);
    return [h, 100 - h];
  }

  function strip(g, opts) {
    const o = opts || {};
    if (!g || !g.id || typeof document === 'undefined') return null;
    const s = node('span', 'ep-pred' + (o.big ? ' big' : ' fxc-pred'));
    s.setAttribute('data-pred-game', g.id);
    s.setAttribute('role', 'group');
    const codes = o.codes || [];
    const names = [(g.home && (g.home.name || g.home.short_name)) || 'Home', (g.away && (g.away.name || g.away.short_name)) || 'Away'];
    s.setAttribute('aria-label', 'who wins? ' + names[0] + ' or ' + names[1]);
    if (g.status === 'final' && g.home_score !== g.away_score) {
      s.setAttribute('data-res', +g.home_score > +g.away_score ? 'home' : 'away');
    }
    if (g.status && g.status !== 'scheduled') s.setAttribute('data-locked', '1');
    /* the clubs' colours for the bar (a card sets them on itself already) */
    const hex = c => (/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(c || '')) ? (String(c)[0] === '#' ? c : '#' + c) : null);
    const hc = hex(g.home && g.home.colour), ac = hex(g.away && g.away.colour);
    if (o.big && hc) s.style.setProperty('--h', hc);
    if (o.big && ac) s.style.setProperty('--a', ac);
    const side = (k, i) => {
      const b = node('button', 'pr-side ' + (k === 'home' ? 'h' : 'a'));
      b.type = 'button';
      b.setAttribute('data-side', k);
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', 'pick ' + names[i] + ' to win');
      const code = codes[i];
      const c = node('b', 'pr-code', (code && code.text) || names[i]);
      if (code && code.team) c.setAttribute('data-initials-team', code.team);
      const p = node('span', 'pr-pct', '–');
      if (k === 'home') { b.appendChild(c); b.appendChild(p); } else { b.appendChild(p); b.appendChild(c); }
      return b;
    };
    s.appendChild(side('home', 0));
    const mid = node('span', 'pr-mid');
    mid.appendChild(node('span', 'pr-q', 'who wins?'));
    mid.appendChild(node('span', 'pr-n', ''));
    s.appendChild(mid);
    /* the middle opens the game at a glance (gamepeek.js, on the pages that load it): hover it, or tap it */
    if (!o.big && root.EpinoiaPeek && g.competition_id) root.EpinoiaPeek.attach(mid, g);
    s.appendChild(side('away', 1));
    const bar = node('span', 'pr-bar');
    bar.setAttribute('aria-hidden', 'true');
    bar.appendChild(node('i', 'h')); bar.appendChild(node('i', 'a'));
    s.appendChild(bar);
    s.addEventListener('click', onClick);
    if (tally.has(g.id)) paint(s); else ask(g.id);
    wire();
    return s;
  }

  function paint(s) {
    const id = s.getAttribute('data-pred-game');
    const t = tally.get(id);
    if (!t) return;
    s.classList.remove('pr-off');
    const open = t.open && !s.hasAttribute('data-locked');
    s.classList.toggle('open', open);
    s.classList.toggle('shut', !open);
    const p = pcts(t);
    const n = t.home + t.away;
    s.style.setProperty('--ph', (p ? p[0] : 50) + '%');
    s.classList.toggle('none', !p);
    const res = s.getAttribute('data-res');
    s.querySelectorAll('.pr-side').forEach((b, i) => {
      const k = b.getAttribute('data-side');
      b.querySelector('.pr-pct').textContent = p ? p[i] + '%' : '–';
      const mine = t.mine === k;
      b.classList.toggle('mine', mine);
      b.classList.toggle('won', res === k);
      b.classList.toggle('lead', !!p && p[i] > p[1 - i]);
      b.setAttribute('aria-pressed', String(mine));
      b.disabled = !open;
    });
    const q = s.querySelector('.pr-q'), cnt = s.querySelector('.pr-n');
    let say = 'who wins?';
    if (res && t.mine) say = t.mine === res ? '✓ called it' : '✗ not this time';
    else if (res) say = 'fans picked';
    else if (!open) say = t.mine ? 'your pick is in' : 'picks closed';
    else if (t.mine) say = 'your pick';
    q.textContent = say;
    s.classList.toggle('right', !!(res && t.mine === res));
    s.classList.toggle('wrong', !!(res && t.mine && t.mine !== res));
    cnt.textContent = n ? n + (n === 1 ? ' pick' : ' picks') : (open ? 'tap a side' : '');
  }
  function paintAll(id) {
    document.querySelectorAll('[data-pred-game="' + id + '"]').forEach(paint);
  }

  /* -------------------------------------------------------------- picking --- */
  async function onClick(e) {
    e.preventDefault(); e.stopPropagation();
    const b = e.target.closest('.pr-side');
    const s = e.currentTarget;
    if (!b || b.disabled) return;
    const id = s.getAttribute('data-pred-game');
    const k = b.getAttribute('data-side');
    const t = tally.get(id);
    if (!t || !t.open) return;
    if (!stored() || !(await token())) { askSignin(s, id, k); return; }
    await pick(id, t.mine === k ? null : k, s);
  }
  async function pick(id, k, from) {
    const t = tally.get(id);
    if (!t) return;
    const was = Object.assign({}, t);
    /* drawn at once, put right by the answer */
    if (t.mine) t[t.mine] = Math.max(0, t[t.mine] - 1);
    if (k) t[k] += 1;
    t.mine = k;
    paintAll(id);
    try {
      const r = await rpc('predict_game', { p_game: id, p_pick: k });
      if (r && r.reason === 'signed_out') { tally.set(id, was); paintAll(id); if (from) askSignin(from, id, k); return; }
      if (r && r.home != null) tally.set(id, { home: +r.home || 0, away: +r.away || 0, mine: r.mine || null, open: !!r.open });
      paintAll(id);
      if (r && r.ok === false && from) say(from, r.reason === 'locked' ? 'picks have closed for this game' : 'that pick could not be saved');
      else if (r && r.ok) {
        try { root.dispatchEvent(new CustomEvent('epinoia:prediction', { detail: { game: id, pick: k } })); } catch (_) { /* a nicety */ }
      }
    } catch (_) {
      tally.set(id, was); paintAll(id);
      if (from) say(from, 'not saved — try again');
    }
  }

  /* a word under the strip, for a moment */
  function say(s, text) {
    let m = s.querySelector('.pr-say');
    if (!m) { m = node('span', 'pr-say'); s.appendChild(m); }
    m.textContent = text;
    s.classList.add('saying');
    clearTimeout(m._t);
    m._t = setTimeout(() => s.classList.remove('saying'), 2600);
  }

  /* ---------------------------------------------------------- signing in --- */
  function signinHref() {
    const A = root.EpinoiaAccess;
    const next = location.pathname + location.search;
    if (A && typeof A.signinHref === 'function') return A.signinHref(next);
    const me = document.querySelector('script[src*="predict.js"]');
    const base = me ? me.getAttribute('src').replace(/predict\.js.*$/, '') : '/epinoia/';
    return base + 'signin/?next=' + encodeURIComponent(next);
  }
  let card = null;
  function askSignin(s, id, k) {
    try { sessionStorage.setItem(PENDING, JSON.stringify({ g: id, k, at: Date.now() })); } catch (_) { /* the pick is just not remembered */ }
    if (!card) {
      card = node('div', 'ep-pred-signin');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'sign in to predict');
      card.innerHTML = '<b>Sign in to make your pick</b><span>Your picks go on the leaderboards, for this league and for all of EPINOIA.</span>' +
        '<span class="acts"><a class="go" href="#">Sign in</a><button type="button" class="no">Not now</button></span>';
      card.addEventListener('click', e => {
        e.stopPropagation();
        if (e.target.closest('.no')) { e.preventDefault(); shut(); }
      });
      document.body.appendChild(card);
    }
    card.querySelector('.go').href = signinHref();
    card.classList.add('on');
    placeCard(s);
    setTimeout(() => card.querySelector('.go').focus({ preventScroll: true }), 0);
  }
  function shut() { if (card) card.classList.remove('on'); }
  function placeCard(s) {
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const r = s.getBoundingClientRect();
    const vw = root.innerWidth / z, vh = root.innerHeight / z;
    const W = Math.min(280, vw - 24);
    card.style.width = W + 'px';
    const left = Math.max(12, Math.min(vw - W - 12, (r.left + r.width / 2) / z - W / 2));
    card.style.left = left + 'px';
    const h = card.offsetHeight;
    const below = r.bottom / z + 8;
    card.style.top = (below + h <= vh - 8 ? below : Math.max(8, r.top / z - 8 - h)) + 'px';
  }

  /* back from sign-in: the pick they tried to make */
  function applyPending(id) {
    let p = null;
    try { p = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch (_) { p = null; }
    if (!p || p.g !== id) return;
    if (!stored()) return;
    try { sessionStorage.removeItem(PENDING); } catch (_) { /* fine */ }
    const t = tally.get(id);
    if (!t || !t.open || Date.now() - (+p.at || 0) > 15 * 60 * 1000 || t.mine === p.k) return;
    const s = document.querySelector('[data-pred-game="' + id + '"]');
    pick(id, p.k === 'away' ? 'away' : 'home', s);
  }

  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    document.addEventListener('click', e => { if (card && card.classList.contains('on') && !e.target.closest('.ep-pred-signin')) shut(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') shut(); });
    root.addEventListener('scroll', shut, { passive: true, capture: true });
    /* signed in or out in another tab: the picks are someone else's now */
    root.addEventListener('storage', e => { if (e.key && /-auth-token$/.test(e.key)) refresh(); });
  }

  function refresh() {
    tally.clear();
    document.querySelectorAll('[data-pred-game]').forEach(el => ask(el.getAttribute('data-pred-game')));
  }

  root.EpinoiaPredict = { strip, refresh, _pcts: pcts };
})(typeof window !== 'undefined' ? window : globalThis);
