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
     { p_home, pick, n, margin, model, record, why }   the bar in the two clubs' colours, the margin, the games behind
                              it, its record in the league; on a finished game, whether its pick came off; the ⓘ beside
                              the margin opens why it leans (why, 0254)
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

  /* WHY IT LEANS (the ⓘ, Louie 2026-10-08): the pick's reasons (model_picks.why, 0254: winodds.js reasons()) as the side
     each favours and how strongly - one, two or three pips - never the model's numbers or weights; what the probability
     means; early in a season, that the numbers are still held close to the league's; and how it decides, in a line */
  /* the matchup's reasons by area and end (2026-10-09, winodds.js matchup()): a side's attack (diet ... ft) and its
     defence (the same with D) - so a club that gives a lot up at the rim shows as the other side's edge at guarding it */
  const LABEL = { home: 'Playing at home', rating: 'Strength this season', form: 'Recent form', rest: 'Rest and travel',
                  squad: 'Line-ups and positions', flow: 'Half court and transition',
                  diet: 'Getting good shots', dietD: 'Taking good shots away', rim: 'Scoring at the rim', rimD: 'Guarding the rim',
                  mid: 'Mid-range shooting', midD: 'Mid-range defence', three: 'Shooting threes', threeD: 'Defending the three',
                  shoot: 'Shooting', shootD: 'Shooting defence', ball: 'Ball security', ballD: 'Taking the ball away',
                  boards: 'Offensive boards', boardsD: 'Defensive boards', line: 'Drawing fouls', lineD: 'Defending without fouling',
                  ft: 'Free throws' };
  const LEVEL = ['a slight edge', 'a clear edge', 'a strong edge'];
  let uid = 0;
  function whyPanel(d, o, ph) {
    const favH = ph >= 0.5, pf = Math.max(ph, 1 - ph);
    const p = el('div', 'wp-why');
    p.id = 'wp-why-' + (++uid);
    p.hidden = true;
    const hd = el('p', 'wp-why-h');
    if (pf < 0.55) hd.textContent = 'Why it is close';
    else { hd.appendChild(el('span', null, 'Why it leans')); const b = el('b', null, nm(favH ? o.home : o.away)); b.setAttribute('translate', 'no'); hd.append(' ', b); }
    p.appendChild(hd);
    const list = el('ul', 'wp-why-l');
    (Array.isArray(d.why) ? d.why : []).forEach(r => {
      const k = r && r[0], v = r ? +r[1] : NaN;
      if (!LABEL[k] || !isFinite(v) || Math.abs(v) < 0.2 || list.childNodes.length >= 5) return;
      const forH = v > 0, lvl = Math.abs(v) >= 3 ? 3 : Math.abs(v) >= 1 ? 2 : 1;
      const li = el('li', forH ? 'h' : 'a');
      li.appendChild(el('span', 'wp-why-k', LABEL[k]));
      const who = el('span', 'wp-why-s', nm(forH ? o.home : o.away));
      who.setAttribute('translate', 'no');
      li.appendChild(who);
      const pips = el('span', 'wp-pips');
      pips.setAttribute('role', 'img');
      pips.setAttribute('aria-label', LEVEL[lvl - 1]);
      pips.title = LEVEL[lvl - 1];
      for (let i = 0; i < 3; i++) pips.appendChild(el('i', i < lvl ? 'on' : null));
      li.appendChild(pips);
      list.appendChild(li);
    });
    if (list.childNodes.length) p.appendChild(list);
    p.appendChild(el('p', 'wp-why-t', pf < 0.55 ? 'Close to a coin flip: the edges are small either way.'
      : 'Games like this go the favourite’s way about ' + Math.round(10 * pf) + ' times in 10.'));
    if (Array.isArray(d.n) && Math.min(+d.n[0], +d.n[1]) < 8) {
      p.appendChild(el('p', 'wp-why-t', 'Early in the season: each club’s numbers are still held close to the league’s until more games are in.'));
    }
    p.appendChild(el('p', 'wp-why-f', 'How it decides: how each club scores and defends against the league — where its shots come from and go in, the rim, turnovers, the glass, the free-throw line — adjusted for whom it has played, then its strength and form, line-ups, rest and the home court, weighed by what has won games across every league.'));
    return p;
  }
  /* the ⓘ: hovered with a mouse it opens and closes with the pointer; tapped or clicked it stays until tapped again */
  function whyButton(box, panel) {
    const b = el('button', 'wp-i', 'i');
    b.type = 'button';
    b.setAttribute('aria-label', 'why this pick');
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', panel.id);
    let pinned = false;
    const set = (on, bring) => {
      if (panel.hidden !== !on) {
        panel.hidden = !on; b.setAttribute('aria-expanded', String(on)); box.classList.toggle('wp-open', on);
        box.dispatchEvent(new CustomEvent('wp-size', { bubbles: true }));
      }
      /* opened by a tap or a click at the foot of a card that scrolls (the preview card on a short screen): brought into
         view inside it - never on a hover, which would slide the ⓘ out from under the pointer */
      const sc = on && bring && box.closest('.gk-in');
      if (sc) requestAnimationFrame(() => {
        const r = panel.getBoundingClientRect(), c = sc.getBoundingClientRect();
        if (r.bottom > c.bottom) sc.scrollTop += Math.min(r.bottom - c.bottom + 8, r.top - c.top);
      });
    };
    const fine = () => root.matchMedia && root.matchMedia('(hover:hover) and (pointer:fine)').matches;
    b.addEventListener('mouseenter', () => { if (fine()) set(true); });
    box.addEventListener('mouseleave', () => { if (!pinned) set(false); });
    /* not stopped here: the preview card hears it and locks itself open (gamepeek.js) */
    b.addEventListener('click', e => { e.preventDefault(); pinned = !pinned || panel.hidden; set(pinned, true); });
    return b;
  }

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
    const byEl = el('span', 'wp-by');
    byEl.appendChild(el('span', null, isFinite(by) && by >= 0.5 ? nm(favH ? o.home : o.away) + ' by ' + by.toFixed(1) : 'a toss-up'));
    const panel = whyPanel(d, o, ph);
    byEl.appendChild(whyButton(box, panel));
    nums.appendChild(byEl);
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
    box.appendChild(panel);
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
