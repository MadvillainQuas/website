'use strict';
/* ============================================================================
   MEMBERSHIP (membership/): Epinoia's tiers, side by side, bought on the page (Louie, 2026-10-16: "a visually
   attractive page detailing (automatically based on the matrix) the benefits of each tier").

   THE COLUMNS are the matrix's (0279, access_wall): Free (everyone, signed out too), Signed in (a free account), then
   each of Epinoia's tiers (access_plans kind 'tier', league_id null) in their order. WHAT EACH ONE OPENS is worked out
   here from the same rows every lock on the site reads, never written by hand:

     a section is in Free        when its gate is 'free'
                  in Signed in   when its gate is 'free' or 'signin'
                  in a tier      when its gate is 'free' or 'signin', or the tier's privileges name it
                                 (a database before 0279: when the tier's features name the section's old gate)

   so a tick moved in the platform console moves this page with it. Each card says "Everything in <the column before>,
   plus:" and lists only what is new there, by category; the table under the cards lists every section.

   Buying is the payment window's (access.js buy, paywindow.js): a tier opens on its own plan; the Manager pass goes
   straight to the step before money. While payments are not switched on the prices still show, and the buttons say so.

   The pure parts (rowsOf, columns, grouped) are exported for supabase/tests/sales-pages.test.mjs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMembershipPage = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* ------------------------------------------------------------ pure parts --- */
/* the categories, in the order the cards and the table list them */
const CATEGORIES = [
  ['analytics', 'Analytics'],
  ['reports', 'Reports'],
  ['club', 'For clubs (front office)'],
  ['manager', 'Manager mode']
];
/* a section's category when the wall does not say (a database before 0279 had none) */
const CATEGORY_OF = { clubReport: 'reports', playerReport: 'reports', gameReport: 'reports', frontOffice: 'club', manager: 'manager' };
const OLD_GATES = ['analytics', 'club_report', 'player_report'];
const humanise = k => { const s = String(k).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

/* THE ROWS: every lockable section, from the wall (EpinoiaAccess.wallGates(): { key: { gate, category, sort } }) and,
   for a section the wall does not name, the catalogue's default (CATALOGUE.locks: { key: { gate, label, what } }).
   `matrix` false (a wall from before 0279) takes the categories from the keys. In category order, then sort, then the
   catalogue's own order. */
function rowsOf(gates, locks, matrix) {
  const g = gates && typeof gates === 'object' ? gates : {};
  const L = locks && typeof locks === 'object' ? locks : {};
  const order = Object.keys(L);
  const keys = Object.keys(g).concat(order.filter(k => !(k in g)));
  const cat = c => CATEGORIES.findIndex(x => x[0] === c);
  return keys.map(key => {
    const w = g[key] || {}, l = L[key] || {};
    const fromWall = matrix !== false && typeof w.category === 'string' && cat(w.category) >= 0;
    return {
      key,
      gate: String(w.gate || l.gate || 'tiers'),
      category: fromWall ? w.category : (CATEGORY_OF[key] || 'analytics'),
      sort: Number.isFinite(Number(w.sort)) && matrix !== false ? Number(w.sort) : 100,
      label: l.label || humanise(key),
      /* a reader's line: the catalogue's notes to whoever maintains it ("(docs/... §10.3)") left out */
      what: String(l.what || '').replace(/\s*\((?:docs\/|see )[^)]*\)/g, '').trim()
    };
  }).sort((a, b) => cat(a.category) - cat(b.category) || a.sort - b.sort ||
    ((order.indexOf(a.key) + 1 || 999) - (order.indexOf(b.key) + 1 || 999)) || (a.key < b.key ? -1 : 1));
}

/* does a tier open a row: a free or signed-in row always; then its privileges; then (before 0279) its features */
function tierHas(t, row) {
  if (row.gate === 'free' || row.gate === 'signin') return true;
  const priv = Array.isArray(t && t.privileges) ? t.privileges : [];
  if (priv.indexOf(row.key) >= 0) return true;
  const feats = Array.isArray(t && t.features) ? t.features : [];
  return OLD_GATES.indexOf(row.gate) >= 0 && feats.indexOf(row.gate) >= 0;
}

