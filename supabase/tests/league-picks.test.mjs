// 0209: A LEAGUE PICKS FROM THE PLATFORM'S PUBLISHERS AND CREATORS. The league console's "Creators & news sources"
// (epinoia/admin/creators-ui.js mountSources, with a league) lists the sources the platform reads for every reader, and
// the league picks the ones it wants, rather than add the same feed again by link. What is held here:
//   * with no database: 0209's copies of news_feed, news_feed_mine and news_sources_public are 0198's but for the one
//     condition each; the console's "From the platform's list" - the league's picks, each to take off, the rest behind
//     a fold, eight at a time, found by name or site or kind; a pick or a take-off sent for this league only and said;
//     a refusal said in the database's words; a database without 0209 saying so while the rest stands; a pasted link
//     the platform reads already offering the pick instead; the platform console's covers row on a publisher too;
//   * on a real Postgres (PGlite; skipped with a note when it is not installed): news_sources_offered and
//     set_league_news_source - a league's administrators for their own league only, a source for every reader only,
//     not one the platform switched off, audit-logged when it changes; one list with the platform's covers row; a
//     picked source on the league's news page (every story of it), in its row of sources, in its followers' feed,
//     and a picked creator on its Community page, a publisher never; nothing else changed; 0209 run again.
//
//   node supabase/tests/league-picks.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const EP = path.join(here, '..', '..', 'epinoia');
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 0)); };

/* ============================================================== 0209's copies of 0198's readers ====== */
console.log('0209\'s copies of the readers');
{
  const m198 = mig('0198_news_by_link.sql'), m209 = mig('0209_league_picks_sources.sql');
  const fn = (text, name) => { const i = text.indexOf('create or replace function public.' + name + '('); const j = text.indexOf('$$;', text.indexOf('$$', i) + 2); return i < 0 ? '' : text.slice(i, j + 3); };
  const flat = t => t.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  const added = {
    news_feed: 'or (s.league_id is null and p_league = any (s.assigned_leagues))',
    news_feed_mine: 'or (s.league_id is null and s.assigned_leagues && me.leagues)',
    news_sources_public: 'or (s.league_id is null and p_league = any (s.assigned_leagues))'
  };
  Object.keys(added).forEach(name => {
    const now = fn(m209, name), was = fn(m198, name);
    ok(name + ': 0198\'s, with the one condition tagged -- 0209 and nothing else',
       now && was && now.includes(added[name]) && /-- 0209/.test(now) && flat(now.replace(added[name], '')) === flat(was), flat(now).slice(0, 120));
  });
  ok('...the same grants as 0198 gave them', /grant execute on function public\.news_feed\(uuid, timestamptz, int, text\[\]\) to anon, authenticated;/.test(m209) &&
     /revoke all on function public\.news_feed_mine\(timestamptz, int\) from public, anon;\s*grant execute on function public\.news_feed_mine\(timestamptz, int\) to authenticated;/.test(m209) &&
     /grant execute on function public\.news_sources_public\(uuid\) to anon, authenticated;/.test(m209));
  ok('the two new ones are for signed-in callers only', /revoke all on function public\.news_sources_offered\(uuid\) from public, anon;/.test(m209) &&
     /revoke all on function public\.set_league_news_source\(uuid, uuid, boolean\) from public, anon;/.test(m209));
  ok('a story\'s league tags, the notices and the Community page are left as they were',
     !/function public\.(news_item_leagues|notify_news_items|league_creator_feed)\(/.test(m209));
}

/* =========================================================================== the console ====== */
class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = ''; this.className = '';
    this.attrs = {}; this.listeners = {}; this.checked = false; this.disabled = false; this.hidden = false; this.value = ''; this.id = ''; this.type = '';
    this.style = { cssText: '', props: {}, setProperty(k, v) { this.props[k] = v; } };
  }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.children = p.children.map(c => (c === this ? n : c)); n.parentNode = p; this.parentNode = null; }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  all() { const out = []; const walk = n => (n.children || []).forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
  querySelectorAll(sel) { const tags = String(sel).split(',').map(s => s.trim().toUpperCase()); return this.all().filter(n => tags.includes(n.tagName)); }
}
globalThis.document = { createElement: t => new El(t), querySelector: () => null };
const C = require(path.join(EP, 'admin', 'creators-ui.js'));
const KBL = { id: 'l-kbl', name: 'KBL', slug: 'kbl' };
const LG = [KBL, { id: 'l-nbl', name: 'NBL', slug: 'nbl' }];
const offeredRows = () => [
  { id: 's1', slug: 'hoops-tube', name: 'Hoops Tube', kind: 'creator', platform: 'youtube', enabled: true, item_count: 4,
    site_url: 'https://www.youtube.com/channel/UC123', feed_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC123', last_at: '2026-09-30T10:00:00Z', picked: true },
  { id: 's2', slug: 'the-wire', name: 'The Wire', kind: 'publisher', platform: 'website', enabled: true, item_count: 9,
    site_url: 'https://www.thewire.example/en/', feed_url: 'https://www.thewire.example/en/feed/', last_at: '2026-09-30T11:00:00Z', picked: false },
  { id: 's3', slug: 'quiet-pod', name: 'Quiet Pod', kind: 'creator', platform: 'podcast', enabled: true, item_count: 0,
    site_url: 'https://quietpod.example', feed_url: 'https://quietpod.example/rss', last_at: null, picked: false },
  { id: 's4', slug: 'gone-wire', name: 'Gone Wire', kind: 'publisher', platform: 'feed', enabled: false, item_count: 2,
    site_url: 'https://gone.example', feed_url: 'https://gone.example/feed', last_at: null, picked: true }
].concat(Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, slug: 'pub-' + i, name: 'Pub ' + String(i).padStart(2, '0'), kind: 'publisher',
  platform: 'feed', enabled: true, item_count: i, site_url: 'https://pub' + i + '.example', feed_url: 'https://pub' + i + '.example/feed', picked: false })));
