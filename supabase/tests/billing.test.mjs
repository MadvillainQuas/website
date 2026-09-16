/* ============================================================================
   BILLING — the part of memberships that takes money.

   Everything here fails QUIETLY, and most of it fails in somebody else's
   favour, which is why it is asserted rather than trusted:

     * a signature check that accepts a changed body, an old timestamp or a v0
       "signature" turns the webhook into a public "grant me access" button
     * a form body with a bracket in the wrong place is accepted by Stripe and
       ignored — the metadata that ties a subscription to a person simply is
       not there, and the member pays for nothing
     * a league sale that forgets the Stripe-Account header charges on
       Epinoia's account; a platform sale that adds one sends Epinoia's money
       to a league
     * the billing period read off the subscription instead of its item is
       undefined on this API version, so every member's renewal date is blank
     * a past_due grace that disagrees with SQL access_active() by a day
     * a `next` that leaves the site makes Stripe's return page a phishing hop
     * a confirmation email that does not repeat the consent wording is not the
       confirmation the Consumer Contracts Regulations ask for; one that does
       not escape a plan name is an HTML injection into somebody's inbox; one
       that quotes a consent nobody recorded tells a person they agreed to
       words they never saw
     * a cancellation made in flexible billing mode arrives as cancel_at with
       cancel_at_period_end still false — read only the flag and a member who
       has cancelled is told "Renews on …"
     * a plan row that says £0.99 a month in front of a Stripe price of £50 a
       year is a button that takes more than it says
     * a test key behind a public join page is free, permanent membership for
       anybody who knows Stripe's test card
     * an older fetch written after a newer one, or an email decided by which
       delivery of an event this is, loses or doubles the emails the law asks for
     * a Stripe error quoting a masked key or a connected account id, passed
       straight to a browser

   Run: node supabase/tests/billing.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  STRIPE_VERSION, CONSENT, ADULT_WORDING, NOT_SYNCED, SUBSCRIPTION_EVENTS, GRACE_DAYS,
  parseStripeSignature, verifyStripeSignature, verifyWebhook,
  formPairs, formEncode, stripeRequest, publicStripeError,
  safeNext, siteOrigin, withQuery, withJoined,
  money, priceLabel, consentProblem, planProblem,
  isTestKey, testEmails, testModeProblem, priceParams, priceProblem,
  checkoutParams, customerParams, portalParams, connectAccountParams, accountLinkParams, accountRow,
  subscriptionIdFromEvent, subscriptionRow, matchingCheckout, grantsAccess, graceUntil,
  deliveryMode, planAccountProblem, transitionEmails, eventEmails, emailFacts,
  escapeHtml, longDate, welcomeEmail, endNoticeEmail, paymentFailedEmail, renewalReminderEmail
} from '../functions/_shared/billing.js';

let pass = 0, fail = 0;
const eq = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; return; }
  fail++; console.error(`  FAIL ${what}\n       got  ${a}\n       want ${b}`);
};
const ok = (cond, what) => { if (cond) pass++; else { fail++; console.error(`  FAIL ${what}`); } };
const throws = (fn, what) => { try { fn(); fail++; console.error(`  FAIL ${what} (did not throw)`); } catch (_) { pass++; } };

/* Test secrets are assembled from pieces so the CI scan for committed Stripe
   secrets (guard.yml) never sees one written out whole. */
const SECRET = ['wh', 'sec', '_', 'unitTestOnly', 'NotARealEndpointSecret0'].join('');
const OLD_SECRET = ['wh', 'sec', '_', 'unitTestOnly', 'TheSecretBeingRolledOut'].join('');
const CONNECT_SECRET = ['wh', 'sec', '_', 'unitTestOnly', 'ConnectEndpointSecret'].join('');
/* Stripe API keys the same way — the scan refuses a quoted key prefix followed
   by a letter or digit, and a test must not need an exemption. */
const TEST_KEY = ['sk', 'test', 'unitTestOnlyNotAKey'].join('_');
const RESTRICTED_TEST_KEY = ['rk', 'test', 'unitTestOnlyNotAKey'].join('_');
const LIVE_KEY = ['sk', 'live', 'unitTestOnlyNotAKey'].join('_');

const USER = '11111111-2222-4333-8444-555555555555';
const OTHER_USER = '22222222-3333-4444-8555-666666666666';
const PLAN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_PLAN = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const LEAGUE = '99999999-8888-4777-8666-555555555555';
const CHECKOUT = 'cccccccc-1111-4222-8333-444444444444';
const SITE = 'https://prophesyscouting.co.uk/epinoia/';   // the spelling notify and ics already use

/* Stripe's scheme, done independently of the code under test: HMAC-SHA256 of
   "<t>.<body>" with the endpoint secret as the key, lower-case hex. */
async function stripeSign(secret, t, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(t + '.' + body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------ signature --- */
console.log('signature');
{
  const body = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: { amount_paid: 499, note: 'Zoë £4.99' } } });
  const t = 1_790_000_000;
  const sig = await stripeSign(SECRET, t, body);

  eq(parseStripeSignature(`t=${t},v1=${sig},v0=abc`), { t, v1: [sig] }, 'the header parses t and v1 and nothing else');
  eq(parseStripeSignature(''), { t: null, v1: [] }, 'an empty header parses to nothing');
  eq(parseStripeSignature(`t=1,t=2,v1=${sig}`).t, null, 'two timestamps make the header malformed');

  const good = await verifyStripeSignature(SECRET, body, `t=${t},v1=${sig}`, t + 5);
  ok(good.ok === true && good.t === t, 'a good signature verifies — including a body with non-ASCII bytes');

  const changed = await verifyStripeSignature(SECRET, body.replace('499', '0'), `t=${t},v1=${sig}`, t);
  ok(!changed.ok, 'a changed body does not verify');

  const moved = await verifyStripeSignature(SECRET, body, `t=${t + 1},v1=${sig}`, t);
  ok(!moved.ok, 'the timestamp is part of what was signed — changing it breaks the signature');

  ok((await verifyStripeSignature(SECRET, body, `t=${t},v1=${sig}`, t + 300)).ok,
     'exactly five minutes old is still inside the tolerance');
  const stale = await verifyStripeSignature(SECRET, body, `t=${t},v1=${sig}`, t + 301);
  ok(!stale.ok && /tolerance/.test(stale.why), 'five minutes and a second old is a replay, refused');
  ok(!(await verifyStripeSignature(SECRET, body, `t=${t},v1=${sig}`, t - 301)).ok,
     'a timestamp from the future is refused the same way');
  ok(!(await verifyStripeSignature(SECRET, body, `t=${t},v1=${sig}`, t + 3600, 0)).ok,
     'a tolerance of zero does not switch the check off');

  const oldSig = await stripeSign(OLD_SECRET, t, body);
  ok((await verifyStripeSignature(SECRET, body, `t=${t},v1=${oldSig},v1=${sig}`, t)).ok,
     'during a secret roll either v1 may be the one that matches (new one second)');
  ok((await verifyStripeSignature(SECRET, body, `t=${t},v1=${sig},v1=${oldSig}`, t)).ok,
     '...or first');
  ok(!(await verifyStripeSignature(SECRET, body, `t=${t},v1=${oldSig}`, t)).ok,
     'a signature from a different secret alone does not verify');

  const v0 = await verifyStripeSignature(SECRET, body, `t=${t},v0=${sig}`, t);
  ok(!v0.ok && /v1/.test(v0.why), 'a correct signature offered only as v0 is refused — v0 is never read');

  for (const [header, what] of [
    ['', 'an empty header'],
    ['nonsense', 'a header with no pairs'],
    [`v1=${sig}`, 'a v1 with no timestamp'],
    [`t=abc,v1=${sig}`, 'a timestamp that is not a number'],
    [`t=${t}`, 'a timestamp with no signature'],
    [`t=${t},v1=${sig.slice(0, 63)}`, 'a signature one hex digit short'],
    [`t=${t},v1=${sig.slice(0, 62)}zz`, 'a signature that is not hex'],
    [`t=${t},v1=${sig}00`, 'a signature too long']
  ]) {
    ok(!(await verifyStripeSignature(SECRET, body, header, t)).ok, 'malformed: ' + what + ' is refused');
  }
  ok(!(await verifyStripeSignature('', body, `t=${t},v1=${sig}`, t)).ok, 'no secret configured verifies nothing');
  ok(!(await verifyStripeSignature(SECRET, undefined, `t=${t},v1=${sig}`, t)).ok, 'no body verifies nothing');

  const connectSig = await stripeSign(CONNECT_SECRET, t, body);
  const both = { platform: SECRET, connect: CONNECT_SECRET };
  eq((await verifyWebhook(both, body, `t=${t},v1=${sig}`, t)).via, 'platform', 'the platform endpoint\'s event verifies as platform');
  eq((await verifyWebhook(both, body, `t=${t},v1=${connectSig}`, t)).via, 'connect', 'the Connect endpoint\'s event verifies as connect');
  ok(!(await verifyWebhook({ platform: SECRET }, body, `t=${t},v1=${connectSig}`, t)).ok,
     'a Connect-signed event does not verify when only the platform secret is set');
  ok(!(await verifyWebhook({}, body, `t=${t},v1=${sig}`, t)).ok, 'with no secrets nothing verifies');
}

