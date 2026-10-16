'use strict';
/* ============================================================================
   A COLLEGE SYSTEM'S HUB (Louie, 2026-10-16): "U Sports/NCAA D2 ... its own navigational splash page instead of being
   treated like a league page - I want it to feel like a proper main hub of each system of leagues ... being an
   accumulation of the whole system's games/data". /epinoia/?college=u-sports (and ncaa-d2): the league front page's
   document in a third mode (mode.js m-college), so the hero, the games strip, MAIN | VIDEO and HOME's groups are the
   same ones; this file fills them for a SYSTEM:

     the hero        the system's name; NCAA D2 a Men's | Women's switch every section follows (remembered)
     CONFERENCES     under MAIN | VIDEO, every conference a card to go to - its own pages, a league's (?l=&conf=) -
                     grouped by region, each region lit on its country's tile map (conferences.js)
     GAMES           the league page's own Games section (leaguegames.js), the system's games, with a chip a conference
                     ("Can Games have its own conference filter like on home?") - read for that conference's clubs
     CONFERENCES & CLUBS   each conference a row, as HOME's countries are, that opens to its clubs
     TABLE           every conference's table, each a row (standingsview.js)
     LEADERS         the statistics page's table, every club of the system's players (fulltable.js)

   Clubs with no conference are not the system's and are shown nowhere (conferences.js scope). Booted by home.js when the
   address says ?college=.
   ============================================================================ */
