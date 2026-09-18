// ============================================================================
// notify — delivers what the bell already holds, beyond the bell.
//
// The fan-outs in the database (notify_fixture_windows, notify_lineups,
// notify_halftime, notify_game_final, post_announcement) write a notification row per
// person. This function takes the rows nobody has been TOLD about yet and tells them
// the way they asked in their profile:
//
//   email  one message per person per run, listing everything new, via Resend
//          (RESEND_API_KEY / CONTACT_FROM, the same pair the contact form uses)
//   phone  a Web Push to every browser the person subscribed from
//          (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT), and an APNs push to
//          every Epinoia iPhone app they turned on, whose rows' endpoints start apns:
//          (0130; APNS_KEY_ID / APNS_TEAM_ID / APNS_KEY_P8, _shared/apns.js)
//
// Each row is stamped emailed_at / pushed_at as it goes, so nothing is sent twice. A row
// older than three days, or past its expires_at (a tip-off reminder after tip-off), is
// stamped and not sent: stale news is worse than none. How a row looks on a lock screen
// (grouping tag, TTL, urgency, topic, action buttons) is decided in
// _shared/pushpayload.js, tested by supabase/tests/pushpayload.test.mjs.
//
// Every push records what the push service answered on the subscription's row
// (last_push_at / last_push_status / last_push_error, 0123), so a phone that stops
// receiving says why on its owner's profile page.
//
// WHO CALLS IT (docs/notifications.md §4): the database's minute tick through pg_net
// (no user token — which is why config.toml deploys this with verify_jwt = false), the
// ingest worker, finalise-game, the admin console, and fans. A caller without a
// recognised token can only trigger delivery of rows already waiting for their own
// owners, which any signed-in fan could always trigger; it is throttled per instance.
//
// THREE REQUESTS ARE ABOUT PHONES RATHER THAN ROWS (docs/notifications.md §7):
//   { test: true, endpoint?, delay? }
//                              signed in: a test push to every phone on the account,
//                              and what each push service answered. delay: seconds to
//                              wait first (10 at most), so the phone can be locked before
//                              it arrives — a heads-up on a locked phone is what the
//                              Android app's Game alerts channel is for; the answer then
//                              carries delayed: the seconds it waited
//   { check: subscription }    anyone: one test push to the subscription the caller
//                              holds (only a known push service's endpoint, which only
//                              that browser knows), and what the push service answered.
//                              It proves the phone's half without the account's.
//   { diag: true }             anyone: whether this server can send at all — the VAPID
//                              pair matches, this runtime encrypts a push a browser can
//                              read, a push service answers — and how many phones are
//                              registered, by push service. No personal data. Also
//                              whether Apple takes the iPhone app's key (apns).
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { payloadFor, webpushOptions, isExpired, testPayload, deviceUrl, crestUrl } from '../_shared/pushpayload.js';
import { serviceOf, explain, decryptPush, makeReceiver, vapidSigned } from '../_shared/pushcheck.js';
import { isApns, parseApns, sendApns, apnsConfig } from '../_shared/apns.js';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-ingest-worker',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* the anonymous tick is throttled per function instance: pg_cron calls once a minute,
   so anything faster is somebody else, and there is nothing to gain by running again */
let lastAnonRun = 0;
const ANON_GAP_MS = 15000;
/* the anonymous phone requests, per instance: a check per endpoint every 5 s and 30 a
   minute in all; the self-check every 10 s */
const checkSeen = new Map<string, number>();
let checkWindow = { start: 0, count: 0 };
let lastDiag = 0;
/* the longest a delayed test waits before sending (push.js asks for 10) */
const TEST_DELAY_MAX_S = 10;

