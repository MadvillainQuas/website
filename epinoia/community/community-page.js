'use strict';
/* ============================================================================
   A LEAGUE'S COMMUNITY — community/?l=<slug>[&s=<server>].

   Built to the page standard (docs/page-standard.md): the centred head in the league's colours (teamcolour.js,
   as the league's front page), then one section per part, each with its title and subtitle and no number;
   nav.js adds ON THIS PAGE and each section's SKIP. Where a league's fans meet, in four parts:
     FIND A GAME         EPINOIA GO's own Find a game (go/nearby/nearby.js), for this league's games only:
                         the nearest first, by the fan's location or passport mode, each arena on the map with
                         the game's preview. It is GO's module itself, not a copy: the page marks its strip
                         data-scope="league" and GO reads only the league's games.
     TALK                the Discord servers the league attached (0197, league_discords): its own, a fans'
                         community, a club's. Each a card with its members and online (Discord's public answer
                         for its invitation, sent nothing but the code) and the way in; a server whose id the
                         league gave shows Discord's own widget, framed from discord.com; "show here" swaps it,
                         and &s= keeps the choice. Hidden while the league has none.
     IN THE STANDS       EPINOIA GO's feed for the league's games (go_feed, 0177): the fans' stamps as GO's stamp
                         cards and their photographs, newest first, and the way to every one on the wall.
     FURTHEST TRAVELLED  the league's GO board by distance (go_leaderboard, 0166): the fans who have covered the
                         most ground between its arenas, each to their own page (fan/?u=, 0197).

   Before EPINOIA GO's functions exist (or for a league the reader may not see) its parts simply stay away.
   Every text goes in as text; every address is checked.
   ============================================================================ */
