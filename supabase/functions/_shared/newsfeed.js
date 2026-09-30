/* ============================================================================
   NEWS FEED - a publisher's feed read into stories, and the guard on which address may be read.

   THE SECOND IMPLEMENTATION OF scripts/news/fetch_feeds.py's parse_feed. The half-hourly reader (Python, GitHub
   Actions) and the "Load now" button (the news-refresh Edge Function, Deno) must make the same story out of the
   same feed, or a story loaded by hand would be replaced by a different one at the next read. So this file follows
   the Python rule for rule (PER_READ, SUMMARY_MAX, the excerpt, the picture, the date, the order, one of each) and
   both are held to the same fixtures (scripts/news/fixtures/parity/, expected.json written by the Python) by
   scripts/news/fetch_feeds_test.py and supabase/tests/news-refresh.test.mjs. Change one, change the other.

   What differs on purpose: no DOM in the Edge runtime, so the XML is read by a small tokenizer here (entities other
   than the five and the numeric ones are left as they stand, not refused; a DOCTYPE is skipped, never expanded, so
   no entity can grow); and the league tags are not matched here (see news-refresh: the next half-hourly read tags
   what was loaded by hand).

   PURE: no network, no Deno, no clock but the `now` handed in. Plain ESM, so node runs the tests on it as it stands.
   ============================================================================ */

export const PER_READ = 40;            // the newest this many items of a feed are kept each read
export const KEEP_DAYS = 120;          // older items are not kept
export const SUMMARY_MAX = 320;

const NS = {
  'http://www.w3.org/2005/Atom': 'atom',
  'http://search.yahoo.com/mrss/': 'media',
  'http://purl.org/rss/1.0/modules/content/': 'content',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://www.itunes.com/dtds/podcast-1.0.dtd': 'itunes',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://purl.org/rss/1.0/': 'rss1'
};

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', bull: '•',
  middot: '·', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', euro: '€',
  pound: '£', yen: '¥', cent: '¢', sect: '§', deg: '°', plusmn: '±', times: '×',
  divide: '÷', frac12: '½', frac14: '¼', frac34: '¾', iexcl: '¡', iquest: '¿', shy: '­',
  para: '¶', larr: '←', rarr: '→', uarr: '↑', darr: '↓', thinsp: ' ', ensp: ' ', emsp: ' '
};
/* the Latin-1 letters by name, from 192: agrave, eacute, ntilde, ouml, szlig ... */
('Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times ' +
 'Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml ' +
 'eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml')
  .split(' ').forEach((n, i) => { NAMED[n] = String.fromCharCode(192 + i); });

const cp = n => { try { return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�'; } catch (_) { return '�'; } };

/* &amp; &#8216; &#x2019; &eacute; read; a name not known is left as it stands */
export function unescapeHtml(s) {
  return String(s).replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,9});/g, (m, e) => {
    if (e[0] === '#') return cp(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return Object.prototype.hasOwnProperty.call(NAMED, e) ? NAMED[e] : m;
  });
}
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/* ------------------------------------------------------------------------------------------------ text --- */
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/y;
const STAG = /<([^\s/>=]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/y;
const SKIP = new Set(['script', 'style', 'noscript', 'iframe', 'svg']);
const BLOCK = new Set(['p', 'br', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'tr']);

/* (the plain text of some HTML, the img srcs in it): tags gone, entities read, scripts and styles dropped, paragraphs a space */
export function textOf(markup) {
  if (!markup) return ['', []];
  const s = String(markup);
  const out = [], imgs = [];
  let skip = 0, i = 0, low = null;
  const n = s.length;
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { if (!skip) out.push(unescapeHtml(s.slice(i))); break; }
    if (lt > i && !skip) out.push(unescapeHtml(s.slice(i, lt)));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); i = e < 0 ? n : e + 3; continue; }
    TAG.lastIndex = lt;
    const m = TAG.exec(s);
    if (!m) {                                            // a "<" that opens nothing: text
      if (!skip) out.push('<');
      i = lt + 1;
      continue;
    }
    i = lt + m[0].length;
    const tag = m[2].toLowerCase(), closing = m[1] === '/', selfClose = /\/\s*$/.test(m[3]);
    if (closing) { if (SKIP.has(tag) && skip) skip--; continue; }
    if (SKIP.has(tag)) {
      if (tag === 'script' || tag === 'style') {         // their content is not markup: on to the closing tag
        if (low === null) low = s.toLowerCase();
        const e = low.indexOf('</' + tag, i);
        if (e < 0) { i = n; continue; }
        const g = s.indexOf('>', e);
        i = g < 0 ? n : g + 1;
        continue;
      }
      if (!selfClose) skip++;
    } else if (tag === 'img') {
      const a = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(m[3]);
      const v = a && (a[1] !== undefined ? a[1] : a[2] !== undefined ? a[2] : a[3]);
      if (v) imgs.push(unescapeHtml(v));
    } else if (BLOCK.has(tag)) out.push(' ');
  }
  return [out.join('').replace(/\s+/g, ' ').trim(), imgs];
}

