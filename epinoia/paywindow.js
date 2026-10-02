'use strict';
/* ============================================================================
   THE PAYMENT WINDOW — membership bought on the page the fan is on (docs/memberships.md §12).

   Every membership prompt (a teaser's button, the members-only card, the popup on a locked control) links to the
   join page. access.js turns a click on one into this window instead, loading this file the first time; if it
   cannot (offline, blocked), the click goes on to the join page as it always did. The window walks the same steps
   the join page does, on top of whatever the fan was looking at:

     PLANS      what is for sale where they are (access_plans_public: the league's own first, then Epinoia's), each
                with its free trial where this fan is due one (my_trial_offers, 0223)
     THE STEP   the summary the law asks for before money (what, what it costs, that it renews, the trial and when
     BEFORE     the first payment is), and the two boxes the buyer ticks themselves, word for word the billing
     MONEY      function's CONSENT (billing.test.mjs holds them equal)
     PAYING     Stripe's embedded Checkout, inside the window: the payment frame (payframe.html, the one page that
                runs Stripe.js, under its own CSP) with the platform's publishable key (billing status) and, for a
                league's own plan, its connected account; a card is confirmed in place. Without a publishable key, on
                a page that may not frame its own site, or if the frame cannot start: Stripe's own page, which comes
                back to this same page. No page's own CSP admits Stripe.
     CONFIRMED  the webhook is waited for (access_state, every two seconds, up to a minute), then the window says so
                and closes; every page redraws itself when what it may show changes (access.js onChange)

   Signed out, a plan's button signs them in and brings them back to this page with the window open on that plan
   (#epjoin=<plan>.<league>). Back from Stripe's own page (?joined=1) the window opens on CONFIRMED. Memberships switched off,
   or payments not switched on: the plans are shown, and nothing can be started.

     window.EpinoiaPayWindow.open({ href, key, leagueSlug, planId, confirming })
   The pure parts are exported for supabase/tests/paywindow.test.mjs.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaPayWindow = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* the wordings, by version, word for word the billing function's CONSENT and ADULT_WORDING */
