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
  const gr = /grant execute on function public\.([a-z0-9_]+)/g;
  while ((m = gr.exec(t))) granted.add(m[1]);
  if (/grant execute on function public\.%s/.test(t)) {
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
                    'formats-ui.js', 'appearance-ui.js'];

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
    const rv = /revoke all on function public\.([a-z0-9_]+)/g;
    while ((m = rv.exec(t))) revoked.add(m[1]);
    if (/revoke all on function public\.%s from public, anon/.test(t)) {
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
  ok('a caller does not read a field its function never returns',
     problems.length === 0, problems.join('\n          '));
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
    const gated = /(is_platform_admin|is_league_admin|is_team_manager|is_league_writer|may_score_game|can_score|auth\.uid\(\)\s*is\s+null|_guard)/i.test(d.body);
    if (!gated) naked.push(fn + '  (' + d.file + ')');
  }
  ok('CANDIDATES: writing SECURITY DEFINER functions with no caller check found by pattern (verify each before acting — only recompute_standings has been confirmed against the live database)',
     naked.length === 0, naked.join('  |  '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
