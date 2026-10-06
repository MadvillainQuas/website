// The platform console's "Official partner" switches (epinoia/admin/creators-ui.js mountPartners, 0201): every news
// source and every creator outlet is listed with its state; a switch asks first, calls set_official_partner with the
// kind and the id, says what happened and draws again; a refusal (the database's own words) puts the switch back; a
// database without 0201 says so instead of failing.
//   node supabase/tests/partners-ui.test.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..', '..');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };

class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = ''; this.className = ''; this.attrs = {}; this.listeners = {}; this.style = {}; this.checked = false; this.disabled = false; }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  all() { const out = []; const walk = n => (n.children || []).forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
}
globalThis.document = { createElement: t => new El(t), querySelector: () => null };
const C = require(path.join(root, 'epinoia', 'admin', 'creators-ui.js'));
ok('the console module offers the partners panel', typeof C.mountPartners === 'function' && typeof C.mountSources === 'function' && typeof C.mount === 'function');

const rows = () => [
  { kind: 'source', id: 's1', slug: 'eurohoops', name: 'Eurohoops', league_slug: null, league_name: null, showing: true, official_partner: true },
  { kind: 'source', id: 's2', slug: 'basketnews', name: 'BasketNews', league_slug: null, league_name: null, showing: false, official_partner: false },
  { kind: 'outlet', id: 'o1', slug: 'hoops-pod', name: 'Hoops Pod', league_slug: 'kbl', league_name: 'KBL', showing: true, official_partner: false }
];
const tick = () => new Promise(r => setTimeout(r, 5));
const make = async (handler) => {
  const calls = [], said = [];
  const sb = { rpc: async (fn, args) => { calls.push([fn, args]); return handler(fn, args); } };
  const host = new El('div');
  C.mountPartners({ host, sb, say: (m, k) => said.push([m, k]) });
  await tick();
  return { host, calls, said, sb };
};
const switches = host => host.all().filter(n => n.tagName === 'INPUT' && n.type === 'checkbox');
const inputsOf = (host, type) => host.all().filter(n => n.tagName === 'INPUT' && n.type === type);

console.log('\nthe list');
{
  let state = rows();
  const t = await make(async fn => (fn === 'official_partners_admin' ? { data: state, error: null } : { data: true, error: null }));
  const text = t.host.textContent;
  ok('it asks the database for every source and outlet', t.calls[0][0] === 'official_partners_admin');
  ok('sources and outlets under their own headings, with how many are partners', /News sources \(1 of 2 are official partners\)/.test(text) && /Creator outlets \(0 of 1 are official partners\)/.test(text), text.slice(0, 300));
  const sw = switches(t.host);
  ok('a switch for each (three), on for the partner, named for screen readers', sw.length === 3 && sw[0].checked === true && sw[1].checked === false && sw[2].checked === false && sw[0].attrs['aria-label'] === 'Official partner: Eurohoops' && sw.every(s => s.attrs.role === 'switch'));
  ok('...each row says where it is (an outlet\'s league) and whether it is showing at all', /KBL · active/.test(text) && /BasketNews[\s\S]*OFF: not shown/.test(text) && /every reader’s · on/.test(text), text);
}