const NOW_VERSION = '2026-09-a';
const NOW_WORDING = 'Start my access now. I understand that access begins straight away, so once it has started I lose my 14-day right to cancel.';
const TRIAL_VERSION = '2026-10-t';
const TRIAL_WORDING = 'Start my free trial now. I understand that access begins straight away and that, unless I cancel before the free trial ends, my membership is then charged automatically and renews until I cancel. Once my access has started I lose my 14-day right to cancel, but I can cancel online at any time.';
const ADULT_WORDING = 'I am 18 or over.';
const PENDING_KEY = 'epinoia_pay_pending';
const WAIT_MS = 60000, POLL_MS = 2000;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/* ------------------------------------------------------------ pure parts --- */
const months = n => n + (n === 1 ? ' month' : ' months');
const per = p => (p && p.interval === 'year' ? 'year' : 'month');
function money(pennies, currency) {
  const n = (Number(pennies) || 0) / 100, c = String(currency || 'gbp').toUpperCase();
  const sym = c === 'GBP' ? '£' : c === 'EUR' ? '€' : c === 'USD' ? '$' : '';
  return sym ? sym + n.toFixed(2) : n.toFixed(2) + ' ' + c;
}
/* the day a trial begun now ends: the same day of the month, months on, clamped (the billing function's trialEnd) */
function trialEndWords(n, now = new Date()) {
  const d = new Date(now), day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  t.setDate(Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return t.getDate() + ' ' + MONTH_NAMES[t.getMonth()] + ' ' + t.getFullYear();
}
/* the months free this fan is offered on a plan: the database's answer for them, else the plan's own */
function trialOf(p, offers) {
  const v = offers && Object.prototype.hasOwnProperty.call(offers, p.id) ? offers[p.id] : p.trial_months;
  const n = Math.floor(Number(v) || 0);
  return n > 0 && n <= 12 ? n : 0;
}
/* the league's own plans first (they came for that league), then Epinoia's; the ones on sale before the rest */
function ordered(plans) {
  const list = (Array.isArray(plans) ? plans : []).filter(p => p && p.id);
  const rank = p => (p.league_id ? 0 : 2) + (p.purchasable === false ? 1 : 0);
  return list.map((p, i) => [p, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);
}
/* what the step before money says, and what its button says */
function summary(p, trial, now) {
  const price = money(p.price_pennies, p.currency) + ' a ' + per(p);
  if (trial) {
    return {
      price: months(trial) + ' free, then ' + price + ', including any VAT. Nothing is charged today.',
      renew: 'From ' + trialEndWords(trial, now) + ' it renews automatically every ' + per(p) + ' at ' + money(p.price_pennies, p.currency) +
        ' until you cancel. Cancel before then and you pay nothing.',
      button: 'Start my free trial', version: TRIAL_VERSION, wording: TRIAL_WORDING
    };
  }
  return {
    price: price + ', including any VAT.',
    renew: 'It renews automatically every ' + per(p) + ' at ' + money(p.price_pennies, p.currency) + ' until you cancel.',
    button: 'Pay ' + price + ' and join', version: NOW_VERSION, wording: NOW_WORDING
  };
}
/* this page as the way back: its path and query, less what a return from Stripe added */
function hereFor(loc) {
  const q = new URLSearchParams(loc.search || '');
  ['joined', 'session_id'].forEach(k => q.delete(k));
  const s = q.toString();
  return (loc.pathname || '/epinoia/') + (s ? '?' + s : '');
}
const slugOf = href => { try { return new URL(href, 'https://x.invalid').searchParams.get('l') || ''; } catch (_) { return ''; } };
/* the membership has landed: a new subscription, or every feature the plan sells */
function landed(st, pending) {
  if (!st || !st.known || !pending) return false;
  if (st.subscriptions > (pending.subsBefore || 0)) return true;
  const want = (pending.features || []).filter(f => f !== 'league');
  return want.length > 0 && want.every(f => (f === 'analytics' ? st.analyticsOk && (st.features || []).indexOf('analytics') >= 0 : (st.features || []).indexOf(f) >= 0));
}

/* ------------------------------------------------------------------ DOM --- */
const doc = root.document;
const A = () => root.EpinoiaAccess || null;
const CFG = () => root.EPINOIA_CONFIG || {};
function el(tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const copy = (k, lg) => { const a = A(); try { return a && a.copyOf ? a.copyOf(k, lg) : ''; } catch (_) { return ''; } };
async function token() {
  const a = A();
  let s = null;
  try { s = a && a.sessionReady ? await a.sessionReady() : (a && a.session ? a.session() : null); } catch (_) { s = a && a.session ? a.session() : null; }
  return s && s.token ? s : null;
}
async function rpc(fn, args) {
  const c = CFG(), s = await token();
  const headers = { apikey: c.supabaseAnonKey, 'Content-Type': 'application/json' };
  if (s) headers.Authorization = 'Bearer ' + s.token;
  try {
    const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers, body: JSON.stringify(args || {}) });
    return r.ok ? { data: await r.json() } : { error: r.status };
  } catch (e) { return { error: 0 }; }
}
async function billing(body) {
  const c = CFG(), s = await token();
  try {
    const r = await fetch(c.supabaseUrl + '/functions/v1/billing', { method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + (s ? s.token : '') },
      body: JSON.stringify(body) });
    let data = null;
    try { data = await r.json(); } catch (_) { data = null; }
    return { status: r.status, data: data || {} };
  } catch (_) { return { status: 0, data: {} }; }
}
function refusal(res) {
  const st = res.status, why = res.data && typeof res.data.error === 'string' ? res.data.error.replace(/[.\s]+$/, '') : '';
  if (st === 503 || (st === 404 && !why)) return 'Payments open soon. Nothing has been charged.';
  if (st === 401) return 'Your sign-in has expired. Sign in again and you will come straight back here.';
  if (st === 0) return 'The payment service could not be reached. Check your connection and try again. Nothing has been charged.';
  return 'Checkout could not start: ' + (why || 'the payment service refused (' + st + ')') + '. Nothing has been charged.';
}
/* THE PAYMENT FRAME (payframe.html) beside this file: the one page that runs Stripe.js, under its own CSP */
const FRAME_SRC = (() => { try { const c = doc && doc.currentScript && doc.currentScript.src; return c ? c.replace(/paywindow\.js(\?|$)/, 'payframe.html$1') : ''; } catch (_) { return ''; } })();
/* can a page with this CSP frame its own site: its frame-src, else child-src, else default-src, else anything */
function framesSelfFrom(csp) {
  if (!csp) return true;
  const dirs = String(csp).split(';').map(x => x.trim().split(/\s+/)).filter(d => d[0]);
  const f = dirs.find(d => d[0] === 'frame-src') || dirs.find(d => d[0] === 'child-src') || dirs.find(d => d[0] === 'default-src');
  return !f || f.slice(1).some(x => x === "'self'" || x === '*');
}
const framesSelf = () => { const m = doc.querySelector('meta[http-equiv="Content-Security-Policy"]'); return framesSelfFrom(m && m.getAttribute('content')); };
const signinHref = next => {
  const a = A();
  return a && a.signinHref ? a.signinHref(next) : '/epinoia/signin/?next=' + encodeURIComponent(next);
};

