/* ============================================================================
   LANGUAGES (epinoia/i18n.js, epinoia/i18n/<code>.js, docs/i18n.md).

   What would go wrong quietly:
     1. the engine translating something it should not (a name, a number) or
        missing the context that changes a word ('PF' beside 'PA' is points for)
     2. a page with the rail that does not load i18n.js, or loads it after the
        page's own scripts, so its first paint is English
     3. the language row missing from the foot, or translated into nonsense
     4. a dictionary that drifts: a key in one language and not the other, an
        empty value, a one-letter phrase that would rewrite a monogram
     5. a translation that departs from what the leagues and media print

       node supabase/tests/i18n.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const EP = path.join(ROOT, 'epinoia');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const core = require(path.join(EP, 'i18n.js'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); }
};
const eq = (name, got, want) => ok(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

/* a dictionary file as the browser would run it: what it registered, for which code and pack */
function runDict(...p) {
  const src = read(...p);
  const got = [];
  vm.runInNewContext(src, { window: { EpinoiaI18n: { register: (c, d, pack) => got.push({ code: c, dict: d, pack: pack || null }) } } });
  return got;
}
function rawDict(code) {
  const r = runDict('epinoia', 'i18n', code + '.js').find(x => x.code === code && !x.pack);
  return r ? r.dict : null;
}
const PACK_DIR = code => path.join(EP, 'i18n', code);
/* every language in the registry is held to the same keys; a hidden one (still being built with
   tools/i18n.mjs new-language) only warns, so it can be committed half done */
const CODES = core.LANGS.filter(l => l.code !== 'en').map(l => l.code);
const HIDDEN = new Set(core.LANGS.filter(l => l.hidden).map(l => l.code));
let warned = 0;
const held = (code, name, cond, detail) => {
  if (!HIDDEN.has(code)) return ok(name, cond, detail);
  if (!cond) { warned++; console.log('  WARN  ' + name + '  (hidden language, still being built)' + (detail ? '\n          ' + detail : '')); }
};
const packNames = code => fs.existsSync(PACK_DIR(code))
  ? fs.readdirSync(PACK_DIR(code)).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort() : [];