(function () {
  const CFG = window.EPINOIA_CONFIG;
  const K = window.EpinoiaNewsCard;
  const SC = window.EpinoiaGoStampCard;
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
  const Q = new URLSearchParams(location.search);
  const WANT = Q.get('l') || '';
  const INVITE = /^https:\/\/(discord\.gg|discord\.com\/invite)\/([A-Za-z0-9-]{2,40})\/?$/i;
  const ID = /^[0-9]{15,22}$/;
  const ICON = /^https:\/\/cdn\.discordapp\.com\/icons\/[0-9]{15,22}\/[A-Za-z0-9_]{1,80}\.(png|webp|gif|jpg)(\?size=[0-9]{2,4})?$/;
  const hasWidget = s => ID.test(String(s.server_id || ''));
  const num = v => Number(v).toLocaleString();
  const hex = c => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : null);

  const headers = () => ({ apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' });
  async function rpc(fn, args) {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers: headers(), body: JSON.stringify(args || {}) });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function rest(path) {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + path, { cache: 'no-store', headers: headers() });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  const photoUrl = p => CFG.supabaseUrl + '/storage/v1/object/public/go-public/' + String(p).split('/').map(encodeURIComponent).join('/');

  /* a part that has something to show comes in; one that has nothing stays away (the index follows, nav.js) */
  const show = id => { const s = $(id); if (s) s.classList.remove('hide'); };
  const emptyBox = text => { const d = el('div', 'pg-empty'); d.appendChild(el('p', null, text)); return d; };

  (async function boot() {
    const kick = $('#cmKick'), sub = $('#cmSub');
    const away = text => { $('#find').classList.add('hide'); sub.textContent = text; };
    if (!WANT) return away('No league asked for: a league’s community is community/?l= its name.');
    let L = null;
    /* the whole row, as the league's front page reads it: its colours (0122) and its own theme */
    try { L = ((await rest('leagues?slug=eq.' + encodeURIComponent(WANT) + '&select=*&limit=1')) || [])[0] || null; }
    catch (_) { L = null; }
    if (!L) return away('No league called “' + WANT + '” is on Epinoia.');
    window.__CS_LEAGUE_SLUG = L.slug;
    document.title = 'Community · ' + L.name + ' · Epinoia';
    /* THE LEAGUE'S OWN COLOURS, as on its front page: the title's gradient, the accent, the rail */
    if (window.EpinoiaTeamColour && window.EpinoiaTeamColour.league) {
      try { window.EpinoiaTeamColour.league(L, { keepAccent: !!(L.theme && L.theme.accent) }); } catch (_) { /* the kit's colours */ }
    }
    document.getElementById('community').style.setProperty('--bc', hex(L.colour_a) || K.tint(L.name));
    /* the head: the league it belongs to (to its front page), the page's name, what it is for */
    const a = el('a');
    a.href = '../?l=' + encodeURIComponent(L.slug);
    if (L.logo_path && typeof window.epinoiaLogoUrl === 'function') {
      const img = el('img'); img.src = window.epinoiaLogoUrl(L.logo_path, 64); img.alt = ''; img.width = 28; img.height = 28;
      a.appendChild(img);
    }
    a.appendChild(data('span', null, L.name));
    kick.textContent = '';
    kick.appendChild(a);
    sub.textContent = 'Where ' + L.name + '’s fans meet: its games near you, the stamps and photographs from its arenas, who has travelled furthest, and where they talk.';
    $('#cmWall').href = '../go/photos/?l=' + encodeURIComponent(L.id);
    await Promise.all([talk(L).catch(() => {}), stands(L).catch(() => {}), board(L).catch(() => {})]);
  })();

  /* ---------------------------------------------------------------- talk --- */
  /* how many are in a server and online, from Discord's public answer for its invitation (no sign-in, no cookie) */
  async function counts(invite) {
    const m = INVITE.exec(String(invite || ''));
    if (!m) return null;
    try {
      const r = await fetch('https://discord.com/api/v10/invites/' + encodeURIComponent(m[2]) + '?with_counts=true',
        { cache: 'no-store', credentials: 'omit' });
      if (r.status === 404) return { gone: true };
      if (!r.ok) return null;                                   // busy (429) or down: the card simply has no numbers
      const j = await r.json();
      return { members: j.approximate_member_count, online: j.approximate_presence_count };
    } catch (_) { return null; }
  }

  async function talk(L) {
    let D = null;
    try { D = await rpc('league_discord_public', { p_slug: L.slug }); } catch (_) { D = null; }
    const servers = ((D && D.servers) || []).filter(s => hasWidget(s) || INVITE.test(String(s.invite || '')));
    if (!servers.length) return;
    const host = $('#cmServers');
    if (servers.length > 1) $('#talkSub').textContent = servers.length + ' Discord servers: who is online, and the way into each';
    const wrap = el('div', 'fo-wrap');
    host.appendChild(wrap);

    /* the widget: the chosen server's, or the first with one */
    const framed = servers.filter(hasWidget);
    let open = framed.find(s => s.id === Q.get('s')) || framed[0] || null;
    let frame = null;
    const cards = new Map();
    if (open) {
      const col = el('div', 'fo-wcol');
      const box = el('div', 'fo-widget');
      frame = document.createElement('iframe');
      frame.loading = 'lazy';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
      box.appendChild(frame);
      col.appendChild(box);
      col.appendChild(el('p', 'fo-note', 'An empty box means the server’s widget is switched off: its owner turns it on in Discord (Server Settings, Widget, Enable Server Widget).'));
      wrap.appendChild(col);
    }
    function showServer(s, remember) {
      if (!frame || !s || !hasWidget(s)) return;
      open = s;
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      frame.src = 'https://discord.com/widget?id=' + s.server_id + '&theme=' + (dark ? 'dark' : 'light');
      frame.title = s.name + ' on Discord';
      cards.forEach((c, id) => {
        c.card.classList.toggle('on', id === s.id);
        if (c.pick) { c.pick.textContent = id === s.id ? 'Showing' : 'Show here'; c.pick.disabled = id === s.id; }
      });
      if (remember) {
        try { history.replaceState(null, '', '?l=' + encodeURIComponent(L.slug) + '&s=' + encodeURIComponent(s.id) + '#talk'); } catch (_) { /* file:// */ }
      }
    }

    const list = el('div', 'fo-list');
    servers.forEach(s => {
      const card = el('article', 'fo-srv' + (s.official ? ' official' : ''));
      const icon = el('span', 'fo-ic');
      if (ICON.test(String(s.icon_url || ''))) {
        const img = el('img'); img.src = s.icon_url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        img.addEventListener('error', () => { icon.textContent = ''; icon.appendChild(el('span', null, K.initials(s.name))); });
        icon.appendChild(img);
      } else icon.appendChild(el('span', null, K.initials(s.name)));
      card.appendChild(icon);
      const body = el('div', 'fo-body');
      const whose = el('div', 'fo-whose');
      if (s.official) whose.appendChild(el('span', 'fo-badge official', 'Official'));
      if (s.club && s.club.slug) {
        const c = el('a', 'fo-badge club', s.club.name);
        c.href = '../t/?t=' + encodeURIComponent(s.club.slug);
        if (hex(s.club.colour)) c.style.setProperty('--cc', s.club.colour);
        whose.appendChild(c);
      }
      if (!s.official && !(s.club && s.club.slug)) whose.appendChild(el('span', 'fo-badge', 'Community'));
      body.appendChild(whose);
      body.appendChild(el('h3', 'fo-name', s.name));
      if (s.note) body.appendChild(el('p', 'fo-line', s.note));
      const count = el('div', 'fo-count');
      body.appendChild(count);
      const acts = el('div', 'fo-acts');
      let join = null;
      if (INVITE.test(String(s.invite || ''))) {
        join = el('a', 'fo-join', 'Join ↗');
        join.href = s.invite; join.target = '_blank'; join.rel = 'noopener noreferrer';
        acts.appendChild(join);
      }
      let pick = null;
      if (frame && hasWidget(s) && framed.length > 1) {
        pick = el('button', 'fo-pick', 'Show here'); pick.type = 'button';
        pick.addEventListener('click', () => { showServer(s, true); if (window.matchMedia && matchMedia('(max-width:760px)').matches) frame.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
        acts.appendChild(pick);
      }
      if (acts.childNodes.length) body.appendChild(acts);
      card.appendChild(body);
      cards.set(s.id, { card, pick });
      list.appendChild(card);
      if (join) counts(s.invite).then(c => {
        if (!c) return;
        if (c.gone) { count.textContent = 'This invitation has expired.'; join.remove(); return; }
        const bits = [];
        if (c.members) bits.push(num(c.members) + ' members');
        if (c.online) bits.push(num(c.online) + ' online');
        count.textContent = bits.join(' · ');
      });
    });
    wrap.appendChild(list);
    showServer(open, false);
    show('#talk');
    if (Q.get('s') || location.hash === '#talk') $('#talk').scrollIntoView({ block: 'start' });
  }

  /* ------------------------------------------------------------ in the stands --- */
  async function stands(L) {
    let rows;
    try { rows = await rpc('go_feed', { p_league: L.id, p_sort: 'new', p_offset: 0, p_limit: 12 }); }
    catch (_) { return; }                                      // no EPINOIA GO here yet
    const host = $('#cmFeed');
    host.textContent = '';
    rows = Array.isArray(rows) ? rows : [];
    if (!rows.length) {
      host.appendChild(emptyBox('No stamps from ' + L.name + '’s games yet. Be the first: find a game above, go, and stamp the arena on EPINOIΛ GO.'));
      $('#cmWall').classList.add('hide');
      show('#stands');
      return;
    }
    /* a row that slides when it is longer than the page, and sits in the middle when it is not */
    const view = el('div', 'cm-strip');
    const strip = el('div', 'cm-strip-in');
    view.appendChild(strip);
    rows.forEach(row => {
      if (row.kind === 'photo' && row.thumb_path) {
        const a = el('a', 'cm-photo');
        a.href = '../go/photos/?p=' + encodeURIComponent(row.id);
        const img = el('img');
        img.src = photoUrl(row.thumb_path); img.alt = row.caption || ''; img.loading = 'lazy'; img.decoding = 'async';
        a.appendChild(img);
        const cap = el('span', 'cm-photo-cap');
        cap.appendChild(data('b', null, '@' + (row.username || '')));
        cap.appendChild(data('span', null, [row.home && row.away ? row.home + ' v ' + row.away : row.venue].filter(Boolean).join('')));
        a.appendChild(cap);
        strip.appendChild(a);
      } else if (row.kind === 'stamp' && SC) {
        strip.appendChild(SC.build(row, { href: row.game_id ? '../game/?g=' + encodeURIComponent(row.game_id) + '&mode=supabase' : '../go/', cls: 'cm-stamp' }));
      }
    });
    host.appendChild(view);
    show('#stands');
  }

  /* ------------------------------------------------------ furthest travelled --- */
  async function board(L) {
    let rows;
    try { rows = await rpc('go_leaderboard', { p_league: L.id, p_by: 'km', p_limit: 10 }); }
    catch (_) { return; }
    const host = $('#cmBoardList');
    host.textContent = '';
    rows = (Array.isArray(rows) ? rows : []).filter(r => Number(r.km) > 0);
    if (!rows.length) {
      host.appendChild(emptyBox('Nobody on this board yet: stamp two of ' + L.name + '’s arenas on EPINOIΛ GO and the distance between them counts.'));
      show('#travelled');
      return;
    }
    const list = el('ol', 'cm-board');
    rows.forEach(r => {
      const li = el('li', 'cm-row' + (r.me ? ' me' : '') + (Number(r.rank) <= 3 ? ' r' + r.rank : ''));
      li.appendChild(data('span', 'cm-rank', String(r.rank)));
      const who = data('a', 'cm-who', '@' + r.username);
      who.href = '../fan/?u=' + encodeURIComponent(r.username);
      li.appendChild(who);
      const km = el('span', 'cm-km');
      km.appendChild(data('b', null, Number(r.km).toLocaleString(undefined, { maximumFractionDigits: 0 })));
      km.appendChild(el('small', null, ' km'));
      li.appendChild(km);
      li.appendChild(el('span', 'cm-sub', num(r.arenas) + ' arenas · ' + num(r.stamps) + ' games'));
      list.appendChild(li);
    });
    host.appendChild(list);
    show('#travelled');
  }
})();