/* THE COLUMNS: Free, Signed in, then each tier, each with
     has    the keys it opens, in row order
     base   the index of the column it builds on: the nearest one before it whose every section it holds too
            (Signed in builds on Free; a tier on the tier before it, or on Signed in when it does not hold all of it)
     fresh  what it opens that its base does not: the "plus:" of its card */
function columns(rows, tiers) {
  const R = Array.isArray(rows) ? rows : [];
  const cols = [
    { id: 'free', kind: 'free', name: 'Free', has: R.filter(r => r.gate === 'free').map(r => r.key) },
    { id: 'signin', kind: 'signin', name: 'Signed in', has: R.filter(r => r.gate === 'free' || r.gate === 'signin').map(r => r.key) }
  ];
  (Array.isArray(tiers) ? tiers : []).forEach(t => {
    if (!t || !t.id) return;
    cols.push({ id: t.id, kind: 'tier', name: String(t.name || 'Membership'), tier: t, has: R.filter(r => tierHas(t, r)).map(r => r.key) });
  });
  cols.forEach((c, i) => {
    c.base = null;
    for (let j = i - 1; j >= 0; j--) {
      if (cols[j].has.every(k => c.has.indexOf(k) >= 0)) { c.base = j; break; }
    }
    const before = c.base == null ? [] : cols[c.base].has;
    c.fresh = c.has.filter(k => before.indexOf(k) < 0);
  });
  return cols;
}

/* keys by category, for a card's list: [{ category, label, keys }] with the empty ones left out */
function grouped(keys, rows) {
  const R = Array.isArray(rows) ? rows : [];
  const want = new Set(Array.isArray(keys) ? keys : []);
  return CATEGORIES.map(([category, label]) => ({ category, label, keys: R.filter(r => r.category === category && want.has(r.key)).map(r => r.key) }))
    .filter(g => g.keys.length);
}

/* Epinoia's tiers from the price list (access_plans_public), in their order; a list from before 0279 has no kind, and
   every platform plan in it was a tier. The wall's tiers fill in what an older list left off. */
function tiersFrom(plans, wallTiers) {
  const wt = Array.isArray(wallTiers) ? wallTiers : [];
  const list = (Array.isArray(plans) ? plans : []).filter(p => p && p.id && !p.league_id && (!p.kind || p.kind === 'tier'));
  const src = list.length ? list : wt;
  return src.map((p, i) => {
    const w = wt.find(x => x.id === p.id) || {};
    return Object.assign({}, p, {
      privileges: Array.isArray(p.privileges) ? p.privileges : (w.privileges || []),
      purchasable: p.purchasable !== false,
      _i: i
    });
  }).sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || a._i - b._i);
}

/* ------------------------------------------------------------- the page --- */
const BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
if (!BROWSER) return { CATEGORIES, rowsOf, columns, grouped, tiersFrom, tierHas };

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
/* one door to the database: { status, data }; never throws */
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
/* is the payment service switched on: true, false, or null when it could not be asked */
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

/* the rows a reader always has, signed out or not: what happened on court */
const ON_COURT = ['Box scores and play-by-play', 'Fixtures, results and standings', 'Season statistics tables', 'Club and player pages'];
/* and what a free account adds that is not a lock */
const ACCOUNT = ['Follow clubs and players', 'Alerts for the games you follow'];

const S = { rows: [], cols: [], tiers: [], products: {}, mine: null, pay: null, off: false, signedIn: false, loaded: false };

function mineHolds(t) {
  const m = S.mine;
  if (!m) return false;
  const subs = Array.isArray(m.subscriptions) ? m.subscriptions : [];
  if (subs.some(s => s && s.active !== false && s.plan_id === t.id)) return true;
  const grants = Array.isArray(m.grants) ? m.grants : [];
  return grants.some(g => g && g.plan_name && g.plan_name === t.name);
}

function priceBlock(p, c, per) {
  const d = el('div', 'sl-price');
  d.appendChild(el('b', null, amount(p, c)));
  if (per) d.appendChild(el('span', null, per));
  return d;
}
function tickList(items, names) {
  const ul = el('ul', 'sl-ticks');
  items.forEach(t => {
    const li = el('li');
    li.appendChild(el('span', 'sl-tk', '✓'));
    const s = el('span', null, t);
    if (names) s.setAttribute('translate', 'no');
    li.appendChild(s);
    ul.appendChild(li);
  });
  return ul;
}
function label(key) {
  const r = S.rows.find(x => x.key === key);
  return r ? r.label : key;
}

