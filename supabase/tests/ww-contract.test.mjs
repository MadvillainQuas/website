/* ============================================================================
   WHAT WINS 2 — THE CONTRACT ACROSS THE PACKAGES (docs/what-wins-model.md §1, §16 WP6, A.0-A.2).

   What no single package's test can see, because it spans them:
     * every model file the tests and pages are built on (fixtures/ww-page, fixtures/ww-fo, fixtures/ww) passes
       EpinoiaWinModel.validate, and no file carries a player's name (I6);
     * only the feature line, the builder, the backfill, finalise-game, the migration, the analytics-file handler and
       the ww tests name game_features in code; the snapshots function names neither it nor the analytics bucket (I4);
     * no What wins file selects stats->sit or a whole stats blob (I8); no page script of this feature names one of
       I1's five tables or writes localStorage (I1, I7);
     * the migration: one *_what_wins.sql, its number unique and the newest (A.0), RLS on game_features with no
       policy or grant to anon / authenticated, a private bucket with no storage.objects policy (I2, I3);
     * CATALOGUE.locks.model (§10.3); the shared copies (winstats before winsim, winmodel, bpm before winmodel);
       guard.yml runs run-ww.mjs; stamp-assets.py --check;
     * END TO END: a builder's files go through epinoia/winfile.js (a stand-in analytics-file and storage) into the
       What wins page's views and into the Front office (fomodel's view and panel, the depth chart by the floor),
       with every chart built at desk and phone widths, no NaN, nothing written to localStorage.

     node supabase/tests/ww-contract.test.mjs
     WW_LOCAL_DIR=<dir> node supabase/tests/ww-contract.test.mjs   also every league in a builder --local --out <dir>
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const EP = path.join(ROOT, 'epinoia');
const TESTS = path.join(ROOT, 'supabase', 'tests');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(...p));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  -> ' + String(extra).slice(0, 600) : ''}`); };
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');

const WM = require(path.join(EP, 'winmodel.js'));

/* code without its comments, so a comment that WARNS against a thing is not the thing */
function code(text, file) {
  if (/\.(m?js|ts|cjs)$/.test(file)) return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
  if (/\.sql$/.test(file)) return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  if (/\.(ya?ml|py|toml|sh)$/.test(file)) return text.replace(/(^|\s)#.*$/gm, '$1');
  if (/\.html?$/.test(file)) return text.replace(/<!--[\s\S]*?-->/g, '');
  return text;
}
/* every source file of the site, the functions, the tools and the workflows */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === '.cache' || e.name === 'vendor' || e.name === 'fixtures') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(m?js|cjs|ts|sql|ya?ml|py|toml|html|sh)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SOURCES = ['epinoia', 'supabase', 'tools', 'scripts', '.github', 'share'].filter(d => exists(ROOT, d)).flatMap(d => walk(path.join(ROOT, d)));

/* ------------------------------------------------------------------ the files --- */
console.log('\nevery model file passes EpinoiaWinModel.validate, and none names a player (I6)');
const scopeOf = f => (/^wins/.test(f) ? 'wins' : /^fo/.test(f) ? 'fo' : /^club/.test(f) ? 'club' : /^teaser/.test(f) ? 'teaser' : /^pos/.test(f) ? 'pos' : /^mix/.test(f) ? 'mix' : null);
const NAMEKEYS = /^(name|first_name|last_name|full_name|surname|given_name|family_name|display_name)$/;
function namesIn(v, trail, out) {
  if (Array.isArray(v)) { v.forEach((x, i) => namesIn(x, trail, out)); return out; }
  if (v && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (NAMEKEYS.test(k) && /(players|lineups|slots|top|pos|realised|losses|squad)/.test(trail)) out.push(trail + '.' + k);
      namesIn(v[k], trail + '.' + k, out);
    }
  }
  return out;
}
const SETS = [['fixtures/ww-page', /\.json$/], ['fixtures/ww-fo', /\.json$/], ['fixtures/ww', /\.sample\.json$/]];
for (const [dir, re] of SETS) {
  const abs = path.join(TESTS, dir);
  const files = exists(abs) ? fs.readdirSync(abs).filter(f => re.test(f)).sort() : [];
  const model = [], skipped = [];
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(abs, f), 'utf8'));
    const sc = scopeOf(f);
    if (!sc || !j || j.w == null) { skipped.push(f); continue; }          // locked.json, refusal.json: an answer, not a file
    model.push([f, sc, j]);
  }
  ok(dir + ': the files are there (' + model.map(m => m[0]).join(', ') + (skipped.length ? '; not model files: ' + skipped.join(', ') : '') + ')', model.length >= 2);
  const bad = model.map(([f, sc, j]) => [f, WM.validate(j, sc)]).filter(x => x[1].length);
  ok(dir + ': every one passes validate', !bad.length, bad.map(b => b[0] + ': ' + b[1].slice(0, 3).join('; ')).join(' | '));
  const embedded = model.flatMap(([f, sc, j]) => (sc === 'club' && j.pos ? [[f + '.pos', j.pos]] : sc === 'fo' && j.pos ? Object.entries(j.pos).map(([t, p]) => [f + '.pos.' + t, p]) : []));
  const badPos = embedded.map(([f, p]) => [f, WM.validate(p, 'pos')]).filter(x => x[1].length);
  ok(dir + ': the pos files embedded in fo and club (A.1) pass validate as pos (' + embedded.length + ')', !badPos.length, badPos.map(b => b[0] + ': ' + b[1][0]).join(' | '));
  const names = model.flatMap(([f, , j]) => namesIn(j, f, []));
  ok(dir + ': no player name in any file', !names.length, names.slice(0, 5).join(', '));
}