/* ------------------------------------------------------------ the window --- */
let W = null;   // { back, box, body, close, checkout, lastFocus, ctx }
function shut() {
  if (!W) return;
  if (typeof W.onShut === 'function') W.onShut();
  try { if (W.checkout && W.checkout.destroy) W.checkout.destroy(); } catch (_) { /* gone */ }
  W.back.remove();
  doc.documentElement.classList.remove('pw-open');
  doc.removeEventListener('keydown', W.onKey, true);
  try { if (W.lastFocus && W.lastFocus.focus) W.lastFocus.focus(); } catch (_) { /* fine */ }
  W = null;
}
function frame(title) {
  shut();
  const back = el('div', 'pw-back');
  const box = el('div', 'pw');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'pwH');
  const x = el('button', 'pw-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close');
  const h = el('h2', 'pw-h', title); h.id = 'pwH'; h.tabIndex = -1;
  const body = el('div', 'pw-b');
  box.append(x, h, body);
  back.appendChild(box);
  doc.body.appendChild(back);
  doc.documentElement.classList.add('pw-open');
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); shut(); return; }
    if (e.key !== 'Tab') return;
    /* the focus stays in the window */
    const f = [...box.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter(n => n.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && doc.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && doc.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };
  W = { back, box, body, h, onKey, lastFocus: doc.activeElement, checkout: null, ctx: null };
  x.addEventListener('click', shut);
  back.addEventListener('mousedown', e => { if (e.target === back) shut(); });
  doc.addEventListener('keydown', onKey, true);
  setTimeout(() => { try { h.focus({ preventScroll: true }); } catch (_) { /* fine */ } }, 0);
  return W;
}
function msg(text, kind) {
  if (!W) return;
  let m = W.box.querySelector('.pw-msg');
  if (!m) { m = el('p', 'pw-msg'); m.setAttribute('role', 'status'); W.body.appendChild(m); }
  m.textContent = text || ''; m.className = 'pw-msg' + (kind ? ' ' + kind : '');
}

