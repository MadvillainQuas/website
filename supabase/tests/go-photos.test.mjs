/* ============================================================================
   GAMES BEEN TO - THE FANS' PHOTOGRAPHS (EPINOIA GO phase 5, migration 0167, epinoia/go/photos/).

   Read from the migration: two buckets, private until a person approves (D7); a fan writes only in their
   own folder; an approved file is named for the photograph, never its fan, so a public address ties no
   username to an account; photographs only of a game the fan stamped (D8), never at a youth league's game
   or one with a player flagged under 18, and only by a fan who confirmed 18 or over; three reports take
   one down until a person looks; files nobody needs any more are listed for the console to remove. Run
   under Node: the wall's addresses, every refusal in words, the uploader's new options (a bigger tile; a
   move to another bucket under another name); the console's queue and its sweep; the game page's strip;
   the words in ja and es.

   0167 was run on a real Postgres (PGlite) with 53 checks over a stub of Supabase Storage, twice over, and
   the pages were driven in Chromium: posting (a real JPEG carrying a phone's make and GPS goes up as WebP
   with no EXIF at all) and taking a stamp back 29, the wall 24, the console's queue and sweep 16, the game
   page's strip 8. The harnesses live outside the repo.

     node supabase/tests/go-photos.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + JSON.stringify(d) : '')); } };

const sql = rd('supabase', 'migrations', '0167_go_photos.sql');
console.log('\nmigration 0167');
ok('two buckets: go-pending private, go-public public', /\('go-pending', 'go-pending', false,/.test(sql) && /\('go-public',  'go-public',  true,/.test(sql));
ok('a fan writes only into their own private folder', /create policy go_pending_write on storage\.objects for insert to authenticated\s*with check \(bucket_id = 'go-pending' and \(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text\)/.test(sql));
ok('only an administrator puts a file in the public bucket, or moves one there',
   /create policy go_public_write on storage\.objects for insert to authenticated\s*with check \(bucket_id = 'go-public' and public\.is_platform_admin\(\)\)/.test(sql)
   && /create policy go_publish_move on storage\.objects for update to authenticated\s*using \(bucket_id = 'go-pending' and public\.is_platform_admin\(\)\)\s*with check \(bucket_id = 'go-public' and public\.is_platform_admin\(\)\)/.test(sql));
ok('an approved file is named for the photograph, never its fan', /select 'p\/' \|\| ph\.id \|\|/.test(sql)
   && /else path like 'p\/%' and thumb_path like 'p\/%' end/.test(sql));
ok('...so a fan\'s own public file is theirs to delete by the row, not by its name',
   /where \(ph\.path = name or ph\.thumb_path = name\) and ph\.user_id = auth\.uid\(\)/.test(sql));
ok('the youth leagues take no photographs', /set go_photos = false\s*where slug in \('aba-u19-league', 'nbl-u18s-men-s', 'lnb-espoirs-elite', 'lnb-espoirs-elite-2'\)/.test(sql));
const sub = sql.slice(sql.indexOf('create or replace function public.submit_go_photo'), sql.indexOf('alter function public.submit_go_photo'));
ok('only a game the fan stamped (D8)', /if not exists \(select 1 from stamps where user_id = me and game_id = p_game\)/.test(sub));
ok('never at a game with a player flagged under 18', /re\.active and pl\.is_minor/.test(sub));
ok('a username, and 18 or over confirmed', /'reason', 'username'/.test(sub) && /'reason', 'adult'/.test(sub));
ok('the files must be the fan\'s own and really there', /split_part\(p_path, '\/', 1\) <> me::text/.test(sub)
   && /o\.bucket_id = 'go-pending' and o\.name = p_path/.test(sub));
ok('three a game, ten a day, a caption the blocklist allows', />= 3 then\s*return jsonb_build_object\('ok', false, 'reason', 'game_full'\)/.test(sub)
   && />= 10 then\s*return jsonb_build_object\('ok', false, 'reason', 'day_full'\)/.test(sub) && /public\.go_caption_ok\(cap\)/.test(sub));
ok('three reports take a photograph down until a person looks', /status = case when n >= 3 then 'hidden' else status end/.test(sql));
ok('nobody writes a row directly', /revoke insert, update, delete on public\.go_photos, public\.go_photo_likes, public\.go_photo_reports from anon, authenticated/.test(sql));
ok('the wall shows no account id', !/returns table \([^)]*user_id/.test(sql.slice(sql.indexOf('function public.go_photos_feed'), sql.indexOf('function public.go_my_photos'))));
ok('a private league\'s photographs only for those who may see the league', /\(ph\.league_id is null or public\.league_visible\(ph\.league_id\)\)/.test(sql));
ok('a merge carries photographs', /update go_photos set venue_id = p_keep where venue_id = p_other/.test(sql));
const nums = readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /^\d{4}_/.test(f)).map(f => f.slice(0, 4));
ok('0167 is the only 0167', nums.filter(n => n === '0167').length === 1);

console.log('\nthe wall');
const W = require(path.join(ROOT, 'epinoia', 'go', 'photos', 'photos.js'));
ok('a public file\'s address, each part escaped', W.publicUrl({ supabaseUrl: 'https://x.supabase.co' }, 'p/a b.webp') === 'https://x.supabase.co/storage/v1/object/public/go-public/p/a%20b.webp');
const pr = W.readParams('?u=@Alice_1&v=00000000-2222-4000-8000-000000000001&s=liked&g=nonsense');
ok('the address reads: a fan, an arena, the order; nonsense is dropped', pr.username === 'Alice_1' && pr.venue === '00000000-2222-4000-8000-000000000001'
   && pr.sort === 'liked' && pr.game === null);
ok('...and writes back', W.writeParams({ username: 'Alice_1', sort: 'liked' }) === '?u=Alice_1&s=liked' && W.writeParams({ sort: 'new' }) === '');

console.log('\nposting');
const G = require(path.join(ROOT, 'epinoia', 'go', 'go.js'));
const reasons = [...new Set([...sub.matchAll(/'reason', '([a-z_]+)'/g)].map(m => m[1]))];
const missing = reasons.filter(r => !G.PHOTO_WHY[r]);
ok('every reason submit_go_photo gives has words on the page', reasons.length >= 9 && !missing.length, missing);
ok('every state a photograph can be in has words', ['pending', 'approved', 'rejected', 'hidden'].every(s => G.PHOTO_STATE[s]));
const go = rd('epinoia', 'go', 'go.js');
ok('re-encoded in the browser before it leaves the phone (D9)', /U\.prepare\(fileObj, 'gamephoto', \{ thumb: 480 \}\)/.test(go));
ok('into the fan\'s own folder', /const base = S\.session\.userId \+ '\/' \+ stamp\.game_id/.test(go));
ok('a refused post takes its files away again', /refused: the files go too/.test(go));
ok('removing a photograph: the files first, then the row', /the files first: a public one's permission asks the row whose it is/.test(go));
const up = rd('epinoia', 'upload.js');
ok('the uploader: a tile size when 96 is too small, the old callers unchanged',
   /async function prepare\(file, kind, opts\)/.test(up) && /\(opts && opts\.thumb\) \|\| SIZES\.thumb/.test(up) && /gamephoto: 1600/.test(up));
ok('...and a move to another bucket under another name, media-pending to media-public still the default',
   /const from = \(opts && opts\.from\) \|\| 'media-pending';/.test(up) && /const to = \(opts && opts\.to\) \|\| 'media-public';/.test(up)
   && /\.move\(path, dest, \{ destinationBucket: to \}\)/.test(up));

console.log('\nthe console');
const q = rd('epinoia', 'admin', 'platform', 'go-photos-ui.js'), pjs = rd('epinoia', 'admin', 'platform', 'platform.js'),
      phtml = rd('epinoia', 'admin', 'platform', 'index.html');
ok('the queue sits in the Moderation tab', /<div id="goPhotoQueue"><\/div>/.test(phtml) && /<script src="go-photos-ui\.js\?v=\d+" defer><\/script>/.test(phtml)
   && /window\.EpinoiaGoPhotosUI\.mount\(\{ host: '#goPhotoQueue', sb, say, oops \}\)/.test(pjs));
ok('approve moves the files to their public names, then records it', /U\.publishPending\(sb, from, \{ from: 'go-pending', to: 'go-public', toPath: to \}\)/.test(q)
   && q.indexOf('publishPending') < q.indexOf("sb.rpc('approve_go_photo'"));
ok('reject records it, then removes the files', q.indexOf("sb.rpc('reject_go_photo'") < q.indexOf('sb.storage.from(r.bucket).remove'));

console.log('\nfiles nobody needs (the privacy page: deleting an account removes the photographs\' files)');
ok('a row deleted - an account erased, most often - leaves its files\' names: public ones, or a waiting one\'s private ones',
   /create trigger go_photos_to_trash after delete on public\.go_photos/.test(sql)
   && /if old\.status in \('approved', 'hidden'\) then\s*insert into go_photo_trash \(path, bucket\) values \(old\.path, 'go-public'\), \(old\.thumb_path, 'go-public'\)/.test(sql)
   && /elsif old\.status = 'pending' then\s*insert into go_photo_trash \(path, bucket\) values \(old\.path, 'go-pending'\), \(old\.thumb_path, 'go-pending'\)/.test(sql));
const tl = sql.slice(sql.indexOf('create or replace function public.go_photo_trash_list'), sql.indexOf('create or replace function public.go_photo_trash_done'));
ok('...and so does an upload that never became a photograph, once it is a day old',
   /o\.bucket_id = 'go-pending' and o\.created_at < now\(\) - interval '1 day'/.test(tl)
   && /not exists \(select 1 from go_photos p where p\.path = o\.name or p\.thumb_path = o\.name\)/.test(tl)
   && /not exists \(select 1 from go_photo_trash t where t\.path = o\.name\)/.test(tl));
ok('the list is for administrators, and nobody writes it directly', /raise exception 'platform administrators only'/.test(tl)
   && /revoke insert, update, delete on public\.go_photo_trash from anon, authenticated/.test(sql));
ok('the console removes them from their buckets, then clears the names; a refusal keeps a name on the list',
   /await sb\.rpc\('go_photo_trash_list', \{ p_limit: 500 \}\)/.test(q) && q.indexOf("sb.storage.from(bucket).remove(paths)") < q.indexOf("sb.rpc('go_photo_trash_done'")
   && /if \(!r\.error \|\| \/not found\|does not exist\/i\.test\(r\.error\.message \|\| ''\)\) done\.push\(\.\.\.paths\)/.test(q));

console.log('\nwhere it shows (5.4)');
const F = require(path.join(ROOT, 'epinoia', 'go', 'fans.js'));
const gid = '11111111-2222-4333-8444-555555555555';
const rows = Array.from({ length: F.MAX + 1 }, (_, i) => ({ id: 'ph' + i, thumb_path: 'p/ph' + i + '-t.webp', username: 'Fan_' + i }));
const fp = F.plan(rows, { supabaseUrl: 'https://x.supabase.co' }, gid);
ok('a game\'s strip: eight tiles, each to its photograph on the wall, and a link to them all',
   fp && fp.tiles.length === 8 && fp.more === true && fp.all === '../go/photos/?g=' + gid
   && fp.tiles[0].href === '../go/photos/?g=' + gid + '&p=ph0'
   && fp.tiles[0].src === 'https://x.supabase.co/storage/v1/object/public/go-public/p/ph0-t.webp' && fp.tiles[0].alt === '@Fan_0', fp);
ok('...nothing at all for a game with none, or for an id that is not one',
   F.plan([], { supabaseUrl: 'x' }, gid) === null && F.plan(null, { supabaseUrl: 'x' }, gid) === null && F.plan(rows, { supabaseUrl: 'x' }, 'nonsense') === null);
const gh = rd('epinoia', 'game', 'index.html'), fjs = rd('epinoia', 'go', 'fans.js');
ok('the game page has it after the game, hidden until there is something to show',
   /<div class="gofans hide" id="goFans"><\/div>/.test(gh) && gh.indexOf('<div id="view">') < gh.indexOf('id="goFans"')
   && /<script src="\.\.\/go\/fans\.js\?v=\d+" defer><\/script>/.test(gh));
ok('...from the wall\'s own function, one more than it shows to know there are more',
   /\/rest\/v1\/rpc\/go_photos_feed/.test(fjs) && /JSON\.stringify\(\{ p_game: gameId, p_limit: MAX \+ 1 \}\)/.test(fjs));

console.log('\nthe words');
for (const code of ['ja', 'es']) {
  const src = rd('epinoia', 'i18n', code, 'go.js');
  const words = [...Object.values(G.PHOTO_WHY), ...Object.values(G.PHOTO_STATE), 'add a photo', 'post it', 'The feed', 'The feed opens soon.', 'most liked', 'this fan',
                 'Sent. A person looks at every photograph before it goes on the wall.'];
  const miss = words.filter(w => !src.includes("'" + w + "':"));
  ok(code + ': posting and the wall are translated', !miss.length, miss);
  const plat = rd('epinoia', 'i18n', code, 'platform.js');
  ok(code + ': the console\'s queue too', ['Fans’ photographs (EPINOIA GO)', 'Approved: it is on the wall.', 'Nothing waiting. Every fan photograph has been dealt with.',
     'Photograph files left behind', 'remove them', 'Some files could not be removed; they stay on the list.']
     .every(w => plat.includes("'" + w + "':")));
  const game = rd('epinoia', 'i18n', code, 'game.js');
  ok(code + ': the game page\'s strip too', ['Fans at this game', 'all their photographs'].every(w => game.includes("'" + w + "':")));
}
const photosHtml = rd('epinoia', 'go', 'photos', 'index.html');
ok('the wall loads the go pack', /<script src="\.\.\/\.\.\/i18n\.js\?v=\d+" data-i18n-packs="go"><\/script>/.test(photosHtml));
ok('a photograph shown whole covers the rail, the bell and the tab bar', /\.gp-view\{position:fixed;inset:0;z-index:2100/.test(photosHtml));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
