/* ============================================================================
   WHO'S YOUR FAVOURITE? — HOME's prompt for somebody who follows no club
   (migration 0161, docs/favourites.md).

   Nothing here needs a database or a browser:

   1. THE ONCE RULE, from epinoia/home/favourites.js: who is asked, and when a "seen", "remind me later"
      or "don't show this again" keeps it shut. Anybody signed in who follows no club is asked, once.
   2. THE ROWS: the country cards (country.js's groups, private leagues left out, the unfiled last) and
      the club row (leagues in the order picked, each league's clubs by name).
   3. THE STORE: one note per account in this browser, the newest twelve kept, garbage ignored.
   4. follow.js, run for real in a VM: { want, quiet } on toggle, the epinoia:follows event, offer().
   5. THE WIRING, read from the files: the anchor between the daily fixtures and MY FOLLOWED, the script
      order, the colours, the rail listening, MY FOLLOWED able to be drawn again, the profile switch.
   6. THE MIGRATION: 0161's set_fan_prefs is 0150's plus exactly one line.
   7. THE WORDS: every string the panel writes has a Japanese and a Spanish entry in its own context.

     node supabase/tests/favourites.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { loadDict } from '../../tools/i18n-coverage.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want),
  'got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want));
const section = s => console.log('\n' + s);

/* a stand-in localStorage, before the module reads any */
const store = {};
const fakeStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; }
};
Object.defineProperty(globalThis, 'localStorage', { value: fakeStorage, configurable: true, writable: true });
globalThis.EPINOIA_CONFIG = { supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'k' };

const FV = require(path.join(ROOT, 'epinoia', 'home', 'favourites.js'));
const C = require(path.join(ROOT, 'epinoia', 'country.js'));

/* =============================================== 1. THE ONCE RULE === */
section('the once rule');
{
  const NOW = 1_800_000_000_000;
  const T = 'team-1';
  const base = { signedIn: true, ready: true, prefs: { fav_team_ids: [], fav_league_ids: [], fav_player_ids: [], fav_game_ids: [] },
                 note: null, account: null, now: NOW };
  const ask = o => FV.shouldAutoOpen(Object.assign({}, base, o));

  ok('the first visit of somebody signed in who follows nothing opens it', ask({}) === true);
  ok('signed out never', ask({ signedIn: false }) === false);
  ok('a failed read of the follow lists is not "follows nothing"', ask({ ready: false }) === false);
  ok('no arguments at all is no', FV.shouldAutoOpen() === false && FV.shouldAutoOpen(null) === false);

  section('  who is asked: anybody who follows no club');
  ok('follows a club: not asked', ask({ prefs: { fav_team_ids: [T] } }) === false);
  ok('follows a club and has never seen it: still not asked', ask({ prefs: { fav_team_ids: [T] }, note: null }) === false);
  ok('follows a league but no club: asked, once', ask({ prefs: { fav_team_ids: [], fav_league_ids: ['l1'] } }) === true);
  ok('follows a player but no club: asked', ask({ prefs: { fav_team_ids: [], fav_player_ids: ['p1'] } }) === true);
  ok('follows a game but no club: asked', ask({ prefs: { fav_team_ids: [], fav_game_ids: ['g1'] } }) === true);
  ok('a fan with no row at all yet (no lists) is asked', ask({ prefs: {} }) === true && ask({ prefs: null }) === true);
  ok('followsTeam is the club list and nothing else',
     FV.followsTeam({ fav_team_ids: [T] }) && !FV.followsTeam({ fav_league_ids: ['l'], fav_player_ids: ['p'] }) &&
     !FV.followsTeam({ fav_team_ids: [] }) && !FV.followsTeam(null) && !FV.followsTeam({ fav_team_ids: 'x' }));

  section('  once');
  ok('seen (closed, finished, or scrolled past): not again by itself', ask({ note: { shown: true, at: NOW - 1 } }) === false);
  ok('any note without a time is no note', ask({ note: { shown: true } }) === true);
  ok('"remind me later": shut until the time is up', ask({ note: { later: NOW + 1000, at: NOW - 1 } }) === false);
  ok('"remind me later": open again once it is', ask({ note: { later: NOW - 1, at: NOW - 100 } }) === true);
  ok('"remind me later" runs out to exactly the moment', ask({ note: { later: NOW, at: NOW - 100 } }) === true);

  section('  don\'t show this again');
  ok('the browser said never', ask({ note: { never: true, at: NOW - 1 } }) === false);
  ok('the account said never (want_favourites false)', ask({ account: false }) === false);
  ok('...even with no note in this browser (another device)', ask({ account: false, note: null }) === false);
  ok('an account that has not said never does not stop it', ask({ account: true }) === true && ask({ account: null }) === true);
  ok('the browser\'s never holds even where the account says yes (a missing panel beats one that returns)',
     ask({ account: true, note: { never: true, at: 1 } }) === false);
  ok('"never" outranks a "remind me later" that has run out', ask({ note: { never: true, later: NOW - 1, at: 1 } }) === false);
  ok('six hours is the reminder', FV.LATER_MS === 6 * 3600 * 1000);
}

