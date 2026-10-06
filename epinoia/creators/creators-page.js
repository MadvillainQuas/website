'use strict';
/* ============================================================================
   A LEAGUE'S CREATORS (migration 0194) — three views in one document:

     creators/?l=<league>                   the league's creators: each outlet as a
                                            tile (its mark, its line, its platforms,
                                            a bell), and their latest pieces
     creators/?l=<league>&o=<outlet>        one outlet's page: its head in its own
                                            colours, the ways to its platforms, the
                                            bell, its bio, and its pieces - a video,
                                            an episode or a post played in the card
     creators/?l=<league>&o=<outlet>&p=<p>  one piece, in the outlet's colourway: an
                                            article in the league's block format, or
                                            the video / episode / post itself with its
                                            caption and the way to it where it lives

   Everything comes through the public creator functions, which answer nothing for a
   league the reader may not see, a league with creators switched off, a suspended
   outlet or a hidden piece. A members-only league's reads carry a member's token, as
   the news page's do (access.js).
   ============================================================================ */
const CFG = window.EPINOIA_CONFIG;
const K = window.EpinoiaNewsCard;
const B = window.EpinoiaNewsBlocks;
const N = window.EpinoiaNews;
/* THE RANKED FEED (feedrank.js), as on the News page: the official partners' pill, what is opened and visited (kept on this
   device only). All optional: without the script this page is what it was. */
const FR = window.EpinoiaFeedRank || null;
let PARTNERS = new Set();
const partnersReady = FR ? FR.partners().then(s => { PARTNERS = s; return s; }, () => PARTNERS) : Promise.resolve(PARTNERS);
const onOpen = it => { try { if (FR && it && it.row) FR.opened(it.row); } catch (_) { /* never in the reader's way */ } };
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

const Q = new URLSearchParams(location.search);
const WANT = Q.get('l') || '';
const OUTLET = Q.get('o') || '';
const PIECE = Q.get('p') || '';
const PAGE = 12;

