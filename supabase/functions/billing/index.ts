// ============================================================================
// billing — memberships paid through Stripe (docs/memberships.md §5).
//
//   POST { action: 'status' }                                  -> { configured, connect }
//   POST { action: 'checkout', planId, next,
//          consent: { version, acknowledged: true, adult: true } }  -> { url }
//   POST { action: 'portal', subscriptionId?, cancel?, next }  -> { url }
//   POST { action: 'connect', leagueId, next }                 -> { url }
//   POST /functions/v1/billing/webhook    (Stripe, signed)     -> { ok }
//
// WHY THIS IS A SERVER. The Stripe secret key must never reach a page, and the
// rows that grant access (access_subscriptions, access_customers,
// access_checkouts, billing_events, league_billing_accounts) have RLS on and
// no write policy at all — only the service role, here, writes them. Every
// page is also locked to `script-src 'self'`, so Stripe.js is not an option
// anyway: the browser is sent to Stripe's hosted Checkout by an ordinary
// navigation to the URL this returns.
//
// ONE FUNCTION, OPEN AT THE GATEWAY. verify_jwt = false in config.toml, because
// Stripe cannot send a Supabase JWT and the webhook shares this function. So
// the function guards itself, in two different ways:
//   * the webhook trusts nothing until the Stripe-Signature header has been
//     checked over the RAW body against an endpoint secret (_shared/billing.js
//     explains the check). The body is parsed only after that;
//   * the actions ask Supabase who the caller is with the caller's own token,
//     and ask the database — through that same token — whether they administer
//     a league. The service role is used only for the secret-bearing reads and
//     the privileged writes, never to answer a permission question.
//
// STATE IS RE-FETCHED, NOT READ OFF THE EVENT. Stripe delivers late, twice and
// out of order. An event is treated as "something changed on subscription X":
// the subscription is fetched from Stripe as it is now and the row is
// overwritten with that, through billing_apply_subscription, which refuses a
// fetch older than the one already stored. A stale event therefore cannot undo
// a newer one, and neither can a slow delivery that fetched first but writes
// last. The welcome and end-of-contract emails are sent when that write says
// the state CHANGED, so they go exactly once however the deliveries fall.
//
// WHAT A BUYER IS TOLD IS WHAT STRIPE CHARGES. Checkout fetches the plan's
// Stripe price and refuses the sale unless amount, currency, interval and tax
// behaviour are exactly what the plan — and so every page — says.
//
// A TEST KEY IS NOT A PUBLIC SHOP. While STRIPE_SECRET_KEY is a test key, only
// platform admins and the addresses in BILLING_TEST_EMAILS can check out: a
// test purchase makes a real membership in the database live mode shares.
//
// WHAT FAILS LOUDLY AND WHAT DOES NOT. After a signature has verified, the
// answer to Stripe is a 2xx whatever else goes wrong — an email that did not
// send, an account that is not ours — and the failure is written on the
// billing_events row, because a retry would not fix it and three days of
// retries would only bury it. The single exception is the subscription itself
// not being saved: that answers 500, so Stripe tries again and the member is
// not left paying for access they do not have.
//
// THE EVIDENCE IS WRITTEN BEFORE THE REDIRECT. access_checkouts records which
// consent wording was ticked, when, and the age confirmation, before Stripe is
// even called — so it exists even if the webhook never arrives. That is the
// record the Consumer Contracts Regulations 2013 (regs 14, 16, 37) turn on.
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, optional
// STRIPE_CONNECT_WEBHOOK_SECRET, optional BILLING_TEST_EMAILS (comma-separated;
// read only while the key is a test key), SITE_URL (only its origin is used),
// and the RESEND_API_KEY / CONTACT_FROM pair the contact and notify functions
// already use. Without the secret key every action but `status` answers 503.
// The runbook is docs/switch-on.md §6.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  SUBSCRIPTION_EVENTS, NOT_SYNCED,
  isUuid, isStripeId, verifyWebhook, stripeRequest, siteOrigin, publicStripeError,
  consentProblem, planProblem, testModeProblem, priceParams, priceProblem,
  checkoutParams, customerParams, portalParams,
  connectAccountParams, accountLinkParams, accountRow,
  subscriptionIdFromEvent, subscriptionRow, matchingCheckout, grantsAccess, graceUntil,
  deliveryMode, planAccountProblem, transitionEmails, eventEmails, emailFacts,
  welcomeEmail, endNoticeEmail, paymentFailedEmail, renewalReminderEmail
} from '../_shared/billing.js';

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, stripe-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

const env = (k: string) => (Deno.env.get(k) ?? '').trim();

/* A Stripe event is a few kilobytes. A megabyte is generous and still refuses
   anything that is not one. */
