// "Load articles now": the news-refresh Edge Function's whole rule, on a fake database and a fake network - no network.
//
//   node supabase/tests/news-refresh.test.mjs
//
//   1. THE PARSER, held to the Python reader: scripts/news/fixtures/parity/expected.json is written by
//      scripts/news/fetch_feeds.py's own parse_feed (fetch_feeds_test.py --write-parity); the JavaScript the function runs
//      (supabase/functions/_shared/newsfeed.js) must make the same stories of the same feeds, and read the same dates.
//      Then RSS 2.0, Atom, RDF, JSON Feed, media:content / enclosure / the first <img>, CDATA, bad dates, relative links,
//      duplicate links, a huge feed cut to forty, HTML that is not a feed, a DOCTYPE that must not grow.
//   2. THE ADDRESS: private ranges (v4, v6, mapped, NAT64, 6to4), the odd spellings of 127.0.0.1, http, ports, passwords,
//      internal names; a redirect to any of them, to http, four deep; a name that resolves privately; a body over 2 MB
//      (declared and streamed); a read that never ends; and that the address read is the stored one, never the request's.
//   3. THE HANDLER: anonymous refused, signed-in non-admin refused, a league's administrator only their own league's
//      sources (a platform source is the platform's alone), a platform administrator any and all; a slug that does not
//      exist tells a non-admin nothing; the rate limits (a source once a minute, a caller ten a minute); the audit rows;
//      idempotence (twice adds nothing and writes nothing); what is stored and what is left for the half-hourly read.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseFeed, when, isoPy, checkFeedUrl, isPrivateIp, urljoin, textOf, clip, PER_READ } from '../functions/_shared/newsfeed.js';
import { createHandler, fetchFeed, decodeBody, CALLER_MAX, SOURCE_GAP_S, MAX_BYTES } from '../functions/_shared/newsrefresh.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const FIX = path.join(root, 'scripts', 'news', 'fixtures', 'parity');
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw)?.slice(0, 500))); } };
const NOW = new Date('2026-09-30T12:00:00Z');
const BASE = 'https://hoops.example/en/';
const fx = n => readFileSync(path.join(FIX, n));
const feed = (body, now = NOW, base = BASE) => parseFeed(typeof body === 'string' ? body : body, base, now);
const throws = fn => { try { fn(); return null; } catch (e) { return e.message; } };

/* ================================================================================== 1. the parser */
console.log('-- the parser makes what the Python reader makes (scripts/news/fixtures/parity)');
const want = JSON.parse(fx('expected.json'));
for (const f of ['rss2.xml', 'atom.xml', 'rdf.xml', 'jsonfeed.json', 'huge.xml', 'page.html']) {
  let got;
  try { const [meta, items] = feed(fx(f)); got = { meta, items }; } catch (e) { got = { error: 'not a feed' }; }
  ok(f + ' reads exactly as the Python does', JSON.stringify(got) === JSON.stringify(want[f]), got.items && got.items.map((x, i) => JSON.stringify(x) === JSON.stringify(want[f].items[i]) ? null : x).filter(Boolean)[0]);
}
{
  const bad = want.dates_in.map((v, i) => { const d = when(v, NOW); const g = d ? isoPy(d) : null; return g === want.dates[i] ? null : [v, g, want.dates[i]]; }).filter(Boolean);
  ok('every date form reads as the Python reads it (RFC 822 with zones, ISO, numbers month-first, day-first, day-only, the future)', bad.length === 0, bad);
}

console.log('-- RSS 2.0');
{
  const [meta, items] = feed(fx('rss2.xml'));
  ok('the feed\'s name, home and picture', meta.title === 'Hoops Site' && meta.home === 'https://hoops.example/en/' && meta.image === 'https://hoops.example/logo.png', meta);
  const one = items.find(x => x.guid === 'https://hoops.example/?p=1');
  ok('a headline with its entities read, CDATA read as text, an author and both categories (a category written as <deals> is markup to both readers)', one.title === 'Big & bold: a ‘signing’' && one.author === 'Ana Pérez' && one.tags.join('|') === 'EuroLeague|Transfers &', one);
  ok('the excerpt is words: no markup, no script or style, the WordPress tail gone', one.summary === 'Opening lines with an and a “quote”. Second para.', one.summary);
  ok('a relative link is made absolute against the feed', one.url === 'https://hoops.example/news/1' && items.find(x => x.guid === 'g-5').url === 'https://hoops.example/en/news/5' && items.find(x => x.guid === 'g-6').url === 'https://hoops.example/up/6', items.map(x => x.url));
  ok('a picture: media:content first (an https one); enclosure by its type; the insecure thumbnail passed over', one.image_url === 'https://cdn.hoops.example/one.jpg' && items.find(x => x.title === 'Second story').image_url === 'https://cdn.hoops.example/two.png');
  ok('...the first <img> of the text when the item names none (og-style fallback), made absolute; media:group and itunes:image too',
    items.find(x => x.guid === 'g-4').image_url === 'https://hoops.example/img/lead.webp' && items.find(x => x.guid === 'g-5').image_url === 'https://cdn.hoops.example/group.jpg' && items.find(x => x.guid === 'g-6').image_url === 'https://cdn.hoops.example/it.jpg');
  ok('two items with one link are one story (the newest kept)', items.filter(x => x.url.includes('news/2')).length === 1 && items.find(x => x.url.includes('news/2')).title === 'Second story');
  ok('an item with no link is left out', !items.some(x => x.guid === 'g-9'));
  ok('an item with no headline takes its first words as one (an untitled Bluesky or Mastodon post), as fetch_feeds.py does', (items.find(x => x.url.endsWith('/news/10')) || {}).title === 'dropped: no headline');
  ok('a podcast episode with no page link takes its audio file as the link', (() => { const [, its] = feed('<rss version="2.0"><channel><title>Pod</title><item><title>Ep 1</title><guid>e1</guid><enclosure url="https://cdn.example/ep1.mp3" type="audio/mpeg"/></item></channel></rss>'); return its.length === 1 && its[0].url === 'https://cdn.example/ep1.mp3'; })());
  ok('a date that is not a date, or is in the future, is the read\'s; a date of numbers is read', items.find(x => x.guid === 'g-3').published_at === '2026-09-30T12:00:00+00:00' && items.find(x => x.guid === 'g-4').published_at === '2026-09-30T11:59:59+00:00' && items.find(x => x.guid === 'g-5').published_at === '2026-09-15T22:15:00+00:00');
  ok('stories dated at one moment are a second apart, in the feed\'s order', items.find(x => x.guid === 'g-7').published_at === '2026-09-20T12:00:00+00:00' && items.find(x => x.guid === 'g-8').published_at === '2026-09-20T11:59:59+00:00');
  ok('newest first', items.every((x, i) => !i || items[i - 1].published_at >= x.published_at));
  ok('an excerpt is at most 320 characters, cut at a word with an ellipsis', items.find(x => x.guid === 'g-11').summary.length <= 320 && items.find(x => x.guid === 'g-11').summary.endsWith('…'));
}

