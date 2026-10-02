'use strict';
/* ============================================================================
   MEMBERSHIP LOCK — the one way a control or a section says "members only".
                                                          window.EpinoiaMemLock

   WHAT IS LOCKED IS DECIDED IN ONE PLACE: access.js CATALOGUE.locks (today 'events'
   and 'csv'), through EpinoiaAccess.featureLocked(key, league). This file only DRAWS
   the answer, so a page never keeps a list of its own. The master switch keeps its
   meaning: while memberships are off (or the check cannot be made) nothing is locked
   and every function here does nothing at all.

     locked(key, league)        true only when the catalogue names the feature, gating
                                is on and this viewer lacks access. Fails open.
     lock(el, {what, league, passive})   make an element read and behave as locked: .mem-lock
                                (stop-sign cursor), aria-disabled, an explanatory
                                label, its action swallowed (click, Enter, Space, a
                                link's navigation) and a popup on hover / focus / tap:
                                'ACCESS IS MEMBERSHIP-ONLY' over 'Become a member'.
                                Returns unlock().
     apply(el, key, opts)       lock(el) when locked(key) -- and only then. Idempotent;
                                unlocks again if the answer has changed. Returns bool.
     set(el, bool, opts)        lock or unlock by a decision the page made itself
     guard(key, league, fn)     fn wrapped so it does not run while locked (for code
                                that starts an action without going through a click).
     placeholder(o)             a blurred block of dummy rows with the notice on it,
                                for a locked table or section: {rows, what, league}.
     tipText                    the exact popup words.

   Styles: kit/access.css (.mem-lock, .mem-tip, .mem-ph). UMD so node can test it.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMemLock = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const DOC = typeof document !== 'undefined' ? document : null;
const TIP_TEXT = 'ACCESS IS MEMBERSHIP-ONLY';
const TIP_LINK = 'Become a member';
let injected = null;            // node tests hand in a fake EpinoiaAccess

const access = () => injected || root.EpinoiaAccess || null;

function locked(key, league) {
  try {
    const A = access();
    return !!(A && typeof A.featureLocked === 'function' && A.featureLocked(key, league));
  } catch (_) { return false; }
}

/* ---------------------------------------------------------------- popup --- */
let tip = null, tipFor = null, hideT = 0;
function joinHref(o) {
  try { const A = access(); return A && A.joinHref ? A.joinHref(o) : '/epinoia/join/'; } catch (_) { return '/epinoia/join/'; }
}
function ensureTip() {
  if (tip || !DOC) return tip;
  tip = DOC.createElement('div');
  tip.className = 'mem-tip'; tip.id = 'mem-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  const a = DOC.createElement('b'); a.className = 'mem-tip-t'; a.textContent = TIP_TEXT;
  const l = DOC.createElement('a'); l.className = 'mem-tip-go'; l.textContent = TIP_LINK;
  const b = DOC.createElement('span'); b.className = 'mem-tip-b'; b.hidden = true;
  tip.append(a, l, b);
  tip.addEventListener('pointerenter', () => clearTimeout(hideT));
  tip.addEventListener('pointerleave', () => hide(120));
  DOC.body.appendChild(tip);
  DOC.addEventListener('keydown', e => { if (e.key === 'Escape') hide(0); });
  DOC.addEventListener('pointerdown', e => {
    if (tip && !tip.hidden && !tip.contains(e.target) && !(tipFor && tipFor.contains(e.target))) hide(0);
  }, true);
  return tip;
}
/* the popup's words: the platform's (access.js copyOf, 0222), the free trial promoted where there is one (0223) */
function words() {
  const A = access();
  const c = k => { try { return A && typeof A.copyOf === 'function' ? A.copyOf(k) : ''; } catch (_) { return ''; } };
  let trial = 0;
  try { trial = A && typeof A.trialMonths === 'function' ? A.trialMonths() : 0; } catch (_) { trial = 0; }
  return { text: (c('popupText') || TIP_TEXT).toUpperCase(), link: trial ? c('trialCta') : (c('popupLink') || TIP_LINK), badge: trial ? c('trialBadge') : '' };
}
function show(el, o) {
  if (!ensureTip()) return;
  clearTimeout(hideT);
  tipFor = el;
  const wd = words();
  tip.querySelector('.mem-tip-t').textContent = wd.text;
  tip.querySelector('.mem-tip-go').textContent = wd.link;
  const b = tip.querySelector('.mem-tip-b');
  b.textContent = wd.badge; b.hidden = !wd.badge;
  tip.querySelector('.mem-tip-go').href = joinHref({ leagueSlug: o && o.leagueSlug });
  tip.hidden = false;
  el.setAttribute('aria-describedby', 'mem-tip');
  /* The site sets a zoom on <body> (legibility): a fixed box inside it is placed in ZOOMED pixels, while the rect of the
     control and the viewport are in screen pixels. Work in screen pixels, place in zoomed ones. */
  let z = 1;
  try { z = parseFloat(root.getComputedStyle(DOC.body).zoom) || 1; } catch (_) { z = 1; }
  const r = el.getBoundingClientRect(), w = tip.offsetWidth * z, h = tip.offsetHeight * z;
  const vw = root.innerWidth || 400, vh = root.innerHeight || 700;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.max(8, Math.min(vw - w - 8, x));
  let y = r.bottom + 8;
  if (y + h > vh - 8) y = Math.max(8, r.top - h - 8);
  tip.style.left = (x / z) + 'px'; tip.style.top = (y / z) + 'px';
}
function hide(ms) {
  clearTimeout(hideT);
  const go = () => { if (tip) tip.hidden = true; if (tipFor) tipFor.removeAttribute('aria-describedby'); tipFor = null; };
  if (ms > 0) hideT = setTimeout(go, ms); else go();
}