const MAX_EVENT_CHARS = 1_000_000;
const OUTBOUND_MS = 15_000;

const PLAN_COLUMNS = 'id, league_id, name, features, price_pennies, currency, interval, stripe_price_id, seller, active';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  if (/\/webhook\/?$/.test(new URL(req.url).pathname)) return await webhook(req);

  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ error: 'expected JSON' }, 400); }
  const action = String(body?.action || '');

  if (action === 'status') {
    const key = !!env('STRIPE_SECRET_KEY');
    return json({
      configured: key && !!env('STRIPE_WEBHOOK_SECRET'),
      connect: key && !!env('STRIPE_CONNECT_WEBHOOK_SECRET')
    });
  }
  if (action !== 'checkout' && action !== 'portal' && action !== 'connect') {
    return json({ error: 'unknown action: say status, checkout, portal or connect' }, 400);
  }
  if (!env('STRIPE_SECRET_KEY')) return json({ error: 'payments are not switched on yet' }, 503);

  const who = await signedIn(req);
  if (!who) return json({ error: 'sign in first' }, 401);

  const admin = serviceClient();
  try {
    if (action === 'checkout') return await checkout(admin, who, body);
    if (action === 'portal') return await portal(admin, who, body);
    return await connect(admin, who, body);
  } catch (e) {
    /* The whole detail goes to the function log, where only the operator reads
       it. The browser gets publicStripeError's sentence, which is Stripe's own
       words only when they cannot quote a key or name an account. */
    console.error('[billing] ' + action + ':', describe(e),
      e instanceof StripeError ? '(stripe ' + e.status + ' ' + (e.type || '-') + ' ' + (e.code || '-') + ')' : '');
    if (e instanceof StripeError) return json({ error: publicStripeError(e) }, 502);
    return json({ error: 'something went wrong on our side. Nothing was charged; try again in a minute.' }, 500);
  }
});

/* ============================================================== actions === */