/* ======================================= 2. THE COUNTRY CARDS AND THE CLUBS === */
section('the country cards');
{
  const L = (id, name, country, extra) => Object.assign({ id, slug: id, name, country }, extra || {});
  const ls = [
    L('l-nbl', 'NBL', 'AU'), L('l-bnxt', 'BNXT League', 'BE+NL'), L('l-aba2', 'ABA League 2', 'XB'), L('l-aba', 'ABA League', 'XB'),
    L('l-lit', 'Some Cup', null), L('l-priv', 'Secret League', 'ES', { visibility: 'private' }), L('l-liga', 'Liga Endesa', 'ES'),
    L('l-wnbl', 'WNBL', 'AU'), null, { name: 'no id', country: 'FR' }
  ];
  const cards = FV.countryCards(ls, C);
  eq('one card per country, by the name a reader sees, the unfiled last',
     cards.map(c => c.name), ['Australia', 'Balkans', 'Belgium + Netherlands', 'Spain', FV.UNFILED]);
  eq('the leagues inside a card by name', cards.find(c => c.code === 'XB').leagues.map(l => l.name), ['ABA League', 'ABA League 2']);
  eq('a league in two countries is one card, coded as filed', cards.find(c => c.name === 'Belgium + Netherlands').code, 'BE+NL');
  ok('a private league is never offered', !cards.some(c => c.leagues.some(l => l.id === 'l-priv')) &&
     cards.find(c => c.code === 'ES').leagues.map(l => l.id).join() === 'l-liga');
  ok('a row with no id is dropped', !cards.some(c => c.leagues.some(l => l.name === 'no id')));
  eq('the unfiled card is called Other leagues', cards[cards.length - 1].name, 'Other leagues');
  eq('no leagues, no cards', [FV.countryCards([], C), FV.countryCards(null, C), FV.countryCards(ls, null)], [[], [], []]);
  ok('Balkans is named by us, not by Intl', cards.some(c => c.code === 'XB' && c.name === 'Balkans'));
}
section('the club row');
{
  const T = (id, name, league_id) => ({ id, name, league_id });
  const leagues = [{ id: 'B' }, { id: 'A' }];
  const rows = [T(1, 'Zed', 'A'), T(2, 'Alpha', 'A'), T(3, 'Mid', 'B'), T(4, 'Other', 'C'), T(5, 'Bee', 'B'), null];
  eq('the leagues in the order given, each league\'s clubs by name, other leagues\' clubs left out',
     FV.orderTeams(rows, leagues).map(t => t.name), ['Bee', 'Mid', 'Alpha', 'Zed']);
  eq('nothing followed, nothing to show', [FV.orderTeams(rows, []), FV.orderTeams(null, leagues)], [[], []]);
}
section('the small words');
{
  eq('plural: one, many, and its own plural', [FV.plural(1, 'league'), FV.plural(3, 'club'), FV.plural(0, 'league'), FV.plural(2, 'story', 'stories')],
     ['1 league', '3 clubs', '0 leagues', '2 stories']);
  eq('a list of names, with the rest counted', [FV.nameList(['a', 'b'], 4), FV.nameList(['a', 'b', 'c', 'd', 'e', 'f'], 4), FV.nameList(['a', '', null, 'b'])],
     ['a, b', 'a, b, c, d and 2 more', 'a, b']);
  const inks = ['ES', 'AU', 'XB', 'BE+NL', 'FI', '', 'GB'].map(FV.inkFor);
  ok('a country\'s ink is one of the kit\'s five, and always the same one',
     inks.every(i => /^var\(--(lume|aqua|amber|flare|violet)\)$/.test(i)) && FV.inkFor('ES') === FV.inkFor('ES'), inks.join());
  ok('...and not all the same one', new Set(inks).size > 2);
  const jwt = sub => 'h.' + Buffer.from(JSON.stringify({ sub, name: 'Zoë ★' })).toString('base64url') + '.s';
  eq('the user out of a token, whatever is in it', [FV.jwtSub(jwt('u-1')), FV.jwtSub('nonsense'), FV.jwtSub(''), FV.jwtSub(null), FV.jwtSub('a.!!!.c')], ['u-1', '', '', '', '']);
}

