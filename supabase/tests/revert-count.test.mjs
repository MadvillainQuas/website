/* ============================================================================
   "BACK TO LISTING" MUST SURVIVE THE DATABASE BEING OLDER THAN THE CLIENT.

   revert_game refuses to discard an event log unless told to explicitly, and
   answers with how many events it would destroy. That number goes into the
   confirmation dialog, so a person is never asked to agree to "discard the
   events" without being told how many there are.

   It arrives in two places:

       exception DETAIL   a bare integer      — added by migration 0067/0068
       exception MESSAGE  "...has N recorded event(s)..."  — always been there

   DETAIL is the right thing to read: it is a machine-readable field that no
   one will reword for tone. So the client was changed to read only DETAIL —
   and that turned "back to listing" into a DEAD BUTTON on the live site,
   because the JavaScript shipped while the migration had not been applied
   yet. The refusal came back, the count was not in the field the client
   looked in, the confirmation never opened, and the user got a raw error
   alert instead. A correct change to one half of a system that deploys in
   two halves.

   So both are read, DETAIL first. And because BOTH the public box score and
   the admin console show this dialog, they have to agree about the answer —
   two copies of this logic that disagree is how one of them silently rots.

   This test pulls the real implementations out of both files and runs them
   over the same cases, including the "database is older than the client"
   case that broke it.

       node supabase/tests/revert-count.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));

const fail = (m) => { console.error('revert-count: ' + m); process.exit(1); };

/* ---- lift the two implementations out of the two files ------------------- */
const boxSrc = fs.readFileSync(path.join(ROOT, 'epinoia', 'game', 'game.js'), 'utf8');
const admSrc = fs.readFileSync(path.join(ROOT, 'epinoia', 'admin', 'governance-ui.js'), 'utf8');

const boxMatch = /function eventCountFromRefusal\(body\)\s*\{[\s\S]*?\n\}/.exec(boxSrc);
if (!boxMatch) fail('could not find eventCountFromRefusal() in epinoia/game/game.js');

const admMatch = /function \(e\) \{\s*\n\s*const d = e\.details;[\s\S]*?\n      \}/.exec(admSrc);
if (!admMatch) fail('could not find the count reader in epinoia/admin/governance-ui.js — ' +
                    'if it was refactored, update this test rather than deleting it');

const boxRead = eval('(' + boxMatch[0].replace(/^function eventCountFromRefusal/, 'function') + ')');
const admRead = eval('(' + admMatch[0] + ')');

/* ---- the cases ----------------------------------------------------------- */
const PROSE = 'that game has 7 recorded event(s). Reverting discards them ' +
              'permanently — call again confirming the discard if that is what you mean.';

const cases = [
  ['migration applied — DETAIL carries the count',
    { details: '7', message: PROSE }, '7'],
  ['MIGRATION NOT APPLIED — the sentence still carries it (the regression)',
    { details: null, message: PROSE }, '7'],
  ['a single event reads as 1, not 1s',
    { details: '1', message: 'that game has 1 recorded event(s).' }, '1'],
  ['not an administrator — no count, so no confirmation is offered',
    { details: null, message: 'you do not administer that game' }, null],
  ['a final game — refused outright, not behind a confirmation',
    { details: null, message: 'that game is final — its result is in the standings' }, null],
  ['no body at all',
    null, null],
  ['a DETAIL that is not a number falls back to the sentence',
    { details: 'oops', message: 'that game has 4 recorded event(s).' }, '4'],
  ['DETAIL with whitespace is still a number',
    { details: ' 12 ', message: PROSE }, '12'],
];

let bad = 0;
for (const [name, body, want] of cases) {
  const b = boxRead(body);
  const a = admRead(body || {});
  const ok = b === want && a === want;
  if (!ok) bad++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
    (ok ? '' : `\n         box score -> ${JSON.stringify(b)}, admin -> ${JSON.stringify(a)}, expected ${JSON.stringify(want)}`));
}

if (bad) {
  fail(bad + ' case(s) failed — the two "back to listing" dialogs disagree, or one of ' +
       'them cannot read the count from a database that predates migration 0067.');
}

console.log('revert-count: the box score and the admin console agree on all ' +
            cases.length + ' cases, with and without the migration applied');
