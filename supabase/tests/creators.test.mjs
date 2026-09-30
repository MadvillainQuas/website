// 0194: content creators and the news sources, on a real Postgres (PGlite; skipped with a note when it is not
// installed). The migration is loaded on stand-ins for what it calls: auth.uid() and auth.users, profiles,
// audit_log, leagues, news_articles, is_league_admin / is_platform_admin / league_visible (set per test), and
// 0051's own clean_news_body and clean_news_spans, read out of that migration. What is held here:
//   * the league switches creators on, opens an outlet and names its owner by email; nobody else can;
//   * the owner edits the page (links allow-listed, https only) and adds a writer; writers publish; the last
//     owner stays; a piece's body is cleaned as the league's news is, its cover and link are https;
//   * the reader sees a piece only while the league shows creators, the league is visible, the outlet is active
//     and the piece is published and not hidden - and the league's moderation takes it away at once;
//   * news sources: the platform's added by a platform admin, a league's by its administrators; the News page
//     (news_feed) is the league's own news, the creators' pieces and the sources' items, newest first, paged,
//     and a league's page is only its own;
//   * the tables are closed: through the functions only.
//
//   node supabase/tests/creators.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('SKIP  @electric-sql/pglite is not installed'); process.exit(0); }

let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');

/* 0051's own body cleaners, as that migration defines them */
const m51 = mig('0051_news_and_writers.sql');
const fnOf = name => { const i = m51.indexOf('create or replace function public.' + name + '('); const j = m51.indexOf('end; $$;', i); return m51.slice(i, j + 'end; $$;'.length); };

const ADMIN = '11111111-1111-1111-1111-111111111111', OWNER = '22222222-2222-2222-2222-222222222222',
      WRITER = '33333333-3333-3333-3333-333333333333', FAN = '44444444-4444-4444-4444-444444444444',
      PLAT = '55555555-5555-5555-5555-555555555555';
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
const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };
/* jsonb keeps its keys in its own order: compared whatever the order */
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(n => [n, x[n]])) : x));

const [lg] = await q(`insert into leagues (slug, name) values ('el', 'EuroLeague') returning id`);
const [lg2] = await q(`insert into leagues (slug, name) values ('priv', 'A Private League') returning id`);
await q(`insert into auth.users values ($1, 'admin@el.com'), ($2, 'Host@Pod.com'), ($3, 'writer@pod.com'), ($4, 'fan@x.com'), ($5, 'plat@epinoia.com')`,
  [ADMIN, OWNER, WRITER, FAN, PLAT]);
await q(`insert into profiles values ($1, 'The Host')`, [OWNER]);
await db.exec(mig('0194_creators.sql'));

console.log('\nthe league opens an outlet');
await as(FAN);
ok('a fan cannot switch creators on, nor open an outlet', /administer/.test(await fails(() => q(`select public.set_league_creators($1, true)`, [lg.id])) || '') &&
   /administer/.test(await fails(() => q(`select public.create_creator_outlet($1, 'Pod', 'x@y.z')`, [lg.id])) || ''));
await as(ADMIN);
await q(`select public.set_league_creators($1, true)`, [lg.id]);
const [{ id: outlet }] = await q(`select public.create_creator_outlet($1, 'The Hoops Pod!', '  Host@Pod.COM ') as id`, [lg.id]);
const [{ id: outlet2 }] = await q(`select public.create_creator_outlet($1, 'The Hoops Pod', 'other@pod.com') as id`, [lg.id]);
const slugs = await q(`select slug from creator_outlets order by created_at`);
ok('the administrator opens outlets, slugs from their names and unique in the league', slugs.map(r => r.slug).join() === 'the-hoops-pod,the-hoops-pod-2', slugs);
ok('...and names the owner by address, folded', (await q(`select email, role from creator_members where outlet_id = $1`, [outlet]))[0].email === 'host@pod.com');
ok('an address that is not one is refused', /not an email/.test(await fails(() => q(`select public.create_creator_outlet($1, 'X', 'nope')`, [lg.id])) || ''));

console.log('\nthe owner and the writers');
await as(OWNER);
const mine = await q(`select * from public.my_creator_outlets()`);
ok('the owner (signed in as Host@Pod.com) finds the outlet in the hub, as its owner, creators on', mine.length === 1 && mine[0].outlet_id === outlet && mine[0].role === 'owner' && mine[0].enabled === true, mine);
await q(`select public.update_creator_outlet($1, 'The Hoops Pod', 'Every game, every week', 'Two friends and a mic.', 'https://pod.example/logo.png', '#ff6600',
  '{"youtube":"https://youtube.com/@hoopspod","x":"https://x.com/hoopspod","website":"http://insecure.example","myspace":"https://myspace.com/x","instagram":"javascript:alert(1)"}'::jsonb)`, [outlet]);
const [o1] = await q(`select tagline, colour, links from creator_outlets where id = $1`, [outlet]);
ok('the owner edits the page; the links are the known platforms at https addresses and nothing else',
   o1.tagline === 'Every game, every week' && o1.colour === '#ff6600' && JSON.stringify(Object.keys(o1.links).sort()) === '["x","youtube"]', o1.links);
