'use strict';
/* ============================================================================
   SIGN IN.

   One page for the whole of identity, because the alternative is an auth panel
   on every page that needs one and four copies of the same bug.

   Two ways in, no passwords either way. There is nothing to choose badly,
   reuse, forget or have stolen, and no reset flow to get wrong.

   GOOGLE is offered first because for most people it is one click, and because
   it costs nothing from the email allowance.

   A MAGIC LINK is the fallback, and it needs care that is invisible from the
   outside: that allowance is shared with everything else the project sends,
   and exhausting it locks the owner out for an hour. So sending is rate
   limited here as well as at the server — not because it protects anything,
   but because a double-clicked button should not cost somebody their
   afternoon.
   ============================================================================ */

const $ = s => document.querySelector(s);
const sb = window.epinoiaClient && window.epinoiaClient();
const params = new URLSearchParams(location.search);

/* Where to go back to once signed in: a same-origin path under /epinoia/ and
   nothing else, because an open redirect in a sign-in page is how phishing gets
   a real domain in the address bar. "Starts with one slash" was not enough:
   browsers strip tabs and newlines out of a URL and read a backslash as a
   slash, so '/%09/evil.com' once decoded, '/\evil.com' and
   '/epinoia/..//evil.com' all used to leave the site. No control characters or
   spaces, no backslash (raw or %5c), no '//' anywhere, and the browser's own
   parser has the last word: resolved here, it must still be here.
   Kept character for character the same as safePath in access.js and safeNext
   in join.js; access.test.mjs reads this function out of this file and runs the
   same attack strings through all three. */
function safePath(n) {
  const s = String(n == null ? '' : n);
  if (s.indexOf('/epinoia/') !== 0) return '';
  if (/[\x00-\x20\x7f\\]|%5c|\/\//i.test(s)) return '';
  try {
    const u = new URL(s, location.origin);
    if (u.origin !== location.origin || u.pathname.indexOf('/epinoia/') !== 0) return '';
  } catch (_) { return ''; }
  return s;
}
function safeNext() {
  return safePath(params.get('next')) || null;
}

function say(text, kind) {
  const m = $('#msg');
  m.textContent = text || '';
  m.className = 'msg ' + (kind || '');
  m.classList.toggle('hide', !text);
}

const ROLE_LABELS = [
  ['is_platform_admin', 'platform admin', w => !!w.is_platform_admin],
  ['leagues',  'league admin',  w => (w.leagues || []).length],
  ['teams',    'team manager',  w => (w.teams || []).length],
  ['scoring',  'games to score', w => (w.scoring || []).length]
];

async function render() {
  if (!sb) {
    say('No Supabase key in config.js — signing in needs one.', 'err');
    return;
  }
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    $('#out').classList.remove('hide');
    $('#in').classList.add('hide');
    return;
  }

  $('#out').classList.add('hide');
  $('#in').classList.remove('hide');
  $('#email2').textContent = session.user.email || 'signed in';

  /* what the DATABASE says this account can do, not what this page assumes */
  const host = $('#roles'); host.textContent = '';
  let who = {};
  try {
    const { data, error } = await sb.rpc('whoami');
    if (error) throw error;
    who = data || {};
  } catch (e) {
    say('Signed in, but your roles could not be read: ' + (e.message || e), 'warn');
  }

  let any = false;
  ROLE_LABELS.forEach(([, label, has]) => {
    let n = 0;
    try { n = has(who) || 0; } catch (_) { n = 0; }
    if (!n) return;
    any = true;
    const d = document.createElement('span');
    d.className = 'role on';
    d.textContent = (typeof n === 'number' && n > 1) ? (n + ' ' + label) : label;
    host.appendChild(d);
  });
  if (!any) {
    const d = document.createElement('span');
    d.className = 'role';
    d.textContent = 'no roles yet';
    host.appendChild(d);
  }

  const next = safeNext();
  if (next && next !== location.pathname) {
    say('Signed in. Returning you to where you were…', 'ok');
    setTimeout(() => { location.replace(next); }, 900);
  }
}

/* >>> THE CODE FROM THE EMAIL, INSIDE THE APP (roadmap Phase 6).

   A magic link's first stop is *.supabase.co, which no App Link covers, so a
   link tapped in Gmail finishes in the phone's default browser: that browser
   ends up signed in and the app does not. The same email also carries a code
   (the Magic Link template's {{ .Token }}), so inside the app (appmode.js:
   window.epinoiaApp, html.m-app) the form offers a field for it once the email
   has gone, and verifyOtp puts the session in the app that asked for it. The
   link still works, and outside the app none of this is ever drawn.

   Built from script rather than markup because one block serves all four
   sign-in forms. Kept character for character the same in signin/signin.js,
   app/app.js, admin/admin.js and admin/platform/platform.js; app-signin.test.mjs
   checks that and then runs it. The names are long on purpose: these files are
   classic scripts sharing one global scope with a dozen others.

   A code sign-in fires onAuthStateChange exactly as the link does, so each page
   carries on down its own post-sign-in path. Nothing here renders the page. */
