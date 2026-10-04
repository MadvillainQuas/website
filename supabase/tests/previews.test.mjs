/* ============================================================================
   PREVIEWS FOR A SIGNED-OUT READER (0231, access.js previews, memlock.js, 2026-10-04).

     * the database counts them against a one-way code made from the network (never the address): ten a week, the
       eleventh refused with when the next comes back; the same thing again that week is free; another network has its
       own ten; one IPv6 /64 is one network; no address, no count; nobody reads the table or the salt;
     * the reports on their own: one player report and one club report a week, apart from the ten and from each other
       (the game's report is counted apart too, though nothing asks for it while it is open to everyone);
     * the page: a preview opens one feature on one page for thirty minutes (featureLocked answers open), the page is
       told (emit 'preview'), none left greys the buttons, a database without 0231 hides them; the card, the placeholder
       and the box offer "Preview it" or "Open your free report" with the week's note; the game report needs nothing;
     * the callers name their feature, scouting's columns open with a preview, the privacy page says what is counted.

     node supabase/tests/previews.test.mjs        (the database half is skipped where PGlite is not installed)
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { allMigrations } from './pg-all-migrations.mjs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
process.on('uncaughtException', e => { console.log('  FAIL  stopped by an error: ' + String((e && e.message) || e).slice(0, 300)); process.exit(1); });
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

const mig = rd('supabase', 'migrations', '0231_previews.sql');
console.log('the migration');
ok('the network is a salted one-way code (the IPv4 address or the IPv6 /64), never the address',
   /extensions\.digest\(coalesce\(s, ''\) \|\| public\.ip_net\(v_ip\)::text, 'sha256'\)/.test(mig) && /net_hash text not null/.test(mig) && !/\bip\s+inet\b/.test(mig.slice(mig.indexOf('create table if not exists public.preview_uses'))));
ok('the salt and the uses are nobody\'s to read; a browser may only take one and ask what is left',
   /revoke all on public\.preview_salt from anon, authenticated;/.test(mig) && /revoke all on public\.preview_uses from anon, authenticated;/.test(mig)
   && /grant execute on function public\.preview_take\(text, text\) to anon, authenticated, service_role;/.test(mig) && /grant execute on function public\.preview_left\(\) to anon, authenticated, service_role;/.test(mig));
ok('a week, forgotten after it (a daily job), and the allowances are the platform\'s settings',
   /interval '7 days'/.test(mig) && /epinoia-preview-uses-prune/.test(mig) && /'preview_limit', '10'::jsonb/.test(mig) && /'preview_report_limit', '1'::jsonb/.test(mig));

const loaded = await allMigrations({});
if (!loaded || !loaded.db) {
  console.log('  SKIP  @electric-sql/pglite is not installed (npm i --no-save @electric-sql/pglite): the database half is not run');
} else {
  const { db, failed } = loaded;
  const q = async (s, p) => (await db.query(s, p)).rows;
  ok('every migration applies, 0231 among them', !failed || failed.length === 0, failed);
  const as = async (ip, uid) => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claims', $1, false), set_config('request.headers', $2, false)`,
      [JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' }), ip ? JSON.stringify({ 'cf-connecting-ip': ip }) : '']);
    await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  };
  const take = async (ip, f, s, uid) => { await as(ip, uid); try { return (await q('select public.preview_take($1, $2) r', [f, s]))[0].r; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); } };
  const left = async ip => { await as(ip); try { return (await q('select public.preview_left() r'))[0].r; } catch (e) { return { error: e.message }; } finally { await db.exec('reset role'); } };

  console.log('the ten');
  ok('a fresh network has ten', (await left('203.0.113.7')).left === 10);
  const tens = [];
  for (let i = 0; i < 10; i++) tens.push(await take('203.0.113.7', 'lineups', '/epinoia/t/#club' + i));
  ok('ten distinct previews open, counting down to none', tens.every(r => r.ok) && tens.map(r => r.left).join() === '9,8,7,6,5,4,3,2,1,0', tens.map(r => r.left));
  const eleventh = await take('203.0.113.7', 'shotZones', '/epinoia/t/#club0');
  ok('the eleventh is refused, saying when the next one comes back (a week after the oldest)', eleventh.ok === false && eleventh.left === 0 && !!eleventh.next_at, eleventh);
  ok('the same thing again that week is free', (await take('203.0.113.7', 'lineups', '/epinoia/t/#club3')).again === true);
  ok('another network has its own ten', (await take('198.51.100.1', 'lineups', '/epinoia/t/#club10')).left === 9);
  await take('2a02:c7c:1:2:aaaa::1', 'wowy', '/epinoia/stats/wowy/#slb');
  ok('one IPv6 /64 is one network (a home\'s or a phone\'s addresses change within it)', (await left('2a02:c7c:1:2:bbbb::9')).left === 9);
  ok('with no address to count against, it is let through', (await take(null, 'wowy', '/x')).ok === true);
  ok('a feature that is not a name is refused', /a feature and a page/.test((await take('1.1.1.1', 'drop table', '/x')).error || ''));
  ok('signed in, nothing is counted', (await take('203.0.113.7', 'lineups', '/epinoia/t/#club11', (await q(`insert into auth.users (email) values ('p@example.invalid') returning id`))[0].id)).signed_in === true);
  const peekAt = async sql => { await as('1.1.1.1'); try { await q(sql); return 'read'; } catch (e) { return e.message; } finally { await db.exec('reset role'); } };
  ok('a browser cannot read the uses or the salt', /permission denied/.test(await peekAt('select * from public.preview_uses')) && /permission denied/.test(await peekAt('select * from public.preview_salt')));
  ok('what is kept is the code, the feature, the page and when: no address',
     (await q(`select count(*)::int n from public.preview_uses where net_hash ~ '^[0-9a-f]{64}$'`))[0].n >= 12
     && !(await q(`select string_agg(net_hash, ',') s from public.preview_uses`))[0].s.includes('203.0.113.7'));

  console.log('\nthe reports, on their own');
  const ip = '192.0.2.50';
  ok('one free player report a week', (await take(ip, 'playerReport', '/epinoia/p/#a')).ok === true);
  ok('...a second player\'s is refused', (await take(ip, 'playerReport', '/epinoia/p/#b')).ok === false);
  ok('...the first again is free', (await take(ip, 'playerReport', '/epinoia/p/#a')).again === true);
  ok('the club report is counted apart from the player\'s', (await take(ip, 'clubReport', '/epinoia/t/#c')).ok === true && (await take(ip, 'clubReport', '/epinoia/t/#d')).ok === false);
  ok('the game report too', (await take(ip, 'gameReport', '/epinoia/game/#g')).ok === true);
  ok('and the ten are untouched by them', (await take(ip, 'lineups', '/epinoia/t/#c')).left === 9);
  const L = await left(ip);
  ok('what is left says the ten and each report kind', L.left === 9 && L.limit === 10 && L.report_limit === 1 && L.reports.playerReport === 0 && L.reports.clubReport === 0 && L.reports.gameReport === 0, L);

  console.log('\nthe settings and the week');
  await q(`update public.platform_settings set value = '2'::jsonb where key = 'preview_limit'`);
  const ip2 = '192.0.2.77';
  const r3 = [await take(ip2, 'lineups', '/a'), await take(ip2, 'lineups', '/b'), await take(ip2, 'lineups', '/c')];
  ok('the platform\'s preview_limit is the week\'s allowance', r3[0].ok && r3[1].ok && r3[2].ok === false && r3[0].limit === 2, r3);
  await q(`update public.platform_settings set value = '10'::jsonb where key = 'preview_limit'`);
  await q(`update public.preview_uses set used_at = now() - interval '8 days' where subject = '/a'`);
  ok('a use older than a week no longer counts', (await take(ip2, 'lineups', '/d')).ok === true);
  await q(`update public.preview_uses set used_at = now() - interval '9 days' where subject in ('/b', '/c', '/d')`);
  ok('...and the daily job forgets what is past it', (await q('select public.preview_uses_prune() n'))[0].n >= 2
     && (await q(`select count(*)::int n from public.preview_uses where subject in ('/b', '/d')`))[0].n === 0);
}

/* ------------------------------------------------------------------- the page --- */
const REF = 'hhvofgqqadtyvcjudhjx';
function page({ path: p = '/epinoia/t/', search = '?t=C1', session = null, net: transport = null } = {}) {
  const store = new Map(), sess = new Map();
  if (session) store.set('sb-' + REF + '-auth-token', JSON.stringify(session));
  const mk = tag => {
    const cls = new Set();
    const e = { tagName: String(tag).toUpperCase(), children: [], attrs: {}, dataset: {}, style: {}, _text: '', listeners: {},
      get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }, set textContent(v) { this._text = String(v); this.children = []; },
      innerHTML: '', setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      append(...cs) { cs.forEach(c => this.appendChild(c)); }, remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this); },
      addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener() {}, focus() {},
      contains(x) { return x === this || this.children.some(c => c.contains && c.contains(x)); },
      classList: { add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)), contains: c => cls.has(c),
        toggle: (c, f) => { const on = f === undefined ? !cls.has(c) : !!f; if (on) cls.add(c); else cls.delete(c); return on; } } };
    Object.defineProperty(e, 'className', { get: () => [...cls].join(' '), set: v => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); } });
    return e;
  };
  const doc = { readyState: 'complete', currentScript: { src: 'https://example.test/epinoia/access.js?v=1' }, createElement: mk, head: mk('head'),
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
    createTextNode: t => ({ textContent: t }) };
  doc.body = mk('body');
  const win = {
    location: { pathname: p, search, href: 'https://example.test' + p + search, origin: 'https://example.test' },
    EPINOIA_CONFIG: { supabaseUrl: 'https://' + REF + '.supabase.co', supabaseAnonKey: 'k' },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: k => sess.has(k) ? sess.get(k) : null, setItem: (k, v) => sess.set(k, String(v)), removeItem: k => sess.delete(k) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    getComputedStyle: () => ({ zoom: '1' }), innerWidth: 1200, innerHeight: 800,
    setTimeout: (f, ms) => (ms > 60000 ? 0 : setTimeout(f, ms)), clearTimeout, setInterval: () => 0, URL, URLSearchParams, console: { warn() {}, log() {} }
  };
  win.window = win; win.document = doc; win.self = win;
  const ctx = vm.createContext(Object.assign(win, { Object, String, Number, Array, Map, Set, WeakMap, Promise, RegExp, Error, JSON, Date, Math, Symbol }));
  ctx.globalThis = ctx;
  vm.runInContext(rd('epinoia', 'access.js'), ctx, { filename: 'access.js' });
  vm.runInContext(rd('epinoia', 'memlock.js'), ctx, { filename: 'memlock.js' });
  const A = ctx.EpinoiaAccess;
  if (transport) A._test.transport(transport);
  const heard = [];
  A.onChange(d => heard.push(d && d.reason));
  return { A, M: ctx.EpinoiaMemLock, sess, heard, doc };
}
const reply = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const asText = n => JSON.stringify(n, (k, v) => (k === 'parentNode' ? undefined : v));

