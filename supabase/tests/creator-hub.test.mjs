// 0200: THE CREATOR HUB's database, on a real Postgres (PGlite; skipped with a note when it is not installed). 0194 is
// loaded on the same stand-ins as creators.test.mjs (auth, profiles, leagues, fan_prefs, notifications, 0051's body
// cleaners), then 0200 with GO's word check (0167) and a storage schema. What is held here:
//   * the writing desk: tags in their one form, the search engines' title and description, an old caller that sends
//     none of them changing none of them; SCHEDULED pieces out of sight until creator_publish_due() publishes them
//     (their followers told then, once); REVISIONS of every save that changed the words, 25 kept, to their people
//     only; the article's pull quote, embed and picture description, and league news's cleaner as it was;
//   * the numbers: creator_track takes a piece seen, opened or followed out - only a piece that is out, once a tab in
//     thirty minutes, 50 a call - and creator_stats gives them (totals and the stretch before, day by day, the best
//     pieces, where readers came from, followers, the pieces by state) to the outlet's people and the league only;
//   * pictures: the creator-media bucket, and an outlet's people writing into its folder alone;
//   * who may call what.
// And first, with no database: the pages - the editor's own rules (words, reading time, the permalink, the tags as
// the database keeps them, the typed shortcuts), the storylines a league's numbers make, the icon set, the hub's
// page on the standard and in the rail, the pieces counted where they are shown, and the hub's words in Spanish and
// Japanese.
//
//   node supabase/tests/creator-hub.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

/* ---------------------------------------------------------------------------- the pages (no database) --- */
const EP = path.join(here, '..', '..', 'epinoia');
const src = f => readFileSync(path.join(EP, f), 'utf8');
const req = createRequire(import.meta.url);
const E = req(path.join(EP, 'creators', 'studio', 'editor.js'));
const SL = req(path.join(EP, 'storylines.js'));
const IC = req(path.join(EP, 'icons.js'));

console.log('the editor');
ok('words and reading time as the editor counts them (a minute at least, 230 words a minute)',
   E.words('  one two\nthree  ') === 3 && E.words('') === 0 && E.readingMinutes(0) === 1 && E.readingMinutes(700) === 3);
ok('a permalink as creator_slug makes one: letters and digits, the rest a hyphen, 60 at most',
   E.slugify('Why the Kings’ run — will LAST!') === 'why-the-kings-run-will-last' && E.slugify('x'.repeat(80)).length === 60 && E.slugify('¡!') === '');
ok('a date for the schedule box in the reader\'s own time, and nothing for no date',
   E.localInput(new Date(2026, 9, 2, 9, 5)) === '2026-10-02T09:05' && E.localInput(new Date('no')) === '' && E.localInput(null) === '');
ok('tags as the database keeps them: trimmed, once each whatever the case, a letter or digit first, 30 long and 8 at most',
   JSON.stringify(E.cleanTags([' NBL ', 'nbl', 'Sydney  Kings', '', 'x'.repeat(31), '#hash', 'Bryce Cotton', '3', 'b', 'c', 'd', 'e', 'f', 'g']))
     === JSON.stringify(['NBL', 'Sydney Kings', 'Bryce Cotton', '3', 'b', 'c', 'd', 'e']));
ok('typed at the start of a line: "## " a heading, "### " a subheading, "> " a quote, \'" \' a pull quote, "- " or "* " a list, "1. " a numbered one',
   E.MARKS['##'] === 'h2' && E.MARKS['###'] === 'h3' && E.MARKS['>'] === 'quote' && E.MARKS['"'] === 'pullquote' &&
   E.MARKS['-'] === 'ul' && E.MARKS['*'] === 'ul' && E.MARKS['1.'] === 'ol');
ok('...and every block it makes is in the block menu', Object.values(E.MARKS).every(b => E.BLOCKS.some(x => x[0] === b)));
{
  const ed = src('creators/studio/editor.js'), nb = src('newsblocks.js');
  ok('the editor saves what upsert_creator_post takes: tags, the search title and description, a time to publish',
     ['p_tags', 'p_seo_title', 'p_seo_description', 'p_publish_at'].every(k => ed.includes(k)));
  ok('...and a server without 0200 is still saved to, the old way', /PGRST202|Could not find the function/.test(ed));
  ok('the article\'s own blocks (a pull quote, an embed, a picture with its description) are read back as the database cleans them',
     /pullquote/.test(nb) && /data-embed/.test(nb) && /\.alt\b/.test(nb));
}

