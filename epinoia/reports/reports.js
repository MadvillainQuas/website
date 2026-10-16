'use strict';
/* ============================================================================
   REPORTS (reports/): the report emails, bought on the page (Louie, 2026-10-16: "purchase a reports subscription
   direct on the page (i.e. player report subscription with customisable tiers, team report subscription with
   customisable tiers when set up etc.)").

   Two kinds on sale (0279, access_plans): player_mail (a player's report every Monday; mail_kinds 'weekly',
   'matchups') and team_mail (a club's reports; 'games', 'opponents', 'own', 'zip'). The reader picks who the reports
   are about (site_search), where they go, a first name to greet and a time zone, then a tier; the payment window
   (access.js buy) carries that as the checkout's details, and billing_provision adds the address when the subscription
   is written. A PDF of one report is bought on the report's own tab; this page only says what it costs.

   The pure parts (mailLines, detailsFor, whatFor, plansOf, subState) are exported for
   supabase/tests/sales-pages.test.mjs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaReportsPage = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ------------------------------------------------------------ pure parts --- */
/* what each email a tier sends is, in the order they are listed */
const MAIL = [
  ['weekly', 'The player report every Monday morning, with the week’s games'],
  ['matchups', 'Potential match-up reports for the week ahead'],
  ['games', 'Each game’s analysis, as soon as it is final'],
  ['opponents', 'Scouting reports on the week’s opponents, every Sunday'],
  ['own', 'The club’s own team report every other Sunday'],
  ['zip', 'Every player’s report in one ZIP after the Sunday email']
];
function mailLines(kinds) {
  const k = Array.isArray(kinds) ? kinds : [];
  return MAIL.filter(m => k.indexOf(m[0]) >= 0).map(m => m[1]);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* the database's own rule for a time zone (billing_provision), so what is sent is what is kept */
const TZ = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function emailOk(s) { const e = String(s == null ? '' : s).trim(); return !e || (e.length <= 254 && EMAIL.test(e)); }

/* WHAT TO BUILD, as the checkout carries it (access_checkouts.details): who the reports are about, the address (left
   out: the account's own), the first name to greet (left out when blank) and the time zone. null while it cannot be
   bought: nobody picked, or an address that is not one. */
function detailsFor(kind, pick, form) {
  if (kind !== 'player_mail' && kind !== 'team_mail') return null;
  if (!pick || !UUID.test(String(pick.id || ''))) return null;
  const f = form || {};
  const email = String(f.email == null ? '' : f.email).trim().toLowerCase();
  if (!emailOk(email)) return null;
  const d = {};
  d[kind === 'team_mail' ? 'team_id' : 'player_id'] = String(pick.id);
  if (email) d.email = email;
  const name = String(f.name == null ? '' : f.name).trim().replace(/\s+/g, ' ').slice(0, 60);
  if (name) d.name = name;
  const tz = String(f.tz == null ? '' : f.tz).trim();
  d.tz = TZ.test(tz) ? tz : 'UTC';
  return d;
}
/* the line the payment window shows over the price */
function whatFor(kind, subject, email) {
  const to = email ? String(email).trim().toLowerCase() : '';
  return (kind === 'team_mail' ? 'Reports on ' : 'Weekly reports on ') + String(subject || '') + ' to ' + (to || 'your account’s address');
}
/* the tiers of one kind on sale, in their order (the price list is already active plans only) */
function plansOf(plans, kind) {
  return (Array.isArray(plans) ? plans : []).filter(p => p && p.id && p.kind === kind && !p.league_id)
    .map((p, i) => [p, i]).sort((a, b) => (Number(a[0].sort) || 0) - (Number(b[0].sort) || 0) ||
      (Number(a[0].price_pennies) || 0) - (Number(b[0].price_pennies) || 0) || a[1] - b[1]).map(x => x[0]);
}
/* how a subscription stands, in the words the account page uses (me.js subState): ending is either flag */
function subState(s, longDate) {
  const day = typeof longDate === 'function' ? longDate : (x => x);
  const ending = !!s.cancel_at_period_end || !!s.cancel_at;
  const iso = ending ? (s.cancel_at || s.current_period_end) : s.current_period_end;
  const end = iso ? day(iso) : '';
  if (s.status === 'active' || s.status === 'trialing') {
    if (ending) return { text: end ? 'Cancelled. Your access ends on ' + end + '.' : 'Cancelled. Your access ends at the end of this period.', cls: 'end', live: true };
    if (s.status === 'trialing') return { text: end ? 'Free trial. The first payment is on ' + end + '.' : 'Free trial.', cls: '', live: true };
    return { text: end ? 'Renews on ' + end + '.' : 'Active.', cls: '', live: true };
  }
  if (s.status === 'past_due' || s.status === 'unpaid' || s.status === 'incomplete') {
    return { text: 'Payment problem: update your card in Manage billing.' + (ending && end ? ' It is set to end on ' + end + '.' : ''), cls: 'bad', live: true };
  }
  if (s.status === 'paused') return { text: 'Paused.', cls: 'end', live: true };
  return { text: 'Ended.', cls: 'end', live: false };
}

/* ------------------------------------------------------------- the page --- */
const BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
const API = { MAIL, mailLines, detailsFor, whatFor, plansOf, subState, emailOk };
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
const amount = (p, c) => { const a = A(); const t = a && a.amountText ? a.amountText(p, c) : '£' + ((Number(p) || 0) / 100).toFixed(2); return t; };
const big = (p, c) => amount(p, c).replace(/\.00$/, '');
const longDate = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };
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
async function rest(path) {
  const c = CFG();
  if (!c.supabaseUrl || !c.supabaseAnonKey) return [];
  try {
    const r = await fetch(c.supabaseUrl + '/rest/v1/' + path, { headers: { apikey: c.supabaseAnonKey, Accept: 'application/json' } });
    const j = r.ok ? await r.json() : [];
    return Array.isArray(j) ? j : [];
  } catch (_) { return []; }
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

const S = { plans: [], products: {}, pay: null, mine: null, signedIn: false, email: '' };
/* the two kinds on the page, each with its own form */
const KINDS = {
  player_mail: { pre: 'p', what: 'player', eye: 'Player report emails', pickFirst: 'Pick a player first', pick: null },
  team_mail: { pre: 'c', what: 'team', eye: 'Club report emails', pickFirst: 'Pick a club first', pick: null }
};

function zones() { try { return Intl.supportedValuesOf('timeZone'); } catch (_) { return ['UTC', 'Europe/London']; } }
function fillZones(sel) {
  const here = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; } })();
  const list = zones();
  if (list.indexOf(here) < 0) list.unshift(here);
  if (list.indexOf('UTC') < 0) list.push('UTC');
  list.forEach(z => { const o = el('option', null, z.replace(/_/g, ' ')); o.value = z; if (z === here) o.selected = true; sel.appendChild(o); });
}