let emailCodeResend = null;

function emailCodeInApp() {
  return !!window.epinoiaApp || document.documentElement.classList.contains('m-app');
}

/* Called after a send succeeds. Outside the app it returns null and the page
   says what it always said; inside, it shows the field (once) after `after`
   and returns it. `resend(email)` is the page's own send, rate limits and all. */
function offerEmailCode(after, email, resend) {
  if (!emailCodeInApp() || !after || !after.parentNode) return null;
  emailCodeResend = resend;
  let box = document.getElementById('emailCodeBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'emailCodeBox';
    box.setAttribute('role', 'group');
    box.setAttribute('aria-labelledby', 'emailCodeHint');
    box.style.cssText = 'flex-direction:column;gap:10px;margin:14px 0;max-width:360px';

    const hint = document.createElement('p');
    hint.id = 'emailCodeHint';
    hint.style.cssText = 'margin:0;font-size:14px;line-height:1.6;color:var(--ink-2)';

    const lab = document.createElement('label');
    lab.htmlFor = 'emailCodeIn';
    lab.textContent = 'Code from the email';
    lab.style.cssText = 'font-family:var(--f-micro);font-size:9px;letter-spacing:.12em;' +
      'text-transform:uppercase;color:var(--ink-3)';

    /* 16px or a phone zooms the page on focus; numeric so the keypad is
       digits; one-time-code so the keyboard can offer the code it saw */
    const input = document.createElement('input');
    input.id = 'emailCodeIn';
    input.className = 'ep-input';
    input.type = 'text';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'one-time-code');
    input.setAttribute('pattern', '[0-9]*');
    input.setAttribute('maxlength', '12');
    input.setAttribute('aria-describedby', 'emailCodeHint');
    input.style.cssText = 'font-size:16px;letter-spacing:.3em;max-width:220px';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
    const go = document.createElement('button');
    go.id = 'emailCodeGo';
    go.type = 'button';
    go.className = 'ep-btn pri';
    go.textContent = 'Verify';
    const again = document.createElement('button');
    again.id = 'emailCodeAgain';
    again.type = 'button';
    again.className = 'ep-btn';
    again.textContent = 'Send a new code';
    row.append(go, again);
    box.append(hint, lab, input, row);

    go.addEventListener('click', () => verifyEmailCode(box));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') verifyEmailCode(box); });
    again.addEventListener('click', async () => {
      if (typeof emailCodeResend !== 'function' || again.disabled) return;
      again.disabled = true;
      try { await emailCodeResend(box.getAttribute('data-email') || ''); }
      finally { again.disabled = false; }
    });
    after.parentNode.insertBefore(box, after.nextSibling);
  }
  box.setAttribute('data-email', email);
  box.querySelector('#emailCodeHint').textContent =
    'Enter the 6-digit code from the email, or open the link on this phone. ' +
    'It went to ' + email + '.';
  box.style.display = 'flex';
  return box;
}

async function verifyEmailCode(box) {
  const input = box.querySelector('#emailCodeIn');
  const go = box.querySelector('#emailCodeGo');
  const email = box.getAttribute('data-email') || '';
  /* a code pasted as "123 456" is still the code */
  const token = String(input.value || '').replace(/\D/g, '');
  if (!/^[0-9]{6,10}$/.test(token)) {
    input.focus();
    return say('Enter the 6-digit code from the email, or open the link on this phone.', 'warn');
  }
  if (go.disabled) return;
  go.disabled = true;
  const label = go.textContent;
  go.textContent = 'checking…';
  let error = null;
  try {
    const res = await sb.auth.verifyOtp({ email, token, type: 'email' });
    error = res && res.error;
  } catch (e) {
    error = e || new Error('The code could not be checked.');
  }
  go.disabled = false;
  go.textContent = label;
  if (error) {
    const m = String(error.message || error);
    /* Supabase says "Token has expired or is invalid" for both, and an older
       email's code is refused the same way once a newer one has been sent */
    if (/expired|invalid|not found/i.test(m)) {
      return say('That code is wrong or has expired. Use the code in the newest ' +
                 'email, or send a new one.', 'err');
    }
    if (/rate|limit|too many/i.test(m)) {
      return say('Too many tries for now. Wait a minute, then try again.', 'err');
    }
    return say(m, 'err');
  }
  input.value = '';
  box.style.display = 'none';
  say('Signed in.', 'ok');
}
/* <<< THE CODE FROM THE EMAIL */

/* ------------------------------------------------------------------ send --- */
const RATE_KEY = 'ep-signin-last';
const RATE_MS = 60000;

/* The resend under the code field passes the address the code went to, so a
   field edited in between cannot send the second email somewhere else. */