console.log('\nthe switch');
{
  let state = rows(), asked = [];
  globalThis.confirm = m => { asked.push(m); return true; };
  const t = await make(async (fn, a) => { if (fn === 'official_partners_admin') return { data: state, error: null }; state = state.map(r => (r.id === a.p_id ? { ...r, official_partner: a.p_on } : r)); return { data: a.p_on, error: null }; });
  const sw = switches(t.host);
  sw[2].checked = true;                                           // the outlet, on
  await sw[2].listeners.change[0]();
  await tick();
  ok('it confirms first, naming the partner and what changes', asked.length === 1 && /Name Hoops Pod an official partner/.test(asked[0]) && /gold pill/.test(asked[0]), asked);
  const call = t.calls.find(c => c[0] === 'set_official_partner');
  ok('...then calls set_official_partner with the kind, the id and the state', call && call[1].p_kind === 'outlet' && call[1].p_id === 'o1' && call[1].p_on === true, call);
  ok('...says it, and draws the list again from the database', t.said.some(s => /Hoops Pod is an official partner/.test(s[0]) && s[1] === 'ok') && t.calls.filter(c => c[0] === 'official_partners_admin').length === 2 && /Creator outlets \(1 of 1/.test(t.host.textContent));
  const sw2 = switches(t.host);
  sw2[0].checked = false;                                         // Eurohoops, off
  await sw2[0].listeners.change[0]();
  await tick();
  ok('stopping asks as well, and calls it with p_on false', /Stop Eurohoops being an official partner/.test(asked[1]) && t.calls.filter(c => c[0] === 'set_official_partner')[1][1].p_on === false);
}
{
  const t = await make(async fn => (fn === 'official_partners_admin' ? { data: rows(), error: null } : { data: true, error: null }));
  globalThis.confirm = () => false;
  const sw = switches(t.host);
  sw[1].checked = true;
  await sw[1].listeners.change[0]();
  ok('a "no" at the confirmation changes nothing: the switch goes back, and nothing is called', sw[1].checked === false && !t.calls.some(c => c[0] === 'set_official_partner'));
}
{
  const t = await make(async fn => (fn === 'official_partners_admin' ? { data: rows(), error: null } : { data: null, error: { message: 'only a platform administrator can name an official partner' } }));
  globalThis.confirm = () => true;
  const sw = switches(t.host);
  sw[1].checked = true;
  await sw[1].listeners.change[0]();
  await tick();
  ok('a refusal is said in the database\'s own words, and the switch goes back', sw[1].checked === false && t.said.some(s => /only a platform administrator/.test(s[0]) && s[1] === 'err'), t.said);
}

console.log('\nno migration, no access');
{
  const t = await make(async () => ({ data: null, error: { message: 'Could not find the function public.official_partners_admin in the schema cache' } }));
  ok('a database without 0201 says so, and draws no switches', /0201: it has not been applied/.test(t.host.textContent) && switches(t.host).length === 0);
  const t2 = await make(async () => ({ data: null, error: { message: 'only a platform administrator can see the official partners' } }));
  ok('anyone else is told what the database told them', /only a platform administrator can see the official partners/.test(t2.host.textContent));
}
ok('the console\'s page loads the panel: its host beside the sources, and platform.js mounts it', (() => {
  const html = readFileSync(path.join(root, 'epinoia', 'admin', 'platform', 'index.html'), 'utf8');
  const js = readFileSync(path.join(root, 'epinoia', 'admin', 'platform', 'platform.js'), 'utf8');
  return /id="officialPartnersHost"/.test(html) && html.indexOf('officialPartnersHost') > html.indexOf('newsSourcesHost') && /C\.mountPartners\(\{ host: '#officialPartnersHost'/.test(js);
})());

console.log('\na partner\'s own words and a publisher\'s logo (0235)');
{
  const t = await make(async fn => (fn === 'official_partners_admin' ? { data: rows(), error: null } : { data: { ok: true }, error: null }));
  const labels = inputsOf(t.host, undefined).concat(t.host.all().filter(n => n.tagName === 'INPUT' && n.maxLength === 32));
  const lab = t.host.all().filter(n => n.tagName === 'INPUT' && n.maxLength === 32);
  ok('a label field for every partner row (sources and outlets)', lab.length === 3, lab.length);
  ok('a logo picker for each news source only', inputsOf(t.host, 'file').length === 2, inputsOf(t.host, 'file').length);
  lab[0].value = 'Official media partner';
  const save = t.host.all().filter(n => n.tagName === 'BUTTON' && n.textContent === 'save label')[0];
  await save.listeners.click[0]();
  await tick();
  const call = t.calls.find(c => c[0] === 'set_partner_branding');
  ok('saving calls set_partner_branding with the kind, the id and the label', call && call[1].p_kind === 'source' && call[1].p_id === 's1' && call[1].p_label === 'Official media partner', call);
  void labels;
}
{
  const src = readFileSync(path.join(here, '..', '..', 'epinoia', 'newscard.js'), 'utf8');
  ok('the pill reads the partner\'s own label, by key or by name, and falls back to "Official partner"',
     /function partnerPill\(cls, ref\)/.test(src) && /EpinoiaPartnerLabels/.test(src) && /\|\| 'Official partner'/.test(src));
  const mig = readFileSync(path.join(here, '..', 'migrations', '0235_partner_label_publisher_logo.sql'), 'utf8');
  ok('0235: the label column, the admin-only branding call, the label in official_partners(), and the admin-only logo upload rule',
     /add column if not exists partner_label/.test(mig) && /function public\.set_partner_branding/.test(mig) && /is_platform_admin\(\)/.test(mig) &&
     /'label', s\.partner_label/.test(mig) && /news\/\[0-9a-fA-F-\]\{36\}\/logo-/.test(mig));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