async function checkout(admin: any, who: Who, body: any) {
  const refused = consentProblem(body.consent);
  if (refused) return json({ error: refused }, 400);

  /* Without the webhook secret a purchase would take money and never grant
     anything, because nothing would ever write the subscription down. */
  if (!env('STRIPE_WEBHOOK_SECRET')) return json({ error: 'payments are not switched on yet' }, 503);

  /* Test mode is for the people testing it (testModeProblem says why). The
     database is only asked whether this is a platform admin when the key is a
     test key and the address is not on the list, so a live sale costs nothing
     extra. Asked with the caller's own token, like every permission question. */
  const mode = { secretKey: env('STRIPE_SECRET_KEY'), email: who.user.email, testers: env('BILLING_TEST_EMAILS') };
  if (testModeProblem(mode)) {
    const { data: isAdmin } = await who.caller.rpc('is_platform_admin');
    const closed = testModeProblem({ ...mode, isPlatformAdmin: isAdmin === true });
    if (closed) return json({ error: closed.error }, closed.status);
  }

  /* NOTHING IS SOLD WHILE MEMBERSHIPS ARE SWITCHED OFF (the 0117 master switch).
     While it is off every league is open and the analytics are free, so a sale
     would take money for access the buyer already has. The people setting it up
     still need to rehearse a purchase: platform admins and the addresses in
     BILLING_TEST_EMAILS may buy anyway. A missing setting row is off, the same
     rule as memberships_enabled(). */
  const { data: sw } = await admin.from('platform_settings')
    .select('value').eq('key', 'memberships_enabled').maybeSingle();
  if (!(sw && sw.value === true)) {
    const testers = String(env('BILLING_TEST_EMAILS') || '').toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const listed = !!who.user.email && testers.indexOf(String(who.user.email).toLowerCase()) !== -1;
    let admin_ = false;
    if (!listed) { const { data: isAdmin } = await who.caller.rpc('is_platform_admin'); admin_ = isAdmin === true; }
    if (!listed && !admin_) {
      return json({ error: 'Memberships are not open yet, so there is nothing to buy: everything is free for now.' }, 409);
    }
  }

  const planId = String(body.planId || '');
  if (!isUuid(planId)) return json({ error: 'say which plan: planId is required' }, 400);
  const { data: plan, error: planErr } = await admin.from('access_plans')
    .select(PLAN_COLUMNS).eq('id', planId).maybeSingle();
  if (planErr) throw planErr;
  const bad = planProblem(plan);
  if (bad) return json({ error: bad.error }, bad.status);

  let account: string | null = null;
  let fee: number | null = null;
  if (plan.seller === 'league') {
    /* A direct charge on the league's own account. Its events only reach us
       through the Connect endpoint, so without that secret the same trap as
       above applies. */
    if (!env('STRIPE_CONNECT_WEBHOOK_SECRET')) {
      return json({ error: 'this league cannot take payments yet' }, 503);
    }
    const { data: acct, error } = await admin.from('league_billing_accounts')
      .select('stripe_account_id, charges_enabled, fee_percent').eq('league_id', plan.league_id).maybeSingle();
    if (error) throw error;
    if (!acct || !isStripeId('acct', acct.stripe_account_id) || acct.charges_enabled !== true) {
      return json({ error: 'this league cannot take payments yet' }, 409);
    }
    account = acct.stripe_account_id;
    fee = Number(acct.fee_percent);
  }

  /* Buying the same plan twice is always a mistake, and a second charge is
     the kind nobody notices until the statement. */
  const { data: held, error: heldErr } = await admin.from('access_subscriptions')
    .select('status, current_period_end, past_due_since').eq('user_id', who.user.id).eq('plan_id', plan.id);
  if (heldErr) throw heldErr;
  if ((held || []).some((r: any) => grantsAccess(r.status, r.current_period_end, r.past_due_since))) {
    return json({ error: 'You already have this plan. Manage it from Your account.' }, 409);
  }

  /* The price the buyer has been shown, and is about to consent to, must be
     the price Stripe will charge (priceProblem explains). Checked before the
     evidence row is written and before any customer is made, so a refused sale
     leaves nothing behind. A price this key cannot find — a test id left in a
     plan after the switch to live — is the same refusal, in words. */
  const pc = priceParams(plan, account);
  let price: any = null;
  try {
    price = await stripe(pc.method, pc.path, pc.params, { account: pc.account });
  } catch (e) {
    if (!(e instanceof StripeError && e.code === 'resource_missing')) throw e;
  }
  const mismatch = priceProblem(plan, price);
  if (mismatch) {
    console.error('[billing] plan ' + plan.id + ' (' + plan.stripe_price_id + (account ? ' on ' + account : '') + ') refused: ' + mismatch);
    return json({ error: mismatch }, 409);
  }

  const customerId = await customerFor(admin, who.user, account);

  /* The evidence first. The id is made here rather than defaulted in SQL so
     it can go into the Stripe metadata and the idempotency key before the
     row's insert has come back. */
  const checkoutId = crypto.randomUUID();
  const { error: ckErr } = await admin.from('access_checkouts').insert({
    id: checkoutId,
    user_id: who.user.id,
    plan_id: plan.id,
    stripe_account_id: account,
    consent_version: body.consent.version,
    acknowledged_at: new Date().toISOString(),
    adult_confirmed: true
  });
  if (ckErr) throw ckErr;

  const build = (cid: string) => checkoutParams({
    plan, userId: who.user.id, email: who.user.email, customerId: cid, account,
    feePercent: fee, siteUrl: env('SITE_URL'), next: body.next,
    checkoutId, consentVersion: body.consent.version
  });
  let call = build(customerId);
  let session: any;
  try {
    session = await stripe(call.method, call.path, call.params,
      { account: call.account, idempotencyKey: call.idempotencyKey });
  } catch (e) {
    /* The stored customer does not exist for this key: it was made in test
       mode before the switch to live (same database, different Stripe), or
       deleted in the dashboard. Replace it once and try again, under a new
       idempotency key — the old one belongs to the request that failed. */
    if (!(e instanceof StripeError && e.code === 'resource_missing' && e.param === 'customer')) throw e;
    const fresh = await customerFor(admin, who.user, account, customerId);
    call = build(fresh);
    session = await stripe(call.method, call.path, call.params,
      { account: call.account, idempotencyKey: call.idempotencyKey + '-customer-' + fresh });
  }
  if (typeof session?.url !== 'string' || typeof session?.id !== 'string') {
    throw new Error('Stripe answered without a Checkout URL');
  }

  /* Not fatal: the checkout row already holds the evidence, and the session id
     is only a cross-reference. The person should still get to pay. */
  const { error: sidErr } = await admin.from('access_checkouts')
    .update({ stripe_session_id: session.id }).eq('id', checkoutId);
  if (sidErr) console.error('[billing] checkout session id not stored:', describe(sidErr));

  return json({ url: session.url });
}

