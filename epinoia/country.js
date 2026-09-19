'use strict';
/* ============================================================================
   COUNTRIES — a flag, a name and the leagues grouped under them (roadmap
   Phase 4).

   MOVED OUT OF countries/countries.js, where flagOf and countryName were
   written, so HOME's leagues section and anything after it share one copy.
   countries.js keeps its own until that page is retired; if the rules below
   change, they change here.

   Pure and DOM-free: supabase/tests/country.test.mjs runs this file as it is.

     flagOf(code)       the flag emoji, a globe for anything that is not a code
     countryName(code)  the name in the reader's language, 'Not yet filed' for none
     group(leagues)     [{ code, name, flag, leagues }], named countries by name,
                        the unfiled group last
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaCountry = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const GLOBE = '\u{1F30D}';
const UNFILED = 'Not yet filed';

/* A CODE IS TWO LETTERS, either case, with the spaces a hand-typed value
   brings trimmed. Anything else (null, 'GBR', '12') is not a country. */
function norm(code) {
  const c = String(code == null ? '' : code).trim();
  return /^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : '';
}

/* WINDOWS HAS NO FLAGS, which is what this used to shrug at. Segoe UI Emoji
   has never carried the regional-indicator PAIRS, so Chrome and Edge on Windows
   draw "GB" where every other platform draws the flag — and a rail of two-letter
   codes beside the country names reads as something broken rather than as a
   decision. No CSS or markup can change that: the only cure is to stop asking
   the font and ship the picture.

   So flagSrc() names a file for the countries we have drawn (epinoia/brand/flags,
   our own SVGs — a flag DESIGN is not copyrightable but somebody else's SVG of
   it is their file, so these are ours and there is nothing to attribute), and
   flagOf() still derives the emoji for everything else. A caller draws the image
   when there is one and the emoji when there is not, which on a Mac, a phone or
   Firefox is the same flag either way.

   ADDING ONE IS TWO STEPS, deliberately: drop <code>.svg into brand/flags and
   add the code here. The alternative — try the image and fall back on error —
   means a 404 on every page load for every country we have not drawn. */
const HAVE_FLAG = ['CZ', 'DE', 'ES', 'EU', 'FR', 'GB', 'JP', 'SK'];

/* Root-relative on purpose: this file is DOM-free and node runs it, so it does
   not know how deep the page asking is. The caller prefixes its own root. */
function flagSrc(code) {
  const c = norm(code);
  return HAVE_FLAG.indexOf(c) >= 0 ? 'brand/flags/' + c.toLowerCase() + '.svg' : '';
}

/* The emoji, DERIVED from the two letters of the ISO code: the regional-
   indicator code points a font renders as that flag. Nothing is stored and
   nothing can go out of step with the code beside it. */
function flagOf(code) {
  const c = norm(code);
  if (!c) return GLOBE;
  return String.fromCodePoint(...[...c].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));
}

/* The NAME from Intl, in the reader's own language, rather than a hard-coded
   list that would be wrong for half the world and stale for the rest.

   A CODE INTL DOES NOT KNOW comes back as itself ('QQ') or, for the reserved
   ZZ, as a phrase like "Unknown Region". Both read as the code: a league filed
   under a code nobody recognises should say what it was filed under. */
let regionNames, unknownRegion;
function countryName(code) {
  const c = norm(code);
  if (!c) return UNFILED;
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(undefined, { type: 'region' });
      unknownRegion = regionNames.of('ZZ');
    } catch (_) { regionNames = null; }
  }
  if (!regionNames) return c;
  try {
    const n = regionNames.of(c);
    return !n || n === unknownRegion ? c : n;
  } catch (_) { return c; }
}

const byName = (a, b) => String((a && a.name) || '').localeCompare(String((b && b.name) || '')) ||
  String((a && a.slug) || '').localeCompare(String((b && b.slug) || ''));

/* ONE GROUP PER COUNTRY. 'gb' and 'GB' are one country.

   Named countries first, alphabetically BY THE NAME A READER SEES rather than
   by the code (sorting by code files Germany under D). A LEAGUE WITH NO
   COUNTRY IS NOT DROPPED: it goes in a group of its own, code '', at the end.
   A competition nobody has filed is still one somebody needs to reach.

   Leagues inside a group by name. The input is never reordered. */
function group(leagues) {
  const map = new Map();
  (Array.isArray(leagues) ? leagues : []).forEach(l => {
    if (!l) return;
    const k = norm(l.country);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(l);
  });
  return [...map.keys()]
    .map(code => ({ code, name: countryName(code), flag: flagOf(code), leagues: map.get(code).slice().sort(byName) }))
    .sort((a, b) => (a.code === '') - (b.code === '') || a.name.localeCompare(b.name) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

return { flagOf, flagSrc, countryName, group, norm, UNFILED, HAVE_FLAG };
}));
