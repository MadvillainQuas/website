'use strict';
/* ============================================================================
   HOME — LEAGUES BY COUNTRY (roadmap Phase 4), section 'leagues'.

   One heading row per country (flag, name, how many leagues), then a rail of
   club-plate cards, one per league, each linking to the league's front page.
   The card is the club card from a league's own page (kit/card.css plate,
   kit/home.css grid and phone rail) so a league reads as the same kind of
   thing as a club; home/leagues.css adds only what a league card needs.

   FOUR READS, ALL IN PARALLEL, and only the first is required:
     leagues   EpinoiaGlobalGames.leagues() (cached for the page, shared with
               the fixtures section), or its own query with the same columns
               when globalgames.js is not on the page
     teams     teams?select=league_id, counted here: one small request for
               every league rather than one count per league
     seasons   newest first; the first row per league is its current season
     next      each league's next fixture, EpinoiaGlobalGames.nextFor(id)

   The cards are drawn as soon as the first three are in. The next-fixture
   line has its height reserved and fills in place, so nothing below it moves
   and front.js's #leagues re-scroll lands where it should.

   COLOURS. A league's own colours only when they came from its logo or were
   set by hand (colour_source 'logo' or 'manual'). A 'default' colour_a is just
   the platform mint copied into the row, so the card uses the platform mint on
   purpose rather than pretending it is the league's (BCB today).

   LOGOS sit on a white tile, because most arrive drawn for a white page (BCB's
   is a dark badge that disappears on the dark plate). A logo that fails to
   load, or is blocked, becomes the monogram.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;

  const MINT = '#93f2bf';
  const LEAGUE_COLS = 'id,slug,name,country,colour_a,colour_b,colour_source,logo_path,access_mode,access_fixtures_public';
  const HOUR = 3600 * 1000;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ------------------------------------------------------------ transport ---
     The fallback reads, used only when globalgames.js is missing. Same manners
     as the rest of HOME: the anon key and a member's token when access.js says
     one is worth sending. */
  async function api(path) {
    const G = window.EpinoiaGlobalGames;
    if (G && typeof G.request === 'function') return G.request(path, false);
    const c = window.EPINOIA_CONFIG;
    if (!c || !c.supabaseUrl) throw new Error('config.js has not loaded');
    const headers = { apikey: c.supabaseAnonKey, Accept: 'application/json' };
    try {
      const A = window.EpinoiaAccess;
      if (A && typeof A.authHeaders === 'function') Object.assign(headers, A.authHeaders() || {});
    } catch (_) { /* anonymous */ }
    const r = await fetch(c.supabaseUrl + '/rest/v1/' + path, { cache: 'no-store', headers });
    if (!r.ok) throw new Error(r.status + ' on ' + path.split('?')[0]);
    return r.json();
  }

  function leagues() {
    const G = window.EpinoiaGlobalGames;
    if (G && typeof G.leagues === 'function') return G.leagues();
    return api('leagues?select=' + LEAGUE_COLS + '&order=name.asc');
  }

  /* club counts by league; a club with no league counts for nobody */
  async function clubCounts() {
    const rows = await api('teams?select=league_id&league_id=not.is.null');
    const m = new Map();
    rows.forEach(r => { if (r.league_id) m.set(r.league_id, (m.get(r.league_id) || 0) + 1); });
    return m;
  }

  /* the newest season per league, by start date (a tie by name, so it never flickers) */
  async function newestSeasons() {
    const rows = await api('seasons?select=league_id,name,starts_on&order=starts_on.desc.nullslast,name.desc');
    const m = new Map();
    rows.forEach(s => { if (!m.has(s.league_id)) m.set(s.league_id, s); });
    return m;
  }

  /* THE NEXT GAME. globalgames.js's, which drops test games with no competition
     (!inner) and is shared with the fixtures section's cache. The fallback asks
     the same question in the same shape. */
  function nextFor(id) {
    const G = window.EpinoiaGlobalGames;
    if (G && typeof G.nextFor === 'function') return G.nextFor(id);
    const from = new Date(Date.now() - 2 * HOUR).toISOString();
    return api('games?select=id,tipoff_at,status,' +
      'home:home_team_id(name,short_name),away:away_team_id(name,short_name),' +
      'competitions!inner(id,seasons!inner(id,league_id))' +
      '&status=eq.scheduled&tipoff_at=gte.' + encodeURIComponent(from) +
      '&competitions.seasons.league_id=eq.' + encodeURIComponent(id) +
      '&order=tipoff_at.asc,id.asc&limit=1').then(r => r[0] || null);
  }

  /* ---------------------------------------------------------------- words --- */
  function monogram(l) {
    const name = String(l.name || l.slug || 'League').trim();
    const words = name.split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
    return (words.length >= 2 ? words.slice(0, 3).map(w => w[0]).join('') : name.slice(0, 3)).toUpperCase();
  }

  function shortTeam(t) {
    const s = String((t && t.short_name) || '').trim();
    if (s) return s;
    const n = String((t && t.name) || '').trim();
    const w = n.split(/\s+/).filter(Boolean);
    return (w.length > 1 && w[0].length <= 2 ? w[1] : w[0]) || n || '?';
  }

  function whenLabel(g, now) {
    const G = window.EpinoiaGlobalGames;
    if (G && G.dayLabel && G.timeLabel) return G.dayLabel(g.tipoff_at, now) + ' · ' + G.timeLabel(g.tipoff_at);
    const d = new Date(g.tipoff_at);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : null);

  /* the card in the league's inks (teamcolour.js), or the platform mint */
  function paint(a, l) {
    const own = l.colour_source === 'logo' || l.colour_source === 'manual';
    const A = (own && hex(l.colour_a)) || MINT;
    const B = own ? (hex(l.colour_b) || A) : null;
    const TC = window.EpinoiaTeamColour;
    if (TC && TC.card) TC.card(a, A, B);
    else a.style.setProperty('--ink-c', A);
    if (!own) a.classList.add('lgc-mint');
  }

  function monoInto(mark, l) {
    const m = monogram(l);
    mark.append(el('span', 'club-mono ghost', m), el('span', 'club-mono', m));
  }

  /* ---------------------------------------------------------------- a card --- */
  function card(l, i, total, ctx, clubs, season) {
    const a = el('a', 'club lgc');
    a.href = ctx.base + '?l=' + encodeURIComponent(l.slug || '');
    a.setAttribute('role', 'listitem');
    paint(a, l);

    const plate = el('div', 'club-plate');
    plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
    ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'club-reg ' + c)));

    const mark = el('div', 'club-mark lgc-mark');
    const url = window.epinoiaLogoUrl ? window.epinoiaLogoUrl(l.logo_path) : null;
    if (url) {
      const tile = el('span', 'lgc-tile');
      const img = el('img', 'lgc-logo');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      /* the CSP forbids inline error handlers, so the fallback is a listener */
      img.addEventListener('error', () => { tile.remove(); monoInto(mark, l); }, { once: true });
      img.src = url;
      tile.appendChild(img);
      mark.appendChild(tile);
    } else monoInto(mark, l);
    plate.appendChild(mark);

    const band = el('div', 'club-band');
    band.appendChild(el('span', null, season && season.name ? season.name + ' season' : 'no season yet'));
    plate.appendChild(band);
    plate.appendChild(el('div', 'club-grain'));
    if (l.access_mode === 'members') plate.appendChild(el('span', 'lgc-tag', 'members'));
    if (l.gender === 'women') {
      const w = el('span', 'lgc-tag lgc-w', 'W');
      w.title = 'Women\u2019s league';
      w.setAttribute('aria-hidden', 'true');
      plate.appendChild(w);
    }

    const foot = el('div', 'club-foot lgc-foot');
    foot.append(el('span', 'club-name lgc-name', l.name || l.slug || 'League'),
                el('span', 'club-ed', 'no ' + String(i + 1).padStart(2, '0') + '/' + String(total).padStart(2, '0')));

    const meta = el('div', 'lgc-meta');
    meta.appendChild(el('span', 'lgc-clubs', clubs == null ? '' : clubs + (clubs === 1 ? ' club' : ' clubs')));

    const next = el('div', 'lgc-next is-pending');
    next.appendChild(el('span', 'k', 'next'));
    next.appendChild(el('span', 'w', '…'));
    next.appendChild(el('span', 'v', ' '));

    a.append(plate, foot, meta, next);
    a.setAttribute('aria-label', (l.name || l.slug) + (l.gender === 'women' ? ', women\u2019s league' : '') +
      (clubs != null ? ', ' + clubs + (clubs === 1 ? ' club' : ' clubs') : ''));
    return { a, next };
  }

  function fillNext(slot, g, ctx, label) {
    slot.classList.remove('is-pending');
    const w = slot.querySelector('.w'), v = slot.querySelector('.v');
    if (!g) {
      slot.classList.add('is-none');
      w.textContent = 'no fixture scheduled';
      v.textContent = ' ';
      return;
    }
    const when = whenLabel(g, ctx.now);
    const match = shortTeam(g.home) + ' v ' + shortTeam(g.away);
    w.textContent = when;
    v.textContent = match;
    slot.title = 'Next: ' + when + ', ' + match;
    const a = slot.parentNode;
    if (a && a.setAttribute) a.setAttribute('aria-label', label + '. Next fixture ' + when + ', ' + match);
  }

  /* ---------------------------------------------------------------- a grid ---
     One grid of league cards, each card's next fixture filled in as it lands.
     What it reads is injected rather than fetched here, because the private
     leagues section draws these same cards from rows only its own reader may
     see and so has to ask for all of it with that reader's token. */
  function grid(ls, ctx, opts) {
    const o = opts || {};
    const counts = o.counts || null;
    const seasons = o.seasons || new Map();
    const next = typeof o.nextFor === 'function' ? o.nextFor : nextFor;
    const node = el('div', 'clubgrid lgc-grid');
    node.setAttribute('role', 'list');
    if (o.label) node.setAttribute('aria-label', o.label);
    const pending = [];
    ls.forEach((l, i) => {
      const clubs = counts ? (counts.get(l.id) || 0) : null;
      const c = card(l, i, ls.length, ctx, clubs, seasons.get(l.id));
      node.appendChild(c.a);
      const label = c.a.getAttribute('aria-label');
      pending.push(Promise.resolve().then(() => next(l.id)).then(
        g => fillNext(c.next, g, ctx, label),
        () => { c.next.classList.remove('is-pending'); c.next.classList.add('is-none');
                c.next.querySelector('.w').textContent = ''; }));
    });
    return { node, pending };
  }

  /* ------------------------------------------------------------ the section --- */
  H.register('leagues', async function (ctx) {
    const C = window.EpinoiaCountry;
    if (!C) throw new Error('country.js has not loaded');

    const [ls, counts, seasons] = await Promise.all([
      leagues(),                                     // a throw here is front.js's quiet empty state
      clubCounts().catch(() => null),
      newestSeasons().catch(() => new Map())
    ]);

    const host = ctx.host;
    host.textContent = '';
    if (!ls || !ls.length) {
      const d = el('div', 'empty', 'No leagues yet. One appears here the moment a league is created.');
      host.appendChild(d);
      ctx.fadeIn(d);
      return;
    }

    /* EACH COUNTRY IS A DROPDOWN, the same accordion as the rows in MY FOLLOWED: its flag,
       its name and how many leagues, shut until tapped, on any screen width, so the section
       reads as a list of countries rather than a wall of rails to scroll past. */

    /* THE FLAG AS A PICTURE where one is drawn (country.js flagSrc). Windows has no flag emoji
       and prints the two letters instead, and on a row whose whole identity is the flag that
       reads as a code, not a country. The emoji stays for everything not yet drawn. */
    const flagEl = grp => {
      const src = typeof C.flagSrc === 'function' ? C.flagSrc(grp.code) : '';
      const emoji = () => { const s = el('span', 'lgc-flag', grp.flag); s.setAttribute('aria-hidden', 'true'); return s; };
      if (!src) return emoji();
      const img = el('img', 'lgc-flag lgc-flag-img');
      img.alt = ''; img.width = 22; img.height = 15; img.decoding = 'async';
      img.addEventListener('error', () => img.replaceWith(emoji()), { once: true });
      img.src = ctx.base + src;
      return img;
    };

    const wrap = el('div', 'lgc-wrap');
    const pending = [];
    C.group(ls).forEach(grp => {
      const box = el('details', 'lgc-country ep-acc');
      box.setAttribute('data-country', grp.code || 'none');

      const head = el('summary', 'starrow-h lgc-h');
      const t = el('h3', 'starrow-t lgc-cn', grp.name);
      head.append(flagEl(grp), t,
        el('span', 'starrow-s lgc-n', grp.leagues.length + (grp.leagues.length === 1 ? ' league' : ' leagues')));
      box.appendChild(head);

      const g = grid(grp.leagues, ctx, { counts, seasons, label: 'Leagues in ' + grp.name });
      pending.push.apply(pending, g.pending);
      box.appendChild(g.node);
      wrap.appendChild(box);
    });

    host.appendChild(wrap);
    ctx.fadeIn(wrap);
    await Promise.all(pending);
  });

  /* The private leagues section (private-leagues.js) draws these same cards. */
  window.EpinoiaHomeLeagues = { grid };
})();