/* PLANS */
async function plansStep(ctx) {
  const w = frame(copy('modalTitle') || 'Become a member');
  w.ctx = ctx;
  const lead = el('p', 'pw-lead', copy('modalLead') || 'Choose a membership and pay here.');
  w.body.appendChild(lead);
  const list = el('div', 'pw-plans');
  list.appendChild(el('p', 'pw-wait', 'Reading what is on sale…'));
  w.body.appendChild(list);
  const more = el('a', 'pw-more', 'Every plan, and what is free →'); more.href = ctx.href;
  w.body.appendChild(more);

  const a = A();
  let st = null;
  try { st = a ? await a.load(ctx.leagueSlug ? { leagueSlug: ctx.leagueSlug } : {}) : null; } catch (_) { st = null; }
  ctx.leagueId = st && st.leagueId || null;
  ctx.leagueName = st && st.name || '';
  ctx.st = st;
  const [pl, of, bs] = await Promise.all([rpc('access_plans_public', { p_league: ctx.leagueId }), rpc('my_trial_offers', { p_league: ctx.leagueId }), billing({ action: 'status' })]);
  if (!W || W.ctx !== ctx) return;
  ctx.offers = of && !of.error && of.data && typeof of.data === 'object' ? of.data : null;
  ctx.payments = !!(bs.status === 200 && bs.data && bs.data.configured);
  ctx.pk = bs.status === 200 && bs.data && typeof bs.data.publishable_key === 'string' ? bs.data.publishable_key : null;
  ctx.signedIn = !!(await token());
  const plans = ordered(pl && !pl.error ? pl.data : []);
  list.textContent = '';
  if (!plans.length) {
    list.appendChild(el('p', 'pw-wait', 'Nothing is on sale here yet, so there is nothing to buy.'));
    return;
  }
  const off = st && st.known && st.membershipsEnabled === false;
  plans.forEach(p => {
    const trial = trialOf(p, ctx.offers);
    const card = el('div', 'pw-plan' + (ctx.planId === p.id ? ' on' : ''));
    const head = el('div', 'pw-ph');
    head.appendChild(el('b', null, p.name || 'Membership'));
    head.appendChild(el('span', 'pw-scope', p.league_id ? (ctx.leagueName || 'This league') : 'Every league'));
    card.appendChild(head);
    if (trial) card.appendChild(el('span', 'pw-trial', months(trial) + ' free'));
    const price = el('div', 'pw-price');
    if (trial) price.appendChild(el('span', 'pw-then', 'then '));
    price.append(el('b', null, money(p.price_pennies, p.currency)), doc.createTextNode(' a ' + per(p)));
    card.appendChild(price);
    const feats = (p.features || []).map(f => (a && a.FEATURES && a.FEATURES[f] ? a.FEATURES[f].label : f)).filter(Boolean);
    if (feats.length) card.appendChild(el('p', 'pw-feat', feats.join(' · ')));
    const go = el('button', 'ep-btn pri pw-go'); go.type = 'button';
    if (p.purchasable === false) { go.textContent = 'Not on sale yet'; go.disabled = true; }
    else if (off) { go.textContent = 'Memberships open soon'; go.disabled = true; }
    else if (!ctx.payments) { go.textContent = 'Payments open soon'; go.disabled = true; }
    else if (!ctx.signedIn) { go.textContent = trial ? 'Sign in to start your free trial' : 'Sign in to join';
      go.addEventListener('click', () => { root.location.href = signinHref(hereFor(root.location) + '#epjoin=' + p.id + (ctx.leagueSlug ? '.' + ctx.leagueSlug : '')); }); }
    else { go.textContent = trial ? 'Start ' + months(trial) + ' free' : 'Choose this plan'; go.addEventListener('click', () => consentStep(ctx, p)); }
    card.appendChild(go);
    list.appendChild(card);
  });
  const pick = ctx.planId && plans.find(p => p.id === ctx.planId && p.purchasable !== false);
  if (pick && ctx.payments && ctx.signedIn && !off) consentStep(ctx, pick);
}