const ownRows = () => [{ id: 'k1', slug: 'kbl-news', name: 'KBL News', kind: 'publisher', platform: 'feed', enabled: true, item_count: 3,
  feed_url: 'https://kbl.example/feed', assigned_leagues: [] }];
async function consoleOf(o) {
  const calls = [], said = [];
  const sb = { rpc: async (fn, args) => { calls.push([fn, args]); return o.handler(fn, args); },
               from: () => { calls.push(['from']); return { select: () => ({ order: async () => ({ data: LG, error: null }) }) }; } };
  const host = new El('div');
  C.mountSources({ host, sb, say: (m, k) => said.push([m, k]), league: o.league === undefined ? KBL : o.league, base: '../', leagues: o.leagues });
  await settle();
  const block = () => host.all().find(n => n.className === 'pf-list');
  const picks = () => host.all().filter(n => n.className === 'pf-got').flatMap(g => g.all().filter(n => n.className === 'pf-row'));
  const offers = () => host.all().filter(n => n.className === 'pf-found').flatMap(g => g.all().filter(n => n.className === 'pf-row'));
  const nameOf = r => r.children.find(c => c.tagName === 'B').textContent;
  const buttonOf = r => r.children.find(c => c.tagName === 'BUTTON');
  return { host, calls, said, block, picks, offers, nameOf, buttonOf };
}
const standard = (over = {}) => async (fn, a) => {
  if (over[fn]) return over[fn](a);
  if (fn === 'news_sources_admin') return { data: ownRows(), error: null };
  if (fn === 'news_sources_offered') return { data: offeredRows(), error: null };
  if (fn === 'set_league_news_source') return { data: a.p_on, error: null };
  return { data: null, error: null };
};

