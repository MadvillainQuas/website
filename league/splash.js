'use strict';
/* ============================================================================
   THE SPLASH — what /league/ is when no league has been asked for.

   The league splash (/league/?l=slug) is a different page in the same document
   and is deliberately untouched by any of this: home.js decides which of the
   two to show, and everything here runs only in the first case.

   Three things it does that are worth knowing about.

   SIGNING IN HAPPENS HERE. Not on a page you are sent to and returned from —
   the whole point of a landing page is that you arrive and you are in. It is
   the same two routes the sign-in page offers, for the same reasons: Google
   first because it is one click and costs nothing from the email allowance,
   and a magic link as the fallback, rate limited locally because that
   allowance is shared with the whole project and a double-clicked button
   should not cost somebody their afternoon.

   THE SCORER'S THREE DOORS ARE NOT THE SAME DOOR. Scoring a real game needs an
   account and a fixture, so it is refused where it cannot work rather than
   sending somebody to a page that will refuse them. Training needs nothing at
   all and says so. Learning more is a page, not an app.

   THE LEAGUES SEGMENT THEMSELVES. However many there are, that is how many
   slices the stone is cut into.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSplash = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const $ = s => document.querySelector(s);

const RATE_KEY = 'epinoia.lastMagicLink';
const RATE_MS = 45000;

function monogram(name) {
  const w = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase();
  return w.slice(0, 2).map(x => x[0]).join('').toUpperCase();
}

/* ================================================================ sign in === */
function signIn(sb, cfg) {
  const host = $('#spLogin');
  if (!host) return;
  const msg = (t, k) => {
    const m = $('#spMsg');
    m.textContent = t || ''; m.className = 'sp-msg ' + (k || '');
  };

  let token = 0;
  async function draw() {
    /* ONE DRAW AT A TIME. onAuthStateChange fires INITIAL_SESSION the instant
       it is subscribed, so the mount call and the listener were both awaiting
       getSession() when the other cleared the host — and the panel rendered
       twice. The token means the slower of two overlapping draws throws its
       work away instead of appending it. */
    const mine = ++token;
    const stale = () => mine !== token;
    host.textContent = '';
    if (!sb) {
      host.appendChild(el('h2', null, 'Sign in'));
      host.appendChild(el('div', 'sp-msg err',
        'No Supabase key in config.js — signing in needs one.'));
      return;
    }
    const { data: { session } } = await sb.auth.getSession();
    if (stale()) return;

    if (session) {
      /* SIGNED IN IS ALSO A STATE THIS PANEL HAS. Landing on a page that still
         says "sign in" when you already are is the commonest way a login on a
         splash screen feels broken. */
      host.appendChild(el('h2', null, 'Signed in'));
      const row = el('div', 'sp-who');
      row.appendChild(el('span', 'em', session.user.email || 'your account'));
      const out = el('button', 'sp-btn ghost', 'sign out');
      out.type = 'button';
      out.addEventListener('click', async () => {
        await sb.auth.signOut();
        msg('Signed out.', 'ok');
        draw(); gate(sb);
      });
      const manage = el('a', 'sp-btn ghost', 'account');
      manage.href = 'signin/';
      row.append(manage, out);
      host.appendChild(row);
      host.appendChild(el('div', 'sp-msg')).id = 'spMsg';
      return;
    }

    host.appendChild(el('h2', null, 'Sign in'));

    /* GOOGLE IS ALWAYS HERE. It used to hide itself until a probe confirmed
       the provider was switched on, which is defensible and was wrong: on a
       splash screen the two ways in are part of the composition, and one of
       them appearing a beat later — or not at all — reads as a broken page
       rather than as a considered absence.

       The probe still runs, but it now decides what a CLICK does rather than
       whether the button exists. That matters because signInWithOAuth does
       NOT return an error for a disabled provider: it navigates, and Supabase
       answers with a raw JSON page there is no way back from. So a click
       while the provider is off says so, in place, and the visitor still has
       the email field. */
    const g = el('button', 'sp-btn ghost', 'Continue with Google');
    g.type = 'button';
    g.style.width = '100%';
    host.appendChild(g);
    host.appendChild(el('div', 'sp-or', 'or'));

    const row = el('div', 'sp-row');
    const email = el('input', 'sp-in');
    email.type = 'email'; email.placeholder = 'you@club.org';
    email.autocomplete = 'email';
    const send = el('button', 'sp-btn', 'email me a link');
    send.type = 'button';
    row.append(email, send);
    host.appendChild(row);
    host.appendChild(el('div', 'sp-msg', ''))
        .id = 'spMsg';

    send.addEventListener('click', () => sendLink(sb, email, send, msg));
    email.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendLink(sb, email, send, msg);
    });

    /* Resolved once, in the background, and read at click time. `null` means
       the probe has not answered yet — treated as "go", because the common
       case is that it IS enabled and a visitor who clicks the instant the
       page paints should not be told no. */
    let googleOn = null;
    googleEnabled(cfg).then(v => { if (!stale()) googleOn = v; });

    g.addEventListener('click', async () => {
      if (googleOn === false) {
        return msg('Google sign-in is not switched on for this site yet — ' +
                   'use the email link below.', 'warn');
      }
      g.disabled = true; msg('');
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: location.origin + location.pathname,
          /* ask which account every time: a shared scorer's laptop must not
             sign the next person in as the last one */
          queryParams: { prompt: 'select_account' }
        }
      });
      g.disabled = false;
      if (error) msg(error.message, 'err');
    });
  }

  async function googleEnabled(cfg) {
    if (!cfg || !cfg.supabaseUrl) return false;
    try {
      const r = await fetch(cfg.supabaseUrl + '/auth/v1/settings',
        { cache: 'no-store', headers: { apikey: cfg.supabaseAnonKey } });
      if (!r.ok) return false;
      const j = await r.json();
      return !!(j && j.external && j.external.google);
    } catch (_) { return false; }
  }

  async function sendLink(sb, email, btn, msg) {
    const v = (email.value || '').trim();
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v)) {
      return msg('That email address does not look right.', 'err');
    }
    let last = 0;
    try { last = Number(localStorage.getItem(RATE_KEY) || 0); } catch (_) {}
    const wait = RATE_MS - (Date.now() - last);
    if (wait > 0) {
      return msg('A link was just sent. Give it ' + Math.ceil(wait / 1000) +
                 ' seconds — they are rationed across the whole project.', 'warn');
    }
    btn.disabled = true;
    const label = btn.textContent; btn.textContent = 'sending…';
    const { error } = await sb.auth.signInWithOtp({
      email: v, options: { emailRedirectTo: location.origin + location.pathname }
    });
    btn.disabled = false; btn.textContent = label;
    if (error) {
      if (/rate|limit|too many/i.test(error.message || '')) {
        return msg('The email allowance is exhausted for now — it resets within ' +
                   'the hour. It is shared across the project, so waiting beats ' +
                   'retrying.', 'err');
      }
      return msg(error.message, 'err');
    }
    try { localStorage.setItem(RATE_KEY, String(Date.now())); } catch (_) {}
    msg('Link sent. Open it on this device — it signs you in here, not where ' +
        'the email was read.', 'ok');
  }

  draw();
  sb && sb.auth.onAuthStateChange(() => { draw(); gate(sb); });
}

