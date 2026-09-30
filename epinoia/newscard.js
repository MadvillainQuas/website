'use strict';
/* ============================================================================
   A POST'S CARD — one card for every piece the site carries from anybody but the
   league: a publisher's story (a news source, migration 0194), a creator's piece,
   and the league's own articles when they sit among them (the News page).

   THE BRAND IS THE PLATE. A story with a picture wears it, with the publisher's
   badge in the corner; a story without one is printed in the publisher's colour -
   the flood and the halftone of the club cards - with its logo large in the middle
   on a disc of its own, so a dark logo and a light one both read. Under the plate,
   the kicker (who, and when), the headline, and the first sentence or two of the
   excerpt: enough to know what it is, never the article.

   THE WAYS OUT, never one link inside another: the headline is the link to the
   piece (a publisher's story to its own site, in a new tab; a creator's piece to
   its page here) and it covers the whole card, so the card is pressed anywhere;
   the league tags (the leagues the story is about: each to that league's news)
   and the foot (the publisher's or the creator's page on Epinoia, where all of
   theirs are) sit above it as links of their own. Text goes in as text
   (textContent), every address is checked, and an outside link opens with
   noopener.

   EMBEDS (embedOf / embedNode): a creator's video, podcast or social post is shown
   where it was published - YouTube, TikTok, Instagram (with its caption), X,
   Spotify, SoundCloud, Apple Podcasts, Twitch, Threads - in a sandboxed frame
   built from that platform's own embed address. What is stored is only the link;
   an address that is none of these is a link card, never markup.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaNewsCard = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : null);
const https = u => (typeof u === 'string' && /^https:\/\/[^\s<>"]+$/i.test(u) ? u : null);
const web = u => (typeof u === 'string' && /^https?:\/\/[^\s<>"]+$/i.test(u) ? u : null);

/* the publisher's colour, or one made from its name that is always the same for it */
function tint(seed) {
  let h = 0;
  for (const ch of String(seed || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return 'hsl(' + h + ' 52% 46%)';
}
function initials(name) {
  const w = String(name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return (w.length >= 2 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
}
function host(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

/* THE FIRST SENTENCE OR TWO. A sentence ends at . ! ? … followed by a space and something that starts one;
   a first sentence too short to say much ("Big night.") takes the next with it; at most `max` characters,
   cut at a word. */
function lede(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const lim = max || 190;
  if (!t) return '';
  const ends = [];
  const re = /[.!?…](?=\s+["'“‘(]?[\p{Lu}\p{N}])/gu;
  let m;
  while ((m = re.exec(t)) && ends.length < 3) ends.push(m.index + 1);
  let out = t;
  if (ends.length) {
    out = t.slice(0, ends[0]);
    if (out.length < 60) out = ends[1] ? t.slice(0, ends[1]) : t;      // too short to say much: the next one too
  }
  if (out.length > lim) {
    out = out.slice(0, lim - 1);
    const sp = out.lastIndexOf(' ');
    if (sp > lim * 0.6) out = out.slice(0, sp);
    out = out.replace(/[\s,.;:–—-]+$/, '') + '…';
  }
  return out;
}

/* 2 h ago, yesterday, 12 Sep */
function ago(iso, now) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return '';
  const s = Math.max(0, ((now || Date.now()) - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 2 * 86400) return 'yesterday';
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' days ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/* ---------------------------------------------------------------------------------------------- embeds --- */
/* {provider, label, src, shape: 'wide'|'tall'|'post'|'audio', thumb?} for an address a platform embeds, else null */
function embedOf(url, pageHost) {
  const u = https(url);
  if (!u) return null;
  let x;
  try { x = new URL(u); } catch (_) { return null; }
  const h = x.hostname.replace(/^(www\.|m\.)/, '');
  const seg = x.pathname.split('/').filter(Boolean);
  const idOk = s => /^[A-Za-z0-9_-]{4,64}$/.test(s || '');
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'music.youtube.com') {
    let id = h === 'youtu.be' ? seg[0] : x.searchParams.get('v');
    let shape = 'wide';
    if (!id && (seg[0] === 'shorts' || seg[0] === 'live' || seg[0] === 'embed')) { id = seg[1]; if (seg[0] === 'shorts') shape = 'tall'; }
    if (!idOk(id)) return null;
    return { provider: 'youtube', label: 'YouTube', shape, src: 'https://www.youtube-nocookie.com/embed/' + id,
             thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
  }
  if (h === 'tiktok.com') {
    const i = seg.indexOf('video');
    const id = i >= 0 ? seg[i + 1] : null;
    if (!/^\d{6,25}$/.test(id || '')) return null;
    return { provider: 'tiktok', label: 'TikTok', shape: 'tall', src: 'https://www.tiktok.com/embed/v2/' + id };
  }
  if (h === 'instagram.com') {
    if (!['p', 'reel', 'reels', 'tv'].includes(seg[0]) || !idOk(seg[1])) return null;
    return { provider: 'instagram', label: 'Instagram', shape: 'post',
             src: 'https://www.instagram.com/' + (seg[0] === 'reels' ? 'reel' : seg[0]) + '/' + seg[1] + '/embed/captioned/' };
  }
  if (h === 'x.com' || h === 'twitter.com' || h === 'mobile.twitter.com') {
    const i = seg.indexOf('status');
    const id = i >= 0 ? seg[i + 1] : null;
    if (!/^\d{5,25}$/.test(id || '')) return null;
    return { provider: 'x', label: 'X', shape: 'post', src: 'https://platform.twitter.com/embed/Tweet.html?dnt=true&id=' + id };
  }
  if (h === 'threads.net' || h === 'threads.com') {
    const i = seg.indexOf('post');
    if (!seg[0] || seg[0][0] !== '@' || i < 0 || !idOk(seg[i + 1])) return null;
    return { provider: 'threads', label: 'Threads', shape: 'post',
             src: 'https://www.threads.net/' + encodeURIComponent(seg[0]).replace('%40', '@') + '/post/' + seg[i + 1] + '/embed' };
  }
  if (h === 'open.spotify.com') {
    const t = /^intl-/.test(seg[0] || '') ? seg.slice(1) : seg;      // open.spotify.com/intl-de/episode/…
    const kinds = ['episode', 'show', 'track', 'album', 'playlist'];
    const k = kinds.includes(t[0]) ? t[0] : (kinds.includes(t[1]) ? t[1] : null);
    const id = k ? t[t.indexOf(k) + 1] : null;
    if (!k || !/^[A-Za-z0-9]{10,40}$/.test(id || '')) return null;
    return { provider: 'spotify', label: 'Spotify', shape: 'audio', src: 'https://open.spotify.com/embed/' + k + '/' + id };
  }
  if (h === 'soundcloud.com' && seg.length >= 2) {
    return { provider: 'soundcloud', label: 'SoundCloud', shape: 'audio',
             src: 'https://w.soundcloud.com/player/?visual=false&url=' + encodeURIComponent('https://soundcloud.com/' + seg.map(encodeURIComponent).join('/')) };
  }
  if (h === 'podcasts.apple.com' && seg.length >= 2) {
    return { provider: 'apple', label: 'Apple Podcasts', shape: 'audio',
             src: 'https://embed.podcasts.apple.com/' + seg.map(encodeURIComponent).join('/') + (x.search || '') };
  }
  if (h === 'twitch.tv' && pageHost) {
    const parent = '&parent=' + encodeURIComponent(pageHost);
    if (seg[0] === 'videos' && /^\d{4,15}$/.test(seg[1] || '')) return { provider: 'twitch', label: 'Twitch', shape: 'wide', src: 'https://player.twitch.tv/?autoplay=false&video=' + seg[1] + parent };
    if (seg.length === 1 && /^[A-Za-z0-9_]{3,25}$/.test(seg[0])) return { provider: 'twitch', label: 'Twitch', shape: 'wide', src: 'https://player.twitch.tv/?autoplay=false&channel=' + seg[0] + parent };
  }
  return null;
}
/* every host embedOf can point a frame at: the pages that show embeds allow exactly these (frame-src) */
const EMBED_HOSTS = ['https://www.youtube-nocookie.com', 'https://www.tiktok.com', 'https://www.instagram.com', 'https://platform.twitter.com',
  'https://www.threads.net', 'https://open.spotify.com', 'https://w.soundcloud.com', 'https://embed.podcasts.apple.com', 'https://player.twitch.tv'];

function embedNode(e, title) {
  const box = el('div', 'pc-embed pc-embed-' + e.shape + ' pc-embed-' + e.provider);
  const f = document.createElement('iframe');
  f.src = e.src;
  f.title = (title ? title + ' — ' : '') + e.label;
  f.loading = 'lazy';
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation');
  f.setAttribute('allow', 'encrypted-media; picture-in-picture; fullscreen; clipboard-write');
  f.setAttribute('allowfullscreen', '');
  box.appendChild(f);
  return box;
}

/* ------------------------------------------------------------------------------------------------ items --- */
const KIND = {
  story:   { glyph: '▤', word: 'Story',   cta: 'Read' },
  article: { glyph: '✎', word: 'Article', cta: 'Read' },
  video:   { glyph: '▶', word: 'Video',   cta: 'Watch' },
  podcast: { glyph: '◉', word: 'Podcast', cta: 'Listen' },
  social:  { glyph: '✦', word: 'Post',    cta: 'See the post' },
  link:    { glyph: '↗', word: 'Link',    cta: 'Open' },
  league:  { glyph: '◆', word: 'League news', cta: 'Read' }
};

/* A ROW OF news_feed (0194) AS A CARD'S ITEM. base: the path to /epinoia/ from the page; media: a league's
   stored path to its public address (upload.js); logo: the same for a league's crest (config.js epinoiaLogoUrl,
   which knows the crest store), media when not given. */
function fromFeed(r, base, media, crest) {
  const it = fromFeedRow(r, base, media, crest);
  /* the row itself stays with the card (the feed's ranking and "opened" read it), and the key the publisher or outlet
     is known by in official_partners(): 'source:<slug>', 'outlet:<league>/<slug>' (feedrank.js pkeyOf is the same rule) */
  it.id = r.id;
  it.row = r;
  /* a story in a language other than the reader's site's wears its code (feedrank.js langOf: the row's own, else the publisher's;
     a league's own article has none) */
  try {
    const FR = typeof window !== 'undefined' ? window.EpinoiaFeedRank : null;
    const l = FR && typeof FR.langOf === 'function' ? FR.langOf(r) : '';
    const site = FR && typeof FR.siteLang === 'function' ? FR.siteLang() : '';
    if (l && l !== site) it.lang = l;
  } catch (_) { /* no tag */ }
  it.pkey = r.kind === 'outlet' && r.source_slug ? 'source:' + r.source_slug
          : r.kind === 'creator' && r.outlet_slug && r.league_slug ? 'outlet:' + r.league_slug + '/' + r.outlet_slug : null;
  return it;
}
function fromFeedRow(r, base, media, crest) {
  const b = base || '';
  const m = typeof media === 'function' ? media : (p => p);
  const lg = typeof crest === 'function' ? crest : m;
  const tags = tagsOf(r.leagues, b, lg);
  if (r.kind === 'outlet') {
    return { kind: 'story', title: r.title, summary: r.summary, image: https(r.image_url), when: r.published_at, author: r.author,
             href: web(r.url), external: true, siteHost: host(r.url), tags,
             brand: { name: r.source_name, logo: https(r.source_logo), colour: hex(r.source_colour),
                      href: r.source_slug ? b + 'news/?s=' + encodeURIComponent(r.source_slug) : null, site: web(r.source_url) } };
  }
  if (r.kind === 'creator') {
    const e = embedOf(r.url);
    return { kind: KIND[r.piece_kind] ? r.piece_kind : 'article', title: r.title, summary: r.summary,
             image: https(r.image_url) || (e && e.thumb) || null, when: r.published_at, author: r.author,
             href: b + 'creators/?l=' + encodeURIComponent(r.league_slug) + '&o=' + encodeURIComponent(r.outlet_slug) + '&p=' + encodeURIComponent(r.slug),
             platform: e ? e.label : (web(r.url) ? host(r.url) : null), league: tags.length ? null : r.league_name, tags,
             embedUrl: web(r.url),
             brand: { name: r.source_name, logo: https(r.source_logo), colour: hex(r.source_colour),
                      href: b + 'creators/?l=' + encodeURIComponent(r.league_slug) + '&o=' + encodeURIComponent(r.outlet_slug) } };
  }
  const img = r.image_url ? (/^https:\/\//.test(r.image_url) ? r.image_url : m(r.image_url)) : null;
  const logo = r.source_logo ? (/^https:\/\//.test(r.source_logo) ? r.source_logo : lg(r.source_logo)) : null;
  return { kind: 'league', title: r.title, summary: r.summary, image: https(img), when: r.published_at, author: r.author, tags,
           href: b + 'news/?l=' + encodeURIComponent(r.league_slug) + '&a=' + encodeURIComponent(r.slug),
           brand: { name: r.league_name || r.source_name, logo: https(logo), colour: hex(r.source_colour),
                    href: b + '?l=' + encodeURIComponent(r.league_slug) } };
}

/* A STORY'S LEAGUES AS ITS TAGS: [{ slug, name, colour, logo }] from the feed, each to that league's news page here */
function tagsOf(list, base, crest) {
  const c = typeof crest === 'function' ? crest : (p => p);
  return (Array.isArray(list) ? list : []).filter(l => l && typeof l.slug === 'string' && l.slug && l.name).slice(0, 4).map(l => {
    const logo = l.logo ? (/^https:\/\//.test(l.logo) ? l.logo : c(l.logo)) : null;
    return { slug: l.slug, name: String(l.name), colour: hex(l.colour), logo: https(logo),
             href: (base || '') + 'news/?l=' + encodeURIComponent(l.slug) };
  });
}

/* the tags as links, each in its league's colour with its crest */
function tagRow(tags) {
  const row = el('div', 'pc-tags');
  row.setAttribute('aria-label', 'leagues');
  tags.forEach(t => {
    const a = el('a', 'pc-tag');
    a.href = t.href;
    a.title = t.name + ': its news';
    a.style.setProperty('--tc', t.colour || tint(t.name));
    a.append(mark({ name: t.name, logo: t.logo }, 'pc-tag-m'), el('span', null, t.name));
    row.appendChild(a);
  });
  return row;
}

/* the brand's mark: its logo, or its initials on its colour when there is none or it will not load. A logo that
   fills its square (the fetcher found no clear ground in its corners and said so with #fill, fetch_feeds.py
   fills_square) is drawn to the edge of its disc or tile; any other sits on white with a margin. */
function mark(brand, cls) {
  const b = brand || {};
  const box = el('span', cls);
  const mono = () => { box.textContent = ''; box.classList.remove('fill'); box.classList.add('mono'); box.appendChild(el('span', null, initials(b.name))); };
  if (b.logo) {
    if (/#fill$/i.test(b.logo)) box.classList.add('fill');
    const img = document.createElement('img');
    img.src = b.logo; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', mono);
    box.appendChild(img);
  } else mono();
  return box;
}

/* THE OFFICIAL-PARTNER PILL: a small gold teletext block, the pixel micro face, black on gold whatever the theme, and
   its name "Official partner" (the words are the text; the capitals are CSS). It is a label, never a link: on a card it
   sits on the plate, away from the headline, and under the headline link's cover. */
function partnerPill(cls) {
  const s = el('span', 'pc-partner' + (cls ? ' ' + cls : ''), 'Official partner');
  s.title = 'Official partner: chosen by Epinoia';
  return s;
}
/* THE LANGUAGE CHIP: a small 'ES' on a story that is not in the reader's language; its title says which language, in the site's */
function langChip(code) {
  const c = String(code || '').toLowerCase();
  const n = el('span', 'pc-lang', c.toUpperCase());
  let name = '';
  try { name = new Intl.DisplayNames([(typeof document !== 'undefined' && document.documentElement.lang) || 'en'], { type: 'language' }).of(c) || ''; } catch (_) { name = ''; }
  n.title = name ? 'In ' + name : 'In another language';
  n.setAttribute('aria-label', name ? 'in ' + name : 'in another language');
  return n;
}
/* "Why am I seeing this?": the ranked feed's reason for a card, as a line at its foot */
function whyLine(why) {
  const d = el('div', 'pc-why');
  d.title = 'Why am I seeing this?';
  d.append(el('i', null, '?'), el('span', null, why));
  d.setAttribute('aria-label', 'Why am I seeing this? ' + why);
  return d;
}

/* THE CARD. opts: { lead, now, embed (show a creator's video / post / podcast in the card itself),
   showLeague (false: no league in the kicker), hideTag (a league's slug: the page is that league's, so no tag for it),
   partners (a Set of the official partners' keys: the item's pkey in it wears the pill), onOpen(item) (called when the
   headline or the way to the piece is pressed: the feed's "read"), why (false: no "Why am I seeing this?" line even
   when the item has one) } */
function card(item, opts) {
  const o = opts || {};
  const it = item || {};
  const b = it.brand || {};
  const K = KIND[it.kind] || KIND.story;
  const colour = b.colour || tint(b.name);
  /* the two ways to the piece tell the page it was opened (a press, a keyboard Enter, a middle click): the feed's "read" */
  const opened = a => { if (typeof o.onOpen === 'function') ['click', 'auxclick'].forEach(t => a.addEventListener(t, () => { try { o.onOpen(it); } catch (_) { /* never in the reader's way */ } })); };
  const art = el('article', 'pc pc-' + (it.kind || 'story') + (o.lead ? ' pc-lead' : '') + (it.image ? '' : ' pc-noimg'));
  art.style.setProperty('--bc', colour);
  const partner = it.partner === true || !!(it.pkey && o.partners && typeof o.partners.has === 'function' && o.partners.has(it.pkey));
  if (partner) art.classList.add('pc-partnered');

  const main = el('div', 'pc-main');

  const e = o.embed && it.embedUrl ? embedOf(it.embedUrl, o.host) : null;
  if (e) {
    art.classList.add('pc-embedded');
  } else {
    const plate = el('div', 'pc-plate');
    if (it.image) {
      const img = el('img', 'pc-cover');
      img.src = it.image; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
      /* a picture that will not load leaves the brand's plate behind */
      img.addEventListener('error', () => { img.remove(); art.classList.add('pc-noimg'); plate.insertBefore(field(b), plate.firstChild); });
      plate.appendChild(img);
      plate.appendChild(el('span', 'pc-shade'));
    } else {
      plate.appendChild(field(b));
    }
    ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'pc-reg ' + c)));
    const badge = el('span', 'pc-badge');
    badge.append(mark(b, 'pc-logo'), el('span', 'pc-bname', b.name || ''));
    plate.appendChild(badge);
    plate.appendChild(el('span', 'pc-kind', K.glyph + ' ' + (it.platform && it.kind !== 'story' && it.kind !== 'article' ? it.platform : K.word)));
    plate.appendChild(el('span', 'pc-grain'));
    if (partner) plate.appendChild(partnerPill());
    main.appendChild(plate);
  }

  const body = el('div', 'pc-body');
  const kick = el('div', 'pc-kick');
  kick.append(el('b', null, b.name || ''));
  const when = ago(it.when, o.now);
  if (when) kick.append(el('span', null, when));
  if (it.league && o.showLeague !== false) kick.append(el('span', 'pc-lg', it.league));
  if (it.lang) kick.append(langChip(it.lang));
  /* a card with no plate (a creator's post played in the card) carries the pill in its kicker */
  if (partner && e) kick.append(partnerPill('in-kick'));
  body.appendChild(kick);
  const h = el('h3', 'pc-title');
  if (it.href) {
    /* THE HEADLINE IS THE LINK, and its ::after covers the card (newscard.css): one link, the card pressed anywhere */
    const a = el('a', 'pc-link', it.title || '');
    a.href = it.href;
    if (it.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    if (it.lang) a.lang = it.lang;
    if (b.name) a.title = b.name + (it.external ? ' — on ' + (it.siteHost || 'their site') : '');
    opened(a);
    h.appendChild(a);
  } else h.textContent = it.title || '';
  body.appendChild(h);
  const sum = lede(it.summary, o.lead ? 240 : 170);
  if (sum && sum !== it.title) body.appendChild(el('p', 'pc-sum', sum));
  const tags = (it.tags || []).filter(t => t.slug !== o.hideTag);
  if (tags.length) body.appendChild(tagRow(tags));
  if (it.why && o.why !== false) body.appendChild(whyLine(it.why));
  main.appendChild(body);
  art.appendChild(main);
  if (e) art.insertBefore(embedNode(e, it.title), main.nextSibling);

  /* the foot: the brand's page here, and the call to read it where it lives */
  const foot = el('div', 'pc-foot');
  if (b.href) {
    const who = el('a', 'pc-src');
    who.href = b.href;
    who.title = 'More from ' + (b.name || 'them');
    who.append(mark(b, 'pc-logo sm'), el('span', null, b.name || 'More'));
    foot.appendChild(who);
  } else foot.appendChild(el('span', 'pc-src', it.author ? 'by ' + it.author : ''));
  if (it.href) {
    const go = el('a', 'pc-go', it.external ? K.cta + ' on ' + (it.siteHost || 'their site') + ' ↗'
                                         : (it.platform && it.kind !== 'article' ? K.cta + ' · ' + it.platform : K.cta) + ' →');
    go.href = it.href;
    if (it.external) { go.target = '_blank'; go.rel = 'noopener noreferrer'; }
    opened(go);
    foot.appendChild(go);
  }
  art.appendChild(foot);
  return art;
}

/* no picture: the brand's print - its colour flooded, the halftone, and its logo on a disc of its own */
function field(b) {
  const f = el('div', 'pc-field');
  f.append(el('span', 'pc-flood'), el('span', 'pc-tone'), mark(b, 'pc-disc'));
  return f;
}

/* A BRAND'S HEAD, at the top of its page here (a publisher's, a creator's): its print across the width, its mark
   on the disc, its name, what it is, and the ways to it. o: { name, logo, colour, kicker, tagline, partner (true: the
   official-partner pill), links: [{ href, text, external, primary }], bell (an element: follow.js's bell) } */
function hero(o) {
  const x = o || {};
  const b = { name: x.name, logo: https(x.logo) };
  const h = el('header', 'pc-hero');
  h.style.setProperty('--bc', hex(x.colour) || tint(x.name));
  const plate = el('div', 'pc-hero-plate');
  plate.append(el('span', 'pc-flood'), el('span', 'pc-tone'), el('span', 'pc-grain'));
  ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'pc-reg ' + c)));
  h.appendChild(plate);
  const inner = el('div', 'pc-hero-in');
  inner.appendChild(mark(b, 'pc-disc'));
  const txt = el('div', 'pc-hero-txt');
  if (x.kicker) txt.appendChild(el('div', 'pc-hero-kick', x.kicker));
  if (x.partner) txt.appendChild(partnerPill('in-hero'));
  txt.appendChild(el('h1', 'pc-hero-name', x.name || ''));
  if (x.tagline) txt.appendChild(el('p', 'pc-hero-tag', x.tagline));
  const acts = el('div', 'pc-hero-acts');
  (x.links || []).forEach(l => {
    const u = l.external ? web(l.href) : (typeof l.href === 'string' && !/^\s*javascript:/i.test(l.href) ? l.href : null);
    if (!u) return;
    const a = el('a', 'pc-btn' + (l.primary ? ' pri' : ''), l.text);
    a.href = u;
    if (l.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    acts.appendChild(a);
  });
  if (x.bell) acts.appendChild(x.bell);
  if (acts.childNodes.length) txt.appendChild(acts);
  inner.appendChild(txt);
  h.appendChild(inner);
  return h;
}

/* A PIECE'S HEAD, in its brand's colourway: the print across the width, the brand's mark and name (its page here)
   with the bell, what kind of piece, the headline centred, when and by whom, and its league tags.
   o: { brand: { name, logo, colour, href }, kind, title, meta: [text], tags (tagsOf), bell, partner (true: the official-partner pill),
   figure (true: the picture under it is laid over its foot) } */
function masthead(o) {
  const x = o || {};
  const b = x.brand || {};
  const h = el('header', 'pc-mast' + (x.figure ? ' pc-has-fig' : ''));
  h.style.setProperty('--bc', hex(b.colour) || tint(b.name));
  const plate = el('div', 'pc-hero-plate');
  plate.append(el('span', 'pc-flood'), el('span', 'pc-tone'), el('span', 'pc-grain'));
  ['tl', 'tr', 'bl', 'br'].forEach(c => plate.appendChild(el('span', 'pc-reg ' + c)));
  const inner = el('div', 'pc-mast-in');
  const top = el('div', 'pc-mast-top');
  const who = el(b.href ? 'a' : 'span', 'pc-mast-brand');
  if (b.href) { who.href = b.href; who.title = 'More from ' + (b.name || 'them'); }
  who.append(mark({ name: b.name, logo: https(b.logo) }, 'pc-logo'), el('span', null, b.name || ''));
  top.appendChild(who);
  if (x.partner) top.appendChild(partnerPill('in-mast'));
  if (x.bell) top.appendChild(x.bell);
  inner.appendChild(top);
  if (x.kind) inner.appendChild(el('div', 'pc-mast-kind', x.kind));
  inner.appendChild(el('h1', 'pc-mast-title', x.title || ''));
  const meta = (x.meta || []).filter(Boolean);
  if (meta.length) inner.appendChild(el('div', 'pc-mast-meta', meta.join(' · ')));
  if ((x.tags || []).length) inner.appendChild(tagRow(x.tags));
  h.append(plate, inner);
  return h;
}

/* A ROW OF BRANDS - the publishers on the News page, a league's creators - each its mark and name, opening its page
   here. list: [{ name, logo, colour, href, note, partner (true: the official-partner pill) }] */
function brands(list) {
  const row = el('div', 'pc-brands');
  (list || []).forEach(x => {
    const a = el('a', 'pc-brand');
    if (x.href) a.href = x.href;
    a.style.setProperty('--bc', hex(x.colour) || tint(x.name));
    const words = el('span', 'pc-brand-w');
    words.appendChild(el('span', 'pc-brand-n', x.name || ''));
    if (x.partner) words.appendChild(partnerPill('in-brand'));
    if (x.note) words.appendChild(el('span', 'pc-brand-x', x.note));
    a.append(mark({ name: x.name, logo: https(x.logo) }, 'pc-logo'), words);
    row.appendChild(a);
  });
  return row;
}

/* a grid of cards, the first one the lead */
function grid(items, opts) {
  const g = el('div', 'pc-grid');
  (items || []).forEach((it, i) => g.appendChild(card(it, Object.assign({}, opts, { lead: (!opts || opts.lead !== false) && i === 0 }))));
  return g;
}

return { card, grid, hero, masthead, brands, mark, fromFeed, tagsOf, embedOf, embedNode, EMBED_HOSTS, lede, ago, tint, initials, host, KIND, partnerPill, whyLine, langChip };
}));
