'use strict';
/* ============================================================================
   THE CONTACT FORM.

   It posts to an Edge Function, which knows the recipient. The address is in a
   function secret — not in this file, not in the page, not anywhere a scraper
   walking the site can find it. That is the whole reason this is not a mailto:
   link.

   The form validates before sending, but only to save a round trip: the
   function validates again, because anything a browser checks is a suggestion.

   THE PRIVACY OPTION (migration 0120). "A privacy request or complaint" turns
   the same form into a data-rights request: the function sends it to the
   restricted queue, where its one-month clock starts, rather than to the
   contact inbox. The subject goes, the details are capped at the queue's 4,000
   characters, and the answer carries a reference and the dates. ?topic=privacy
   opens the form that way.
   ============================================================================ */

const $ = s => document.querySelector(s);
const CFG = window.EPINOIA_CONFIG;

function say(text, kind) {
  const m = $('#msg');
  m.textContent = text || '';
  m.className = 'msg ' + (kind || '');
  m.classList.toggle('hide', !text);
  if (text) m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

const body = $('#body');
const count = $('#count');
body.addEventListener('input', () => { count.textContent = String(body.value.length); });

const isPrivacy = () => $('#topic').value === 'privacy';
const londonDate = iso => iso
  ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' })
  : '';

function syncTopic() {
  const p = isPrivacy();
  $('#privacyBox').classList.toggle('hide', !p);
  $('#subjectRow').classList.toggle('hide', p);
  $('#bodyLabel').textContent = p ? 'Details: what you are asking for, and anything that helps us find your data' : 'Message';
  const max = p ? 4000 : 5000;
  body.maxLength = max;
  $('#max').textContent = String(max);
  count.textContent = String(body.value.length);
}
$('#topic').addEventListener('change', syncTopic);
if (new URLSearchParams(location.search).get('topic') === 'privacy') $('#topic').value = 'privacy';
syncTopic();

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const privacy = isPrivacy();
  const name = $('#name').value.trim();
  const email = $('#email').value.trim();
  const subject = privacy ? '' : $('#subject').value.trim();
  const text = body.value.trim();

  /* Say what is wrong and put the cursor there. A form that reports one
     failure at a time and does not move focus is a form people abandon. */
  const bad = (el, msg) => { say(msg, 'warn'); el.focus(); return false; };
  if (!name) return bad($('#name'), 'A name, so a reply knows who it is to.');
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return bad($('#email'), 'That email address does not look right — a reply would bounce.');
  }
  if (!privacy && text.length < 10) return bad(body, 'Say a little more than that.');
  if (privacy && text.length > 4000) return bad(body, 'Keep the details to 4,000 characters. More can follow once we reply.');

  const btn = $('#send');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'sending…';
  say('');

  const payload = {
    name, email, subject, body: text,
    website: $('#website').value      // the honeypot, always empty for a person
  };
  if (privacy) payload.privacy = { kind: $('#pkind').value, capacity: $('#pcap').value };

  try {
    const r = await fetch(CFG.supabaseUrl + '/functions/v1/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey },
      body: JSON.stringify(payload)
    });
    const out = await r.json().catch(() => ({}));

    if (!r.ok) {
      btn.disabled = false; btn.textContent = label;
      return say(out.error || ('That was refused (' + r.status + ').'), 'err');
    }

    const topic = $('#topic').value;
    $('#form').reset();
    $('#topic').value = topic;
    syncTopic();
    count.textContent = '0';
    btn.textContent = 'sent';

    if (privacy && out.reference) {
      say('Recorded as reference ' + out.reference + '. ' +
          (out.ack_due_at ? 'We acknowledge a complaint by ' + londonDate(out.ack_due_at) + ', and aim to resolve it by ' +
                            londonDate(out.due_at) + '. '
                          : 'The answer is due by ' + londonDate(out.due_at) + '. If we need to check who you are, or what ' +
                            'you mean, we will ask, and the month runs from your answer. ') +
          'We write to ' + email + '. Quote the reference if you write to us about it.', 'ok');
      return;
    }

    /* Whether the email left the building is not the sender's problem — the
       message is recorded either way, and saying "not delivered" would invite
       them to send it again. The distinction is kept for the admin console. */
    say('Thank you — that has been sent and will be read. If you asked for a ' +
        'reply, it will come to ' + email + '.', 'ok');
  } catch (err) {
    btn.disabled = false; btn.textContent = label;
    say('Could not reach the server: ' + (err.message || err) +
        '. Your message has not been sent — nothing was lost, but it needs sending again.', 'err');
  }
});
