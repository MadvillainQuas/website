/* ============================================================================
   USERNAMES (migration 0163, EPINOIA GO step 2, docs/epinoia-go.md).

   Read from the files: the table nobody writes directly, the rules in one verdict function, the 30 days,
   the functions' grants, the self-check's cases; and the profile page asking for one (me.js, index.html),
   its messages built so the language engine translates the words and never the name.

   0163 itself was run on a real Postgres (PGlite) with 24 checks before it was committed - two fans on one
   name, the case rules, the 30 days, who reads what, a second run - and the profile page was driven in
   Chromium against the real Supabase SDK with 18 checks. Both harnesses live outside the repo.

     node supabase/tests/usernames.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };

const sql = rd('supabase', 'migrations', '0163_usernames.sql');
console.log('\nmigration 0163');
ok('its own table, not a column on the owner-writable profiles', /create table if not exists public\.usernames/.test(sql) && !/alter table public\.profiles/.test(sql));
ok('the format is enforced by the table itself', /check \(username ~ '\^\[A-Za-z\]\[A-Za-z0-9_\]\{2,19\}\$'\)/.test(sql));
ok('unique whatever the case', /create unique index if not exists usernames_unique_ci on public\.usernames \(lower\(username\)\)/.test(sql));
ok('the owner reads their own row, nobody writes it directly',
   /create policy usernames_own_read on public\.usernames for select using \(user_id = auth\.uid\(\)\)/.test(sql)
   && /revoke insert, update, delete on public\.usernames from anon, authenticated/.test(sql)
   && !/create policy [a-z_]+ on public\.usernames for (insert|update|delete|all)/.test(sql));
ok('the account goes, the name goes', /user_id\s+uuid primary key references auth\.users on delete cascade/.test(sql));
ok('reserved words, and names that begin with the platform\'s own', /lower\(p\) ~ '\^\(epinoia\|admin\|official\|support\)'/.test(sql));
ok('the blocklist knows disguises (0 o, 1 i, 3 e...) and fragments that are ordinary names',
   /translate\(lower\(n\), '013457 8@_', 'oieast ba'\)/.test(sql) && /\('dick', true/.test(sql) && /\('fuck', false/.test(sql));
ok('once in 30 days, a change of case free', /cur\.changed_at > now\(\) - interval '30 days'/.test(sql) && /lower\(cur\.username\) <> lower\(n\)/.test(sql));
ok('two fans racing for one name: the loser is told it is taken', /exception when unique_violation then[\s\S]{0,120}'reason', 'taken'/.test(sql));
ok('signed in only', (sql.match(/if (me|auth\.uid\(\)) is null then raise exception 'sign in first'/g) || []).length >= 2);
ok('the verdict itself is internal', /revoke all on function public\.username_verdict\(text, uuid\) from public, anon, authenticated/.test(sql));
ok('check and set are for signed-in fans', /grant execute on function public\.username_check\(text\) to authenticated/.test(sql)
   && /grant execute on function public\.set_username\(text\) to authenticated/.test(sql));
ok('the self-check covers the ordinary names a blocklist gets wrong',
   ['Dickson', 'Peacock', 'ScunthorpeFan', 'Fagerlund'].every(n => new RegExp("array\\['" + n + "', 'ok'\\]").test(sql)));
const nums = readdirSync(path.join(ROOT, 'supabase', 'migrations')).filter(f => /^\d{4}_/.test(f)).map(f => f.slice(0, 4));
ok('0163 is the only 0163', nums.filter(n => n === '0163').length === 1);

console.log('\nthe profile page');
const html = rd('epinoia', 'me', 'index.html'), js = rd('epinoia', 'me', 'me.js');
ok('the section is first on the profile, hidden until the database answers',
   /<div id="pane-profile" role="tabpanel">[\s\S]{0,700}<section class="sec hide" id="unameSec"/.test(html));
ok('...shown only when my_username answers (no 0163: stays hidden)', /const \{ data, error \} = await sb\.rpc\('my_username'\);\s*\n\s*if \(error\) return;/.test(js));
ok('checked while typing, once per pause, the last answer wins', /username_check/.test(js) && /if \(n !== asked\) return;/.test(js) && /\}, 350\);/.test(js));
ok('the format is checked on the page without asking', /const UNAME_FORMAT = \/\^\[A-Za-z\]\[A-Za-z0-9_\]\{2,19\}\$\//.test(js));
ok('saved through set_username only', /sb\.rpc\('set_username', \{ p: v \}\)/.test(js) && !/from\('usernames'\)/.test(js));
ok('every refusal has words', ['short', 'long', 'start', 'characters', 'reserved', 'blocked', 'taken', 'same'].every(k => new RegExp('\\b' + k + ': \'').test(js)));
ok('too soon says when, in the reader\'s own calendar', /reason === 'too_soon'/.test(js) && /window\.EpinoiaI18n\.locale/.test(js));
ok('a name or a date is never translated; the words around it are', /s\.setAttribute\('translate', 'no'\)/.test(js)
   && /\[\{ name: v \}, ' is available\.'\]/.test(js));
ok('#username brings it into view', /location\.hash === '#username'/.test(js));
ok('the message is in the UI face (the pixel one has no lower case)', /\.uname-msg\{font-family:var\(--f-ui\)/.test(html));

console.log('\nthe words');
const require = createRequire(import.meta.url);
for (const code of ['ja', 'es']) {
  const src = rd('epinoia', 'i18n', code, 'account.js');
  const words = ['Username', 'You have not chosen one yet.', 'is available.', 'Saved. Your username is', 'You can change it again on',
                 'That name is kept for EPINOIA itself.', 'Taken. Try another.'];
  const miss = words.filter(w => !src.includes("'" + w + "':"));
  ok(code + ': every username message is translated', !miss.length, miss.join(' | '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