/* ============================================================ 3. THE STORE === */
section('the store');
{
  Object.keys(store).forEach(k => delete store[k]);
  eq('nothing stored, no note', FV.noteOf('u1'), null);
  FV.setNote('u1', { shown: true });
  ok('a note is kept for the account, with the time', FV.noteOf('u1').shown === true && FV.noteOf('u1').at > 0);
  eq('another account in the same browser has none', FV.noteOf('u2'), null);
  FV.setNote('u1', { later: 5 });
  ok('a new note REPLACES the last (closing ends a "remind me later")', FV.noteOf('u1').later === 5 && !FV.noteOf('u1').shown);
  FV.setNote('u1', { never: true });
  ok('"never" is a note like the rest', FV.noteOf('u1').never === true);
  for (let i = 0; i < 20; i++) { FV.setNote('user-' + i, { shown: true }); const s = JSON.parse(store[FV.STORE]); s.users['user-' + i].at = 1000 + i; store[FV.STORE] = JSON.stringify(s); }
  FV.setNote('newest', { shown: true });
  const users = Object.keys(JSON.parse(store[FV.STORE]).users);
  ok('the newest twelve accounts are kept, the rest forgotten', users.length === 12 && users.includes('newest') && !users.includes('user-0'), users.join());
  store[FV.STORE] = '{not json';
  eq('garbage in the store is no notes', FV.readStore(), { users: {} });
  store[FV.STORE] = JSON.stringify({ users: 'x' });
  eq('the wrong shape is no notes', FV.readStore(), { users: {} });
  store[FV.STORE] = JSON.stringify({ users: { a: 'not an object' } });
  eq('a note that is not an object is no note', FV.noteOf('a'), null);
  ok('the key is the one the profile clears', FV.STORE === 'epinoia.favourites' && /'epinoia\.favourites'/.test(rd('epinoia', 'me', 'me.js')));

  const session = o => { store['sb-proj-auth-token'] = JSON.stringify(o); };
  session({ access_token: 'x.y.z', user: { id: 'from-user' } });
  eq('the account from the stored session', FV.storedUserId(), 'from-user');
  session({ currentSession: { access_token: 'x.y.z', user: { id: 'nested' } } });
  eq('...in either shape', FV.storedUserId(), 'nested');
  session({ access_token: 'h.' + Buffer.from(JSON.stringify({ sub: 'from-token' })).toString('base64url') + '.s' });
  eq('...or from the token, when the session carries no user', FV.storedUserId(), 'from-token');
  delete store['sb-proj-auth-token'];
  eq('nobody signed in is nobody', FV.storedUserId(), '');
}

