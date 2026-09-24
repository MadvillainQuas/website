'use strict';
/* ============================================================================
   THE EPINOIA GO LOGO, WHEREVER THE NAME IS WRITTEN (Louie, 2026-09-24).

   EPINOIΛ in the logotype (EpinoiaMark) and GO in Orbitron, lit in the site's green: the same pair as the
   rail's row (nav.js goRow). Two ways in:

     EpinoiaGoLogo.make({ size })   one logo element - 'hero' (the GO page's), 'head' (a page's heading)
                                    or nothing (inline, sized to the text around it)
     EpinoiaGoLogo.brandify(root)   every "EPINOIA GO" written in text under root becomes the logo

   A page that loads this file is brandified by itself: once translated (EpinoiaI18n.whenReady - Japanese
   and Spanish keep the name as it is, so it is found in any language), and again whenever text arrives
   later. The text around a logo is wrapped with data-i18n="off", because it has been translated already:
   the halves of a sentence are not phrases, and translating them again would only miss.

   Skipped: the rail (it draws its own), form fields, <title> (a browser tab cannot take a font), and
   anything marked data-go-logo="off".
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.EpinoiaGoLogo = api; if (typeof document !== 'undefined') api.auto(); }
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const NAME = /EPINOI[AΛ] GO/g;
const SKIP = 'script,style,title,noscript,textarea,input,select,option,.go-logo,.ep-nav,[contenteditable],[data-go-logo="off"]';

function make(opts) {
  const o = opts || {};
  const box = document.createElement('span');
  box.className = 'go-logo' + (o.size ? ' ' + o.size : ' inline');
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', 'EPINOIA GO');
  box.setAttribute('translate', 'no');
  box.setAttribute('data-i18n', 'off');
  const ep = document.createElement('span');
  ep.className = 'gl-ep';
  ep.textContent = 'EPINOIΛ';
  ep.setAttribute('aria-hidden', 'true');
  const go = document.createElement('span');
  go.className = 'gl-go';
  go.textContent = 'GO';
  go.setAttribute('aria-hidden', 'true');
  box.append(ep, go);
  return box;
}

/* the pieces of one text: plain strings and null where a logo goes */
function split(text) {
  const out = [];
  let last = 0;
  NAME.lastIndex = 0;
  for (let m = NAME.exec(text); m; m = NAME.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(null);
    last = m.index + m[0].length;
  }
  if (!out.length) return null;
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function brandify(root) {
  if (!root || typeof document === 'undefined') return 0;
  const hits = [];
  const test = n => n.nodeType === 3 && n.nodeValue && n.nodeValue.indexOf(' GO') >= 0 && split(n.nodeValue)
    && !(n.parentElement && n.parentElement.closest(SKIP));
  if (root.nodeType === 3) { if (test(root)) hits.push(root); }
  else if (root.nodeType === 1 && !root.closest(SKIP)) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (test(n)) hits.push(n);
  }
  hits.forEach(n => {
    const wrap = document.createElement('span');
    wrap.setAttribute('data-i18n', 'off');
    wrap.className = 'go-logo-text';
    // a heading's name is the heading: the logo takes its size rather than the inline one
    const head = n.parentElement && /^H[1-6]$/.test(n.parentElement.tagName) ? 'head' : undefined;
    split(n.nodeValue).forEach(p => wrap.appendChild(p == null ? make({ size: head }) : document.createTextNode(p)));
    n.parentNode.replaceChild(wrap, n);
  });
  return hits.length;
}

let watching = false;
function auto() {
  const go = () => {
    brandify(document.body);
    if (watching || typeof MutationObserver === 'undefined') return;
    watching = true;
    // made after the translator's own observer, so it sees each text already translated
    new MutationObserver(recs => {
      for (const r of recs) {
        if (r.type === 'childList') r.addedNodes.forEach(n => brandify(n));
        else if (r.type === 'characterData') brandify(r.target);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  const ready = () => (window.EpinoiaI18n && window.EpinoiaI18n.whenReady ? window.EpinoiaI18n.whenReady(go) : go());
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
}

return { make, brandify, split, auto };
}));
