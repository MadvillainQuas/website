'use strict';
/* ============================================================================
   THE NEWS PAGE — every article, or one of them.

   Two views in one document, chosen by ?a=. That is the same shape the league
   splash and the platform hub share, and for the same reason: an article page
   and a list of articles differ by one query and one renderer, and keeping
   them apart means keeping two copies of the header, the league lookup and
   the not-found handling in step.

   AND THE PLATFORM'S NEWS (0194), in the same document:
     news/                 every league, every publisher, every creator, newest
                           first, on the post card (newscard.js), with a switch
                           for each kind and one for what the reader follows
     news/?s=<slug>        a publisher's page: its head in its colours, the way
                           to its own site, a bell to follow it, its stories
     news/?i=<id>          one story, where a notification lands: its headline
                           and opening lines, and the way to read it on the
                           publisher's own site
     news/?l=<slug>        the league's own archive as before, and under it
                           AROUND THE LEAGUE: the stories the publishers ran
                           about it (their league tags) and its creators' pieces
   ============================================================================ */
const CFG = window.EPINOIA_CONFIG;
const N = window.EpinoiaNews;
const B = window.EpinoiaNewsBlocks;
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

const K = window.EpinoiaNewsCard;
/* THE RANKED FEED (feedrank.js): the order a reader's device makes, the official partners, "opened". All of it optional:
   without the script every page here is what it was. */
const FR = window.EpinoiaFeedRank || null;
let PARTNERS = new Set();
/* the official partners (official_partners(), once per page, cached): the pill on a card and on a head, the boost in the order */
const partnersReady = FR ? Promise.all([FR.partners(), FR.net().languages().catch(() => ({}))]).then(r => { PARTNERS = r[0]; return r[0]; }, () => PARTNERS) : Promise.resolve(PARTNERS);
/* a card pressed: the story is read, and its publisher's page a little nearer (kept on this device only) */
const onOpen = it => { try { if (FR && it && it.row) FR.opened(it.row); } catch (_) { /* never in the reader's way */ } };
const Q = new URLSearchParams(location.search);
const WANT = Q.get('l') || '';
const SLUG = Q.get('a') || '';
const SRC = Q.get('s') || '';
const ITEM = Q.get('i') || '';
const PAGE = 24;
/* the post cards: a lead and two dozen under it, three to a row */
const FIRST = 25, MORE = 24;

/* A members-only league's news is refused to an anonymous caller (news_public and
   news_article check visibility inside), so a member's calls carry their token.
   access.js decides when that is worth doing and returns {} otherwise, so an open
   league's request is unchanged; a 401 on a token the server no longer accepts is
   asked once more without it. */
function withAuth(headers, anon) {
  const A = window.EpinoiaAccess;
  if (!anon && A && typeof A.authHeaders === 'function') {
    try { Object.assign(headers, A.authHeaders() || {}); } catch (_) { /* anonymous, as before */ }
  }
  return headers;
}
async function api(p, anon) {
  const headers = withAuth({ apikey: CFG.supabaseAnonKey, Accept: 'application/json' }, anon);
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers });
  if (r.status === 401 && headers.Authorization) return api(p, true);
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}
async function rpc(fn, args, anon) {
  const headers = withAuth({ apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json',
                             Accept: 'application/json' }, anon);
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST', cache: 'no-store',
    headers,
    body: JSON.stringify(args || {})
  });
  if (r.status === 401 && headers.Authorization) return rpc(fn, args, true);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status));
  return j;
}

/* A MEMBERS-ONLY LEAGUE'S NEWS IS THE MEMBERS'. On a KNOWN "may not view" the
   paywall card replaces the archive (or the article), instead of "No news yet",
   which would be untrue. Without access.js, or when the check fails, nothing
   changes. Returns true when the card is up. */
async function newsWall(league) {
  const A = window.EpinoiaAccess;
  if (!A || typeof A.load !== 'function' || typeof A.get !== 'function') return false;
  try { await A.load({ leagueId: league.id, leagueSlug: league.slug }); } catch (_) { return false; }
  const st = A.get(league.id) || {};
  const walled = !!(st.known && typeof A.canView === 'function' && !A.canView(league.id));
  /* a sign-in or sign-out that changes the answer re-reads the page */
  if (typeof A.onChange === 'function') {
    A.onChange(() => {
      const now = A.get(league.id) || {};
      if (now.known && !A.canView(league.id) !== walled) location.reload();
    });
  }
  if (!walled || typeof A.paywallHTML !== 'function') return false;
  const w = $('#accessWall');
  w.innerHTML = A.paywallHTML({ league });
  w.classList.remove('hide');
  ['#one', '#list', '#pager'].forEach(s => $(s).classList.add('hide'));
  return true;
}