/* at most n characters, cut at a word where there is one, with an ellipsis */
export function clip(text, n) {
  const t = String(text || '').trim();
  const cps = Array.from(t);
  if (cps.length <= n) return t;
  let cut = cps.slice(0, n - 1).join('');
  const sp = cut.lastIndexOf(' ');
  if (Array.from(cut.slice(0, sp)).length > n * 0.6 && sp >= 0) cut = cut.slice(0, sp);
  return cut.replace(/[ ,.;:\-–—]+$/, '') + '…';
}

/* an address made absolute, without re-encoding it (as Python's urljoin) */
export function urljoin(base, ref) {
  ref = String(ref);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref)) return ref;
  const b = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?/.exec(String(base));
  if (!b) return ref;
  const [, scheme, auth, bpath, bquery] = b;
  if (ref.startsWith('//')) return scheme + ':' + ref;
  if (ref === '') return String(base).replace(/#.*$/, '');
  let path, query = '', frag = '';
  const h = ref.indexOf('#');
  if (h >= 0) { frag = ref.slice(h); ref = ref.slice(0, h); }
  const q = ref.indexOf('?');
  if (q >= 0) { query = ref.slice(q); ref = ref.slice(0, q); }
  if (ref === '') { path = bpath; if (!query) query = bquery || ''; }
  else if (ref[0] === '/') path = ref;
  else path = bpath.slice(0, bpath.lastIndexOf('/') + 1) + ref;
  if (!path.startsWith('/')) path = '/' + path;
  const segs = [];
  const parts = path.split('/');
  parts.slice(1).forEach((p, k, all) => {
    if (p === '.') { if (k === all.length - 1) segs.push(''); }
    else if (p === '..') { if (segs.length) segs.pop(); if (k === all.length - 1) segs.push(''); }
    else segs.push(p);
  });
  return scheme + '://' + auth + '/' + segs.join('/') + query + frag;
}

/* an image the page may show: https, made absolute */
export function httpsOnly(url, base) {
  if (!url) return null;
  const u = urljoin(base, unescapeHtml(String(url).trim()));
  return /^https:\/\//i.test(u) && u.length <= 500 && !/[\s<>"]/.test(u) ? u : null;
}
/* an article's address: http(s), made absolute */
export function webUrl(url, base) {
  if (!url) return null;
  const u = urljoin(base, unescapeHtml(String(url).trim()));
  return /^https?:\/\//i.test(u) && u.length <= 1000 && !/[\s<>"]/.test(u) ? u : null;
}

/* ------------------------------------------------------------------------------------------------ dates --- */
const NUMERIC_DATE = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ZONES = { GMT: 0, UT: 0, UTC: 0, Z: 0, EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420 };
const RFC822 = /^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{2,4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([+-]\d{2}:?\d{2}|[A-Za-z]{1,5})?$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d+))?)?)?)?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?$/;

const utc = (y, mo, d, h, mi, s, ms) => {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms || 0));
  return t.getUTCMonth() !== mo - 1 ? null : t;                  // a 31st of April is not a date
};

