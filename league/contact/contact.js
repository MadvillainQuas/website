'use strict';
/* ============================================================================
   THE CONTACT FORM.

   It posts to an Edge Function, which knows the recipient. The address is in a
   function secret — not in this file, not in the page, not anywhere a scraper
   walking the site can find it. That is the whole reason this is not a mailto:
   link.

   The form validates before sending, but only to save a round trip: the
   function validates again, because anything a browser checks is a suggestion.
   ============================================================================ */

const $ = s => document.querySelector(s);
const CFG = window.COURTSIDE_CONFIG;

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

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = $('#name').value.trim();
  const email = $('#email').value.trim();
  const subject = $('#subject').value.trim();
  const text = body.value.trim();

  /* Say what is wrong and put the cursor there. A form that reports one
     failure at a time and does not move focus is a form people abandon. */
  const bad = (el, msg) => { say(msg, 'warn'); el.focus(); return false; };
  if (!name) return bad($('#name'), 'A name, so a reply knows who it is to.');
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return bad($('#email'), 'That email address does not look right — a reply would bounce.');
  }
  if (text.length < 10) return bad(body, 'Say a little more than that.');

  const btn = $('#send');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'sending…';
  say('');

  try {
    const r = await fetch(CFG.supabaseUrl + '/functions/v1/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey },
      body: JSON.stringify({
        name, email, subject, body: text,
        website: $('#website').value      // the honeypot, always empty for a person
      })
    });
    const out = await r.json().catch(() => ({}));

    if (!r.ok) {
      btn.disabled = false; btn.textContent = label;
      return say(out.error || ('That was refused (' + r.status + ').'), 'err');
    }

    /* Whether the email left the building is not the sender's problem — the
       message is recorded either way, and saying "not delivered" would invite
       them to send it again. The distinction is kept for the admin console. */
    $('#form').reset();
    count.textContent = '0';
    btn.textContent = 'sent';
    say('Thank you — that has been sent and will be read. If you asked for a ' +
        'reply, it will come to ' + email + '.', 'ok');
  } catch (err) {
    btn.disabled = false; btn.textContent = label;
    say('Could not reach the server: ' + (err.message || err) +
        '. Your message has not been sent — nothing was lost, but it needs sending again.', 'err');
  }
});