const imgUrl = p => /^https?:\/\//.test(p || '') ? p
  : (window.EpinoiaUpload ? window.EpinoiaUpload.publicUrl(CFG, p) : p);
/* a league's crest: config.js knows where each is kept */
const crestUrl = p => (typeof window.epinoiaLogoUrl === 'function' && window.epinoiaLogoUrl(p, 64)) || imgUrl(p);
/* a row of news_feed as a post card's item */
const cardOf = r => K.fromFeed(r, '../', imgUrl, crestUrl);
/* the platform page's switches: each kind of news_feed, and the reader's own */
const KINDS = [
  { k: 'all',      label: 'Everything',   kinds: null },
  { k: 'press',    label: 'Publishers',   kinds: ['outlet'] },
  { k: 'creators', label: 'Creators',     kinds: ['creator'] },
  { k: 'leagues',  label: 'League news',  kinds: ['league'] },
  { k: 'mine',     label: 'Following',    mine: true }
];

/* the order of the platform's news: the reader's own (For you) or the newest first; an explicit choice is remembered in this
   browser. The key is '...order2': the older key held the choice of a time when Newest was the way in, so everybody starts on
   For you again and stays where they then choose to be. */
const ORDER_KEY = 'epinoia.news.order2';
const ORDERS = [{ k: 'you', label: 'For you' }, { k: 'new', label: 'Newest' }];
function storedOrder() { try { const v = localStorage.getItem(ORDER_KEY); return v === 'you' || v === 'new' ? v : null; } catch (_) { return null; } }

(async function boot() {
  if (ITEM) return story(ITEM);
  if (SRC) return publisher(SRC);
  if (!WANT) return everything();

  let league = null;
  try {
    const ls = await api('leagues?slug=eq.' + encodeURIComponent(WANT) +
      '&select=id,slug,name,colour_a&limit=1');
    league = ls[0] || null;
  } catch (_) { /* handled below */ }

  if (!league) {
    $('#list').textContent = '';
    $('#list').appendChild(el('div', 'empty', 'No league called “' + WANT + '”.'));
    return;
  }

  document.title = 'News · ' + league.name;
  /* the rail marks the league, and the page wears its colours (nav.js) */
  window.__CS_LEAGUE_SLUG = league.slug;
  $('#leagueName').textContent = league.name;
  if (league.colour_a) {
    document.documentElement.style.setProperty('--team-a', league.colour_a);
  }
  const back = '../?l=' + encodeURIComponent(league.slug);
  $('#backLeague').href = back;
  $('#footLeague').href = back;

  if (await newsWall(league)) return;
  if (SLUG) await one(league);
  else {
    await all(league, 0);
    press(league);
  }
})();