/* RFC 822 (RSS), ISO 8601 (Atom, JSON Feed, dc:date), or a date in numbers (month first unless the first number cannot
   be a month); a date more than five minutes ahead is now. A day with no time: now when it is today, else that day's noon */
export function when(value, now) {
  if (!value) return null;
  const v = String(value).trim();
  let d = null;
  let m = RFC822.exec(v);
  if (m && MONTHS[m[2].toLowerCase()]) {
    let y = +m[3];
    if (m[3].length === 2) y += y < 50 ? 2000 : 1900;
    d = utc(y, MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    if (d && m[7]) {
      const z = m[7];
      const off = /^[+-]/.test(z) ? (z[0] === '-' ? -1 : 1) * (parseInt(z.slice(1, 3), 10) * 60 + parseInt(z.slice(-2), 10)) : (ZONES[z.toUpperCase()] || 0);
      d = new Date(d.getTime() - off * 60000);
    }
  }
  if (!d) {
    m = NUMERIC_DATE.exec(v);
    if (m) {
      const a = +m[1], b = +m[2], y = +m[3];
      const [mon, day] = a > 12 ? [b, a] : [a, b];
      if (m[4] === undefined) {
        const dd = utc(y, mon, day, 12, 0, 0);
        if (!dd) return null;
        const same = dd.getUTCFullYear() === now.getUTCFullYear() && dd.getUTCMonth() === now.getUTCMonth() && dd.getUTCDate() === now.getUTCDate();
        return same ? now : dd;
      }
      const hh = m[7] ? (+m[4] % 12) + (m[7].toLowerCase() === 'pm' ? 12 : 0) : +m[4];
      d = utc(y, mon, day, hh, +m[5], +(m[6] || 0));
      if (!d) return null;
    }
  }
  if (!d) {
    m = ISO.exec(v);
    if (m) {
      d = utc(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), m[7] ? Math.floor(+('0.' + m[7]) * 1000) : 0);
      if (d && m[8] && !/^[Zz]$/.test(m[8])) {
        const z = m[8].replace(':', '');
        const off = (z[0] === '-' ? -1 : 1) * (parseInt(z.slice(1, 3), 10) * 60 + parseInt(z.slice(3, 5) || '0', 10));
        d = new Date(d.getTime() - off * 60000);
      }
    }
  }
  if (!d) return null;
  return d.getTime() > now.getTime() + 5 * 60000 ? now : d;      // a clock a little ahead is let be
}

/* as Python's datetime.isoformat() writes a UTC time: 2026-09-30T10:00:00+00:00 (microseconds only when there are some) */
export function isoPy(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const ms = d.getUTCMilliseconds();
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + 'T' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' +
    p(d.getUTCSeconds()) + (ms ? '.' + p(ms, 3) + '000' : '') + '+00:00';
}

/* ------------------------------------------------------------------------------------------------- xml --- */
/* A SMALL XML READER: elements with children, attributes, text and CDATA; namespaces mapped to the fixed prefixes above
   (an element in an unknown namespace keeps {uri}local). Refuses what is not well formed enough to be a feed. */
const MAX_DEPTH = 100, MAX_NODES = 200000;

