/* The names under the faces on the modern box score.

   A surname is only a name while it is the only one. These are the cases that decide whether a
   circle names a player or merely labels him: two Garcias on the floor together, two Halbwachs
   brothers, and the pair that share a first name as well and have nothing left but a shirt.

       node supabase/tests/modern-names.test.mjs
*/
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

/* the module is an IIFE that hangs itself on window; give it one and take the labeller back */
const src = readFileSync(new URL('../../epinoia/game/modern.js', import.meta.url), 'utf8');
const win = {};
const sandbox = { window: win, document: { addEventListener() {} }, setTimeout, clearTimeout };
new Function('window', 'document', 'setTimeout', 'clearTimeout', src)
  .call(null, sandbox.window, sandbox.document, setTimeout, clearTimeout);
const nameLabels = win.EpinoiaModernBox && win.EpinoiaModernBox.nameLabels;
assert.equal(typeof nameLabels, 'function', 'nameLabels is reachable');

let pass = 0, fail = 0;
const ok = (what, got, want) => {
  if (got === want) { pass++; console.log('  PASS  ' + what); }
  else { fail++; console.log('  FAIL  ' + what + ': got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)); }
};

const P = (id, name, num) => ({ id, name, num });

console.log('-- a surname nobody shares is the whole label');
let L = nameLabels([P(1, 'Tao Halbwachs', 19), P(2, 'Kilyan Bader', 9), P(3, 'Ioannis Vidale', 21)]);
ok('one Halbwachs', L[1], 'Halbwachs');
ok('one Bader', L[2], 'Bader');

console.log('\n-- two players who share it get the least first name that separates them');
L = nameLabels([P(1, 'Tao Halbwachs', 19), P(2, 'Marc Halbwachs', 7)]);
ok('T. Halbwachs', L[1], 'T. Halbwachs');
ok('M. Halbwachs', L[2], 'M. Halbwachs');

console.log('\n-- ...and when one initial is not enough, two letters, then three');
L = nameLabels([P(1, 'Tao Halbwachs', 19), P(2, 'Theo Halbwachs', 7)]);
ok('Ta. Halbwachs', L[1], 'Ta. Halbwachs');
ok('Th. Halbwachs', L[2], 'Th. Halbwachs');
L = nameLabels([P(1, 'Thomas Jacquet', 4), P(2, 'Thibaut Jacquet', 5)]);
ok('Tho. Jacquet', L[1], 'Tho. Jacquet');
ok('Thi. Jacquet', L[2], 'Thi. Jacquet');

console.log('\n-- three at once, and only as long as it has to be');
L = nameLabels([P(1, 'Tao Garcia', 1), P(2, 'Marc Garcia', 2), P(3, 'Tomas Garcia', 3)]);
ok('T and To still need two letters', L[1], 'Ta. Garcia');
ok('Marc needs only one, but the group agrees on a length', L[2], 'Ma. Garcia');
ok('Tomas', L[3], 'To. Garcia');

console.log('\n-- the same first name as well: the shirt is what is left');
L = nameLabels([P(1, 'Tao Halbwachs', 19), P(2, 'Tao Halbwachs', 7)]);
ok('numbered', L[1], '#19 Halbwachs');
ok('numbered', L[2], '#7 Halbwachs');

console.log('\n-- accents are folded for the COMPARISON and kept in the label');
L = nameLabels([P(1, 'Luis Peña', 4), P(2, 'Marc Pena', 5)]);
ok('Pena and Peña are the same surname to a reader', L[1], 'L. Peña');
ok('...and the label keeps its accent', L[2], 'M. Pena');

console.log('\n-- the awkward ones do not throw');
L = nameLabels([P(1, 'Cher', 1), P(2, 'Cher', 2)]);
ok('one name, shared', L[1], '#1 Cher');
L = nameLabels([P(1, 'Nael El Moussaoui', 28)]);
ok('a multi-word surname keeps its last word', L[1], 'Moussaoui');
L = nameLabels([P(1, 'Ray Allen Jr.', 3)]);
ok('a suffix is not the surname', L[1], 'Allen');
L = nameLabels([P(1, '', 3)]);
ok('no name at all', L[1], '?');

console.log('\n-- and it never returns something too long to read');
L = nameLabels([P(1, 'Jean-Baptiste Vanderbeken-Delacroix', 11)]);
ok('a long surname is still the surname', L[1], 'Vanderbeken-Delacroix');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