/* ---------------------------------------------------------- form bodies --- */
console.log('form encoding');
{
  eq(formPairs({
    mode: 'subscription',
    line_items: [{ price: 'price_1', quantity: 1 }],
    metadata: { user_id: 'u', league_id: null, gone: undefined },
    allow_promotion_codes: true,
    discounts: [],
    note: '',
    bad: NaN
  }), [
    ['mode', 'subscription'],
    ['line_items[0][price]', 'price_1'],
    ['line_items[0][quantity]', '1'],
    ['metadata[user_id]', 'u'],
    ['allow_promotion_codes', 'true'],
    ['note', '']
  ], 'nesting, arrays, booleans; null, undefined, empty arrays and NaN are skipped; an empty string is kept');

  eq(formPairs({ a: { b: { c: [false, 2] } } }), [['a[b][c][0]', 'false'], ['a[b][c][1]', '2']], 'deep nesting');
  const enc = formEncode({ custom_text: { submit: { message: '£4.99 a month & more = yes' } } });
  eq(enc, 'custom_text%5Bsubmit%5D%5Bmessage%5D=%C2%A34.99%20a%20month%20%26%20more%20%3D%20yes',
     'keys and values are percent-encoded, so an & or = in a sentence cannot start a new field');
  eq(decodeURIComponent(enc), 'custom_text[submit][message]=£4.99 a month & more = yes', '...and decode back');
  eq(formEncode(null), '', 'nothing encodes to nothing');

  const post = stripeRequest({ secretKey: 'k', method: 'POST', path: '/checkout/sessions',
    params: { mode: 'subscription' }, account: 'acct_1', idempotencyKey: 'checkout-x' });
  eq(post.url, 'https://api.stripe.com/v1/checkout/sessions', 'the Stripe URL');
  eq(post.headers['Stripe-Version'], '2026-08-26.dahlia', 'every request is pinned to dahlia');
  eq(STRIPE_VERSION, '2026-08-26.dahlia', 'and the pin is the version the code was written against');
  eq(post.headers['Stripe-Account'], 'acct_1', 'a connected account travels as the Stripe-Account header');
  eq(post.headers['Idempotency-Key'], 'checkout-x', 'a POST carries its idempotency key');
  eq(post.headers['Content-Type'], 'application/x-www-form-urlencoded', 'form-encoded, as Stripe wants');
  eq(post.body, 'mode=subscription', 'the body is the form encoding');
  const get = stripeRequest({ secretKey: 'k', method: 'GET', path: '/subscriptions/sub_1', idempotencyKey: 'x' });
  ok(!('Stripe-Account' in get.headers), 'no account, no Stripe-Account header');
  ok(!('Idempotency-Key' in get.headers) && get.body === undefined, 'a GET has no idempotency key and no body');
  throws(() => stripeRequest({ secretKey: 'k', path: '/subscriptions/../customers' }), 'a path with dots is refused');
  throws(() => stripeRequest({ secretKey: 'k', path: '/subscriptions/sub_1?expand=x' }), 'a path with a query is refused');
  throws(() => stripeRequest({ secretKey: 'k', path: '//evil' }), 'a path starting // is refused');
}

/* ------------------------------------------------ what a browser is told --- */
console.log('Stripe refusals, as a browser sees them');
{
  const GENERIC = 'payments are not set up correctly yet';
  const masked = ['sk', 'live', ''].join('_') + '************************abcd';
  const maskedRestricted = ['rk', 'live', ''].join('_') + '*********wxyz';
  for (const [err, what] of [
    [{ status: 401, type: 'invalid_request_error', message: 'Invalid API Key provided: ' + masked }, 'an invalid key, quoted back masked'],
    [{ status: 400, type: 'invalid_request_error',
       message: "The provided key '" + maskedRestricted + "' does not have access to account 'acct_1LeagueAbc' (or that account does not exist). Application access may have been revoked." },
     'a key without access to a connected account, arriving as a 400 rather than a 403'],
    [{ status: 403, message: 'This action is not allowed.' }, 'any 403, however bland its words'],
    [{ status: 401, message: 'Unauthorized.' }, 'any 401, however bland its words'],
    [{ status: 400, type: 'permission_error', message: 'Not allowed.' }, 'a permission error at any status'],
    [{ status: 400, code: 'api_key_expired', message: 'Expired.' }, 'an expired key, by its code'],
    [{ status: 400, code: 'account_invalid', message: 'Invalid account.' }, 'an invalid account, by its code'],
    [{ status: 400, type: 'invalid_request_error', message: 'Cannot create a session on acct_9Other' }, 'any message naming a connected account'],
    [{ status: 400, type: 'invalid_request_error', message: 'A secret key is required here' }, 'any message about a secret key']
  ]) {
    const out = publicStripeError(err);
    eq(out, GENERIC, 'generic: ' + what);
    ok(!/abcd|wxyz|acct_/.test(out), '...and nothing of the key or the account survives: ' + what);
  }
  eq(publicStripeError({ status: 400, type: 'invalid_request_error', message: "No such price: 'price_1Abc'" }),
     "the payment provider refused: No such price: 'price_1Abc'", 'a plain refusal about the request is passed on in Stripe\'s words');
  ok(/save your customer portal settings/.test(publicStripeError({ status: 400, type: 'invalid_request_error',
     message: "You can't create a portal session in test mode until you save your customer portal settings in test mode at https://dashboard.stripe.com/test/settings/billing/portal." })),
     'the unsaved-portal message still reaches the page — switch-on §6.4 tells the operator to look for it');
  for (const [err, what] of [
    [{ status: 500, message: 'An unknown error occurred' }, 'a Stripe outage'],
    [{ status: 429, message: 'Too many requests' }, 'rate limiting'],
    [{}, 'nothing at all']
  ]) ok(/not answering/.test(publicStripeError(err)), 'not answering: ' + what);
}

/* ---------------------------------------------------------------- urls --- */
console.log('where people are sent back to');
{
  const D = '/epinoia/me/';
  eq(safeNext('/epinoia/join/?l=bbl'), '/epinoia/join/?l=bbl', 'a join page with its league is kept');
  eq(safeNext('/epinoia/me/#membership'), '/epinoia/me/#membership', 'a fragment is kept');
  eq(safeNext('/epinoia/join/?l=bbl&next=%2Fepinoia%2Fgame%2F'), '/epinoia/join/?l=bbl&next=%2Fepinoia%2Fgame%2F',
     'an encoded path in the query is fine');
  for (const [bad, what] of [
    ['//evil.com', 'a protocol-relative URL'],
    ['https://evil.com/epinoia/', 'an absolute URL'],
    ['/\\evil.com', 'a backslash, which browsers read as a slash'],
    ['/epinoia/\\evil.com', 'a backslash later on'],
    ['/epinoia/%5Cevil.com', 'an encoded backslash'],
    ['/epinoia//evil.com', 'a double slash inside the path'],
    ['/epinoia/join/?next=https://evil.com', 'a URL tucked into the query'],
    ['/epinoia/../admin.html', 'a .. segment — resolves outside /epinoia/, so refused'],
    ['/epinoia/%2e%2e/admin.html', 'an encoded .. segment'],
    ['/epinoia/./me/', 'a . segment'],
    ['/\t/evil.com', 'a tab, which the URL parser deletes'],
    ['/epinoia/me/\n', 'a newline'],
    [' /epinoia/me/', 'leading whitespace'],
    ['javascript:alert(1)', 'a script URL'],
    ['/epinoiax/', 'a look-alike prefix'],
    ['/epinoia', 'the section without its slash'],
    ['/admin.html', 'a same-site page outside the section'],
    ['', 'nothing'],
    [null, 'null'],
    [42, 'a number'],
    ['/epinoia/' + 'a'.repeat(600), 'something absurdly long']
  ]) eq(safeNext(bad), D, 'refused: ' + what);
  eq(safeNext('/epinoia/..hidden/'), '/epinoia/..hidden/', 'dots inside a segment name are not a dot segment');
  eq(safeNext('nope', '/epinoia/admin/'), '/epinoia/admin/', 'the fallback can be chosen per call');

  eq(siteOrigin(SITE), 'https://prophesyscouting.co.uk', 'SITE_URL spelled with /epinoia/ gives the origin');
  eq(siteOrigin('https://prophesyscouting.co.uk'), 'https://prophesyscouting.co.uk', 'and spelled bare, the same');
  eq(siteOrigin(''), 'https://prophesyscouting.co.uk', 'unset falls back to the site');
  eq(siteOrigin('http://evil.example'), 'https://prophesyscouting.co.uk', 'plain http is not a return address');
  eq(siteOrigin('http://localhost:8000/'), 'http://localhost:8000', 'except on localhost');
  eq(siteOrigin('javascript:alert(1)'), 'https://prophesyscouting.co.uk', 'nor is a script URL');

  eq(withJoined('https://x.test/epinoia/join/'), 'https://x.test/epinoia/join/?joined=1', 'joined on a bare path');
  eq(withJoined('https://x.test/epinoia/join/?l=bbl'), 'https://x.test/epinoia/join/?l=bbl&joined=1', 'joined after a query');
  eq(withJoined('https://x.test/epinoia/join/?l=bbl#plans'), 'https://x.test/epinoia/join/?l=bbl&joined=1#plans',
     'joined goes before the fragment, where a browser will send it');
  eq(withJoined('https://x.test/j/?joined=1&l=bbl'), 'https://x.test/j/?l=bbl&joined=1', 'joined is never doubled');
  eq(withQuery('/a/?connect=refresh', 'connect', 'done'), '/a/?connect=done', 'a parameter is replaced, not repeated');
}