function parseXml(src) {
  let s = String(src);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const n = s.length;
  const root = { name: '#root', kids: [], attrs: {}, ns: { xml: 'xml' }, parent: null, raw: '#root' };
  let cur = root, i = 0, depth = 0, count = 0, seenRoot = false;
  const addText = t => { if (t && cur !== root) cur.kids.push(t); };
  const xmlText = t => t.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|lt|gt|quot|apos);/g, (m, e) =>
    e[0] === '#' ? cp(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e]);
  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { addText(xmlText(s.slice(i))); break; }
    if (lt > i) addText(xmlText(s.slice(i, lt)));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt + 4); if (e < 0) throw new Error('unterminated comment'); i = e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt + 9);
      if (e < 0) throw new Error('unterminated CDATA');
      addText(s.slice(lt + 9, e));                        // (kept apart from markup: CDATA is text, never entities)
      i = e + 3;
      continue;
    }
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt + 2); if (e < 0) throw new Error('unterminated declaration'); i = e + 2; continue; }
    if (s.startsWith('<!', lt)) {                         // a DOCTYPE: skipped, never expanded
      let d = lt + 2, br = 0;
      for (; d < n; d++) { const c = s[d]; if (c === '[') br++; else if (c === ']') br--; else if (c === '>' && br <= 0) break; }
      i = d + 1;
      continue;
    }
    if (s[lt + 1] === '/') {
      const g = s.indexOf('>', lt);
      if (g < 0) throw new Error('unterminated tag');
      const nm = s.slice(lt + 2, g).trim();
      if (cur === root || nm !== cur.raw) throw new Error('mismatched tag');
      cur = cur.parent; depth--;
      i = g + 1;
      continue;
    }
    STAG.lastIndex = lt;
    const m = STAG.exec(s);
    if (!m) throw new Error('bad tag');
    if (cur === root && seenRoot) throw new Error('more than one root');
    if (++count > MAX_NODES || ++depth > MAX_DEPTH) throw new Error('too deep or too large');
    const attrs = {}, decl = {};
    for (const a of m[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) {
      const val = xmlText(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : '');
      if (a[1] === 'xmlns') decl[''] = val; else if (a[1].startsWith('xmlns:')) decl[a[1].slice(6)] = val; else attrs[a[1]] = val;
    }
    const ns = Object.keys(decl).length ? Object.assign({}, cur.ns, decl) : cur.ns;
    const canon = (raw, isAttr) => {
      const c = raw.indexOf(':');
      const prefix = c < 0 ? '' : raw.slice(0, c), local = c < 0 ? raw : raw.slice(c + 1);
      if (isAttr && c < 0) return local;
      const uri = ns[prefix];
      if (uri === undefined) return raw;
      return NS[uri] ? NS[uri] + ':' + local : (uri && uri !== 'xml' ? '{' + uri + '}' + local : local);
    };
    const pf = m[1].indexOf(':');
    const el = { raw: m[1], name: canon(m[1], false), kids: [], attrs: {}, ns, parent: cur, uri: ns[pf < 0 ? '' : m[1].slice(0, pf)] || '' };
    for (const k of Object.keys(attrs)) el.attrs[canon(k, true)] = attrs[k];
    cur.kids.push(el);
    seenRoot = seenRoot || cur === root;
    i = lt + m[0].length;
    if (m[3] === '/') depth--; else cur = el;
  }
  if (cur !== root) throw new Error('unclosed tag');
  const top = root.kids.find(k => typeof k !== 'string');
  if (!top) throw new Error('no element');
  return top;
}

const kids = (el, name) => el ? el.kids.filter(k => typeof k !== 'string' && k.name === name) : [];
const kid = (el, name) => kids(el, name)[0] || null;
const path = (el, p) => p.split('/').reduce((els, name) => els.flatMap(e => kids(e, name)), [el]);
/* the text before the first child element, trimmed (ElementTree's .text) */
const t_ = el => {
  if (!el) return '';
  let out = '';
  for (const k of el.kids) { if (typeof k !== 'string') break; out += k; }
  return out.trim();
};
/* an element written back as HTML (Atom's type="xhtml") */
const serialise = el => el.kids.map(k => {
  if (typeof k === 'string') return escapeHtml(k);
  const nm = k.uri ? 'ns0:' + k.raw.replace(/^[^:]*:/, '') : k.raw;       // as ElementTree writes a namespaced tag: so <img> in
  return '<' + nm + Object.keys(k.attrs).map(a => ' ' + a + '="' + escapeHtml(k.attrs[a]) + '"').join('') + '>' + serialise(k) + '</' + nm + '>';   // xhtml is no img to the reader, in either language
}).join('');

/* ---------------------------------------------------------------------------------------------- parsing --- */
const WP_TAIL = /\s*The post [\s\S]{1,300}? appeared first on [\s\S]{1,120}?\.?\s*$/;

