// 0197: a fan's public profile and a league's Discord, on a real Postgres (PGlite; skipped with a note when it is
// not installed). The migration is loaded on stand-ins for what it calls: auth.uid(), auth.users and
// auth.identities, usernames and go_settings (0163, 0166, 0177), go_numbers / go_leaderboard (their answers set per
// test), go_photos, fan_prefs, leagues and teams, league_visible / is_league_admin, and the real go_caption_ok
// (0167) and clean_creator_links (0194), read out of their migrations. What is held here:
//   * a fan's own profile offers what their social accounts say (a name, a handle, a picture per provider);
//   * saving: only the keys sent change; the name and the line pass the word list; a picture is https; the links
//     are the allow-listed platforms; the club is one the fan may see;
//   * Discord comes from the linked identity, never typed; unlinking clears it;
//   * the page: nobody unless public on GO (username, 18 or over, public); the stamps only if shown; follows only if
//     shown and only public leagues; the GO numbers and the rank;
//   * a league's Discord servers, any number up to 12 and any server: its administrators attach, change, order and
//     take them off (each checked), and the league's Community page reads them;
//   * the table is closed, and who may call what.
//
//   node supabase/tests/fan-profiles.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

/* ---- the pages' wiring: read as text, so it runs with or without PGlite ---- */
{
  const page = p => readFileSync(path.join(here, '..', '..', p), 'utf8');
  const csp = html => ((html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/) || [])[1] || '');
  const scripts = html => [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]);
  const sql = readFileSync(path.join(here, '..', 'migrations', '0197_fan_profiles.sql'), 'utf8');
  const defined = n => sql.includes('create or replace function public.' + n + '(');
  console.log('the pages');

  const fanHtml = page('epinoia/fan/index.html'), fanJs = page('epinoia/fan/fan-page.js');
  const fs1 = scripts(fanHtml);
  ok('a fan\'s page loads the card, GO\'s stamp card, its own script and the rail, in that order',
     ['../config.js', '../newscard.js', '../go/stampcard.js', 'fan-page.js', '../nav.js'].every(x => fs1.includes(x)) &&
     fs1.indexOf('../newscard.js') < fs1.indexOf('fan-page.js') && fs1.indexOf('../go/stampcard.js') < fs1.indexOf('fan-page.js'), fs1);
  ok('...frames nothing, and talks only to the database', !/frame-src/.test(csp(fanHtml)) && /default-src 'self'/.test(csp(fanHtml)) &&
     /connect-src 'self' https:\/\/\*\.supabase\.co/.test(csp(fanHtml)), csp(fanHtml));
  ok('...reads the page and GO\'s feed, and writes no markup', /rpc\('fan_profile_public'/.test(fanJs) && /rpc\('go_feed'/.test(fanJs) &&
     !/innerHTML|insertAdjacentHTML|document\.write/.test(fanJs));
  ok('...links a Discord account only by its number', /\/\^\[0-9\]\{15,22\}\$\/\.test\(String\(d\.id/.test(fanJs) && /discord\.com\/users\//.test(fanJs));
  ok('...and is translated with GO\'s words', /i18n\.js\?v=\d+" data-i18n-packs="go"/.test(fanHtml));

  const cmHtml = page('epinoia/community/index.html'), cmJs = page('epinoia/community/community-page.js');
  const nbJs = page('epinoia/go/nearby/nearby.js');
  ok('a league\'s Community page frames Google\'s map (Find a game) and discord.com and nothing else, and asks Discord for nothing but invitations',
     (csp(cmHtml).match(/frame-src[^;]*/) || [''])[0].trim() === 'frame-src https://www.google.com https://discord.com' &&
     /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co https:\/\/discord\.com(;|$)/.test(csp(cmHtml)) &&
     (cmJs.match(/https:\/\/discord\.com\/[a-z0-9\/]*/g) || []).every(u => u === 'https://discord.com/api/v10/invites/' || u === 'https://discord.com/widget') &&
     /credentials: 'omit'/.test(cmJs), csp(cmHtml));
  ok('...Find a game is EPINOIA GO\'s own module, for the league\'s games only: the page marks its strip, GO reads the league from the address',
     /id="nbStrip" data-scope="league"/.test(cmHtml) && ['nbWhere', 'nbHere', 'nbLocate', 'nbPassport', 'nbPlaces', 'nbQuery', 'nbList', 'nbWhen', 'nbCount', 'nbDetail', 'nbSub']
       .every(id => cmHtml.includes('id="' + id + '"')) &&
     scripts(cmHtml).indexOf('../go/nearby/nearby.js') > scripts(cmHtml).indexOf('community-page.js') &&
     /strip\.dataset\.scope !== 'league'/.test(nbJs) && /competitions!inner\(name,season_id,seasons!inner\(leagues!inner\(/.test(nbJs) &&
     /'&competitions\.seasons\.leagues\.slug=eq\.' \+ encodeURIComponent\(league\)/.test(nbJs), scripts(cmHtml));
  ok('...the stands are GO\'s feed and the board GO\'s leaderboard by distance, both for the league; each fan to their page',
     /rpc\('go_feed', \{ p_league: L\.id/.test(cmJs) && /rpc\('go_leaderboard', \{ p_league: L\.id, p_by: 'km'/.test(cmJs) &&
     /who\.href = '\.\.\/fan\/\?u=' \+ encodeURIComponent\(r\.username\)/.test(cmJs) && /SC\.build\(row/.test(cmJs));
  ok('...the league\'s Discord servers: a widget only for an id that is a number, sandboxed; every server a card',
     /const hasWidget = s => ID\.test\(String\(s\.server_id/.test(cmJs) &&
     /frame\.src = 'https:\/\/discord\.com\/widget\?id=' \+ s\.server_id/.test(cmJs) && /if \(!frame \|\| !s \|\| !hasWidget\(s\)\) return;/.test(cmJs) &&
     /setAttribute\('sandbox'/.test(cmJs) && /rpc\('league_discord_public'/.test(cmJs) && /ICON\.test\(String\(s\.icon_url/.test(cmJs) &&
     /join\.target = '_blank'; join\.rel = 'noopener noreferrer'/.test(cmJs) && /This invitation has expired\./.test(cmJs) &&
     !/innerHTML|insertAdjacentHTML|document\.write/.test(cmJs));
  ok('...the page loads GO\'s parts before its own script and the card, and the go, game and report words',
     ['../config.js', '../access.js', '../data.js', '../game/preview.js', '../newscard.js', '../go/stampcard.js', 'community-page.js', '../nav.js']
       .every(x => scripts(cmHtml).includes(x)) && /data-i18n-packs="go game report"/.test(cmHtml) &&
     ['../go/go.css', '../go/nearby/nearby.css', '../go/stampcard.css', '../kit/community.css'].every(x => cmHtml.includes(x + '?v=')));

  const nav = page('epinoia/nav.js');
  ok('the rail: a community row on every league (Find a game is there whenever it has games); the forum row is gone',
     /href: 'community\/',[^\n]*key: 'community'/.test(nav) && !/href: 'community\/',[^\n]*probe:/.test(nav) && !/'forum\/'|kind === 'forum'/.test(nav));

  /* YOUR PAGE lives on PROFILE (profile/) since 2026-09-30; me/ is PERSONALISATION and forwards #fanprofile there */
  const pfHtml = page('epinoia/profile/index.html'), pfJs = page('epinoia/profile/profile.js'), fp = page('epinoia/me/fanprofile.js');
  const meHtml = page('epinoia/me/index.html'), meJs = page('epinoia/me/me.js');
  const ms = scripts(pfHtml);
  ok('PROFILE: a "Your page" section and "Your public page", the editor loaded before profile.js and mounted by it',
     /id="fanprofile"/.test(pfHtml) && /id="fpHost"/.test(pfHtml) && /id="public"/.test(pfHtml) && /id="fpState"/.test(pfHtml) &&
     ms.includes('../me/fanprofile.js') && ms.indexOf('../me/fanprofile.js') < ms.indexOf('profile.js') &&
     ms.includes('../newscard.js') && /EpinoiaFanProfileEditor|E\.mount\(\{ host: '#fpHost', sec: '#fanprofile', state: '#fpState'/.test(pfJs) &&
     /mount\(\{ host: '#fpHost', sec: '#fanprofile', state: '#fpState', stateSec: '#public', sb \}\)/.test(pfJs), ms);
  ok('...me/ no longer carries the editor, and forwards an old #fanprofile to PROFILE',
     !/id="fanprofile"|fanprofile\.js/.test(meHtml) && /'#fanprofile': '#fanprofile'/.test(meJs) && /\.\.\/profile\//.test(meJs));
  ok('...a fan\'s page points its reader at their own on PROFILE', /href="\.\.\/profile\/#fanprofile"/.test(page('epinoia/fan/index.html')));
  ok('...the editor reads, syncs Discord and saves through the functions', /sb\.rpc\('my_fan_profile'\)/.test(fp) &&
     /sb\.rpc\('sync_fan_discord'\)/.test(fp) && /sb\.rpc\('set_fan_profile'/.test(fp) &&
     /linkIdentity\(\{ provider: 'discord'/.test(fp) && !/innerHTML|insertAdjacentHTML/.test(fp));

  const si = page('epinoia/signin/index.html'), sj = page('epinoia/signin/signin.js');
  ok('sign-in: a Discord button, offered only when the provider is on and never in the iOS app',
     /id="discord"/.test(si) && /provider: 'discord'/.test(sj) && /googleInIOSApp\(\) \|\| !\(await providers\(\)\)\.discord/.test(sj));

  const adm = page('epinoia/admin/index.html'), admJs = page('epinoia/admin/admin.js'), cu = page('epinoia/admin/creators-ui.js');
  ok('the league console: a Discord panel that attaches, changes, orders and takes off servers', /id="forumPanel"/.test(adm) &&
     /mountForum\(\{ host: '#forumPanel'/.test(admJs) && ['save_league_discord', 'move_league_discord', 'remove_league_discord',
     'league_discords_admin'].every(f => cu.includes("sb.rpc('" + f + "'")) && /mountSources, mountForum/.test(cu) &&
     /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co https:\/\/discord\.com"/.test(adm));

  const go = page('epinoia/go/go.js');
  ok('the GO leaderboard links each name to their page', /who\.href = '\.\.\/fan\/\?u=' \+ encodeURIComponent\(x\.username\)/.test(go));

  ok('every function the pages call is in the migration', ['fan_profile_public', 'my_fan_profile', 'set_fan_profile', 'sync_fan_discord',
     'league_discord_public', 'league_discord_probe', 'save_league_discord', 'remove_league_discord', 'move_league_discord',
     'league_discords_admin'].every(defined));
}

/* ---- the console reads a pasted invitation from Discord (its answer's real shape, 2026-09-30) ---- */
{
  const { createRequire } = await import('node:module');
  const CU = createRequire(import.meta.url)(path.join(here, '..', '..', 'epinoia', 'admin', 'creators-ui.js'));
  const asked = [];
  const answer = (status, body) => async url => { asked.push(url); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  const GUILD = { type: 0, code: 'discord-developers', expires_at: null, guild: { id: '613425648685547541', name: 'Discord Developers',
    icon: 'a_1d18823294be0ccfbcdec090c8ffcc0d', description: 'x' }, approximate_member_count: 214533, approximate_presence_count: 30121 };
  console.log('\nreading an invitation');
  const r = await CU.lookUpInvite('https://discord.gg/discord-developers', answer(200, GUILD));
  ok('an invitation gives the server\'s id, name and picture, and its numbers', r.server_id === '613425648685547541' &&
     r.name === 'Discord Developers' && r.icon_url === 'https://cdn.discordapp.com/icons/613425648685547541/a_1d18823294be0ccfbcdec090c8ffcc0d.png?size=128' &&
     r.members === 214533 && r.online === 30121 && asked[0] === 'https://discord.com/api/v10/invites/discord-developers?with_counts=true', r);
  ok('...a discord.com/invite address is read the same way', (await CU.lookUpInvite('https://discord.com/invite/discord-developers/', answer(200, GUILD))).server_id === '613425648685547541');
  asked.length = 0;
  ok('...anything else is refused before Discord is asked', /discord\.gg or discord\.com\/invite/.test((await CU.lookUpInvite('https://evil.example/x', answer(200, GUILD))).error) &&
     /discord\.gg or discord\.com\/invite/.test((await CU.lookUpInvite('https://discord.gg/../../api', answer(200, GUILD))).error) && asked.length === 0);
  ok('...an expired invitation is said so, and a busy Discord too', /expired/.test((await CU.lookUpInvite('https://discord.gg/gone', answer(404, { code: 10006 }))).error) &&
     /did not answer \(429\)/.test((await CU.lookUpInvite('https://discord.gg/busy', answer(429, {}))).error));
  ok('...a group chat\'s invitation is not a server, and an odd picture is left out',
     /not to a server/.test((await CU.lookUpInvite('https://discord.gg/group', answer(200, { type: 1, channel: { id: '1' } }))).error) &&
     (await CU.lookUpInvite('https://discord.gg/oddpic', answer(200, Object.assign({}, GUILD, { guild: Object.assign({}, GUILD.guild, { icon: '../../evil' }) })))).icon_url === null);
}

let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch {
  console.log('SKIP  @electric-sql/pglite is not installed: the database checks');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
/* a function as a migration defines it: from its create to the end of its body */
const fnFrom = (src, name) => {
  const i = src.indexOf('create or replace function public.' + name + '(');
  const a = src.indexOf('$$', i), b = src.indexOf('$$', a + 2);
  return src.slice(i, src.indexOf(';', b) + 1);
};

const FAN = '11111111-1111-1111-1111-111111111111', KID = '22222222-2222-2222-2222-222222222222',
      QUIET = '33333333-3333-3333-3333-333333333333', ADMIN = '44444444-4444-4444-4444-444444444444';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid, provider text, identity_data jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.audit_log (actor uuid, action text, subject text, subject_id text, detail jsonb, at timestamptz default now());
  create table public.leagues (id uuid primary key default gen_random_uuid(), slug text, name text, colour_a text, logo_path text,
    visibility text not null default 'public');
  create table public.teams (id uuid primary key default gen_random_uuid(), league_id uuid, slug text, name text, short_name text,
    colour text, logo_path text);
  create table public.test_hidden (league_id uuid);
  create function public.league_visible(p uuid) returns boolean language sql stable as $$ select not exists (select 1 from test_hidden where league_id = p) $$;
  create function public.is_league_admin(p uuid) returns boolean language sql stable as $$ select auth.uid() = '${ADMIN}'::uuid $$;
  create table public.usernames (user_id uuid primary key, username text not null, created_at timestamptz not null default now());
  create table public.go_settings (user_id uuid primary key, public boolean not null default false, adult_confirmed_at timestamptz,
    stamps_public boolean not null default false, updated_at timestamptz);
  create table public.go_photos (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
  create table public.test_numbers (user_id uuid, arenas bigint, stamps bigint, km double precision, first_at timestamptz);
  create function public.go_numbers(p_league uuid default null)
    returns table (user_id uuid, arenas bigint, stamps bigint, km double precision, first_at timestamptz)
    language sql stable as $$ select * from test_numbers $$;
  create function public.go_leaderboard(p_league uuid default null, p_by text default 'arenas', p_limit integer default 100)
    returns table (rank bigint, username text, arenas bigint, stamps bigint, km numeric, me boolean)
    language sql stable as $$ select rank() over (order by n.arenas desc), u.username, n.arenas, n.stamps, n.km::numeric, false
      from test_numbers n join usernames u on u.user_id = n.user_id join go_settings g on g.user_id = n.user_id and g.public $$;
  create table public.fan_prefs (user_id uuid primary key, fav_team_ids uuid[] not null default '{}', fav_league_ids uuid[] not null default '{}');
  create table public.username_blocklist (word text primary key, whole boolean not null default false);
  insert into public.username_blocklist values ('nasty', false), ('ass', true);
  ${fnFrom(mig('0167_go_photos.sql'), 'go_caption_ok')}
  ${fnFrom(mig('0194_creators.sql'), 'clean_creator_links')}
`);
const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };

const [el] = await q(`insert into leagues (slug, name, colour_a) values ('el', 'EuroLeague', '#ff6600') returning id`);
const [pv] = await q(`insert into leagues (slug, name, visibility) values ('mates', 'Mates League', 'private') returning id`);
const [club] = await q(`insert into teams (league_id, slug, name, short_name, colour) values ($1, 'oly', 'Olympiacos', 'OLY', '#e2001a') returning id`, [el.id]);
const [pclub] = await q(`insert into teams (league_id, slug, name, short_name) values ($1, 'mates-a', 'Mates A', 'MTA') returning id`, [pv.id]);
await q(`insert into auth.users values ($1, 'fan@x.com'), ($2, 'kid@x.com'), ($3, 'quiet@x.com'), ($4, 'admin@x.com')`, [FAN, KID, QUIET, ADMIN]);
await q(`insert into auth.identities (user_id, provider, identity_data) values
  ($1, 'email', '{"email":"fan@x.com"}'),
  ($1, 'google', '{"full_name":"Sam Carter","avatar_url":"https://lh3.googleusercontent.com/a/x=s96-c"}'),
  ($1, 'twitter', '{"full_name":"Sam C","user_name":"samcarter","avatar_url":"http://pbs.twimg.com/insecure.jpg"}')`, [FAN]);
await q(`insert into usernames (user_id, username, created_at) values ($1, 'SamCarter', '2026-09-01'), ($2, 'Kiddo', now()), ($3, 'QuietOne', now())`, [FAN, KID, QUIET]);
await q(`insert into go_settings (user_id, public, adult_confirmed_at, stamps_public) values ($1, true, now(), true), ($2, false, null, false), ($3, true, now(), false)`, [FAN, KID, QUIET]);
await q(`insert into test_numbers values ($1, 12, 15, 1843.37, '2026-09-02'), ($2, 3, 3, 40, '2026-09-10')`, [FAN, QUIET]);
await q(`insert into go_photos (user_id, status) values ($1, 'approved'), ($1, 'approved'), ($1, 'pending')`, [FAN]);
await q(`insert into fan_prefs values ($1, array[$2::uuid, $3::uuid], array[$4::uuid, $5::uuid])`, [FAN, club.id, pclub.id, el.id, pv.id]);
await db.exec(mig('0197_fan_profiles.sql'));

console.log('\nthe fan\'s own profile');
await as(FAN);
let mine = (await q(`select public.my_fan_profile() as j`))[0].j;
ok('offers what their social accounts say: a name, a handle and a picture per provider, never the email login',
   mine.suggest.length === 2 && mine.suggest[0].provider === 'google' && mine.suggest[0].name === 'Sam Carter' &&
   /^https:\/\/lh3/.test(mine.suggest[0].avatar_url) && mine.suggest[1].handle === 'samcarter', mine.suggest);
ok('...an http picture is not offered', mine.suggest[1].avatar_url === null);
ok('...and says whether it is shown: public on EPINOIA GO, with the stamps', mine.public === true && mine.stamps_public === true && mine.username === 'SamCarter');
let r = (await q(`select public.set_fan_profile($1::jsonb) as j`, [JSON.stringify({
  name: '  Sam   Carter ', bio: 'Every arena in the league by Christmas.', avatar_url: 'https://lh3.googleusercontent.com/a/x=s96-c',
  colour: '#123abc', links: { instagram: 'https://www.instagram.com/samcarter', x: 'https://x.com/samcarter', evil: 'https://evil.example', youtube: 'http://youtube.com/x' },
  club_id: club.id, show_follows: true })]))[0].j;
mine = (await q(`select public.my_fan_profile() as j`))[0].j;
ok('saved: the name tidied, the links the allow-listed platforms at https addresses', r.ok && mine.name === 'Sam Carter' && mine.colour === '#123abc' &&
   JSON.stringify(Object.keys(mine.links).sort()) === '["instagram","x"]' && mine.club_id === club.id && mine.show_follows === true, [r, mine]);
r = (await q(`select public.set_fan_profile($1::jsonb) as j`, [JSON.stringify({ bio: 'Just the line changed.' })]))[0].j;
mine = (await q(`select public.my_fan_profile() as j`))[0].j;
ok('...only the keys sent change', r.ok && mine.bio === 'Just the line changed.' && mine.name === 'Sam Carter' && mine.links.instagram);
const refuse = async (p) => (await q(`select public.set_fan_profile($1::jsonb) as j`, [JSON.stringify(p)]))[0].j.reason;
ok('refused, each in words: a word off the list, too long, an http picture, a colour, a club nobody may see, a club that is not an id',
   await refuse({ name: 'N4sty fan' }) === 'words' && await refuse({ bio: 'x'.repeat(281) }) === 'bio_long' &&
   await refuse({ avatar_url: 'http://x.example/a.png' }) === 'avatar' && await refuse({ colour: 'red' }) === 'colour' &&
   await (async () => { await q(`insert into test_hidden values ($1)`, [pv.id]); const x = await refuse({ club_id: pclub.id }); await q(`delete from test_hidden`); return x; })() === 'club' &&
   await refuse({ club_id: 'not-a-uuid' }) === 'club');
ok('...and "ass" is refused as a word but Cassandra is not', await refuse({ name: 'ass' }) === 'words' && (await q(`select public.set_fan_profile('{"name":"Cassandra"}'::jsonb) as j`))[0].j.ok);
await q(`select public.set_fan_profile('{"name":"Sam Carter"}'::jsonb)`);

console.log('\nDiscord, from the linked identity');
ok('no Discord linked: nothing, and nothing kept', (await q(`select public.sync_fan_discord() as j`))[0].j === null);
await q(`insert into auth.identities (user_id, provider, identity_data) values ($1, 'discord',
  '{"sub":"80351110224678912","name":"samc#0","full_name":"Sam C","custom_claims":{"global_name":"Sam C"},"avatar_url":"https://cdn.discordapp.com/avatars/8035/abc.png"}')`, [FAN]);
const d = (await q(`select public.sync_fan_discord() as j`))[0].j;
ok('linked: its id, its name (the old #0 dropped), its display name and picture, read from the identity',
   d.id === '80351110224678912' && d.username === 'samc' && d.global_name === 'Sam C' && /^https:\/\/cdn\.discordapp\.com/.test(d.avatar_url), d);
mine = (await q(`select public.my_fan_profile() as j`))[0].j;
ok('...kept on the profile, and offered as a source too', mine.discord.username === 'samc' && mine.suggest.some(s => s.provider === 'discord' && s.handle === 'samc'));

console.log('\nthe page');
await as('');
let page = (await q(`select public.fan_profile_public('samcarter') as j`))[0].j;
ok('a public fan\'s page, found whatever the case of the name: the profile, the club, Discord, the GO numbers and rank',
   page && page.username === 'SamCarter' && page.name === 'Sam Carter' && page.club.slug === 'oly' && page.club.league.slug === 'el' &&
   page.discord.username === 'samc' && page.go.arenas === 12 && Number(page.go.km) === 1843.4 && Number(page.rank) === 1 && page.photos === 2 &&
   page.stamps_public === true, page);
ok('...what they follow, when they show it: public leagues only, never a private one', page.follows.leagues.map(l => l.slug).join() === 'el' &&
   page.follows.clubs.map(c => c.slug).join() === 'oly', page.follows);
ok('nobody who is not public on GO has a page: under 18 / not public, or no such name', (await q(`select public.fan_profile_public('Kiddo') as j`))[0].j === null &&
   (await q(`select public.fan_profile_public('nobody') as j`))[0].j === null);
page = (await q(`select public.fan_profile_public('QuietOne') as j`))[0].j;
ok('a public fan with no profile yet: the name and the numbers; stamps not shown; follows not shown', page && page.name === '' && page.go.arenas === 3 &&
   page.stamps_public === false && page.follows === undefined, page);
await as(FAN);
await q(`select public.set_fan_profile('{"show_discord":false,"show_follows":false}'::jsonb)`);
await as('');
page = (await q(`select public.fan_profile_public('SamCarter') as j`))[0].j;
ok('Discord and the follows leave the page when the fan says so', page.discord === null && page.follows === undefined, page);
await as(FAN);
await q(`delete from auth.identities where provider = 'discord'`);
ok('unlinking Discord clears it at the next sync', (await q(`select public.sync_fan_discord() as j`))[0].j === null &&
   (await q(`select discord from fan_profiles where user_id = $1`, [FAN]))[0].discord === null);

console.log('\na league\'s Discord servers');
const SRV = n => String(n).padStart(18, '1');                  // an 18-digit server id
const save = (league, p) => q(`select public.save_league_discord($1, $2::jsonb) as id`, [league, JSON.stringify(p)]).then(r => r[0].id);
await as(FAN);
ok('only the league\'s administrators attach one', /administer/.test(await fails(() => save(el.id, { invite: 'https://discord.gg/abcDEF12', name: 'EL' })) || ''));
await as(ADMIN);
ok('...each checked: the id a long number, the invitation Discord\'s, one of the two, a name, Discord\'s own picture, a club of the league',
   /long number/.test(await fails(() => save(el.id, { server_id: 'abc', name: 'x' })) || '') &&
   /invitation is/.test(await fails(() => save(el.id, { invite: 'https://evil.example/x', name: 'x' })) || '') &&
   /invitation, its id, or both/.test(await fails(() => save(el.id, { name: 'x' })) || '') &&
   /a name/.test(await fails(() => save(el.id, { invite: 'https://discord.gg/abcDEF12', name: '  ' })) || '') &&
   /picture/.test(await fails(() => save(el.id, { invite: 'https://discord.gg/abcDEF12', name: 'x', icon_url: 'https://evil.example/i.png' })) || '') &&
   /club is not in this league/.test(await fails(() => save(el.id, { invite: 'https://discord.gg/abcDEF12', name: 'x', team_id: pclub.id })) || ''));
const s1 = await save(el.id, { server_id: SRV(1), invite: 'https://discord.gg/official1', name: 'EuroLeague', official: true,
                               icon_url: `https://cdn.discordapp.com/icons/${SRV(1)}/a_1d18823294be0ccfbcdec090c8ffcc0d.png?size=128` });
const s2 = await save(el.id, { invite: 'https://discord.com/invite/fanscomm', name: 'r/Euroleague', note: 'Fan-run: game threads every night' });
const s3 = await save(el.id, { server_id: SRV(3), name: 'Olympiacos fans', team_id: club.id });
ok('...any server, the league\'s own or not: three attached, by invitation, by id, or both', !!(s1 && s2 && s3));
ok('...the same server twice is refused', /already/.test(await fails(() => save(el.id, { server_id: SRV(1), name: 'again' })) || ''));
await as('');
let dp = (await q(`select public.league_discord_public('el') as j`))[0].j;
ok('the Community page reads the league and its servers, in order, with the club\'s and the official mark',
   dp && dp.name === 'EuroLeague' && dp.servers.length === 3 && dp.servers.map(x => x.name).join('|') === 'EuroLeague|r/Euroleague|Olympiacos fans' &&
   dp.servers[0].official === true && dp.servers[0].server_id === SRV(1) && dp.servers[1].server_id === null &&
   dp.servers[1].note === 'Fan-run: game threads every night' && dp.servers[0].note === null &&
   dp.servers[2].club && dp.servers[2].club.slug === 'oly' && dp.servers[0].club === null, dp);
ok('...and the rail gets a row for it, and none for a league without', (await q(`select * from public.league_discord_probe('el')`)).length === 1 &&
   (await q(`select * from public.league_discord_probe('mates')`)).length === 0 && (await q(`select public.league_discord_public('mates') as j`))[0].j === null);
await q(`insert into test_hidden values ($1)`, [el.id]);
ok('...never for a league the reader may not see', (await q(`select public.league_discord_public('el') as j`))[0].j === null &&
   (await q(`select * from public.league_discord_probe('el')`)).length === 0);
await q(`delete from test_hidden`);
await as(ADMIN);
ok('the console lists them; moving one up changes the order, and the top stays the top',
   (await q(`select public.league_discords_admin($1) as j`, [el.id]))[0].j.length === 3 &&
   (await q(`select public.move_league_discord($1, -1) as ok`, [s3]))[0].ok === true &&
   (await q(`select public.move_league_discord($1, -1) as ok`, [s1]))[0].ok === false &&
   (await q(`select public.league_discords_admin($1) as j`, [el.id]))[0].j.map(x => x.name).join('|') === 'EuroLeague|Olympiacos fans|r/Euroleague');
await save(el.id, { id: s2, invite: 'https://discord.com/invite/fanscomm', name: 'r/Euroleague', note: '' });
const [other] = await q(`insert into leagues (slug, name) values ('bcl', 'Champions League') returning id`);
ok('...a change keeps its place; a server of one league cannot be changed through another',
   (await q(`select public.league_discords_admin($1) as j`, [el.id]))[0].j[2].note === '' &&
   /not attached to this league/.test(await fails(() => save(other.id, { id: s2, invite: 'https://discord.gg/abcDEF12', name: 'x' })) || ''));
ok('...twelve at most', await (async () => {
  for (let i = 0; i < 9; i++) await save(other.id, { server_id: SRV(100 + i), name: 'bcl ' + i });
  const before = await fails(() => save(other.id, { server_id: SRV(200), name: 'the tenth' }));
  for (let i = 0; i < 2; i++) await save(other.id, { server_id: SRV(300 + i), name: 'more ' + i });
  return before === null && /12 servers at most/.test(await fails(() => save(other.id, { server_id: SRV(400), name: 'the thirteenth' })) || '');
})());
await as(FAN);
ok('a fan can take none off, move none, list none', /administer/.test(await fails(() => q(`select public.remove_league_discord($1)`, [s1])) || '') &&
   /administer/.test(await fails(() => q(`select public.move_league_discord($1, 1)`, [s1])) || '') &&
   /administer/.test(await fails(() => q(`select public.league_discords_admin($1)`, [el.id])) || ''));
await as(ADMIN);
for (const id of [s1, s2, s3]) await q(`select public.remove_league_discord($1)`, [id]);
await as('');
ok('taking every one off takes the page and the rail\'s row away', (await q(`select public.league_discord_public('el') as j`))[0].j === null &&
   (await q(`select * from public.league_discord_probe('el')`)).length === 0);
ok('every change is in the audit log', (await q(`select count(*)::int as n from audit_log where action in ('save_league_discord', 'remove_league_discord')`))[0].n >= 19);

console.log('\nwho may touch what');
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`))[0].ok;
ok('the signed-out may read a page and a league\'s Discord, and nothing else', await priv('anon', 'public.fan_profile_public(text)') &&
   await priv('anon', 'public.league_discord_public(text)') && await priv('anon', 'public.league_discord_probe(text)') &&
   !(await priv('anon', 'public.my_fan_profile()')) && !(await priv('anon', 'public.set_fan_profile(jsonb)')) &&
   !(await priv('anon', 'public.sync_fan_discord()')) && !(await priv('anon', 'public.save_league_discord(uuid, jsonb)')) &&
   !(await priv('anon', 'public.remove_league_discord(uuid)')) && !(await priv('anon', 'public.move_league_discord(uuid, integer)')) &&
   !(await priv('anon', 'public.league_discords_admin(uuid)')));
ok('the tables are shut: through the functions only', ['fan_profiles', 'league_discords'].every(Boolean) &&
   !(await q(`select has_table_privilege('anon', 'public.fan_profiles', 'select') as ok`))[0].ok &&
   !(await q(`select has_table_privilege('authenticated', 'public.fan_profiles', 'select') as ok`))[0].ok &&
   !(await q(`select has_table_privilege('anon', 'public.league_discords', 'select') as ok`))[0].ok &&
   !(await q(`select has_table_privilege('authenticated', 'public.league_discords', 'select') as ok`))[0].ok &&
   (await q(`select bool_and(relrowsecurity) as ok from pg_class where relname in ('fan_profiles', 'league_discords')`))[0].ok);
await as('');
ok('signed out, the editor\'s read is nothing', (await q(`select public.my_fan_profile() as j`))[0].j === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
