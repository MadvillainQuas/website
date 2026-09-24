/* ============================================================================
   STAMPS (EPINOIA GO steps 3.1-3.2, migration 0165, docs/epinoia-go.md).

   Read from the file: a stamp keeps no location (D5), only a fan's own stamps are theirs to read, nobody
   writes one but the check; the check's rules - the window (D1), a pin a person has not cleared, the
   phone's accuracy allowed for up to 200 m, no faster than a plane, six tries a minute and thirty an hour,
   a private game invisible - and the games a fan can stamp, asked for without any location at all.

   0165 was run on a real Postgres (PGlite) with 40 checks before it was committed - every refusal, a stamp
   at a home club's arena, Helsinki to Tokyo in minutes and in twenty hours, the rate limit, row-level
   security as a fan, a merge carrying stamps, an account deleted - twice over. The harness lives outside
   the repo.

     node supabase/tests/stamps.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };

const sql = rd('supabase', 'migrations', '0165_stamps.sql');
const table = name => (new RegExp('create table if not exists public\\.' + name + ' \\(([\\s\\S]*?)\\n\\);').exec(sql) || [])[1] || '';
const fn = name => (new RegExp('create or replace function public\\.' + name + '\\(([\\s\\S]*?)\\n\\$\\$;').exec(sql) || [])[1] || '';

console.log('\nwhat is kept (D5)');
const cols = t => table(t).split('\n').map(l => (/^\s*([a-z_]+)\s/.exec(l) || [])[1]).filter(c => c && c !== 'constraint');
ok('a stamp keeps the arena, the game, its league, the time and the reported accuracy',
   ['user_id', 'venue_id', 'game_id', 'league_id', 'stamped_at', 'accuracy_m'].every(c => cols('stamps').includes(c)), cols('stamps').join());
ok('...and never where the phone was', !cols('stamps').some(c => /lat|lng|lon|point|geo|dist/.test(c)), cols('stamps').join());
ok('a try is logged without a location either', table('stamp_attempts') && !cols('stamp_attempts').some(c => /lat|lng|lon|point|geo|dist/.test(c)), cols('stamp_attempts').join());
ok('one stamp per fan per game', /constraint stamps_one_per_game unique \(user_id, game_id\)/.test(sql));
ok('the account goes, its stamps and tries go', /user_id\s+uuid not null references auth\.users on delete cascade,[\s\S]*venue_id\s+uuid not null references public\.venues on delete restrict/.test(sql)
   && (sql.match(/references auth\.users on delete cascade/g) || []).length === 2);
ok('an arena with stamps is only removed by a merge that moves them',
   /venue_id\s+uuid not null references public\.venues on delete restrict/.test(sql) && /update stamps set venue_id = p_keep where venue_id = p_other/.test(sql));
// the privacy page (section 08) says tries are forgotten after 30 days: for everybody, not only a fan who tries again
ok('tries are forgotten after 30 days, everybody\'s, nightly (the privacy page promises it)',
   /delete from stamp_attempts where user_id = me and tried_at < now\(\) - interval '30 days'/.test(sql)
   && /'epinoia-go-forget-tries'::text, '25 3 \* \* \*'::text,\s*'delete from public\.stamp_attempts where tried_at < now\(\) - interval ''30 days'''::text/.test(sql)
   && /create index if not exists stamp_attempts_at on public\.stamp_attempts \(tried_at\)/.test(sql));
const priv = rd('epinoia', 'privacy', 'index.html');
ok('...and the privacy page says what 0165 does', /id="goSec"/.test(priv) && /forgotten after 30 days/.test(priv) && /never your location/.test(priv)
   && /Never where you were/.test(priv));

console.log('\nwho reads and writes');
ok('a fan reads their own stamps, and may take one back', /create policy stamps_own_read on public\.stamps for select using \(user_id = auth\.uid\(\)\)/.test(sql)
   && /create policy stamps_own_delete on public\.stamps for delete using \(user_id = auth\.uid\(\)\)/.test(sql));
ok('nobody writes a stamp but the check', /revoke insert, update on public\.stamps from anon, authenticated/.test(sql)
   && !/create policy [a-z_]+ on public\.stamps for (insert|update|all)/.test(sql));
ok('the tries are for administrators', /create policy stamp_attempts_admin on public\.stamp_attempts for select using \(public\.is_platform_admin\(\)\)/.test(sql));
ok('stamping is for signed-in fans', /revoke all on function public\.stamp_venue\(uuid, double precision, double precision, double precision\) from public, anon/.test(sql)
   && /grant execute on function public\.stamp_venue\(uuid, double precision, double precision, double precision\) to authenticated/.test(sql));

console.log('\nthe check (3.2)');
const sv = fn('stamp_venue');
ok('signed in first', /if me is null then\s*return jsonb_build_object\('ok', false, 'reason', 'signed_out'\)/.test(sv));
ok('six tries a minute, thirty an hour', /n_min >= 6 or n_hour >= 30/.test(sv));
ok('NaN is asked for by name (Postgres holds it equal to itself)', /p_lat = 'NaN'::float8/.test(sv) && !/p_lat <> p_lat/.test(sv));
ok('a game the fan may not see is not there', /not public\.can_read_game\(g\.id\)[\s\S]{0,200}'no_such_game'/.test(sv));
ok('the window (D1): two hours before tip-off, one hour after the end',
   /p_tipoff - interval '2 hours'/.test(sql) && /end\) \+ interval '1 hour'/.test(sql) && /'too_early', 'opens_at'/.test(sv) && /'too_late', 'closed_at'/.test(sv));
ok('the arena is the game\'s own, else its home club\'s (0162 game_venue_id)', /public\.game_venue_id\(gm\.id\) as venue_id/.test(sv));
ok('a pin with a note is never checked against', /v\.lat is null or v\.pin_note is not null then[\s\S]{0,200}'arena_unchecked'/.test(sv));
ok('the phone\'s doubt is allowed for, up to 200 m of it', /allow := v\.radius_m \+ least\(coalesce\(acc, 0\), 200\)/.test(sv));
ok('too far says how far (to 10 m) and the radius', /'too_far', 'venue', v\.name,\s*'distance_m', \(round\(d \/ 10\) \* 10\)::bigint, 'radius_m', v\.radius_m/.test(sv));
ok('no faster than a plane (900 km/h, arenas more than 50 km apart)', /> 50000/.test(sv) && /> 900 then/.test(sv) && /'too_fast', 'last_venue'/.test(sv));
ok('two taps racing make one stamp', /on conflict \(user_id, game_id\) do nothing/.test(sv));
const reasons = [...new Set([...sv.matchAll(/'reason', '([a-z_]+)'/g)].map(m => m[1]))].sort();
ok('every refusal has a name', reasons.join() === 'arena_unchecked,bad_location,imprecise,no_arena,no_such_game,no_time,not_on,signed_out,slow_down,too_early,too_far,too_fast,too_late', reasons.join());

console.log('\nthe games a fan can stamp');
ok('asked for with no location: the phone measures', /create or replace function public\.go_games_now\(\)\s*returns table/.test(sql));
ok('...only games the caller may see, never a void one', /public\.can_read_game\(g\.id\)/.test(fn('go_games_now') || sql.slice(sql.indexOf('go_games_now()'))) && /g\.status::text <> 'void'/.test(sql));
ok('...each says whether its pin can be trusted', /\(v\.lat is not null and v\.pin_note is null\)/.test(sql));
ok('...open to anybody (the page shows games before sign-in)', /grant execute on function public\.go_games_now\(\) to anon, authenticated/.test(sql));

console.log('\nthe file');
const nums = readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /^\d{4}_/.test(f)).map(f => f.slice(0, 4));
ok('0165 is the only 0165', nums.filter(n => n === '0165').length === 1);
ok('0165 checks itself', /raise exception '0165: anon may call stamp_venue'/.test(sql) && /raise exception '0165: a fan may insert a stamp directly'/.test(sql)
   && /raise exception '0165: go_metres is wrong/.test(sql));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