function item(title, link, guid, date, summaryHtml, contentHtml, author, tags, images, base, now) {
  let [words, imgs] = textOf(summaryHtml);
  if (!words && contentHtml) { const r = textOf(contentHtml); words = r[0]; imgs = imgs.concat(r[1]); }
  else if (contentHtml) imgs = imgs.concat(textOf(contentHtml)[1]);
  words = words.replace(WP_TAIL, '').trim();
  const url = webUrl(link, base);
  const ttl = clip(textOf(title)[0], 300) || clip(words, 140);      // an untitled post (Bluesky, Mastodon): its first words, as fetch_feeds.py
  if (!url || !ttl) return null;
  let image = null;
  for (const x of images.concat(imgs)) { const u = httpsOnly(x, base); if (u) { image = u; break; } }
  const g = String(guid || '').trim() || url;
  const d = when(date, now);
  return {
    guid: Array.from(g).slice(0, 500).join(''),
    url,
    title: ttl,
    summary: clip(words, SUMMARY_MAX),
    image_url: image,
    author: clip(textOf(author)[0], 80) || null,
    tags: tags.filter(t => t && textOf(t)[0]).map(t => clip(textOf(t)[0], 40)).slice(0, 8),
    published_at: d ? isoPy(d) : null                     // none: newest() dates it
  };
}

const IMG_EXT = /\.(jpe?g|png|webp|gif)(\?|$)/i;

