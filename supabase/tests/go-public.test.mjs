/* ============================================================================
   ONE FEED OF EVERYBODY'S STAMPS, AND GOING PUBLIC IN ONE TAP (EPINOIA GO, migration 0177).

   Read from the migration: a fan's stamps are shown only by their own choice (go_settings.stamps_public,
   which needs public and the age confirmed), never because they joined the leaderboards before the feed showed
   stamps; one call - set_go_profile - turns on the leaderboards and the stamps together; the feed is the approved
   photographs, then the stamps of the fans who chose, a stamp with a photograph shown once, as the photograph;
   no account id, no note, no email; a youth league's stamps and a private league's are not shown to a stranger.

   Run under Node: public.js against a small stand-in for the document (the tap, the order of the calls, the
   fall-back before 0177, the reasons it refuses), stampcard.js (the day and hour on the league's clock, a card
   for a game and for a game that was removed), and the pages that use them (go.js, photos.js, the stamps page).

   0177 was also run on a real Postgres (PGlite) over stand-ins for the tables it reads - 45 checks: the
   switch and its refusals, the feed's order, filters and paging, who may read what, a fan taking their stamps
   off - and the pages were driven in Chromium with 40 (the card, the strip, the feed, the wall, Japanese,
   Spanish, before 0177). Both harnesses live outside the repo.

     node supabase/tests/go-public.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + JSON.stringify(d) : '')); } };

/* ------------------------------------------------------------ a stand-in for the document --- */
class N {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this._text = ''; this.value = ''; this.disabled = false; this.props = {}; this.style = { setProperty: (k, v) => { this.props[k] = v; } }; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { (this.listeners.click || []).forEach(f => f({ preventDefault() { this.stopped = true; } })); }
  get classes() { return this.className.split(/\s+/).filter(Boolean); }
}
const all = (n, f, out = []) => { n.children.forEach(c => { if (f(c)) out.push(c); all(c, f, out); }); return out; };
globalThis.document = { createElement: t => new N(t), createTextNode: t => { const n = new N('#text'); n._text = String(t); return n; } };
globalThis.window = { dispatchEvent() {}, EpinoiaI18n: { locale: 'en-GB' } };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };

const P = require(path.join(ROOT, 'epinoia', 'go', 'public.js'));
const SC = require(path.join(ROOT, 'epinoia', 'go', 'stampcard.js'));

/* ------------------------------------------------------------------- the migration --- */
const sql = rd('supabase', 'migrations', '0177_go_feed.sql');
console.log('\nmigration 0177');
ok('showing stamps is its own switch, off unless chosen, and only with public',
   /add column if not exists stamps_public boolean not null default false/.test(sql)
   && /constraint go_settings_stamps_need_public check \(not stamps_public or public\)/.test(sql));
ok('one call turns on the leaderboards and the stamps together; going off turns off both',
   /create or replace function public\.set_go_profile\(p_on boolean, p_adult boolean default false\)/.test(sql)
   && /values \(me, want, want,/.test(sql) && /stamps_public = excluded\.stamps_public/.test(sql));
ok('...with a username and 18 or over, as the leaderboards always needed', /'reason', 'username'/.test(sql) && /'reason', 'adult'/.test(sql)
   && /coalesce\(go_settings\.adult_confirmed_at, excluded\.adult_confirmed_at\)/.test(sql));
ok('...only a signed-in fan can call it, and nobody writes the table directly',
   /revoke all on function public\.set_go_profile\(boolean, boolean\) from public, anon/.test(sql)
   && /grant execute on function public\.set_go_profile\(boolean, boolean\) to authenticated/.test(sql)
   && /has_table_privilege\('authenticated', 'public\.go_settings', 'update'\)/.test(sql));
ok('the old switch takes the stamps off with the leaderboards, and turning it on shows the leaderboards only',
   /stamps_public = case when excluded\.public then go_settings\.stamps_public else false end/.test(sql));
ok('an earlier choice shows no stamp: nobody is switched on by the migration',
   !/update\s+public\.go_settings\s+set\s+stamps_public/i.test(sql) && !/update\s+go_settings\s+set\s+stamps_public/i.test(sql));
ok('go_my_settings says whether the stamps are shown', /'stamps', coalesce\(\(select stamps_public from go_settings where user_id = auth\.uid\(\)\), false\)/.test(sql));
const feed = sql.slice(sql.indexOf('create or replace function public.go_feed'), sql.indexOf('revoke all on function public.go_feed'));
ok('the feed is public: anon may read it', /grant execute on function public\.go_feed\([^)]*\) to anon, authenticated/.test(sql));
ok('photographs first (group 0), then stamps (group 1), in one ordered read', /0 as grp/.test(feed) && /\b1\s*\n\s*from stamps s/.test(feed) && /order by f\.grp,/.test(feed));
ok('a stamp is shown only for a fan who is public, shows stamps, and confirmed 18 or over',
   /gs\.public and gs\.stamps_public\s+and gs\.adult_confirmed_at is not null/.test(feed));
