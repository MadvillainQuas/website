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
//
// A PRIVACY REQUEST OR COMPLAINT (a payload carrying `privacy`) is the one
// exception to all of the above: it goes to the data-rights queue instead
// (privacyRequest, below; migration 0120).
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

/* ============================================================================
   A PRIVACY REQUEST OR COMPLAINT (migration 0120; foundations.md 7.6).

   The contact form's "privacy request" option and the signed-out half of
   /epinoia/privacy/ post { name, email, body, privacy: { kind, capacity,
   tenant_id } }. A signed-in person uses submit_data_request directly; this is
   the way in for everybody else, and the contract names this function for it.

   IT IS NOT A CONTACT MESSAGE. The request goes to intake_data_request, which
   stores it in the restricted queue (where the statutory clock starts), and
   nothing of it is written to contact_messages: the requester's words belong
   in one guarded place, not two. The database limits signed-out requests to
   three per address in 24 hours (signed-in requests are counted per account,
   apart); that refusal comes back as 429, and says to sign in.

   THE EMAIL SAYS THAT ONE ARRIVED, NOT WHAT IT SAYS: the kind, the reference and
   the dates, and where to handle it. No name, no address, no details, and no
   reply-to, so a request never sits in an ordinary inbox. Nothing is emailed to
   the requester: a form that mailed whatever address it was given would let
   anybody send mail to anybody. The acknowledgement is the handler's.
   ============================================================================ */
