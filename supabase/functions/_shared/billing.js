// ============================================================================
// BILLING — the pure half of the `billing` Edge Function (docs/memberships.md §5).
//
// PURE. No database, no network, no Deno. Everything in this file is a
// function of its arguments, which is why it is .js and not .ts: it runs
// unchanged under Deno in the Edge Function and under Node in
// supabase/tests/billing.test.mjs. The function itself (billing/index.ts) is
// the thin part that holds the secrets, talks to Stripe, Resend and Postgres,
// and decides what to do when one of them fails.
//
// WHY THERE IS NO STRIPE SDK. Four calls and one signature check do not need a
// library that pulls in its own HTTP stack, its own retry policy and its own
// idea of which API version it is speaking. Every request goes out as plain
// form-encoded fetch, pinned to one version, and every shape it sends is
// asserted by a test — so a Stripe release cannot change what we send without
// somebody changing a line here and watching a test fail.
//
// THE VERSION IS PINNED, AND IT MATTERS. 2026-08-26.dahlia moved things the
// code depends on:
//   * the billing period lives on the subscription ITEM
//     (items.data[0].current_period_end), not on the subscription;
//   * an invoice names its subscription at parent.subscription_details;
//   * Checkout's ui_mode values were renamed, so ui_mode is left unset and the
//     hosted page is what you get.
// The webhook endpoints in the Stripe dashboard must be created on the SAME
// version (docs/switch-on.md §6), because events are rendered in the endpoint's
// version, not the request's.
//
// THREE RULES THIS FILE FOLLOWS
//
// 1. NOTHING FROM STRIPE IS TRUSTED UNTIL THE SIGNATURE HAS BEEN CHECKED OVER
//    THE RAW BODY. Re-serialised JSON is not the bytes Stripe signed. The
//    check accepts any v1 (two appear while a secret is being rolled), ignores
//    v0 (a test scheme an attacker could otherwise downgrade to), and refuses
//    a timestamp more than five minutes away, so a captured request cannot be
//    replayed tomorrow.
//
// 2. STATE IS OVERWRITTEN, NEVER INCREMENTED, AND AN OLDER READ NEVER WINS.
//    Stripe delivers events more than once and in any order. So an event is
//    only ever a prompt to re-fetch the subscription and write down what it
//    says NOW; a stale event can then never roll a member back, because
//    nothing is derived from the event's own copy of the object. The write is
//    compare-and-set on the moment of that fetch (billing_apply_subscription),
//    so two deliveries racing through two function instances cannot leave the
//    older fetch on top. And the one-off emails follow from what the write
//    CHANGED, which the database reports to exactly one write — never from the
//    event's type or from which delivery of it this is.
//
// 3. WORDS A CUSTOMER READS ARE BUILT HERE, WHERE A TEST CAN READ THEM. The
//    confirmation email is the durable-medium record the Consumer Contracts
//    Regulations 2013 (reg 16) ask for, and it must repeat the consent wording
//    the person actually ticked. That wording is kept by version in CONSENT,
//    and the join page sends the version it showed.
// ============================================================================

export const STRIPE_API = 'https://api.stripe.com/v1';
export const STRIPE_VERSION = '2026-08-26.dahlia';

/* Stripe's own libraries default to five minutes. Zero would switch the check
   off, which Stripe warns against — so a zero or negative tolerance is not
   honoured below, it falls back to this. */
export const SIGNATURE_TOLERANCE = 300;

/* The same week SQL access_active() allows, used twice there and twice here.
   A past_due member keeps access for a week from the moment the row first went
   past_due (past_due_since) while Stripe's retries run — counted from then, not
   from the period end, because Stripe moves the period end forward when it
   raises the renewal invoice, so "period end + 7 days" was a whole unpaid
   period plus a week. And an active member whose events have stopped arriving
   (a test-mode subscription after the switch to live, an endpoint deleted)
   loses access a week after the period end they last told us about, instead
   of keeping it for ever. Keep the two equal. */
export const GRACE_DAYS = 7;

export const DEFAULT_SITE = 'https://prophesyscouting.co.uk';
export const DEFAULT_NEXT = '/epinoia/me/';
export const DEFAULT_CONNECT_NEXT = '/epinoia/admin/';

/* The consent wording, by version. The join page shows CONSENT[version] beside
   checkbox 1 and posts the version; checkout refuses a version not listed here;
   the confirmation email quotes it back. Never edit a wording in place — add a
   new version, because a stored consent_version must keep meaning the words
   that person saw. */
export const CONSENT = Object.freeze({
  '2026-09-a': 'Start my access now. I understand that access begins straight away, so once it has started I lose my 14-day right to cancel.'
});
export const ADULT_WORDING = 'I am 18 or over.';

/* The events the webhook acts on. Anything else that arrives signed is recorded
   and acknowledged, so a dashboard that subscribes to one event too many does
   not produce three days of retries. */
export const SUBSCRIPTION_EVENTS = Object.freeze([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.upcoming'
]);
export const ACCOUNT_EVENTS = Object.freeze(['account.updated']);

/* An event whose subscription could not be saved is marked with this prefix and
   answered 500, so Stripe retries it. The retry is then treated as a first
   delivery for the emails that belong to the event itself (payment failed,
   renewal reminder) — nothing one-off happened the first time, because emails
   are only sent after the save succeeds. The emails that belong to a change of
   state need no such care: the database reports each change once. */
export const NOT_SYNCED = 'not synced: ';

/* --------------------------------------------------------------- small --- */

const hasOwn = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);

export const isUuid = (s) =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** `isStripeId('sub', 'sub_1Abc')`. Ids go into URL paths, so the shape is checked. */
export const isStripeId = (prefix, s) =>
  typeof s === 'string' && new RegExp('^' + prefix + '_[A-Za-z0-9]{1,250}$').test(s);

/** A field Stripe may send as an id or as an expanded object. */
const idOf = (v) =>
  typeof v === 'string' ? v : (v && typeof v === 'object' && typeof v.id === 'string' ? v.id : null);

