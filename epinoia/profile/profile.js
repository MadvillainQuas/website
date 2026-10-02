'use strict';
/* ============================================================================
   PROFILE — a fan's dashboard (2026-10-02; their public page on EPINOIA since 2026-09-30).

   The dashboard itself (the head they customise, their reports, what is coming up, the leagues, clubs and players
   they follow) is dashboard.js, mounted here once there is a session. Below it, their public page, as it was two
   sections of the old "Your profile" (me/, which is PERSONALISATION now):
     USERNAME      the public name (0163): EPINOIA GO's leaderboards and photos, and the address of the page
     YOUR PAGE     the state of the public page at fan/?u=<username> (a username, 18 or over, and public on
                   EPINOIA GO) and the editor of what it shows (me/fanprofile.js, 0197, reused as it is)
   Signed out, the page says so and sends to sign in, then back here. me/ forwards an old #username or
   #fanprofile link to this page.
   ============================================================================ */
const $ = s => document.querySelector(s);
let sb = null;

/* -------------------------------------------------------------- username ---
   THE PUBLIC NAME (0163): EPINOIA GO's leaderboards and photos show it, never the email. Checked
   while it is typed (username_check, which changes nothing) and saved by set_username, which applies
   every rule again - this page's checks are for the fan's benefit, the database's are the ones that
   hold. Before 0163 is applied the functions are missing and the section stays hidden. */
const UNAME_WHY = {
  short: 'At least 3 characters.',
  long: '20 characters at most.',
  start: 'Start with a letter.',
  characters: 'Letters, digits and underscores only.',
  reserved: 'That name is kept for EPINOIA itself.',
  blocked: 'Please choose a different name.',
  taken: 'Taken. Try another.',
  same: 'That is your username.'
};
const UNAME_FORMAT = /^[A-Za-z][A-Za-z0-9_]{2,19}$/;

/* A message is words and, where it names one, a username or a date. Each part is its own node: the words
   are text the language engine translates as it would anywhere, the name and the date are left alone
   (translate="no") - a username is never translated, and the date is already in the reader's language. */
function unameSay(parts, kind) {
  const m = $('#unameMsg');
  m.textContent = '';
  [].concat(parts || []).forEach(p => {
    if (p && typeof p === 'object') {
      const s = document.createElement('b');
      s.setAttribute('translate', 'no');
      s.textContent = p.name != null ? '@' + p.name : p.date;
      m.appendChild(s);
    } else if (p) m.appendChild(document.createTextNode(p));
  });
  m.className = 'uname-msg' + (kind ? ' ' + kind : '');
}
function unameWhen(iso) {
  const d = new Date(iso);
  const loc = (window.EpinoiaI18n && window.EpinoiaI18n.locale) || 'en-GB';
  return isNaN(d) ? '' : d.toLocaleDateString(loc, { day: 'numeric', month: 'long' });
}

/* the verdict this page can give without asking: the format */
function unameLocal(v) {
  if (v.length < 3) return 'short';
  if (v.length > 20) return 'long';
  if (!/^[A-Za-z]/.test(v)) return 'start';
  if (!UNAME_FORMAT.test(v)) return 'characters';
  return '';
}

async function paintUsername() {
  const { data, error } = await sb.rpc('my_username');
  if (error) return;                                  // no 0163 yet: the section stays hidden
  const sec = $('#username');
  sec.classList.remove('hide');
  let current = data || '';
  let asked = 0;
  let timer = null;
  const input = $('#unameIn'), save = $('#unameSave');
  input.value = current;
  const lead = () => unameSay(current ? '' : 'You have not chosen one yet.', current ? '' : 'bad');
  lead();

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const v = input.value.trim();
    save.disabled = true;
    if (!v || v === current) { lead(); if (v === current && current) unameSay(UNAME_WHY.same, 'ok'); return; }
    const local = unameLocal(v);
    if (local) { unameSay(UNAME_WHY[local], 'bad'); return; }
    unameSay('Checking…');
    const n = ++asked;
    timer = setTimeout(async () => {
      const { data: r, error: e } = await sb.rpc('username_check', { p: v });
      if (n !== asked) return;                        // a later keystroke has its own answer coming
      if (e || !r) { unameSay('Could not check just now.', 'bad'); return; }
      if (r.ok) { unameSay([{ name: v }, ' is available.'], 'ok'); save.disabled = false; }
      else unameSay(UNAME_WHY[r.reason] || 'Please choose a different name.', 'bad');
    }, 350);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !save.disabled) save.click(); });

  save.addEventListener('click', async () => {
    const v = input.value.trim();
    save.disabled = true;
    unameSay('Saving…');
    const { data: r, error: e } = await sb.rpc('set_username', { p: v });
    if (e || !r) { unameSay('Not saved: ' + ((e && e.message) || 'try again'), 'bad'); save.disabled = false; return; }
    if (r.ok) {
      current = r.username;
      input.value = current;
      unameSay(['Saved. Your username is', ' ', { name: current }], 'ok');
      try { window.dispatchEvent(new CustomEvent('epinoia:username', { detail: { username: current } })); } catch (_) { /* a nicety */ }
      return;
    }
    if (r.reason === 'too_soon') unameSay(['You can change it again on', ' ', { date: unameWhen(r.next_change_at) }], 'bad');
    else unameSay(UNAME_WHY[r.reason] || 'Please choose a different name.', 'bad');
  });

  if (location.hash === '#username') {
    try { sec.scrollIntoView({ block: 'start' }); input.focus({ preventScroll: true }); } catch (_) { /* old browser */ }
  }
}

/* ---------------------------------------------------------- your page --- */
function mountPage() {
  const E = window.EpinoiaFanProfileEditor;
  if (!E) return Promise.resolve();
  return E.mount({ host: '#fpHost', sec: '#fanprofile', state: '#fpState', stateSec: '#public', sb });
}

/* ----------------------------------------------------------------- boot --- */
(async function boot() {
  sb = window.epinoiaClient && window.epinoiaClient();
  const { data: { session } } = sb ? await sb.auth.getSession() : { data: { session: null } };
  if (!session) { $('#signedout').classList.remove('hide'); return; }
  $('#signedout').remove();
  if (window.EpinoiaDashboard) window.EpinoiaDashboard.mount({ sb, session }).catch(() => { /* the page's own head stays */ });
  paintUsername().catch(() => { /* hidden, as before 0163 */ });
  mountPage()
    .then(() => {
      if (location.hash !== '#fanprofile' && location.hash !== '#public') return;
      try { $(location.hash).scrollIntoView({ block: 'start' }); } catch (_) { /* old browser */ }
    })
    .catch(() => { /* hidden, as before 0197 */ });
  /* a username chosen here changes what the page's state says, and the head's @name: draw them again */
  window.addEventListener('epinoia:username', () => {
    mountPage().catch(() => { /* kept as it was */ });
    if (window.EpinoiaDashboard) window.EpinoiaDashboard.mount({ sb, session }).catch(() => { /* kept as it was */ });
  });
})();
