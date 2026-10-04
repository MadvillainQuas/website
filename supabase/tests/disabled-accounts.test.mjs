/* ============================================================================
   A DISABLED ACCOUNT IS OUT, AND ANOTHER EMAIL ON THE SAME NETWORK DOES NOT GET BACK IN (0230).

     * the gate (PostgREST's pre-request function): a disabled account's signed-in requests are refused, so is any
       account on a blocked network (not a platform administrator's); signed-out and service requests never are; the
       one call that says why (account_status) always passes; anything going wrong inside lets the request through;
     * account_status notes the network, says disabled / blocked, and disables an account made after its network was
       blocked (an account that was there before is only refused);
     * disabling ends the sessions and enabling lifts the blocks made for the account; blocking needs a disabled account
       and never takes the caller's own network; an IPv6 block covers the /64;
     * the pages: config.js asks on every page but the embeds, signs out and says why; the sign-in forms say
       "disabled" for GoTrue's "banned"; the console offers to block after a disable, lists the blocks and lifts them;
       the privacy page says what is noted, why, who sees it and for how long.

     node supabase/tests/disabled-accounts.test.mjs        (the database half is skipped where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { allMigrations } from './pg-all-migrations.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const read = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '\n          ' + String(typeof saw === 'string' ? saw : JSON.stringify(saw)).slice(0, 900))); } };

const mig = read('supabase', 'migrations', '0230_disabled_accounts.sql');
const gateSrc = mig.slice(mig.indexOf('create or replace function public.api_gate()'), mig.indexOf('grant execute on function public.api_gate()'));
console.log('the migration');
ok('the gate is PostgREST\'s pre-request function, set only where none is set already',
   /alter role authenticator set pgrst\.db_pre_request = ''public\.api_gate''/.test(mig) && /already runs % before each request/.test(mig) && /notify pgrst, 'reload config'/.test(mig));
ok('every role can run the gate (a role that cannot would have every request refused)',
   /grant execute on function public\.api_gate\(\) to public, anon, authenticated, service_role;/.test(mig));
ok('the gate fails open: an error inside lets the request through, and only its own two refusals are raised',
   /exception when others then\s+deny := null;/.test(gateSrc) && (gateSrc.match(/raise exception/g) || []).length === 2 && /errcode = 'PT403', hint = 'epinoia:disabled'/.test(gateSrc) && /hint = 'epinoia:blocked'/.test(gateSrc));
ok('signed-out and service requests are never looked at; account_status always passes',
   /if uid is not null/.test(gateSrc) && /<> 'service_role'/.test(gateSrc) && /not like '%\/rpc\/account_status'/.test(gateSrc));
ok('it warns never to drop the gate without resetting PostgREST first', /alter role authenticator reset pgrst\.db_pre_request; notify pgrst, 'reload config';/.test(mig));
ok('the networks are nobody\'s to read but the console\'s functions; addresses forgotten after 90 days, daily',
   /revoke all on public\.account_ips from anon, authenticated;/.test(mig) && /revoke all on public\.ip_blocks from anon, authenticated;/.test(mig)
   && /interval '90 days'/.test(mig) && /epinoia-account-ips-prune/.test(mig));
ok('the internals are for no browser', /'account_end_sessions\(uuid\)', 'account_disable_now\(uuid,uuid,jsonb\)'/.test(mig) && /from public, anon, authenticated', f\)/.test(mig));

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite): the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  const one = async (s, p) => (await q(s, p))[0];
  ok('every migration applies, 0230 among them', !failed || failed.length === 0, failed);
  ok('the gate is switched on for PostgREST',
     ((await one(`select rolconfig from pg_roles where rolname = 'authenticator'`)).rolconfig || []).includes('pgrst.db_pre_request=public.api_gate'));

  /* a request as PostgREST makes it: the claims, the headers and the path set, then the role */
  const req = async (uid, ip, p = '/rpc/x', role) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false), set_config('request.path', $3, false)`,
      [JSON.stringify(uid ? { sub: uid, role: role || 'authenticated' } : { role: role || 'anon' }), ip ? JSON.stringify({ 'cf-connecting-ip': ip }) : '', p]);
    await db.exec(`set role ${role || (uid ? 'authenticated' : 'anon')}`);
  };
  const gate = async (uid, ip, p, role) => { await req(uid, ip, p, role); try { await q('select public.api_gate()'); return 'ok'; } catch (e) { return (e.hint || '') + ' ' + e.code + ' ' + e.message; } finally { await db.exec('reset role'); } };
  const status = async (uid, ip) => { await req(uid, ip, '/rpc/account_status'); try { return (await one('select public.account_status() s')).s; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); } };
  const mk = async e => (await one(`insert into auth.users (email, email_confirmed_at) values ($1, now()) returning id`, [e])).id;
  const banned = async id => (await one(`select coalesce(banned_until > now(), false) b from auth.users where id = $1`, [id])).b;

  const boss = await mk('boss@example.invalid');
  await q(`insert into memberships (user_id, role, scope_type) values ($1, 'platform_admin', 'platform')`, [boss]);
  const admin = async (sql, p, ip = '198.51.100.9') => { await req(boss, ip); try { return await q(sql, p); } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); } };
  const bad = await mk('bad@example.invalid');
  const neighbour = await mk('neighbour@example.invalid');
  const elsewhere = await mk('elsewhere@example.invalid');

  console.log('before anything is disabled');
  ok('a signed-in request passes', await gate(bad, '203.0.113.7') === 'ok');
  ok('account_status says all is well, and notes the network', JSON.stringify(await status(bad, '203.0.113.7')) === JSON.stringify({ blocked: false, disabled: false, signed_in: true }));
  await status(bad, '2a02:c7c:1234:5678:abcd::1');
  await status(neighbour, '203.0.113.7');
  await status(elsewhere, '192.0.2.44');
  ok('account_status is not for a signed-out browser', /permission denied/.test((await status(null, '203.0.113.7')).error || ''));
  ok('a browser cannot read the noted networks', await (async () => { await req(bad, '203.0.113.7'); try { await q('select * from public.account_ips'); return 'read'; } catch (e) { return e.message; } finally { await db.exec('reset role'); } })() !== 'read');

  console.log('disabling');
  await q(`create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz default now(), ip inet)`);
  await q(`create table if not exists auth.refresh_tokens (id bigserial primary key, user_id varchar(255), session_id uuid)`);
  const sess = (await one(`insert into auth.sessions (user_id, ip) values ($1, '198.18.0.5') returning id`, [bad])).id;
  await q(`insert into auth.refresh_tokens (user_id, session_id) values ($1::text, $2)`, [bad, sess]);
  ok('only a platform administrator can disable', !!(await (async () => { await req(neighbour, '1.1.1.1'); try { await q(`select public.platform_set_account_banned($1, true)`, [bad]); return null; } catch (e) { return e.message; } finally { await db.exec('reset role'); } })()));
  ok('blocking an account that is not disabled is refused', /disable the account first/.test(JSON.stringify(await admin(`select public.platform_block_networks($1) r`, [bad]))));
  ok('disabling says so', (await admin(`select public.platform_set_account_banned($1, true) r`, [bad]))[0].r === 'account disabled');
  ok('its sessions and refresh tokens are gone', (await one(`select (select count(*) from auth.sessions where user_id = $1)::int s, (select count(*) from auth.refresh_tokens where user_id = $1::text)::int r`, [bad])).s === 0
     && (await one(`select count(*)::int r from auth.refresh_tokens where user_id = $1::text`, [bad])).r === 0);
  ok('the address its session was on is kept', (await one(`select count(*)::int n from public.account_ips where user_id = $1 and ip = '198.18.0.5'`, [bad])).n === 1);
  ok('its signed-in requests are refused (403, epinoia:disabled)', /^epinoia:disabled PT403/.test(await gate(bad, '203.0.113.7')));
  ok('…but account_status passes the gate, and says disabled', await gate(bad, '203.0.113.7', '/rpc/account_status') === 'ok' && (await status(bad, '203.0.113.7')).disabled === true);
  ok('others on the same network are not refused yet', await gate(neighbour, '203.0.113.7') === 'ok');

  console.log('the console\'s networks');
  const nets = await admin(`select * from public.platform_account_networks($1) order by ip`, [bad]);
  ok('the account\'s networks are listed, with how many other accounts share each', nets.length === 3 && nets.find(n => n.ip === '203.0.113.7').others === 1 && nets.find(n => n.ip === '198.18.0.5').others === 0, nets);
  ok('nobody but an administrator reads them', !!(await (async () => { await req(neighbour, '1.1.1.1'); try { await q(`select * from public.platform_account_networks($1)`, [bad]); return null; } catch (e) { return e.message; } finally { await db.exec('reset role'); } })()));
  ok('the caller\'s own network is never blocked', /network you are on now/.test(JSON.stringify(await admin(`select public.platform_block_networks($1) r`, [bad], '203.0.113.7'))));
  ok('blocking them all says how many', (await admin(`select public.platform_block_networks($1) r`, [bad]))[0].r === 'blocked 3 networks');
  ok('an IPv6 address is blocked as its /64', (await one(`select count(*)::int n from public.ip_blocks where net = '2a02:c7c:1234:5678::/64'`)).n === 1);
  ok('blocking again adds nothing', (await admin(`select public.platform_block_networks($1) r`, [bad]))[0].r === 'blocked 0 networks');

  console.log('on a blocked network');
  ok('an account that was already there is refused while it is there (epinoia:blocked)', /^epinoia:blocked PT403/.test(await gate(neighbour, '203.0.113.7')));
  const st = await status(neighbour, '203.0.113.7');
  ok('…told it is blocked, and not disabled', st.blocked === true && st.disabled === false && !(await banned(neighbour)), st);
  ok('…and works anywhere else', await gate(neighbour, '192.0.2.1') === 'ok');
  ok('signed-out reading is never refused, on any network', await gate(null, '203.0.113.7') === 'ok');
  ok('the service key is never refused', await gate(null, '203.0.113.7', '/rpc/x', 'service_role') === 'ok');
  ok('a platform administrator is never refused for a network', await gate(boss, '203.0.113.7') === 'ok' && (await status(boss, '203.0.113.7')).blocked === false);
  const fresh = await mk('fresh@example.invalid');
  const fs = await status(fresh, '2a02:c7c:1234:5678:9999::2');
  ok('an account made after the block, on the same IPv6 /64, is disabled the first time it is used', fs.disabled === true && fs.blocked === true && await banned(fresh), fs);
  ok('…and the audit log says why', /made after its network was blocked/.test(JSON.stringify((await one(`select detail from audit_log where subject_id = $1 and action = 'disable_account'`, [fresh])).detail)));
  ok('the refusals are counted against the block', (await one(`select refused from public.ip_blocks where net = '203.0.113.7/32'`)).refused >= 1);
  const blocks = await admin(`select * from public.platform_ip_blocks()`);
  ok('the console lists the blocks, who they were for and the other accounts seen since',
     blocks.length === 3 && blocks.every(b => b.for_email === 'bad@example.invalid') && blocks.find(b => b.net === '2a02:c7c:1234:5678::/64').accounts_since === 1, blocks);

  console.log('when the gate cannot decide');
  ok('headers that are not JSON: the request passes', await (async () => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.headers', 'not json', false), set_config('request.path', '/x', false)`, [JSON.stringify({ sub: neighbour, role: 'authenticated' })]); await db.exec('set role authenticated'); try { await q('select public.api_gate()'); return 'ok'; } catch (e) { return e.message; } finally { await db.exec('reset role'); } })() === 'ok');
  ok('claims that are not JSON: the request passes', await (async () => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', 'nope', false)`); await db.exec('set role anon'); try { await q('select public.api_gate()'); return 'ok'; } catch (e) { return e.message; } finally { await db.exec('reset role'); } })() === 'ok');
  ok('an address the gateway sends as x-forwarded-for is read too', await (async () => { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false), set_config('request.path', '/x', false)`, [JSON.stringify({ sub: neighbour, role: 'authenticated' }), JSON.stringify({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })]); await db.exec('set role authenticated'); try { await q('select public.api_gate()'); return 'ok'; } catch (e) { return e.hint; } finally { await db.exec('reset role'); } })() === 'epinoia:blocked');

  console.log('lifting');
  ok('an administrator unblocks one network', (await admin(`select public.platform_unblock_network($1) r`, ['203.0.113.7/32']))[0].r === 'network unblocked' && await gate(neighbour, '203.0.113.7') === 'ok');
  ok('enabling the account lifts the rest of its blocks, and says so', /account enabled, and 2 blocked networks lifted/.test((await admin(`select public.platform_set_account_banned($1, false) r`, [bad]))[0].r)
     && (await one(`select count(*)::int n from public.ip_blocks`)).n === 0 && await gate(bad, '203.0.113.7') === 'ok');
  ok('the account made on the blocked network stays disabled until it is enabled itself', await banned(fresh));
  ok('the prune forgets addresses not seen for 90 days', await (async () => {
    await q(`update public.account_ips set last_seen = now() - interval '91 days' where user_id = $1`, [elsewhere]);
    const n = (await one(`select public.account_ips_prune() n`)).n;
    return n === 1 && (await one(`select count(*)::int n from public.account_ips where user_id = $1`, [elsewhere])).n === 0;
  })());
  ok('a deleted account\'s addresses go with it', await (async () => { await q(`delete from auth.users where id = $1`, [neighbour]); return (await one(`select count(*)::int n from public.account_ips where user_id = $1`, [neighbour])).n === 0; })());
}

/* ------------------------------------------------------------------------------------------------- the pages --- */
console.log('the page: config.js');
const cfg = read('epinoia', 'config.js');
ok('the sign-in forms\' words for GoTrue\'s "banned"', /window\.epinoiaAuthText = function/.test(cfg) && /banned/.test(cfg));
for (const f of [['signin', 'signin.js'], ['splash.js'], ['app', 'app.js'], ['admin', 'admin.js'], ['admin', 'platform', 'platform.js']]) {
  ok(f.join('/') + ' says "disabled" for a refused sign-in', /window\.epinoiaAuthText \|\| String\)\(/.test(read('epinoia', ...f)));
}

/* run config.js as a page would: signed in, the database saying disabled */
async function runPage(answer, { pathname = '/epinoia/home/', status = 200 } = {}) {
  const store = new Map([['sb-hhvofgqqadtyvcjudhjx-auth-token', JSON.stringify({ access_token: 'aaa.bbb.ccc-token-for-test-1234567890', expires_at: Date.now() / 1000 + 3600 })]]);
  const sess = new Map();
  const calls = [], body = [], listeners = {};
  const mkEl = tag => {
    const e = { tagName: tag, children: [], attrs: {}, style: {}, textContent: '', innerHTML: '', className: '', remove() { const i = body.indexOf(e); if (i >= 0) body.splice(i, 1); },
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, appendChild(c) { this.children.push(c); return c; },
      addEventListener() {}, focus() {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } };
    e.querySelector = sel => { const x = mkEl('x'); x.querySelector = () => mkEl('y'); return x; };
    return e;
  };
  const document = {
    readyState: 'complete', currentScript: { src: 'https://example.test/epinoia/config.js?v=1' },
    documentElement: mkEl('html'), head: mkEl('head'),
    body: { appendChild(c) { body.push(c); return c; } },
    querySelector: sel => (sel === '.ep-refused' ? (body.find(b => b.className === 'ep-refused') || null) : null),
    getElementById: () => null, createElement: mkEl, addEventListener() {}, hidden: false
  };
  const window = {
    location: { pathname, search: '', href: 'https://example.test' + pathname, origin: 'https://example.test' },
    addEventListener: (k, f) => { (listeners[k] = listeners[k] || []).push(f); }, dispatchEvent() {},
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: k => sess.has(k) ? sess.get(k) : null, setItem: (k, v) => sess.set(k, String(v)), removeItem: k => sess.delete(k), get length() { return sess.size; }, key: i => [...sess.keys()][i] },
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: status >= 200 && status < 300, status, json: async () => answer }; },
    setInterval: () => 0, setTimeout: (f) => 0, document, URL, URLSearchParams, JSON, Date, Math, console: { warn() {}, log() {} }, Event: function (t) { this.type = t; }
  };
  window.window = window;
  Object.defineProperty(window.localStorage, 'length', { get: () => store.size });
  const ctx = vm.createContext(Object.assign(window, { Object, String, Number, Array, Map, Promise, RegExp, Error }));
  vm.runInContext(cfg, ctx, { filename: 'config.js' });
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
  return { calls, body, store, sess, window };
}
const said = await runPage({ signed_in: true, disabled: true, blocked: false });
ok('a signed-in page asks account_status with the session\'s token', said.calls.length === 1 && /\/rest\/v1\/rpc\/account_status$/.test(said.calls[0].url) && /^Bearer aaa\.bbb/.test(said.calls[0].init.headers.Authorization), said.calls);
ok('disabled: the session is gone from this browser', !said.store.has('sb-hhvofgqqadtyvcjudhjx-auth-token'));
ok('…and a box says why (an alert dialog with a way to contact us)', said.body.some(b => b.className === 'ep-refused' && b.attrs.role === 'alertdialog' && /contact/.test(b.innerHTML + JSON.stringify(b))), said.body.map(b => b.className));
const fine = await runPage({ signed_in: true, disabled: false, blocked: false });
ok('all well: still signed in, nothing shown, and the answer kept for a minute in this tab', fine.store.has('sb-hhvofgqqadtyvcjudhjx-auth-token') && !fine.body.length && /"t":/.test(fine.sess.get('epinoia_acct_ok') || ''));
const blocked = await runPage({ signed_in: true, disabled: false, blocked: true });
ok('on a blocked network: signed out and told', !blocked.store.has('sb-hhvofgqqadtyvcjudhjx-auth-token') && blocked.body.some(b => b.className === 'ep-refused'));
const early = await runPage(null, { status: 404 });
ok('a database without 0230 changes nothing', early.store.has('sb-hhvofgqqadtyvcjudhjx-auth-token') && !early.body.length);
const embed = await runPage({ signed_in: true, disabled: true }, { pathname: '/epinoia/embed/game/' });
ok('an embed never asks', embed.calls.length === 0 && embed.store.has('sb-hhvofgqqadtyvcjudhjx-auth-token'));

console.log('the console');
const plat = read('epinoia', 'admin', 'platform', 'platform.js');
const platHtml = read('epinoia', 'admin', 'platform', 'index.html');
ok('after a disable (on a row and on the account\'s page) it offers to block the account\'s networks',
   (plat.match(/if \(!(r|a)\.banned\) await offerBlock\(/g) || []).length === 2 && /async function offerBlock\(user, email\)/.test(plat) && /platform_block_networks/.test(plat));
ok('it warns when a network is shared with other accounts', /shared with other accounts \(a household, a school, an office or a mobile network\)/.test(plat));
ok('the account\'s page lists its networks, each with a block button when it is disabled', /async function drawNetworks\(host, a, redraw\)/.test(plat) && /await drawNetworks\(host, a, redraw\);/.test(plat));
ok('the Accounts tab lists the blocks with an unblock button', /id="netBlocks"/.test(platHtml) && /id="netBody"/.test(platHtml) && /platform_unblock_network/.test(plat) && /loadBlocks\(\);\n  acctQuery/.test(plat));

console.log('the privacy page');
const priv = read('epinoia', 'privacy', 'index.html');
const sec = priv.slice(priv.indexOf('id="netSec"'), priv.indexOf('</section>', priv.indexOf('id="netSec"')));
ok('it says what is noted, why, who sees it, how long, and what a block does',
   /network \(IP\) address/.test(sec) && /Nothing is noted while you are signed out/.test(sec) && /platform administrators/.test(sec) && /90 days/.test(sec) && /signed out as always|Reading the site signed out works as always/.test(sec));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
