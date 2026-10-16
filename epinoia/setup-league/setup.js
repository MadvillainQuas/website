'use strict';
/* ============================================================================
   SET UP A LEAGUE (setup-league/): a private league of one's own, bought on the page (Louie, 2026-10-16: "'SET UP A
   LEAGUE' will allow a user to purchase a new private league that gets built on site, gives them league admin status
   of that league to customise and create their league").

   The plan is access_plans kind 'league_setup' (0279), monthly. The reader names the league, picks its address (from
   the name, checked as it is typed: league_slug_free) and its colour; the payment window (access.js buy) carries them
   as the checkout's details, and billing_provision builds the league when the subscription is written: private, the
   buyer its administrator. When the subscription ends the league stays, private, and its buyer stops running it until
   they renew (leagues.setup_lapsed_at).

   "Your leagues" is my_paid_leagues(): each one's state, and the way into the league console (admin/?l=<slug>, which
   opens the console on that league). After a payment it is asked again every 3 seconds for up to a minute, until the
   new league is there.

   The pure parts (slugify, nameOk, slugOk, leagueState) are exported for supabase/tests/sales-pages.test.mjs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSetupLeaguePage = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ------------------------------------------------------------ pure parts --- */
/* AN ADDRESS FROM A NAME, as the database makes one (billing_provision): lower case, every run of anything that is not
   a letter or a digit one hyphen, none at either end; accents folded first (é -> e) so "Liga Española" reads
   liga-espanola rather than liga-espa-ola; at most 40 characters, never ending on a hyphen. */
const SLUG_MAX = 40;
function slugify(name) {
  let s = String(name == null ? '' : name);
  try { s = s.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (_) { /* an engine without normalize */ }
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, SLUG_MAX).replace(/-+$/, '');
}
/* the database's rules (league_slug_free, billing_provision) */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const slugOk = s => typeof s === 'string' && s.length >= 2 && s.length <= SLUG_MAX && SLUG.test(s);
const nameOk = n => { const t = String(n == null ? '' : n).trim(); return t.length >= 2 && t.length <= 60; };
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_COLOUR = '#93f2bf';

/* how one of the reader's leagues stands (a my_paid_leagues row) */
function leagueState(r) {
  if (!r) return { key: 'none' };
  if (r.problem) return { key: 'problem', text: 'We’re building it: if this stays, contact us' };
  if (r.active === false || r.lapsed_at) return { key: 'lapsed', text: 'Lapsed: renew to run it again' };
  if (!r.league_id || !r.slug) return { key: 'building', text: 'Building it now' };
  return { key: 'live', text: 'Yours to run' };
}

/* ------------------------------------------------------------- the page --- */
const BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
const API = { slugify, slugOk, nameOk, leagueState, SLUG_MAX, DEFAULT_COLOUR };
if (!BROWSER) return API;

const doc = document;
const A = () => root.EpinoiaAccess || null;
const CFG = () => root.EPINOIA_CONFIG || {};
const $ = s => doc.querySelector(s);
function el(tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const amount = (p, c) => { const a = A(); const t = a && a.amountText ? a.amountText(p, c) : '£' + ((Number(p) || 0) / 100).toFixed(2); return t.replace(/\.00$/, ''); };
async function token() {
  const a = A();
  try { const s = a && a.sessionReady ? await a.sessionReady() : (a && a.session ? a.session() : null); return s && s.token ? s : null; } catch (_) { return null; }
}
async function rpc(fn, args, auth) {
  const c = CFG();
  if (!c.supabaseUrl || !c.supabaseAnonKey) return { status: 0, data: null };
  const h = { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (auth) { const s = await token(); if (!s) return { status: 401, data: null }; h.Authorization = 'Bearer ' + s.token; }
  try {
    const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers: h, body: JSON.stringify(args || {}) });
    let data = null;
    try { data = await r.json(); } catch (_) { data = null; }
    return { status: r.status, data: r.ok ? data : null };
  } catch (_) { return { status: 0, data: null }; }
}
async function payments() {
  const c = CFG();
  if (!c.supabaseUrl || !c.supabaseAnonKey) return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), 8000) : 0;
  try {
    const r = await fetch(c.supabaseUrl + '/functions/v1/billing', { method: 'POST', signal: ctl ? ctl.signal : undefined,
      headers: { 'Content-Type': 'application/json', apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + c.supabaseAnonKey },
      body: JSON.stringify({ action: 'status' }) });
    if (r.status === 404 || r.status === 503) return false;
    const j = r.ok ? await r.json() : null;
    return j && typeof j.configured === 'boolean' ? j.configured : null;
  } catch (_) { return null; } finally { clearTimeout(t); }
}
/* an answer waited for a moment only (undefined when it has not come), so a slow one never holds the page up: the
   buttons are drawn again when it lands */
const soon = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(undefined), ms))]);

const S = { plan: null, pay: null, slugTouched: false, slugFree: null, slugAsked: '', mine: null, signedIn: false };