ok('...never a youth league\'s, and a private league\'s only for those who may see it',
   /public\.league_visible\(s\.league_id\) and coalesce\(l\.go_photos, true\)/.test(feed));
ok('...a stamp with an approved photograph is the photograph: not shown twice',
   /not exists \(select 1 from go_photos ph\s+where ph\.user_id = s\.user_id and ph\.game_id = s\.game_id and ph\.status = 'approved'\)/.test(feed));
ok('a row has no account id, no note, no location',
   !/returns table \([^)]*\buser_id\b/.test(feed) && !/s\.note/.test(feed) && !/accuracy_m|\blat\b|\blng\b/.test(feed));
ok('it carries what a stamp\'s card is drawn from: the clubs\' short names, colours and crests, and the league\'s time zone',
   /home_short text, home_colour text, home_logo text, away_short text, away_colour text, away_logo text/.test(feed) && /tz text/.test(feed)
   && /l\.timezone/.test(feed));
ok('paged by offset, at most 96 a page', /offset greatest\(coalesce\(p_offset, 0\), 0\)/.test(feed) && /least\(coalesce\(p_limit, 48\), 96\)/.test(feed));

/* ------------------------------------------------------------ public.js: what a fan sees --- */
console.log('\npublic.js');
const states = [
  [null, null], [undefined, null], ['x', null],
  [{ public: false, username: null }, 'name'], [{ public: false, username: 'louie' }, 'off'],
  [{ public: true, stamps: false, username: 'louie' }, 'boards'], [{ public: true, stamps: true, username: 'louie' }, 'on'],
  [{ public: true, username: 'louie' }, 'on'],
];
ok('where a fan stands: signed out, no name, private, on the boards only, public; before 0177 the boards are all there is',
   states.every(([s, want]) => P.stateOf(s) === want), states.map(([s]) => P.stateOf(s)));
ok('a username\'s local checks are the server\'s',
   P.nameProblem('ab') === 'short' && P.nameProblem('a'.repeat(21)) === 'long' && P.nameProblem('7up') === 'start'
   && P.nameProblem('louie.h') === 'characters' && P.nameProblem('Louie_7') === '');
ok('the button carries the age confirmation until the fan has given it once',
   P.goLabel({ adult: false }) === 'I am 18 or over · go public' && P.goLabel({ adult: true }) === 'go public' && P.goLabel(null) === 'I am 18 or over · go public');

function server(state, o) {
  const calls = [];
  const opts = o || {};
  const rpc = async (fn, body) => {
    calls.push([fn, body]);
    if (fn === 'set_username') { state.username = body.p; return { data: { ok: true, username: body.p } }; }
    if (fn === 'set_go_profile') {
      if (opts.no0177) return { missing: true };
      if (opts.refuse) return { data: { ok: false, reason: opts.refuse } };
      Object.assign(state, body.p_on ? { public: true, stamps: true, adult: true } : { public: false, stamps: false });
      return { data: { ok: true } };
    }
    if (fn === 'set_go_public') { Object.assign(state, body.p_public ? { public: true, adult: true } : { public: false }); return { data: { ok: true } }; }
    if (fn === 'go_my_settings') return { data: opts.no0177 ? { public: state.public, adult: state.adult, username: state.username } : Object.assign({}, state) };
    return { missing: true };
  };
  return { rpc, calls };
}
const buttons = n => all(n, c => c.tagName === 'button' || (c.tagName === 'a' && c.classes.includes('ep-btn')));