/* (the feed's own name, home and picture; its items, newest first, at most PER_READ). Throws when it is not a feed at all. */
export function parseFeed(body, base, now) {
  now = now || new Date();
  const text = typeof body === 'string' ? body : new TextDecoder('utf-8').decode(body);
  const head = text.replace(/^[\s﻿]+/, '')[0];
  if (head === '{') {                                     // JSON Feed
    let j;
    try { j = JSON.parse(text); } catch (e) { throw new Error('not a feed: ' + e.message); }
    if (!j || typeof j !== 'object' || Array.isArray(j) || !Array.isArray(j.items)) throw new Error('not a feed');
    const items = [];
    for (const it of j.items) {
      if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
      const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
      const authors = (Array.isArray(it.authors) && it.authors.length ? it.authors : null) || (isObj(it.author) ? [it.author] : []);
      const x = item(it.title || '', it.url || it.external_url, String(it.id || ''), it.date_published || it.date_modified,
        it.summary || it.content_html || escapeHtml(it.content_text || ''), null,
        authors.filter(isObj).map(a => a.name || '').join(', '), Array.isArray(it.tags) ? it.tags.map(String) : [],
        [it.image, it.banner_image], base, now);
      if (x) items.push(x);
    }
    return [{ title: j.title || null, home: webUrl(j.home_page_url, base), image: httpsOnly(j.icon || j.favicon, base) }, newest(items, now)];
  }

  let root;
  try { root = parseXml(text); } catch (e) { throw new Error('not a feed: ' + e.message); }
  const tag = root.name;
  const items = [];
  if (tag === 'rss' || tag === 'rdf:RDF') {
    const rss = tag === 'rss';
    const ch = rss ? kid(root, 'channel') : kid(root, 'rss1:channel');
    const nodes = rss ? (ch ? kids(ch, 'item') : []) : kids(root, 'rss1:item');
    const T = n => rss ? n : 'rss1:' + n;
    for (const it of nodes) {
      const imgs = [];
      for (const enc of kids(it, 'enclosure')) {
        if ((enc.attrs.type || '').startsWith('image/') || IMG_EXT.test(enc.attrs.url || '')) imgs.push(enc.attrs.url);
      }
      for (const m of kids(it, 'media:content').concat(path(it, 'media:group/media:content'))) {
        if (m.attrs.medium === 'image' || (m.attrs.type || '').startsWith('image/') ||
            (!m.attrs.medium && !m.attrs.type && IMG_EXT.test(m.attrs.url || ''))) imgs.push(m.attrs.url);
      }
      kids(it, 'media:thumbnail').forEach(m => imgs.push(m.attrs.url));
      kids(it, 'itunes:image').forEach(m => imgs.push(m.attrs.href));
      const guid = t_(kid(it, 'guid')) || it.attrs['rdf:about'] || '';
      const audio = (kids(it, 'enclosure').find(enc => (enc.attrs.type || '').startsWith('audio/')) || { attrs: {} }).attrs.url || null;   // a podcast episode with no page: its audio
      const x = item(t_(kid(it, T('title'))), rss ? (t_(kid(it, 'link')) || audio) : t_(kid(it, T('link'))), guid,
        t_(kid(it, 'pubDate')) || t_(kid(it, 'dc:date')),
        t_(kid(it, T('description'))), t_(kid(it, 'content:encoded')),
        t_(kid(it, 'dc:creator')) || t_(kid(it, 'author')),
        kids(it, 'category').map(t_).concat(kids(it, 'dc:subject').map(t_)),
        imgs.filter(Boolean), base, now);
      if (x) items.push(x);
    }
    let img = null;
    if (ch) img = t_(path(ch, 'image/url')[0]) || (kid(ch, 'itunes:image') ? kid(ch, 'itunes:image').attrs.href : null);
    return [{ title: ch ? t_(kid(ch, 'title')) : null, home: webUrl(ch ? t_(kid(ch, 'link')) : null, base), image: httpsOnly(img, base) }, newest(items, now)];
  }

  if (tag === 'atom:feed') {
    const linkOf = node => {
      let best = null;
      for (const l of kids(node, 'atom:link')) {
        const rel = l.attrs.rel;
        if (rel === undefined || rel === '' || rel === 'alternate') return l.attrs.href;
        best = best || (rel !== 'self' ? l.attrs.href : null);
      }
      return best;
    };
    const markup = node => !node ? '' : node.attrs.type === 'xhtml' ? serialise(node) : nodeText(node);
    for (const e of kids(root, 'atom:entry')) {
      const imgs = kids(e, 'media:thumbnail').map(m => m.attrs.url);
      kids(e, 'media:content').forEach(m => { if (m.attrs.medium === 'image' || (m.attrs.type || '').startsWith('image/')) imgs.push(m.attrs.url); });
      path(e, 'media:group/media:thumbnail').forEach(m => imgs.push(m.attrs.url));
      const descr = t_(path(e, 'media:group/media:description')[0]);
      const x = item(markup(kid(e, 'atom:title')), linkOf(e), t_(kid(e, 'atom:id')),
        t_(kid(e, 'atom:published')) || t_(kid(e, 'atom:updated')),
        markup(kid(e, 'atom:summary')) || escapeHtml(descr), markup(kid(e, 'atom:content')),
        kids(e, 'atom:author').map(a => t_(kid(a, 'atom:name'))).join(', '),
        kids(e, 'atom:category').map(c => c.attrs.term || ''),
        imgs.filter(Boolean), base, now);
      if (x) items.push(x);
    }
    return [{ title: textOf(t_(kid(root, 'atom:title')))[0] || null, home: webUrl(linkOf(root), base),
      image: httpsOnly(t_(kid(root, 'atom:logo')) || t_(kid(root, 'atom:icon')), base) }, newest(items, now)];
  }
  throw new Error('not a feed: <' + tag + '>');
}
/* an element's own text (ElementTree's .text, not stripped: a title's inner spaces matter to nobody, and item() cleans it) */
const nodeText = el => { let out = ''; for (const k of el.kids) { if (typeof k !== 'string') break; out += k; } return out; };

/* newest first, one of each, at most PER_READ. A story with no date is dated now, a second apart in the feed's own order;
   stories dated at one moment are set a second apart in the feed's order, so the page's "older" never steps over one */