(function (root) {
  const $ = s => document.querySelector(s);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const ME = document.currentScript || document.querySelector('script[src*="college.js"]');
  const STAMP = (/[?&]v=(\d+)/.exec((ME && ME.src) || '') || [])[1] || '';
  const GKEY = 'epinoia_college_g';

  let SYS = null, CF = null, D = null, PART = null;
  const DATA = new Map();               // league slug -> Promise<data>

  /* ---------------------------------------------------------------- the reads --- */
  /* the league's row on its own, so its logo and colours paint before the season's reads come back */
  const ROWS = new Map();               // league slug -> Promise<row | null>
  function leagueRow(slug) {
    if (!ROWS.has(slug)) {
      /* the whole row, as a league's page reads it: colour_source and theme (0122) paint the hub, and naming a column a
         database without that migration lacks would lose the hub altogether */
      const p = D.get('leagues?slug=eq.' + encodeURIComponent(slug) + '&select=*&limit=1').then(ls => (ls && ls[0]) || null);
      ROWS.set(slug, p);
      p.catch(() => ROWS.delete(slug));
    }
    return ROWS.get(slug).catch(() => null);
  }

  async function leagueData(slug) {
    if (DATA.has(slug)) return DATA.get(slug);
    const p = (async () => {
      const league = await leagueRow(slug);
      if (!league) return { slug, league: null, comps: [], teams: [], scope: CF.scopeFrom(slug, [], null) };
      const seasons = await D.get('seasons?league_id=eq.' + league.id +
        '&select=id,name,starts_on,competitions(id,name,kind,format)&order=starts_on.desc').catch(() => []);
      const season = (seasons || []).find(s => (s.competitions || []).length) || null;
      const comps = season ? season.competitions : [];
      const [teams, scope] = await Promise.all([
        D.get('teams?league_id=eq.' + league.id + '&select=id,name,short_name,slug,colour,colour_2,logo_path&order=name').catch(() => []),
        CF.scope({ D, league: slug, compIds: comps.map(c => c.id), conf: null })
      ]);
      /* the season's clubs: those with a conference (scope); the league's whole list when nothing is assigned yet */
      const ids = new Set();
      teams.forEach(t => { if (scope.conferenceOf(t.id)) ids.add(t.id); });
      return { slug, league, season, comps, teams: ids.size ? teams.filter(t => ids.has(t.id)) : [], scope };
    })();
    DATA.set(slug, p);
    p.catch(() => DATA.delete(slug));
    return p;
  }

  /* the clubs of each conference: Map conference key -> [team] */
  function byConference(d) {
    const m = new Map();
    d.teams.forEach(t => {
      const c = d.scope.conferenceOf(t.id);
      if (!c) return;
      if (!m.has(c.key)) m.set(c.key, []);
      m.get(c.key).push(t);
    });
    return m;
  }

  const confHref = (slug, c) => '?l=' + encodeURIComponent(slug) + '&conf=' + encodeURIComponent(c.key);

  /* ---------------------------------------------------------------- the hero --- */
  function hero() {
    const wm = $('.wordmark');
    /* "U SPORTS Main Hub" (Louie, 2026-10-16): the system's front page, not one more league's. One text, so a
       translated page's pattern keeps the name and words the rest in its own order */
    const title = SYS.name + ' Main Hub';
    if (wm) { wm.textContent = title; wm.classList.remove('epinoia-mark'); wm.removeAttribute('aria-label'); }
    document.title = title + ' · Epinoia';
    const n = SYS.conferences.filter(c => c.key !== 'independent').length;
    const tag = $('.tagline');
    if (tag) {
      /* in pieces, so a translated page translates the words and leaves the system's name alone */
      tag.textContent = '';
      const nm = el('span', null, SYS.long);
      nm.setAttribute('translate', 'no');
      tag.append(nm, ': ', el('span', null, n + ' conferences'));
      if (SYS.leagues.length > 1) tag.append(' · ', el('span', null, 'men’s and women’s'));
      tag.append(' · ', el('span', null, 'every conference’s games, tables and leaders'));
    }
    const acts = $('#leagueActs');
    if (acts && SYS.leagues.length > 1) {
      acts.textContent = '';
      const row = el('div', 'cg-sides');
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', 'Men\'s or women\'s');
      SYS.leagues.forEach(l => {
        const b = el('button', 'ep-chip' + (l === PART ? ' on' : ''), l.part === 'Men' ? 'Men’s' : l.part === 'Women' ? 'Women’s' : l.part);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(l === PART));
        b.addEventListener('click', () => {
          if (l === PART) return;
          PART = l;
          try { localStorage.setItem(GKEY, l.part === 'Women' ? 'women' : 'men'); } catch (_) { /* this visit */ }
          const u = new URL(location.href);
          u.searchParams.set('g', l.part === 'Women' ? 'women' : 'men');
          history.replaceState(null, '', u);
          row.querySelectorAll('.ep-chip').forEach((x, i) => { const on = SYS.leagues[i] === PART; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
          paint();
        });
        row.appendChild(b);
      });
      acts.appendChild(row);
    }
  }

  /* THE SYSTEM'S OWN LOGO beside its name (Louie, 2026-10-16: "U Sports uses the U Sports logo"): its league's crest,
     where it has one - NCAA D2's leagues have none yet, and its name stands alone */
  function heroLogo(d) {
    const wm = $('.wordmark');
    if (!wm || !d.league || !d.league.logo_path || wm.parentNode.querySelector('.lg-logo')) return;
    const url = root.epinoiaLogoUrl ? root.epinoiaLogoUrl(d.league.logo_path, 256) : null;
    if (!url) return;
    const img = el('img', 'lg-logo');
    img.alt = '';
    img.addEventListener('error', () => { img.remove(); wm.parentNode.classList.remove('has-logo'); });
    img.src = url;
    wm.parentNode.insertBefore(img, wm);
    wm.parentNode.classList.add('has-logo');
  }

  /* THE HUB IN ITS LOGO'S COLOURS (Louie, 2026-10-16), as a league's own page is (0122, teamcolour.js league()): the
     colours somebody vouched for, or read from the logo for this visit, as trims on the page and on the sidebar beside it.
     NCAA D2's two sides are two leagues, so a switch takes the last side's colours off first. A league that picked its
     own accent in Appearance keeps it. */
  function look(d) {
    const TC = root.EpinoiaTeamColour;
    if (!TC || typeof TC.league !== 'function') return;
    if (typeof TC.clearLeague === 'function') TC.clearLeague();
    const L = d.league;
    if (!L) return;
    const own = L.theme && /^#[0-9a-f]{6}$/i.test(L.theme.accent || '') ? L.theme.accent : null;
    Promise.resolve(TC.league(L, { keepAccent: !!own })).then(() => {
      if (own && PART && PART.slug === d.slug) document.documentElement.style.setProperty('--lume', own);
    }).catch(() => { /* the platform's own colours */ });
  }

  /* the games strip (the embed every site gets) and VIDEO follow the league being shown */
  function pointStrip(d) {
    const f = $('#strip');
    if (f) {
      const want = 'embed/strip/?l=' + encodeURIComponent(d.slug) + '&n=24';
      if (f.getAttribute('src') !== want) f.setAttribute('src', want);
    }
    const modes = $('#hmModes');
    if (modes && d.league) modes.dataset.league = JSON.stringify({ id: d.league.id, slug: d.league.slug, name: d.league.name });
  }

  /* ---------------------------------------------------------- the conferences --- */
  /* THE CONFERENCES ON THE MAP (Louie, 2026-10-16: "an interactable big, realistic map of the US/Canada with each region
     indicated on the map, then have hover over arrows (if a region is hovered over) with the conferences in that region,
     and the regions to the side as dropdown menus"). The country (maps.js: the states' or provinces'
     outlines), each state or province in its region's colour; a region hovered lights up, the rest dims, and a card
     with an arrow to it lists its conferences; a region tapped (or its dropdown opened) stays lit. Beside the map every
     region is a dropdown of its conferences, each a link to its own pages; hovering one lights its region. */
  const SVGNS = 'http://www.w3.org/2000/svg';
  let mapsP = null;
  function maps() {
    if (root.EpinoiaMaps) return Promise.resolve(root.EpinoiaMaps);
    if (mapsP) return mapsP;
    mapsP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'maps.js' + (STAMP ? '?v=' + STAMP : '');
      s.onload = () => res(root.EpinoiaMaps);
      s.onerror = rej;
      document.head.appendChild(s);
    });
    mapsP.catch(() => { mapsP = null; });
    return mapsP;
  }

  function confLink(d, c, n, size) {
    const a = el('a', 'cg-clink');
    a.href = confHref(d.slug, c);
    a.style.setProperty('--cc', c.colour || 'var(--lume)');
    a.appendChild(CF.badge(SYS, c, size || 36));
    const t = el('span', 'cg-clink-t');
    t.appendChild(el('b', null, c.short));
    if (c.name !== c.short) t.appendChild(el('span', 'cg-clink-n', c.name));
    t.appendChild(el('span', 'cg-clink-m', n ? n + (n === 1 ? ' club' : ' clubs') : 'no clubs yet'));
    a.appendChild(t);
    a.appendChild(el('span', 'cg-go', '→'));
    return a;
  }

  async function regions(d) {
    const host = $('#cgRegions');
    if (!host) return;
    host.textContent = '';
    host.className = 'cg-regions cg-atlas';
    const counts = byConference(d);
    const shown = SYS.conferences.filter(c => c.key !== 'independent' || counts.has(c.key));
    const total = [...counts.values()].reduce((a, l) => a + l.length, 0);
    const note = $('#cgConfsNote');
    if (note) note.textContent = shown.length + ' conferences' + (total ? ' · ' + total + ' clubs' : '');
    const groups = CF.byRegion(SYS, shown);

    const stage = el('div', 'cg-stage');
    const side = el('div', 'cg-side');
    host.append(stage, side);
    const gOf = new Map();                       // region key -> its <g> on the map
    const card = el('div', 'cg-callout');
    card.hidden = true;
    let pinned = null, hideT = null, svg = null, M = null;

    /* ---- the regions beside the map, each a dropdown of its conferences ---- */
    const rows = new Map();
    groups.forEach(g => {
      const key = g.region ? g.region.key : 'none';
      const det = el('details', 'ep-acc cg-rrow');
      det.dataset.region = key;
      if (g.region) det.style.setProperty('--rc', g.region.colour);
      const sum = el('summary');
      sum.appendChild(el('span', 'cg-swatch'));
      const nm = el('span', 'cg-rrow-n');
      nm.appendChild(el('b', null, g.region ? g.region.name : 'Independents'));
      nm.appendChild(el('span', null, g.conferences.length + (g.conferences.length === 1 ? ' conference' : ' conferences')));
      sum.appendChild(nm);
      const logos = el('span', 'cg-rrow-l');
      g.conferences.slice(0, 4).forEach(c => logos.appendChild(CF.badge(SYS, c, 24)));
      sum.appendChild(logos);
      det.appendChild(sum);
      const body = el('div', 'cg-rrow-b');
      g.conferences.forEach(c => body.appendChild(confLink(d, c, (counts.get(c.key) || []).length, 34)));
      det.appendChild(body);
      if (g.region) {
        sum.addEventListener('pointerenter', () => light(g.region.key, false));
        sum.addEventListener('pointerleave', () => unlight());
        det.addEventListener('toggle', () => { if (det.open) pin(g.region.key, true); else if (pinned === g.region.key) unpin(); });
      }
      rows.set(key, det);
      side.appendChild(det);
    });

    /* ---- the map ---- */
    try { M = (await maps())[SYS.map]; } catch (_) { M = null; }
    if (!M) { stage.remove(); return; }
    svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + M.w + ' ' + M.h);
    svg.setAttribute('class', 'cg-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Conferences by region');
    const ofState = new Map();
    SYS.regions.forEach(r => r.where.forEach(w => ofState.set(w, r)));
    const base = document.createElementNS(SVGNS, 'g');
    base.setAttribute('class', 'cg-out');
    svg.appendChild(base);
    groups.filter(g => g.region).forEach(g => {
      const G = document.createElementNS(SVGNS, 'g');
      G.setAttribute('class', 'cg-g');
      G.dataset.region = g.region.key;
      G.style.setProperty('--rc', g.region.colour);
      G.setAttribute('tabindex', '0');
      G.setAttribute('role', 'button');
      G.setAttribute('aria-label', g.region.name + ': ' + g.conferences.map(c => c.short).join(', '));
      gOf.set(g.region.key, G);
      svg.appendChild(G);
    });
    Object.keys(M.paths).forEach(code => {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', M.paths[code]);
      p.dataset.st = code;
      const r = ofState.get(code);
      (r && gOf.get(r.key) ? gOf.get(r.key) : base).appendChild(p);
    });
    stage.appendChild(svg);
    stage.appendChild(card);

    /* ---- lighting a region, its card and its arrow ---- */
    function fillCard(key) {
      const g = groups.find(x => x.region && x.region.key === key);
      card.textContent = '';
      card.style.setProperty('--rc', g.region.colour);
      const h = el('div', 'cg-callout-h');
      h.appendChild(el('b', null, g.region.name));
      h.appendChild(el('span', null, g.conferences.length + (g.conferences.length === 1 ? ' conference' : ' conferences')));
      card.appendChild(h);
      g.conferences.forEach(c => card.appendChild(confLink(d, c, (counts.get(c.key) || []).length, 30)));
    }
    function place(key) {
      const G = gOf.get(key);
      if (!G) return;
      const bb = G.getBBox();
      /* IN THE STAGE'S OWN CSS PIXELS: the page is zoomed on a wide screen (body zoom), where a box measured on screen
         is the zoomed size and a left/top set in CSS is zoomed again - so screen measures are divided by the zoom */
      const sr = stage.getBoundingClientRect(), vr = svg.getBoundingClientRect();
      const z = (sr.width / (stage.offsetWidth || sr.width)) || 1;
      const ox = (vr.left - sr.left) / z - stage.clientLeft, oy = (vr.top - sr.top) / z - stage.clientTop;
      const k = (vr.width / z) / M.w;
      const sw = stage.clientWidth, sh = stage.clientHeight;
      const cw = card.offsetWidth || 300, ch = card.offsetHeight || 200;
      const right = ox + (bb.x + bb.width) * k, left = ox + bb.x * k, mid = oy + (bb.y + bb.height / 2) * k;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const topY = oy + bb.y * k, botY = oy + (bb.y + bb.height) * k, cx = (left + right) / 2;
      let x, top, side;
      /* beside the region (the arrow pointing in from the side), else under it or over it (pointing up or down) */
      if (right + 18 + cw <= sw) { x = right + 18; side = 'l'; }
      else if (left - 18 - cw >= 0) { x = left - 18 - cw; side = 'r'; }
      if (side) top = clamp(mid - ch / 2, 0, sh - ch);
      else {
        x = clamp(cx - cw / 2, 0, sw - cw);
        if (botY + 18 + ch <= sh) { top = botY + 18; side = 'u'; }
        else if (topY - 18 - ch >= 0) { top = topY - 18 - ch; side = 'd'; }
        else { top = clamp(mid - ch / 2, 0, sh - ch); side = 'n'; }
      }
      card.style.left = x + 'px';
      card.style.top = top + 'px';
      card.dataset.arrow = side;
      card.style.setProperty('--ay', clamp(mid - top, 14, ch - 14) + 'px');
      card.style.setProperty('--ax', clamp(cx - x, 16, cw - 16) + 'px');
    }
    function show(key) {
      if (!svg) return;
      clearTimeout(hideT);
      stage.dataset.on = key;
      gOf.forEach((G, k) => G.classList.toggle('on', k === key));
      rows.forEach((r, k) => r.classList.toggle('lit', k === key));
      /* ON A NARROW SCREEN NO CARD: it would cover the map, and the region's dropdown, just under the map, opens with
         the same conferences (pin) */
      if (stage.clientWidth < 560) { card.hidden = true; return; }
      fillCard(key);
      card.hidden = false;
      place(key);
    }
    function light(key, fromMap) { if (!pinned || pinned === key || fromMap) show(key); }
    function unlight() {
      clearTimeout(hideT);
      hideT = setTimeout(() => {
        if (card.matches(':hover')) return;
        if (pinned) { show(pinned); return; }
        delete stage.dataset.on;
        gOf.forEach(G => G.classList.remove('on'));
        rows.forEach(r => r.classList.remove('lit'));
        card.hidden = true;
      }, 160);
    }
    /* one region at a time: its dropdown open, the others closed */
    function pin(key, fromRow) {
      pinned = key;
      show(key);
      rows.forEach((r, k) => { if (k !== key && r.open) r.open = false; });
      const r = rows.get(key);
      if (r && !fromRow && !r.open) {
        r.open = true;
        if (stage.clientWidth < 560 && r.scrollIntoView) r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    function unpin() { pinned = null; unlight(); }
    gOf.forEach((G, key) => {
      G.addEventListener('pointerenter', () => light(key, true));
      G.addEventListener('pointerleave', unlight);
      G.addEventListener('click', () => (pinned === key ? (rows.get(key) && (rows.get(key).open = false), unpin()) : pin(key, false)));
      G.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); G.dispatchEvent(new MouseEvent('click')); } });
    });
    card.addEventListener('pointerleave', unlight);
    stage.addEventListener('keydown', e => { if (e.key === 'Escape' && pinned) { const r = rows.get(pinned); if (r) r.open = false; unpin(); } });
    root.addEventListener('resize', () => { if (!card.hidden && stage.dataset.on) place(stage.dataset.on); });
  }

  /* --------------------------------------------------------------- the games --- */
  let gamesMounted = false, gamesConf = '';
  function games(d) {
    const sec = $('#lgGamesSec'), hostEl = $('#cgGamesHost');
    const LG = root.EpinoiaLeagueGames;
    if (!sec || !hostEl || !LG) return;
    if (sec.parentNode !== hostEl) hostEl.appendChild(sec);         // the league page's own section, in the hub's group
    let chips = $('#cgGamesConf');
    if (!chips) {
      chips = el('div', 'cg-chips');
      chips.id = 'cgGamesConf';
      chips.setAttribute('role', 'group');
      chips.setAttribute('aria-label', 'Conference');
      sec.querySelector('.sec-h').after(chips);
    }
    const counts = byConference(d);
    const list = d.scope.conferences.filter(c => counts.has(c.key));
    if (gamesConf && !list.some(c => c.key === gamesConf)) gamesConf = '';
    const scopeOf = () => {
      const teams = gamesConf ? (counts.get(gamesConf) || []).map(t => t.id) : [];
      return { leagues: d.league ? [d.league.id] : [], teams,
               allHref: 'fixtures/?l=' + encodeURIComponent(d.slug) + (gamesConf ? '&conf=' + encodeURIComponent(gamesConf) : '') };
    };
    chips.textContent = '';
    chips.hidden = list.length < 2;
    const chip = (key, label, c) => {
      const b = el('button', 'ep-chip' + (gamesConf === key ? ' on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(gamesConf === key));
      if (c) { b.appendChild(CF.badge(SYS, c, 18)); b.title = c.name; }
      b.appendChild(el('span', null, label));
      b.addEventListener('click', () => {
        if (gamesConf === key) return;
        gamesConf = key;
        chips.querySelectorAll('.ep-chip').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
        LG.rescope(scopeOf());
      });
      chips.appendChild(b);
    };
    chip('', 'All', null);
    list.forEach(c => chip(c.key, c.short, c));
    if (!d.league) {
      const h = $('#lgGames');
      if (h) { h.textContent = ''; h.appendChild(el('div', 'empty', 'No games yet: the season\'s fixtures have not been published.')); h.setAttribute('aria-busy', 'false'); }
      return;
    }
    if (!gamesMounted) gamesMounted = LG.mount(scopeOf());
    else LG.rescope(scopeOf());
  }

  /* ------------------------------------------------- conferences and their clubs --- */
  function clubs(d) {
    const host = $('#cgClubs');
    if (!host) return;
    host.textContent = '';
    const counts = byConference(d);
    const note = $('#cgClubsNote');
    if (note) note.textContent = d.teams.length ? d.teams.length + ' clubs' : '';
    const list = d.scope.conferences.filter(c => counts.has(c.key));
    if (!list.length) { host.appendChild(el('div', 'empty', 'No clubs yet: the season\'s fixtures have not been published.')); return; }
    const wrap = el('div', 'cg-acc');
    list.forEach(c => {
      const ts = (counts.get(c.key) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
      const det = el('details', 'ep-acc cg-crow');
      det.dataset.conf = c.key;
      const sum = el('summary');
      sum.appendChild(CF.badge(SYS, c, 34));
      const names = el('span', 'cg-crow-n');
      names.appendChild(el('b', null, c.short));
      if (c.name !== c.short) names.appendChild(el('span', null, c.name));
      sum.appendChild(names);
      const reg = CF.region(SYS, c.region);
      if (reg) sum.appendChild(el('span', 'cg-crow-r', reg.name));
      sum.appendChild(el('span', 'n', ts.length + (ts.length === 1 ? ' club' : ' clubs')));
      det.appendChild(sum);
      const body = el('div', 'cg-crow-b');
      const grid = el('div', 'cg-clubgrid');
      ts.forEach(t => {
        const a = el('a', 'cg-club');
        a.href = 't/?t=' + encodeURIComponent(t.slug);
        a.style.setProperty('--tc', t.colour || 'var(--rule-2)');
        a.appendChild(root.epinoiaCrest ? root.epinoiaCrest(t, { cls: 'ep-crest cg-crest' }) : el('span', 'cg-crest'));
        a.appendChild(el('span', 'cg-clubname', t.name));
        grid.appendChild(a);
      });
      body.appendChild(grid);
      const go = el('a', 'cg-confpage', c.short + '’s page →');
      go.href = confHref(d.slug, c);
      body.appendChild(go);
      det.appendChild(body);
      wrap.appendChild(det);
    });
    host.appendChild(wrap);
  }

  /* --------------------------------------------- the table and the leaders (lazy) --- */
  let toolsP = null;
  function tools() {
    if (toolsP) return toolsP;
    const q = STAMP ? '?v=' + STAMP : '';
    const css = h => new Promise(res => {
      if (document.querySelector('link[href^="' + h + '"]')) return res();
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = h + q; l.onload = res; l.onerror = res;
      const tt = document.querySelector('link[href^="kit/teletext.css"]');      // before it: its black header rows win
      if (tt) tt.before(l); else document.head.appendChild(l);
    });
    const js = (src, global) => (root[global] ? Promise.resolve() : new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = src + q; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    }));
    toolsP = Promise.all([
      css('kit/standings.css'), css('kit/table.css'),
      js('standings.js', 'EpinoiaStandings'), js('sos.js', 'EpinoiaSOS'), js('units.js', 'EpinoiaUnits'),
      js('ages.js', 'EpinoiaAges'), js('memlock.js', 'EpinoiaMemLock')
    ]).then(() => Promise.all([js('standingsview.js', 'EpinoiaStandingsView'), js('fulltable.js', 'EpinoiaTable')]));
    toolsP.catch(() => { toolsP = null; });
    return toolsP;
  }
  const mainComp = d => (d.comps.find(c => c.format === 'conferences') || d.comps.find(c => c.kind === 'league') || d.comps[0] || null);

  async function table(d) {
    const host = $('#cgTable');
    const all = $('#cgTableAll');
    if (all) all.href = 'l/?l=' + encodeURIComponent(d.slug);
    if (!host) return;
    host.textContent = '';
    const comp = mainComp(d);
    if (!comp) { host.appendChild(el('div', 'empty', 'No table yet: the season has not started.')); return; }
    host.appendChild(el('div', 'empty', 'Loading…'));
    await tools();
    host.textContent = '';
    await root.EpinoiaStandingsView.render(host, { api: p => D.get(p), competition: comp, base: '', league: d.slug,
      eloIds: d.comps.map(c => c.id) });
  }

  async function leaders(d) {
    const host = $('#cgLeaders');
    const all = $('#cgLeadAll');
    if (all) all.href = 'stats/?l=' + encodeURIComponent(d.slug);
    if (!host) return;
    host.textContent = '';
    const comp = mainComp(d);
    if (!comp) { host.appendChild(el('div', 'empty', 'No statistics yet: the season has not started.')); return; }
    host.appendChild(el('div', 'empty', 'Loading…'));
    await tools();
    const S = await D.season([comp.id], { rows: false, trim: true });
    const players = ((S && S.players) || []).filter(p => d.scope.keep((S.teamOfPlayer && S.teamOfPlayer.get(p.id)) || p.teamId));
    const meta = players.length && D.playerMeta ? await D.playerMeta(players.map(p => p.id)).catch(() => ({})) : {};
    players.forEach(p => Object.assign(p, meta[p.id] || {}));
    host.textContent = '';
    if (!players.length) { host.appendChild(el('div', 'empty', 'No statistics yet: they fill in as games are finalised.')); return; }
    root.EpinoiaTable.render({
      host, kind: 'player', sortKey: 'ppg', pageSize: 25,
      filename: d.slug + '-leaders', track: 'college-leaders',
      leagueId: d.league.id, leagueSlug: d.slug, rows: players,
      playerHref: r => 'p/?p=' + encodeURIComponent(r.id)
    });
  }

  /* each drawn when it first comes near the screen (a tab opened, a scroll), and again for the other side */
  const lazy = new Map();
  function whenSeen(id, draw) {
    const node = document.getElementById(id);
    if (!node) return;
    const prev = lazy.get(id);
    if (prev) prev.disconnect();
    const run = () => draw().catch(e => {
      const h = node.querySelector('[id^="cg"]:not(.sec-h)') || node;
      if (typeof console !== 'undefined') console.warn('[college]', e);
      if (h) { h.textContent = ''; h.appendChild(el('div', 'empty', 'This could not be read just now.')); }
    });
    if (typeof IntersectionObserver !== 'function') { run(); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); lazy.delete(id); run(); } },
      { rootMargin: '400px 0px' });
    io.observe(node);
    lazy.set(id, io);
  }

  /* ------------------------------------------------------------------ painting --- */
  async function paint() {
    const part = PART;
    /* the name's logo and the page's colours first: they need the league's row and nothing else */
    leagueRow(part.slug).then(league => {
      if (part !== PART || !league) return;
      heroLogo({ slug: part.slug, league });
      look({ slug: part.slug, league });
    });
    const d = await leagueData(part.slug);
    if (part !== PART) return;                          // the other side was chosen meanwhile
    root.__CS_COLLEGE = { system: SYS.key, league: d.slug };
    try { document.dispatchEvent(new CustomEvent('epinoia:college', { detail: root.__CS_COLLEGE })); } catch (_) { /* old browser */ }
    pointStrip(d);
    regions(d).catch(e => { if (typeof console !== 'undefined') console.warn('[college map]', e); });
    games(d);
    clubs(d);
    whenSeen('cgTableSec', () => table(d));
    whenSeen('cgLeadSec', () => leaders(d));
  }

  /* the side shown: ?g=, else the one this reader last chose, else the first (men's) */
  function sidePicked(S) {
    let g = new URLSearchParams(location.search).get('g');
    if (!g) { try { g = localStorage.getItem(GKEY); } catch (_) { g = null; } }
    return S.leagues.find(l => (g === 'women' ? l.part === 'Women' : l.part === 'Men')) || S.leagues[0];
  }

  async function boot(o) {
    CF = root.EpinoiaConferences;
    D = root.EpinoiaData;
    const key = new URLSearchParams(location.search).get('college');
    SYS = CF && CF.system(key);
    if (!SYS || !D) {
      const h = $('#cgRegions');
      if (h) { h.textContent = ''; h.appendChild(el('div', 'empty', 'No system called "' + (key || '') + '".')); }
      return false;
    }
    PART = sidePicked(SYS);
    hero();
    await paint();
    return true;
  }

  /* THE GAMES SECTION MOVES IN AT ONCE, not when the reads come back: secgroups.js picks the first group with something in
     it when the page is ready, and an empty Games group would hand the first tab to the next one */
  if (document.documentElement.classList.contains('m-college')) {
    const sec = $('#lgGamesSec'), hostEl = $('#cgGamesHost');
    if (sec && hostEl) hostEl.appendChild(sec);
    /* ...and the games strip goes to the system's league at once too: it opens on every league's games, and the hub's
       reads can take seconds, long enough to show a reader other countries' live games under U SPORTS's name */
    const S0 = root.EpinoiaConferences && root.EpinoiaConferences.system(new URLSearchParams(location.search).get('college'));
    if (S0) pointStrip({ slug: sidePicked(S0).slug, league: null });
  }

  root.EpinoiaCollegeHub = { boot };
})(typeof window !== 'undefined' ? window : globalThis);
