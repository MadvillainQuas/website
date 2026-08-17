/* ============================================================================
   THE UPLOADER'S COLUMN NAMES MUST EXIST.

   epinoia/upload.js inserted `w` and `h` into public.media, whose columns are
   `width` and `height`. PostgREST answered every single upload with

       Could not find the 'h' column of 'media' in the schema cache

   and the media table stood at nought rows — no player photograph, no venue
   picture, no club crest, no league logo had ever been recorded, for as long as
   the pipeline had existed.

   WHY NOTHING CAUGHT IT. The failure is at the last step. The image resizes,
   both files upload to storage and succeed, and only the row that records them
   is refused — so everything reports progress right up until the error, and
   every consumer of media had simply always found it empty, which is
   indistinguishable from "nobody has uploaded anything yet".

   This is the cheapest check that would have caught it: read the keys the
   client actually inserts, read the columns the migration actually declares,
   and compare. No network and no database, so it runs anywhere the rest of the
   tests do.

       node supabase/tests/media-columns.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));

const fail = (m) => { console.error('media-columns: ' + m); process.exit(1); };

/* ---- what the migration declares ---------------------------------------- */
const initSql = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '0001_init.sql'), 'utf8');

const tableMatch = /create table public\.media\s*\(([\s\S]*?)\n\);/.exec(initSql);
if (!tableMatch) fail('could not find the media table in 0001_init.sql');

const columns = new Set();
tableMatch[1].split('\n').forEach(line => {
  const clean = line.replace(/--.*$/, '').trim();
  if (!clean || /^(constraint|primary|unique|check|foreign)\b/i.test(clean)) return;
  /* a line can declare several columns: "width int, height int, bytes int," */
  clean.split(',').forEach(part => {
    const m = /^\s*([a-z_][a-z0-9_]*)\s+\S/i.exec(part);
    if (m) columns.add(m[1].toLowerCase());
  });
});
if (!columns.has('storage_path')) fail('parsed the table but found no storage_path — the parser is wrong');

/* ---- what the client inserts -------------------------------------------- */
const up = fs.readFileSync(path.join(ROOT, 'epinoia', 'upload.js'), 'utf8');
const insert = /\.from\('media'\)\s*\.insert\(\{([\s\S]*?)\}\)/.exec(up);
if (!insert) fail('could not find the media insert in epinoia/upload.js');

const keys = [];
insert[1].split('\n').forEach(line => {
  const clean = line.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '');
  /* both `key: value` and the shorthand `key,` */
  clean.split(',').forEach(part => {
    const m = /^\s*([a-z_][a-z0-9_]*)\s*(:|$)/i.exec(part.trim() ? part : '');
    if (m) keys.push(m[1].toLowerCase());
  });
});
if (!keys.length) fail('parsed the insert but found no keys — the parser is wrong');

/* ---- and they have to agree --------------------------------------------- */
const missing = keys.filter(k => !columns.has(k));
if (missing.length) {
  fail('epinoia/upload.js inserts column(s) public.media does not have: ' +
       missing.join(', ') + '\n' +
       '  media has: ' + [...columns].sort().join(', ') + '\n' +
       '  PostgREST will refuse every upload with "Could not find the \'' +
       missing[0] + '\' column of \'media\' in the schema cache".');
}

console.log('media-columns: upload.js inserts ' + keys.length +
            ' columns, all present on public.media (' + keys.join(', ') + ')');
