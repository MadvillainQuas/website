'use strict';
/* ============================================================================
   THE MANAGER ON EPINOIA GO (Louie, 2026-10-09: "The new manager leaderboards/tables etc. go into EPINOIA GO with a
   global and league by league leaderboard. It also has 'Leagues' link which shows all the leagues the user is in";
   "on its promo page on EPINOIA GO, can it promote the simulation's ability to correspond to reality (using your marks
   during simmed seasons testing the model)?").

   Any element with data-mgr-board draws, in the Manager's own skin (kit/mgboard.css):
     "full"    GO's leaderboards (#manager): the promise; the marks it rests on - manager/validation.json, written by
               tools/manager-validate.mjs from complete real seasons replayed club against club; the reader's own
               clubs, each in its league (their LEAGUES); and the board - every Manager club that has played, ranked
               by its winning share, then its points difference a game (manager_leaderboard, 0259) - every league,
               or one (a button per league with clubs on the board, manager_board_leagues; ?mlg=<slug> keeps it)
     "teaser"  GO's home: the promise in a line, the top three, the ways in
   A club shows by its own name, its manager's name and its badge (manager/core/badge.js; an uploaded image comes on
   its own, manager_badges) - never the account behind it. Every text goes in as text. Before 0259 is on the server
   the board says it is on its way, and nothing breaks.
   ============================================================================ */
