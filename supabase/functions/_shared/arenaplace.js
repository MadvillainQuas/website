/* ============================================================================
   ARENA PLACE - what a pin says about where it is.

   A person moves an arena's pin in the platform console (or Google's first match was
   wrong and a person corrects it). The pin is then right and everything stored BESIDE it
   - name, address, town, country, Google place - still describes the old spot: Saga's
   arena was listed at Wembley for a day, and four other hand-moved arenas the same way.
   This reads the new spot: given the places Google finds around the pin, it picks the
   arena the person meant and says what to store.

   Pure functions, no network, so the choice is testable and the Edge Function (arena-place)
   and its test share one rule.
   ============================================================================ */

/* what Google calls a place a basketball game can be played in */
export const ARENA_TYPES = ['stadium', 'arena', 'sports_complex', 'sports_activity_location', 'gym', 'sports_club'];
/* an arena within this many metres of the pin is the one the person meant; a car park and a
   hotel across the road are not */
export const REACH_M = 150;

export function metres(a, b) {
  const r = (x) => x * Math.PI / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 +
            Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(h));
}

/* the first address component of any of these kinds, as Google names it */
export function component(place, ...kinds) {
  for (const k of kinds) {
    const c = (place.addressComponents || []).find((x) => (x.types || []).includes(k));
    if (c) return c;
  }
  return null;
}

/* the place Google found nearest the pin, as the fields a venue row stores; null if nothing is
   close enough to be the arena. Types the arena kinds first: a sports hall 90 m away beats a
   bakery 20 m away, but a bakery is never returned at all (only arena-typed results are asked
   for, and one that is not is skipped here as well). */
export function pickPlace(places, pin, reach = REACH_M) {
  const ranked = (places || [])
    .filter((p) => p && p.id && p.location && (p.displayName?.text || '').trim())
    .map((p) => ({ p, d: metres(pin, { lat: p.location.latitude, lng: p.location.longitude }),
                   arena: (p.types || []).some((t) => ARENA_TYPES.includes(t)) }))
    .filter((x) => x.d <= reach && x.arena)
    .sort((a, b) => a.d - b.d);
  if (!ranked.length) return null;
  const { p, d } = ranked[0];
  const cc = component(p, 'country')?.shortText;
  return {
    place_id: p.id,
    name: p.displayName.text.trim(),
    address: p.formattedAddress || null,
    city: (component(p, 'locality', 'postal_town', 'administrative_area_level_3', 'administrative_area_level_2')?.longText) || null,
    country: /^[A-Z]{2}$/.test(cc || '') ? cc : null,
    distance_m: Math.round(d)
  };
}

/* the language to ask Google for names in: the country's own, because an arena's name is never
   translated (the leagues print it as it is written where it stands) */
const LANG = { JP: 'ja', GR: 'el', ES: 'es', FR: 'fr', DE: 'de', IT: 'it', LT: 'lt', LV: 'lv', EE: 'et', PL: 'pl',
               TR: 'tr', CZ: 'cs', SK: 'sk', FI: 'fi', NL: 'nl', SI: 'sl', HR: 'hr', RS: 'sr', BG: 'bg', RO: 'ro',
               HU: 'hu', PT: 'pt', SE: 'sv', NO: 'no', DK: 'da', KR: 'ko', CN: 'zh-CN', MX: 'es' };
export const languageFor = (country) => LANG[String(country || '').toUpperCase()] || 'en';

/* is this a different name for the arena, or the same one written differently? Only a different
   one is worth keeping the old spelling as an alias for (a feed still writes it that way). */
export const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
