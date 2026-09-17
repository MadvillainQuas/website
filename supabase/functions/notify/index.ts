// ============================================================================
// notify — delivers what the bell already holds, beyond the bell.
//
// The fan-outs in the database (notify_fixture_windows, notify_lineups,
// notify_game_final, post_announcement) write a notification row per person. This
// function takes the rows nobody has been TOLD about yet and tells them the way they
// asked in their profile:
//
//   email  one message per person per run, listing everything new, via Resend
//          (RESEND_API_KEY / CONTACT_FROM, the same pair the contact form uses)
//   phone  a Web Push to every browser the person subscribed from
//          (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT)
//
// Each row is stamped emailed_at / pushed_at as it goes, so nothing is sent twice. A row
// older than three days, or past its expires_at (a tip-off reminder after tip-off), is
// stamped and not sent: stale news is worse than none. How a row looks on a lock screen
// (grouping tag, TTL, urgency, topic, action buttons) is decided in
// _shared/pushpayload.js, tested by supabase/tests/pushpayload.test.mjs.
//
// WHO CALLS IT (docs/notifications.md §4): the database's minute tick through pg_net
// (no user token — which is why config.toml deploys this with verify_jwt = false), the
// ingest worker, finalise-game, the admin console, and fans. A caller without a
// recognised token can only trigger delivery of rows already waiting for their own
// owners, which any signed-in fan could always trigger; it is throttled per instance.
// A signed-in fan may also ask for a test push to their own phones: { test: true }.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { payloadFor, webpushOptions, isExpired, testPayload } from '../_shared/pushpayload.js';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  let body: any = {};
  try { body = await req.json(); } catch (_) { body = {}; }

  const who = await caller(req, url, serviceKey);
  const site = (Deno.env.get('SITE_URL') ?? 'https://prophesyscouting.co.uk/epinoia/').replace(/\/?$/, '/');

  /* ------------------------------------------------------------- a test --- */
  if (body && body.test === true) {
    if (!who.userId) return json({ error: 'sign in first, then send yourself a test' }, 401);
    return json(await sendTest(admin, who.userId, site));
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
  const V2 = 'id,user_id,kind,title,body,link,ref,game_id,data,expires_at,urgency,created_at';
  const V1 = 'id,user_id,kind,title,body,link,ref,game_id,created_at';
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
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@prophesyscouting.co.uk', pub, priv);
    const users = [...new Set(toPush.map((n: any) => n.user_id))];
    const subs = users.length
      ? (await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', users)).data ?? []
      : [];
    const byUser = new Map<string, any[]>();
    subs.forEach((s: any) => { const a = byUser.get(s.user_id) ?? []; a.push(s); byUser.set(s.user_id, a); });
    const dead: string[] = [];
    for (const n of toPush) {
      const mine = byUser.get(n.user_id) ?? [];
      const payload = JSON.stringify(payloadFor(n, site, Date.now()));
      const options = webpushOptions(n, Date.now());
      let sent = 0;
      for (const s of mine) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
          sent++;
        } catch (e: any) {
          const code = e?.statusCode ?? 0;
          if (code === 404 || code === 410) dead.push(s.id);        // the browser let the subscription go
          else notes.push('push ' + code + ' for ' + n.user_id.slice(0, 8));
        }
      }
      /* stamped whether or not a browser took it: a person with no live subscription would
         otherwise be retried every run forever */
      await stamp('pushed_at', [n.id]);
      if (sent) (out.pushed as number) += 1;
    }
    if (dead.length) await admin.from('push_subscriptions').delete().in('id', [...new Set(dead)]);
  }

  return json({ ok: true, ...out });
});

/* ------------------------------------------------------------------ helpers --- */

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
   the profile page's "Send a test" is how they find out whether this phone works. */
async function sendTest(admin: any, userId: string, site: string) {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
  if (!pub || !priv) return { ok: false, sent: 0, message: 'Phone notifications are not set up on this site yet.' };
  const { data: subs } = await admin.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', userId);
  if (!subs || !subs.length) return { ok: false, sent: 0, message: 'This account has no phone turned on yet. Turn notifications on first.' };
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@prophesyscouting.co.uk', pub, priv);
  const payload = JSON.stringify(testPayload(site, Date.now()));
  let sent = 0; const dead: string[] = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 300, urgency: 'high' });
      sent++;
    } catch (e: any) {
      const code = e?.statusCode ?? 0;
      if (code === 404 || code === 410) dead.push(s.id);
    }
  }
  if (dead.length) await admin.from('push_subscriptions').delete().in('id', dead);
  return sent
    ? { ok: true, sent, message: sent === 1 ? 'Sent. It should appear on your phone in a few seconds.' : 'Sent to ' + sent + ' devices.' }
    : { ok: false, sent: 0, message: 'The phone did not accept it. Turn notifications off and on again on that phone.' };
}