async function portal(admin: any, who: Who, body: any) {
  const ref = String(body.subscriptionId || '');
  const cancel = body.cancel === true;
  let customerId = '';
  let account: string | null = null;
  let stripeSub: string | null = null;

  if (ref) {
    /* Filtered on user_id explicitly: the RLS read policy on this table also
       lets league admins see their members' rows, and a league admin must not
       be able to open a member's billing. */
    let q = admin.from('access_subscriptions')
      .select('stripe_subscription_id, stripe_customer_id, stripe_account_id').eq('user_id', who.user.id);
    if (isUuid(ref)) q = q.eq('id', ref);
    else if (isStripeId('sub', ref)) q = q.eq('stripe_subscription_id', ref);
    else return json({ error: 'that is not a subscription id' }, 400);
    const { data: row, error } = await q.maybeSingle();
    if (error) throw error;
    if (!row) return json({ error: 'There is no such subscription on this account.' }, 404);
    customerId = row.stripe_customer_id;
    account = row.stripe_account_id || null;
    stripeSub = row.stripe_subscription_id;
  } else {
    if (cancel) return json({ error: 'say which subscription to cancel' }, 400);
    const { data: c, error } = await admin.from('access_customers')
      .select('stripe_customer_id').eq('user_id', who.user.id).eq('stripe_account_id', '').maybeSingle();
    if (error) throw error;
    if (!c) return json({ error: 'There is no billing to manage yet: nothing has been bought on this account.' }, 404);
    customerId = c.stripe_customer_id;
  }

  const call = portalParams({
    customerId, siteUrl: env('SITE_URL'), next: body.next,
    subscriptionId: stripeSub, cancel, account
  });
  const session = await stripe(call.method, call.path, call.params, { account: call.account });
  if (typeof session?.url !== 'string') throw new Error('Stripe answered without a portal URL');
  return json({ url: session.url });
}

async function connect(admin: any, who: Who, body: any) {
  const leagueId = String(body.leagueId || '');
  if (!isUuid(leagueId)) return json({ error: 'leagueId is required' }, 400);

  // authorisation is the database's answer, asked with the caller's own token
  const { data: mayAdminister } = await who.caller.rpc('is_league_admin', { p_league: leagueId });
  if (mayAdminister !== true) return json({ error: 'you do not administer that league' }, 403);

  const { data: row, error } = await admin.from('league_billing_accounts')
    .select('stripe_account_id').eq('league_id', leagueId).maybeSingle();
  if (error) throw error;

  let accountId: string = row?.stripe_account_id || '';
  const now = new Date().toISOString();
  if (!accountId) {
    accountId = await createLeagueAccount(admin, leagueId, now, null);
  } else {
    /* Refresh the flags on every visit. account.updated does this too, but
       only once the Connect endpoint exists — and an admin coming back from
       onboarding should see the truth either way. */
    try {
      const acct = await stripe('GET', '/accounts/' + accountId, null, {});
      await admin.from('league_billing_accounts')
        .update({ ...accountRow(acct), updated_at: now }).eq('league_id', leagueId);
    } catch (e) {
      /* Stripe says this key has no such account: it was onboarded in test
         mode before the switch to live, or removed from the platform. Left in
         place, every onboarding link and every sale would fail on it for good,
         and nothing but a database edit could clear it. So start again. */
      if (e instanceof StripeError && (e.code === 'resource_missing' || e.code === 'account_invalid')) {
        accountId = await createLeagueAccount(admin, leagueId, now, accountId);
      } else {
        console.error('[billing] account refresh:', describe(e));
      }
    }
  }

  const link = accountLinkParams({ account: accountId, siteUrl: env('SITE_URL'), next: body.next });
  const out = await stripe(link.method, link.path, link.params, {});
  if (typeof out?.url !== 'string') throw new Error('Stripe answered without an onboarding URL');
  return json({ url: out.url });
}

/* A league's connected account, created (or re-created in place of one Stripe
   no longer knows) and written down. Upsert on league_id writes only these
   columns, so a fee a platform admin set before the league connected is kept. */
async function createLeagueAccount(admin: any, leagueId: string, now: string, replacing: string | null) {
  const call = connectAccountParams({ leagueId });
  const acct = await stripe(call.method, call.path, call.params, {
    idempotencyKey: replacing && call.idempotencyKey ? call.idempotencyKey + '-replacing-' + replacing : call.idempotencyKey
  });
  if (!isStripeId('acct', acct?.id)) throw new Error('Stripe answered without an account id');
  const { error: upErr } = await admin.from('league_billing_accounts').upsert(
    { league_id: leagueId, stripe_account_id: acct.id, ...accountRow(acct), updated_at: now },
    { onConflict: 'league_id' });
  if (upErr) throw upErr;
  if (replacing) console.error('[billing] league ' + leagueId + ': ' + replacing + ' is unknown to this key; replaced by ' + acct.id);
  return acct.id as string;
}

/* A customer per person per Stripe account ('' = Epinoia's own). Made before
   the first checkout rather than left to Checkout, because Checkout makes a
   NEW customer every time it is not given one. `stale` names a stored customer
   Stripe has just said does not exist: a new one is made and swapped in for
   exactly that id, so a checkout that already replaced it wins. */
