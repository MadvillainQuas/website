/* ============================================================================
   A HIDDEN NAV ROW MUST ACTUALLY BE HIDDEN.

   The rail hides its role-gated rows — "score a game", "club portal", "league
   admin", "admin controls", "platform" — the only way a script can: it sets
   node.hidden = true. The browser honours that through the UA rule

       [hidden]{ display:none }

   which carries a specificity of (0,1,0). nav.css then styles the same rows

       .ep-nav a.item, .ep-nav button.item{ display:flex; … }

   at (0,2,1). The stylesheet outranked the attribute, so every gated row was
   painted for everybody: signed out, or signed in with no roles at all,
   whatever whoami() answered. applyAuth() was correct and failed closed on an
   error exactly as designed — the attribute it set simply had no effect, so
   nothing downstream of it could work either.

   Nothing was actionable through those links (row-level security refuses every
   write behind them, and each console renders empty without the role), so this
   disclosed that the doors exist rather than anything behind them. It still
   told an account it held rights it did not hold.

   THE SHAPE IS WHAT RECURS, not this one selector: a gate expressed as an
   attribute, defeated by a rule written later for layout. So this test does not
   check that one line exists — it checks the INVARIANT, that whatever display
   rules nav.css carries, a [hidden] guard outranks all of them.

       node supabase/tests/nav-gating.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const css = fs.readFileSync(path.join(ROOT, 'epinoia', 'kit', 'nav.css'), 'utf8');
const js  = fs.readFileSync(path.join(ROOT, 'epinoia', 'nav.js'), 'utf8');

const fail = m => { console.error('nav-gating: ' + m); process.exit(1); };

/* strip comments so prose about the bug is never mistaken for the fix */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

/* 1. the guard exists, is scoped to the rail, and is !important — the rows'
      display is set again in the phone bar and a third time in the open
      drawer, so anything weaker only holds at whichever width was tested */
const guard = /\.ep-nav\s+\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/i.test(bare);
if (!guard) {
  fail('nav.css has no `.ep-nav [hidden]{ display:none !important }` guard.\n' +
       '  Without it, `.ep-nav a.item{display:flex}` (0,2,1) outranks the UA rule\n' +
       '  `[hidden]{display:none}` (0,1,0) and every role-gated row is painted for\n' +
       '  everybody — signed out included. Restore the guard.');
}

/* 2. every gated row still starts hidden, so a slow or failed whoami() cannot
      flash them and cannot leave them shown */
const gatedRows = (js.match(/\.hidden\s*=\s*true/g) || []).length;
if (gatedRows < 3) {
  fail('nav.js sets .hidden = true on only ' + gatedRows + ' node(s).\n' +
       '  The gated rows must start hidden and be revealed by whoami(), not the reverse.');
}

/* 3. and the role check fails CLOSED: a whoami() that throws must leave the
      predicates reading an empty object, never be skipped */
if (!/catch\s*\([^)]*\)\s*\{\s*who\s*=\s*\{\s*\}\s*;?\s*\}/.test(js)) {
  fail('nav.js no longer falls back to an empty whoami() on error.\n' +
       '  A failed role lookup must hide everything, not reveal it.');
}

console.log('nav-gating: the [hidden] guard outranks nav.css layout, rows start hidden, ' +
            'and a failed whoami() fails closed');