/* ------------------------------------------------------------------ who names game_features --- */
console.log('\nwho names game_features, and what the snapshots function may touch');
{
  const ALLOW = new Set(['epinoia/features.js', 'supabase/functions/_shared/features.js', 'tools/build-analytics.mjs', 'scripts/backfill_features.mjs',
    'supabase/functions/finalise-game/index.ts', 'supabase/functions/_shared/analyticsfile.ts']);
  const mig = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /_what_wins\.sql$/.test(f));
  mig.forEach(f => ALLOW.add('supabase/migrations/' + f));
  const allowed = r => ALLOW.has(r) || /^supabase\/tests\/ww-[\w-]+\.test\.mjs$/.test(r);
  const naming = SOURCES.map(p => [rel(p), p]).filter(([r, p]) => !allowed(r) && /\bgame_features\b/.test(code(fs.readFileSync(p, 'utf8'), p))).map(x => x[0]);
  ok('only the feature line, the builder, the backfill, finalise-game, the migration, the analytics-file handler and the ww tests name game_features in code',
     !naming.length, naming.join(', '));
  const used = [...ALLOW].filter(r => !r.startsWith('supabase/functions/_shared/features')).filter(r => exists(ROOT, r) && /\bgame_features\b/.test(read(ROOT, r)));
  ok('...and each of those does (the rule lists real readers and writers, not stale names)', used.length === ALLOW.size - 1, [...ALLOW].filter(r => !used.includes(r)).join(', '));
  const snapDir = path.join(ROOT, 'supabase', 'functions', 'snapshots');
  const snap = exists(snapDir) ? walk(snapDir).map(p => [rel(p), code(fs.readFileSync(p, 'utf8'), p)]) : [];
  ok('the snapshots function exists to be checked', snap.some(([r]) => r.endsWith('snapshots/index.ts')));
  const snapBad = snap.filter(([, s]) => /\bgame_features\b/.test(s) || /from\(\s*['"`]analytics['"`]\s*\)/.test(s) || /['"`/]analytics\/(wins|fo|club|pos|store|priors)\b/.test(s) ||
    /bucket[^\n]{0,40}['"`]analytics['"`]/i.test(s) || /\b(winmodel|winstats|winsim|features)\.js\b/.test(s)).map(x => x[0]);
  ok('the snapshots function names neither game_features nor the analytics bucket, nor loads the model (I4: the teaser is the builder\'s)', !snapBad.length, snapBad.join(', '));
}

/* ------------------------------------------------------------------ stats->sit, whole stats, I1, I7 --- */
console.log('\nwhat the new code reads and writes (I1, I7, I8)');
const WW_FILES = ['epinoia/features.js', 'epinoia/winfile.js', 'epinoia/winstats.js', 'epinoia/winsim.js', 'epinoia/winsim.worker.js', 'epinoia/winmodel.js',
  'epinoia/vizkit.js', 'epinoia/winning/page.js', 'epinoia/winning.js', 'epinoia/t/fomodel.js', 'tools/build-analytics.mjs', 'scripts/backfill_features.mjs',
  'supabase/functions/_shared/analyticsfile.ts', 'supabase/functions/analytics-file/index.ts', 'supabase/functions/finalise-game/index.ts',
  '.github/workflows/analytics.yml', '.github/workflows/backfill-features.yml'].concat(
  fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /_what_wins\.sql$/.test(f)).map(f => 'supabase/migrations/' + f));
{
  const missing = WW_FILES.filter(f => !exists(ROOT, f));
  ok('the What wins files are all there (' + WW_FILES.length + ')', !missing.length, missing.join(', '));
  const SIT = /stats\s*-(>|%3E)+\s*'?sit\b|stats\s*->>\s*'?sit\b|\{\s*sit\s*\}|['"`]sit['"`]\s*\]/i;
  const sit = WW_FILES.filter(f => exists(ROOT, f) && SIT.test(code(read(ROOT, f), f)));
  ok('no What wins file selects stats->sit (I8)', !sit.length, sit.join(', '));
  /* every select list: no bare stats column and no * */
  const lists = [];
  for (const f of WW_FILES.filter(x => exists(ROOT, x))) {
    const s = code(read(ROOT, f), f);
    /* the table each list is on: the REST path before ?, or the .from('…') before .select */
    const tableAt = i => { const back = s.slice(Math.max(0, i - 300), i);
      const a = [...back.matchAll(/(?:from\(\s*['"]|[`'"/])(\w+)(?:['"]\s*\)|\?)/g)].pop(); return a ? a[1] : '?'; };
    for (const m of s.matchAll(/select=([^&'"`\s]+)/g)) lists.push([f, m[1], tableAt(m.index)]);
    for (const m of s.matchAll(/\.select\(\s*['"]([^'"]*)['"]/g)) lists.push([f, m[1], tableAt(m.index)]);
    for (const m of s.matchAll(/\b[A-Z_]*SELECT\s*=\s*((?:'[^']*'\s*\+?\s*)+)/g)) lists.push([f, m[1].replace(/'\s*\+\s*'/g, '').replace(/'/g, '')]);
  }
  const B = await import(path.join(ROOT, 'tools', 'build-analytics.mjs'));
  ['PGS_SELECT', 'STINT_SELECT', 'GAME_SELECT', 'FEATURE_SELECT'].forEach(k => { if (B[k]) lists.push(['build-analytics ' + k, B[k]]); });
  const toks = l => l.replace(/\$\{[^}]*\}/g, '').split(/[,()]/).map(t => t.trim().replace(/^[\w]+:/, '')).filter(Boolean);
  /* a whole stats blob: the bare column anywhere, or * on a table that carries one (or on a table this cannot name) */
  const BLOB = /^(player_game_stats|team_game_stats|lineup_stints|\?)$/;
  const whole = lists.filter(([, l, t]) => toks(l).some(x => x === 'stats' || (x === '*' && BLOB.test(t || '?'))));
  ok('no select list in them reads a whole stats blob (' + lists.length + ' lists)', lists.length > 10 && !whole.length, whole.map(w => w[0] + ' ' + (w[2] || '') + ': ' + w[1]).join(' | '));
  const sitSel = lists.filter(([, l]) => toks(l).some(t => /^stats->>?'?sit/.test(t)));
  ok('...nor stats->sit', !sitSel.length, sitSel.map(w => w[0]).join(', '));

  const BROWSER = ['epinoia/winfile.js', 'epinoia/winning/page.js', 'epinoia/t/fomodel.js', 'epinoia/vizkit.js', 'epinoia/winstats.js', 'epinoia/winsim.js', 'epinoia/winsim.worker.js', 'epinoia/winning.js'];
  const I1 = /\b(game_events|game_features|player_game_stats|lineup_stints|team_game_stats)\b/;
  const t1 = BROWSER.filter(f => I1.test(code(read(ROOT, f), f)));
  ok('I1: no page script of What wins or the win model names game_events, game_features, player_game_stats, lineup_stints or team_game_stats', !t1.length, t1.join(', '));
  /* the one transition exception (I1): before the first build, the page's previous public box-score reading */
  const BX = code(read(EP, 'winning/boxpreview.js'), 'epinoia/winning/boxpreview.js'), PG = code(read(EP, 'winning/page.js'), 'epinoia/winning/page.js');
  const bxTables = [...BX.matchAll(/\b(game_events|game_features|player_game_stats|lineup_stints|team_game_stats)\b/g)].map(m => m[1]);
  ok('I1 transition: boxpreview.js names only team_game_stats, selected by winning.js SELECT, and the finished games; no localStorage',
     bxTables.length && bxTables.every(t => t === 'team_game_stats') && /&select=' \+ W\.SELECT/.test(BX) && /games\?status=eq\.final&select=id,home_score,away_score,competitions/.test(BX) && !/localStorage/.test(BX), bxTables.join());
  ok('I1 transition: page.js loads it only when the teaser cannot be had', /if \(t\.ok\) ctx\.teaser = t\.data;\s*else if \(t\.reason !== 'aborted'\) \{ ctx\.teaser = await boxPreview\(\)/.test(PG) &&
     (PG.match(/await boxPreview\(\)/g) || []).length === 1);
  const ls = BROWSER.filter(f => /localStorage\s*(\.\s*setItem|\[[^\]]+\]\s*=(?!=))/.test(code(read(ROOT, f), f)));
  ok('I7: none of them writes localStorage', !ls.length, ls.join(', '));
  ok('I7: winfile.js and the What wins page remove the legacy epinoia_winning_v1', /epinoia_winning_v1/.test(read(EP, 'winfile.js')) && /removeItem/.test(read(EP, 'winfile.js')) &&
     /epinoia_winning_v1/.test(read(EP, 'winning/page.js')));
  const pages = [['epinoia/winning/index.html', 'winfile.js'], ['epinoia/t/index.html', 'winfile.js']];
  /* the team page loads it (with the rest of the win model) when the Front office opens: team.js loadWinModel */
  const lazy = p => p === 'epinoia/t/index.html' && /\['\.\.\/winfile\.js', \(\) => !!window\.EpinoiaWinFile\]/.test(read(EP, 't/team.js'));
  const noLoader = pages.filter(([p, s]) => !lazy(p) && !new RegExp('<script src="\\.\\./' + s.replace('.', '\\.') + '\\?v=\\d+"').test(read(ROOT, p))).map(p => p[0]);
  ok('both pages read the files through EpinoiaWinFile (winfile.js is loaded: in the head, or by team.js when the Front office opens)', !noLoader.length, noLoader.join(', '));
  const winmodelLoaded = ['epinoia/winning/index.html', 'epinoia/t/index.html'].filter(p => /winmodel\.js/.test(code(read(ROOT, p), p)));
  ok('...and no page loads the 180 KB builder model (winmodel.js is the builder\'s and the function\'s)', !winmodelLoaded.length, winmodelLoaded.join(', '));
}

/* ------------------------------------------------------------------ the guard's trigger --- */
console.log('\nthe guard runs when what the ww tests read changes');
{
  const g = read(ROOT, '.github/workflows/guard.yml');
  const m = /push:\s*\n\s*paths:\s*\[([\s\S]*?)\]/.exec(g);
  const paths = m ? [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]) : [];
  const need = ['tools/build-analytics.mjs', 'scripts/backfill_features.mjs', 'scripts/backfill_situations.mjs', '.github/workflows/analytics.yml', '.github/workflows/backfill-features.yml'];
  const miss = need.filter(f => !paths.includes(f));
  ok('guard.yml\'s push paths name the builder, the backfill scripts and their workflows (ww-build, ww-features, ww-contract read them)', !miss.length, miss.join(', '));
}

/* ------------------------------------------------------------------ the migration --- */
console.log('\nthe migration (A.0, I2, I3)');
{
  const all = fs.readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
  const ww = all.filter(f => /_what_wins\.sql$/.test(f));
  ok('one What wins migration (' + ww.join(', ') + ')', ww.length === 1);
  const num = f => f.slice(0, 4);
  const same = all.filter(f => ww.length && num(f) === num(ww[0]));
  ok('...its number belongs to it alone', same.length === 1, same.join(', '));
  /* after everything it builds on (0208_scorer_reliability was the newest at merge); later migrations may follow it */
  ok('...and it comes after everything it builds on (above 0208), whatever migrations follow it', ww.length && +num(ww[0]) > 208, all.slice(-3).join(', '));
  ok('...not the spec\'s placeholder 0207 (main has 0207_league_creators and 0208_scorer_reliability)', ww.length && !/^020[78]_/.test(ww[0]));
  const sql = ww.length ? code(read(ROOT, 'supabase/migrations', ww[0]), ww[0]).toLowerCase() : '';
  ok('I2: RLS is on for game_features', /alter table (public\.)?game_features enable row level security/.test(sql));
  ok('I2: no policy on game_features', !/create policy[^;]*\bon (public\.)?game_features\b/.test(sql));
  const grants = [...sql.matchAll(/grant[^;]*\bon (?:table )?(?:public\.)?game_features\b[^;]*;/g)].map(m => m[0]);
  ok('I2: no grant on game_features to anon or authenticated', !grants.some(g => /\b(anon|authenticated|public)\b\s*;?$/.test(g.replace(/to\s+/, ' ').trim()) || /to[^;]*\b(anon|authenticated)\b/.test(g)), grants.join(' | '));
  ok('I2: and the defaults are revoked from them', /revoke all on (table )?(public\.)?game_features from[^;]*\banon\b/.test(sql) && /revoke all on (table )?(public\.)?game_features from[^;]*\bauthenticated\b/.test(sql));
  ok('I3: the analytics bucket is created private', /insert into storage\.buckets[^;]*'analytics'[^;]*\bfalse\b/.test(sql) || /'analytics'[^;]*public\s*=\s*false/.test(sql));
  ok('I3: no storage.objects policy for it', !/create policy[^;]*on storage\.objects[^;]*'analytics'/.test(sql));
  ok('no RAISE with a % placeholder (the db push trap migration-lint knows)', !/raise[^;]*%/.test(sql));
}

/* ------------------------------------------------------------------ lock, shared copies, guard, stamps --- */
console.log('\nthe lock, the shared copies, the guard step and the stamps');
{
  const A = require(path.join(EP, 'access.js'));
  const m = A.CATALOGUE && A.CATALOGUE.locks && A.CATALOGUE.locks.model;
  ok('§10.3: CATALOGUE.locks.model = {gate: \'analytics\', label: \'What wins model\'}', !!m && m.gate === 'analytics' && m.label === 'What wins model', JSON.stringify(m));
  ok('...beside the two locks that were there (events, csv; more may follow)', !!(A.CATALOGUE.locks.events && A.CATALOGUE.locks.csv && A.CATALOGUE.locks.model));
  const ES = read(TESTS, 'extract-shared.mjs');
  const entry = n => { const i = ES.indexOf("'epinoia', '" + n + "'"); return i < 0 ? null : ES.slice(i, ES.indexOf('}', i)); };
  const want = ['features.js', 'winstats.js', 'winsim.js', 'winmodel.js'];
  ok('extract-shared copies features, winstats, winsim and winmodel to _shared, none of them optional any more', want.every(n => entry(n) && !/optional:\s*true/.test(entry(n))),
     want.filter(n => !entry(n) || /optional:\s*true/.test(entry(n))).join(', '));
  ok('...winstats listed before winsim', ES.indexOf("'epinoia', 'winstats.js'") < ES.indexOf("'epinoia', 'winsim.js'"));
  ok('...and the copies are there', want.every(n => exists(ROOT, 'supabase/functions/_shared', n)));
  const AF = read(ROOT, 'supabase/functions/analytics-file/index.ts');
  const at = s => AF.indexOf("import '../_shared/" + s + "'");
  ok('analytics-file imports winstats before winsim (winsim finds it on globalThis under Deno), and bpm before winmodel (positions as the builder\'s)',
     at('winstats.js') > 0 && at('winstats.js') < at('winsim.js') && at('bpm.js') > 0 && at('bpm.js') < at('winmodel.js') && at('features.js') < at('winmodel.js'));
  const r = spawnSync(process.execPath, [path.join(TESTS, 'extract-shared.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  ok('extract-shared --check: the Edge copies match the browser files', r.status === 0, (r.stdout + r.stderr).split('\n').filter(l => /DRIFTED|Error/.test(l)).join(' | '));

  const G = read(ROOT, '.github/workflows/guard.yml');
  const step = /- name: What wins 2[^\n]*\n([\s\S]*?)(?=\n {6}- name:|\n*$)/.exec(G);
  ok('guard.yml has one What wins 2 step after the What wins one', !!step && G.indexOf('- name: What wins 2') > G.indexOf('- name: What wins - which numbers go with winning'));
  ok('...that installs PGlite and runs run-ww.mjs strictly', !!step && /npm i --no-save @electric-sql\/pglite/.test(step[1]) && /node supabase\/tests\/run-ww\.mjs --strict/.test(step[1]));
  const RUN = read(TESTS, 'run-ww.mjs');
  ok('run-ww.mjs runs every ww-*.test.mjs with --experimental-strip-types and fails on any failure',
     /ww-\.\+\\\.test\\\.mjs/.test(RUN) && /--experimental-strip-types/.test(RUN) && /process\.exit\(bad\.length \? 1 : 0\)/.test(RUN));
  const tests = fs.readdirSync(TESTS).filter(f => /^ww-.+\.test\.mjs$/.test(f));
  const expect = ['features', 'gate', 'function', 'winfile', 'winstats', 'winsim', 'winmodel', 'build', 'vizkit', 'page', 'fomodel', 'contract'];
  ok('...and finds the twelve: ' + expect.join(', '), expect.every(n => tests.includes('ww-' + n + '.test.mjs')), expect.filter(n => !tests.includes('ww-' + n + '.test.mjs')).join(', '));

  const py = spawnSync('python3', [path.join(ROOT, 'tools', 'stamp-assets.py'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  ok('stamp-assets.py --check: every page carries the one stamp', py.status === 0, (py.stdout || '') + (py.stderr || '') + (py.error ? py.error.message : ''));
  const v = read(EP, 'version.txt').trim();
  const pagesV = ['epinoia/winning/index.html', 'epinoia/t/index.html'].filter(p => {
    const h = read(ROOT, p); const refs = [...h.matchAll(/(?:src|href)="[^"]*(?:winfile|winstats|winsim|vizkit|fomodel|page|winning)\.(?:js|css)\?v=(\d+)"/g)].map(x => x[1]);
    return !refs.length || refs.some(x => x !== v);
  });
  ok('...the What wins scripts on both pages carry it (v' + v + ')', !pagesV.length, pagesV.join(', '));
}

/* ------------------------------------------------------------------ end to end --- */
console.log('\nend to end: builder files -> winfile.js -> the What wins page and the Front office');
const LIG = 'a1a1a1a1-0000-4000-8000-000000000001', SEA = 'b2b2b2b2-0000-4000-8000-000000000002';
const res = (status, body, headers = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: k => headers[k] ?? headers[k.toLowerCase()] ?? null },
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
});
function storage(log, name) {
  const m = new Map();
  return { get length() { return m.size; }, key: i => Array.from(m.keys())[i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { log.push([name, 'set', k, String(v).length]); m.set(k, String(v)); }, removeItem: k => { log.push([name, 'remove', k]); m.delete(k); } };
}
/* a stand-in for analytics-file and the bucket: {scope|league|season|team -> file}; signed in as a member */
function server(files) {
  const reqs = [];
  const keyOf = b => [b.scope, b.league || 'all', b.season || 'current', b.team || ''].join('|');
  const route = async (url, init) => {
    reqs.push({ url, method: (init && init.method) || 'GET', headers: init && init.headers });
    if (/\/functions\/v1\/analytics-file$/.test(url)) {
      const b = JSON.parse(init.body); const f = files.get(keyOf(b));
      if (!f) return res(404, { reason: 'none' });
      const text = JSON.stringify(f);
      return res(200, { url: 'https://proj.supabase.co/storage/v1/object/sign/analytics/' + encodeURIComponent(keyOf(b)) + '.json?token=T', token: f.token || 'tk',
        bytes: text.length, built_at: f.built || null, layout: f.w, expires_in: 120, n_games: f.n && f.n.games, pending: 3, ci_at: f.ci_at || null });
    }
    if (/\/storage\/v1\/object\/public\/snapshots\/whatwins\/index\.json$/.test(url)) {
      const t = files.get('teaser|all|current|'); return t ? res(200, { file: 'whatwins/v1-x.json', token: t.token, built: t.built }) : res(404, {});
    }
    if (/\/storage\/v1\/object\/public\/snapshots\/whatwins\/v1-x\.json$/.test(url)) return res(200, JSON.stringify(files.get('teaser|all|current|')));
    const m = /\/object\/sign\/analytics\/([^?]+)\.json\?/.exec(url);
    if (m) { const f = files.get(decodeURIComponent(m[1])); return f ? res(200, JSON.stringify(f)) : res(400, {}); }
    return res(500, {});
  };
  return { reqs, route };
}
function sandboxFor(scripts, srv) {
  const log = [];
  const sb = { console, module: undefined, Math, Date, JSON, Promise, setTimeout, clearTimeout, URLSearchParams, btoa, atob,
    EPINOIA_CONFIG: { supabaseUrl: 'https://proj.supabase.co', supabaseAnonKey: 'sb_publishable_test' },
    EpinoiaAccess: { session: () => ({ token: 'a.b.c', userId: 'u-1' }), onChange: () => () => {} },
    localStorage: storage(log, 'local'), sessionStorage: storage(log, 'session') };
  sb.self = sb; sb.globalThis = sb; sb.window = sb;
  const cx = vm.createContext(sb);
  for (const f of scripts) vm.runInContext(read(EP, f), cx, { filename: f });
  sb.EpinoiaWinFile._setTransport(srv.route);
  return { sb, log };
}
function svgProblems(VK, spec, tag) {
  const out = [];
  if (!VK[spec.kind]) return [tag + ': no chart builder ' + spec.kind];
  for (const W of [760, 360]) {
    let b;
    try { b = VK[spec.kind](spec.data, Object.assign({}, spec.o, { W, id: 'c' + W })); } catch (e) { out.push(tag + ' ' + spec.kind + '@' + W + ' threw ' + e.message); continue; }
    if (!/^<svg[^>]*role="img"/.test(b.svg) || !/<\/svg>\s*$/.test(b.svg)) out.push(tag + ' ' + spec.kind + '@' + W + ' not an svg');
    if (/NaN|undefined|Infinity/.test(b.svg)) out.push(tag + ' ' + spec.kind + '@' + W + ' NaN/undefined');
  }
  return out;
}

async function endToEnd(tag, set) {
  /* the What wins page, as winning/index.html loads it */
  const files = new Map();
  files.set(['wins', LIG, SEA, ''].join('|'), set.wins);
  if (set.pooled) files.set('wins|all|current|', set.pooled);
  if (set.teaser) files.set('teaser|all|current|', set.teaser);
  const tid = set.club && set.club.team && (set.club.team.id || set.club.team);
  if (set.fo) files.set(['fo', LIG, SEA, ''].join('|'), set.fo);
  if (set.club) files.set(['club', LIG, SEA, tid].join('|'), set.club);
  const posFile = set.pos || (set.club && set.club.pos) || (set.fo && set.fo.pos && set.fo.pos[tid]);
  if (posFile) files.set(['pos', LIG, SEA, tid].join('|'), posFile);
  if (set.mix) files.set(['mix', LIG, SEA, ''].join('|'), set.mix);
  const srv = server(files);
  const pg = sandboxFor(['winstats.js', 'winsim.js', 'winfile.js', 'winning.js', 'vizkit.js', 'winmix.js', 'winning/page.js'], srv);
  const WF = pg.sb.EpinoiaWinFile, P = pg.sb.EpinoiaWinPage, VK = pg.sb.EpinoiaVizKit;
  const stages = [];
  const ans = await WF.get({ scope: 'wins', league: LIG, season: SEA }, { onProgress: e => stages.push(e.stage) });
  ok(tag + ': the league file comes through winfile.js (POST, then the signed URL), whole', ans.ok && JSON.stringify(ans.data) === JSON.stringify(set.wins) &&
     srv.reqs.length === 2 && srv.reqs[0].method === 'POST' && srv.reqs[0].headers.Authorization === 'Bearer a.b.c' && /\/sign\/analytics\//.test(srv.reqs[1].url) && !srv.reqs[1].headers,
     JSON.stringify({ ok: ans.ok, reason: ans.reason, reqs: srv.reqs.map(r => r.method + ' ' + r.url) }));
  ok(tag + ': ...with pending and the stages check, download, done', ans.pending === 3 && stages[0] === 'check' && stages.includes('download') && stages[stages.length - 1] === 'done', JSON.stringify({ p: ans.pending, stages }));
  const again = await WF.get({ scope: 'wins', league: LIG, season: SEA });
  ok(tag + ': ...and the second ask is answered from the cache, with no request', again.ok && again.cached && srv.reqs.length === 2);
  const pooled = set.pooled ? await WF.get({ scope: 'wins' }) : null;
  const teaser = set.teaser ? await WF.get({ scope: 'teaser' }) : null;
  ok(tag + ': the pooled file and the teaser come through it too', (!set.pooled || pooled.ok) && (!set.teaser || (teaser.ok && teaser.data.scope === 'teaser')),
     JSON.stringify([pooled && pooled.reason, teaser && teaser.reason]));
  const fo = set.fo ? await WF.get({ scope: 'fo', league: LIG, season: SEA }) : null;
  const club = set.club ? await WF.get({ scope: 'club', league: LIG, season: SEA, team: tid }) : null;
  /* A.3: the lineup mixes' file, as the page asks for it when #mixes comes near */
  const mix = set.mix ? await WF.get({ scope: 'mix', league: LIG, season: SEA }) : null;
  if (set.mix) ok(tag + ': the lineup mixes file comes through winfile.js (scope mix), whole, and decodes', mix.ok && JSON.stringify(mix.data) === JSON.stringify(set.mix) && !!pg.sb.EpinoiaWinMix.decode(mix.data));
  const st0 = () => ({ lens: 'explain', unit: 'pts', k: '', t1: '', t2: '', venue: 1, dials: { A: {}, B: {} }, picks: null, fview: 'bars', sortKey: 'r', sortDir: -1, posG: 'G', club: '', brushed: null, refit: null, simState: 'idle', simResult: null });
  const probs = [], counts = {};
  for (const id of P.SECTIONS.filter(s => P.views[s])) {
    const ctx = { W: ans.data, ans, fo: null, foState: 'idle', club: null, clubState: 'idle', teaser: null, reason: null, pooledFallback: false, message: '', gateNote: '', st: st0() };
    if (id === 'sim' && fo && fo.ok) { ctx.fo = fo.data; ctx.foState = 'ok'; }
    if (id === 'losses' && club && club.ok) { ctx.st.club = tid; ctx.club = club.data; ctx.clubState = 'ok'; }
    if (id === 'leagues' && pooled && pooled.ok) ctx.pooled = pooled.data;
    if (id === 'mixes') { if (!(mix && mix.ok)) continue; ctx.mix = pg.sb.EpinoiaWinMix.decode(mix.data); ctx.mixState = 'ok'; }
    let v;
    try { v = P.views[id](ctx); } catch (e) { probs.push('#' + id + ' threw ' + e.message); continue; }
    counts[id] = v.charts.length;
    if (v.state !== 'ok') probs.push('#' + id + ' state ' + v.state);
    if (/NaN|undefined|\[object Object\]/.test(v.html)) probs.push('#' + id + ' NaN/undefined in the html');
    v.charts.forEach(c => probs.push(...svgProblems(VK, c, '#' + id)));
  }
  const nCharts = Object.values(counts).reduce((a, b) => a + b, 0);
  ok(tag + ': every section of the What wins page draws from what winfile.js gave it (' + Object.keys(counts).length + ' sections, ' + nCharts + ' charts at 760 and 360 px)',
     !probs.length && nCharts >= 10, probs.slice(0, 5).join(' | '));
  if (set.pooled && pooled.ok) {
    const v = P.views.answer({ W: pooled.data, ans: pooled, fo: null, foState: 'idle', club: null, clubState: 'idle', teaser: null, reason: null, pooledFallback: true, message: '', gateNote: '', st: st0() });
    ok(tag + ': the pooled file draws the answer as the fallback', v.state === 'ok' && !/NaN|undefined/.test(v.html));
  }
  const sl = P.statusLine(ans, ans.data, { now: Date.parse(ans.data.built) + 3600e3 });
  ok(tag + ': the status line reads the file and the function\'s pending', sl.line === 'Model of ' + ans.data.n.games + ' games · built 1 h ago · 3 new games since' && sl.canRecalc, sl.line);
  ok(tag + ': nothing reached localStorage on the page', !pg.log.some(l => l[0] === 'local' && l[1] === 'set'), JSON.stringify(pg.log.filter(l => l[0] === 'local')));

  /* the Front office, as t/index.html loads it */
  if (!(set.fo && set.club)) return;
  const fsrv = server(files);
  const fx = sandboxFor(['season.js', 'winstats.js', 'winsim.js', 'winfile.js', 'vizkit.js', 't/depth.js', 't/fomodel.js'], fsrv);
  const W2 = fx.sb.EpinoiaWinFile, F = fx.sb.EpinoiaFoModel, X = fx.sb.EpinoiaDepth, VK2 = fx.sb.EpinoiaVizKit;
  const [foA, clubA, posA] = await Promise.all([W2.get({ scope: 'fo', league: LIG, season: SEA }), W2.get({ scope: 'club', league: LIG, season: SEA, team: tid }),
    W2.get({ scope: 'pos', league: LIG, season: SEA, team: tid })]);
  ok(tag + ': the Front office gets fo, club and pos through winfile.js', foA.ok && clubA.ok && (!posFile || posA.ok), JSON.stringify([foA.reason, clubA.reason, posA.reason]));
  if (!(foA.ok && clubA.ok)) return;
  const others = foA.data.teams.filter(t => t.id !== tid);
  const fixtures = others.slice(0, 4).map((o, i) => ({ id: 'fx' + i, home_team_id: i % 2 ? o.id : tid, away_team_id: i % 2 ? tid : o.id, tipoff_at: '2026-10-1' + i + 'T18:00:00Z' }));
  const names = Object.fromEntries(foA.data.teams.map(t => [t.id, t.name || 'Club']));
  let vmv, html = '';
  try { vmv = F.view({ fo: foA.data, club: clubA.data, team: { id: tid, name: clubA.data.team.name || 'Club' }, fixtures, names }); html = F.panel(vmv, { signin: '../signin/' }); }
  catch (e) { vmv = { ok: false, reason: 'threw ' + e.message }; }
  ok(tag + ': fomodel draws the win model from them (verdict, ledger, needs, slots, squad, losses, next, what if)', vmv.ok && ['verdict', 'ledger', 'needs', 'slots', 'squad', 'losses', 'next', 'whatIf'].every(k => vmv[k] != null),
     vmv.reason || ['verdict', 'ledger', 'needs', 'slots', 'squad', 'losses', 'next', 'whatIf'].filter(k => vmv[k] == null).join());
  ok(tag + ': ...with no NaN or undefined in the panel', html.length > 500 && !/NaN|undefined|\[object Object\]/.test(html), (/.{0,60}(NaN|undefined|\[object Object\]).{0,60}/.exec(html) || [''])[0]);
  const fprobs = Object.entries(vmv.charts || {}).flatMap(([id, c]) => svgProblems(VK2, c, 'F3 ' + id));
  ok(tag + ': ...and every one of its charts builds at 760 and 360 px (' + Object.keys(vmv.charts || {}).length + ')', Object.keys(vmv.charts || {}).length >= 3 && !fprobs.length, fprobs.slice(0, 4).join(' | '));
  const gm = F.gmModel(foA.data, tid);
  ok(tag + ': the GM\'s view gets a wins-per-30 value for its measures', Object.keys(gm.wins).length >= 4 && Object.values(gm.wins).every(Number.isFinite));
  const pos = posA.ok ? posA.data : (clubA.data.pos || null);
  if (pos) {
    const roster = pos.players.map((p, i) => ({ id: p.id, name: 'P' + i, num: String(i), height: 190 + i }));
    const season = new Map(pos.players.map(p => [p.id, { mpg: p.min.reduce((a, b) => a + b, 0) / Math.max(1, pos.games), gp: pos.games, min: p.min.reduce((a, b) => a + b, 0) }]));
    const cs = X.slotChart({ pos, roster, season, recent: new Map(), starts: { season: new Map(), recent: new Map(), games: 0 } });
    ok(tag + ': the depth chart fills all five positions from the pos file (A.1)', cs && cs.source === 'stints' && cs.slots.length === 5 && cs.slots.every(s => s.players.length > 0),
       cs && cs.slots.map(s => s.key + ':' + s.players.length).join(' '));
  }
  ok(tag + ': nothing reached localStorage in the Front office', !fx.log.some(l => l[0] === 'local' && l[1] === 'set'));
  ok(tag + ': the Front office asked for 3 files and downloaded 3 (' + fsrv.reqs.length + ' requests, ' +
     Math.round([foA, clubA, posA].reduce((a, r) => a + (r.ok ? JSON.stringify(r.data).length : 0), 0) / 1024) + ' KB)', fsrv.reqs.length === (posFile ? 6 : 4));
}

const J = (...p) => { const f = path.join(...p); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
{
  const d = path.join(TESTS, 'fixtures', 'ww-page');
  await endToEnd('real ORLEN files (builder --local)', { wins: J(d, 'wins.json'), pooled: J(d, 'wins-all.json'), fo: J(d, 'fo.json'), club: J(d, 'club.json'), teaser: J(d, 'teaser.json'), mix: J(d, 'mix.json') });
  const e = path.join(TESTS, 'fixtures', 'ww');
  await endToEnd('synthetic builder fixtures (--fixtures)', { wins: J(e, 'wins.sample.json'), pooled: J(e, 'wins-all.sample.json'), fo: J(e, 'fo.sample.json'), club: J(e, 'club.sample.json'), teaser: J(e, 'teaser.sample.json'), mix: J(e, 'mix.sample.json') });
}
if (process.env.WW_LOCAL_DIR) {
  const d = path.resolve(process.env.WW_LOCAL_DIR);
  const leagues = fs.readdirSync(d).map(f => /^wins-(.+)\.json$/.exec(f)).filter(m => m && m[1] !== 'all').map(m => m[1]).sort();
  ok('WW_LOCAL_DIR: a builder --local folder with leagues (' + leagues.join(', ') + ')', leagues.length > 0);
  for (const lg of leagues) {
    await endToEnd('--local ' + lg, { wins: J(d, 'wins-' + lg + '.json'), pooled: J(d, 'wins-all.json'), fo: J(d, 'fo-' + lg + '.json'), club: J(d, 'club-' + lg + '.json'),
      pos: J(d, 'pos-' + lg + '.json'), teaser: J(d, 'teaser.json'), mix: J(d, 'mix-' + lg + '.json') });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