console.log('-- Atom, RDF, JSON Feed');
{
  const [meta, items] = feed(fx('atom.xml'));
  ok('Atom: the alternate link (not the self link), the published date with its zone, the thumbnail, two authors, two categories', meta.home === 'https://bcb.example/blogs/news' && items[0].url === 'https://bcb.example/blogs/news/one' && items[0].published_at === '2026-09-30T12:00:00+00:00' && items[0].image_url === 'https://cdn.bcb.example/thumb.jpg' && items[0].author === 'Sam, Kim' && items[0].tags.join() === 'BCB,Fixtures', items[0]);
  ok('...an xhtml title and body read as words, an item with only a self link falls back to it as its address... and none without one is left out', items.find(x => x.title === 'An xhtml title').summary === 'Body from xhtml content.' && !items.some(x => x.url.includes('self-only')), items.map(x => x.url));
  ok('...a media:group thumbnail and description', items.find(x => x.title === 'No date at all').image_url === 'https://cdn.bcb.example/g.jpg' && items.find(x => x.title === 'No date at all').summary === 'Group description');
  const [, rdf] = feed(fx('rdf.xml'));
  ok('RSS 1.0 (RDF): the rdf:about is the guid, dc:date the date, dc:subject the category', rdf.length === 2 && rdf[0].guid === 'https://old.example/a' && rdf[0].published_at === '2026-09-28T08:00:00+00:00' && rdf[0].tags.join() === 'News', rdf);
  const [jm, jit] = feed(fx('jsonfeed.json'));
  ok('JSON Feed: authors joined, content_text kept as text, external_url the address, no id makes the url the guid, a bad date the read\'s', jit.length === 3 && jit.find(x => x.guid === '1').author === 'Lee, Mo' && jit.find(x => x.guid === '2').url === 'https://elsewhere.example/2' && jit.find(x => x.guid === '2').summary === 'Text <not> markup & more' && jit.find(x => x.title === 'No id').guid === 'https://json.example/4' && jm.home === 'https://json.example/', jit);
}

