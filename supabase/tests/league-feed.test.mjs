// A LEAGUE'S FRONT-PAGE NEWS IS HOME'S FEED (epinoia/feedview.js), and both are ranked by one engine (epinoia/feedrank.js):
//   * the three groups by default: an official partner's piece, then the press (publishers, creators, the league's own
//     articles), then the automatic match reports
//   * learning from clicks: a reader who opens match reports sees them climb; the clicks decay; the weight is bounded
//     (a fresh partner piece stays first) and floored (no group vanishes: the exploration floor)
//   * a slow pool (a league's months of news) is fresh against itself
//   * the league page and HOME mount the same module, read once per page view, and work with storage blocked
//
//   node supabase/tests/league-feed.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 500))); } };

/* ------------------------------------------------------------ a fake page --- */
class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = '';
    this.className = ''; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.hidden = false;
    const props = {};
    this.style = { setProperty: (k, v) => { props[k] = v; }, getPropertyValue: k => props[k] };
  }
  get classList() {
    const self = this, list = () => self.className.split(/\s+/).filter(Boolean);
    return { contains: c => list().includes(c), add: c => { if (!list().includes(c)) self.className = list().concat(c).join(' '); },
             remove: c => { self.className = list().filter(x => x !== c).join(' '); },
             toggle: (c, on) => { const has = list().includes(c); const want = on === undefined ? !has : !!on; if (want && !has) self.className = list().concat(c).join(' '); if (!want && has) self.className = list().filter(x => x !== c).join(' '); return want; } };
  }
  appendChild(n) { if (n.parentNode && n.parentNode.children) n.parentNode.children = n.parentNode.children.filter(c => c !== n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  after(n) { const p = this.parentNode; if (!p) return; n.parentNode = p; p.children.splice(p.children.indexOf(this) + 1, 0, n); }
  insertBefore(n, ref) { n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
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
  findAll(cls) { return this.all().filter(n => n.classList.contains(cls)); }
  querySelectorAll(sel) { return sel === 'button[data-feed]' ? this.all().filter(n => n.tagName === 'BUTTON' && n.dataset.feed) : []; }
}
globalThis.document = { createElement: t => new El(t), createTextNode: t => new Text(t) };
/* STORAGE BLOCKED: even reading window.localStorage throws, as a browser does with site data refused */
const denied = () => { throw new Error('SecurityError: access denied'); };
Object.defineProperty(globalThis, 'localStorage', { get: denied, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { get: denied, configurable: true });
globalThis.location = { pathname: '/epinoia/', search: '?l=slb-men', hostname: 'localhost' };
globalThis.addEventListener = () => {};
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://db.example', supabaseAnonKey: 'anon' };

const FR = require(path.join(root, 'epinoia', 'feedrank.js'));
globalThis.EpinoiaFeedRank = FR;
globalThis.EpinoiaNewsCard = require(path.join(root, 'epinoia', 'newscard.js'));
const V = require(path.join(root, 'epinoia', 'feedview.js'));
const { W, HOUR, DAY } = FR;

const NOW = Date.parse('2026-10-02T12:00:00Z');
const ago = h => new Date(NOW - h * HOUR).toISOString();
let seq = 0;
const story = (o = {}) => Object.assign({ kind: 'outlet', id: 's' + (++seq), title: 'Story ' + seq, published_at: ago(o.h || 1), source_name: 'BasketNews', source_slug: 'basketnews',
  league_slug: 'slb-men', league_name: 'SLB', leagues: [{ slug: 'slb-men', name: 'SLB' }], author: 'A. Writer', slug: null }, o);
const channel = (o = {}) => Object.assign(story(o), { kind: 'channel', source_name: 'Court Vision', source_slug: 'court-vision' }, o);
const report = (o = {}) => Object.assign({ kind: 'league', id: 'r' + (++seq), title: 'Report ' + seq, published_at: ago(o.h || 1), source_name: 'SLB', league_slug: 'slb-men', league_name: 'SLB',
  leagues: [], slug: 'report-' + String(seq).padStart(8, '0'), author: 'Epinoia match report' }, o);
const partners = new Set(['source:court-vision']);
const R = (rows, prof, now = NOW) => FR.rank(rows, Object.assign({ partners }, prof), now);
const ids = rows => rows.map(r => r.id);
/* a reader who opened n match reports (and nothing else), `daysAgo` days ago */
function opener(n, daysAgo = 0) {
  const st = FR.emptyState();
  for (let i = 0; i < n; i++) FR.noteOpen(st, report({ h: 100 + i }), NOW - daysAgo * DAY);
  return st;
}

console.log('\nthe three groups, by default');
{
  const p = channel({ h: 5 }), pub = story({ h: 5, source_slug: 'eurohoops', source_name: 'Eurohoops' }), rp = report({ h: 5 });
  ok('a row is a partner\'s, the press\'s or automatic', FR.groupOf(p, partners) === 'partner' && FR.groupOf(pub, partners) === 'press' && FR.groupOf(rp, partners) === 'auto' &&
     FR.groupOf(Object.assign({}, pub, { partner: true })) === 'partner' && FR.groupOf({ kind: 'league', slug: 'a-written-piece', author: 'Press office' }) === 'press');
  ok('equal age, no history: partner, then publisher, then match report', ids(R([rp, pub, p], FR.emptyState())).join() === [p.id, pub.id, rp.id].join(), R([rp, pub, p], FR.emptyState()).map(r => r.group));
  const fresh = report({ h: 0.2 });
  ok('a partner piece six days old still leads a fresh story and a fresh report', R([fresh, story({ h: 0.2, source_slug: 'x' }), channel({ h: 144 })], FR.emptyState())[0].source_slug === 'court-vision');
  ok('the rows say their group', R([rp, pub, p], FR.emptyState()).every(r => ['partner', 'press', 'auto'].includes(r.group)));
}

console.log('\nlearning from clicks: a reader who opens match reports');
{
  const st0 = FR.emptyState();
  const w0 = FR.groupWeights(st0, NOW);
  ok('no clicks: every group weighs 1', w0.partner === 1 && w0.press === 1 && w0.auto === 1);
  const one = FR.groupWeights(opener(1), NOW);
  ok('one click moves little (three virtual clicks each): reports 1.125, the rest 0.9375', Math.abs(one.auto - 1.125) < 1e-9 && Math.abs(one.press - 0.9375) < 1e-9, one);
  const ten = FR.groupWeights(opener(10), NOW);
  ok('ten: reports climb (1.66) and the press sinks (0.67)', ten.auto > 1.6 && ten.auto < 1.7 && ten.press > 0.6 && ten.press < 0.7, ten);
  const lots = FR.groupWeights(opener(500), NOW);
  ok('bounded: never above KIND_MAX, never below KIND_FLOOR (the exploration floor)', lots.auto === W.KIND_MAX && lots.press === W.KIND_FLOOR && lots.partner === W.KIND_FLOOR, lots);
  ok('a click is recorded for its group on the first open only', (() => { const st = FR.emptyState(); const r = report({ h: 1 }); FR.noteOpen(st, r, NOW); FR.noteOpen(st, r, NOW); return st.k.auto[0] === W.KIND_OPEN_PTS && !st.k.press; })());
  ok('a partner\'s piece marked by the ranking counts as a partner click', (() => { const st = FR.emptyState(); FR.noteOpen(st, Object.assign(channel({ h: 1 }), { partner: true }), NOW); return st.k.partner && !st.k.press; })());

  const rp = report({ h: 2 }), pub = story({ h: 8, source_slug: 'eurohoops', source_name: 'Eurohoops' });
  ok('with no history a fresh report sits under a publisher\'s story six hours older', ids(R([rp, pub], FR.emptyState()))[0] === pub.id);
  const reader = opener(10);
  const out = R([rp, pub], reader);
  ok('...after ten reports opened, the report passes it, and says why', out[0].id === rp.id && out[0].why === 'Because you open match reports', out.map(r => [r.id, r.why]));
  const same = report({ h: 3 }), pub3 = story({ h: 3, source_slug: 'eurohoops', source_name: 'Eurohoops' });
  ok('...but not a publisher\'s story of its own age: the tiers usually hold', ids(R([same, pub3], reader))[0] === pub3.id);
  ok('the clicks decay (half every 14 days): eight weeks on, the same reader is nearly even again', (() => {
    const later = FR.groupWeights(opener(10, 56), NOW); return later.auto < 1.1 && later.auto > 1 && ids(R([rp, pub], opener(10, 56)))[0] === pub.id; })());
  ok('...and the stored clicks are pruned once they are nothing', (() => { const st = opener(3, 400); FR.prune(st, NOW); return !st.k.auto; })());
  ok('the profile keeps the clicks through a save and a load (sane)', (() => { const st = opener(4); const back = FR.sane(JSON.parse(JSON.stringify(st))); return back.k.auto && back.k.auto[0] === st.k.auto[0]; })());
}

console.log('\nbounded: a fresh partner piece stays first');
{
  ok('the partner boost is above the most any other story can score', W.PARTNER_BOOST > FR.scoreMax());
  const st = opener(500);
  st.l['slb-men'] = [1e6, NOW];
  const prof = Object.assign(st, { country: 'GB', leagueCountry: { 'slb-men': 'GB' }, followedLeagues: ['slb-men'],
    sig: {} });
  const cup = report({ h: 0.1 });
  prof.sig[cup.id] = { points: 999, reasons: ['Cup final'] };
  const p = channel({ h: 30 });
  ok('a reader who only ever opens reports, a cup final minutes old: the partner piece of yesterday is still first', R([cup, p], prof)[0].id === p.id, R([cup, p], prof).map(r => [r.id, r.score]));
  ok('...until it is read, or more than a week (fading to nine days) old', R([cup, channel({ h: 24 * 10 })], prof)[0].id === cup.id);
}

console.log('\nthe exploration floor: no group vanishes');
{
  const press = []; for (let i = 0; i < 12; i++) press.push(story({ h: 1 + i * 0.2, source_slug: 'p' + (i % 4), source_name: 'P' + (i % 4) }));
  const old = report({ h: 30 });
  const out = R(press.concat(old), FR.emptyState());
  ok('a report under twelve fresher stories still has a card in the first six (the last of them), marked explore', ids(out).indexOf(old.id) === W.EXPLORE_N - 1 && out[W.EXPLORE_N - 1].explore === true);
  const reps = []; for (let i = 0; i < 12; i++) reps.push(report({ h: 1 + i * 0.2 }));
  const pub = story({ h: 40 });
  const out2 = R(reps.concat(pub), opener(500));
  ok('...and a story keeps one for the reader who only opens reports', ids(out2).slice(0, W.EXPLORE_N).includes(pub.id));
  ok('a pool smaller than six is left as ranked', R([story({ h: 1 }), report({ h: 2 })], FR.emptyState()).length === 2);
}

console.log('\na slow pool: a league\'s months of news');
{
  const rp = report({ h: 24 * 5 }), stale = story({ h: 24 * 100, source_slug: 'slb-show', source_name: 'SLB Show' });
  const pool = [rp, stale]; for (let i = 0; i < 6; i++) pool.push(story({ h: 24 * (20 + i * 10), source_slug: 'q' + i, source_name: 'Q' + i }));
  const out = R(pool, FR.emptyState());
  ok('a report of five days ago is above a publisher\'s story of a hundred days ago', ids(out).indexOf(rp.id) < ids(out).indexOf(stale.id), out.map(r => [r.id, r.score]));
  const a = story({ h: 2, source_slug: 'a' }), b = story({ h: 1, source_slug: 'b' });
  ok('a pool of hours is ranked as before (the half-life stays 18 h)', ids(R([a, b], FR.emptyState())).join() === [b.id, a.id].join() &&
     Math.abs(FR.scoreOf(a, { partners }, NOW).rec - FR.recency(2 * HOUR)) < 1e-12);
}

console.log('\nthe league page and HOME are one module');
{
  const home = read('epinoia', 'home.js'), fh = read('epinoia', 'home', 'feed-home.js'), fv = read('epinoia', 'feedview.js');
  const news = home.slice(home.indexOf('async function news()'), home.indexOf('async function creators()'));
  ok('the league\'s news() mounts EpinoiaFeedView with the league, its own rpc, and the section shown only with something in it',
     /window\.EpinoiaFeedView/.test(news) && /V\.mount\(\{/.test(news) && /league: \{ id: LEAGUE\.id, slug: LEAGUE\.slug/.test(news) && /\brpc\b/.test(news) && /reveal: shown =>/.test(news));
  ok('HOME\'s feed mounts the same EpinoiaFeedView', /window\.EpinoiaFeedView/.test(fh) && /V\.mount\(\{/.test(fh) && !/rankRows|K\.grid/.test(fh));
  ok('the ranking and the cards live in feedview.js once (rankRows, K.grid), not in either page', /FR\.rankRows\(/.test(fv) && /K\.grid\(/.test(fv) && !/rankRows/.test(news) && !/mountHeadlines/.test(home));
  const splash = read('epinoia', 'index.html'), hhome = read('epinoia', 'home', 'index.html');
  const sec = splash.slice(splash.indexOf('id="newsSec"') - 40, splash.indexOf('<!-- the league\'s creators'));
  ok('the league page\'s section is HOME\'s: the switch in the heading (For you, Newest, no Followed), all news, the mount',
     /class="sec hide fv" id="newsSec"/.test(sec) && /class="hm-seg" id="newsSeg"/.test(sec) && /data-feed="foryou" aria-pressed="true"/.test(sec) && /data-feed="newest"/.test(sec) &&
     !/data-feed="followed"/.test(sec) && /id="newsAll"/.test(sec) && /class="hm-mount fv-mount" id="news"/.test(sec));
  ok('HOME\'s section wears the same classes', /class="sec fv" id="feed"/.test(hhome) && /class="hm-mount fv-mount" id="homeFeed"/.test(hhome) && /id="feedSeg"/.test(hhome));
  const note = (sec.match(/<p class="note">([^<]*)<\/p>/) || [])[1] || '';
  ok('a subtitle under the title, sentence case, no full stop, 70 characters or fewer', note.length > 0 && note.length <= 70 && !/\.$/.test(note) && /^[A-Z]/.test(note), note);
  ok('both load feedview.js after feedrank.js, and the league page before home.js (whose news() reads it)',
     splash.indexOf('feedrank.js?v=') < splash.indexOf('feedview.js?v=') && splash.indexOf('feedview.js?v=') < splash.indexOf('src="home.js?v=') &&
     hhome.indexOf('feedrank.js?v=') < hhome.indexOf('feedview.js?v=') && hhome.indexOf('feedview.js?v=') < hhome.indexOf('feed-home.js?v='));
  ok('both load kit/feedview.css after newscard.css and before teletext.css and legibility.css; the league page no longer loads news.js',
     [splash, hhome].every(h => h.indexOf('feedview.css?v=') > h.indexOf('newscard.css?v=') && h.indexOf('feedview.css?v=') < h.indexOf('legibility.css?v=') && h.indexOf('feedview.css?v=') < h.indexOf('teletext.css?v=')) &&
     !/src="news\.js/.test(splash));
  const css = read('epinoia', 'kit', 'feedview.css').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the switch is styled once for both, and the feed\'s own choice (aria-pressed) is filled', /:is\(\.hm, \.fv\) \.sec-h \.hm-seg\{/.test(css) && /button\[aria-pressed="true"\]/.test(css) &&
     !/\.hm \.sec-h \.hm-seg\{/.test(read('epinoia', 'kit', 'home.css')));
  ok('pixel-face letter-spacing stays at or under .2em', [...css.matchAll(/letter-spacing:\s*([\d.]+)em/g)].every(m => parseFloat(m[1]) <= 0.2));
  ok('no inline script on either page added for it', !/<script>(?![\s\S]*?application\/ld\+json)/.test(sec));
}

/* ------------------------------------------------------------ the module on a page --- */
const calls = [];
const rows = [];
for (let i = 0; i < 8; i++) rows.push(story({ h: 3 + i, source_slug: 'p' + (i % 3), source_name: 'P' + (i % 3) }));
for (let i = 0; i < 5; i++) rows.push(report({ h: 2 + i }));
rows.push(channel({ h: 20 }));
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), body: init && init.body });
  const ok200 = j => ({ ok: true, status: 200, json: async () => j });
  if (/official_partners/.test(url)) return ok200([{ kind: 'source', slug: 'court-vision' }]);
  if (/news_feed/.test(url)) return ok200(rows);
  return { ok: false, status: 404, json: async () => ({}) };
};
function page() {
  const sec = new El('section'); sec.className = 'sec hide fv';
  const head = new El('div'); const seg = new El('div');
  ['foryou', 'followed', 'newest'].forEach(m => { const b = new El('button'); b.dataset.feed = m; seg.appendChild(b); });
  head.appendChild(seg);
  const all = new El('a'); head.appendChild(all);
  const host = new El('div');
  sec.append(head, host);
  return { sec, seg, all, host };
}
console.log('\non a league page, with storage blocked');
{
  const pg = page();
  const rpcCalls = [];
  const rpc = async (fn, args) => { rpcCalls.push([fn, args]); return rows; };
  let shown = null;
  const done = await V.mount({ sec: pg.sec, seg: pg.seg, all: pg.all, host: pg.host, base: '', rpc,
    league: { id: 'L1', slug: 'slb-men', name: 'SLB', country: 'GB' }, key: 'epinoia.league.feed', reveal: s => { shown = s; } });
  const cards = pg.host.findAll('pc');
  ok('it renders with storage blocked: six cards, the section shown', done === true && shown === true && cards.length === 6, [done, shown, cards.length]);
  const nf = rpcCalls.filter(c => c[0] === 'news_feed'), np = rpcCalls.filter(c => c[0] === 'news_feed_partners');
  ok('one read of the league\'s news (news_feed with p_league, 60), through the page\'s own rpc', nf.length === 1 && nf[0][1].p_league === 'L1' && nf[0][1].p_limit === 60, rpcCalls);
  ok('...and one of its official partners\' stories of the boost\'s window (news_feed_partners, 0236)',
     np.length === 1 && np[0][1].p_league === 'L1' && np[0][1].p_days === 9 && rpcCalls.length === 2, rpcCalls);
  ok('...and the ranking asks the server for nothing but the partners (cached on the page anyway): no languages, no countries, no significance',
     calls.length > 0 && calls.every(c => /official_partners/.test(c.url)), calls.map(c => c.url));
  ok('the partner piece leads, and wears the pill', cards[0].classList.contains('pc-partnered'));
  ok('a match report is in the first six (the floor), and the press between', cards.some(c => c.classList.contains('pc-league')) && cards.slice(1, 5).every(c => c.classList.contains('pc-story')));
  ok('Followed is not offered on a league\'s page; For you is pressed; all news is the league\'s', pg.seg.children.length === 2 && !pg.seg.children.some(b => b.dataset.feed === 'followed') &&
     pg.seg.children.find(b => b.dataset.feed === 'foryou').getAttribute('aria-pressed') === 'true' && pg.all.href === 'news/?l=slb-men');
  ok('Personalise sits beside the switch, its panel above the cards', pg.seg.nextSibling && pg.seg.nextSibling.classList.contains('pc-pers-btn') && pg.host.children[0].classList.contains('pc-pers'));
  const before = rpcCalls.length;
  pg.seg.children.find(b => b.dataset.feed === 'newest').listeners.click[0]();
  await new Promise(r => setTimeout(r, 20));
  ok('Newest is drawn from the same read: no new request', rpcCalls.length === before && pg.host.findAll('pc').length === 6);
  /* a card pressed: the click is learned (in memory, storage being blocked) and nothing throws */
  const link = pg.host.find('pc-league') && pg.host.find('pc-league').find('pc-link');
  let threw = false;
  try { (link.listeners.click || []).forEach(f => f()); } catch (_) { threw = true; }
  ok('a report pressed is learned in memory and nothing throws', !threw && FR.store().profile().k && FR.store().profile().k.auto && FR.store().usingStorage === false);
  const empty = page();
  const res = await V.mount({ sec: empty.sec, seg: empty.seg, all: empty.all, host: empty.host, rpc: async () => [], league: { id: 'L2', slug: 'quiet' }, reveal: s => { shown = s; } });
  ok('a league with nothing published: no section', res === false && shown === false);
}

/* NEWS, NOT VIDEOS (2026-10-07; 0251 in the reads): the feed leaves a YouTube video to the video section */
{
  const rows = [{ id: 'a', url: 'https://example.com/story' }, { id: 'b', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
                { id: 'c', url: 'https://youtu.be/abcdefghijk' }, { id: 'd', url: 'https://x.example/p', piece_kind: 'youtube' },
                { id: 'e', url: 'https://x.example/v', video_id: 'abcdefghijk' }, { id: 'f', url: 'https://notyoutube.com/x', piece_kind: 'podcast' }];
  const kept = V.newsOnly(rows).map(r => r.id).join();
  if (kept === 'a,f') { pass++; console.log('  PASS  the feed is news: a YouTube video (by its address, its platform or its video id) is left to the video section'); }
  else { fail++; console.log('  FAIL  the feed is news  -- saw ' + kept); }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