console.log('\nthe league console: the platform\'s list');
{
  const t = await consoleOf({ handler: standard() });
  const off = t.calls.filter(c => c[0] === 'news_sources_offered');
  ok('the platform\'s list is read once, for this league', off.length === 1 && off[0][1].p_league === 'l-kbl');
  const b = t.block();
  ok('it sits under the league\'s own sources, titled and explained', b && /^From the platform’s list/.test(b.textContent) &&
     /Pick one for KBL: every story of it joins the league’s news page, and a creator’s posts its Community page too/.test(b.textContent) &&
     t.host.textContent.indexOf('KBL News') < t.host.textContent.indexOf('From the platform’s list'));
  ok('the league\'s picks first, each with its take-off', JSON.stringify(t.picks().map(t.nameOf)) === '["Hoops Tube","Gone Wire"]' &&
     t.picks().every(r => t.buttonOf(r).textContent === 'take off'), t.picks().map(t.nameOf));
  ok('...one the platform switched off since says so', /PUBLISHER · feed · switched off by the platform/.test(t.picks()[1].textContent));
  ok('...each saying what it is and how it reads', /CREATOR · YouTube · 4 posts, the latest .* · youtube\.com/.test(t.picks()[0].textContent), t.picks()[0].textContent);
  const fold = b.all().find(n => n.tagName === 'DETAILS');
  ok('the rest behind a fold, counted', fold && !fold.hidden && fold.children[0].textContent === 'Pick from the platform’s publishers and creators (12)', fold && fold.children[0].textContent);
  ok('...the first eight, the rest behind "show more"', t.offers().length === 8 && /^Show more \(4\)$/.test(b.all().find(n => /^Show (more|fewer)/.test(n.textContent) && n.tagName === 'BUTTON').textContent));
  const more = b.all().find(n => n.tagName === 'BUTTON' && /^Show more/.test(n.textContent));
  more.listeners.click[0]();
  ok('...all twelve, and "Show fewer"', t.offers().length === 12 && more.textContent === 'Show fewer' && more.attrs['aria-expanded'] === 'true');
  const find = b.all().find(n => n.tagName === 'INPUT' && n.type === 'search');
  find.value = 'wire'; find.listeners.input[0]();
  ok('found by name: one word, any case', JSON.stringify(t.offers().map(t.nameOf)) === '["The Wire"]' && more.hidden, t.offers().map(t.nameOf));
  find.value = 'thewire.example'; find.listeners.input[0]();
  ok('...or by its site', JSON.stringify(t.offers().map(t.nameOf)) === '["The Wire"]');
  find.value = 'nothing like it'; find.listeners.input[0]();
  ok('...and says when nothing is', t.offers().length === 0 && /None of them by that/.test(b.textContent));
  find.value = ''; find.listeners.input[0]();
  const kinds = b.all().find(n => n.tagName === 'SELECT');
  kinds.value = 'creator'; kinds.listeners.change[0]();
  ok('only creators, or only publishers', JSON.stringify(t.offers().map(t.nameOf)) === '["Quiet Pod"]', t.offers().map(t.nameOf));
  kinds.value = ''; kinds.listeners.change[0]();

  const wire = t.offers().find(r => t.nameOf(r) === 'The Wire');
  ok('each offer has its pick, saying what it does', t.buttonOf(wire).textContent === 'pick' && t.buttonOf(wire).attrs['aria-label'] === 'put The Wire on KBL’s pages');
  await t.buttonOf(wire).listeners.click[0]();
  await settle();
  const sent = t.calls.filter(c => c[0] === 'set_league_news_source');
  ok('picking sends this league, this source, on', sent.length === 1 && JSON.stringify(sent[0][1]) === JSON.stringify({ p_league: 'l-kbl', p_id: 's2', p_on: true }), sent);
  ok('...it joins the picks, the fold counts one fewer, and it is said', t.picks().map(t.nameOf).includes('The Wire') && !t.offers().map(t.nameOf).includes('The Wire') &&
     /\(11\)$/.test(fold.children[0].textContent) && t.said.some(s => s[0] === 'The Wire is on KBL’s pages: every story of it on the league’s news page.' && s[1] === 'ok'), t.said);
  ok('...without reading anything again', t.calls.filter(c => c[0] === 'news_sources_offered').length === 1 && t.calls.filter(c => c[0] === 'news_sources_admin').length === 1);
  const tube = t.picks().find(r => t.nameOf(r) === 'Hoops Tube');
  await t.buttonOf(tube).listeners.click[0]();
  await settle();
  const sent2 = t.calls.filter(c => c[0] === 'set_league_news_source')[1];
  ok('taking one off sends off, and it goes back among the rest', sent2 && sent2[1].p_on === false && sent2[1].p_id === 's1' &&
     !t.picks().map(t.nameOf).includes('Hoops Tube') && t.said.some(s => s[0] === 'Hoops Tube is off KBL’s pages. It stays on the platform’s list.'));
  ok('a creator\'s pick says its Community page too', await (async () => {
    const pod = t.offers().find(r => t.nameOf(r) === 'Quiet Pod');
    await t.buttonOf(pod).listeners.click[0](); await settle();
    return t.said.some(s => s[0] === 'Quiet Pod is on KBL’s pages: every story of it on the league’s news page, and its posts under Content creators on its Community page.');
  })());
}
{
  const t = await consoleOf({ handler: standard({ set_league_news_source: () => ({ data: null, error: { message: 'the platform has switched that source off: it cannot be picked' } }) }) });
  const wire = t.offers().find(r => t.nameOf(r) === 'The Wire');
  await t.buttonOf(wire).listeners.click[0]();
  await settle();
  ok('a refusal is said in the database\'s words, and nothing moves', t.said.some(s => s[0] === 'the platform has switched that source off: it cannot be picked' && s[1] === 'err') &&
     t.offers().map(t.nameOf).includes('The Wire') && !t.picks().map(t.nameOf).includes('The Wire'));
}
{
  const t = await consoleOf({ handler: standard({ news_sources_offered: () => ({ data: null, error: { message: 'Could not find the function public.news_sources_offered(p_league) in the schema cache' } }) }) });
  ok('a database without 0209: one line saying so, and the league\'s own sources as before',
     /Picking from the platform’s publishers and creators arrives with migration 0209/.test(t.block().textContent) && t.picks().length === 0 &&
     /KBL News/.test(t.host.textContent));
  const none = await consoleOf({ handler: standard({ news_sources_offered: () => ({ data: [], error: null }) }) });
  ok('a platform that reads nothing yet: said, and no fold', /The platform reads no publishers or creators yet/.test(none.block().textContent) &&
     none.block().all().find(n => n.tagName === 'DETAILS').hidden === true);
  const plat = await consoleOf({ league: null, leagues: () => LG, handler: standard({ news_sources_admin: () => ({ data: offeredRows().map(r => ({ ...r, assigned_leagues: [] })), error: null }) }) });
  ok('the platform\'s own console has no such list (the sources are its own)', !plat.calls.some(c => c[0] === 'news_sources_offered') && !plat.block());
}