/* A PICKER: the site's search as it is typed, its players or its clubs only */
function wirePicker(kind) {
  const K = KINDS[kind], p = K.pre;
  const inp = $('#' + p + 'Find'), list = $('#' + p + 'Found'), chosen = $('#' + p + 'Chosen');
  let tm = 0, seq = 0;
  const close = () => { list.hidden = true; list.textContent = ''; inp.setAttribute('aria-expanded', 'false'); };
  const choose = x => {
    K.pick = { id: x.id, name: x.name, sub: x.sub || x.league_name || '' };
    chosen.textContent = '';
    chosen.classList.remove('none');
    const nm = el('b', null, x.name); nm.setAttribute('translate', 'no');
    chosen.appendChild(nm);
    if (K.pick.sub) { const s = el('span', 'sub', K.pick.sub); s.setAttribute('translate', 'no'); chosen.appendChild(s); }
    const ch = el('button', 'sl-change', 'change'); ch.type = 'button';
    ch.addEventListener('click', () => { K.pick = null; chosen.textContent = kind === 'team_mail' ? 'No club picked yet' : 'No player picked yet'; chosen.classList.add('none'); inp.value = ''; inp.focus(); paintPlans(kind); });
    chosen.appendChild(ch);
    inp.value = '';
    close();
    paintPlans(kind);
  };
  inp.addEventListener('input', () => {
    clearTimeout(tm);
    const q = inp.value.trim();
    if (q.length < 2) { close(); return; }
    tm = setTimeout(async () => {
      const my = ++seq;
      const r = await rpc('site_search', { p_q: q, p_limit: 12 });
      if (my !== seq) return;
      const rows = (Array.isArray(r.data) ? r.data : []).filter(x => x && x.kind === K.what && x.id);
      list.textContent = '';
      if (!rows.length) {
        list.appendChild(el('li', 'none', r.status === 0 ? 'The search could not be reached just now' : 'Nobody by that name'));
      }
      rows.forEach(x => {
        const li = el('li');
        const b = el('button', null);
        b.type = 'button';
        const n = el('b', null, x.name); n.setAttribute('translate', 'no');
        b.appendChild(n);
        const where = [x.sub, x.league_name].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
        if (where) { const s = el('small', null, where); s.setAttribute('translate', 'no'); b.appendChild(s); }
        b.addEventListener('click', () => choose(x));
        li.appendChild(b);
        list.appendChild(li);
      });
      list.hidden = false;
      inp.setAttribute('aria-expanded', 'true');
    }, 250);
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowDown' && !list.hidden) { const b = list.querySelector('button'); if (b) { e.preventDefault(); b.focus(); } }
  });
  list.addEventListener('keydown', e => {
    const bs = [...list.querySelectorAll('button')], i = bs.indexOf(doc.activeElement);
    if (e.key === 'Escape') { close(); inp.focus(); }
    else if (e.key === 'ArrowDown' && i >= 0 && i < bs.length - 1) { e.preventDefault(); bs[i + 1].focus(); }
    else if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); (i ? bs[i - 1] : inp).focus(); }
  });
  doc.addEventListener('click', e => { if (!list.hidden && !list.contains(e.target) && e.target !== inp) close(); });
  const em = $('#' + p + 'Email');
  em.addEventListener('input', () => paintPlans(kind));
}
const formOf = kind => { const p = KINDS[kind].pre; return { email: $('#' + p + 'Email').value, name: $('#' + p + 'Name').value, tz: $('#' + p + 'Tz').value }; };

