/* ============================================================================
   THE WHAT WINS PAGE (epinoia/winning/; docs/what-wins-model.md §11, §16 WP4, addendum A.2), with no browser.

     node supabase/tests/ww-page.test.mjs
     WW_PAGE_FILES=<dir> node supabase/tests/ww-page.test.mjs     also draws every section from the files in <dir>
                                                                  (wins.json, wins-all.json, fo.json, club.json,
                                                                  teaser.json), e.g. the builder's --local output

   What is held here:
     * the page: the existing CSP kept, no inline script, no on*= handler, no inline style; the page standard's frame
       and head; the twelve static sections in order, each with its id, title and note (the first </div> of each
       .sec-h closes after the note); the sheets and scripts in §11's order, i18n.js with the analysis pack,
       teamcolour.js, nav.js last;
     * the words: the analysis pack's es and ja carry the same keys, repeat no core phrase, and translate every
       static line on the page and every card template;
     * page.js reads only EpinoiaWinFile plus the leagues and seasons rows: it names none of I1's five tables, never
       calls localStorage.setItem, removes the legacy epinoia_winning_v1 key, and builds the Worker's URL from its
       own ?v=;
     * each section draws from fixtures/ww-page/*.json (league, pooled, fo, club, teaser), every chart well-formed
       through the chart kit; a locked answer draws the placeholders and no numbers; the public preview words the
       teaser only;
     * the status line (A.2): "Model of N games · built 2 h ago · 12 new games since", RECALCULATE on only with
       games pending and a league's own file, "up to date" otherwise;
     * the fo file's profiles go through the simulator and the wins file's blocks through the Worker's re-fit, as
       the page sends them.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const EP = path.join(ROOT, 'epinoia');
const FIX = path.join(ROOT, 'supabase/tests/fixtures/ww-page');
const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra && !cond ? '  -> ' + extra : ''}`); };

const HTML = read(EP, 'winning/index.html');
const PAGE = read(EP, 'winning/page.js');

/* ------------------------------------------------------------------ the page --- */
console.log('\nthe page');
{
  const csp = /<meta http-equiv="Content-Security-Policy"\s+content="([^"]+)">/.exec(HTML);
  ok('the CSP is kept: self scripts only, no unsafe-eval, Supabase for connect', !!csp && /script-src 'self'(;|$)/.test(csp[1]) && !/unsafe-eval/.test(csp[1]) &&
     /connect-src 'self' https:\/\/\*\.supabase\.co wss:\/\/\*\.supabase\.co/.test(csp[1]) && /default-src 'self'/.test(csp[1]));
  const scripts = [...HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  ok('no inline script: every <script> has a src and an empty body', scripts.length > 0 && scripts.every(m => /\bsrc="/.test(m[1]) && !m[2].trim()));
  ok('no on*= handler anywhere', !/\son[a-z]+\s*=/i.test(HTML.replace(/<!--[\s\S]*?-->/g, '')));
  ok('no inline style: no <style> and no style= attribute', !/<style\b/i.test(HTML) && !/\sstyle\s*=/i.test(HTML));
  ok('the frame carries data-std (nav.js adds the line, the keys, ON THIS PAGE and SKIP)', /<div class="ep-frame ww" id="ww" data-std>/.test(HTML));
  ok('the head: header.hero.pg-head with .pg-kick#wwKick, the one h1 and the .pg-sub of §11',
     /<header class="hero pg-head">\s*<p class="pg-kick" id="wwKick">[^<]*<\/p>\s*<h1>What wins<\/h1>\s*<p class="pg-sub">Which parts of the game turn into wins, what each is worth, and what a squad needs to win more\.<\/p>\s*<\/header>/.test(HTML) &&
     (HTML.match(/<h1\b/g) || []).length === 1);
  ok('the meta, canonical and title are kept', /<title>What wins · Epinoia<\/title>/.test(HTML) && /rel="canonical" href="https:\/\/prophesyscouting\.co\.uk\/epinoia\/winning\/"/.test(HTML) &&
     /name="description"/.test(HTML) && /rel="manifest"/.test(HTML));
}

const TABLE = [
  ['answer', 'The short answer', 'What decided these games, in plain numbers'],
  ['value', 'What each factor is worth', 'Points of margin and wins for one step better, with a 95% range'],
  ['factors', 'Every measure', 'Each measure against the result, with how sure we can be'],
  ['curves', 'Where the line is', 'The chance of winning across each gap, and the break-even point'],
  ['tempo', 'Pace and possession', 'Whether playing fast or holding the ball changes who wins'],
  ['positions', 'By position', 'What guards, wings and bigs add, and what winners get from each'],
  ['squad', 'Building a squad', 'Roster shapes and lineup mixes that go with winning'],
  ['mixes', 'Lineup mixes', 'Set your own lineup conditions and see how those fives did'],
  ['sim', 'Simulate a game', 'Pick two sides, move the dials, and see the odds change'],
  ['losses', 'Why games are lost', 'Each defeat split into shooting, turnovers, boards and the rest'],
  ['leagues', 'League by league', 'Each league’s answer, leaning on the rest where games are few'],
  ['model', 'How good is the model', 'Forecasts checked against games the model had not seen'],
  ['method', 'How it is worked out', 'Definitions, sample sizes and what the numbers cannot say']
];
console.log('\nthe thirteen sections (A.3 added Lineup mixes)');
{
  const secs = [...HTML.matchAll(/<section class="sec" id="([^"]+)" aria-labelledby="([^"]+)">\s*<div class="sec-h"><h2 id="([^"]+)">([^<]+)<\/h2>\s*<p class="note">([^<]+)<\/p><\/div>/g)];
  ok('thirteen static sections, in §11\'s order (+ A.3\'s Lineup mixes after Building a squad)', secs.length === 13 && secs.map(m => m[1]).join() === TABLE.map(t => t[0]).join(), secs.map(m => m[1]).join());
  ok('every section is labelled by its own h2 (id + "H")', secs.every(m => m[2] === m[1] + 'H' && m[3] === m[1] + 'H'));
  TABLE.forEach(([id, title, note]) => {
    const m = secs.find(x => x[1] === id);
    ok(id + ': "' + title + '" with its note, the .sec-h closing after the note', !!m && m[4] === title && m[5] === note);
  });
  ok('no section count matches anything but the thirteen', (HTML.match(/<section\b/g) || []).length === 13);
  ok('titles are never numbered', TABLE.every(t => !/^\s*\d/.test(t[1])) && !/class="idx"/.test(HTML));
  ok('every note is sentence case, no full stop, 70 characters or fewer', TABLE.every(t => /^[A-Z]/.test(t[2]) && !/\.$/.test(t[2]) && t[2].length <= 70));
}

console.log('\nthe sheets and scripts');
{
  const sheets = [...HTML.matchAll(/<link rel="stylesheet" href="\.\.\/kit\/([\w-]+)\.css\?v=\d+">/g)].map(m => m[1]);
  ok('sheets in §11\'s order: kit, nav, access, page, vizkit, winning, sectitle, teletext, legibility (last)',
     sheets.join() === 'epinoia-kit,nav,access,page,vizkit,winning,sectitle,teletext,legibility', sheets.join());
  const heads = [...HTML.split('</head>')[0].matchAll(/<script src="\.\.\/([\w-]+)\.js\?v=\d+"([^>]*)><\/script>/g)];
  ok('the head: appmode.js, i18n.js with data-i18n-packs="analysis", glyphs.js deferred', heads.length === 3 && heads[0][1] === 'appmode' && heads[1][1] === 'i18n' &&
     /data-i18n-packs="analysis"/.test(heads[1][2]) && heads[2][1] === 'glyphs' && /\bdefer\b/.test(heads[2][2]));
  const body = [...HTML.split('</head>')[1].matchAll(/<script src="([^"?]+)\?v=\d+"([^>]*)><\/script>/g)];
  const order = body.map(m => m[1].replace(/^\.\.\//, '').replace(/\.js$/, ''));
  ok('the scripts, deferred, in order: config, access, memlock, data, teamcolour, winning, winstats, winsim, winfile, vizkit, xscroll, winmix, page, nav',
     order.join() === 'config,access,memlock,data,teamcolour,winning,winstats,winsim,winfile,vizkit,xscroll,winmix,page,nav' && body.every(m => /\bdefer\b/.test(m[2])), order.join());
  ok('nav.js is the last script; teamcolour.js comes before the page\'s own', order[order.length - 1] === 'nav' && order.indexOf('teamcolour') < order.indexOf('page'));
  ok('one stamp on every asset', new Set([...HTML.matchAll(/\?v=(\d+)/g)].map(m => m[1])).size === 1);
  ok('every script and sheet named exists', body.every(m => fs.existsSync(path.join(EP, 'winning', m[1]))) && sheets.every(s => fs.existsSync(path.join(EP, 'kit', s + '.css'))));
  ok('kit/winning.css carries no copy of page.css / sectitle.css rules (no .pg-head, .sec-h h2, .pg-empty)',
     !/(^|[\s,}])\.(pg-head|pg-empty|pg-kick|pg-sub)\s*[{,]/.test(read(EP, 'kit/winning.css')) && !/\.sec-h\s+h2\s*\{/.test(read(EP, 'kit/winning.css')));
  ok('the pixel face never tracks wider than .2em in the new sheets', ['winning', 'vizkit'].every(s => [...read(EP, 'kit/' + s + '.css').matchAll(/letter-spacing:\s*([\d.]+)em/g)].every(m => +m[1] <= 0.2)));
}

/* ------------------------------------------------------------------ page.js, read --- */
console.log('\npage.js: what it reads and keeps');
{
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const I1 = ['game_events', 'game_features', 'player_game_stats', 'lineup_stints', 'team_game_stats'];
  ok('names none of I1\'s five tables', I1.every(t => !PAGE.includes(t)), I1.filter(t => PAGE.includes(t)).join());
  ok('never localStorage.setItem (nor sessionStorage: the loader caches)', !/localStorage\s*\.\s*setItem|sessionStorage\s*\.\s*setItem|\blocalStorage\s*\[/.test(code));
  ok('removes the legacy epinoia_winning_v1 key first thing in boot()', /const LEGACY = 'epinoia_winning_v1'/.test(PAGE) && /function boot\(\) \{[^]*?localStorage\.removeItem\(LEGACY\)/.test(code) &&
     code.indexOf('localStorage.removeItem(LEGACY)') < code.indexOf('new root.Worker'));
  const gets = [...code.matchAll(/D\(\)\.get\('([a-z_]+)\?/g)].map(m => m[1]);
  ok('its only table reads are leagues and seasons rows', gets.length >= 2 && gets.every(t => t === 'leagues' || t === 'seasons'), gets.join());
  ok('the league row is read whole and passed to EpinoiaTeamColour.league with keepAccent', /leagues\?slug=eq\.' \+ encodeURIComponent\(league\.slug\) \+ '&select=\*'/.test(code) &&
     /EpinoiaTeamColour\.league\(row, \{ keepAccent: !!\(row\.theme && row\.theme\.accent\) \}\)/.test(code));
  ok('files come through EpinoiaWinFile get() and refresh() only (no fetch, no XHR)', /WF\(\)\.get\(/.test(code) && /WF\(\)\.refresh\(/.test(code) && !/\bfetch\(|XMLHttpRequest/.test(code));
  ok('the Worker is built from this script\'s own ?v=', /new root\.Worker\('\.\.\/winsim\.worker\.js\?v=' \+ myV\)/.test(code) && /winning\\\/page\\\.js/.test(code));
  ok('...and without a Worker the same op runs on the main thread, n / 5, in idle slices', /a\.n = Math\.max\(200, Math\.round\(a\.n \/ 5\)\)/.test(code) && /requestIdleCallback/.test(code) && /Sim\(\)\.drive\(Sim\(\)\.steps\(op, a\)/.test(code));
  ok('a cancel reaches the Worker as {id, op: \'cancel\'}', /postMessage\(\{ id, op: 'cancel' \}\)/.test(code));
  ok('memlock placeholders for a refused reader: EpinoiaMemLock.placeholder({rows, what: \'What wins model\', leagueSlug})', /M\.placeholder\(\{ rows, what: 'What wins model', leagueSlug: /.test(code));
  const inner = [...code.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map(m => m[1].trim());
  ok('innerHTML only takes a view\'s escaped html or a fixed literal (names and messages go in by textContent)', inner.length > 0 &&
     inner.every(r => r === 'out.html' || (/^'/.test(r) && !/\+\s*(?!esc\()[a-zA-Z]/.test(r))), inner.join(' | '));
  ok('the address keeps l, s, lens, k, t1 and t2', ['l', 's', 'lens', 'k', 't1', 't2'].every(k => new RegExp("set\\('" + k + "'").test(code)));
  ok('the fo file is asked for only when #sim comes into view (or its button is pressed)', /IntersectionObserver/.test(code) && /simObs\.observe\(\$\('sim'\)\)/.test(code) && /scope: 'fo'/.test(code));
  ok('RECALCULATE refreshes the unit under the season the page READ it with (no season: the current one), so the cache keeps one entry (PERF2-1)',
     /WF\(\)\.refresh\(\{ league: W\.league\.id, season: seasonId \|\| undefined \}/.test(code) && /season: seasonId \|\| undefined \} : \{ scope: 'wins' \}/.test(code));
  ok('RECALCULATE: refresh() with the signal and onProgress; Cancel aborts', /WF\(\)\.refresh\(\{ league: W\.league\.id[^)]*\}, \{ signal: ab\.signal, onProgress:/.test(code) && /recalcAbort\.abort\(\)/.test(code));
}
console.log('\nthe status line and the bar (A.2), in the page');
{
  ok('a status line that is a live region, and RECALCULATE described by it', /<p class="ww-line" id="wwLine" aria-live="polite">/.test(HTML) && /id="wwRecalc" disabled aria-describedby="wwLine"/.test(HTML));
  ok('a real progressbar with the five stages: checking, updating the model, downloading, re-simulating, drawing',
     /role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"/.test(HTML) &&
     ['check', 'update', 'download', 'sim', 'draw'].every(s => HTML.includes('data-stage="' + s + '"')));
  ok('a Cancel button and a status message line', /id="wwCancel"/.test(HTML) && /id="wwMsg" role="status" aria-live="polite"/.test(HTML));
  const css = read(EP, 'kit/winning.css');
  ok('the bar respects reduced motion and forced colours', /prefers-reduced-motion:\s*reduce/.test(css) && /forced-colors:\s*active/.test(css));
}

/* ------------------------------------------------------------------ the words --- */
console.log('\nthe analysis pack');
const i18n = require(path.join(EP, 'i18n.js'));
const runDict = file => { const got = []; vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: { EpinoiaI18n: { register: (c, d, p) => got.push({ c, d, p }) } } }); return got; };
const PACK = {}, CORE = {};
for (const code of ['es', 'ja']) {
  const r = runDict(path.join(EP, 'i18n', code, 'analysis.js'));
  PACK[code] = r.length === 1 && r[0].c === code && r[0].p === 'analysis' ? r[0].d : null;
  CORE[code] = runDict(path.join(EP, 'i18n', code + '.js')).find(x => x.c === code && !x.p).d;
}
{
  ok('es and ja each register one "analysis" pack', !!PACK.es && !!PACK.ja);
  const ke = Object.keys(PACK.es.phrases).sort(), kj = Object.keys(PACK.ja.phrases).sort();
  ok('the same phrase keys in both (' + ke.length + ')', ke.length > 50 && JSON.stringify(ke) === JSON.stringify(kj), ke.filter(k => !kj.includes(k)).concat(kj.filter(k => !ke.includes(k))).slice(0, 5).join(' | '));
  const pe = PACK.es.patterns.map(p => String(p[0])), pj = PACK.ja.patterns.map(p => String(p[0]));
  ok('the same patterns in both (' + pe.length + '), in the same order', pe.length > 10 && JSON.stringify(pe) === JSON.stringify(pj));
  ok('no empty translation', ['es', 'ja'].every(c => Object.values(PACK[c].phrases).every(v => typeof v === 'string' && v.trim())));
  const fold = s => String(s).replace(/[\s ]+/g, ' ').trim().toLowerCase();
  const core = new Set([...Object.keys(CORE.es.phrases), ...Object.keys(CORE.ja.phrases)].map(fold));
  const dup = ke.filter(k => core.has(fold(k)));
  ok('no core phrase repeated in the pack', !dup.length, dup.slice(0, 5).join(' | '));
}
const DICT = {};
for (const code of ['es', 'ja']) {
  const merged = { phrases: Object.assign({}, CORE[code].phrases, PACK[code].phrases), exact: Object.assign({}, CORE[code].exact, PACK[code].exact), keep: [...(CORE[code].keep || []), ...(PACK[code].keep || [])], ctx: CORE[code].ctx, units: CORE[code].units,
    patterns: [...(CORE[code].patterns || []), ...PACK[code].patterns], ctxPatterns: CORE[code].ctxPatterns, sentences: CORE[code].sentences, sentenceJoin: CORE[code].sentenceJoin,
    locale: CORE[code].locale, decimal: CORE[code].decimal, caseless: CORE[code].caseless };
  DICT[code] = i18n.compile(code, merged);
}
const tr = (code, s) => i18n.translateText(DICT[code], s, []);

/* the text of an HTML fragment, outside translate="no", as the page's i18n walker meets it */
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'col', 'source', 'wbr']);
const ENT = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
function textsOf(html) {
  const out = [], stack = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] != null) {
      const s = ENT(m[5]).replace(/\s+/g, ' ').trim();
      if (s && /[A-Za-z]/.test(s) && !stack.some(x => x.no)) out.push(s);
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1]) { while (stack.length && stack.pop().tag !== tag); continue; }
    const attrs = m[3];
    for (const a of ['aria-label', 'title', 'placeholder']) {
      const v = new RegExp('\\s' + a + '="([^"]*)"').exec(attrs);
      if (v && /[A-Za-z]/.test(v[1]) && !/translate="no"/.test(attrs) && !stack.some(x => x.no)) out.push(ENT(v[1]));
    }
    if (tag === 'script' || tag === 'style') { const end = html.indexOf('</' + tag, re.lastIndex); re.lastIndex = end < 0 ? html.length : end; continue; }
    if (!m[4] && !VOID.has(tag)) stack.push({ tag, no: /translate="no"/.test(attrs) || /class="[^"]*\b(topbar|notranslate)\b/.test(attrs) });
  }
  return out;
}
{
  const body = HTML.split(/<body>/)[1];
  const lines = [...new Set(textsOf(body))].filter(s => s !== 'EPINOIΛ' && s !== 'Every league');
  for (const code of ['es', 'ja']) {
    const miss = lines.filter(s => tr(code, s) == null);
    ok(code + ': every static line on the page translates (' + lines.length + ')', !miss.length, miss.slice(0, 6).join(' | '));
  }
  const FE = require(path.join(EP, 'features.js'));
  for (const code of ['es', 'ja']) {
    const miss = FE.FACTORS.flatMap(f => [f.label, f.def]).filter(x => x && tr(code, x) == null);
    ok(code + ': every factor\'s label and definition (the files\' meta, the tooltips) translates (' + FE.FACTORS.length + ' factors)', !miss.length, miss.slice(0, 5).join(' | '));
  }
  const head = ['Which parts of the game turn into wins, what each is worth, and what a squad needs to win more.'];
  ok('...the subtitle too, in both', head.every(s => tr('es', s) && tr('ja', s)));
}

/* ------------------------------------------------------------------ the views --- */
const sandbox = { console, module: undefined, Math, Date, JSON };
sandbox.self = sandbox; sandbox.globalThis = sandbox; sandbox.window = sandbox;
const cx = vm.createContext(sandbox);
for (const f of ['winstats.js', 'winsim.js', 'winning.js', 'vizkit.js', 'winmix.js', 'winning/page.js']) vm.runInContext(read(EP, f), cx, { filename: f });
const P = sandbox.EpinoiaWinPage, VK = sandbox.EpinoiaVizKit, Sim = sandbox.EpinoiaWinSim, WN = sandbox.EpinoiaWinning, MX = sandbox.EpinoiaWinMix;
ok('page.js loads in node without a document and exports its views, cards and statusLine', !!P && typeof P.views === 'object' && typeof P.cards === 'function' && typeof P.statusLine === 'function' &&
   P.SECTIONS.join() === TABLE.map(t => t[0]).join());

function wellFormed(xml) {
  const stack = [];
  /* attributes quoted, or bare booleans (checked, selected, disabled) in HTML */
  const re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+(?:="[^"<]*")?)*)\s*(\/?)>|<!--[\s\S]*?-->/g;
  let last = 0, m;
  while ((m = re.exec(xml))) {
    const between = xml.slice(last, m.index);
    if (/[<>]/.test(between) || /&(?!(amp|lt|gt|quot|#39);)/.test(between)) return 'stray text: ' + between.slice(0, 60);
    last = re.lastIndex;
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) { if (stack.pop() !== m[2]) return 'mismatch at </' + m[2] + '>'; }
    else if (!m[4] && !VOID.has(m[2].toLowerCase())) stack.push(m[2]);
  }
  if (/[<>]/.test(xml.slice(last))) return 'trailing';
  return stack.length ? 'unclosed ' + stack.join(',') : '';
}
const st0 = () => ({ lens: 'explain', unit: 'pts', k: '', t1: '', t2: '', venue: 1, dials: { A: {}, B: {} }, picks: null, fview: 'bars', sortKey: 'r', sortDir: -1, posG: 'G', club: '', brushed: null, refit: null, simState: 'idle', simResult: null,
  posSet: 'grp', posOut: 'net', posS: '', gap: null, gapK: '', mix: null });
const ctxOf = (o) => Object.assign({ W: null, ans: null, fo: null, foState: 'idle', club: null, clubState: 'idle', mix: null, mixState: 'idle', teaser: null, reason: null, pooledFallback: false, message: '', gateNote: '', st: st0() }, o);
/* draw one view and every chart it asks for; {out, charts: built[], problems} */
function draw(id, ctx, widths) {
  const out = P.views[id](ctx), problems = [];
  const hw = wellFormed(out.html); if (hw) problems.push('html ' + hw);
  if (/<script|\son[a-z]+=/i.test(out.html)) problems.push('script or handler in the html');
  const slots = (out.html.match(/data-chart="\d+"/g) || []).length;
  if (slots !== out.charts.length) problems.push('slots ' + slots + ' != charts ' + out.charts.length);
  const built = [];
  for (const spec of out.charts) {
    if (!VK[spec.kind]) { problems.push('no builder ' + spec.kind); continue; }
    for (const W of widths || [760, 360]) {
      let b;
      try { b = VK[spec.kind](spec.data, Object.assign({}, spec.o, { W, id: id + 'x' })); } catch (e) { problems.push(spec.kind + ' threw ' + e.message); continue; }
      const wf = wellFormed(b.svg);
      if (wf) problems.push(spec.kind + ' svg ' + wf);
      if (!/^<svg[^>]*role="img"/.test(b.svg) || !/<title id=/.test(b.svg) || !/<desc id=/.test(b.svg)) problems.push(spec.kind + ' without role/title/desc');
      if (/NaN|undefined|Infinity/.test(b.svg)) problems.push(spec.kind + ' NaN/undefined in the svg');
      if (!b.table || !b.table.rows.length) problems.push(spec.kind + ' empty table twin');
      if (W === 760) built.push(b);
    }
  }
  if (/NaN|undefined|\[object Object\]/.test(out.html)) problems.push('NaN/undefined/[object Object] in the html: ' + /.{0,40}(NaN|undefined|\[object Object\]).{0,40}/.exec(out.html)[0]);
  return { out, built, problems };
}
const load = (dir, f) => { const p = path.join(dir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };

function drawFiles(dir, tag) {
  const wins = load(dir, 'wins.json'), pooled = load(dir, 'wins-all.json'), fo = load(dir, 'fo.json'), club = load(dir, 'club.json'), teaser = load(dir, 'teaser.json'), mixF = load(dir, 'mix.json');
  const mixD = mixF ? MX.decode(mixF) : null;
  console.log('\neach section draws from ' + tag);
  ok(tag + ': the five files are there (wins, wins-all, fo, club, teaser)', !!(wins && pooled && fo && club && teaser));
  if (!(wins && pooled && fo && club && teaser)) return;
  const WM = (() => { try { return require(path.join(EP, 'winmodel.js')); } catch (_) { return null; } })();
  if (WM && WM.validate) {
    const probs = [['wins', wins], ['wins', pooled], ['fo', fo], ['club', club], ['teaser', teaser]].map(([s, f]) => [s, WM.validate(f, s)]).filter(x => x[1].length);
    ok(tag + ': every file passes EpinoiaWinModel.validate', !probs.length, probs.map(p => p[0] + ': ' + p[1].slice(0, 3).join('; ')).join(' | '));
  }
  const ansL = { ok: true, data: wins, token: wins.token, built: wins.built, pending: 12 };
  const drawn = {};
  for (const id of P.SECTIONS.filter(s => s !== 'method')) {
    const ctx = ctxOf({ W: wins, ans: ansL });
    if (id === 'sim') { ctx.fo = fo; ctx.foState = 'ok'; }
    if (id === 'losses') { ctx.st.club = club.team.id; ctx.club = club; ctx.clubState = 'ok'; }
    if (id === 'mixes') { ctx.mix = mixD; ctx.mixState = mixD ? 'ok' : 'error'; }
    const d = drawn[id] = draw(id, ctx);
    ok(tag + ' league file: #' + id + ' draws (' + d.out.charts.length + ' charts) with no problem', (d.out.state === 'ok' || (id === 'mixes' && !mixD)) && d.out.html.length > 40 && !d.problems.length, d.out.state + ' ' + d.problems.slice(0, 4).join(' | '));
  }
  if (wins.tempo && wins.tempo.bins && wins.tempo.bins.length) {
    const th = drawn.tempo.out.html, at = th.indexOf('Winning by team pace');
    ok(tag + ': the team-pace curve has a heading and a key for its solid (observed) and dashed (net rating held level) lines (UI2-2)',
       at >= 0 && /<i class="ww-k-line"><\/i>observed/.test(th) && (!wins.tempo.curveAdj || /ww-k-line ww-k-dash"><\/i>with net rating held level/.test(th)) &&
       th.indexOf('data-chart', at) > at);
  }
  const want = { value: 2, factors: 1, curves: 3, tempo: 1, positions: wins.positions && wins.positions.stats ? 3 : 1, squad: wins.roles ? 3 : 1, mixes: mixD ? 2 : 0, sim: 0, losses: 2, leagues: wins.models.core4c.coef.some(c => c.own) ? 1 : 0, model: 1 };
  const short = Object.keys(want).filter(id => drawn[id].out.charts.length < want[id]);
  ok(tag + ': each member section has its charts (value ≥ 2, curves ≥ 3, losses ≥ 2 with the club …)', !short.length, short.join());
  /* the variants a reader can switch to */
  const variants = [
    ['value', { unit: 'wins' }], ['value', { unit: 'unit' }], ['value', { lens: 'forecast' }], ['factors', { fview: 'table' }], ['factors', { sortKey: 'k', sortDir: 1 }],
    ['positions', { posG: 'C' }], ['positions', { posG: 'F' }], ['tempo', { brushed: [(wins.tempo && wins.tempo.teams[0] || {}).id] }],
    ['positions', { posSet: 'slot' }], ['positions', { posSet: 'slot', posS: '5', posOut: 'win' }], ['positions', { posS: 'C' }]
  ].concat(Object.keys(wins.curves || {}).map(k => ['curves', { k }]), Object.keys(wins.curves || {}).map(k => ['curves', { k, gap: -2.5, gapK: k }]),
    mixD ? [['mixes', { mix: { c: [{ kind: 'stat', stat: 'ast_pct', cmp: '>', x: 20, op: 'ge', n: 2 }, { kind: 'role', role: 'shooter', op: 'ge', n: 3 }], two: true } }],
      ['mixes', { mix: { c: [{ kind: 'stat', stat: 'orb_pct', cmp: '>', x: 7, op: 'eq', n: 1 }], two: false, team: mixD.teams[0] } }],
      ['mixes', { mix: { c: [{ kind: 'role', role: 'big', op: 'eq', n: 0 }], two: false } }]] : []);
  const bad = variants.map(([id, s]) => { const ctx = ctxOf({ W: wins, ans: ansL }); Object.assign(ctx.st, s); if (id === 'mixes') { ctx.mix = mixD; ctx.mixState = 'ok'; } const d = draw(id, ctx); return d.problems.length || d.out.state !== 'ok' ? id + JSON.stringify(s) + ': ' + d.problems[0] : null; }).filter(Boolean);
  ok(tag + ': every switch and every curve\'s factor draws (' + variants.length + ' variants)', !bad.length, bad.slice(0, 3).join(' | '));
  /* pooled */
  for (const id of ['answer', 'value', 'factors', 'curves', 'leagues', 'model', 'losses', 'tempo']) {
    const d = draw(id, ctxOf({ W: pooled, ans: { ok: true, data: pooled, pending: null } }));
    ok(tag + ' pooled file: #' + id + ' draws', ['ok', 'empty'].includes(d.out.state) && !d.problems.length, d.out.state + ' ' + d.problems.slice(0, 3).join(' | '));
  }
  {
    const d = draw('leagues', ctxOf({ W: pooled }));
    const open = pooled.leagues || [];
    ok(tag + ' pooled: League by league is the leagues × factors heatmap, one row a league, hatched where w > 0.6', d.out.charts[0] && d.out.charts[0].kind === 'heatmap' &&
       d.out.charts[0].data.rows.length === open.length && d.out.charts[0].data.cells.every((r, i) => r.every(c => !c || c.hatch === (open[i].coef.find(x => x.label === undefined && true) ? c.hatch : c.hatch))));
    const sim = P.views.sim(ctxOf({ W: pooled }));
    ok(tag + ' pooled: #sim asks for a league', sim.state === 'empty' && /Pick a league/.test(sim.html));
    const s = P.statusLine({ built: pooled.built, pending: null }, pooled);
    ok(tag + ' pooled: no RECALCULATE for the pooled file', !s.canRecalc);
  }
  /* the cards (§11) */
  const cs = P.cards(wins);
  ok(tag + ': ≤ 6 cards, each with a lens and an interval', cs.length >= 3 && cs.length <= 6 && cs.every(c => ['explain', 'forecast', 'model'].includes(c.lens) && /\(|γ|indirect|does not change/.test(c.text)), cs.map(c => c.text).join(' | '));
  /* UI2-1: the hard-number card only from a measure with a better side whose interval leaves out 50% */
  {
    const Wn = JSON.parse(JSON.stringify(wins));
    Wn.meta = Object.assign({}, Wn.meta, { players_used: { label: 'Players used', dir: 0 }, dead100: { label: 'Dead balls per 100', dir: -1 } });
    Wn.curves = { players_used: { hard: { t: 1, p: 0.5694, lo: 0.4544, hi: 0.6774, n: 72 } }, dead100: { hard: { t: 2, p: 0.509, lo: 0.379, hi: 0.639, n: 72 } } };
    const none = P.cards(Wn).find(c => /^Sides ahead by/.test(c.text));
    Wn.curves.ast_rate = { hard: { t: 5, p: 0.62, lo: 0.55, hi: 0.69, n: 120 } };
    Wn.meta.ast_rate = { label: 'Assist rate', dir: 1 };
    Wn.curves.players_used.hard = { t: 1, p: 0.8, lo: 0.7, hi: 0.9, n: 80 };
    const one = P.cards(Wn).find(c => /^Sides ahead by/.test(c.text));
    ok(tag + ': no hard-number card from noise (50% inside the interval) or from a measure with no better side (players used)', !none && !!one && one.k === 'ast_rate',
       (none && none.text) + ' / ' + (one && one.text));
  }
  for (const code of ['es', 'ja']) {
    const miss = cs.map(c => c.text).filter(s => tr(code, s) == null);
    ok(tag + ' ' + code + ': every card translates', !miss.length, miss.join(' | '));
  }
  /* every line a view writes translates, outside translate="no" */
  for (const code of ['es', 'ja']) {
    const miss = new Set();
    for (const id of Object.keys(drawn)) textsOf(drawn[id].out.html).forEach(s => { if (tr(code, s) == null && !/^[\d\s.,:+−–%()-]+$/.test(s)) miss.add(id + ': ' + s); });
    ok(tag + ' ' + code + ': every line the views write translates', !miss.size, [...miss].slice(0, 6).join(' | '));
  }
  /* every word handed to the chart kit: titles, descriptions, axes, labels, details (names left as they are) */
  {
    const words = new Set(), add = x => { if (typeof x === 'string' && /[A-Za-z]/.test(x)) words.add(x); };
    const names = new Set([...((wins.tempo && wins.tempo.teams) || []).map(t => t.name), ...((pooled.leagues) || []).map(l => l.name), ...(fo.teams || []).map(t => t.name)]);
    const each = [];
    for (const id of Object.keys(drawn)) each.push(drawn[id].out);
    for (const id of ['value', 'leagues', 'model', 'curves']) each.push(P.views[id](ctxOf({ W: pooled })));
    { const c = ctxOf({ W: wins }); c.st.lens = 'forecast'; each.push(P.views.value(c)); }
    for (const out of each) for (const ch of out.charts) {
      [ch.label, ch.o && ch.o.title, ch.o && ch.o.desc, ch.o && ch.o.x && ch.o.x.label, ch.o && ch.o.y && ch.o.y.label, ch.o && ch.o.countLabel].forEach(add);
      if (ch.kind === 'scatter' || ch.kind === 'meter') continue;
      const d = ch.data, rows = Array.isArray(d) ? d : (d && (d.rows || d.parts || d.series)) || [];
      rows.forEach(r => { if (typeof r === 'string') add(r); else if (r) { add(r.label); add(r.detail); add(r.badge); add(r.title); (r.parts || r.pts || []).forEach(q => q && add(q.label)); } });
      if (d && d.cols) d.cols.forEach(add);
      if (d && d.start) add(d.start.label);
      if (d && d.total) add(d.total.label);
      if (d && d.cells) d.cells.flat().forEach(c => c && add(c.detail));
    }
    for (const code of ['es', 'ja']) {
      const miss = [...words].filter(w => !names.has(w) && tr(code, w) == null);
      ok(tag + ' ' + code + ': every word handed to the charts translates (' + words.size + ')', !miss.length, miss.slice(0, 6).join(' | '));
    }
  }
  /* the simulator: the fo file's profiles, as the page sends them */
  {
    const T = fo.teams, A = T[0], B = T[1];
    let r = null, err = '';
    try {
      const pa = Sim.applyEdits(A.prof, [{ end: 'off', key: 'efg', delta: 2 }], fo.lg), pb = Sim.applyEdits(B.prof, [], fo.lg);
      const M = Sim.matchup(pa, pb, fo.lg, { home: 1, platt: P.simPlatt(fo) });
      r = Sim.simulate(JSON.parse(JSON.stringify(M)), { n: 600, seed: 1 });
    } catch (e) { err = e.message; }
    const pl = { a: 0.464, b: 0.11 };
    ok(tag + ': the simulator\'s Platt map is used only when the builder calibrated it (an experimental one is shown raw)',
       P.simPlatt({ sim: { calibrated: false, platt: pl } }) === null && P.simPlatt({ sim: { calibrated: true, platt: pl } }) === pl && P.simPlatt({}) === null);
    ok(tag + ': the fo file\'s profiles run through matchup and simulate (structured-clone safe)', !!r && r.pWin > 0 && r.pWin < 1 && r.hist.length > 3, err);
    const ctx = ctxOf({ W: wins, fo, foState: 'ok' });
    const key = [A.id, B.id, 1, JSON.stringify(ctx.st.dials)].join('|');
    Object.assign(ctx.st, { t1: A.id, t2: B.id, simState: 'done', simResult: Object.assign({ key, tornado: [{ id: 'efg', label: 'eFG%', lo: 0.4, hi: 0.6, loLabel: '−5 pp', hiLabel: '+5 pp' }] }, r || {}) });
    const d = draw('sim', ctx);
    ok(tag + ': a simulation draws the meter, the margins and the tornado', d.out.charts.map(c => c.kind).join() === 'meter,histogram,tornado' && !d.problems.length, d.out.charts.map(c => c.kind).join() + ' ' + d.problems.join());
    ok(tag + ': six dials a side, 44 px targets, from the §12 ranges', (d.out.html.match(/type="range"/g) || []).length === 12 && /min="-5" max="5"/.test(d.out.html) && /min="-3" max="3"/.test(d.out.html));
  }
  /* the re-fit: the wins file's blocks, as the page sends them to the Worker */
  if (wins.blocks) {
    let r = null, err = '';
    try {
      const keys = wins.blocks.keys, cols = ['h'].concat(wins.models.core4c.coef.map(c => c.k).filter(k => keys.includes(k)));
      const scale = wins.blocks.scale.slice(); scale[keys.indexOf('h')] = 0;
      r = Sim.run(Sim.steps('refit', { blocks: JSON.parse(JSON.stringify(wins.blocks.list)), keys, cols, lambda: wins.blocks.lambda, scale, B: 40, seed: 1 }));
      r.cols = cols;
    } catch (e) { err = e.message; }
    ok(tag + ': the blocks re-fit through the Worker\'s refit op, home court unpenalised, intervals ordered', !!r && r.b.length === r.cols.length && r.b.every((b, i) => r.lo[i] <= b + 1e-9 && b <= r.hi[i] + 1e-9), err);
    const c4 = wins.models.core4c.coef;
    const same = r && c4.every(c => { const i = r.cols.indexOf(c.k); return i < 0 || Math.sign(r.b[i]) === Math.sign(c.b); });
    ok(tag + ': ...and the re-fit of the four factors keeps the file\'s signs', !!same);
  }
  /* a club's file: the defeats */
  {
    const games = club.games || [];
    const exact = games.every(g => Math.abs(g.xm + Object.values(g.parts).reduce((s, v) => s + v, 0) - g.m) < 0.06);
    ok(tag + ': a club\'s games: m = xm + Σ parts (to the file\'s rounding)', games.length > 0 && exact);
  }
  return { wins, pooled, fo, club, teaser };
}

const F = drawFiles(FIX, 'fixtures/ww-page');

/* ------------------------------------------------------------------ A.3: where the line is, in depth --- */
console.log('\nA.3: every measure defined, and the gap a reader moves');
{
  const W0 = F.wins, keys = Object.keys(W0.curves || {});
  const c = { raw: [[-10, 0.1, 0.05, 0.2], [0, 0.5, 0.4, 0.6], [10, 0.9, 0.8, 0.95]], adj: [[-10, 0.2], [10, 0.8]], hist: [[-10, -5, 10], [-5, 0, 40], [0, 5, 40], [5, 10, 10]] };
  const a = P.gapAt(c, 5);
  ok('gapAt: the fitted chance and its band between the curve\'s points, the curve with the others level, the share of games with a gap this big either way',
     Math.abs(a.p - 0.7) < 1e-12 && Math.abs(a.lo - 0.6) < 1e-12 && Math.abs(a.hi - 0.775) < 1e-12 && Math.abs(a.adj - 0.65) < 1e-12 && Math.abs(a.share - 0.2) < 1e-12, JSON.stringify(a));
  const G = P.gapRange(c);
  ok('gapRange: the curve\'s own x range in about 200 nice steps, starting at 0 when there is no x75', G.lo === -10 && G.hi === 10 && G.step === 0.1 && G.start === 0, JSON.stringify(G));
  ok('...beyond the curve the chance holds its end (never extrapolated)', P.gapAt(c, 99).p === 0.9 && P.gapAt(c, -99).p === 0.1);
  const d = draw('curves', ctxOf({ W: W0 }));
  ok('every factor the picker lists has its definition and how to read it (the box under the picker and the glossary)', keys.every(k => W0.meta[k] && W0.meta[k].def) &&
     /class="ww-def"/.test(d.out.html) && (d.out.html.match(/<dt>/g) || []).length === keys.length && /Higher is better|Lower is better|A style|Part of the score/.test(d.out.html));
  ok('move the gap: a keyboard-operable range and a number over the same values, described by an aria-live readout', /<input type="range" id="wwGap" data-act="gap"[^>]*aria-describedby="wwGapOut"/.test(d.out.html) &&
     /<input type="number"[^>]*id="wwGapN" data-act="gapn"/.test(d.out.html) && /<p class="ww-gapout" id="wwGapOut" aria-live="polite">/.test(d.out.html));
  const ch = d.out.charts.find(x => x.live === 'gap'), k0 = keys[0], at0 = P.gapAt(W0.curves[k0], P.gapRange(W0.curves[k0]).start);
  ok('...the curve carries the reader\'s mark (the page moves it without drawing the section again)', !!ch && ch.data.mark && Math.abs(ch.data.mark.p - at0.p) < 1e-12 && /vz-cursor/.test(VK.binnedCurve(ch.data, { W: 760 }).svg));
  const lines = P.gapText(W0, k0, W0.curves[k0], Object.assign({}, at0, { x: 2.5 }));
  for (const code of ['es', 'ja']) { const miss = lines.concat(P.gapText(W0, 'efg', W0.curves.efg || W0.curves[k0], Object.assign({}, at0, { x: -3 }))).filter(x => tr(code, x) == null); ok(code + ': the readout translates', !miss.length, miss.join(' | ')); }
}
console.log('\nA.3: the new sections read nothing but their files');
{
  const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, '');
  ok('the lineup mixes\' file comes through EpinoiaWinFile (scope mix) only when #mixes comes near or its button is pressed', /mixObs\.observe\(\$\('mixes'\)\)/.test(code) && /scope: 'mix'/.test(code) &&
     (code.match(/scope: 'mix'/g) || []).length === 1 && /act === 'loadmix'\) \{ loadMix\(\)/.test(code) && /function load\(force\)[^]*?observeMix\(\);/.test(code));
  const WM = read(EP, 'winmix.js').replace(/\/\*[\s\S]*?\*\//g, '');
  ok('winmix.js reads nothing: no fetch, no XHR, no EpinoiaData, no storage', !/\bfetch\(|XMLHttpRequest|EpinoiaData|localStorage|sessionStorage|EpinoiaWinFile/.test(WM));
  ok('...nor does page.js add a read: its only table reads are still leagues and seasons, and files only through EpinoiaWinFile', !/\bfetch\(|XMLHttpRequest/.test(code) &&
     [...code.matchAll(/D\(\)\.get\('([a-z_]+)\?/g)].every(m => m[1] === 'leagues' || m[1] === 'seasons'));
}

/* ------------------------------------------------------------------ the review's fixes (S4, S5, S7, UI-5..UI-11) --- */
console.log('\nwhat the cards and sections claim');
{
  const W0 = F.wins, clone = o => JSON.parse(JSON.stringify(o));
  const withG = (v, lo, hi, x) => { const W = clone(W0); W.tempo.sqrtN = Object.assign({}, W.tempo.sqrtN, { gamma: { v, lo, hi } }, x || {}); return W; };
  const paceCard = W => (P.cards(W).find(c => c.lens === 'forecast') || {}).text || '';
  const tells = [paceCard(withG(2, -1, 2)), paceCard(withG(-1, -1, 2)), paceCard(withG(0.9, 0.2, 1.6)), paceCard(withG(-0.6, -0.95, -0.2)), paceCard(withG(0.05, -0.3, 0.4))];
  ok('S4: γ at an end of its search range [-1, 2] with the interval over all of it: "cannot yet tell", never "does not change"', /cannot yet tell/.test(tells[0]) && /cannot yet tell/.test(tells[1]) &&
     !/does not change/.test(tells[0] + tells[1]), tells.slice(0, 2));
  ok('...lo > 0: more possessions help the favourite; hi < 0: longer games help the underdog; narrow around 0: does not change (with γ)',
     /^More possessions help the favourite/.test(tells[2]) && /^Longer games help the underdog/.test(tells[3]) && /does not change who wins here, once quality is counted: γ = /.test(tells[4]), tells.slice(2));
  const tempoHtml = P.views.tempo(ctxOf({ W: withG(2, -1, 2) })).html;
  ok('...the Pace and possession section says the same', /cannot yet tell/.test(tempoHtml) && !/does not change who wins/.test(tempoHtml));
  /* S5 */
  const Wh = clone(W0); Wh.homeMargin = { v: 2.33, lo: 1.1, hi: 3.5, n: 251 };
  const home = P.cards(Wh).find(c => /Home court/.test(c.text));
  ok('S5: the home card is the whole edge (the home side\'s mean margin), not α beyond the factors', home && /^Home court is worth 2\.3 points \(1\.1–3\.5\) and \d+% of games$/.test(home.text), home && home.text);
  const Wa = clone(W0); delete Wa.homeMargin;
  const alpha = P.cards(Wa).find(c => /Home court/.test(c.text));
  ok('...a file without it names α for what it is ("beyond the four factors"), never beside the home win share', alpha && /^Home court beyond the four factors is worth/.test(alpha.text) && !/% of games/.test(alpha.text), alpha && alpha.text);
  /* S7 */
  const Wt = clone(W0), top = (Wt.path || []).find(x => x.k === 'top_avg');
  if (top) {
    top.direct = { v: 0.41, lo: 0.1, hi: 0.7 }; top.indirect = { v: 1.53, lo: 0.9, hi: 2.1 };
    const t1 = P.cards(Wt).find(c => /Time of possession|second more/.test(c.text));
    top.direct = { v: 0.2, lo: -0.3, hi: 0.6 };
    const t2 = P.cards(Wt).find(c => /Time of possession|second more/.test(c.text));
    ok('S7: the time-of-possession card headlines the DIRECT effect with its interval, never the indirect share', t1 && /^One second more a possession is worth \+0\.41 points of margin directly \(\+0\.10 to \+0\.70\)/.test(t1.text) &&
       t2 && /no clear direct effect/.test(t2.text) && !/indirect/.test(t1.text + t2.text), [t1 && t1.text, t2 && t2.text]);
  }
  /* every new card text translates */
  for (const code of ['es', 'ja']) {
    const texts = tells.concat([home && home.text, alpha && alpha.text]).filter(Boolean);
    const miss = texts.filter(x => tr(code, x) == null);
    ok(code + ': the new card texts translate', !miss.length, miss.join(' | '));
  }
  /* UI-5: a significant style measure is drawn in its own hue, noise in grey, and the legend says both */
  const fx = P.views.factors(ctxOf({ W: W0 }));
  const bars = fx.charts[0].data, b = VK.bars(bars, { W: 760 });
  const style = bars.find(r => r.dir === 0 && !r.muted), noise = bars.find(r => r.muted);
  ok('UI-5: a style measure that is not noise is not drawn in the noise grey; the legend names both', !!style && /vz-style/.test(b.svg) &&
     (!noise || /vz-neu vz-muted/.test(b.svg)) && /a style measure, no better side/.test(fx.html) && /not distinguishable from noise/.test(fx.html));
  /* UI-6 */
  const lo = P.views.losses(ctxOf({ W: W0 })).html;
  ok('UI-6: the luck note no longer calls it "beyond the parts"', !/beyond the parts/.test(lo) && /Shot-making against shot quality/.test(lo));
  for (const code of ['es', 'ja']) ok(code + ': ...and it translates', textsOf(lo).every(x => tr(code, x) != null || /^[\d\s.,:+−–%()-]+$/.test(x)), textsOf(lo).filter(x => tr(code, x) == null).join(' | '));
  /* UI-7 */
  const val = P.views.value(ctxOf({ W: W0 })), ss = val.charts.find(c => c.kind === 'stackShare');
  const card = P.cards(W0).find(c => /^Shooting decides/.test(c.text)), pcCard = card && +/decides (\d+)%/.exec(card.text)[1];
  const sb = VK.stackShare(ss.data, { W: 760 });
  const efgSeg = sb.hits.find(h => /Measured here · eFG/.test(h.label));
  ok('UI-7: the share bar and the card give eFG the same number; the unexplained rest is drawn', efgSeg && Math.round(parseFloat(efgSeg.value)) === pcCard && sb.hits.some(h => /not explained/.test(h.label)),
     [card && card.text, efgSeg && efgSeg.value]);
  /* UI-8 */
  const pos = P.views.positions(ctxOf({ W: W0 })), db = pos.charts.find(c => c.kind === 'dumbbell');
  ok('UI-8: the bottom quarter is a hollow marker, the league the grey one', !db || (db.data.every(r => r.pts.find(q => q.k === 'bottom').hollow) && /vz-ptho/.test(VK.dumbbell(db.data, { W: 760 }).svg)));
  /* UI-10 */
  const lg = P.views.leagues(ctxOf({ W: F.pooled })), hm = lg.charts.find(c => c.kind === 'heatmap');
  ok('UI-10: the leagues heatmap is a neutral pair (more / less weight), not good / bad', hm && hm.data.mode === 'rel' && !/better or worse/.test(hm.o.desc) &&
     !/vz-good|vz-bad/.test(VK.heatmap(hm.data, { W: 760 }).svg));
  /* S1: the simulator's checks are held out; the in-sample score only beside them */
  const Wm = clone(W0); Wm.predictive.sim = Object.assign({}, Wm.predictive.sim || { calibrated: false, brier: 0.24, slope: 1.3, checks: { pace: { obs: 76, sim: 77 } } }, { heldOut: true, inSample: { brier: 0.201, slope: 1.1, checks: {} } });
  const mh = P.views.model(ctxOf({ W: Wm })).html;
  ok('S1: the model section says the simulator\'s checks are out of sample, and shows the in-sample Brier apart', /fitted only on the games played before it/.test(mh) && /would be 0\.201: shown for comparison, never used for the gate/.test(mh));
  for (const code of ['es', 'ja']) { const miss = textsOf(mh).filter(x => tr(code, x) == null && !/^[\d\s.,:+−–%()-]+$/.test(x)); ok(code + ': ...and it translates', !miss.length, miss.join(' | ')); }
  /* UI-11 */
  const none = P.views.answer(ctxOf({ W: F.pooled, pooledFallback: true, fallbackWhy: 'none' })).html, few = P.views.answer(ctxOf({ W: F.pooled, pooledFallback: true, fallbackWhy: 'few' })).html;
  const simNone = P.views.sim(ctxOf({ W: F.pooled, pooledFallback: true, fallbackWhy: 'none' })).html;
  ok('UI-11: a league whose file is missing is not told it has fewer than 20 games, and #sim does not ask to pick a league', /has not been built yet/.test(none) && !/Fewer than 20/.test(none) &&
     /Fewer than 20/.test(few) && !/Pick a league/.test(simNone) && /built with its model/.test(simNone));
}

/* ------------------------------------------------------------------ refused, preview, states --- */
console.log('\nrefused, preview and the states of §11');
{
  const locked = JSON.parse(read(FIX, 'locked.json'));
  ok('the locked fixture is a refusal', locked.ok === false && locked.reason === 'members');
  const ctx = ctxOf({ reason: locked.reason });
  const leak = [];
  for (const id of P.MEMBER) {
    const out = P.views[id](ctx);
    const text = out.html.replace(/data-memlock="\d+"/g, '');
    if (out.state !== 'locked' || !/data-memlock="\d+"/.test(out.html) || /\d/.test(text) || out.charts.length) leak.push(id + ':' + out.state);
  }
  ok('locked: every member section draws its placeholder, no numbers and no chart (' + P.MEMBER.length + ')', !leak.length, leak.join());
  const ans = P.views.answer(ctxOf({ reason: 'members', message: '' }));
  ok('locked without a preview: the short answer draws nothing with a number', !/\d/.test(ans.html));
  ok('the method section is static and public (no member view for it)', !P.views.method && /id="method"/.test(HTML) && !P.MEMBER.includes('method'));

  const T = F && F.teaser;
  if (T) {
    const pv = ctxOf({ reason: 'members', teaser: T, gateNote: '<p class="ww-gate">The full model is for members: <a href="../join/">become a member</a></p>' });
    const a = P.views.answer(pv), f = P.views.factors(pv), l = P.views.leagues(pv), v = P.views.value(pv);
    ok('preview: the short answer words the teaser through winning.fromTeaser + insights, each card a preview chip', a.state === 'preview' && /data-lens="preview"/.test(a.html) && (a.html.match(/class="ww-card"/g) || []).length >= 2);
    const words = WN.insights(WN.fromTeaser(T));
    ok('...the same sentences insights() gives for the teaser', words.slice(0, 2).every(w => a.html.includes(P.views ? w.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') : w)));
    ok('preview: Every measure is the teaser\'s ranked box-score measures, PUBLIC keys only', f.state === 'preview' && f.charts[0].data.length === T.ranked.length);
    ok('preview: League by league lists the teaser\'s open leagues', l.state === 'preview' && T.leagues.every(x => l.html.includes(x.name.replace(/&/g, '&amp;'))));
    ok('preview: the other member sections stay placeholders', v.state === 'locked');
    ok('preview: a member\'s note under the preview', a.html.includes('become a member'));
    for (const code of ['es', 'ja']) {
      const miss = [a, f, l].flatMap(o => textsOf(o.html)).filter(s => tr(code, s) == null && !/^[\d\s.,:+−–%()-]+$/.test(s) && !T.leagues.some(x => x.name === s));
      ok('preview ' + code + ': every line translates', !miss.length, miss.slice(0, 5).join(' | '));
    }
  }
  const pf = P.views.answer(ctxOf({ W: F && F.pooled, pooledFallback: true }));
  ok('under 20 games: the .pg-empty line and the pooled file\'s cards', /class="pg-empty"><p>Fewer than 20 finished games here yet: showing every league pooled<\/p>/.test(pf.html) && /class="ww-card"/.test(pf.html));
  ok('\'layout\', \'rate\' and \'none\' are said plainly', /The model is being rebuilt; back within the hour/.test(PAGE) && /'Too many requests: try again in ' \+ /.test(PAGE) &&
     /The full model switches on once it has been built/.test(PAGE));
  ok('a file over 48 h old with newer finals: a banner with its build time', /48 \* 3600e3/.test(PAGE) && /newer games have finished since/.test(PAGE));
  const e = P.views.answer(ctxOf({ message: 'Too many requests: try again in 30 minutes' }));
  ok('a refusal with nothing to show is a .pg-empty saying so', /pg-empty/.test(e.html) && /30 minutes/.test(e.html));
  for (const code of ['es', 'ja']) ok(code + ': the rate message translates', tr(code, 'Too many requests: try again in 30 minutes') != null);
}

console.log('\nthe status line (A.2)');
{
  const W = F.wins, now = Date.parse(W.built) + 2 * 3600e3;
  const s = P.statusLine({ built: W.built, pending: 12 }, W, { now });
  ok('"Model of N games · built 2 h ago · 12 new games since"', s.line === 'Model of ' + W.n.games + ' games · built 2 h ago · 12 new games since', s.line);
  ok('...RECALCULATE on with games pending', s.canRecalc && !s.upToDate);
  const u = P.statusLine({ built: W.built, pending: 0 }, W, { now: Date.parse(W.built) + 5 * 60e3 });
  ok('nothing pending: "up to date", RECALCULATE greyed', u.line === 'Model of ' + W.n.games + ' games · built 5 min ago · up to date' && !u.canRecalc && u.upToDate, u.line);
  const one = P.statusLine({ built: W.built, pending: 1 }, W, { now: Date.parse(W.built) + 3 * 86400e3 });
  ok('one game, and days', one.line.endsWith('built 3 days ago · 1 new game since'), one.line);
  const unk = P.statusLine({ built: W.built }, W, { now });
  ok('pending unknown: no claim either way, no button', !/new game|up to date/.test(unk.line) && !unk.canRecalc);
  for (const code of ['es', 'ja']) {
    const miss = [s.line, u.line, one.line, 'Model of 7 games · built just now'].filter(x => tr(code, x) == null);
    ok(code + ': the status line translates', !miss.length, miss.join(' | '));
  }
  const words = ['Checking what has changed', 'Updating the model on the server', 'Downloading the new file (182 KB)', 'Re-simulating: 40%', 'Drawing', 'Done',
    'Cancelled: anything the server had started still finishes, and is reused next time', 'Too many new games for a quick update: a full rebuild is scheduled',
    'The update is queued: the next scheduled build picks these games up first', 'Recalculated with 12 new games', 'Recalculating is for members', 'Sign in to recalculate', 'Up to date', 'Recalculate', 'Cancel', 'show table', 'hide table'];
  ok('every message of the bar is in page.js', words.filter(w => !/\d/.test(w) && !/table$/.test(w)).every(w => PAGE.includes("'" + w + "'") || PAGE.includes(w)));
  for (const code of ['es', 'ja']) {
    const miss = words.filter(x => tr(code, x) == null);
    ok(code + ': every message of the bar translates', !miss.length, miss.join(' | '));
  }
}


/* ------------------------------------------------------------------ before the first build --- */
/* the page booted on a stand-in document, with a stand-in loader and data.js: with no teaser it draws the short answer
   and the measures from the public box scores (boxpreview.js), for the picked league; with a teaser it reads no box
   score at all and never loads boxpreview.js */
console.log('\nbefore the first build: the box-score preview');
await (async () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const LG = [{ id: 'L1', slug: 'north', name: 'North League', country: 'GB' }, { id: 'L2', slug: 'south', name: 'South League', country: 'GB' }];
  const games = [], tgs = new Map();
  for (let i = 0; i < 90; i++) {
    const lg = LG[i < 60 ? 0 : 1], id = 'g' + i, edge = rnd() - 0.5;
    const hs = 75 + Math.round(30 * edge + 10 * (rnd() - 0.5)), as = 75 + Math.round(10 * (rnd() - 0.5));
    if (hs === as) continue;
    games.push({ id, home_score: hs, away_score: as, competitions: { seasons: { name: '2026', leagues: lg } } });
    const side = (idx, e) => { const r = { game_id: id, team_idx: idx }; WN.MEASURES.forEach(([k]) => { r[k] = 40 + 20 * rnd() + (k === 'efg' || k === 'ts' ? 25 * e : 0); }); return r; };
    tgs.set(id, [side(0, edge), side(1, 0)]);
  }
  class El {
    constructor(id) { this.id = id; this.textContent = ''; this.innerHTML = ''; this.attrs = {}; this.children = []; this.value = ''; this.disabled = false; this.src = '';
      this.classList = { toggle() {}, add() {}, remove() {}, contains: () => false }; }
    setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; } removeAttribute(k) { delete this.attrs[k]; }
    addEventListener() {} querySelectorAll() { return []; } querySelector() { return null; } appendChild(c) { this.children.push(c); return c; }
    contains() { return false; } focus() {} scrollIntoView() {} closest() { return null; } replaceWith() {}
  }
  async function boot(search, teaser) {
    const els = new Map(), head = new El('head'), reqs = [], asked = [];
    const doc = { getElementById: id => { if (!els.has(id)) els.set(id, new El(id)); return els.get(id); }, createElement: t => new El(t), head, scripts: [], activeElement: null,
      currentScript: { src: 'http://x/epinoia/winning/page.js?v=42' } };
    const mem = new Map(), ss = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i], get length() { return mem.size; } };
    const D = {
      get: async u => { reqs.push(u); if (/^leagues\?select=/.test(u)) return LG.map(l => ({ id: l.id, slug: l.slug, name: l.name })); if (/^leagues\?slug=/.test(u)) return [LG.find(l => u.includes(l.slug))]; return []; },
      all: async u => { reqs.push(u);
        if (/^games\?status=eq\.final/.test(u)) return games;
        if (/^team_game_stats\?game_id=in\.\(/.test(u)) return /\(([^)]*)\)/.exec(u)[1].split(',').flatMap(id => tgs.get(id) || []);
        return []; } };
    const WFk = { get: async o => { asked.push(o.scope); if (o.scope === 'teaser') return teaser ? { ok: true, data: teaser } : { ok: false, reason: 'none' }; return { ok: false, reason: 'network' }; } };
    const sb = { console: { warn() {}, log() {} }, setTimeout, clearTimeout, URL, URLSearchParams, Promise, Date, Math, JSON, Map, Set, Object, Array, String, Number, isFinite,
      document: doc, location: { search, href: 'http://x/epinoia/winning/' + search, pathname: '/epinoia/winning/' }, history: { replaceState() {} },
      localStorage: { removeItem() {}, getItem: () => null }, sessionStorage: ss, EpinoiaData: D, EpinoiaWinFile: WFk, EpinoiaVizKit: {} };
    sb.globalThis = sb; sb.self = sb;
    vm.createContext(sb);
    vm.runInContext(read(EP, 'winning.js'), sb, { filename: 'winning.js' });
    /* boxpreview.js arrives as the script page.js appends to the head */
    head.appendChild = c => { head.children.push(c); if (/boxpreview\.js/.test(c.src)) { vm.runInContext(read(EP, 'winning/boxpreview.js'), sb, { filename: 'boxpreview.js' }); setTimeout(() => c.onload && c.onload(), 0); } return c; };
    vm.runInContext(PAGE, sb, { filename: 'page.js' });
    for (let i = 0; i < 100 && !/preview of/.test(doc.getElementById('wwLine').textContent); i++) await new Promise(r => setTimeout(r, 5));
    return { $: doc.getElementById, reqs, asked, head, mem };
  }
  {
    const b = await boot('?l=north', null);
    const box = b.reqs.filter(u => /^team_game_stats\?/.test(u));
    ok('no teaser: the page loads boxpreview.js at its own ?v= and reads the finished games and their box scores', b.head.children.some(c => c.src === 'boxpreview.js?v=42') &&
       b.reqs.some(u => /^games\?status=eq\.final&select=id,home_score,away_score,competitions\(seasons\(name,leagues\(id,name,slug,country\)\)\)$/.test(u)) && box.length >= 1, b.reqs.join(' | '));
    ok('...150 games to a request, eighteen measures by their paths (winning.js SELECT), never the blob', box.every(u => u.endsWith('&select=' + WN.SELECT) && /\(([^)]*)\)/.exec(u)[1].split(',').length <= 150));
    ok('...the teaser was asked first, and only then the box scores', b.asked.indexOf('teaser') >= 0);
    const cards = b.$('wwCards').innerHTML, n = games.filter(g => g.competitions.seasons.leagues.slug === 'north').length;
    ok('...the short answer is drawn from it, for the picked league (?l=)', /class="ww-card"/.test(cards) && /data-lens="preview"/.test(cards) && cards.includes('Across ' + n + ' games') &&
       b.$('wwLine').textContent === 'Box-score preview of ' + n + ' games', b.$('wwLine').textContent + ' ' + cards.slice(0, 200));
    ok('...the measures are drawn from it too', /data-chart="0"/.test(b.$('factorsB').innerHTML) && /data-lens="preview"/.test(b.$('factorsB').innerHTML));
    ok('...and the full model is said to switch on once built, not "could not be reached"', cards.includes('The full model switches on once it has been built') && !cards.includes('could not be reached') &&
       /full model switches on/.test(b.$('wwAsof').textContent));
    ok('...the members\' sections keep their placeholders', /data-memlock/.test(b.$('valueB').innerHTML));
    ok('...kept in sessionStorage under the reader\'s epinoia_ww: key, never localStorage', [...b.mem.keys()].some(k => k === 'epinoia_ww:anon:box:all:current:-'));
  }
  {
    const T = { scope: 'teaser', w: 1, token: 't1', built: '2026-09-30T10:00:00Z', n: 50, homeWin: 0.55, ranked: [{ k: 'efg', label: 'effective field goal %', r: 0.5, winRate: 0.7 }, { k: 'ts', label: 'true shooting %', r: 0.45, winRate: 0.68 }], leagues: [] };
    const b = await boot('', T);
    ok('a teaser there: no box score is read and boxpreview.js is never loaded', !b.reqs.some(u => /team_game_stats|^games\?/.test(u)) && !b.head.children.some(c => /boxpreview/.test(c.src || '')), b.reqs.join(' | '));
    ok('...and the short answer words the teaser', /data-lens="preview"/.test(b.$('wwCards').innerHTML) && b.$('wwLine').textContent === 'Box-score preview of 50 games');
  }
})();

/* ------------------------------------------------------------------ real files, if given --- */
if (process.env.WW_PAGE_FILES) drawFiles(path.resolve(process.env.WW_PAGE_FILES), path.basename(path.resolve(process.env.WW_PAGE_FILES)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
