/* ============================================================================
   Generates league/boxscore.js by lifting the scorer's own render functions
   out of league/score/index.html, verbatim.

     node supabase/tests/extract-boxscore.mjs          # write
     node supabase/tests/extract-boxscore.mjs --check  # fail if out of date

   Why a copy rather than a shared import: the brief was to leave the scorer
   structurally alone. Deleting 500 lines out of a 3,400-line inline script to
   re-import them is exactly the kind of edit that breaks a working app in a
   way nobody notices until a game night. So the scorer keeps its definitions
   and this lifts them out byte-for-byte; --check runs in CI, so the two cannot
   drift without the build going red.

   The public box score therefore renders through the same code that draws the
   statistician's final screen — not a reimplementation that agrees today and
   disagrees after the next tweak.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const SRC  = path.join(ROOT, 'league', 'score', 'index.html');
const DEST = path.join(ROOT, 'league', 'boxscore.js');
const CSS  = path.join(ROOT, 'league', 'boxscore.css');

/* Pure helpers and pure HTML builders. Everything here takes data and returns
   a string or a number — nothing touches the DOM or the scorer's UI state. */
const WANTED = [
  // primitives the renderers lean on
  'PLEN', 'PMAP', 'ADV_GROUPS', 'advSort',   // advSort's line also declares advHidden
  'esc', 'COLOUR_OK', 'safeColour',
  'perName', 'fmtClock', 'fmtMin', 'tname', 'pname',
  'mkP', 'mkOC', 'mkBox', 'mkT', 'cumEl', 'activeTags', 'courtSVG',
  // calculators
  'teamTotals', 'teamAdv', 'playerAdv', 'playerAdvTable', 'lineupAgg',
  // HTML builders
  'scoreHeadHTML', 'qstripHTML', 'teamChipsHTML', 'bxTeamHTML', 'pbpHTML',
  'shotChartHTML', 'advHTML', 'luNames', 'lineupsHTML'
];

const src = fs.readFileSync(SRC, 'utf8');

/* Line-anchored extraction: from the `function name(` line to the line before
   the next top-level declaration.

   Character-level brace matching was tried first and is the wrong tool without
   a real parser — esc() contains the regex /"/g, and a scanner that cannot
   tell a regex from a division reads that quote as the start of a string and
   swallows the rest of the file. Every function here is declared at column 0
   in a consistently formatted file, so the line anchor is both simpler and
   more reliable. The vm.Script parse below is the safety net. */