const VAPID_SUBJECT = () => Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@prophesyscouting.co.uk';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }

  const site = (Deno.env.get('SITE_URL') ?? 'https://prophesyscouting.co.uk/epinoia/').replace(/\/?$/, '/');

  /* ---------------------------------------------------- the self-check --- */
  if (body && body.diag === true) {
    const now = Date.now();
    if (now - lastDiag < 10000) return json({ ok: false, error: 'a self-check has just run; try again in a few seconds' }, 429);
    lastDiag = now;
    return json(await diagnose(admin));
  }

  const who = await caller(req, url, serviceKey);

  /* ------------------------------------------------ one phone's check --- */
  if (body && body.check && typeof body.check === 'object') {
    return json(await checkPhone(admin, body.check, who.userId, site));
  }

  /* ------------------------------------------------------------- a test --- */
  if (body && body.test === true) {
    if (!who.userId) return json({ error: 'sign in first, then send yourself a test' }, 401);
    /* the wait comes after the sign-in check, so only a signed-in fan can hold a request
       open, and never for more than 10 s; anything that is not a positive number is none */
    const delay = Math.min(Math.max(Number(body.delay) || 0, 0), TEST_DELAY_MAX_S);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay * 1000));
    const out = await sendTest(admin, who.userId, site, typeof body.endpoint === 'string' ? body.endpoint : '');
    /* delayed: the seconds actually waited, so push.js can tell this notify from one deployed
       before the delay existed (which sends at once and answers without it). An extra field:
       the answer is otherwise exactly sendTest's, as before. */
    return json(delay > 0 ? { ...out, delayed: delay } : out);
  }

  if (!who.trusted && !who.userId) {
    const now = Date.now();
    if (now - lastAnonRun < ANON_GAP_MS) return json({ ok: true, skipped: 'a run has just happened' });
    lastAnonRun = now;
  }

  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const out: Record<string, unknown> = { emailed: 0, pushed: 0, expired: 0, notes: [] as string[] };
  const notes = out.notes as string[];

  /* The v2 columns (0121) are read when they exist; a function deployed ahead of the
     migration falls back to v1's, so delivery never stops over a deploy order. */
  /* league_id rides along so a push can say which pile it belongs to (pushpayload.js
     group): a fan following a whole league can have several games land together, and the
     service worker folds them into one notice. It has been on the table since 0106, so
     both shapes can ask for it. */
  const V2 = 'id,user_id,kind,title,body,link,ref,game_id,league_id,data,expires_at,urgency,created_at';
  const V1 = 'id,user_id,kind,title,body,link,ref,game_id,league_id,created_at';
  const pending = async (stamp: 'emailed_at' | 'pushed_at', users: string[]) => {
    if (!users.length) return [] as any[];
    const q = (cols: string) => admin.from('notifications').select(cols)
      .is(stamp, null).gte('created_at', since).in('user_id', users)
      .order('created_at', { ascending: true }).limit(500);
    let r = await q(V2);
    if (r.error && /column/i.test(r.error.message)) r = await q(V1);
    if (r.error) { notes.push('could not read notifications: ' + r.error.message); return []; }
    return (r.data ?? []) as any[];
  };
  const stamp = (col: 'emailed_at' | 'pushed_at', ids: string[]) =>
    ids.length ? admin.from('notifications').update({ [col]: new Date().toISOString() }).in('id', ids) : null;

  /* ------------------------------------------------------------- email --- */
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('CONTACT_FROM') ?? 'Epinoia <onboarding@resend.dev>';
  /* who asked for email, then their unsent rows (no foreign key joins the two tables) */
  const mailUsers = ((await admin.from('fan_prefs').select('user_id').eq('notify_email', true)).data ?? []).map((r: any) => r.user_id);
  const allMail = await pending('emailed_at', mailUsers);
  const nowMs = Date.now();
  const staleMail = allMail.filter(n => isExpired(n, nowMs)).map(n => n.id);
  const toMail = allMail.filter(n => !isExpired(n, nowMs));
  if (staleMail.length) await stamp('emailed_at', staleMail);
  if (!resendKey) {
    if (toMail.length) notes.push('RESEND_API_KEY not set: ' + toMail.length + ' email(s) waiting');
  } else {
    const byUser = new Map<string, any[]>();
    toMail.forEach((n: any) => { const a = byUser.get(n.user_id) ?? []; a.push(n); byUser.set(n.user_id, a); });
    for (const [uid, rows] of byUser) {
      let email: string | null = null;
      try { const { data } = await admin.auth.admin.getUserById(uid); email = data?.user?.email ?? null; } catch (_) { email = null; }
      if (!email) { notes.push('no email on account ' + uid.slice(0, 8)); continue; }
      const items = rows.map(n =>
        `<li style="margin:0 0 10px"><a href="${site}${esc(String(n.link ?? '').replace(/^\/+/, ''))}" style="color:#0a7a52;font-weight:700;text-decoration:none">${esc(n.title)}</a>` +
        (n.body ? `<br><span style="color:#556;white-space:pre-line">${esc(n.body)}</span>` : '') + '</li>').join('');
      const subject = rows.length === 1 ? rows[0].title : `${rows.length} updates from your clubs and players`;
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from, to: [email], subject: '[Epinoia] ' + subject,
            html: `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#123"><ul style="padding-left:18px">${items}</ul>` +
                  `<p style="font-size:12px;color:#889">You chose email updates in your <a href="${site}me/">Epinoia profile</a>. Turn them off there any time.</p></div>`
          })
        });
        if (!r.ok) { notes.push('resend ' + r.status + ' for ' + uid.slice(0, 8)); continue; }
        await stamp('emailed_at', rows.map(n => n.id));
        (out.emailed as number) += rows.length;
      } catch (e) { notes.push('email failed for ' + uid.slice(0, 8) + ': ' + String(e).slice(0, 80)); }
    }
  }

  /* -------------------------------------------------------------- push --- */
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
  const pushUsers = ((await admin.from('fan_prefs').select('user_id').eq('notify_push', true)).data ?? []).map((r: any) => r.user_id);
  const allPush = await pending('pushed_at', pushUsers);
  const pushNow = Date.now();
  const stalePush = allPush.filter(n => isExpired(n, pushNow)).map(n => n.id);
  const toPush = allPush.filter(n => !isExpired(n, pushNow));
  if (stalePush.length) { await stamp('pushed_at', stalePush); out.expired = stalePush.length; }
  if (!pub || !priv) {
    if (toPush.length) notes.push('VAPID keys not set: ' + toPush.length + ' push(es) waiting');
  } else {
    webpush.setVapidDetails(VAPID_SUBJECT(), pub, priv);
    const users = [...new Set(toPush.map((n: any) => n.user_id))];
    const subs = users.length
      ? (await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', users)).data ?? []
      : [];
    const byUser = new Map<string, any[]>();
    subs.forEach((s: any) => { const a = byUser.get(s.user_id) ?? []; a.push(s); byUser.set(s.user_id, a); });
    /* what to call each pile, in one read: "3 updates in British Championship Basketball"
       rather than "3 updates". A league that cannot be read is simply not named. */
    const lgIds = [...new Set(toPush.map((n: any) => n.league_id).filter(Boolean))];
    const lgName = new Map<string, string>();
    if (lgIds.length) {
      const r = await admin.from('leagues').select('id,name').in('id', lgIds);
      ((r.data ?? []) as any[]).forEach(l => lgName.set(l.id, l.name));
    }
    const dead: string[] = [];
    const outcomes = new Map<string, { status: number; error: string | null }>();
    for (const n of toPush) {
      const mine = byUser.get(n.user_id) ?? [];
      const payload = JSON.stringify(payloadFor(n, site, Date.now(),
        { groupName: (n.league_id && lgName.get(n.league_id)) || '' }));
      const options = webpushOptions(n, Date.now());
      let sent = 0;
      for (const s of mine) {
        const r = await push(s, payload, options);
        outcomes.set(s.id, { status: r.status, error: r.ok ? null : r.detail });
        if (r.ok) sent++;
        else if (r.status === 404 || r.status === 410) dead.push(s.id);        // the browser let the subscription go
        else notes.push('push ' + r.status + ' for ' + n.user_id.slice(0, 8) + (r.detail ? ': ' + r.detail.slice(0, 80) : ''));
      }
      /* stamped whether or not a browser took it: a person with no live subscription would
         otherwise be retried every run forever */
      await stamp('pushed_at', [n.id]);
      if (sent) (out.pushed as number) += 1;
    }
    await record(admin, outcomes, dead);
    if (dead.length) await admin.from('push_subscriptions').delete().in('id', [...new Set(dead)]);
  }

  /* ----------------------------------------------------------- devices --- */
  /* A notification button's subscriber (docs/notify-embed.md, 0127): no account, one
     browser subscription. Its rows are pushed to that subscription, with an absolute
     link (the league's own page when it gave a pattern) and the league's crest. */
  out.devices = 0;
  if (pub && priv) {
    const DEV = 'id,device_id,kind,title,body,link,ref,game_id,league_id,data,expires_at,urgency,created_at';
    const r = await admin.from('notifications').select(DEV)
      .not('device_id', 'is', null).is('pushed_at', null).gte('created_at', since)
      .order('created_at', { ascending: true }).limit(500);
    if (r.error) {
      if (!/device_id|column/i.test(r.error.message)) notes.push('could not read device notifications: ' + r.error.message);
    } else {
      const rows = (r.data ?? []) as any[];
      const nowD = Date.now();
      const staleD = rows.filter(n => isExpired(n, nowD)).map(n => n.id);
      if (staleD.length) { await stamp('pushed_at', staleD); out.expired = (out.expired as number) + staleD.length; }
      const liveD = rows.filter(n => !isExpired(n, nowD));
      if (liveD.length) {
        const uniq = (xs: any[]) => [...new Set(xs.filter(Boolean))];
        const devIds = uniq(liveD.map(n => n.device_id));
        const leagueIds = uniq(liveD.map(n => n.league_id));
        const gameIds = uniq(liveD.map(n => n.game_id));
        const devs = ((await admin.from('push_devices').select('id,endpoint,p256dh,auth').in('id', devIds)).data ?? []) as any[];
        const cfgs = leagueIds.length ? ((await admin.from('notify_embeds').select('league_id,game_url,home_url').in('league_id', leagueIds)).data ?? []) as any[] : [];
        const lgs = leagueIds.length ? ((await admin.from('leagues').select('id,logo_path').in('id', leagueIds)).data ?? []) as any[] : [];
        const exts = gameIds.length ? ((await admin.from('external_games').select('game_id,external_id').in('game_id', gameIds)).data ?? []) as any[] : [];
        const devBy = new Map(devs.map(d => [d.id, d]));
        const cfgBy = new Map(cfgs.map(c => [c.league_id, c]));
        const crestBy = new Map(lgs.map(l => [l.id, crestUrl(l.logo_path, url)]));
        const extBy = new Map(exts.map(e => [e.game_id, e.external_id]));
        webpush.setVapidDetails(VAPID_SUBJECT(), pub, priv);
        const outcomes = new Map<string, { status: number; error: string | null }>();
        const dead: string[] = [];
        for (const n of liveD) {
          const d = devBy.get(n.device_id);
          if (d && !dead.includes(d.id)) {
            const link = deviceUrl(n, site, cfgBy.get(n.league_id) ?? null, extBy.get(n.game_id) ?? null);
            const payload = JSON.stringify(payloadFor(n, site, Date.now(), { url: link, icon: crestBy.get(n.league_id) ?? null }));
            const res = await push(d, payload, webpushOptions(n, Date.now()));
            outcomes.set(d.id, { status: res.status, error: res.ok ? null : res.detail });
            if (res.ok) (out.devices as number) += 1;
            else if (res.status === 404 || res.status === 410) dead.push(d.id);
            else notes.push('device push ' + res.status + (res.detail ? ': ' + res.detail.slice(0, 80) : ''));
          }
          await stamp('pushed_at', [n.id]);
        }
        const at = new Date().toISOString();
        for (const [id, o] of outcomes) {
          if (dead.includes(id)) continue;
          try {
            await admin.from('push_devices').update({ last_push_at: at, last_push_status: o.status, last_push_error: o.error }).eq('id', id);
          } catch (_) { /* the push itself is what matters */ }
        }
        /* the browser let the subscription go: the device and its rows go with it */
        if (dead.length) await admin.from('push_devices').delete().in('id', dead);
      }
    }
  }

  return json({ ok: true, ...out });
});

