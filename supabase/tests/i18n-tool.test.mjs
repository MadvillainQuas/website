/* ============================================================================
   tools/i18n.mjs, the commands that edit the language files, run against a
   throwaway copy of them: a scanner that miscounts one brace inside a regex
   would corrupt a dictionary that every Japanese or Spanish page loads.

       node supabase/tests/i18n-tool.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};

/* the copy: the tool, the engine, the two core dictionaries, and one page that names a pack */
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-tool-'));
fs.mkdirSync(path.join(T, 'tools'));
fs.mkdirSync(path.join(T, 'epinoia', 'i18n'), { recursive: true });
fs.mkdirSync(path.join(T, 'epinoia', 'game'));
fs.copyFileSync(path.join(ROOT, 'tools', 'i18n.mjs'), path.join(T, 'tools', 'i18n.mjs'));
fs.copyFileSync(path.join(ROOT, 'epinoia', 'i18n.js'), path.join(T, 'epinoia', 'i18n.js'));
for (const c of ['ja', 'es']) fs.copyFileSync(path.join(ROOT, 'epinoia', 'i18n', c + '.js'), path.join(T, 'epinoia', 'i18n', c + '.js'));
fs.writeFileSync(path.join(T, 'epinoia', 'game', 'index.html'),
  '<head><script src="../i18n.js?v=1" data-i18n-packs="game"></script></head>');

const run = (...args) => execFileSync(process.execPath, [path.join(T, 'tools', 'i18n.mjs'), ...args],
  { cwd: T, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const dict = (code, pack) => {
  const f = pack ? path.join(T, 'epinoia', 'i18n', code, pack + '.js') : path.join(T, 'epinoia', 'i18n', code + '.js');
  let d = null;
  vm.runInNewContext(fs.readFileSync(f, 'utf8'), { window: { EpinoiaI18n: { register: (c, x) => { if (c === code) d = x; } } } });
  return d;
};
const json = (name, v) => { const f = path.join(T, name); fs.writeFileSync(f, JSON.stringify(v)); return f; };
const patternsBefore = dict('es').patterns.length;

console.log('\nnew-pack');
run('new-pack', 'demo', 'game/');
ok('an empty pack file per language', !!dict('ja', 'demo') && !!dict('es', 'demo'));
ok('...and the page now asks for it', /data-i18n-packs="game demo"/.test(fs.readFileSync(path.join(T, 'epinoia', 'game', 'index.html'), 'utf8')));

console.log('\nadd');
run('add', json('a.json', [
  { pack: 'core', section: 'phrases', entries: { "it's a test": { ja: 'テストです', es: 'Es una prueba' }, fixtures: { ja: '日程', es: 'Partidos' } } },
  { pack: 'core', section: 'ctx.col', entries: { ZZC: { ja: 'Z列', es: 'Zc' } } },
  { pack: 'core', section: 'ctx.fresh', entries: { 'a new context': { ja: '新しい', es: 'Nuevo' } } },
  { pack: 'demo', section: 'units', entries: { widgets: { ja: '{n}個', es: '{n} widgets' } } }
]));
ok('a new phrase lands in both languages, apostrophe and all', dict('ja').phrases["it's a test"] === 'テストです' && dict('es').phrases["it's a test"] === 'Es una prueba');
ok('an existing phrase is replaced, not duplicated', dict('es').phrases.fixtures === 'Partidos');
run('add', json('case.json', { pack: 'core', section: 'phrases', entries: { FIXTURES: { ja: '日程・結果', es: 'Calendario' } } }));
ok('...whatever case the new entry is written in (the engine folds case, so must the tool)',
   dict('es').phrases.fixtures === 'Calendario' && !('FIXTURES' in dict('es').phrases));
ok('a context table gets its entry', dict('ja').ctx.col.ZZC === 'Z列');
ok('a context that did not exist is created', dict('es').ctx.fresh['a new context'] === 'Nuevo');
ok('a pack section that did not exist is created', dict('ja', 'demo').units.widgets === '{n}個');
/* (a RegExp from another vm realm is not instanceof this one's, so ask for .exec) */
ok('the hand-written patterns survive the edit', dict('es').patterns.length === patternsBefore &&
   dict('es').patterns.every(p => p[0] && typeof p[0].exec === 'function'));
let refused = false;
try { run('add', json('b.json', { pack: 'core', section: 'phrases', entries: { 'only one': { ja: 'ひとつ' } } })); } catch (_) { refused = true; }
ok('an entry missing a visible language is refused', refused && !('only one' in dict('ja').phrases));

console.log('\nremove');
run('remove', 'core', 'phrases', "it's a test");
ok('a phrase goes from every language', !("it's a test" in dict('ja').phrases) && !("it's a test" in dict('es').phrases));

console.log('\nnew-language, export, import, unhide');
run('new-language', 'fr', '--native', 'Français', '--short', 'FR', '--locale', 'fr-FR', '--decimal', ',');
const eng = () => { delete globalThis.__x; const src = fs.readFileSync(path.join(T, 'epinoia', 'i18n.js'), 'utf8');
  const m = { exports: {} }; vm.runInNewContext(src, { module: m, globalThis: {}, window: undefined }); return m.exports; };
ok('the registry gains the language, hidden', eng().LANGS.some(l => l.code === 'fr' && l.hidden === true));
ok('a core file with its settings', dict('fr').locale === 'fr-FR' && dict('fr').decimal === ',');
ok('...and every pack', !!dict('fr', 'demo'));
run('export', 'fr', '--out', path.join(T, 'fr.json'));
const w = JSON.parse(fs.readFileSync(path.join(T, 'fr.json'), 'utf8'));
ok('the worklist has every key with the references beside it', w.items.length > 500 && w.items.every(i => 'ja' in i && 'es' in i && 'fr' in i));
w.items.forEach(i => { if (i.en === 'fixtures' && i.section === 'phrases') i.fr = 'Calendrier'; if (i.en === 'widgets') i.fr = '{n} widgets'; });
fs.writeFileSync(path.join(T, 'fr.json'), JSON.stringify(w));
run('import', 'fr', path.join(T, 'fr.json'));
ok('a filled worklist is written into the files', dict('fr').phrases.fixtures === 'Calendrier' && dict('fr', 'demo').units.widgets === '{n} widgets');
ok('status reports what is still missing', /fr \(hidden\)\s+\d+\/\d+\s+missing/.test(run('status')));
let partialOk = true;
try { run('add', json('c.json', { pack: 'core', section: 'phrases', entries: { 'two only': { ja: '二', es: 'Dos' } } })); } catch (_) { partialOk = false; }
ok('a hidden language does not block adding a string to the others', partialOk);
run('unhide', 'fr');
ok('unhide puts it in the picker', eng().LANGS.some(l => l.code === 'fr' && !l.hidden));

fs.rmSync(T, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