/* ============================================================ 4. follow.js === */
section('follow.js: set rather than flip, quietly, and say so');
{
  const src = rd('epinoia', 'follow.js');
  const run = row => {
    const posted = [], events = [], appended = [];
    const win = { EPINOIA_CONFIG: { supabaseUrl: 'https://p.supabase.co', supabaseAnonKey: 'k' },
                  dispatchEvent: e => { events.push(e); return true; },
                  CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i && i.detail; } } };
    win.window = win;
    let fail = false;
    const ctx = {
      console, JSON, Object, Array, Set, Date, String, Promise, encodeURIComponent,
      localStorage: { getItem: () => JSON.stringify({ access_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600 }) },
      location: { pathname: '/epinoia/home/', search: '', href: '' },
      document: { createElement: () => ({ addEventListener() {}, setAttribute() {} }), querySelector: () => null,
                  querySelectorAll: () => [], head: { appendChild: n => appended.push(n) } },
      window: win,
      fetch: async (url, init) => {
        if (/rpc\/set_fan_prefs/.test(url)) {
          if (fail) return { ok: false, status: 500, json: async () => ({ message: 'boom' }) };
          posted.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => [row || {}] };
      }
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: 'follow.js' });
    return { F: win.EpinoiaFollow, posted, events, appended, failNext: () => { fail = true; } };
  };

  let r = run({ fav_team_ids: [], fav_league_ids: [] });
  await r.F.load();
  eq('want: true follows what is not followed', await r.F.toggle('team', 't1', 'T One', { want: true }), { ok: true, on: true });
  eq('...and writes the list', r.posted, [{ p: { fav_team_ids: ['t1'] } }]);
  eq('...and says so on the window', r.events.map(e => [e.type, e.detail]), [['epinoia:follows', { kind: 'team', id: 't1', on: true }]]);
  eq('want: true again is already so: nothing written, nothing said, still on',
     [await r.F.toggle('team', 't1', 'T One', { want: true }), r.posted.length, r.events.length], [{ ok: true, on: true }, 1, 1]);
  eq('want: false unfollows', [await r.F.toggle('team', 't1', 'T One', { want: false }), r.posted[1]], [{ ok: true, on: false }, { p: { fav_team_ids: [] } }]);
  eq('want: false on what is not followed changes nothing',
     [await r.F.toggle('team', 'nobody', 'X', { want: false }), r.posted.length], [{ ok: true, on: false }, 2]);
  eq('no options is the old flip', [await r.F.toggle('league', 'l1', 'L'), await r.F.toggle('league', 'l1', 'L')].map(x => x.on), [true, false]);
  await new Promise(s => setTimeout(s, 0));

  r = run({ fav_team_ids: [] });
  await r.F.load();
  await r.F.toggle('team', 'q1', 'Quiet', { want: true, quiet: true });
  await new Promise(s => setTimeout(s, 0));
  eq('quiet: no push offer', r.appended.length, 0);
  await r.F.toggle('team', 'l1', 'Loud');
  await new Promise(s => setTimeout(s, 0));
  eq('...and without it the offer is made as it always was', r.appended.length, 1);
  r.F.offer('team', 'Somebody');
  await new Promise(s => setTimeout(s, 0));
  ok('offer() is there for the end of a run of quiet follows (it loads push.js once)', typeof r.F.offer === 'function' && r.appended.length === 1);

  r = run({ fav_team_ids: ['keep'] });
  await r.F.load();
  r.failNext();
  const res = await r.F.toggle('team', 'nope', 'N', { want: true, quiet: true });
  ok('a write that fails is reported, put back, and never said to the page',
     res.ok === false && /boom/.test(res.reason) && r.events.length === 0 && r.F.has('team', 'nope') === false && r.F.has('team', 'keep') === true, JSON.stringify(res));
}