ok('a logo that is not https is refused', /https/.test(await fails(() => q(`select public.update_creator_outlet($1, 'P', '', '', 'http://x/logo.png', null, '{}')`, [outlet])) || ''));
await q(`select public.add_creator_member($1, 'Writer@Pod.com')`, [outlet]);
ok('the last owner stays', /at least one owner/.test(await fails(() => q(`select public.remove_creator_member($1, 'host@pod.com')`, [outlet])) || ''));
await as(WRITER);
ok('a writer cannot change the page or its people', /owner/.test(await fails(() => q(`select public.update_creator_outlet($1, 'P', '', '', null, null, '{}')`, [outlet])) || '') &&
   /owner/.test(await fails(() => q(`select public.add_creator_member($1, 'x@y.z')`, [outlet])) || ''));
const body = [{ type: 'p', spans: [{ t: 'Hello ' }, { t: 'there', b: true, onclick: 'x' }, { t: 'link', href: 'javascript:alert(1)' }] }, { type: 'script', src: 'x' },
              { type: 'image', path: 'team/x/news-1.jpg', caption: 'an upload path: an outlet has none' }, { type: 'image', path: 'javascript:alert(1)' }];
const [{ id: post1 }] = await q(`select public.upsert_creator_post(null, $1, 'article', 'Game 3 preview', 'What to watch', $2::jsonb, 'https://pod.example/cover.jpg', null, 'published') as id`,
  [outlet, JSON.stringify(body)]);
const [p1] = await q(`select body, published_at, author_name, slug from creator_posts where id = $1`, [post1]);
ok('a writer publishes; the body cleaned as the league\'s news is (no unknown block, key or javascript: link), and a picture only an https address',
   canon(p1.body) === canon([{ type: 'p', spans: [{ t: 'Hello ' }, { t: 'there', b: true }, { t: 'link' }] }]) && p1.published_at && p1.slug === 'game-3-preview', p1.body);
{
  const [{ id: pi }] = await q(`select public.upsert_creator_post(null, $1, 'article', 'With a picture', '', $2::jsonb, null, null, 'draft') as id`,
    [outlet, JSON.stringify([{ type: 'image', path: 'https://pod.example/court.jpg', caption: 'The court' }, { type: 'p', spans: [{ t: 'After' }] }])]);
  const [pb] = await q(`select body from creator_posts where id = $1`, [pi]);
  ok('...a picture at an https address stays, with its caption, in its place', canon(pb.body) === canon([{ type: 'image', path: 'https://pod.example/court.jpg', caption: 'The court' }, { type: 'p', spans: [{ t: 'After' }] }]), pb.body);
  await q(`select public.delete_creator_post($1)`, [pi]);
}
ok('...a video, a podcast or a social post needs its address, and every address is https',
   /needs its address/.test(await fails(() => q(`select public.upsert_creator_post(null, $1, 'social', 'Clip', '', '[]', null, null, 'published')`, [outlet])) || '') &&
   /https/.test(await fails(() => q(`select public.upsert_creator_post(null, $1, 'video', 'Clip', '', '[]', null, 'http://youtube.com/watch?v=x', 'published')`, [outlet])) || ''));
const [{ id: post2 }] = await q(`select public.upsert_creator_post(null, $1, 'social', 'The dunk', '', '[]', null, 'https://www.instagram.com/p/ABC123/', 'published') as id`, [outlet]);
const firstPub = (await q(`select published_at from creator_posts where id = $1`, [post1]))[0].published_at;
await q(`select public.upsert_creator_post($1, $2, 'article', 'Game 3 preview', 'What to watch, updated', '[]', null, null, 'published')`, [post1, outlet]);
ok('an edit keeps the moment it was first published', (await q(`select published_at from creator_posts where id = $1`, [post1]))[0].published_at.getTime() === firstPub.getTime());
await as(FAN);
ok('a fan cannot write for it, nor read its studio', /do not write/.test(await fails(() => q(`select public.upsert_creator_post(null, $1, 'article', 'X', '', '[]')`, [outlet])) || '') &&
   /do not write/.test(await fails(() => q(`select public.creator_studio($1)`, [outlet])) || ''));

console.log('\nwhat a reader sees');
await as('');
let pub = await q(`select * from public.creators_public($1, 6, 0)`, [lg.id]);
ok('the league\'s pieces, newest first, with the outlet', pub.length === 2 && pub[0].title === 'The dunk' && pub[0].outlet_name === 'The Hoops Pod' && pub[0].outlet_colour === '#ff6600', pub.map(r => r.title));
const page = (await q(`select public.creator_outlet_public($1, 'the-hoops-pod') as j`, [lg.id]))[0].j;
ok('the outlet\'s page: its links and its pieces, and its id for the follow bell', page && page.links.youtube && page.posts.length === 2 && page.id === outlet);
const one = (await q(`select public.creator_post_public($1, 'the-hoops-pod', 'game-3-preview') as j`, [lg.id]))[0].j;
ok('one piece, with its body, its outlet (and its id) and its league', one && one.title === 'Game 3 preview' && Array.isArray(one.body) &&
   one.outlet.name === 'The Hoops Pod' && one.outlet.id === outlet && one.league.slug === 'el');
ok('the directory names each outlet\'s id too', (await q(`select id from public.creator_outlets_public($1)`, [lg.id]))[0].id === outlet);
ok('an outlet with nothing published is not listed', (await q(`select slug from public.creator_outlets_public($1)`, [lg.id])).map(r => r.slug).join() === 'the-hoops-pod');
ok('the rail\'s question: a row for a league with creators on and something published, none for one without',
   (await q(`select * from public.creators_probe('el')`)).length === 1 && (await q(`select * from public.creators_probe('priv')`)).length === 0 &&
   (await q(`select * from public.creators_probe('nope')`)).length === 0);
