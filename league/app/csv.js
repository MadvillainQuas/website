'use strict';
/* ============================================================================
   ROSTER CSV — parsing, column mapping and validation.

   Kept separate from the UI and free of any DOM so it can be tested directly,
   which matters more here than in most places: this is the one path where a
   manager hands us twenty players at once and a quiet mistake becomes twenty
   wrong rows instead of one.

   Three jobs, in order:

     PARSE     real CSV, not split(','). Quoted fields containing commas and
               newlines are normal in exported team sheets, and a naive split
               turns "Byrne, Silas" into two broken columns.
     MAP       work out which column is which, because nobody's export agrees.
               A header called "No", "#", "Number" and "Jersey" is the same
               column, and a sheet with one "Name" column is as common as one
               with "First"/"Last".
     VALIDATE  say what is wrong per row BEFORE anything is written, since a
               half-applied import is worse than a refused one.

   On safeguarding: a player's minor status is derived from birth year and
   OR-ed with any explicit column. A CSV can mark someone a minor; it can
   never clear the flag, because the consequence of being wrong in that
   direction is a child's photograph being publishable.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideCSV = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* --------------------------------------------------------------- parsing ---
   A hand-written scanner rather than a regex: quoted fields can contain the
   delimiter, the line ending, and escaped quotes ("" inside a quoted field),
   and no single regex reads all three correctly. */
function parse(text, delimiter) {
  if (text == null) return [];
  let s = String(text);
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);      // Excel's UTF-8 BOM
  const d = delimiter || sniff(s);

  const rows = [];
  let row = [], field = '', quoted = false, i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }   // escaped quote
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === d) { endField(); i++; continue; }
    if (c === '\r') { i++; continue; }                 // CRLF and lone CR both
    if (c === '\n') { endRow(); i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) endRow();

  /* a trailing newline should not become a row of one empty string */
  return rows.filter(r => r.length > 1 || (r[0] != null && r[0].trim() !== ''));
}

/* Excel in a European locale writes semicolons; exports from stat software
   often write tabs. Count candidates on the header line and take the winner. */
function sniff(s) {
  const line = s.split(/\r?\n/)[0] || '';
  const counts = [[',', 0], [';', 0], ['\t', 0], ['|', 0]];
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; continue; }
    if (quoted) continue;
    const hit = counts.find(c => c[0] === ch);
    if (hit) hit[1]++;
  }
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] ? counts[0][0] : ',';
}

/* ---------------------------------------------------------------- mapping --- */
const norm = h => String(h == null ? '' : h)
  .toLowerCase().replace(/[^a-z0-9]/g, '');

/* Headers that are pure punctuation survive nothing — "#" is the single most
   common jersey header there is and normalising it leaves an empty string, so
   it is resolved before the alphanumeric pass rather than dropped. */
const SYMBOL = { '#': 'jersey', '##': 'jersey', 'no.': 'jersey', '№': 'jersey' };

/* every spelling of a column anyone has actually exported */
const ALIASES = {
  jersey:  ['jersey', 'jerseyno', 'jerseynumber', 'number', 'no', 'num', 'shirt',
            'shirtno', 'squadno', 'n', 'nr'],
  first:   ['first', 'firstname', 'forename', 'given', 'givenname', 'fname'],
  last:    ['last', 'lastname', 'surname', 'family', 'familyname', 'lname'],
  name:    ['name', 'player', 'fullname', 'playername', 'athlete'],
  year:    ['birthyear', 'year', 'yob', 'yearofbirth', 'born', 'birth', 'dob',
            'dateofbirth', 'birthdate'],
  position:['position', 'pos', 'role'],
  minor:   ['minor', 'isminor', 'u18', 'under18', 'junior', 'youth'],
  height:  ['height', 'ht', 'cm', 'heightcm']
};

function mapHeaders(header) {
  const map = {};
  (header || []).forEach((h, i) => {
    const sym = SYMBOL[String(h == null ? '' : h).trim().toLowerCase()];
    if (sym) { if (map[sym] == null) map[sym] = i; return; }
    const n = norm(h);
    if (!n) return;
    for (const key of Object.keys(ALIASES)) {
      if (map[key] != null) continue;
      if (ALIASES[key].indexOf(n) !== -1) { map[key] = i; return; }
    }
  });
  return map;
}

