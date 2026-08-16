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
const sb = window.courtsideClient && window.courtsideClient();
const params = new URLSearchParams(location.search);

/* where to go back to once signed in — same-origin paths only, because an
   open redirect in a sign-in page is how phishing gets a real domain in the
   address bar */
function safeNext() {
  const n = params.get('next') || '';
  if (!n.startsWith('/') || n.startsWith('//')) return null;
  return n;
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

/* ------------------------------------------------------------------ send --- */
const RATE_KEY = 'cs-signin-last';
const RATE_MS = 60000;

$('#send').addEventListener('click', async () => {
  const email = $('#email').value.trim();
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
  say('Link sent. Open it on this device — it signs you in here, not where ' +
      'the email was read.', 'ok');
});

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
  const c = window.COURTSIDE_CONFIG;
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
  await sb.auth.signOut();
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
  history.replaceState(null, '', location.pathname +
    (q.get('next') ? '?next=' + encodeURIComponent(q.get('next')) : ''));
})();

/* arriving back from the emailed link */
if (sb) {
  sb.auth.onAuthStateChange(() => render());
}
render();