await as(ADMIN);
await q(`select public.hide_creator_post($1, true)`, [post2]);
await as('');
ok('the league hides a piece: gone from every read at once', (await q(`select * from public.creators_public($1, 6, 0)`, [lg.id])).length === 1 &&
   (await q(`select public.creator_outlet_public($1, 'the-hoops-pod') as j`, [lg.id]))[0].j.posts.length === 1);
await as(OWNER);
ok('...the outlet still sees it, marked hidden', (await q(`select public.creator_studio($1) as j`, [outlet]))[0].j.posts.some(p => p.hidden === true));
await as(ADMIN);
await q(`select public.set_creator_outlet_status($1, 'suspended')`, [outlet]);
await as('');
ok('a suspended outlet: no pieces, no page', (await q(`select * from public.creators_public($1, 6, 0)`, [lg.id])).length === 0 &&
   (await q(`select public.creator_outlet_public($1, 'the-hoops-pod') as j`, [lg.id]))[0].j === null);
await as(WRITER);
ok('...and its people cannot publish', /suspended/.test(await fails(() => q(`select public.upsert_creator_post(null, $1, 'article', 'X', '', '[]')`, [outlet])) || ''));
await as(ADMIN);
await q(`select public.set_creator_outlet_status($1, 'active')`, [outlet]);
await q(`select public.set_league_creators($1, false)`, [lg.id]);
await as('');
ok('creators switched off: nothing shown, nothing deleted', (await q(`select * from public.creators_public($1, 6, 0)`, [lg.id])).length === 0 &&
   (await q(`select count(*)::int as n from creator_posts`))[0].n === 2);
await as(ADMIN);
await q(`select public.set_league_creators($1, true)`, [lg.id]);
await q(`insert into test_hidden values ($1)`, [lg.id]);
await as('');
ok('a league the reader may not see: nothing', (await q(`select * from public.creators_public($1, 6, 0)`, [lg.id])).length === 0);
await q(`delete from test_hidden`);

console.log('\nnews sources and the News page');
await as(ADMIN);
ok('a league\'s administrator cannot add a source for every reader', /cannot add/.test(await fails(() =>
  q(`select public.add_news_source(null, 'Eurohoops', 'https://www.eurohoops.net', 'https://www.eurohoops.net/en/feed/')`)) || ''));
const [{ id: lsrc }] = await q(`select public.add_news_source($1, 'Local Paper', 'https://paper.example', 'https://paper.example/rss') as id`, [lg.id]);
await as(PLAT);
const [{ id: gsrc }] = await q(`select public.add_news_source(null, 'Eurohoops', 'https://www.eurohoops.net', 'https://www.eurohoops.net/en/feed/') as id`);
ok('the platform adds one for every reader, and each console lists its own', (await q(`select name from public.news_sources_admin(null)`)).map(r => r.name).join() === 'Eurohoops');
await as(FAN);
ok('a fan cannot see the list', /cannot see/.test(await fails(() => q(`select * from public.news_sources_admin($1)`, [lg.id])) || ''));
/* what the fetcher (service role) writes */
await q(`insert into news_items (source_id, guid, url, title, summary, image_url, published_at) values
  ($1, 'g1', 'https://www.eurohoops.net/en/a/1', 'Global story', 'Short excerpt', 'https://images.eurohoops.net/1.jpg', '2026-09-30T10:00:00Z'),
  ($1, 'g2', 'https://www.eurohoops.net/en/a/2', 'Older global story', '', null, '2026-09-20T10:00:00Z'),
  ($2, 'l1', 'https://paper.example/a/1', 'Local story', '', null, '2026-09-29T10:00:00Z')`, [gsrc, lsrc]);
await q(`insert into news_articles (league_id, slug, title, status, published_at) values ($1, 'official', 'Official news', 'published', '2026-09-28T10:00:00Z'),
  ($2, 'hidden-league', 'Private news', 'published', '2026-09-30T11:00:00Z')`, [lg.id, lg2.id]);
await q(`insert into test_hidden values ($1)`, [lg2.id]);
await q(`update creator_posts set published_at = '2026-09-27T10:00:00Z' where id = $1`, [post1]);
await as('');
const feed = await q(`select * from public.news_feed(null, null, 30)`);
ok('the News page: every source, every league\'s creators and own news, newest first; a league the reader may not see left out',
   feed.map(r => r.kind + ':' + r.title).join(' | ') === 'outlet:Global story | outlet:Local story | league:Official news | creator:Game 3 preview | outlet:Older global story',
   feed.map(r => r.kind + ':' + r.title));
