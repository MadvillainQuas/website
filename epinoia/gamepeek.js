'use strict';
/* ============================================================================
   A GAME AT A GLANCE — the card that opens from the middle of a fixture's pick strip (predict.js), on HOME and the
   global fixtures (Louie, 2026-10-07): hovering "who wins?" with a mouse, or tapping it on a phone, shows the
   preview's numbers condensed: each club's record and net rating, the four factors side by side with the better side
   lit, the ratings and the pace, each club's two leading players, and under them EPINOIΛ's win probability
   (winprob.js, where the page loads it). "Full preview" goes to the game.

     EpinoiaPeek.attach(el, game)   el: the strip's middle; game: the fixture card's game ({ id, competition_id, home, away })

   THE SEASON, NOT ONE COMPETITION: a cup tie's own competition may have no game finished, so the fixture's
   competition is taken to its season and every competition of that season is read together (as the game page's
   preview does) - through data.js season(), which answers from the season's file where there is one, so the card
   opens in a moment. Read once a season and kept for the page's life; the leading players' names once each.

   The card lives on <body> (the strip is inside a link), placed allowing for the kit's zoom of <body>, as the watch
   card is (watch.js).
   ============================================================================ */
(function (root) {
  const D = () => root.EpinoiaData;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = v => (v == null || v === '' || !isFinite(+v) ? null : +v);
  const one = v => (num(v) == null ? '–' : (+v).toFixed(1));
  const sgn = v => (num(v) == null ? '–' : (+v > 0 ? '+' : +v < 0 ? '−' : '±') + Math.abs(+v).toFixed(1));

  /* --------------------------------------------------------------- data --- */
  const seasonOf = new Map();       // competition id -> Promise of the season (S)
  function season(compId) {
    if (!compId || !D()) return Promise.resolve(null);
    if (seasonOf.has(compId)) return seasonOf.get(compId);
    const p = (async () => {
      const c = await D().all('competitions?id=eq.' + encodeURIComponent(compId) + '&select=season_id');
      const sid = c && c[0] && c[0].season_id;
      const sib = sid ? await D().all('competitions?season_id=eq.' + encodeURIComponent(sid) + '&select=id') : [];
      const ids = (sib || []).map(x => x.id);
      return D().season(ids.length ? ids : [compId], { rows: false, trim: true });
    })();
    p.catch(() => seasonOf.delete(compId));
    seasonOf.set(compId, p);
    return p;
  }
  const names = new Map();
  async function namesOf(ids) {
    const want = ids.filter(id => id && !names.has(id));
    if (want.length && D() && D().playerMeta) {
      try { const m = await D().playerMeta(want); want.forEach(id => names.set(id, (m[id] && m[id].name) || '')); } catch (_) { /* unnamed */ }
    }
    return ids.map(id => names.get(id) || '');
  }
  function record(S, id) {
    let w = 0, l = 0;
    (S.games || []).forEach(g => {
      if (g.home_team_id !== id && g.away_team_id !== id) return;
      const h = +g.home_score || 0, a = +g.away_score || 0;
      if (h === a) return;
      if ((g.home_team_id === id) === (h > a)) w++; else l++;
    });
    return w + l ? w + '–' + l : '';
  }
  /* two a side, by production over a real sample first (the preview's rule) */
  function leaders(S, id) {
    const tp = S.teamOfPlayer || new Map();
    const mine = (S.players || []).filter(p => tp.get(p.id) === id && p.gp);
    const prod = p => (p.ppg || 0) + (p.rpg || 0) + (p.apg || 0);
    const solid = mine.filter(p => p.gp >= 3).sort((a, b) => prod(b) - prod(a));
    return (solid.length >= 2 ? solid : solid.concat(mine.filter(p => p.gp < 3).sort((a, b) => prod(b) - prod(a)))).slice(0, 2);
  }

  /* ---------------------------------------------------------------- card --- */
  const FF = [['eFG%', 'ff_efg'], ['TOV%', 'ff_tov', true], ['OREB%', 'ff_oreb'], ['FT rate', 'ff_ftr']];
  const RT = [['ORTG', 'ortg'], ['DRTG', 'drtg', true], ['PACE', 'pace', null, true]];
  const crest = t => (t && t.logo_path && typeof root.epinoiaLogoUrl === 'function'
    ? '<img src="' + esc(root.epinoiaLogoUrl(t.logo_path, 64)) + '" alt="" loading="lazy">' : '<b>' + esc(((t && (t.short_name || t.name)) || '?').slice(0, 3)) + '</b>');
  /* a row: both values, a bar split by their share, the better side lit (a style - pace - lights neither) */
  function row(label, a, b, low, style) {
    const x = num(a), y = num(b);
    const better = x == null || y == null || style || Math.abs(x - y) < 0.05 ? 0 : (low ? x < y : x > y) ? 1 : 2;
    const share = x != null && y != null && x + y > 0 ? 100 * x / (x + y) : 50;
    return '<div class="gk-row"><b class="' + (better === 1 ? 'up' : '') + '">' + one(x) + '</b>' +
      '<span class="gk-mid"><i>' + esc(label) + '</i><span class="gk-bar"><u style="width:' + share.toFixed(1) + '%"></u></span></span>' +
      '<b class="' + (better === 2 ? 'up' : '') + '">' + one(y) + '</b></div>';
  }
  function html(g, S, hm, aw, ln) {
    const side = (t, r, k) => '<div class="gk-side ' + k + '"><span class="gk-crest">' + crest(t) + '</span>' +
      '<span class="gk-nm">' + esc((t && (t.short_name || t.name)) || '') + '</span>' +
      '<span class="gk-rec">' + esc(record(S, t.id) || (r && r.gp ? r.gp + ' played' : 'no games yet')) + '</span>' +
      '<span class="gk-net"><small>NET</small>' + sgn(r && r.net) + '</span></div>';
    const lead = (list, nm) => list.map((p, i) => '<div class="gk-pl"><b>' + esc(nm[i] || 'Player') + '</b><span>' +
      one(p.ppg) + ' pts · ' + one(p.rpg) + ' reb · ' + one(p.apg) + ' ast</span></div>').join('') || '<div class="gk-pl none">—</div>';
    const both = hm && aw && hm.gp && aw.gp;
    return '<div class="gk-hd"><span>' + (g.status === 'final' ? 'the season so far' : 'preview') + '</span><button type="button" class="gk-x" aria-label="close">×</button></div>' +
      '<div class="gk-top">' + side(g.home, hm, 'h') + '<span class="gk-v">v</span>' + side(g.away, aw, 'a') + '</div>' +
      (both
        ? '<div class="gk-sec"><div class="gk-k">four factors · offence</div>' + FF.map(([l, k, lo]) => row(l, hm[k], aw[k], lo)).join('') + '</div>' +
          '<div class="gk-sec"><div class="gk-k">ratings · per 100 possessions</div>' + RT.map(([l, k, lo, st]) => row(l, hm[k], aw[k], lo, st)).join('') + '</div>'
        : '<p class="gk-none">Not enough games yet this season to compare them.</p>') +
      '<div class="gk-sec gk-leads"><div class="gk-k">leading players</div><div class="gk-lcols"><div>' + lead(ln.h, ln.hn) + '</div><div>' + lead(ln.a, ln.an) + '</div></div></div>' +
      /* EPINOIΛ's win probability (winprob.js), filled after: hidden until it has something to say */
      '<div class="gk-sec gk-wp" hidden></div>' +
      '<a class="gk-go" href="' + esc(g.href || ('../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase')) + '">full preview →</a>';
  }

  /* ------------------------------------------------------------- showing --- */
  let pop = null, owner = null, pinned = false, openT = 0, shutT = 0, ticket = 0;
  function ensure() {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.className = 'gk-pop';
    pop.setAttribute('role', 'dialog');
    pop.addEventListener('mouseenter', () => clearTimeout(shutT));
    pop.addEventListener('mouseleave', () => { if (!pinned) shutSoon(); });
    pop.addEventListener('click', e => { e.stopPropagation(); if (e.target.closest('.gk-x')) close(); });
    document.body.appendChild(pop);
    document.addEventListener('click', e => { if (pop.classList.contains('on') && !e.target.closest('.gk-pop') && !e.target.closest('.pr-mid')) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    root.addEventListener('scroll', () => { if (pop.classList.contains('on')) { if (pinned) place(); else close(); } }, { passive: true, capture: true });
    root.addEventListener('resize', () => { if (pop.classList.contains('on')) place(); });
    return pop;
  }
  const fill = h => { pop.innerHTML = '<div class="gk-in">' + h + '</div>'; };
  function place() {
    if (!pop || !owner || !owner.isConnected) return;
    const z = parseFloat(getComputedStyle(document.body).zoom) || 1;
    const r = owner.getBoundingClientRect();
    const vw = root.innerWidth / z, vh = root.innerHeight / z;
    const W = Math.min(340, vw - 20);
    pop.style.width = W + 'px';
    const cx = (r.left + r.width / 2) / z;
    const left = Math.max(10, Math.min(vw - W - 10, cx - W / 2));
    pop.style.left = left + 'px';
    /* no taller than the screen (in the kit's own pixels: the body is zoomed); the rest scrolls inside */
    const inner = pop.querySelector('.gk-in');
    if (inner) {
      /* the card's own padding and border are outside the scrolling part: taken off too, or a tall card runs off the foot */
      const cs = getComputedStyle(pop), edge = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
      inner.style.maxHeight = Math.max(160, vh - 16 - edge) + 'px';
    }
    const h = pop.offsetHeight;
    const below = r.bottom / z + 10, above = r.top / z - 10 - h;
    /* under the strip when it fits, else over it, else as low as the screen allows (never off its foot; the nib goes) */
    const fitsBelow = below + h <= vh - 8, fitsAbove = above >= 8;
    const top = fitsBelow ? below : fitsAbove ? above : Math.max(8, vh - 8 - h);
    pop.style.top = top + 'px';
    pop.classList.toggle('up', !fitsBelow && fitsAbove);
    pop.classList.toggle('free', !fitsBelow && !fitsAbove);
    pop.style.setProperty('--ax', Math.max(16, Math.min(W - 16, cx - left)) + 'px');
  }
  async function open(el, g, pin) {
    clearTimeout(shutT); clearTimeout(openT);
    ensure();
    if (owner && owner !== el) owner.classList.remove('gk-on');
    owner = el; pinned = !!pin;
    el.classList.add('gk-on');
    const t = ++ticket;
    fill('<div class="gk-hd"><span>preview</span><button type="button" class="gk-x" aria-label="close">×</button></div><div class="gk-wait">reading the season…</div>');
    pop.setAttribute('aria-label', 'preview: ' + ((g.home && g.home.name) || '') + ' v ' + ((g.away && g.away.name) || ''));
    /* the bars in the two clubs' colours, as the strip's */
    const hex = c => (/^#?[0-9a-f]{6}$/i.test(String(c || '')) ? (String(c)[0] === '#' ? c : '#' + c) : null);
    ['h', 'a'].forEach(k => { const c = hex(((k === 'h' ? g.home : g.away) || {}).colour); if (c) pop.style.setProperty('--' + k, c); else pop.style.removeProperty('--' + k); });
    pop.classList.add('on');
    place();
    try {
      const S = await season(g.competition_id);
      if (t !== ticket) return;
      if (!S) throw new Error('no season');
      const row = id => (S.teams || []).find(x => x.id === id) || null;
      const hm = row(g.home && g.home.id), aw = row(g.away && g.away.id);
      const h = leaders(S, g.home && g.home.id), a = leaders(S, g.away && g.away.id);
      const [hn, an] = await Promise.all([namesOf(h.map(p => p.id)), namesOf(a.map(p => p.id))]);
      if (t !== ticket) return;
      fill(html(g, S, hm, aw, { h, a, hn, an }));
      const wp = pop.querySelector('.gk-wp');
      if (wp && root.EpinoiaWinProb) {
        root.EpinoiaWinProb.mount(wp, g.id, { home: g.home, away: g.away, status: g.status, homeScore: g.home_score, awayScore: g.away_score })
          .then(() => { if (t === ticket) place(); }, () => {});
      }
    } catch (_) {
      if (t !== ticket) return;
      fill('<div class="gk-hd"><span>preview</span><button type="button" class="gk-x" aria-label="close">×</button></div><p class="gk-none">The season could not be read just now.</p>');
    }
    place();
  }
  function close() {
    clearTimeout(shutT); clearTimeout(openT);
    ticket++;
    if (pop) pop.classList.remove('on');
    if (owner) owner.classList.remove('gk-on');
    owner = null; pinned = false;
  }
  function shutSoon() { clearTimeout(shutT); shutT = setTimeout(close, 280); }
  const fine = () => root.matchMedia && root.matchMedia('(hover:hover) and (pointer:fine)').matches;

  function attach(el, g) {
    if (!el || !g || !g.id) return;
    el.classList.add('gk-trigger');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'the season so far: ' + ((g.home && g.home.name) || '') + ' v ' + ((g.away && g.away.name) || ''));
    el.addEventListener('mouseenter', () => { if (!fine()) return; clearTimeout(openT); openT = setTimeout(() => { if (!pinned) open(el, g, false); }, 160); });
    el.addEventListener('mouseleave', () => { clearTimeout(openT); if (owner === el && !pinned) shutSoon(); });
    /* a tap (or a click) pins it open; a second one closes it. Stopped here: the strip, and the card under it, never see it */
    el.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (owner === el && pinned) close(); else open(el, g, true);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (owner === el && pinned) close(); else open(el, g, true); } });
  }

  root.EpinoiaPeek = { attach, close, _season: season };
})(typeof window !== 'undefined' ? window : globalThis);