(function () {
  const hosts = [...document.querySelectorAll('[data-mgr-board]')];
  if (!hosts.length) return;
  const CFG = window.EPINOIA_CONFIG || {};
  const ME = document.currentScript;
  const BASE = ME && ME.src ? new URL('../', ME.src).href : '../';          // epinoia/
  const Q = new URLSearchParams(location.search);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
  const num = v => Number(v || 0).toLocaleString();
  /* a small count in words, the way a sentence says it */
  const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const words = n => WORDS[n] || num(n);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  /* ------------------------------------------------------------- requests --- */
  async function token() {
    const A = window.EpinoiaAccess;
    if (A && typeof A.sessionReady === 'function') {
      try { const s = await A.sessionReady(); return s && s.token ? s.token : null; } catch (_) { return null; }
    }
    return null;
  }
  async function rpc(fn, args) {
    const h = { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' };
    const t = await token();
    if (t) h.Authorization = 'Bearer ' + t;
    const go = () => fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers: h, body: JSON.stringify(args || {}) });
    let r = await go();
    if (r.status === 401 && t) { delete h.Authorization; r = await go(); }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function rest(path, auth) {
    const h = { apikey: CFG.supabaseAnonKey };
    if (auth) h.Authorization = 'Bearer ' + auth;
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, { cache: 'no-store', headers: h });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  let marksP = null;
  const marks = () => marksP || (marksP = fetch(BASE + 'manager/validation.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null));

  /* a club's badge: the drawing, or its uploaded image once it has come (badge.svg escapes every field it writes) */
  function badge(b, size) {
    const s = el('span', 'mgb-badge');
    if (window.Mgr && window.Mgr.badge) s.innerHTML = window.Mgr.badge.svg(b || {}, size);
    return s;
  }
  async function images(slots) {
    if (!slots.size) return;
    let rows;
    try { rows = await rpc('manager_badges', { p_ids: [...slots.keys()].slice(0, 60) }); } catch (_) { return; }
    (Array.isArray(rows) ? rows : []).forEach(x => {
      const s = slots.get(x.id);
      if (!s || !x.img) return;
      s.forEach(({ el: host, b, size }) => { host.textContent = ''; host.appendChild(badge(Object.assign({}, b, { img: x.img }), size)); });
    });
  }
  const slot = (slots, r, size) => {
    const b = badge(r.badge, size);
    if (r.has_img) { if (!slots.has(r.id)) slots.set(r.id, []); slots.get(r.id).push({ el: b, b: r.badge, size }); }
    return b;
  };
  const pctOf = r => (r.pct == null ? '–' : Math.round(Number(r.pct) * 100) + '%');
  const diffOf = r => { const d = Number(r.diff || 0); return (d > 0 ? '+' : '') + d.toFixed(1); };

  /* ------------------------------------------------------------ the promise --- */
  function head(host, teaser) {
    const top = el('div', 'mgb-hero');
    const mk = el('div', 'mgb-mark');
    mk.appendChild(data('span', 'mgb-ep epinoia-mark', 'EPINOIΛ'));
    mk.appendChild(data('b', 'mgb-mg', 'MANAGER'));
    top.appendChild(mk);
    top.appendChild(el('p', 'mgb-pitch', 'Build a club from real players and play a real league’s season against its real clubs, game by game.'));
    const acts = el('div', 'mgb-acts');
    const open = el('a', 'mgb-btn pri', 'Open Manager');
    open.href = BASE + 'manager/';
    acts.appendChild(open);
    if (teaser) { const b = el('a', 'mgb-btn', 'Leaderboards'); b.href = BASE + 'go/leaderboards/#manager'; acts.appendChild(b); }
    top.appendChild(acts);
    host.appendChild(top);
  }
  /* THE MARKS: the model's seasons set against the real ones (tools/manager-validate.mjs) */
  function real(host, M, teaser) {
    if (!M || !M.summary || !Array.isArray(M.leagues) || !M.leagues.length) return;
    const S = M.summary;
    if (teaser) {
      const p = el('p', 'mgb-real-1');
      p.appendChild(el('span', null, 'Tested on ' + words(S.leagues) + ' complete real seasons: the simulated winning margins follow the real ones at '));
      p.appendChild(data('b', null, 'r\u00a0=\u00a0' + Number(S.r).toFixed(2)));   // one line, never broken
      p.appendChild(el('span', null, ', and the scoring lands within ' + Number(S.ppgGap).toFixed(1) + ' points a game.'));
      host.appendChild(p);
      return;
    }
    const box = el('div', 'mgb-real');
    box.appendChild(el('h3', null, 'Does it play like the real thing?'));
    box.appendChild(el('p', 'mgb-how', cap(words(S.leagues)) + ' complete real seasons replayed, every club against every other, home and away, ' + words(M.reps) +
      ' times: ' + num(S.games) + ' games, each club built from its own players’ numbers the way the Manager builds them, and set against what really happened.'));
    const grid = el('div', 'mgb-marks');
    [[Number(S.r).toFixed(2), 'how closely the clubs’ simulated winning margins follow their real ones (1 is perfect), each club as the Manager plays it'],
     [Number(S.rPlayers).toFixed(2), 'the same from the players alone: how your club is built'],
     [Number(S.ppgGap).toFixed(1), 'points a game between the simulated scoring and the real, on average']].forEach(([v, t]) => {
      const m = el('div', 'mgb-m');
      m.appendChild(data('b', null, v));
      m.appendChild(el('span', null, t));
      grid.appendChild(m);
    });
    box.appendChild(grid);
    box.appendChild(el('p', 'mgb-leg', 'League by league: each pair is simulated · real'));
    const tw = el('div', 'mgb-tw'), t = el('table', 'mgb-t');
    const hr = el('tr'), COLS = ['league', 'margins (r)', 'points a game', 'home wins', 'threes, of shots'];
    COLS.forEach(x => hr.appendChild(el('th', null, x)));
    const th = el('thead'); th.appendChild(hr); t.appendChild(th);
    const tb = el('tbody');
    /* each figure carries its column's name too, shown only where the table becomes a card a league (a phone) */
    const cell = (k, cls) => { const c = el('td', cls); c.appendChild(el('span', 'k', COLS[k])); return c; };
    const pair = (k, a, b, f) => { const c = cell(k); c.appendChild(data('b', null, f(a))); c.appendChild(el('span', 'sr', ' · ')); c.appendChild(data('span', 'sr', f(b))); return c; };
    M.leagues.forEach(L => {
      const tr = el('tr');
      const c0 = el('td');
      c0.appendChild(data('b', null, L.league));
      const sm = el('small');
      sm.appendChild(data('span', null, L.season));
      sm.appendChild(el('span', null, ' · ' + num(L.clubs) + ' clubs'));
      c0.appendChild(sm);
      tr.appendChild(c0);
      const rc = cell(1, 'hi');
      rc.appendChild(data('span', null, Number(L.r).toFixed(2)));
      tr.appendChild(rc);
      tr.appendChild(pair(2, L.ppgSim, L.ppgReal, v => Number(v).toFixed(1)));
      tr.appendChild(pair(3, L.homeSim, L.homeReal, v => Math.round(Number(v) * 100) + '%'));
      tr.appendChild(pair(4, L.p3rSim, L.p3rReal, v => Number(v).toFixed(1) + '%'));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    tw.appendChild(t);
    box.appendChild(tw);
    if (M.built) {
      const d = new Date(M.built + 'T12:00:00Z');
      box.appendChild(el('p', 'mgb-when', 'Measured ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) + ', and again whenever the model changes.'));
    }
    host.appendChild(box);
  }

  /* ---------------------------------------------------------- their leagues --- */
  /* the reader's own clubs, each in its league, where it stands - or how to get on the board */
  async function mine(host) {
    const card = el('div', 'mgb-mine');
    host.appendChild(card);
    const t = await token();
    const A = window.EpinoiaAccess;
    if (!t) {
      card.appendChild(el('span', 'mgb-mine-t', 'Sign in, then start a club in any league: it joins this board after its first game.'));
      const a = el('a', 'mgb-btn pri', 'Sign in');
      a.href = A && A.signinHref ? A.signinHref() : BASE + 'signin/?next=' + encodeURIComponent(location.pathname + location.search + location.hash);
      card.appendChild(a);
      return;
    }
    let clubs = [];
    try { clubs = await rest('manager_teams?select=id,name,manager,badge,league_id,status,w,l,gp,pos,of_n,played,rounds&order=created_at', t); } catch (_) { clubs = []; }
    if (!clubs.length) {
      card.appendChild(el('span', 'mgb-mine-t', 'You have no Manager club yet. Start one in any league: it joins this board after its first game.'));
      const a = el('a', 'mgb-btn pri', 'Start a club');
      a.href = BASE + 'manager/';
      card.appendChild(a);
      return;
    }
    let lg = new Map();
    try {
      const ids = [...new Set(clubs.map(c => c.league_id).filter(Boolean))];
      if (ids.length) (await rest('leagues?select=id,name&id=in.(' + ids.join(',') + ')')).forEach(L => lg.set(L.id, L.name));
    } catch (_) { lg = new Map(); }
    card.classList.add('has');
    clubs.forEach(c => {
      const a = el('a', 'mgb-mc');
      a.href = BASE + 'manager/';
      a.appendChild(badge(c.badge, 40));
      const tx = el('span', 't');
      tx.appendChild(data('b', null, c.name));
      tx.appendChild(data('span', null, (lg.get(c.league_id) || 'Manager') + (c.status === 'draft' ? ' · squad not confirmed' : '')));
      a.appendChild(tx);
      const rk = el('span', 'rk');
      if (Number(c.gp) > 0) {
        rk.appendChild(data('b', null, num(c.w) + '–' + num(c.l)));
        rk.appendChild(el('small', null, (c.pos ? c.pos + ' of ' + c.of_n + ' · ' : '') + num(c.played) + ' of ' + num(c.rounds) + ' rounds'));
      } else rk.appendChild(el('small', null, 'on the board after its first game'));
      a.appendChild(rk);
      card.appendChild(a);
    });
  }

  /* -------------------------------------------------------------- the board --- */
  const state = { league: null, leagues: [], limit: 50 };
  async function chips(host, redraw) {
    let rows = [];
    try { rows = await rpc('manager_board_leagues', {}); } catch (_) { rows = []; }
    state.leagues = Array.isArray(rows) ? rows : [];
    const want = Q.get('mlg');
    state.league = want ? state.leagues.find(L => L.league_slug === want) || null : null;
    const draw = () => {
      host.textContent = '';
      if (!state.leagues.length) { host.hidden = true; return; }
      host.hidden = false;
      const all = state.leagues.reduce((a, L) => a + Number(L.clubs || 0), 0);
      [[null, 'Every league', all]].concat(state.leagues.map(L => [L, L.league, L.clubs])).forEach(([L, label, n]) => {
        const b = el('button', 'mgb-chip' + (L === state.league ? ' on' : ''));
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(L === state.league));
        b.appendChild(L ? data('span', null, label) : el('span', null, label));
        b.appendChild(data('small', null, num(n)));
        b.addEventListener('click', () => {
          if (L === state.league) return;
          state.league = L; state.limit = 50;
          try {
            const u = new URL(location.href);
            if (L) u.searchParams.set('mlg', L.league_slug); else u.searchParams.delete('mlg');
            history.replaceState(null, '', u);
          } catch (_) { /* the address stays */ }
          draw(); redraw();
        });
        host.appendChild(b);
      });
    };
    draw();
  }
  async function board(host, teaser) {
    host.setAttribute('aria-busy', 'true');
    let rows;
    try { rows = await rpc('manager_leaderboard', { p_league: state.league ? state.league.league_id : null, p_limit: teaser ? 3 : state.limit }); } catch (e) {
      host.textContent = '';
      if (!teaser) host.appendChild(el('p', 'mgb-empty', e && e.status === 404 ? 'The Manager’s leaderboards are on their way.' : 'The board could not be read just now. Try again in a moment.'));
      host.setAttribute('aria-busy', 'false');
      return;
    }
    rows = Array.isArray(rows) ? rows : [];
    host.textContent = '';
    const slots = new Map();
    if (!rows.length) {
      if (!teaser) host.appendChild(el('p', 'mgb-empty', state.league ? 'No club in ' + state.league.league + ' has played a game yet.'
        : 'No Manager club has played a game yet: the first to finish a round leads the board.'));
      host.setAttribute('aria-busy', 'false');
      return;
    }
    if (teaser) {
      const ol = el('ol', 'mgb-top3');
      rows.slice(0, 3).forEach(r => {
        const li = el('li');
        li.appendChild(data('span', 'n', String(r.rank)));
        li.appendChild(slot(slots, r, 34));
        const t = el('span', 't');
        t.appendChild(data('b', null, r.name));
        t.appendChild(data('span', null, num(r.w) + '–' + num(r.l) + ' · ' + r.league));
        li.appendChild(t);
        ol.appendChild(li);
      });
      host.appendChild(ol);
      host.setAttribute('aria-busy', 'false');
      images(slots);
      return;
    }
    const top = rows.filter(r => Number(r.rank) <= 3).slice(0, 3);
    if (top.length === 3) {
      const pod = el('ol', 'mgb-pod');
      const MED = ['1st', '2nd', '3rd'];
      top.forEach(r => {
        const li = el('li', 'r' + Math.min(3, Number(r.rank)) + (r.me ? ' me' : ''));
        li.appendChild(data('span', 'md', MED[Number(r.rank) - 1] || r.rank + 'th'));
        li.appendChild(slot(slots, r, 64));
        li.appendChild(data('span', 'nm', r.name));
        li.appendChild(data('span', 'mn', r.manager));
        if (!state.league) li.appendChild(data('span', 'mgb-lg', r.league));
        li.appendChild(data('span', 'wl', num(r.w) + '–' + num(r.l)));
        li.appendChild(el('span', 'sub', pctOf(r) + ' · ' + diffOf(r) + ' a game'));
        pod.appendChild(li);
      });
      host.appendChild(pod);
    }
    const rest = top.length === 3 ? rows.slice(3) : rows;
    if (rest.length) {
      const list = el('ol', 'mgb-list');
      const hd = el('li', 'mgb-row hd');
      hd.setAttribute('aria-hidden', 'true');
      ['#', 'club', 'won–lost', '+/− a game', 'place'].forEach(x => hd.appendChild(el('span', null, x)));
      list.appendChild(hd);
      rest.forEach(r => {
        const li = el('li', 'mgb-row' + (r.me ? ' me' : ''));
        li.appendChild(data('span', 'rk', String(r.rank)));
        const who = el('span', 'who');
        who.appendChild(slot(slots, r, 30));
        const t = el('span', 't');
        t.appendChild(data('b', null, r.name));
        t.appendChild(data('span', null, r.manager + (state.league ? '' : ' · ' + r.league)));
        who.appendChild(t);
        li.appendChild(who);
        li.appendChild(data('span', 'wl', num(r.w) + '–' + num(r.l)));
        const d = Number(r.diff || 0);
        li.appendChild(data('span', 'df' + (d > 0 ? ' up' : d < 0 ? ' dn' : ''), diffOf(r)));
        const pl = el('span', 'pl');
        pl.appendChild(data('span', null, r.pos ? r.pos + ' of ' + r.of_n : '–'));
        pl.appendChild(el('small', null, num(r.played) + ' of ' + num(r.rounds) + ' rounds'));
        li.appendChild(pl);
        list.appendChild(li);
      });
      host.appendChild(list);
    }
    if (rows.length >= state.limit && state.limit < 500) {
      const more = el('button', 'mgb-btn mgb-more', 'show more');
      more.type = 'button';
      more.addEventListener('click', () => { state.limit = 500; board(host, false); });
      host.appendChild(more);
    }
    host.setAttribute('aria-busy', 'false');
    images(slots);
  }

  /* ------------------------------------------------------------------ draw --- */
  hosts.forEach(async host => {
    const teaser = host.getAttribute('data-mgr-board') === 'teaser';
    host.textContent = '';
    host.classList.add('mgb');
    if (teaser) host.classList.add('teaser');
    head(host, teaser);
    const realHost = el('div');
    host.appendChild(realHost);
    marks().then(M => real(realHost, M, teaser));
    if (teaser) {
      const b = el('div');
      host.appendChild(b);
      board(b, true);
      return;
    }
    const wrap = el('div', 'mgb-board');
    const bh = el('div', 'mgb-bh');
    bh.appendChild(el('h3', null, 'Leaderboard'));
    bh.appendChild(el('small', null, 'Ranked by winning share, then points difference a game'));
    wrap.appendChild(bh);
    const mineHost = el('div');
    wrap.appendChild(mineHost);
    const ch = el('div', 'mgb-chips');
    ch.setAttribute('role', 'radiogroup');
    ch.setAttribute('aria-label', 'Which league');
    wrap.appendChild(ch);
    const list = el('div');
    list.setAttribute('aria-live', 'polite');
    wrap.appendChild(list);
    host.appendChild(wrap);
    mine(mineHost);
    await chips(ch, () => board(list, false));
    board(list, false);
  });
})();