const LINES = src.split('\n');
const TOP = /^(function |const |let |var |\/\* |\$\(|document\.|window\.|if \(|\/\/ =)/;

function extractLines(name) {
  // the scorer declares these four ways; PMAP is a `let` because it is rebuilt
  const decl = new RegExp(`^(function ${name}\\s*\\(|(?:const|let|var) ${name}\\s*=)`);
  const start = LINES.findIndex(l => decl.test(l));
  if (start < 0) throw new Error(`${name} not found in ${path.basename(SRC)}`);
  let end = start + 1;
  while (end < LINES.length && !TOP.test(LINES[end])) end++;
  // drop trailing blank lines and any comment banner belonging to what follows
  let body = LINES.slice(start, end);
  while (body.length > 1 && /^\s*$|^\s*\/\*|^\s*\/\//.test(body[body.length - 1])) body.pop();
  return body.join('\n');
}

const bodies = WANTED.map(extractLines);

const out = `/* ============================================================================
   EPINOIA BOX SCORE — GENERATED FILE, DO NOT EDIT.

   Lifted verbatim from league/score/index.html by
   supabase/tests/extract-boxscore.mjs. Edit the scorer, then re-run:

       node supabase/tests/extract-boxscore.mjs

   CI runs it with --check, so this file cannot fall behind the scorer.

   These are the same functions that draw the statistician's final screen, so
   the public box score is not a second implementation that has to be kept in
   agreement — it is the same code over the same event log.

   Callers must supply two globals the scorer provides for itself:
     S        the game state  {teams, starters, period, clockMs, events, …}
     derive() the replayed game, in the shape league/engine.js returns
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaBox = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
'use strict';

/* S and derive are deliberately NOT declared here. The extracted functions
   read them as free variables, so they resolve to whatever the host page has
   defined at call time — the scorer's own state in the scorer, and the
   replayed game in the viewer. Declaring them here would shadow both. */

${bodies.join('\n\n')}

/* Not lifted from the scorer: PMAP is a mutable pid -> {team, player} lookup
   that the scorer refills in buildPmap(), which also writes CSS custom
   properties to the document. Only the lookup half belongs here, so this is
   that half. Call it after setting S and before rendering. */
function rebuildPmap() {
  PMAP = {};
  S.teams.forEach((tm, t) => tm.players.forEach(p => { PMAP[p.id] = { team: t, p }; }));
  return PMAP;
}

return { ${WANTED.join(', ')}, rebuildPmap };
}));
`;

/* The scorer's stylesheet, lifted whole. The extracted renderers emit the
   scorer's own class names, so the viewer needs the scorer's own rules to draw
   them — anything less and "identical box score" would mean identical numbers
   in different clothes. Paths are rewritten because the viewer sits one
   directory deeper than the scorer does. */
const styleStart = src.indexOf('<style>');
const styleEnd   = src.indexOf('</style>', styleStart);
if (styleStart < 0 || styleEnd < 0) { console.error('no <style> block in the scorer'); process.exit(1); }
const css = `/* GENERATED from league/score/index.html by supabase/tests/extract-boxscore.mjs.
   DO NOT EDIT — edit the scorer's <style> block and re-run the extractor.
   These are the scorer's own rules, so the public box score is drawn by the
   same CSS as the statistician's final screen. */
` + src.slice(styleStart + 7, styleEnd).replace(/\.\.\/kit\/fonts\//g, 'kit/fonts/') + `

/* ==========================================================================
   APPENDED BY THE EXTRACTOR — undo the scorer's application shell.

   The scorer is a fixed-viewport app: body is position:fixed, inset:0,
   overflow:hidden, overscroll-behavior:none, user-select:none. Every one of
   those is correct for a scoring surface — it must not scroll under a thumb
   mid-gesture, and selecting text instead of registering a tap loses a stat.

   Every one of them is wrong for a public box score, which is a document. It
   has five tabs of tables that are taller than any phone, so it has to scroll,
   and a reader has to be able to select a number to copy it out.

   The rules above are left exactly as the scorer writes them so the file stays
   a faithful lift; they are overridden here instead of edited out.
   ========================================================================== */
html, body{
  position:static; inset:auto; overflow:visible; height:auto;
  overscroll-behavior:auto;
  -webkit-user-select:text; user-select:text; -webkit-touch-callout:default;
}
/* the two decorative backdrops stay pinned; they are painted, not laid out */
body::before, body::after{ position:fixed; }
`;

/* The authoritative check that the extraction took the right extent is whether
   the result parses — with the engine's own parser, not a hand-rolled one.
   vm.Script compiles without running a line of it. */
try { new vm.Script(out, { filename: 'boxscore.js' }); }
catch (e) { console.error('extraction produced unparseable output:', e.message); process.exit(1); }

if (process.argv.includes('--check')) {
  const have = fs.existsSync(DEST) ? fs.readFileSync(DEST, 'utf8') : '';
  if (have !== out) {
    console.error('league/boxscore.js is out of date with the scorer.');
    console.error('Run: node supabase/tests/extract-boxscore.mjs');
    process.exitCode = 1;
  } else {
    const haveCss = fs.existsSync(CSS) ? fs.readFileSync(CSS, 'utf8') : '';
    if (haveCss !== css) {
      console.error('league/boxscore.css is out of date with the scorer.');
      console.error('Run: node supabase/tests/extract-boxscore.mjs');
      process.exitCode = 1;
    } else {
      console.log('boxscore.js + boxscore.css match the scorer (' + WANTED.length + ' functions)');
    }
  }
} else {
  fs.writeFileSync(DEST, out);
  fs.writeFileSync(CSS, css);
  console.log('wrote', path.relative(ROOT, DEST), '—', WANTED.length, 'functions,',
              (out.length / 1024).toFixed(0) + 'KB');
  console.log('wrote', path.relative(ROOT, CSS), '—', (css.length / 1024).toFixed(0) + 'KB');
}
