/* ============================================================================
   PRIVATE LEAGUES, AND THE ROLES MACHINERY AROUND THEM (0139, 0140).

   The database's own self-tests run inside the migrations and prove the rules
   against a real Postgres. This checks the things a migration cannot: that the
   four gates 0118 built were ALL updated rather than three of them, that the
   fast path is still a fast path, and that the pages agree with the functions.

   The specific faults it is standing guard over:

   1. A GATE LEFT BEHIND. 0118 funnels every read of on-court content through
      can_view_league / league_visible / competition_visible / game_visible, each
      with an `access_mode = 'open' then true` shortcut. A private league is
      access_mode = 'open'. Miss one of those four and that surface stays public
      for a league somebody is paying to keep quiet.

   2. THE FAST PATH SWITCHED OFF. Each gate opens with "is anything gated at
      all", asked once per statement. Extend privacy without extending that
      test and a private league is invisible to the very policies meant to hide
      it; write the test without the index behind it and every query on the
      platform pays for a sequential scan of leagues.

   3. THE FRONT PAGE. Six different pages list leagues straight off the table.
      They are hidden by the leagues_read policy and nothing else, so that
      policy must not be `using (true)` any more.

   4. A ROLE THAT NEVER LANDS. grant_role used to refuse an address with no
      account and tell the admin to come back later, which is the step that gets
      forgotten. It now waits — but only if the trigger that applies it fires on
      CONFIRMATION rather than on sign-up, or an address somebody else typed
      first collects the league.

   5. THE SCORER'S PICKER. It listed every league on the platform, so a league
      admin for one league was offered another league's fixtures and refused
      only after pressing load.

     node supabase/tests/privateleagues.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

const m39 = read('supabase', 'migrations', '0139_private_leagues.sql');
const m40 = read('supabase', 'migrations', '0140_roles_before_signup.sql');
const plat = read('epinoia', 'admin', 'platform', 'platform.js');
const platH = read('epinoia', 'admin', 'platform', 'index.html');
const boot = read('epinoia', 'score', 'bootstrap.js');
const invite = read('epinoia', 'invite', 'invite.js');
const inviteH = read('epinoia', 'invite', 'index.html');
const admin = read('epinoia', 'admin', 'admin.js');
const adminH = read('epinoia', 'admin', 'index.html');
const me = read('epinoia', 'me', 'me.js');
const meH = read('epinoia', 'me', 'index.html');
const home = read('epinoia', 'home.js');
const nav = read('epinoia', 'nav.js');
const navcss = read('epinoia', 'kit', 'nav.css');
const follow = read('epinoia', 'follow.js');
const kit = read('epinoia', 'kit', 'epinoia-kit.css');
const country = read('epinoia', 'country.js');
const robots = read('epinoia', 'robots.txt');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* The body of one `create or replace function public.<name>` in a migration,
   up to the closing `$$;`. */
function fn(sql, name) {
  const at = sql.indexOf('create or replace function public.' + name + '(');
  if (at < 0) return '';
  const end = sql.indexOf('$$;', at);
  return end < 0 ? '' : sql.slice(at, end);
}

/* ---- 1. every gate 0118 built knows about privacy ------------------------- */
console.log('\n1. all four gates, not three');
for (const g of ['can_view_league', 'can_view_league_for', 'league_visible',
                 'competition_visible', 'game_visible']) {
  const body = fn(m39, g);
  ok(g + ' is re-stated in 0139', body.length > 40);
  ok(g + ' asks about privacy', /visibility/.test(body),
     'a private league is access_mode = open, so the open shortcut would pass it through');
}
/* The two that answer per league must decide privacy BEFORE the open-league
   shortcut, or the shortcut answers first and privacy never runs. */
for (const g of ['can_view_league', 'can_view_league_for']) {
  const body = fn(m39, g);
  ok(g + ' asks about privacy before it short-circuits on an open league',
     body.indexOf('visibility') < body.indexOf("access_mode = 'open'"));
}
/* ...and the three the policies call must keep a columns-only fast path for an
   ordinary league rather than calling a lookup for every public row. */