{
  const st = { public: false, stamps: false, adult: false, username: 'louie' };
  const s = server(st);
  const host = new N('div'), changed = [];
  P.mount(host, { rpc: s.rpc, settings: Object.assign({}, st), variant: 'card', changed: x => changed.push(x) });
  ok('a fan with a name, not public: one button that says 18 or over and go public, and what it means',
     buttons(host).length === 1 && buttons(host)[0].textContent === 'I am 18 or over · go public' && /Never your email or your notes/.test(host.textContent), host.textContent);
  buttons(host)[0].click();
  await settle();
  ok('one tap: one call, on, with the age said', s.calls.filter(c => c[0] === 'set_go_profile').length === 1
     && JSON.stringify(s.calls[0]) === JSON.stringify(['set_go_profile', { p_on: true, p_adult: true }]), s.calls);
  ok('...the page is told, and the card is now the public one with the name', changed.length === 1 && changed[0].public && changed[0].stamps
     && /You are public/.test(host.textContent) && /@louie/.test(host.textContent) && buttons(host)[0].textContent === 'go private', host.textContent);
  buttons(host)[0].click();
  await settle();
  ok('go private: off, and the card offers going public again, no age words now (given once)',
     JSON.stringify(s.calls[s.calls.length - 2]) === JSON.stringify(['set_go_profile', { p_on: false, p_adult: false }]) && !st.public
     && buttons(host)[0].textContent === 'go public', s.calls.map(c => c[0]));
}
{
  const st = { public: true, stamps: false, adult: true, username: 'louie' };
  const s = server(st);
  const host = new N('div');
  P.mount(host, { rpc: s.rpc, settings: Object.assign({}, st), variant: 'card' });
  ok('on the leaderboards from before the feed: asked once about the stamps - show them, or come off',
     /Show your stamps on the feed too\?/.test(host.textContent) && buttons(host).map(b => b.textContent).join() === 'show my stamps,take me off');
  buttons(host)[0].click();
  await settle();
  ok('...one tap and they are shown', st.stamps === true && /You are public/.test(host.textContent));
  const strip = new N('div');
  P.mount(strip, { rpc: s.rpc, settings: { public: true, stamps: false, adult: true, username: 'louie' }, variant: 'strip' });
  ok('a strip for such a fan says so, in one line, with one button', /Your stamps are not on the feed yet/.test(strip.textContent) && buttons(strip).length === 1);
  const none = new N('div');
  P.mount(none, { rpc: s.rpc, settings: { public: true, stamps: true, adult: true, username: 'louie' }, variant: 'strip' });
  ok('a strip asks a fan who is already public nothing', none.children.length === 0);
  const signedOut = new N('div');
  P.mount(signedOut, { rpc: s.rpc, settings: null, variant: 'card' });
  ok('signed out (or before 0166): nothing at all', signedOut.children.length === 0);
}
{
  const st = { public: false, stamps: false, adult: false, username: null };
  const s = server(st);
  const host = new N('div');
  P.mount(host, { rpc: s.rpc, settings: Object.assign({}, st), variant: 'card' });
  const input = all(host, c => c.tagName === 'input')[0];
  ok('no username: the card asks for one, right there', !!input && input.placeholder === 'username' && /Choose a username first: it is how everyone sees you\./.test(host.textContent));
  buttons(host)[0].click();
  await settle();
  ok('...an empty name is refused before any call, in the username\'s own words', s.calls.length === 0 && /At least 3 characters\./.test(host.textContent), host.textContent);
  input.value = 'Louie_7';
  buttons(host)[0].click();
  await settle();
  ok('...a good name is saved, then the profile goes public: two calls, in that order',
     JSON.stringify(s.calls.slice(0, 2).map(c => c[0])) === JSON.stringify(['set_username', 'set_go_profile']) && st.public && /@Louie_7/.test(host.textContent), s.calls.map(c => c[0]));
  const strip = new N('div');
  P.mount(strip, { rpc: s.rpc, settings: { public: false, adult: false, username: null }, variant: 'strip', homeHref: '../#goPublic' });
  const link = buttons(strip)[0];
  ok('a strip for a fan with no name sends them to the card (no form squeezed into a line)', link.tagName === 'a' && link.href === '../#goPublic' && !all(strip, c => c.tagName === 'input').length);
}
{
  const st = { public: false, stamps: false, adult: false, username: 'louie' };
  const s = server(st, { no0177: true });
  const host = new N('div');
  P.mount(host, { rpc: s.rpc, settings: Object.assign({}, st), variant: 'card' });
  buttons(host)[0].click();
  await settle();
  ok('before 0177 is pushed: set_go_profile is not there, so the leaderboards switch is used', JSON.stringify(s.calls.slice(0, 2).map(c => c[0])) === JSON.stringify(['set_go_profile', 'set_go_public']) && st.public, s.calls.map(c => c[0]));
  ok('...and no question about stamps follows', /You are public/.test(host.textContent) && !/Show your stamps/.test(host.textContent));
}
{
  const st = { public: false, stamps: false, adult: false, username: 'louie' };
  const s = server(st, { refuse: 'adult' });
  const host = new N('div');
  P.mount(host, { rpc: s.rpc, settings: Object.assign({}, st), variant: 'card' });
  buttons(host)[0].click();
  await settle();
  ok('a refusal is said in words, and the button is usable again', /Confirm you are 18 or over\./.test(host.textContent) && buttons(host)[0].disabled === false, host.textContent);
}

