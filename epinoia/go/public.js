'use strict';
/* ============================================================================
   GOING PUBLIC IN ONE TAP (EPINOIA GO, migration 0177).

   One switch for what a fan shows: their username and numbers on the leaderboards, their stamps on the
   feed, and - later - a public profile. A fan needs a username and to be 18 or over; this asks for nothing
   else. The button that turns it on says "I am 18 or over" until the fan has said so once, so the tap is
   the confirmation; a fan with no username is asked for one in the same card, and the two are saved one
   after the other.

   Two shapes of the same thing: a `card` (the leaderboard section and the stamps page: says what going
   public means, and what it is now) and a `strip` (one line beside the feed, the wall and a fresh stamp,
   drawn only for a fan who is not public yet).

   Before 0177 is applied the switch still works: set_go_profile is not there, so it falls back to
   set_go_public (the leaderboards) and the card does not ask about stamps.

   Nothing here reads the page: the page hands over its rpc(), the fan's go_my_settings() and a function to
   call when the choice changed.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGoPublic = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ---------------------------------------------------------------- pure --- */

const NAME_FORMAT = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;
/* the username's words: the same ones the intro and the profile page use, so one translation serves all */
const NAME_WHY = {
  short: 'At least 3 characters.',
  long: '20 characters at most.',
  start: 'Start with a letter.',
  characters: 'Letters, digits and underscores only.',
  reserved: 'That name is kept for EPINOIA itself.',
  blocked: 'Please choose a different name.',
  taken: 'Taken. Try another.',
};
const SAVE_FAILED = 'It did not save. Try again in a moment.';

function nameProblem(v) {
  if (v.length < 3) return 'short';
  if (v.length > 20) return 'long';
  if (!/^[A-Za-z]/.test(v)) return 'start';
  if (!NAME_FORMAT.test(v)) return 'characters';
  return '';
}

/* where a fan stands, from go_my_settings():
     null    signed out (or the settings are not on the server yet): nothing to offer
     'name'  no username yet
     'off'   has a username, not public
     'boards' on the leaderboards, stamps not shown (joined before 0177)
     'on'    public: leaderboards and stamps
   `stamps` missing means 0177 is not applied: the leaderboards are all there is, and that is 'on'. */
function stateOf(st) {
  if (!st || typeof st !== 'object') return null;
  if (st.public) return st.stamps === false ? 'boards' : 'on';
  return st.username ? 'off' : 'name';
}

/* ---------------------------------------------------------------- page --- */

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };

/* what the button says: the tap is the confirmation of age until the fan has confirmed it once */
function goLabel(st) { return st && st.adult ? 'go public' : 'I am 18 or over · go public'; }

/* Draw the choice into `host`.
   o.rpc(fn, body)   -> { data } | { missing } | { error }
   o.settings        the fan's go_my_settings()
   o.variant         'card' (default) or 'strip'
   o.ready()         optional, awaited before a call (a fresh session)
   o.changed(st)     called with the new settings after a change
   o.homeHref        where a fan with no username goes to choose one, from a strip
   msg               a line to show under it (the result of the last change) */