console.log('\nstorylines');
{
  const now = new Date('2026-09-30T12:00:00Z');
  const d = n => new Date(now.getTime() + n * 86400e3).toISOString();
  const teams = new Map('ABCDEF'.split('').map(x => [x, { name: 'Club ' + x }]));
  const st = (id, rank, w, l, streak, pf, pa) => ({ team_id: id, rank, gp: w + l, w, l, streak, group_name: null, pts_for: pf, pts_against: pa });
  const standings = [st('A', 1, 6, 0, 'W6', 540, 450), st('B', 2, 4, 2, 'W1', 500, 470), st('C', 3, 4, 2, 'L1', 490, 480),
                     st('D', 4, 3, 3, 'W2', 480, 490), st('E', 5, 2, 4, 'L2', 470, 500), st('F', 6, 0, 6, 'L6', 420, 510)];
  const g = (h, a, hs, as, t) => ({ tipoff_at: t, home_team_id: h, away_team_id: a, home_score: hs, away_score: as });
  const results = [g('E', 'A', 80, 78, d(-1)), g('A', 'F', 90, 70, d(-3)), g('F', 'A', 60, 85, d(-5)), g('A', 'F', 88, 72, d(-7)),
                   g('F', 'A', 65, 90, d(-9)), g('A', 'F', 95, 71, d(-11))];
  const fixtures = [{ tipoff_at: d(2), home_team_id: 'A', away_team_id: 'F' }, { tipoff_at: d(3), home_team_id: 'B', away_team_id: 'C' },
                    { tipoff_at: d(20), home_team_id: 'A', away_team_id: 'B' }];
  const leaders = { ppg: [{ first_name: 'Bryce', last_name: 'Cotton', team_short: 'PER', gp: 6, ppg: 30.25 }, { first_name: 'Kendric', last_name: 'Davis', gp: 6, ppg: 27 }],
    rpg: [{ first_name: 'Nick', last_name: 'Kay', rpg: 9.66 }], apg: [{ first_name: 'Arnas', last_name: 'Velicka', apg: 10 }],
    totals: [{ first_name: 'Bryce', last_name: 'Cotton', pts: 188, gp: 6, ppg: 31.33 }, { first_name: 'Low', last_name: 'Total', pts: 95, gp: 6, ppg: 15.8 }] };
  const records = { player: [{ cat: { k: 'pts' }, v: 41, meta: { name: 'Bryce Cotton' }, game: { tipoff_at: d(-4) }, oppId: 'B' },
                             { cat: { k: 'reb' }, v: 15, meta: { name: 'Nick Kay' } }] };
  const fmt = (t, withTime) => (withTime ? 'T:' : 'D:') + String(t).slice(0, 10);
  const out = SL.build({ comp: { qualifiers: 4 }, standings, teams, leaders, records, results, fixtures, now, fmt });
  const by = k => out.find(c => c.key === k) || { head: '', lines: [] };
  const line = k => by(k).head + ' / ' + by(k).lines.join(' / ');
  ok('every storyline a season like this has, in order: the table, the race, runs, leaders, highs, form, the upset, the big game, a milestone, the scoring',
     out.map(c => c.key).join() === 'top,race,streaks,leaders,highs,form,upset,big,milestone,numbers', out.map(c => c.key));
  ok('the table: who is top, and by how much (games behind, as a table counts them)',
     line('top') === 'Club A, top of the table / 6-0 after 6 games / 2 games clear of Club B (4-2)', line('top'));
  ok('the race at the competition\'s own play-off line (0018\'s qualifiers)',
     line('race') === 'The race for 4th / Club D hold 4th at 3-3 / Club E one game behind, in 5th', line('race'));
  ok('the longest runs, both ends', line('streaks') === 'Club A: 6 wins in a row / The longest winning run in the league, 6-0 overall / At the other end, Club F have lost 6 straight', line('streaks'));
  ok('the leaders, to one decimal', line('leaders') === 'Bryce Cotton leads the scoring / 30.3 points a game for PER (6 games) / Next: Kendric Davis, 27.0 / Rebounds: Nick Kay, 9.7 a game / Assists: Arnas Velicka, 10.0 a game', line('leaders'));
  ok('the season\'s single-game highs from records.js, against whom and when',
     line('highs') === '41 points: Bryce Cotton / Against Club B, D:2026-09-26 / Rebounds: 15, Nick Kay', line('highs'));
  ok('form over the last five, newest first, hottest and coldest', line('form') === 'Club A: 4 wins from the last 5 / Newest first: L W W W W / Coldest: Club F, L L L L L', line('form'));
  ok('the latest upset: a winner four places or more below', line('upset') === 'Club E (5th) beat Club A (1st) / Club E 80-78 Club A, D:2026-09-29', line('upset'));
  ok('the big game: the best-placed pair in the next fortnight, both in the top half (not 1st against 6th, nor a game three weeks off)',
     line('big') === 'Club B v Club C / 2nd against 3rd / T:2026-10-03', line('big'));
  ok('a milestone in reach: a season total within twenty of the next hundred', line('milestone') === 'Bryce Cotton: 12 points from 200 / 188 this season in 6 games (31.3 a game)', line('milestone'));
  ok('the league\'s scoring, best attack and defence per game', line('numbers') === 'Teams score 80.6 points a game / Best attack: Club A, 90.0 / Best defence: Club A, 75.0 allowed', line('numbers'));
  ok('each copies as its headline and lines, one to a line', by('top').copy === 'Club A, top of the table\n6-0 after 6 games\n2 games clear of Club B (4-2)', by('top').copy);
  const grp = SL.build({ standings: [Object.assign(st('A', 1, 3, 0, 'W3', 240, 200), { group_name: 'East' }), Object.assign(st('B', 1, 2, 1, 'W1', 230, 220), { group_name: 'West' }),
                                     Object.assign(st('C', 2, 0, 3, 'L3', 200, 240), { group_name: 'East' })], teams });
  ok('a competition in groups: each group\'s leader, and no race or upset read across them',
     grp.map(c => c.key).join() === 'top,streaks,numbers' && grp[0].lines.join(' / ') === 'East: Club A (3-0) / West: Club B (2-1)', grp.map(c => c.key + ': ' + c.lines.join(' / ')));
  ok('nothing played, nothing said (and nothing breaks)', SL.build({}).length === 0 && SL.build(null).length === 0);
  ok('games behind in halves, as a table prints them', SL.half(1.5) === '1½' && SL.half(0.5) === '½' && SL.half(2) === '2' && SL.ord(12) === '12th' && SL.ord(22) === '22nd' && SL.ord(103) === '103rd');
}

