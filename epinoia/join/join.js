'use strict';
/* ============================================================================
   JOIN — plans, prices and the way in (docs/memberships.md §7).

   Five things happen on this page, in the order a fan meets them:

     1. WHAT IS FOR SALE. access_plans_public: the ?l= league's own plans first,
        because somebody who followed a league's link came for that league, then
        Epinoia's plans that apply in every league. Prices are what you pay,
        VAT included, per month or per year.
     2. WHAT IS FREE AGAINST WHAT IS NOT, built from EpinoiaAccess.FEATURES so the
        page cannot promise something the teasers do not lock, or the reverse.
     3. THE WAY IN. Signed out, a plan's button goes to sign-in and comes back to
        this page with the plan chosen. Signed in, it opens the step before the
        money: the summary the law asks for, apart from the terms, two boxes
        the buyer ticks themselves, and a button that says what it costs. Only
        then is the billing function asked for a checkout, and the browser goes
        to Stripe's own page. No Stripe script ever runs here.
     4. BACK FROM STRIPE (?joined=1). The payment page returns before the webhook
        has necessarily landed, so the page waits — access_state every two
        seconds, for up to a minute — until the membership is really there, and
        only then says so and offers the way back to where the fan came from.
     5. ALREADY A MEMBER. my_access: a member sees their plan and Manage billing
        rather than an offer to buy what they already have.

   WHETHER THE BUTTONS ARE LIVE is the billing function's status answer. Until
   Stripe is switched on — or while the function is not deployed at all — every
   plan says "Payments open soon" and nothing can be started. That is the state
   the platform ships in.

   Reads use plain fetch with the stored session, the way nav.js and follow.js
   do: this page does not load the 200kB SDK for three requests.
   ============================================================================ */
