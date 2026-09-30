'use strict';
/* ============================================================================
   HOME — THE FEED, section 'feed', under MY FOLLOWED.

   The newest six posts on the platform, on the post card (newscard.js): the
   leagues' own news, their creators' pieces and the publishers' stories, each
   in its brand's colours with its league tags. Two ways to read it, a switch
   at its head:

     Followed   what this reader follows: the leagues (and the leagues of the
                clubs) they follow, the publishers and the creators
                (news_feed_mine, 0194), newest first
     Newest     everything on the platform, newest first (news_feed)

   The choice is remembered in this browser. Nobody has chosen yet: Followed
   for a reader who is signed in, Newest for everybody else; a Followed with
   nothing in it yet shows the newest instead, and says so, rather than an
   empty section. Signed out, Followed leads to sign-in.

   THE FOLLOW LIST'S TOKEN IS follow.js's (the stored session, the way nav.js
   reads it), as MY FOLLOWED's is: access.js sends no token on HOME.

   A DATABASE WITHOUT THE FEED (0194 not taken yet) answers 404 for the call,
   and the section stays shut rather than saying it failed.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;

  const N = 6;
  const KEY = 'epinoia.home.feed';

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const stored = () => { try { const v = localStorage.getItem(KEY); return v === 'followed' || v === 'newest' ? v : null; } catch (_) { return null; } };
  const remember = v => { try { localStorage.setItem(KEY, v); } catch (_) { /* this visit only */ } };
  const token = () => { const F = window.EpinoiaFollow; const s = F && typeof F.session === 'function' ? F.session() : null; return s && s.token; };

  /* one of the two reads: rows, or null when it needs a reader and there is none; a missing function is 'absent' */
  async function read(mode) {
    const c = window.EPINOIA_CONFIG || {};
    const t = token();
    if (mode === 'followed' && !t) return null;
    const headers = { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' };
    if (mode === 'followed') headers.Authorization = 'Bearer ' + t;
    const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/' + (mode === 'followed' ? 'news_feed_mine' : 'news_feed'), {
      method: 'POST', cache: 'no-store', headers,
      body: JSON.stringify(mode === 'followed' ? { p_limit: N } : { p_limit: N })
    });
    if (r.status === 404) { const e = new Error('absent'); e.absent = true; throw e; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  H.register('feed', async function (ctx) {
    const { host, base, fadeIn } = ctx;
    const K = window.EpinoiaNewsCard;
    const sec = document.getElementById('feed');
    if (!K) throw new Error('newscard.js is not loaded');
    /* a league article's stored picture, as upload.js would give it (HOME does not load upload.js) */
    const media = p => {
      const c = window.EPINOIA_CONFIG || {};
      if (!p || /^https:\/\//.test(p) || !c.supabaseUrl) return p;
      return c.supabaseUrl + '/storage/v1/object/public/media-public/' + String(p).split('/').map(encodeURIComponent).join('/');
    };
    const crest = p => (typeof window.epinoiaLogoUrl === 'function' && window.epinoiaLogoUrl(p, 64)) || media(p);
    const signed = !!token();
    let mode = stored() || (signed ? 'followed' : 'newest');
    let chosen = !!stored();

    /* the switch and the link are in the heading (index.html), as the fixtures' are */
    const seg = document.getElementById('feedSeg');
    const all = document.getElementById('feedAll') || el('a');
    const buttons = seg ? [].slice.call(seg.querySelectorAll('button[data-feed]')) : [];
    buttons.forEach(b => {
      b.dataset.mode = b.dataset.feed;
      b.addEventListener('click', () => {
        const k = b.dataset.mode;
        chosen = true; remember(k);
        if (k !== mode || note.textContent) draw(k).catch(() => {});
      });
    });
    const note = el('div', 'hm-feed-note');
    const box = el('div', 'hm-feed');

    let gen = 0;
    async function draw(want) {
      const mine = ++gen;
      mode = want;
      buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === want)));
      all.href = base + 'news/' + (want === 'followed' ? '?k=mine' : '');
      note.textContent = '';
      let rows = await read(want);
      if (mine !== gen) return;
      box.textContent = '';
      if (rows === null) {                                          // Followed, signed out
        const d = el('div', 'pc-empty');
        d.append('The newest from the leagues, clubs, publishers and creators you follow. ');
        const a = el('a', null, 'Sign in');
        a.href = base + 'signin/?next=' + encodeURIComponent(location.pathname);
        d.append(a, ' to see yours.');
        box.appendChild(d);
        return;
      }
      if (want === 'followed' && !rows.length && !chosen) {
        /* nothing from what they follow yet, and they never asked for Followed: the newest, said so */
        rows = await read('newest');
        if (mine !== gen) return;
        mode = 'newest';
        buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === 'newest')));
        all.href = base + 'news/';
        note.textContent = 'Nothing from what you follow yet, so the newest from everywhere. Follow a publisher or a creator with the bell on their page.';
      }
      if (!rows.length) {
        box.appendChild(el('div', 'pc-empty', want === 'followed'
          ? 'Nothing from what you follow yet. Follow a league, a club, a publisher or a creator, and their news arrives here.'
          : 'No news yet.'));
        return;
      }
      box.appendChild(K.grid(rows.slice(0, N).map(r => K.fromFeed(r, base, media, crest)), { lead: false, now: Date.now() }));
      fadeIn(box);
    }

    host.textContent = '';
    host.append(note, box);
    try {
      await draw(mode);
    } catch (e) {
      if (e && e.absent) { if (sec) sec.hidden = true; return; }   // no feed in this database yet
      throw e;
    }
    if (sec) sec.hidden = false;
    /* a follow saved on this page (a bell, HOME's favourites) changes what Followed holds */
    window.addEventListener('epinoia:follows', () => { if (mode === 'followed') draw('followed').catch(() => {}); });
  });
})();