function buyButton(t) {
  const b = el('button', 'ep-btn pri sl-go');
  b.type = 'button';
  if (t.purchasable === false) { b.textContent = 'Not on sale yet'; b.disabled = true; return b; }
  if (S.off) { b.textContent = 'Memberships open soon'; b.disabled = true; return b; }
  if (S.pay === false) { b.textContent = 'Payments open soon'; b.disabled = true; return b; }
  b.textContent = 'Choose this tier';
  b.addEventListener('click', () => {
    const a = A();
    if (a && a.buy) a.buy({ planId: t.id, title: t.name, what: 'Every league' });
    else location.href = '../join/';
  });
  return b;
}

/* the highest tier, lit on its card and in its column: the last one, when there is more than one */
const topIndex = () => (S.cols.filter(c => c.kind === 'tier').length > 1 ? S.cols.length - 1 : -1);

function card(col, i) {
  const cur = S.tiers.length ? (S.tiers[0].currency || 'gbp') : 'gbp';
  const top = i === topIndex();
  const own = col.kind === 'tier' && mineHolds(col.tier);
  const c = el('article', 'sl-tier k-' + col.kind + (top ? ' top' : '') + (own ? ' mine' : ''));
  const head = el('div', 'sl-th');
  head.appendChild(el('p', 'sl-eye', col.kind === 'free' ? 'Everyone' : col.kind === 'signin' ? 'A free account' : 'Membership'));
  const h = el('h3', null, col.name);
  if (col.kind === 'tier') h.setAttribute('translate', 'no');
  head.appendChild(h);
  c.appendChild(head);

  if (col.kind === 'tier') {
    const t = col.tier;
    const trial = Math.floor(Number(t.trial_months) || 0);
    c.appendChild(priceBlock(t.price_pennies, t.currency, t.interval === 'year' ? 'a year' : 'a month'));
    if (trial > 0 && trial <= 12) c.appendChild(el('span', 'sl-trial', trial === 1 ? '1 month free for new members' : trial + ' months free for new members'));
    if (t.blurb) c.appendChild(el('p', 'sl-blurb', t.blurb));
    const act = el('div', 'sl-act');
    if (own) act.appendChild(el('span', 'sl-own', 'Your plan'));
    else act.appendChild(buyButton(t));
    c.appendChild(act);
  } else {
    c.appendChild(priceBlock(0, cur, col.kind === 'free' ? 'no account needed' : 'with a free account'));
    c.appendChild(el('p', 'sl-blurb', col.kind === 'free'
      ? 'Everything that happened on court, in every open league.'
      : 'Sign in with your email, Google or Discord. It takes a moment.'));
    const act = el('div', 'sl-act');
    if (col.kind === 'signin') {
      if (S.signedIn) act.appendChild(el('span', 'sl-own', 'You’re signed in'));
      else {
        const a = el('a', 'ep-btn sl-go', 'Sign in');
        const x = A();
        a.href = x && x.signinHref ? x.signinHref() : '../signin/';
        act.appendChild(a);
      }
    } else act.appendChild(el('span', 'sl-own quiet', 'Open to all'));
    c.appendChild(act);
  }

  const gets = el('div', 'sl-gets');
  if (col.base != null) gets.appendChild(el('p', 'sl-base', 'Everything in ' + S.cols[col.base].name + ', plus:'));
  if (col.kind === 'free') {
    gets.appendChild(el('h4', null, 'On court'));
    gets.appendChild(tickList(ON_COURT));
  }
  if (col.kind === 'signin') {
    gets.appendChild(el('h4', null, 'Your account'));
    gets.appendChild(tickList(ACCOUNT));
  }
  grouped(col.fresh, S.rows).forEach(g => {
    gets.appendChild(el('h4', null, g.label));
    gets.appendChild(tickList(g.keys.map(label)));
  });
  if (col.kind === 'tier' && !col.fresh.length) gets.appendChild(el('p', 'sl-none', 'The sections it opens are being chosen.'));
  c.appendChild(gets);
  return c;
}