async function customerFor(admin: any, user: any, account: string | null, stale: string | null = null) {
  const key = account || '';
  if (!stale) {
    const { data: have, error } = await admin.from('access_customers')
      .select('stripe_customer_id').eq('user_id', user.id).eq('stripe_account_id', key).maybeSingle();
    if (error) throw error;
    if (have?.stripe_customer_id) return have.stripe_customer_id as string;
  }

  const call = customerParams({ userId: user.id, email: user.email, account });
  const created = await stripe(call.method, call.path, call.params, {
    account: call.account,
    idempotencyKey: stale ? call.idempotencyKey + '-replacing-' + stale : call.idempotencyKey
  });
  if (!isStripeId('cus', created?.id)) throw new Error('Stripe answered without a customer id');

  const { error: insErr } = stale
    ? await admin.from('access_customers').update({ stripe_customer_id: created.id })
        .eq('user_id', user.id).eq('stripe_account_id', key).eq('stripe_customer_id', stale)
    : await admin.from('access_customers').upsert(
        { user_id: user.id, stripe_account_id: key, stripe_customer_id: created.id },
        { onConflict: 'user_id,stripe_account_id', ignoreDuplicates: true });
  if (insErr) throw insErr;
  /* Two checkouts at once can each make a customer; the one stored first wins
     and is used from here on. */
  const { data: winner } = await admin.from('access_customers')
    .select('stripe_customer_id').eq('user_id', user.id).eq('stripe_account_id', key).maybeSingle();
  return (winner?.stripe_customer_id || created.id) as string;
}

/* ============================================================== webhook === */

async function webhook(req: Request) {
  const secrets = {
    platform: env('STRIPE_WEBHOOK_SECRET'),
    connect: env('STRIPE_CONNECT_WEBHOOK_SECRET')
  };
  if (!env('STRIPE_SECRET_KEY') || (!secrets.platform && !secrets.connect)) {
    return json({ error: 'payments are not switched on yet' }, 503);
  }
  const header = req.headers.get('stripe-signature');
  if (!header) return json({ error: 'a Stripe event carries a Stripe-Signature header, and this has none' }, 400);

  const raw = await req.text();
  if (raw.length > MAX_EVENT_CHARS) return json({ error: 'that is too large to be a Stripe event' }, 413);

  const check = await verifyWebhook(secrets, raw, header, Math.floor(Date.now() / 1000));
  if (!check.ok) return json({ error: 'the signature did not verify: ' + check.why }, 400);

  // only now is the body read as anything but bytes
  let event: any;
  try { event = JSON.parse(raw); } catch (_) { return json({ error: 'the signed body is not JSON' }, 400); }
  if (typeof event?.id !== 'string' || typeof event?.type !== 'string' || !event?.data?.object) {
    return json({ error: 'that is not a Stripe event' }, 400);
  }

  const admin = serviceClient();

  /* The event id is the idempotency key. Inserting it is the claim; a unique
     violation means this event has been here before. */
  let existing: any = null;
  const { error: claimErr } = await admin.from('billing_events').insert({ id: event.id, type: event.type });
  if (claimErr) {
    if (claimErr.code !== '23505') {
      console.error('[billing] recording event:', describe(claimErr));
      return json({ error: 'the event could not be recorded; Stripe will retry' }, 500);
    }
    const { data } = await admin.from('billing_events')
      .select('processed_at, error').eq('id', event.id).maybeSingle();
    existing = data || { processed_at: null, error: null };
  }
  const mode = deliveryMode(existing);
  if (mode === 'duplicate') return json({ ok: true, duplicate: true });

  const notes: string[] = [];
  const result: Record<string, unknown> = { ok: true };
  try {
    if (event.type === 'account.updated') {
      await refreshAccount(admin, event, notes);
    } else if (SUBSCRIPTION_EVENTS.includes(event.type)) {
      const subId = subscriptionIdFromEvent(event);
      if (subId) await syncSubscription(admin, event, subId, mode === 'first', notes);
      else result.ignored = true;   // a one-off payment session, or an invoice with no subscription
    } else {
      result.ignored = true;
    }
  } catch (e) {
    if (e instanceof NotSynced) {
      console.error('[billing] ' + event.id + ':', e.message);
      await admin.from('billing_events')
        .update({ processed_at: null, error: (NOT_SYNCED + e.message).slice(0, 2000) }).eq('id', event.id);
      return json({ error: 'the subscription could not be saved; Stripe will retry' }, 500);
    }
    notes.push('unexpected: ' + describe(e));
  }

  const { error: doneErr } = await admin.from('billing_events').update({
    processed_at: new Date().toISOString(),
    error: notes.length ? notes.join(' | ').slice(0, 2000) : null
  }).eq('id', event.id);
  if (doneErr) console.error('[billing] marking processed:', describe(doneErr));
  if (notes.length) console.error('[billing] ' + event.id + ' notes:', notes.join(' | '));
  if (mode === 'resync') result.resynced = true;
  return json(result);
}

