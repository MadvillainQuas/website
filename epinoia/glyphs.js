/* ============================================================================
   A LETTER THE DISPLAY FACE CANNOT DRAW IS TRANSLITERATED, NOT BORROWED.

   Jersey 25 (headings, scores) and Silkscreen (labels, eyebrows) are pixel faces subset to Latin-1:
   é, ö, ñ are there; Ę, Ż, Ł, Š, Ğ, Ő are not. The browser draws a missing letter in a fallback
   font, so "1 LIGA MĘŻCZYZN" came out as a pixel word with two smooth letters in it. Under those
   two faces only, such a letter becomes its plain form - Ę -> E, Ł -> L, Š -> S - and the rest of
   the text is untouched. Archivo (names, prose) and every other face keep the real spelling, a
   letter the face DOES have (Ó, É, Ñ) is never changed, and a script with no Latin form (Japanese,
   Cyrillic, Greek) is left for the fallback font, which is right for it.

   What each face covers is read from its woff2 by tools/font-coverage.py and written below; it is
   not typed by hand. Everything is decided per text node by the font the page actually gives it
   (getComputedStyle), so no page has to opt in, and text drawn later (a live score, a translated
   heading, a table filled after a fetch) is caught by one MutationObserver. A node with nothing
   outside Latin-1 in it costs one regular-expression test.
   ============================================================================ */
(function () {
  'use strict';
  /* coverage:begin (tools/font-coverage.py) */
  var COVER = {
    'Jersey25': 'a0-a3,a5,a7-ab,ae-b0,b4,b6-b8,ba-bb,bf-ff,102,131,152-153,2c6,2da,2dc,300-301,303-304,308,2013-2014,2018-201a,201c-201e,2022,2026,2039-203a,20ac,2122,2212',
    'Silkscreen': 'a0-ff,152-153,2c6,2dc,300-301,303-304,308,2013-2014,2018-201a,201c-201e,2022,2026,2039-203a,20ac,2122',
  };
  /* coverage:end */

  // letters with no decomposition to a base letter
  var PLAIN = { 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'Ħ': 'H', 'ħ': 'h', 'ı': 'i', 'Ŧ': 'T', 'ŧ': 't',
    'Ŀ': 'L', 'ŀ': 'l', 'Œ': 'OE', 'œ': 'oe', 'ĸ': 'k', 'Ŋ': 'N', 'ŋ': 'n', 'ſ': 's', 'ƒ': 'f',
    'Ø': 'O', 'ø': 'o', 'Æ': 'AE', 'æ': 'ae', 'Þ': 'TH', 'þ': 'th', 'ß': 'ss', 'Ð': 'D', 'ð': 'd' };
  // Latin Extended-A/B and Additional: the only letters this file ever changes
  var CANDIDATE = /[\u00c0-\u024f\u1e00-\u1eff]/;

  var sets = {};
  function covers(fam) {
    if (sets[fam]) return sets[fam];
    var s = {};
    String(COVER[fam] || '').split(',').forEach(function (r) {
      if (!r) return;
      var p = r.split('-'), a = parseInt(p[0], 16), b = parseInt(p[1] || p[0], 16);
      for (var c = a; c <= b; c++) s[c] = 1;
    });
    return (sets[fam] = s);
  }
  function has(set, ch) {
    for (var i = 0; i < ch.length; i++) {
      var c = ch.charCodeAt(i);
      if (c > 0x7f && !set[c]) return false;
    }
    return true;
  }
  /** One letter in the plain form the face can draw, or the letter itself when there is none. */
  function plainLetter(ch, set) {
    if (set[ch.charCodeAt(0)]) return ch;
    var p = PLAIN[ch];
    if (p && has(set, p)) return p;
    var base = ch.normalize ? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : ch;
    return base && base !== ch && has(set, base) ? base : ch;
  }
  /** The text as the face `fam` can draw it (exported for tests). */
  function transliterate(text, fam) {
    if (!COVER[fam] || !CANDIDATE.test(text)) return text;
    var set = covers(fam), out = '';
    for (var i = 0; i < text.length; i++) out += CANDIDATE.test(text[i]) ? plainLetter(text[i], set) : text[i];
    return out;
  }
  function faceOf(el) {
    var ff = (getComputedStyle(el).fontFamily || '').split(',')[0].replace(/["']/g, '').trim();
    return COVER[ff] ? ff : null;
  }

  function fixNode(n) {
    var t = n.nodeValue;
    if (!t || !CANDIDATE.test(t) || !n.parentElement) return;
    var el = n.parentElement;
    if (el.closest('script,style,textarea,[contenteditable="true"]')) return;
    var fam = faceOf(el);
    if (!fam) return;
    var v = transliterate(t, fam);
    if (v !== t) n.nodeValue = v;
  }
  function walk(root) {
    if (root.nodeType === 3) return fixNode(root);
    if (root.nodeType !== 1 || !CANDIDATE.test(root.textContent || '')) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) fixNode(n);
  }

  if (typeof window !== 'undefined') window.EpinoiaGlyphs = { transliterate: transliterate, COVER: COVER };
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;

  function start() {
    walk(document.body);
    new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.type === 'characterData') fixNode(r.target);
        else for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]);
      }
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
