/* ============================================================================
   A PUBLIC STORAGE URL MUST NAME ITS BUCKET.

   Supabase serves an object at

       /storage/v1/object/public/<bucket>/<path>

   and six different files built that URL by hand with the bucket left out, so
   they asked for /object/public/team/<id>/logo-….webp and got NoSuchKey. It hit
   club cards, fixture logos, the sidebar's league logo, the venue photograph,
   a merchandise logo and — the one this test was written for — the player
   photograph on the Stars feature.

   It survived because every one of those call sites falls back quietly. An
   image that 404s leaves a monogram, a drawing or a blank where a picture
   should be, and every one of those is a state the page is designed to have.
   Nothing looked broken; there was simply never a photograph anywhere.

   EpinoiaUpload.publicUrl has always built it correctly. The bug was six
   hand-rolled copies of a one-line job, so this test forbids the shape rather
   than the mistake: any concatenation onto /object/public/ has to be followed
   by a bucket name.

       node supabase/tests/storage-urls.test.mjs
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const DIR = path.join(ROOT, 'epinoia');

/* the buckets this platform actually has */
const BUCKETS = ['media-public', 'media-pending', 'merch-print'];

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'vendor' || e.name === 'node_modules') continue;
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(js|html)$/.test(e.name)) files.push(full);
  }
}(DIR));

const bad = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    /* only the concatenated form can be wrong — a literal URL with the bucket
       written in is fine, and so is publicUrl() */
    const m = /object\/public\/(['"`])?\s*\+/.exec(line);
    if (!m) return;
    /* if a bucket name appears immediately before the quote, it is correct */
    if (BUCKETS.some(b => line.includes('object/public/' + b + '/'))) return;
    /* comments explaining the bug are not the bug */
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
    bad.push(f.replace(ROOT + path.sep, '').replace(/\\/g, '/') + ':' + (i + 1) +
             '  ' + t.slice(0, 96));
  });
}

if (bad.length) {
  console.error('storage-urls: ' + bad.length +
    ' public storage URL(s) built without a bucket — they will 404 with NoSuchKey:\n  ' +
    bad.join('\n  ') +
    '\n\nUse EpinoiaUpload.publicUrl(cfg, path), or write the bucket in:' +
    '\n  /storage/v1/object/public/media-public/<path>');
  process.exit(1);
}

console.log('storage-urls: every public storage URL names its bucket (' +
            files.length + ' files scanned)');