ok('...each item links home: the source\'s article and its site', feed[0].url === 'https://www.eurohoops.net/en/a/1' && feed[0].source_url === 'https://www.eurohoops.net' && feed[0].image_url);
ok('...a creator\'s piece names its league and outlet, for its link on the site', feed[3].league_slug === 'el' && feed[3].outlet_slug === 'the-hoops-pod' && feed[3].slug === 'game-3-preview');
const paged = await q(`select * from public.news_feed(null, $1, 2)`, [feed[1].published_at]);
ok('paged: the next two before the last one shown', paged.map(r => r.title).join() === 'Official news,Game 3 preview', paged.map(r => r.title));
const league = await q(`select * from public.news_feed($1, null, 30)`, [lg.id]);
ok('a league\'s own page: its news, its creators and its own sources, not every reader\'s', league.map(r => r.title).join() === 'Local story,Official news,Game 3 preview', league.map(r => r.title));
await as(PLAT);
/* THE LOGO: the fetcher found one and said when it looked; clearing it (or moving the site) has it look again */
await q(`update news_sources set logo_url = 'https://www.eurohoops.net/apple-touch-icon.png', logo_checked_at = now() where id = $1`, [gsrc]);
await q(`select public.update_news_source($1, 'Eurohoops', 'https://www.eurohoops.net', 'https://www.eurohoops.net/en/feed/', 'https://www.eurohoops.net/apple-touch-icon.png', null, true)`, [gsrc]);
ok('an edit that keeps the logo keeps when it was found', (await q(`select logo_checked_at from news_sources where id = $1`, [gsrc]))[0].logo_checked_at !== null);
await q(`select public.update_news_source($1, 'Eurohoops', 'https://www.eurohoops.net', 'https://www.eurohoops.net/en/feed/', null, null, false)`, [gsrc]);
ok('...clearing the logo has the fetcher look for it again on its next read',
   (await q(`select logo_url, logo_checked_at from news_sources where id = $1`, [gsrc]))[0].logo_checked_at === null);
await as('');
ok('a disabled source leaves the page', !(await q(`select * from public.news_feed(null, null, 30)`)).some(r => r.source_name === 'Eurohoops'));