const PRIVACY_KINDS = ['access', 'erasure', 'rectification', 'restriction', 'objection', 'portability', 'complaint'];
const PRIVACY_WORDS: Record<string, string> = {
  access: 'access request', erasure: 'erasure request', rectification: 'correction request',
  restriction: 'restriction request', objection: 'objection', portability: 'portability request',
  complaint: 'complaint'
};
const CAPACITIES = ['self', 'guardian', 'representative'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const londonDate = (iso: string | null) => iso
  ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' })
  : '';

async function privacyRequest(payload: any, privacy: any): Promise<Response> {
  const kind = clip(privacy.kind, 20).toLowerCase();
  if (!PRIVACY_KINDS.includes(kind)) {
    return json({ error: 'Choose what the request is: access, erasure, rectification, restriction, objection, portability, or a complaint.' }, 400);
  }
  const capacity = clip(privacy.capacity, 20).toLowerCase() || 'self';
  if (!CAPACITIES.includes(capacity)) {
    return json({ error: 'Say whether this is about you, someone you are a parent or guardian of, or someone you represent.' }, 400);
  }
  const tenant = clip(privacy.tenant_id, 40) || null;
  if (tenant && !UUID.test(tenant)) return json({ error: 'That organisation is not on file.' }, 400);

  const name = clip(payload.name, MAX.name);
  const email = clip(payload.email, MAX.email);
  const details = String(payload.body ?? '').trim();
  if (!name) return json({ error: 'Give a name so the reply knows who it is to.' }, 400);
  if (!looksLikeEmail(email)) return json({ error: 'That email address does not look right, and the reply goes to it.' }, 400);
  if (details.length > 4000) {
    return json({ error: 'Keep the details to 4,000 characters. More can follow by email once we reply.' }, 400);
  }

  const { data, error } = await admin.rpc('intake_data_request', {
    p: { kind, name, email, capacity, details, tenant_id: tenant }
  });
  if (error) {
    if (error.code === '54000') return json({ error: error.message }, 429);
    if (error.code === '22023') return json({ error: error.message }, 400);
    return json({ error: 'Could not record that request: ' + error.message }, 500);
  }

  const to = Deno.env.get('CONTACT_TO');
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('CONTACT_FROM') ?? 'Epinoia <onboarding@resend.dev>';
  const words = PRIVACY_WORDS[kind] ?? kind;
  let delivered = false;
  if (to && key) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [to],
          subject: '[Epinoia] New ' + words + ' ' + data.reference,
          text: [
            'A ' + words + ' came in through the privacy form, reference ' + data.reference + '.',
            data.ack_due_at ? 'Acknowledge it by ' + londonDate(data.ack_due_at) + '.' : null,
            'It is due by ' + londonDate(data.due_at) + '.',
            '',
            'Who sent it and what it says are in the Privacy tab of the platform console, ' +
            'not in this email.'
          ].filter((l) => l !== null).join('\n')
        })
      });
      delivered = r.ok;
    } catch (_) {
      delivered = false;
    }
  }

  // stored either way; the queue is what the handler works from
  return json({
    ok: true, stored: true, delivered, privacy: true,
    reference: data.reference, kind: data.kind,
    received_at: data.received_at, ack_due_at: data.ack_due_at, due_at: data.due_at
  });
}

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

  // a privacy request or complaint goes to the queue, not to contact_messages
  if (payload.privacy && typeof payload.privacy === 'object') {
    return privacyRequest(payload, payload.privacy);
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

  /* Addressed to a CLUB rather than to the platform?
     The browser sends a team id, never an address. The recipient is resolved
     here, from a table no browser can read, which is the same rule the
     platform's own address follows: a form that works without publishing an
     address is the only kind worth having on a page a scraper will visit.
     A club that has switched the form off simply is not a recipient. */
  const teamId = clip(payload.team_id, 40) || null;
  let clubTo: string | null = null;
  let clubName: string | null = null;
  if (teamId) {
    // this reads with the service role, which sees a private league's (0139)
    // clubs same as any other — RLS is not what hides them from this form, so
    // the visibility check has to happen here. Answer the SAME 404 as a
    // missing club: telling the two apart would confirm the private league,
    // and its club, exist.
    const { data: t } = await admin.from('teams')
      .select('id,name,leagues(visibility)').eq('id', teamId).maybeSingle();
    if (!t || (t as any).leagues?.visibility === 'private') {
      return json({ error: 'That club is not on file.' }, 404);
    }
    clubName = t.name;
    const { data: c } = await admin.from('team_contacts')
      .select('email,accepts_form').eq('team_id', teamId).maybeSingle();
    if (!c?.accepts_form) {
      return json({ error: 'This club is not taking messages through the site.' }, 400);
    }
    clubTo = c.email || null;
  }

  // ---- store first, always ----
  const { data: row, error: insErr } = await admin.from('contact_messages').insert({
    name, email, subject, body,
    league_id: payload.league_id ?? null,
    team_id: teamId,
    user_agent: clip(req.headers.get('user-agent'), 300),
    source_ip: clip(req.headers.get('x-forwarded-for'), 60)
  }).select('id').single();

  if (insErr) return json({ error: 'Could not record that message: ' + insErr.message }, 500);

  /* A club message goes to the club. If the club has no address on file it
     still lands in the table, where the club can read it from their portal —
     which is why storage happens first and unconditionally. */
  const to = teamId ? clubTo : Deno.env.get('CONTACT_TO');
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('CONTACT_FROM') ?? 'Epinoia <onboarding@resend.dev>';

  if (!to || !key) {
    await admin.from('contact_messages')
      .update({ delivery_note: !to
        ? (teamId ? 'club has no address on file' : 'CONTACT_TO not set')
        : 'RESEND_API_KEY not set' })
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
        subject: (clubName ? '[' + clubName + '] ' : '[Epinoia] ') +
                 (subject || 'Message from ' + name),
        text: [
          'From: ' + name + ' <' + email + '>',
          subject ? 'Subject: ' + subject : null,
          clubName ? 'For: ' + clubName : null,
          '',
          body,
          '',
          '—',
          clubName
            ? 'Sent from ' + clubName + "'s page on Epinoia. Reply to this email " +
              'and it reaches the sender directly.'
            : 'Sent from the Epinoia contact form.',
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
