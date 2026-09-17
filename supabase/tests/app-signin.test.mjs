/* ============================================================================
   EMAIL SIGN-IN INSIDE THE APP, AND THE PLAY-READY PRIVACY PAGE
   (roadmap Phase 6 "Email sign-in in the app", Phase 8).

   A magic link tapped in Gmail finishes in the phone's default browser, so the
   Android app stays signed out. Every signInWithOtp form therefore offers the
   code from the same email, inside the app only. This checks:

     1. the four sign-in forms (signin/, app/, admin/, admin/platform/) carry
        the same code block, character for character, and each one offers it
        only after a send that succeeded, passing its own send as the resend;
     2. that block, run in node against a stub DOM:
          a plain tab                    nothing drawn, the page's own words
          window.epinoiaApp / html.m-app the field, numeric, one-time-code, 16px
          a code typed "123 456"         verifyOtp({email, token, type:'email'})
          a short code                   a warning, no call
          an expired code                a clear error, the field stays
          success                        the field goes, "Signed in."
          resend                         the page's send, with the address the
                                         code went to
     3. privacy/: the "Epinoia on Android" section says what Play needs it to,
        and #delete chooses the erasure kind (privacy.js run against a stub).

     node supabase/tests/app-signin.test.mjs
   ============================================================================ */
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b),
  'got ' + JSON.stringify(a) + '\n          want ' + JSON.stringify(b));
const tick = () => new Promise(r => setTimeout(r, 0));

/* ------------------------------------------------------------------ 1 --- */
console.log('\n-- the four forms');

const FORMS = [
  { file: ['epinoia', 'signin', 'signin.js'], send: 'sendLink', anchor: "$('#send')" },
  { file: ['epinoia', 'app', 'app.js'], send: 'sendLink', anchor: "$('#send').closest('.row') || $('#send')" },
  { file: ['epinoia', 'admin', 'admin.js'], send: 'sendAdminLink', anchor: "$('#send').parentNode" },
  { file: ['epinoia', 'admin', 'platform', 'platform.js'], send: 'sendLink', anchor: "$('#signinRow')" }
];
const START = '/* >>> THE CODE FROM THE EMAIL';
const END = '/* <<< THE CODE FROM THE EMAIL */';
const blockOf = src => {
  const a = src.indexOf(START), b = src.indexOf(END);
  return a >= 0 && b > a ? src.slice(a, b + END.length) : '';
};