function paintCards() {
  const host = $('#tierCards');
  host.textContent = '';
  host.setAttribute('aria-busy', 'false');
  const note = $('#tierNote');
  note.textContent = '';
  note.classList.add('hide');
  /* switched off with tiers to show: say why their buttons wait (with none, the empty card says it) */
  if (S.off && S.tiers.length) { note.textContent ='Memberships are not available yet, so everything on Epinoia is free for now.'; note.classList.remove('hide'); }
  const grid = el('div', 'sl-tiers');
  S.cols.forEach((c, i) => grid.appendChild(card(c, i)));
  if (!S.tiers.length) {
    const ph = el('article', 'sl-tier sl-soon');
    ph.append(el('p', 'sl-eye', 'Membership'), el('h3', null, 'Not on sale yet'),
      el('p', 'sl-blurb', 'Nothing is on sale yet, so everything on Epinoia is free until memberships open.'));
    grid.appendChild(ph);
  }
  grid.dataset.n = String(grid.children.length);
  host.appendChild(grid);

  /* one report as a PDF, bought from the report's own tab */
  const pdf = $('#pdfNote');
  const pp = S.products.player_pdf, cp = S.products.club_pdf;
  pdf.textContent = '';
  if (pp || cp) {
    const prices = [];
    if (pp) prices.push(['A player report', amountFull(pp)]);
    if (cp) prices.push(['A club report', amountFull(cp)]);
    pdf.appendChild(el('span', 'sl-pdf-k', 'One report as a PDF'));
    prices.forEach(([k, v]) => { const s = el('span', 'sl-pdf-v'); s.append(el('span', null, k), el('b', null, v)); pdf.appendChild(s); });
    pdf.appendChild(el('span', 'sl-pdf-w', 'From the report’s own tab'));
    pdf.classList.remove('hide');
  } else pdf.classList.add('hide');
}
const amountFull = p => { const a = A(); return a && a.amountText ? a.amountText(p.price_pennies, p.currency) : amount(p.price_pennies, p.currency); };

