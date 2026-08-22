/* ============================================================================
   THE TWO WAYS A MIGRATION REFUSES TO APPLY.

   Both of these cost a push each, discovered one at a time by running it:

     1. CREATE OR REPLACE CANNOT CHANGE A RETURN TYPE.
        Adding a column to a RETURNS TABLE, or changing the returned type at
        all, is refused with "cannot change return type of existing function —
        row type defined by OUT parameters is different". The ARGUMENT list is
        unchanged, which is what makes it easy to miss: replace looks like the
        right verb and the signature looks identical.

     2. CHANGING THE ARGUMENT LIST MAKES A SECOND FUNCTION.
        Postgres overloads on arguments, so a new parameter does not replace
        anything — it adds. Every caller that names its arguments then gets
        "function is not unique" and the feature stops dead, with both versions
        sitting there looking correct.

   Either is fixed by dropping the old signature first. This walks the
   migrations in order, tracks what each function looks like after each file,
   and fails on any redefinition that changes the shape without a drop in front
   of it. Cheaper than a push, and it does not need a database.

     node supabase/tests/migrations.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const DIR = path.join(ROOT, 'supabase', 'migrations');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();

/* Strip line comments and dollar-quoted bodies before looking for statements:
   a migration explains itself at length, and prose about "create or replace"
   reads to a scanner exactly like the statement it describes. Block bodies go
   too — a function that CONTAINS a create statement in its text is not one. */
function statements(sql) {
  const noLine = sql.split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
  return noLine.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/* The head of a definition: name, argument type list, and what it returns.
   Argument NAMES and DEFAULTS are dropped — Postgres overloads on types. */
function signatures(sql) {
  const out = [];
  const re = /create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\s+(?:language|as)\b/gi;
  let m;
  while ((m = re.exec(sql))) {
    const [, name, args, ret] = m;
    const types = args.split(/,(?![^(]*\))/)
      .map(a => a.trim()).filter(Boolean)
      .map(a => {
        const noDefault = a.replace(/\s+default\s+[\s\S]*$/i, '').trim();
        const parts = noDefault.split(/\s+/);
        return (parts.length > 1 ? parts.slice(1).join(' ') : parts[0]).toLowerCase();
      });
    out.push({
      name,
      args: types.join(','),
      ret: ret.replace(/\s+/g, ' ').trim().toLowerCase(),
      at: m.index
    });
  }
  return out;
}

function drops(sql) {
  const out = [];
  const re = /drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\)/gi;
  let m;
  while ((m = re.exec(sql))) {
    out.push({
      name: m[1],
      args: m[2].split(/,(?![^(]*\))/).map(a => a.trim().toLowerCase())
              .filter(Boolean).join(','),
      at: m.index
    });
  }
  return out;
}

/* ---- walk the migrations in the order Postgres will ---------------------- */
console.log('\nno migration changes a function shape without dropping it first');

const known = new Map();          // name -> { args, ret, file }
const problems = [];
/* Shapes that changed with no drop in front of them YET. A drop in any later
   migration settles it: what decides whether the database ends up ambiguous is
   the end state, not the file that happened to create the second copy. */
let pending = [];

for (const f of files) {
  const sql = statements(readFileSync(path.join(DIR, f), 'utf8'));
  const dropped = drops(sql);

  /* Anything this file drops stops being outstanding. */
  pending = pending.filter(p =>
    !dropped.some(d => d.name === p.name && (d.args === p.args || d.args === '')));

  for (const s of signatures(sql)) {
    const prev = known.get(s.name);
    if (prev) {
      const argsMoved = prev.args !== s.args;
      const retMoved = prev.ret !== s.ret;
      if (argsMoved || retMoved) {
        const coveredHere = dropped.some(d =>
          d.name === s.name && d.at < s.at &&
          (d.args === prev.args || !argsMoved));
        if (!coveredHere) {
          pending.push({
            name: s.name, args: prev.args,
            note: f + ': ' + s.name +
              (retMoved ? ' changes its RETURN (' + prev.ret + ' -> ' + s.ret + ')' : '') +
              (argsMoved ? ' changes its ARGUMENTS (' + prev.args + ' -> ' + s.args + ')' : '') +
              ' — first defined in ' + prev.file
          });
        }
      }
    }
    known.set(s.name, { args: s.args, ret: s.ret, file: f });
  }
}

for (const p of pending) {
  problems.push(p.note + ', and nothing since has dropped the old signature');
}

ok('every redefinition that changes a shape drops the old one, here or later',
   problems.length === 0, problems.join('\n          '));

/* The two this was written after, asserted by name so a regression is obvious
   rather than just a count going up. */
