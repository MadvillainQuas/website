/* ============================================================================
   AN APPROVED IMAGE REACHES THE PUBLIC BUCKET.

   Reported 2026-09-17, approving a league logo in the platform console:
   "Could not publish the file: new row violates row-level security policy".
   The Storage API's move is an UPDATE of the object's row into the other bucket,
   and no update policy admitted media-public (0017 pins the row to
   media-pending), so every approval from a queue was refused. Two fixes, both
   held here:

     epinoia/upload.js publishPending   the move, or a copy of the bytes when
                                        storage refuses it (works today)
     0123_media_publish_move.sql        the update policy the move needed, and
                                        read access for whoever approves

     node supabase/tests/media-publish.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const U = require(path.join(ROOT, 'epinoia', 'upload.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.error('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

const RLS = { message: 'new row violates row-level security policy' };
function storage(o = {}) {
  const calls = [];
  const blob = { type: 'image/webp', size: 1234 };
  const bucket = name => ({
    move: async (a, b, opt) => { calls.push(['move', name, a, b, opt && opt.destinationBucket]); return { error: o.move || null }; },
    download: async p => { calls.push(['download', name, p]); return o.download ? { data: null, error: o.download } : { data: blob, error: null }; },
    upload: async (p, data, opt) => { calls.push(['upload', name, p, data === blob, opt && opt.contentType, opt && opt.upsert]); return { error: o.upload || null }; },
    remove: async ps => { calls.push(['remove', name, ps]); return { error: null }; }
  });
  return { sb: { storage: { from: bucket } }, calls };
}
const PATH = 'league/4bd8b5d7-9142-4b74-89e7-3bfe5d08d92f/logo-abc.webp';

console.log('\n-- publishPending');
{
  const s = storage();
  const r = await U.publishPending(s.sb, PATH);
  ok('a move that works is all it takes', r.ok && !r.copied && s.calls.length === 1 &&
     JSON.stringify(s.calls[0]) === JSON.stringify(['move', 'media-pending', PATH, PATH, 'media-public']), JSON.stringify(s.calls));
}
{
  const s = storage({ move: { message: 'The resource already exists' } });
  const r = await U.publishPending(s.sb, PATH);
  ok('"already exists" is done: the file is where it needs to be', r.ok && s.calls.length === 1);
}
{
  const s = storage({ move: RLS });
  const r = await U.publishPending(s.sb, PATH);
  ok('a refused move copies the bytes instead', r.ok && r.copied, JSON.stringify(r));
  ok('...reading the pending file, writing the same path in the public bucket with its type',
     JSON.stringify(s.calls.slice(1, 3)) === JSON.stringify([['download', 'media-pending', PATH],
       ['upload', 'media-public', PATH, true, 'image/webp', false]]), JSON.stringify(s.calls));
  ok('...and removing the private copy after', JSON.stringify(s.calls[3]) === JSON.stringify(['remove', 'media-pending', [PATH]]));
}
{
  const s = storage({ move: RLS, upload: { message: 'The resource already exists' } });
  const r = await U.publishPending(s.sb, PATH);
  ok('a copy that finds the file already public is done too', r.ok && r.copied);
}
{
  const s = storage({ move: RLS, download: { message: 'Object not found' } });
  const r = await U.publishPending(s.sb, PATH);
  ok('a copy that cannot read the file fails, saying both why', !r.ok && /row-level security/.test(r.error.message) && /Object not found/.test(r.error.message), r.error && r.error.message);
  ok('...and publishes nothing', !s.calls.some(c => c[0] === 'upload' || c[0] === 'remove'));
}
{
  const s = storage({ move: RLS, upload: RLS });
  const r = await U.publishPending(s.sb, PATH);
  ok('a copy the public bucket refuses fails, and keeps the private file', !r.ok && !s.calls.some(c => c[0] === 'remove'));
}

console.log('\n-- every approval goes through it');
const platform = read('epinoia', 'admin', 'platform', 'platform.js');
const admin = read('epinoia', 'admin', 'admin.js');
const app = read('epinoia', 'app', 'app.js');
const platformHtml = read('epinoia', 'admin', 'platform', 'index.html');
ok('the platform console\'s moderation queue', /EpinoiaUpload\.publishPending\(sb, m\.storage_path\)/.test(platform) && !/\.move\(/.test(platform));
ok('...which now loads the uploader, before its own script',
   platformHtml.indexOf('src="../../upload.js') > 0 &&
   platformHtml.indexOf('src="../../upload.js') < platformHtml.indexOf('src="platform.js'));
ok('the league console\'s Photographs', /EpinoiaUpload\.publishPending\(sb, m\.storage_path\)/.test(admin) && !/\.move\(/.test(admin));
ok('the club portal\'s pending crest', /async function moveToPublic\(path\) \{[\s\S]{0,420}EpinoiaUpload\.publishPending\(sb, path\)/.test(app) && !/\.move\(/.test(app));

console.log('\n-- 0123: the move itself is allowed');
const sql = read('supabase', 'migrations', '0123_media_publish_move.sql').split('\n').filter(l => !/^\s*--/.test(l)).join('\n');
ok('an approver may move a pending object into the public bucket',
   /create policy media_publish_move on storage\.objects for update to authenticated\s+using \(bucket_id = 'media-pending' and public\.may_approve_media\(name\)\)\s+with check \(bucket_id = 'media-public' and public\.may_approve_media\(name\)\)/.test(sql));
ok('...and may read what they approve', /create policy media_pending_read[\s\S]*?public\.may_approve_media\(name\)/.test(sql));
ok('...while the uploader keeps reading their own', /create policy media_pending_read[\s\S]*?public\.may_upload_media\(name\)/.test(sql));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