/* the platforms an outlet may link (0194 clean_creator_links), in the order they are shown */
const PLATFORMS = [['website', 'Website'], ['youtube', 'YouTube'], ['podcast', 'Podcast'], ['spotify', 'Spotify'],
  ['apple_podcasts', 'Apple Podcasts'], ['substack', 'Substack'], ['x', 'X'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'],
  ['twitch', 'Twitch'], ['threads', 'Threads'], ['bluesky', 'Bluesky'], ['facebook', 'Facebook'], ['discord', 'Discord'],
  ['patreon', 'Patreon']];

function withAuth(headers, anon) {
  const A = window.EpinoiaAccess;
  if (!anon && A && typeof A.authHeaders === 'function') {
    try { Object.assign(headers, A.authHeaders() || {}); } catch (_) { /* anonymous */ }
  }
  return headers;
}
async function api(p, anon) {
  const headers = withAuth({ apikey: CFG.supabaseAnonKey, Accept: 'application/json' }, anon);
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`, { cache: 'no-store', headers });
  if (r.status === 401 && headers.Authorization) return api(p, true);
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}
async function rpc(fn, args, anon) {
  const headers = withAuth({ apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' }, anon);
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, { method: 'POST', cache: 'no-store', headers, body: JSON.stringify(args || {}) });
  if (r.status === 401 && headers.Authorization) return rpc(fn, args, true);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status));
  return j;
}

const crestUrl = p => (typeof window.epinoiaLogoUrl === 'function' && window.epinoiaLogoUrl(p, 64)) ||
  (p && /^https:\/\//.test(p) ? p : null);
const outletHref = (league, slug) => '?l=' + encodeURIComponent(league.slug) + '&o=' + encodeURIComponent(slug);
const pieceHref = (league, o, slug) => outletHref(league, o) + '&p=' + encodeURIComponent(slug);
const leagueTag = league => K.tagsOf([{ slug: league.slug, name: league.name, colour: league.colour_a, logo: league.logo_path }], '../', crestUrl);
const bellFor = (id, name, cls) => {
  const F = window.EpinoiaFollow;
  return F && id ? F.bell('outlet', id, { label: 'Follow', labelOn: 'Following', name, cls: cls || 'lbl big' }) : null;
};

/* a piece as a post card's item: on this site, its outlet's page at the foot */
function pieceItem(league, x, outlet) {
  const o = outlet || { slug: x.outlet_slug, name: x.outlet_name, logo_url: x.outlet_logo, colour: x.outlet_colour };
  const e = K.embedOf(x.external_url, location.hostname);
  return {
    kind: K.KIND[x.kind] ? x.kind : 'article', title: x.title, summary: x.standfirst,
    piece: x.id || null, outlet: league.slug + '/' + o.slug,
    image: (x.cover_url && /^https:\/\//.test(x.cover_url) ? x.cover_url : null) || (e && e.thumb) || null,
    when: x.published_at, author: x.author_name,
    href: pieceHref(league, o.slug, x.slug),
    platform: e ? e.label : (x.external_url ? K.host(x.external_url) : null),
    embedUrl: x.kind !== 'article' ? (x.external_url || null) : null,
    brand: { name: o.name, logo: o.logo_url, colour: o.colour, href: outlet ? null : outletHref(league, o.slug) },
    /* what "opened" reads, and the key the pill is looked up by */
    id: x.id, pkey: 'outlet:' + league.slug + '/' + o.slug,
    row: { id: x.id, kind: 'creator', league_slug: league.slug, outlet_slug: o.slug, slug: x.slug, source_name: o.name,
           leagues: [{ slug: league.slug, name: league.name }] }
  };
}

function empty(text, link) {
  const d = el('div', 'pc-empty', text);
  if (link) { d.append(' '); const a = el('a', null, link.text); a.href = link.href; d.appendChild(a); }
  return d;
}

/* A MEMBERS-ONLY LEAGUE'S CREATORS ARE THE MEMBERS': the paywall card, as on its news page */
async function wall(league) {
  const A = window.EpinoiaAccess;
  if (!A || typeof A.load !== 'function' || typeof A.get !== 'function') return false;
  try { await A.load({ leagueId: league.id, leagueSlug: league.slug }); } catch (_) { return false; }
  const st = A.get(league.id) || {};
  const walled = !!(st.known && typeof A.canView === 'function' && !A.canView(league.id));
  if (!walled || typeof A.paywallHTML !== 'function') return false;
  const w = $('#accessWall');
  w.innerHTML = A.paywallHTML({ league });
  w.classList.remove('hide');
  $('#main').classList.add('hide');
  return true;
}

(async function boot() {
  const main = $('#main');
  if (!WANT) {
    main.textContent = '';
    main.appendChild(empty('No league asked for. Every league’s creators are in the news:', { text: 'all news →', href: '../news/?k=creators' }));
    return;
  }
  let league = null;
  try {
    const ls = await api('leagues?slug=eq.' + encodeURIComponent(WANT) + '&select=id,slug,name,colour_a,logo_path&limit=1');
    league = ls[0] || null;
  } catch (_) { /* below */ }
  if (!league) {
    main.textContent = '';
    main.appendChild(empty('No league called “' + WANT + '”.'));
    return;
  }
  window.__CS_LEAGUE_SLUG = league.slug;
  const back = $('#back');
  const foot = $('#footLeague');
  foot.textContent = league.name; foot.href = '../?l=' + encodeURIComponent(league.slug); foot.classList.remove('hide');
  if (await wall(league)) return;
  if (PIECE && OUTLET) {
    back.textContent = '← the outlet'; back.href = outletHref(league, OUTLET);
    return piece(league);
  }
  if (OUTLET) {
    back.textContent = '← ' + league.name + ' creators'; back.href = '?l=' + encodeURIComponent(league.slug);
    return outlet(league);
  }
  back.textContent = '← ' + league.name; back.href = '../?l=' + encodeURIComponent(league.slug);
  return directory(league);
})();

/* ------------------------------------------------------------ ?l= --- */
async function directory(league) {
  const main = $('#main');
  document.title = 'Creators · ' + league.name;
  let outlets = [], first = [];
  try {
    [outlets, first] = await Promise.all([
      rpc('creator_outlets_public', { p_league: league.id }),
      rpc('creators_public', { p_league: league.id, p_limit: PAGE, p_offset: 0 })
    ]);
  } catch (e) {
    main.textContent = '';
    main.appendChild(empty('Could not load the creators: ' + e.message));
    return;
  }
  main.textContent = '';
  await partnersReady;
  main.appendChild(K.hero({
    name: 'Creators', logo: crestUrl(league.logo_path), colour: league.colour_a,
    kicker: league.name + ' · independent voices',
    tagline: 'The podcasts, channels and writers around ' + league.name + ': their own voices, not the league’s, on the league’s pages.',
    links: [{ href: '../?l=' + encodeURIComponent(league.slug), text: league.name + ' →' }]
  }));
  const wrap = el('div', 'cr-wrap');
  main.appendChild(wrap);
  if (!(outlets || []).length) {
    wrap.appendChild(empty('No creators here yet. When the league opens an outlet and it publishes, it appears here and on the league’s front page.'));
    return;
  }
  wrap.appendChild(el('div', 'pc-sec-h cr-h', 'The creators'));
  const tiles = el('div', 'cr-tiles');
  (outlets || []).forEach(o => tiles.appendChild(tile(league, o)));
  wrap.appendChild(tiles);

  const h = el('div', 'pc-sec-h cr-h');
  h.appendChild(el('span', null, 'Latest'));
  const allNews = el('a', null, 'in the news →');
  allNews.href = '../news/?l=' + encodeURIComponent(league.slug);
  h.appendChild(allNews);
  wrap.appendChild(h);
  const grid = K.grid((first || []).map(x => pieceItem(league, x)), { now: Date.now(), showLeague: false, partners: PARTNERS, onOpen });
  wrap.appendChild(grid);
  const total = Number((first && first[0] && first[0].total) || 0);
  if (total > PAGE) {
    let offset = PAGE;
    const more = el('div', 'pc-more');
    const btn = el('button', 'ep-btn', 'Older pieces');
    btn.type = 'button';
    more.appendChild(btn);
    wrap.appendChild(more);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const rows = await rpc('creators_public', { p_league: league.id, p_limit: PAGE, p_offset: offset }) || [];
        rows.forEach(x => grid.appendChild(K.card(pieceItem(league, x), { now: Date.now(), showLeague: false, partners: PARTNERS, onOpen })));
        offset += rows.length;
        if (offset >= total || !rows.length) more.remove();
      } catch (_) { /* the button stays for another go */ }
      btn.disabled = false;
    });
  }
}

/* an outlet as a tile: its print, its mark, its name and line, what it has published, its platforms, the bell */
function tile(league, o) {
  const t = el('article', 'cr-tile');
  t.style.setProperty('--bc', /^#[0-9a-f]{6}$/i.test(o.colour || '') ? o.colour : K.tint(o.name));
  const top = el('a', 'cr-tile-top');
  top.href = outletHref(league, o.slug);
  top.setAttribute('aria-label', o.name);
  top.append(el('span', 'pc-flood'), el('span', 'pc-tone'), K.mark({ name: o.name, logo: o.logo_url }, 'pc-disc'));
  if (PARTNERS.has('outlet:' + league.slug + '/' + o.slug)) top.appendChild(K.partnerPill('in-tile', 'outlet:' + league.slug + '/' + o.slug));
  t.appendChild(top);
  const body = el('div', 'cr-tile-body');
  const name = el('a', 'cr-tile-name', o.name);
  name.href = outletHref(league, o.slug);
  body.appendChild(name);
  if (o.tagline) body.appendChild(el('p', 'cr-tile-tag', o.tagline));
  body.appendChild(el('div', 'cr-tile-meta', Number(o.pieces || 0) + (Number(o.pieces) === 1 ? ' piece' : ' pieces') +
    (o.last_at ? ' · ' + K.ago(o.last_at) : '')));
  const links = platformRow(o.links, true);
  if (links) body.appendChild(links);
  t.appendChild(body);
  const bell = bellFor(o.id, o.name, 'lbl');
  if (bell) { const f = el('div', 'cr-tile-foot'); f.appendChild(bell); t.appendChild(f); }
  return t;
}

/* the outlet's platforms as buttons (small: a row of names; else the hero's buttons) */
function platformRow(links, small) {
  const L = links || {};
  const have = PLATFORMS.filter(([k]) => typeof L[k] === 'string' && /^https:\/\//i.test(L[k]));
  if (!have.length) return null;
  const row = el('div', small ? 'cr-plats' : 'cr-plats big');
  have.forEach(([k, label]) => {
    const a = el('a', 'cr-plat cr-' + k, label);
    a.href = L[k]; a.target = '_blank'; a.rel = 'noopener noreferrer';
    row.appendChild(a);
  });
  return row;
}

/* ------------------------------------------------------- ?l=&o= --- */
async function outlet(league) {
  const main = $('#main');
  let o = null;
  try { o = await rpc('creator_outlet_public', { p_league: league.id, p_slug: OUTLET }); } catch (_) { /* below */ }
  main.textContent = '';
  if (!o) {
    main.appendChild(empty('That outlet is not here. It may have been closed, or the league has switched creators off.',
      { text: league.name + ' creators →', href: '?l=' + encodeURIComponent(league.slug) }));
    return;
  }
  document.title = o.name + ' · ' + league.name;
  await partnersReady;
  const okey = 'outlet:' + league.slug + '/' + o.slug;
  /* an outlet's page visited, and an outlet followed here: a reason to like it (on this device only) */
  if (FR) {
    try { FR.visited(okey); } catch (_) { /* nothing */ }
    window.addEventListener('epinoia:follows', e => {
      const d = e && e.detail;
      if (d && d.on && d.kind === 'outlet') { try { FR.store().followed({ key: okey }); } catch (_) { /* nothing */ } }
    });
  }
  const L = o.links || {};
  const first = PLATFORMS.find(([k]) => typeof L[k] === 'string' && /^https:\/\//i.test(L[k]));
  main.appendChild(K.hero({
    partner: PARTNERS.has(okey),
    name: o.name, logo: o.logo_url, colour: o.colour,
    kicker: 'Creator · ' + league.name,
    tagline: o.tagline || '',
    links: first ? [{ href: L[first[0]], text: (first[0] === 'website' ? 'Visit ' + (K.host(L.website) || 'their site') : first[1]) + ' ↗',
                      external: true, primary: true }] : [],
    bell: bellFor(o.id, o.name)
  }));
  const wrap = el('div', 'cr-wrap');
  wrap.style.setProperty('--bc', /^#[0-9a-f]{6}$/i.test(o.colour || '') ? o.colour : K.tint(o.name));
  main.appendChild(wrap);
  const plats = platformRow(o.links);
  if (plats || o.bio) {
    const about = el('section', 'cr-about');
    if (o.bio) o.bio.split(/\n{2,}/).forEach(par => about.appendChild(el('p', 'cr-bio', par.trim())));
    if (plats) { about.appendChild(el('div', 'cr-about-h', 'Find them on')); about.appendChild(plats); }
    wrap.appendChild(about);
  }
  const posts = o.posts || [];
  const h = el('div', 'pc-sec-h cr-h');
  h.appendChild(el('span', null, posts.length ? 'Their pieces' : 'Nothing published yet'));
  wrap.appendChild(h);
  if (posts.length) {
    /* a video, an episode or a post plays in its card here: this is their page */
    wrap.appendChild(K.grid(posts.map(x => pieceItem(league, x, o)), { now: Date.now(), embed: true, host: location.hostname, showLeague: false, partners: PARTNERS, onOpen }));
  }
}

/* ---------------------------------------------------- ?l=&o=&p= --- */
async function piece(league) {
  const main = $('#main');
  let x = null;
  try { x = await rpc('creator_post_public', { p_league: league.id, p_outlet: OUTLET, p_slug: PIECE }); } catch (_) { /* below */ }
  main.textContent = '';
  if (!x) {
    main.appendChild(empty('That piece is not here. It may have been taken down.',
      { text: 'the outlet →', href: outletHref(league, OUTLET) }));
    return;
  }
  const o = x.outlet || {};
  const colour = /^#[0-9a-f]{6}$/i.test(o.colour || '') ? o.colour : K.tint(o.name);
  const K0 = K.KIND[x.kind] || K.KIND.article;
  const e = x.kind !== 'article' ? K.embedOf(x.external_url, location.hostname) : null;
  const cover = x.cover_url && /^https:\/\//.test(x.cover_url) ? x.cover_url : null;
  /* the title and the description the creator wrote for search engines and link previews (0200) */
  document.title = (x.seo_title || x.title) + ' · ' + (o.name || league.name);
  const desc = x.seo_description || x.standfirst;
  if (desc) {
    let m = document.querySelector('meta[name="description"]');
    if (!m) { m = document.createElement('meta'); m.name = 'description'; document.head.appendChild(m); }
    m.content = desc;
  }
  await partnersReady;
  /* a piece opened here (from a notification, a card, a link): it is read, its outlet gains (this device only) */
  if (FR && o.slug) { try { FR.opened({ kind: 'creator', league_slug: league.slug, outlet_slug: o.slug, slug: x.slug, source_name: o.name,
                                       leagues: [{ slug: league.slug, name: league.name }] }); } catch (_) { /* nothing */ } }

  main.appendChild(K.masthead({
    partner: !!o.slug && PARTNERS.has('outlet:' + league.slug + '/' + o.slug),
    brand: { name: o.name, logo: o.logo_url, colour, href: outletHref(league, o.slug) },
    kind: e ? K0.word + ' · ' + e.label : K0.word,
    title: x.title,
    meta: [x.published_at ? N.when(x.published_at) : '', x.author_name ? 'by ' + x.author_name : ''],
    tags: leagueTag(league),
    bell: bellFor(o.id, o.name, 'lbl'),
    figure: !!(cover || e)
  }));

  const wrap = el('div', 'pc-read cr-piece');
  wrap.style.setProperty('--bc', colour);
  if (e) {
    /* the video, the episode or the post, played where it was published */
    const box = el('div', 'cr-embed cr-embed-' + e.shape);
    box.appendChild(K.embedNode(e, x.title));
    wrap.appendChild(box);
    if (x.standfirst) wrap.appendChild(el('p', 'pc-read-sum', x.standfirst));
    const go = el('div', 'pc-read-go');
    const a = el('a', 'pc-btn', K0.cta + ' on ' + e.label + ' ↗');
    a.href = x.external_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    go.appendChild(a);
    wrap.appendChild(go);
  } else {
    if (cover) {
      const fig = el('figure', 'pc-read-fig');
      const img = el('img'); img.src = cover; img.alt = ''; img.decoding = 'async';
      img.addEventListener('error', () => { fig.remove(); const m = main.querySelector('.pc-mast'); if (m) m.classList.remove('pc-has-fig'); });
      fig.appendChild(img);
      wrap.appendChild(fig);
    }
    if (x.kind === 'article') {
      const body = el('div', 'art-body cr-body');
      if (x.standfirst) body.appendChild(el('p', 'art-stand', x.standfirst));
      /* a picture in it is an https address (0194 clean_creator_body); anything else is not drawn */
      if (B && Array.isArray(x.body)) {
        body.appendChild(B.toDom(x.body.filter(b => b && (b.type !== 'image' || /^https:\/\/[^\s<>"]+$/i.test(b.path || ''))), {
          url: u => u,
          /* an embedded video, episode or post plays where it was published, from the platforms newscard.js knows */
          embed: u => {
            const e2 = K.embedOf(u, location.hostname);
            if (!e2) return null;
            const box = el('div', 'cr-embed cr-embed-' + e2.shape);
            box.appendChild(K.embedNode(e2, x.title));
            return box;
          }
        }));
      }
      wrap.appendChild(body);
      /* its tags (0200) */
      if (Array.isArray(x.tags) && x.tags.length) {
        const tr = el('div', 'cr-tags');
        tr.setAttribute('aria-label', 'tags');
        x.tags.forEach(t => { const c = el('span', 'cr-tag', t); c.setAttribute('translate', 'no'); tr.appendChild(c); });
        wrap.appendChild(tr);
      }
    } else {
      if (x.standfirst) wrap.appendChild(el('p', 'pc-read-sum', x.standfirst));
    }
    if (x.external_url) {
      const go = el('div', 'pc-read-go');
      const a = el('a', 'pc-btn', (x.kind === 'article' ? 'Read it on ' : K0.cta + ' on ') + (K.host(x.external_url) || 'their site') + ' ↗');
      a.href = x.external_url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      go.appendChild(a);
      wrap.appendChild(go);
    }
  }
  wrap.appendChild(el('p', 'pc-read-note cr-own', o.name + ' is an independent creator on ' + league.name + '’s pages: the piece is theirs, not the league’s.'));
  main.appendChild(wrap);

  /* THE CREATOR HUB'S NUMBERS (0200, track.js): the piece opened here, and each link out of it followed */
  if (x.id && K.toTrack) {
    const who = league.slug + '/' + o.slug;
    K.toTrack({ post: x.id, kind: 'open', outlet: who });
    wrap.addEventListener('click', ev => {
      const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
      if (!a || !/^https?:/i.test(a.href) || a.host === location.host) return;
      K.toTrack({ post: x.id, kind: 'out', outlet: who });
    });
  }

  /* more from them */
  try {
    const page = await rpc('creator_outlet_public', { p_league: league.id, p_slug: o.slug });
    const rows = ((page && page.posts) || []).filter(p => p.slug !== x.slug).slice(0, 6);
    if (rows.length) {
      const sec = el('section', 'pc-more-from');
      sec.style.setProperty('--bc', colour);
      const h = el('div', 'pc-sec-h');
      h.appendChild(el('span', null, 'More from ' + o.name));
      const all = el('a', null, 'their page →');
      all.href = outletHref(league, o.slug);
      h.appendChild(all);
      sec.append(h, K.grid(rows.map(p => pieceItem(league, p, page)), { lead: false, now: Date.now(), showLeague: false, partners: PARTNERS, onOpen }));
      main.appendChild(sec);
    }
  } catch (_) { /* the piece stands on its own */ }
}
