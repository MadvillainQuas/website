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

console.log('\nthe pages');
const hostsIn = html => { const m = /frame-src ([^;"]+)/.exec(html); return m ? m[1].trim().split(/\s+/) : []; };
for (const page of [['epinoia', 'creators', 'index.html'], ['epinoia', 'creators', 'studio', 'index.html']]) {
  const h = hostsIn(read(...page));
  ok(page.slice(1).join('/') + ' frames exactly the platforms newscard.js builds frames for', h.length === K.EMBED_HOSTS.length && K.EMBED_HOSTS.every(x => h.includes(x)), h);
}
const newsHtml = read('epinoia', 'news', 'index.html');
ok('the News page loads the card and the bell before its own script, and frames nothing',
   newsHtml.indexOf('newscard.js?v=') > 0 && newsHtml.indexOf('newscard.js?v=') < newsHtml.indexOf('src="news-page.js') &&
   newsHtml.indexOf('follow.js?v=') < newsHtml.indexOf('src="news-page.js') && !/frame-src/.test(newsHtml));
const home = read('epinoia', 'home', 'index.html');
ok('HOME: the FEED under MY FOLLOWED, its switch in its heading, its script after the card\'s',
   home.indexOf('id="feed"') > home.indexOf('id="followed"') && home.indexOf('id="feed"') < home.indexOf('id="stars"') &&
   /data-feed="followed"/.test(home) && /data-feed="newest"/.test(home) && home.indexOf('newscard.js?v=') < home.indexOf('feed-home.js?v='));
ok('...mounted by front.js as the feed section', /feed: 'homeFeed'/.test(read('epinoia', 'home', 'front.js')) && /H\.register\('feed'/.test(read('epinoia', 'home', 'feed-home.js')));
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