/* ------------------------------------------------------------ one article --- */
async function one(league) {
  let a = null;
  try { a = await rpc('news_article', { p_league: league.id, p_slug: SLUG }); }
  catch (_) { /* below */ }

  /* No showing or hiding here: ?a= put m-article on the root before the first
     paint, so the archive was never drawn under this in the first place. */
  const host = $('#one');
  host.textContent = '';

  if (!a) {
    $('#head').textContent = 'Not found';
    host.appendChild(el('div', 'empty',
      'That article is not here. It may have been unpublished.'));
    const b = el('div', 'wrap');
    const link = el('a', 'ep-chip', 'all news →');
    link.href = '?l=' + encodeURIComponent(league.slug);
    b.appendChild(link);
    host.appendChild(b);
    return;
  }

  document.title = a.title + ' · ' + league.name;
  /* an article of the league opened: read, and a little for the league (this device only: feedrank.js) */
  if (FR) { try { FR.opened({ kind: 'league', league_slug: league.slug, slug: a.slug || SLUG, leagues: [{ slug: league.slug, name: league.name }] }); } catch (_) { /* nothing */ } }
  /* a filed match report is the report writer's prose: in another language the report pack's
     sentence templates translate its headline, standfirst and body (nothing else is tagged) */
  const generated = a.author_name === 'Epinoia match report';
  if (generated) $('#head').dataset.i18nCtx = 'report';
  else delete $('#head').dataset.i18nCtx;
  $('#head').textContent = a.title;
  $('#leagueName').textContent = league.name +
    (a.published_at ? ' · ' + N.when(a.published_at) : '') +
    (a.author_name ? ' · by ' + a.author_name : '');

  if (a.cover_path) {
    const fig = el('div', 'art-cover');
    const img = el('img');
    img.src = imgUrl(a.cover_path); img.alt = '';
    img.addEventListener('error', () => fig.remove());
    fig.appendChild(img);
    host.appendChild(fig);
  }

  const body = el('div', 'art-body');
  if (generated) body.dataset.i18nCtx = 'report';
  if (a.standfirst) body.appendChild(el('p', 'art-stand', a.standfirst));
  /* the report's game, straight after the standfirst: filled in when it answers */
  const gameSlot = el('div', 'art-game-slot');
  body.appendChild(gameSlot);
  body.appendChild(B.toDom(a.body, { url: imgUrl }));
  host.appendChild(body);

  const foot = el('div', 'art-foot');
  const link = el('a', 'ep-chip', 'all news →');
  link.href = '?l=' + encodeURIComponent(league.slug);
  foot.appendChild(link);
  host.appendChild(foot);

  reportGame(league, a).then(g => {
    if (!g) return;
    gameSlot.appendChild(gameCard(g));
    const chip = el('a', 'ep-chip', 'the game →');
    chip.href = gameHref(g.id);
    foot.insertBefore(chip, link);
  }, () => { /* a written piece, or no answer: the article stands on its own */ });
}

/* ------------------------------------------------------ a report's game ---
   A MATCH REPORT LINKS THE GAME IT IS ABOUT. finalise-game files each report with
   news_articles.game_id (0105), but news_article does not return it; the published row is
   readable directly (the news_read policy), with the member's token for a members-only league,
   as every other call here. The fixture line comes from the game itself, so the card reads
   "Nottingham Hoods 79–76 Derby Trailblazers" and opens the box score. A written article has
   no game and gets nothing. */
const gameHref = id => '../game/?g=' + encodeURIComponent(id) + '&mode=supabase';
async function reportGame(league, a) {
  if (!a || !a.slug) return null;
  const rows = await api('news_articles?select=game_id&league_id=eq.' + encodeURIComponent(league.id) +
    '&slug=eq.' + encodeURIComponent(a.slug) + '&limit=1');
  const id = rows && rows[0] && rows[0].game_id;
  if (!id) return null;
  let g = null;
  try {
    const gs = await api('games?select=id,status,home_score,away_score,tipoff_at,' +
      'home:home_team_id(name),away:away_team_id(name)&id=eq.' + encodeURIComponent(id) + '&limit=1');
    g = gs && gs[0];
  } catch (_) { /* the link still works without the line */ }
  return g || { id };
}
function gameCard(g) {
  const card = el('a', 'art-game');
  card.href = gameHref(g.id);
  const one = v => (Array.isArray(v) ? v[0] : v) || {};
  const home = one(g.home).name, away = one(g.away).name;
  const scored = g.status === 'final' || g.status === 'live';
  card.appendChild(el('span', 'k', g.status === 'live' ? 'live now' : 'the game'));
  const line = el('span', 't');
  if (home && away) {
    line.append(el('span', null, home),
      el('b', null, scored && g.home_score != null && g.away_score != null ? ' ' + g.home_score + '–' + g.away_score + ' ' : ' v '),
      el('span', null, away));
  } else line.textContent = 'This report’s game';
  card.appendChild(line);
  card.appendChild(el('span', 'd', 'Box score, play-by-play and every stat →'));
  return card;
}

