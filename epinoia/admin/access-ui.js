'use strict';
/* ============================================================================
   MEMBERSHIPS & ACCESS — who can see this league, and what fans can buy.

   The contract is docs/memberships.md. Six parts, all read through ONE call,
   league_access_admin(), so the numbers on this panel cannot disagree with
   each other: the league's mode, its analytics setting, its plans, the people
   paying, the people given access for free, and whether it can be paid.

   WHAT THIS PANEL DOES NOT DECIDE. Whether a fan sees a members-only league
   is row-level security in the database (0118); whether a fan sees premium
   analytics is decided by the page, from access_state(). Nothing here grants
   anything by being drawn. Every write is an RPC that authorises its caller,
   so this file decides what to draw, never what is permitted.

   THE LEAGUE IS A FUNCTION, AND WRITES ARE PINNED TO THE LEAGUE THAT WAS LOADED.
   The keys, webhook and merch panels are mounted with the league object that
   happened to be selected when the page loaded, and keep acting on it after a
   chip switches league. This one reads the league through a getter. But a
   getter alone makes the opposite mistake possible: the chip changes the
   league at once, while the panel is only rebuilt a few awaits later (after
   the seasons and teams have loaded), so a "save" pressed in that gap would
   apply league A's form to league B. So every write goes to the id the panel
   was LOADED for, and refuses if the getter now says something else.

   "MEMBERSHIP" IN CODE MEANS SOMETHING ELSE. Roles and the federation
   register already own that word, so the objects here are access_* in the
   database and EpinoiaAccessUI in the browser. The heading says Memberships,
   because that is what the league calls it.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaAccessUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const opt = (v, l) => { const o = document.createElement('option'); o.value = v;
  o.textContent = l; return o; };
const field = (label, control, flex) => {
  const f = el('label', 'f');
  if (flex) f.style.flex = flex;
  f.append(el('span', null, label), control);
  return f;
};

/* The two things that are sold. Worded for the person running a league, who
   needs to know what a fan gets, not which screens compute it. */
const FEATURES = {
  league: {
    label: 'The league',
    hint: 'everything played in a members-only league: results, box scores, live ' +
          'games, statistics, standings, awards, news and video'
  },
  analytics: {
    label: 'Analytics',
    hint: 'the advanced analytics: events splits, zone shot charts, the game flow, ' +
          'connections and events tabs, and the full WOWY screen'
  }
};
const featureWords = list => (list || []).length
  ? list.map(k => (FEATURES[k] || { label: k }).label).join(' + ')
  : 'nothing';

/* Stripe's own status words, turned round to say what they mean for the fan. */
const STATUS = {
  active:             ['paying', 'ok'],
  trialing:           ['on a free trial', 'ok'],
  past_due:           ['last payment failed', 'warn'],
  incomplete:         ['checkout not finished', 'off'],
  incomplete_expired: ['checkout abandoned', 'off'],
  canceled:           ['cancelled', 'off'],
  unpaid:             ['unpaid, no access', 'warn'],
  paused:             ['paused', 'off']
};

/* access_active(): past_due keeps access this long after the payment FIRST
   failed (past_due_since), not after the period end — which Stripe moves forward
   when it raises the renewal invoice, paid or not. league_access_admin() does
   not return past_due_since, so the panel says how long, not until when. */
const GRACE_DAYS = 7;

function money(pennies, currency) {
  const n = Number(pennies || 0);
  if (!n) return 'free';
  const cur = String(currency || 'gbp').toLowerCase();
  const amount = (n / 100).toFixed(2);
  return cur === 'gbp' ? '£' + amount : amount + ' ' + cur.toUpperCase();
}
const per = interval => interval === 'year' ? 'a year' : 'a month';

const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/* league_access_admin() shows a price as has_price; platform_access_admin()
   may only carry the id. Either answers "can this be bought". */
const hasPrice = p => p.has_price != null ? !!p.has_price : !!p.stripe_price_id;

/* A price typed in pounds, into pennies, WITHOUT floating point: 4.99 * 100 is
   499.00000000000006, and a rounding rule that is right today is one edit away
   from charging a penny too much. Returns null when it is not a price. */
function toPennies(text) {
  let v = String(text == null ? '' : text).replace(/[£\s]/g, '');
  /* a decimal comma (4,99 — how a Spanish admin writes it, and how the Spanish page shows it):
     a comma with one or two digits after it and nothing more is the decimal point; any other
     comma, and a dot before three digits (1.000,50), separates thousands */
  if (/,\d{1,2}$/.test(v)) v = v.replace(/\.(?=\d{3}(\D|$))/g, '').replace(/,(?=\d{1,2}$)/, '.');
  v = v.replace(/,/g, '');
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(((m[2] || '') + '00').slice(0, 2));
}

const PRICE_ID = /^price_[A-Za-z0-9]+$/;

/* The league console's own conventions, for when it does not pass its oops:
   the opaque codes translated, everything else in Postgres's own words. */
function oopsLike(say, e) {
  if (!e) return say('Something went wrong.', 'err');
  const msg = e.message || String(e);
  if (e.code === '42501' || /permission denied/i.test(msg))
    return say('Refused: you do not have rights for that.', 'err');
  if (e.code === 'PGRST202' || /schema cache/i.test(msg))
    return say('That function is not on the server yet — run `npx supabase db push`.', 'err');
  say(msg, 'err');
}
const isMissing = e => !!e && (e.code === 'PGRST202' ||
  /schema cache|could not find the function/i.test(e.message || ''));