/* THE STEP BEFORE MONEY */
function consentStep(ctx, p) {
  if (!W) return;
  const trial = trialOf(p, ctx.offers);
  const S = summary(p, trial);
  W.h.textContent = p.name || 'Membership';
  W.body.textContent = '';
  const sum = el('div', 'pw-sum');
  sum.append(el('p', 'pw-what', (p.league_id ? (ctx.leagueName || 'This league') + ' only' : 'Every league')),
             el('p', 'pw-cost', S.price), el('p', 'pw-renew', S.renew));
  W.body.appendChild(sum);
  const form = el('form', 'pw-form');
  form.noValidate = true;   // the window says what is missing, in its own words
  const box = (id, words) => {
    const l = el('label', 'pw-consent'); l.htmlFor = id;
    const i = el('input'); i.type = 'checkbox'; i.id = id; i.required = true;
    l.append(i, el('span', null, words));
    return [l, i];
  };
  const [l1, now] = box('pwNow', S.wording), [l2, adult] = box('pwAdult', ADULT_WORDING);
  const go = el('button', 'ep-btn pri pw-order', S.button); go.type = 'submit';
  const back = el('button', 'ep-btn mini', 'other plans'); back.type = 'button';
  back.addEventListener('click', () => plansStep(Object.assign(ctx, { planId: null })));
  const row = el('div', 'pw-row'); row.append(go, back);
  form.append(l1, l2, row);
  W.body.appendChild(form);
  W.body.appendChild(el('p', 'pw-fine', 'You can cancel online at any time from Your account. The card is taken by Stripe; Epinoia never sees it.'));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!now.checked || !adult.checked) { msg('Tick both boxes to continue.', 'bad'); (!now.checked ? now : adult).focus(); return; }
    if (go.disabled) return;
    go.disabled = true; go.textContent = 'Opening secure checkout…'; msg('');
    await payStep(ctx, p, S, () => { go.disabled = false; go.textContent = S.button; });
  });
}