/* ---- 1. the engine, on a dictionary of its own ------------------------------ */
console.log('\n1. the engine');
{
  const D = core.compile('es', {
    locale: 'es-ES',
    phrases: { fixtures: 'calendario', 'sign in': 'iniciar sesión', leagues: 'ligas', 'no games yet': 'aún no hay partidos' },
    ctx: { col: { PF: 'FP', PTS: 'PTS', or: 'RO' }, standings: { PF: 'PF', PA: 'PC' }, nav: { 'Table / Team Stats': 'Clasificación' } },
    units: { games: '{n} partidos', game: '{n} partido', pts: '{n} pts' },
    patterns: [[/^Q([1-4])$/, 'C$1'], [/^Leagues in (.+)$/, (m, T) => 'Ligas de ' + T(m[1])]]
  });
  const t = (s, c) => core.translateText(D, s, c || []);
  eq('a phrase', t('fixtures'), 'calendario');
  eq('the case it was written in: Title', t('Fixtures'), 'Calendario');
  eq('the case it was written in: UPPER', t('FIXTURES'), 'CALENDARIO');
  eq('whitespace around a text node is kept', t('  sign in\n'), '  iniciar sesión\n');
  eq('a trailing arrow is kept, the word translated', t('leagues ›'), 'ligas ›');
  eq('a trailing full stop likewise', t('No games yet.'), 'Aún no hay partidos.');
  eq('each side of a middle dot on its own', t('Fixtures · Epinoia'), 'Calendario · Epinoia');
  eq('a count and its unit', t('3 games'), '3 partidos');
  eq('...the singular too', t('1 game'), '1 partido');
  eq('a pattern', t('Q4'), 'C4');
  eq('a pattern that translates what it captured', t('Leagues in Spain'), 'Ligas de Spain');
  eq('a name is left alone', t('London Lions'), null);
  eq('a number is left alone', t('84–73'), null);
  eq('Japanese or anything without a Latin letter is never looked up', t('リバウンド'), null);
  eq('an abbreviation outside its context is left alone', t('PF'), null);
  eq('PF in a box-score header is a personal foul', t('PF', ['col']), 'FP');
  eq('PF beside PA is points for', t('PF', ['standings', 'col']), 'PF');
  eq('an acronym stays an acronym when the source was lower case', t('or', ['col']), 'RO');
  eq('a no-break space matches a plain one', t('Table / Team Stats', ['nav']), 'Clasificación');

  const J = core.compile('ja', { caseless: true, phrases: { fixtures: '日程', 'no games yet': 'まだ試合がありません' } });
  eq('Japanese takes no case', core.translateText(J, 'FIXTURES', []), '日程');
  eq('Japanese ends a sentence in its own full stop', core.translateText(J, 'No games yet.', []), 'まだ試合がありません。');

  /* generated prose: a paragraph is translated sentence by sentence */
  const R = core.compile('es', {
    locale: 'es-ES', decimal: ',', sentences: ['report'],
    ctxPatterns: { report: [[/^(.+?) scored (\d+)\.$/, '$1 anotó $2.'], [/^It was close\.$/, 'Fue igualado.']] }
  });
  eq('each sentence of a paragraph on its own', core.translateText(R, 'Ada Shaw scored 21. It was close.', ['report']),
     'Ada Shaw anotó 21. Fue igualado.');
  eq('an initial is not the end of a sentence', core.translateText(R, 'J. Anderson scored 12.', ['report']), 'J. Anderson anotó 12.');
  eq('a decimal before a full stop still takes the comma', core.translateText(R, 'It averaged 0.70.', ['report']), 'It averaged 0,70.');
  eq('context patterns stay in their context', core.translateText(R, 'Ada Shaw scored 21.', []), null);
  eq('a version number keeps its point in Spanish (iOS 16.4)', core.translateText(R, 'iOS 16.4', []), null);
  eq('the HTML source\'s line breaks inside a text node do not stop a sentence matching',
     core.translateText(R, '\n   Ada Shaw\n      scored 21.\n  ', ['report']), '\n   Ada Shaw anotó 21.\n  ');
  eq('...a "v1.2" too', core.translateText(R, 'v1.2', []), null);

  eq('a toLocale call asking for English gets the chosen locale', core.swapLocale('en-GB', 'ja-JP'), 'ja-JP');
  eq('...and so does one asking for nothing', core.swapLocale(undefined, 'es-ES'), 'es-ES');
  eq('an explicit other locale is respected', core.swapLocale('de-DE', 'ja-JP'), 'de-DE');
  eq('?lang= wins over the stored choice', core.pick('ja', 'es'), 'ja');
  eq('an unknown language falls back to the stored one', core.pick('xx', 'es'), 'es');
  eq('...and then to English', core.pick(null, null), 'en');
}