(function () {
  const CFG = window.EPINOIA_CONFIG || {};
  const A = window.EpinoiaAccess || null;
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const params = new URLSearchParams(location.search);
  const SLUG = (params.get('l') || '').trim();

  /* The rail opens inside the league. nav.js reads this global before it
     builds, and loads after this file, so setting it now is enough. */
  if (SLUG) window.__CS_LEAGUE_SLUG = SLUG;

  /* The wording of the two boxes in index.html is this version. The billing
     function stores it on the checkout row and repeats that wording in the
     confirmation email, so the three change together or not at all. */
  const CONSENT_VERSION = '2026-09-a';
  const PENDING_KEY = 'epinoia_join_pending';
  const WAIT_MS = 60000, POLL_MS = 2000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  let access = null;       // EpinoiaAccess state for ?l= (or the platform, without one)
  let leagueId = null;
  let plans = null;        // [] once read; null when they could not be read
  let payments = false;    // the billing function says it is switched on
  let mine = null;         // my_access(), signed in
  let chosen = null;

  /* ------------------------------------------------------------ helpers --- */
  const sess = () => (A && A.session ? A.session() : null);
  /* A league that is members only AND enforced. While the platform keeps
     memberships switched off (access.js membershipsEnabled false) a league set
     to members only is open to everyone, and this page must not say otherwise. */
  const closedLeague = st => !!(st && st.known && st.accessMode === 'members' && st.membershipsEnabled !== false);
  /* The session as it is once an expired access token has been refreshed. An
     hour after sign-in the stored token has run out, and this page does not load
     the SDK that would renew it, so without this a member coming back to the
     join page reads as signed out and is offered what they already pay for. */
  const sessNow = async () => {
    if (A && typeof A.sessionReady === 'function') {
      try { return await A.sessionReady(); } catch (_) { /* fall through */ }
    }
    return sess();
  };
  /* WHERE ?next= MAY GO: a same-origin path under /epinoia/, nothing else. This
     page hands it to the billing function and links to it after payment, so an
     open redirect here would put a real payment page in front of a phishing
     site. Browsers strip tabs and newlines from URLs and read a backslash as a
     slash, which is why the checks are more than "starts with one slash".
     Kept character for character the same as safePath in access.js and in
     signin.js; access.test.mjs reads this function out of this file and runs the
     same attack strings through all three. */
  function safeNext(n) {
    const s = String(n == null ? '' : n);
    if (s.indexOf('/epinoia/') !== 0) return '';
    if (/[\x00-\x20\x7f\\]|%5c|\/\//i.test(s)) return '';
    try {
      const u = new URL(s, location.origin);
      if (u.origin !== location.origin || u.pathname.indexOf('/epinoia/') !== 0) return '';
    } catch (_) { return ''; }
    return s;
  }
  const BACK = safeNext(params.get('next'));
  /* this page, carrying the league and the way back, plus anything extra */
  function pagePath(extra) {
    const q = new URLSearchParams();
    if (SLUG) q.set('l', SLUG);
    if (BACK) q.set('next', BACK);
    Object.keys(extra || {}).forEach(k => { if (extra[k] != null) q.set(k, extra[k]); });
    const s = q.toString();
    return location.pathname + (s ? '?' + s : '');
  }
  const signinTo = next => '../signin/?next=' + encodeURIComponent(next);
  const leagueName = () => (access && access.name) || SLUG || 'this league';
  function backHref() {
    if (BACK) return BACK;
    return SLUG ? '../?l=' + encodeURIComponent(SLUG) : '../';
  }
  const backLabel = () => (BACK ? 'Back to where you were' : SLUG ? 'Back to ' + leagueName() : 'Back to Epinoia');
  const amount = p => (A ? A.amountText(p.price_pennies, p.currency) : '£' + ((Number(p.price_pennies) || 0) / 100).toFixed(2));
  const per = p => (p.interval === 'year' ? 'year' : 'month');
  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function show(sel, on) { const n = $(sel); if (n) n.classList.toggle('hide', !on); renumber(); }
  /* the visible sections count 01, 02, 03 whichever of them are showing */
  function renumber() {
    let n = 0;
    document.querySelectorAll('.ep-frame > .sec').forEach(sec => {
      if (sec.classList.contains('hide')) return;
      const idx = sec.querySelector('.ep-hdr .idx');
      if (idx) idx.textContent = String(++n).padStart(2, '0');
    });
  }
  function say(sel, text, kind, link) {
    const m = $(sel);
    if (!m) return;
    m.textContent = text || '';
    if (link) { m.append(' '); const a = el('a', null, link.text); a.href = link.href; m.appendChild(a); }
    m.className = 'msg ' + (kind || '');
    m.classList.toggle('hide', !text);
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function rpc(fn, args) {
    const s = await sessNow();
    const headers = { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json' };
    if (s) headers.Authorization = 'Bearer ' + s.token;
    try {
      const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/' + fn, {
        method: 'POST', cache: 'no-store', headers, body: JSON.stringify(args || {})
      });
      let body = null;
      try { body = await r.json(); } catch (_) { body = null; }
      return r.ok ? { data: body, status: r.status } : { error: body || {}, status: r.status };
    } catch (e) {
      return { error: { message: String((e && e.message) || e) }, status: 0 };
    }
  }

  /* One door to the billing function. Never throws: a network failure is
     status 0, and the caller turns every answer into a sentence. */
  async function billing(body) {
    const s = await sessNow();
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 20000) : null;
    try {
      const r = await fetch(CFG.supabaseUrl + '/functions/v1/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + (s ? s.token : '') },
        body: JSON.stringify(body),
        signal: ctl ? ctl.signal : undefined
      });
      let data = null;
      try { data = await r.json(); } catch (_) { data = null; }
      return { status: r.status, data: data || {} };
    } catch (_) {
      return { status: 0, data: {} };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const goodUrl = u => typeof u === 'string' && /^https:\/\//.test(u);

  /* Every refusal as something a fan can act on. Nothing is ever charged before
     Stripe's own page, so every one of these can say so. */
  function billingError(sel, res, what) {
    const st = res.status, why = res.data && typeof res.data.error === 'string' ? res.data.error : '';
    /* 503 is the function saying Stripe is not switched on; a 404 WITHOUT the
       function's own {error} is the gateway saying it is not deployed. A 404
       with one is a real answer ("no such subscription") and is shown as such. */
    if (st === 503 || (st === 404 && !why)) return say(sel, 'Payments open soon. Nothing has been charged.', 'warn');
    if (st === 401) {
      return say(sel, 'Your sign-in has expired. Sign in again and you will come straight back here.', 'err',
                 { text: 'Sign in', href: signinTo(pagePath(chosen ? { plan: chosen.id } : null)) });
    }
    if (st === 0) return say(sel, 'The payment service could not be reached. Check your connection and try again. Nothing has been charged.', 'err');
    say(sel, what + ' could not start: ' + (why ? why.replace(/[.\s]+$/, '') : 'the payment service refused (' + st + ')') + '. Nothing has been charged.', 'err');
  }

  function readPending() {
    try { return JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch (_) { return null; }
  }
  function writePending(v) { try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(v)); } catch (_) { /* private mode: the count check still works */ } }
  function clearPending() { try { sessionStorage.removeItem(PENDING_KEY); } catch (_) { /* nothing to clear */ } }

  const liveSubs = () => (mine && Array.isArray(mine.subscriptions) ? mine.subscriptions.filter(s => s && s.active) : []);
  const owned = p => liveSubs().find(s => s.plan_id === p.id) || null;

  /* ------------------------------------------------------------- the top --- */
  function paintWho() {
    const host = $('#who');
    host.textContent = '';
    const s = sess();
    if (s) { host.append('Signed in as ' + (s.email || 'your account') + '.'); return; }
    host.append('You are not signed in. Already a member? ');
    const a = el('a', null, 'Sign in');
    a.href = signinTo(pagePath());
    host.appendChild(a);
    host.append(' and it is recognised straight away.');
  }

  function paintLeague() {
    const host = $('#lg');
    if (!SLUG) { host.classList.add('hide'); return; }
    host.classList.remove('hide');
    if (!leagueId) {
      host.textContent = 'We could not find the league in this link, so these are Epinoia’s own plans, which apply in every league.';
      return;
    }
    const name = leagueName();
    document.title = 'Membership · ' + name + ' · Epinoia';
    if (closedLeague(access)) {
      host.textContent = name + ' keeps its results, box scores and statistics for its members. ' +
        (access.fixturesPublic ? 'Its upcoming fixtures, clubs and squads stay free for everyone.' : 'Its clubs and squads stay free for everyone.');
    } else if (access.known) {
      host.textContent = name + ' is open to everyone. Membership adds the advanced analytics on top.';
    } else {
      host.textContent = 'Plans for ' + name + ', and Epinoia’s plans for every league.';
    }
  }

  /* ------------------------------------------------------ already a member --- */
  /* ENDING IS EITHER FLAG. A cancellation made in Stripe's portal on flexible
     billing — the default for every subscription Checkout creates — sets only
     cancel_at and leaves cancel_at_period_end false, so reading the one flag
     would say "renews" about a membership that is ending. The end date is
     cancel_at when there is one. */
  const ending = s => !!s.cancel_at_period_end || !!s.cancel_at;
  function statusWords(s) {
    const iso = ending(s) ? (s.cancel_at || s.current_period_end) : s.current_period_end;
    const end = iso ? fmtDate(iso) : '';
    if (s.status === 'active' || s.status === 'trialing') {
      if (ending(s)) return [end ? 'Active — ends on ' + end : 'Active — ends at the end of this period', 'end'];
      return [end ? 'Active — renews on ' + end : 'Active', ''];
    }
    if (s.status === 'past_due' || s.status === 'unpaid' || s.status === 'incomplete') return ['Payment problem — update your card', 'bad'];
    if (s.status === 'paused') return ['Paused', 'end'];
    return ['Ended', 'end'];
  }
  const scopeWords = x => (x.league_id ? (x.league_name || leagueName()) + ' only' : 'Every league');
  const featureWords = fs => (fs || []).map(f => (A && A.FEATURES[f] ? A.FEATURES[f].label : f)).join(', ');

  function paintMember() {
    const host = $('#mine');
    host.textContent = '';
    say('#mineMsg', '');
    if (!sess() || !mine) { show('#memberSec', false); return; }
    const here = x => !x.league_id || !leagueId || x.league_id === leagueId;
    const subs = liveSubs().filter(here);
    const now = Date.now();
    const grants = (Array.isArray(mine.grants) ? mine.grants : [])
      .filter(g => g && here(g) && !(g.expires_at && new Date(g.expires_at).getTime() < now));
    if (!subs.length && !grants.length) { show('#memberSec', false); return; }

    subs.forEach(s => {
      const row = el('div', 'own');
      const tx = el('div');
      const [words, cls] = statusWords(s);
      tx.append(el('b', null, s.plan_name || 'Membership'), el('small', null, scopeWords(s) + ' · ' + featureWords(s.features)),
                el('span', 'st' + (cls ? ' ' + cls : ''), words));
      const b = el('button', 'ep-btn', 'Manage billing');
      b.type = 'button';
      b.onclick = () => portal(s.id, b, '#mineMsg');
      const act = el('div', 'act'); act.style.marginTop = '0'; act.appendChild(b);
      row.append(tx, act);
      host.appendChild(row);
    });
    grants.forEach(g => {
      const row = el('div', 'own');
      const tx = el('div');
      tx.append(el('b', null, featureWords(g.features) || 'Membership'),
                el('small', null, 'Given by ' + (g.league_id ? (g.league_name || 'the league') : 'Epinoia')),
                el('span', 'st', g.expires_at ? 'Until ' + fmtDate(g.expires_at) : 'No end date'));
      row.appendChild(tx);
      host.appendChild(row);
    });
    show('#memberSec', true);
  }

  async function portal(subscriptionId, button, msgSel) {
    button.disabled = true;
    const body = { action: 'portal', next: pagePath() };
    if (subscriptionId) body.subscriptionId = subscriptionId;
    const res = await billing(body);
    if (res.status === 200 && goodUrl(res.data.url)) { location.assign(res.data.url); return; }
    button.disabled = false;
    billingError(msgSel, res, 'Billing');
  }

  /* --------------------------------------------------------------- plans --- */
  function planCard(p) {
    const mineSub = owned(p);
    const card = el('article', 'plan' + (mineSub ? ' owned' : ''));
    card.setAttribute('aria-label', (p.name || 'Membership') + ', ' + amount(p) + ' a ' + per(p));
    card.appendChild(el('div', 'eyebrow', p.league_id ? leagueName() : 'Every league'));
    card.appendChild(el('h3', null, p.name || 'Membership'));
    const price = el('div', 'price');
    price.append(el('b', null, amount(p)), el('span', null, 'a ' + per(p)));
    card.appendChild(price);
    card.appendChild(el('div', 'vat', 'Including any VAT. Renews every ' + per(p) + ' until you cancel.'));
    if (p.blurb) card.appendChild(el('p', 'blurb', p.blurb));

    const ul = el('ul');
    (p.features || []).forEach(f => {
      const F = A && A.FEATURES[f];
      if (!F) return;
      const li = el('li');
      const where = p.league_id ? leagueName() : 'every league';
      li.appendChild(el('b', null, f === 'league' ? leagueName() + ', members only' : F.label + ', in ' + where));
      li.append(' — ' + F.blurb);
      ul.appendChild(li);
    });
    if (ul.childElementCount) card.appendChild(ul);

    /* staff and grant holders already have what a league plan sells there */
    if (!mineSub && p.league_id && access && access.known && (p.features || []).length &&
        p.features.every(f => access.features.indexOf(f) !== -1)) {
      card.appendChild(el('div', 'note-in', 'Your account already has this in ' + leagueName() + '.'));
    }
    card.appendChild(el('div', 'grow'));

    const act = el('div', 'act');
    const off = text => { const b = el('button', 'ep-btn', text); b.type = 'button'; b.disabled = true; return b; };
    if (mineSub) {
      act.appendChild(el('span', 'mine', 'You’re a member'));
      const b = el('button', 'ep-btn', 'Manage billing');
      b.type = 'button';
      b.onclick = () => portal(mineSub.id, b, '#plansMsg');
      act.appendChild(b);
    } else if (!p.purchasable) {
      act.appendChild(off('Not on sale yet'));
    } else if (access && access.known && access.membershipsEnabled === false &&
               !/[?&]rehearse=1(&|$)/.test(location.search)) {
      /* the platform's master switch is off: everything is free, so nothing is
         sold (the billing function refuses too). ?rehearse=1 lets the people
         setting payments up reach checkout; the function still only lets platform
         admins and BILLING_TEST_EMAILS through. */
      act.appendChild(off('Memberships open soon'));
    } else if (!payments) {
      act.appendChild(off('Payments open soon'));
    } else if (!sess()) {
      const a = el('a', 'ep-btn pri', 'Sign in to join');
      a.href = signinTo(pagePath({ plan: p.id }));
      act.appendChild(a);
    } else {
      const b = el('button', 'ep-btn pri', 'Choose this plan');
      b.type = 'button';
      b.onclick = () => openPre(p);
      act.appendChild(b);
    }
    card.appendChild(act);
    return card;
  }

  function paintPlans() {
    const host = $('#plans');
    host.textContent = '';
    host.className = '';
    $('#plansNote').textContent = '';
    if (plans === null) {
      host.appendChild(el('p', 'empty', 'Memberships are not available yet, so everything on Epinoia is free for now.'));
      return;
    }
    const ordered = plans.filter(p => p && p.league_id).concat(plans.filter(p => p && !p.league_id));
    if (!ordered.length) {
      host.appendChild(el('p', 'empty', leagueId && closedLeague(access)
        ? leagueName() + ' has not put its memberships on sale yet.'
        : 'Nothing is on sale yet, so everything on Epinoia is free until memberships open.'));
      return;
    }
    if (!payments && ordered.some(p => p.purchasable)) $('#plansNote').textContent = 'payments open soon';
    host.className = 'plans';
    ordered.forEach(p => host.appendChild(planCard(p)));
  }

  /* ------------------------------------------------ the step before money --- */
  function openPre(p) {
    chosen = p;
    const price = A ? A.priceText(p.price_pennies, p.currency, p.interval) : amount(p) + ' a ' + per(p);
    $('#sumPlan').textContent = (p.name || 'Membership') + ' — ' + (p.league_id ? leagueName() + ' only' : 'every league');
    $('#sumPrice').textContent = price + ', including any VAT.';
    $('#sumRenew').textContent = 'It renews automatically every ' + per(p) + ' at ' + amount(p) + ' until you cancel.';
    $('#cNow').checked = false;
    $('#cAdult').checked = false;
    const order = $('#order');
    order.disabled = false;
    order.textContent = 'Pay ' + price + ' and join';
    say('#preMsg', '');
    show('#preSec', true);
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try { $('#preSec').scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }); } catch (_) { /* old browser */ }
    try { $('#preH').focus({ preventScroll: true }); } catch (_) { $('#preH').focus(); }
  }

  async function order(e) {
    e.preventDefault();
    if (!chosen) return;
    const now = $('#cNow'), adult = $('#cAdult');
    if (!now.checked || !adult.checked) {
      say('#preMsg', 'Tick both boxes to continue.', 'err');
      (!now.checked ? now : adult).focus();
      return;
    }
    const btn = $('#order'), label = btn.textContent;
    if (btn.disabled) return;
    /* disabled before the first await, so a double click cannot start two
       checkouts while an expired token is being renewed */
    btn.disabled = true;
    const plan = chosen;
    if (!(await sessNow())) { btn.disabled = false; location.href = signinTo(pagePath({ plan: plan.id })); return; }
    btn.textContent = 'Opening secure checkout…';
    say('#preMsg', '');
    const res = await billing({
      action: 'checkout', planId: plan.id, next: pagePath(),
      consent: { version: CONSENT_VERSION, acknowledged: true, adult: true }
    });
    if (res.status === 200 && goodUrl(res.data.url)) {
      /* what to wait for when Stripe sends the fan back here */
      writePending({ planId: plan.id, planName: plan.name || '', features: plan.features || [],
                     leagueId: plan.league_id || leagueId || null,
                     subsBefore: access ? access.subscriptions : 0, at: Date.now() });
      location.assign(res.data.url);
      return;
    }
    btn.disabled = false;
    btn.textContent = label;
    billingError('#preMsg', res, 'Checkout');
  }

  /* ----------------------------------------------------- free vs members --- */
  function paintCompare() {
    const host = $('#compare');
    if (!A) return;
    host.textContent = '';
    const F = A.FEATURES;
    const membersLeague = !!(leagueId && closedLeague(access));
    const sellsLeague = Array.isArray(plans) && plans.some(p => p && (p.features || []).indexOf('league') !== -1);

    const t = el('table', 'cmp');
    t.appendChild(el('caption', 'sr', 'What is free and what membership adds'));
    const head = el('thead'), hr = el('tr');
    [['What', ''], ['Free', 'c'], ['Members', 'c']].forEach(([x, c]) => {
      const th = el('th', c, x); th.scope = 'col'; hr.appendChild(th);
    });
    head.appendChild(hr);
    t.appendChild(head);
    const body = el('tbody');
    const group = text => { const tr = el('tr', 'grp'); const th = el('th', null, text); th.colSpan = 3; th.scope = 'colgroup'; tr.appendChild(th); body.appendChild(tr); };
    const row = (text, free, member) => {
      const tr = el('tr');
      const th = el('th', null, text); th.scope = 'row'; tr.appendChild(th);
      [free, member].forEach(v => tr.appendChild(el('td', 'c ' + (v === 'Yes' ? 'yes' : v === 'No' ? 'no' : 'part'), v)));
      body.appendChild(tr);
    };

    if (!membersLeague) {
      group(SLUG && leagueId ? 'Free in ' + leagueName() : 'Free for everyone');
      row('Box scores, play-by-play and the made-and-missed shot chart', 'Yes', 'Yes');
      row('Season tables, standings and statistical leaders', 'Yes', 'Yes');
      row('Club and player pages, fixtures and live scores', 'Yes', 'Yes');
    }
    /* As shipped the analytics are free (the platform default, or a league a
       sponsor has opened). The table must not say "No" for something anyone can
       open right now, so a KNOWN free mode reads Yes; an unknown one keeps the
       members' column honest about what a plan would add. */
    const everyLeague = !leagueId || membersLeague;       // the heading's own scope
    const analyticsFree = !!(access && access.known &&
      (everyLeague ? access.analyticsDefault : access.analytics) === 'free');
    group(F.analytics.label + (everyLeague ? ', in every league' : '') + (analyticsFree ? ', free for now' : ''));
    F.analytics.includes.forEach(x => row(x, analyticsFree ? 'Yes' : /preview/i.test(x) ? 'Preview' : 'No', 'Yes'));
    if (membersLeague || sellsLeague) {
      group(membersLeague ? leagueName() + ', members only' : F.league.label);
      F.league.includes.forEach(x => row(x, 'No', 'Yes'));
      if (membersLeague) {
        row('Upcoming fixtures', access.fixturesPublic ? 'Yes' : 'No', 'Yes');
        row('Clubs, crests and squads', 'Yes', 'Yes');
      }
    }
    t.appendChild(body);
    const wrap = el('div', 'ep-xscroll');
    wrap.appendChild(t);
    host.appendChild(wrap);
  }

  /* --------------------------------------------------------- back from Stripe --- */
  function confirmed(st, pending) {
    if (!st || !st.known) return false;
    const need = pending && Array.isArray(pending.features)
      ? pending.features.filter(f => f === 'analytics' || f === 'league') : null;
    if (st.leagueId && need && need.length && (!pending.leagueId || pending.leagueId === st.leagueId)) {
      return need.every(f => st.features.indexOf(f) !== -1);
    }
    /* no league on the page (or nothing remembered): a new live subscription */
    return st.subscriptions > (pending ? (Number(pending.subsBefore) || 0) : 0);
  }

  let waiting = false;
  async function waitForMembership() {
    if (waiting) return;
    waiting = true;
    const h = $('#joinedH'), p = $('#joinedP'), act = $('#joinedAct');
    act.textContent = '';
    show('#joinedSec', true);
    show('#plansSec', false);

    /* back from Stripe is exactly when an hour can have passed since sign-in */
    if (!(await sessNow())) {
      h.textContent = 'Sign in to finish';
      p.textContent = 'If you paid, sign in with the same account and your membership will be waiting for you here.';
      const a = el('a', 'ep-btn pri', 'Sign in');
      a.href = signinTo(pagePath({ joined: '1' }));
      act.appendChild(a);
      waiting = false;
      return;
    }

    h.textContent = 'Confirming your membership';
    p.textContent = 'Your payment went through. We are waiting for the payment service to confirm it — this usually takes a few seconds.';
    const pending = readPending();
    if (A) A.forget();
    const start = Date.now();
    let st = null, ok = false;
    for (;;) {
      st = A ? await A.load(SLUG ? { leagueSlug: SLUG, force: true } : { force: true }) : null;
      if (st && st.leagueId) { access = st; leagueId = st.leagueId; }
      ok = confirmed(st, pending);
      if (ok || Date.now() - start >= WAIT_MS) break;
      await sleep(POLL_MS);
    }
    waiting = false;

    const back = el('a', 'ep-btn pri', backLabel());
    back.href = backHref();
    const me = el('a', 'ep-btn', 'Your profile');
    me.href = '../me/';
    if (ok) {
      clearPending();
      /* every page this fan opens next asks the server again rather than
         reading an answer cached from before they paid */
      if (A) A.forget();
      h.textContent = 'You’re a member';
      const what = (pending && pending.planName) || 'Your membership';
      p.textContent = what + ' is active' + (leagueId && SLUG ? ' in ' + leagueName() : '') +
        '. You can manage it or cancel it at any time from Your profile.';
      act.append(back, me);
    } else {
      h.textContent = 'Almost there';
      p.textContent = 'Your payment went through, but the confirmation is taking longer than usual. ' +
        'Your access starts the moment it arrives, usually within a minute or two.';
      const again = el('button', 'ep-btn pri', 'Check again');
      again.type = 'button';
      again.onclick = () => waitForMembership();
      back.className = 'ep-btn';
      act.append(again, back, me);
    }
    try { h.focus({ preventScroll: true }); } catch (_) { /* focus is a courtesy */ }
  }

  /* ---------------------------------------------------------------- boot --- */
  async function boot() {
    paintWho();
    const joinedReturn = params.get('joined') === '1';
    if (joinedReturn) waitForMembership();

    $('#preForm').addEventListener('submit', order);
    $('#preBack').addEventListener('click', () => {
      chosen = null;
      show('#preSec', false);
      try { $('#plansSec').scrollIntoView({ block: 'start' }); } catch (_) { /* old browser */ }
    });

    if (!A || !CFG.supabaseUrl || !CFG.supabaseAnonKey) {
      plans = null;
      paintPlans();
      return;
    }

    /* renew an expired token before deciding who this is; paintWho() above drew
       from what was stored, so it is drawn again if that changed the answer */
    const before = !!sess();
    const s = await sessNow();
    if (!!s !== before) paintWho();
    const [st, stat, my] = await Promise.all([
      A.load(SLUG ? { leagueSlug: SLUG } : {}),
      billing({ action: 'status' }),
      s ? rpc('my_access', {}) : Promise.resolve(null)
    ]);
    if (!waiting || !access) access = st;
    leagueId = (st && st.leagueId) || leagueId || null;
    payments = stat.status === 200 && !!(stat.data && stat.data.configured);
    mine = my && !my.error && my.data && typeof my.data === 'object' ? my.data : null;

    const pr = await rpc('access_plans_public', { p_league: leagueId });
    plans = pr.error ? null : (Array.isArray(pr.data) ? pr.data : []);

    paintLeague();
    paintMember();
    if (!joinedReturn) paintPlans();
    paintCompare();

    /* back from sign-in with a plan chosen: straight to the step before paying */
    const want = params.get('plan');
    const p = !joinedReturn && want && plans ? plans.find(x => x && x.id === want) : null;
    if (p && sess() && payments && p.purchasable && !owned(p)) openPre(p);
  }

  renumber();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