/* ------------------------------------------------------------------ stampcard.js --- */
console.log('\nstampcard.js');
const NOW = Date.parse('2026-09-25T12:00:00Z');
const w1 = SC.whenText('2026-09-27T16:30:00Z', 'Europe/London', 'en-GB', NOW);
ok('the day and hour are the league\'s clock, not the reader\'s: 16:30 UTC in London in September is 17:30', w1.time === '17:30' && /Sun/.test(w1.day) && /27/.test(w1.day) && !/2026/.test(w1.day), w1);
const w2 = SC.whenText('2026-09-27T16:30:00Z', 'Asia/Tokyo', 'en-GB', NOW);
ok('...and Tokyo\'s is the next day\'s morning', w2.time === '01:30' && /Mon/.test(w2.day) && /28/.test(w2.day), w2);
ok('a year on another year\'s game', /2025/.test(SC.whenText('2025-03-01T19:00:00Z', 'Europe/London', 'en-GB', NOW).day));
ok('midnight is a game whose hour was never set: no hour', SC.whenText('2026-09-27T00:00:00Z', 'Europe/London', 'en-GB', NOW).time === '' || SC.whenText('2026-09-26T23:00:00Z', 'Europe/London', 'en-GB', NOW).time === '');
ok('a zone that is not one is the reader\'s own clock, not a crash; nothing for no date', SC.whenText('2026-09-27T16:30:00Z', 'Not/AZone', 'en-GB', NOW).day !== '' && SC.whenText(null, null, 'en-GB', NOW).day === '' && SC.whenText('nope', null, 'en-GB', NOW).time === '');
ok('a club as epinoiaCrest reads it, from the feed\'s flat columns',
   JSON.stringify(SC.teamOf({ home: 'Alpha', home_short: 'ALP', home_colour: '#aa2222', home_logo: 'c/a.png' }, 'home')) === JSON.stringify({ name: 'Alpha', short_name: 'ALP', colour: '#aa2222', logo_path: 'c/a.png' })
   && SC.colourOf('#12ab34') === '#12ab34' && SC.colourOf('red') === null && SC.colourOf('#12ab3') === null);
const row = { kind: 'stamp', id: 'x', username: 'Ana', home: 'Alpha', away: 'Beta', home_short: 'ALP', away_short: 'BET', home_colour: '#aa2222', away_colour: '#2222aa',
              tipoff_at: '2026-09-27T16:30:00Z', tz: 'Europe/London', venue: 'Arena One', city: 'Town', league: 'Open League' };
const card = SC.build(row, { href: 'photos/?u=Ana', cls: 'feed-card' });
const txt = card.textContent;
ok('a card is a link into that fan\'s page, in the find-a-game cards\' colours: home into away', card.tagName === 'a' && card.href === 'photos/?u=Ana'
   && card.classes.join() === 'sc,feed-card' && card.props['--c1'] === '#aa2222' && card.props['--c2'] === '#2222aa', [card.classes, card.props]);
ok('...both crests and the home crest as the watermark', all(card, c => c.classes.includes('sc-crest')).length === 2 && all(card, c => c.classes.includes('sc-mark')).length === 1);
ok('...who stamped it (a name, never translated), the teams big, the day and hour, the arena and town',
   /stamped by/.test(txt) && /@Ana/.test(txt) && /Alpha v Beta/.test(txt) && /Sun 27 Sept/.test(txt) && /17:30/.test(txt) && /Arena One · Town/.test(txt), txt);
