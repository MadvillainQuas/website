// 0207: A LEAGUE'S CONTENT CREATORS. The platform assigns a creator to the leagues it covers (the console's "covers" row,
// epinoia/admin/creators-ui.js), and a league's Community page (epinoia/community/) shows the newest from its creators
// under Content creators, with its Discord servers under Forum. What is held here:
//   * with no database: the page's two sections on the page standard; the page run on a stand-in document against a
//     stand-in server - the Forum (an old #talk link landing on it), Content creators (nine cards, "Show more" while
//     there are more, the league's own tag left off, the official partners' keys, nothing played on the page, the
//     part away before 0207 and while there is nothing); the console's covers row (a chip per league, the leagues left
//     to add, the whole list sent, a refusal said in the database's words, on every one of the platform's own sources -
//     a publisher's too since 0209, which puts its stories on the league's news page: league-picks.test.mjs); a creator's
//     channel wearing its partner pill (newscard.js and feedrank.js, one rule); the words in Spanish and Japanese;
//   * on a real Postgres (PGlite; skipped with a note when it is not installed): set_news_source_leagues for a platform
//     administrator only and on a source for every reader only, the leagues once each in the order given, audit-logged;
//     news_sources_admin with them; league_creator_feed - an assigned creator's posts, the league's own creators', its
//     outlets' pieces where it shows creators, and never a publisher, a source that is off, a hidden piece, a suspended
//     outlet or a league the reader may not see; newest first, a page at a time; news_feed's own rows unchanged; who
//     may call what; and 0207 run again changing nothing.
//
//   node supabase/tests/league-creators.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const EP = path.join(here, '..', '..', 'epinoia');
const src = f => readFileSync(path.join(EP, f), 'utf8');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); };

/* a stand-in document: enough of it for the Community page and the console */
class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = ''; this.className = '';
    this.attrs = {}; this.listeners = {}; this.checked = false; this.disabled = false; this.hidden = false; this.value = ''; this.id = '';
    this.style = { cssText: '', props: {}, setProperty(k, v) { this.props[k] = v; } };
    const me = this;
    this.classList = {
      has: c => me.className.split(/\s+/).includes(c),
      add: (...cs) => { cs.forEach(c => { if (!me.classList.has(c)) me.className = (me.className + ' ' + c).trim(); }); },
      remove: (...cs) => { me.className = me.className.split(/\s+/).filter(x => x && !cs.includes(x)).join(' '); },
      contains: c => me.classList.has(c),
      toggle: (c, on) => { const want = on === undefined ? !me.classList.has(c) : !!on; if (want) me.classList.add(c); else me.classList.remove(c); return want; }
    };
  }
  get childNodes() { return this.children; }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; } }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.children = p.children.map(c => (c === this ? n : c)); n.parentNode = p; this.parentNode = null; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  scrollIntoView() { this.scrolled = (this.scrolled || 0) + 1; }
  all() { const out = []; const walk = n => (n.children || []).forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
  querySelectorAll(sel) { const tags = String(sel).split(',').map(s => s.trim().toUpperCase()); return this.all().filter(n => tags.includes(n.tagName)); }
}