async function syncSubscription(admin: any, event: any, subId: string, first: boolean, notes: string[]) {
  const account = event.account ? String(event.account) : null;
  if (account && !isStripeId('acct', account)) {
    notes.push('the event names an account that is not an account id');
    return;
  }

  /* The moment of the fetch, taken BEFORE it is made. It is what the write is
     compared on: a delivery that fetched earlier but reaches the database later
     than another (Checkout's opening burst of events, a cancel then a resume)
     must lose, and only a time from before its own fetch guarantees that it
     does. A time taken after the fetch could let an old read look newer. */
  const fetchedAt = new Date().toISOString();
  let sub: any;
  try {
    sub = await stripe('GET', '/subscriptions/' + subId, null, { account });
  } catch (e) {
    if (e instanceof StripeError && e.status === 404) {
      notes.push('Stripe has no subscription ' + subId + (account ? ' on ' + account : ''));
      return;
    }
    throw new NotSynced('fetching ' + subId + ': ' + describe(e));
  }
  if (!isStripeId('sub', sub?.id)) throw new NotSynced('Stripe answered ' + subId + ' without a subscription');

  const { data: before, error: readErr } = await admin.from('access_subscriptions')
    .select('user_id, plan_id, stripe_account_id, cooling_off_waived_at')
    .eq('stripe_subscription_id', sub.id).maybeSingle();
  if (readErr) throw new NotSynced('reading the stored subscription: ' + describe(readErr));

  const meta = sub.metadata || {};
  let userId: string;
  let planId: string | null;
  if (before) {
    /* Stripe ids are unique across accounts, so this should never differ; if
       it does, something is claiming a subscription it does not hold. */
    if ((before.stripe_account_id || null) !== account) {
      notes.push(sub.id + ' is stored against a different Stripe account; left alone');
      return;
    }
    /* Who and what were settled when the row was created, against the plan and
       the account that was paid. Metadata edited in a dashboard since then
       does not move a membership to somebody else or onto another plan. */
    userId = before.user_id;
    planId = before.plan_id || null;
  } else {
    const session = event.type === 'checkout.session.completed' ? event.data.object : null;
    const uid = isUuid(meta.user_id) ? meta.user_id
      : (isUuid(session?.client_reference_id) ? session.client_reference_id : null);
    if (!uid) {
      notes.push(sub.id + ' carries no user_id, so it cannot be matched to anybody');
      return;
    }
    if (!isUuid(meta.plan_id)) {
      notes.push(sub.id + ' carries no plan_id, so it grants nothing');
      return;
    }
    const { data: plan, error: planErr } = await admin.from('access_plans')
      .select(PLAN_COLUMNS).eq('id', meta.plan_id).maybeSingle();
    if (planErr) throw new NotSynced('reading the plan: ' + describe(planErr));

    let leagueAccount: string | null = null;
    if (plan?.seller === 'league' && plan.league_id) {
      const { data: lba, error } = await admin.from('league_billing_accounts')
        .select('stripe_account_id').eq('league_id', plan.league_id).maybeSingle();
      if (error) throw new NotSynced('reading the league account: ' + describe(error));
      leagueAccount = lba?.stripe_account_id || null;
    }
    const problem = planAccountProblem(plan, account, leagueAccount);
    if (problem) {
      notes.push(sub.id + ': ' + problem + '; nothing granted');
      return;
    }
    userId = uid;
    planId = plan.id;
  }

  /* The consent evidence, while none is stored. Looked for again on later
     events when it is missing, so a lookup that failed once heals itself. */
  const checkout = before?.cooling_off_waived_at ? null : await checkoutFor(admin, meta.checkout_id, userId, planId);

  const { data: result, error } = await admin.rpc('billing_apply_subscription', {
    p_row: subscriptionRow(sub, { userId, planId, account, checkout }),
    p_fetched_at: fetchedAt
  });
  if (error) {
    /* A new row whose account was deleted between purchase and now. A retry
       cannot bring it back, so this is recorded rather than retried for three
       days. On an existing row the same code is a plan deleted mid-flight,
       which a retry (reading plan_id afresh) does fix. */
    if (error.code === '23503' && !before) {
      notes.push(sub.id + ': the account or plan it belongs to no longer exists (' + describe(error) + ')');
      return;
    }
    throw new NotSynced('saving ' + sub.id + ': ' + describe(error));
  }
  if (!result || typeof result !== 'object' || typeof result.applied !== 'boolean') {
    throw new NotSynced('saving ' + sub.id + ': the database did not say whether it was saved');
  }

  /* Two kinds of email. What CHANGED comes from the write (transitionEmails),
     on any delivery that made the change; what belongs to the event itself
     comes from its first delivery only (eventEmails). */
  const ownKinds = first ? eventEmails(event, sub) : [];
  const changed = result.applied === true &&
    (result.first_active === true || result.ending_started === true || result.ended === true);
  if (!ownKinds.length && !changed) return;

  /* Read after the write: welcomed_at says whether this person ever had the
     membership, and past_due_since is the grace the payment email quotes —
     both as the database now holds them, including any other delivery's. */
  const { data: row } = await admin.from('access_subscriptions')
    .select('plan_id, league_id, welcomed_at, past_due_since').eq('stripe_subscription_id', sub.id).maybeSingle();
  const kinds = [...transitionEmails(result, { welcomed: !!row?.welcomed_at }), ...ownKinds];
  if (kinds.length) await sendEmails(admin, kinds, event, sub, userId, row || null, notes);
}

