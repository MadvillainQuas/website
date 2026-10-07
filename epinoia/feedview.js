'use strict';
/* ============================================================================
   THE FEED, AS A SECTION: HOME's feed and a league's front-page news are this one file.

   Six posts on the post card (newscard.js), in the order feedrank.js makes on the reader's device, under a heading
   that carries the switch (For you / Followed / Newest), Personalise beside it, and "all news →":

     For you    the ranking (feedrank.js): official partners first, then the press (publishers, creators, the league's
                own articles), then the automatic match reports, each within its group by freshness and what the reader
                spends time on, opens, follows and reads; the group the reader opens more often climbs (feedrank.js,
                THE THREE GROUPS). Each card says why. Nothing about the reader is sent anywhere.
     Followed   (HOME only) what this reader follows (news_feed_mine, 0194), newest first
     Newest     everything in scope, newest first (news_feed)

   THE SCOPE. HOME (opts.league absent): every league, the newest 60 and, signed in, the newest 60 of what the reader
   follows. A LEAGUE'S FRONT PAGE (opts.league): news_feed for that league only, ONE read of its newest 60 that every
   switch then draws from (its page view costs the one call its old five headlines did), ranked with what the browser
   already has cached (feedrank.js rankRows cachedOnly); Followed is not offered there (the league is what is
   followed), and the section stays away while the league has nothing.

   The choice is remembered in this browser (opts.key) and nobody who has not chosen starts anywhere but For you.
   A database without the feed (0194 not taken) answers 404, and the section stays shut rather than saying it failed.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaFeedView = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const N = 6;
const POOL = 60;                        // the candidates the ranking chooses from (the RPCs' own ceiling)
const MODES = ['foryou', 'followed', 'newest'];

function el(tag, cls, text) {
  const n = root.document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const token = () => { const F = root.EpinoiaFollow; const s = F && typeof F.session === 'function' ? F.session() : null; return s && s.token; };

/* the switches a scope offers: a league's page has no Followed (the league itself is what is followed there) */
function modesFor(league) { return league ? ['foryou', 'newest'] : MODES.slice(); }

/* the row a card hands to "opened": its own, marked partner when it is one, so the click counts for the right group */
function openedRow(it, partners) {
  const r = Object.assign({}, it && it.row);
  if (r.partner !== true && it && it.pkey && partners && typeof partners.has === 'function' && partners.has(it.pkey)) r.partner = true;
  return r;
}

/* opts: { sec, seg (the switch: buttons with data-feed), all (the "all news" link), host (the mount), base (path to
   /epinoia/), league ({ id, slug, name, country } for a league's page), rpc(fn, args) (the page's own, with a member's
   headers on a league page), key (where the choice is remembered), fadeIn(node), reveal(shown) } */