/* --------------------------------------------------------- every article --- */
async function all(league, offset) {
  let rows = [];
  try {
    rows = await rpc('news_public',
      { p_league: league.id, p_limit: PAGE, p_offset: offset }) || [];
  } catch (e) {
    $('#list').textContent = '';
    $('#list').appendChild(el('div', 'empty', 'Could not load the news: ' + e.message));
    return;
  }

  const host = $('#list');
  host.textContent = '';
  if (!rows.length) {
    host.appendChild(el('div', 'empty',
      offset ? 'Nothing further back than this.'
             : 'No news yet. When this league publishes something it appears here ' +
               'and on its front page.'));
    return;
  }

  /* NEWEST FIRST — which is what news_public already orders by, pinned aside.
     The pin only decides what leads the five cards on the league page; on a
     full archive it would put an old article above a new one, which is not
     what an archive is for. */
  const grid = el('div', 'news-grid');
  rows.slice()
      .sort((x, y) => new Date(y.published_at || 0) - new Date(x.published_at || 0))
      .forEach((a, i) => grid.appendChild(N.card(a, {
        leagueSlug: league.slug, url: imgUrl, base: '../',
        /* first after the sort IS the newest here, since this list is ordered
           by date rather than by the pin */
        latest: i === 0
      })));
  /* the cards link back into this page, not out of it */
  grid.querySelectorAll('a.news-card').forEach(a => {
    a.href = a.href.replace(/.*news\//, '');
    if (a.getAttribute('href').charAt(0) !== '?') {
      a.setAttribute('href', '?' + a.getAttribute('href').split('?')[1]);
    }
  });
  host.appendChild(grid);

  const total = Number(rows[0].total || rows.length);
  const pager = $('#pager');
  pager.textContent = '';
  if (total > PAGE) {
    pager.classList.remove('hide');
    const prev = el('button', 'ep-btn mini', 'newer'); prev.type = 'button';
    prev.disabled = offset === 0;
    prev.addEventListener('click', () => all(league, Math.max(0, offset - PAGE)));
    const next = el('button', 'ep-btn mini', 'older'); next.type = 'button';
    next.disabled = offset + PAGE >= total;
    next.addEventListener('click', () => all(league, offset + PAGE));
    pager.append(prev,
      el('span', null, (offset + 1) + '–' + Math.min(offset + PAGE, total) + ' of ' + total),
      next);
  } else {
    pager.classList.add('hide');
  }
}

/* ======================================================= THE PLATFORM'S NEWS ===
   The post cards (newscard.js) over news_feed (0194): the league's articles, the
   creators' pieces and the publishers' stories, newest first. */

/* THE READER'S OWN FEED IS THEIRS: news_feed_mine is the signed-in reader's, so it goes with their token
   (access.js refreshes one that has expired), or not at all. */
async function rpcMine(fn, args) {
  const A = window.EpinoiaAccess;
  let s = null;
  try { s = A && typeof A.sessionReady === 'function' ? await A.sessionReady() : null; } catch (_) { s = null; }
  if (!s || !s.token) return null;
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + s.token,
               'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(args || {})
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status));
  return j;
}


/* A FEED OF CARDS, a page at a time. fetchPage(before, n) -> rows, newest first; toItem(row) -> a card's item;
   each "more" asks for what is older than the last card. A switch that starts the feed again (reset) makes any
   answer still on its way for the old one arrive to nothing. Returns { reset, box }.

   RANKED (o.pooled() true, o.rank(rows) -> rows in the reader's order, each with a `why`): the feed asks for a POOL of the
   newest rows at a time (POOL, the RPCs' own ceiling), ranks it and deals it out a page at a time; when the pool is used up it
   asks for the next one, older, and ranks that. The order is the reader's; the database is asked exactly as before. */