/** Unix seconds -> ISO string, or null. */
export function isoFromUnix(sec) {
  return typeof sec === 'number' && Number.isFinite(sec) && sec > 0
    ? new Date(sec * 1000).toISOString() : null;
}

const toMs = (now) =>
  now instanceof Date ? now.getTime() : (typeof now === 'string' ? Date.parse(now) : Number(now));

/* ------------------------------------------------------------ signature --- */

/**
 * `t=1492774577,v1=abc…,v1=def…,v0=123…` -> { t, v1: [...] }.
 * Only `t` and `v1` are read. A second `t` makes the header malformed rather
 * than letting the later one win.
 */
export function parseStripeSignature(header) {
  const out = { t: null, v1: [] };
  if (typeof header !== 'string' || !header) return out;
  let seenT = false;
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') {
      out.t = !seenT && /^\d{1,12}$/.test(v) ? Number(v) : null;
      seenT = true;
    } else if (k === 'v1') {
      out.v1.push(v);
    }
  }
  return out;
}

function hexToBytes(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/i.test(hex)) return null;
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
}

/**
 * Checks a Stripe-Signature header against the raw body.
 * -> { ok: true, t } or { ok: false, why }.
 *
 * `rawBody` is the string from `await req.text()`. Stripe signs bytes; a valid
 * UTF-8 body decodes and re-encodes to the same bytes, and a body that is not
 * valid UTF-8 comes back changed and fails — the safe direction.
 *
 * crypto.subtle.verify does the comparison itself, in constant time, in Deno
 * and in Node alike, so there is no hand-written compare here to get wrong.
 */
export async function verifyStripeSignature(secret, rawBody, header, nowSec, tolerance = SIGNATURE_TOLERANCE) {
  if (typeof secret !== 'string' || !secret) return { ok: false, why: 'no webhook secret is configured' };
  if (typeof rawBody !== 'string') return { ok: false, why: 'there is no body' };
  const { t, v1 } = parseStripeSignature(header);
  if (t == null) return { ok: false, why: 'the header carries no usable timestamp' };
  if (!v1.length) return { ok: false, why: 'the header carries no v1 signature' };

  const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : SIGNATURE_TOLERANCE;
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > tol) return { ok: false, why: 'the timestamp is outside the tolerance' };

  const sigs = v1.map(hexToBytes).filter(Boolean);
  if (!sigs.length) return { ok: false, why: 'no v1 signature is well-formed' };

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const data = enc.encode(t + '.' + rawBody);
  for (const sig of sigs) {
    if (await crypto.subtle.verify('HMAC', key, sig, data)) return { ok: true, t };
  }
  return { ok: false, why: 'no v1 signature matches' };
}

/**
 * Tries each configured endpoint secret in turn: the platform endpoint's, then
 * the Connect endpoint's. -> { ok, via: 'platform'|'connect', t } or { ok:false, why }.
 *
 * WHY BOTH, RATHER THAN CHOOSING BY `event.account`. Choosing would mean
 * parsing the body before it is verified, and then trusting an unverified field
 * to decide how to verify it. Both secrets belong to our own endpoints, so a
 * body that verifies against either was signed by Stripe; which one it was does
 * not change what the event is allowed to do (billing/index.ts checks the
 * account against the plan's seller separately).
 */
export async function verifyWebhook(secrets, rawBody, header, nowSec) {
  let last = { ok: false, why: 'no webhook secret is configured' };
  for (const via of ['platform', 'connect']) {
    const secret = secrets && secrets[via];
    if (!secret) continue;
    const r = await verifyStripeSignature(secret, rawBody, header, nowSec);
    if (r.ok) return { ok: true, via, t: r.t };
    last = r;
  }
  return last;
}

/* ---------------------------------------------------------- form bodies --- */

/**
 * Nested values -> [key, value] pairs in Stripe's bracket notation:
 * { line_items: [{ price: 'p' }] } -> [['line_items[0][price]', 'p']].
 * null and undefined are skipped (Stripe reads an empty string as "unset",
 * which is a different instruction from "not mentioned"); so are NaN, Infinity
 * and functions, which could only ever be a bug.
 */
export function formPairs(value, prefix = '', out = []) {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => formPairs(v, prefix + '[' + i + ']', out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) formPairs(v, prefix ? prefix + '[' + k + ']' : k, out);
    return out;
  }
  if (!prefix) return out;
  if (typeof value === 'number' && !Number.isFinite(value)) return out;
  if (typeof value === 'function' || typeof value === 'symbol') return out;
  out.push([prefix, String(value)]);
  return out;
}

export function formEncode(obj) {
  return formPairs(obj)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}

/**
 * One Stripe request, described rather than sent: { url, method, headers, body }.
 * Paths are checked so an id that slipped past validation cannot become
 * `/subscriptions/../customers`.
 */
export function stripeRequest({ secretKey, method = 'GET', path, params = null, account = null, idempotencyKey = null }) {
  if (typeof path !== 'string' || !/^\/[A-Za-z0-9_\/]+$/.test(path) || path.includes('//')) {
    throw new Error('not a Stripe API path: ' + String(path));
  }
  const headers = {
    Authorization: 'Bearer ' + (secretKey || ''),
    'Stripe-Version': STRIPE_VERSION
  };
  if (account) headers['Stripe-Account'] = account;
  const encoded = params ? formEncode(params) : '';
  let url = STRIPE_API + path;
  let body;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    body = encoded;
  } else if (encoded) {
    url += '?' + encoded;
  }
  return { url, method, headers, body };
}

/* Stripe error codes that describe our keys or our accounts rather than the
   request, whatever status they arrive with. */
const PRIVATE_STRIPE_CODES = new Set([
  'api_key_expired', 'platform_api_key_expired', 'secret_key_required',
  'account_invalid', 'platform_account_required'
]);