const s83 = readFileSync(path.join(DIR, '0083_video_timing.sql'), 'utf8');
ok('0083 drops stream_targets_for_league before widening what it returns',
   s83.indexOf('drop function if exists public.stream_targets_for_league(uuid);') !== -1 &&
   s83.indexOf('drop function if exists public.stream_targets_for_league(uuid);') <
   s83.indexOf('create or replace function public.stream_targets_for_league'));
ok('0083 drops both earlier set_game_video signatures before creating the new one',
   (s83.match(/drop function if exists public\.set_game_video/g) || []).length >= 2 &&
   s83.indexOf('drop function if exists public.set_game_video') <
   s83.indexOf('create or replace function public.set_game_video'));

/* ---- and the other thing that stops a push: a self-test that is wrong ----- */
console.log('\nself-tests check properties, not the source text that implements them');

const s81 = readFileSync(path.join(DIR, '0081_stream_targets.sql'), 'utf8');
ok('0081 checks the return COLUMNS rather than grepping the body',
   /'stream_key' = any \(p\.proargnames\)/.test(s81) &&
   !/routine_definition like/.test(s81),
   'grepping for t.stream_key matched right(t.stream_key, 4) — the masking itself');
ok('...and confirms the masked column is the one that exists',
   /'key_tail' = any \(p\.proargnames\)/.test(s81));

/* A self-test that calls an auth-gated function during a migration proves
   nothing: there is no auth.uid() when a migration runs, so it returns nothing
   and passes whatever the code does. */
const authGated = [];
for (const f of files) {
  const sql = readFileSync(path.join(DIR, f), 'utf8');
  const test = sql.slice(sql.indexOf('SELF-TEST'));
  if (!test) continue;
  if (/perform\s+\d*\s*from\s+public\.stream_targets_for_league/i.test(test)) {
    authGated.push(f + ': calls stream_targets_for_league, which needs auth.uid()');
  }
}
ok('no self-test relies on a function that cannot return rows during a migration',
   authGated.length === 0, authGated.join('\n          '));

/* ---- self-tests that cannot fail ----------------------------------------- */
console.log('\nnothing asserts against a rendering, or against a column that is always null');

const all = files.map(f => [f, readFileSync(path.join(DIR, f), 'utf8')]);
/* COMMENTS OUT FIRST — and this scanner caught itself on that.

   0088's self-test now explains the mistake it used to make, in prose, and the
   words "qual is not null" in that explanation read to a regex exactly like the
   statement being warned about. The scan reported the file it had just been
   used to fix. Same trap the CSS tests already document; it applies to SQL and
   to any check that greps a file which argues about its own contents. */
const testPart = sql => {
  const at = sql.indexOf('SELF-TEST');
  return at === -1 ? '' : statements(sql.slice(at));
};

/* An INSERT policy has no USING clause, so pg_policies.qual is null for one.
   Requiring `qual is not null` on an INSERT policy makes a check that can never
   fire — which is what 0088 did, while reading as a security assertion. */
const vacuous = all
  .filter(([, sql]) => /cmd = 'INSERT'/.test(testPart(sql)) &&
                       /qual is not null/.test(testPart(sql)))
  .map(([f]) => f);
ok('no self-test requires qual on an INSERT policy, which is always null',
   vacuous.length === 0, vacuous.join(', '));

/* pg_get_function_identity_arguments renders NAMES alongside types, so matching
   a bare type list against it never hits — 0089 refused a function that was
   exactly right for this reason. */
const rendered = all
  .filter(([, sql]) => /position\('[a-z ,]*\b(boolean|text|uuid|int)\b[a-z ,]*' in args\)/
                         .test(testPart(sql)))
  .map(([f]) => f);
ok('no self-test matches a bare type list against a rendered signature',
   rendered.length === 0, rendered.join(', '));

/* position() answers 0 for "not found", so comparing two of them without
   checking the landmark exists blames the wrong statement when one moves. */
const unguarded = all.filter(([, sql]) => {
  const t = testPart(sql);
  const m = t.match(/if position\('([^']+)' in src\) > position\('([^']+)' in src\)/);
  if (!m) return false;
  const esc2 = m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !new RegExp("position\\('" + esc2 + "' in src\\) = 0").test(t);
}).map(([f]) => f);
ok('a position() comparison first checks that both landmarks are there',
   unguarded.length === 0, unguarded.join(', '));

const s89 = readFileSync(path.join(DIR, '0089_drop_stale_overload.sql'), 'utf8');
const s88 = readFileSync(path.join(DIR, '0088_attach_video_after.sql'), 'utf8');
ok('0089 identifies the surviving function by parameter name',
   /'p_auto_reports' = any \(p\.proargnames\)/.test(s89));
ok('0088 reads the event log policy through with_check',
   /coalesce\(with_check, ''\) like '%may_attach_video%'/.test(s88));
ok('...and confirms can_score still guards it',
   /no longer gated on can_score/.test(s88));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