const POOL = 60;
function cardFeed(opts) {
  const o = opts || {};
  const box = el('div', 'nw-feed');
  const grid = el('div');
  const more = el('div', 'pc-more hide');
  const btn = el('button', 'ep-btn', o.moreText || 'More');
  btn.type = 'button';
  more.appendChild(btn);
  box.append(grid, more);
  let gen = 0, before = null, seen = new Set(), g = null, fetchPage = o.fetchPage;
  let queue = [], dry = false, pooled = false, quiet = false;
  const cardOpts = () => ({ now: Date.now(), showLeague: o.showLeague, hideTag: o.hideTag, partners: PARTNERS, onOpen });
  const itemOf = r => { const it = (o.toItem || cardOf)(r); if (pooled && r.why) it.why = r.why; return it; };
  async function page(first) {
    const mine = gen;
    const n = first ? FIRST : MORE;
    btn.disabled = true;
    let rows = null, shown = null;
    try {
      if (pooled) {
        /* deal from the ranked queue; refill it from the next pool while it runs short */
        rows = [];
        while (queue.length < n && !dry) {
          const got = await fetchPage(before, POOL);
          if (mine !== gen) return;
          if (got === null) { rows = null; break; }
          const fresh = (got || []).filter(r => r && r.id && !seen.has(r.id));
          fresh.forEach(r => seen.add(r.id));
          if (got.length) before = got[got.length - 1].published_at;
          if (got.length < POOL) dry = true;
          queue = queue.concat(await o.rank(fresh));
          if (mine !== gen) return;
        }
        if (rows !== null) { shown = queue.splice(0, n); rows = shown; }
      } else {
        rows = await fetchPage(before, n);
      }
    }
    catch (e) {
      if (mine !== gen) return;
      if (first) { grid.textContent = ''; grid.appendChild(el('div', 'pc-empty', 'Could not load the news: ' + e.message)); }
      btn.disabled = false;
      return;
    }
    if (mine !== gen) return;
    btn.disabled = false;
    if (rows === null) {                                   // the feed needs a reader and there is none
      grid.textContent = '';
      grid.appendChild(o.signedOut ? o.signedOut() : el('div', 'pc-empty', 'Sign in to see this.'));
      more.classList.add('hide');
      return;
    }
    let fresh;
    if (pooled) fresh = rows;                              // already de-duplicated, already in order
    else { fresh = (rows || []).filter(r => r && r.id && !seen.has(r.id)); fresh.forEach(r => seen.add(r.id)); }
    const items = fresh.map(itemOf);
    if (first) {
      grid.textContent = '';
      if (!items.length) {
        grid.appendChild(o.empty ? o.empty() : el('div', 'pc-empty', 'Nothing here yet.'));
        more.classList.add('hide');
        if (o.onEmpty) o.onEmpty();
        return;
      }
      g = K.grid(items, cardOpts());
      grid.appendChild(g);
    } else {
      items.forEach(it => g.appendChild(K.card(it, cardOpts())));
    }
    if (!pooled && rows.length) before = rows[rows.length - 1].published_at;
    more.classList.toggle('hide', pooled ? (queue.length === 0 && dry) : rows.length < n);
    if (pooled && FR && !quiet) { try { FR.shown(items.map(x => x.id)); } catch (_) { /* nothing */ } }
    if (o.onRows) o.onRows(fresh, first);
  }
  btn.addEventListener('click', () => page(false));
  /* quiet: started again because Personalise changed something, not a new sight of the cards: none is counted */
  function reset(fp, q) {
    gen++;
    quiet = !!q;
    if (fp) fetchPage = fp;
    before = null; seen = new Set(); g = null; queue = []; dry = false;
    pooled = !!(o.rank && o.pooled && o.pooled());
    grid.textContent = '';
    grid.appendChild(el('div', 'pc-empty', 'Loading…'));
    more.classList.add('hide');
    return partnersReady.then(() => page(true));
  }
  return { box, reset };
}

/* ------------------------------------------------------------- news/ --- */

function platformHead() {
  const back = $('#backLeague');
  back.textContent = '← home';
  back.href = '../home/';
  const foot = $('#footLeague');
  foot.textContent = 'Home';
  foot.href = '../home/';
}