console.log('\na link the platform reads already');
{
  const t = await consoleOf({ handler: standard() });
  const link = t.host.all().find(n => n.tagName === 'INPUT' && n.type === 'url');
  const said = () => link.parentNode.parentNode.all().find(n => n.tagName === 'P' && /min-height:1\.4em/.test(n.style.cssText));
  link.value = 'https://thewire.example/en';
  link.listeners.input[0]();
  const p = said();
  ok('pasted: it is named, and picking is offered instead of reading the feed twice',
     p && /The Wire is on the platform’s list: pick it rather than read the same feed twice/.test(p.textContent) && p.all().some(n => n.tagName === 'BUTTON' && n.textContent === 'pick The Wire'), p && p.textContent);
  await p.all().find(n => n.tagName === 'BUTTON').listeners.click[0]();
  await settle();
  ok('...the button picks it for the league, and the box is cleared',
     t.calls.some(c => c[0] === 'set_league_news_source' && c[1].p_id === 's2' && c[1].p_on === true) && link.value === '' && t.picks().map(t.nameOf).includes('The Wire'));
  ok('...nothing was added by link', !t.calls.some(c => c[0] === 'add_news_link'));
  link.value = 'https://www.youtube.com/feeds/videos.xml?channel_id=UC123';
  link.listeners.input[0]();
  ok('its feed\'s address is known too; one the league has already says so, with nothing to press',
     /Hoops Tube is on the platform’s list, and KBL has it already\./.test(said().textContent) && !said().all().some(n => n.tagName === 'BUTTON'), said().textContent);
  link.value = 'https://elsewhere.example/blog';
  link.listeners.input[0]();
  ok('another link: no word about the platform', !/platform’s list/.test(said().textContent));
}

