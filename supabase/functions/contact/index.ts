// ============================================================================
// CONTACT — takes a message from the public form and gets it to the owner.
//
// THE RECIPIENT'S ADDRESS IS NOT IN THIS FILE. It comes from the CONTACT_TO
// secret, set once with `supabase secrets set`, so it is never in the
// repository, never in the page, and never in anything a scraper can read. The
// browser posts to this function and the function knows where to send it; the
// browser never learns.
//
// Every message is STORED as well as sent. Email is the least reliable part of
// any stack — a provider can be down, unpaid or misconfigured — and a stored
// message can still be read from the admin console, whereas one that only ever
// existed as an SMTP attempt is simply lost. Storage happens FIRST, so a
// delivery failure cannot cost somebody their message.
//
// Delivery uses Resend when RESEND_API_KEY is set. Without it the function
// still accepts and stores messages and says plainly in the response that it
// stored rather than sent, instead of pretending.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' }
  });

const MAX = { name: 120, email: 200, subject: 160, body: 5000 };
const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

/* Deliberately loose. A validator that rejects a valid address is worse than
   one that accepts an invalid one — the first loses a message from somebody
   who wanted to reach you, the second wastes a reply. */
const looksLikeEmail = (s: string) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(s);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let payload: any = {};
  try { payload = await req.json(); } catch (_) { return json({ error: 'expected JSON' }, 400); }

  // A field no human can see and no human will fill in. Bots fill everything.
  if (clip(payload.website, 50)) {
    // Answer as though it worked. Telling a bot it was caught only teaches it.
    return json({ ok: true, stored: true, delivered: true });
  }

  const name = clip(payload.name, MAX.name);
  const email = clip(payload.email, MAX.email);
  const subject = clip(payload.subject, MAX.subject);
  const body = clip(payload.body, MAX.body);

  if (!name) return json({ error: 'Give a name so a reply knows who it is to.' }, 400);
  if (!looksLikeEmail(email)) return json({ error: 'That email address does not look right.' }, 400);
  if (body.length < 10) return json({ error: 'Say a little more than that.' }, 400);

  // rate limit, counted in the database so two at once cannot both pass
  try {
    const { data: recent } = await admin.rpc('contact_recent_count',
      { p_email: email, p_minutes: 10 });
    if ((recent ?? 0) >= 3) {
      return json({ error: 'That is three messages in ten minutes. Give it a moment.' }, 429);
    }
  } catch (_) { /* if the check itself fails, accept rather than lose the message */ }

  // ---- store first, always ----
  const { data: row, error: insErr } = await admin.from('contact_messages').insert({
    name, email, subject, body,
    league_id: payload.league_id ?? null,
    user_agent: clip(req.headers.get('user-agent'), 300),
    source_ip: clip(req.headers.get('x-forwarded-for'), 60)
  }).select('id').single();

  if (insErr) return json({ error: 'Could not record that message: ' + insErr.message }, 500);

  // ---- then try to deliver ----
  const to = Deno.env.get('CONTACT_TO');
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('CONTACT_FROM') ?? 'Courtside <onboarding@resend.dev>';

  if (!to || !key) {
    await admin.from('contact_messages')
      .update({ delivery_note: !to ? 'CONTACT_TO not set' : 'RESEND_API_KEY not set' })
      .eq('id', row.id);
    return json({
      ok: true, stored: true, delivered: false,
      note: 'Your message was recorded and will be read.'
    });
  }

  let delivered = false, note = '';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        // replying to the notification reaches the person who wrote in
        reply_to: email,
        subject: '[Courtside] ' + (subject || 'Message from ' + name),
        text: [
          'From: ' + name + ' <' + email + '>',
          subject ? 'Subject: ' + subject : null,
          '',
          body,
          '',
          '—',
          'Sent from the Courtside contact form.',
          'Recorded as ' + row.id
        ].filter(Boolean).join('\n')
      })
    });
    delivered = r.ok;
    if (!r.ok) note = (await r.text().catch(() => '')).slice(0, 300) || r.statusText;
  } catch (e) {
    note = String(e).slice(0, 300);
  }

  await admin.from('contact_messages')
    .update({ delivered, delivery_note: note || null }).eq('id', row.id);

  // A failed send is NOT a failed submission — the message is safe either way,
  // and telling the sender it failed would invite them to send it again.
  return json({ ok: true, stored: true, delivered });
});