/* The checkout a subscription's metadata names, only if it is this member's
   and this plan's (matchingCheckout explains why). The filters are in the query
   as well as in the check, so a row that is not theirs is never even read. */
async function checkoutFor(admin: any, checkoutId: unknown, userId: string, planId: string | null) {
  if (!isUuid(checkoutId) || !isUuid(userId) || !isUuid(planId)) return null;
  const { data, error } = await admin.from('access_checkouts')
    .select('user_id, plan_id, consent_version, acknowledged_at')
    .eq('id', checkoutId).eq('user_id', userId).eq('plan_id', planId).maybeSingle();
  if (error) return null;
  return matchingCheckout(data, { userId, planId });
}

async function refreshAccount(admin: any, event: any, notes: string[]) {
  const id = event.data.object?.id;
  if (!isStripeId('acct', id)) { notes.push('account.updated without an account id'); return; }
  if (event.account && event.account !== id) { notes.push('account.updated names two different accounts'); return; }

  let acct: any = event.data.object;
  try {
    acct = await stripe('GET', '/accounts/' + id, null, {});
  } catch (e) {
    notes.push('re-fetching ' + id + ' failed, so the event\'s own copy was used: ' + describe(e));
  }
  const { data, error } = await admin.from('league_billing_accounts')
    .update({ ...accountRow(acct), updated_at: new Date().toISOString() })
    .eq('stripe_account_id', id).select('league_id');
  if (error) notes.push('saving ' + id + ': ' + describe(error));
  else if (!data || !data.length) notes.push('no league holds Stripe account ' + id);
}

/* =============================================================== emails === */

/* `row` is the access_subscriptions row as read just after the write (plan_id,
   league_id, welcomed_at, past_due_since), or null if that read failed. */
async function sendEmails(admin: any, kinds: string[], event: any, sub: any, userId: string, row: any, notes: string[]) {
  const key = env('RESEND_API_KEY');
  if (!key) { notes.push('RESEND_API_KEY not set: ' + kinds.join(', ') + ' email not sent'); return; }
  const from = env('CONTACT_FROM') || 'Epinoia <onboarding@resend.dev>';

  let to: string | null = null;
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    to = data?.user?.email ?? null;
  } catch (_) { to = null; }
  if (!to) { notes.push('no email address on account ' + String(userId).slice(0, 8) + ': ' + kinds.join(', ') + ' not sent'); return; }

  const { data: plan } = row?.plan_id
    ? await admin.from('access_plans').select(PLAN_COLUMNS).eq('id', row.plan_id).maybeSingle()
    : { data: null };
  const { data: league } = row?.league_id
    ? await admin.from('leagues').select('name').eq('id', row.league_id).maybeSingle()
    : { data: null };

  const facts = emailFacts(sub, plan);
  const leagueName = league?.name || null;
  const manageUrl = siteOrigin(env('SITE_URL')) + '/epinoia/me/';
  const invoice = event.type.startsWith('invoice.') ? event.data.object : {};

  for (const kind of kinds) {
    let mail: { subject: string; text: string; html: string } | null = null;
    try {
      if (kind === 'welcome') {
        /* The wording is quoted only from a checkout row that is this member's,
           for this plan. Nothing is taken from the subscription's metadata:
           a league's own dashboard can write any consent_version there, and
           this email must never tell somebody they agreed to words they were
           never shown. Without a matching row it says the wording was not
           recorded, which is the truth. */
        const ck = await checkoutFor(admin, (sub.metadata || {}).checkout_id, userId, row?.plan_id || null);
        mail = welcomeEmail({
          planName: facts.planName, leagueName,
          sellerName: plan?.seller === 'league' ? (leagueName || 'the league') : 'Epinoia',
          pricePennies: facts.pricePennies, currency: facts.currency, interval: facts.interval,
          periodEnd: facts.periodEnd,
          consentVersion: ck ? ck.consent_version : null,
          acknowledgedAt: ck ? ck.acknowledged_at : null,
          manageUrl
        });
      } else if (kind === 'ending' || kind === 'ended') {
        mail = endNoticeEmail({
          planName: facts.planName, leagueName, endsAt: facts.endsAt, ended: kind === 'ended', manageUrl
        });
      } else if (kind === 'payment_failed') {
        mail = paymentFailedEmail({
          planName: facts.planName, leagueName,
          amountPennies: Number.isFinite(invoice.amount_due) ? invoice.amount_due : facts.pricePennies,
          currency: invoice.currency || facts.currency,
          manageUrl, invoiceUrl: invoice.hosted_invoice_url || '',
          // a week from when the row first went past_due, as access_active() counts it
          graceUntil: sub.status === 'past_due' ? graceUntil(row?.past_due_since) : null
        });
      } else if (kind === 'renewal_reminder') {
        mail = renewalReminderEmail({
          planName: facts.planName, leagueName,
          amountPennies: Number.isFinite(invoice.amount_due) ? invoice.amount_due : facts.pricePennies,
          currency: invoice.currency || facts.currency,
          renewsAt: facts.periodEnd, manageUrl
        });
      }
      if (!mail) continue;
      const r = await send('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject: mail.subject, text: mail.text, html: mail.html })
      });
      if (!r.ok) notes.push(kind + ' email: Resend answered ' + r.status + ' ' + r.text.slice(0, 160));
    } catch (e) {
      notes.push(kind + ' email failed: ' + describe(e));
    }
  }
}