/* --------------------------------------------------------------- money --- */
console.log('prices');
{
  eq(money(499), '£4.99', 'pennies to pounds');
  eq(money(4900), '£49.00', 'whole pounds keep their pence');
  eq(money(5), '£0.05', 'under a pound');
  eq(money(123456), '£1,234.56', 'thousands are grouped');
  eq(money(0), '£0.00', 'free is £0.00');
  eq(money(null), '£0.00', 'and nothing is not NaN');
  eq(money(499, 'eur'), '€4.99', 'euros');
  eq(money(499, 'SEK'), 'SEK 4.99', 'a currency without a symbol here is named');
  eq(priceLabel(499, 'gbp', 'month'), '£4.99 a month', 'monthly, as the order button says it');
  eq(priceLabel(4900, 'gbp', 'year'), '£49.00 a year', 'yearly');
}

/* ------------------------------------------------------------- checkout --- */
console.log('checkout');
{
  const V = '2026-09-a';
  eq(Object.keys(CONSENT), [V], 'the consent wording is versioned, and this is the version the join page shows');
  eq(CONSENT[V], 'Start my access now. I understand that access begins straight away, so once it has started I lose my 14-day right to cancel.',
     'the wording is exactly the contract\'s');
  eq(consentProblem({ version: V, acknowledged: true, adult: true }), null, 'both boxes ticked on a known wording is enough');
  ok(consentProblem(null), 'no consent at all is refused');
  ok(consentProblem({ version: V, acknowledged: false, adult: true }), 'without the 14-day acknowledgement, refused');
  ok(consentProblem({ version: V, acknowledged: true }), 'without the age confirmation, refused');
  ok(consentProblem({ version: V, acknowledged: 'true', adult: 'yes' }), 'truthy is not true: a string does not tick a box');
  ok(consentProblem({ version: '2020-01-z', acknowledged: true, adult: true }), 'an unknown wording is refused');
  ok(consentProblem({ version: '__proto__', acknowledged: true, adult: true }), 'and so is an inherited property name');
  ok(consentProblem({ version: 'toString', acknowledged: true, adult: true }), '...of any kind');

  eq(planProblem(null)?.status, 404, 'a missing plan is a 404');
  eq(planProblem({ active: false, stripe_price_id: 'price_1' })?.status, 409, 'an archived plan is not on sale');
  eq(planProblem({ active: true, stripe_price_id: null })?.status, 409, 'a plan with no price cannot be bought');
  eq(planProblem({ active: true, stripe_price_id: 'price_1' }), null, 'an active priced plan can');
  eq(planProblem({ active: true, stripe_price_id: 'price_1/../x' })?.status, 409,
     'a price id that could not be one never reaches a Stripe URL');

  const platformPlan = { id: PLAN_ID, league_id: null, name: 'Analytics', features: ['analytics'],
    price_pennies: 499, currency: 'gbp', interval: 'month', stripe_price_id: 'price_platform', seller: 'platform', active: true };
  const base = { userId: USER, email: 'fan@example.com', customerId: 'cus_P1', siteUrl: SITE,
    next: '/epinoia/join/?l=bbl', checkoutId: CHECKOUT, consentVersion: V };

  const p = checkoutParams({ ...base, plan: platformPlan, account: 'acct_League1', feePercent: 10 });
  eq(p.path, '/checkout/sessions', 'a Checkout Session');
  eq(p.account, null, 'a platform sale is charged on Epinoia\'s account even if an account id was passed');
  eq(p.idempotencyKey, 'checkout-' + CHECKOUT, 'one idempotency key per checkout record');
  eq(p.params.mode, 'subscription', 'subscription mode');
  eq(p.params.line_items, [{ price: 'price_platform', quantity: 1 }], 'the plan\'s price, once');
  eq(p.params.client_reference_id, USER, 'the buyer is the client reference');
  eq(p.params.customer, 'cus_P1', 'the stored customer is reused');
  ok(!('customer_email' in p.params), '...so no email is sent to make another');
  eq(p.params.metadata, { user_id: USER, plan_id: PLAN_ID, league_id: null, consent_version: V, checkout_id: CHECKOUT },
     'the session metadata');
  eq(p.params.subscription_data.metadata, p.params.metadata, 'the SAME metadata on the subscription, where later events can see it');
  ok(!('application_fee_percent' in p.params.subscription_data), 'no application fee on a platform sale');
  eq(p.params.allow_promotion_codes, true, 'promotion codes allowed');
  ok(!('ui_mode' in p.params), 'ui_mode left unset — dahlia renamed its values; unset is the hosted page');
  eq(p.params.success_url, 'https://prophesyscouting.co.uk/epinoia/join/?l=bbl&joined=1', 'success returns to the page, joined');
  eq(p.params.cancel_url, 'https://prophesyscouting.co.uk/epinoia/join/?l=bbl', 'cancel returns to the page as it was');
  ok(/£4\.99 a month/.test(p.params.custom_text.submit.message), 'the text above the pay button states the price per period');
  ok(/renews automatically every month until you cancel/.test(p.params.custom_text.submit.message), '...that it renews until cancelled');
  ok(/cancel online/.test(p.params.custom_text.submit.message), '...and how to cancel');
  const pairs = formPairs(p.params).map(([k]) => k);
  ok(pairs.includes('subscription_data[metadata][user_id]') && pairs.includes('metadata[checkout_id]'),
     'encoded, both metadata copies are really there');
  ok(!pairs.includes('metadata[league_id]'), 'a null league id is left out, not sent as an empty string (which Stripe reads as unset)');

  const leaguePlan = { ...platformPlan, id: PLAN_ID, league_id: LEAGUE, features: ['league', 'analytics'],
    price_pennies: 4900, interval: 'year', stripe_price_id: 'price_onLeagueAccount', seller: 'league' };
  const l = checkoutParams({ ...base, plan: leaguePlan, account: 'acct_League1', feePercent: 10 });
  eq(l.account, 'acct_League1', 'a league sale is a direct charge: the account comes back for the Stripe-Account header');
  eq(l.params.subscription_data.application_fee_percent, 10, 'and Epinoia\'s fee rides on the subscription');
  eq(l.params.metadata.league_id, LEAGUE, 'the league is in the metadata');
  ok(/£49\.00 a year/.test(l.params.custom_text.submit.message) && /every year/.test(l.params.custom_text.submit.message),
     'a yearly plan says a year');
  eq(checkoutParams({ ...base, plan: leaguePlan, account: 'acct_League1', feePercent: 7.456 })
       .params.subscription_data.application_fee_percent, 7.46, 'a fee is sent to two decimal places');
  ok(!('application_fee_percent' in checkoutParams({ ...base, plan: leaguePlan, account: 'acct_League1', feePercent: 0 })
       .params.subscription_data), 'a zero fee is not sent at all');
  throws(() => checkoutParams({ ...base, plan: leaguePlan, account: null, feePercent: 10 }),
    'a league sale with no connected account is refused before Stripe is called');

  const epinoiaSellsLeague = { ...leaguePlan, seller: 'platform', stripe_price_id: 'price_platformLeague' };
  const e = checkoutParams({ ...base, plan: epinoiaSellsLeague, account: 'acct_League1', feePercent: 10 });
  eq(e.account, null, 'a league plan Epinoia sells is charged on Epinoia\'s account');
  ok(!('application_fee_percent' in e.params.subscription_data), '...with no application fee');
  eq(e.params.metadata.league_id, LEAGUE, '...and still names its league');

  const noCustomer = checkoutParams({ ...base, plan: platformPlan, customerId: null });
  eq(noCustomer.params.customer_email, 'fan@example.com', 'without a customer, the email pre-fills a new one');
  eq(checkoutParams({ ...base, plan: platformPlan, next: '//evil.com' }).params.cancel_url,
     'https://prophesyscouting.co.uk/epinoia/me/', 'a bad next becomes Your account, not a refusal');
  throws(() => checkoutParams({ ...base, plan: platformPlan, consentVersion: 'made-up' }), 'an unknown consent version cannot reach Stripe');
  throws(() => checkoutParams({ ...base, plan: { ...platformPlan, stripe_price_id: null } }), 'nor can a plan with no price');

  const c = customerParams({ userId: USER, email: 'fan@example.com', account: 'acct_League1' });
  eq([c.path, c.account, c.idempotencyKey, c.params.metadata.user_id],
     ['/customers', 'acct_League1', 'customer-' + USER + '-acct_League1', USER], 'a customer is made on the right account, once');
  eq(customerParams({ userId: USER, email: 'x@example.com' }).idempotencyKey, 'customer-' + USER + '-platform',
     'the platform customer has its own key');

  console.log('test mode');
  ok(isTestKey(TEST_KEY) && isTestKey(RESTRICTED_TEST_KEY), 'a test secret key and a test restricted key are test mode');
  ok(isTestKey(' ' + TEST_KEY + '\n'), '...even with the whitespace a pasted secret picks up');
  ok(!isTestKey(LIVE_KEY), 'a live key is not');
  ok(!isTestKey('') && !isTestKey(null) && !isTestKey(undefined) && !isTestKey(42), 'nothing is not');
  ok(!isTestKey('x' + TEST_KEY) && !isTestKey(TEST_KEY.slice(2)), 'only a key that STARTS with the test prefix');

  eq(testEmails(' Louie@Example.com, tester@example.com ;; , nonsense '), ['louie@example.com', 'tester@example.com'],
     'BILLING_TEST_EMAILS: comma-separated, lower-cased, stray spaces, semicolons and non-addresses forgiven');
  eq(testEmails(undefined), [], 'an unset secret is an empty list');

  eq(testModeProblem({ secretKey: LIVE_KEY, email: 'stranger@example.com' }), null, 'with a live key everybody can buy');
  const closed = testModeProblem({ secretKey: TEST_KEY, email: 'stranger@example.com', testers: 'tester@example.com' });
  eq(closed?.status, 403, 'with a test key a stranger is refused');
  ok(/^Payments are in test mode/.test(closed?.error || ''), '...in words the join page can show');
  eq(testModeProblem({ secretKey: TEST_KEY, email: 'Tester@Example.com', testers: 'louie@example.com, tester@example.com' }), null,
     'a listed tester is let through, whatever the case of the address');
  eq(testModeProblem({ secretKey: TEST_KEY, email: 'anyone@example.com', isPlatformAdmin: true }), null, 'so is a platform admin');
  eq(testModeProblem({ secretKey: TEST_KEY, email: 'anyone@example.com', isPlatformAdmin: 'true' })?.status, 403,
     'truthy is not true: only the database\'s own true lets an admin through');
  eq(testModeProblem({ secretKey: TEST_KEY, email: 'tester@example.com.evil.test', testers: 'tester@example.com' })?.status, 403,
     'whole addresses only, never a prefix');
  eq(testModeProblem({ secretKey: TEST_KEY, email: '', testers: '' })?.status, 403, 'no address and no list: refused');
  eq(testModeProblem({ secretKey: RESTRICTED_TEST_KEY, email: 'stranger@example.com' })?.status, 403, 'a restricted test key is test mode too');

  console.log('the price Stripe will charge');
  const stripePrice = { id: 'price_platform', object: 'price', active: true, type: 'recurring', currency: 'gbp',
    unit_amount: 499, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, tax_behavior: 'inclusive' };
  eq(priceProblem(platformPlan, stripePrice), null, 'the same amount, currency, interval and inclusive tax: on sale');
  eq(priceProblem(platformPlan, { ...stripePrice, currency: 'GBP' }), null, 'currency case does not matter');
  eq(priceProblem({ ...platformPlan, price_pennies: '499' }, stripePrice), null, 'nor a price_pennies that arrives as text');
  const STOP = /^This plan cannot be bought until its price is put right: /;
  for (const [price, plan, what, words] of [
    [{ ...stripePrice, unit_amount: 5000, recurring: { interval: 'year', interval_count: 1 } }, platformPlan,
     'a monthly plan in front of a £50-a-year price',/Stripe would charge £50\.00 a year, but it is shown here as £4\.99 a month/],
    [{ ...stripePrice, unit_amount: 999 }, platformPlan, 'a different amount', /£9\.99 a month.*£4\.99 a month/],
    [{ ...stripePrice, recurring: { interval: 'year', interval_count: 1 } }, platformPlan, 'yearly against monthly', /£4\.99 a year/],
    [{ ...stripePrice, recurring: { interval: 'month', interval_count: 3 } }, platformPlan, 'every three months against every month', /every 3 months/],
    [{ ...stripePrice, currency: 'eur' }, platformPlan, 'another currency', /€4\.99 a month/],
    [{ ...stripePrice, type: 'one_time', recurring: null }, platformPlan, 'a one-off price', /£4\.99 once/],
    [{ ...stripePrice, unit_amount: null }, platformPlan, 'a tiered or pay-what-you-want price', /a varying amount/],
    [{ ...stripePrice, tax_behavior: 'exclusive' }, platformPlan, 'VAT added on top', /does not include VAT.*including any VAT/],
    [{ ...stripePrice, tax_behavior: 'unspecified' }, platformPlan, 'tax behaviour never chosen', /does not include VAT/],
    [(({ tax_behavior, ...rest }) => rest)(stripePrice), platformPlan, 'no tax behaviour at all', /does not include VAT/],
    [{ ...stripePrice, active: false }, platformPlan, 'an archived price', /archived/],
    [{ ...stripePrice, id: 'price_other' }, platformPlan, 'a different price than the plan names', /no price with the id/],
    [null, platformPlan, 'a price this key cannot find', /no price with the id/]
  ]) {
    const why = priceProblem(plan, price);
    ok(STOP.test(why || ''), 'refused: ' + what);
    ok(words.test(why || ''), '...and the sentence says what differs: ' + what);
  }

  eq(priceParams(platformPlan, 'acct_League1'), { method: 'GET', path: '/prices/price_platform', params: null, account: null },
     'a platform plan\'s price is read on Epinoia\'s account, even if an account id was passed');
  eq(priceParams(leaguePlan, 'acct_League1').account, 'acct_League1', 'a league-sold plan\'s price is read on the league\'s account');
  const priceGet = stripeRequest({ secretKey: 'k', ...priceParams(leaguePlan, 'acct_League1') });
  eq([priceGet.url, priceGet.headers['Stripe-Account'], priceGet.body],
     ['https://api.stripe.com/v1/prices/price_onLeagueAccount', 'acct_League1', undefined], '...as a GET with the Stripe-Account header');
  throws(() => priceParams(leaguePlan, null), 'a league-sold price with no connected account is refused before Stripe is called');
  throws(() => priceParams({ ...platformPlan, stripe_price_id: 'price_1/../x' }), 'a price id that could not be one never becomes a path');
}