function planCard(kind, plan) {
  const K = KINDS[kind];
  const c = el('article', 'sl-tier sl-rtier');
  c.appendChild(el('p', 'sl-eye', K.eye));
  const h = el('h3', null, plan.name || 'Report emails'); h.setAttribute('translate', 'no');
  c.appendChild(h);
  const pr = el('div', 'sl-price');
  pr.append(el('b', null, big(plan.price_pennies, plan.currency)), el('span', null, plan.interval === 'year' ? 'a year' : 'a month'));
  c.appendChild(pr);
  if (plan.blurb) c.appendChild(el('p', 'sl-blurb', plan.blurb));
  const lines = mailLines(plan.mail_kinds);
  if (lines.length) {
    const ul = el('ul', 'sl-ticks');
    lines.forEach(t => { const li = el('li'); li.append(el('span', 'sl-tk', '✓'), el('span', null, t)); ul.appendChild(li); });
    c.appendChild(ul);
  }
  if (plan.includes_tier_name) c.appendChild(el('p', 'sl-with', 'Comes with ' + plan.includes_tier_name + ' membership'));
  const act = el('div', 'sl-act');
  const b = el('button', 'ep-btn pri sl-go');
  b.type = 'button';
  const form = formOf(kind);
  const d = detailsFor(kind, K.pick, form);
  if (plan.purchasable === false) { b.textContent = 'Not on sale yet'; b.disabled = true; }
  else if (S.pay === false) { b.textContent = 'Payments open soon'; b.disabled = true; }
  else if (!K.pick) { b.textContent = K.pickFirst; b.disabled = true; }
  else if (!emailOk(form.email)) { b.textContent = 'Check the address'; b.disabled = true; }
  else {
    b.textContent = 'Subscribe';
    b.addEventListener('click', () => {
      const f = formOf(kind);
      const det = detailsFor(kind, K.pick, f);
      const a = A();
      if (!det || !a || !a.buy) return;
      a.buy({ planId: plan.id, details: det, title: plan.name || 'Report emails', what: whatFor(kind, K.pick.name, det.email || S.email) });
    });
  }
  act.appendChild(b);
  c.appendChild(act);
  c.classList.toggle('ready', !!d && !b.disabled);
  return c;
}