async function mount(opts) {
  const o = opts || {};
  const K = root.EpinoiaNewsCard;
  if (!K) throw new Error('newscard.js is not loaded');
  const FR = root.EpinoiaFeedRank || null;
  const base = o.base || '';
  const lg = o.league || null;
  const allowed = modesFor(lg);
  const KEY = o.key || 'epinoia.home.feed2';
  const stored = () => { try { const v = root.localStorage.getItem(KEY); return allowed.indexOf(v) >= 0 ? v : null; } catch (_) { return null; } };
  const remember = v => { try { root.localStorage.setItem(KEY, v); } catch (_) { /* this visit only */ } };
  const reveal = o.reveal || (shown => { if (o.sec) o.sec.hidden = !shown; });
  const fadeIn = typeof o.fadeIn === 'function' ? o.fadeIn : () => {};

  /* a league article's stored picture, and a league's crest */
  const media = p => {
    const c = root.EPINOIA_CONFIG || {};
    if (!p || /^https:\/\//.test(p) || !c.supabaseUrl) return p;
    return c.supabaseUrl + '/storage/v1/object/public/media-public/' + String(p).split('/').map(encodeURIComponent).join('/');
  };
  const crest = p => (typeof root.epinoiaLogoUrl === 'function' && root.epinoiaLogoUrl(p, 64)) || media(p);

  /* THE READS. news_feed (scoped to the league on its page) and, HOME signed in, news_feed_mine. A function missing from
     the database is 'absent'. */
  async function call(fn, args, bearer) {
    if (typeof o.rpc === 'function' && !bearer) {
      try { return await o.rpc(fn, args); } catch (e) { if (/404|Could not find the function/i.test(String(e && e.message))) { const x = new Error('absent'); x.absent = true; throw x; } throw e; }
    }
    const c = root.EPINOIA_CONFIG || {};
    const headers = { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    const r = await root.fetch(c.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers, body: JSON.stringify(args || {}) });
    if (r.status === 404) { const e = new Error('absent'); e.absent = true; throw e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async function read(mode, n) {
    if (mode === 'followed') { const t = token(); return t ? call('news_feed_mine', { p_limit: n || N }, t) : null; }
    const args = { p_limit: n || N };
    if (lg) args.p_league = lg.id;
    return call('news_feed', args);
  }
  /* the candidates For you chooses from, read once per page: a league's newest 60; HOME's newest 60 and, signed in,
     the newest 60 of what the reader follows */
  let poolP = null;
  function pool() {
    if (poolP) return poolP;
    const signed = !lg && !!token();
    /* THE OFFICIAL PARTNERS' STORIES OF THE BOOST'S WINDOW (0236), so a partner's story of a few days ago is in the pool for
       its boost to lift; the newest 60 of everything left it out. A database without 0236 answers 404: nothing added. */
    const partnersRead = call('news_feed_partners', lg ? { p_league: lg.id, p_days: 9, p_limit: 30 } : { p_days: 9, p_limit: 30 }).catch(() => null);
    poolP = Promise.all([read('newest', POOL), signed ? read('followed', POOL).catch(() => null) : null, partnersRead]).then(([rows, mineRows, partnerRows]) => {
      const seen = new Set(), out = [];
      (rows || []).concat(mineRows || [], partnerRows || []).forEach(r => { if (r && r.id && !seen.has(r.id)) { seen.add(r.id); out.push(r); } });
      return { rows: out, followedIds: (mineRows || []).map(r => r.id) };
    });
    poolP.catch(() => { poolP = null; });
    return poolP;
  }
  /* a league's page ranks with what the browser has: its own country, and nothing asked that is not cached */
  const rankOpts = followedIds => lg
    ? { followedIds: [], cachedOnly: true, leagues: { country: { [lg.slug]: lg.country || '' }, idToSlug: lg.id ? { [lg.id]: lg.slug } : {} } }
    : { followedIds };

  let mode = stored() || 'foryou';
  let chosen = !!stored();

  /* the switch and the link are in the heading, as the fixtures' are; a switch this scope does not offer goes */
  const seg = o.seg || null;
  const all = o.all || el('a');
  const buttons = seg ? [].slice.call(seg.querySelectorAll('button[data-feed]')) : [];
  buttons.forEach(b => {
    b.dataset.mode = b.dataset.feed;
    if (allowed.indexOf(b.dataset.mode) < 0) { b.remove(); return; }
    b.addEventListener('click', () => {
      const k = b.dataset.mode;
      chosen = true; remember(k);
      if (k !== mode || note.textContent) draw(k).catch(() => {});
    });
  });
  const live = buttons.filter(b => allowed.indexOf(b.dataset.mode) >= 0);
  const note = el('div', 'hm-feed-note');
  const box = el('div', 'hm-feed');
  /* PERSONALISE: the button beside the switch, its panel above the cards; a change draws the feed again */
  let ctl = null;
  try { ctl = FR && typeof FR.control === 'function' ? FR.control({ base, onChange: () => draw(mode, true).catch(() => {}) }) : null; } catch (_) { ctl = null; }
  if (ctl && seg) seg.after(ctl.button);
  let partners = new Set();
  /* a press on a card: the story is read (the feed's "opened"), and its group gets a click */
  const onOpen = it => { try { if (FR) FR.opened(openedRow(it, partners)); } catch (_) { /* never in the reader's way */ } };
  const newsHref = want => lg ? base + 'news/?l=' + encodeURIComponent(lg.slug) : base + 'news/' + (want === 'followed' ? '?k=mine' : '');

  let gen = 0;
  /* quiet: drawn again because Personalise changed something - not a new sight of the cards, so none is counted */
  async function draw(want, quiet) {
    const mine = ++gen;
    mode = want;
    live.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === want)));
    all.href = newsHref(want);
    note.textContent = '';
    let rows, ranked = false;
    if (want === 'foryou') {
      const p = await pool();
      if (FR) {
        const res = await FR.rankRows(p.rows, rankOpts(p.followedIds));
        rows = res.rows; ranked = res.ranked; partners = res.partners;
        if (!ranked && !FR.enabled()) note.textContent = 'Personalisation is off, so this is the newest first. Switch it on under Personalise.';
      } else rows = p.rows.slice().sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    } else {
      rows = lg ? (await pool()).rows.slice().sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0)) : await read(want, POOL);
      if (FR) { partners = await FR.partners(); await FR.net().languages(lg ? { cachedOnly: true } : undefined).catch(() => ({})); }
    }
    if (mine !== gen) return;
    /* A SERIES IS ITS NEWEST EPISODE on a front page (feedrank.js latestEpisodes): a podcast's weekly show once, not
       every week of it; the others stay on its page and the news page */
    /* what the reader has opened leaves the feed, and at most two official partners' stories are in it (feedrank.js tidy,
       for Newest and Followed as For you ranks them) */
    if (rows && FR && typeof FR.tidy === 'function') rows = FR.tidy(rows, { partners });
    if (rows && FR && typeof FR.latestEpisodes === 'function') rows = FR.latestEpisodes(rows);
    box.textContent = '';
    if (rows === null) {                                          // Followed, signed out
      const d = el('div', 'pc-empty');
      d.append('The newest from the leagues, clubs, publishers and creators you follow. ');
      const a = el('a', null, 'Sign in');
      a.href = base + 'signin/?next=' + encodeURIComponent(root.location.pathname);
      d.append(a, ' to see yours.');
      box.appendChild(d);
      return;
    }
    if (want === 'followed' && !rows.length && !chosen) {
      /* nothing from what they follow yet, and they never asked for Followed: the newest, said so */
      rows = await read('newest', POOL);
      if (mine !== gen) return;
      if (rows && FR && typeof FR.latestEpisodes === 'function') rows = FR.latestEpisodes(rows);
      mode = 'newest';
      live.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === 'newest')));
      all.href = newsHref('newest');
      note.textContent = 'Nothing from what you follow yet, so the newest from everywhere. Follow a publisher or a creator with the bell on their page.';
    }
    if (!rows.length) {
      box.appendChild(el('div', 'pc-empty', want === 'followed'
        ? 'Nothing from what you follow yet. Follow a league, a club, a publisher or a creator, and their news arrives here.'
        : 'No news yet.'));
      return;
    }
    /* SHOW MORE (2026-10-06): six at a time, from the same ranked list, as far as it goes; each six counted as seen when shown */
    let at = 0;
    const more = el('button', 'ep-btn hm-feed-more', 'Show more');
    more.type = 'button';
    const wrap = el('div', 'pg-more');
    wrap.style.cssText = 'display:flex;justify-content:center;width:100%;grid-column:1 / -1;margin-top:calc(var(--u, 4px) * 4)';
    wrap.appendChild(more);
    const addSix = (first) => {
      const shown = rows.slice(at, at + N);
      at += shown.length;
      const g = K.grid(shown.map(r => Object.assign(K.fromFeed(r, base, media, crest), { why: ranked ? r.why : '' })),
        { lead: false, now: Date.now(), partners, onOpen, showLeague: !lg, hideTag: lg ? lg.slug : undefined });
      box.insertBefore(g, wrap.parentNode === box ? wrap : null);
      if (!first) { g.style.marginTop = 'calc(var(--u, 4px) * 3)'; fadeIn(g); }
      if (ranked && FR && !(first && quiet)) FR.shown(shown.map(r => r.id));
      wrap.hidden = at >= rows.length;
    };
    box.appendChild(wrap);
    addSix(true);
    fadeIn(box);
    more.addEventListener('click', () => addSix(false));
  }

  const host = o.host;
  host.textContent = '';
  if (ctl) host.append(ctl.panel);
  host.append(note, box);
  try {
    /* a league with nothing published: no section (an empty "News" heading is worse than none) */
    if (lg && !(await pool()).rows.length) { reveal(false); return false; }
    await draw(mode);
  } catch (e) {
    if (e && e.absent) { reveal(false); return false; }   // no feed in this database yet
    throw e;
  }
  reveal(true);
  /* HOME: a follow saved on the page (a bell, HOME's favourites) changes what Followed holds; a league followed is a
     reason for it (kept on this device: feedrank.js). A league's own page counts its follows in interest.js. */
  if (!lg) {
    root.addEventListener('epinoia:follows', e => {
      if (mode === 'followed') draw('followed').catch(() => {});
      const d = e && e.detail;
      if (FR && d && d.on && d.kind === 'league') {
        FR.net().leagueMap().then(m => { const slug = m.idToSlug[d.id]; if (slug) FR.store().followed({ league: slug }); }).catch(() => {});
      }
    });
  }
  return true;
}

return { mount, modesFor, openedRow, N, POOL };
}));
