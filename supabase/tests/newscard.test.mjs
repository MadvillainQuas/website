// THE POST CARD (epinoia/newscard.js) and the pages that carry it: the embeds a creator's link becomes (and
// only those), the first lines of an excerpt, a feed row as a card, the league tags, the card's links (one to
// the piece, never one inside another, noopener outside), and the pages' wiring - each page that frames an
// embed allows exactly the platforms newscard.js builds frames for.
//   node supabase/tests/newscard.test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

/* ------------------------------------------------------------ a fake page --- */
class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = '';
    this.className = ''; this.dataset = {}; this.attrs = {}; this.listeners = {};
    const props = {};
    this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: k => props[k] };
  }
  get classList() {
    const self = this, list = () => self.className.split(/\s+/).filter(Boolean);
    return { contains: c => list().includes(c), add: c => { if (!list().includes(c)) self.className = list().concat(c).join(' '); },
             remove: c => { self.className = list().filter(x => x !== c).join(' '); } };
  }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  insertBefore(n, ref) { n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); }
  get nextSibling() { const p = this.parentNode; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null; }
  get firstChild() { return this.children[0] || null; }
  get childNodes() { return this.children; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set innerHTML(v) { throw new Error('innerHTML used: ' + v); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  all() { const out = []; const walk = n => (n.children || []).forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
  find(cls) { return this.all().find(n => n.classList.contains(cls)) || null; }
}
globalThis.document = { createElement: t => new El(t), createTextNode: t => new Text(t) };

const K = require(path.join(root, 'epinoia', 'newscard.js'));

console.log('\nwhat a creator\'s link becomes (embedOf)');
const yt = K.embedOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10');
ok('a YouTube video: the privacy-enhanced player, wide, with its thumbnail', yt && yt.src === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' && yt.shape === 'wide' &&
   yt.thumb === 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', yt);
ok('...a Short is tall; youtu.be is the same video', K.embedOf('https://youtube.com/shorts/abcdEFGH123').shape === 'tall' &&
   K.embedOf('https://youtu.be/dQw4w9WgXcQ').src === yt.src);
ok('a TikTok video, an Instagram post or reel (with its caption), an X post, a Threads post',
   K.embedOf('https://www.tiktok.com/@club/video/7301234567890123456').src === 'https://www.tiktok.com/embed/v2/7301234567890123456' &&
   K.embedOf('https://www.instagram.com/reels/C8abcdEFGHI/').src === 'https://www.instagram.com/reel/C8abcdEFGHI/embed/captioned/' &&
   K.embedOf('https://x.com/club/status/1790000000000000000').src.startsWith('https://platform.twitter.com/embed/Tweet.html?dnt=true&id=1790000000000000000') &&
   K.embedOf('https://www.threads.net/@club/post/C8abcdEFG').provider === 'threads');
ok('a Spotify episode (an intl- address too), a SoundCloud track, an Apple Podcasts show',
   K.embedOf('https://open.spotify.com/intl-de/episode/4rOoJ6Egrf8K2IrywzwOMk').src === 'https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk' &&
   K.embedOf('https://soundcloud.com/club/game-3').provider === 'soundcloud' && K.embedOf('https://podcasts.apple.com/gb/podcast/x/id123').shape === 'audio');
ok('a Twitch video only where the page names itself (Twitch requires it)',
   K.embedOf('https://www.twitch.tv/videos/123456789') === null && K.embedOf('https://www.twitch.tv/videos/123456789', 'example.org').src.includes('&parent=example.org'));
ok('anything else is a link, never a frame: http, another site, a made-up id, script',
   [ 'http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=<script>',
     'javascript:alert(1)', 'https://www.instagram.com/stories/x/1/', null, '' ].every(u => K.embedOf(u) === null));
ok('every frame is on a host EMBED_HOSTS names', ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.tiktok.com/@c/video/7301234567890123456',
   'https://www.instagram.com/p/C8abcdEFGHI/', 'https://x.com/c/status/17900000000000', 'https://www.threads.net/@c/post/C8abcdEFG',
   'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk', 'https://soundcloud.com/a/b', 'https://podcasts.apple.com/gb/podcast/x/id1',
   'https://www.twitch.tv/club'].every(u => { const e = K.embedOf(u, 'example.org'); return e && K.EMBED_HOSTS.includes(new URL(e.src).origin); }));

console.log('\nthe first lines (lede)');
ok('the first sentence', K.lede('The club has signed a veteran centre from Greece for the next two seasons. He arrives on Monday.') ===
   'The club has signed a veteran centre from Greece for the next two seasons.');
ok('...and the next when the first is too short to say much', K.lede('Big night. The champions lost at home for the first time since March.') === 'Big night. The champions lost at home for the first time since March.');
ok('...at most so many characters, cut at a word', (() => { const t = K.lede('word '.repeat(80), 60); return t.length <= 60 && t.endsWith('…') && !/ …$/.test(t); })());

console.log('\na feed row as a card (fromFeed) and its league tags (tagsOf)');
const out = K.fromFeed({ kind: 'outlet', id: 'x', title: 'Motiejunas joins PAOK', summary: 'A one-year deal.', image_url: 'http://insecure.example/a.jpg',
  url: 'https://www.eurohoops.net/en/a/1', published_at: '2026-09-30T10:00:00Z', source_name: 'Eurohoops', source_logo: 'https://e.example/l.png#fill',
  source_colour: '#e30613', source_url: 'https://www.eurohoops.net', source_slug: 'eurohoops',
  leagues: [{ slug: 'eurocup', name: 'EuroCup', colour: '#123456', logo: 'leagues/ec.png' }, { slug: 'x' }, null] }, '../', p => p, p => 'https://crests.example/' + p);
ok('a publisher\'s story: to its own site, in a new tab; its publisher\'s page here at the foot', out.href === 'https://www.eurohoops.net/en/a/1' && out.external === true &&
   out.brand.href === '../news/?s=eurohoops' && out.siteHost === 'eurohoops.net', out);
ok('...an http picture is no picture', out.image === null);
ok('...its league tags, each to that league\'s news, its crest found where the site keeps crests; a tag with no name is none',
   out.tags.length === 1 && out.tags[0].href === '../news/?l=eurocup' && out.tags[0].logo === 'https://crests.example/leagues/ec.png' && out.tags[0].colour === '#123456', out.tags);
const cr = K.fromFeed({ kind: 'creator', title: 'Film room', summary: 'Three possessions.', image_url: null, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  published_at: '2026-09-30T10:00:00Z', source_name: 'Hoops Tape', league_slug: 'kbl', league_name: 'KBL', outlet_slug: 'hoops-tape', slug: 'film-room', piece_kind: 'video',
  leagues: [{ slug: 'kbl', name: 'KBL' }] }, '../');
ok('a creator\'s piece: to its page here, with its platform named and its video\'s thumbnail for a picture',
   cr.href === '../creators/?l=kbl&o=hoops-tape&p=film-room' && !cr.external && cr.platform === 'YouTube' && /i\.ytimg\.com/.test(cr.image) && cr.kind === 'video', cr);
const lg = K.fromFeed({ kind: 'league', title: 'Round two', summary: '', image_url: 'news/x.jpg', published_at: '2026-09-30T10:00:00Z', source_name: 'KBL',
  source_logo: 'leagues/kbl.png', league_slug: 'kbl', league_name: 'KBL', slug: 'round-two', leagues: [] }, '', p => 'https://media.example/' + p);
ok('the league\'s own article: to its page here, its stored picture made an address', lg.href === 'news/?l=kbl&a=round-two' && lg.image === 'https://media.example/news/x.jpg' && lg.tags.length === 0);

const chYt = K.fromFeed({ kind: 'channel', id: 'c1', title: 'Game 3 breakdown', summary: 'The fourth quarter.', image_url: null,
  url: 'https://www.youtube.com/watch?v=abcdefghijk', published_at: '2026-09-30T10:00:00Z', source_name: 'Hoops Channel',
  source_logo: 'https://yt3.googleusercontent.com/a=s240-c#fill', source_colour: '#cc0000', source_url: 'https://www.youtube.com/@HoopsChannel',
  source_slug: 'hoops-channel', piece_kind: 'youtube', leagues: [] }, '../');
ok('a creator\'s channel post (0198): a video, to its story page here where it plays, the channel\'s page its brand\'s link',
   chYt.kind === 'video' && chYt.href === '../news/?i=c1' && !chYt.external && chYt.embedUrl === 'https://www.youtube.com/watch?v=abcdefghijk' &&
   chYt.platform === 'YouTube' && chYt.image === 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' && chYt.brand.href === '../news/?s=hoops-channel' &&
   chYt.brand.logo.endsWith('#fill'), chYt);
const chPod = K.fromFeed({ kind: 'channel', id: 'c2', title: 'Episode 12', url: 'https://pod.example/12', piece_kind: 'podcast', source_name: 'The Hoops Pod' }, '');
const chSky = K.fromFeed({ kind: 'channel', id: 'c3', title: 'Tip-off in ten', url: 'https://bsky.app/profile/h/post/1', piece_kind: 'bluesky', source_name: 'Hoops' }, '');
ok('...an episode a podcast, a Bluesky post a post, each on its own page here', chPod.kind === 'podcast' && chPod.platform === 'Podcast' &&
   chPod.embedUrl === null && chSky.kind === 'social' && chSky.platform === 'Bluesky' && chSky.href === 'news/?i=c3');

console.log('\nthe card');
const card = K.card(out, { now: Date.parse('2026-09-30T12:00:00Z') });
const links = card.all().filter(n => n.tagName === 'A');
const nested = links.some(a => a.all().some(n => n.tagName === 'A'));
ok('ONE link to the piece - the headline, which covers the card - and never a link inside a link',
   links.filter(a => a.classList.contains('pc-link')).length === 1 && !nested && card.find('pc-link').href === 'https://www.eurohoops.net/en/a/1', links.map(a => a.className));
ok('...opening outside in a new tab, with noopener', links.filter(a => /^https:/.test(a.href || '')).every(a => a.target === '_blank' && /noopener/.test(a.rel || '')));
ok('...the league tags and the publisher\'s page as links of their own, beside it', links.some(a => a.classList.contains('pc-tag') && a.href === '../news/?l=eurocup') &&
   links.some(a => a.classList.contains('pc-src') && a.href === '../news/?s=eurohoops'));
ok('...in the brand\'s colour, its logo said to fill its disc', card.style.getPropertyValue('--bc') === '#e30613' && card.find('pc-logo').classList.contains('fill'));
ok('...the headline, the first lines, when: as text', card.find('pc-title').textContent === 'Motiejunas joins PAOK' && card.find('pc-sum').textContent === 'A one-year deal.' &&
   /2 h ago/.test(card.find('pc-kick').textContent));
ok('...a tag for the page\'s own league is left off (it is that league\'s page)', !K.card(out, { hideTag: 'eurocup' }).find('pc-tags'));
const emb = K.card(Object.assign({}, cr, { embedUrl: cr.embedUrl || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), { embed: true });
const frame = emb.all().find(n => n.tagName === 'IFRAME');
ok('a creator\'s video played in its card on their page: a sandboxed frame of the platform\'s own player', frame && frame.src === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' &&
   /allow-scripts/.test(frame.getAttribute('sandbox')) && !/allow-top-navigation/.test(frame.getAttribute('sandbox')));
const g = K.grid([out, out, out], {});
ok('a grid leads with its first card, unless told not to', g.children[0].classList.contains('pc-lead') && !g.children[1].classList.contains('pc-lead') &&
   !K.grid([out, out], { lead: false }).children[0].classList.contains('pc-lead'));

console.log('\nthe official-partner pill (0201)');
const FRk = require(path.join(root, 'epinoia', 'feedrank.js'));
ok('a feed row keeps its id and itself, and the key the publisher / outlet is known by (the same one feedrank.js and official_partners() use)',
   out.id === 'x' && out.row && out.row.kind === 'outlet' && out.pkey === 'source:eurohoops' && cr.pkey === 'outlet:kbl/hoops-tape' && lg.pkey === null &&
   out.pkey === FRk.pkeyOf(out.row) && cr.pkey === FRk.pkeyOf(cr.row) && lg.pkey === FRk.pkeyOf(lg.row));
const partnerSet = new Set(['source:eurohoops', 'outlet:kbl/hoops-tape']);
const pcard = K.card(out, { now: Date.parse('2026-09-30T12:00:00Z'), partners: partnerSet });
const pill = pcard.find('pc-partner');
ok('a publisher\'s story from an official partner wears the pill, named "Official partner" (the words are its text; the capitals are CSS)',
   pill && pill.textContent === 'Official partner' && pcard.classList.contains('pc-partnered'), pill && pill.className);
ok('...on the plate, away from the headline, and a label only: not a link, not inside the headline\'s link, and the card still has its ONE link to the piece',
   pill.parentNode.classList.contains('pc-plate') && pill.tagName === 'SPAN' && !pcard.find('pc-link').all().includes(pill) &&
   pcard.all().filter(n => n.tagName === 'A' && n.classList.contains('pc-link')).length === 1 && !pcard.find('pc-title').all().includes(pill));
ok('...with a picture or without one (the plate is the brand\'s print then): the pill is on both',
   K.card(Object.assign({}, out, { image: 'https://e.example/p.jpg' }), { partners: partnerSet }).find('pc-partner') && K.card(Object.assign({}, out, { image: null }), { partners: partnerSet }).find('pc-partner'));
ok('a card that is not a partner\'s, and a card given no partners, has none', !K.card(Object.assign({}, out, { pkey: 'source:basketnews' }), { partners: partnerSet }).find('pc-partner') && !K.card(out, {}).find('pc-partner') && !K.card(lg, { partners: partnerSet }).find('pc-partner'));
ok('a creator\'s piece from a partner outlet wears it too (the key carries its league: the same outlet slug in another league is not the partner)',
   K.card(cr, { partners: partnerSet }).find('pc-partner') && !K.card(Object.assign({}, cr, { pkey: 'outlet:nbl/hoops-tape' }), { partners: partnerSet }).find('pc-partner'));
ok('a card with no plate (a creator\'s post played in the card) carries it in its kicker', (() => {
  const c2 = K.card(Object.assign({}, cr, { embedUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), { embed: true, partners: partnerSet });
  const p2 = c2.find('pc-partner'); return p2 && p2.parentNode.classList.contains('pc-kick'); })());
ok('an item may say it is a partner itself (item.partner)', K.card(Object.assign({}, out, { pkey: null, partner: true }), {}).find('pc-partner'));
const hero = K.hero({ name: 'Eurohoops', kicker: 'Publisher', partner: true, links: [] });
const mast = K.masthead({ brand: { name: 'Eurohoops' }, title: 'A story', partner: true });
ok('the publisher\'s page head and the story page\'s head carry it, and only when asked', hero.find('pc-partner') && mast.find('pc-partner') && mast.find('pc-mast-top').all().includes(mast.find('pc-partner')) &&
   !K.hero({ name: 'X' }).find('pc-partner') && !K.masthead({ brand: { name: 'X' }, title: 'T' }).find('pc-partner'));
ok('the row of publishers marks a partner', K.brands([{ name: 'Eurohoops', partner: true }, { name: 'Other' }]).all().filter(n => n.classList.contains('pc-partner')).length === 1);
{
  const css = read('epinoia', 'kit', 'newscard.css');
  const rule = /\.pc-partner\{([^}]*)\}/.exec(css);
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const hexOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const bg = /background:(#[0-9a-f]{6})/i.exec(rule && rule[1]), fg = /(?:^|[;\s])color:(#[0-9a-f]{6})/i.exec(rule && rule[1]);
  const ratio = bg && fg ? (Math.max(lum(hexOf(bg[1])), lum(hexOf(fg[1]))) + .05) / (Math.min(lum(hexOf(bg[1])), lum(hexOf(fg[1]))) + .05) : 0;
  ok('the pill is gold with black type in BOTH themes (fixed colours, not the page\'s ink), at 7:1 or better, in the pixel micro face at most .2em tracked',
     rule && /var\(--f-micro\)/.test(rule[1]) && ratio >= 7 && !/var\(--ink/.test(rule[1]) && !/:root\[data-theme/.test(css.slice(css.indexOf('.pc-partner'), css.indexOf('.pc-partner') + 400)) &&
     (/letter-spacing:([\d.]+)em/.exec(rule[1]) || [0, 0])[1] <= 0.2, [rule && rule[1], ratio]);
  ok('...it sits on the plate, under the headline link\'s cover (z-index below it) and takes no press', /\.pc-plate > \.pc-partner\{[^}]*z-index:3/.test(css) && /\.pc-link::after\{[^}]*z-index:4/.test(css) && /pointer-events:none/.test(rule[1]));
}

console.log('\n"Why am I seeing this?" and "opened"');
const wc = K.card(Object.assign({}, out, { why: 'Because you read a lot about NBL' }), {});
ok('a ranked card says why, on a line of its own that is no link (the ? mark, the words)', wc.find('pc-why') && wc.find('pc-why').textContent === '?Because you read a lot about NBL' &&
   wc.find('pc-why').getAttribute('aria-label') === 'Why am I seeing this? Because you read a lot about NBL' && wc.find('pc-why').title === 'Why am I seeing this?' && wc.find('pc-why').tagName === 'DIV');
ok('...an unranked card, and a card asked not to, say nothing', !K.card(out, {}).find('pc-why') && !K.card(Object.assign({}, out, { why: 'x' }), { why: false }).find('pc-why'));
{
  const seen = [];
  const oc = K.card(out, { onOpen: it => seen.push(it.id) });
  const link = oc.find('pc-link'), go = oc.find('pc-go');
  ['click', 'auxclick'].forEach(t => { link.listeners[t][0](); go.listeners[t][0](); });
  ok('pressing the headline or the way to the piece (a click, or a middle click) tells the page which item was opened', seen.length === 4 && seen.every(x => x === 'x'), seen);
  ok('...a card given no onOpen listens to nothing, and a throwing one never gets in the reader\'s way',
     !K.card(out, {}).find('pc-link').listeners.click && (() => { const bad = K.card(out, { onOpen: () => { throw new Error('x'); } }); try { bad.find('pc-link').listeners.click[0](); return true; } catch (_) { return false; } })());
}

console.log('\nthe pages');
const hostsIn = html => { const m = /frame-src ([^;"]+)/.exec(html); return m ? m[1].trim().split(/\s+/) : []; };
for (const page of [['epinoia', 'creators', 'index.html'], ['epinoia', 'creators', 'studio', 'index.html'], ['epinoia', 'news', 'index.html']]) {
  const h = hostsIn(read(...page));
  ok(page.slice(1).join('/') + ' frames exactly the platforms newscard.js builds frames for', h.length === K.EMBED_HOSTS.length && K.EMBED_HOSTS.every(x => h.includes(x)), h);
}
const newsHtml = read('epinoia', 'news', 'index.html');
ok('the News page loads the card and the bell before its own script (it frames a creator\'s post on its story page, 0198)',
   newsHtml.indexOf('newscard.js?v=') > 0 && newsHtml.indexOf('newscard.js?v=') < newsHtml.indexOf('src="news-page.js') &&
   newsHtml.indexOf('follow.js?v=') < newsHtml.indexOf('src="news-page.js'));
const newsJs = read('epinoia', 'news', 'news-page.js');
ok('the News page: "Creators" is the outlets\' pieces and the creators\' channels; a league\'s page carries both; creators get a row of their own',
   /k: 'creators', label: 'Creators',\s+kinds: \['creator', 'channel'\]/.test(newsJs) && /k: 'press',\s+label: 'Publishers',\s+kinds: \['outlet'\]/.test(newsJs) &&
   /p_kinds: \['outlet', 'creator', 'channel'\]/.test(newsJs) && /'The creators'/.test(newsJs) && /x\.kind === 'creator'/.test(newsJs));
ok('...a creator\'s post plays on its story page, and their page says they are a creator',
   /const play = maker \? K\.embedOf\(it\.url\) : null;/.test(newsJs) && /K\.embedNode\(play, it\.title\)/.test(newsJs) && /\(maker \? 'Creator' : 'Publisher'\)/.test(newsJs));
const CU = require(path.join(root, 'epinoia', 'admin', 'creators-ui.js'));
const rl = u => CU.recogniseLink(u) || {};
ok('the console knows a link before it is sent: YouTube, a podcast, Bluesky, Substack, Medium and Mastodon are creators, a site or a feed a publisher',
   rl('https://www.youtube.com/@NBA').kind === 'creator' && rl('https://podcasts.apple.com/us/podcast/x/id1384802639').platform === 'podcast' &&
   rl('https://bsky.app/profile/nba.com').platform === 'bluesky' && rl('https://hoops.substack.com').platform === 'substack' &&
   rl('https://medium.com/@coach').platform === 'medium' && rl('https://mastodon.social/@hoops').platform === 'mastodon' &&
   rl('https://www.eurohoops.net/en/feed/').platform === 'feed' && rl('https://www.eurohoops.net/').kind === 'publisher');
ok('...and says why Instagram, TikTok, X, Threads, Facebook and Spotify cannot be read, and what to do instead',
   ['https://www.instagram.com/nba/', 'https://www.tiktok.com/@nba', 'https://x.com/nba', 'https://www.threads.net/@nba', 'https://www.facebook.com/nba',
    'https://open.spotify.com/show/x'].every(u => rl(u).refused && /feed/.test(rl(u).why)) && /YouTube channel, podcast/.test(rl('https://www.instagram.com/nba/').why) &&
   rl('youtube.com/@x').error && CU.recogniseLink('') === null);
const home = read('epinoia', 'home', 'index.html');
ok('HOME: the FEED under MY FOLLOWED, its switch in its heading, its script after the card\'s',
   home.indexOf('id="feed"') > home.indexOf('id="followed"') && home.indexOf('id="feed"') < home.indexOf('id="stars"') &&
   /data-feed="followed"/.test(home) && /data-feed="newest"/.test(home) && home.indexOf('newscard.js?v=') < home.indexOf('feed-home.js?v='));
ok('...mounted by front.js as the feed section', /feed: 'homeFeed'/.test(read('epinoia', 'home', 'front.js')) && /H\.register\('feed'/.test(read('epinoia', 'home', 'feed-home.js')));
ok('HOME: For you first (the new default), then Followed and Newest, and feedrank.js before the feed\'s script',
   home.indexOf('data-feed="foryou"') > 0 && home.indexOf('data-feed="foryou"') < home.indexOf('data-feed="followed"') && home.indexOf('feedrank.js?v=') > home.indexOf('newscard.js?v=') && home.indexOf('feedrank.js?v=') < home.indexOf('feed-home.js?v='));
const npage = read('epinoia', 'news', 'news-page.js'), hfeed = read('epinoia', 'home', 'feed-home.js');
ok('DEFAULT IS FOR YOU on both: the News page and HOME open on For you when nothing was chosen, and the remembered choice lives under NEW keys so an old remembered Newest cannot stick',
   /\|\| 'you'/.test(npage) && /const ORDER_KEY = 'epinoia\.news\.order2'/.test(npage) && /let mode = stored\(\) \|\| 'foryou'/.test(hfeed) && /const KEY = 'epinoia\.home\.feed2'/.test(hfeed) &&
   !/'epinoia\.news\.order'/.test(npage) && !/'epinoia\.home\.feed'/.test(hfeed));
ok('an explicit choice is still remembered (the buttons write the key), in a try/catch', /localStorage\.setItem\(ORDER_KEY/.test(npage) && /localStorage\.setItem\(KEY/.test(hfeed));
{
  /* the language chip: only on a story in a language other than the site's */
  const FRm = require(path.join(root, 'epinoia', 'feedrank.js'));
  global.window = { EpinoiaFeedRank: FRm }; globalThis.EpinoiaI18n = { lang: 'en' };
  const es = K.fromFeed({ kind: 'outlet', id: 'x1', title: 'Hola', url: 'https://www.gigantes.com/a', source_slug: 'gigantes', source_name: 'Gigantes', leagues: [] }, '../');
  const en = K.fromFeed({ kind: 'outlet', id: 'x2', title: 'Hi', url: 'https://www.eurohoops.net/a', source_slug: 'eurohoops', source_name: 'Eurohoops', leagues: [] }, '../');
  const lg = K.fromFeed({ kind: 'league', id: 'x3', title: 'L', league_slug: 'nbl', league_name: 'NBL', slug: 'a', leagues: [] }, '../');
  ok('a Spanish story for an English site carries lang es; an English one and a league\'s own article carry none', es.lang === 'es' && !en.lang && !lg.lang, [es.lang, en.lang, lg.lang]);
  globalThis.EpinoiaI18n.lang = 'es';
  const es2 = K.fromFeed({ kind: 'outlet', id: 'x1', title: 'Hola', url: 'https://www.gigantes.com/a', source_slug: 'gigantes', leagues: [] }, '../');
  ok('...and on the Spanish site the Spanish story is the reader\'s own: no tag', !es2.lang);
  delete global.window; delete globalThis.EpinoiaI18n;
}
ok('the News page and the creators\' pages load feedrank.js BEFORE their own script (they read it at the top), interest.js after it',
   [['news', 'news-page.js'], ['creators', 'creators-page.js']].every(([d, js]) => { const h = read('epinoia', d, 'index.html'); return h.indexOf('feedrank.js?v=') > h.indexOf('newscard.js?v=') && h.indexOf('feedrank.js?v=') < h.indexOf('src="' + js) && h.indexOf('interest.js?v=') > h.indexOf('feedrank.js?v='); }));
ok('every league page that counts dwell loads feedrank.js then interest.js, deferred and version-stamped like its neighbours; HOME does not (the platform is nobody\'s league)',
   ['index.html', 'l/index.html', 't/index.html', 'p/index.html', 'game/index.html', 'stats/index.html', 'stats/wowy/index.html', 'fixtures/index.html', 'news/index.html', 'creators/index.html'].every(f => {
     const h = read('epinoia', ...f.split('/')); const i = h.indexOf('interest.js?v='); return i > 0 && /<script src="[.\/]*interest\.js\?v=\d+" defer><\/script>/.test(h) && h.indexOf('feedrank.js?v=') > 0 && h.indexOf('feedrank.js?v=') < i && i < h.indexOf('nav.js?v='); }) &&
   !/interest\.js/.test(home) && !/interest\.js/.test(read('epinoia', 'games', 'index.html')));
ok('interest.js is small and sends nothing: no fetch, no XHR, no beacon, no eval', (() => { const j = read('epinoia', 'interest.js'); return j.split('\n').length < 30 && !/fetch\(|XMLHttpRequest|sendBeacon|eval\(|new Function|document\.cookie/.test(j.replace(/\/\*[\s\S]*?\*\//g, '')); })());
ok('feedrank.js reaches out only for the public lists: partners, the leagues\' countries, a report\'s points, the publishers\' languages (and never with a token)', (() => {
  const j = read('epinoia', 'feedrank.js').replace(/\/\*[\s\S]*?\*\//g, ''); const paths = [...j.matchAll(/call\('(?:rpc|get)', '([^']+)'/g)].map(m => m[1]);
  return paths.sort().join() === ['leagues?select=id,slug,country&order=slug', 'rpc/news_report_significance', 'rpc/news_source_languages', 'rpc/official_partners'].sort().join() && !/Authorization|authHeaders|sendBeacon|document\.cookie/.test(j); })());
const splash = read('epinoia', 'index.html');
ok('a league\'s front page carries its creators under its news, hidden until there are some',
   /id="creatorsSec"/.test(splash) && /class="sec hide" id="creatorsSec"/.test(splash) && splash.indexOf('id="creatorsSec"') > splash.indexOf('id="newsSec"') &&
   /creators\(\)\.catch/.test(read('epinoia', 'home.js')));
const nav = read('epinoia', 'nav.js');
ok('the rail: News on the platform panel, the league\'s creators probed, the studio in the hub',
   /platformRow\('❑', 'news', 'news\/'/.test(nav) && /key: 'creators', probe: 'creators'/.test(nav) && /rpc\/creators_probe\?p_slug=/.test(nav) && /my_creator_outlets/.test(nav));
const follow = read('epinoia', 'follow.js');
ok('follow.js knows publishers and creators', /source: 'fav_source_ids', outlet: 'fav_outlet_ids'/.test(follow));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
