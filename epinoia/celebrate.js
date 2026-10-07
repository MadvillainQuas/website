'use strict';
/* ============================================================================
   YOU CALLED IT — confetti in the top right corner when a fan's pick came right (0239 predictions, 0243).

   Loaded by nav.js on every page, for a signed-in fan only. Asks prediction_unseen_wins() when the page opens and
   every minute and a half while it is in view (so a game finishing while the fan is on the site is celebrated then),
   fires the confetti with a banner - "You got Leicester v Bristol right", or "You got 3 games right" with the first few
   listed - and marks them shown (prediction_mark_celebrated), so each right pick is celebrated once, on whichever
   device the fan is on first. Reduced motion: the banner, no confetti. Before 0243 is on the server (404) it stops.

   The canvas and the banner hang off <html>, not <body>: the kit zooms the body on a desktop, and a canvas inside it
   would be drawn in one set of pixels and shown in another.
   ============================================================================ */
(function (root) {
  if (root.__epCelebrate) return;
  root.__epCelebrate = true;
  const C = () => root.EPINOIA_CONFIG || {};
  const EVERY_MS = 90 * 1000;
  const me = document.querySelector('script[src*="celebrate.js"]');
  const BASE = me ? me.getAttribute('src').replace(/celebrate\.js.*$/, '') : '/epinoia/';
  const V = me ? ((/[?&]v=([^&#]+)/.exec(me.getAttribute('src')) || [])[1] || '') : '';
  const shown = new Set();              // this tab's, in case marking them fails
  let stopped = false, busy = false, timer = 0;

  /* ------------------------------------------------------------ session --- */
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
  async function token() {
    const A = root.EpinoiaAccess;
    if (A && typeof A.sessionReady === 'function') { try { const s = await A.sessionReady(); if (s && s.token) return s.token; } catch (_) { /* below */ } }
    const s = stored();
    return s && !(s.exp && s.exp * 1000 < Date.now()) ? s.token : null;
  }
  async function rpc(fn, body) {
    const t = await token();
    if (!t || !C().supabaseUrl) return null;
    const r = await fetch(C().supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store',
      headers: { apikey: C().supabaseAnonKey, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (r.status === 404) { stopped = true; return null; }      // before 0243
    if (!r.ok) return null;
    return r.json();
  }

  /* ---------------------------------------------------------------- look --- */
  function sheet() {
    if (document.getElementById('ep-cel-css')) return;
    const l = document.createElement('link');
    l.id = 'ep-cel-css'; l.rel = 'stylesheet'; l.href = BASE + 'kit/celebrate.css' + (V ? '?v=' + V : '');
    document.head.appendChild(l);
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const short = (n, s) => (s && s.length <= 5 ? s : String(n || '').split(/\s+/)[0]) || '';

  /* the confetti: a burst from the top right corner, thrown left and down, falling under gravity */
  function confetti() {
    if (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = document.createElement('canvas');
    cv.className = 'ep-cel-cv';
    cv.setAttribute('aria-hidden', 'true');
    const W = Math.min(520, root.innerWidth), H = Math.min(560, root.innerHeight);
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    document.documentElement.appendChild(cv);
    const x = cv.getContext('2d');
    x.scale(dpr, dpr);
    const COL = ['#ffe14d', '#93f2bf', '#8ff5ff', '#ff5f6b', '#b7a8ff', '#ffffff', '#3ddc84'];
    const P = [];
    for (let i = 0; i < 160; i++) {
      const a = Math.PI * (0.55 + Math.random() * 0.5);          // leftwards, from up-left to down-left
      const v = 5 + Math.random() * 9;
      P.push({ x: W - 18 - Math.random() * 16, y: 22 + Math.random() * 10, vx: Math.cos(a) * v, vy: -Math.sin(a) * v * 0.9 - 2,
               w: 5 + Math.random() * 6, h: 3 + Math.random() * 5, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.35,
               c: COL[i % COL.length], round: Math.random() < 0.25 });
    }
    const t0 = performance.now(), LIFE = 3200;
    const tick = t => {
      const age = t - t0;
      x.clearRect(0, 0, W, H);
      P.forEach(p => {
        p.vy += 0.24; p.vx *= 0.985; p.vy *= 0.99;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        x.save();
        x.globalAlpha = Math.max(0, 1 - Math.max(0, age - LIFE * 0.6) / (LIFE * 0.4));
        x.translate(p.x, p.y); x.rotate(p.r);
        x.fillStyle = p.c;
        if (p.round) { x.beginPath(); x.arc(0, 0, p.h / 1.4, 0, 6.28); x.fill(); }
        else x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
        x.restore();
      });
      if (age < LIFE) requestAnimationFrame(tick); else cv.remove();
    };
    requestAnimationFrame(tick);
  }

  /* the banner: what came right, the way to the boards; it goes by itself unless the pointer is on it */
  function banner(wins) {
    const old = document.querySelector('.ep-cel'); if (old) old.remove();
    const b = document.createElement('div');
    b.className = 'ep-cel';
    b.setAttribute('role', 'status');
    const one = wins.length === 1 ? wins[0] : null;
    const line = w => {
      const hs = short(w.home_name, w.home_short), as = short(w.away_name, w.away_short), mine = w.pick === 'home' ? hs : as;
      return '<li><span class="t">' + esc(hs) + ' <b>' + (+w.home_score) + '–' + (+w.away_score) + '</b> ' + esc(as) + '</span><span class="p">✓ ' + esc(mine) + '</span></li>';
    };
    b.innerHTML = '<div class="ep-cel-hd"><span>★ you called it</span><button type="button" aria-label="close">×</button></div>' +
      '<p class="ep-cel-t">' + (one
        ? 'You got <b>' + esc(one.home_name) + ' v ' + esc(one.away_name) + '</b> right'
        : 'You got <b>' + wins.length + ' games</b> right') + '</p>' +
      '<ul>' + wins.slice(0, 3).map(line).join('') + (wins.length > 3 ? '<li class="more">and ' + (wins.length - 3) + ' more</li>' : '') + '</ul>' +
      '<a class="ep-cel-go" href="' + esc(BASE + 'go/leaderboards/') + '">see the leaderboards →</a>';
    document.documentElement.appendChild(b);
    requestAnimationFrame(() => b.classList.add('on'));
    let t = 0;
    const go = () => { b.classList.remove('on'); setTimeout(() => b.remove(), 400); };
    const arm = () => { clearTimeout(t); t = setTimeout(go, 9000); };
    b.addEventListener('mouseenter', () => clearTimeout(t));
    b.addEventListener('mouseleave', arm);
    b.querySelector('button').addEventListener('click', go);
    arm();
  }

  /* --------------------------------------------------------------- check --- */
  async function check() {
    if (stopped || busy || document.hidden || !stored()) return;
    busy = true;
    try {
      const rows = await rpc('prediction_unseen_wins');
      const wins = (Array.isArray(rows) ? rows : []).filter(w => w && !shown.has(w.game_id));
      if (!wins.length) return;
      wins.forEach(w => shown.add(w.game_id));
      sheet();
      setTimeout(() => { confetti(); banner(wins); }, 250);              // the sheet a moment to land
      await rpc('prediction_mark_celebrated', { p_games: wins.map(w => w.game_id) });
    } catch (_) { /* next time */ }
    finally { busy = false; }
  }
  function loop() { clearTimeout(timer); if (!stopped) timer = setTimeout(() => { check().finally(loop); }, EVERY_MS); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  /* signed in from another tab: look now */
  root.addEventListener('storage', e => { if (e.key && /-auth-token$/.test(e.key)) check(); });
  const start = () => { setTimeout(() => { check().finally(loop); }, 1500); };
  if (document.readyState === 'complete') start(); else root.addEventListener('load', start, { once: true });

  root.EpinoiaCelebrate = { check, _confetti: confetti, _banner: banner };
})(typeof window !== 'undefined' ? window : globalThis);