export function newest(items, now) {
  let k = 0;
  for (const x of items) if (!x.published_at) x.published_at = isoPy(new Date(now.getTime() - 1000 * k++));
  const taken = new Map();
  for (const x of items) {
    const t = x.published_at, c = taken.get(t) || 0;
    taken.set(t, c + 1);
    if (c) x.published_at = isoPy(new Date(new Date(t).getTime() - 1000 * c));
  }
  const seen = new Set(), out = [];
  const sorted = items.map((x, i) => [x, i]).sort((a, b) => a[0].published_at < b[0].published_at ? 1 : a[0].published_at > b[0].published_at ? -1 : a[1] - b[1]);
  for (const [x] of sorted) {
    if (seen.has(x.guid)) continue;
    seen.add(x.guid);
    out.push(x);
  }
  return out.slice(0, PER_READ);
}

/* ------------------------------------------------------------------------------------------- the address --- */
/* WHICH ADDRESS MAY BE READ. Only https, on the ordinary port, to a public name or a public address; never one with a
   password in it. The URL parser has already turned 2130706433, 0x7f.1 and 017700000001 into 127.0.0.1 by the time this looks. */
export function isPrivateIp(ip) {
  const h = String(ip).replace(/^\[|\]$/g, '').toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b, c] = [+v4[1], +v4[2], +v4[3]];
    if ([a, b, c, +v4[4]].some(x => x > 255)) return true;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
  }
  if (h.indexOf(':') < 0) return false;
  let words;
  try { words = ipv6Words(h); } catch (_) { return true; }   // what cannot be read is not let through
  if (!words) return true;
  const embedded = (hi, lo) => isPrivateIp((hi >> 8) + '.' + (hi & 255) + '.' + (lo >> 8) + '.' + (lo & 255));
  if (words.every(w => w === 0)) return true;                                    // ::
  if (words.slice(0, 7).every(w => w === 0) && words[7] === 1) return true;     // ::1
  if (words.slice(0, 5).every(w => w === 0) && (words[5] === 0xffff || words[5] === 0)) return embedded(words[6], words[7]);   // ::ffff:a.b.c.d, ::a.b.c.d
  if (words[0] === 0x64 && words[1] === 0xff9b) return embedded(words[6], words[7]);                                          // 64:ff9b::/96 (NAT64)
  if (words[0] === 0x2002) return embedded(words[1], words[2]);                                                                // 6to4
  if ((words[0] & 0xfe00) === 0xfc00) return true;                                // fc00::/7
  if ((words[0] & 0xffc0) === 0xfe80) return true;                                // fe80::/10
  if ((words[0] & 0xff00) === 0xff00) return true;                                // ff00::/8
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true;                   // documentation
  return false;
}
function ipv6Words(h) {
  let s = h.split('%')[0];
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (dotted) {
    const p = dotted[1].split('.').map(Number);
    if (p.some(x => x > 255)) return null;
    s = s.slice(0, -dotted[1].length) + ((p[0] << 8) | p[1]).toString(16) + ':' + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const a = halves[0] ? halves[0].split(':') : [], b = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - a.length - b.length : 0;
  if (fill < 0 || (halves.length === 1 && a.length !== 8)) return null;
  const all = a.concat(Array(fill).fill('0'), b);
  if (all.length !== 8 || all.some(x => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return all.map(x => parseInt(x, 16));
}

const BAD_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|private|home\.arpa|invalid)$/;

/* { ok: true, url } or { ok: false, why }. `url` is what is stored in news_sources, or where a redirect went: never the request's. */
export function checkFeedUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { return { ok: false, why: 'not an address' }; }
  if (u.protocol !== 'https:') return { ok: false, why: 'only https addresses are read' };
  if (u.username || u.password) return { ok: false, why: 'an address with a password in it is not read' };
  if (u.port && u.port !== '443') return { ok: false, why: 'only the ordinary https port is read' };
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, why: 'no host' };
  if (host.startsWith('[') || /^[0-9.]+$/.test(host)) {
    if (isPrivateIp(host)) return { ok: false, why: 'a private address is not read' };
  } else {
    if (host.indexOf('.') < 0 || BAD_NAME.test(host)) return { ok: false, why: 'an internal name is not read' };
    if (/^0x[0-9a-f]+$/i.test(host.split('.').pop())) return { ok: false, why: 'not a public name' };
  }
  return { ok: true, url: u.href };
}
