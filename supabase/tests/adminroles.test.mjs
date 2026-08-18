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
import { readFileSync } from 'node:fs';

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
ok('...scoped to a league, not a club',
   /role === 'statistician_league'\)\s*\{[\s\S]{0,200}leagues\.forEach/.test(js) ||
   /statistician_league'\)\s*\{[\s\S]{0,200}leagues\.forEach/.test(js));
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
ok('...scoped to a league', /role === 'news_writer'[\s\S]{0,240}leagues\.forEach/.test(js));
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