/* ---- the price, beside what you get ---- */
function paintPrice() {
  const host = $('#suPrice');
  host.textContent = '';
  const p = S.plan;
  host.appendChild(el('p', 'sl-eye', 'Your own league'));
  if (!p) {
    host.appendChild(el('p', 'sl-soonbig', 'Not on sale yet'));
    host.appendChild(el('p', 'sl-blurb', 'Leagues go on sale here soon. Until then, write to us and we can set one up with you.'));
    const c = el('a', 'ep-btn', 'Contact'); c.href = '../contact/';
    const act = el('div', 'sl-act'); act.appendChild(c); host.appendChild(act);
    return;
  }
  const pr = el('div', 'sl-price');
  pr.append(el('b', null, amount(p.price_pennies, p.currency)), el('span', null, p.interval === 'year' ? 'a year' : 'a month'));
  host.appendChild(pr);
  if (p.blurb) host.appendChild(el('p', 'sl-blurb', p.blurb));
  if (p.includes_tier_name) host.appendChild(el('p', 'sl-with', 'Comes with ' + p.includes_tier_name + ' membership'));
  /* to the form: a jump on the long page, the next tab where the sections are tabs (nav.js opens it) */
  const act = el('div', 'sl-act');
  const go = el('a', 'ep-btn pri sl-go', 'Build your league'); go.href = '#build';
  act.appendChild(go);
  host.appendChild(act);
  host.appendChild(el('p', 'sl-fine', 'Cancel any time. When the subscription ends the league stays, private, and you run it again when you renew.'));
}

/* ---- the form ---- */
const nameIn = () => $('#suName'), slugIn = () => $('#suSlug'), colIn = () => $('#suColour');
let slugTimer = 0, slugSeq = 0;
function checkSlug() {
  clearTimeout(slugTimer);
  const s = slugIn().value.trim();
  S.slugFree = null;
  S.slugAsked = s;
  const msg = $('#suSlugMsg');
  msg.className = 'sl-check';
  if (!s) { msg.textContent = ''; paintGo(); return; }
  if (!slugOk(s)) { msg.textContent = 'Use lower-case letters, numbers and single hyphens, 2 to 40 characters'; msg.classList.add('bad'); paintGo(); return; }
  msg.textContent = 'checking…';
  paintGo();
  slugTimer = setTimeout(async () => {
    const my = ++slugSeq;
    const r = await rpc('league_slug_free', { p_slug: s });
    if (my !== slugSeq || slugIn().value.trim() !== s) return;
    if (typeof r.data === 'boolean') {
      S.slugFree = r.data;
      msg.textContent = r.data ? 'available' : 'taken';
      msg.classList.add(r.data ? 'good' : 'bad');
    } else {
      /* the check is not there yet (or could not be reached): the address is checked again when the league is built,
         and a taken one is given a short suffix there */
      S.slugFree = null;
      msg.textContent = '';
    }
    paintGo();
  }, 350);
}
function paintPreview() {
  const name = nameIn().value.trim(), slug = slugIn().value.trim(), col = COLOUR.test(colIn().value) ? colIn().value : DEFAULT_COLOUR;
  const T = root.EpinoiaTeamColour;
  const ink = T && T.ink ? (T.ink(col) || col) : col;
  const on = T && T.on ? T.on(col) : '#04100b';
  const pv = $('#suPreview');
  pv.style.setProperty('--lg', col);
  pv.style.setProperty('--lg-ink', ink);
  pv.style.setProperty('--lg-on', on);
  const pvName = $('#suPvName');
  if (name) pvName.setAttribute('translate', 'no'); else pvName.removeAttribute('translate');
  pvName.textContent = name || 'Your league';
  $('#suPvMono').textContent = (name || 'L').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map(w => w.charAt(0)).join('').slice(0, 3).toUpperCase() || 'L';
  $('#suPvAddr').textContent = 'prophesyscouting.co.uk/epinoia/l/?l=' + (slug || 'your-league');
  $('#suColourHex').textContent = col.toLowerCase();
}
function ready() {
  return nameOk(nameIn().value) && slugOk(slugIn().value.trim()) && S.slugFree !== false && COLOUR.test(colIn().value);
}
function paintGo() {
  const b = $('#suGo');
  const fresh = b.cloneNode(false);
  b.replaceWith(fresh);
  const p = S.plan;
  if (!p || p.purchasable === false) { fresh.textContent = 'Not on sale yet'; fresh.disabled = true; return; }
  if (S.pay === false) { fresh.textContent = 'Payments open soon'; fresh.disabled = true; return; }
  if (!ready()) { fresh.textContent = 'Set up my league'; fresh.disabled = true; return; }
  fresh.textContent = 'Set up my league';
  fresh.disabled = false;
  fresh.addEventListener('click', () => {
    const name = nameIn().value.trim().replace(/\s+/g, ' ');
    const a = A();
    if (!a || !a.buy || !ready()) return;
    a.buy({ planId: p.id, details: { league_name: name, slug: slugIn().value.trim(), colour: colIn().value.toLowerCase() },
      title: 'Your own league', what: name + ', a private league' });
  });
}
function wireForm() {
  nameIn().addEventListener('input', () => {
    const n = nameIn().value;
    $('#suNameMsg').classList.toggle('hide', !n.trim() || nameOk(n));
    if (!S.slugTouched) { slugIn().value = slugify(n); checkSlug(); }
    paintPreview();
    paintGo();
  });
  slugIn().addEventListener('input', () => {
    const v = slugIn().value, low = v.toLowerCase().replace(/\s+/g, '-');
    if (low !== v) slugIn().value = low;
    S.slugTouched = slugIn().value.trim() !== '';
    checkSlug();
    paintPreview();
  });
  colIn().addEventListener('input', () => { paintPreview(); paintGo(); });
  paintPreview();
}