/* Does row 0 look like headers, or is this a headerless sheet?

   Requiring two recognised columns is too strict — a sheet whose only header
   is "Name" is perfectly ordinary, and treating it as data costs that file its
   first player. Requiring one is too loose, because a data row like
   "7,Player,One" contains the word "player".

   So: two or more recognised columns is a header outright; one is a header
   only if no cell is a bare number, since a jersey in row 0 means row 0 is a
   player. */
function hasHeader(rows) {
  if (!rows.length) return false;
  const hits = Object.keys(mapHeaders(rows[0])).length;
  if (hits >= 2) return true;
  if (hits < 1) return false;
  return !rows[0].some(c => /^\s*\d+\s*$/.test(String(c == null ? '' : c)));
}

/* ------------------------------------------------------------------ names --- */
/* "Byrne, Silas" and "Silas Byrne" are both normal. A comma is the reliable
   signal of surname-first; without one, the LAST token is the surname, which
   is right for the overwhelming majority and wrong in a way a manager can see
   and fix in the preview. */
function splitName(full) {
  const s = String(full || '').trim().replace(/\s+/g, ' ');
  if (!s) return { first: '', last: '' };
  if (s.indexOf(',') !== -1) {
    const [a, b] = s.split(',', 2);
    return { first: (b || '').trim(), last: (a || '').trim() };
  }
  const parts = s.split(' ');
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

/* fold accents and case so "Kovács" re-imports as the same person as "Kovacs" */
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');
const nameKey = (first, last) => fold(first) + '|' + fold(last);

/* ------------------------------------------------------------------- year --- */
/* Accepts a bare year, or a full date in any of the three orders people use.
   A full date is REDUCED TO ITS YEAR and the rest discarded — the schema
   deliberately holds birth year only, and a date of birth is personal data
   this platform has no reason to keep. */
function birthYear(raw, thisYear) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  const now = thisYear || 2026;

  let m = s.match(/^(\d{4})$/);
  if (m) return within(+m[1]);

  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);        // ISO
  if (m) return within(+m[1]);

  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);         // d/m/Y or m/d/Y
  if (m) return within(+m[3]);

  m = s.match(/(\d{4})/);                                        // last resort
  if (m) return within(+m[1]);
  return NaN;                                                    // present but unreadable

  function within(y) { return (y >= 1900 && y <= now) ? y : NaN; }
}

const TRUE = ['1', 'y', 'yes', 'true', 't', 'minor', 'u18', 'junior'];
const truthy = v => TRUE.indexOf(String(v == null ? '' : v).trim().toLowerCase()) !== -1;

/* ------------------------------------------------------------- the import ---
   opts: { text, existing:[{name, jersey, playerId}], thisYear, minorAge }
   Returns { rows, header, map, delimiter, counts } with every row carrying its
   own verdict, so the preview can show exactly what will happen line by line. */
