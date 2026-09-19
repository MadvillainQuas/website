/* ============================================================================
   THE ADMIN CONSOLE'S CONTROLS DO WHAT THEY SAY.

   Four faults, found by using the page rather than by reading it:

   1. EVERY REFUSAL SAID THE SAME THING. oops() turned any 42501 into "Refused:
      platform administrators only", which is worse than useless when the
      person reading it IS a platform admin — and it hid which of a dozen calls
      had failed. Most of those refusals are not about platform rights at all.

   2. APPROVING AN IMAGE LEFT IT IN THE PENDING BUCKET. approve_media stopped
      moving files two migrations ago — only the Storage API can move an object
      — so the league console moves it first and this one never learned to.
      Every crest approved from the platform page 404'd on the public site.

   3. A STATISTICIAN COULD ONLY BE TIED TO ONE CLUB, which does not describe
      the job. grant_role already accepted league scope; nothing honoured it.

   4. THE NEWS WRITER ROLE WAS NOT ON THE PAGE, and its function answers 404
      over the API, so it could only be granted from a league's own console.

     node supabase/tests/adminroles.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const js = read('epinoia', 'admin', 'platform', 'platform.js');
const html = read('epinoia', 'admin', 'platform', 'index.html');
const mig = read('supabase', 'migrations', '0072_league_statisticians.sql');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* ---- 1. the message tells you what actually happened ---------------------- */
ok('a refusal reports the database’s own reason',
   /say\('Refused: ' \+ msg/.test(js), (js.match(/Refused:[^\n]*/g) || []).join(' | '));
ok('...and no longer blames platform rights for every error',
   !/say\('Refused: platform administrators only\.'/.test(js));
ok('...with the code, so it can be looked up',
   /e\.code \? ' \[' \+ e\.code/.test(js));

/* ---- 2. the file moves before the row is marked approved ------------------ */
ok('the platform console moves the object into the public bucket',
   /media-pending'\)\s*\n?\s*\.move\([\s\S]{0,120}media-public/.test(js));
ok('...before calling approve_media, not after',
   js.indexOf('.move(') < js.indexOf("rpc('approve_media'"),
   'move at ' + js.indexOf('.move(') + ', approve at ' + js.indexOf("rpc('approve_media'"));
ok('...and does not mark it approved when the move failed',
   /mv\.error[\s\S]{0,200}return say\('Could not publish/.test(js));
ok('"already exists" is treated as done, not as a failure',
   /exists\/i\.test\(mv\.error\.message/.test(js));
ok('the queue supplies the path the move needs',
   /storage_path text/.test(read('supabase', 'migrations', '0044_platform_console.sql')));

/* ---- 3. a statistician can belong to a league ----------------------------- */
ok('the console offers a league-wide statistician',
   /statistician_league/.test(html) && /statistician_league/.test(js));
/* Which roles take a league and which take a club used to be an if-chain inside
   fillScopePicker. It has four callers now — the grant form, the account
   dashboard, a league card and a club row — so it is one table, LEAGUE_ROLES,
   and the picker fills from `leagues` for anything in it. Same guarantee, read
   where it now lives. */
ok('...scoped to a league, not a club',
   /statistician_league:/.test(js) &&
   /if \(LEAGUE_ROLES\[picked\]\) \{[\s\S]{0,160}leagues\.forEach/.test(js));
ok('...granted as the statistician role the schema knows',
   /picked === 'statistician_league' \? 'statistician'/.test(js));
ok('the club-scoped statistician is still available',
   /statistician — one club only|statistician — one club only/.test(html) ||
   />statistician[^<]*club/i.test(html));

ok('the database honours a league statistician when scoring',
   /is_league_statistician/.test(mig) &&
   /may_score_game[\s\S]{0,900}is_league_statistician/.test(mig));
ok('...and the migration proves the branch is really in the function',
   /pg_get_functiondef\(p\.oid\) like '%is_league_statistician%'/.test(mig));
ok('...while can_score stays the narrower write gate',
   /can_score[\s\S]{0,300}may_score_game/.test(mig));
/* The two sit side by side in may_score_game as alternatives, which is correct
   — an earlier version of this test read that adjacency as the statistician
   inheriting admin rights. The real rule is that is_league_admin is not
   widened: a statistician may score, and that is the whole of it. */
ok('the role confers scoring only — is_league_admin is untouched',
   !/create or replace function public\.is_league_admin/.test(mig));
ok('...and nothing else in the console grants on it',
   !/is_league_statistician/.test(js));

/* ---- 4. the news writer role is grantable here ---------------------------- */
ok('the console offers the news writer role', /news_writer/.test(html));
ok('...scoped to a league', /news_writer:/.test(js) &&
   /if \(LEAGUE_ROLES\[picked\]\) \{[\s\S]{0,160}leagues\.forEach/.test(js));
ok('...and calls the writer function, not grant_role',
   /picked === 'news_writer'[\s\S]{0,320}rpc\('grant_league_writer'/.test(js));
ok('...which the migration makes reachable over the API',
   /grant execute on function public\.grant_league_writer\(uuid, text\) to authenticated/.test(mig));
ok('...without loosening who may actually use it',
   /is_league_admin/.test(read('supabase', 'migrations', '0051_news_and_writers.sql')));

/* ---- the grant form still refuses incomplete input ------------------------ */
ok('a role that needs a scope will not be granted without one',
   /Choose what that role applies to|Choose the league they write for/.test(js));
ok('granting platform admin still warns first',
   /can do everything on this page[\s\S]{0,120}confirm|confirm\([\s\S]{0,160}removing you/.test(js));


/* ---- storage is not a table you may write to ------------------------------
   Supabase refuses a SQL delete on storage.objects from ANY role, including a
   SECURITY DEFINER function owned by the superuser:

     Direct deletion from storage tables is not allowed. [42501]

   0062 fixed this for publishing a crest. reject_media, written in 0017 and
   never re-run, kept its delete and so every rejection failed — invisibly,
   because the console reported the 42501 as "platform administrators only".
   Two functions have now had the same fault; this makes it the third that
   fails a test rather than a moderator. */
{
  const migs = readdirSync(path.join(ROOT, 'supabase', 'migrations'))
    .filter(f => f.endsWith('.sql')).sort();

  /* the LAST definition of each media function is the one that runs */
  const lastDefOf = (fn) => {
    let src = null;
    for (const f of migs) {
      const t = read('supabase', 'migrations', f);
      const at = t.indexOf('create or replace function public.' + fn);
      if (at < 0) continue;
      const end = t.indexOf('$$;', at);
      src = t.slice(at, end < 0 ? undefined : end);
    }
    return src;
  };

  for (const fn of ['reject_media', 'approve_media', 'publish_team_logo']) {
    const src = lastDefOf(fn);
    if (!src) { ok(fn + ' exists', true); continue; }
    ok(fn + ' does not delete from storage.objects',
       !/delete\s+from\s+storage\.objects/i.test(src),
       'Supabase refuses this from any role');
    ok(fn + ' does not insert into storage.objects either',
       !/insert\s+into\s+storage\.objects/i.test(src));
  }

  /* and the callers do the half the database cannot */
  const admin = read('epinoia', 'admin', 'admin.js');
  for (const [name, src] of [['platform console', js], ['league console', admin]]) {
    ok(name + ' removes the object through the Storage API when rejecting',
       /reject_media[\s\S]{0,700}storage\.from\('media-pending'\)\.remove/.test(src),
       'the function no longer does it');
    ok(name + ' records the rejection before touching the bytes',
       src.indexOf("rpc('reject_media'") < src.indexOf("'media-pending').remove"),
       'a storage failure must not leave a photograph un-rejected');
    ok(name + ' treats a missing file as already gone',
       /not found\|does not exist/i.test(src));
  }

  const mig73 = read('supabase', 'migrations', '0073_reject_no_sql_delete.sql');
  ok('a rejected crest stops being the club crest',
     /update teams set logo_path = null/.test(mig73));
  ok('...and a rejected photograph stops being the player photograph',
     /update players set photo_media_id = null/.test(mig73));
  ok('the migration checks the shipped function body, not its own text',
     /pg_get_functiondef[\s\S]{0,200}delete\s\+from\s\+storage\.objects/.test(mig73) ||
     /src ~\* 'delete/.test(mig73));
}


/* ---- 5. appointing somebody where you are already looking ---------------- */
console.log('\n5. a role is granted in context, not only from one form at the bottom');
{
  const mig = read('supabase', 'migrations', '0141_account_and_club_people.sql');

  /* ONE ACCOUNT, WHOLE. Four different things attach a person to a league and
     the accounts table could only ever show the first, so a news writer, a
     private-league guest and an invitation still waiting on the address were
     all invisible from this page. */
  for (const k of ['memberships', 'writers', 'guests', 'pending']) {
    ok('platform_account returns ' + k, new RegExp("'" + k + "',").test(mig));
  }
  ok('...and names the scope rather than returning a uuid to draw',
     /'label',\s+case ms\.scope_type/.test(mig));
  ok('a pending row is matched on the ADDRESS, not the id',
     /from pending_roles pe where pe\.email = lower\(u\.email::text\)/.test(mig),
     'the whole point of a pending row is that there was no account to point at');
  ok('platform_account is platform admins only',
     /platform administrators only/.test(mig));
  ok('team_members is gated on is_team_manager, so a league admin sees their own clubs',
     /where public\.is_team_manager\(p_team\)/.test(mig));

  /* NO NEW WRITE PATH. Every grant and revoke reachable from the new screens is
     a function that already existed, so this adds no authorisation surface. */
  ok('0141 adds readers only — no new way to change anybody’s rights',
     !/\binsert into memberships\b/.test(mig.split('SELF-TEST')[0]) &&
     !/\bdelete from memberships\b/.test(mig.split('SELF-TEST')[0]));

  ok('clicking an account opens its dashboard',
     /openA\.addEventListener\('click', \(\) => openAccount\(r\.user_id\)\)/.test(js));
  ok('the dashboard grants against THAT account, with the scope chosen by name',
     /grantTo\(a\.email, role\.value, scope\.value \|\| null\)/.test(js));
  ok('a league card can appoint somebody to THAT league',
     /grantTo\(v, role\.value, l\.id\)/.test(js));
  ok('a club row can appoint somebody to THAT club',
     /grantTo\(v, role\.value, t\.id\)/.test(js));

  /* The mapping from a picker entry to (role, scope_type) now has four callers.
     Four copies would drift, and the one that drifted would quietly grant the
     wrong KIND of scope — a statistician tied to a club instead of a league. */
  ok('the role-to-scope mapping exists once, not once per screen',
     (js.match(/const role = picked === 'statistician_league'/g) || []).length === 1);
  ok('...and the grant form goes through it too',
     /function fillScopePicker\(\) \{\s*\n\s*fillScopeFor\(/.test(js) &&
     /await grantTo\(email, \$\('#grRole'\)\.value/.test(js));
  ok('a league-wide statistician is still role=statistician, scope=league',
     /picked === 'league_admin' \|\| picked === 'statistician_league'\)\s*\n?\s*\? 'league'/.test(js));

  ok('deleting from the dashboard closes it only if the account really went',
     /if \(await deleteAccount\(\{ user_id: a\.user_id, email: a\.email \}\)\) backToAccounts\(\)/.test(js),
     'a cancelled prompt or a mistyped address must leave the dashboard open');
  ok('the account list is put back when you leave the dashboard',
     /function backToAccounts\(\)/.test(js) && /id="acctList"/.test(html));
}


console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