/* ----------------------------------------------------------------- lock --- */
const LOCKS = typeof WeakMap === 'function' ? new WeakMap() : null;

function lock(el, o) {
  o = o || {};
  if (!el || !el.classList) return () => {};
  if (LOCKS && LOCKS.has(el)) return LOCKS.get(el).undo;
  const what = String(o.what || 'this');
  const prev = { label: el.getAttribute('aria-label'), title: el.getAttribute('title'), dis: el.getAttribute('aria-disabled') };
  el.classList.add('mem-lock');
  if (!o.passive) el.setAttribute('aria-disabled', 'true');
  el.setAttribute('aria-label', (prev.label || (el.textContent || '').trim() || what) + ' — locked, ' + TIP_TEXT.toLowerCase());
  el.removeAttribute('title');            // the popup is the explanation; a native tooltip would fight it
  el.dataset.memLock = '1';
  /* the action never runs: capture phase on the element itself, ahead of the page's own listeners */
  /* passive: the control still does its own thing (a locked preset opens its teaser); it only
     gets the cursor and the popup */
  const stop = e => { if (!o.passive) { e.preventDefault(); e.stopImmediatePropagation(); } };
  const onClick = e => { stop(e); if (o.passive) return; if (tipFor === el && tip && !tip.hidden) hide(0); else show(el, o); };
  const onKey = e => {
    if (!o.passive && (e.key === 'Enter' || e.key === ' ')) { stop(e); show(el, o); }
  };
  const onEnter = e => { if (e.pointerType !== 'touch') show(el, o); };
  const onLeave = () => hide(160);
  const onFocus = () => show(el, o);
  const onBlur = () => hide(160);
  /* Where the action listeners go: on the document in the capture phase in a browser, so they run ahead of whatever
     the page bound to the control itself, whenever that was; on the element under node (the tests' fake). */
  const onKeyUp = e => { if (e.key === ' ') stop(e); };
  const wired = [['click', onClick], ['keydown', onKey], ['keyup', onKeyUp]].map(([t, f]) => {
    if (!DOC) { el.addEventListener(t, f, true); return () => el.removeEventListener(t, f, true); }
    const h = e => { if (e.target && el.contains(e.target)) f(e); };
    DOC.addEventListener(t, h, true);
    return () => DOC.removeEventListener(t, h, true);
  });
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
  el.addEventListener('focus', onFocus);
  el.addEventListener('blur', onBlur);
  const undo = () => {
    wired.forEach(u => u());
    el.removeEventListener('pointerenter', onEnter);
    el.removeEventListener('pointerleave', onLeave);
    el.removeEventListener('focus', onFocus);
    el.removeEventListener('blur', onBlur);
    el.classList.remove('mem-lock'); delete el.dataset.memLock;
    if (prev.dis == null) el.removeAttribute('aria-disabled'); else el.setAttribute('aria-disabled', prev.dis);
    if (prev.label == null) el.removeAttribute('aria-label'); else el.setAttribute('aria-label', prev.label);
    if (prev.title != null) el.setAttribute('title', prev.title);
    if (tipFor === el) hide(0);
    if (LOCKS) LOCKS.delete(el);
  };
  if (LOCKS) LOCKS.set(el, { undo });
  return undo;
}

function set(el, now, o) {
  const has = !!(LOCKS && el && LOCKS.has(el));
  if (now && !has) lock(el, o);
  if (!now && has) LOCKS.get(el).undo();
  return !!now;
}
function apply(el, key, o) {
  o = o || {};
  const A = access();
  return set(el, locked(key, o.league), Object.assign({ what: (A && A.CATALOGUE && A.CATALOGUE.locks[key] || {}).label }, o));
}

function guard(key, league, fn) {
  return function () { return locked(key, league) ? undefined : fn.apply(this, arguments); };
}

/* a locked table or section: dummy rows, blurred, with the notice over them */
function placeholder(o) {
  o = o || {};
  if (!DOC) return null;
  const wrap = DOC.createElement('div');
  wrap.className = 'mem-ph mem-lock';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', String(o.what || 'These stats') + ' — locked, ' + TIP_TEXT.toLowerCase());
  const rows = DOC.createElement('div'); rows.className = 'mem-ph-rows'; rows.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < (o.rows || 6); i++) {
    const r = DOC.createElement('div'); r.className = 'mem-ph-row';
    for (let c = 0; c < 6; c++) r.appendChild(DOC.createElement('i'));
    rows.appendChild(r);
  }
  const note = DOC.createElement('div'); note.className = 'mem-ph-note';
  const t = DOC.createElement('b'); t.textContent = TIP_TEXT;
  const a = DOC.createElement('a'); a.href = joinHref({ leagueSlug: o.leagueSlug }); a.textContent = TIP_LINK;
  note.append(t, a);
  wrap.append(rows, note);
  return wrap;
}

return {
  locked, lock, set, apply, guard, placeholder, tipText: TIP_TEXT, tipLink: TIP_LINK,
  _test: { use(A) { injected = A || null; }, isLocked(el) { return !!(LOCKS && LOCKS.has(el)); } }
};
}));