/* ---- 2. every page with the rail loads the engine, early ------------------------ */
console.log('\n2. every page with the rail loads i18n.js in its head');
{
  const pages = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name === 'index.html') pages.push(p);
  });
  walk(EP);
  let withRail = 0;
  const named = new Set();
  for (const p of pages) {
    const html = fs.readFileSync(p, 'utf8');
    const rel = path.relative(EP, p).replace(/\\/g, '/');
    if (/^(vendor|android\/app|ios\/)/.test(rel) && !/i18n\.js/.test(html)) continue;
    /* a redirect with no words of its own, which home-links.test.mjs keeps script-free */
    if (rel === 'countries/index.html') continue;
    if (/<script\s+src="[./]*nav\.js/.test(html)) withRail++;
    const tag = /<script src="[./]*i18n\.js(?:\?v=\d+)?"(?: data-i18n-packs="([a-z ]*)")?><\/script>/.exec(html);
    const i18n = tag ? tag.index : -1;
    const head = html.indexOf('</head>');
    const firstDefer = html.search(/<script[^>]+\bdefer\b/);
    const appmode = html.search(/<script src="[./]*appmode\.js/);
    ok(rel + ' loads i18n.js synchronously in <head>', i18n > 0 && i18n < head && (firstDefer < 0 || i18n < firstDefer));
    if (appmode > 0) ok(rel + ' ...after appmode.js', i18n > appmode);
    if (tag && tag[1]) tag[1].split(' ').filter(Boolean).forEach(n => named.add(n + ' (' + rel + ')'));
  }
  ok('the rail is on at least thirty pages, and each was checked', withRail >= 30, withRail + ' pages');
  for (const code of CODES) {
    const have = packNames(code);
    const missing = [...named].filter(n => have.indexOf(n.split(' ')[0]) < 0);
    held(code, code + ': every pack a page asks for exists', !missing.length, missing.join(' | '));
  }
}

/* ---- 3. the language row --------------------------------------------------------- */
console.log('\n3. the language row: the bottom of the foot');
{
  const nav = read('epinoia', 'nav.js');
  const css = read('epinoia', 'kit', 'nav.css');
  const i18n = read('epinoia', 'i18n.js');
  ok('it is appended to the foot, after contact',
     nav.indexOf('navFoot.appendChild(contact);') > 0 &&
     nav.indexOf('navFoot.appendChild(langRow);') > nav.indexOf('navFoot.appendChild(contact);'));
  ok('one button per language, each written in itself and tagged with its language',
     /I18N\.LANGS\.filter\(l => !l\.hidden \|\| l\.code === I18N\.lang\)\.forEach\(l => \{/.test(nav) &&
     /b\.lang = l\.code;/.test(nav) && /b\.title = l\.native;/.test(nav));
  ok('a language still being built is not offered in the picker', /!l\.hidden/.test(nav));
  ok('the row itself is never translated', /langRow\.setAttribute\('translate', 'no'\);/.test(nav));
  ok('pressing one keeps the choice and reloads, through i18n.js', /I18N\.set\(l\.code\)/.test(nav) &&
     /localStorage\.setItem\(STORE, code\)/.test(i18n));
  ok('the pressed state is announced', /aria-pressed/.test(nav));
  ok('league and club names in the rail are marked as names', /inner\.setAttribute\('translate', 'no'\);/.test(nav));
  ok('the row has its own styles, in the phone sheet too',
     /\.ep-nav \.lang-row\{/.test(css) && /\.ep-nav\.drawer-open \.lang-row button\.lang\{/.test(css));
  ok('the Japanese button is set in a Japanese face on every page', /button\.lang:lang\(ja\)\{/.test(css));
  ok('English, Japanese and Spanish lead the registry', core.LANGS.slice(0, 3).map(l => l.code).join() === 'en,ja,es');
  ok('every language says its code, its own name, a short label and a locale',
     core.LANGS.every(l => /^[a-z]{2,3}$/.test(l.code) && l.native && l.short && /^[a-z]{2,3}-[A-Z]{2}$/.test(l.locale)));
  ok('English fetches nothing', i18n.indexOf("if (lang === 'en') return;") > 0 &&
     i18n.indexOf("if (lang === 'en') return;") < i18n.indexOf("createElement('script')"));
  ok('a dictionary that never arrives leaves English on screen, not a blank page',
     /const failsafe = G\.setTimeout/.test(i18n) && /s\.onerror = \(\) => \{[^}]*reveal\(\)/.test(i18n));
  ok('Japanese text gets a Japanese face behind the pixel fonts', /:root:lang\(ja\)\{/.test(i18n) && /Noto Sans JP/.test(i18n));
  ok('alert, confirm and prompt are translated in the dialog context (they never reach the DOM)',
     /\['alert', 'confirm', 'prompt'\]\.forEach/.test(i18n) && /translateText\(D, msg, \['dialog'\]/.test(i18n) &&
     i18n.indexOf('patchDialogs();') < i18n.indexOf("createElement('script')"));
  ok('a page names its packs on the script tag, and each is fetched beside the core',
     /data-i18n-packs/.test(i18n) && /load\('i18n\/' \+ lang \+ '\/' \+ p \+ '\.js', p\)/.test(i18n));
}

/* ---- 4. the dictionaries agree with each other ------------------------------------ */
console.log('\n4. the dictionaries');
const DICTS = {};
for (const l of core.LANGS) {
  if (l.code === 'en') continue;
  const d = rawDict(l.code);
  ok('i18n/' + l.code + '.js registers ' + l.code, !!d);
  DICTS[l.code] = d;
}
{
  const keys = t => Object.keys(t || {}).map(core.norm);
  const sectionsOf = ds => ['phrases', 'units'].concat([...new Set(ds.flatMap(d => Object.keys((d && d.ctx) || {})))].map(c => 'ctx.' + c));
  const sec = (d, s) => !d ? {} : s === 'phrases' ? d.phrases : s === 'units' ? d.units : (d.ctx || {})[s.slice(4)];
  /* the same English in every language: each is compared with the union of all of them */
  const parity = (label, byCode) => {
    const ds = Object.values(byCode);
    for (const s of sectionsOf(ds)) {
      const union = new Set(ds.flatMap(d => keys(sec(d, s))));
      for (const [code, d] of Object.entries(byCode)) {
        const have = new Set(keys(sec(d, s)));
        const lack = [...union].filter(k => !have.has(k));
        held(code, label + ' ' + s + ': ' + code + ' has every key', !lack.length, lack.slice(0, 10).join(' | '));
      }
    }
  };
  parity('core', DICTS);
  for (const [code, d] of Object.entries(DICTS)) {
    if (!d) continue;
    const all = [['phrases', d.phrases]].concat(Object.entries(d.ctx || {}).map(([c, t]) => ['ctx.' + c, t]));
    const empty = [];
    all.forEach(([n, t]) => Object.entries(t || {}).forEach(([k, v]) => {
      if (typeof v !== 'string' || !v.trim()) empty.push(n + ':' + k);
    }));
    held(code, code + ': no empty translation', !empty.length, empty.slice(0, 10).join(' | '));
    const tiny = Object.keys(d.phrases || {}).filter(k => k.replace(/[^A-Za-z]/g, '').length < 2);
    held(code, code + ': no one-letter phrase outside a context (it would rewrite a monogram or a W/L)',
       !tiny.length, tiny.join(' | '));
    const units = Object.entries(d.units || {}).filter(([, v]) => v.indexOf('{n}') < 0);
    held(code, code + ': every unit says where the number goes', !units.length, units.map(u => u[0]).join(' | '));
    const dup = Object.keys(d.phrases || {}).map(core.fold).filter((k, i, a) => a.indexOf(k) !== i);
    held(code, code + ': no phrase listed twice', !dup.length, dup.join(' | '));
  }

  /* the packs: every language, registered under its own name, the same English in all of them,
     and never a phrase the core file already has (one place for every string) */
  const names = new Set(CODES.flatMap(packNames));
  for (const name of names) {
    const got = {};
    for (const code of CODES) {
      const f = path.join('epinoia', 'i18n', code, name + '.js');
      if (!fs.existsSync(path.join(ROOT, f))) { held(code, f + ' exists', false); continue; }
      const regs = runDict(...f.split(path.sep));
      const r = regs.find(x => x.code === code && x.pack === name);
      held(code, f + ' registers ' + code + ' as the pack "' + name + '"', !!r && regs.length === 1,
         regs.map(x => x.code + '/' + x.pack).join(', '));
      if (r) got[code] = r.dict;
    }
    parity(name, got);
    for (const [code, d] of Object.entries(got)) {
      const ck = new Set(Object.keys((DICTS[code] || {}).phrases || {}).map(core.fold));
      const again = Object.keys(d.phrases || {}).filter(k => ck.has(core.fold(k)));
      held(code, name + ' (' + code + ') repeats no core phrase', !again.length, again.slice(0, 10).join(' | '));
      const bad = [];
      Object.entries(d.phrases || {}).forEach(([k, v]) => { if (typeof v !== 'string' || !v.trim()) bad.push(k); });
      held(code, name + ' (' + code + ') has no empty translation', !bad.length, bad.slice(0, 10).join(' | '));
      const cp = d.ctxPatterns || {};
      const badP = Object.entries(cp).filter(([, l]) => !Array.isArray(l) || l.some(p => !(p[0] && p[0].constructor && p[0].constructor.name === 'RegExp')));
      held(code, name + ' (' + code + ') context patterns are [RegExp, replacement] pairs', !badP.length, badP.map(x => x[0]).join(', '));
    }
  }
}

/* EPINOIA presents its words as its own: the shipped files name no other site. The sources
   behind each choice are in docs/i18n.md, which is not a page. */
{
  const shipped = ['epinoia/i18n.js']
    .concat(CODES.map(c => 'epinoia/i18n/' + c + '.js'))
    .concat(CODES.flatMap(c => packNames(c).map(n => 'epinoia/i18n/' + c + '/' + n + '.js')))
    .map(p => [p, read(...p.split('/'))]);
  for (const [p, src] of shipped) {
    const named = src.match(/bleague\.jp|acb\.com|feb\.es|basketballking|gigantes|espn|kenpom|basketball-reference/gi);
    ok(p + ' names no other site', !named, named && named.join(', '));
  }
}

/* ---- 5. the rail and the phone bar are translated whole -------------------------- */
console.log('\n5. every label the rail and the phone bar draw has a translation');
{
  const nav = read('epinoia', 'nav.js');
  const labels = new Set();
  for (const m of nav.matchAll(/\btx:\s*'([^']+)'/g)) labels.add(m[1].replace(/\\xa0/g, ' '));
  for (const m of nav.matchAll(/\{ label: '([^']+)'/g)) labels.add(m[1]);
  for (const m of nav.matchAll(/el\('span', 'tx', '([^']+)'\)/g)) labels.add(m[1]);
  ['menu', 'close'].forEach(s => labels.add(s));
  labels.delete('EPINOIΛ');
  for (const [code, d] of Object.entries(DICTS)) {
    if (!d) continue;
    const D = core.compile(code, d);
    const miss = [...labels].filter(s => core.translateText(D, s, ['tab', 'nav']) == null &&
                                         core.translateText(D, s, ['nav']) == null);
    held(code, code + ': all ' + labels.size + ' rail and tab-bar labels', !miss.length, miss.join(' | '));
  }
}

/* ---- 6. what the leagues and their media print (docs/i18n.md has the sources) ---- */
console.log('\n6. the words the leagues use: B.LEAGUE for Japanese, ACB and FEB for Spanish');
if (DICTS.ja && DICTS.es) {
  const JA = core.compile('ja', DICTS.ja), ES = core.compile('es', DICTS.es);
  const t = (D, s, c) => core.translateText(D, s, c || []);
  const box = ['col'], table = ['standings', 'col'];

  /* B.LEAGUE's box score keeps Latin letters, its own ones */
  eq('ja box: REB is TR', t(JA, 'REB', box), 'TR');
  eq('ja box: AST is AS', t(JA, 'AST', box), 'AS');
  eq('ja box: STL is ST', t(JA, 'STL', box), 'ST');
  eq('ja box: BLK is BS', t(JA, 'BLK', box), 'BS');
  eq('ja box: PF is F', t(JA, 'PF', box), 'F');
  eq('ja box: the lower-case box score header too', t(JA, 'pf', box), 'F');
  eq('ja: ORTG is OFFRTG, as the glossary writes it', t(JA, 'ORTG', box), 'OFFRTG');
  eq('ja: an advanced stat stays in Latin', t(JA, 'TS%', box), 'TS%');
  eq('ja standings: クラブ, not チーム', t(JA, 'TEAM', table), 'クラブ');
  eq('ja standings: PF is 得点', t(JA, 'PF', table), '得点');
  eq('ja standings: PA is 失点', t(JA, 'PA', table), '失点');
  eq('ja standings: W is 勝', t(JA, 'W', table), '勝');
  eq('ja standings: L is 負', t(JA, 'L', table), '負');
  eq('ja: a streak reads 3連勝', t(JA, 'W3'), '3連勝');
  eq('ja: periods are 1Q-4Q', t(JA, 'q1', box), '1Q');
  eq('ja: overtime OT1', t(JA, 'ot1', box), 'OT1');
  eq('ja: the live text marks a make with ○', t(JA, 'three-pointer made'), '3Pシュート○');
  eq('ja: a count reads 24得点', t(JA, '24 pts'), '24得点');
  eq('ja: the rail\'s home is the front page (トップ)', t(JA, 'home', ['nav']), 'トップ');
  eq('ja: anywhere else home is the home side (ホーム)', t(JA, 'Home'), 'ホーム');
  eq('ja: a decimal keeps its point', t(JA, '45.5%'), null);
  eq('ja: "top 3" of the podium is the top three', t(JA, 'top 3'), 'トップ3');
  eq('ja: ...and a shot zone is the top-of-the-key three', t(JA, 'top 3', ['zone']), 'トップ3P');

  /* ACB's box score and FEB's standings */
  eq('es box: REB is RT', t(ES, 'REB', box), 'RT');
  eq('es box: AST is AS', t(ES, 'AST', box), 'AS');
  eq('es box: STL is REC', t(ES, 'STL', box), 'REC');
  eq('es box: BLK is TAP', t(ES, 'BLK', box), 'TAP');
  eq('es box: TO is PÉR', t(ES, 'TO', box), 'PÉR');
  eq('es box: PF is FP, never PF', t(ES, 'PF', box), 'FP');
  eq('es box: FT is TL', t(ES, 'FT', box), 'TL');
  eq('es box: 3PT is T3', t(ES, '3PT', box), 'T3');
  eq('es standings: GP is PJ', t(ES, 'GP', table), 'PJ');
  eq('es standings: W is PG', t(ES, 'W', table), 'PG');
  eq('es standings: L is PP', t(ES, 'L', table), 'PP');
  eq('es standings: PF stays PF (puntos a favor)', t(ES, 'PF', table), 'PF');
  eq('es standings: PA is PC', t(ES, 'PA', table), 'PC');
  eq('es standings: league points are PT', t(ES, 'PTS', table), 'PT');
  eq('es: periods are 1C-4C', t(ES, 'Q4', box), '4C');
  eq('es: overtime is PR', t(ES, 'ot2', box), 'PR2');
  eq('es: the live text, in the case the page writes it', t(ES, 'three-pointer made'), 'triple anotado');
  eq('es: ...and capitalised where the page capitalises', t(ES, 'Three-pointer made'), 'Triple anotado');
  eq('es: a decimal comma, as ACB\'s tables', t(ES, '45.5%'), '45,5%');
  eq('es: ...in a label too', t(ES, '+23.6 BPM'), '+23,6 BPM');
  eq('es: a version number is not a decimal', t(ES, '1.0.0'), null);
  eq('es: nor a clock\'s tenths', t(ES, '0:05.4'), null);
  eq('es: a card line in ACB\'s short labels', t(ES, '23.3p 6.3r 4a'), '23,3 Pts 6,3 Rt 4 As');
  eq('es: "v" between two clubs is vs', t(ES, 'v'), 'vs');
  eq('es: a crest\'s monogram V is not', t(ES, 'V'), null);
}

/* A Spanish page shows prices as 4,99, so a Spanish admin types them that way: the parser
   that turns a plan's price into pennies must read a decimal comma (it once made 4,99 £499). */
{
  const src = read('epinoia', 'admin', 'access-ui.js');
  const body = src.slice(src.indexOf('function toPennies'), src.indexOf('const PRICE_ID'));
  const toPennies = new Function(body + '; return toPennies;')();
  eq('a price with a decimal point', toPennies('4.99'), 499);
  eq('a price with a decimal comma', toPennies('4,99'), 499);
  eq('a comma before three digits is still a thousands separator', toPennies('1,000'), 100000);
  eq('...and European thousands with a decimal comma', toPennies('1.000,50'), 100050);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (warned ? ', ' + warned + ' warnings for hidden languages' : ''));
process.exit(fail ? 1 : 0);