/**
 * What a browser may be told about a Stripe refusal: { status, type, code,
 * message } in (a StripeError will do), one sentence out.
 *
 * Most of Stripe's messages are plain sentences about the request ("No such
 * price", "save your customer portal settings") and passing them on is what
 * lets a problem be reported in words. But some describe the KEY or the
 * ACCOUNT: an invalid key is quoted back masked to its last four characters,
 * and "the provided key does not have access to account acct_…" names a
 * league's account and our key's prefix. Stripe does not promise which status
 * those arrive with (401, 403, sometimes 400), so the status is not the only
 * test: the type, the code and the words themselves are looked at too. Any of
 * them, and the browser gets a sentence that says nothing; billing/index.ts
 * has already logged the detail where only the operator can read it.
 */
export function publicStripeError(err) {
  const status = Number(err?.status);
  const type = String(err?.type || '');
  const code = String(err?.code || '');
  const text = String(err?.message || '');
  const aboutUs =
    status === 401 || status === 403 ||
    type === 'authentication_error' || type === 'permission_error' ||
    PRIVATE_STRIPE_CODES.has(code) ||
    // a key prefix (built so the CI secret scan never reads it as a key), a
    // masked key, a connected account id, or words that only a key or an
    // account permission problem uses
    /\b[a-z]{2}_(?:live|test)_|\*{4,}|\bacct_[A-Za-z0-9]|api[ _-]?key|secret key|does not have access|application access|oauth/i.test(text);
  if (aboutUs) return 'payments are not set up correctly yet';
  if (!text || status === 429 || status >= 500) return 'the payment provider is not answering; try again in a minute';
  return 'the payment provider refused: ' + text;
}

/* ---------------------------------------------------------------- urls --- */

/**
 * Where to send somebody back to. The same rule signin.js applies, made
 * stricter because this one is handed to Stripe as a return address:
 *   * a path inside /epinoia/, never a scheme or another host;
 *   * no `//` anywhere and no backslash (browsers read `/\evil.com` as
 *     `//evil.com`), no whitespace or control characters (the URL parser drops
 *     tabs and newlines, which is how `/\t/evil.com` becomes `//evil.com`);
 *   * no `.` or `..` segments, encoded or not — `/epinoia/../admin.html`
 *     would resolve outside the section, and nothing legitimate needs one.
 * Anything else becomes the fallback rather than an error: a bad `next` is a
 * page's mistake, not a reason to refuse somebody's purchase.
 */
