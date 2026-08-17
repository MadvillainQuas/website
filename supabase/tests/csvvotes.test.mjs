/* The two pure functions behind the official-votes paste box. Both are places
   a real spreadsheet breaks a naive parser: a club with a comma in its name,
   and a surname carrying accents in one system and not in another. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../league/admin/awards-ui.js', import.meta.url), 'utf8');
const mod = { exports: {} };
new Function('module', 'exports', src)(mod, mod.exports);
const { splitCsv, norm } = mod.exports;

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('plain row', () => {
  assert.deepEqual(splitCsv('Head of Officiating,1,Jo Bloggs,Sam Smith'),
    ['Head of Officiating', '1', 'Jo Bloggs', 'Sam Smith']);
});

t('a quoted cell keeps its comma', () => {
  assert.deepEqual(splitCsv('"Smith, A",2,Jo Bloggs'),
    ['Smith, A', '2', 'Jo Bloggs']);
});

t('a doubled quote is one quote', () => {
  assert.deepEqual(splitCsv('"He said ""no""",1,X'),
    ['He said "no"', '1', 'X']);
});

t('tabs separate too, so a paste straight out of a sheet works', () => {
  assert.deepEqual(splitCsv('Voter\t1\tJo Bloggs'), ['Voter', '1', 'Jo Bloggs']);
});

t('an empty trailing cell survives rather than vanishing', () => {
  assert.deepEqual(splitCsv('A,1,'), ['A', '1', '']);
});

t('names fold to the same key across accents, case and spacing', () => {
  assert.equal(norm('Šarić'), norm('Saric'));
  assert.equal(norm('  JO   BLOGGS '), norm('Jo Bloggs'));
  assert.equal(norm('Müller'), norm('Muller'));
});

t('different people do not fold together', () => {
  assert.notEqual(norm('Jo Bloggs'), norm('Joe Bloggs'));
});

console.log('csv votes: ' + n + ' checks passed');