function build(opts) {
  const o = opts || {};
  const delimiter = o.delimiter || sniff(String(o.text || ''));
  const raw = parse(o.text, delimiter);
  const thisYear = o.thisYear || new Date().getFullYear();
  const minorAge = o.minorAge == null ? 18 : o.minorAge;

  if (!raw.length) {
    return { rows: [], header: [], map: {}, delimiter,
             counts: { add: 0, existing: 0, error: 0 }, empty: true };
  }

  const headed = hasHeader(raw);
  const header = headed ? raw[0] : [];
  const body = headed ? raw.slice(1) : raw;
  /* with no header, fall back to the order a hand-typed sheet is written in */
  const map = headed ? mapHeaders(header) : { jersey: 0, first: 1, last: 2, year: 3 };

  /* what is already on this roster, so a re-import updates rather than doubles */
  const byName = new Map(), byJersey = new Map();
  (o.existing || []).forEach(e => {
    const n = splitName(e.name);
    byName.set(nameKey(n.first, n.last), e);
    if (e.jersey != null && String(e.jersey).trim() !== '') {
      byJersey.set(String(e.jersey).trim(), e);
    }
  });

  const seenName = new Map(), seenJersey = new Map();
  const rows = [];

  body.forEach((cells, idx) => {
    const cell = k => (map[k] == null ? '' : String(cells[map[k]] == null ? '' : cells[map[k]]).trim());

    let first = cell('first'), last = cell('last');
    if (!first && !last && map.name != null) {
      const n = splitName(cell('name'));
      first = n.first; last = n.last;
    }
    /* a "first" column holding a whole name is common enough to handle */
    if (first && !last && /\s|,/.test(first)) {
      const n = splitName(first); first = n.first; last = n.last;
    }

    const jersey = cell('jersey');
    const yearRaw = cell('year');
    const year = birthYear(yearRaw, thisYear);
    const explicitMinor = map.minor != null && truthy(cell('minor'));

    const r = {
      line: idx + (headed ? 2 : 1),          // the line number in their file
      first, last, jersey,
      position: cell('position') || null,
      birth_year: (year && !Number.isNaN(year)) ? year : null,
      errors: [], warnings: [],
      action: 'add', match: null
    };

    /* under-18 by age OR by declaration; never cleared by the file */
    const impliedMinor = r.birth_year ? (thisYear - r.birth_year) < minorAge : false;
    r.is_minor = explicitMinor || impliedMinor;

    if (!first && !last) r.errors.push('no name');

    /* A name that is only digits means the row is short and the columns have
       slid left — the classic cause is a quoted "Surname, Forename" written
       without the empty column beside it. Creating a player called "1998" is
       exactly the silent nonsense this preview exists to prevent, so it is
       refused with the reason rather than passed through. */
    const numericName = [first, last].filter(Boolean).some(v => /^\d+$/.test(v));
    if (numericName) {
      r.errors.push('the columns look misaligned on this line — a name reads as a number');
    } else if (headed && cells.length < header.length) {
      r.warnings.push('only ' + cells.length + ' of ' + header.length + ' columns on this line');
    }

    if (yearRaw && Number.isNaN(year)) r.warnings.push('birth year "' + yearRaw + '" not understood — left blank');
    if (jersey && !/^\d{1,2}$/.test(jersey)) r.warnings.push('jersey "' + jersey + '" is not 0–99');

    const key = nameKey(first, last);

    /* duplicates WITHIN the file are an error: we cannot know which is meant */
    if (key !== '|' && seenName.has(key)) {
      r.errors.push('same name as line ' + seenName.get(key));
    } else if (key !== '|') seenName.set(key, r.line);

    if (jersey) {
      if (seenJersey.has(jersey)) r.errors.push('jersey ' + jersey + ' also on line ' + seenJersey.get(jersey));
      else seenJersey.set(jersey, r.line);
    }

    /* already on this roster? then this row updates, and importantly does NOT
       create a second player record for the same person */
    const hit = key !== '|' ? byName.get(key) : null;
    if (hit) {
      r.action = 'existing'; r.match = hit;
      if (jersey && String(hit.jersey || '') !== jersey) {
        r.warnings.push('jersey changes ' + (hit.jersey || '–') + ' → ' + jersey);
        r.action = 'update';
      }
    } else if (jersey && byJersey.has(jersey)) {
      /* a number already worn by somebody else on the roster */
      r.warnings.push('jersey ' + jersey + ' is currently ' + byJersey.get(jersey).name);
    }

    if (r.errors.length) r.action = 'error';
    rows.push(r);
  });

  const counts = {
    add:      rows.filter(r => r.action === 'add').length,
    update:   rows.filter(r => r.action === 'update').length,
    existing: rows.filter(r => r.action === 'existing').length,
    error:    rows.filter(r => r.action === 'error').length
  };
  return { rows, header, map, delimiter, counts, headed };
}

return { parse, sniff, mapHeaders, hasHeader, splitName, birthYear, build,
         nameKey, fold };
}));