/* ======================================================================= the page, as written ====== */
console.log('the Community page');
const html = src('community/index.html'), page = src('community/community-page.js');
{
  const sec = id => { const m = new RegExp('<section class="sec hide" id="' + id + '"[^>]*>([\\s\\S]*?)</section>').exec(html); return m ? m[1] : ''; };
  ok('the Discord servers are under FORUM: section#forum, its title "Forum" and its subtitle, the servers\' box inside',
     /<h2 id="forumH">Forum<\/h2>/.test(sec('forum')) && /class="note" id="forumSub"/.test(sec('forum')) && /id="cmServers"/.test(sec('forum')));
  ok('...and nothing is called Talk any more', !/id="talk"|>Talk</.test(html) && !/'#talk'/.test(page));
  ok('CONTENT CREATORS is a section of the standard: its title, a short subtitle with no full stop, its box, away until it has something',
     /<h2 id="creatorsH">Content creators<\/h2>/.test(sec('creators')) && /class="note" id="creatorsSub">[^<]{10,70}[^.]<\/p>/.test(sec('creators')) && /id="cmCreators"/.test(sec('creators')));
  ok('...after the forum and before the stands', html.indexOf('id="forum"') < html.indexOf('id="creators"') && html.indexOf('id="creators"') < html.indexOf('id="stands"'));
  ok('the head and the page\'s description name both', /its forum, the creators who cover it/.test(html) && /its forum on Discord, its content creators/.test(html));
  ok('nothing new is framed or fetched: the same frame-src and connect-src as before',
     /frame-src https:\/\/www\.google\.com https:\/\/discord\.com">/.test(html) && /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co https:\/\/discord\.com;/.test(html));
  ok('the cards are never played on the page (no embed), and nothing goes in as HTML', !/embed\s*:/.test(page) && !/innerHTML/.test(page));
}

/* the page on a stand-in document, against a stand-in server */
const L = { id: 'L1', slug: 'kbl', name: 'KBL', colour_a: '#123456' };
const at = n => new Date(Date.UTC(2026, 8, 30, 12) - n * 3600e3).toISOString();
const feedRows = n => Array.from({ length: n }, (_, i) => ({ kind: i % 3 ? 'channel' : 'creator', id: 'r' + i, title: 'Post ' + i, published_at: at(i),
  source_slug: 'pod-' + (i % 2), outlet_slug: i % 3 ? null : 'hoops-pod', league_slug: 'kbl' }));
async function community(o) {
  const els = new Map();
  const doc = {
    createElement: t => new El(t),
    querySelector: sel => {
      if (!/^#[A-Za-z]+$/.test(sel)) return null;
      const id = sel.slice(1);
      if (!els.has(id)) { const e = new El(['find', 'forum', 'creators', 'stands', 'travelled'].includes(id) ? 'section' : 'div'); e.id = id; els.set(id, e); }
      return els.get(id);
    },
    getElementById: id => doc.querySelector('#' + id),
    documentElement: { getAttribute: () => 'dark' },
    title: ''
  };
  ['find', 'forum', 'creators', 'stands', 'travelled'].forEach(id => { doc.querySelector('#' + id).className = 'sec hide'; });
  const calls = [];
  const json = v => ({ ok: true, status: 200, json: async () => v });
  const no = { ok: false, status: 404, json: async () => ({}) };
  const fetchFn = async (url, init) => {
    const u = String(url), body = init && init.body ? JSON.parse(init.body) : null;
    calls.push([u, body, init]);
    if (u.startsWith('https://discord.com/api/')) return json({ approximate_member_count: 1200, approximate_presence_count: 80 });
    if (u.includes('/rest/v1/leagues?')) return json([L]);
    const fn = (/\/rpc\/([a-z_]+)$/.exec(u) || [])[1];
    if (fn === 'league_creator_feed') {
      if (o.rows === 'absent') return no;
      const before = body.p_before ? Date.parse(body.p_before) : Infinity;
      return json(o.rows.filter(r => Date.parse(r.published_at) < before).slice(0, body.p_limit));
    }
    if (fn === 'official_partners') return json(o.partners || []);
    if (fn === 'league_discord_public') return json({ servers: o.servers || [] });
    if (fn === 'go_feed' || fn === 'go_leaderboard') return json([]);
    return no;
  };
  const K = {
    tint: () => '#000000', initials: s => String(s).slice(0, 2),
    fromFeed: (r, base, media, crest) => ({ id: r.id, kind: r.kind, base, media: media('a/b c.png'), crest: crest('x.png') }),
    grid: (items, opts) => { const g = new El('div'); g.className = 'pc-grid'; g.opts = opts; items.forEach(it => { const c = new El('article'); c.item = it; c.opts = opts; g.appendChild(c); }); return g; },
    card: (it, opts) => { const c = new El('article'); c.item = it; c.opts = opts; return c; }
  };
  const box = { document: doc, location: { search: '?l=kbl', hash: o.hash || '', pathname: '/community/' }, history: { replaceState: (a, b, u) => { box.replaced = u; } },
    fetch: fetchFn, URLSearchParams, console, setTimeout, clearTimeout, matchMedia: () => ({ matches: false }),
    EPINOIA_CONFIG: { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' }, EpinoiaNewsCard: K,
    epinoiaLogoUrl: (p, n) => 'https://logo.example/' + p + '?w=' + n };
  box.window = box;
  vm.runInNewContext(page, box);
  await settle();
  const sec = id => els.get(id);
  const shown = id => !!sec(id) && !sec(id).classList.has('hide');
  const grid = () => (sec('cmCreators') ? sec('cmCreators').all().find(n => n.className === 'pc-grid') : undefined);
  const more = () => (sec('cmCreators') ? sec('cmCreators').all().find(n => n.tagName === 'BUTTON') : undefined);
  const feedCalls = () => calls.filter(c => /\/rpc\/league_creator_feed$/.test(c[0])).map(c => c[1]);
  return { els, calls, box, shown, grid, more, feedCalls, sec };
}
{
  const rows = feedRows(23);
  const t = await community({ rows, partners: [{ kind: 'source', slug: 'pod-1' }, { kind: 'outlet', slug: 'hoops-pod', league: 'kbl' }, { kind: 'odd' }] });
  const first = t.feedCalls()[0] || {};
  ok('it asks league_creator_feed for the league, from the newest, one more than a page (to know if there is another)',
     first.p_league === 'L1' && first.p_before === null && first.p_limit === 10, first);
  ok('nine cards, from the rows in their order, and the section comes in', t.grid() && t.grid().children.length === 9 &&
     t.grid().children.map(c => c.item.id).join() === rows.slice(0, 9).map(r => r.id).join() && t.shown('creators'));
  const opts = (t.grid() || {}).opts || {};
  ok('...drawn as the feed draws them: no lead card, the league\'s own tag left off, the time now',
     opts.lead === false && opts.hideTag === 'kbl' && typeof opts.now === 'number' && !('embed' in opts));
  ok('...an official partner\'s keys as the feed knows them (a source\'s, an outlet\'s with its league; anything else ignored)',
     !!opts.partners && typeof opts.partners.has === 'function' && opts.partners.size === 2 && opts.partners.has('source:pod-1') && opts.partners.has('outlet:kbl/hoops-pod'),
     opts.partners && [...opts.partners]);
  const c0 = t.grid().children[0].item;
  ok('...pictures from the public media bucket, crests at 64, each card to its story here (base ../)',
     c0.base === '../' && c0.media === 'https://x.supabase.co/storage/v1/object/public/media-public/a/b%20c.png' && c0.crest === 'https://logo.example/x.png?w=64', c0);
  ok('"Show more" while there are more', t.more() && t.more().textContent === 'Show more');
  await t.more().listeners.click[0]();
  await settle();
  const second = t.feedCalls()[1] || {};
  ok('...it asks for the next page from the last card shown', second.p_before === rows[8].published_at && second.p_limit === 10, second);
  ok('...and adds nine more to the same grid, drawn the same way', t.grid().children.length === 18 &&
     t.grid().children.slice(9).map(c => c.item.id).join() === rows.slice(9, 18).map(r => r.id).join() && t.grid().children[17].opts.hideTag === 'kbl');
  ok('...still there while more remain', !!t.more() && t.more().disabled === false);
  await t.more().listeners.click[0]();
  await settle();
  ok('...and gone at the end, every row shown once', t.grid().children.length === 23 && !t.more() &&
     new Set(t.grid().children.map(c => c.item.id)).size === 23);
  ok('the forum stays away when the league has no server', !t.shown('forum'));
}
{
  const t = await community({ rows: feedRows(5) });
  ok('five rows: five cards and no "Show more"', t.grid() && t.grid().children.length === 5 && !t.more());
  const none = await community({ rows: [] });
  ok('nothing from its creators: the section stays away', !none.shown('creators') && !none.grid());
  const absent = await community({ rows: 'absent' });
  ok('a server without 0207: the section stays away, and the page carries on', !absent.shown('creators') && absent.shown('stands') && absent.shown('travelled'));
}
{
  const servers = [{ id: 'd1', name: 'KBL Fans', invite: 'https://discord.gg/kblfans', server_id: '123456789012345678', official: true }];
  const t = await community({ rows: [], servers, hash: '#talk' });
  ok('the Discord servers come in under Forum', t.shown('forum') && /KBL Fans/.test(t.sec('cmServers').textContent));
  ok('...an old link to #talk lands on it', t.sec('forum').scrolled === 1);
  const c = await community({ rows: [], servers, hash: '#cmTalk' });
  ok('...and so does the console\'s old #cmTalk', c.sec('forum').scrolled === 1);
  const n = await community({ rows: [], servers, hash: '' });
  ok('...while a plain visit stays at the top', !n.sec('forum').scrolled);
  const discord = t.calls.find(x => x[0].startsWith('https://discord.com/'));
  ok('...Discord asked for the numbers with nothing but the invitation\'s code', discord && discord[0] === 'https://discord.com/api/v10/invites/kblfans?with_counts=true' && discord[2].credentials === 'omit');
  const two = servers.concat([{ id: 'd2', name: 'Club Fans', invite: 'https://discord.gg/clubfans', server_id: '223456789012345678' }]);
  const w = await community({ rows: [], servers: two, hash: '' });
  const showHere = w.sec('cmServers').all().filter(x => x.tagName === 'BUTTON' && x.textContent === 'Show here');
  if (showHere[0]) showHere[0].listeners.click[0]();
  ok('the server chosen with "Show here" is kept in the address, at #forum', showHere.length === 1 && w.box.replaced === '?l=kbl&s=d2#forum', w.box.replaced);
}

/* =================================================================== the console's covers row ====== */
console.log('\nthe console: which leagues a creator covers');
globalThis.document = { createElement: t => new El(t), querySelector: () => null };
const C = require(path.join(EP, 'admin', 'creators-ui.js'));
const LG = [{ id: 'l-kbl', name: 'KBL', slug: 'kbl' }, { id: 'l-nbl', name: 'NBL', slug: 'nbl' }, { id: 'l-acb', name: 'Liga ACB', slug: 'acb' }];
const sourceRows = () => [
  { id: 's1', slug: 'hoops-tube', name: 'Hoops Tube', kind: 'creator', platform: 'youtube', enabled: true, item_count: 4, feed_url: 'https://y.example/feed',
    assigned_leagues: [{ id: 'l-nbl', slug: 'nbl', name: 'NBL' }] },
  { id: 's2', slug: 'wire', name: 'The Wire', kind: 'publisher', platform: 'feed', enabled: true, item_count: 9, feed_url: 'https://w.example/feed', assigned_leagues: [] },
  { id: 's3', slug: 'quiet-pod', name: 'Quiet Pod', kind: 'creator', platform: 'podcast', enabled: true, item_count: 0, feed_url: 'https://q.example/feed', assigned_leagues: [] }
];
async function consoleOf(o) {
  const calls = [], said = [];
  const sb = { rpc: async (fn, args) => { calls.push([fn, args]); return o.handler(fn, args); },
               from: () => { calls.push(['from']); return { select: () => ({ order: async () => ({ data: LG, error: null }) }) }; } };
  const host = new El('div');
  C.mountSources({ host, sb, say: (m, k) => said.push([m, k]), league: o.league === undefined ? null : o.league, base: '../../', leagues: o.leagues });
  await settle();
  const rowsOf = () => host.all().filter(n => n.className === 'cv-row');
  return { host, calls, said, rowsOf };
}
{
  let stored = sourceRows();
  const t = await consoleOf({ leagues: () => LG, handler: async (fn, a) => {
    if (fn === 'news_sources_admin') return { data: stored, error: null };
    if (fn === 'set_news_source_leagues') return { data: a.p_leagues, error: null };
    return { data: null, error: null };
  } });
  const rows = t.rowsOf();
  const lineOf = n => n.parentNode.textContent;
  ok('the platform console: a covers row on every source, a publisher\'s too (0209: its stories on the league\'s news page)',
     rows.length === 3 && /^Hoops Tube/.test(lineOf(rows[0])) && /^The Wire/.test(lineOf(rows[1])) && /^Quiet Pod/.test(lineOf(rows[2])));
  ok('...the console\'s own list of leagues is used (nothing read again)', !t.calls.some(c => c[0] === 'from'));
  const tube = rows[0];
  const chips = n => n.all().filter(x => x.className === 'cv-chip').map(x => x.children[0].textContent);
  const pick = n => n.all().find(x => x.tagName === 'SELECT');
  ok('...a chip for each league it covers', JSON.stringify(chips(tube)) === '["NBL"]', chips(tube));
  ok('...and the leagues it does not cover yet to add one, in name order', pick(tube) && pick(tube).children.map(x => x.textContent).join('|') === '+ another league|KBL|Liga ACB', pick(tube) && pick(tube).children.map(x => x.textContent));
  ok('a creator with none says where its posts are', /COVERS\s*no league yet: its posts are in News/.test(rows[2].textContent) && pick(rows[2]).children[0].textContent === '+ a league it covers');
  const sel = pick(tube);
  sel.value = 'l-kbl';
  await sel.listeners.change[0]();
  await settle();
  const set1 = t.calls.filter(c => c[0] === 'set_news_source_leagues');
  ok('choosing a league sends the whole list, the new one last', set1.length === 1 && set1[0][1].p_id === 's1' && JSON.stringify(set1[0][1].p_leagues) === '["l-nbl","l-kbl"]', set1);
  ok('...the row is drawn again from what was kept, and says so', JSON.stringify(chips(tube)) === '["NBL","KBL"]' &&
     t.said.some(s => /Hoops Tube covers KBL: its posts show under Content creators/.test(s[0]) && s[1] === 'ok'), t.said);
  ok('...without drawing the whole list again', t.calls.filter(c => c[0] === 'news_sources_admin').length === 1);
  const off = tube.all().find(x => x.className === 'cv-chip' && x.children[0].textContent === 'NBL').all().find(x => x.tagName === 'BUTTON');
  ok('each chip\'s × says what it does', off.attrs['aria-label'] === 'take Hoops Tube off NBL' && off.title === 'take Hoops Tube off NBL');
  await off.listeners.click[0]();
  await settle();
  const set2 = t.calls.filter(c => c[0] === 'set_news_source_leagues')[1];
  ok('...and takes it off: the list without it', set2 && JSON.stringify(set2[1].p_leagues) === '["l-kbl"]' && JSON.stringify(chips(tube)) === '["KBL"]', set2);
}
{
  const t = await consoleOf({ leagues: () => LG, handler: async (fn) => {
    if (fn === 'news_sources_admin') return { data: sourceRows(), error: null };
    if (fn === 'set_news_source_leagues') return { data: null, error: { message: 'only a platform administrator can assign a creator to leagues' } };
    return { data: null, error: null };
  } });
  const tube = t.rowsOf()[0];
  const sel = tube.all().find(x => x.tagName === 'SELECT');
  sel.value = 'l-acb';
  await sel.listeners.change[0]();
  await settle();
  ok('a refusal is said in the database\'s words, and the row stays as it was',
     t.said.some(s => s[0] === 'only a platform administrator can assign a creator to leagues' && s[1] === 'err') &&
     tube.all().filter(x => x.className === 'cv-chip').length === 1 && tube.all().find(x => x.tagName === 'SELECT').disabled === false);
}
{
  const t = await consoleOf({ leagues: [], handler: async (fn) => (fn === 'news_sources_admin' ? { data: sourceRows(), error: null } : { data: null, error: null }) });
  ok('given no leagues, the console reads them itself', t.calls.some(c => c[0] === 'from') && t.rowsOf().length === 3);
  const old = await consoleOf({ leagues: () => LG, handler: async (fn) => (fn === 'news_sources_admin'
    ? { data: sourceRows().map(r => { const x = { ...r }; delete x.assigned_leagues; return x; }), error: null } : { data: null, error: null }) });
  ok('a database without 0207: no covers row, and one line saying why', old.rowsOf().length === 0 && /arrives with migration 0207/.test(old.host.textContent));
  const lc = await consoleOf({ league: { id: 'l-kbl', name: 'KBL', slug: 'kbl' }, handler: async (fn) => (fn === 'news_sources_admin' ? { data: sourceRows(), error: null } : { data: null, error: null }) });
  ok('a league\'s console: no covers row (its creators are its own), and it says they show on its Community page',
     lc.rowsOf().length === 0 && /its creators also under Content creators on its Community page/.test(lc.host.textContent) && !lc.calls.some(c => c[0] === 'from'));
}
{
  const ui = src('admin/creators-ui.js'), plat = src('admin/platform/platform.js');
  ok('the league console\'s link to its Discord servers goes to #forum', /community\/\?l=' \+ encodeURIComponent\(league\.slug \|\| ''\) \+ '#forum'/.test(ui) && !/#cmTalk/.test(ui));
  ok('the platform console hands its leagues to the list', /mountSources\(\{[^}]*leagues: \(\) => leagues/.test(plat));
}

/* ========================================================= a creator's channel and its partner pill ====== */
console.log('\nan official partner\'s creator channel');
{
  globalThis.window = globalThis.window || undefined;
  const K = require(path.join(EP, 'newscard.js'));
  const FR = require(path.join(EP, 'feedrank.js'));
  const ch = { kind: 'channel', id: 'c1', title: 'Game 3', url: 'https://www.youtube.com/watch?v=abcdefghijk', source_slug: 'hoops-tube', piece_kind: 'youtube', source_name: 'Hoops Tube', leagues: [] };
  ok('a creator\'s channel post is known by its source, as a publisher\'s is (the key official_partners() gives)',
     K.fromFeed(ch, '').pkey === 'source:hoops-tube' && K.fromFeed({ kind: 'outlet', id: 'x', source_slug: 'wire', url: 'https://w.example/1' }, '').pkey === 'source:wire');
  ok('...the feed\'s ranking says the same (one rule)', FR.pkeyOf(ch) === 'source:hoops-tube' && FR.pkeyOf({ kind: 'creator', outlet_slug: 'p', league_slug: 'kbl' }) === 'outlet:kbl/p' && FR.pkeyOf({ kind: 'league', league_slug: 'kbl' }) === null);
}

/* ============================================================================= the words ====== */
console.log('\nthe words');
{
  const es = src('i18n/es/go.js'), ja = src('i18n/ja/go.js');
  ok('Forum and Content creators in Spanish and Japanese (the page\'s "go" pack), and Talk gone',
     /'Forum': 'Foro'/.test(es) && /'Content creators': 'Creadores de contenido'/.test(es) && /'Forum': 'フォーラム'/.test(ja) && /'Content creators': 'コンテンツクリエイター'/.test(ja) &&
     !/'Talk'/.test(es) && !/'Talk'/.test(ja));
  ok('"Show more" is the core\'s phrase, already in both', /'Show more': 'Mostrar más'/.test(src('i18n/es.js')) && /'Show more': 'もっと見る'/.test(src('i18n/ja.js')));
}

/* ====================================================================== on a real Postgres ====== */
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('\nSKIP  the database: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
console.log('');
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
const m51 = mig('0051_news_and_writers.sql');
const fnOf = name => { const i = m51.indexOf('create or replace function public.' + name + '('); const j = m51.indexOf('end; $$;', i); return m51.slice(i, j + 'end; $$;'.length); };

const ADMIN = '11111111-1111-1111-1111-111111111111', FAN = '33333333-3333-3333-3333-333333333333', PLAT = '55555555-5555-5555-5555-555555555555';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.profiles (id uuid primary key, display_name text);
  create table public.audit_log (actor uuid, action text, subject text, subject_id text, detail jsonb, at timestamptz default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text, colour_a text, logo_path text);
  create table public.test_hidden (league_id uuid);
  create function public.is_platform_admin() returns boolean language sql stable as $$ select auth.uid() = '${PLAT}'::uuid $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$ select auth.uid() = '${ADMIN}'::uuid or public.is_platform_admin() $$;
  create function public.league_visible(p uuid) returns boolean language sql stable as $$ select not exists (select 1 from test_hidden where league_id = p) $$;
  create table public.news_articles (id uuid primary key default gen_random_uuid(), league_id uuid, slug text, title text,
    standfirst text default '', cover_path text, status text, published_at timestamptz, author_name text default '');
  create function public.can_view_league_for(u uuid, p uuid) returns boolean language sql stable as $$ select not exists (select 1 from test_hidden where league_id = p) $$;
  create function public.notify_valid_tz(t text) returns text language sql immutable as $$ select t $$;
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid);
  create table public.fan_prefs (user_id uuid primary key, theme text, colour text,
    fav_team_ids uuid[] not null default '{}', fav_player_ids uuid[] not null default '{}', fav_game_ids uuid[] not null default '{}',
    fav_league_ids uuid[] not null default '{}', notify_inapp boolean default true, notify_email boolean default false, notify_push boolean default false,
    want_results boolean default true, want_players boolean default true, want_fixtures boolean default true, want_announcements boolean default true,
    want_fixture_2d boolean default true, want_fixture_2h boolean default true, want_lineups boolean default true, want_player_games boolean default true,
    want_halftime boolean default true, want_fanvote boolean default true, want_favourites boolean default true, time_zone text, updated_at timestamptz);
  create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid, device_id uuid, kind text not null,
    title text not null, body text not null default '', link text, league_id uuid, game_id uuid, ref text not null, data jsonb not null default '{}',
    urgency text not null default 'normal', expires_at timestamptz, created_at timestamptz default now(), read_at timestamptz, pushed_at timestamptz,
    unique (user_id, kind, ref),
    constraint notifications_kind_check check (kind in ('result', 'player', 'fixture', 'lineups', 'halftime', 'announcement', 'message', 'highlights', 'privacy', 'test')));
  ${fnOf('clean_news_spans')}
  ${fnOf('clean_news_body')}
`);
const q = async (sql, params, role) => {
  if (role) await db.exec('set role ' + role);
  try { return (await db.query(sql, params)).rows; } finally { if (role) await db.exec('reset role'); }
};
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };

await db.exec(mig('0194_creators.sql'));
await db.exec(mig('0198_news_by_link.sql'));
await db.exec(`grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;`);
const resultOf = async f => (await q(`select pg_get_function_result(p.oid) as r from pg_proc p where p.proname = $1`, [f]))[0].r;
const feedBefore = await resultOf('news_feed');
const feedSrcBefore = (await q(`select prosrc from pg_proc where proname = 'news_feed'`))[0].prosrc;
await db.exec(mig('0207_league_creators.sql'));

await q(`insert into auth.users values ($1, 'admin@kbl.com'), ($2, 'fan@x.com'), ($3, 'plat@epinoia.com')`, [ADMIN, FAN, PLAT]);
const [kbl] = await q(`insert into leagues (slug, name, colour_a) values ('kbl', 'KBL', '#112233') returning id`);
const [nbl] = await q(`insert into leagues (slug, name) values ('nbl', 'NBL') returning id`);
const [acb] = await q(`insert into leagues (slug, name) values ('acb', 'Liga ACB') returning id`);
const T0 = Date.parse('2026-09-30T12:00:00Z');
const ago = mins => new Date(T0 - mins * 60e3).toISOString();
const source = async (slug, kind, league, platform, enabled = true) => (await q(
  `insert into news_sources (league_id, slug, name, site_url, feed_url, kind, platform, enabled) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
  [league, slug, slug.replace(/-/g, ' '), 'https://' + slug + '.example', 'https://' + slug + '.example/feed', kind, platform, enabled]))[0].id;
const item = (src_, guid, mins, leagueIds = []) => q(
  `insert into news_items (source_id, guid, url, title, published_at, league_ids) values ($1, $2, $3, $4, $5, $6::uuid[])`,
  [src_, guid, 'https://x.example/' + guid, 'Story ' + guid, ago(mins), leagueIds]);
const tube = await source('hoops-tube', 'creator', null, 'youtube');
const wire = await source('wire', 'publisher', null, 'feed');
const kblPod = await source('kbl-pod', 'creator', kbl.id, 'podcast');
const kblNews = await source('kbl-news', 'publisher', kbl.id, 'feed');
const nblTube = await source('nbl-tube', 'creator', null, 'youtube');
const offTube = await source('off-tube', 'creator', null, 'youtube', false);
await item(tube, 't1', 60, []); await item(tube, 't2', 180, [nbl.id]);
await item(wire, 'w1', 120, [kbl.id]);
await item(kblPod, 'k1', 30);
await item(kblNews, 'kn1', 10);
await item(nblTube, 'n1', 15);
await item(offTube, 'o1', 5);
await q(`update leagues set creators_enabled = true where id = $1`, [kbl.id]);
const [{ id: outlet }] = await q(`insert into creator_outlets (league_id, slug, name) values ($1, 'hoops-pod', 'Hoops Pod') returning id`, [kbl.id]);
const post = (slug, mins, extra = {}) => q(
  `insert into creator_posts (outlet_id, league_id, slug, kind, title, status, hidden, published_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
  [outlet, kbl.id, slug, extra.kind || 'video', 'Piece ' + slug, extra.status || 'published', !!extra.hidden, mins == null ? null : ago(mins)]);
await post('p1', 20); await post('p2', 25, { hidden: true }); await post('p3', null, { status: 'draft' });

console.log('assigning a creator to leagues');
const setLeagues = (id, leagues, role = 'authenticated') => q(`select public.set_news_source_leagues($1, $2::uuid[]) as v`, [id, leagues], role);
await as(PLAT);
const [{ v: kept }] = await setLeagues(tube, [kbl.id, nbl.id, kbl.id, '99999999-9999-9999-9999-999999999999']);
ok('a platform administrator assigns: the leagues once each, in the order given, one that does not exist dropped',
   JSON.stringify(kept) === JSON.stringify([kbl.id, nbl.id]), kept);
ok('...and it is kept on the source', JSON.stringify((await q(`select assigned_leagues from news_sources where id = $1`, [tube]))[0].assigned_leagues) === JSON.stringify([kbl.id, nbl.id]));
ok('...audit-logged, with the leagues', (await q(`select detail from audit_log where action = 'set_news_source_leagues' and subject_id = $1`, [tube]))
   .some(r => JSON.stringify(r.detail.leagues) === JSON.stringify([kbl.id, nbl.id])));
await setLeagues(nblTube, [nbl.id]);
await setLeagues(offTube, [kbl.id]);
await setLeagues(wire, [kbl.id]);
ok('a publisher can be assigned (it shows once it is a creator)', JSON.stringify((await q(`select assigned_leagues from news_sources where id = $1`, [wire]))[0].assigned_leagues) === JSON.stringify([kbl.id]));
ok('a league\'s own source is refused: it is its league\'s already', /its league's already/.test(await fails(() => setLeagues(kblPod, [nbl.id])) || ''));
ok('a source that is not there is refused', /no such source/.test(await fails(() => setLeagues('99999999-9999-9999-9999-999999999999', [kbl.id])) || ''));
ok('an empty list (or none) takes it off every league', JSON.stringify((await setLeagues(nblTube, []))[0].v) === '[]' &&
   JSON.stringify((await q(`select public.set_news_source_leagues($1, null) as v`, [nblTube], 'authenticated'))[0].v) === '[]');
await setLeagues(nblTube, [nbl.id]);
await as(ADMIN);
ok('a league\'s administrator is refused', /only a platform administrator/.test(await fails(() => setLeagues(tube, [acb.id])) || ''));
await as(FAN);
ok('...and a fan', /only a platform administrator/.test(await fails(() => setLeagues(tube, [acb.id])) || ''));
await as('');
ok('...and a signed-out caller cannot call it at all', /permission denied/.test(await fails(() => setLeagues(tube, [acb.id], 'anon')) || ''));
ok('...nothing changed by any of them', JSON.stringify((await q(`select assigned_leagues from news_sources where id = $1`, [tube]))[0].assigned_leagues) === JSON.stringify([kbl.id, nbl.id]));

console.log('\nthe console\'s list');
await as(PLAT);
const plat = await q(`select * from public.news_sources_admin(null)`, [], 'authenticated');
const tubeRow = plat.find(r => r.slug === 'hoops-tube');
ok('the platform\'s list carries each source\'s leagues, by name, in their order',
   JSON.stringify(tubeRow.assigned_leagues) === JSON.stringify([{ id: kbl.id, name: 'KBL', slug: 'kbl' }, { id: nbl.id, name: 'NBL', slug: 'nbl' }]), tubeRow.assigned_leagues);
ok('...none is an empty list, and the list holds only the sources for every reader',
   JSON.stringify(plat.find(r => r.slug === 'nbl-tube').assigned_leagues) === JSON.stringify([{ id: nbl.id, name: 'NBL', slug: 'nbl' }]) &&
   !plat.some(r => r.slug === 'kbl-pod') && ['kind', 'platform', 'resolve_from', 'item_count'].every(k => k in tubeRow));
await as(ADMIN);
const own = await q(`select * from public.news_sources_admin($1)`, [kbl.id], 'authenticated');
ok('a league\'s list: its own sources, each with no leagues of its own to show', own.length === 2 && own.every(r => JSON.stringify(r.assigned_leagues) === '[]'));
await as(FAN);
ok('a fan cannot read the list', /cannot see the news sources/.test(await fails(() => q(`select * from public.news_sources_admin(null)`, [], 'authenticated')) || ''));
ok('...nor a signed-out caller', /permission denied/.test(await fails(() => q(`select * from public.news_sources_admin(null)`, [], 'anon')) || ''));

console.log('\nthe Community page\'s content creators');
await as('');
const feed = (league, before = null, limit = 30, role = 'anon') => q(`select * from public.league_creator_feed($1, $2, $3)`, [league, before, limit], role);
let rows = await feed(kbl.id);
const ids = r => r.map(x => x.title).join();
ok('the league\'s: its outlet\'s piece, its own creator\'s post, and the posts of the creator assigned to it - newest first',
   ids(rows) === 'Piece p1,Story k1,Story t1,Story t2', ids(rows));
ok('...never a publisher (its own, or one assigned), a source that is off, a creator assigned elsewhere, a hidden piece or a draft',
   !/w1|kn1|o1|n1|p2|p3/.test(ids(rows)));
const piece = rows.find(r => r.title === 'Piece p1'), k1 = rows.find(r => r.title === 'Story k1'), t2 = rows.find(r => r.title === 'Story t2');
ok('a piece is the feed\'s "creator" row: its outlet, its league, its kind', piece.kind === 'creator' && piece.outlet_slug === 'hoops-pod' && piece.league_slug === 'kbl' && piece.piece_kind === 'video' && piece.leagues[0].slug === 'kbl');
ok('a post is the feed\'s "channel" row: its source, its platform, its own leagues as tags', k1.kind === 'channel' && k1.source_slug === 'kbl-pod' && k1.piece_kind === 'podcast' && k1.league_slug === 'kbl' &&
   k1.leagues.map(l => l.slug).join() === 'kbl' && t2.leagues.map(l => l.slug).join() === 'nbl' && rows.find(r => r.title === 'Story t1').leagues.length === 0);
ok('its rows are news_feed\'s, column for column', await resultOf('league_creator_feed') === await resultOf('news_feed'));
const nblRows = await feed(nbl.id);
ok('another league gets its own: the creators assigned to it (one creator can cover two)', ids(nblRows) === 'Story n1,Story t1,Story t2', ids(nblRows));
ok('a league nobody is assigned to, with no creators of its own: nothing', (await feed(acb.id)).length === 0);
ok('a page at a time: the newest two, then the next two from the last one\'s time',
   ids(await feed(kbl.id, null, 2)) === 'Piece p1,Story k1' && ids(await feed(kbl.id, k1.published_at, 2)) === 'Story t1,Story t2');
ok('...sixty at most, however many are asked for', (await feed(kbl.id, null, 1000)).length === 4 && (await feed(kbl.id, null, 0)).length === 1);
await as(PLAT);
await q(`select public.set_news_source_kind($1, 'creator')`, [wire], 'authenticated');
await as('');
ok('a publisher assigned to the league shows once it is called a creator (its assignment kept)', /Story w1/.test(ids(await feed(kbl.id))));
await as(PLAT);
await q(`select public.set_news_source_kind($1, 'publisher')`, [wire], 'authenticated');
await as('');
ok('...and goes again when it is a publisher once more', !/Story w1/.test(ids(await feed(kbl.id))));
await q(`update leagues set creators_enabled = false where id = $1`, [kbl.id]);
ok('a league that does not show its creator outlets: no pieces, while the creators the platform assigned stay',
   ids(await feed(kbl.id)) === 'Story k1,Story t1,Story t2', ids(await feed(kbl.id)));
await q(`update leagues set creators_enabled = true where id = $1`, [kbl.id]);
await q(`update creator_outlets set status = 'suspended' where id = $1`, [outlet]);
ok('a suspended outlet: none of its pieces', !/Piece/.test(ids(await feed(kbl.id))));
await q(`update creator_outlets set status = 'active' where id = $1`, [outlet]);
await q(`update news_sources set enabled = false where id = $1`, [tube]);
ok('a source switched off: none of its posts', ids(await feed(kbl.id)) === 'Piece p1,Story k1');
await q(`update news_sources set enabled = true where id = $1`, [tube]);
await q(`insert into test_hidden values ($1)`, [kbl.id]);
ok('a league the reader may not see: nothing at all', (await feed(kbl.id)).length === 0);
await q(`delete from test_hidden`);
ok('a league that is not there: nothing', (await feed('99999999-9999-9999-9999-999999999999')).length === 0);
ok('signed in, the same', ids(await feed(kbl.id, null, 30, 'authenticated')) === 'Piece p1,Story k1,Story t1,Story t2');
ok('the tables stay closed: the leagues a source is assigned to are read through the functions only',
   /permission denied/.test(await fails(() => q(`select assigned_leagues from news_sources`, [], 'anon')) || ''));

console.log('\nwhat 0207 leaves alone, and running it again');
ok('news_feed is not changed: its columns and its body as before', await resultOf('news_feed') === feedBefore &&
   (await q(`select prosrc from pg_proc where proname = 'news_feed'`))[0].prosrc === feedSrcBefore);
await db.exec(mig('0207_league_creators.sql'));
ok('running 0207 again changes nothing: every assignment kept', JSON.stringify((await q(`select assigned_leagues from news_sources where id = $1`, [tube]))[0].assigned_leagues) === JSON.stringify([kbl.id, nbl.id]) &&
   ids(await feed(kbl.id)) === 'Piece p1,Story k1,Story t1,Story t2');
ok('...and who may call what is as it was',
   /permission denied/.test(await fails(() => setLeagues(tube, [acb.id], 'anon')) || '') && (await feed(kbl.id, null, 30, 'anon')).length === 4);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
