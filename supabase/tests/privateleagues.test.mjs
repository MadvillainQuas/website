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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
