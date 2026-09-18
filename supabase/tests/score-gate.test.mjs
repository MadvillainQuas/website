/* ============================================================================
   THE SCORER IS SHUT UNTIL SOMEBODY SAYS OTHERWISE.

   A signed-out visitor reached the statistician's app from HOME and was shown a
   league's fixture list with a load button (reported 2026-09-18). Two separate
   faults, so two separate guards:

     1. HOME'S FOOT offered "Score a game" to everybody, linking straight at the
        real scorer. The splash page had always asked first; HOME never did.
     2. THE SCORER DREW ITSELF AND WAS THEN REFUSED — a notice laid over a live
        application. Nothing had to go wrong for that to be dangerous; anything
        that stopped the notice appearing (an old copy of bootstrap.js from a
        phone's cache, a script that failed to load, an exception before the
        gate ran) left a working scorer in a stranger's hands.

   The fix in both places is the same shape and it is what this file holds: the
   shut state is in the MARKUP, so it needs nothing to run, and only an answered
   yes opens it. Every other state — including every way of failing — is shut.

     node supabase/tests/score-gate.test.mjs
   ============================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b),
  'got  ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));

/* ------------------------------------------------ 1. the door, in the markup --- */
console.log('\n1. the scorer ships shut');
{
  const page = rd('epinoia', 'score', 'index.html');
  ok('the body carries the shut state itself, not a class a script adds',
     /<body class="cs-shut">/.test(page));
  ok('...which hides every screen, every modal and the toast', (() => {
    const rule = /body\.cs-shut > ([^{]+)\{\s*display:none !important;?\s*\}/.exec(page);
    if (!rule) return false;
    const sel = rule[1];
    return ['section', '.modalwrap', '#toast'].every(s => sel.includes(s));
  })(), (/body\.cs-shut > ([^{]+)\{/.exec(page) || [])[1]);
  ok('the setup screen is one of the sections it hides',
     /<section id="setup" class="screen">/.test(page));
  ok('a notice stands in its place while the question is being put',
     /<div id="csGate">/.test(page) && /Checking your account/.test(page));
  ok('...and that notice is gone the moment the door is open',
     /body:not\(\.cs-shut\) > #csGate\{ display:none !important; \}/.test(page));
}

/* --------------------------------------------- 2. only a yes opens it --- */
console.log('\n2. only an answered yes opens it');
{
  const b = rd('epinoia', 'score', 'bootstrap.js');
  ok('one function takes the class off, and it is the only place that does',
     (b.match(/classList\.remove\('cs-shut'\)/g) || []).length === 1 &&
     /function openDoor\(\)/.test(b));
  ok('...called after the gate has answered, never before',
     /if \(!\(await gateScorer\(\)\)\) return;[^\n]*\n\s*openDoor\(\);/.test(b));
  ok('a refusal leaves the door shut and covers a blank page', (() => {
    /* the body of refuse(), up to the next top-level function in the file */
    const at = b.indexOf('  function refuse(title, body) {');
    const body = b.slice(at, b.indexOf('\n  async function mayScoreThis', at));
    return at > 0 && body.length > 200 &&
      !/classList\.remove\('cs-shut'\)/.test(body) &&            // it never opens the door
      /getElementById\('csGate'\); if \(g\) g\.remove\(\);/.test(body);  // only the notice goes
  })());
  ok('the practice game is let through, because it touches no fixture',
     /if \(TRAINING\) return true;/.test(b));
  ok('the demo is still given no league machinery',
     /if \(TRAINING\) return;\s*\n\s*\n?\s*try \{ injectFixturePicker\(\)/.test(b.slice(b.indexOf('openDoor();'))));
  ok('signed out is a real no, not a question that could not be put',
     /if \(!session\) return false;\s*\n\s*const \{ data, error \} = await sb\.rpc\('whoami'\);/.test(b));
  ok('a whoami that errors is not a yes either',
     /if \(error \|\| !data\) return false;/.test(b));

  /* the phones that already hold the ungated pair must not keep serving it */
  const sw = rd('epinoia', 'score', 'sw.js');
  ok('the scorer\'s cache is renamed, so an old shell and an old bootstrap.js are dropped',
     /const CACHE = 'epinoia-scorer-v2';/.test(sw));
  ok('...and activate deletes every earlier one',
     /n\.indexOf\('epinoia-scorer-'\) === 0\)\s*\?\s*caches\.delete\(n\)/.test(sw));
}

/* ------------------------------------------------------- 3. HOME's foot --- */
console.log('\n3. HOME does not offer what it cannot give');
{
  const page = rd('epinoia', 'home', 'index.html');
  ok('the "Score a game" row is hidden in the markup',
     /<li id="homeScoreLi" hidden><a id="homeScore" href="\.\.\/score\/">/.test(page));
  ok('the practice game is NOT hidden — it is the door a visitor should find',
     /<li><a href="\.\.\/score\/\?train=1">/.test(page));
  eq('and it is the only ungated route to the scorer on the page',
     (page.match(/href="\.\.\/score\/[^"]*"/g) || []).sort(),
     ['href="../score/"', 'href="../score/?train=1"']);

  /* paintScore run for real, against a fake document and a fake client */
  const src = rd('epinoia', 'home', 'front.js');
  const cut = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
  const fns = cut('function signedIn() {', '/* ------------------------------------------------------------ #leagues');
  ok('signedIn and paintScore are where this test reads them',
     /function signedIn\(\)/.test(fns) && /async function paintScore\(\)/.test(fns), fns.length);

  const run = async (o) => {
    const opt = o || {};
    const li = { hidden: true };
    const asked = [];
    const fake = {
      auth: { getSession: async () => ({ data: { session: opt.session === undefined ? { access_token: 'x' } : opt.session } }) },
      rpc: async (name) => { asked.push(name); return opt.rpc || { data: null, error: { message: 'no' } }; }
    };
    const ctx = {
      console, JSON, Date, Number, String, localStorage: {
        getItem: () => (opt.stored === undefined
          ? JSON.stringify({ access_token: 'x', expires_at: Math.floor(Date.now() / 1000) + 3600 })
          : opt.stored)
      },
      document: { getElementById: id => (id === 'homeScoreLi' ? li : null) },
      root: { EPINOIA_CONFIG: { supabaseUrl: 'https://proj.supabase.co' },
              epinoiaClientReady: opt.noClient ? null : (async () => fake) }
    };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fns + '\nglobalThis.__p = paintScore();', ctx);
    await ctx.__p;
    return { hidden: li.hidden, asked };
  };

  const YES = { data: { is_platform_admin: true, leagues: [], scoring: [] }, error: null };
  const NO = { data: { is_platform_admin: false, leagues: [], scoring: [] }, error: null };

  eq('signed out: shut, and nothing is even asked',
     await run({ stored: null }), { hidden: true, asked: [] });
  eq('an expired token is signed out', (await run({
     stored: JSON.stringify({ access_token: 'x', expires_at: 1 }) })).hidden, true);
  eq('signed in with no roles: shut', (await run({ rpc: NO })).hidden, true);
  eq('signed in as an administrator: offered', (await run({ rpc: YES })).hidden, false);
  eq('a league of their own is enough',
     (await run({ rpc: { data: { leagues: ['l1'] }, error: null } })).hidden, false);
  eq('a fixture of their own is enough',
     (await run({ rpc: { data: { scoring: ['g1'] }, error: null } })).hidden, false);
  eq('a whoami that errors is shut, not open',
     (await run({ rpc: { data: null, error: { message: 'offline' } } })).hidden, true);
  eq('no session behind the stored token is shut',
     (await run({ session: null, rpc: YES })).hidden, true);
  eq('no client at all is shut', (await run({ noClient: true })).hidden, true);
  eq('and it asks the database exactly once', (await run({ rpc: YES })).asked, ['whoami']);
}

/* ------------------------------------------- 4. the three agree with each other --- */
console.log('\n4. the rail, HOME and the scorer ask the same question');
{
  const nav = rd('epinoia', 'nav.js');
  const front = rd('epinoia', 'home', 'front.js');
  const boot = rd('epinoia', 'score', 'bootstrap.js');
  const has = (s, re) => re.test(s);
  ok('the scorer: platform admin, a league, or a fixture',
     has(boot, /data\.is_platform_admin \|\|\s*\n?\s*\(data\.leagues \|\| \[\]\)\.length \|\|\s*\n?\s*\(data\.scoring \|\| \[\]\)\.length/));
  ok('HOME: the same three, so it never offers a door the scorer shuts',
     has(front, /data\.is_platform_admin \|\| \(data\.leagues \|\| \[\]\)\.length \|\|\s*\n?\s*\(data\.scoring \|\| \[\]\)\.length/));
  ok('the rail: a fixture of their own, or they administer this league',
     has(nav, /role: w => \(w\.scoring \|\| \[\]\)\.length \|\| adminsThis\(w\)/));
  ok('...and the rail keeps the row, downgraded to the demo, rather than hiding it',
     has(nav, /demo: \{ href: 'score\/\?train=1', tx: 'demo score'/));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