console.log('\nthe platform console: a publisher\'s leagues too');
{
  const rowsP = () => offeredRows().slice(0, 3).map(r => ({ ...r, assigned_leagues: [] }));
  const calls = [], said = [];
  const sb = { rpc: async (fn, a) => { calls.push([fn, a]); return fn === 'news_sources_admin' ? { data: rowsP(), error: null } : { data: a.p_leagues, error: null }; } };
  const host = new El('div');
  C.mountSources({ host, sb, say: (m, k) => said.push([m, k]), league: null, base: '../../', leagues: () => LG });
  await settle();
  const rows = host.all().filter(n => n.className === 'cv-row');
  ok('a covers row on every source, the publisher\'s too', rows.length === 3 && /^The Wire/.test(rows[1].parentNode.textContent));
  const sel = rows[1].all().find(n => n.tagName === 'SELECT');
  sel.value = 'l-kbl';
  await sel.listeners.change[0]();
  await settle();
  ok('...and what a league gets of a publisher is said', said.some(s => s[0] === 'The Wire covers KBL: every story of it shows on the league’s news page.'), said);
  ok('the words say a league picks from the list too', /A league’s administrators pick from this list for their own league as well/.test(host.textContent));
}

/* ====================================================================== on a real Postgres ====== */
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('\nSKIP  the database: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
console.log('');
const m51 = mig('0051_news_and_writers.sql');
const fnOf = name => { const i = m51.indexOf('create or replace function public.' + name + '('); const j = m51.indexOf('end; $$;', i); return m51.slice(i, j + 'end; $$;'.length); };

const ADMIN = '11111111-1111-1111-1111-111111111111', FAN = '33333333-3333-3333-3333-333333333333', PLAT = '55555555-5555-5555-5555-555555555555',
      OTHER = '77777777-7777-7777-7777-777777777777';
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
  create table public.test_admins (user_id uuid, league_id uuid);
  create function public.is_platform_admin() returns boolean language sql stable as $$ select auth.uid() = '${PLAT}'::uuid $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$
    select public.is_platform_admin() or exists (select 1 from public.test_admins a where a.user_id = auth.uid() and a.league_id = p) $$;
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
await db.exec(mig('0207_league_creators.sql'));
await db.exec(mig('0209_league_picks_sources.sql'));

await q(`insert into auth.users values ($1, 'admin@kbl.com'), ($2, 'fan@x.com'), ($3, 'plat@epinoia.com'), ($4, 'admin@nbl.com')`, [ADMIN, FAN, PLAT, OTHER]);
const [kbl] = await q(`insert into leagues (slug, name, colour_a) values ('kbl', 'KBL', '#112233') returning id`);
const [nbl] = await q(`insert into leagues (slug, name) values ('nbl', 'NBL') returning id`);
const [acb] = await q(`insert into leagues (slug, name) values ('acb', 'Liga ACB') returning id`);
await q(`insert into test_admins values ($1, $2), ($3, $4)`, [ADMIN, kbl.id, OTHER, nbl.id]);
const T0 = Date.parse('2026-09-30T12:00:00Z');
const ago = mins => new Date(T0 - mins * 60e3).toISOString();
const source = async (slug, kind, league, platform, enabled = true) => (await q(
  `insert into news_sources (league_id, slug, name, site_url, feed_url, kind, platform, enabled) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
  [league, slug, slug.replace(/-/g, ' '), 'https://' + slug + '.example', 'https://' + slug + '.example/feed', kind, platform, enabled]))[0].id;
const item = (src_, guid, mins, leagueIds = []) => q(
  `insert into news_items (source_id, guid, url, title, published_at, league_ids) values ($1, $2, $3, $4, $5, $6::uuid[])`,
  [src_, guid, 'https://x.example/' + guid, 'Story ' + guid, ago(mins), leagueIds]);
const wire = await source('wire', 'publisher', null, 'website');
const tube = await source('tube', 'creator', null, 'youtube');
const nblTube = await source('nbl-tube', 'creator', null, 'youtube');
const offWire = await source('off-wire', 'publisher', null, 'feed', false);
const kblNews = await source('kbl-news', 'publisher', kbl.id, 'feed');
await item(wire, 'w1', 60, []); await item(wire, 'w2', 90, [nbl.id]);
await item(tube, 't1', 30, []);
await item(nblTube, 'n1', 15, []);
await item(offWire, 'o1', 5, []);
await item(kblNews, 'kn1', 10, []);
await as(PLAT);
await q(`select public.set_news_source_leagues($1, $2::uuid[])`, [nblTube, [nbl.id]], 'authenticated');
await q(`insert into fan_prefs (user_id, fav_league_ids) values ($1, $2::uuid[])`, [FAN, [kbl.id]]);
await q(`update leagues set creators_enabled = true where id = $1`, [kbl.id]);

const titles = r => r.map(x => x.title).join();
const pageOf = async (league, role = 'anon') => { await as(''); return q(`select * from public.news_feed($1, null, 30, $2::text[])`, [league, ['outlet', 'creator', 'channel']], role); };
const everyone = async () => { await as(''); return q(`select id from public.news_feed(null, null, 60, null)`, [], 'anon'); };
const rowOf = async league => { await as(''); return q(`select slug from public.news_sources_public($1)`, [league], 'anon'); };
const mineOf = async () => { await as(FAN); return q(`select * from public.news_feed_mine(null, 30)`, [], 'authenticated'); };
const creatorsOf = async league => { await as(''); return q(`select * from public.league_creator_feed($1, null, 30)`, [league], 'anon'); };
const offered = async (league, who = ADMIN) => { await as(who); return q(`select * from public.news_sources_offered($1)`, [league], 'authenticated'); };
const setPick = async (league, id, on, who = ADMIN, role = 'authenticated') => { await as(who); return (await q(`select public.set_league_news_source($1, $2, $3) as v`, [league, id, on], role))[0].v; };
const listOf = async id => (await q(`select assigned_leagues from news_sources where id = $1`, [id]))[0].assigned_leagues;

console.log('before any pick');
const everyoneBefore = (await everyone()).map(r => r.id).sort().join();
const kblBefore = titles(await pageOf(kbl.id));
ok('the league\'s news page: its own source, and the stories that name it (none of the platform\'s here)', kblBefore === 'Story kn1', kblBefore);
const offer0 = await offered(kbl.id);
ok('the league\'s administrator reads the platform\'s list: the sources that are on, none picked yet',
   offer0.map(r => r.slug).join() === 'nbl-tube,tube,wire' && offer0.every(r => r.picked === false), offer0.map(r => [r.slug, r.picked]));
ok('...never a league\'s own source, nor one the platform switched off', !offer0.some(r => r.slug === 'kbl-news' || r.slug === 'off-wire'));
const w0 = offer0.find(r => r.slug === 'wire');
ok('...each with what the console shows: its kind, platform, site and feed, posts, its latest story',
   w0.kind === 'publisher' && w0.platform === 'website' && w0.site_url === 'https://wire.example' && w0.feed_url === 'https://wire.example/feed' &&
   new Date(w0.last_at).toISOString() === ago(60) && 'item_count' in w0 && 'resolve_from' in w0 && w0.enabled === true);

console.log('\na league picks');
ok('its administrator picks one of the platform\'s publishers: true', await setPick(kbl.id, wire, true) === true);
ok('...the league is on the source\'s list', JSON.stringify(await listOf(wire)) === JSON.stringify([kbl.id]));
ok('...audit-logged with the league', (await q(`select detail from audit_log where action = 'set_league_news_source' and subject_id = $1`, [wire]))
   .some(r => r.detail.league === kbl.id && r.detail.on === true));
ok('picking it again changes nothing, and logs nothing', await setPick(kbl.id, wire, true) === true && JSON.stringify(await listOf(wire)) === JSON.stringify([kbl.id]) &&
   (await q(`select count(*)::int as n from audit_log where action = 'set_league_news_source' and subject_id = $1`, [wire]))[0].n === 1);
await setPick(kbl.id, tube, true);
ok('the picks come first in the list, saying so', (await offered(kbl.id)).map(r => r.slug + ':' + r.picked).join() === 'tube:true,wire:true,nbl-tube:false');
ok('a creator another league has keeps it: a pick adds this league only', JSON.stringify(await listOf(nblTube)) === JSON.stringify([nbl.id]) &&
   await setPick(kbl.id, nblTube, true) === true && JSON.stringify(await listOf(nblTube)) === JSON.stringify([nbl.id, kbl.id]));
ok('...and taking it off takes this league only', await setPick(kbl.id, nblTube, false) === false && JSON.stringify(await listOf(nblTube)) === JSON.stringify([nbl.id]));
ok('another league\'s administrator cannot touch this league\'s picks', /cannot pick news sources for that league/.test(await fails(() => setPick(kbl.id, wire, false, OTHER)) || '') &&
   JSON.stringify(await listOf(wire)) === JSON.stringify([kbl.id]));
ok('...nor can this one pick for theirs', /cannot pick news sources for that league/.test(await fails(() => setPick(nbl.id, wire, true)) || ''));
ok('...nor read the list for theirs', /cannot pick news sources for that league/.test(await fails(() => offered(nbl.id)) || ''));
ok('a league\'s own source is not picked: it is its league\'s already', /its league's already/.test(await fails(() => setPick(kbl.id, kblNews, true)) || ''));
ok('one the platform switched off is not picked', /switched that source off/.test(await fails(() => setPick(kbl.id, offWire, true)) || '') && JSON.stringify(await listOf(offWire)) === '[]');
ok('a source that is not there is refused', /no such source/.test(await fails(() => setPick(kbl.id, '99999999-9999-9999-9999-999999999999', true)) || ''));
ok('a fan cannot read the list or pick', /cannot pick news sources/.test(await fails(() => offered(kbl.id, FAN)) || '') &&
   /cannot pick news sources/.test(await fails(() => setPick(kbl.id, wire, false, FAN)) || ''));
ok('...and a signed-out caller cannot call either at all', /permission denied/.test(await fails(() => setPick(kbl.id, wire, false, '', 'anon')) || '') &&
   /permission denied/.test(await fails(async () => { await as(''); return q(`select * from public.news_sources_offered($1)`, [kbl.id], 'anon'); }) || ''));
ok('a platform administrator can pick for any league', await setPick(acb.id, tube, true, PLAT) === true && JSON.stringify(await listOf(tube)) === JSON.stringify([kbl.id, acb.id]) &&
   await setPick(acb.id, tube, false, PLAT) === false);
ok('...but not for a league that is not there', /no such league/.test(await fails(() => setPick('99999999-9999-9999-9999-999999999999', tube, true, PLAT)) || ''));

console.log('\none list, two hands');
await as(PLAT);
const platList = await q(`select * from public.news_sources_admin(null)`, [], 'authenticated');
ok('the platform\'s console sees the league\'s pick on its covers row', JSON.stringify(platList.find(r => r.slug === 'wire').assigned_leagues) === JSON.stringify([{ id: kbl.id, name: 'KBL', slug: 'kbl' }]));
await q(`update news_sources set enabled = false where id = $1`, [tube]);
const offOff = await offered(kbl.id);
ok('one the platform switches off after the pick stays in the league\'s list, picked and saying off, to be taken off',
   offOff.some(r => r.slug === 'tube' && r.picked === true && r.enabled === false));
ok('...and taking it off works', await setPick(kbl.id, tube, false) === false && !(await offered(kbl.id)).some(r => r.slug === 'tube'));
await as(PLAT);
await q(`update news_sources set enabled = true where id = $1`, [tube]);
await setPick(kbl.id, tube, true);

console.log('\nwhere a pick shows');
ok('the league\'s news page: every story of a picked source, the ones that name another league too, newest first',
   titles(await pageOf(kbl.id)) === 'Story kn1,Story t1,Story w1,Story w2', titles(await pageOf(kbl.id)));
ok('...not on a league that has not picked it (a story naming it still lands there, as before)', titles(await pageOf(acb.id)) === '' &&
   titles(await pageOf(nbl.id)) === 'Story n1,Story w2', titles(await pageOf(nbl.id)));
const w1 = (await pageOf(kbl.id)).find(r => r.title === 'Story w1');
ok('...a picked story keeps its own league tags: no badge for every league that picked its site', w1.kind === 'outlet' && w1.source_slug === 'wire' && JSON.stringify(w1.leagues) === '[]');
ok('the platform\'s News (no league) is just as it was', (await everyone()).map(r => r.id).sort().join() === everyoneBefore);
ok('the league\'s row of sources: its own and its picks', (await rowOf(kbl.id)).map(r => r.slug).sort().join() === 'kbl-news,tube,wire');
const mine = await mineOf();
ok('a fan who follows the league: the picked sources\' stories in their own feed', /Story w1/.test(titles(mine)) && /Story t1/.test(titles(mine)) && !/Story n1/.test(titles(mine)), titles(mine));
const cc = await creatorsOf(kbl.id);
ok('the Community page\'s content creators: a picked creator, never a picked publisher', /Story t1/.test(titles(cc)) && !/Story w/.test(titles(cc)), titles(cc));
await q(`insert into test_hidden values ($1)`, [kbl.id]);
ok('a league the reader may not see: nothing on its page, picked or not', (await pageOf(kbl.id)).length === 0 && (await rowOf(kbl.id)).length === 0);
await q(`delete from test_hidden`);
await as(PLAT);
await q(`update news_sources set enabled = false where id = $1`, [wire]);
ok('a picked source the platform switches off: gone from the league\'s pages', !/Story w/.test(titles(await pageOf(kbl.id))) && !(await rowOf(kbl.id)).some(r => r.slug === 'wire'));
await as(PLAT);
await q(`update news_sources set enabled = true where id = $1`, [wire]);
await setPick(kbl.id, wire, false);
ok('taken off: its stories leave the page (but the one that names the league would stay)', titles(await pageOf(kbl.id)) === 'Story kn1,Story t1');
await setPick(kbl.id, wire, true);
await as(PLAT);
await q(`select public.set_news_source_leagues($1, $2::uuid[])`, [wire, [nbl.id]], 'authenticated');
ok('the platform\'s covers row writes the same list, whole: a league it leaves out is off', JSON.stringify(await listOf(wire)) === JSON.stringify([nbl.id]) &&
   !/Story w1/.test(titles(await pageOf(kbl.id))) && /Story w1/.test(titles(await pageOf(nbl.id))));

console.log('\nrunning 0209 again');
await setPick(kbl.id, wire, true);
const before = JSON.stringify([await listOf(wire), await listOf(tube)]);
await db.exec(mig('0209_league_picks_sources.sql'));
ok('every pick kept, every page the same', JSON.stringify([await listOf(wire), await listOf(tube)]) === before &&
   titles(await pageOf(kbl.id)) === 'Story kn1,Story t1,Story w1,Story w2');
ok('...and who may call what is as it was', /permission denied/.test(await fails(() => setPick(kbl.id, wire, false, '', 'anon')) || '') &&
   (await pageOf(kbl.id, 'anon')).length === 4 && /permission denied/.test(await fails(async () => { await as(''); return q(`select * from public.news_feed_mine(null, 30)`, [], 'anon'); }) || ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