/* ------------------------------------------------------ portal, connect --- */
console.log('portal and connect');
{
  const plain = portalParams({ customerId: 'cus_1', siteUrl: SITE, next: '/epinoia/me/' });
  eq(plain, { method: 'POST', path: '/billing_portal/sessions',
    params: { customer: 'cus_1', return_url: 'https://prophesyscouting.co.uk/epinoia/me/' }, account: null },
    'a portal session for the platform customer');
  const cancel = portalParams({ customerId: 'cus_2', siteUrl: SITE, next: '/epinoia/me/', subscriptionId: 'sub_9', cancel: true, account: 'acct_L' });
  eq(cancel.params.flow_data, { type: 'subscription_cancel', subscription_cancel: { subscription: 'sub_9' } },
     'cancel deep-links straight to cancelling that subscription');
  eq(cancel.account, 'acct_L', 'on the account the subscription lives on');
  ok(formPairs(cancel.params).some(([k, v]) => k === 'flow_data[type]' && v === 'subscription_cancel'), 'encoded as flow_data[type]');
  throws(() => portalParams({ customerId: 'cus_1', siteUrl: SITE, cancel: true }), 'cancel without a subscription is refused');
  throws(() => portalParams({ customerId: '', siteUrl: SITE }), 'no customer, no portal');

  const acct = connectAccountParams({ leagueId: LEAGUE });
  eq(acct.path, '/accounts', 'a connected account');
  eq(acct.params.controller, { stripe_dashboard: { type: 'full' }, fees: { payer: 'account' }, losses: { payments: 'stripe' } },
     'full dashboard, the league pays its own Stripe fees, Stripe carries losses');
  ok(!('type' in acct.params), 'no legacy account type alongside controller properties');
  eq(acct.params.metadata, { league_id: LEAGUE }, 'the account says which league it is for');
  eq(acct.idempotencyKey, 'connect-account-' + LEAGUE, 'one account per league, even on a double click');

  const link = accountLinkParams({ account: 'acct_L', siteUrl: SITE, next: '/epinoia/admin/?l=bbl' });
  eq(link.params, {
    account: 'acct_L', type: 'account_onboarding',
    refresh_url: 'https://prophesyscouting.co.uk/epinoia/admin/?l=bbl&connect=refresh',
    return_url: 'https://prophesyscouting.co.uk/epinoia/admin/?l=bbl&connect=done'
  }, 'onboarding link returns to the console, saying which way it came back');
  eq(link.account, null, 'account links are created on the platform, not as the league');
  eq(accountLinkParams({ account: 'acct_L', siteUrl: SITE, next: 'https://evil.com' }).params.return_url,
     'https://prophesyscouting.co.uk/epinoia/admin/?connect=done', 'a bad next falls back to the console');
  eq(accountRow({ charges_enabled: true, payouts_enabled: 'yes', details_submitted: true }),
     { charges_enabled: true, payouts_enabled: false, details_submitted: true }, 'account flags are strictly boolean');
}