/* ------------------------------------------------------------------ helpers --- */

/* One push, and what the push service said: never throws. status 0 is this server
   failing before a push service answered, with the error's message as the detail. */
async function push(s: { endpoint: string; p256dh: string; auth: string }, payload: string, options: Record<string, unknown>) {
  /* the iPhone app's row: through Apple Push Notification service, same answer shape */
  if (isApns(s.endpoint)) return await sendApns(s.endpoint, payload, options, { get: (k: string) => Deno.env.get(k) });
  try {
    const r: any = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
    return { ok: true, status: Number(r?.statusCode) || 201, detail: '' };
  } catch (e: any) {
    const status = Number(e?.statusCode) || 0;
    const detail = String((status ? e?.body : e?.message) ?? e ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    return { ok: false, status, detail };
  }
}

/* What each subscription's push service last answered. A project that has not had 0123
   applied has no such columns, and delivery must not depend on them. */
async function record(admin: any, outcomes: Map<string, { status: number; error: string | null }>, dead: string[]) {
  const at = new Date().toISOString();
  const gone = new Set(dead);
  for (const [id, o] of outcomes) {
    if (gone.has(id)) continue;
    try {
      await admin.from('push_subscriptions')
        .update({ last_push_at: at, last_push_status: o.status, last_push_error: o.error })
        .eq('id', id);
    } catch (_) { /* before 0123 */ }
  }
}

/* Who is calling. trusted = the service role or the ingest worker's privileged key;
   userId = a signed-in fan. Neither = the database tick or a stranger, who may only
   trigger delivery of what is already waiting. */
async function caller(req: Request, url: string, serviceKey: string) {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (bearer && bearer === serviceKey) return { trusted: true, userId: null as string | null };
  if (!bearer) return { trusted: false, userId: null as string | null };
  try {
    const client = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: 'Bearer ' + bearer } }, auth: { persistSession: false } });
    const { data } = await client.auth.getUser();
    if (data?.user) return { trusted: false, userId: data.user.id as string };
  } catch (_) { /* not a user token */ }
  if (req.headers.get('x-ingest-worker') === '1') {
    try {
      const probe = createClient(url, bearer, { auth: { persistSession: false } });
      const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
      if (!error) return { trusted: true, userId: null as string | null };
    } catch (_) { /* not a privileged key */ }
  }
  return { trusted: false, userId: null as string | null };
}