console.log('\nfollowing a publisher or an outlet, and what it brings');
{
  await q(`delete from test_hidden`);
  await as(PLAT);
  await q(`select public.update_news_source($1, 'Eurohoops', 'https://www.eurohoops.net', 'https://www.eurohoops.net/en/feed/', null, '#e30613', true)`, [gsrc]);
  await as(FAN);
  await q(`select public.set_fan_prefs($1::jsonb)`, [JSON.stringify({ fav_source_ids: [gsrc], fav_outlet_ids: [outlet], want_results: false })]);
  const [fp] = await q(`select fav_source_ids, fav_outlet_ids, want_news, want_results from fan_prefs where user_id = $1`, [FAN]);
  ok('a fan follows a publisher and an outlet through set_fan_prefs, which still takes everything it took', fp.fav_source_ids[0] === gsrc && fp.fav_outlet_ids[0] === outlet &&
     fp.want_news === true && fp.want_results === false, fp);
  await as(ADMIN);
  await q(`select public.set_fan_prefs($1::jsonb)`, [JSON.stringify({ fav_outlet_ids: [outlet] })]);
  await as(WRITER);
  await q(`select public.set_fan_prefs($1::jsonb)`, [JSON.stringify({ fav_outlet_ids: [outlet] })]);   // follows the outlet they write for
  const [{ id: post3 }] = await q(`select public.upsert_creator_post(null, $1, 'social', 'The block', 'What a rejection. Watch it.', '[]', null, 'https://www.tiktok.com/@hoopspod/video/7300000000000000000', 'published') as id`, [outlet]);
  let notes = await q(`select user_id, kind, title, body, link from notifications where kind = 'creator' order by user_id`);
  ok('an outlet\'s new piece: a notice to each follower, with the caption, opening its page (where the post is embedded)',
     notes.length === 2 && notes.every(n => n.title === 'The Hoops Pod' && n.body === 'What a rejection. Watch it.' && n.link === 'creators/?l=el&o=the-hoops-pod&p=the-block'), notes);
  ok('...and not to the person who published it', !notes.some(n => n.user_id === WRITER));
  await q(`select public.upsert_creator_post($1, $2, 'social', 'The block', 'Edited caption', '[]', null, 'https://www.tiktok.com/@hoopspod/video/7300000000000000000', 'published')`, [post3, outlet]);
  ok('an edit tells nobody again', (await q(`select count(*)::int as n from notifications where kind = 'creator'`))[0].n === 2);
  const [{ id: draft }] = await q(`select public.upsert_creator_post(null, $1, 'article', 'A draft', 'Soon', '[]', null, null, 'draft') as id`, [outlet]);
  ok('...nor does a draft', (await q(`select count(*)::int as n from notifications where kind = 'creator'`))[0].n === 2);
  await q(`select public.upsert_creator_post($1, $2, 'article', 'A draft', 'Out now', '[]', null, null, 'published')`, [draft, outlet]);
  notes = await q(`select body, link from notifications where kind = 'creator' and ref = $1`, [draft]);
  ok('...until it is published: an article\'s notice is its headline and its standfirst', notes.length === 2 && notes[0].body === 'A draft — Out now' &&
     notes[0].link === 'creators/?l=el&o=the-hoops-pod&p=a-draft', notes);

  /* the fetcher's writes, as the service role makes them */
  const recent = new Date(Date.now() - 3600e3).toISOString(), old = new Date(Date.now() - 72 * 3600e3).toISOString();
  const [{ id: fresh1 }] = await q(`insert into news_items (source_id, guid, url, title, summary, published_at) values
    ($1, 'n1', 'https://www.eurohoops.net/en/a/n1', 'Motiejunas joins PAOK', 'A one-year deal.', $2) returning id`, [gsrc, recent]);
  notes = await q(`select user_id, title, body, link from notifications where kind = 'news'`);
  ok('a publisher\'s new story: a notice to its follower, the headline and the excerpt, opening the story\'s page on the site',
     notes.length === 1 && notes[0].user_id === FAN && notes[0].title === 'Eurohoops' && notes[0].body === 'Motiejunas joins PAOK — A one-year deal.' &&
     notes[0].link === 'news/?i=' + fresh1, notes);
  await q(`insert into news_items (source_id, guid, url, title, published_at) values
    ($1, 'n2', 'https://x/2', 'Story two', $2), ($1, 'n3', 'https://x/3', 'Story three', $2), ($1, 'n4', 'https://x/4', 'Old story', $3)`, [gsrc, recent, old]);
  notes = await q(`select title, body, link from notifications where kind = 'news' order by created_at desc, title desc`);
  ok('several in one read: one notice naming them, opening the publisher\'s page; a story from days ago is not news',
     notes.length === 2 && notes[0].title === 'Eurohoops · 2 new stories' && /Story/.test(notes[0].body) && !/Old story/.test(notes[0].body) &&
     notes[0].link === 'news/?s=eurohoops', notes);
  await as(PLAT);
  const [{ id: nsrc }] = await q(`select public.add_news_source(null, 'New Site', 'https://new.example', 'https://new.example/rss') as id`);
  await as(FAN);
  await q(`select public.set_fan_prefs($1::jsonb)`, [JSON.stringify({ fav_source_ids: [gsrc, nsrc] })]);
  await q(`insert into news_items (source_id, guid, url, title, published_at) values ($1, 'a', 'https://new.example/a', 'First read A', $2), ($1, 'b', 'https://new.example/b', 'First read B', $2)`, [nsrc, recent]);
  ok('a source\'s first read is its back catalogue: nobody is told', (await q(`select count(*)::int as n from notifications where kind = 'news' and title like 'New Site%'`))[0].n === 0);
  await q(`update fan_prefs set want_news = false where user_id = $1`, [FAN]);
  await q(`insert into news_items (source_id, guid, url, title, published_at) values ($1, 'n5', 'https://x/5', 'Story five', $2)`, [gsrc, recent]);
  ok('the switch off: nothing', (await q(`select count(*)::int as n from notifications where kind = 'news'`))[0].n === 2);

  await as('');
  const pubPage = (await q(`select public.news_source_public('eurohoops', null, 30) as j`))[0].j;
  ok('the publisher\'s page: itself, its home site, and its stories newest first', pubPage.name === 'Eurohoops' && pubPage.site_url === 'https://www.eurohoops.net' &&
     pubPage.colour === '#e30613' && pubPage.items.length === 7 && pubPage.items[pubPage.items.length - 1].title === 'Older global story', pubPage.items.map(i => i.title));
  const story = (await q(`select public.news_item_public($1) as j`, [fresh1]))[0].j;
  ok('one story: its excerpt, its link on the publisher\'s site, and the publisher', story.url === 'https://www.eurohoops.net/en/a/n1' && story.summary === 'A one-year deal.' &&
     story.source.slug === 'eurohoops');
  const outs = await q(`select source_slug, source_name from public.news_feed(null, null, 60) where kind = 'outlet'`);
  ok('the feed names each story\'s publisher page', outs.length > 0 && outs.every(r => r.source_slug) &&
     outs.some(r => r.source_slug === 'eurohoops' && r.source_name === 'Eurohoops'), outs);
  ok('...and gives one kind when asked (the News page\'s chips)', (await q(`select distinct kind from public.news_feed(null, null, 30, array['creator'])`)).map(r => r.kind).join() === 'creator');

  /* A STORY ABOUT A LEAGUE, from a site that covers everything: on that league's page, named on its card */
  const [ll] = await q(`insert into leagues (slug, name) values ('acb', 'Liga Endesa') returning id`);
  await q(`update news_items set league_ids = array[$1::uuid] where guid = 'g2'`, [ll.id]);
  const acb = await q(`select title, league_slug, source_name from public.news_feed($1, null, 30)`, [ll.id]);
  ok('a publisher\'s story tagged to a league is on that league\'s news page, named for it',
     acb.length === 1 && acb[0].title === 'Older global story' && acb[0].league_slug === 'acb' && acb[0].source_name === 'Eurohoops', acb);
  ok('...and not on another league\'s', !(await q(`select title from public.news_feed($1, null, 30)`, [lg.id])).some(r => r.title === 'Older global story'));
  const g2 = (await q(`select id from news_items where guid = 'g2'`))[0].id;
  const [was] = await q(`select published_at, fetched_at from news_items where id = $1`, [g2]);
  await q(`insert into news_items (source_id, guid, url, title, published_at, fetched_at)
           select source_id, guid, url, 'Older global story (corrected)', now(), now() + interval '1 day' from news_items where id = $1
           on conflict (source_id, guid) do update set title = excluded.title, published_at = excluded.published_at, fetched_at = excluded.fetched_at`, [g2]);
  const [kept] = await q(`select title, published_at, fetched_at from news_items where id = $1`, [g2]);
  ok('a re-read takes the new headline but never moves the story up the page, and keeps when it was first read',
     kept.title === 'Older global story (corrected)' && +new Date(kept.published_at) === +new Date(was.published_at) &&
     +new Date(kept.fetched_at) === +new Date(was.fetched_at), [was, kept]);
  await q(`update news_items set title = 'Older global story' where id = $1`, [g2]);
  const tagged = (await q(`select public.news_item_public($1) as j`, [g2]))[0].j;
  ok('the story names the leagues it is about (each links to that league\'s news)',
     Array.isArray(tagged.leagues) && tagged.leagues.length === 1 && tagged.leagues[0].slug === 'acb' && tagged.leagues[0].name === 'Liga Endesa', tagged.leagues);
  const tagRow = (await q(`select leagues from public.news_feed(null, null, 60) where title = 'Older global story'`))[0];
  ok('THE CARD\'S TAGS: the feed carries every league a story is about', tagRow && tagRow.leagues.map(l => l.slug).join() === 'acb', tagRow);
  const [ll2] = await q(`insert into leagues (slug, name) values ('lnb', 'Betclic Elite') returning id`);
  await q(`update news_items set league_ids = array[$1::uuid, $2::uuid] where guid = 'g2'`, [ll2.id, ll.id]);
  ok('...in the order the fetcher ranked them',
     (await q(`select leagues from public.news_feed(null, null, 60) where title = 'Older global story'`))[0].leagues.map(l => l.slug).join() === 'lnb,acb');
  await q(`update news_items set league_ids = array[$1::uuid] where guid = 'g2'`, [ll.id]);
  const byKind = await q(`select kind, jsonb_array_length(leagues) as n, leagues->0->>'slug' as first from public.news_feed(null, null, 60)`);
  ok('...a creator\'s piece is tagged with its league, the league\'s own article with none (it is the league\'s already)',
     byKind.filter(r => r.kind === 'creator').every(r => r.n === 1 && r.first === 'el') && byKind.filter(r => r.kind === 'league').every(r => r.n === 0), byKind);
  ok('...and the publisher\'s page carries them too',
     (await q(`select public.news_source_public('eurohoops', null, 60) as j`))[0].j.items.find(i => i.title === 'Older global story').leagues[0].slug === 'acb');
  const pubs = await q(`select slug, name, items::int as items from public.news_sources_public(null)`);
  ok('the publishers row: every source on with a story, never an empty or disabled one',
     pubs.some(r => r.slug === 'eurohoops' && r.items === 7) && !pubs.some(r => r.items === 0), pubs);
  ok('...and a league\'s: its own sources and the ones with a story about it',
     (await q(`select slug from public.news_sources_public($1)`, [ll.id])).map(r => r.slug).join() === 'eurohoops');
  /* A LEAGUE'S OWN SOURCE, a story of which is about another league: that league's page carries it too */
  const [{ id: own }] = await q(`insert into news_sources (league_id, slug, name, site_url, feed_url) values ($1, 'el-own', 'EL own', 'https://el.example', 'https://el.example/feed') returning id`, [lg.id]);
  await q(`insert into news_items (source_id, guid, url, title, published_at, league_ids) values ($1, 'x1', 'https://el.example/1', 'An EL story about ACB', now() - interval '1 hour', array[$2::uuid])`, [own, ll.id]);
  ok('a league\'s own source\'s story about another league is on that league\'s page too, and on its own',
     (await q(`select title from public.news_feed($1, null, 60)`, [ll.id])).some(r => r.title === 'An EL story about ACB') &&
     (await q(`select title from public.news_feed($1, null, 60)`, [lg.id])).some(r => r.title === 'An EL story about ACB'));
  ok('...tagged with both leagues, its own first', (await q(`select leagues from public.news_feed(null, null, 60) where title = 'An EL story about ACB'`))[0].leagues.map(l => l.slug).join() === 'el,acb');
  await q(`delete from news_sources where id = $1`, [own]);

  /* HOME's FEED, "Followed": what the reader follows, and nothing else */
  await as(FAN);
  let mine = await q(`select kind, title from public.news_feed_mine(null, 30)`);
  ok('the followed feed: the publisher and the outlet the fan follows', mine.length > 0 && mine.every(r => r.kind === 'outlet' || r.kind === 'creator') &&
     !mine.some(r => r.title === 'Local story' || r.title === 'Official news'), mine.map(r => r.kind + ':' + r.title));
  const [club] = await q(`insert into teams (league_id) values ($1) returning id`, [lg.id]);
  await q(`select public.set_fan_prefs($1::jsonb)`, [JSON.stringify({ fav_team_ids: [club.id], fav_source_ids: [], fav_outlet_ids: [] })]);
  mine = await q(`select kind, title from public.news_feed_mine(null, 30)`);
  await q(`update news_items set league_ids = array[$1::uuid] where guid = 'g1'`, [lg.id]);
  ok('...a publisher\'s story about a followed league comes too', (await q(`select title from public.news_feed_mine(null, 30)`)).some(r => r.title === 'Global story'));
  ok('...a followed club brings its league: its own news, its creators and its own sources, not every reader\'s',
     mine.some(r => r.title === 'Official news') && mine.some(r => r.title === 'Local story') && mine.some(r => r.kind === 'creator') &&
     !mine.some(r => r.title === 'Older global story'), mine.map(r => r.kind + ':' + r.title));
  await as('');
  ok('...signed out: closed (the signed-out may not call it)',
     !(await q(`select has_function_privilege('anon', 'public.news_feed_mine(timestamptz, int)', 'execute') as ok`))[0].ok);
}