async function everything() {
  document.title = 'News · Epinoia';
  platformHead();
  $('#head').textContent = 'News';
  $('#leagueName').textContent = 'Every league, every publisher, every creator: for you, or the newest first';

  const host = $('#list');
  host.textContent = '';
  const pubs = el('div', 'nw-pubs');
  const tabs = el('div', 'pc-tabs nw-tabs');
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', 'what to show');
  let cur = KINDS.find(t => t.k === Q.get('k')) || KINDS[0];
  let order = (ORDERS.find(x => x.k === Q.get('o')) || {}).k || storedOrder() || 'you';
  /* the stories in the reader's own feed, for the follow bonus (signed in: the same call as "Following") */
  let mineIds = null;
  const followedIds = async rows => {
    if (cur.mine) return rows.map(r => r.id);
    if (!mineIds) mineIds = rpcMine('news_feed_mine', { p_limit: POOL }).then(r => (r || []).map(x => x.id)).catch(() => []);
    return mineIds;
  };
  const feed = cardFeed({
    moreText: 'Older stories',
    pooled: () => order === 'you' && !!FR,
    rank: async rows => (await FR.rankRows(rows, { followedIds: await followedIds(rows) })).rows,
    signedOut: () => {
      const d = el('div', 'pc-empty');
      d.append('What you follow — leagues, clubs, publishers and creators — in one feed. ');
      const a = el('a', null, 'Sign in');
      a.href = '../signin/?next=' + encodeURIComponent(location.pathname + '?k=mine');
      d.append(a, ' to see it.');
      return d;
    },
    empty: () => el('div', 'pc-empty', cur.mine
      ? 'Nothing from what you follow yet. Follow a league, a club, a publisher or a creator (the bell on their page), and their news arrives here.'
      : 'Nothing here yet.')
  });

  /* what to show (kinds) on the left; on the right the order (For you / Newest) and Personalise */
  const tools = el('div', 'nw-tools');
  const right = el('div', 'nw-tools-r');
  right.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:8px';
  const orderTabs = el('div', 'pc-tabs nw-order');
  orderTabs.setAttribute('role', 'group');
  orderTabs.setAttribute('aria-label', 'order');
  let ctl = null, paintOrder = () => {};
  try { ctl = FR && typeof FR.control === 'function' ? FR.control({ base: '../', onChange: () => load(true) }) : null; } catch (_) { ctl = null; }
  if (FR) {
    const obuttons = ORDERS.map(x => {
      const b = el('button', 'pc-tab', x.label);
      b.type = 'button';
      b.dataset.o = x.k;
      b.addEventListener('click', () => {
        if (order === x.k) return;
        order = x.k;
        try { localStorage.setItem(ORDER_KEY, x.k); } catch (_) { /* this visit only */ }
        load();
      });
      orderTabs.appendChild(b);
      return b;
    });
    right.appendChild(orderTabs);
    if (ctl) right.appendChild(ctl.button);
    paintOrder = () => obuttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.o === order)));
  }
  tools.append(tabs, right);
  const notice = el('div', 'hm-feed-note nw-note');
  host.append(tools);
  if (ctl) host.append(ctl.panel);
  host.append(notice, pubs, feed.box);

  const buttons = KINDS.map(t => {
    const b = el('button', 'pc-tab', t.label);
    b.type = 'button';
    b.dataset.k = t.k;
    b.addEventListener('click', () => { if (cur !== t) choose(t); });
    tabs.appendChild(b);
    return b;
  });
  function url() {
    const q = [];
    if (cur.k !== 'all') q.push('k=' + cur.k);
    if (FR && order === 'new') q.push('o=new');
    return location.pathname + (q.length ? '?' + q.join('&') : '');
  }
  /* (re)draw the feed for the kind and the order chosen */
  function load(quiet) {
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === cur.k)));
    paintOrder();
    /* the switches are in the address, so a reload or a shared link opens on them */
    try { history.replaceState(null, '', url()); } catch (_) { /* a sandboxed page */ }
    notice.textContent = FR && order === 'you' && !FR.enabled() ? 'Personalisation is off, so this is the newest first. Switch it on under Personalise.' : '';
    feed.reset(cur.mine
      ? (before, n) => rpcMine('news_feed_mine', { p_before: before, p_limit: n })
      : (before, n) => rpc('news_feed', { p_league: null, p_before: before, p_limit: n, p_kinds: cur.kinds }), quiet);
  }
  function choose(t) { cur = t; load(); }
  load();

  /* the publishers, each to its page here */
  try {
    const list = await rpc('news_sources_public', { p_league: null }) || [];
    await partnersReady;
    if (list.length) {
      pubs.append(el('div', 'nw-h', 'The publishers'),
        K.brands(list.map(x => ({ name: x.name, logo: x.logo_url, colour: x.colour, href: '?s=' + encodeURIComponent(x.slug),
                                  note: x.last_at ? K.ago(x.last_at) : '', partner: PARTNERS.has('source:' + x.slug) }))));
    }
  } catch (_) { /* the feed stands without the row */ }
}

/* ------------------------------------------------------- news/?s=<slug> --- */
function sourceItem(src) {
  return x => ({
    kind: 'story', title: x.title, summary: x.summary, image: x.image_url, when: x.published_at, author: x.author,
    href: x.url, external: true, siteHost: K.host(x.url), tags: K.tagsOf(x.leagues, '../', crestUrl),
    brand: { name: src.name, logo: src.logo_url, colour: src.colour },
    /* what "opened" reads, and the key the pill is looked up by (a publisher's stories all carry the publisher's own) */
    id: x.id, pkey: 'source:' + src.slug,
    row: { id: x.id, kind: 'outlet', source_slug: src.slug, source_name: src.name, leagues: x.leagues }
  });
}