/* ------------------------------------------------------------- webhook --- */
console.log('webhook events');
{
  eq(SUBSCRIPTION_EVENTS, ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed', 'invoice.upcoming'],
     'the subscription events the contract names');

  const ev = (type, object, extra = {}) => ({ id: 'evt_x', type, data: { object }, ...extra });
  eq(subscriptionIdFromEvent(ev('checkout.session.completed', { object: 'checkout.session', mode: 'subscription', subscription: 'sub_A1' })),
     'sub_A1', 'checkout: the session\'s subscription');
  eq(subscriptionIdFromEvent(ev('checkout.session.completed', { mode: 'subscription', subscription: { id: 'sub_A2' } })),
     'sub_A2', 'checkout: an expanded subscription');
  eq(subscriptionIdFromEvent(ev('checkout.session.completed', { mode: 'payment', subscription: null })),
     null, 'checkout: a one-off payment has no subscription');
  eq(subscriptionIdFromEvent(ev('customer.subscription.updated', { object: 'subscription', id: 'sub_B1' })),
     'sub_B1', 'customer.subscription.*: the object itself');
  eq(subscriptionIdFromEvent(ev('customer.subscription.deleted', { id: 'sub_B2' })), 'sub_B2', '...deleted too');
  eq(subscriptionIdFromEvent(ev('invoice.paid', { object: 'invoice', parent: { type: 'subscription_details',
     subscription_details: { subscription: 'sub_C1' } } })), 'sub_C1', 'invoice.*: parent.subscription_details.subscription');
  eq(subscriptionIdFromEvent(ev('invoice.upcoming', { parent: { subscription_details: { subscription: 'sub_C2' } } })),
     'sub_C2', 'invoice.upcoming has no id of its own but still names its subscription');
  eq(subscriptionIdFromEvent(ev('invoice.payment_failed', { subscription: 'sub_OLD' })), null,
     'the pre-basil invoice.subscription field is not read — on dahlia it means the endpoint version is wrong');
  eq(subscriptionIdFromEvent(ev('account.updated', { object: 'account', id: 'acct_1' })), null, 'account events have no subscription');
  eq(subscriptionIdFromEvent(ev('customer.subscription.updated', { id: 'sub_../../x' })), null, 'an id that could not be one is refused');
  eq(subscriptionIdFromEvent(null), null, 'nothing gives nothing');

  /* A subscription as the dahlia API renders it, trimmed to what matters —
     including a top-level current_period_end that does NOT exist on this
     version, planted here so a regression to reading it shows up. */
  const sub = {
    id: 'sub_1SxDahlia', object: 'subscription', status: 'active', customer: 'cus_Dahlia1', livemode: true,
    cancel_at_period_end: false, cancel_at: null, canceled_at: null, ended_at: null, trial_end: null,
    current_period_end: 1111111111,
    metadata: { user_id: USER, plan_id: PLAN_ID, league_id: LEAGUE, consent_version: '2026-09-a', checkout_id: CHECKOUT },
    items: { object: 'list', data: [{
      id: 'si_1', object: 'subscription_item', current_period_start: 1789516800, current_period_end: 1792108800,
      price: { id: 'price_onLeagueAccount', object: 'price', currency: 'gbp', unit_amount: 499, nickname: null,
               recurring: { interval: 'month', interval_count: 1 }, tax_behavior: 'inclusive' }, quantity: 1
    }] }
  };
  const plan = { id: PLAN_ID, league_id: LEAGUE, features: ['league', 'analytics'], name: 'Season pass',
                 price_pennies: 499, currency: 'gbp', interval: 'month', seller: 'league' };
  const row = subscriptionRow(sub, { userId: USER, planId: PLAN_ID, account: 'acct_League1',
                                     checkout: { acknowledged_at: '2026-09-16T10:00:00.000Z' } });
  eq(row, {
    user_id: USER,
    plan_id: PLAN_ID,
    status: 'active',
    stripe_subscription_id: 'sub_1SxDahlia',
    stripe_customer_id: 'cus_Dahlia1',
    stripe_account_id: 'acct_League1',
    current_period_end: '2026-10-16T00:00:00.000Z',
    cancel_at_period_end: false,
    cancel_at: null,
    trial_end: null,
    ended_at: null,
    livemode: true,
    cooling_off_waived_at: '2026-09-16T10:00:00.000Z'
  }, 'p_row: the period end from items.data[0], the member and plan, the consent moment kept');
  eq(Object.keys(row).sort(), ['cancel_at', 'cancel_at_period_end', 'cooling_off_waived_at', 'current_period_end', 'ended_at',
     'livemode', 'plan_id', 'status', 'stripe_account_id', 'stripe_customer_id', 'stripe_subscription_id', 'trial_end', 'user_id'],
     'exactly the keys billing_apply_subscription reads — no features and no league_id, which the database takes from the plan');

  const later = subscriptionRow({ ...sub, status: 'canceled', cancel_at_period_end: true, ended_at: 1792108800,
                                  customer: { id: 'cus_Dahlia1' } }, { userId: USER, planId: PLAN_ID, account: null });
  eq([later.status, later.cancel_at_period_end, later.ended_at, later.stripe_account_id, later.stripe_customer_id, later.cooling_off_waived_at],
     ['canceled', true, '2026-10-16T00:00:00.000Z', null, 'cus_Dahlia1', null],
     'status, cancellation, end and an expanded customer are read; no account means Epinoia\'s; no checkout, no consent moment');

  /* The two shapes a booked cancellation comes in. Checkout's subscriptions are
     flexible billing mode, where the portal books it as cancel_at alone. */
  const flexible = subscriptionRow({ ...sub, cancel_at_period_end: false, cancel_at: 1792108800 }, { userId: USER, planId: PLAN_ID });
  eq([flexible.cancel_at_period_end, flexible.cancel_at], [true, '2026-10-16T00:00:00.000Z'],
     'flexible billing: cancel_at set with cancel_at_period_end FALSE is still a booked cancellation, with its date');
  const classic = subscriptionRow({ ...sub, cancel_at_period_end: true, cancel_at: null }, { userId: USER, planId: PLAN_ID });
  eq([classic.cancel_at_period_end, classic.cancel_at], [true, null], 'classic billing: the flag alone');
  const resumed = subscriptionRow({ ...sub, cancel_at_period_end: false, cancel_at: null }, { userId: USER, planId: PLAN_ID });
  eq([resumed.cancel_at_period_end, resumed.cancel_at], [false, null], 'resumed: neither, so the member is shown as renewing again');

  eq(subscriptionRow({ ...sub, livemode: false }, { userId: USER }).livemode, false, 'a test-mode subscription is recorded as one');
  eq(subscriptionRow((({ livemode, ...rest }) => rest)(sub), { userId: USER }).livemode, true,
     'livemode missing is taken as live — the safe reading for a shop that is open');
  eq(subscriptionRow(sub, { userId: USER, planId: 'not-a-plan' }).plan_id, null, 'a plan id that is not a uuid is sent as none');
  eq(subscriptionRow({ ...sub, trial_end: 1790000000 }, { userId: USER }).trial_end, '2026-09-21T14:13:20.000Z', 'a trial end is ISO');
  eq(subscriptionRow({ ...sub, items: { data: [] } }, { userId: USER }).current_period_end, null, 'no item, no period end — never the top-level decoy');
  throws(() => subscriptionRow({ id: 'in_1' }, { userId: USER }), 'an invoice is not a subscription');
  throws(() => subscriptionRow(sub, {}), 'a row with nobody to belong to is refused before the database sees it');

  console.log('whose consent it was');
  const ck = { user_id: USER, plan_id: PLAN_ID, consent_version: '2026-09-a', acknowledged_at: '2026-09-16T10:00:00.000Z' };
  eq(matchingCheckout(ck, { userId: USER, planId: PLAN_ID }), ck, 'this member\'s checkout for this plan is the evidence');
  eq(matchingCheckout({ ...ck, user_id: OTHER_USER }, { userId: USER, planId: PLAN_ID }), null,
     'somebody else\'s checkout, named in metadata a league wrote by hand, is not');
  eq(matchingCheckout({ ...ck, plan_id: OTHER_PLAN }, { userId: USER, planId: PLAN_ID }), null, 'nor this member\'s checkout for another plan');
  eq(matchingCheckout(ck, { userId: USER, planId: null }), null, 'nor anything, once the plan no longer exists to match');
  eq(matchingCheckout({ ...ck, consent_version: 'made-up' }, { userId: USER, planId: PLAN_ID }), null, 'nor a wording we never showed');
  eq(matchingCheckout({ ...ck, acknowledged_at: null }, { userId: USER, planId: PLAN_ID }), null, 'nor one with no moment of consent');
  eq(matchingCheckout(null, { userId: USER, planId: PLAN_ID }), null, 'no row, no evidence');

  const facts = emailFacts(sub, plan);
  eq([facts.planName, facts.pricePennies, facts.currency, facts.interval, facts.periodEnd],
     ['Season pass', 499, 'gbp', 'month', '2026-10-16T00:00:00.000Z'], 'email facts come from Stripe\'s own price, named by the plan');
  eq(emailFacts({ ...sub, cancel_at: 1792108800 }, null).endsAt, '2026-10-16T00:00:00.000Z', 'a booked cancellation ends at cancel_at');
  eq(emailFacts(sub, null).planName, 'Epinoia membership', 'a deleted plan still gets a name');

  console.log('who keeps access');
  const NOW = Date.parse('2026-09-16T12:00:00Z');
  const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
  eq(GRACE_DAYS, 7, 'the same week SQL access_active() allows');
  for (const [status, end, since, want, what] of [
    ['active', null, null, true, 'active with no period end'],
    ['active', daysAgo(-20), null, true, 'active with the period still running'],
    ['active', daysAgo(6.9), null, true, 'active six days and change past the period end — a renewal event may simply be late'],
    ['active', daysAgo(7), null, false, 'active but a week past the period end with nothing heard since — SQL\'s > is strict'],
    ['active', daysAgo(40), null, false, 'a test-mode subscription nobody will ever hear about again runs out on its own'],
    ['trialing', null, null, true, 'trialing'],
    ['trialing', daysAgo(8), null, false, 'trialing long past its period, unheard of'],
    ['past_due', daysAgo(-20), daysAgo(0), true, 'past_due since today'],
    ['past_due', daysAgo(-20), daysAgo(6.9), true, 'past_due for six days and change'],
    ['past_due', daysAgo(-20), daysAgo(7), false, 'past_due for exactly a week'],
    ['past_due', daysAgo(-330), daysAgo(8), false,
     'past_due for a week and a day — however far ahead Stripe moved the period end when it raised the renewal'],
    ['past_due', daysAgo(30), null, true, 'past_due not yet stamped counts from now, as coalesce(past_due_since, now()) does'],
    ['incomplete', null, null, false, 'incomplete — the first payment has not gone through'],
    ['incomplete_expired', null, null, false, 'incomplete_expired'],
    ['canceled', daysAgo(-20), null, false, 'canceled, even with time left on the period'],
    ['unpaid', null, null, false, 'unpaid'],
    ['paused', null, null, false, 'paused'],
    ['', null, null, false, 'no status'],
    [undefined, null, null, false, 'undefined']
  ]) eq(grantsAccess(status, end, since, NOW), want, 'access: ' + what);
  eq(grantsAccess('past_due', null, daysAgo(3), new Date(NOW)), true, 'now may be a Date');
  eq(graceUntil('2026-09-01T00:00:00.000Z'), '2026-09-08T00:00:00.000Z', 'the grace ends a week after the row went past_due');
  eq(graceUntil(null), null, 'no past_due moment, no grace date to quote');

  console.log('deliveries');
  eq(deliveryMode(null), 'first', 'a new event is a first delivery');
  eq(deliveryMode({ processed_at: '2026-09-16T10:00:00Z', error: null }), 'duplicate', 'a processed event is a duplicate');
  eq(deliveryMode({ processed_at: '2026-09-16T10:00:00Z', error: 'no email' }), 'duplicate', '...even one with a note');
  eq(deliveryMode({ processed_at: null, error: NOT_SYNCED + 'saving sub_1: timeout' }), 'first',
     'a retry of an event whose save failed is still its first real delivery — nothing one-off happened');
  eq(deliveryMode({ processed_at: null, error: null }), 'resync', 'an unfinished one is re-synced without the event\'s own emails');

  console.log('whose money it was');
  const pPlat = { seller: 'platform', league_id: null };
  const pLeague = { seller: 'league', league_id: LEAGUE };
  eq(planAccountProblem(pPlat, null, null), null, 'a platform plan paid on the platform');
  ok(planAccountProblem(pPlat, 'acct_League1', null), 'a platform plan "paid" on a league\'s account grants nothing');
  eq(planAccountProblem(pLeague, 'acct_League1', 'acct_League1'), null, 'a league plan paid on that league\'s account');
  ok(planAccountProblem(pLeague, 'acct_Other', 'acct_League1'), 'a league plan paid on another league\'s account grants nothing');
  ok(planAccountProblem(pLeague, 'acct_League1', null), 'nor on an account no league holds');
  ok(planAccountProblem(pLeague, null, 'acct_League1'), 'nor a league-sold plan on the platform account');
  ok(planAccountProblem({ seller: 'platform', league_id: LEAGUE }, null, null) === null,
     'a league plan Epinoia sells is paid on the platform');
  ok(planAccountProblem(null, null, null), 'a plan that does not exist grants nothing');

  console.log('emails that follow a change of state');
  const W = { applied: true, first_active: false, ending_started: false, ended: false };
  eq(transitionEmails({ ...W, first_active: true }), ['welcome'], 'the write that first makes it active welcomes');
  eq(transitionEmails({ ...W }, { welcomed: true }), [], 'an ordinary write — a renewal, a retried checkout event — sends nothing');
  eq(transitionEmails({ applied: false }, { welcomed: true }), [], 'a fetch older than the stored one decides nothing');
  eq(transitionEmails({ ...W, ending_started: true }, { welcomed: true }), ['ending'], 'a cancellation booked: the end notice');
  eq(transitionEmails({ ...W, ended: true }, { welcomed: true }), ['ended'], 'an end: the ended notice');
  eq(transitionEmails({ ...W, ended: true }, { welcomed: false }), [],
     'no ended notice for somebody never welcomed — a first payment that never went through also ends');
  eq(transitionEmails({ ...W, ending_started: true }, { welcomed: false }), [], '...nor a "will end" one');
  eq(transitionEmails({ ...W, ending_started: true, ended: true }, { welcomed: true }), ['ended'],
     'booked and ended in one write: the ended notice says everything');
  eq(transitionEmails({ ...W, first_active: true, ending_started: true }), ['welcome', 'ending'],
     'first recorded already active and already cancelling: both, welcome first');
  eq(transitionEmails({ applied: 'true', first_active: 'true' }), [], 'truthy is not true');
  eq(transitionEmails(null), [], 'no answer, no email');

  /* The whole point, played out. This is a model of the agreed
     billing_apply_subscription contract — compare-and-set on the fetch time,
     transitions reported against the stored row — so the function's side can
     be run through Checkout's burst, retries and a flexible-mode cancellation.
     The migration's own self-test must prove the SQL behaves the same. */
  const ENDED = ['canceled', 'incomplete_expired', 'unpaid'];
  const applyModel = (store, p, fetchedAt) => {
    const s = store.get(p.stripe_subscription_id) || null;
    if (s && s.synced_at >= fetchedAt) return { applied: false };
    const n = { ...(s || {}), ...p, synced_at: fetchedAt,
      cooling_off_waived_at: s?.cooling_off_waived_at ?? p.cooling_off_waived_at,
      past_due_since: p.status === 'past_due' ? (s?.past_due_since ?? fetchedAt) : null,
      welcomed_at: s?.welcomed_at ?? null };
    const first_active = ['active', 'trialing'].includes(n.status) && n.welcomed_at == null;
    if (first_active) n.welcomed_at = fetchedAt;
    const ending_started = !(s && (s.cancel_at_period_end || s.cancel_at != null)) && (n.cancel_at_period_end || n.cancel_at != null);
    const ended = !(s && ENDED.includes(s.status)) && ENDED.includes(n.status);
    store.set(p.stripe_subscription_id, n);
    return { applied: true, id: 'row', first_active, ending_started, ended };
  };
  const deliver = (store, stripeSub, fetchedAt) => {
    const result = applyModel(store, subscriptionRow(stripeSub, { userId: USER, planId: PLAN_ID }), fetchedAt);
    return transitionEmails(result, { welcomed: !!store.get(stripeSub.id)?.welcomed_at });
  };
  const at = (min) => new Date(NOW + min * 60000).toISOString();
  {
    const store = new Map();
    const sent = [];
    const paid = { ...sub, status: 'active' };
    sent.push(...deliver(store, paid, at(2)));                          // fetched after payment, written first
    sent.push(...deliver(store, { ...sub, status: 'incomplete' }, at(1))); // fetched before payment, written last
    eq(store.get(sub.id).status, 'active', 'played out: an older fetch written last does not roll the member back to incomplete');
    eq(sent, ['welcome'], '...and the welcome goes exactly once');
    eq(deliver(store, paid, at(60)), [], '...not again when Stripe retries checkout.session.completed an hour later');

    const portalCancel = { ...paid, cancel_at_period_end: false, cancel_at: 1792108800 };
    eq(deliver(store, portalCancel, at(120)), ['ending'], 'played out: a flexible-mode portal cancellation sends the end notice');
    eq(store.get(sub.id).cancel_at_period_end, true, '...and the stored row says a cancellation is booked');
    eq(deliver(store, portalCancel, at(121)), [], '...once, however many events describe it');
    eq(deliver(store, { ...portalCancel, status: 'canceled', ended_at: 1792108800 }, at(200)), ['ended'], 'the end arrives: the ended notice');
    eq(deliver(store, { ...portalCancel, status: 'canceled', ended_at: 1792108800 }, at(201)), [], '...once');
  }
  {
    const store = new Map();
    const never = { ...sub, id: 'sub_NeverPaid1', status: 'incomplete' };
    eq([...deliver(store, never, at(1)), ...deliver(store, { ...never, status: 'incomplete_expired', ended_at: 1790000000 }, at(2))], [],
       'played out: a first payment that never went through sends no welcome and no ended notice');
  }
  {
    const store = new Map();
    const late = { ...sub, id: 'sub_DelayedBacs1', status: 'incomplete' };
    const sent = [...deliver(store, late, at(1)), ...deliver(store, { ...late, status: 'active' }, at(3 * 24 * 60))];
    eq(sent, ['welcome'], 'played out: a delayed payment method is welcomed when it becomes active, days after Checkout closed');
  }

  console.log('emails that belong to an event');
  const T = Math.floor(NOW / 1000);
  const active = { ...sub, items: { data: [{ ...sub.items.data[0], current_period_end: T + 20 * 86400 }] } };
  const pastDue = { ...active, status: 'past_due' };
  eq(eventEmails(ev('invoice.payment_failed', { billing_reason: 'subscription_cycle', attempt_count: 1 }), pastDue, NOW),
     ['payment_failed'], 'the first failed attempt at a renewal asks for a new card');
  eq(eventEmails(ev('invoice.payment_failed', { billing_reason: 'subscription_cycle', attempt_count: 2 }), pastDue, NOW),
     [], 'a Smart Retries attempt does not ask again');
  eq(eventEmails(ev('invoice.payment_failed', { billing_reason: 'subscription_cycle', attempt_count: 4 }), pastDue, NOW),
     [], '...however many there are');
  eq(eventEmails(ev('invoice.payment_failed', { billing_reason: 'subscription_cycle' }), pastDue, NOW),
     [], 'no attempt count, no email — guessing would be the nagging this exists to stop');
  eq(eventEmails(ev('invoice.payment_failed', { billing_reason: 'subscription_create', attempt_count: 1 }), { ...active, status: 'incomplete' }, NOW),
     [], 'a card declined inside Checkout is not emailed about');

  const yearly = { ...active, items: { data: [{ ...active.items.data[0], price: { ...active.items.data[0].price, recurring: { interval: 'year' } } }] } };
  eq(eventEmails(ev('invoice.upcoming', {}), yearly, NOW), ['renewal_reminder'], 'a yearly renewal is reminded');
  eq(eventEmails(ev('invoice.upcoming', {}), active, NOW), [], 'a monthly one is not');
  eq(eventEmails(ev('invoice.upcoming', {}), { ...yearly, cancel_at_period_end: true }, NOW), [],
     'nor one already cancelled — it is not going to renew');
  eq(eventEmails(ev('invoice.upcoming', {}), { ...yearly, cancel_at: T + 20 * 86400 }, NOW), [],
     '...including one cancelled the flexible-mode way');
  eq(eventEmails(ev('invoice.paid', {}), active, NOW), [], 'a paid invoice sends nothing');
  eq(eventEmails(ev('checkout.session.completed', { mode: 'subscription', subscription: sub.id }), active, NOW), [],
     'the welcome is not an event\'s email any more: it follows the write that made the membership active');
  eq(eventEmails(ev('customer.subscription.deleted', { id: sub.id }), { ...active, status: 'canceled' }, NOW), [],
     '...and nor is the ended notice');
}