console.log('\nthe page');
{
  const { A, sess } = page();
  ok('signed out, the lineups are locked', A.featureLocked('lineups', 'L1') === true);
  sess.set('epinoia_peek', JSON.stringify({ 'lineups|/epinoia/t/#C1': Date.now() + 60000 }));
  ok('a live preview of them on this club\'s page opens them', A.previewActive('lineups') && A.featureLocked('lineups', 'L1') === false && A.lockReason('lineups', 'L1') === null);
  ok('...and only them', A.featureLocked('shotZones', 'L1') === true);
  sess.set('epinoia_peek', JSON.stringify({ 'lineups|/epinoia/t/#C2': Date.now() + 60000 }));
  ok('...and only on that page (another club\'s are still locked)', A.featureLocked('lineups', 'L1') === true);
  sess.set('epinoia_peek', JSON.stringify({ 'lineups|/epinoia/t/#C1': Date.now() - 1 }));
  ok('a preview past its thirty minutes has closed', A.featureLocked('lineups', 'L1') === true);
  ok('the page a preview is for: the path and the club, player or league, never the tab', page({ search: '?t=C9&tab=report&sort=x' }).A.peekSubject() === '/epinoia/t/#C9'
     && page({ path: '/epinoia/stats/', search: '?l=slb-men' }).A.peekSubject() === '/epinoia/stats/#slb-men');
}
{
  let sent = null;
  const { A, sess, heard } = page({ net: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ ok: true, left: 7, limit: 10 }) }; } });
  const r = await A.takePreview('lineups');
  ok('taking one asks the database for this feature on this page', !!sent && /\/rest\/v1\/rpc\/preview_take$/.test(sent.url) && sent.body.p_feature === 'lineups' && sent.body.p_subject === '/epinoia/t/#C1', sent);
  ok('...opens it for thirty minutes, and the page is told', r.ok && r.left === 7 && A.featureLocked('lineups', 'L1') === false && heard.includes('preview')
     && Math.abs(JSON.parse(sess.get('epinoia_peek'))['lineups|/epinoia/t/#C1'] - (Date.now() + 30 * 60000)) < 5000, [r, heard]);
  ok('...and says so after any reload: open for 30 minutes, what is left, sign in', /Preview open for 30 minutes/.test(sess.get('epinoia_peek_said')) && /7 of 10 previews left this week/.test(sess.get('epinoia_peek_said')));
}
{
  const { A, heard } = page({ net: reply(200, { ok: false, left: 0, limit: 10, next_at: '2026-10-11T00:00:00Z' }) });
  const r = await A.takePreview('lineups');
  ok('none left: refused, nothing opens, nobody is told of a change', r.ok === false && r.error === 'none-left' && A.featureLocked('lineups', 'L1') === true && !heard.includes('preview'));
  ok('...and the note says none are left', A.peekText(r, 'lineups') === 'No previews left this week');
  const gone = await page({ net: reply(404, {}) }).A.takePreview('lineups');
  ok('a database without 0231: no preview (the buttons are taken away)', gone.ok === false && gone.error === 'unavailable');
  ok('signed in, a preview is never needed', (await page({ session: { access_token: 'a.b.c', refresh_token: 'r', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u' } } }).A.takePreview('lineups')).open === true);
}

console.log('\nthe buttons');
{
  const { A, M } = page();
  const card = A.teaserHTML({ key: 'lineups', title: 'Lineups' });
  ok('the sign-in card offers "Preview it" for its feature, with the week\'s note', /class="ep-in-peek" data-peek="lineups">Preview it</.test(card) && /data-peek-left="lineups">Signed out, you can preview 10 things a week\.</.test(card), card);
  const rep = A.teaserHTML({ peek: 'clubReport', title: 'The club report is for members' });
  ok('a report\'s card offers its free one instead', /data-peek="clubReport">Open your free report</.test(rep) && /Signed out, you can open one free club report a week\./.test(rep), rep);
  ok('...and a teaser naming no feature offers none', !/data-peek/.test(A.teaserHTML({ title: 'Pairs are for members' })));
  ok('the notes as the database answers: what is left, and a used report', A.peekText({ left: 9, limit: 10 }, 'lineups') === '9 of 10 previews left this week'
     && A.peekText({ reports: { playerReport: 0 } }, 'playerReport') === 'This week’s free player report has been used.');
  const ph = asText(M.placeholder({ what: 'Events', key: 'events' }));
  ok('the placeholder over the blurred rows offers it too', /"data-peek":"events"/.test(ph) && /Preview it/.test(ph), ph.slice(0, 300));
  const box = asText(M.askSignIn({ what: 'CSV download', key: 'csv' }));
  ok('the box a press opens offers it beside Sign in', /Preview it/.test(box) && /"data-peek-left":"csv"/.test(box), box.slice(0, 400));
  const plain = asText(M.askSignIn({ what: 'Something' }));
  ok('...unless the press named no feature', !/Preview it/.test(plain));
}
{
  const { A } = page({ path: '/epinoia/game/', search: '?g=G1' });
  ok('the game report is open to everyone, with no limit for now: nothing asks, and nothing is offered',
     A.signinFirst('gameReport') === false && A.featureLocked('gameReport', 'L1') === false && A.peekHTML('gameReport') === null);
  ok('...its membership gate (the club report\'s) is kept for later', A.CATALOGUE.locks.gameReport.gate === 'club_report');
}

console.log('\nthe callers and the words');
{
  ok('the report tab names its report for the card and the placeholder', /peek: o\.lock\.key/.test(rd('epinoia', 'report.js')) && /rows: 8, key: o\.lock\.key/.test(rd('epinoia', 'report.js')));
  ok('the game page asks for the game report\'s own lock', (rd('epinoia', 'game', 'analysis.js').match(/'gameReport'/g) || []).length === 2);
  ok('a table\'s locked view offers a preview of the table', /peek: 'statColumns'/.test(rd('epinoia', 'fulltable.js')));
  ok('scouting\'s premium columns open with a preview', /A\.previewActive\('statColumns'\)/.test(rd('epinoia', 'global.js')));
  ok('WOWY, the teammates panel and the What wins placeholders name theirs', /peek: 'wowy'/.test(rd('epinoia', 'stats', 'wowy', 'wowyui.js')) && /peek: 'wowy'/.test(rd('epinoia', 'p', 'withui.js'))
     && /key: 'model'/.test(rd('epinoia', 'winning', 'page.js')) && /key: 'model'/.test(rd('epinoia', 't', 'fomodel.js')));
  const priv = rd('epinoia', 'privacy', 'index.html');
  const sec = priv.slice(priv.indexOf('id="peekSec"'), priv.indexOf('</section>', priv.indexOf('id="peekSec"')));
  ok('the privacy page says what is counted, against what, how many, and for how long',
     /one-way code made from your network address/.test(sec) && /never the address itself/.test(sec) && /Ten previews a week/.test(sec) && /one free player report and one free club report/.test(sec) && /A week, and then it is deleted\./.test(sec));
  for (const L of ['ja', 'es']) {
    const core = rd('epinoia', 'i18n', L + '.js');
    ok(L + ': the buttons, the notes and the message are translated', ["'preview it'", "'open your free report'", "'preview open for 30 minutes'"].every(s => core.toLowerCase().includes(s))
       && /previews left this week\$\//.test(core) && /report has been used/.test(core));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
