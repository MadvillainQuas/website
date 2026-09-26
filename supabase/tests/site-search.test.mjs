/* ============================================================================
   THE RAIL'S SEARCH - teams, players and leagues across the whole site (migrations 0179 and 0180,
   epinoia/search.js, the row in nav.js, the Analytics tab).

   Read from the migrations: what may be found is what the site shows anyone (a hidden league and everything in
   it, a player withheld from the public, and a player whose latest club is in a hidden league are never returned);
   nothing that identifies a person comes back; the helpers are not for browsers to call. What is searched is
   recorded ANONYMOUSLY: no session token, no account, no address, phone number or web address, at most 200 a minute.

   Run under Node: search.js's pure parts (how a name is folded, what is marked, what is finished in grey, where a
   result goes), how it asks (the function, then a second look forgiving a typing mistake only when the first found
   nothing, the tables when the function is not there, what it remembers), the recents, and that nav.js puts the row
   first in the foot, loads the script only when wanted, and opens the phone's sheet.

   0179 and 0180 were also run on a real Postgres (PGlite) over stand-ins for the tables they read - 42 and 31
   checks: words in any order with a middle name missing, initials, nicknames, a club's league words, a sponsor's
   name not needed ("udine" finds OLD WILD WEST Udine), accents, typos when asked, every visibility rule, the
   anonymity of the analytics, the report, the prune - and the pages in Chromium with 39 (the row, the box, the list,
   the grey completion, the keys, the phone's sheet, before 0179, Japanese, Spanish). Both harnesses live outside
   the repo.

     node supabase/tests/site-search.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + JSON.stringify(d) : '')); } };

const S = require(path.join(ROOT, 'epinoia', 'search.js'));

/* ----------------------------------------------------------- the migrations --- */
const m78 = rd('supabase', 'migrations', '0179_site_search.sql');
const m79 = rd('supabase', 'migrations', '0180_search_analytics.sql');
console.log('\nmigration 0179: what may be found, and what comes back');
{
  const fn = m78.slice(m78.indexOf('create or replace function public.site_search'), m78.indexOf('alter function public.site_fold'));
  ok('a league is found only if the caller may see it (0139), for leagues, clubs and players alike', (fn.match(/league_visible\(/g) || []).length >= 3);
  ok('a player withheld from the public is never found', /not public\.player_withheld\(pl\.is_minor, pl\.public_consent\)/.test(fn));
  ok('...nor one whose latest club is in a league the caller may not see (a free agent is)', /order by re\.active desc, re\.created_at desc/.test(fn) && /cur\.ok is not false/.test(fn));
  const head = fn.slice(0, fn.indexOf('language plpgsql'));
  ok('a row is a kind, an id, a name, where it is, a colour and a crest: no account id, no email, no birth year, no minor flag',
     /returns table \(kind text, id uuid, name text, slug text, sub text, league_slug text, league_name text,\s+colour text, logo text, short_name text\)/.test(head)
     && !/user_id|email|birth|is_minor/.test(head));
  ok('it runs as its owner (the tables\' row-level security is not asked, and the rules above are)', /language plpgsql stable security definer set search_path = public/.test(fn));
  ok('only the search is for the browser to call; the helpers are the service role\'s',
     /grant execute on function public\.site_search\(text, integer, boolean\) to anon, authenticated;/.test(m78)
     && /grant execute on function public\.site_rank\(text, text\[\], text, text, boolean\) to service_role;/.test(m78) && !/site_rank[^;]*to anon/.test(m78)
     && /has_function_privilege\('anon', 'public\.site_rank/.test(m78));
  ok('the length asked for is at most twelve a kind and four leagues; under two letters is nothing',
     /least\(coalesce\(p_limit, 6\), 12\)/.test(fn) && /limit least\(n, 4\)/.test(fn) && /if char_length\(q\) < 2 then return; end if;/.test(fn));
  ok('only rows that could match are ranked: every word no club could account for has to be in the name first',
     /site_musts\(toks, p_fuzzy, ctxcap\)/.test(fn) && /not exists \(select 1 from unnest\(musts\) ms/.test(fn));
}
console.log('\nmigration 0179: smart matching');
{
  ok('a name is folded on both sides: lower case, accents, dots and apostrophes, hyphens and slashes', /translate\(regexp_replace\(lower\(coalesce\(t, ''\)\)/.test(m78) && /-_\/,/.test(m78));
  ok('words in any order with others between: every typed word is looked for on its own', /foreach k in array toks loop/.test(m78) && /position\(' ' \|\| k in ps\) > 0/.test(m78));
  ok('a suffix or a particle typed is dropped when other words were (jr, sr, iii, de, van...)', /noise constant text\[\] := array\['jr','sr'/.test(m78) && /'van'/.test(m78) && /k <> all \(noise\)/.test(m78));
  ok('nicknames both ways, from one table of groups (mike/michael, liz/elizabeth, giannis/yannis...)', /when 'mike' then array\[/.test(m78) && /when 'michael' then array\[[^\]]*'mike'/.test(m78) && /when 'yannis' then array\[/.test(m78));
  ok('a club\'s words (its league\'s) may stand for words not in the player\'s name, but at least one word must be his own', /own = 0 then return null/.test(m78) && /position\(' ' \|\| k in pc\) > 0/.test(m78));
  ok('one typing mistake is forgiven only when asked, only for a word of four letters or more', /elsif fuzzy and char_length\(k\) >= 4 then/.test(m78) && /p_fuzzy boolean default false/.test(m78));
  ok('a club is also found by its short name, its initials and its other names (sponsors); a player by his other spellings',
     /array\[c\.name, c\.short_name, c\.initials\] \|\| coalesce\(c\.aliases/.test(m78) && /coalesce\(c\.aliases, '\{\}'\)/.test(m78));
  ok('the best come first: whole-name start, then word starts, then anywhere, then a typo; the shorter name first',
     /return 0; end if;/.test(m78) && /order by m\.r, char_length\(c\.name\), c\.name/.test(m78) && /order by c\.r, char_length\(c\.nm\), c\.nm/.test(m78));
  ok('the file checks itself: folding, ranks, a nickname, a middle name, a club word, a typo', /raise exception '0179: %'/.test(m78) && /'a middle name'/.test(m78) && /'a nickname'/.test(m78));
}
console.log('\nmigration 0180: what is searched, anonymously');
{
  const tbl = m79.slice(m79.indexOf('create table if not exists public.site_searches'), m79.indexOf('create index'));
  ok('a row holds when, the folded words, how many results, what kind was picked and its page name, device, language, app - and no session',
     /q\s+text not null check \(char_length\(q\) between 2 and 60\)/.test(tbl) && !/session|user|email|ip\b|signed_in/i.test(tbl.replace(/--[^\n]*/g, '')));
  ok('no browser role can read or write the table', /revoke all on table public\.site_searches from public, anon, authenticated/.test(m79) && /enable row level security/.test(m79));
  const fn = m79.slice(m79.indexOf('create or replace function public.analytics_search('), m79.indexOf('-- OUT.'));
  ok('the words are folded before they are kept, at most 60 characters', /public\.site_fold\(left\(coalesce\(p_q, ''\), 100\)\)/.test(fn) && /char_length\(v\) > 60/.test(fn));
  ok('an address, a phone number or a web address is never kept', /coalesce\(p_q, ''\) ~ '@'/.test(fn) && /regexp_replace\(v, '\[\^0-9\]', '', 'g'\)\) >= 6/.test(fn) && /https\?:\|www/.test(fn));
  ok('the whole table takes at most 200 a minute, with nothing to count per visitor', /count\(\*\) from site_searches where at > now\(\) - interval '1 minute'\) >= 200/.test(fn));
  ok('a visitor may record one; only a platform administrator may read the report; the builder is nobody\'s but the service\'s',
     /grant execute on function public\.analytics_search\(text, integer, text, text, text, text, text\) to anon, authenticated/.test(m79)
     && /is_platform_admin\(\)/.test(m79) && /grant execute on function public\.analytics_search_build\(integer\) to service_role/.test(m79)
     && /revoke all on function public\.analytics_search_report\(integer\) from public, anon/.test(m79));
  ok('every list is capped (100, the picked 50), and a withheld player is never named in it',
     /limit 100\) t/.test(m79) && /limit 50\) t/.test(m79) && /not public\.player_withheld\(pl\.is_minor, pl\.public_consent\)/.test(m79));
  ok('the daily prune takes the searches too, at 400 days', /delete from site_searches where at < now\(\) - interval '400 days'/.test(m79));
}

/* ------------------------------------------------------------ search.js: pure --- */
console.log('\nsearch.js: names');
ok('folded as the database folds: accents, dots and apostrophes gone, hyphens as spaces, spaces collapsed',
   S.fold('B.LEAGUE  Premier') === 'bleague premier' && S.fold('O\'Neil-Nagy / Ó') === 'oneil nagy o' && S.fold('Łukasz Żółć') === 'lukasz zolc' && S.fold('  ') === '' && S.fold(null) === '');
ok('the typed words: a suffix or particle is dropped when others were typed, kept when alone', S.words('Diggins Jr').join() === 'diggins' && S.words('jr').join() === 'jr' && S.words('van der Berg').join() === 'berg');
const NAME = 'Michael Ray Diggins Jr';
const cut = (name, q) => S.segments(name, q).map(s => (s.hit ? '[' + s.t + ']' : s.t)).join('');
ok('what matched is marked: the starts of words, in any order', cut(NAME, 'mich dig') === '[Mich]ael Ray [Dig]gins Jr' && cut(NAME, 'diggins michael') === '[Michael] Ray [Diggins] Jr', cut(NAME, 'mich dig'));
ok('...an initial, a word inside a name (three letters or more), and nothing for a nickname', cut(NAME, 'm d') === '[M]ichael Ray [D]iggins Jr' && cut('Newcastle Eagles', 'astle') === 'Newc[astle] Eagles' && cut(NAME, 'mike') === NAME);
ok('...through accents and punctuation: "lukasz" marks the whole of Łukasz; "bleague" marks B.LEAGUE', cut('Łukasz Żółć', 'lukasz') === '[Łukasz] Żółć' && cut('B.LEAGUE Premier', 'bleague') === '[B.LEAGUE] Premier', [cut('Łukasz Żółć', 'lukasz'), cut('B.LEAGUE Premier', 'bleague')]);
ok('...overlapping marks are one', cut('Diggins', 'dig diggins') === '[Diggins]');
ok('the grey completion is the rest of the name, when what is typed starts it', S.completion(NAME, 'mich') === 'ael Ray Diggins Jr' && S.completion(NAME, 'michael ') === 'Ray Diggins Jr' && S.completion(NAME, 'MICHAEL RAY') === ' Diggins Jr');
ok('...through accents; and none when it is not a start, is all of it, or is one letter', S.completion('Łukasz Żółć', 'lukasz') === ' Żółć' && S.completion(NAME, 'diggins') === '' && S.completion(NAME, NAME) === '' && S.completion(NAME, 'm') === '');

console.log('\nsearch.js: results');
ok('where a result goes: a league\'s front page, a club\'s page by its slug, a player by his id', S.hrefOf('../', { kind: 'league', slug: 'slb-men' }) === '../?l=slb-men'
   && S.hrefOf('../', { kind: 'team', slug: 'newcastle-eagles' }) === '../t/?t=newcastle-eagles'
   && S.hrefOf('', { kind: 'player', id: '13eff2f4-bd51-425b-93a5-af524786e20e', slug: 'x-y' }) === 'p/?p=13eff2f4-bd51-425b-93a5-af524786e20e'
   && S.hrefOf('', { kind: 'player', id: 'nope', slug: 'x-y' }) === 'p/?p=x-y');
const rows = [{ kind: 'league', id: 'l1', name: 'L' }, { kind: 'player', id: 'p1', name: 'P1' }, { kind: 'team', id: 't1', name: 'T1' }, { kind: 'player', id: 'p2', name: 'P2' }];
ok('listed as Teams, then Players, then Leagues, each in the order it came, and the arrow keys walk that order',
   S.grouped(rows).map(g => g.label + ':' + g.rows.map(r => r.id)).join('|') === 'Teams:t1|Players:p1,p2|Leagues:l1' && S.flat(rows).map(r => r.id).join() === 't1,p1,p2,l1');
const both = S.merge([rows[1]], [rows[1], rows[2]]);
ok('a second look adds what is new, marked as a close match, and never one twice', both.length === 2 && !both[0].close && both[1].close === true && both[1].id === 't1');
ok('a country\'s name in the reader\'s language', S.regionName('GB', 'en') === 'United Kingdom' && /日本/.test(S.regionName('jp', 'ja')) && S.regionName('xx1', 'en') === 'xx1' && S.regionName(null, 'en') === '');
ok('the line under a name: a league\'s country, a club\'s league, a player\'s club and league',
   S.subOf({ kind: 'league', sub: 'GB' }, 'en') === 'United Kingdom' && S.subOf({ kind: 'team', league_name: 'SLB Men' }, 'en') === 'SLB Men'
   && S.subOf({ kind: 'player', sub: 'Bristol Flyers', league_name: 'SLB Men' }, 'en') === 'Bristol Flyers · SLB Men' && S.subOf({ kind: 'player', sub: null, league_name: null }, 'en') === '');

console.log('\nsearch.js: before 0179 (the tables)');
{
  const q = S.restQueries('Michael Diggins Jr');
  ok('every word has to be in the name: leagues and clubs by name, a player by his first or last name, a suffix not asked for',
     q.league.includes('and=(name.ilike.*michael*,name.ilike.*diggins*)') && q.team.includes('leagues!inner(slug,name)') && q.team.includes('name.ilike.*diggins*')
     && q.player.includes('and=(or(first_name.ilike.*michael*,last_name.ilike.*michael*),or(first_name.ilike.*diggins*,last_name.ilike.*diggins*))') && !/\bjr\b/.test(q.player), q.player);
  const vals = (S.restQueries('a,b(c)*%d,e').league.match(/name\.ilike\.\*([^*]*)\*/g) || []).map(x => x.slice(12, -1));
  ok('...nothing that is a filter\'s own syntax gets through (a comma, a bracket, a star, a percent)', vals.length === 5 && vals.every(v => /^[a-z0-9]+$/.test(v)), vals);
  ok('...and nothing typed is nothing asked', S.restQueries('  ') === null);
  const t = S.fromRest('team', { id: 't', name: 'Newcastle Eagles', slug: 'newcastle-eagles', short_name: 'NEW', colour: '#000000', logo_path: 'x.png', leagues: { slug: 'slb-men', name: 'SLB Men' } });
  ok('a table row is the same shape as the function\'s', t.kind === 'team' && t.league_name === 'SLB Men' && t.short_name === 'NEW' && t.logo === 'x.png' && t.sub === null);
  const p = S.fromRest('player', { id: 'p', slug: 'a-b', first_name: 'Michael Ray', last_name: 'Diggins Jr' });
  ok('...a player\'s name is his first and last', p.name === 'Michael Ray Diggins Jr' && p.kind === 'player');
}

console.log('\nsearch.js: the recents');
{
  const mem = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m }; };
  const st = mem();
  const r1 = { kind: 'team', id: 't1', name: 'One', slug: 'one', junk: 'not kept', account: 'x' };
  S.keepRecent(st, r1);
  S.keepRecent(st, { kind: 'player', id: 'p1', name: 'Two', slug: 'two' });
  S.keepRecent(st, r1);
  const got = S.readRecent(st);
  ok('the last things picked, newest first, none twice, only the fields a result has', got.map(r => r.id).join() === 't1,p1' && !('junk' in got[0]) && !('account' in got[0]), got);
  for (let i = 0; i < 9; i++) S.keepRecent(st, { kind: 'team', id: 'x' + i, name: 'X' + i, slug: 'x' });
  ok('...five at most', S.readRecent(st).length === 5);
  st.setItem('epinoia_search_recent', 'not json');
  ok('...and a damaged store is an empty one, not an error', S.readRecent(st).length === 0 && S.readRecent({ getItem() { throw new Error('private mode'); } }).length === 0);
}

/* ---------------------------------------------------------- search.js: asking --- */
console.log('\nsearch.js: asking');
const CFG = { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'sb_publishable_test' };
function net(o) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body, signal: init && init.signal });
    const json = v => ({ ok: true, status: 200, json: async () => v });
    if (/\/rpc\/site_search$/.test(url)) {
      if (o.rpc === 'missing') return { ok: false, status: 404, json: async () => ({}) };
      if (o.rpc === 'error') return { ok: false, status: 500, json: async () => ({}) };
      return json(o.rpc(body));
    }
    if (/^https:\/\/x\.supabase\.co\/rest\/v1\/leagues\?/.test(url)) return json((o.tables && o.tables.leagues) || []);
    if (/\/rest\/v1\/teams\?/.test(url)) return json((o.tables && o.tables.teams) || []);
    if (/\/rest\/v1\/players\?/.test(url)) return json((o.tables && o.tables.players) || []);
    if (/\/rest\/v1\/roster_entries\?/.test(url)) return json((o.tables && o.tables.roster) || []);
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return calls;
}
const P1 = { kind: 'player', id: '13eff2f4-bd51-425b-93a5-af524786e20e', name: 'Michael Ray Diggins Jr', slug: 'd', sub: 'Bristol Flyers', league_slug: 'slb-men', league_name: 'SLB Men' };
{
  S._reset();
  let calls = net({ rpc: b => (b.p_q === 'diggins' ? [P1] : []) });
  let r = await S.search(CFG, 'diggins');
  ok('the function is asked for six of each kind, with mistakes not forgiven, with the public key', r.via === 'rpc' && r.rows.length === 1 && calls.length === 1
     && calls[0].body.p_q === 'diggins' && calls[0].body.p_limit === 6 && calls[0].body.p_fuzzy === false && /rpc\/site_search$/.test(calls[0].url), calls);
  await S.search(CFG, 'Diggins');
  await S.search(CFG, ' D.iggins ');
  ok('what was asked is remembered by how it folds: the same words in another case or with a dot are not asked again', calls.length === 1, calls.length);
  r = await S.search(CFG, 'digins');
  ok('a search that finds NOTHING is asked again forgiving one mistake', calls.filter(c => c.body && c.body.p_q === 'digins').map(c => c.body.p_fuzzy).join() === 'false,true', calls.map(c => c.body && c.body.p_fuzzy));
  S._reset();
  calls = net({ rpc: b => (b.p_fuzzy ? [P1] : []) });
  r = await S.search(CFG, 'digins');
  ok('...and what that finds is marked as close matches', r.rows.length === 1 && r.close === true && r.rows[0].close === true, r);
  S._reset();
  calls = net({ rpc: b => [] });
  r = await S.search(CFG, 'zzzzzz');
  ok('...a second look that finds nothing either is just nothing', r.rows.length === 0 && r.close === false && calls.length === 2);
  S._reset();
  calls = net({ rpc: b => [P1, Object.assign({}, P1, { id: 'b' })] });
  r = await S.search(CFG, 'michael');
  ok('a search that finds something is not asked again (mistakes are for when there is nothing)', calls.length === 1 && !r.close);
  S._reset();
  calls = net({ rpc: b => [] });
  await S.search(CFG, 'zzz');
  ok('...nor a word of three letters (too short to guess)', calls.length === 1);
  S._reset();
  calls = net({ rpc: 'error' });
  let threw = false;
  try { await S.search(CFG, 'diggins'); } catch (e) { threw = true; }
  ok('a database that fails is an error to show, not an empty list', threw);
}
{
  S._reset();
  let calls = net({ rpc: 'missing', tables: {
    leagues: [], teams: [{ id: 't', name: 'Newcastle Eagles', slug: 'newcastle-eagles', short_name: 'NEW', colour: '#000000', logo_path: null, leagues: { slug: 'slb-men', name: 'SLB Men' } }],
    players: [{ id: 'p', slug: 'a-b', first_name: 'Cole', last_name: 'Long' }],
    roster: [{ player_id: 'p', active: true, created_at: 'x', teams: { name: 'Newcastle Eagles', short_name: 'NEW', colour: '#000000', logo_path: null, leagues: { slug: 'slb-men', name: 'SLB Men' } } }] } });
  const parts = [];
  let r = await S.search(CFG, 'newcastle', null, rows => parts.push(rows.map(x => x.kind).join()));
  ok('with no function in the database, the tables answer: leagues, clubs, and players with their club and league',
     r.via === 'tables' && r.rows.map(x => x.kind).join() === 'team,player' && r.rows[1].sub === 'Newcastle Eagles' && r.rows[1].league_name === 'SLB Men', r);
  ok('...the clubs are shown while the players are still being looked for', parts.length >= 2 && parts.some(p => p === 'team') && parts[parts.length - 1] === 'team,player', parts);
  const before = calls.length;
  await S.search(CFG, 'newcastle eagles');
  ok('...and the missing function is not asked again', !calls.slice(before).some(c => /rpc\/site_search/.test(c.url)) && calls.filter(c => /rpc\/site_search/.test(c.url)).length === 1);
}
{
  S._reset();
  const ctl = new AbortController();
  const calls = net({ rpc: () => [] });
  await S.search(CFG, 'newcastle', ctl.signal);
  ok('a search can be called off: the signal goes with the request', calls[0].signal === ctl.signal);
}

/* -------------------------------------------------------------- the rail's row --- */
console.log('\nthe rail\'s row');
const nav = rd('epinoia', 'nav.js'), css = rd('epinoia', 'kit', 'nav.css'), js = rd('epinoia', 'search.js');
ok('the search is the FIRST row of the foot, where the HOME row was, and HOME is still the small house at the bottom', /navFoot\.append\(searchRow, adminRow, platRow\);/.test(nav) && /footEnd\.appendChild\(home\)/.test(nav));
ok('it is a rail row that says "search", with the slash key, and a label for a screen reader', /el\('span', 'tx', 'search'\), el\('kbd', 'ep-sr-key', '\/'\)/.test(nav) && /aria-label', 'Search teams, players and leagues'/.test(nav));
ok('the script is fetched the first time it is wanted (a hand over the row, a touch, a focus, a click, the slash key), never with every page',
   /s\.src = root \+ 'search\.js' \+ stamp;/.test(nav) && /\['pointerenter', 'touchstart', 'focus'\]\.forEach/.test(nav) && !/<script[^>]*search\.js/.test(rd('epinoia', 'home', 'index.html')));
ok('the slash key opens it from anywhere but a box that is being typed in', /e\.key !== '\/'/.test(nav) && /tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT'/.test(nav) && /isContentEditable/.test(nav));
ok('a phone gets a sheet over the page (the menu closes behind it); a desktop the box in the rail', /phone: \(\) => !!\(window\.matchMedia && window\.matchMedia\('\(max-width: 820px\)'\)/.test(nav) && /closeSheet: \(\) => \{ if \(nav\.classList\.contains\('drawer-open'\)\) navToggle\.click\(\); \}/.test(nav));
ok('what was searched goes to the tracker\'s search() (which is anonymous, and off when counting is off)', /window\.EpinoiaTrack\.search\(e\)/.test(nav) && /log: e =>/.test(nav));
ok('the list is fixed above the box and placed by the page\'s zoom (1.25 / 1.5): screen pixels divided back by its own scale', /const k = panel\.offsetWidth \? \(b\.width \/ panel\.offsetWidth\) \|\| 1 : 1;/.test(js) && /panel\.style\.bottom = \(\(vh - r\.top \+ 8\) \/ k\)/.test(js));
ok('it is styled: the row, the box, the list above the desktop rail, the sheet on a phone at 16px so the phone does not zoom, above every other layer',
   /\.ep-sr-panel\{ position:fixed; z-index:2600/.test(css) && /\.ep-sr-sheet\{ position:fixed; inset:0; z-index:2600/.test(css) && /\.ep-sr-sbar \.ep-sr-in, \.ep-sr-sbar \.ep-sr-ghost\{ font-size:16px/.test(css) && /body\.ep-sr-locked\{ overflow:hidden \}/.test(css));
ok('the keys: arrows walk the list, Enter opens it (Ctrl or Cmd in a new tab), Tab or the right arrow takes the grey completion, Escape clears then closes',
   /e\.key === 'ArrowDown'/.test(js) && /e\.key === 'ArrowUp'/.test(js) && /e\.key === 'Enter'/.test(js) && /pick\(r, e\.ctrlKey \|\| e\.metaKey\)/.test(js) && /e\.key === 'Tab' && !e\.shiftKey \|\| e\.key === 'ArrowRight'/.test(js) && /e\.key === 'Escape'/.test(js));
ok('a result is a real link (a middle click and a copied link work) and is announced as an option in a list', /el\('a', 'sr-o'\)/.test(js) && /a\.setAttribute\('role', 'option'\)/.test(js) && /role', 'combobox'/.test(js));
ok('what a person typed is only ever set as text, never as markup', !/innerHTML/.test(js));
ok('what is logged is once per search (a pick, or the box closing), and only from three letters', /if \(S\.logged\) return;/.test(js) && /fq\.length < 3/.test(js) && /kind: S\.picked \? S\.picked\.kind : null, ref: S\.picked \? S\.picked\.slug : null/.test(js));

/* --------------------------------------------------------------- the words --- */
console.log('\nthe privacy notice and the words');
const priv = rd('epinoia', 'privacy', 'index.html');
ok('the privacy notice says what is kept of a search: the words folded, the count, the pick, no code at all, never an address, phone number or web address',
   /What you search for<\/div>/.test(priv) && /kept with no code at all, not even the visit&rsquo;s/.test(priv) && /never kept/.test(priv.slice(priv.indexOf('What you search for'))));
for (const code of ['ja', 'es']) {
  const core = rd('epinoia', 'i18n', code + '.js'), info = rd('epinoia', 'i18n', code, 'info.js');
  const miss = ['Search teams, players and leagues', 'teams, players, leagues', 'Close search', 'Search results', 'Type a team, a player or a league.', 'Close matches are shown too.',
                'searching…', 'Search is not available just now.', 'Nothing matches'].filter(w => !core.includes("'" + w + "':"));
  ok(code + ': the row, the box, the list and its messages are translated', !miss.length && /'search': '/.test(core), miss);
  ok(code + ': the privacy notice\'s new paragraph is translated', info.includes("'What you search for':") && info.includes('When you use the search box'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