/* -------------------------------------------------------------- emails --- */
console.log('emails');
{
  const manageUrl = 'https://prophesyscouting.co.uk/epinoia/me/';
  const w = welcomeEmail({
    planName: 'Analytics <script>alert(1)</script>', leagueName: 'Hoops & Friends', sellerName: 'Epinoia',
    pricePennies: 499, currency: 'gbp', interval: 'month', periodEnd: '2026-10-16T09:00:00.000Z',
    consentVersion: '2026-09-a', acknowledgedAt: '2026-09-16T09:00:00.000Z', manageUrl
  });
  ok(w.text.includes(CONSENT['2026-09-a']), 'the confirmation repeats the consent wording, word for word');
  ok(w.html.includes(escapeHtml(CONSENT['2026-09-a'])), '...in the HTML too');
  ok(w.text.includes(ADULT_WORDING), 'and the age confirmation');
  ok(w.text.includes('£4.99 a month'), 'it states the price per period');
  ok(/renews automatically every month until you cancel/.test(w.text), 'that it renews until cancelled');
  ok(/cancel online/.test(w.text) && w.text.includes(manageUrl), 'and how to cancel online, with the link');
  ok(w.text.includes('16 October 2026'), 'the next payment date');
  ok(w.text.includes('Sold by Epinoia'), 'who sold it');
  ok(!w.html.includes('<script>') && w.html.includes('&lt;script&gt;'), 'a plan name cannot inject HTML');
  ok(w.html.includes('Hoops &amp; Friends'), 'an ampersand in a league name is escaped');
  ok(w.text.includes('Analytics <script>alert(1)</script>'), 'the text part carries the name as written');
  ok(!/[\r\n]/.test(w.subject) && w.subject.startsWith('[Epinoia] '), 'the subject is one line');
  const newline = welcomeEmail({ planName: 'A\r\nBcc: x@example.com', pricePennies: 1, consentVersion: '2026-09-a', manageUrl });
  ok(!/[\r\n]/.test(newline.subject), 'a newline in a plan name cannot add a header');
  const unknown = welcomeEmail({ planName: 'A', pricePennies: 1, consentVersion: 'nope', manageUrl });
  ok(!unknown.text.includes('14-day') && unknown.text.includes('nope'), 'an unknown version is named, never guessed at');
  /* What the function passes when no checkout row of THIS member for THIS plan
     exists — a subscription a league made by hand in its own dashboard. */
  const unrecorded = welcomeEmail({ planName: 'A', pricePennies: 1, consentVersion: null,
    acknowledgedAt: '2026-09-16T09:00:00.000Z', manageUrl });
  ok(!/you confirmed/.test(unrecorded.text) && !unrecorded.text.includes(CONSENT['2026-09-a']) &&
     !unrecorded.text.includes(ADULT_WORDING) && !/as you asked/.test(unrecorded.text),
     'with no matching checkout the confirmation claims no consent at all');
  ok(unrecorded.text.includes('Consent wording not recorded.'), '...and says plainly that none was recorded');

  const js = welcomeEmail({ planName: 'A', pricePennies: 1, consentVersion: '2026-09-a', manageUrl: 'javascript:alert(1)' });
  ok(!js.html.includes('javascript:') && !js.text.includes('javascript:'), 'a link that is not https is dropped');

  const ending = endNoticeEmail({ planName: 'Analytics', endsAt: '2026-10-16T09:00:00.000Z', ended: false, manageUrl });
  ok(/will end on 16 October 2026/.test(ending.subject), 'the end notice says when');
  ok(/not be charged/.test(ending.text) && /carries on until 16 October 2026/.test(ending.text), '...that nothing more is taken and access runs to then');
  const endedMail = endNoticeEmail({ planName: 'Analytics', endsAt: '2026-10-16T09:00:00.000Z', ended: true, manageUrl });
  ok(/has ended/.test(endedMail.subject) && /not be charged/.test(endedMail.text), 'the ended notice');

  const failed = paymentFailedEmail({ planName: 'Analytics', amountPennies: 499, currency: 'gbp', manageUrl,
    invoiceUrl: 'https://invoice.stripe.com/i/acct_1/test_x', graceUntil: '2026-09-23T00:00:00.000Z' });
  ok(failed.text.includes('£4.99') && /Update your card: https:\/\/prophesyscouting/.test(failed.text), 'payment failed: the amount and the card link');
  ok(failed.text.includes('https://invoice.stripe.com/i/acct_1/test_x'), '...and Stripe\'s own invoice page, which does not expire');
  ok(failed.text.includes('23 September 2026'), '...and how long access lasts meanwhile');
  const noInvoice = paymentFailedEmail({ planName: 'A', amountPennies: 1, manageUrl, invoiceUrl: '' });
  ok(!/another card/.test(noInvoice.text), 'no invoice URL, no invoice line');

  const reminder = renewalReminderEmail({ planName: 'Season pass', leagueName: 'BBL', amountPennies: 4900, currency: 'gbp',
    renewsAt: '2027-09-16T09:00:00.000Z', manageUrl });
  ok(/renews on 16 September 2027/.test(reminder.subject), 'the reminder names the renewal date');
  ok(reminder.text.includes('£49.00') && /cancel before 16 September 2027/.test(reminder.text), '...the amount and the deadline to cancel');

  eq(longDate('2026-03-29T00:30:00Z'), '29 March 2026', 'dates are London dates (BST starts that morning)');
  eq(longDate('2026-10-31T23:30:00Z'), '31 October 2026', '...and GMT after the clocks go back');
  eq(longDate('not a date'), '', 'a bad date prints nothing rather than "Invalid Date"');
}