function mount(host, o, msg) {
  if (!host) return;
  host.textContent = '';
  const st = o.settings;
  const s = stateOf(st);
  if (!s) return;
  const strip = o.variant === 'strip';
  if (strip && s === 'on') return;                        // nothing to ask a fan who is already public
  const box = host.appendChild(el('div', 'gpub' + (strip ? ' strip' : '') + (s === 'on' ? ' is-on' : '')));
  const text = box.appendChild(el('div', 'gpub-t'));
  const acts = box.appendChild(el('div', 'gpub-a'));
  const say = box.appendChild(el('div', 'gpub-msg'));
  say.setAttribute('role', 'status');
  if (msg) say.textContent = msg;
  let input = null, goBtn = null;

  const button = (label, cls, fn) => {
    const b = acts.appendChild(el('button', 'ep-btn' + (cls ? ' ' + cls : ''), label));
    b.type = 'button';
    b.addEventListener('click', () => fn(b));
    return b;
  };

  const flag = (on, b) => act(host, o, st, on, input, b, say);

  if (s === 'on') {
    text.appendChild(el('b', null, 'You are public'));
    const who = text.appendChild(el('span'));
    who.appendChild(el('span', null, 'Your username'));
    who.appendChild(document.createTextNode(': '));
    who.appendChild(data('b', 'at', '@' + (st.username || '')));
    text.appendChild(el('span', null, 'Your stamps are on the feed, and you are on the leaderboards.'));
    button('go private', '', b => flag(false, b));
  } else if (s === 'boards') {
    text.appendChild(el('b', null, strip ? 'Your stamps are not on the feed yet' : 'You are on the leaderboards'));
    if (!strip) text.appendChild(el('span', null, 'Show your stamps on the feed too?'));
    button('show my stamps', 'pri', b => flag(true, b));
    if (!strip) button('take me off', '', b => flag(false, b));
  } else if (s === 'name') {
    text.appendChild(el('b', null, strip ? 'Want your stamps on the feed?' : 'Go public'));
    if (strip) {
      text.appendChild(el('span', null, 'Choose a username first.'));
      const a = acts.appendChild(el('a', 'ep-btn pri', 'choose one'));
      a.href = o.homeHref || '#goPublic';
    } else {
      text.appendChild(el('span', null, 'Choose a username first: it is how everyone sees you.'));
      input = text.appendChild(el('input', 'ep-input gpub-name'));
      input.type = 'text';
      input.maxLength = 20;
      input.autocomplete = 'off';
      input.autocapitalize = 'off';
      input.spellcheck = false;
      input.placeholder = 'username';
      input.setAttribute('aria-label', 'username');
      input.setAttribute('translate', 'no');
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (goBtn) goBtn.click(); } });
      goBtn = button(goLabel(st), 'pri', b => flag(true, b));
    }
  } else {
    text.appendChild(el('b', null, strip ? 'Want your stamps on the feed?' : 'Go public'));
    if (!strip) {
      text.appendChild(el('span', null,
        'Your username and your stamps show to everyone, on the feed and the leaderboards. Never your email or your notes, and you can go private any time.'));
    }
    button(goLabel(st), 'pri', b => flag(true, b));
  }
}

async function act(host, o, st, on, input, btn, say) {
  btn.disabled = true;
  say.textContent = '';
  if (o.ready) { try { await o.ready(); } catch (_) { /* the call says if it matters */ } }
  const fail = m => { btn.disabled = false; say.textContent = m; };

  if (on && !st.username) {
    const v = input ? input.value.trim() : '';
    const bad = nameProblem(v);
    if (bad) return fail(NAME_WHY[bad]);
    const n = await o.rpc('set_username', { p: v });
    if (!n.data || !n.data.ok) return fail((n.data && NAME_WHY[n.data.reason]) || NAME_WHY.blocked);
    try { window.dispatchEvent(new CustomEvent('epinoia:username', { detail: { username: n.data.username } })); } catch (_) { /* a nicety */ }
  }

  /* the tap that shows the button saying "18 or over" is the confirmation; when the fan has confirmed
     before, the server knows it and ignores this */
  let r = await o.rpc('set_go_profile', { p_on: !!on, p_adult: !!on });
  if (r.missing) r = await o.rpc('set_go_public', { p_public: !!on, p_adult: !!on });
  if (r.missing || r.error || !r.data) return fail(SAVE_FAILED);
  if (!r.data.ok) {
    return fail({ adult: 'Confirm you are 18 or over.', username: 'Choose a username first.', signed_out: 'Sign in first.' }[r.data.reason] || SAVE_FAILED);
  }
  const fresh = await o.rpc('go_my_settings');
  const next = fresh.data && !fresh.missing ? fresh.data : Object.assign({}, st, { public: !!on, stamps: !!on });
  o.settings = next;
  if (o.changed) { try { await o.changed(next); } catch (_) { /* the page redraws itself */ } }
  mount(host, o);                                         // the card changing is the confirmation
}

return { mount, stateOf, nameProblem, goLabel, NAME_WHY, NAME_FORMAT };
}));
