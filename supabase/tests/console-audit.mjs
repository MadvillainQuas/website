/* ============================================================================
   EVERY CONTROL IN EVERY ADMIN PANEL, CHECKED AGAINST THE DATABASE.

   Three faults in three days were all the same shape: a control that looked
   fine, called something that had drifted, and reported the failure as
   somebody else's problem. reject_media kept a statement that had stopped
   being legal; publish_team_logo returned a shape its caller did not read;
   grant_league_writer was not reachable over the API at all. None of them was
   visible by reading the panel.

   So this reads both consoles, pulls out every RPC they call and every element
   id they touch, and holds each against the migrations and the markup:

     MISSING        a call to a function no migration defines
     UNREACHABLE    defined, but never granted to a signed-in user
     ILLEGAL        a function that writes to storage.objects, which Supabase
                    refuses from any role
     ORPHAN         a handler bound to an element id the page does not contain
     SHAPE          a caller reading a field its function never returns

   It is a report, not a pass/fail gate for style: anything it prints is a
   control that cannot work, or a function nobody can call.

       node supabase/tests/console-audit.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* ---- what the database ships ---------------------------------------------- */
const migDir = path.join(ROOT, 'supabase', 'migrations');
const migs = readdirSync(migDir).filter(f => f.endsWith('.sql')).sort();
const migSrc = migs.map(f => [f, readFileSync(path.join(migDir, f), 'utf8')]);