console.log('-- a huge feed, and what is not a feed');
{
  const [, items] = feed(fx('huge.xml'));
  ok('sixty stories are cut to the newest forty', items.length === PER_READ && PER_READ === 40, items.length);
  ok('...the newest', items.every((x, i) => !i || items[i - 1].published_at >= x.published_at) && items[0].published_at >= items[39].published_at);
  ok('an HTML page is not a feed', /not a feed/.test(throws(() => feed(fx('page.html'))) || ''));
  ok('nor is an empty body, plain text, truncated XML, a mismatched tag, JSON that is not a feed, or an unknown root',
    [Buffer.from(''), Buffer.from('hello'), Buffer.from('<rss><channel><item><title>x'), Buffer.from('<rss><channel></rss>'), Buffer.from('{"a":1}'), Buffer.from('[1]'), Buffer.from('<html/>'), Buffer.from('<?xml version="1.0"?><foo/>')]
      .every(b => /not a feed/.test(throws(() => feed(b)) || '')));
  ok('a feed with no items is a feed with none', feed('<rss version="2.0"><channel><title>x</title></channel></rss>')[1].length === 0);
  const dtd = feed(fx('dtd.xml'))[1];
  ok('a DOCTYPE\'s entities are never expanded (a billion laughs is one name, not a gigabyte)', dtd.length === 1 && dtd[0].title === 'Entity &b; stays a name', dtd);
  ok('a byte-order mark and CRLFs are no trouble', feed('﻿<?xml version="1.0"?>\r\n<rss version="2.0"><channel>\r\n<item><title>T</title><link>https://x.example/1</link></item></channel></rss>')[1].length === 1);
  ok('XML nested past a hundred deep is refused, not walked', /not a feed/.test(throws(() => feed('<a>'.repeat(300) + '</a>'.repeat(300))) || ''));
  ok('an address is joined as a person reads it (../, ./, //, ?q, #f, a bare name)',
    urljoin('https://a.example/x/y/z.html', '../w') === 'https://a.example/x/w' && urljoin('https://a.example/x/y', './w?q=1#f') === 'https://a.example/x/w?q=1#f' && urljoin('https://a.example/x/', '//b.example/q') === 'https://b.example/q' && urljoin('https://a.example/x/y', 'z') === 'https://a.example/x/z' && urljoin('https://a.example', '/q') === 'https://a.example/q', urljoin('https://a.example/x/y/z.html', '../w'));
  ok('text: a "<" that opens nothing stays, an unclosed script drops the rest, comments go', textOf('a < b <!-- c --> d <script>x')[0] === 'a < b d' && clip('x'.repeat(400), 320).length === 320);
  ok('the body is read in the charset it says (header, then the XML declaration)', decodeBody(Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><t>caf\xe9</t>', 'latin1'), '').includes('café') && decodeBody(Buffer.from('café'), 'text/xml; charset=utf-8') === 'café' && decodeBody(Buffer.from('x'), 'text/xml; charset=nonsense') === 'x');
}

/* ===================================================================================== 2. the address */
console.log('-- which address may be read');
{
  const blocked = ['http://hoops.example/feed', 'https://127.0.0.1/feed', 'https://localhost/feed', 'https://a.localhost/x', 'https://10.0.0.1/', 'https://172.16.5.5/', 'https://172.31.255.255/', 'https://192.168.1.1/', 'https://169.254.169.254/latest/meta-data',
    'https://100.64.0.1/', 'https://0.0.0.0/', 'https://[::1]/', 'https://[::]/', 'https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/', 'https://[fe80::1]/', 'https://[fd00::1]/', 'https://[fc00::1]/', 'https://[64:ff9b::a00:1]/',
    'https://[2002:7f00:1::]/', 'https://[2001:db8::1]/', 'https://[ff02::1]/', 'https://2130706433/', 'https://0x7f.1/', 'https://017700000001/', 'https://127.1/', 'https://metadata.google.internal/', 'https://db.internal/',
    'https://intranet/', 'https://printer.local/', 'https://x.example:8443/feed', 'https://user:pw@hoops.example/feed', 'https://user@hoops.example/feed', 'ftp://hoops.example/feed', 'file:///etc/passwd', 'javascript:alert(1)', 'not an address', '',
    'https://224.0.0.1/', 'https://198.18.0.1/', 'https://192.0.2.1/', 'https://8.8.8.8.example/feed?x=1#y'.replace('.example', '.internal')];
  const notBlocked = blocked.filter(u => checkFeedUrl(u).ok);
  ok('every one of ' + blocked.length + ' private, odd or non-https addresses is refused', notBlocked.length === 0, notBlocked);
  ok('an ordinary https feed is let through, as the address it is', ['https://www.eurohoops.net/en/feed/', 'https://basketnews.com/news/rss', 'https://hoops.example:443/feed', 'https://8.8.8.8/feed', 'https://[2606:4700::1111]/feed'].every(u => checkFeedUrl(u).ok));
  ok('isPrivateIp: the edges of the ranges', [['172.15.255.255', false], ['172.16.0.0', true], ['172.32.0.1', false], ['100.63.255.255', false], ['100.128.0.1', false], ['11.0.0.1', false], ['169.253.1.1', false], ['1.1.1.1', false], ['::ffff:1.1.1.1', false], ['2606:4700::1', false], ['::ffff:10.0.0.1', true], ['999.1.1.1', true]].every(([ip, want]) => isPrivateIp(ip) === want));
}

console.log('-- the read itself: redirects, size, time, and the address never the request\'s');
const res = (status, body, headers = {}) => new Response(body, { status, headers });
const chunked = (n, size = 65536) => new Response(new ReadableStream({ start(c) { for (let i = 0; i < n; i += size) c.enqueue(new Uint8Array(Math.min(size, n - i)).fill(97)); c.close(); } }), { status: 200 });
const code = async p => { try { await p; return null; } catch (e) { return e.code + ': ' + e.message; } };
{
  const seen = [];
  const mk = routes => ({ fetch: async (u, init) => { seen.push([u, init.redirect]); const r = routes[u]; if (!r) return res(404, 'no'); return typeof r === 'function' ? r(init) : r; }, resolve: async () => ['93.184.216.34'] });
  let r = await fetchFeed(mk({ 'https://a.example/feed': res(200, '<rss/>', { 'content-type': 'application/rss+xml' }) }), 'https://a.example/feed');
  ok('a plain read: the bytes, the type, the address; redirects are followed by hand (never by fetch)', r.contentType === 'application/rss+xml' && r.url === 'https://a.example/feed' && seen[0][1] === 'manual', [r.url, seen[0]]);
  seen.length = 0;
  r = await fetchFeed(mk({ 'https://a.example/feed': res(301, '', { location: '/moved' }), 'https://a.example/moved': res(302, '', { location: 'https://b.example/f' }), 'https://b.example/f': res(200, '<rss/>') }), 'https://a.example/feed');
  ok('a redirect to another public https address is followed (relative or absolute), each hop asked again', r.url === 'https://b.example/f' && seen.length === 3);
  for (const [why, loc] of [['a private address', 'https://169.254.169.254/latest/meta-data'], ['localhost', 'https://localhost/admin'], ['an http address', 'http://b.example/f'], ['a private IPv6 address', 'https://[::1]/'], ['a name with a password', 'https://u:p@b.example/f'], ['another port', 'https://b.example:8080/f']]) {
    const c = await code(fetchFeed(mk({ 'https://a.example/feed': res(302, '', { location: loc }), [loc]: res(200, '<rss/>') }), 'https://a.example/feed'));
    ok('a redirect to ' + why + ' is refused, and never fetched', /^blocked/.test(c || '') && !seen.some(s => s[0] === loc), c);
  }
  ok('four redirects are one too many', /^unreachable: too many redirects/.test(await code(fetchFeed(mk({ 'https://a.example/1': res(302, '', { location: '/2' }), 'https://a.example/2': res(302, '', { location: '/3' }), 'https://a.example/3': res(302, '', { location: '/4' }), 'https://a.example/4': res(302, '', { location: '/5' }), 'https://a.example/5': res(200, 'x') }), 'https://a.example/1')) || ''));
  ok('a redirect with nowhere to go is refused', /^unreachable/.test(await code(fetchFeed(mk({ 'https://a.example/f': res(302, '') }), 'https://a.example/f')) || ''));
  ok('a name that resolves to a private address is refused, never fetched', /^blocked: its host is on a private address/.test(await code(fetchFeed({ fetch: async () => { throw new Error('fetched!'); }, resolve: async () => ['10.0.0.5'] }, 'https://evil.example/feed')) || ''));
  ok('...one of several addresses being private is enough (IPv6 too)', /^blocked/.test(await code(fetchFeed({ fetch: async () => res(200, 'x'), resolve: async () => ['93.184.216.34', 'fd00::5'] }, 'https://evil.example/feed')) || ''));
  ok('a runtime that cannot resolve names reads on (the literal and redirect checks still hold); strict mode refuses',
    (await fetchFeed({ fetch: async () => res(200, '<rss/>'), resolve: async () => null }, 'https://a.example/f')).url === 'https://a.example/f' && /^blocked: its host could not be checked/.test(await code(fetchFeed({ fetch: async () => res(200, 'x'), resolve: async () => null, strictDns: true }, 'https://a.example/f')) || ''));
  ok('an http address in the database is never read', /^blocked: only https/.test(await code(fetchFeed({ fetch: async () => { throw new Error('fetched!'); } }, 'http://a.example/f')) || ''));
  ok('a 5xx, a 404 and a refused connection are "unreachable", with what the site said',
    /HTTP 503/.test(await code(fetchFeed(mk({ 'https://a.example/f': res(503, 'x') }), 'https://a.example/f')) || '') && /HTTP 404/.test(await code(fetchFeed(mk({}), 'https://a.example/f')) || '') && /^unreachable: could not connect/.test(await code(fetchFeed({ fetch: async () => { throw new TypeError('fetch failed'); }, resolve: async () => [] }, 'https://a.example/f')) || ''));
  ok('a feed of exactly 2 MB is read; one byte more (streamed, no length given) is too big', (await fetchFeed(mk({ 'https://a.example/f': chunked(MAX_BYTES) }), 'https://a.example/f')).bytes.length === MAX_BYTES && /^too_big/.test(await code(fetchFeed(mk({ 'https://a.example/f': chunked(MAX_BYTES + 1) }), 'https://a.example/f')) || ''));
  ok('...and one that says so up front is refused before its body is read', /^too_big/.test(await code(fetchFeed(mk({ 'https://a.example/f': res(200, 'x', { 'content-length': String(MAX_BYTES + 5) }) }), 'https://a.example/f')) || ''));
  const t0 = Date.now();
  const slow = { timeoutMs: 80, resolve: async () => [], fetch: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) };
  const c = await code(fetchFeed(slow, 'https://a.example/f'));
  ok('a site that never answers is given up on at the limit (10 s in the function; 80 ms here)', /^unreachable: timed out after/.test(c || '') && Date.now() - t0 < 2000, c);
  const stall = { timeoutMs: 80, resolve: async () => [], fetch: async (u, init) => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); init.signal.addEventListener('abort', () => c.error(new Error('aborted'))); } }), { status: 200 }) };
  ok('...and so is one that starts and stalls', /^unreachable: timed out after/.test(await code(fetchFeed(stall, 'https://a.example/f')) || ''));
}

