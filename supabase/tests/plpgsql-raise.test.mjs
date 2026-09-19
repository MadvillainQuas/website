/* ============================================================================
   EVERY RAISE HAS AN ARGUMENT FOR EVERY % IT WRITES.

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

     node supabase/tests/plpgsql-raise.test.mjs
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

console.log(`plpgsql-raise: ${statements} RAISE statement(s) with a format string, across ` +
            `${readdirSync(DIR).filter(f => f.endsWith('.sql')).length} migrations`);
if (bad.length) {
  console.log('\nThese would stop a db push at CREATE FUNCTION time:\n');
  bad.forEach(b => console.log('  ' + b));
  console.log('\n' + bad.length + ' malformed RAISE(s)');
  process.exit(1);
}
console.log('every one has an argument for every %');