async function publisher(slug) {
  platformHead();
  let src = null;
  try { src = await rpc('news_source_public', { p_slug: slug, p_limit: FIRST }); } catch (_) { /* below */ }
  const host = $('#list');
  host.textContent = '';
  if (!src) {
    $('#head').textContent = 'Not found';
    $('#leagueName').textContent = '';
    host.appendChild(el('div', 'pc-empty', 'No publisher called “' + slug + '” is on Epinoia.'));
    host.appendChild(allNewsLink());
    return;
  }
  document.title = src.name + ' · News · Epinoia';
  document.querySelector('.hero').classList.add('hide');
  await partnersReady;
  /* a publisher's page visited, and a publisher followed here: a reason to like it (on this device only) */
  if (FR) {
    try { FR.visited('source:' + src.slug); } catch (_) { /* nothing */ }
    window.addEventListener('epinoia:follows', e => {
      const d = e && e.detail;
      if (d && d.on && d.kind === 'source') { try { FR.store().followed({ key: 'source:' + src.slug }); } catch (_) { /* nothing */ } }
    });
  }
  const F = window.EpinoiaFollow;
  const bell = F && src.id ? F.bell('source', src.id, { label: 'Follow', labelOn: 'Following', name: src.name, cls: 'lbl big' }) : null;
  const siteHost = K.host(src.site_url);
  $('#brand').appendChild(K.hero({
    partner: PARTNERS.has('source:' + src.slug),
    name: src.name, logo: src.logo_url, colour: src.colour,
    kicker: 'Publisher' + (src.league ? ' · ' + src.league.name : '') + ' · on Epinoia',
    tagline: 'Their stories as they publish them: the headline and the opening lines here, the story on ' + (siteHost || 'their site') + '.',
    links: [{ href: src.site_url, text: 'Visit ' + (siteHost || 'their site') + ' ↗', external: true, primary: true }],
    bell
  }));
  if (src.league) {
    const b = $('#backLeague');
    b.textContent = '← ' + src.league.name + ' news';
    b.href = '?l=' + encodeURIComponent(src.league.slug);
  } else {
    const b = $('#backLeague');
    b.textContent = '← all news';
    b.href = './';
  }

  /* the first page came with the publisher; the feed asks for the rest */
  let firstRows = src.items || [];
  const feed = cardFeed({
    moreText: 'Older stories',
    toItem: sourceItem(src),
    empty: () => el('div', 'pc-empty', 'Nothing from ' + src.name + ' yet: their stories arrive here as they publish them.'),
    fetchPage: (before, n) => {
      if (!before && firstRows) { const r = firstRows; firstRows = null; return Promise.resolve(r); }
      return rpc('news_source_public', { p_slug: slug, p_before: before, p_limit: n }).then(j => (j && j.items) || []);
    }
  });
  host.appendChild(feed.box);
  feed.reset();
}

function allNewsLink() {
  const b = el('div', 'pc-more');
  const a = el('a', 'ep-chip', 'all news →');
  a.href = './';
  b.appendChild(a);
  return b;
}

/* ------------------------------------------------------- news/?i=<id> ---
   ONE STORY, IN ITS PUBLISHER'S COLOURWAY (newscard.js masthead): their print across the page, their mark and a
   bell to follow them, the headline centred; the picture over the foot of the print; the opening lines and the way
   to the story on their site, centred under it; and more of theirs. */