async function sendLink(to) {
  const email = typeof to === 'string' ? to : $('#email').value.trim();
  if (!email || email.indexOf('@') === -1) {
    return say('Enter the email your account uses.', 'warn');
  }

  /* every send costs one from an allowance shared with the rest of the
     project, and exhausting it locks everybody out for an hour */
  let last = 0;
  try { last = Number(localStorage.getItem(RATE_KEY) || 0); } catch (_) {}
  const wait = RATE_MS - (Date.now() - last);
  if (wait > 0) {
    return say('A link was just sent. Give it ' + Math.ceil(wait / 1000) +
               ' seconds before asking for another — they are rationed.', 'warn');
  }

  const btn = $('#send');
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = 'sending…';

  const next = safeNext();
  const redirect = location.origin + location.pathname +
    (next ? '?next=' + encodeURIComponent(next) : '');

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirect }
  });

  btn.disabled = false; btn.textContent = label;
  if (error) {
    /* the rate limit is the one failure worth naming, because the message the
       server sends for it is not obviously about email */
    if (/rate|limit|too many/i.test(error.message || '')) {
      return say('The email allowance is exhausted for now. It resets within ' +
                 'the hour — this is shared across the whole project, so it is ' +
                 'worth waiting rather than retrying.', 'err');
    }
    return say(error.message, 'err');
  }
  try { localStorage.setItem(RATE_KEY, String(Date.now())); } catch (_) {}
  if (offerEmailCode($('#send'), email, sendLink)) {
    return say('Email sent to ' + email + '. Open the link in it on this phone, or enter its code below.', 'ok');
  }
  say('Link sent. Open it on this device — it signs you in here, not where ' +
      'the email was read.', 'ok');
}
$('#send').addEventListener('click', () => sendLink());

/* ---------------------------------------------------------------- google ---
   One click, no inbox trip, and — the part that matters here — it costs
   NOTHING from the email allowance the magic link draws on. For a league
   secretary signing in on a phone at the scorer's table, that is the
   difference between working and waiting.

   THE BUTTON IS ONLY SHOWN IF THE PROVIDER IS ACTUALLY ENABLED, which has to
   be checked rather than assumed. signInWithOAuth does not return an error
   when a provider is off — it navigates immediately, and Supabase answers the
   navigation with a raw JSON page reading "Unsupported provider: provider is
   not enabled". The user is left staring at that with no way back, and any
   error handling on this page never runs because the page is gone.

   So the enabled providers are read from /auth/v1/settings first, and a button
   that would lead nowhere is simply not offered. */
async function googleAvailable() {
  const c = window.EPINOIA_CONFIG;
  if (!c || !c.supabaseUrl) return false;
  try {
    const r = await fetch(c.supabaseUrl + '/auth/v1/settings',
      { cache: 'no-store', headers: { apikey: c.supabaseAnonKey } });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j && j.external && j.external.google);
  } catch (_) { return false; }
}

(async function setUpGoogle() {
  const btn = $('#google');
  const or = document.querySelector('.or');
  if (!(await googleAvailable())) {
    /* hidden rather than disabled: a greyed-out button invites a click and a
       question, where its absence invites neither */
    if (btn) btn.hidden = true;
    if (or) or.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    if (!sb) return say('No Supabase key in config.js — signing in needs one.', 'err');
    btn.disabled = true;
    say('');
    const next = safeNext();
    const redirect = location.origin + location.pathname +
      (next ? '?next=' + encodeURIComponent(next) : '');
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirect,
        /* ask which account each time rather than silently reusing whichever
           Google session the browser holds — a shared scorer's laptop should
           not sign the next person in as the last one */
        queryParams: { prompt: 'select_account' }
      }
    });
    /* reaching here means the navigation did not happen */
    btn.disabled = false;
    if (error) say(error.message, 'err');
  });
})();

$('#signout').addEventListener('click', async () => {
  await (window.epinoiaSignOut ? window.epinoiaSignOut(sb) : sb.auth.signOut());
  say('Signed out.', 'ok');
  render();
});

/* Coming back from a provider that refused. Supabase puts the reason in the
   fragment, which no server sees and nothing reports unless it is looked for —
   without this the page would simply look as though nothing had happened. */
(function oauthError() {
  const h = new URLSearchParams((location.hash || '').replace(/^#/, ''));
  const q = new URLSearchParams(location.search);
  const err = h.get('error_description') || h.get('error') || q.get('error_description');
  if (!err) return;
  say(decodeURIComponent(String(err).replace(/\+/g, ' ')), 'err');
  /* keep only a next= this page would actually follow */
  const next = safeNext();
  history.replaceState(null, '', location.pathname +
    (next ? '?next=' + encodeURIComponent(next) : ''));
})();

/* arriving back from the emailed link */
if (sb) {
  sb.auth.onAuthStateChange(() => render());
}
render();