export function safeNext(next, fallback = DEFAULT_NEXT) {
  if (typeof next !== 'string' || !next || next.length > 512) return fallback;
  if (/[\x00-\x20\x7f\\]/.test(next)) return fallback;
  if (/%5c/i.test(next)) return fallback;
  if (!next.startsWith('/epinoia/')) return fallback;
  if (next.includes('//')) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(next)) return fallback;
  const path = next.split(/[?#]/)[0];
  const dotted = path.split('/').some((seg) => {
    const s = seg.replace(/%2e/gi, '.');
    return s === '.' || s === '..';
  });
  if (dotted) return fallback;
  return next;
}

/**
 * The site's origin from SITE_URL. Only the origin is used, because `notify`
 * and `ics` already read the same secret as the /epinoia/ root
 * (https://prophesyscouting.co.uk/epinoia/) — so either spelling works here,
 * and setting it for billing cannot break their links. https only (plain http
 * only for localhost), else the default.
 */
export function siteOrigin(siteUrl) {
  try {
    const u = new URL(String(siteUrl || ''));
    if (u.protocol === 'https:') return u.origin;
    if (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return u.origin;
  } catch (_) { /* fall through */ }
  return DEFAULT_SITE;
}

/** Adds or replaces one query parameter, keeping any #fragment at the end. */
export function withQuery(url, key, value) {
  const s = String(url);
  const hashAt = s.indexOf('#');
  const base = hashAt < 0 ? s : s.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : s.slice(hashAt);
  const k = encodeURIComponent(key);
  const pair = k + '=' + encodeURIComponent(value);
  const q = base.indexOf('?');
  if (q < 0) return base + '?' + pair + hash;
  const kept = base.slice(q + 1).split('&').filter((p) => p && p.split('=')[0] !== k);
  return base.slice(0, q) + '?' + [...kept, pair].join('&') + hash;
}

/** The success URL: the page they came from, told that they have just joined. */
export const withJoined = (url) => withQuery(url, 'joined', '1');

/* --------------------------------------------------------------- money --- */

const SYMBOL = { gbp: '£', eur: '€', usd: '$' };

/** 499 -> '£4.99'. Pennies in, because that is how the plan stores it. */
export function money(pennies, currency = 'gbp') {
  const n = Math.round(Number(pennies) || 0);
  const c = String(currency || 'gbp').toLowerCase();
  const abs = Math.abs(n);
  const pounds = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const amount = pounds + '.' + String(abs % 100).padStart(2, '0');
  return (n < 0 ? '-' : '') + (SYMBOL[c] ? SYMBOL[c] + amount : c.toUpperCase() + ' ' + amount);
}

/** '£4.99 a month' / '£49.00 a year' — the price per period, the way CMA209 wants it read. */
export function priceLabel(pennies, currency, interval) {
  const per = interval === 'year' ? 'a year' : interval === 'month' ? 'a month' : '';
  return money(pennies, currency) + (per ? ' ' + per : '');
}

/* ------------------------------------------------------------- checkout --- */

/** null when the two boxes were ticked against a wording we know; else the sentence to show. */
export function consentProblem(consent) {
  if (!consent || typeof consent !== 'object') {
    return 'Tick both boxes first: that your access starts straight away, and that you are 18 or over.';
  }
  if (typeof consent.version !== 'string' || !hasOwn(CONSENT, consent.version)) {
    return 'The wording you agreed to has changed. Reload the page and tick the boxes again.';
  }
  if (consent.acknowledged !== true) {
    return 'Tick the box that says your access starts straight away and that you lose the 14-day right to cancel once it has.';
  }
  if (consent.adult !== true) {
    return 'Tick the box that says you are 18 or over. A parent or guardian can buy for a junior.';
  }
  return null;
}

/** null when the plan can be bought; else { status, error }. */
export function planProblem(plan) {
  if (!plan) return { status: 404, error: 'That plan does not exist.' };
  if (plan.active === false) return { status: 409, error: 'That plan is no longer on sale.' };
  // the shape too: the id goes into a Stripe URL path next
  if (!isStripeId('price', plan.stripe_price_id)) return { status: 409, error: 'That plan cannot be bought yet.' };
  return null;
}

/* ------------------------------------------------------------ test mode --- */

/* The middle of a test key's prefix. Built rather than written out whole,
   because guard.yml fails the build on a quoted Stripe key prefix followed by
   a letter or digit, and a mode check must never look like a key. */
const TEST_KEY_MIDDLE = '_' + 'test' + '_';

/** Whether a Stripe secret (or restricted) key is a test-mode key. */
export function isTestKey(secretKey) {
  if (typeof secretKey !== 'string') return false;
  const k = secretKey.trim();
  return k.startsWith('sk' + TEST_KEY_MIDDLE) || k.startsWith('rk' + TEST_KEY_MIDDLE);
}

/** BILLING_TEST_EMAILS -> lower-cased addresses. Commas separate them; stray spaces and semicolons are forgiven. */
export function testEmails(raw) {
  if (typeof raw !== 'string') return [];
  return raw.split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'));
}

/**
 * Whether this person may check out while the key is a test key.
 * -> null, or { status: 403, error }.
 *
 * WHY TEST MODE IS NOT OPEN TO EVERYONE. The join page is public and Stripe's
 * test card number is published, so while the shop runs on a test key anybody
 * could "buy" a plan for nothing — and the membership that creates is real, in
 * the one database test and live share. Once the live webhook secret replaces
 * the test one, no event about that subscription can ever verify again, so
 * nothing would ever end it. Only the people doing the testing get through:
 * platform admins, and the addresses in the optional BILLING_TEST_EMAILS
 * secret (an ordinary account is needed to test a purchase at all, because
 * staff already hold every feature). With a live key this answers null for
 * everybody and the secret is not read.
 *
 * `isPlatformAdmin` is the database's answer, asked with the caller's own
 * token. The function only asks when this has said no without it.
 */
export function testModeProblem({ secretKey, email, testers = '', isPlatformAdmin = false } = {}) {
  if (!isTestKey(secretKey)) return null;
  if (isPlatformAdmin === true) return null;
  const me = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (me && testEmails(testers).includes(me)) return null;
  return { status: 403, error: 'Payments are in test mode, so only the people testing them can buy for now' };
}

/* ---------------------------------------------------------- the price --- */

/**
 * The request for a plan's Stripe price, on the account that price lives on:
 * Epinoia's for a platform sale, the league's (Stripe-Account) for a league
 * sale. The same account rule as checkoutParams, for the same reason.
 */
export function priceParams(plan, account = null) {
  if (!plan || !isStripeId('price', plan.stripe_price_id)) throw new Error('that plan has no Stripe price id');
  const byLeague = plan.seller === 'league';
  if (byLeague && !account) throw new Error('this league has not connected a Stripe account');
  return { method: 'GET', path: '/prices/' + plan.stripe_price_id, params: null, account: byLeague ? account : null };
}

/* How a Stripe price actually reads: '£50.00 a year', '£5.00 every 3 months'. */
function stripePriceLabel(price) {
  const amount = Number.isFinite(price?.unit_amount) ? money(price.unit_amount, price.currency) : 'a varying amount';
  const r = price?.recurring;
  if (price?.type !== 'recurring' || !r || typeof r.interval !== 'string') return amount + ' once';
  const n = Number(r.interval_count) || 1;
  return n === 1 ? amount + ' a ' + r.interval : amount + ' every ' + n + ' ' + r.interval + 's';
}

/**
 * null when the Stripe price is exactly what the plan says; else the sentence.
 *
 * WHY THIS IS CHECKED AT ALL. Everything the buyer reads comes from the plan
 * row — "Pay £4.99 a month and join", the line above Checkout's pay button,
 * the consent record, the confirmation email's promise of renewal — but what
 * Stripe charges is whatever stripe_price_id really is. A pasted id from the
 * wrong product, or a league pairing a £0.99 monthly plan with a £50 yearly
 * price, and somebody is told one price directly above a button that takes
 * another. So before any evidence is written or any customer made, the price
 * must match on every point the words promise:
 *   * recurring, every 1 month or every 1 year as the plan says — "renews
 *     every month" is untrue of a price billed every three;
 *   * the same amount in the same currency;
 *   * tax behaviour INCLUSIVE — every page says "including any VAT", and an
 *     exclusive (or unspecified) price adds VAT on top once tax collection is
 *     switched on.
 * An archived price is refused here too, in words, rather than by Stripe.
 *
 * The sentence names both prices, because the only person who can fix it is
 * whoever the buyer tells, and "£50.00 a year against £0.99 a month" is the
 * whole bug report.
 */
export function priceProblem(plan, price) {
  const stop = (why) => 'This plan cannot be bought until its price is put right: ' + why;
  if (!plan || !price || typeof price !== 'object' || !price.id || price.id !== plan.stripe_price_id) {
    return stop('Stripe has no price with the id the plan names');
  }
  if (price.active === false) return stop('its price in Stripe has been archived');
  const shown = priceLabel(plan.price_pennies, plan.currency, plan.interval);
  const r = price.recurring;
  const same =
    price.type === 'recurring' && r && typeof r === 'object' &&
    r.interval === plan.interval && r.interval_count === 1 &&
    price.unit_amount === Number(plan.price_pennies) &&
    String(price.currency || '').toLowerCase() === String(plan.currency || 'gbp').toLowerCase();
  if (!same) return stop('Stripe would charge ' + stripePriceLabel(price) + ', but it is shown here as ' + shown);
  if (price.tax_behavior !== 'inclusive') {
    return stop('its price in Stripe does not include VAT, and it is shown here as ' + shown + ' including any VAT');
  }
  return null;
}

/* The line Stripe prints above its pay button. Deliberately not "today": a
   promotion code can change what is taken now, and Checkout shows that total
   itself. What this line owns is the recurring promise and the way out. */
export function submitMessage(plan) {
  const every = plan.interval === 'year' ? 'year' : 'month';
  return priceLabel(plan.price_pennies, plan.currency, plan.interval) +
    ', including any VAT. It renews automatically every ' + every +
    ' until you cancel, and you can cancel online at any time from Your account.';
}

/**
 * The Checkout Session for one purchase.
 * -> { method, path, params, account, idempotencyKey }
 *
 * `account` comes back non-null ONLY for seller = 'league': that is a direct
 * charge on the league's connected account, so the request carries the
 * Stripe-Account header, the price and customer live on that account, and
 * Epinoia's cut rides along as subscription_data[application_fee_percent].
 * A platform sale ignores any account passed in — the money must not be sent
 * somewhere because a caller happened to have an account id to hand.
 *
 * metadata goes on the Session AND on subscription_data: the Session's copy is
 * only on the Session, and the subscription's copy is what every later
 * customer.subscription.* event and every re-fetch carries.
 */
export function checkoutParams({ plan, userId, email, customerId, account, feePercent, siteUrl, next, checkoutId, consentVersion }) {
  if (!plan || !plan.stripe_price_id) throw new Error('that plan cannot be bought yet');
  if (!userId || !checkoutId) throw new Error('a checkout needs the buyer and its checkout record');
  if (typeof consentVersion !== 'string' || !hasOwn(CONSENT, consentVersion)) {
    throw new Error('unknown consent version: ' + String(consentVersion));
  }
  const byLeague = plan.seller === 'league';
  if (byLeague && !account) throw new Error('this league has not connected a Stripe account');

  const back = siteOrigin(siteUrl) + safeNext(next);
  const metadata = {
    user_id: userId,
    plan_id: plan.id,
    league_id: plan.league_id || null,
    consent_version: consentVersion,
    checkout_id: checkoutId
  };
  const subscription_data = { metadata: { ...metadata } };
  const fee = Number(feePercent);
  if (byLeague && Number.isFinite(fee) && fee > 0) {
    subscription_data.application_fee_percent = Math.min(100, Math.round(fee * 100) / 100);
  }

  const params = {
    mode: 'subscription',
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    client_reference_id: userId,
    metadata,
    subscription_data,
    allow_promotion_codes: true,
    custom_text: { submit: { message: submitMessage(plan) } },
    success_url: withJoined(back),
    cancel_url: back
  };
  /* A known customer is passed so Checkout does not make a second one — in
     subscription mode a blank `customer` ALWAYS creates a new Customer.
     customer_email is only the fallback that pre-fills a new one. */
  if (customerId) params.customer = customerId;
  else if (email) params.customer_email = email;

  return {
    method: 'POST',
    path: '/checkout/sessions',
    params,
    account: byLeague ? account : null,
    idempotencyKey: 'checkout-' + checkoutId
  };
}

/** The Customer object made before the first checkout on an account, so it can be reused. */
export function customerParams({ userId, email, account }) {
  return {
    method: 'POST',
    path: '/customers',
    params: { email: email || null, metadata: { user_id: userId } },
    account: account || null,
    idempotencyKey: 'customer-' + userId + '-' + (account || 'platform')
  };
}

/**
 * A Customer Portal session. `cancel` deep-links straight to cancelling one
 * subscription — the online, one-step exit DMCCA 2024 s.260 will require.
 * `subscriptionId` is Stripe's sub_ id; `account` is the connected account the
 * customer lives on, when the subscription was sold by a league.
 */
export function portalParams({ customerId, siteUrl, next, subscriptionId, cancel, account = null }) {
  if (!customerId) throw new Error('there is no billing account to manage yet');
  const params = { customer: customerId, return_url: siteOrigin(siteUrl) + safeNext(next) };
  if (cancel) {
    if (!subscriptionId) throw new Error('say which subscription to cancel');
    params.flow_data = {
      type: 'subscription_cancel',
      subscription_cancel: { subscription: subscriptionId }
    };
  }
  return { method: 'POST', path: '/billing_portal/sessions', params, account: account || null };
}

/* ------------------------------------------------------------- connect --- */

/**
 * A league's own Stripe account, described by controller properties (the
 * Standard/Express/Custom names are legacy now): the league gets the FULL
 * Stripe dashboard, pays its own Stripe fees, and Stripe — not Epinoia — carries
 * negative balances. That is what makes the league the seller of its
 * memberships, with its own refunds and disputes.
 */
export function connectAccountParams({ leagueId } = {}) {
  const params = {
    controller: {
      stripe_dashboard: { type: 'full' },
      fees: { payer: 'account' },
      losses: { payments: 'stripe' }
    }
  };
  if (leagueId) params.metadata = { league_id: leagueId };
  return {
    method: 'POST',
    path: '/accounts',
    params,
    account: null,
    idempotencyKey: leagueId ? 'connect-account-' + leagueId : null
  };
}

/**
 * The onboarding link. Single-use and short-lived, which is why refresh_url
 * exists: Stripe sends the admin there when the link has gone stale, and the
 * console asks for a new one.
 */
export function accountLinkParams({ account, siteUrl, next }) {
  if (!account) throw new Error('there is no connected account to onboard');
  const back = siteOrigin(siteUrl) + safeNext(next, DEFAULT_CONNECT_NEXT);
  return {
    method: 'POST',
    path: '/account_links',
    params: {
      account,
      type: 'account_onboarding',
      refresh_url: withQuery(back, 'connect', 'refresh'),
      return_url: withQuery(back, 'connect', 'done')
    },
    account: null
  };
}

/** The three flags league_billing_accounts keeps from a Stripe Account. */
export function accountRow(acct) {
  return {
    charges_enabled: acct?.charges_enabled === true,
    payouts_enabled: acct?.payouts_enabled === true,
    details_submitted: acct?.details_submitted === true
  };
}

/* ------------------------------------------------------------- webhook --- */

/**
 * Which subscription an event is about, or null.
 *   checkout.session.*       -> session.subscription (subscription mode only)
 *   customer.subscription.*  -> the object's own id
 *   invoice.*                -> parent.subscription_details.subscription
 * The invoice's old top-level `subscription` field is NOT read: it does not
 * exist on this API version, and reading it would hide a mis-set endpoint
 * version behind a fallback instead of showing up as an unsynced event.
 */
export function subscriptionIdFromEvent(event) {
  const type = typeof event?.type === 'string' ? event.type : '';
  const o = event?.data?.object || {};
  let id = null;
  if (type.startsWith('checkout.session.')) {
    id = o.mode === 'subscription' ? idOf(o.subscription) : null;
  } else if (type.startsWith('customer.subscription.')) {
    id = idOf(o.id);
  } else if (type.startsWith('invoice.')) {
    id = idOf(o.parent?.subscription_details?.subscription);
  }
  return isStripeId('sub', id) ? id : null;
}

/**
 * A re-fetched Stripe Subscription -> p_row for billing_apply_subscription.
 *
 * Exactly the keys that RPC reads, every one of them every time. features and
 * league_id are NOT among them: the database takes both from the plan row, the
 * one authority, so nothing written into a subscription's metadata can widen
 * what it unlocks. `userId` and `planId` are the stored row's once it exists,
 * and the metadata's — already checked against the plan and the account that
 * was paid — while it is being created.
 *
 * A CANCELLATION COMES IN TWO SHAPES. Checkout makes subscriptions in flexible
 * billing mode (the default from 2025-09-30.clover on), and a Customer Portal
 * cancellation in that mode sets cancel_at to the period end and leaves
 * cancel_at_period_end FALSE. Reading only the flag, a member who had just
 * cancelled was shown "Renews on …" and offered Cancel again, while the end
 * notice went out anyway. So cancel_at_period_end is written as "a
 * cancellation is booked", whichever shape it arrived in, and cancel_at carries
 * the date when there is one.
 *
 * livemode is kept because test and live share one database, and a membership
 * bought with a test key must stay recognisable as one.
 *
 * `checkout` is the access_checkouts row, already matched to this member and
 * this plan (matchingCheckout). It supplies cooling_off_waived_at — the moment
 * the person acknowledged losing the 14-day right — which the RPC only writes
 * while nothing is stored, so a later event cannot blank or move it.
 */
export function subscriptionRow(sub, { userId, planId = null, account = null, checkout = null } = {}) {
  if (!sub || !isStripeId('sub', sub.id)) throw new Error('that is not a subscription');
  if (!isUuid(userId)) throw new Error('a subscription row needs the member it belongs to');
  const item = sub.items?.data?.[0] || null;
  const cancelAt = isoFromUnix(sub.cancel_at);
  return {
    user_id: userId,
    plan_id: isUuid(planId) ? planId : null,
    status: String(sub.status || ''),
    stripe_subscription_id: sub.id,
    stripe_customer_id: idOf(sub.customer),
    stripe_account_id: account || null,
    current_period_end: isoFromUnix(item?.current_period_end),
    cancel_at_period_end: sub.cancel_at_period_end === true || cancelAt != null,
    cancel_at: cancelAt,
    trial_end: isoFromUnix(sub.trial_end),
    ended_at: isoFromUnix(sub.ended_at),
    livemode: sub.livemode !== false,
    cooling_off_waived_at: checkout && checkout.acknowledged_at ? checkout.acknowledged_at : null
  };
}

/**
 * The access_checkouts row a subscription's metadata points at, or null unless
 * it is THIS member's, for THIS plan, on a consent wording we know.
 *
 * Metadata is whatever the account that created the subscription wrote. A
 * league with a full dashboard can create a subscription to its own plan by
 * hand, naming any user and any checkout id; the plan-and-account rule lets
 * that stand (it is the league's own plan on its own account), but the
 * evidence of somebody's consent must not be borrowed by a subscription they
 * never agreed to — neither into cooling_off_waived_at nor into a confirmation
 * email telling them what they "confirmed". Both read through here.
 */
export function matchingCheckout(checkout, { userId, planId } = {}) {
  if (!checkout || typeof checkout !== 'object') return null;
  if (!isUuid(userId) || checkout.user_id !== userId) return null;
  if (!isUuid(planId) || checkout.plan_id !== planId) return null;
  if (typeof checkout.consent_version !== 'string' || !hasOwn(CONSENT, checkout.consent_version)) return null;
  if (!checkout.acknowledged_at) return null;
  return checkout;
}

const WEEK_MS = GRACE_DAYS * 86400000;
const parsedOrNull = (iso) => {
  const ms = typeof iso === 'string' && iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The same answer as SQL access_active(status, period_end, past_due_since):
 *   active / trialing -> yes while there is no period end, or it is less than a
 *                        week gone (a subscription whose events stopped
 *                        arriving expires on its own);
 *   past_due          -> yes while past_due_since (now, when not recorded yet)
 *                        is less than a week gone;
 *   everything else (incomplete, incomplete_expired, canceled, unpaid, paused)
 *                     -> no.
 * Used for decisions the function makes itself (does this person already hold
 * the plan? is a renewal reminder due?); the database's own function stays the
 * one that grants access.
 */
export function grantsAccess(status, periodEndIso, pastDueSinceIso = null, now = Date.now()) {
  const t = toMs(now);
  if (!Number.isFinite(t)) return false;
  if (status === 'active' || status === 'trialing') {
    const end = parsedOrNull(periodEndIso);
    return end == null || end + WEEK_MS > t;
  }
  if (status === 'past_due') {
    const since = parsedOrNull(pastDueSinceIso);
    return (since == null ? t : since) + WEEK_MS > t;
  }
  return false;
}

/** The last moment a past_due member keeps access — past_due_since + a week — as ISO, or null. */
export function graceUntil(pastDueSinceIso) {
  const since = parsedOrNull(pastDueSinceIso);
  return since == null ? null : new Date(since + WEEK_MS).toISOString();
}

/**
 * How to treat an event given the billing_events row that was already there
 * (null when this delivery inserted it):
 *   'first'     — never seen, or seen and refused before anything one-off
 *                 happened (the NOT_SYNCED mark): process fully, the event's
 *                 own emails included;
 *   'duplicate' — processed already: acknowledge and do nothing;
 *   'resync'    — seen, not finished, not marked: another delivery is running
 *                 or died part-way. Re-sync state (compare-and-set, so doing it
 *                 twice is harmless) and send what the write reports as
 *                 changed, but not the event's own emails, because one may
 *                 already have gone.
 */
export function deliveryMode(existing) {
  if (!existing) return 'first';
  if (existing.processed_at) return 'duplicate';
  if (typeof existing.error === 'string' && existing.error.startsWith(NOT_SYNCED)) return 'first';
  return 'resync';
}

/**
 * Whether a verified event may create or change a membership, given where it
 * was paid. null when fine, else the reason.
 *
 * This is the rule that stops a league's own Stripe dashboard from minting
 * access it does not sell. A league with a full-dashboard account can create a
 * subscription there by hand, with any metadata it likes — and its events reach
 * our Connect endpoint correctly signed. So an event from a connected account
 * may only create a subscription to a plan that league sells on that very
 * account; and a platform plan may only be paid on the platform account.
 */
export function planAccountProblem(plan, account, leagueAccountId) {
  if (!plan) return 'the plan named in the subscription does not exist';
  if (plan.seller === 'league') {
    if (!account) return 'a plan the league sells was paid on the platform account';
    if (!leagueAccountId || leagueAccountId !== account) {
      return 'the subscription is on a Stripe account that is not the selling league\'s';
    }
    return null;
  }
  if (account) return 'a plan Epinoia sells was paid on a connected account';
  return null;
}

/**
 * The one-off emails a change of state calls for, read off
 * billing_apply_subscription's answer:
 *   { applied, first_active, ending_started, ended }
 * -> any of 'welcome', 'ending', 'ended'.
 *
 * WHY FROM THE WRITE AND NOT FROM THE EVENT. The database reports each of these
 * transitions to exactly one write: first_active stamps welcomed_at as it says
 * so, and the other two compare the stored row before and after, under the
 * compare-and-set. So a retried delivery, a delivery racing another, or the
 * checkout event arriving after the subscription event can neither lose one of
 * these emails nor send it twice — and a subscription that only becomes active
 * later (a delayed payment method) is still welcomed when it does. An answer of
 * { applied: false } means a newer fetch was already stored; that write has
 * decided, or will decide, everything, so this one decides nothing.
 *
 * `welcomed` is whether the stored row has ever been welcomed (read after the
 * write). An ending is only news to somebody who had the membership: a
 * subscription whose first payment never went through also ends, as
 * incomplete_expired, and "your membership has ended" would be about something
 * they never had. When a subscription ends in the same write that first
 * records its cancellation, the ended notice says everything, so the "will
 * end" one is not sent as well.
 */
export function transitionEmails(result, { welcomed = false } = {}) {
  if (!result || typeof result !== 'object' || result.applied !== true) return [];
  const kinds = [];
  if (result.first_active === true) kinds.push('welcome');
  if (!(welcomed === true || result.first_active === true)) return kinds;
  if (result.ended === true) kinds.push('ended');
  else if (result.ending_started === true) kinds.push('ending');
  return kinds;
}

/**
 * The one-off emails that belong to an EVENT rather than to a change of state,
 * sent on its FIRST delivery (deliveryMode):
 *   sub — the RE-FETCHED subscription (what is true now)
 * -> any of 'payment_failed', 'renewal_reminder'.
 */
export function eventEmails(event, sub, now = Date.now()) {
  const kinds = [];
  const type = event?.type;
  const o = event?.data?.object || {};
  const item = sub?.items?.data?.[0] || {};
  const live = grantsAccess(sub?.status, isoFromUnix(item.current_period_end), null, now);
  const cancelling = sub?.cancel_at_period_end === true || sub?.cancel_at != null;

  /* Once per failed renewal, not once per retry. Smart Retries raises a fresh
     invoice.payment_failed, under a fresh event id, on every attempt, and a
     member asked to update their card four times in one week has been nagged
     rather than told; attempt_count is 1 on the first. Not the first invoice
     either: a card declined inside Checkout is shown on Checkout's own page
     while the person is still looking at it. */
  if (type === 'invoice.payment_failed' && o.attempt_count === 1 && o.billing_reason !== 'subscription_create' &&
      ['active', 'trialing', 'past_due', 'unpaid'].includes(sub?.status)) kinds.push('payment_failed');

  /* The DMCCA s.258 reminder, for yearly plans: a monthly member is reminded by
     their bank statement twelve times a year. */
  if (type === 'invoice.upcoming' && live && !cancelling &&
      item.price?.recurring?.interval === 'year') kinds.push('renewal_reminder');

  return kinds;
}

/** What an email says about a subscription, from Stripe's own price where it can. */
export function emailFacts(sub, plan = null) {
  const item = sub?.items?.data?.[0] || {};
  const price = item.price || {};
  return {
    planName: plan?.name || price.nickname || 'Epinoia membership',
    pricePennies: Number.isFinite(price.unit_amount) ? price.unit_amount : (plan?.price_pennies ?? 0),
    currency: price.currency || plan?.currency || 'gbp',
    interval: price.recurring?.interval || plan?.interval || 'month',
    periodEnd: isoFromUnix(item.current_period_end),
    endsAt: isoFromUnix(sub?.ended_at) || isoFromUnix(sub?.cancel_at) || isoFromUnix(item.current_period_end)
  };
}

/* -------------------------------------------------------------- emails --- */

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** '16 September 2026', in London time, whatever the server's clock zone. */
export function longDate(iso) {
  const d = new Date(iso || '');
  if (!Number.isFinite(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB',
    { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  return get('day') + ' ' + get('month') + ' ' + get('year');
}

const oneLine = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const safeHref = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : '');

/* Blocks -> the same message as text and as HTML. Every value is escaped at
   the one place HTML is produced, so no builder can forget to. A link that is
   not a plain https URL is dropped rather than printed. */
function compose(subject, blocks) {
  const text = [];
  const html = [];
  for (const b of blocks) {
    if (b == null || b === false || b === '') continue;
    if (typeof b === 'string') {
      text.push(b);
      html.push('<p style="margin:0 0 14px">' + escapeHtml(b) + '</p>');
    } else if (b.quote) {
      text.push('    "' + b.quote + '"');
      html.push('<blockquote style="margin:0 0 14px;padding:8px 14px;border-left:3px solid #0a7a52;color:#234">' +
        escapeHtml(b.quote) + '</blockquote>');
    } else if (b.link) {
      const href = safeHref(b.link[1]);
      if (!href) continue;
      text.push(b.link[0] + ': ' + href);
      html.push('<p style="margin:0 0 14px"><a href="' + escapeHtml(href) +
        '" style="color:#0a7a52;font-weight:700;text-decoration:none">' + escapeHtml(b.link[0]) + '</a></p>');
    } else if (b.small) {
      text.push(b.small);
      html.push('<p style="margin:18px 0 0;font-size:12px;color:#889">' + escapeHtml(b.small) + '</p>');
    }
  }
  return {
    subject: '[Epinoia] ' + oneLine(subject),
    text: text.join('\n\n'),
    html: '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#123">' +
      html.join('') + '</div>'
  };
}

const planTitle = (planName, leagueName) =>
  oneLine(planName || 'Epinoia membership') + (leagueName ? ' (' + oneLine(leagueName) + ')' : '');

/**
 * The confirmation CCR 2013 reg 16 asks for, on a durable medium: what was
 * bought, the price per period, that it renews until cancelled, how to cancel
 * online, and the consent wording the person agreed to, quoted by version.
 */
export function welcomeEmail({ planName, leagueName, sellerName, pricePennies, currency, interval,
                               periodEnd, consentVersion, acknowledgedAt, manageUrl }) {
  const every = interval === 'year' ? 'year' : 'month';
  const wording = hasOwn(CONSENT, consentVersion) ? CONSENT[consentVersion] : null;
  return compose('Your ' + planTitle(planName, leagueName) + ' membership has started', [
    'Thank you for joining. This email confirms your membership, so it is worth keeping.',
    'What you bought: ' + planTitle(planName, leagueName) + '.',
    'Price: ' + priceLabel(pricePennies, currency, interval) + ', including any VAT.',
    'It renews automatically every ' + every + ' until you cancel.' +
      (periodEnd ? ' The next payment is due on ' + longDate(periodEnd) + '.' : ''),
    'You can cancel online at any time, in one step, from Your account. Cancelling stops the next ' +
      'payment, and your access carries on until the end of the period you have paid for.',
    { link: ['Your account', manageUrl] },
    'Sold by ' + oneLine(sellerName || 'Epinoia') + '.',
    wording
      ? 'Before paying' + (acknowledgedAt ? ' on ' + longDate(acknowledgedAt) : '') + ' you confirmed:'
      : null,
    wording ? { quote: wording } : null,
    wording ? { quote: ADULT_WORDING } : null,
    wording
      ? 'Your access started straight away, as you asked, so the 14-day right to cancel ended when it started.'
      : null,
    { small: 'Consent wording ' + oneLine(consentVersion || 'not recorded') + '.' }
  ]);
}

/**
 * The end-of-contract notice (DMCCA 2024 s.261 — within 24 hours, not yet in
 * force and cheap to send now). `ended` false: a cancellation is booked and
 * access runs to `endsAt`. `ended` true: it has stopped.
 */
export function endNoticeEmail({ planName, leagueName, endsAt, ended, manageUrl }) {
  const title = planTitle(planName, leagueName);
  const when = longDate(endsAt);
  if (ended) {
    return compose('Your ' + title + ' membership has ended', [
      'Your ' + title + ' membership has ended' + (when ? ' (' + when + ')' : '') +
        '. You will not be charged for it again.',
      'You can join again at any time.',
      { link: ['Your account', manageUrl] }
    ]);
  }
  return compose('Your ' + title + ' membership will end' + (when ? ' on ' + when : ''), [
    'Your cancellation is booked. You will not be charged for ' + title + ' again.',
    when
      ? 'Your access carries on until ' + when + ', and then it stops.'
      : 'Your access carries on until the end of the period you have paid for, and then it stops.',
    'Changed your mind? You can keep it going from Your account before then.',
    { link: ['Your account', manageUrl] }
  ]);
}

/** invoice.payment_failed: update the card. */
export function paymentFailedEmail({ planName, leagueName, amountPennies, currency, manageUrl, invoiceUrl, graceUntil: until }) {
  const title = planTitle(planName, leagueName);
  return compose('Your ' + title + ' payment did not go through', [
    'We could not take ' + money(amountPennies, currency) + ' for ' + title + '.',
    'The card may have expired or been replaced. Update it and the payment is tried again.',
    until ? 'Your access carries on until ' + longDate(until) + ' while it is retried.' : null,
    { link: ['Update your card', manageUrl] },
    { link: ['Or pay this invoice with another card', invoiceUrl] }
  ]);
}

/** invoice.upcoming on a yearly plan: the renewal reminder (DMCCA 2024 s.258). */
export function renewalReminderEmail({ planName, leagueName, amountPennies, currency, renewsAt, manageUrl }) {
  const title = planTitle(planName, leagueName);
  const when = longDate(renewsAt);
  return compose('Your ' + title + ' membership renews' + (when ? ' on ' + when : ' soon'), [
    'Your yearly ' + title + ' membership renews' + (when ? ' on ' + when : ' soon') + ', and ' +
      money(amountPennies, currency) + ' will be taken from your card then.',
    'If you do not want it to renew, cancel before' + (when ? ' ' + when : ' then') +
      ' from Your account. It takes one step, and your access carries on until that date.',
    'If you want to keep it, there is nothing to do.',
    { link: ['Your account', manageUrl] }
  ]);
}
