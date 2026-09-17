/* ============================================================================
   Placeholder sides are never clubs — the console's copy of the rule
   (epinoia/admin/admin.js isPlaceholderTeam), against the shared vectors that
   scripts/ingest/placeholders_test.py and migration 0126's self-test also use.
   Run: node supabase/tests/placeholders.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = fs.readFileSync(path.join(ROOT, 'epinoia', 'admin', 'admin.js'), 'utf8');
const vectors = JSON.parse(fs.readFileSync(path.join(ROOT, 'supabase', 'tests', 'fixtures', 'placeholder_teams.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) pass++;
  else { fail++; console.log('  FAIL  ' + name + (detail !== undefined ? '\n          ' + detail : '')); }
};

const start = src.indexOf('const PLACEHOLDER_PATTERNS = [');
const fnAt = src.indexOf('function isPlaceholderTeam(');
const close = /\r?\n\}\r?\n/.exec(src.slice(fnAt));
const end = fnAt >= 0 && close ? fnAt + close.index + close[0].length : -1;
ok('admin.js carries PLACEHOLDER_PATTERNS and isPlaceholderTeam', start > 0 && end > start);
const ctx = vm.createContext({});
vm.runInContext(src.slice(start, end) + '\nthis.isPlaceholderTeam = isPlaceholderTeam; this.PLACEHOLDER_PATTERNS = PLACEHOLDER_PATTERNS;', ctx);

vectors.placeholders.forEach(n => ok('placeholder: ' + JSON.stringify(n), ctx.isPlaceholderTeam(n) === true));
vectors.clubs.forEach(n => ok('club: ' + JSON.stringify(n), ctx.isPlaceholderTeam(n) === false));
['', null, undefined, '   '].forEach(n => ok('empty: ' + JSON.stringify(n), ctx.isPlaceholderTeam(n) === false));

/* the Python module holds the same patterns, in the same order */
const py = fs.readFileSync(path.join(ROOT, 'scripts', 'ingest', 'placeholders.py'), 'utf8');
const pyPatterns = [...py.matchAll(/^\s*r"([^"]+)",/gm)].map(m => m[1]);
ok('placeholders.py and admin.js hold the same patterns in the same order',
   JSON.stringify(pyPatterns) === JSON.stringify(Array.from(ctx.PLACEHOLDER_PATTERNS)),
   JSON.stringify(pyPatterns) + '\n          ' + JSON.stringify(Array.from(ctx.PLACEHOLDER_PATTERNS)));

/* the console refuses to create one */
ok('creating a team refuses a placeholder before anything is written',
   /if \(isPlaceholderTeam\(name\)\) \{\s*return say\(/.test(src) &&
   src.indexOf('if (isPlaceholderTeam(name))') < src.indexOf("sb.from('teams').insert"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
