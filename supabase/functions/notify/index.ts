// ============================================================================
// notify — delivers what the bell already holds, beyond the bell.
//
// The fan-outs in the database (notify_game_final, notify_fixtures, post_announcement) write a
// notification row per person. This function takes the rows nobody has been TOLD about yet
// and tells them the way they asked in their profile:
//
//   email  one message per person per run, listing everything new, via Resend
//          (RESEND_API_KEY / CONTACT_FROM, the same pair the contact form uses)
//   phone  a Web Push to every browser the person subscribed from the profile page
//          (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT)
//
// Each row is stamped emailed_at / pushed_at as it goes, so nothing is sent twice, and a row
// older than three days is left alone — stale news is worse than none.
//
// Called by finalise-game after a result, by the ingest after its fixture pass, and by the
// admin console after an announcement. Any signed-in caller may trigger a run: it only ever
// delivers rows to their own owners.
// ============================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-ingest-worker',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  /* who may trigger a run: the worker (service key), or any signed-in person */
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  let allowed = bearer.length > 0 && bearer === serviceKey;
  if (!allowed && bearer) {
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: 'Bearer ' + bearer } }, auth: { persistSession: false } });
    const { data } = await caller.auth.getUser();
    allowed = !!data?.user;
    if (!allowed && req.headers.get('x-ingest-worker') === '1') {
      try {
        const probe = createClient(url, bearer, { auth: { persistSession: false } });
        const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
        allowed = !error;
      } catch (_) { allowed = false; }
    }
  }
  if (!allowed) return json({ error: 'sign in first' }, 401);

  const site = (Deno.env.get('SITE_URL') ?? 'https://prophesyscouting.co.uk/epinoia/').replace(/\/?$/, '/');
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const out: Record<string, unknown> = { emailed: 0, pushed: 0, notes: [] as string[] };
  const notes = out.notes as string[];

  /* ------------------------------------------------------------- email --- */
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('CONTACT_FROM') ?? 'Epinoia <onboarding@resend.dev>';
  /* who asked for email, then their unsent rows (no foreign key joins the two tables) */
  const mailUsers = ((await admin.from('fan_prefs').select('user_id').eq('notify_email', true)).data ?? []).map((r: any) => r.user_id);
  const { data: toMail } = mailUsers.length
    ? await admin.from('notifications').select('id,user_id,kind,title,body,link,created_at')
        .is('emailed_at', null).gte('created_at', since).in('user_id', mailUsers)
        .order('created_at', { ascending: true }).limit(500)
    : { data: [] as any[] };
  if (!resendKey) {
    if ((toMail ?? []).length) notes.push('RESEND_API_KEY not set: ' + toMail!.length + ' email(s) waiting');
  } else {
    const byUser = new Map<string, any[]>();
    (toMail ?? []).forEach((n: any) => { const a = byUser.get(n.user_id) ?? []; a.push(n); byUser.set(n.user_id, a); });
    for (const [uid, rows] of byUser) {
      let email: string | null = null;
      try { const { data } = await admin.auth.admin.getUserById(uid); email = data?.user?.email ?? null; } catch (_) { email = null; }
      if (!email) { notes.push('no email on account ' + uid.slice(0, 8)); continue; }
      const items = rows.map(n =>
        `<li style="margin:0 0 10px"><a href="${site}${esc(n.link ?? '')}" style="color:#0a7a52;font-weight:700;text-decoration:none">${esc(n.title)}</a>` +
        (n.body ? `<br><span style="color:#556">${esc(n.body)}</span>` : '') + '</li>').join('');
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
        await admin.from('notifications').update({ emailed_at: new Date().toISOString() }).in('id', rows.map(n => n.id));
        (out.emailed as number) += rows.length;
      } catch (e) { notes.push('email failed for ' + uid.slice(0, 8) + ': ' + String(e).slice(0, 80)); }
    }
  }

  /* -------------------------------------------------------------- push --- */
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY');
  const pushUsers = ((await admin.from('fan_prefs').select('user_id').eq('notify_push', true)).data ?? []).map((r: any) => r.user_id);
  const { data: toPush } = pushUsers.length
    ? await admin.from('notifications').select('id,user_id,kind,title,body,link')
        .is('pushed_at', null).gte('created_at', since).in('user_id', pushUsers)
        .order('created_at', { ascending: true }).limit(500)
    : { data: [] as any[] };
  if (!pub || !priv) {
    if ((toPush ?? []).length) notes.push('VAPID keys not set: ' + toPush!.length + ' push(es) waiting');
  } else {
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@prophesyscouting.co.uk', pub, priv);
    const users = [...new Set((toPush ?? []).map((n: any) => n.user_id))];
    const subs = users.length
      ? (await admin.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth').in('user_id', users)).data ?? []
      : [];
    const byUser = new Map<string, any[]>();
    subs.forEach((s: any) => { const a = byUser.get(s.user_id) ?? []; a.push(s); byUser.set(s.user_id, a); });
    const dead: string[] = [];
    for (const n of (toPush ?? []) as any[]) {
      const mine = byUser.get(n.user_id) ?? [];
      let sent = 0;
      for (const s of mine) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: n.title, body: n.body ?? '', url: site + (n.link ?? ''), tag: n.kind + ':' + n.id }),
            { TTL: 6 * 3600 });
          sent++;
        } catch (e: any) {
          const code = e?.statusCode ?? 0;
          if (code === 404 || code === 410) dead.push(s.id);        // the browser let the subscription go
          else notes.push('push ' + code + ' for ' + n.user_id.slice(0, 8));
        }
      }
      /* stamped whether or not a browser took it: a person with no live subscription would
         otherwise be retried every run forever */
      await admin.from('notifications').update({ pushed_at: new Date().toISOString() }).eq('id', n.id);
      if (sent) (out.pushed as number) += 1;
    }
    if (dead.length) await admin.from('push_subscriptions').delete().in('id', [...new Set(dead)]);
  }

  return json({ ok: true, ...out });
});