for (const g of ['league_visible', 'competition_visible', 'game_visible']) {
  ok(g + ' still answers an ordinary league on the leagues row alone',
     /l\.visibility = 'public' and l\.access_mode = 'open'/.test(fn(m39, g)));
}

/* ---- 2. the statement-level fast path -------------------------------------- */
console.log('\n2. nothing is evaluated per row until something is actually gated');
ok('any_gated_league covers BOTH kinds of gate',
   /access_mode = 'members'/.test(fn(m39, 'any_gated_league')) &&
   /visibility = 'private'/.test(fn(m39, 'any_gated_league')));
ok('the 0118 name is kept, so its dozen policies pick this up unchanged',
   /create or replace function public\.any_members_league\(\)/.test(m39) &&
   /select public\.any_gated_league\(\);/.test(fn(m39, 'any_members_league')));
ok('a partial index keeps "is any league private" an index probe',
   /create index if not exists leagues_private_idx[\s\S]*?where visibility = 'private'/.test(m39));
ok('the shop-window policies open on that one statement-level question',
   /not \(select public\.any_private_league\(\)\) or \(%s\)/.test(m39));
ok('...and privacy does NOT wait on the memberships master switch',
   !/memberships_enabled/.test(fn(m39, 'any_private_league')),
   'a private league must not become browsable because Stripe is not configured');