/* ==========================================================================
   THE PLAN FORM — shared with the platform console.

   One form, because the rules it carries are the same wherever a plan is
   written: pounds become pennies the same way, a Stripe price id has one
   shape, a plan has to unlock something. The CALLER saves (o.save), so each
   console reports a refusal in its own voice and the RPC stays visible in the
   console's own source.

   o: { plan, leagueId, features:[allowed keys], seller:'league'|'platform',
        sellerChoice:boolean, save: async payload => boolean, cancel, say }
   ========================================================================== */
function planForm(o) {
  const p = o.plan || {};
  const allowed = o.features && o.features.length ? o.features : ['analytics'];
  const wrap = el('div', 'ax-form');
  wrap.appendChild(el('div', 'ax-sub', p.id ? 'Edit “' + p.name + '”' : 'New plan'));

  const r1 = el('div', 'row');
  const name = el('input', 'ep-input');
  name.maxLength = 60; name.value = p.name || '';
  name.placeholder = o.leagueId ? 'Season membership' : 'Epinoia Analytics';
  const price = el('input', 'ep-input');
  price.inputMode = 'decimal'; price.placeholder = '4.99';
  price.value = p.price_pennies != null ? (Number(p.price_pennies) / 100).toFixed(2) : '';
  const every = el('select', 'ep-input');
  every.append(opt('month', 'month'), opt('year', 'year'));
  every.value = p.interval === 'year' ? 'year' : 'month';
  const sort = el('input', 'ep-input');
  sort.type = 'number'; sort.step = '1'; sort.value = String(p.sort != null ? p.sort : 0);
  r1.append(field('NAME', name, '2 1 220px'), field('PRICE IN POUNDS', price, '0 0 120px'),
            field('EVERY', every, '0 0 110px'), field('ORDER ON THE PAGE', sort, '0 0 120px'));
  wrap.appendChild(r1);

  const r2 = el('div', 'row');
  const blurb = el('textarea', 'ep-input');
  blurb.rows = 2; blurb.maxLength = 400; blurb.value = p.blurb || '';
  blurb.placeholder = 'One or two sentences a fan reads beside the price (optional)';
  r2.appendChild(field('WHAT THE PLAN SAYS', blurb, '1 1 100%'));
  wrap.appendChild(r2);

  wrap.appendChild(el('div', 'ax-sub', 'What it unlocks'));
  const feats = el('div', 'ax-feats');
  const boxes = {};
  allowed.forEach(k => {
    const cell = el('div');
    const lab = el('label', 'sw');
    const box = el('input'); box.type = 'checkbox';
    box.checked = p.features ? p.features.includes(k) : true;
    /* one thing on offer is not a choice: shown, ticked, and not untickable */
    if (allowed.length === 1) { box.checked = true; box.disabled = true; }
    boxes[k] = box;
    lab.append(box, document.createTextNode(' ' + (FEATURES[k] || { label: k }).label));
    cell.append(lab, el('div', 'ax-hint', (FEATURES[k] || {}).hint || ''));
    feats.appendChild(cell);
  });
  wrap.appendChild(feats);
  if (!o.leagueId) {
    wrap.appendChild(el('div', 'ax-hint',
      'A plan sold by Epinoia can only unlock the analytics. A league that closes ' +
      'its doors does so for its own members, and Epinoia does not sell a way past that.'));
  }

  const r3 = el('div', 'row');
  const priceId = el('input', 'ep-input');
  priceId.placeholder = 'price_…';
  priceId.value = p.stripe_price_id || '';
  priceId.autocomplete = 'off'; priceId.spellcheck = false;
  r3.appendChild(field('STRIPE PRICE ID', priceId, '2 1 260px'));
  let sellerSel = null;
  if (o.sellerChoice) {
    sellerSel = el('select', 'ep-input');
    sellerSel.append(opt('league', 'the league, on its own Stripe account'),
                     opt('platform', 'Epinoia, on Epinoia’s Stripe account'));
    sellerSel.value = p.seller === 'platform' ? 'platform' : 'league';
    r3.appendChild(field('SOLD BY', sellerSel, '1 1 240px'));
  }
  wrap.appendChild(r3);

  const sellerHint = el('div', 'ax-hint');
  const drawSellerHint = () => {
    const seller = sellerSel ? sellerSel.value : (p.seller || o.seller || 'platform');
    sellerHint.textContent = (seller === 'league'
      ? 'Sold on the league’s own Stripe account: the money goes to the league, less ' +
        'Epinoia’s fee. Create the price in the league’s Stripe account once payouts ' +
        'are connected, and paste its id here.'
      : 'Sold on Epinoia’s Stripe account. Create the price in Epinoia’s Stripe ' +
        'dashboard and paste its id here.') +
      ' Make the Stripe price the same amount, recurring every ' + every.value +
      ', with tax included, so a fan pays exactly the price they were shown. ' +
      'Without an id the plan is listed but cannot be bought.';
  };
  drawSellerHint();
  every.addEventListener('change', drawSellerHint);
  if (sellerSel) sellerSel.addEventListener('change', drawSellerHint);
  wrap.appendChild(sellerHint);

  const r4 = el('div', 'row');
  const activeLab = el('label', 'sw');
  const active = el('input'); active.type = 'checkbox';
  active.checked = p.active !== false;
  activeLab.append(active, document.createTextNode(' on sale'));
  const save = el('button', 'ep-btn pri', p.id ? 'save plan' : 'create plan');
  save.type = 'button';
  const cancel = el('button', 'ep-btn mini', 'cancel');
  cancel.type = 'button';
  r4.append(activeLab, save, cancel);
  wrap.appendChild(r4);

  cancel.addEventListener('click', () => { if (o.cancel) o.cancel(); else wrap.remove(); });

  save.addEventListener('click', async () => {
    const say = o.say || (() => {});
    const n = name.value.trim();
    if (!n) return say('Give the plan a name.', 'err');
    const features = allowed.filter(k => boxes[k].checked);
    if (!features.length) return say('Tick at least one thing the plan unlocks.', 'err');
    const pennies = toPennies(price.value);
    if (pennies == null) return say('Write the price in pounds, like 4.99.', 'err');
    const pid = priceId.value.trim();
    if (pid && !PRICE_ID.test(pid)) {
      return say('A Stripe price id starts with price_ and has only letters and digits ' +
                 'after it. Copy it from the price’s page in Stripe.', 'err');
    }
    const seller = sellerSel ? sellerSel.value : (p.seller || o.seller || 'platform');
    /* The analytics are Epinoia's product. A plan the league sells on its own
       account may include them, but not for nothing — otherwise a free league
       plan is a way to give Epinoia's analytics away. save_access_plan refuses
       the same; saying so here saves a round trip and a Postgres sentence. */
    if (o.leagueId && seller === 'league' && features.includes('analytics') && pennies === 0) {
      return say('A plan the league sells can only include the analytics at a price. ' +
                 'Set a price, or untick Analytics.', 'err');
    }
    const payload = {
      league_id: o.leagueId || null,
      name: n,
      blurb: blurb.value.trim(),
      features,
      price_pennies: pennies,
      currency: (p.currency || 'gbp').toLowerCase(),
      interval: every.value,
      /* '' clears a stored id, which is what an emptied box means here: the
         id is shown back, so an empty box is a decision, not "not loaded" */
      stripe_price_id: pid,
      active: active.checked,
      sort: Math.trunc(Number(sort.value) || 0),
      seller
    };
    if (p.id) payload.id = p.id;
    save.disabled = true;
    try { await o.save(payload); } finally { save.disabled = false; }
  });

  wrap.focusFirst = () => { try { name.focus(); } catch (_) {} };
  return wrap;
}

