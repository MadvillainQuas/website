'use strict';
/* ============================================================================
   A FAN'S PAGE — fan/?u=<username> (migration 0197).

   Only a fan who is public on EPINOIA GO has one (fan_profile_public answers
   nothing otherwise, the same as a name that does not exist). Drawn in the
   fan's own colour, on the post card's head (newscard.js hero):

     THE HEAD      their picture, name, @username and since when, their line,
                   and the ways to them: their social accounts and Discord
     THEIR CLUB    the club they chose, to its page
     ARENAS        the arenas of the stamps they show, ticked off (go/arenaticks.js)
     THE PASSPORT  EPINOIA GO's numbers - arenas, stamps, kilometres - and the
                   board rank; their stamps as GO's stamp cards and their
                   photographs, when they show them (go_feed, 0177)
     FOLLOWS       the leagues and clubs they follow, when they show them
                   (public leagues only: the database leaves the rest out)

   Every text goes in as text; every address is checked.
   ============================================================================ */
(function () {
  const CFG = window.EPINOIA_CONFIG;
  const K = window.EpinoiaNewsCard;
  const SC = window.EpinoiaGoStampCard;
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const https = u => typeof u === 'string' && /^https:\/\/[^\s<>"]+$/i.test(u);
  const WANT = (new URLSearchParams(location.search).get('u') || '').trim();
  /* the platforms a profile may link (0194 clean_creator_links), in the order they are shown */
  const PLATFORMS = [['website', 'Website'], ['instagram', 'Instagram'], ['x', 'X'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'],
    ['twitch', 'Twitch'], ['threads', 'Threads'], ['bluesky', 'Bluesky'], ['facebook', 'Facebook'], ['substack', 'Substack'],
    ['podcast', 'Podcast'], ['spotify', 'Spotify'], ['apple_podcasts', 'Apple Podcasts'], ['patreon', 'Patreon'], ['discord', 'Discord']];

  async function rpc(fn, args) {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, {
      method: 'POST', cache: 'no-store',
      headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(args || {})
    });
    if (r.status === 404) { const e = new Error('absent'); e.absent = true; throw e; }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status));
    return j;
  }
  const photoUrl = p => CFG.supabaseUrl + '/storage/v1/object/public/go-public/' + String(p).split('/').map(encodeURIComponent).join('/');
  const crest = t => (typeof window.epinoiaCrest === 'function' ? window.epinoiaCrest(t, { cls: 'ep-crest fn-crest' }) : el('span', 'ep-crest fn-crest', (t.short_name || t.name || '?').slice(0, 3)));
  function empty(text, link) {
    const d = el('div', 'pc-empty', text);
    if (link) { d.append(' '); const a = el('a', null, link.text); a.href = link.href; d.appendChild(a); }
    return d;
  }
  const since = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }); };
  const n = v => Number(v || 0).toLocaleString();

  (async function boot() {
    const main = $('#fan');
    if (!WANT) { main.textContent = ''; main.appendChild(empty('Whose page? A fan’s page is fan/?u= their username.', { text: 'EPINOIΛ GO →', href: '../go/' })); return; }
    let p = null;
    try { p = await rpc('fan_profile_public', { p_username: WANT }); }
    catch (e) {
      main.textContent = '';
      main.appendChild(empty(e.absent ? 'Fans’ pages open soon.' : 'This page could not be loaded just now.'));
      return;
    }
    main.textContent = '';
    if (!p) {
      main.appendChild(empty('No public page for “' + WANT + '”. A fan’s page shows once they go public on EPINOIΛ GO.',
        { text: 'EPINOIΛ GO →', href: '../go/' }));
      return;
    }
    document.title = (p.name || '@' + p.username) + ' · Epinoia';
    const colour = /^#[0-9a-f]{6}$/i.test(p.colour || '') ? p.colour : K.tint(p.username);

    /* ---- the head ---- */
    const L = p.links || {};
    const links = PLATFORMS.filter(([k]) => https(L[k])).map(([k, label]) => ({ href: L[k], text: label + ' ↗', external: true }));
    const d = p.discord;
    if (d && /^[0-9]{15,22}$/.test(String(d.id || ''))) links.push({ href: 'https://discord.com/users/' + d.id, text: 'Discord · ' + (d.username || d.global_name || '') + ' ↗', external: true });
    const head = K.hero({
      name: p.name || '@' + p.username, logo: https(p.avatar_url) ? p.avatar_url : null, colour,
      kicker: '@' + p.username + (p.since ? ' · fan since ' + since(p.since) : ''),
      tagline: p.bio || '', links
    });
    head.classList.add('fn-head');
    main.appendChild(head);

    const wrap = el('div', 'fn-wrap');
    wrap.style.setProperty('--bc', colour);
    main.appendChild(wrap);

    /* ---- their club ---- */
    if (p.club && p.club.slug) {
      const c = el('a', 'fn-club');
      c.href = '../t/?t=' + encodeURIComponent(p.club.slug);
      if (/^#[0-9a-f]{6}$/i.test(p.club.colour || '')) c.style.setProperty('--cc', p.club.colour);
      c.append(crest(p.club));
      const w = el('span', 'fn-club-w');
      w.append(el('span', 'fn-k', 'Their club'), el('b', null, p.club.name));
      if (p.club.league) w.append(el('span', 'fn-sub', p.club.league.name));
      c.appendChild(w);
      wrap.appendChild(c);
    }

    /* ---- the passport ---- */
    const g = p.go || {};
    const pass = el('section', 'fn-pass');
    pass.appendChild(el('div', 'pc-sec-h', 'EPINOIΛ GO passport'));
    const nums = el('div', 'fn-nums');
    [[n(g.arenas), 'arenas'], [n(g.stamps), 'stamps'], [Number(g.km || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }), 'travelled', 'km'],
     [p.rank ? '#' + p.rank : '—', 'on the board'], [n(p.photos), 'photographs']].forEach(([v, k, unit]) => {
      const b = el('div', 'fn-num');
      const big = el('b', null, v);
      if (unit) big.appendChild(el('small', null, unit));
      b.append(big, el('span', null, k));
      nums.appendChild(b);
    });
    pass.appendChild(nums);
    wrap.appendChild(pass);

    /* their stamps and photographs, when they show them */
    if (p.stamps_public || Number(p.photos) > 0) {
      const sec = el('section', 'fn-stamps');
      const h = el('div', 'pc-sec-h');
      h.appendChild(el('span', null, 'Games been to'));
      const all = el('a', null, 'every photograph →');
      all.href = '../go/photos/?u=' + encodeURIComponent(p.username);
      h.appendChild(all);
      sec.appendChild(h);
      const grid = el('div', 'fn-grid');
      sec.appendChild(grid);
      wrap.appendChild(sec);
      try {
        const rows = await rpc('go_feed', { p_username: p.username, p_sort: 'new', p_offset: 0, p_limit: 96 }) || [];
        /* ARENAS TICKED OFF: the arenas of the stamps they show, a tick each (go/arenaticks.js), above the games */
        const AT = window.EpinoiaArenaTicks, ticked = AT ? AT.group(rows.filter(r => r.kind === 'stamp')) : [];
        if (p.stamps_public && AT && ticked.length) {
          const ts = el('section', 'fn-ticks');
          const th = el('div', 'pc-sec-h');
          th.appendChild(el('span', null, 'Arenas ticked off'));
          ts.appendChild(th);
          const tg = ts.appendChild(el('div'));
          AT.draw(tg, ticked, {});
          wrap.insertBefore(ts, sec);
        }
        rows.slice(0, 24).forEach(row => {                // the games: the newest 24 (the arenas above read them all)
          if (row.kind === 'photo' && row.thumb_path) {
            const a = el('a', 'fn-photo');
            a.href = '../go/photos/?p=' + encodeURIComponent(row.id);
            const img = el('img');
            img.src = photoUrl(row.thumb_path); img.alt = row.caption || ''; img.loading = 'lazy'; img.decoding = 'async';
            a.appendChild(img);
            const cap = [row.home && row.away ? row.home + ' v ' + row.away : row.venue, row.league].filter(Boolean).join(' · ');
            if (cap) a.appendChild(el('span', 'fn-photo-cap', cap));
            grid.appendChild(a);
          } else if (row.kind === 'stamp' && SC) {
            grid.appendChild(SC.build(row, { href: row.game_id ? '../game/?g=' + encodeURIComponent(row.game_id) + '&mode=supabase' : '../go/', cls: 'fn-stamp' }));
          }
        });
        if (!rows.length) grid.appendChild(empty('Nothing shown yet.'));
      } catch (_) { grid.appendChild(empty('The stamps could not be loaded just now.')); }
    }

    /* ---- what they follow ---- */
    const f = p.follows;
    if (f && ((f.leagues || []).length || (f.clubs || []).length)) {
      const sec = el('section', 'fn-follows');
      sec.appendChild(el('div', 'pc-sec-h', 'Follows'));
      const row = el('div', 'fn-chips');
      (f.leagues || []).forEach(l => {
        const a = el('a', 'fn-chip');
        a.href = '../?l=' + encodeURIComponent(l.slug);
        if (/^#[0-9a-f]{6}$/i.test(l.colour || '')) a.style.setProperty('--cc', l.colour);
        a.append(crest({ name: l.name, colour: l.colour, logo_path: l.logo_path }), el('span', null, l.name));
        row.appendChild(a);
      });
      (f.clubs || []).forEach(c => {
        const a = el('a', 'fn-chip');
        a.href = '../t/?t=' + encodeURIComponent(c.slug);
        if (/^#[0-9a-f]{6}$/i.test(c.colour || '')) a.style.setProperty('--cc', c.colour);
        a.append(crest(c), el('span', null, c.name));
        row.appendChild(a);
      });
      sec.appendChild(row);
      wrap.appendChild(sec);
    }
  })();
})();