let BLOCK = '';
for (const f of FORMS) {
  const name = f.file.slice(1).join('/');
  const src = rd(...f.file);
  const block = blockOf(src);
  ok(name + ': carries the code block', !!block);
  if (!BLOCK) BLOCK = block;
  else ok(name + ': the block is character for character the one in signin.js', block === BLOCK);

  ok(name + ': one signInWithOtp, still with its emailRedirectTo (the link keeps working)',
     (src.match(/signInWithOtp\(/g) || []).length === 1 && /signInWithOtp\(\{[^}]*emailRedirectTo/.test(src));
  ok(name + ': verifyOtp only inside the block, with type \'email\'',
     src.split('verifyOtp(').length === 2 && /verifyOtp\(\{ email, token, type: 'email' \}\)/.test(block));

  /* the send function, from its declaration to the next top-level close */
  const at = src.indexOf('async function ' + f.send + '(');
  const body = at >= 0 ? src.slice(at, src.indexOf('\n}\n', at) + 3) : '';
  ok(name + ': ' + f.send + '() is a function the resend can call with an address',
     /typeof to === 'string' \? to :/.test(body));
  const iOtp = body.indexOf('signInWithOtp('), iOffer = body.indexOf('offerEmailCode(');
  ok(name + ': the code is offered after the send, never before it', iOtp > 0 && iOffer > iOtp);
  ok(name + ': offered only once the send did not fail',
     /if \(error\)[^\n]*return|if \(error\) \{[\s\S]*?return/.test(body.slice(iOtp, iOffer)) || /!error && offerEmailCode/.test(body));
  ok(name + ': offered after the form, with its own send as the resend',
     body.includes('offerEmailCode(' + f.anchor + ', ') && body.includes(', ' + f.send + ')'));
  ok(name + ': outside the app it says what it always said, after the offer was declined',
     body.indexOf("'Link sent", iOffer) > iOffer);
  ok(name + ': the in-app wording comes back only when the code is offered',
     /if \([^)]*offerEmailCode\([^\n]*\{\n\s*return say\('Email sent to /.test(body));
  /* the installed web apps count as "in the app" too, and until the owner adds
     {{ .Token }} to the email templates the email has only the link, so the
     message must stay true without a code */
  ok(name + ': the in-app message still holds for an email with only the link (the field below says what to do)',
     body.includes("'. What to do next is below.'") &&
     !/enter its code below|Enter the code from it below/.test(body));
}
ok('signin.js: the click still sends from the field', /\$\('#send'\)\.addEventListener\('click', \(\) => sendLink\(\)\)/.test(rd('epinoia', 'signin', 'signin.js')));
ok('app.js: the click still sends from the field', /\$\('#send'\)\.addEventListener\('click', \(\) => sendLink\(\)\)/.test(rd('epinoia', 'app', 'app.js')));
ok('admin.js: the click still sends from the field', /\$\('#send'\)\.addEventListener\('click', \(\) => sendAdminLink\(\)\)/.test(rd('epinoia', 'admin', 'admin.js')));
ok('platform.js: click and Enter still send (an Event is not an address)',
   /\$\('#send'\)\.addEventListener\('click', sendLink\)/.test(rd('epinoia', 'admin', 'platform', 'platform.js')));

/* ------------------------------------------------------------------ 2 --- */
console.log('\n-- the block, run');

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null;
    this.attrs = {}; this.style = {}; this.listeners = {}; this.textContent = '';
    this.value = ''; this.disabled = false; this.focused = false; this.id = ''; this.className = '';
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(t, e) { return Promise.all((this.listeners[t] || []).map(fn => fn(e || {}))); }
  append(...ns) { ns.forEach(n => { n.parentNode = this; this.children.push(n); }); }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n, ref) {
    n.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    return n;
  }
  get nextSibling() {
    const s = this.parentNode ? this.parentNode.children : [];
    return s[s.indexOf(this) + 1] || null;
  }
  focus() { this.focused = true; }
  all() { return this.children.flatMap(c => [c, ...c.all()]); }
  querySelector(sel) { return this.all().find(n => sel === '#' + n.id) || null; }
}

function page(o = {}) {
  const body = new Node('body');
  const form = new Node('div');
  const anchor = new Node('div');
  const after = new Node('p');
  body.append(form); form.append(anchor, after);
  const cls = new Set(o.mApp ? ['m-app'] : []);
  const said = [];
  const calls = [];
  const document = {
    documentElement: { classList: { contains: c => cls.has(c) } },
    createElement: t => new Node(t),
    getElementById: id => body.all().find(n => n.id === id) || null
  };
  const sb = { auth: { verifyOtp: async args => { calls.push(args); return o.verify ? o.verify(args) : { data: {}, error: null }; } } };
  const ctx = { console, String, RegExp, Error, Promise, document, sb,
    say: (text, kind) => { said.push([text, kind]); } };
  ctx.window = ctx;
  if (o.app) ctx.epinoiaApp = true;
  /* the owner's switch, set once the email carries {{ .Token }} */
  if (o.otp) ctx.EPINOIA_CONFIG = { emailOtp: true };
  else if (o.config !== undefined) ctx.EPINOIA_CONFIG = o.config;
  vm.createContext(ctx);
  vm.runInContext(BLOCK + '\nthis.offerEmailCode = offerEmailCode; this.emailCodeInApp = emailCodeInApp;', ctx, { filename: 'email-code-block.js' });
  return { ctx, body, form, anchor, after, said, calls };
}

{
  const p = page();
  ok('a plain tab: not in the app', p.ctx.emailCodeInApp() === false);
  const r = p.ctx.offerEmailCode(p.anchor, 'a@b.co', async () => {});
  ok('a plain tab: nothing offered, nothing drawn', r === null && p.body.all().length === 3);
}

for (const [label, o] of [['window.epinoiaApp', { app: true }], ['html.m-app', { mApp: true }]]) {
  const p = page(o);
  ok(label + ': in the app', p.ctx.emailCodeInApp() === true);
  const box = p.ctx.offerEmailCode(p.anchor, 'sec@club.co.uk', async () => {});
  ok(label + ': the field is drawn straight after the form', !!box && p.form.children[1] === box && p.form.children[2] === p.after);
  ok(label + ': shown', box && box.style.display === 'flex');
}

/* BEFORE THE OWNER'S TEMPLATE CHANGE (config.js emailOtp not true): no code field, a plain note */
for (const [label, config] of [['no EPINOIA_CONFIG', undefined], ['emailOtp: false', { emailOtp: false }], ['emailOtp: "true" (a string)', { emailOtp: 'true' }]]) {
  const p = page({ app: true, config });
  const box = p.ctx.offerEmailCode(p.anchor, 'sec@club.co.uk', async () => {});
  const hint = box && box.querySelector('#emailCodeHint');
  ok(label + ': the note is drawn in the app, where the field would be', !!box && box.style.display === 'flex' && p.form.children[1] === box);
  ok(label + ': no code field, label or buttons shown',
     box.querySelector('#emailCodeIn').style.display === 'none' && box.querySelector('#emailCodeLab').style.display === 'none' &&
     box.querySelector('#emailCodeRow').style.display === 'none');
  ok(label + ': it says the link signs in the phone\'s browser, not the app, and points to Google',
     /browser/.test(hint.textContent) && /not in this app/.test(hint.textContent) && /Google/.test(hint.textContent) &&
     hint.textContent.includes('sec@club.co.uk') && !/code/i.test(hint.textContent), hint.textContent);
}
{
  const p = page({ app: true });
  p.ctx.offerEmailCode(p.anchor, 'a@b.co', async () => {});
  p.ctx.EPINOIA_CONFIG = { emailOtp: true };
  const box = p.ctx.offerEmailCode(p.anchor, 'a@b.co', async () => {});
  ok('switched on: the same box now shows the field and its buttons',
     box.querySelector('#emailCodeIn').style.display === '' && box.querySelector('#emailCodeLab').style.display === '' &&
     box.querySelector('#emailCodeRow').style.display === 'flex' && /6-digit code/.test(box.querySelector('#emailCodeHint').textContent));
}
ok('config.js ships emailOtp: false until the template carries {{ .Token }}', /\n\s*emailOtp: false\n/.test(rd('epinoia', 'config.js')));

{
  const resent = [];
  const p = page({ app: true, otp: true });
  const box = p.ctx.offerEmailCode(p.anchor, 'sec@club.co.uk', async to => { resent.push(to); });
  const input = box.querySelector('#emailCodeIn');
  const go = box.querySelector('#emailCodeGo');
  const again = box.querySelector('#emailCodeAgain');
  const hint = box.querySelector('#emailCodeHint');

  eq('input: inputmode numeric', input.getAttribute('inputmode'), 'numeric');
  eq('input: autocomplete one-time-code', input.getAttribute('autocomplete'), 'one-time-code');
  ok('input: 16px, so the phone does not zoom', /font-size:16px/.test(input.style.cssText));
  ok('input: a kit input with a label pointing at it', input.className === 'ep-input' &&
     box.children.some(n => n.tagName === 'LABEL' && n.htmlFor === 'emailCodeIn' && /code/i.test(n.textContent)));
  ok('input: described by the hint, in a labelled group', input.getAttribute('aria-describedby') === 'emailCodeHint' &&
     box.getAttribute('role') === 'group' && box.getAttribute('aria-labelledby') === 'emailCodeHint');
  ok('hint: the wording', hint.textContent.startsWith('Enter the 6-digit code from the email, or open the link on this phone.') &&
     hint.textContent.includes('sec@club.co.uk'), hint.textContent);
  ok('buttons: Verify and a resend, never submit buttons', go.textContent === 'Verify' && go.type === 'button' &&
     /new code/i.test(again.textContent) && again.type === 'button');

  /* a short code */
  input.value = '1234';
  await go.fire('click');
  ok('a short code: a warning and no call', p.calls.length === 0 && p.said.at(-1)[1] === 'warn' && input.focused);

  /* pasted with a space, sent with Enter */
  input.value = '123 456';
  await input.fire('keydown', { key: 'Enter' });
  await tick(); await tick();
  eq('verifyOtp: the address it went to, the digits, type email', p.calls[0], { email: 'sec@club.co.uk', token: '123456', type: 'email' });
  ok('success: the field goes and the page hears "Signed in."', box.style.display === 'none' && input.value === '' &&
     JSON.stringify(p.said.at(-1)) === JSON.stringify(['Signed in.', 'ok']));
  ok('success: the button is usable again', go.disabled === false && go.textContent === 'Verify');

  /* offered again: the same field, not a second one */
  const box2 = p.ctx.offerEmailCode(p.anchor, 'other@club.co.uk', async to => { resent.push('second:' + to); });
  ok('offered again: one field, shown again, with the new address', box2 === box && p.body.all().filter(n => n.id === 'emailCodeBox').length === 1 &&
     box.style.display === 'flex' && hint.textContent.includes('other@club.co.uk'));
  await again.fire('click');
  eq('resend: the latest send, with the address the code went to', resent, ['second:other@club.co.uk']);
  ok('resend: the button is usable again afterwards', again.disabled === false);
}

{
  const p = page({ app: true, otp: true, verify: () => ({ data: null, error: { message: 'Token has expired or is invalid' } }) });
  const box = p.ctx.offerEmailCode(p.anchor, 'a@b.co', async () => {});
  const input = box.querySelector('#emailCodeIn');
  input.value = '654321';
  await box.querySelector('#emailCodeGo').fire('click');
  ok('an expired code: a plain error that says what to do', p.said.at(-1)[1] === 'err' && /expired/.test(p.said.at(-1)[0]) && /new one/.test(p.said.at(-1)[0]), p.said.at(-1));
  ok('an expired code: the field stays, with what was typed', box.style.display === 'flex' && input.value === '654321');
}
{
  const p = page({ app: true, otp: true, verify: () => { throw new Error('Failed to fetch'); } });
  const box = p.ctx.offerEmailCode(p.anchor, 'a@b.co', async () => {});
  box.querySelector('#emailCodeIn').value = '111111';
  await box.querySelector('#emailCodeGo').fire('click');
  ok('a network failure: said, and the button comes back', p.said.at(-1)[1] === 'err' && /fetch/.test(p.said.at(-1)[0]) &&
     box.querySelector('#emailCodeGo').disabled === false);
}

/* ------------------------------------------------------------------ 3 --- */
console.log('\n-- privacy');

const HTML = rd('epinoia', 'privacy', 'index.html');
const PJS = rd('epinoia', 'privacy', 'privacy.js');
const sec = (/<section[^>]*id="androidSec"[\s\S]*?<\/section>/.exec(HTML) || [''])[0];
const text = sec.replace(/<[^>]+>/g, ' ').replace(/&rsquo;/g, '\'').replace(/\s+/g, ' ');
ok('an "Epinoia on Android" section', /<h2 id="androidH">Epinoia on Android<\/h2>/.test(sec));
ok('android: the app is the website shown in Chrome', /shows this website/.test(text) && /Chrome/.test(text));
ok('android: the account holds email, name, follows, subscription and delivery status',
   /email address/.test(text) && /name/.test(text) && /follow/.test(text) && /subscription/.test(text) && /delivered/.test(text));
ok('android: clubs enter players, including minors\' birth years', /Clubs and leagues enter/.test(text) && /birth years/.test(text) && /under 18/.test(text));
ok('android: email through Resend', /Resend/.test(text));
ok('android: no ads or tracking', /no adverts/.test(text) && /tracker/.test(text));
ok('android: notifications optional and switchable in the app\'s settings', /Optional/.test(text) && /notification settings/.test(text));
ok('the CSP and head are untouched (no inline script added)', !/<script>(?!<\/script>)|<script(?![^>]*\ssrc=)[^>]*>/.test(HTML) &&
   /script-src 'self';/.test(HTML));
ok('id="delete" is the erasure choice', /<label class="kind" id="delete"><input type="radio" name="kind" value="erasure">/.test(HTML));
ok('exactly one id="delete"', (HTML.match(/id="delete"/g) || []).length === 1);

/* privacy.js against a stub: the hash, the radios, the note */
function privacy(hash) {
  const radios = ['access', 'rectification', 'erasure'].map((v, i) => ({ value: v, checked: i === 0, focused: false,
    focus() { this.focused = true; } }));
  const note = { hidden: true, classList: {
    remove(c) { if (c === 'hide') note.hidden = false; },
    add(c) { if (c === 'hide') note.hidden = true; },
    toggle(c, force) { if (c === 'hide') note.hidden = force === undefined ? !note.hidden : !!force; } } };
  const listeners = {};
  const docListeners = {};
  const any = () => ({ textContent: '', classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, append() {},
    appendChild() {}, options: [], remove() {}, value: '', scrollIntoView() {} });
  const form = Object.assign(any(), { listeners: {},
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    reset() { radios.forEach((r, i) => { r.checked = i === 0; }); } });
  const els = { '#deleteNote': note, '#form': form };
  const location = { hash, pathname: '/epinoia/privacy/' };
  const ctx = {
    console, JSON, Promise, String, Object, Array, Date, Number, RegExp, Error, location,
    fetch: async () => ({ ok: false, json: async () => null }),
    EPINOIA_CONFIG: { supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'k' },
    document: {
      querySelector: s => {
        const m = /^input\[name="kind"\]\[value="(\w+)"\]$/.exec(s);
        if (m) return radios.find(r => r.value === m[1]) || null;
        return els[s] || (els[s] = any());
      },
      createElement: () => any(), createTextNode: () => ({}),
      addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); }
    },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(PJS, ctx, { filename: 'privacy.js' });
  return { ctx, radios, note, listeners, docListeners, form, location };
}
{
  const p = privacy('#delete');
  ok('#delete: erasure chosen', p.radios.find(r => r.value === 'erasure').checked);
  ok('#delete: the note about deleting an account shown', p.note.hidden === false);
  ok('#delete: the choice focused', p.radios.find(r => r.value === 'erasure').focused);

  /* another kind chosen: the note goes; Erase it again: it comes back */
  p.radios.forEach(r => { r.checked = r.value === 'rectification'; });
  (p.form.listeners.change || []).forEach(fn => fn({}));
  ok('another kind chosen: the delete note hidden again', p.note.hidden === true);
  p.radios.forEach(r => { r.checked = r.value === 'erasure'; });
  (p.form.listeners.change || []).forEach(fn => fn({}));
  ok('Erase it chosen by hand: the note shown', p.note.hidden === false);

  /* the in-page link clicked while the hash is already #delete (no hashchange) */
  p.radios.forEach(r => { r.checked = r.value === 'access'; });
  (p.form.listeners.change || []).forEach(fn => fn({}));
  const link = { closest: s => (s === 'a[href="#delete"]' ? link : null) };
  (p.docListeners.click || []).forEach(fn => fn({ target: link }));
  ok('the #delete link clicked again: erasure chosen and the note shown',
     p.radios.find(r => r.value === 'erasure').checked && p.note.hidden === false);
  const other = { closest: () => null };
  p.radios.forEach(r => { r.checked = r.value === 'access'; });
  (p.form.listeners.change || []).forEach(fn => fn({}));
  (p.docListeners.click || []).forEach(fn => fn({ target: other }));
  ok('any other click leaves the choice alone', !p.radios.find(r => r.value === 'erasure').checked);
}
{
  const src = PJS;
  ok('after each send the form resets and the note follows the reset',
     (src.match(/\$\('#form'\)\.reset\(\);\n\s*syncDeleteNote\(\);/g) || []).length === 2);
}
{
  const p = privacy('');
  ok('no hash: nothing chosen for the person', !p.radios.find(r => r.value === 'erasure').checked && p.note.hidden);
  p.location.hash = '#delete';
  (p.listeners.hashchange || []).forEach(fn => fn());
  ok('the hash changing to #delete while open chooses erasure', p.radios.find(r => r.value === 'erasure').checked && p.note.hidden === false);
}
{
  const p = privacy('#deleted');
  ok('another hash leaves the choice alone', !p.radios.find(r => r.value === 'erasure').checked);
}
ok('the note is in the page, hidden until #delete', /<p class="fine hide" id="deleteNote"/.test(HTML));
ok('the Android section links to #delete', /<a href="#delete">/.test(sec));

await tick();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