/* PAYING */
async function payStep(ctx, p, S, undo) {
  const next = hereFor(root.location);
  /* on the page when there is a publishable key and this page may frame its own site; else Stripe's own page */
  const embedded = !!ctx.pk && framesSelf();
  const res = await billing({ action: 'checkout', planId: p.id, next, embedded,
    consent: { version: S.version, acknowledged: true, adult: true } });
  if (!W) return;
  const pending = { planId: p.id, features: p.features || [], leagueId: p.league_id || ctx.leagueId || null, leagueSlug: ctx.leagueSlug || '',
    subsBefore: ctx.st ? ctx.st.subscriptions : 0, at: Date.now() };
  try { root.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (_) { /* the subscription count still tells */ }
  /* Stripe's own page, coming back here: when this page cannot frame the payment, or the frame cannot start */
  const hosted = async () => {
    const again = await billing({ action: 'checkout', planId: p.id, next, consent: { version: S.version, acknowledged: true, adult: true } });
    if (again.status === 200 && typeof again.data.url === 'string' && /^https:\/\//.test(again.data.url)) { root.location.assign(again.data.url); return; }
    if (!W) return;
    consentStep(ctx, p); msg(refusal(again), 'bad');
  };
  if (res.status === 200 && embedded && typeof res.data.client_secret === 'string') {
    W.body.textContent = '';
    const f = el('iframe', 'pw-frame');
    f.title = 'Secure checkout'; f.setAttribute('allow', 'payment *'); f.src = FRAME_SRC || '/epinoia/payframe.html';
    W.body.appendChild(f);
    let ready = false;
    const stop = () => root.removeEventListener('message', onMsg);
    /* only the frame this window made, on this site, is listened to; the checkout goes to it alone */
    function onMsg(e) {
      if (e.origin !== root.location.origin || e.source !== f.contentWindow) return;
      const d = e.data || {};
      if (d.type === 'epinoia:payframe-ready') {
        ready = true;
        f.contentWindow.postMessage({ type: 'epinoia:pay', pk: ctx.pk, cs: res.data.client_secret, account: res.data.account || null }, root.location.origin);
      } else if (d.type === 'epinoia:payframe-height' && d.h > 0) f.style.height = Math.min(Math.max(d.h, 320), 4000) + 'px';
      else if (d.type === 'epinoia:paid') { stop(); confirmStep(pending); }
      else if (d.type === 'epinoia:payframe-error') { stop(); hosted(); }
    }
    root.addEventListener('message', onMsg);
    W.onShut = stop;
    /* a frame that never says it is ready (blocked, offline): Stripe's own page */
    setTimeout(() => { if (!ready && W && f.isConnected) { stop(); hosted(); } }, 15000);
    return;
  }
  if (res.status === 200 && typeof res.data.url === 'string' && /^https:\/\//.test(res.data.url)) { root.location.assign(res.data.url); return; }
  undo();
  msg(refusal(res), 'bad');
}

/* CONFIRMED: wait for the webhook, then say so; the page redraws itself on access.js's change */
async function confirmStep(pending) {
  const w = W && W.box.isConnected ? W : frame(copy('modalTitle') || 'Become a member');
  if (W && W.checkout) { try { W.checkout.destroy(); } catch (_) { /* gone */ } W.checkout = null; }
  w.h.textContent = 'Confirming your membership…';
  w.body.textContent = '';
  const line = el('p', 'pw-lead', 'Payment received. Your membership is being switched on: this takes a few seconds.');
  w.body.appendChild(line);
  const a = A(), until = Date.now() + WAIT_MS;
  const p = pending || (() => { try { return JSON.parse(root.sessionStorage.getItem(PENDING_KEY) || 'null'); } catch (_) { return null; } })();
  /* THE PAGE MAY RELOAD UNDER THE WINDOW: every page draws itself again when what it may show changes, which is
     exactly what landing a membership does. Marked as confirming, so access.js opens the window again after it. */
  if (p) { p.confirming = true; try { root.sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch (_) { /* one try */ } }
  let ok = !!(p && p.done);   // landed before a reload: say so straight away
  while (!ok && a && Date.now() < until) {
    let st = null;
    try { st = await a.load(Object.assign(p && p.leagueId ? { leagueId: p.leagueId } : p && p.leagueSlug ? { leagueSlug: p.leagueSlug } : {}, { force: true })); } catch (_) { st = null; }
    if (landed(st, p)) { ok = true; break; }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  /* kept, marked done, until the fan closes the window: the page may be reloading itself right now (above) */
  if (p) { p.done = ok; try { root.sessionStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch (_) { /* fine */ } }
  if (!W) return;
  W.onShut = () => { try { root.sessionStorage.removeItem(PENDING_KEY); } catch (_) { /* fine */ } };
  if (ok) {
    w.h.textContent = copy('modalDone') || 'Payment confirmed: welcome.';
    line.textContent = 'Everything your membership opens is open now, here and on every page. A confirmation is on its way by email.';
  } else {
    w.h.textContent = 'Payment received';
    line.textContent = 'Your membership is taking longer than usual to switch on. It will appear on its own within a few minutes; ' +
      'Your account shows it as soon as it does. Nothing more is charged.';
  }
  const done = el('button', 'ep-btn pri', ok ? 'Carry on' : 'Close'); done.type = 'button';
  done.addEventListener('click', () => { shut(); });
  w.body.appendChild(done);
  setTimeout(() => { try { done.focus(); } catch (_) { /* fine */ } }, 0);
}

/* ---------------------------------------------------------------- open --- */
function open(o) {
  o = o || {};
  const ctx = { href: o.href || '/epinoia/join/', key: o.key || null, leagueSlug: o.leagueSlug || slugOf(o.href || ''), planId: o.planId || null };
  if (o.confirming) return confirmStep(null);
  return plansStep(ctx);
}

return { open, close: shut, trialOf, trialEndWords, ordered, summary, hereFor, slugOf, landed, money, framesSelfFrom,
  NOW_VERSION, NOW_WORDING, TRIAL_VERSION, TRIAL_WORDING, ADULT_WORDING };
}));