/* ============================================================ the scorer === */
/* "Score a game" is refused where it cannot work rather than sending somebody
   to a page that will refuse them. The other two need nothing. */
async function gate(sb) {
  const seg = $('#segScore');
  if (!seg) return;
  const set = (ok, why) => {
    seg.classList.toggle('off', !ok);
    seg.querySelector('.d').textContent = why;
    if (ok) { seg.setAttribute('href', 'score/'); seg.removeAttribute('aria-disabled'); }
    else { seg.removeAttribute('href'); seg.setAttribute('aria-disabled', 'true'); }
  };
  if (!sb) return set(false, 'Signing in is not configured on this build.');
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return set(false, 'Sign in above first — a real game is written to a real fixture.');
  let who = {};
  try { const { data } = await sb.rpc('whoami'); who = data || {}; } catch (_) {}
  const may = !!who.is_platform_admin || (who.scoring || []).length ||
              (who.leagues || []).length || (who.teams || []).length;
  set(may, may ? 'Opens the fixture list you are assigned to.'
                : 'Your account has no fixtures assigned. Ask your league to add you.');
}

/* ============================================================ the leagues === */
/* THE LEAGUES DECK IS ONE DOOR NOW, not a shelf of them.

   It used to list every league on the platform as a slice of the stone, which
   worked at one league and would not have worked at forty — and it put the
   whole directory on a landing page whose job is to point at things. So the
   deck says how many there are and where they are, and the Countries page is
   where the choosing happens.

   The count is still read live, because "3 countries · 5 leagues" is the one
   thing that makes the door worth opening, and a door that says nothing about
   what is behind it is a door people do not try. */
async function leagues(api, cfg) {
  const host = $('#segLeagues');
  if (!host) return;
  let ls = [];
  try {
    ls = await api('leagues?select=slug,name,country&order=name');
  } catch (_) { /* the segment still renders, without the count */ }

  host.textContent = '';
  host.className = 'segs';
  host.style.gridTemplateColumns = '1fr';

  if (!ls.length) {
    const s = el('div', 'seg off');
    s.append(el('span', 'k', 'leagues'), el('span', 't', 'None yet'),
             el('span', 'd', 'A league appears here the moment one is created.'));
    host.appendChild(s);
    return;
  }

  const countries = new Set(ls.map(l => (l.country || '').toUpperCase()));
  const nC = countries.size;
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  const a = el('a', 'seg league');
  a.href = 'countries/';
  a.setAttribute('aria-label', 'Browse the leagues by country');
  const crest = el('div', 'crest');
  crest.appendChild(el('span', 'mono', '◇'));
  a.append(crest,
    el('span', 'k', 'by country'),
    el('span', 't', 'Browse leagues'),
    el('span', 'd', plural(nC, 'country') + ' · ' + plural(ls.length, 'league') +
       '. Tables, fixtures and season statistics.'));
  host.appendChild(a);
}

/* ================================================================== mount === */
function mount(opts) {
  /* THE LEAGUE LIST FIRST, AND WITHOUT WAITING FOR ANYTHING.

     It is a plain anonymous read, so it needs no SDK — and it is the content of
     the page, where the sign-in box is a control in the corner. Asking for the
     207kB auth bundle before drawing the four ways in is the wrong order, and
     it was the order: the bundle was a blocking script tag, so nothing on this
     page happened until it landed.

     The sign-in slab fills itself in a moment later. That is the honest
     trade — a login box that appears a beat after the page it is on, rather
     than a page that waits for a login box. */
  leagues(opts.api, opts.cfg);

  window.epinoiaClientReady().then(sb => {
    signIn(sb, opts.cfg);
    gate(sb);
  }).catch(() => {
    /* No SDK, no auth. The rest of the splash is unaffected, which is the point
       of it not being in the way. */
    signIn(null, opts.cfg);
  });
}

return { mount };
}));