console.log('\nthe sources to start with (0195)');
{
  await as('');
  await q(`insert into leagues (slug, name) values ('nbl', 'NBL') on conflict do nothing`);
  const before = (await q(`select count(*)::int as n from news_sources`))[0].n;
  await db.exec(mig('0195_news_sources.sql'));
  const seeded = await q(`select s.slug, s.league_id, l.slug as league, s.logo_url, s.logo_checked_at, s.site_url, s.feed_url, s.colour
                            from news_sources s left join leagues l on l.id = s.league_id`);
  const by = Object.fromEntries(seeded.map(r => [r.slug, r]));
  ok('the news sites and the leagues\' own are added; one already there (Eurohoops, by its slug) is left as it was',
     seeded.length - before === 29 && by.basketnews && by['b-league'] && by.eurohoops.feed_url === 'https://www.eurohoops.net/en/feed/' && by.eurohoops.site_url === 'https://www.eurohoops.net',
     seeded.length - before);
  ok('...a league\'s own feed belongs to that league when it is on Epinoia, and is every reader\'s when it is not',
     by['nbl-australia'].league === 'nbl' && by['b-league'].league_id === null && by.basketnews.league_id === null);
  ok('...each with its logo (said to be looked for already) and every address and colour as the table requires',
     by.basketnews.logo_url && by.basketnews.logo_checked_at && by['u-sports'].logo_url === null && by['u-sports'].logo_checked_at === null &&
     seeded.every(r => /^https?:\/\//.test(r.site_url) && /^https?:\/\//.test(r.feed_url) && (!r.logo_url || /^https:\/\//.test(r.logo_url)) && (!r.colour || /^#[0-9a-f]{6}$/i.test(r.colour))));
  await db.exec(mig('0195_news_sources.sql'));
  ok('...and running it again adds nothing', (await q(`select count(*)::int as n from news_sources`))[0].n === seeded.length);
}

console.log('\nset_fan_prefs is 0161\'s and more');
{
  const keysOf = sql => { const i = sql.indexOf('create or replace function public.set_fan_prefs'); const j = sql.indexOf('$$;', sql.indexOf('$$', i) + 2);
    const body = sql.slice(i, j); return new Set([...body.matchAll(/p \? '(\w+)'|p->>?'(\w+)'/g)].map(m => m[1] || m[2])); };
  const before = keysOf(mig('0161_favourites_prompt.sql')), after = keysOf(mig('0194_creators.sql'));
  const lost = [...before].filter(k => !after.has(k));
  ok('every key 0161\'s set_fan_prefs took, 0194\'s still takes (and the three new ones)', before.size > 15 && lost.length === 0 &&
     ['fav_source_ids', 'fav_outlet_ids', 'want_news'].every(k => after.has(k)), lost);
}

console.log('\nadding a publisher or a creator by its link (0198)');
await db.exec(mig('0198_news_by_link.sql'));
await as(FAN);
ok('a fan cannot add one', /cannot add/.test(await fails(() => q(`select public.add_news_link(null, 'https://www.youtube.com/@Hoops', 'creator')`)) || ''));
await as(PLAT);
ok('Instagram, TikTok, X, Threads, Facebook and Spotify are refused with the reason, before anything is stored',
   /Instagram publishes no feed/.test(await fails(() => q(`select public.add_news_link(null, 'https://www.instagram.com/hoopsfan/', 'creator')`)) || '') &&
   /TikTok publishes no feed/.test(await fails(() => q(`select public.add_news_link(null, 'https://www.tiktok.com/@hoopsfan', 'creator')`)) || '') &&
   /X publishes no feed/.test(await fails(() => q(`select public.add_news_link(null, 'https://x.com/hoopsfan', 'creator')`)) || '') &&
   /Threads publishes/.test(await fails(() => q(`select public.add_news_link(null, 'https://www.threads.net/@hoopsfan', 'creator')`)) || '') &&
   /Facebook publishes/.test(await fails(() => q(`select public.add_news_link(null, 'https://m.facebook.com/hoopsfan', 'creator')`)) || '') &&
   /Spotify publishes/.test(await fails(() => q(`select public.add_news_link(null, 'https://open.spotify.com/show/abc', 'creator')`)) || '') &&
   (await q(`select count(*)::int as n from news_sources where resolve_from is not null`))[0].n === 0);
ok('...and a link is a whole https address, a source a publisher or a creator',
   /whole link/.test(await fails(() => q(`select public.add_news_link(null, 'youtube.com/@Hoops', 'creator')`)) || '') &&
   /publisher or a creator/.test(await fails(() => q(`select public.add_news_link(null, 'https://www.youtube.com/@Hoops', 'channel')`)) || ''));
const yt = (await q(`select public.add_news_link(null, 'https://www.youtube.com/@HoopsChannel', 'creator') as j`))[0].j;
const bs = (await q(`select public.add_news_link(null, 'https://bsky.app/profile/hoops.example', 'creator') as j`))[0].j;
const site = (await q(`select public.add_news_link(null, 'https://www.basketnews.example/', 'publisher', 'Basket News') as j`))[0].j;
ok('any other link is taken, with a stand-in name until the first read (a handle, or the site\'s name)',
   yt.name === '@HoopsChannel' && bs.name === '@hoops.example' && site.name === 'Basket News' &&
   (await q(`select name_auto, resolve_from, feed_url, kind from news_sources where id = $1`, [yt.id]))[0].name_auto === true &&
   (await q(`select name_auto from news_sources where id = $1`, [site.id]))[0].name_auto === false, [yt, bs, site]);
ok('...the same link twice is refused', /already/.test(await fails(() => q(`select public.add_news_link(null, 'https://www.youtube.com/@HoopsChannel', 'creator')`)) || ''));
const adm = await q(`select * from public.news_sources_admin(null)`);
ok('the console lists it as waiting for its first read, a creator', (() => { const r = adm.find(x => x.id === yt.id);
   return r && r.kind === 'creator' && r.resolve_from === 'https://www.youtube.com/@HoopsChannel' && r.platform === null; })(), adm);
/* what the reader writes once it has found the feed */
await q(`update news_sources set feed_url = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv', resolve_from = null,
         platform = 'youtube', name = 'Hoops Channel', name_auto = false where id = $1`, [yt.id]);
await q(`insert into news_items (source_id, guid, url, title, summary, image_url, published_at) values
  ($1, 'yt:video:abc', 'https://www.youtube.com/watch?v=abcdefghijk', 'Game 3 breakdown', 'Every possession of the fourth quarter',
   'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', '2026-09-30T12:00:00Z')`, [yt.id]);
await as('');
const top = (await q(`select * from public.news_feed(null, null, 30)`)).find(r => r.title === 'Game 3 breakdown') || {};
ok('its posts come out of the News page as a creator\'s channel, with the platform', top.kind === 'channel' && top.piece_kind === 'youtube' &&
   top.title === 'Game 3 breakdown' && top.source_name === 'Hoops Channel', top);
ok('...under "Creators", not "Publishers"', !(await q(`select * from public.news_feed(null, null, 30, array['outlet'])`)).some(r => r.id === top.id) &&
   (await q(`select * from public.news_feed(null, null, 30, array['channel'])`)).map(r => r.title).join() === 'Game 3 breakdown');
ok('...its page and each story say it is a creator\'s, on YouTube',
   (await q(`select public.news_source_public($1) as j`, [ (await q(`select slug from news_sources where id = $1`, [yt.id]))[0].slug ]))[0].j.kind === 'creator' &&
   (await q(`select public.news_item_public($1) as j`, [top.id]))[0].j.source.platform === 'youtube' &&
   (await q(`select kind, platform from public.news_sources_public(null) where id = $1`, [yt.id]))[0].kind === 'creator');
await as(FAN);
await q(`insert into fan_prefs (user_id, fav_source_ids) values ($1, array[$2::uuid])
         on conflict (user_id) do update set fav_source_ids = array[$2::uuid], fav_league_ids = '{}', fav_team_ids = '{}', fav_outlet_ids = '{}'`, [FAN, yt.id]);
ok('a fan following it gets its posts in their own feed, as a creator\'s', (await q(`select kind, title from public.news_feed_mine(null, 30)`))
   .some(r => r.kind === 'channel' && r.title === 'Game 3 breakdown'));
ok('...and a fan cannot turn it into a publisher', /cannot change/.test(await fails(() => q(`select public.set_news_source_kind($1, 'publisher')`, [yt.id])) || ''));
await as(PLAT);
await q(`select public.set_news_source_kind($1, 'publisher')`, [yt.id]);
await as('');
ok('the console can call a source a publisher instead: its posts move to "Publishers"',
   (await q(`select kind from public.news_feed(null, null, 30) where id = $1`, [top.id]))[0].kind === 'outlet');
await as(PLAT);
await q(`select public.set_news_source_kind($1, 'creator')`, [yt.id]);
ok('only the console may add by link or change the kind', !(await q(`select has_function_privilege('anon', 'public.add_news_link(uuid, text, text, text)', 'execute') as ok`))[0].ok &&
   !(await q(`select has_function_privilege('anon', 'public.set_news_source_kind(uuid, text)', 'execute') as ok`))[0].ok &&
   (await q(`select has_function_privilege('anon', 'public.news_feed(uuid, timestamptz, integer, text[])', 'execute') as ok`))[0].ok);

console.log('\nwho may touch what');
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`))[0].ok;
ok('the signed-out may read (the public reads) and may not write', await priv('anon', 'public.creators_public(uuid, int, int)') && await priv('anon', 'public.news_feed(uuid, timestamptz, int, text[])') &&
   await priv('anon', 'public.news_sources_public(uuid)') && await priv('anon', 'public.news_item_public(uuid)') &&
   !(await priv('anon', 'public.upsert_creator_post(uuid, uuid, text, text, text, jsonb, text, text, text, text)')) && !(await priv('anon', 'public.add_news_source(uuid, text, text, text, text, text)')));
ok('the tables are shut: through the functions only', !(await q(`select has_table_privilege('anon', 'public.creator_posts', 'select') as ok`))[0].ok &&
   !(await q(`select has_table_privilege('authenticated', 'public.news_items', 'select') as ok`))[0].ok &&
   (await q(`select bool_and(relrowsecurity) as ok from pg_class where relname in ('creator_outlets','creator_members','creator_posts','news_sources','news_items')`))[0].ok);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