/* ========================================================= plumbing ====== */
/* BELOW THE HANDLER ON PURPOSE. Function declarations hoist, and classes are
   only constructed once a request is being handled, long after the module has
   finished loading — so all of this is in scope where it is used.
   cors.test.mjs asserts that nothing resembling an authentication check
   appears above the OPTIONS branch: a preflight answered after an auth check
   is a browser refusing the request with "Failed to fetch" and no clue why.
   Keeping every function in the same order keeps that rule checkable. */

type Who = { user: any; caller: any };

function serviceClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } });
}

/* The caller, as Supabase knows them from their own token — never from a user
   id in the body. The same client asks permission questions later, so RLS and
   is_league_admin see the real person. */
async function signedIn(req: Request): Promise<Who | null> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+/i.test(authHeader)) return null;
  const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data } = await caller.auth.getUser();
  return data?.user ? { user: data.user, caller } : null;
}

class StripeError extends Error {
  status: number;
  code: string;    // Stripe's error.code, e.g. resource_missing ('' when absent)
  param: string;   // the parameter it is about, e.g. customer ('' when absent)
  type: string;    // Stripe's error.type, e.g. invalid_request_error ('' when absent)
  constructor(status: number, message: string, code = '', param = '', type = '') {
    super(message);
    this.status = status;
    this.code = code;
    this.param = param;
    this.type = type;
  }
}

/* Thrown when the subscription itself could not be written down — the one
   webhook failure that must answer 500. */
class NotSynced extends Error {}

/* Every outbound call gets a deadline and refuses redirects: a hung provider
   must not hold a request open until the platform kills it, and an API that
   suddenly answers with a redirect is not one to follow with a bearer token. */
async function send(url: string, init: RequestInit, ms = OUTBOUND_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: 'error' });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function stripe(method: string, path: string, params: Record<string, unknown> | null,
                      opts: { account?: string | null; idempotencyKey?: string | null }) {
  const r = stripeRequest({
    secretKey: env('STRIPE_SECRET_KEY'), method, path, params,
    account: opts.account || null, idempotencyKey: opts.idempotencyKey || null
  });
  const res = await send(r.url, { method: r.method, headers: r.headers, body: r.body });
  let data: any = null;
  try { data = JSON.parse(res.text); } catch (_) { data = null; }
  if (!res.ok) {
    /* The message is kept whole for the log. It is NOT safe to pass on as it
       stands — a bad key is quoted back masked, a permission error names an
       account — so nothing sends it to a browser except through
       publicStripeError, which needs the status, type and code kept here. */
    throw new StripeError(res.status, String(data?.error?.message || ('HTTP ' + res.status)).slice(0, 300),
      String(data?.error?.code || ''), String(data?.error?.param || ''), String(data?.error?.type || ''));
  }
  if (!data) throw new StripeError(502, 'Stripe answered with something that is not JSON');
  return data;
}

function describe(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) return String((e as any).message).slice(0, 400);
  return String(e).slice(0, 400);
}