ok('...names, days and hours are data: marked so the translator leaves them',
   all(card, c => c.getAttribute('translate') === 'no').map(c => c.textContent).join('|').includes('Alpha v Beta')
   && all(card, c => c.getAttribute('translate') === 'no' && c.textContent === '@Ana').length === 1);
const gone = SC.build({ kind: 'stamp', id: 'y', username: 'Flo', home: null, away: null, tipoff_at: null, created_at: '2026-09-20T18:00:00Z', venue: 'Arena Two', city: 'Town Two', league: 'Open League' }, {});
ok('a stamp whose game was removed later: the arena and the day it was stamped, no clubs, no hour',
   !all(gone, c => c.classes.includes('sc-crest')).length && /Arena Two/.test(gone.textContent) && /20 Sept/.test(gone.textContent) && !/\d\d:\d\d/.test(gone.textContent) && !/ v /.test(gone.textContent), gone.textContent);
let opened = null;
const held = SC.build(row, { href: '#', onOpen: r => { opened = r; } });
held.click();
ok('the wall keeps its place: onOpen is called and the link is not followed', opened === row);

/* ---------------------------------------------------------------- the pages that use them --- */
const goJs = rd('epinoia', 'go', 'go.js');
const photosJs = rd('epinoia', 'go', 'photos', 'photos.js');
const goHtml = rd('epinoia', 'go', 'index.html');
const stampsHtml = rd('epinoia', 'go', 'stamps', 'index.html');
const photosHtml = rd('epinoia', 'go', 'photos', 'index.html');
console.log('\nthe GO page');
ok('the feed asks go_feed and, before 0177, falls back to the photographs alone',
   /rpc\('go_feed', \{ p_limit: 60 \}\)/.test(goJs) && /r\.missing \? rpc\('go_photos_feed', \{ p_limit: 60 \}\) : r/.test(goJs)
   && /Object\.assign\(\{ kind: 'photo' \}, x\)/.test(goJs));