/* ==========================================================================
   THE PANEL.
   o: { host, sb, league: () => league, say, oops?, cfg, isPlatformAdmin? }
   ========================================================================== */
const generations = new WeakMap();

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.setAttribute('data-i18n-ctx', 'console');
  /* A remount (the league changed) makes every answer still in flight from the
     previous mount stale; they check this before drawing anything. */
  const gen = (generations.get(host) || 0) + 1;
  generations.set(host, gen);
  const live = () => generations.get(host) === gen;

  const current = () => (typeof o.league === 'function' ? o.league() : o.league) || null;
  const fail = e => (o.oops ? o.oops(e) : oopsLike(o.say, e));
  const isPlat = () => typeof o.isPlatformAdmin === 'function' && !!o.isPlatformAdmin();

  host.textContent = '';
  if (!current()) {
    host.appendChild(el('div', 'empty', 'Pick a league above.'));
    return;
  }
  host.appendChild(el('div', 'empty', 'Loading…'));

  let state = null;       // the last league_access_admin() answer
  let built = false;
  let accessDirty = false;
  const ui = {};

  /* Every write goes here first: the id this panel was loaded for, or nothing. */
  function pinned() {
    const lg = current();
    if (!state || !lg || lg.id !== state.league.id) {
      o.say('The league changed while this section was open, so nothing was saved. ' +
            'It is reloading for ' + (lg ? lg.name : 'the league you picked') + '.', 'err');
      load();
      return null;
    }
    return state.league.id;
  }

  async function load() {
    const lg = current();
    if (!lg) return;
    const { data, error } = await o.sb.rpc('league_access_admin', { p_league: lg.id });
    if (!live()) return;
    const now = current();
    if (!now || now.id !== lg.id) { load(); return; }

    if (error) {
      if (isMissing(error)) {
        /* nothing else: every part below needs the tables this would create */
        host.textContent = '';
        built = false;
        host.appendChild(el('div', 'empty', 'Run the membership migration first.'));
        return;
      }
      if (!built) {
        host.textContent = '';
        host.appendChild(el('div', 'empty',
          'Memberships could not be loaded for ' + lg.name + '.'));
      }
      return fail(error);
    }

    /* A DIFFERENT LEAGUE THROWS THE FORMS AWAY. Refilling in place is right
       for a reload after a save; for another league it would leave a plan
       form opened for the last one on screen, and saving it would create
       that plan here. */
    if (state && state.league.id !== lg.id) { built = false; accessDirty = false; }
    const d = data || {};
    state = {
      /* THE PLATFORM'S MASTER SWITCH. While memberships are off nothing this
         panel sets is enforced, so it says so at the top and in every sentence
         that would otherwise promise "straight away". Only an explicit false
         is off: a server older than the switch leaves the key out and gates
         by the league's settings alone. */
      membershipsEnabled: d.memberships_enabled !== false,
      league: Object.assign({ id: lg.id, name: lg.name, slug: lg.slug,
        access_mode: 'open', fixtures_public: true,
        analytics_access: 'inherit', analytics_mode: 'free' }, d.league || {}),
      plans: d.plans || [],
      members: d.members || [],
      grants: d.grants || [],
      counts: d.counts || {},
      payouts: d.payouts || {}
    };
    if (!built) build();
    fill();
  }

  /* ------------------------------------------------------------ skeleton --- */
  /* Built once per mount. A reload after a write refills the lists and the
     numbers but leaves the forms alone, so saving a grant does not throw away
     a plan half typed further up. */
  function build() {
    built = true;
    host.textContent = '';
    /* first thing in the section, above everything it qualifies */
    ui.switchedOff = el('div', 'ax-note ax-off hide',
      'Memberships are switched off for the whole platform. You can set this league up ' +
      'now; nothing is enforced until a platform admin switches memberships on.');
    ui.switchedOff.setAttribute('role', 'status');
    host.appendChild(ui.switchedOff);
    host.appendChild(el('p', 'empty',
      'Decide who can see this league, sell plans to fans, and give free access to ' +
      'the people who should have it. The league’s own admins, statisticians and ' +
      'writers always see everything and never pay. Club managers always see the ' +
      'league, but get the advanced analytics the same way fans do.'));

    buildAccess();
    buildAnalytics();
    buildPlans();
    buildMembers();
    buildGrants();
    buildPayouts();
  }

  function fill() {
    ui.switchedOff.classList.toggle('hide', state.membershipsEnabled);
    fillAccess();
    fillAnalytics();
    fillPlans();
    fillMembers();
    fillGrants();
    fillPayouts();
  }

  /* -------------------------------------------------------- a. access --- */
  function buildAccess() {
    host.appendChild(el('div', 'fmt-h', 'Who can see the league'));
    const choice = el('div', 'ax-choice');
    choice.dataset.i18nCtx = 'access';
    const nameAttr = 'ax-mode-' + gen + '-' + Math.random().toString(36).slice(2, 7);
    const radio = (value, title, words) => {
      const lab = el('label');
      const r = el('input'); r.type = 'radio'; r.name = nameAttr; r.value = value;
      const txt = el('span', null, title);
      txt.appendChild(el('small', null, words));
      lab.append(r, txt);
      choice.appendChild(lab);
      return r;
    };
    ui.modeOpen = radio('open', 'Open',
      'Everyone can see everything the league plays, as now.');
    ui.modeMembers = radio('members', 'Members only',
      'Results, box scores, live games, statistics, standings, awards, news and video ' +
      'are shown only to members, to people you give access below, and to the ' +
      'league’s own staff.');
    host.appendChild(choice);

    const fxLab = el('label', 'sw');
    ui.fixtures = el('input'); ui.fixtures.type = 'checkbox';
    fxLab.append(ui.fixtures, document.createTextNode(' Keep upcoming fixtures public'));
    host.appendChild(fxLab);
    host.appendChild(el('div', 'ax-hint',
      'Only matters when the league is members only. A league that wants people ' +
      'through the door has to say when the doors open, so this starts ticked.'));

    ui.nobuy = el('div', 'ax-note hide');
    host.appendChild(ui.nobuy);

    const bar = el('div', 'row');
    ui.saveAccess = el('button', 'ep-btn pri', 'save access');
    ui.saveAccess.type = 'button';
    ui.accessState = el('span', 'mt');
    bar.append(ui.saveAccess, ui.accessState);
    host.appendChild(bar);
    ui.warnings = el('div');
    host.appendChild(ui.warnings);

    host.appendChild(el('p', 'empty',
      'Still public in a members-only league, so fans can find it and join: the ' +
      'league’s name, crest and colours, its seasons and competitions, its clubs, ' +
      'squads and player names, its upcoming fixtures while the box above is ' +
      'ticked, and its plans and prices.'));

    /* ALWAYS ON SCREEN, not behind a fold or shown only after switching: this
       is the list a league has to read before it decides, and a warning that
       appears after the decision is a receipt, not a warning. */
    const gap = el('div', 'ax-gap');
    gap.appendChild(el('div', 'ax-gap-h', 'What members only does not protect yet'));
    const ol = el('ol');
    [
      'Photos, club crests and highlight videos are stored at public web ' +
      'addresses. Anyone who has one of those links can still open it.',
      'Live scoring updates travel over open channels. Someone who knows a ' +
      'game’s id can follow a members-only game while it is being played.',
      'Broadcast overlays read the league as a signed-out visitor, so a ' +
      'members-only league’s own on-air graphics go blank. If this league ' +
      'streams its games, keep it open until overlays get their own access tokens.',
      'If the league’s games come from a public FIBA LiveStats feed, the ' +
      'play-by-play is already public at the source. Members only protects how ' +
      'Epinoia presents and analyses it, not the facts.',
      'Partner feeds, webhooks and API keys this league has set up keep working. ' +
      'That is the league’s own choice, not a leak.'
    ].forEach(t => ol.appendChild(el('li', null, t)));
    gap.appendChild(ol);
    host.appendChild(gap);

    const dirty = () => { accessDirty = true; drawNobuy(); };
    ui.modeOpen.addEventListener('change', dirty);
    ui.modeMembers.addEventListener('change', dirty);
    ui.fixtures.addEventListener('change', dirty);

    ui.saveAccess.addEventListener('click', saveAccess);
  }

  function purchasableLeaguePlan() {
    return state.plans.some(p => p.league_id && p.active !== false && hasPrice(p) &&
      (p.features || []).includes('league'));
  }

  function drawNobuy() {
    const show = ui.modeMembers.checked && !purchasableLeaguePlan();
    ui.nobuy.classList.toggle('hide', !show);
    ui.nobuy.textContent = show
      ? 'Nobody can join yet: no plan that includes the league is on sale with a ' +
        'Stripe price. Until there is one, only the league’s staff and people you ' +
        'give access below can see what it plays.'
      : '';
  }

  function fillAccess() {
    const L = state.league;
    if (!accessDirty) {
      ui.modeOpen.checked = L.access_mode !== 'members';
      ui.modeMembers.checked = L.access_mode === 'members';
      ui.fixtures.checked = L.fixtures_public !== false;
    }
    ui.accessState.textContent = 'now: ' + (L.access_mode === 'members'
      ? 'members only' + (L.fixtures_public !== false ? ', fixtures public' : ', fixtures private') +
        (state.membershipsEnabled ? '' : ' (not enforced while memberships are off)')
      : 'open');
    drawNobuy();
  }

  async function saveAccess() {
    const id = pinned(); if (!id) return;
    const L = state.league;
    const mode = ui.modeMembers.checked ? 'members' : 'open';
    const fx = ui.fixtures.checked;
    if (mode !== L.access_mode) {
      const q = mode === 'members'
        ? 'Make ' + L.name + ' members only?\n\nResults, box scores, live games, ' +
          'statistics, standings, awards, news and video will be shown only to ' +
          'members, to people given access, and to the league’s staff. ' +
          (fx ? 'Upcoming fixtures stay public.' : 'Upcoming fixtures will be hidden too.') +
          (state.membershipsEnabled ? '' : '\n\nMemberships are switched off for the whole ' +
            'platform, so nothing changes for fans until a platform admin switches them on.') +
          '\n\nCheck the list of what this does not protect yet before you go ahead.'
        : 'Open ' + L.name + ' to everyone?\n\nEverything the league has played ' +
          'becomes public again straight away. Members keep paying until they cancel.';
      if (!confirm(q)) return;
    }

    ui.saveAccess.disabled = true;
    const { data, error } = await o.sb.rpc('set_league_access',
      { p_league: id, p_mode: mode, p_fixtures_public: fx });
    ui.saveAccess.disabled = false;
    if (!live()) return;
    if (error) return fail(error);

    const res = data || {};
    const nowMode = res.access_mode || mode;
    const nowFx = res.fixtures_public != null ? !!res.fixtures_public : fx;
    const warnings = res.warnings || [];
    accessDirty = false;

    ui.warnings.textContent = '';
    warnings.forEach(w => ui.warnings.appendChild(el('div', 'ax-note', String(w))));

    let s;
    if (nowMode === 'members') {
      s = L.name + (L.access_mode === 'members' ? ' stays members only' : ' is now members only') +
          (nowFx ? ', and its upcoming fixtures are public.' : ', and its upcoming fixtures are hidden too.');
    } else {
      s = L.name + (L.access_mode === 'members' ? ' is open to everyone again.' : ' stays open to everyone.');
    }
    if (warnings.length) s += ' Read the warning under the button.';
    o.say(s, 'ok');
    load();
  }

  /* ------------------------------------------------------ b. analytics --- */
  function buildAnalytics() {
    host.appendChild(el('div', 'fmt-h', 'Analytics in this league'));
    ui.analytics = el('p', 'empty');
    ui.analytics.dataset.i18nCtx = 'prose';
    ui.analytics.style.paddingTop = '0';
    host.appendChild(ui.analytics);
  }

  function fillAnalytics() {
    const L = state.league;
    const mode = L.analytics_mode === 'members' ? 'members' : 'free';
    let line;
    if (L.analytics_access === 'free') {
      line = 'Free for everyone in this league, whatever the platform default: Epinoia has set it that way.';
    } else if (L.analytics_access === 'members') {
      line = 'Members only in this league, whatever the platform default: Epinoia has set it that way.';
    } else {
      line = 'This league follows the platform default, which is currently ' +
        (mode === 'members' ? 'members only.' : 'free for everyone.');
    }
    /* analytics_mode is the configured mode; while memberships are off it is
       not what fans get */
    if (!state.membershipsEnabled && mode === 'members') {
      line += ' Memberships are switched off, so for now the analytics are free for everyone here.';
    }
    ui.analytics.textContent = line + ' The advanced analytics are the events splits, ' +
      'zone shot charts, the game flow, connections and events tabs, and the full ' +
      'WOWY screen. Only Epinoia’s platform admins can change this. ';
    if (isPlat()) {
      const a = el('a', null, 'Change it in the platform console.');
      a.href = 'platform/';
      a.style.color = 'var(--lume)';
      ui.analytics.appendChild(a);
    }
  }

  /* ---------------------------------------------------------- c. plans --- */
  function buildPlans() {
    host.appendChild(el('div', 'fmt-h', 'Plans'));
    host.appendChild(el('p', 'empty',
      'What fans can buy in this league. A plan without a Stripe price id is listed ' +
      'but cannot be bought. A league plan’s Stripe price has to be created in the ' +
      'league’s own Stripe account, once payouts are connected below.'));
    const bar = el('div', 'row');
    const add = el('button', 'ep-btn', 'new plan'); add.type = 'button';
    bar.appendChild(add);
    host.appendChild(bar);
    ui.editor = el('div');
    host.appendChild(ui.editor);
    ui.planList = el('div', 'list');
    host.appendChild(ui.planList);
    add.addEventListener('click', () => openEditor(null));
  }

  function openEditor(plan) {
    ui.editor.textContent = '';
    const L = state.league;
    const form = planForm({
      plan, leagueId: L.id, features: ['league', 'analytics'],
      seller: 'league', sellerChoice: isPlat(), say: o.say,
      cancel: () => { ui.editor.textContent = ''; },
      save: async payload => {
        const id = pinned(); if (!id) return false;
        payload.league_id = id;
        const { error } = await o.sb.rpc('save_access_plan', { p: payload });
        if (!live()) return false;
        if (error) { fail(error); return false; }
        ui.editor.textContent = '';
        o.say(payload.id
          ? '“' + payload.name + '” saved.' + (payload.active ? '' : ' It is not on sale.')
          : '“' + payload.name + '” created at ' + money(payload.price_pennies, payload.currency) +
            ' ' + per(payload.interval) + '.' +
            (payload.stripe_price_id ? '' : ' Add its Stripe price id to put it on sale.'), 'ok');
        load();
        return true;
      }
    });
    ui.editor.appendChild(form);
    form.focusFirst();
  }

  function planState(p) {
    if (p.active === false) return 'off sale';
    if (!hasPrice(p)) return 'no Stripe price yet, so it cannot be bought';
    if (p.seller === 'league' && !state.payouts.charges_enabled) {
      return 'cannot be bought until the league’s Stripe account can take payments';
    }
    return 'on sale';
  }

  function fillPlans() {
    const host2 = ui.planList;
    host2.textContent = '';
    const mine = state.plans.filter(p => p.league_id);
    const platform = state.plans.filter(p => !p.league_id);

    if (!mine.length) {
      host2.appendChild(el('div', 'empty', 'This league has no plans of its own yet.'));
    }
    mine.forEach(p => {
      const row = el('div', 'item');
      if (p.active === false) row.style.opacity = '.62';
      const box = el('div');
      box.appendChild(el('div', 'nm', p.name + ' · ' + money(p.price_pennies, p.currency) +
        ' ' + per(p.interval)));
      const bits = [
        'unlocks ' + featureWords(p.features),
        p.seller === 'league' ? 'sold by the league' : 'sold by Epinoia',
        planState(p)
      ];
      if (p.stripe_price_id) bits.push(p.stripe_price_id);
      bits.push('order ' + (p.sort || 0));
      box.appendChild(el('div', 'mt', bits.join(' · ')));
      if (p.blurb) box.appendChild(el('div', 'mt', p.blurb));
      row.appendChild(box);

      /* A league plan Epinoia sells (seller 'platform') is only a platform
         admin's to change: save_access_plan and archive_access_plan refuse a
         league admin. Offering buttons that can only be refused is worse than
         saying who looks after it. */
      if (p.seller !== 'league' && !isPlat()) {
        box.appendChild(el('div', 'mt', 'Epinoia sells this plan for the league, so only ' +
          'Epinoia can change it.'));
        host2.appendChild(row);
        return;
      }
      const sp = el('div', 'sp');
      const edit = el('button', 'ep-btn mini', 'edit'); edit.type = 'button';
      edit.addEventListener('click', () => openEditor(p));
      sp.appendChild(edit);
      if (p.active !== false) {
        const arch = el('button', 'ep-btn mini dgr', 'take off sale'); arch.type = 'button';
        arch.addEventListener('click', async () => {
          if (!confirm('Take “' + p.name + '” off sale?\n\nNobody new can buy it. People ' +
                       'who already pay for it keep their membership until they cancel.')) return;
          if (!pinned()) return;
          arch.disabled = true;
          const { error } = await o.sb.rpc('archive_access_plan', { p_plan: p.id });
          arch.disabled = false;
          if (!live()) return;
          if (error) return fail(error);
          o.say('“' + p.name + '” is off sale. People who already pay for it keep it.', 'ok');
          load();
        });
        sp.appendChild(arch);
      }
      row.appendChild(sp);
      host2.appendChild(row);
    });

    if (platform.length) {
      host2.appendChild(el('div', 'ax-sub', 'Sold by Epinoia in every league'));
      platform.forEach(p => {
        const row = el('div', 'item');
        if (p.active === false) row.style.opacity = '.62';
        const box = el('div');
        box.appendChild(el('div', 'nm', p.name + ' · ' + money(p.price_pennies, p.currency) +
          ' ' + per(p.interval)));
        box.appendChild(el('div', 'mt', 'unlocks ' + featureWords(p.features) + ' · ' +
          planState(p) + ' · managed in the platform console'));
        row.appendChild(box);
        host2.appendChild(row);
      });
    }
  }

  /* -------------------------------------------------------- d. members --- */
  function buildMembers() {
    host.appendChild(el('div', 'fmt-h', 'Members'));
    ui.counts = el('div', 'app-grid');
    host.appendChild(ui.counts);
    ui.members = el('div');
    host.appendChild(ui.members);
  }

  /* ENDING IS EITHER FLAG: a cancellation made in Stripe's portal on flexible
     billing (the default for new subscriptions) sets only cancel_at, with
     cancel_at_period_end left false, and the date it ends on is cancel_at. */
  const ending = m => !!m.cancel_at_period_end || !!m.cancel_at;
  function renewWords(m) {
    const end = fmtDate(m.current_period_end);
    const endsOn = fmtDate(m.cancel_at || m.current_period_end);
    switch (m.status) {
      case 'canceled':
      case 'incomplete_expired':
        return end ? 'ended ' + end : 'ended';
      case 'incomplete':
        return 'not started';
      case 'past_due':
        if (!m.active) return 'access stopped';
        return 'keeps access for up to ' + GRACE_DAYS + ' days after the payment failed, ' +
          'unless the card is fixed' + (ending(m) && endsOn ? '; set to end ' + endsOn : '');
      case 'unpaid':
      case 'paused':
        return 'no access';
      default:
        if (ending(m)) return endsOn ? 'ends ' + endsOn : 'ending';
        if (!end) return '';
        return (m.status === 'trialing' ? 'first payment ' : 'renews ') + end;
    }
  }

  function fillMembers() {
    const c = state.counts;
    ui.counts.textContent = '';
    [
      ['active', 'members with access', 'ok'],
      ['past_due', 'payment failing', 'warn'],
      ['ended', 'ended', ''],
      ['grants', 'complimentary', 'ok']
    ].forEach(([k, label, tone]) => {
      const cell = el('div', 'app-cell');
      const n = Number(c[k] || 0);
      cell.append(el('div', 'ax-k', label),
                  el('div', 'ax-v' + (n && tone ? ' ' + tone : ''), String(n)));
      ui.counts.appendChild(cell);
    });

    ui.members.textContent = '';
    const rows = state.members;
    if (!rows.length) {
      ui.members.appendChild(el('div', 'empty', 'Nobody has bought a plan in this league yet.'));
      return;
    }
    const wrap = el('div', 'ax-scroll');
    const t = el('table', 'ax-tbl');
    const hr = t.createTHead().insertRow();
    ['Email', 'Plan', 'Status', 'Renews or ends'].forEach(h => hr.appendChild(el('th', null, h)));
    const body = t.createTBody();
    rows.forEach(m => {
      const tr = body.insertRow();
      if (!m.active) tr.className = 'off';
      const c0 = tr.insertCell();
      c0.appendChild(el('div', 'nm', m.email || '—'));
      if (m.created_at) c0.appendChild(el('div', 'mt', 'since ' + fmtDate(m.created_at)));
      const c1 = tr.insertCell();
      c1.appendChild(el('div', null, m.plan_name || '(plan removed)'));
      c1.appendChild(el('div', 'mt', featureWords(m.features)));
      const [words, tone] = STATUS[m.status] || [String(m.status || 'unknown'), 'off'];
      const c2 = tr.insertCell();
      c2.appendChild(el('span', 'ax-st ' + tone, words));
      /* bought with Stripe's test keys and a test card: no money moved. Marked
         so a league does not count it as a member, and so switch-on can find
         every one to cancel. Only a KNOWN false: an older server says nothing. */
      if (m.livemode === false) {
        const t = el('span', 'ax-st warn', 'test');
        t.title = 'Bought in Stripe’s test mode: no money was taken.';
        t.style.marginLeft = '4px';
        c2.appendChild(t);
      }
      tr.insertCell().appendChild(el('span', 'mt', renewWords(m)));
    });
    wrap.appendChild(t);
    ui.members.appendChild(wrap);
  }

  /* --------------------------------------------- e. complimentary access --- */
  function buildGrants() {
    host.appendChild(el('div', 'fmt-h', 'Complimentary access'));
    host.appendChild(el('p', 'empty',
      'Free access for press, club officials, a sponsor’s guests. It is tied to an ' +
      'email address, so it works the moment that person signs in, even if they have ' +
      'no account yet. The league’s own staff already have everything and need nothing here.'));

    const r1 = el('div', 'row');
    ui.gEmail = el('input', 'ep-input');
    ui.gEmail.type = 'email'; ui.gEmail.placeholder = 'person@example.org';
    ui.gEmail.autocomplete = 'off';
    ui.gExpires = el('input', 'ep-input'); ui.gExpires.type = 'date';
    ui.gNote = el('input', 'ep-input');
    ui.gNote.maxLength = 200; ui.gNote.placeholder = 'Why (only admins see this)';
    r1.append(field('EMAIL', ui.gEmail, '2 1 220px'),
              field('UNTIL (OPTIONAL)', ui.gExpires, '0 0 160px'),
              field('NOTE', ui.gNote, '2 1 200px'));
    host.appendChild(r1);

    /* THE ANALYTICS ARE EPINOIA'S TO GIVE. A league admin grants its league;
       grant_access refuses 'analytics' from anybody but a platform admin, so
       the box is only offered to one. It starts unticked even then: giving the
       analytics away is a decision, not a default. Visibility is set on every
       fill, because who is looking can be learnt after this is built. */
    const r2 = el('div', 'row');
    ui.gBoxes = {};
    ui.gLabs = {};
    ['league', 'analytics'].forEach(k => {
      const lab = el('label', 'sw');
      const box = el('input'); box.type = 'checkbox'; box.checked = k === 'league';
      ui.gBoxes[k] = box;
      ui.gLabs[k] = lab;
      lab.append(box, document.createTextNode(' ' + FEATURES[k].label));
      r2.appendChild(lab);
    });
    const go = el('button', 'ep-btn pri', 'give access'); go.type = 'button';
    r2.appendChild(go);
    host.appendChild(r2);
    ui.gHint = el('div', 'ax-hint',
      'Complimentary access opens the league. The advanced analytics are Epinoia’s ' +
      'product, so only Epinoia can give those away.');
    host.appendChild(ui.gHint);

    ui.grantList = el('div', 'list');
    host.appendChild(ui.grantList);

    go.addEventListener('click', async () => {
      const email = ui.gEmail.value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return o.say('Enter the email address the person signs in with.', 'err');
      }
      const features = ['league', 'analytics']
        .filter(k => ui.gBoxes[k].checked && (k !== 'analytics' || isPlat()));
      if (!features.length) return o.say('Tick what the access unlocks.', 'err');
      /* a date means "through that day": the end of it, in the admin's own
         time, rather than midnight at its start, which would end a pass
         marked "until Saturday" before Saturday's game */
      let expires = null;
      if (ui.gExpires.value) {
        const [y, m, d] = ui.gExpires.value.split('-').map(Number);
        const end = new Date(y, m - 1, d, 23, 59, 59, 999);
        if (isNaN(end) || end.getTime() <= Date.now()) {
          return o.say('That date has already passed. Leave it empty for access with no end date.', 'err');
        }
        expires = end.toISOString();
      }
      const id = pinned(); if (!id) return;
      go.disabled = true;
      const { error } = await o.sb.rpc('grant_access', {
        p_league: id, p_email: email, p_features: features,
        p_expires: expires, p_note: ui.gNote.value.trim() || null });
      go.disabled = false;
      if (!live()) return;
      if (error) return fail(error);
      o.say('Access given to ' + email + ': ' + featureWords(features) +
            (expires ? ', until ' + fmtDate(expires) : ', with no end date') +
            '. It takes effect as soon as they sign in with that address.', 'ok');
      ui.gEmail.value = ''; ui.gExpires.value = ''; ui.gNote.value = '';
      load();
    });
  }

  function fillGrants() {
    const plat = isPlat();
    ui.gLabs.analytics.classList.toggle('hide', !plat);
    if (!plat) ui.gBoxes.analytics.checked = false;
    ui.gHint.classList.toggle('hide', plat);
    const list = ui.grantList;
    list.textContent = '';
    const now = Date.now();
    const ended = g => !!g.revoked_at || (g.expires_at && new Date(g.expires_at).getTime() <= now);
    const rows = state.grants.slice().sort((a, b) => Number(ended(a)) - Number(ended(b)));
    if (!rows.length) {
      list.appendChild(el('div', 'empty', 'Nobody has complimentary access in this league.'));
      return;
    }
    rows.forEach(g => {
      const row = el('div', 'item');
      const gone = ended(g);
      if (gone) row.style.opacity = '.55';
      const box = el('div');
      box.appendChild(el('div', 'nm', g.email));
      const bits = [featureWords(g.features)];
      if (g.revoked_at) bits.push('taken away ' + fmtDate(g.revoked_at));
      else if (gone) bits.push('ended ' + fmtDate(g.expires_at));
      else bits.push(g.expires_at ? 'until ' + fmtDate(g.expires_at) : 'no end date');
      if (g.created_at) bits.push('given ' + fmtDate(g.created_at));
      box.appendChild(el('div', 'mt', bits.join(' · ')));
      if (g.note) box.appendChild(el('div', 'mt', g.note));
      row.appendChild(box);
      if (!gone) {
        const sp = el('div', 'sp');
        const rm = el('button', 'ep-btn mini dgr', 'take away'); rm.type = 'button';
        rm.addEventListener('click', async () => {
          if (!confirm('Take complimentary access away from ' + g.email + '?\n\n' +
                       'It stops straight away.')) return;
          if (!pinned()) return;
          rm.disabled = true;
          const { error } = await o.sb.rpc('revoke_access_grant', { p_grant: g.id });
          rm.disabled = false;
          if (!live()) return;
          if (error) return fail(error);
          o.say('Complimentary access for ' + g.email + ' has been taken away.', 'ok');
          load();
        });
        sp.appendChild(rm);
        row.appendChild(sp);
      }
      list.appendChild(row);
    });
  }

  /* -------------------------------------------------------- f. payouts --- */
  function buildPayouts() {
    host.appendChild(el('div', 'fmt-h', 'Payouts'));
    ui.payText = el('p', 'empty');
    ui.payText.style.paddingTop = '0';
    host.appendChild(ui.payText);
    ui.payGrid = el('div', 'app-grid');
    host.appendChild(ui.payGrid);
    const bar = el('div', 'row');
    ui.connect = el('button', 'ep-btn pri', 'Connect a Stripe account');
    ui.connect.type = 'button';
    bar.appendChild(ui.connect);
    host.appendChild(bar);
    host.appendChild(el('div', 'ax-note',
      'Before this league sells on its own account, get an accountant’s view on VAT. ' +
      'HMRC’s rule for digital platforms can make Epinoia the supplier of the ' +
      'league’s memberships, even though the money goes to the league.'));
    ui.connect.addEventListener('click', connect);
  }

  function fillPayouts() {
    const pay = state.payouts;
    const fee = pay.fee_percent != null ? Number(pay.fee_percent) : 10;
    ui.payText.textContent = 'Connecting a Stripe account lets this league sell its own ' +
      'plans and be paid directly, less Epinoia’s fee of ' + fee + '%. Stripe asks for ' +
      'the league’s bank and identity details on its own site; nothing is typed in here. ' +
      'Afterwards Stripe sends you back to this page, and the status below updates once ' +
      'Stripe has told Epinoia, usually within a minute.';
    ui.payGrid.textContent = '';
    [
      ['Stripe account', pay.connected ? 'connected' : 'not connected', pay.connected],
      ['Can take payments', pay.charges_enabled ? 'yes' : 'not yet', pay.charges_enabled],
      ['Can pay out to the bank', pay.payouts_enabled ? 'yes' : 'not yet', pay.payouts_enabled],
      ['Epinoia’s fee', fee + '%', null]
    ].forEach(([k, v, good]) => {
      const cell = el('div', 'app-cell');
      cell.append(el('div', 'ax-k', k),
                  el('div', 'ax-v' + (good === true ? ' ok' : good === false && pay.connected ? ' warn' : ''), v));
      ui.payGrid.appendChild(cell);
    });
    ui.connect.textContent = !pay.connected ? 'Connect a Stripe account'
      : !pay.charges_enabled ? 'Finish setting up Stripe'
      : 'Update the Stripe details';
  }

  async function connect() {
    const id = pinned(); if (!id) return;
    if (!o.cfg || !o.cfg.supabaseUrl) {
      return o.say('There is no Supabase address in config.js, so Stripe cannot be reached.', 'err');
    }
    ui.connect.disabled = true;
    try {
      const { data: { session } } = await o.sb.auth.getSession();
      if (!session) {
        ui.connect.disabled = false;
        return o.say('Your sign-in has run out. Sign in again, then connect Stripe.', 'err');
      }
      const r = await fetch(o.cfg.supabaseUrl + '/functions/v1/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: o.cfg.supabaseAnonKey,
                   Authorization: 'Bearer ' + session.access_token },
        body: JSON.stringify({ action: 'connect', leagueId: id, next: '/epinoia/admin/' })
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 503) {
        ui.connect.disabled = false;
        return o.say('Payments are not switched on yet: Epinoia has not added its Stripe ' +
                     'keys, so no league can connect an account. Nothing has changed.', 'err');
      }
      if (!r.ok || j.error || !j.url) {
        ui.connect.disabled = false;
        return o.say('Stripe could not be opened: ' + (j.error || ('refused (' + r.status + ')')) + '.', 'err');
      }
      /* the address comes from our own function, but a page that navigates
         wherever a response says is one bug away from an open redirect */
      if (!/^https:\/\//i.test(j.url)) {
        ui.connect.disabled = false;
        return o.say('Stripe sent back an address this page will not open.', 'err');
      }
      o.say('Opening Stripe…', 'ok');
      location.assign(j.url);
    } catch (e) {
      ui.connect.disabled = false;
      o.say('Could not reach the server: ' + (e.message || e), 'err');
    }
  }

  load();
}

return { mount, planForm, money, per, featureWords, FEATURES };
}));