function paintPlans(kind) {
  const K = KINDS[kind], p = K.pre;
  const host = $('#' + p + 'Plans'), form = $('#' + p + 'Form');
  const list = plansOf(S.plans, kind);
  host.textContent = '';
  host.setAttribute('aria-busy', 'false');
  if (!list.length) {
    form.classList.add('hide');
    const e = el('div', 'pg-empty');
    e.append(el('p', null, 'Not on sale yet.'), el('p', 'sl-soon-l', 'These report emails go on sale here as soon as they are ready.'));
    host.appendChild(e);
    return;
  }
  form.classList.remove('hide');
  const em = $('#' + p + 'Email'), bad = $('#' + p + 'EmailBad');
  bad.classList.toggle('hide', emailOk(em.value));
  const grid = el('div', 'sl-tiers sl-rgrid');
  list.forEach(pl => grid.appendChild(planCard(kind, pl)));
  grid.dataset.n = String(list.length);
  host.appendChild(grid);
}

function paintPdf() {
  const host = $('#pdfBody');
  host.textContent = '';
  const pp = S.products.player_pdf, cp = S.products.club_pdf;
  if (!pp && !cp) {
    const e = el('div', 'pg-empty');
    e.append(el('p', null, 'Not on sale yet.'), el('p', 'sl-soon-l', 'A single report as a PDF goes on sale on each report’s own tab.'));
    host.appendChild(e);
    return;
  }
  const row = el('div', 'sl-pdfs');
  [[pp, 'A player’s report', 'The Report tab on the player’s page'], [cp, 'A club’s report', 'The Report tab on the club’s page']].forEach(([x, k, where]) => {
    if (!x) return;
    const t = el('div', 'sl-pdfc');
    t.appendChild(el('p', 'sl-eye', k));
    const pr = el('div', 'sl-price');
    pr.append(el('b', null, big(x.price_pennies, x.currency)), el('span', null, 'paid once'));
    t.appendChild(pr);
    t.appendChild(el('p', 'sl-blurb', where));
    row.appendChild(t);
  });
  host.appendChild(row);
  host.appendChild(el('p', 'sl-fine', 'Each PDF is the report as it stands the day you buy it, yours to download straight away. Nothing renews.'));
}

async function readMine() {
  const a = A();
  const s = a && a.session ? a.session() : null;
  S.signedIn = !!s;
  S.email = s && s.email ? s.email : '';
  if (!s) { S.mine = null; return; }
  const r = await rpc('my_access', {}, true);
  S.mine = r.data && typeof r.data === 'object' ? r.data : null;
}

