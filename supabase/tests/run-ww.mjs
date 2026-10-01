/* ============================================================================
   WHAT WINS 2 — EVERY ww-*.test.mjs IN ONE GO (docs/what-wins-model.md §16, one guard step).

   Runs each supabase/tests/ww-*.test.mjs in turn, in its own node with --experimental-strip-types (ww-function
   imports the Edge Function's TypeScript handler), from the repository root, and exits non-zero if any of them
   fails. The tests need no network and no browser; ww-gate needs PGlite (`npm i --no-save @electric-sql/pglite`,
   or PGLITE_DIR pointing at an unpacked copy) and prints SKIP without it.

     node supabase/tests/run-ww.mjs                  every ww-*.test.mjs
     node supabase/tests/run-ww.mjs winsim page      only the ones whose name holds one of the words
     node supabase/tests/run-ww.mjs --strict         a test that prints SKIP fails (the guard step: PGlite is
                                                     installed there, so a SKIP means something is wrong)
   ============================================================================ */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const strict = args.includes('--strict') || process.env.WW_STRICT === '1';
const words = args.filter(a => !a.startsWith('--'));

const all = readdirSync(HERE).filter(f => /^ww-.+\.test\.mjs$/.test(f)).sort();
const files = words.length ? all.filter(f => words.some(w => f.includes(w))) : all;
if (!files.length) { console.error('run-ww: no ww-*.test.mjs matches ' + words.join(' ')); process.exit(1); }

const rows = [];
for (const f of files) {
  console.log('\n=== ' + f + ' ' + '='.repeat(Math.max(3, 70 - f.length)));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', path.join(HERE, f)],
    { cwd: ROOT, env: process.env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);
  const tally = /(\d+) passed, (\d+) failed/.exec(out.split('\n').reverse().find(l => /\d+ passed, \d+ failed/.test(l)) || '');
  const skipped = /^\s*SKIP\b/m.test(out);
  const failed = r.status !== 0 || (tally && +tally[2] > 0) || (strict && skipped);
  rows.push({ f, ms: Date.now() - t0, status: r.status, tally: tally ? tally[1] + '/' + tally[2] : (skipped ? 'SKIP' : '-'), failed });
}

console.log('\n=== What wins: ' + files.length + ' test file(s) ' + '='.repeat(40));
for (const r of rows) console.log(`  ${r.failed ? 'FAIL' : 'ok  '}  ${r.f.padEnd(28)} ${String(r.tally).padStart(9)}  ${(r.ms / 1000).toFixed(1).padStart(6)} s` +
  (r.status !== 0 ? '  (exit ' + r.status + ')' : ''));
const bad = rows.filter(r => r.failed);
console.log(bad.length ? `\n${bad.length} of ${rows.length} What wins test file(s) failed` : `\nall ${rows.length} What wins test files passed`);
process.exit(bad.length ? 1 : 0);