/* A test push to one fan's own phones, straight away, whatever their notify_push says:
   the profile page's "Send a test" is how they find out whether this phone works.
   endpoint: the phone asking, so the answer can say whether THAT phone is on the account. */
async function sendTest(admin: any, userId: string, site: string, endpoint: string) {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return { ok: false, sent: 0, devices: [], message: 'Phone notifications are not set up on this site yet.' };
  const { data: subs } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', userId);
  const thisPhone = !!endpoint && (subs ?? []).some((s: any) => s.endpoint === endpoint);
  if (!subs || !subs.length) {
    return { ok: false, sent: 0, devices: [], thisPhone: false,
             message: 'This account has no phone turned on yet. Turn notifications on first.' };
  }
  webpush.setVapidDetails(VAPID_SUBJECT(), pub, priv);
  const payload = JSON.stringify(testPayload(site, Date.now()));
  let sent = 0;
  const dead: string[] = [];
  const outcomes = new Map<string, { status: number; error: string | null }>();
  const devices: any[] = [];
  for (const s of subs) {
    const r = await push(s, payload, { TTL: 300, urgency: 'high' });
    const service = serviceOf(s.endpoint);
    const said = explain(r.status, service, r.detail);
    outcomes.set(s.id, { status: r.status, error: r.ok ? null : r.detail });
    devices.push({ service, status: r.status, ok: r.ok, thisPhone: s.endpoint === endpoint, text: said.text, fix: said.fix,
                   detail: r.ok ? '' : r.detail });
    if (r.ok) sent++;
    else if (r.status === 404 || r.status === 410) dead.push(s.id);
  }
  await record(admin, outcomes, dead);
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead);
  const message = sent
    ? (sent === 1 ? 'Sent. It should appear on your phone in a few seconds.' : 'Sent to ' + sent + ' devices.')
    : 'The phone did not accept it. Turn notifications off and on again on that phone.';
  return { ok: sent > 0, sent, devices, thisPhone, message };
}