async function story(id) {
  platformHead();
  let it = null;
  try { it = await rpc('news_item_public', { p_id: id }); } catch (_) { /* below */ }
  const host = $('#one');
  host.textContent = '';
  if (!it) {
    $('#head').textContent = 'Not found';
    $('#leagueName').textContent = '';
    host.appendChild(el('div', 'empty', 'That story is not here any more: stories are kept for four months.'));
    host.appendChild(allNewsLink());
    return;
  }
  const src = it.source || {};
  const colour = /^#[0-9a-f]{6}$/i.test(src.colour || '') ? src.colour : K.tint(src.name);
  const siteHost = K.host(it.url);
  document.title = it.title + ' · ' + (src.name || 'News');
  /* the page's own head gives way to the publisher's */
  document.querySelector('.hero').classList.add('hide');
  const back = $('#backLeague');
  back.textContent = '← ' + (src.name || 'all news');
  back.href = src.slug ? '?s=' + encodeURIComponent(src.slug) : './';

  await partnersReady;
  /* a story opened here (from a notification, or a link): it is read, and its publisher gains (this device only) */
  if (FR && src.slug) { try { FR.opened({ id: it.id, kind: 'outlet', source_slug: src.slug, source_name: src.name, leagues: it.leagues }); } catch (_) { /* nothing */ } }
  const F = window.EpinoiaFollow;
  const bell = F && src.id ? F.bell('source', src.id, { label: 'Follow', labelOn: 'Following', name: src.name, cls: 'lbl' }) : null;
  const when = it.published_at ? new Date(it.published_at) : null;
  host.appendChild(K.masthead({
    partner: !!src.slug && PARTNERS.has('source:' + src.slug),
    brand: { name: src.name, logo: src.logo_url, colour, href: src.slug ? '?s=' + encodeURIComponent(src.slug) : null },
    kind: 'Story',
    title: it.title,
    meta: [when && !isNaN(when) ? N.when(it.published_at) : '', it.author ? 'by ' + it.author : '', siteHost],
    tags: K.tagsOf(it.leagues, '../', crestUrl),
    bell,
    figure: !!it.image_url
  }));

  const wrap = el('div', 'pc-read');
  wrap.style.setProperty('--bc', colour);
  if (it.image_url) {
    const fig = el('figure', 'pc-read-fig');
    const img = el('img');
    img.src = it.image_url; img.alt = ''; img.decoding = 'async';
    /* a picture that will not load: the print closes up behind it */
    img.addEventListener('error', () => { fig.remove(); const m = host.querySelector('.pc-mast'); if (m) m.classList.remove('pc-has-fig'); });
    fig.appendChild(img);
    wrap.appendChild(fig);
  }
  if (it.summary) wrap.appendChild(el('p', 'pc-read-sum', it.summary));

  const go = el('div', 'pc-read-go');
  const read = el('a', 'pc-btn', 'Read the full story on ' + (siteHost || 'their site') + ' ↗');
  read.href = it.url; read.target = '_blank'; read.rel = 'noopener noreferrer';
  go.append(read, el('span', 'pc-read-note', 'The story is ' + (src.name || 'the publisher') + '’s: Epinoia carries its headline and opening lines, and the way to it.'));
  wrap.appendChild(go);
  host.appendChild(wrap);

  /* more from them */
  if (src.slug) {
    try {
      const more = await rpc('news_source_public', { p_slug: src.slug, p_limit: 7 });
      const rows = ((more && more.items) || []).filter(x => x.id !== it.id).slice(0, 6);
      if (rows.length) {
        const sec = el('section', 'pc-more-from');
        sec.style.setProperty('--bc', colour);
        const h = el('div', 'pc-sec-h');
        h.appendChild(el('span', null, 'More from ' + src.name));
        const all = el('a', null, 'all their stories →');
        all.href = '?s=' + encodeURIComponent(src.slug);
        h.appendChild(all);
        sec.append(h, K.grid(rows.map(sourceItem(src)), { lead: false, now: Date.now(), partners: PARTNERS, onOpen }));
        host.appendChild(sec);
      }
    } catch (_) { /* the story stands on its own */ }
  }
}

/* ---------------------------------------------------- news/?l=, AROUND THE LEAGUE ---
   What the publishers ran about this league (a league's own sources, and the stories the fetcher matched to it)
   and what its creators published: under the league's own archive, hidden while there is none. */
async function press(league) {
  const sec = $('#press');
  if (!sec) return;
  const feed = cardFeed({
    moreText: 'Older stories',
    showLeague: false,
    hideTag: league.slug,
    fetchPage: (before, n) => rpc('news_feed', { p_league: league.id, p_before: before, p_limit: n, p_kinds: ['outlet', 'creator'] }),
    onRows: (rows, first) => { if (first && rows.length) sec.classList.remove('hide'); }
  });
  const h = el('div', 'pc-sec-h');
  h.appendChild(el('span', null, 'Around the league'));
  const all = el('a', null, 'all news →');
  all.href = './';
  h.appendChild(all);
  sec.textContent = '';
  sec.append(h);
  const pubs = el('div', 'nw-pubs');
  sec.append(pubs, feed.box);
  await feed.reset();
  try {
    const list = await rpc('news_sources_public', { p_league: league.id }) || [];
    if (list.length) pubs.appendChild(K.brands(list.map(x => ({ name: x.name, logo: x.logo_url, colour: x.colour,
      href: '?s=' + encodeURIComponent(x.slug), note: x.last_at ? K.ago(x.last_at) : '' }))));
  } catch (_) { /* the stories stand without the row */ }
}