/* ------------------------------------------------ the function's shape --- */
/* Structural, because the function itself needs a live project to run: these
   are the rules a refactor would break without any test noticing. */
console.log('the function');
{
  const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const src = readFileSync(path.join(ROOT, 'supabase', 'functions', 'billing', 'index.ts'), 'utf8');
  const hook = src.slice(src.indexOf('async function webhook('));
  ok(hook.indexOf('await req.text()') > 0, 'the webhook reads the raw body');
  ok(hook.indexOf('verifyWebhook(') > 0 && hook.indexOf('verifyWebhook(') < hook.indexOf('JSON.parse(raw)'),
     'and parses it only after the signature has verified');
  ok(!/req\.json\(\)/.test(hook.slice(0, hook.indexOf('async function syncSubscription('))),
     'the webhook never lets the runtime parse the body for it');
  ok(!/ui_mode/.test(src), 'ui_mode is not set anywhere');
  /* Test mode and live mode share one database. A customer or connected
     account made with the test key does not exist for the live key, and
     without these a stored test id breaks that person's checkout (or that
     league's onboarding) for good. */
  ok(/String\(data\?\.error\?\.code \|\| ''\), String\(data\?\.error\?\.param \|\| ''\), String\(data\?\.error\?\.type \|\| ''\)/.test(src),
     'a Stripe error keeps its code, param and type');
  ok(/json\(\{ error: publicStripeError\(e\) \}, 502\)/.test(src) && !/'the payment provider refused: ' \+/.test(src),
     'a Stripe refusal reaches a browser only through publicStripeError');
  const co = src.slice(src.indexOf('async function checkout('), src.indexOf('async function portal('));
  const firstStripeCall = co.indexOf('await stripe(');
  const adminAsk = co.indexOf("who.caller.rpc('is_platform_admin')");
  ok(co.indexOf('testModeProblem(') > 0 && adminAsk > co.indexOf('testModeProblem(') && adminAsk < firstStripeCall,
     'test mode is decided — the admin question asked with the caller\'s own token — before Stripe is called at all');
  ok(/secretKey: env\('STRIPE_SECRET_KEY'\)/.test(co) && /testers: env\('BILLING_TEST_EMAILS'\)/.test(co),
     '...from the real key and the BILLING_TEST_EMAILS secret');
  const priceCheck = co.indexOf('priceProblem(plan, price)');
  ok(/priceParams\(plan, account\)/.test(co) && priceCheck > 0 &&
     priceCheck < co.indexOf("from('access_checkouts').insert(") && priceCheck < co.indexOf('customerFor('),
     'the Stripe price is compared before the evidence row is written and before any customer is made');
  ok(/return json\(\{ error: mismatch \}, 409\)/.test(co), '...and a mismatch is a 409 with the sentence');
  ok(/grantsAccess\(r\.status, r\.current_period_end, r\.past_due_since\)/.test(co), '"already held" asks the same question SQL does');

  const sync = src.slice(src.indexOf('async function syncSubscription('), src.indexOf('async function checkoutFor('));
  ok(!/from\('access_subscriptions'\)\s*\.(upsert|update|insert|delete)\(/.test(src),
     'nothing writes access_subscriptions directly — every write is the compare-and-set RPC');
  const stamp = sync.indexOf('const fetchedAt = new Date().toISOString()');
  const refetch = sync.indexOf("stripe('GET', '/subscriptions/'");
  // one await between the two: the re-fetch's own
  ok(stamp > 0 && stamp < refetch && sync.slice(stamp, refetch).split('await').length === 2,
     'the fetch time is taken immediately before the re-fetch, with nothing else awaited in between');
  ok(/admin\.rpc\('billing_apply_subscription', \{\s*p_row: subscriptionRow\(sub, \{ userId, planId, account, checkout \}\),\s*p_fetched_at: fetchedAt\s*\}\)/.test(sync),
     'the write is billing_apply_subscription(p_row, p_fetched_at)');
  ok(!/oneOffEmails/.test(src) && /transitionEmails\(result, \{ welcomed: !!row\?\.welcomed_at \}\)/.test(sync),
     'the welcome and end notices come from what the write reports');
  ok(/const checkout = before\?\.cooling_off_waived_at \? null : await checkoutFor\(admin, meta\.checkout_id, userId, planId\)/.test(sync),
     'the consent moment is looked for while none is stored, through the same member-and-plan match');
  ok(/const ownKinds = first \? eventEmails\(event, sub\) : \[\]/.test(sync),
     'payment-failed and renewal emails stay with the first delivery of their event');
  const cf2 = src.slice(src.indexOf('async function checkoutFor('), src.indexOf('async function refreshAccount('));
  ok(/\.eq\('id', checkoutId\)\.eq\('user_id', userId\)\.eq\('plan_id', planId\)/.test(cf2) && /matchingCheckout\(data,/.test(cf2),
     'a checkout is only read as this member\'s, for this plan');
  const se = src.slice(src.indexOf('async function sendEmails('));
  ok(!/consent_version \|\||meta\.consent_version/.test(src), 'the consent wording never comes from subscription metadata');
  ok(/checkoutFor\(admin, \(sub\.metadata \|\| \{\}\)\.checkout_id, userId, row\?\.plan_id \|\| null\)/.test(se) &&
     /consentVersion: ck \? ck\.consent_version : null/.test(se),
     'the welcome quotes a wording only from a matching checkout, and otherwise none');
  ok(/graceUntil\(row\?\.past_due_since\)/.test(se), 'the payment email quotes the grace SQL gives: a week from past_due_since');
  ok(/e\.code === 'resource_missing' && e\.param === 'customer'/.test(co) && /customerFor\(admin, who\.user, account, customerId\)/.test(co),
     'checkout replaces a customer Stripe says does not exist');
  ok(/idempotencyKey: call\.idempotencyKey \+ '-customer-' \+ fresh/.test(co),
     '...and retries under a NEW idempotency key, not the failed request\'s');
  const cn = src.slice(src.indexOf('async function connect('), src.indexOf('async function createLeagueAccount('));
  ok(/'account_invalid'/.test(cn) && /createLeagueAccount\(admin, leagueId, now, accountId\)/.test(cn),
     'connect replaces a connected account this key does not know');
  const cf = src.slice(src.indexOf('async function customerFor('));
  ok(/\.eq\('stripe_customer_id', stale\)/.test(cf), 'a replacement swaps exactly the stale id, so a concurrent fix wins');
  const cors = (src.match(/'Access-Control-Allow-Headers':\s*'([^']*)'/) || [])[1] || '';
  for (const h of ['authorization', 'content-type', 'apikey', 'x-client-info', 'stripe-signature']) {
    ok(cors.split(',').map((s) => s.trim()).includes(h), 'CORS allows ' + h);
  }
  const config = readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
  ok(/\[functions\.billing\]\s*\nverify_jwt = false/.test(config), 'config.toml opens billing at the gateway — Stripe cannot send a JWT');
}

/* --------------------------------------------------------------------- */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