/* One test push to the subscription the caller holds. Anonymous on purpose: it answers
   "can THIS phone receive?" even when saving it to the account is what failed. */
async function checkPhone(admin: any, sub: any, userId: string | null, site: string) {
  const endpoint = typeof sub.endpoint === 'string' ? sub.endpoint : '';
  const keys = sub.keys && typeof sub.keys === 'object' ? sub.keys : {};
  const service = serviceOf(endpoint);
  /* the iPhone app holds an Apple token rather than Web Push keys (0130) */
  const apple = service === 'apns';
  if (!service || (!apple && (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string'
      || keys.p256dh.length > 200 || keys.auth.length > 100)) || endpoint.length > 2000) {
    return { ok: false, status: 0, service, error: 'not a push subscription from a browser this site knows' };
  }
  const now = Date.now();
  if (now - checkWindow.start > 60000) checkWindow = { start: now, count: 0 };
  if (checkWindow.count >= 30 || now - (checkSeen.get(endpoint) ?? 0) < 5000) {
    return { ok: false, status: 429, service, error: 'a check has just run; try again in a few seconds' };
  }
  checkWindow.count++;
  checkSeen.set(endpoint, now);
  if (checkSeen.size > 500) checkSeen.clear();

  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return { ok: false, status: 0, service, error: 'Phone notifications are not set up on this site yet.' };
  webpush.setVapidDetails(VAPID_SUBJECT(), pub, priv);
  const payload = JSON.stringify({ ...testPayload(site, now), title: 'This phone can get notifications',
                                   body: 'The check on your Epinoia profile reached this phone.', tag: 'check', kind: 'check' });
  const r = await push({ endpoint, p256dh: keys.p256dh, auth: keys.auth }, payload, { TTL: 120, urgency: 'high' });
  const said = explain(r.status, service, r.detail);

  /* where the subscription stands in the database, told only about itself */
  let saved: 'yours' | 'another account' | 'no' | 'unknown' = 'unknown';
  try {
    const { data } = await admin.from('push_subscriptions').select('id,user_id').eq('endpoint', endpoint).limit(1);
    const row = (data ?? [])[0];
    saved = !row ? 'no' : !userId ? 'unknown' : row.user_id === userId ? 'yours' : 'another account';
    if (row) {
      const o = new Map([[row.id, { status: r.status, error: r.ok ? null : r.detail }]]);
      if (r.status === 404 || r.status === 410) await admin.from('push_subscriptions').delete().eq('id', row.id);
      else await record(admin, o, []);
    }
  } catch (_) { /* the push itself is the answer */ }
  return { ok: r.ok, status: r.status, service, text: said.text, fix: said.fix, detail: r.ok ? '' : r.detail, saved };
}