function paintTable() {
  const host = $('#cmpBody');
  host.textContent = '';
  host.setAttribute('aria-busy', 'false');
  const wrap = el('div', 'sl-cmpwrap');
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'region');
  wrap.setAttribute('aria-label', 'Every section, tier by tier');
  const t = el('table', 'sl-cmp');
  const thead = el('thead'), hr = el('tr');
  hr.appendChild(el('th', 'sl-cmp-k', 'Section'));
  const topAt = topIndex();
  S.cols.forEach((c, i) => {
    const th = el('th', 'c' + (i === topAt ? ' top' : ''));
    th.scope = 'col';
    const n = el('span', 'cn', c.name);
    if (c.kind === 'tier') n.setAttribute('translate', 'no');
    th.appendChild(n);
    if (c.kind === 'tier') {
      const p = el('span', 'cp');
      p.append(el('b', null, amount(c.tier.price_pennies, c.tier.currency)), doc.createTextNode(' '), el('span', null, c.tier.interval === 'year' ? 'a year' : 'a month'));
      th.appendChild(p);
    }
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  t.appendChild(thead);
  const tb = el('tbody');
  const group = name => { const tr = el('tr', 'grp'); const th = el('th', null, name); th.colSpan = S.cols.length + 1; th.scope = 'colgroup'; tr.appendChild(th); tb.appendChild(tr); };
  const row = (text, what, has) => {
    const tr = el('tr');
    const th = el('th');
    th.scope = 'row';
    th.appendChild(el('span', 'rk', text));
    if (what) { th.appendChild(el('small', null, what)); th.title = what; }
    tr.appendChild(th);
    has.forEach((h, i) => {
      const td = el('td', 'c ' + (h ? 'yes' : 'no') + (i === topAt ? ' top' : ''), h ? '✓' : '–');
      td.setAttribute('aria-label', h ? 'Yes' : 'No');
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  };
  group('On court');
  ON_COURT.forEach(x => row(x, '', S.cols.map(() => true)));
  group('Your account');
  ACCOUNT.forEach(x => row(x, '', S.cols.map(c => c.kind !== 'free')));
  CATEGORIES.forEach(([cat, name]) => {
    const rs = S.rows.filter(r => r.category === cat);
    if (!rs.length) return;
    group(name);
    rs.forEach(r => row(r.label, r.what, S.cols.map(c => c.has.indexOf(r.key) >= 0)));
  });
  t.appendChild(tb);
  wrap.appendChild(t);
  host.appendChild(wrap);
}

function paintManager() {
  const sec = $('#manager'), host = $('#mgrBody');
  const m = S.products.manager;
  const row = S.rows.find(r => r.key === 'manager');
  if (!m || (row && row.gate === 'free')) { sec.classList.add('hide'); return; }
  sec.classList.remove('hide');
  host.textContent = '';
  const strip = el('div', 'sl-strip');
  const tx = el('div', 'sl-strip-t');
  tx.append(el('b', null, 'EPINOIA Manager'),
    el('p', null, 'Build a club from real players and play a real league’s season. The leaderboards stay open to everyone.'));
  if (m.includes_tier_name) tx.appendChild(el('p', 'sl-with', 'Comes with ' + m.includes_tier_name + ' membership'));
  strip.appendChild(tx);
  strip.appendChild(priceBlock(m.price_pennies, m.currency, m.interval === 'year' ? 'a year' : 'a month'));
  const act = el('div', 'sl-act');
  const b = el('button', 'ep-btn pri sl-go');
  b.type = 'button';
  if (m.purchasable === false) { b.textContent = 'Not on sale yet'; b.disabled = true; }
  else if (S.pay === false) { b.textContent = 'Payments open soon'; b.disabled = true; }
  else {
    b.textContent = 'Get the pass';
    b.addEventListener('click', () => { const a = A(); if (a && a.buy) a.buy({ planId: m.id, product: 'manager', title: 'Manager mode', what: 'Playing EPINOIA Manager' }); });
  }
  act.appendChild(b);
  strip.appendChild(act);
  host.appendChild(strip);
}

function paint() {
  paintCards();
  paintTable();
  paintManager();
}

async function readMine() {
  const a = A();
  const s = a && a.session ? a.session() : null;
  S.signedIn = !!s;
  if (!s) { S.mine = null; return; }
  const r = await rpc('my_access', {}, true);
  S.mine = r.data && typeof r.data === 'object' ? r.data : null;
}

async function init() {
  const a = A();
  const payP = payments();
  const [wall, pl, st, pay] = await Promise.all([
    a && a.loadWall ? a.loadWall().catch(() => null) : Promise.resolve(null),
    rpc('access_plans_public', { p_league: null }),
    a && a.load ? a.load({}).catch(() => null) : Promise.resolve(null),
    soon(payP, 1500)
  ]);
  S.pay = pay === undefined ? null : pay;
  if (pay === undefined) payP.then(p => { if (p !== S.pay) { S.pay = p; if (S.loaded) paint(); } });
  S.off = !!(st && st.known && st.membershipsEnabled === false);
  const gates = a && a.wallGates ? a.wallGates() : {};
  const locks = a && a.CATALOGUE ? a.CATALOGUE.locks : {};
  S.rows = rowsOf(gates, locks, !!(wall && wall.matrix));
  S.tiers = tiersFrom(pl.data, a && a.wallTiers ? a.wallTiers() : []);
  /* the things sold on their own: the wall's (cheapest of each kind), else the price list's */
  const prods = a && a.products ? Object.assign({}, a.products()) : {};
  (Array.isArray(pl.data) ? pl.data : []).forEach(p => {
    if (p && p.kind && p.kind !== 'tier' && !p.league_id && !prods[p.kind]) prods[p.kind] = p;
  });
  S.products = prods;
  S.cols = columns(S.rows, S.tiers);
  await readMine();
  S.loaded = true;
  paint();
}

function start() {
  init().catch(e => { if (root.console) console.warn('[membership]', e); });
  const again = () => { if (S.loaded) readMine().then(paint, () => {}); };
  root.addEventListener('epinoia:paid', () => { const a = A(); if (a && a.forget) a.forget(); again(); });
  const a = A();
  if (a && a.onChange) a.onChange(d => { if (d && d.reason === 'auth') again(); });
}
if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start);
else start();

return { CATEGORIES, rowsOf, columns, grouped, tiersFrom, tierHas };
}));