/* ==================================================================================== 3. the handler */
console.log('-- the handler: who, what, how often');
const RSS = fx('rss2.xml').toString();
const TWO = '<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><item><title>One</title><link>https://feed.example/1</link><guid>1</guid><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate><description>First.</description></item><item><title>Two</title><link>https://feed.example/2</link><guid>2</guid><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate></item></channel></rss>';

function world(over = {}) {
  const w = {
    clock: NOW.getTime(),
    sources: [
      { id: 's-plat', slug: 'eurohoops', name: 'Eurohoops', feed_url: 'https://feed.example/eurohoops', league_id: null, enabled: true },
      { id: 's-kbl', slug: 'kbl-news', name: 'KBL News', feed_url: 'https://feed.example/kbl', league_id: 'L-kbl', enabled: true },
      { id: 's-acb', slug: 'acb-news', name: 'ACB News', feed_url: 'https://feed.example/acb', league_id: 'L-acb', enabled: true },
      { id: 's-off', slug: 'old-news', name: 'Old News', feed_url: 'https://feed.example/old', league_id: 'L-kbl', enabled: false }
    ],
    items: [], marks: [], audit: [], fetched: [], bodies: {}, headers: {},
    users: { 'tok-fan': { id: 'u-fan' }, 'tok-kbl': { id: 'u-kbl' }, 'tok-plat': { id: 'u-plat' }, 'tok-plat2': { id: 'u-plat2' } },
    platform: new Set(['tok-plat', 'tok-plat2']), leagueAdmin: { 'tok-kbl': new Set(['L-kbl']) },
    ...over
  };
  let seq = 0;
  const deps = {
    cors: { 'Access-Control-Allow-Origin': '*' },
    now: () => new Date(w.clock),
    fetch: async url => { w.fetched.push(url); const b = w.bodies[url]; if (b === undefined) return res(404, 'gone'); if (b instanceof Error) throw b; return res(200, b, { 'content-type': 'application/xml', ...w.headers }); },
    resolve: async () => ['93.184.216.34'],
    isService: t => t === 'service-key',
    getUser: async t => w.users[t] || null,
    isPlatformAdmin: async t => w.platform.has(t),
    canManage: async (t, league) => !!(w.leagueAdmin[t] && w.leagueAdmin[t].has(league)),
    db: {
      source: async slug => w.sources.find(s => s.slug === slug) || null,
      sources: async () => w.sources.filter(s => s.enabled),
      existing: async (sid, guids) => new Map(w.items.filter(i => i.source_id === sid && guids.includes(i.guid)).map(i => [i.guid, i])),
      upsert: async rows => { w.upserts = (w.upserts || []).concat([rows]); rows.forEach(r => { const k = w.items.findIndex(i => i.source_id === r.source_id && i.guid === r.guid); if (k < 0) w.items.push({ ...r, league_ids: [] }); else w.items[k] = { ...w.items[k], ...r, published_at: w.items[k].published_at, fetched_at: w.items[k].fetched_at }; }); },
      count: async sid => w.items.filter(i => i.source_id === sid).length,
      mark: async (sid, f) => { w.marks.push([sid, f]); Object.assign(w.sources.find(s => s.id === sid), f); },
      lastRefresh: async sid => { const r = w.audit.filter(a => a.action === 'news_refresh' && a.subject_id === sid).map(a => a.created_at).sort().pop(); return r || null; },
      callerCalls: async (uid, since) => w.audit.filter(a => a.action === 'news_refresh_call' && a.actor === uid && a.created_at >= since).map(a => a.created_at),
      audit: async row => { w.audit.push({ id: ++seq, created_at: new Date(w.clock).toISOString(), ...row }); }
    },
    ...(over.deps || {})
  };
  w.deps = deps;
  w.handle = createHandler(deps);
  w.post = (token, body, method = 'POST') => w.handle(new Request('https://x.example/functions/v1/news-refresh', { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json' }, body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined }));
  w.send = async (token, body) => { const r = await w.post(token, body); return { status: r.status, j: await r.json().catch(() => null) }; };
  for (const s of w.sources) w.bodies[s.feed_url] = TWO;
  return w;
}
const secs = (w, n) => { w.clock += n * 1000; };

{
  const w = world();
  ok('OPTIONS is answered without anybody\'s credentials, with the CORS headers', (await w.post(null, null, 'OPTIONS')).status === 200 && (await w.post(null, null, 'OPTIONS')).headers.get('access-control-allow-origin') === '*');
  ok('anything but POST is refused (405)', (await w.post('tok-plat', null, 'GET')).status === 405);
  let r = await w.send(null, { source: 'eurohoops' });
  ok('ANONYMOUS: no credentials at all is 401, and nothing is read or written', r.status === 401 && r.j.code === 'auth' && w.fetched.length === 0 && w.audit.length === 0, r);
  r = await w.send('the-anon-key', { source: 'eurohoops' });
  ok('...the project\'s anon key (a token that is no user) is 401 too', r.status === 401 && w.fetched.length === 0, r);
  r = await w.send('tok-fan', { source: 'eurohoops' });
  ok('A SIGNED-IN READER who administers nothing: 403 on a platform source', r.status === 403 && r.j.code === 'forbidden' && w.fetched.length === 0 && w.audit.length === 0, r);
  r = await w.send('tok-fan', { source: 'kbl-news' });
  ok('...on a league\'s source', r.status === 403 && w.fetched.length === 0, r);
  r = await w.send('tok-fan', { all: true });
  ok('...and on all', r.status === 403 && w.fetched.length === 0, r);
  r = await w.send('tok-fan', { source: 'no-such-source' });
  const r2 = await w.send('tok-fan', { source: 'eurohoops' });
  ok('...a slug that does not exist answers a non-admin exactly as one that does (no probing)', r.status === 403 && r.j.code === r2.j.code && r.j.error !== undefined, [r, r2]);
  r = await w.send('tok-kbl', { source: 'eurohoops' });
  ok('A LEAGUE ADMINISTRATOR (KBL): a platform source is the platform\'s alone', r.status === 403 && w.fetched.length === 0, r);
  r = await w.send('tok-kbl', { source: 'acb-news' });
  ok('...another league\'s source is refused', r.status === 403 && w.fetched.length === 0, r);
  r = await w.send('tok-kbl', { all: true });
  ok('...all is refused', r.status === 403, r);
  r = await w.send('tok-kbl', { source: 'kbl-news' });
  ok('...their own league\'s source is read', r.status === 200 && r.j.ok && r.j.added === 2 && w.fetched.join() === 'https://feed.example/kbl', r);
  r = await w.send('tok-plat', { source: 'acb-news' });
  ok('A PLATFORM ADMINISTRATOR: any source (a league\'s)', r.status === 200 && r.j.ok, r);
  r = await w.send('tok-plat', { source: 'eurohoops' });
  ok('...a platform source', r.status === 200 && r.j.ok, r);
  r = await w.send('tok-plat', { source: 'no-such-source' });
  ok('...and is told when a source does not exist (404 no_source)', r.status === 404 && r.j.code === 'no_source', r);
  r = await w.send('service-key', { source: 'old-news' });
  ok('a switched-off source is refused with a reason (409), even to a platform administrator', (await w.send('tok-plat', { source: 'old-news' })).j.code === 'off' && r.status === 409, r);
  ok('a body that is not a request is 400', (await w.send('tok-plat2', 'not json')).status === 400 && (await w.send('tok-plat2', {})).status === 400 && (await w.send('tok-plat2', { source: '../../etc' })).status === 400 && (await w.send('tok-plat2', { source: 'a'.repeat(200) })).status === 400 && (await w.send('tok-plat2', [1])).status === 400);
}

console.log('-- what is read is what the database holds, and only that');
{
  const w = world();
  w.bodies['https://feed.example/eurohoops'] = TWO;
  const r = await w.send('tok-plat', { source: 'eurohoops', url: 'http://169.254.169.254/latest', feed_url: 'https://evil.example/x', feed: 'https://evil.example/y', site_url: 'https://evil.example/z', id: 's-kbl' });
  ok('an address, feed_url or id in the request is ignored: the stored feed_url is the only address asked for', r.status === 200 && w.fetched.length === 1 && w.fetched[0] === 'https://feed.example/eurohoops' && w.items.every(i => i.source_id === 's-plat'), w.fetched);
  const w2 = world();
  w2.sources[0].feed_url = 'https://169.254.169.254/latest/meta-data';
  const r2 = await w2.send('tok-plat', { source: 'eurohoops' });
  ok('a stored feed_url that is private is refused as "blocked" (422): nothing fetched, the reason kept on the source', r2.status === 422 && r2.j.code === 'blocked' && w2.fetched.length === 0 && /not read/.test(w2.sources[0].last_error), r2);
  const w3 = world();
  w3.sources[0].feed_url = 'http://feed.example/eurohoops';
  ok('...and a stored http one', (await w3.send('tok-plat', { source: 'eurohoops' })).status === 422 && w3.fetched.length === 0);
  const w4 = world({ deps: { fetch: async u => { w4.fetched.push(u); return u === 'https://feed.example/eurohoops' ? res(302, '', { location: 'https://10.1.1.1/secret' }) : res(200, TWO); } } });
  const r4 = await w4.send('tok-plat', { source: 'eurohoops' });
  ok('a feed that redirects to a private address is refused (422), the private address never asked', r4.status === 422 && w4.fetched.length === 1, [r4, w4.fetched]);
}

console.log('-- what is stored');
{
  const w = world();
  w.sources[0].etag = 'W/"abc"'; w.sources[0].last_modified = 'Tue, 29 Sep 2026 00:00:00 GMT';
  const r = await w.send('tok-plat', { source: 'eurohoops' });
  ok('the answer: added, updated, total, fetched, took_ms, last_error', r.j.ok && r.j.added === 2 && r.j.updated === 0 && r.j.total === 2 && r.j.fetched === 2 && r.j.last_error === null && typeof r.j.took_ms === 'number' && r.j.slug === 'eurohoops', r.j);
  const one = w.items.find(i => i.guid === '1');
  ok('a story: its source, guid, address, headline, excerpt, picture, author, tags, its own date, and when it was read', one.source_id === 's-plat' && one.url === 'https://feed.example/1' && one.title === 'One' && one.summary === 'First.' && one.published_at === '2026-09-29T10:00:00+00:00' && one.fetched_at === NOW.toISOString() && Array.isArray(one.tags), one);
  ok('the league tags are left to the half-hourly read: none are written by this (a new story has none until it runs)', w.upserts.flat().every(x => !('league_ids' in x)), w.upserts[0][0]);
  const m = w.marks[0][1];
  ok('the source: read now, ok now, no error, its count', m.last_fetched_at === NOW.toISOString() && m.last_ok_at === NOW.toISOString() && m.last_error === null && m.item_count === 2, m);
  ok('...and its ETag and Last-Modified cleared, so the next half-hourly read fetches afresh and tags what came in', m.etag === null && m.last_modified === null);
  ok('the page\'s own status and the marks agree on the count', w.sources[0].item_count === 2);
}
{
  const w = world();
  w.sources[0].etag = 'W/"abc"';
  await w.send('tok-plat', { source: 'eurohoops' });
  secs(w, 61);
  w.sources[0].etag = 'W/"kept"';
  const before = JSON.stringify(w.items);
  const r = await w.send('tok-plat', { source: 'eurohoops' });
  ok('IDEMPOTENT: pressed again with nothing new, it adds 0 and updates 0 and says the same total', r.j.ok && r.j.added === 0 && r.j.updated === 0 && r.j.total === 2, r.j);
  ok('...and writes no story at all (the rows are not touched), and leaves the ETag as the half-hourly read left it', w.upserts.length === 1 && JSON.stringify(w.items) === before && w.sources[0].etag === 'W/"kept"', w.upserts.length);
  secs(w, 61);
  w.bodies['https://feed.example/eurohoops'] = TWO.replace('<title>One</title>', '<title>One, corrected</title>').replace('</channel>', '<item><title>Three</title><link>https://feed.example/3</link><guid>3</guid><pubDate>Wed, 30 Sep 2026 09:00:00 GMT</pubDate></item></channel>');
  const r3 = await w.send('tok-plat', { source: 'eurohoops' });
  ok('a corrected headline is an update, a new story an add', r3.j.added === 1 && r3.j.updated === 1 && r3.j.total === 3 && w.items.find(i => i.guid === '1').title === 'One, corrected', r3.j);
  ok('...and a story keeps its place (published_at and fetched_at as first read)', w.items.find(i => i.guid === '1').published_at === '2026-09-29T10:00:00+00:00');
  secs(w, 61);
  w.bodies['https://feed.example/eurohoops'] = TWO.replace('2026 10:00:00 GMT</pubDate><description>First', '2026 10:00:00 GMT</pubDate><description>First');
  const r4 = await w.send('tok-plat', { source: 'eurohoops' });
  ok('a story that has left the feed stays (only the cron prunes, at 120 days)', r4.j.total === 3 && r4.j.added === 0);
  secs(w, 61);
  w.bodies['https://feed.example/eurohoops'] = TWO.replace('Tue, 29 Sep 2026', 'Tue, 29 Sep 2025').replace('Mon, 28 Sep 2026', 'Mon, 28 Sep 2025');
  const w5 = world(); w5.bodies['https://feed.example/eurohoops'] = TWO.replace('Tue, 29 Sep 2026', 'Sun, 29 Sep 2024').replace('Mon, 28 Sep 2026', 'Sat, 28 Sep 2024');
  const r5 = await w5.send('tok-plat', { source: 'eurohoops' });
  ok('a story older than the 120 days the reader keeps is not loaded (it would only be pruned)', r5.j.ok && r5.j.added === 0 && r5.j.total === 0, r5.j);
}
{
  const w = world();
  w.bodies['https://feed.example/eurohoops'] = RSS;
  const r = await w.send('tok-plat', { source: 'eurohoops' });
  ok('a real fixture feed is loaded whole (ten stories of it), each once, with a picture where it has one', r.j.ok && r.j.added === 10 && w.items.filter(i => i.image_url).length >= 5, r.j);
}

console.log('-- when a feed will not load');
{
  for (const [why, body, codeWant, status, text] of [
    ['it is not a feed', '<html><body>Hi</body></html>', 'not_feed', 502, /not a feed/],
    ['the site is down', Object.assign(new TypeError('fetch failed'), {}), 'unreachable', 502, /unreachable/],
    ['it does not exist', undefined, 'unreachable', 502, /HTTP 404/]
  ]) {
    const w = world();
    if (body === undefined) delete w.bodies['https://feed.example/eurohoops']; else w.bodies['https://feed.example/eurohoops'] = body;
    const r = await w.send('tok-plat', { source: 'eurohoops' });
    ok('a source that ' + why + ': ' + status + ' ' + codeWant + ', and its reason kept on the source for the console', r.status === status && r.j.code === codeWant && text.test(r.j.error) && text.test(w.sources[0].last_error) && w.sources[0].last_ok_at === undefined, r);
    ok('...it wrote no stories, and audited the attempt', w.items.length === 0 && w.audit.some(a => a.action === 'news_refresh' && a.detail.ok === false && a.detail.code === codeWant));
  }
}

console.log('-- how often');
{
  const w = world();
  let r = await w.send('tok-plat', { source: 'eurohoops' });
  ok('the first press reads', r.status === 200);
  secs(w, 18);
  r = await w.send('tok-plat2', { source: 'eurohoops' });
  ok('RATE LIMIT, per source: a second press, by ANYBODY, 18 s later is 429 with the seconds to wait (42)', r.status === 429 && r.j.code === 'rate' && r.j.retry_after === 42 && w.fetched.length === 1, r);
  ok('...a refused press writes no audit row and asks the site nothing', w.audit.filter(a => a.action === 'news_refresh_call').length === 1 && w.audit.filter(a => a.action === 'news_refresh').length === 1);
  r = await w.send('tok-plat', { source: 'acb-news' });
  ok('...another source is free at once', r.status === 200);
  secs(w, 43);
  r = await w.send('tok-plat2', { source: 'eurohoops' });
  ok('...and the minute over, the source is free again', r.status === 200 && w.fetched.filter(u => u.endsWith('eurohoops')).length === 2, r);
  ok('the gap is a minute', SOURCE_GAP_S === 60);
}
{
  const w = world();
  w.sources = Array.from({ length: 14 }, (_, i) => ({ id: 's' + i, slug: 'src-' + i, name: 'Src ' + i, feed_url: 'https://feed.example/' + i, league_id: null, enabled: true }));
  w.sources.forEach(s => { w.bodies[s.feed_url] = TWO; });
  const out = [];
  for (let i = 0; i < 12; i++) out.push((await w.send('tok-plat', { source: 'src-' + i })));
  ok('RATE LIMIT, per caller: ten requests in a minute, the eleventh is 429 "rate_caller" with a wait', out.slice(0, CALLER_MAX).every(x => x.status === 200) && out[10].status === 429 && out[10].j.code === 'rate_caller' && out[10].j.retry_after >= 1 && out[10].j.retry_after <= 60 && CALLER_MAX === 10, out.map(x => x.status));
  ok('...the twelfth too, and only ten rows of calls were kept', out[11].status === 429 && w.audit.filter(a => a.action === 'news_refresh_call').length === 10);
  const other = await w.send('tok-plat2', { source: 'src-12' });
  ok('...another caller is not held by it', other.status === 200, other);
  secs(w, 61);
  ok('...and a minute later the caller is free', (await w.send('tok-plat', { source: 'src-10' })).status === 200);
}
{
  const w = world();
  const [a, b] = await Promise.all([w.send('tok-plat', { source: 'eurohoops' }), w.send('tok-plat2', { source: 'eurohoops' })]);
  ok('two presses arriving together read the feed once (the second is told to wait)', [a.status, b.status].sort().join() === '200,429' && w.fetched.length === 1, [a.status, b.status]);
}

console.log('-- the audit log');
{
  const w = world();
  await w.send('tok-kbl', { source: 'kbl-news' });
  const call = w.audit.find(a => a.action === 'news_refresh_call'), rd = w.audit.find(a => a.action === 'news_refresh');
  ok('a request that is let through is logged before it runs: who, which source', call && call.actor === 'u-kbl' && call.subject === 'news_source' && call.subject_id === 's-kbl' && call.detail.source === 'kbl-news', call);
  ok('...and what came of it: ok, added, updated, total, how long, which source', rd && rd.actor === 'u-kbl' && rd.subject === 'news_source' && rd.subject_id === 's-kbl' && rd.detail.ok === true && rd.detail.added === 2 && rd.detail.total === 2 && typeof rd.detail.took_ms === 'number' && rd.detail.slug === 'kbl-news', rd);
  ok('...never anything of the request or the token', !JSON.stringify(w.audit).includes('tok-kbl'));
  const before = w.audit.length;
  await w.send('tok-fan', { source: 'kbl-news' });
  ok('a refused request leaves no row', w.audit.length === before);
  const w3 = world();
  w3.deps.db.audit = async () => { throw new Error('audit is down'); };
  const h = createHandler(w3.deps);
  const rr = await h(new Request('https://x/', { method: 'POST', headers: { Authorization: 'Bearer tok-plat' }, body: JSON.stringify({ source: 'eurohoops' }) }));
  ok('a log that cannot be written does not undo a read that was made', rr.status === 200 && w3.items.length === 2);
}

console.log('-- all');
{
  const w = world();
  w.bodies['https://feed.example/acb'] = new TypeError('fetch failed');
  const r = await w.send('tok-plat', { all: true });
  ok('all: every enabled source (not the switched-off one), each read, one failing without stopping the rest', r.status === 200 && r.j.all && r.j.sources === 3 && r.j.read === 2 && r.j.failed === 1 && r.j.added === 4 && r.j.results.length === 3 && !r.j.results.some(x => x.slug === 'old-news'), r.j);
  ok('...each result named, the failure readable', r.j.results.find(x => x.slug === 'acb-news').code === 'unreachable' && /unreachable/.test(r.j.results.find(x => x.slug === 'acb-news').error) && r.j.results.find(x => x.slug === 'eurohoops').added === 2);
  ok('...one row for the request, one for each source read', w.audit.filter(a => a.action === 'news_refresh_call').length === 1 && w.audit.filter(a => a.action === 'news_refresh').length === 3 && w.audit.find(a => a.action === 'news_refresh').detail.all === true);
  secs(w, 10);
  const r2 = await w.send('tok-plat2', { all: true });
  ok('...pressed again within the minute, each source holds to its own minute (all "waiting", nothing fetched)', r2.status === 200 && r2.j.waiting === 3 && r2.j.read === 0 && w.fetched.length === 3, r2.j);
}

console.log('-- the wiring of the function (index.ts)');
{
  const ts = readFileSync(path.join(root, 'supabase', 'functions', 'news-refresh', 'index.ts'), 'utf8');
  ok('it runs the shared handler and answers OPTIONS itself before anything else', /createHandler\(/.test(ts) && /from '\.\.\/_shared\/newsrefresh\.js'/.test(ts) && ts.indexOf("req.method === 'OPTIONS'") > 0);
  ok('the caller is asked as the caller: getUser, is_platform_admin and can_manage_news_sources with their own token', /auth\.getUser\(\)/.test(ts) && /rpc\('is_platform_admin'\)/.test(ts) && /rpc\('can_manage_news_sources', \{ p_league: leagueId \}\)/.test(ts));
  ok('the service role writes, and only to news_items, news_sources and audit_log', ['news_items', 'news_sources', 'audit_log'].every(t => ts.includes("from('" + t + "')")) && !/from\('(?!news_items|news_sources|audit_log)/.test(ts));
  ok('the item write is by (source_id, guid), as the Python reader\'s', /onConflict: 'source_id,guid'/.test(ts));
  ok('it is not in config.toml as verify_jwt = false: the gateway checks the JWT too', !/\[functions\.news-refresh\]/.test(readFileSync(path.join(root, 'supabase', 'config.toml'), 'utf8')));
  ok('it reads no address from the request (the body is read in the handler, and only for a slug)', !/req\.json|feed_url\s*:\s*body|body\.(url|feed)/.test(ts));
  ok('CORS: POST and OPTIONS, and the headers supabase-js sends', /'Access-Control-Allow-Methods': 'POST, OPTIONS'/.test(ts) && /authorization, x-client-info, apikey, content-type/.test(ts));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
