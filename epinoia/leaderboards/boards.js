'use strict';
/* ============================================================================
   THE LEADERBOARDS — a league's (leaderboards/?l=<slug>) and EPINOIA GO's (go/leaderboards/[?lg=<slug>]).

   Built to the page standard. The frame says which (data-scope="league" or "all"):
     PREDICTIONS      prediction_board (0239): every fan who has picked, ranked by the winners they called, then by
                      how often they were right; ties share a rank. All time, this month or this week. The first
                      three on a podium, the rest in a list; the reader's own line above it (prediction_mine), with
                      their rank even when it is further down than the list goes. GO's page adds a button per
                      league that has picks (prediction_leagues), and remembers the choice in the address (?lg=).
     EPINOIΛ          the What wins model as a competitor of its own (prediction_model, 0253), pinned above the fans.
     ARENAS STAMPED   (the league's page) the league's EPINOIA GO board by arenas (go_leaderboard, 0166), away while
                      it is empty or before GO's functions exist.

   A fan shows by their username, or by a fixed tag ("fan-3f2a1") that says nothing about them. Every text goes in
   as text. Before 0239 is on the server the board says the boards are on their way, and nothing breaks.
   ============================================================================ */
(function () {
  const CFG = window.EPINOIA_CONFIG || {};
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
  const FRAME = $('#boards');
  const SCOPE = FRAME ? FRAME.getAttribute('data-scope') : 'league';
  const ROOT = SCOPE === 'all' ? '../../' : '../';
  const Q = new URLSearchParams(location.search);
  const num = v => Number(v || 0).toLocaleString();
  const hex = c => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : null);

  /* ------------------------------------------------------------- requests --- */
  async function token() {
    const A = window.EpinoiaAccess;
    if (A && typeof A.sessionReady === 'function') {
      try { const s = await A.sessionReady(); return s && s.token ? s.token : null; } catch (_) { return null; }
    }
    return null;
  }
  async function rpc(fn, args, opts) {
    const h = { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' };
    const t = opts && opts.anon ? null : await token();
    if (t) h.Authorization = 'Bearer ' + t;
    let r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers: h, body: JSON.stringify(args || {}) });
    if (r.status === 401 && t) { delete h.Authorization; r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers: h, body: JSON.stringify(args || {}) }); }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function rest(path) {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /* ---------------------------------------------------------------- state --- */
  const state = { league: null, when: 'all', limit: 100 };
  const WHEN = [['all', 'All time'], ['month', 'This month'], ['week', 'This week']];
  function since(w) {
    const d = new Date();
    if (w === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
    if (w === 'week') { const day = (d.getDay() + 6) % 7; return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).toISOString(); }
    return null;
  }

  function chips(host, items, cur, onPick) {
    host.textContent = '';
    items.forEach(([k, label, sub]) => {
      const b = el('button', 'lb-chip' + (k === cur ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(k === cur));
      b.appendChild(el('span', null, label));
      if (sub != null) b.appendChild(el('small', null, sub));
      b.addEventListener('click', () => { if (k !== cur) onPick(k); });
      host.appendChild(b);
    });
  }

  /* --------------------------------------------------------------- boards --- */
  /* the fan's name: to their page when it is public (fan/?u=, 0197) */
  const nameEl = r => {
    const f = r.face;
    const link = f && f.u && f.shown;
    const n = data(link ? 'a' : 'span', 'lb-name' + (r.named ? '' : ' tag'), r.named ? '@' + r.name : r.name);
    if (link) n.href = ROOT + 'fan/?u=' + encodeURIComponent(f.u);
    return n;
  };
  /* THEIR FACE (Louie, 2026-10-07): the photo circle, their colour and the crest of the club they support, as set in
     YOUR HUB - only for a fan whose page is public; anybody else is their initials on a colour made from their name */
  const F = window.EpinoiaFace;
  const face = r => {
    const c = F ? F.circle(r.face || null, r.name) : el('span');   // sized by kit/boards.css
    return admin && r.face && r.face.u && r.face.shown ? modWrap(c, r) : c;
  };

  /* ------------------------------------------------------------ moderation --- */
  /* A PLATFORM ADMINISTRATOR moderates from the board (Louie, 2026-10-07): hovering a fan's circle shows a flag; the flag
     opens a card to reject their picture, or the whole of what their page shows, with a reason - and to warn them in
     their bell (moderate_fan, 0239). Only a fan whose page is public has anything shown to moderate. */
  let admin = false;
  async function checkAdmin() {
    if (!(await token())) return false;
    try { admin = (await rpc('is_platform_admin', {})) === true; } catch (_) { admin = false; }
    return admin;
  }
  function modWrap(circle, r) {
    const w = el('span', 'lb-facemod');
    w.appendChild(circle);
    const b = el('button', 'lb-modbtn', '⚑');
    b.type = 'button';
    b.title = 'moderate @' + r.face.u;
    b.setAttribute('aria-label', 'moderate @' + r.face.u);
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMod(r, b); });
    w.appendChild(b);
    return w;
  }
  const REASONS = ['Inappropriate', 'Offensive', 'Impersonation', 'Not theirs to use', 'Spam or advertising'];
  let modCard = null;
  async function openMod(r, from) {
    if (modCard) modCard.remove();
    const f = r.face;
    const card = modCard = el('div', 'lb-modcard');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'moderate @' + f.u);
    const hd = el('div', 'lb-mod-hd');
    hd.appendChild(el('span', null, '⚑ moderate'));
    const x = el('button', 'lb-mod-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'close');
    x.addEventListener('click', () => card.remove());
    hd.appendChild(x);
    card.appendChild(hd);
    const who = el('div', 'lb-mod-who');
    if (F) who.appendChild(F.circle(f, r.name));
    const wt = el('div');
    wt.appendChild(data('b', null, '@' + f.u));
    const cnt = el('small', null, 'warnings so far: …');
    wt.appendChild(cnt);
    who.appendChild(wt);
    card.appendChild(who);
    rpc('fan_moderation_count', { p_username: f.u }).then(n => { cnt.textContent = 'warnings so far: ' + (n == null ? '?' : n); }).catch(() => { cnt.textContent = ''; });
    const whatG = el('div', 'lb-mod-what');
    let what = 'picture';
    [['picture', 'Reject the picture'], ['profile', 'Reset their whole page']].forEach(([k, label]) => {
      const b = el('button', 'lb-mod-opt' + (k === what ? ' on' : ''), label); b.type = 'button';
      b.addEventListener('click', () => { what = k; whatG.querySelectorAll('.lb-mod-opt').forEach(o => o.classList.toggle('on', o === b)); });
      whatG.appendChild(b);
    });
    card.appendChild(whatG);
    const rs = el('div', 'lb-mod-reasons');
    let reason = REASONS[0];
    REASONS.forEach(t => {
      const b = el('button', 'lb-chip' + (t === reason ? ' on' : ''), t); b.type = 'button';
      b.addEventListener('click', () => { reason = t; rs.querySelectorAll('.lb-chip').forEach(o => o.classList.toggle('on', o === b)); });
      rs.appendChild(b);
    });
    card.appendChild(el('span', 'lb-mod-l', 'why'));
    card.appendChild(rs);
    const note = el('input', 'ep-input lb-mod-note'); note.maxLength = 120; note.placeholder = 'a note for them (optional)';
    card.appendChild(note);
    const wl = el('label', 'lb-mod-warn');
    const warn = el('input'); warn.type = 'checkbox'; warn.checked = true;
    wl.append(warn, el('span', null, 'Warn them, in their bell'));
    card.appendChild(wl);
    const msg = el('p', 'lb-mod-msg'); msg.setAttribute('role', 'status');
    const acts = el('div', 'lb-mod-acts');
    const go = el('button', 'lb-mod-go', 'Reject'); go.type = 'button';
    const no = el('button', 'lb-mod-no', 'Cancel'); no.type = 'button';
    no.addEventListener('click', () => card.remove());
    go.addEventListener('click', async () => {
      go.disabled = true; msg.textContent = 'Rejecting…';
      try {
        const res = await rpc('moderate_fan', { p_username: f.u, p_what: what, p_reason: reason + (note.value.trim() ? ' (' + note.value.trim() + ')' : ''), p_warn: warn.checked });
        if (!res || !res.ok) { msg.textContent = 'Not done: ' + ((res && res.reason) || 'refused'); go.disabled = false; return; }
        msg.textContent = (what === 'picture' ? 'Picture removed' : 'Page reset') + (warn.checked ? ' · warning ' + res.warnings + ' sent' : '');
        setTimeout(() => { card.remove(); drawPredictions(); }, 1100);
      } catch (e) { msg.textContent = 'Not done: ' + e.message; go.disabled = false; }
    });
    acts.append(go, no);
    card.append(acts, msg);
    document.body.appendChild(card);
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const rr = from.getBoundingClientRect();
    const vw = innerWidth / z, vh = innerHeight / z, W = Math.min(320, vw - 24);
    card.style.width = W + 'px';
    card.style.left = Math.max(12, Math.min(vw - W - 12, rr.left / z - 20)) + 'px';
    const h = card.offsetHeight;
    card.style.top = (rr.bottom / z + 8 + h <= vh - 8 ? rr.bottom / z + 8 : Math.max(8, rr.top / z - 8 - h)) + 'px';
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modCard) modCard.remove(); });
  const tintOf = r => (F ? F.tint(r.face || null, r.name) : 'var(--bc)');
  function clubChip(r) {
    const c = r.face && r.face.club;
    if (!c || !c.name) return null;
    const a = el(c.slug ? 'a' : 'span', 'lb-club');
    if (c.slug) a.href = ROOT + 't/?t=' + encodeURIComponent(c.slug);
    if (c.logo && typeof window.epinoiaLogoUrl === 'function') {
      const img = el('img'); img.src = window.epinoiaLogoUrl(c.logo, 48); img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', () => img.remove(), { once: true });
      a.appendChild(img);
    }
    a.appendChild(data('span', null, c.name));
    a.title = 'supports ' + c.name;
    return a;
  }
  const pct = r => (r.pct == null ? '–' : (Math.round(Number(r.pct) * 10) / 10) + '%');

  /* EPINOIΛ ON THE BOARD (Louie, 2026-10-08): the What wins model as a competitor of its own (prediction_model, 0253),
     pinned above the fans rather than ranked among them - it picks every game it can judge, so its count of right
     picks would bury everyone's. Its wins and losses, its hit rate, and how many of the fans with five decided picks
     or more it is ahead of. Away before 0253, before it has a decided pick here, and for a private league */
  let modelSeq = 0;
  function drawModel(m) {
    const host = $('#lbModel');
    if (!host) return;
    host.textContent = '';
    if (!m || !(Number(m.decided) > 0)) return;
    const right = Number(m.correct), lost = Number(m.decided) - right;
    const card = el('div', 'lb-model-c');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'EPINOIA, the model: ' + right + ' right, ' + lost + ' wrong');
    const who = el('span', 'lb-model-who');
    who.appendChild(data('b', 'lb-model-mk epinoia-mark', 'EPINOIΛ'));
    who.appendChild(el('small', null, 'the model'));
    card.appendChild(who);
    const wl = el('span', 'lb-model-wl');
    wl.appendChild(data('b', null, num(right) + '–' + num(lost)));
    wl.appendChild(el('small', null, 'right–wrong'));
    card.appendChild(wl);
    const rate = el('span', 'lb-model-rate');
    const bar = el('i', 'lb-rate');
    bar.style.setProperty('--p', (m.pct == null ? 0 : Number(m.pct)) + '%');
    rate.appendChild(bar);
    rate.appendChild(data('span', null, pct(m)));
    card.appendChild(rate);
    const t = [];
    if (Number(m.fans) > 0) t.push('ahead of ' + num(m.ahead) + ' of ' + num(m.fans) + (Number(m.fans) === 1 ? ' fan' : ' fans') + ' with 5+ picks');
    if (Number(m.pending) > 0) t.push(num(m.pending) + ' to play');
    if (t.length) card.appendChild(el('span', 'lb-model-t', t.join(' · ')));
    card.appendChild(el('span', 'lb-model-how', 'It picks the side it makes more likely in every game it can judge, before tip-off, and never changes a pick after.'));
    host.appendChild(card);
  }

  async function drawPredictions() {
    const host = $('#lbBoard');
    host.setAttribute('aria-busy', 'true');
    const args = { p_league: state.league ? state.league.id : null, p_since: since(state.when) };
    let rows, mine = null;
    const seq = ++modelSeq;   // a later choice of league or time wins over a slower answer to an earlier one
    rpc('prediction_model', args, { anon: true }).then(m => { if (seq === modelSeq) drawModel(m); }, () => { if (seq === modelSeq) drawModel(null); });
    try {
      [rows, mine] = await Promise.all([
        rpc('prediction_board', Object.assign({ p_limit: state.limit }, args)),
        token().then(t => (t ? rpc('prediction_mine', args).catch(() => null) : null))
      ]);
    } catch (e) {
      host.textContent = '';
      host.appendChild(empty(e && e.status === 404 ? 'The leaderboards are on their way: picks open on every fixture very soon.'
                                                  : 'The board could not be read just now. Try again in a moment.'));
      host.setAttribute('aria-busy', 'false');
      return;
    }
    drawMine(mine);
    host.textContent = '';
    rows = Array.isArray(rows) ? rows : [];
    if (!rows.length) {
      host.appendChild(empty(state.when === 'all'
        ? 'Nobody has picked a winner ' + (state.league ? 'in ' + state.league.name + ' ' : '') + 'yet. Be the first: tap a side under any fixture.'
        : 'No picks for games ' + (state.when === 'week' ? 'this week' : 'this month') + ' yet.'));
      host.setAttribute('aria-busy', 'false');
      return;
    }
    const top = rows.filter(r => Number(r.rank) <= 3 && Number(r.correct) > 0).slice(0, 3);
    if (top.length) {
      const pod = el('ol', 'lb-podium n' + top.length);
      /* placed by position, medalled by rank: two fans level on second are both silver, and the first stays in the middle */
      const ORD = ['1st', '2nd', '3rd'];
      top.forEach((r, i) => {
        const li = el('li', 'lb-pod p' + (i + 1) + ' r' + r.rank + (r.me ? ' me' : ''));
        li.style.setProperty('--fc', tintOf(r));
        const card = el('span', 'lb-card');
        if (+r.rank === 1) card.appendChild(el('span', 'lb-crown', '♛'));
        const fw = el('span', 'lb-facew');
        fw.appendChild(face(r));
        fw.appendChild(data('span', 'lb-medal', String(r.rank)));
        card.appendChild(fw);
        card.appendChild(nameEl(r));
        const cc = clubChip(r);
        if (cc) card.appendChild(cc);
        const big = el('span', 'lb-big');
        big.appendChild(data('b', null, num(r.correct)));
        big.appendChild(el('small', null, Number(r.correct) === 1 ? 'right pick' : 'right picks'));
        card.appendChild(big);
        card.appendChild(el('span', 'lb-sub', 'of ' + num(r.decided) + ' · ' + pct(r)));
        li.appendChild(card);
        li.appendChild(data('span', 'lb-step', ORD[Number(r.rank) - 1] || r.rank + 'th'));
        pod.appendChild(li);
      });
      host.appendChild(pod);
    }
    const rest = rows.filter(r => !top.includes(r));
    if (rest.length) {
      const list = el('ol', 'lb-list');
      const hd = el('li', 'lb-row hd');
      hd.setAttribute('aria-hidden', 'true');
      ['#', 'fan', 'right', 'played', 'hit rate'].forEach((t, i) => hd.appendChild(el('span', 'c' + i, t)));
      list.appendChild(hd);
      rest.forEach(r => list.appendChild(row(r)));
      host.appendChild(list);
    }
    if (rows.length >= state.limit && state.limit < 500) {
      const more = el('button', 'ep-btn lb-more', 'show more');
      more.type = 'button';
      more.addEventListener('click', () => { state.limit = 500; drawPredictions(); });
      host.appendChild(more);
    }
    host.setAttribute('aria-busy', 'false');
  }
  function row(r) {
    const li = el('li', 'lb-row' + (r.me ? ' me' : '') + (r.face && r.face.shown ? ' styled' : ''));
    li.style.setProperty('--fc', tintOf(r));
    li.appendChild(data('span', 'c0', String(r.rank)));
    const who = el('span', 'c1');
    who.appendChild(face(r));
    const wt = el('span', 'lb-who');
    wt.appendChild(nameEl(r));
    const meta = el('span', 'lb-meta');
    const cc = clubChip(r);
    if (cc) meta.appendChild(cc);
    if (Number(r.pending) > 0) meta.appendChild(el('small', 'lb-pend', num(r.pending) + ' to play'));
    if (meta.childNodes.length) wt.appendChild(meta);
    who.appendChild(wt);
    li.appendChild(who);
    li.appendChild(data('b', 'c2', num(r.correct)));
    li.appendChild(data('span', 'c3', num(r.decided)));
    const rate = el('span', 'c4');
    const bar = el('i', 'lb-rate');
    bar.style.setProperty('--p', (r.pct == null ? 0 : Number(r.pct)) + '%');
    rate.appendChild(bar);
    rate.appendChild(data('span', null, pct(r)));
    li.appendChild(rate);
    return li;
  }
  function empty(text) { const d = el('div', 'pg-empty'); d.appendChild(el('p', null, text)); return d; }

  /* the reader's own line: where they stand, or how to get on the board */
  function drawMine(m) {
    const host = $('#lbMine');
    host.textContent = '';
    const A = window.EpinoiaAccess;
    const signedIn = !!(A && A.session && A.session());
    const card = el('div', 'lb-me');
    if (!signedIn) {
      card.appendChild(el('span', 'lb-me-t', 'Sign in, then tap a side under any fixture: your picks put you on this board.'));
      const a = el('a', 'ep-btn pri', 'Sign in');
      a.href = A && A.signinHref ? A.signinHref() : ROOT + 'signin/?next=' + encodeURIComponent(location.pathname + location.search);
      card.appendChild(a);
    } else if (!m) {
      card.appendChild(el('span', 'lb-me-t', 'You have no picks ' + (state.when === 'all' ? '' : state.when === 'week' ? 'this week ' : 'this month ') +
        (state.league ? 'in ' + state.league.name + ' ' : '') + 'yet: tap a side under any fixture to make one.'));
      const a = el('a', 'ep-btn', 'to the fixtures');
      a.href = state.league ? ROOT + 'fixtures/?l=' + encodeURIComponent(state.league.slug) : ROOT + 'games/';
      card.appendChild(a);
    } else {
      card.classList.add('has');
      const rk = el('span', 'lb-me-rk');
      rk.appendChild(el('small', null, 'your rank'));
      rk.appendChild(data('b', null, '#' + m.rank));
      card.appendChild(rk);
      card.style.setProperty('--fc', tintOf(m));
      card.appendChild(face(m));
      const t = el('span', 'lb-me-t');
      t.appendChild(nameEl(m));
      const cc = clubChip(m);
      if (cc) t.appendChild(cc);
      t.appendChild(el('span', null, num(m.correct) + ' right of ' + num(m.decided) + ' played · ' + pct(m) +
        (Number(m.pending) > 0 ? ' · ' + num(m.pending) + ' to play' : '')));
      card.appendChild(t);
      /* how to look your own on the boards: a username, a public page, then the circle, the colour and the club */
      const f = m.face || {};
      const a = el('a', 'lb-me-u');
      a.href = ROOT + 'profile/';
      a.textContent = !m.named ? 'choose a username to show it here →'
        : !f.shown ? 'make your page public to show your picture, colour and club here →'
        : 'your picture, colour and club: change them in your hub →';
      card.appendChild(a);
    }
    host.appendChild(card);
  }

  /* --------------------------------------------------------- arenas (GO) --- */
  async function drawStamped(L) {
    let rows;
    try { rows = await rpc('go_leaderboard', { p_league: L.id, p_by: 'arenas', p_limit: 10 }); } catch (_) { return; }
    rows = (Array.isArray(rows) ? rows : []).filter(r => Number(r.arenas) > 0);
    if (!rows.length) return;
    const host = $('#lbGo');
    host.textContent = '';
    const list = el('ol', 'lb-list go');
    rows.forEach(r => {
      const li = el('li', 'lb-row' + (r.me ? ' me' : ''));
      li.appendChild(data('span', 'c0', String(r.rank)));
      const who = el('span', 'c1');
      const a = data('a', 'lb-name', '@' + r.username);
      a.href = ROOT + 'fan/?u=' + encodeURIComponent(r.username);
      who.appendChild(a);
      li.appendChild(who);
      li.appendChild(data('b', 'c2', num(r.arenas)));
      li.appendChild(el('span', 'c3', num(r.stamps) + (Number(r.stamps) === 1 ? ' game' : ' games')));
      list.appendChild(li);
    });
    host.appendChild(list);
    const more = el('p', 'pg-more');
    const go = el('a', null, 'Stamp the arenas you go to on EPINOIΛ GO →');
    go.href = ROOT + 'go/';
    more.appendChild(go);
    host.appendChild(more);
    $('#stamped').classList.remove('hide');
  }

  /* ----------------------------------------------------------------- boot --- */
  function drawWhen() {
    chips($('#lbWhen'), WHEN.map(([k, l]) => [k, l]), state.when, k => { state.when = k; state.limit = 100; drawWhen(); drawPredictions(); });
  }

  async function bootLeague() {
    const want = Q.get('l') || '';
    const sub = $('#lbSub');
    if (!want) { sub.textContent = 'No league asked for: a league’s leaderboards are leaderboards/?l= its name.'; $('#lbBoard').textContent = ''; return; }
    let L = null;
    try { L = ((await rest('leagues?slug=eq.' + encodeURIComponent(want) + '&select=*&limit=1')) || [])[0] || null; } catch (_) { L = null; }
    if (!L) { sub.textContent = 'No league called “' + want + '” is on Epinoia.'; $('#lbBoard').textContent = ''; return; }
    state.league = L;
    window.__CS_LEAGUE_SLUG = L.slug;
    document.title = 'Leaderboards · ' + L.name + ' · Epinoia';
    if (window.EpinoiaTeamColour && window.EpinoiaTeamColour.league) {
      try { window.EpinoiaTeamColour.league(L, { keepAccent: !!(L.theme && L.theme.accent) }); } catch (_) { /* the kit's colours */ }
    }
    if (hex(L.colour_a)) FRAME.style.setProperty('--bc', L.colour_a);
    const kick = $('#lbKick');
    const a = el('a');
    a.href = ROOT + '?l=' + encodeURIComponent(L.slug);
    if (L.logo_path && typeof window.epinoiaLogoUrl === 'function') {
      const img = el('img'); img.src = window.epinoiaLogoUrl(L.logo_path, 64); img.alt = ''; img.width = 28; img.height = 28;
      a.appendChild(img);
    }
    a.appendChild(data('span', null, L.name));
    kick.textContent = '';
    kick.appendChild(a);
    sub.textContent = L.name + '’s fans, ranked: the winners they called on its games, and the arenas they have stamped.';
    drawWhen();
    await Promise.all([drawPredictions(), drawStamped(L).catch(() => {})]);
  }

  async function bootAll() {
    let leagues = [];
    try { leagues = await rpc('prediction_leagues', {}, { anon: true }); } catch (_) { leagues = []; }
    leagues = Array.isArray(leagues) ? leagues : [];
    const pickLg = slug => {
      const L = leagues.find(x => x.league_slug === slug);
      state.league = L ? { id: L.league_id, slug: L.league_slug, name: L.league } : null;
      state.limit = 100;
      const u = new URL(location.href);
      if (state.league) u.searchParams.set('lg', state.league.slug); else u.searchParams.delete('lg');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
      const note = document.querySelector('#predictions .note');
      if (note) note.textContent = state.league ? 'Fans ranked by the winners they called in ' + state.league.name : 'Fans ranked by the winners they called, across every league';
      drawLeagues();
      drawPredictions();
    };
    const drawLeagues = () => {
      const host = $('#lbLeagues');
      if (!leagues.length) { host.textContent = ''; return; }
      chips(host, [['', 'Every league', null]].concat(leagues.map(l => [l.league_slug, l.league, num(l.fans)])),
            state.league ? state.league.slug : '', pickLg);
    };
    const want = Q.get('lg');
    const L = want && leagues.find(x => x.league_slug === want);
    if (L) state.league = { id: L.league_id, slug: L.league_slug, name: L.league };
    drawLeagues();
    drawWhen();
    await drawPredictions();
  }

  function boot() { checkAdmin().catch(() => false).then(() => (SCOPE === 'all' ? bootAll() : bootLeague())).catch(() => {}); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  /* a pick made in another tab, or a sign-in: the board again */
  window.addEventListener('storage', e => { if (e.key && /-auth-token$/.test(e.key)) drawPredictions(); });
})();
