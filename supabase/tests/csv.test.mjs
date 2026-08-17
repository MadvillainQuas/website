/* ============================================================================
   Roster CSV import — parsing, mapping and validation.

   This module is the one place a manager hands us twenty players at once, so a
   quiet misparse becomes twenty wrong rows rather than one. Everything here is
   a shape somebody's export actually produces: Excel's BOM, European
   semicolons, quoted commas inside names, surname-first ordering, a single
   "Name" column, a headerless sheet, dates where a year was asked for.
   ============================================================================ */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../../league/app/csv.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + '\n        got  ' + g + '\n        want ' + w); }
};
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '  -> ' + detail : '')); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
};

console.log('\nparsing');

eq('plain rows', C.parse('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
eq('CRLF line endings', C.parse('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
eq('quoted comma stays one field',
   C.parse('name,no\n"Byrne, Silas",4'), [['name', 'no'], ['Byrne, Silas', '4']]);
eq('escaped quotes', C.parse('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
eq('newline inside a quoted field',
   C.parse('a,b\n"one\ntwo",3'), [['a', 'b'], ['one\ntwo', '3']]);
eq('BOM is stripped', C.parse('﻿a,b\n1,2')[0], ['a', 'b']);
eq('trailing newline makes no phantom row', C.parse('a,b\n1,2\n').length, 2);

eq('semicolon delimiter sniffed', C.sniff('name;no;year'), ';');
eq('tab delimiter sniffed', C.sniff('name\tno\tyear'), '\t');
eq('comma wins by default', C.sniff('name'), ',');
eq('delimiter inside quotes does not count',
   C.sniff('"a;b;c;d",e'), ',');
eq('semicolon file parses into columns',
   C.parse('name;no\nByrne;4'), [['name', 'no'], ['Byrne', '4']]);

console.log('\nheader mapping');

eq('# is a jersey column', C.mapHeaders(['#', 'First', 'Last']).jersey, 0);
eq('"No" is a jersey column', C.mapHeaders(['No', 'Name']).jersey, 0);
eq('Surname maps to last', C.mapHeaders(['Forename', 'Surname']).last, 1);
eq('YOB maps to year', C.mapHeaders(['Name', 'YOB']).year, 1);
ok('a data row is not mistaken for a header',
   C.hasHeader([['4', 'Silas', 'Byrne']]) === false);
ok('a real header is detected',
   C.hasHeader([['No', 'First', 'Last']]) === true);

console.log('\nnames');

eq('surname-first with comma', C.splitName('Byrne, Silas'), { first: 'Silas', last: 'Byrne' });
eq('given-first', C.splitName('Silas Byrne'), { first: 'Silas', last: 'Byrne' });
eq('middle names stay with the forename',
   C.splitName('Jean Paul Van Damme').last, 'Damme');
eq('single token', C.splitName('Pelé'), { first: 'Pelé', last: '' });
eq('accents fold together', C.nameKey('Iggy', 'Kovács'), C.nameKey('iggy', 'Kovacs'));

console.log('\nbirth year');

eq('bare year', C.birthYear('2007', 2026), 2007);
eq('ISO date reduced to year', C.birthYear('2007-03-14', 2026), 2007);
eq('UK date reduced to year', C.birthYear('14/03/2007', 2026), 2007);
eq('US date reduced to year', C.birthYear('03/14/2007', 2026), 2007);
eq('empty is null', C.birthYear('', 2026), null);
ok('a future year is refused', Number.isNaN(C.birthYear('2098', 2026)));
ok('an impossible year is refused', Number.isNaN(C.birthYear('1823', 2026)));
ok('unreadable text is refused', Number.isNaN(C.birthYear('last tuesday', 2026)));

console.log('\nthe import as a whole');

{
  const r = C.build({
    text: '#,First,Last,Year\n4,Silas,Byrne,2007\n7,Iggy,Kovacs,1998',
    existing: [], thisYear: 2026
  });
  eq('two players read', r.counts.add, 2);
  eq('jersey read', r.rows[0].jersey, '4');
  eq('birth year read', r.rows[0].birth_year, 2007);
  ok('a 19-year-old is not flagged as a minor', r.rows[0].is_minor === false,
     'born 2007, aged ' + (2026 - 2007) + ' in 2026');
}

{
  /* age 19 is NOT a minor; age 17 is. The boundary is the whole point. */
  const r = C.build({
    text: 'First,Last,Year\nA,One,2007\nB,Two,2010',
    existing: [], thisYear: 2026
  });
  eq('19-year-old is not a minor', r.rows[0].is_minor, false);
  eq('16-year-old is a minor', r.rows[1].is_minor, true);
}

{
  /* A file may declare somebody a minor; it may never clear the flag. */
  const r = C.build({
    text: 'First,Last,Year,Minor\nA,One,2010,no',
    existing: [], thisYear: 2026
  });
  eq('a CSV cannot downgrade a child to an adult', r.rows[0].is_minor, true);

  const r2 = C.build({
    text: 'First,Last,Minor\nB,Two,yes',
    existing: [], thisYear: 2026
  });
  eq('a CSV can declare a minor with no birth year', r2.rows[0].is_minor, true);
}

{
  const r = C.build({
    text: '#,Name\n4,"Byrne, Silas"\n4,"Kovacs, Iggy"',
    existing: [], thisYear: 2026
  });
  eq('a duplicated jersey is an error', r.counts.error, 1);
  ok('the error names the clashing line',
     /line 2/.test(r.rows[1].errors.join(' ')), r.rows[1].errors.join(' '));
}

{
  const r = C.build({
    text: 'First,Last\nSilas,Byrne\nsilas,byrne',
    existing: [], thisYear: 2026
  });
  eq('the same name twice in one file is an error', r.counts.error, 1);
}

{
  /* re-importing the same sheet must not create a second Silas Byrne */
  const existing = [{ name: 'Silas Byrne', jersey: '4', playerId: 'p1' }];
  const r = C.build({
    text: '#,First,Last\n4,Silas,Byrne\n7,Iggy,Kovacs',
    existing, thisYear: 2026
  });
  eq('an existing player is recognised', r.rows[0].action, 'existing');
  eq('and is matched to their record', r.rows[0].match.playerId, 'p1');
  eq('the new player is still added', r.rows[1].action, 'add');
  eq('so a re-import adds only what is new', r.counts.add, 1);
}

{
  const existing = [{ name: 'Silas Byrne', jersey: '4', playerId: 'p1' }];
  const r = C.build({
    text: '#,First,Last\n9,Silas,Byrne',
    existing, thisYear: 2026
  });
  eq('a changed jersey is an update, not a new player', r.rows[0].action, 'update');
  ok('and it says what changes', /4 . 9/.test(r.rows[0].warnings.join(' ')),
     r.rows[0].warnings.join(' '));
}

{
  const existing = [{ name: 'Silas Byrne', jersey: '4', playerId: 'p1' }];
  const r = C.build({
    text: '#,First,Last\n4,Iggy,Kovacs',
    existing, thisYear: 2026
  });
  ok('taking someone else\'s number warns but does not block',
     r.rows[0].action === 'add' && /currently Silas Byrne/.test(r.rows[0].warnings.join(' ')),
     r.rows[0].warnings.join(' '));
}

{
  const r = C.build({ text: '#,First,Last\n4,,\n', existing: [], thisYear: 2026 });
  eq('a nameless row is an error', r.rows[0].errors[0], 'no name');
}

{
  const r = C.build({
    text: '4,Silas,Byrne,2007\n7,Iggy,Kovacs,1998',
    existing: [], thisYear: 2026
  });
  ok('a headerless sheet keeps its first player', r.rows.length === 2, r.rows.length + ' rows');
  eq('and reads it positionally', r.rows[0].last, 'Byrne');
}

{
  const r = C.build({
    text: 'Name\n"Byrne, Silas"\nIggy Kovacs',
    existing: [], thisYear: 2026
  });
  eq('one Name column, surname first',
     { first: r.rows[0].first, last: r.rows[0].last }, { first: 'Silas', last: 'Byrne' });
  eq('one Name column, given first', r.rows[1].last, 'Kovacs');
}

{
  const r = C.build({
    text: 'First,Last,Year\nA,One,nineteen ninety\nB,Two,2005',
    existing: [], thisYear: 2026
  });
  ok('an unreadable year warns rather than failing the row',
     r.rows[0].action === 'add' && r.rows[0].birth_year === null &&
     r.rows[0].warnings.length === 1, r.rows[0].warnings.join(' '));
}

{
  /* the classic ragged row: a quoted "Surname, Forename" with no empty column
     beside it slides the year into the surname slot */
  const r = C.build({
    text: '#,First,Last,Year\n12,"Petrelli, Ronan",1998',
    existing: [], thisYear: 2026
  });
  eq('a misaligned row is refused, not turned into a player called 1998',
     r.rows[0].action, 'error');
  ok('and it says why', /misaligned/.test(r.rows[0].errors.join(' ')),
     r.rows[0].errors.join(' '));
}

{
  /* the same sheet written correctly still reads surname-first */
  const r = C.build({
    text: '#,First,Last,Year\n12,"Petrelli, Ronan",,1998',
    existing: [], thisYear: 2026
  });
  eq('a correctly shaped quoted full name splits',
     { first: r.rows[0].first, last: r.rows[0].last },
     { first: 'Ronan', last: 'Petrelli' });
  eq('and keeps its year', r.rows[0].birth_year, 1998);
}

{
  const r = C.build({
    text: '#,First,Last,Year\n7,Iggy,Kovacs',
    existing: [], thisYear: 2026
  });
  ok('a short row is allowed but noted',
     r.rows[0].action === 'add' && /3 of 4 columns/.test(r.rows[0].warnings.join(' ')),
     r.rows[0].warnings.join(' '));
}

{
  const r = C.build({ text: '', existing: [], thisYear: 2026 });
  ok('an empty file is empty, not an exception', r.empty === true && r.rows.length === 0);
}

{
  const r = C.build({
    text: 'No;First;Last;YOB\n4;Silas;Byrne;2007',
    existing: [], thisYear: 2026
  });
  eq('a European export reads correctly', r.rows[0].last, 'Byrne');
  eq('including its birth year', r.rows[0].birth_year, 2007);
}

{
  const r = C.build({
    text: '  #  , First , Last \n 4 , Silas , Byrne ',
    existing: [], thisYear: 2026
  });
  eq('padding is trimmed from headers and cells', r.rows[0].last, 'Byrne');
  eq('and from the jersey', r.rows[0].jersey, '4');
}


console.log('\nmeasurements');

/* ---- measurements, added with the team-sheet columns (0049) --------------- */
{
  const r = C.build({ text:
    'No,Name,Height,Weight,Wingspan,Previous club\n' +
    '7,Jo Bloggs,198,92,208,Old Town\n' +
    '8,Sam Smith,1.98,203 lb,2.05,Second City\n' +
    "9,Alex Roe,6'6\",,6-9,\n" +
    '10,Pat Fry,nonsense,,,\n' });

  eq('centimetres pass through', r.rows[0].height_cm, 198);
  eq('kilograms pass through', r.rows[0].weight_kg, 92);
  eq('wingspan in cm', r.rows[0].wingspan_cm, 208);
  eq('previous club is read', r.rows[0].previous_club, 'Old Town');

  eq('metres become centimetres', r.rows[1].height_cm, 198);
  eq('pounds become kilograms', r.rows[1].weight_kg, 92);
  eq('a wingspan in metres converts', r.rows[1].wingspan_cm, 205);

  eq('feet and inches convert', r.rows[2].height_cm, 198);
  eq('the 6-9 notation converts', r.rows[2].wingspan_cm, 206);
  eq('a blank weight stays null', r.rows[2].weight_kg, null);

  eq('an unreadable height is null, not a guess', r.rows[3].height_cm, null);
  ok('and it says so', r.rows[3].warnings.some(w => /height/.test(w)),
     'expected a warning about the height');
}

{
  /* A weight of 180 is plausible in either unit, so nothing is inferred from
     the size of the number — only from the unit written beside it. */
  const r = C.build({ text: 'No,Name,Weight\n7,A B,180\n8,C D,180 lbs\n' });
  eq('a bare 180 is kilograms', r.rows[0].weight_kg, 180);
  eq('180 lbs is 82 kg', r.rows[1].weight_kg, 82);
}

{
  /* A wingspan is bounded differently from a height: 110cm is a possible
     child's height reading and an impossible span. */
  const r = C.build({ text: 'No,Name,Wingspan\n7,A B,110\n' });
  eq('an out-of-range wingspan is refused', r.rows[0].wingspan_cm, null);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
