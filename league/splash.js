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

    /* Google first, and only if it is actually enabled. signInWithOAuth does
       not error for a disabled provider — it navigates, and Supabase answers
       with a raw JSON page saying so, from which there is no way back. */
    const g = el('button', 'sp-btn ghost', 'Continue with Google');
    g.type = 'button'; g.hidden = true;
    g.style.width = '100%';
    host.appendChild(g);
    const or = el('div', 'sp-or', 'or');
    or.hidden = true;
    host.appendChild(or);

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

    if (await googleEnabled(cfg)) {
      if (stale()) return;
      g.hidden = false; or.hidden = false;
      g.addEventListener('click', async () => {
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
async function leagues(api, cfg) {
  const host = $('#segLeagues');
  if (!host) return;
  let ls = [];
  try {
    ls = await api('leagues?select=id,slug,name,colour_a,colour_b,logo_path&order=name');
  } catch (_) { /* handled below */ }

  host.textContent = '';
  if (!ls.length) {
    const s = el('div', 'seg off');
    s.append(el('span', 'k', 'leagues'), el('span', 't', 'None yet'),
             el('span', 'd', 'A league appears here the moment one is created.'));
    host.appendChild(s);
    host.className = 'segs';
    return;
  }
  /* however many there are, that is how many slices the stone is cut into —
     up to four across, because a fifth would be unreadable at this size */
  host.className = 'segs';
  host.style.gridTemplateColumns = 'repeat(' + Math.min(ls.length, 4) + ', 1fr)';

  ls.forEach(l => {
    const a = el('a', 'seg league');
    a.href = './?l=' + encodeURIComponent(l.slug);
    a.setAttribute('aria-label', l.name);
    const crest = el('div', 'crest');
    if (l.logo_path && cfg && cfg.supabaseUrl) {
      const img = document.createElement('img');
      img.src = cfg.supabaseUrl + '/storage/v1/object/public/' + l.logo_path;
      img.alt = '';
      img.loading = 'lazy';
      /* a logo that fails to load falls back to the monogram rather than
         leaving the segment blank */
      img.addEventListener('error', () => {
        img.remove(); crest.appendChild(el('span', 'mono', monogram(l.name)));
      });
      crest.appendChild(img);
    } else {
      crest.appendChild(el('span', 'mono', monogram(l.name)));
    }
    a.append(crest, el('span', 'k', 'league'), el('span', 't', l.name),
             el('span', 'd', 'Table, fixtures and season statistics.'));
    host.appendChild(a);
  });
}

/* ================================================================== mount === */
function mount(opts) {
  const sb = window.epinoiaClient && window.epinoiaClient();
  signIn(sb, opts.cfg);
  gate(sb);
  leagues(opts.api, opts.cfg);
}

return { mount };
}));