const defined = new Map();     // name -> { file, body }
const granted = new Set();
const dropped = new Set();
for (const [file, t] of migSrc) {
  let m;
  const def = /create or replace function public\.([a-z0-9_]+)\s*\(/g;
  while ((m = def.exec(t))) {
    const end = t.indexOf('$$;', m.index);
    defined.set(m[1], { file, body: t.slice(m.index, end < 0 ? m.index + 4000 : end) });
  }
  /* Two spellings. A literal grant, and 0044's loop over an array of
     signatures — `execute format('grant execute on function public.%s ...')`
     — which an earlier version of this file could not see, so it reported
     forty-four reachable functions as unreachable. A detector that cries wolf
     is worse than none: it is what stops the real one being noticed. */
  const gr = /grant\s+execute\s+on\s+function\s+public\.([a-z0-9_]+)/g;
  while ((m = gr.exec(t))) granted.add(m[1]);
  if (/grant\s+execute\s+on\s+function\s+public\.%s/.test(t)) {
    const list = /'([a-z0-9_]+)\s*\(/g;
    while ((m = list.exec(t))) granted.add(m[1]);
  }
  const dr = /drop function if exists public\.([a-z0-9_]+)/g;
  while ((m = dr.exec(t))) dropped.add(m[1]);
}

/* ---- what the consoles call ----------------------------------------------- */
const CONSOLES = [
  ['platform console', ['epinoia', 'admin', 'platform', 'platform.js'],
                       ['epinoia', 'admin', 'platform', 'index.html']],
  ['league console',   ['epinoia', 'admin', 'admin.js'],
                       ['epinoia', 'admin', 'index.html']],
  ['club portal',      ['epinoia', 'app', 'app.js'],
                       ['epinoia', 'app', 'index.html']]
];
const UI_MODULES = ['news-ui.js', 'feeds-ui.js', 'merch-ui.js', 'socials-ui.js',
                    'formats-ui.js', 'appearance-ui.js', 'access-ui.js'];

const calls = [];      // { where, fn }
for (const [name, jsPath] of CONSOLES.map(c => [c[0], c[1]])) {
  const src = read(...jsPath);
  const re = /\brpc\(\s*'([a-z0-9_]+)'/g;
  let m; while ((m = re.exec(src))) calls.push({ where: name, fn: m[1] });
}
for (const f of UI_MODULES) {
  let src; try { src = read('epinoia', 'admin', f); } catch (_) { continue; }
  const re = /\brpc\(\s*'([a-z0-9_]+)'/g;
  let m; while ((m = re.exec(src))) calls.push({ where: f, fn: m[1] });
}

const uniq = [...new Set(calls.map(c => c.fn))].sort();
ok('the consoles were read and call something', uniq.length > 10, String(uniq.length));

/* ---- MISSING --------------------------------------------------------------- */
{
  const missing = uniq.filter(fn => !defined.has(fn));
  ok('every function a console calls is defined by a migration',
     missing.length === 0,
     missing.map(fn => fn + '  <- ' + [...new Set(calls.filter(c => c.fn === fn)
       .map(c => c.where))].join(', ')).join('\n          '));
}

/* ---- UNREACHABLE ----------------------------------------------------------- */
{
  /* THE RULE IS "REVOKED AND NOT RE-GRANTED", NOT "NEVER GRANTED".

     Postgres grants EXECUTE to PUBLIC when a function is created, so a
     function with no grant line is usually still callable — verified against
     the live database, where recompute_standings answered an anonymous caller
     with 204. What actually produces "permission denied for function" is a
     REVOKE from public with no matching grant to authenticated, which is what
     had happened to grant_league_writer.

     Flagging every ungrantless function listed seventeen working ones and
     buried the one that mattered. */
  const revoked = new Set();
  for (const [, t] of migSrc) {
    let m;
    const rv = /revoke\s+(all|execute)\s+on\s+function\s+public\.([a-z0-9_]+)/g;
    while ((m = rv.exec(t))) revoked.add(m[2]);
    if (/revoke\s+all\s+on\s+function\s+public\.%s/.test(t)) {
      const list = /'([a-z0-9_]+)\s*\(/g;
      while ((m = list.exec(t))) revoked.add(m[1]);
    }
  }
  const ungranted = uniq.filter(fn =>
    defined.has(fn) && revoked.has(fn) && !granted.has(fn));
  ok('every function a console calls is granted to a signed-in user',
     ungranted.length === 0,
     ungranted.map(fn => fn + '  (defined in ' + defined.get(fn).file + ')')
              .join('\n          '));
}

/* ---- ILLEGAL --------------------------------------------------------------- */
{
  const illegal = [];
  for (const [fn, d] of defined) {
    if (/(delete\s+from|insert\s+into|update)\s+storage\.objects/i.test(d.body)) {
      illegal.push(fn + '  (' + d.file + ')');
    }
  }
  ok('no shipped function writes to storage.objects — Supabase refuses it',
     illegal.length === 0, illegal.join('\n          '));
}

/* ---- ORPHAN ---------------------------------------------------------------- */
{
  const orphans = [];
  for (const [name, jsPath, htmlPath] of CONSOLES) {
    const src = read(...jsPath);
    const html = read(...htmlPath);
    const ids = new Set();
    let m;
    const re = /\$\('#([A-Za-z0-9_-]+)'\)|getElementById\('([A-Za-z0-9_-]+)'\)/g;
    while ((m = re.exec(src))) ids.add(m[1] || m[2]);
    for (const id of ids) {
      if (new RegExp('id="' + id + '"').test(html)) continue;
      /* Built at runtime rather than served in the markup — the club portal
         creates its crest controls only for a manager, which is the point. */
      if (new RegExp("\.id = '" + id + "'").test(src)) continue;
      if (new RegExp("id: ?'" + id + "'").test(src)) continue;
      orphans.push(name + ': #' + id);
    }
  }
  /* A handler bound to an element that is not on the page is a control the
     user can never reach — or a silent throw on boot. */
  ok('every element a console reaches for exists in its markup',
     orphans.length === 0, orphans.join('\n          '));
}

/* ---- SHAPE ----------------------------------------------------------------- */
{
  /* The publish_team_logo fault: the caller read pub.data.orphans and the
     function returned text. Only checkable where the function returns jsonb
     with literal keys, which covers the ones that bit. */
  const problems = [];
  const check = (fn, keys, src, label) => {
    const d = defined.get(fn);
    if (!d) return;
    if (!/returns jsonb/i.test(d.body)) {
      keys.forEach(k => problems.push(
        label + ' reads .' + k + ' from ' + fn + ', which does not return jsonb'));
      return;
    }
    keys.forEach(k => {
      if (!new RegExp("'" + k + "'").test(d.body)) {
        problems.push(label + ' reads .' + k + ' from ' + fn + ', never returned');
      }
    });
  };
  const app = read('epinoia', 'app', 'app.js');
  check('publish_team_logo', ['orphans'], app, 'club portal');
  /* The Organisations tab (0119) draws everything from four jsonb answers; a
     key renamed on one side would leave a panel silently empty. */
  const plat = read('epinoia', 'admin', 'platform', 'platform.js');
  check('organisation_admin', ['organisations', 'leagues', 'counts', 'today', 'organisation',
                               'ancestors', 'children', 'affiliations', 'teams'], plat, 'platform console');
  check('adopt_clubs', ['proposals', 'created', 'linked', 'skipped'], plat, 'platform console');
  check('record_affiliation', ['warnings', 'created'], plat, 'platform console');
  check('platform_move_organisation', ['descendants'], plat, 'platform console');
  /* The Privacy tab (0120) draws the queue, its tiles, the tenant picker and
     the handler picker from privacy_queue, and reports each action's answer. */
  check('privacy_queue', ['requests', 'counts', 'tenants', 'handlers', 'platform_open', 'tenant',
                          'reference', 'requester_email', 'requester_has_account', 'days_left', 'ack_days_left',
                          'latest_extension', 'paused_days_now', 'assigned_email', 'open'], plat, 'platform console');
  check('update_data_request', ['status', 'due_at'], plat, 'platform console');
  ok('a caller does not read a field its function never returns',
     problems.length === 0, problems.join('\n          '));
}

/* ---- the Organisations tab reaches every call it is the surface for ------- */
{
  /* foundations.md section 9, 0119: "a platform console Organisations tab: build
     BE's tree, link leagues and clubs, record affiliations and accreditation".
     Each of these has no other caller yet, so one dropped from the tab is a
     function nobody can use. */
  const want = ['organisation_admin', 'platform_save_organisation', 'platform_move_organisation',
                'set_league_organiser', 'set_team_club', 'record_affiliation', 'adopt_clubs'];
  if (migs.some(f => f.startsWith('0119'))) {
    const absent = want.filter(fn => !calls.some(c => c.where === 'platform console' && c.fn === fn));
    ok('the platform console calls every 0119 organisation RPC', absent.length === 0, absent.join(', '));
  }
}

/* ---- the Privacy tab reaches the queue and every action ------------------- */
{
  /* foundations.md section 9, 0120: "a platform console Privacy tab (queue,
     timers, actions)". privacy_queue is read with sb.rpc (so a missing
     migration shows its own note), update_data_request through rpc(); both
     spellings count, and every action the function takes must have a control. */
  if (migs.some(f => f.startsWith('0120'))) {
    const plat = read('epinoia', 'admin', 'platform', 'platform.js');
    const reached = ['privacy_queue', 'update_data_request'].filter(fn =>
      new RegExp("\\b(sb\\.)?rpc\\(\\s*'" + fn + "'").test(plat));
    ok('the platform console calls privacy_queue and update_data_request', reached.length === 2, reached.join(', '));
    const actions = ['acknowledge', 'confirm_identity', 'pause', 'resume', 'extend', 'assign', 'close'];
    const missing = actions.filter(a => !new RegExp("privAct\\(r, '" + a + "'").test(plat));
    ok('the Privacy tab has a control for every update_data_request action', missing.length === 0, missing.join(', '));
    const body = (defined.get('update_data_request') || {}).body || '';
    const unknown = actions.filter(a => !body.includes("'" + a + "'"));
    ok('...and every one of those actions is one the function takes', unknown.length === 0, unknown.join(', '));
  }
}

/* ---- the privacy reminders have a runner, and a tab to land on ------------- */
{
  /* foundations.md section 9, 0120: "nightly reminders". The ingest runner is
     the nightly runner (section 5.2): a reminder function nobody calls reminds
     nobody. Each reminder links to a console tab, which must exist and which
     the console must open from the link. */
  if (migs.some(f => f.startsWith('0120'))) {
    /* PENDING, NOT PASSED. The runner hook (a 12-line call after each discovery
       pass) was held back on 2026-09-16 because another session had uncommitted
       work in run_ingest.py; until it lands the reminders are written by nothing,
       and this says so on every run instead of failing or quietly passing. */
    const runner = read('scripts', 'ingest', 'run_ingest.py');
    if (/sb\.rpc\(\s*'notify_data_requests'/.test(runner)) ok('the ingest runner calls notify_data_requests', true);
    else console.log('  PENDING  the ingest runner does not call notify_data_requests yet: privacy reminders are not being written');
    const body = (defined.get('notify_data_requests') || {}).body || '';
    const tab = (body.match(/'admin\/platform\/#([a-z]+)'/) || [])[1];
    const html = read('epinoia', 'admin', 'platform', 'index.html');
    const plat = read('epinoia', 'admin', 'platform', 'platform.js');
    ok('a privacy reminder links to a console tab that exists, and the console opens a #tab link',
       !!tab && html.includes('data-p="' + tab + '"') && /location\.hash/.test(plat), 'link #' + tab);
  }
}

/* ---- every panel is actually wired ----------------------------------------- */
{
  const html = read('epinoia', 'admin', 'platform', 'index.html');
  const js = read('epinoia', 'admin', 'platform', 'platform.js');
  const panes = [...html.matchAll(/id="pane-([a-z0-9]+)"/g)].map(m => m[1]);
  ok('the platform console has its panels', panes.length >= 8, panes.join(', '));

  /* every tab points at a pane that exists, and every pane has a tab */
  const tabs = [...html.matchAll(/data-p="([a-z0-9]+)"/g)].map(m => m[1]);
  const tabless = panes.filter(p => !tabs.includes(p));
  const paneless = tabs.filter(t => !panes.includes(t));
  ok('every panel has a tab that reaches it', tabless.length === 0, tabless.join(', '));
  ok('every tab points at a panel that exists', paneless.length === 0, paneless.join(', '));

  /* and each one loads something rather than sitting empty */
  const loaders = [...js.matchAll(/function (load[A-Za-z]+)\s*\(/g)].map(m => m[1]);
  ok('each panel has a loader behind it', loaders.length >= 6, loaders.join(', '));
  const unused = loaders.filter(fn =>
    (js.match(new RegExp('\\b' + fn + '\\s*\\(', 'g')) || []).length < 2);
  ok('no panel loader is defined and never called', unused.length === 0, unused.join(', '));
}

/* ---- a SECURITY DEFINER function with no gate is a public write ------------
   recompute_standings was one: no permission check, never revoked, and an
   anonymous POST returned 204 while deleting and rebuilding a league's table.
   Any function that WRITES and runs as its owner has to say who may call it. */
{
  const naked = [];
  for (const fn of uniq) {
    const d = defined.get(fn);
    if (!d || !/security definer/i.test(d.body)) continue;
    const writes = /(delete\s+from|insert\s+into|update)\s+(?!storage\.)[a-z_]/i.test(d.body);
    if (!writes) continue;
    /* 0074 and 0075 wrap three of these at runtime — they read the shipped
       body out of pg_proc and prepend the check, so the guard never appears in
       the function's own CREATE statement. A migration that names the function
       beside the guard helper is the record of that. */
    const wrapped = migSrc.some(([f, t]) => {
      /* ...and only a wrap that comes AFTER the definition that ships. 0086
         replaced recompute_standings with a body copied from before 0074's
         wrap, which removed the guard, and this still passed on 0074 alone:
         a wrap only guards the body that existed when it ran. */
      if (f <= d.file) return false;
      /* The name must sit in the loop that DOES the wrapping — an `execute src`
         block — not merely somewhere in a migration that also mentions the
         guard. A first version accepted the latter, so removing a function from
         the wrapping list and leaving it in the proof block still passed. */
      const loops = t.match(/foreach fn in array array\[[^\]]*\][\s\S]*?execute src;/g) || [];
      return loops.some(b => new RegExp("'" + fn + "'").test(b)) ||
        (/recompute_standings_guard/.test(t) && /execute src;/.test(t) &&
         new RegExp("proname = '" + fn + "'").test(t));
    });
    if (wrapped) continue;
    const gated = /(is_platform_admin|is_league_admin|is_team_manager|is_league_writer|may_score_game|can_score|auth\.uid\(\)\s*is\s+null|_guard|you do not administer|you do not manage|you may not change|only the league)/i.test(d.body);
    if (!gated) naked.push(fn + '  (' + d.file + ')');
  }
  ok('every writing SECURITY DEFINER function the consoles call checks its caller',
     naked.length === 0, naked.join('  |  '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