console.log('\nicons');
{
  const keys = IC.LIST.map(x => x.key);
  ok('a set of 30, each with its own file name and a name to show', IC.LIST.length === 30 && new Set(keys).size === 30 && keys.every(k => /^[a-z0-9-]+$/.test(k)) && IC.LIST.every(x => x.name && x.d));
  const all = IC.LIST.map(x => IC.svg(x.key, { colour: '#1a2b3c', weight: 2.4 }));
  ok('each is an SVG on the 24-unit square in the colour and weight asked',
     all.every(t => t.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"') && t.includes('stroke="#1a2b3c"') && t.includes('stroke-width="2.4"') && t.endsWith('</svg>')));
  ok('...and nothing but a colour gets into it', !/onload|script/i.test(IC.svg('hoop', { colour: 'red" onload="alert(1)', bg: '<script>' })));
  ok('an icon that is not in the set is nothing', !IC.svg('nope'));
}

console.log('\nthe hub, the rail and the counting');
{
  const html = src('creators/hub/index.html'), hub = src('creators/hub/hub.js'), nav = src('nav.js');
  ok('the hub is a page of the standard, in its own words\' context (data-std, data-i18n-ctx="creatorhub")',
     /<div class="ep-frame ch" id="hub" data-std data-i18n-ctx="creatorhub">/.test(html));
  ok('...its five sections: your numbers, the writing desk, storylines, graphics and icons',
     ['numbers', 'desk', 'stories', 'graphics', 'icons'].every(id => html.includes('<section class="sec' + (id === 'desk' ? ' hide' : '') + '" id="' + id + '"')));
  const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1].replace(/^(\.\.\/)+/, ''));
  ok('...reading the league with the site\'s own scripts (data, records, the social cards) before hub.js, and nav.js last',
     ['teamcolour.js', 'data.js', 'records.js', 'socialcard.js', 'admin/socialgfx-ui.js', 'icons.js', 'storylines.js'].every(f => scripts.indexOf(f) >= 0 && scripts.indexOf(f) < scripts.indexOf('hub.js')) &&
     scripts[scripts.length - 1] === 'nav.js', scripts);
  ok('...talking to the database only (its content policy)', /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co;/.test(html) && /script-src 'self';/.test(html));
  ok('the rail\'s "your hub" opens the creator hub', /mk\('', '✎', 'creator hub', root \+ 'creators\/hub\/'\)/.test(nav));
  ok('...and nav.js keeps the outlets the account writes for, so their own reading is never counted', /my_creator_outlets/.test(nav) && /epinoia_my_outlets/.test(nav));
  ok('the studio and your hub point to it', /href="\.\.\/hub\/"/.test(src('creators/studio/index.html')) && /href="\.\.\/creators\/hub\/"/.test(src('me/index.html')));
  ok('the hub reads creator_stats and the desk creator_studio, and asks for what is due to go out first',
     /rpc\('creator_stats'/.test(hub) && /rpc\('creator_studio'/.test(hub) && /rpc\('creator_publish_due'\)/.test(hub));
  const nc = src('newscard.js'), cp = src('creators/creators-page.js');
  ok('a creator\'s card counts as seen where it is shown (the feed, the news page, a league\'s): once half of it is on screen',
     /piece: r\.id/.test(nc) && /watchSeen\(art, it\)/.test(nc) && /threshold: 0\.5/.test(nc));
  ok('the piece\'s own page counts it opened, and its link followed out', /toTrack\([^)]*'open'/.test(cp) && /toTrack\([^)]*'out'/.test(cp));
}

console.log('\nthe hub in Spanish and Japanese');
{
  const core = req(path.join(EP, 'i18n.js'));
  const vm = req('node:vm');
  const dictOf = code => { let d = null; vm.runInNewContext(src('i18n/' + code + '.js'), { window: { EpinoiaI18n: { register: (c, x, p) => { if (!p) d = x; } } } }); return d; };
  const html = src('creators/hub/index.html'), hub = src('creators/hub/hub.js'), sl = src('storylines.js');
  const words = new Set();
  for (const re of [/<h1>([^<]+)<\/h1>/g, /<p class="pg-sub">([^<]+)<\/p>/g, /<h2 id="\w+">([^<]+)<\/h2>/g, /<p class="note">([^<]+)<\/p>/g,
                    /<div class="pg-empty">([^<]+)<\/div>/g, /<label[^>]*>([^<]+)<\/label>/g]) for (const m of html.matchAll(re)) words.add(m[1].trim());
  for (const m of hub.matchAll(/stat\('([^']+)'/g)) words.add(m[1]);
  for (const m of hub.matchAll(/\['(?:article|video|podcast|social)', '(New [a-z]+)'\]/g)) words.add(m[1]);
  for (const m of hub.matchAll(/\['(?:draft|scheduled|published)', '([A-Z][a-z]+)'/g)) words.add(m[1]);
  for (const m of (hub.match(/const SOURCES = \{[^}]+\}/) || [''])[0].matchAll(/: '([^']+)'/g)) if (m[1] !== 'EPINOIA GO') words.add(m[1]);
  for (const m of sl.matchAll(/card\('[a-z]+', '([^']+)'/g)) words.add(m[1]);
  IC.LIST.forEach(x => { if (x.name !== 'MVP') words.add(x.name); });
  for (const code of ['es', 'ja']) {
    const D = core.compile(code, dictOf(code));
    const miss = [...words].filter(w => core.translateText(D, w, ['creatorhub']) == null);
    ok(code + ': every word of the hub\'s page (' + words.size + ': the head, the sections, the cards, the desk, the sources, the storylines, the icons)', !miss.length, miss);
    ok(code + ': ...and "creator hub" wherever the site says it (the rail, the page\'s title)',
       core.translateText(D, 'creator hub', []) != null && core.translateText(D, 'Creator hub · Epinoia', ['title']) != null);
    ok(code + ': ...its sentences with a number or a league in them',
       ['in these 30 days · 38 in all · 1 scheduled', 'Download all (23) as a ZIP', 'Drawing NBL’s week…', 'NBL’s colour', '−6.1 pts']
         .every(w => { const t = core.translateText(D, w, ['creatorhub']); return t != null && !/in all|as a ZIP|week|colour|pts/.test(t); }));
  }
}

let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('\nSKIP  the database: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
console.log('');
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
const m51 = mig('0051_news_and_writers.sql');
const fnOf = name => { const i = m51.indexOf('create or replace function public.' + name + '('); const j = m51.indexOf('end; $$;', i); return m51.slice(i, j + 'end; $$;'.length); };
const fnFrom = (src, name) => {
  const i = src.indexOf('create or replace function public.' + name + '(');
  const a = src.indexOf('$$', i), b = src.indexOf('$$', a + 2);
  return src.slice(i, src.indexOf(';', b) + 1);
};

const ADMIN = '11111111-1111-1111-1111-111111111111', OWNER = '22222222-2222-2222-2222-222222222222',
      WRITER = '33333333-3333-3333-3333-333333333333', FAN = '44444444-4444-4444-4444-444444444444',
      PLAT = '55555555-5555-5555-5555-555555555555', OTHER = '66666666-6666-6666-6666-666666666666';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
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
  create table public.username_blocklist (word text primary key, whole boolean not null default false);
  insert into public.username_blocklist values ('nasty', false);
  ${fnOf('clean_news_spans')}
  ${fnOf('clean_news_body')}
  ${fnFrom(mig('0167_go_photos.sql'), 'go_caption_ok')}
`);
const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };

const [lg] = await q(`insert into leagues (slug, name) values ('el', 'EuroLeague') returning id`);
await q(`insert into auth.users values ($1, 'admin@el.com'), ($2, 'host@pod.com'), ($3, 'writer@pod.com'), ($4, 'fan@x.com'), ($5, 'plat@epinoia.com'), ($6, 'other@x.com')`,
  [ADMIN, OWNER, WRITER, FAN, PLAT, OTHER]);
await q(`insert into profiles values ($1, 'The Host'), ($2, 'The Writer')`, [OWNER, WRITER]);
await db.exec(mig('0194_creators.sql'));
await db.exec(mig('0200_creator_hub.sql'));
await as(ADMIN);
await q(`select public.set_league_creators($1, true)`, [lg.id]);
const [{ id: outlet }] = await q(`select public.create_creator_outlet($1, 'The Hoops Pod', 'host@pod.com') as id`, [lg.id]);
const [{ id: outlet2 }] = await q(`select public.create_creator_outlet($1, 'Another Pod', 'other@x.com') as id`, [lg.id]);
await as(OWNER);
await q(`select public.add_creator_member($1, 'writer@pod.com', 'writer')`, [outlet]);
await q(`insert into fan_prefs (user_id, fav_outlet_ids) values ($1, array[$2]::uuid[])`, [FAN, outlet]);

const up = (o) => q(`select public.upsert_creator_post($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::text[], $12, $13, $14::timestamptz) as id`,
  [o.id || null, o.outlet || outlet, o.kind || 'article', o.title, o.stand || '', JSON.stringify(o.body || [{ type: 'p', spans: [{ t: 'Words here.' }] }]),
   o.cover || null, o.url || null, o.status || 'draft', o.slug || null, o.tags === undefined ? null : o.tags, o.seoT === undefined ? null : o.seoT,
   o.seoD === undefined ? null : o.seoD, o.at || null]).then(r => r[0].id);
const row = id => q(`select * from creator_posts where id = $1`, [id]).then(r => r[0]);

console.log('the writing desk');
await as(WRITER);
const p1 = await up({ title: 'Game 3 preview', tags: ['EuroLeague', ' euroleague ', 'Game 3', 'Play-offs', '<b>x</b>', 'nasty words', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
                      seoT: '  Game 3: what to watch  ', seoD: 'The three things that decide it.' });
const r1 = await row(p1);
ok('tags in their one form: trimmed, the same tag once whatever its case, nothing but words, nothing from the word list, eight at most',
   JSON.stringify(r1.tags) === JSON.stringify(['EuroLeague', 'Game 3', 'Play-offs', 'a', 'b', 'c', 'd', 'e']), r1.tags);
{
  /* the editor shows the tags as they will be kept before a save: it and creator_tags agree (less the word list) */
  const cases = [['EuroLeague', ' euroleague ', 'Game 3', 'Play-offs', '<b>x</b>', 'a', 'b', 'c', 'd', 'e', 'f', 'g'],
                 ['  Sydney   Kings ', 'O’Brien', 'AT&T Center', 'C++', '#1', 'x'.repeat(30), 'y'.repeat(31), 'St. Mary\'s', '', '-x']];
  const got = [];
  for (const c of cases) got.push([(await q(`select public.creator_tags($1::text[]) as t`, [c]))[0].t, E.cleanTags(c)]);
  ok('the editor\'s tags before a save are the ones the database keeps', got.every(([db, ed]) => JSON.stringify(db) === JSON.stringify(ed)), got);
}
ok('...and a title and a description for search engines, tidied', r1.seo_title === 'Game 3: what to watch' && r1.seo_description === 'The three things that decide it.' &&
   r1.edited_name === 'The Writer', r1);
ok('a search title of 71 characters, or a description of 161, is refused',
   /70 characters/.test(await fails(() => up({ title: 'x', seoT: 'x'.repeat(71) })) || '') && /160 characters/.test(await fails(() => up({ title: 'x', seoD: 'x'.repeat(161) })) || ''));
await q(`select public.upsert_creator_post($1, $2, 'article', 'Game 3 preview, updated', '', $3::jsonb, null, null, 'draft', null)`,
  [p1, outlet, JSON.stringify([{ type: 'p', spans: [{ t: 'New words.' }] }])]);
const r1b = await row(p1);
ok('an old caller (0194\'s arguments only) changes none of the new: tags and search fields stay',
   r1b.title === 'Game 3 preview, updated' && r1b.tags.length === 8 && r1b.seo_title === 'Game 3: what to watch');

const soon = new Date(Date.now() + 3 * 3600e3).toISOString();
const p2 = await up({ title: 'Scheduled for tonight', status: 'scheduled', at: soon });
const r2 = await row(p2);
ok('a scheduled piece: kept as scheduled, its time in published_at', r2.status === 'scheduled' && Math.abs(new Date(r2.published_at) - new Date(soon)) < 1000, r2);
ok('...out of sight until then: not on the outlet\'s page, not as a piece, and nobody told',
   !(await q(`select public.creator_outlet_public($1, 'the-hoops-pod') as j`, [lg.id]))[0].j.posts.some(p => p.slug === r2.slug) &&
   (await q(`select public.creator_post_public($1, 'the-hoops-pod', $2) as j`, [lg.id, r2.slug]))[0].j === null &&
   (await q(`select count(*)::int as n from notifications`))[0].n === 0);
ok('a time already come publishes it now; a year ahead is too far; a scheduled piece needs its time',
   (await row(await up({ title: 'Past time', status: 'scheduled', at: new Date(Date.now() - 60e3).toISOString() }))).status === 'published' &&
   /year ahead/.test(await fails(() => up({ title: 'Far', status: 'scheduled', at: new Date(Date.now() + 400 * 86400e3).toISOString() })) || '') &&
   /needs the date/.test(await fails(() => up({ title: 'No time', status: 'scheduled' })) || ''));
const nPast = (await q(`select count(*)::int as n from notifications where user_id = $1`, [FAN]))[0].n;
await q(`update creator_posts set published_at = now() - interval '1 minute' where id = $1`, [p2]);
const due = (await q(`select public.creator_publish_due() as n`))[0].n;
ok('when its time comes it goes out, and its followers are told - once', due === 1 && (await row(p2)).status === 'published' &&
   (await q(`select count(*)::int as n from notifications where user_id = $1 and ref = $2`, [FAN, p2]))[0].n === 1 &&
   (await q(`select public.creator_publish_due() as n`))[0].n === 0 && nPast === 1, { due, nPast });

const revs0 = (await q(`select public.creator_post_revisions($1) as j`, [p1]))[0].j;
ok('a save that changed the words kept the version it replaced: its headline, its size and who saved it',
   revs0.length === 1 && revs0[0].title === 'Game 3 preview' && revs0[0].words === 2 && revs0[0].saved_name === 'The Writer', revs0);
await q(`update creator_posts set cover_url = 'https://x.example/c.jpg' where id = $1`, [p1]);
ok('...a save that changed nothing of the words keeps none', (await q(`select public.creator_post_revisions($1) as j`, [p1]))[0].j.length === 1);
for (let i = 0; i < 30; i++) await q(`update creator_posts set title = $2, updated_at = clock_timestamp() where id = $1`, [p1, 'Take ' + i]);
const revs = (await q(`select public.creator_post_revisions($1) as j`, [p1]))[0].j;
const one = (await q(`select public.creator_post_revision($1) as j`, [revs[revs.length - 1].id]))[0].j;
ok('...25 kept, newest first; one whole, to bring back', revs.length === 25 && revs[0].title === 'Take 28' && one.post_id === p1 && Array.isArray(one.body), revs.length);
await as(FAN);
ok('...to the outlet\'s people and the league only', /do not write/.test(await fails(() => q(`select public.creator_post_revisions($1)`, [p1])) || '') &&
   /do not write/.test(await fails(() => q(`select public.creator_post_revision($1)`, [one.id])) || ''));

await as(WRITER);
const body = [
  { type: 'pullquote', spans: [{ t: 'We will win it.' }], cite: '  The coach  ' },
  { type: 'embed', url: 'https://www.youtube.com/watch?v=abc123', caption: 'The highlights' },
  { type: 'embed', url: 'http://insecure.example/x' },
  { type: 'image', path: 'https://cdn.example/p.jpg', caption: 'The arena', alt: 'A full arena before tip-off' },
  { type: 'script', src: 'x' }, { type: 'p', spans: [{ t: 'Plain.' }] }];
const p3 = await up({ title: 'With everything', body });
const b3 = (await row(p3)).body;
ok('an article keeps a pull quote (and who said it), an embed at an https address, a picture\'s description; nothing else new',
   JSON.stringify(b3.map(b => b.type)) === JSON.stringify(['pullquote', 'embed', 'image', 'p']) && b3[0].cite === 'The coach' &&
   b3[1].url === 'https://www.youtube.com/watch?v=abc123' && b3[1].caption === 'The highlights' && b3[2].alt === 'A full arena before tip-off', b3);
ok('...and league news\'s cleaner is as it was: no pull quote, no embed',
   JSON.stringify((await q(`select public.clean_news_body($1::jsonb) as j`, [JSON.stringify(body)]))[0].j.map(b => b.type)) === JSON.stringify(['image', 'p']));

console.log('\nthe numbers');
const pub = await up({ title: 'Published piece', status: 'published' });
const draft = await up({ title: 'Still a draft' });
const S1 = 'AAAAAAAAAAAAAAAAAAAAAAAA', S2 = 'BBBBBBBBBBBBBBBBBBBBBBBB', S3 = 'CCCCCCCCCCCCCCCCCCCCCCCC';
await as('');
const track = (s, events, device = 'phone') => q(`select public.creator_track($1, $2, $3::jsonb) as n`, [s, device, JSON.stringify(events)]).then(r => r[0].n);
const n1 = await track(S1, [{ post: pub, kind: 'seen', source: 'news' }, { post: pub, kind: 'open', source: 'news' }, { post: pub, kind: 'out', source: 'creators' },
                            { post: draft, kind: 'seen' }, { post: pub, kind: 'like' }, { post: 'not-a-uuid', kind: 'seen' }, 'x']);
ok('a piece seen, opened and followed out is counted, signed out; a draft, an unknown kind or a bad id is not', n1 === 3, n1);
ok('...once a tab in thirty minutes (a reload is not a second reader)', (await track(S1, [{ post: pub, kind: 'open', source: 'news' }])) === 0 &&
   (await track(S2, [{ post: pub, kind: 'open', ref: 'reddit.com' }], 'desktop')) === 1 && (await track(S3, [{ post: pub, kind: 'open' }], 'desktop')) === 1);
ok('...a bad token counts nothing; fifty at most a call', (await track('short', [{ post: pub, kind: 'seen' }])) === 0 &&
   (await track('DDDDDDDDDDDDDDDDDDDDDDDD', Array.from({ length: 60 }, () => ({ post: pub, kind: 'seen' })))) === 1);
const ev = await q(`select kind, source, ref, device from creator_events order by id`);
ok('...and what is kept is only that: the page, the other site for an opening, the kind of device - no account', ev.length === 6 &&
   ev.every(e => !('user_id' in e)) && ev.find(e => e.ref === 'reddit.com').kind === 'open' && ev.filter(e => e.ref).length === 1, ev);

await as(FAN);
ok('the figures are the outlet\'s people\'s and the league\'s: a fan, or another outlet, is refused',
   /do not write/.test(await fails(() => q(`select public.creator_stats($1, 30)`, [outlet])) || ''));
await as(OTHER);
ok('...another outlet\'s owner too', /do not write/.test(await fails(() => q(`select public.creator_stats($1, 30)`, [outlet])) || ''));
await as(WRITER);
const st = (await q(`select public.creator_stats($1, 7) as j`, [outlet]))[0].j;
ok('totals for the stretch: seen, opened, followed out, and readers (tabs that opened one)', st.days === 7 &&
   st.totals.seen === 2 && st.totals.open === 3 && st.totals.out === 1 && st.totals.readers === 3 && st.before.open === 0, st.totals);
ok('...day by day, one row a day of the stretch, today last', st.daily.length === 7 && st.daily[6].open === 3, st.daily.map(d => d.open));
ok('...the pieces that did best, where readers came from (a page here, another site, direct) and on what',
   st.top[0].title === 'Published piece' && st.top[0].open === 3 &&
   ['news', 'elsewhere', 'direct'].every(s => st.sources.some(x => x.source === s)) && st.sites[0].site === 'reddit.com' &&
   st.devices.phone === 3 && st.devices.desktop === 2, st);
ok('...its followers, and its pieces by state', Number(st.followers) === 1 && st.pieces.drafts >= 2 && st.pieces.published >= 3 && st.pieces.scheduled === 0, st.pieces);
await as(ADMIN);
ok('...the league reads them too', (await q(`select public.creator_stats($1, 30) as j`, [outlet]))[0].j.totals.open === 3);

console.log('\npictures, and who may call what');
await as(WRITER);
const mw = p => q(`select public.may_write_creator_media($1) as ok`, [p]).then(r => r[0].ok);
ok('an outlet\'s people write into its own folder of creator-media: a picture with a plain name',
   await mw(outlet + '/cover-abc12345.webp') && !(await mw(outlet2 + '/cover-abc12345.webp')) && !(await mw(outlet + '/../x/cover-abc12345.webp')) &&
   !(await mw(outlet + '/cover-abc12345.svg')) && !(await mw('cover-abc12345.webp')));
await as('');
ok('...not signed in, nothing', !(await mw(outlet + '/cover-abc12345.webp')));
ok('the bucket is public, 3 MB, pictures only; its policy is there', (await q(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'creator-media'`))
   .every(b => b.public && Number(b.file_size_limit) === 3145728 && b.allowed_mime_types.join() === 'image/webp,image/jpeg,image/png') &&
   (await q(`select count(*)::int as n from pg_policies where tablename = 'objects' and policyname = 'creator_media_write'`))[0].n === 1);
const priv = async (role, fn) => (await q(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`))[0].ok;
ok('the signed-out may count a piece and nothing else', await priv('anon', 'public.creator_track(text, text, jsonb)') &&
   !(await priv('anon', 'public.creator_stats(uuid, integer)')) && !(await priv('anon', 'public.creator_post_revisions(uuid)')) &&
   !(await priv('anon', 'public.creator_publish_due()')) && !(await priv('anon', 'public.upsert_creator_post(uuid, uuid, text, text, text, jsonb, text, text, text, text, text[], text, text, timestamp with time zone)')) &&
   !(await priv('authenticated', 'public.creator_tags(text[])')));
ok('the old signature of upsert_creator_post is gone (PostgREST could not choose between two)',
   (await q(`select count(*)::int as n from pg_proc where proname = 'upsert_creator_post'`))[0].n === 1);
ok('the events and the revisions are shut: through the functions only',
   !(await q(`select has_table_privilege('anon', 'public.creator_events', 'select') as ok`))[0].ok &&
   !(await q(`select has_table_privilege('authenticated', 'public.creator_post_revisions', 'select') as ok`))[0].ok);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