ok('...the arenas strip takes its thumbnails from the photographs only', /isPhoto\(p\) && p\.thumb_path && p\.venue_id/.test(goJs));
ok('the feed: photographs first, then the stamps as cards, the rest of the frames faded rather than repeated',
   /photos\.concat\(stamps\)\.slice\(0, FEED_N\)/.test(goJs) && /'feed-card spare'/.test(goJs) && /EpinoiaGoStampCard\.build\(q,/.test(goJs) && /cls: 'feed-card'/.test(goJs));
ok('...without stamps it is exactly what it was: ten photograph cards, going round them', /take = \(\) => photos\[next\+\+ % photos\.length\]/.test(goJs));
ok('...only the photograph cards swap', /cards\.push\(c\)/.test(goJs) && /const rest = photos\.slice\(cards\.length\)/.test(goJs));
ok('going public is drawn by public.js into every place that asks for it, and the page follows the change',
   /querySelectorAll\('\[data-go-public\]'\)/.test(goJs) && /P\.mount\(host, publicOpts\(host\), msg\)/.test(goJs) && /changed: publicChanged/.test(goJs)
   && /feedP = null;\s*loadFeed\(\);/.test(goJs) && !/function setPublic/.test(goJs));
ok('a fan just stamped is asked once, there, in a line: after the note and the photograph',
   /ask\.setAttribute\('data-go-public', 'strip'\);\s*drawPublic\(\);/.test(goJs) && !/if \(!x \|\| !host \|\| \(!S\.noteOk && !S\.photos\)\) return;/.test(goJs));
ok('the page has the card (in the boards), the strip (under the feed), and loads public.js and the card before go.js',
   /<div id="goPublic" data-go-public="card"><\/div>/.test(goHtml) && /<div id="goFeedJoin" data-go-public="strip"><\/div>/.test(goHtml)
   && /<script src="public\.js\?v=\d+" defer><\/script>\s*<script src="stampcard\.js\?v=\d+" defer><\/script>\s*<script src="go\.js/.test(goHtml)
   && /<link rel="stylesheet" href="stampcard\.css\?v=\d+">/.test(goHtml));
ok('the stamps page has the card too, at the top', /<div id="goPublicStamps" data-go-public="card"><\/div>/.test(stampsHtml)
   && stampsHtml.indexOf('goPublicStamps') < stampsHtml.indexOf('id="goTally"'));
console.log('\nthe wall');
ok('the wall asks go_feed one page at a time by offset, and before 0177 the photographs by the old paging',
   /rpc\('go_feed', Object\.assign\(\{ p_offset: S\.rows\.length, p_limit: PAGE \}, ask\)\)/.test(photosJs)
   && /rpc\('go_photos_feed', Object\.assign\(\{ p_before:/.test(photosJs) && /S\.legacy = true/.test(photosJs));
ok('...a row is never shown twice when the pages shift', /const seen = new Set\(S\.rows\.map\(rowKey\)\)/.test(photosJs));
const W = require(path.join(ROOT, 'epinoia', 'go', 'photos', 'photos.js'));
ok('...a photograph and a stamp with the same id are two rows', W.rowKey({ kind: 'photo', id: 'a' }) !== W.rowKey({ kind: 'stamp', id: 'a' }) && W.rowKey({ id: 'a' }) === W.rowKey({ kind: 'photo', id: 'a' }));
ok('a photograph opens whole and the arrows step through photographs only: a stamp has no whole view', /function photoAt\(i, dir\)/.test(photosJs) && /photoAt\(S\.open, -1\)/.test(photosJs) && /photoAt\(S\.open, 1\)/.test(photosJs));
ok('...a stamp is a card two tiles wide that opens that fan\'s page here; a divider says what follows',
   /EpinoiaGoStampCard\.build\(x, \{ href: location\.pathname \+ writeParams\(f\), cls: 'gp-sc', onOpen: \(\) => go\(f\) \}\)/.test(photosJs)
   && /'Stamps without a photograph'/.test(photosJs) && /\.gp-sc\{grid-column:span 2;/.test(photosHtml));
ok('...a signed-in fan who is not public is asked in one line above the wall',
   /<div id="gpJoin"><\/div>/.test(photosHtml) && /P\.mount\(host, \{ rpc, settings: S\.settings, variant: 'strip', homeHref: '\.\.\/#goPublic'/.test(photosJs));
ok('...and the page loads the card, the stamp card and their styles', /<script src="\.\.\/public\.js\?v=\d+" defer><\/script>\s*<script src="\.\.\/stampcard\.js\?v=\d+" defer><\/script>\s*<script src="photos\.js/.test(photosHtml)
   && /stampcard\.css/.test(photosHtml) && /look\.css/.test(photosHtml));
ok('the lede says what comes first', /Photographs of stamped games first, then the stamps of fans who chose to show them\./.test(photosHtml));

/* ------------------------------------------------------------------- what is promised --- */
console.log('\nthe privacy notice and the words');
const priv = rd('epinoia', 'privacy', 'index.html');
ok('the notice says what going public shows, never the email or the notes, and that stamps are private otherwise',
   /Going public<\/div>/.test(priv) && /your stamps on the feed: the game, the arena and the date, under your username\. Never your email or your notes\./.test(priv)
   && /Your stamps are private too, unless you go public/.test(priv));
ok('...and no longer says the leaderboards never show which arenas', !/never your email or which arenas/.test(priv));
ok('...says a fan already on the leaderboards keeps their stamps private until they say otherwise', /your stamps stay private until you say otherwise/.test(priv));
for (const code of ['ja', 'es']) {
  const go = rd('epinoia', 'i18n', code, 'go.js'), info = rd('epinoia', 'i18n', code, 'info.js');
  const miss = ['You are public', 'go private', 'go public', 'show my stamps', 'Want your stamps on the feed?', 'stamped by', 'Stamps without a photograph',
    'Your stamps are not on the feed yet', 'Show your stamps on the feed too?', 'Confirm you are 18 or over.', 'Nothing here yet.', 'username'].filter(w => !go.includes("'" + w + "':"));
  ok(code + ': the card, the strip, the cards and the wall are translated', !miss.length, miss);
  ok(code + ': the privacy notice\'s new paragraphs are translated and the old ones gone',
     info.includes("'Going public':") && info.includes('Your stamps are private too, unless you go public') && !info.includes('never your email or which arenas'));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