/* ---- 3. the front page ----------------------------------------------------- */
console.log('\n3. a private league is off every listing');
ok('leagues_read is no longer `using (true)`',
   /create policy leagues_read on public\.leagues for select\s*\n\s*using \(not \(select public\.any_private_league\(\)\)/.test(m39));
for (const t of ['seasons', 'competitions', 'competition_teams', 'teams', 'roster_entries']) {
  ok(t + ' is covered too', new RegExp("\\('" + t + "',").test(m39));
}
ok('players are deliberately NOT hidden',
   !/\('players',\s+'public\.league_open_to_me/.test(m39),
   'a player may be in a private league and three public ones; hiding the person breaks those');
/* The walk from a row to its league must not be written into the policy TEXT.
   A policy expression runs as the querying role, so a sub-select over teams or
   seasons is itself filtered by those tables' policies: once the club is
   hidden, the walk returns NULL, NULL reads as "nothing to check", and every
   roster row sails through the policy that was meant to hide it. */
ok('the walk from a row to its league happens inside a definer function',
   !/'public\.\w+\(\(select /.test(m39) &&
   ['team_open_to_me', 'season_open_to_me', 'comp_open_to_me']
     .every(f => /security definer/.test(fn(m39, f))),
   'a sub-select in the policy text is filtered by the hidden table and answers NULL');
ok('the invitation page is kept out of the index',
   /noindex,nofollow/.test(inviteH) && /Disallow: \/epinoia\/invite\//.test(robots));

/* ---- 4. the link ----------------------------------------------------------- */
console.log('\n4. the link, and what it does');
ok('a token is CSPRNG bytes, not a guessable id',
   /extensions\.gen_random_bytes\(18\)/.test(fn(m39, 'league_invite_create')));
ok('only a platform admin may mint a link that hands over the league',
   /p_role = 'league_admin' and not public\.is_platform_admin\(\)/.test(fn(m39, 'league_invite_create')));
ok('the invites table answers nobody over the API',
   /create policy invites_none on public\.league_invites for select using \(false\)/.test(m39));
ok('redeeming locks the row, so two phones cannot both take the last place',
   /where token = p_token for update/.test(fn(m39, 'redeem_league_invite')));
ok('redeeming twice is a success and does not spend a use',
   /'already', true/.test(fn(m39, 'redeem_league_invite')));
ok('peek is callable by anon — you may know what you were invited to',
   /grant execute on function public\.league_invite_peek\(text\) to anon/.test(m39));
ok('the page checks the link BEFORE sending anybody to sign in',
   invite.indexOf('league_invite_peek') < invite.indexOf('signinHref()'));
ok('...and never redeems without a deliberate press',
   /join\.addEventListener\('click'/.test(invite) &&
   !/redeem_league_invite[\s\S]{0,200}\n\s*\}\s*\n\s*if \(document\.readyState/.test(invite));
ok('the page names the account it is about to join as',
   /Joining as /.test(invite) && /Not you\?/.test(invite));
ok('the console builds the link against this page, not a guessed origin',
   /new URL\('\.\.\/\.\.\/invite\/\?i='/.test(plat));
ok('revoking says what it does not do',
   /Everybody who already used it is still in/.test(fn(m39, 'league_invite_revoke')));

/* ---- 5. a role that has not found its person yet --------------------------- */
console.log('\n5. granting a role to somebody who has not signed up');
ok('grant_role no longer dead-ends on an unknown address',
   !/no account for/.test(fn(m40, 'grant_role')) &&
   /insert into pending_roles/.test(fn(m40, 'grant_role')));
ok('...and neither does grant_league_writer',
   !/no account for/.test(fn(m40, 'grant_league_writer')) &&
   /insert into pending_roles/.test(fn(m40, 'grant_league_writer')));
ok('it lands on CONFIRMATION, not on sign-up',
   /after update of email_confirmed_at on auth\.users/.test(m40) &&
   /when \(old\.email_confirmed_at is null and new\.email_confirmed_at is not null\)/.test(m40),
   'the auth.users row exists before the code is entered, so an insert trigger ' +
   'would hand a league to whoever typed the address first');
ok('an already-confirmed account still collects it at insert',
   /if new\.email_confirmed_at is not null then\s*\n\s*perform public\.apply_pending_roles/.test(m40));
ok('applying never raises, so a bad row cannot block a sign-up',
   /exception when others then\s*\n\s*raise warning '0140/.test(fn(m40, 'apply_pending_roles')));
ok('addresses are stored folded, so case cannot make two invitations',
   /check \(email = lower\(trim\(email\)\)/.test(m40));
ok('one platform_admin row per person, whatever the unique constraint thinks of NULLs',
   /create unique index if not exists memberships_platform_one[\s\S]*?where scope_id is null/.test(m40));
ok('the last administrator is counted by person, not by row',
   /count\(distinct user_id\) from memberships where role = 'platform_admin'/.test(fn(m40, 'revoke_role')));
ok('a platform admin is platform-scoped whatever the caller sent',
   /st := 'platform'; sid := null;/.test(fn(m40, 'grant_role')));

console.log('\n6. the consoles say what the database now does');
ok('the platform console no longer promises the account must already exist',
   !/The account must already exist/.test(platH));
ok('...and shows what is waiting',
   /pending_roles_list/.test(plat) && /pendList/.test(platH));
ok('an "invited" answer is not drawn as a failure',
   !/\/\^no account\/\.test/.test(plat) && /\/\^invited\/\.test/.test(plat));
ok('the league console shows its own waiting appointments',
   /loadPendingMembers/.test(admin) && /pending_roles_list/.test(admin));

/* ---- 7. the scorer offers only what it can deliver ------------------------- */
console.log('\n7. a league admin is not offered another league\'s fixtures');
ok('the picker no longer lists every league on the platform',
   !/const lgs = await sbApi\('leagues\?select=id,name,slug&order=name'\);\s*\n\s*if \(!lgs\.length\)/.test(boot));
ok('it takes the list from whoami, and gives a platform admin all of them',
   /who\.is_platform_admin\s*\n?\s*\? await sbApi\('leagues\?select=id,name,slug&order=name'\)/.test(boot) &&
   /\(who\.leagues \|\| \[\]\)/.test(boot));
ok('an assigned statistician gets their own fixtures rather than an empty picker',
   /who\.scoring \|\| \[\]/.test(boot) && /games\?id=in\.\(/.test(boot));
ok('the picker reads as the signed-in account, so a private league resolves',
   /h\.Authorization = 'Bearer ' \+ tok/.test(boot));

/* ---- 8. a link that keeps working, said out loud ------------------------- */
console.log('\n8. a permanent link is the default and says so');
/* Unlimited was always possible — max_uses null, expires_at null — but the only
   way to ask for it was leaving a box labelled "uses" empty, which reads as an
   omission rather than a choice. */
ok('the database still takes "no limit" as null',
   /max_uses    int check \(max_uses is null or max_uses > 0\)/.test(m39) &&
   /expires_at  timestamptz,\s+-- null = no expiry/.test(m39));
for (const [where, src] of [['platform console', plat], ['league console', admin + adminH]]) {
  ok(where + ' offers "anyone with the link" as the first, default option',
     /anyone with the link/.test(src));
  ok(where + ' only sends a cap when one was actually chosen',
     /=== 'n'/.test(src));
  ok(where + ' says which links are permanent',
     /permanent, used /.test(src));
}

/* ---- 9. your leagues ------------------------------------------------------ */
console.log('\n9. the profile says which leagues are yours, and why');
ok('the profile is a rail of two, not one long scroll',
   /data-p="profile"/.test(meH) && /data-p="leagues"/.test(meH) &&
   /id="pane-profile"/.test(meH) && /id="pane-leagues"/.test(meH));
ok('the three attachments are three sections, not one merged list',
   /id="runList"/.test(meH) && /id="privList"/.test(meH) && /id="followList"/.test(meH));
ok('each is read with what the account can already see — no new reader',
   /rpc\('whoami'\)/.test(me) && /from\('league_guests'\)/.test(me) &&
   /fav_league_ids/.test(me));
ok('a followed league is read as the account, not on the anon key',
   /sb\.from\('leagues'\)\s*\n?\s*\.select\('id,slug,name,colour_a'\)\.in\('id', ids\)/.test(me),
   'a league you follow can be a private one you were let into, and anonymously its row does not exist');
ok('leaving a private league is offered, and it is the guest\'s own row',
   /from\('league_guests'\)\.delete\(\)/.test(me) && /\.eq\('user_id', user\.id\)/.test(me));
ok('the renumbering follows the sections into their pane',
   /#pane-profile > section\.sec/.test(me),
   'it was #body > section.sec, which the rail would have broken');
ok('an error in this pane is reported in this pane',
   /function oops\(host, text\)/.test(me) && !/return status\('could not leave/.test(me),
   'status() writes into the notifications section, which is in the other pane');
ok('the pane is drawn when it is opened, not at boot',
   /if \(want === 'leagues'\) paintMyLeagues\(\);/.test(me));

/* ---- 10. the league's own page opens for the people let into it ---------- */
console.log('\n10. a private league has a league page, not the hub');
/* WHAT WENT WRONG. /epinoia/?l=<slug> resolves the league and switches into
   league mode; not finding it falls through to the platform hub. home.js reads
   anonymously on purpose — access.js attaches a token only where it changes the
   answer for a members-only league, which keeps an open league's request
   cacheable — and a private league is the OTHER case where it changes the
   answer. So somebody who followed their invite link, joined, and clicked
   through was shown the hub, every league on it, and "No league called ...".
   The league was there; they were not asking as themselves. */
ok('the league lookup is retried as the account when it comes back empty',
   /if \(!LEAGUE\) \{[\s\S]{0,420}sessionReady\(\)[\s\S]{0,200}AUTHED = true;[\s\S]{0,120}await api\(q\)/.test(home));
ok('...and the rest of the page then reads as them too',
   /if \(AUTHED && typeof A\.session === 'function'\)/.test(home),
   'the games, standings and clubs of a private league are hidden from an anonymous read as well');
ok('a slug that really is wrong goes back to an anonymous hub',
   /if \(!LEAGUE\) AUTHED = false;/.test(home),
   'the hub below must stay cacheable');
ok('the ordinary case is untouched: one anonymous request, still cacheable',
   /const ls = await api\(q\);\s*\n\s*LEAGUE = ls\[0\] \|\| null;\s*\n\s*\} catch/.test(home));

/* ---- 11. an empty league tells the person who can fill it --------------- */
console.log('\n11. a league with nothing in it offers its admin a schedule');
ok('the offer is drawn under the league name, beside the follow bell',
   /leagueBell\(\);[\s\S]{0,220}offerSchedule\(\)/.test(home) &&
   /\$\('#leagueActs'\)/.test(home.slice(home.indexOf('async function offerSchedule'))));
ok('it goes to the fixtures section of the console, not its front door',
   /a\.href = 'admin\/#fixtures'/.test(home) && /id="fixtures"/.test(adminH));
ok('...and the console scrolls there after it has loaded',
   /location\.hash === '#fixtures'/.test(admin) && /scrollIntoView/.test(admin),
   'the browser jumps at parse time, before the fixture list has moved everything down');
ok('a signed-out visitor costs no request at all',
   /if \(!s \|\| !s\.token\) return;/.test(home) &&
   home.indexOf('sessionReady') < home.indexOf('/rpc/whoami'),
   'who before what: most people looking at a league are nobody on it');
ok('only an admin of THIS league, or the platform, is offered it',
   /who\.is_platform_admin \|\|\s*\n?\s*\(who\.leagues \|\| \[\]\)\.some\(l => l\.id === LEAGUE\.id\)/.test(home));
ok('whoami carries the token explicitly, so it works on a public league too',
   /rpc\/whoami[\s\S]{0,300}Authorization: 'Bearer ' \+ s\.token/.test(home),
   'withAuth only attaches one for a members-only or an already-resolved private league');
ok('"empty" means the league has no game at all, not none in the splash window',
   /games\?select=id&limit=1&competition_id=in\.\(/.test(home),
   'a league between seasons would otherwise be told to build a schedule it already has');
ok('a league with no competition cannot break the in.() list',
   /compIdsCache = \['00000000-0000-0000-0000-000000000000'\]/.test(home));
ok('it is drawn once, however many times it is called',
   /if \(host\.querySelector\('\.mk-sched'\) \|\| host\.querySelector\('\.mk-share'\)\) return;/.test(home));

/* ---- 12. the rail knows about a private league ---------------------------- */
console.log('\n12. the sidebar');
/* The rail reads the league list to decide which COUNTRY to open, from the
   page's own league. That read was anonymous, so a private league was missing
   from it: the page found nothing, fell back to the "every country" sentinel,
   and put "Not yet filed" above a list of every league on the platform. */
ok('the rail reads the leagues as the account when there is one',
   /if \(!anon && sess && sess\.token\) headers\.Authorization = 'Bearer ' \+ sess\.token;/.test(nav));
ok('...and a bad token falls back to the anonymous request, not to an empty rail',
   /if \(r\.status === 401 && headers\.Authorization\) return pull\(true\);/.test(nav),
   'storedSession only refuses an EXPIRED token; a revoked or malformed one would 401 and this is the navigation on every page');
ok('a private league is its own group, not "Not yet filed"',
   /const PRIVATE_KEY = '~private';/.test(nav) &&
   /if \(code === PRIVATE_KEY\) return 'Private';/.test(nav));
ok('...and it sorts to the top, above the countries',
   /\(b === PRIVATE_KEY\) - \(a === PRIVATE_KEY\)/.test(nav));
ok('every place that groups a league uses the one rule',
   (nav.match(/groupKey\(/g) || []).length >= 5,
   'the counter, the list filter, the page-opens-its-own-group path and settleCountry');

console.log('\n13. your profile is a rail, and the way back to a private league');
ok('the deck carries a sixth panel',
   /const followsPanel = el\('div', 'panel followspanel'\);/.test(nav) &&
   /deck\.append\(homePanel, countryPanel, rootPanel, leaguePanel, teamsPanel, followsPanel\)/.test(nav));
ok('...and the CSS is a sixth, not a fifth',
   /width:600%/.test(navcss) && /width:16\.6667%/.test(navcss) &&
   /data-view="follows"\] \.deck\{ transform:translateX\(-83\.3333%\)/.test(navcss));
ok('the panel is hidden from the tab order like every other',
   /followsPanel\.setAttribute\('aria-hidden', String\(v !== 'follows'\)\)/.test(nav));
ok('"your profile" opens it, and is still a real link for a modified click',
   /openFollows\(\);/.test(nav) &&
   /e\.button !== 0 \|\| e\.metaKey \|\| e\.ctrlKey \|\|\s*\n?\s*e\.shiftKey \|\| e\.altKey\) return;/.test(nav));
ok('...and says so with a chevron',
   /meLink\.append\(el\('span', 'ic', '☆'\), el\('span', 'tx', 'your profile'\),\s*\n?\s*el\('span', 'lgo', '›'\)\)/.test(nav));
ok('the list is clubs AND leagues, read as the account',
   /fan_prefs\?select=fav_league_ids,fav_team_ids/.test(nav) &&
   /leagues\?id=in\./.test(nav) && /teams\?id=in\./.test(nav));
ok('a private league in the list is marked as one',
   /if \(l\.visibility === 'private'\) a\.append\(el\('span', 'lgo', '\\u\{1F511\}'\)\)/.test(nav) ||
   /l\.visibility === 'private'/.test(nav));
/* This first carried the league slug back with the club. The clubs panel does
   not need one at all \u2014 it links ?t= alone \u2014 so the link now cannot be broken
   by a missing slug, which is a better answer than fetching one. */
ok('a club\u2019s link needs no league slug, so none can be missing from it',
   /root \+ 't\/\?t=' \+ encodeURIComponent\(t\.slug\)/.test(nav) &&
   !/'t\/\?l='/.test(nav),
   '/t/?l=&t=slug is a broken link, not a degraded one');
ok('a draw that could not reach the answer is not cached',
   /followsDrawn = true;\s+\/\/ the answer arrived; keep it/.test(nav),
   'opened once while signed out, it would otherwise say "sign in" for the rest of the session');

console.log('\n14. opening the link follows the league');
{
  const m42 = read('supabase', 'migrations', '0142_redeem_follows_the_league.sql');
  ok('redeeming adds the league to the fan\u2019s own list',
     /set fav_league_ids = array_append\(fav_league_ids, v\.league_id\)/.test(m42));
  ok('...only if it is not already there',
     /not \(v\.league_id = any \(fav_league_ids\)\)/.test(m42));
  ok('...and never past 0133\u2019s cap',
     /cardinality\(fav_league_ids\) < 20/.test(m42));
  ok('being let in never fails because the follow did',
     /exception when others then\s*\n\s*raise warning '0142/.test(m42),
     'the access is the point; the follow is the courtesy');
  ok('a second open does not re-follow what somebody deliberately dropped',
     m42.indexOf("'already', true") < m42.indexOf('array_append'));
}

/* ---- 15. the share link, where the league is ----------------------------- */
console.log('\n15. a private league\u2019s admin can hand out the link from the league');
ok('the button is on the league page, under its name',
   /b\.className = 'ep-btn mk-share';/.test(home) && /\$\('#leagueActs'\)/.test(home));
ok('only on a private league, only for its admins',
   /LEAGUE\.visibility !== 'private'\) return;/.test(home) &&
   /who\.is_platform_admin \|\|/.test(home));
ok('it reuses a live link rather than minting one every press',
   /league_invites_list[\s\S]{0,300}find\(i => !i\.spent && i\.role === 'viewer'\)/.test(home),
   'a permanent link is meant to be sent again and again');
ok('...and mints one only when there is none',
   /if \(!live\) \{[\s\S]{0,200}league_invite_create/.test(home));
ok('a browser that refuses the clipboard still hands over the link',
   /copy it from here/.test(home));
ok('both offers share one whoami',
   /offerShareLink\(who\)/.test(home));

/* ---- 16. a club in the follows list is drawn like a club ----------------- */
console.log('\n16. the follows list uses the clubs panel\u2019s own badge and link');
/* nav's crest() is the LEAGUE plate — colour_a/colour_b and a monogram. A club
   drawn with it lost the crest it already has everywhere else on the rail. */
ok('a club uses epinoiaCrest, not the league plate',
   /window\.epinoiaCrest\(t, \{ cls: 'ep-crest ic' \}\)/.test(nav) &&
   (nav.match(/window\.epinoiaCrest\(t, \{ cls: 'ep-crest ic' \}\)/g) || []).length === 2,
   'once in the clubs panel, once in the follows list — the same badge in both');
ok('...and the clubs panel\u2019s link shape, which needs no league slug',
   /root \+ 't\/\?t=' \+ encodeURIComponent\(t\.slug\)/.test(nav));
ok('the follows query asks for what that badge needs',
   /teams\?id=in\.\(' \+ tids\.join\(','\) \+\s*\n?\s*'\)&select=id,slug,name,short_name,colour,logo_path/.test(nav));

/* ---- 17. a follow that will not save says so ----------------------------- */
console.log('\n17. a refused follow is not a silent revert');
ok('the server\u2019s own reason is read off the response',
   /j && \(j\.message \|\| j\.hint \|\| j\.details\)/.test(follow),
   'a full follow list and a refused write read completely differently');
ok('toggle hands the reason back rather than swallowing it',
   /return \{ ok: false, reason: \(e && e\.message\) \|\| 'could not be saved' \}/.test(follow));
ok('...and the bell that was pressed says it',
   /sp\.textContent = 'not saved'/.test(follow) &&
   /b\.title = 'not saved: ' \+ res\.reason/.test(follow));
ok('it is three seconds, not a stuck state',
   /setTimeout\(\(\) => \{ if \(sp\) sp\.textContent = was;/.test(follow));
ok('a successful follow still offers push and reports ok',
   /if \(cur\.has\(id\)\) offerPush\(kind, name\);[\s\S]{0,80}return \{ ok: true/.test(follow));
ok('the failed bell has a style of its own',
   /\.ep-follow\.failed\{/.test(kit));

/* ---- 18. the private group cannot appear for somebody with no private league */
console.log('\n18. "Private" only shows to somebody who is in one');
ok('the group is built from the league list, which RLS has already filtered',
   /leagues\.forEach\(l => \{\s*\n\s*const k = groupKey\(l\);/.test(nav),
   'a league nobody let this account into is not in `leagues`, so it makes no group');
ok('...and 0139 is what filters it',
   /create policy leagues_read on public\.leagues for select/.test(m39) &&
   /or public\.league_invited\(id\)/.test(m39));

/* ---- 19. the follow that would not save on a private league -------------- */
console.log('\n19. a rotated token does not cost a follow');
/* follow.js parsed localStorage ONCE and kept the answer for the life of the
   page. Fine until something else refreshed the session — and a private
   league's page is the only one that does, because home.js resolves the league
   as the account (sessionReady). Supabase ROTATES on refresh, so the token this
   file was still holding was dead, every write 401'd, and a failed follow used
   to revert in silence. Nothing about following a private league was ever
   different; the page around it was. */
ok('the token is re-read rather than remembered for the page',
   /if \(raw === rawSeen\) return sess \|\| null;/.test(follow) && /rawSeen = raw;/.test(follow));
ok('...and the parse is still skipped while it has not changed',
   /let rawSeen = null;/.test(follow));
ok('a 401 is retried once with whatever the store now holds',
   /if \(r\.status === 401\) \{ rawSeen = null; r = await send\(\); \}/.test(follow));

/* ---- 20. flags Windows can actually draw --------------------------------- */
console.log('\n20. the rail shows flags, not the two letters a flag is made of');
/* Segoe UI Emoji has never carried the regional-indicator PAIRS, so Chrome and
   Edge on Windows draw "CZ", "DE", "GB" down the rail. No CSS fixes that; the
   only cure is to ship the picture. */
{
  const CODES = ['cz', 'de', 'es', 'eu', 'fr', 'gb', 'jp', 'sk'];
  const dir = path.join(ROOT, 'epinoia', 'brand', 'flags');
  for (const c of CODES) {
    const svg = readFileSync(path.join(dir, c + '.svg'), 'utf8');
    ok(c + '.svg is a 3:2 svg that draws something',
       /^<svg [^>]*viewBox="0 0 60 40"/.test(svg) && /<(rect|path|circle|polygon)/.test(svg));
  }
  ok('every drawn flag is listed in the shared rule',
     CODES.every(c => new RegExp("'" + c.toUpperCase() + "'").test(country)) &&
     /function flagSrc\(code\)/.test(country));
  ok('...and in the rail, which cannot depend on country.js',
     CODES.every(c => new RegExp("'" + c.toUpperCase() + "'").test(nav)) &&
     /const HAVE_FLAG = \[/.test(nav),
     'the rail is on every page and country.js is on two');
  ok('a country we have not drawn keeps the emoji',
     /return el\('span', 'ic', flagOf\(code\)\);/.test(nav));
  ok('a file that fails to load leaves the emoji behind, not a gap',
     /addEventListener\('error', \(\) => \{\s*\n?\s*wrap\.textContent = flagOf\(code\)/.test(nav));
  ok('both dimensions are stated, so the flag fits the slot the glyph had',
     /width:16px; height:10\.67px/.test(navcss),
     'height:auto let another rule drive it and the image came out a third too wide');
}

/* ---- 21. "Create a schedule" lands somewhere that can work ---------------- */
console.log('\n21. a new league arrives with a season and a competition');
/* The button went to a fixtures section that, on a brand-new league, could not
   do anything: both club dropdowns disabled, schedule refusing with "Pick a
   competition first", and the two things it wanted in the section ABOVE, which
   the reader had just been scrolled past. */
{
  const m43 = read('supabase', 'migrations', '0143_a_new_league_has_a_season.sql');
  ok('create_league gives the league a season and a competition',
     /perform public\.ensure_first_competition\(new_id\);/.test(m43));
  ok('...and the competition is a league competition, in this season',
     /values \(v_season, 'League', 'league'\)/.test(m43) &&
     /public\.season_label\(\)/.test(m43));
  ok('the season label turns over in July, and reads as two years',
     /extract\(month from p_on\) >= 7/.test(m43));
  ok('it is idempotent, so the creator and the backfill cannot fight',
     /if exists \(select 1 from seasons s where s\.league_id = p_league\) then\s*\n\s*return null;/.test(m43));
  ok('the backfill only reaches a league with no season AND no game',
     /not exists \(select 1 from seasons s where s\.league_id = lg\.id\)[\s\S]{0,300}not exists \(select 1 from games g/.test(m43),
     'a feed league has seasons the moment it ingests');
  /* USAGE, not the mention: the migration's own header explains that the feed
     path is deliberately untouched, and prose naming it must not fail this. */
  ok('a feed-connected league is NOT given an invented season',
     !/(create or replace function|perform)\s+public\.create_league_from_feed/.test(m43),
     'it takes its seasons from the feed; a stray one would sit beside the real ones');

  ok('the fixtures section names what is missing instead of just refusing',
     /A fixture lives in a season/.test(admin) && /A fixture needs two\./.test(admin));
  ok('...and links to the section that fixes it',
     /need\('A fixture lives in a season[^']*', '#seasons'\)/.test(admin) &&
     /'#teams'\)/.test(admin) &&
     /id="seasons"/.test(adminH) && /id="teams"/.test(adminH));
  ok('...and says nothing once a fixture can actually be made',
     /note\.textContent = '';/.test(admin),
     'a note that stays up after it stops being true is one people read past');
}

/* ---- 22. a season and a competition can be corrected ---------------------- */
console.log('\n22. what is already there can be edited');
/* Both could only be ADDED. Everything else in this console can be corrected,
   and these two could not: a season named by the wrong convention, a
   competition called "League" that should say "Division One", a date in the
   wrong box. The only way out was a second one beside it. */
ok('a season can be renamed and re-dated',
   /from\('seasons'\)\.update\(\{\s*\n?\s*name: v, starts_on: from\.value \|\| null, ends_on: to\.value \|\| null \}\)/.test(admin));
ok('a competition can be renamed and change kind',
   /from\('competitions'\)\.update\(\{ name: v, kind: kind\.value \}\)/.test(admin));
ok('both can be deleted',
   /from\('seasons'\)\.delete\(\)/.test(admin) && /from\('competitions'\)\.delete\(\)/.test(admin));
ok('the editor opens on the PICKED one, not on every chip',
   /'edit ' \+ season\.name/.test(admin) && /'edit ' \+ comp\.name/.test(admin),
   'a pencil and a bin on each chip turns a row of choices into a row of hazards');
ok('deleting counts the games first, and says what becomes of them',
   /async function gamesUnder/.test(admin) &&
   /stay on Epinoia with their box scores/.test(admin) &&
   /become ad-hoc/.test(admin),
   'games.competition_id is `on delete set null` (0001) — they survive but leave every table');
ok('...and the count is asked before the question is put',
   admin.indexOf('const n = await gamesUnder([comp.id]);') <
   admin.indexOf('Delete the competition "'));
ok('nothing played reads as nothing lost',
   /Nothing has been played in it, so nothing is lost\./.test(admin));
ok('the season sentence agrees with its number',
   /'Its one competition goes with it\.'/.test(admin),
   '"Its 1 competition go with it" is what counting without reading gives you');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