async function paintMine() {
  const sec = $('#mine'), host = $('#mineBody');
  if (!S.signedIn || !S.mine) { sec.classList.add('hide'); return; }
  const subs = (Array.isArray(S.mine.subscriptions) ? S.mine.subscriptions : []).filter(s => s && (s.kind === 'player_mail' || s.kind === 'team_mail'));
  sec.classList.remove('hide');
  host.textContent = '';
  if (!subs.length) {
    const e = el('div', 'pg-empty');
    e.appendChild(el('p', null, 'The report emails you pay for appear here, once you subscribe to one.'));
    host.appendChild(e);
    return;
  }
  /* who each one is about: the names, read once */
  const pid = [], tid = [];
  subs.forEach(s => { const d = s.details || {}; if (UUID.test(String(d.player_id || ''))) pid.push(d.player_id); if (UUID.test(String(d.team_id || ''))) tid.push(d.team_id); });
  const [ps, ts] = await Promise.all([
    pid.length ? rest('players?select=id,first_name,last_name&id=in.(' + [...new Set(pid)].join(',') + ')') : [],
    tid.length ? rest('teams?select=id,name&id=in.(' + [...new Set(tid)].join(',') + ')') : []
  ]);
  const who = {};
  ps.forEach(p => { who[p.id] = [p.first_name, p.last_name].filter(Boolean).join(' '); });
  ts.forEach(t => { who[t.id] = t.name; });
  const list = el('div', 'sl-subs');
  subs.forEach(s => {
    const st = subState(s, longDate);
    const d = s.details || {};
    const row = el('div', 'sl-sub');
    const tx = el('div', 'sl-sub-t');
    const b = el('b', null, s.plan_name || 'Report emails'); b.setAttribute('translate', 'no');
    tx.appendChild(b);
    const subj = who[d.player_id || d.team_id] || (s.kind === 'team_mail' ? 'a club' : 'a player');
    tx.appendChild(el('small', null, whatFor(s.kind, subj, d.email || S.email)));
    tx.appendChild(el('span', 'st' + (st.cls ? ' ' + st.cls : ''), st.text));
    if (s.problem && st.live) tx.appendChild(el('span', 'st bad', 'We’re setting up the emails: if this stays, contact us'));
    row.appendChild(tx);
    const acts = el('div', 'sl-sub-a');
    const m = el('a', 'ep-btn', 'Manage billing'); m.href = '../me/';
    acts.appendChild(m);
    row.appendChild(acts);
    list.appendChild(row);
  });
  host.appendChild(list);
}

async function init() {
  const a = A();
  fillZones($('#pTz'));
  fillZones($('#cTz'));
  wirePicker('player_mail');
  wirePicker('team_mail');
  const payP = payments();
  const [pl, pay] = await Promise.all([
    rpc('access_plans_public', { p_league: null }),
    soon(payP, 1500),
    a && a.loadWall ? a.loadWall().catch(() => null) : Promise.resolve(null)
  ]);
  S.pay = pay === undefined ? null : pay;
  if (pay === undefined) payP.then(p => { if (p !== S.pay) { S.pay = p; paintPlans('player_mail'); paintPlans('team_mail'); } });
  S.plans = Array.isArray(pl.data) ? pl.data : [];
  const prods = a && a.products ? Object.assign({}, a.products()) : {};
  S.plans.forEach(p => { if (p && p.kind && p.kind !== 'tier' && !p.league_id && !prods[p.kind]) prods[p.kind] = p; });
  S.products = prods;
  await readMine();
  ['pEmail', 'cEmail'].forEach(id => { const i = $('#' + id); if (S.email && !i.value) i.value = S.email; });
  paintPlans('player_mail');
  paintPlans('team_mail');
  paintPdf();
  await paintMine();
}

function start() {
  init().catch(e => { if (root.console) console.warn('[reports]', e); });
  root.addEventListener('epinoia:paid', () => { readMine().then(paintMine, () => {}); });
  const a = A();
  if (a && a.onChange) a.onChange(d => { if (d && d.reason === 'auth') readMine().then(() => { paintPlans('player_mail'); paintPlans('team_mail'); return paintMine(); }, () => {}); });
}
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
else start();

return API;
}));
