/* ============================================================================
   TWO THINGS ABOUT A MIGRATION THAT ONLY A REAL `db push` WOULD OTHERWISE FIND.

   Both of these cost a round trip to the person holding the database, and both
   leave a NON-TRANSACTIONAL push stopped half way: earlier statements applied,
   the migration unrecorded, the database in a state no file describes. Each was
   found the expensive way, on 2026-09-19, one after the other in the same file.

   -------------------------------------------------------------------------
   1. EVERY RAISE HAS AN ARGUMENT FOR EVERY % IT WRITES.

   plpgsql does not check a RAISE's format string until the function body is
   COMPILED, which is at CREATE time. So

       raise exception '% is not an email address' using errcode = '22023';

   is not a runtime surprise waiting for an unusual input — it is
   "ERROR: too few parameters specified for RAISE (SQLSTATE 42601)" thrown by
   the CREATE FUNCTION itself, the first time anybody pushes the migration.

   And `supabase db push` IS NOT TRANSACTIONAL. It stopped at statement 16 of
   0140 on 2026-09-19 with exactly this, which left fifteen statements of that
   migration applied, the migration unrecorded, and the database in a state no
   file describes. Everything in 0140 happened to be idempotent so re-running it
   was safe; that was luck, not design. The cost of finding this in CI instead is
   one regex.

   Checked across EVERY migration, not just the newest, because the ones already
   applied are the calibration: they compiled on a real Postgres, so any hit
   among them would be a false positive in this test rather than a bug in them.
   At the time of writing there are none.

   It counts placeholders in the format string (the literal before the first
   top-level comma) against the arguments after it. %% is an escaped percent and
   is not a placeholder. A `raise ... using message = ...` form has no format
   string and is skipped.

   -------------------------------------------------------------------------
   2. A MIXED-CASE ADDRESS IS TESTING CASE-FOLDING, SO THE FOLDED FORM MUST BE
      IN THE SAME FILE.

   `'  T0140-New@Example.Invalid '` in a self-test is not decoration: it is
   there because the function under test lowercases and trims, and the
   assertion below it looks for the folded form. 0117 and 0120 use the same
   padded, mixed-case idiom for the same reason.

   Which makes the pair a find-and-replace hazard, and that is exactly what
   happened: a case-SENSITIVE sed rewrote the assertion's
   `t0140-new@example.test` to `...@example.invalid` and left the mixed-case
   literal above it alone. The function folded the address it was given, stored
   it, and the assertion then looked for an address nobody had written. The
   self-test failed on the live database, 33 statements in.

   So: any email literal carrying an uppercase letter must have its lowercased
   form somewhere else in the same file. Lower-case-only addresses are not
   checked — 0036 uses one address for both the write and the read and has
   nothing to fold — so this fires only on the idiom it is about.

     node supabase/tests/migration-lint.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const DIR = path.join(ROOT, 'supabase', 'migrations');

/* the index of the first comma not inside brackets */
function topLevelComma(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) return i;
  }
  return -1;
}

/* how many arguments a comma-separated list holds, brackets respected */
function countArgs(s) {
  if (!s.trim()) return 0;
  let depth = 0, n = 1;
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) n++;
  }
  return n;
}

const LITERAL = /'((?:''|[^'])*)'/g;
const RAISE = /\braise\s+(?:exception|notice|warning|info|debug|log)\b([\s\S]*?);/gi;

const bad = [];
let statements = 0;

for (const file of readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
  const src = readFileSync(path.join(DIR, file), 'utf8');
  for (const m of src.matchAll(RAISE)) {
    const stmt = m[1];
    if (/^\s*using\b/i.test(stmt)) continue;         // no format string at all
    const head = stmt.split(/\susing\s/i)[0];
    const cut = topLevelComma(head);
    const fmtPart = cut < 0 ? head : head.slice(0, cut);
    const argsPart = cut < 0 ? '' : head.slice(cut + 1);
    const fmt = [...fmtPart.matchAll(LITERAL)].map(x => x[1]).join('');
    if (!fmt) continue;
    statements++;
    const holes = (fmt.match(/%(?!%)/g) || []).length;
    if (!holes) continue;
    const args = countArgs(argsPart);
    if (args < holes) {
      const line = src.slice(0, m.index).split('\n').length;
      bad.push(`${file}:${line} — ${holes} placeholder(s), ${args} argument(s): ${fmt.slice(0, 90)}`);
    }
  }
}

const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
console.log(`1. RAISE arity: ${statements} statement(s) with a format string, across ` +
            `${files.length} migrations`);
if (bad.length) {
  console.log('\nThese would stop a db push at CREATE FUNCTION time:\n');
  bad.forEach(b => console.log('  ' + b));
  console.log('\n' + bad.length + ' malformed RAISE(s)');
  process.exit(1);
}
console.log('   every one has an argument for every %');

/* -- 2. a folded address must be findable in the file that folds it --------- */
const ADDR = /'\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\s*'/g;
const orphans = [];
let folded = 0;

for (const file of files) {
  const src = readFileSync(path.join(DIR, file), 'utf8');
  const lower = src.toLowerCase();
  for (const m of src.matchAll(ADDR)) {
    const addr = m[1];
    if (addr === addr.toLowerCase()) continue;    // nothing to fold, nothing to pair
    folded++;
    /* The folded form has to appear somewhere OTHER than this literal itself.
       The literal contributes one occurrence to the lowercased source, so the
       count has to clear two. */
    const want = addr.toLowerCase();
    if (lower.split(want).length - 1 < 2) {
      const line = src.slice(0, m.index).split('\n').length;
      orphans.push(`${file}:${line} — ${addr} folds to ${want}, which appears nowhere else in ` +
                   `this file. Whatever should read it back is looking for something else.`);
    }
  }
}

console.log(`\n2. folded addresses: ${folded} mixed-case email literal(s)`);
if (orphans.length) {
  console.log('\nThese would fail a migration self-test on the live database:\n');
  orphans.forEach(o => console.log('  ' + o));
  console.log('\n' + orphans.length + ' orphaned address(es)');
  process.exit(1);
}
console.log('   each one is read back in its folded form');