/* Whether this server can send at all, without anybody's phone. */
async function diagnose(admin: any) {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY') ?? '', priv = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const subject = VAPID_SUBJECT();
  const outcome: Record<string, unknown> = {
    ok: false,
    vapid: { configured: !!(pub && priv), subject: /^(mailto:|https:\/\/)/.test(subject) ? 'ok' : 'not a mailto: or https: address' },
    keyPair: 'not checked', encryption: 'not checked', transport: 'not checked', apns: 'not checked', phones: null
  };
  /* THE IPHONE APP (0130): its key is set, this runtime reaches Apple, and Apple takes the key.
     A push to a token that cannot exist is refused 400 BadDeviceToken when the key is good,
     403 when it is not, and never reaches anybody. Not part of ok: a site can run without it. */
  const ac = apnsConfig((k: string) => Deno.env.get(k));
  if (!ac.configured) {
    outcome.apns = 'not configured: set APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY_P8 for the iPhone app';
  } else {
    const a = await sendApns('apns:production:' + '0'.repeat(64), JSON.stringify({ title: 'Epinoia self-check' }), { TTL: 0 }, { config: ac });
    outcome.apns = a.status === 410 && /BadDeviceToken/.test(a.detail)
      ? 'ok (Apple accepted the key and refused a made-up iPhone, as it should)'
      : 'BROKEN: ' + (a.detail || 'status ' + a.status);
  }
  if (!pub || !priv) return outcome;
  try {
    webpush.setVapidDetails(subject, pub, priv);
    const h: any = webpush.getVapidHeaders('https://fcm.googleapis.com', subject, pub, priv, 'aes128gcm');
    outcome.keyPair = (await vapidSigned(h.Authorization, pub)) ? 'match' : 'MISMATCH: the private key does not belong to the public key browsers subscribe with';
  } catch (e) { outcome.keyPair = 'error: ' + String((e as any)?.message ?? e).slice(0, 200); }

  const receiver = await makeReceiver();
  const words = 'epinoia self-check ' + Date.now();
  try {
    const req: any = webpush.generateRequestDetails({ endpoint: 'https://fcm.googleapis.com/fcm/send/epinoia-self-check', keys: receiver.keys },
                                                    words, { TTL: 60 });
    const read = await decryptPush(new Uint8Array(req.body), receiver, receiver.authSecret);
    outcome.encryption = read === words ? 'ok' : 'BROKEN: a browser could not read what this server encrypts';
  } catch (e) { outcome.encryption = 'error: ' + String((e as any)?.message ?? e).slice(0, 200); }

  /* a push to a subscription that cannot exist: a push service's refusal proves the
     request left this server and was read; an exception without a status proves it did not */
  const r = await push({ endpoint: 'https://fcm.googleapis.com/fcm/send/epinoia-self-check', p256dh: receiver.keys.p256dh, auth: receiver.keys.auth },
                      'x', { TTL: 0 });
  outcome.transport = r.status ? 'ok (Google answered ' + r.status + ' for a made-up phone, as it should)' : 'BROKEN: ' + r.detail;

  try {
    const { data } = await admin.from('push_subscriptions').select('endpoint,created_at,last_push_at,last_push_status');
    const rows = data ?? [];
    const by: Record<string, number> = {};
    rows.forEach((s: any) => { const k = serviceOf(s.endpoint) ?? 'other'; by[k] = (by[k] ?? 0) + 1; });
    const day = Date.now() - 86400000;
    const recent = rows.filter((s: any) => s.last_push_at && Date.parse(s.last_push_at) > day);
    outcome.phones = {
      total: rows.length, byService: by,
      addedLastDay: rows.filter((s: any) => Date.parse(s.created_at) > day).length,
      pushedLastDay: { accepted: recent.filter((s: any) => s.last_push_status >= 200 && s.last_push_status < 300).length,
                       refused: recent.filter((s: any) => !(s.last_push_status >= 200 && s.last_push_status < 300)).length }
    };
  } catch (_) {
    try {
      const { count } = await admin.from('push_subscriptions').select('id', { count: 'exact', head: true });
      outcome.phones = { total: count ?? null };
    } catch (_) { /* leave null */ }
  }
  outcome.ok = outcome.keyPair === 'match' && outcome.encryption === 'ok' && String(outcome.transport).startsWith('ok');
  return outcome;
}