/* ============================================================ 5. THE WIRING === */
section('HOME and the pages around it');
{
  const home = rd('epinoia', 'home', 'index.html');
  const js = rd('epinoia', 'home', 'favourites.js');
  const css = rd('epinoia', 'home', 'favourites.css');
  const at = s => home.indexOf(s);
  ok('the anchor sits between the daily fixtures and MY FOLLOWED',
     at('id="fixtures"') > 0 && at('id="favourites"') > at('id="fixtures"') && at('id="followed"') > at('id="favourites"'));
  ok('...empty, so with no script it takes no room, and in its own language context',
     /<div class="fav-anchor" id="favourites" data-i18n-ctx="favourites"><\/div>/.test(home));
  ok('it is not a numbered section (renumber() counts .sec with an .idx)', !/id="favourites"[^>]*class="sec/.test(home) && !/class="sec[^>]*id="favourites"/.test(home));
  ok('the stylesheet is linked, stamped', /href="favourites\.css\?v=\d+"/.test(home));
  ok('the script comes after follow.js, country.js and front.js, which it uses',
     at('favourites.js?v=') > at('../follow.js?v=') && at('favourites.js?v=') > at('../country.js?v=') && at('favourites.js?v=') > at('front.js?v='));
  ok('...deferred, like every other file here', /<script src="favourites\.js\?v=\d+" defer><\/script>/.test(home));
  ok('the fixtures, the anchor and MY FOLLOWED are all in the frame', at('class="ep-frame hm"') > 0);

  ok('no innerHTML: every name is text', !/innerHTML/.test(js));
  ok('no inline handler or eval (the CSP is script-src \'self\')', !/onclick=|onerror=|eval\(|new Function/.test(js));
  ok('every request has a deadline', /function timed\(/.test(js) && !/[^.]fetch\(/.test(js.replace(/root\.fetch\(/g, '')));
  ok('a pick is set, quietly, never flipped', /F\.toggle\(kind, id, name, \{ want, quiet: true \}\)/.test(js));
  ok('taps are saved one after another', /ctx\.chain\s*\.then\(\(\) => F\.toggle/.test(js) && /ctx\.chain = run/.test(js));
  ok('the follows are read as the fan, never as HOME\'s anonymous reader', !/EpinoiaAccess/.test(js) && /F\.load\(\)/.test(js));
  ok('a sign-in landing on HOME is heard (the magic link arrives with the page already loaded)',
     /addEventListener\('epinoia:auth'/.test(js) && /addEventListener\('hashchange'/.test(js));
  ok('signed out, the line leads to sign-in and comes back with #favourites',
     /signin\/\?next=' \+ encodeURIComponent\(next\)/.test(js) && /'#favourites'/.test(js));
  ok('the rule opens it by hand and closes it again', /rule\.addEventListener\('click'/.test(js) && /close\('x'\)/.test(js));
  ok('the line is watched, so it opens as they scroll to it', /IntersectionObserver/.test(js) && /io\.observe\(rule\)/.test(js));
  ok('by itself it takes neither their scroll position nor their keyboard', /if \(byHand\) \{[\s\S]{0,260}scrollIntoView[\s\S]{0,220}\.focus\(/.test(js));
  ok('a fan who follows leagues but no club starts at the clubs', /!byHand && P\.filled && P\.at === 'countries' && followedLeagues\(\)\.length\) await toTeams\(P, true\)/.test(js));
  ok('MY FOLLOWED is drawn again when the panel closes on a change, and the push offer is made once',
     /H\.refresh\('followed'\)/.test(js) && /F\.offer\(first\.kind, first\.name\)/.test(js) && /how === 'later' \|\| how === 'never'/.test(js));
  ok('"don\'t show again" is the account\'s too, where the database has the switch', /set_fan_prefs/.test(js) && /want_favourites: !!on/.test(js) && /want_favourites/.test(js));
  ok('the account\'s switch is read tolerantly (a database without the column answers 400: no answer)', /if \(!r\.ok\) return null;/.test(js));
  ok('names are data: never for the language engine', (js.match(/setAttribute\('translate', 'no'\)/g) || []).length >= 3);
  ok('the ten in view are the widest step and the row steps down from there',
     /--n:10/.test(css) && [9, 8, 7, 6, 5, 4].every(n => new RegExp('--n:' + n + '\\}').test(css)) && /--n:3\.2/.test(css) && /--n:2\.5/.test(css));

  ok('the panel is BLACK in the light theme and WHITE in the dark',
     /\.fav-anchor\{[^}]*--fav-bg:#ffffff;--fav-fg:#04100b/.test(css) &&
     /:root\[data-theme="light"\] \.fav-anchor\{[^}]*--fav-bg:#050a07;--fav-fg:#ffffff/.test(css));
  ok('the line is the same colour as the panel', /\.fav-rule::before\{[^}]*background:var\(--fav-bg\)/.test(css));
  ok('it unrolls out of the line, as the fans\' vote does', /grid-template-rows:0fr/.test(css) && /\.fav\.open\{grid-template-rows:1fr\}/.test(css) && /clip-path:inset\(0 0 100% 0\)/.test(css));
  ok('the screens are a deck that slides, the rail\'s way', /\.fav-track\{[^}]*translateX\(calc\(var\(--i,0\) \* -100%\)\)/.test(css));
  ok('a screen that is off leaves the tab order', /\.fav-stage\[inert\]\{visibility:hidden\}/.test(css) && /setAttribute\('inert', ''\)/.test(js));
  ok('a first card is clear of the fade at the strip\'s end (padding and scroll-padding agree)', /padding:10px 12px 16px;scroll-padding-inline:12px/.test(css));
  ok('nothing moves for a reader who asked for reduced motion', /@media \(prefers-reduced-motion:reduce\)/.test(css) && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(js));
  ok('a touch phone has no arrow buttons (it swipes), a mouse in a narrow window keeps them', /@media \(max-width:620px\) and \(hover:none\)\{ \.fav-nav\{display:none\} \}/.test(css));

  const front = rd('epinoia', 'home', 'front.js');
  ok('front.js can draw a section again, after its own first run, and says so in its API',
     /function refresh\(name\)/.test(front) && /firstRuns\.followed = followed/.test(front) && /return \{ register, refresh,/.test(front));
  const nav = rd('epinoia', 'nav.js');
  ok('the rail\'s "your follows" is drawn again after a follow made on this page',
     /window\.addEventListener\('epinoia:follows', \(\) => \{\s*followsDrawn = false;/.test(nav));
  const me = rd('epinoia', 'me', 'me.js'), meHtml = rd('epinoia', 'me', 'index.html');
  ok('the profile has the switch, on unless the account said never', /id="wFavourites"/.test(meHtml) && /prefs\.want_favourites !== false/.test(me));
  ok('...saved with the rest', /want_favourites: \$\('#wFavourites'\)\.checked/.test(me));
  ok('...and turning it on clears this browser\'s own "never" for this account', /delete u\.never/.test(me) && /s\.users\[user\.id\]/.test(me));
  ok('the profile says when it opens', /once, when you have not followed a club yet/.test(meHtml));
}

/* ========================================================== 6. THE MIGRATION === */
section('migration 0161');
{
  const m50 = rd('supabase', 'migrations', '0150_fan_vote.sql');
  const sql = rd('supabase', 'migrations', '0161_favourites_prompt.sql');
  const fnOf = s => (s.match(/create or replace function public\.set_fan_prefs\(p jsonb\)[\s\S]*?\nend \$\$;\n/) || [''])[0];
  const a = fnOf(m50), b = fnOf(sql);
  ok('it re-creates set_fan_prefs', a.length > 500 && b.length > 500);
  const extra = b.split('\n').filter(l => !a.split('\n').includes(l));
  eq('...as 0150\'s function plus exactly one line', extra.length, 1);
  ok('...and that line is the new switch, tagged', /want_favourites\s+= coalesce\(\(p->>'want_favourites'\)::boolean, want_favourites\),\s+-- 0161/.test(extra[0] || ''), extra[0]);
  eq('...and nothing of 0150\'s was dropped', a.split('\n').filter(l => !b.split('\n').includes(l)), []);
  ok('the column is on by default, and adding it twice is harmless',
     /alter table public\.fan_prefs add column if not exists want_favourites boolean not null default true;/.test(sql));
  ok('a read-only check says so if either half did not take',
     /column_name = 'want_favourites'/.test(sql) && /pg_get_functiondef\('public\.set_fan_prefs\(jsonb\)'::regprocedure\)/.test(sql));
  ok('it writes nothing but the column and the function', !/\binsert\b|\bdelete\b|\bupdate\b|\bdrop\b/i.test(sql.replace(/--.*$/gm, '').replace(/create or replace function[\s\S]*?\nend \$\$;\n/, '')));
  const nums = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /^\d{4}_/.test(f)).map(f => f.slice(0, 4));
  ok('0161 is the only 0161', nums.filter(n => n === '0161').length === 1);
  ok('...and follows 0160 without a gap', nums.includes('0160'));
  ok('the fans\' vote\'s switch and this one are both kept by the profile', /want_fanvote: \$\('#wFanvote'\)\.checked/.test(rd('epinoia', 'me', 'me.js')));
}

/* ============================================================= 7. THE WORDS === */
section('the words');
{
  const js = rd('epinoia', 'home', 'favourites.js').replace(/\\u2019/g, '’').replace(/\\u00b7/g, '·').replace(/\\u2026/g, '…');
  const STATIC = [
    'Who’s your favourite?', 'Who’s your favourite? Pick the leagues you watch and the clubs you back',
    'Which Leagues Do You Prefer to Watch?', 'Who Do You Back?', 'Tap the clubs you want to follow.',
    'Step 1 of 2 · Leagues', 'Step 2 of 2 · Clubs', 'All set', 'You’re In', 'Here’s who you’re following.',
    'Tap a country to see its leagues.', 'Tap a league to follow it.', 'Tap the clubs you back.',
    'Following', 'Skip', 'Advance', 'Done', 'Pick another league', 'Add more leagues', 'Add more',
    'Remind me later', 'Don’t show this again', 'Find them on your profile and in My followed.',
    'Loading the leagues…', 'Loading the clubs…', 'The clubs could not be loaded just now.',
    'These leagues have no clubs listed yet.', 'Pick a league first, and its clubs are here.',
    'Following is not available just now. Try again in a little while.', 'Other leagues', 'Back to the countries',
    'Previous countries', 'More countries', 'Previous leagues', 'More leagues', 'Previous clubs', 'More clubs', 'no clubs'
  ];
  const core = require(path.join(ROOT, 'epinoia', 'i18n.js'));
  const tr = (D, s, ctx) => { const o = core.translateText(D, s, ctx, null); return typeof o === 'string' ? o : (o && o.t != null ? o.t : o); };
  /* the strip's two arrow buttons are labelled 'Previous ' + label and 'More ' + label, for three rows */
  const BUILT = STATIC.filter(s => /^(Previous|More) (countries|leagues|clubs)$/.test(s));
  ok('every string the panel writes is really in favourites.js (an entry for words that are gone is a stale entry)',
     STATIC.filter(s => !BUILT.includes(s)).every(s => js.includes(s)), STATIC.filter(s => !BUILT.includes(s) && !js.includes(s)).join(' | '));
  ok('...and the six arrow labels are built from the three rows\' names',
     /'Previous ' \+ label/.test(js) && /'More ' \+ label/.test(js) && ['countries', 'leagues', 'clubs'].every(r => new RegExp("strip\\('" + r + "'\\)").test(js)) && BUILT.length === 6);
  for (const code of ['ja', 'es']) {
    const D = loadDict(code, []);
    const miss = STATIC.filter(s => { const t = tr(D, s, ['favourites']); return !t || t === s; });
    ok(code + ': every one is translated in the panel\'s own context', miss.length === 0, miss.join(' | '));
    ok(code + ': "Back to the countries" is its own entry, not the generic "Back to…"', !/the countries/.test(tr(D, 'Back to the countries', ['favourites'])));
    ok(code + ': the same words outside the panel are left to the rest of the site (nothing leaks into the shared table)',
       ['Advance', 'Skip', 'You’re In', 'All set', 'Add more'].every(s => tr(D, s, []) == null),
       ['Advance', 'Skip', 'You’re In', 'All set', 'Add more'].map(s => s + '=' + tr(D, s, [])).join(' | '));
  }
  const home = rd('epinoia', 'home', 'index.html');
  ok('the anchor carries the context the entries live under', /id="favourites" data-i18n-ctx="favourites"/.test(home));
  for (const code of ['ja', 'es']) {
    const D = loadDict(code, ['account']);
    const t = s => tr(D, s, []);
    ok(code + ': the profile\'s switch is translated', ['On HOME', 'Favourites prompt'].every(s => t(s) !== s) &&
       t('open “Who’s your favourite?” on HOME once, when you have not followed a club yet, to pick the leagues you watch and the clubs you back. Off, it stays out of your way, and it can still be opened from the line under the daily fixtures.') !== undefined);
    ok(code + ': the picker\'s country names', ['Belgium + Netherlands', 'Kosovo', 'Balkans'].every(s => (code === 'es' && s === 'Kosovo') || t(s) !== s));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