/* ---- your leagues ---- */
async function readMine() {
  const a = A();
  const s = a && a.session ? a.session() : null;
  S.signedIn = !!s;
  if (!s) { S.mine = null; return null; }
  const r = await rpc('my_paid_leagues', {}, true);
  S.mine = Array.isArray(r.data) ? r.data : null;     // null: 0279 not applied (404), or not answered
  return S.mine;
}
function paintMine() {
  const sec = $('#yours'), host = $('#yoursBody');
  if (!S.signedIn || !S.mine) { sec.classList.add('hide'); return; }
  sec.classList.remove('hide');
  host.textContent = '';
  if (!S.mine.length) {
    const e = el('div', 'pg-empty');
    e.appendChild(el('p', null, 'Once you set up a league it appears here, ready to run.'));
    host.appendChild(e);
    return;
  }
  const list = el('div', 'sl-subs');
  S.mine.forEach(r => {
    const st = leagueState(r);
    const row = el('div', 'sl-sub sl-lg-' + st.key);
    const tx = el('div', 'sl-sub-t');
    const b = el('b', null, r.name || r.asked || 'Your league'); b.setAttribute('translate', 'no');
    tx.appendChild(b);
    if (r.slug) { const s = el('small', null, 'epinoia/l/?l=' + r.slug); s.setAttribute('translate', 'no'); tx.appendChild(s); }
    tx.appendChild(el('span', 'st' + (st.key === 'problem' ? ' bad' : st.key === 'lapsed' ? ' end' : ''), st.text));
    row.appendChild(tx);
    const acts = el('div', 'sl-sub-a');
    if (st.key === 'live') {
      const run = el('a', 'ep-btn pri', 'Run it'); run.href = '../admin/?l=' + encodeURIComponent(r.slug);
      const view = el('a', 'ep-btn', 'Open'); view.href = '../l/?l=' + encodeURIComponent(r.slug);
      acts.append(run, view);
    } else if (st.key === 'lapsed') {
      const m = el('a', 'ep-btn', 'Manage billing'); m.href = '../me/';
      acts.appendChild(m);
    } else if (st.key === 'problem') {
      const c = el('a', 'ep-btn', 'Contact'); c.href = '../contact/';
      acts.appendChild(c);
    }
    if (acts.children.length) row.appendChild(acts);
    list.appendChild(row);
  });
  host.appendChild(list);
}
/* after a payment: ask every 3 seconds for up to a minute, until a league more than before is built */
let polling = 0;
function pollAfterPaid() {
  const built = rows => (rows || []).filter(r => r && r.league_id).length;
  const before = built(S.mine);
  const n0 = (S.mine || []).length;
  const until = Date.now() + 60000;
  const my = ++polling;
  const tick = async () => {
    if (my !== polling) return;
    const rows = await readMine();
    paintMine();
    if (rows && (built(rows) > before || (rows.length > n0 && built(rows) >= rows.length))) return;
    if (Date.now() < until) setTimeout(tick, 3000);
  };
  tick();
}

async function init() {
  wireForm();
  const payP = payments();
  const [pl, pay] = await Promise.all([rpc('access_plans_public', { p_league: null }), soon(payP, 1500)]);
  S.pay = pay === undefined ? null : pay;
  if (pay === undefined) payP.then(p => { if (p !== S.pay) { S.pay = p; paintGo(); } });
  const plans = (Array.isArray(pl.data) ? pl.data : []).filter(p => p && p.kind === 'league_setup' && !p.league_id)
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || (Number(a.price_pennies) || 0) - (Number(b.price_pennies) || 0));
  S.plan = plans.find(p => p.purchasable !== false) || plans[0] || null;
  paintPrice();
  paintGo();
  await readMine();
  paintMine();
}

function start() {
  init().catch(e => { if (root.console) console.warn('[setup-league]', e); });
  root.addEventListener('epinoia:paid', e => { const k = e && e.detail && e.detail.kind; if (!k || k === 'league_setup') pollAfterPaid(); });
  const a = A();
  if (a && a.onChange) a.onChange(d => { if (d && d.reason === 'auth') readMine().then(paintMine, () => {}); });
}
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
else start();

return API;
}));
