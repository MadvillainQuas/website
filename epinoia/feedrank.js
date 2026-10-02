'use strict';
/* ============================================================================
   THE FEED IS RANKED, NOT JUST NEWEST — and what ranks it is learned on THIS DEVICE and goes nowhere.

   HOME's "For you" and the News page's "For you" put the posts (news_feed, 0194) in an order made for the reader:
   fresh first, then what they spend time on, what they read, where they are, what they follow, and the platform's
   official partners. Everything the ranking knows about a reader is in their browser's localStorage
   (epinoia_feed_v1) and is never sent to the server: not the points, not the reads, not the country. The calls
   this file makes are the same for every reader (the newest posts, the partners list, the leagues' countries, the
   points of a match report), and the ranking itself happens here.

   WHAT IT LEARNS (learnt only while personalisation is ON, the reader's switch; off is pure newest and nothing kept)
     a  DWELL    time on a league's pages (league, club, player, game, stats, its news: interest.js), counted only
                 while the tab is visible and the reader has touched, scrolled or typed in the last 30 s, flushed
                 when the tab is hidden or closed, capped per league per session. A point a minute.
     b  LOCATION the reader's country from their time zone, else their language's region: no permission, no IP,
                 no geolocation. A league in that country is boosted, a neighbour's (a region's) less.
     c  AFFINITY each story or piece opened, each publisher's or outlet's page visited, each follow: points to that
                 publisher or outlet, and a little to the story's leagues.
     d  READS    the ids of what they opened (capped, forgotten after 60 days), and impressions (what was shown)
                 kept apart. Only an UNREAD official-partner story is boosted.
     e  LANGUAGE the languages the reader reads: the site's language (EN / 日本語 / ES in the nav), the browser's
                 languages (navigator.languages) - both count as read from the start - and any language whose
                 publishers they open or visit, a little each time (see LANGUAGE below).
   Points halve every 30 days, so interests move.

   THE SCORE of a candidate, all of it in the constants below (W):
       recency   =  floor + (1 - floor) * 2^(-age / 18 h)               smooth, never zero
       personal  =  1 + W_LEAGUE * L + W_COUNTRY * C + W_PUB * P        each of L, C, P in [0, 1]: a saturating
                                                                        curve, so one obsession cannot bury the rest
       base      =  TIER[tier] (+ what a match report's game is worth)  publisher = creator > league-written > report
       score     =  base * recency * personal * (impressions: a little less when shown and never opened)
                    * language factor           when the story is in a language the reader does not read
                    * the group's weight        the group the reader opens more often climbs (below)
                    + FOLLOW_BONUS * sqrt(recency)      when it comes from something they follow
                    + PARTNER_BOOST * fade(age)         when it is an official partner's and UNREAD
   The partner boost is full for a week from publication and gone two days after, and it is more than any other story
   can score at all (scoreMax: 9.14 against 10), so an unread partner piece of the last week leads. Then the order is
   made to vary: never more than two in a row from one source, and no more than two boosted partner items in the first six.

   THE THREE GROUPS, in the order a reader sees them unless they show otherwise: an official PARTNER's piece (the boost),
   then the PRESS (a publisher's story = a creator's piece or post, base 1; a league's own article, 0.8), then AUTO, the
   match reports (0.35, lifted by the game's significance). Weights, not walls: a cup final, a fresh report of a league
   the reader follows, or a reader who opens reports can put one above a weaker story.
   LEARNING THE GROUPS: every first open is a click for its group (profile.k, halving every KIND_HALF_LIFE_DAYS = 14).
       share(g) = (clicks(g) + 3) / (all clicks + 9)                       three virtual clicks each: one click moves little
       weight(g) = clamp(1 + 1.25 (3 share(g) - 1) / 2, 0.6, 2)            1 for a reader with no clicks, or even ones
   One report opened: reports 1.13, the rest 0.94. Five reports and nothing else: 1.45 against 0.78; ten: 1.66 against
   0.67, and a plain report (0.58) passes a publisher's story some hours older, a significant game's report most; thirty:
   1.96 against 0.6, and a plain report passes a publisher's story of its own age (0.69 to 0.6). A reader who opens both
   keeps the tiers. THE EXPLORATION FLOOR: no group goes below 60% of its weight, and each group in the pool keeps
   a card in the first six (its best one, at the last places), so no group vanishes and the reader can still show they
   want it. A fresh partner piece stays first whatever was learned (scoreMax counts KIND_MAX).
   A SLOW POOL (a league's own news, which can span months): the recency half-life is the larger of 18 h and half the
   pool's median age, so 'fresh' is fresh for that league. HOME's pool is hours old and keeps 18 h.

   LANGUAGE. A publisher's language comes from news_source_languages() (0204; until it is applied, from SOURCE_LANG, the
   sources 0195 seeded). A story in a language the reader does not read is multiplied by LANG_PENALTY (0.3) - it sinks,
   it does not go - except as the reader shows they read it:
     * the site's language and the browser's languages are read outright (factor 1)
     * every story or piece opened, and every publisher's page visited, gives its language points; the language is
       unlocked by sat(points, LANG_SCALE): ONE accidental open is ~22% of the way, a habit (five or six stories) ~ 3/4,
       a dozen nearly all - graded, so a single click does not unlock a whole language but a habit does
     * a story from a league the reader follows, or one from the publisher/creator they follow, is relieved to 85%; one
       from a league they have many points for by LANG_LEAGUE_RELIEF x L (a Spanish-league fan reading in English still
       sees ACB's Spanish news)
     * an official partner's story is held back only mildly (factor at least 0.75), and its additive boost is untouched
     * a league's own article and a match report are the site's, written in the site's language: never held back; a
       source with no language on record (or a piece with none) is never held back either
     * 'Show every language' (Personalise) switches it all off. The relief is on the reader's device like the rest.
   MATCH REPORTS ("Epinoia match report": finalise-game's own, one per game) are the low tier: an ordinary result is
   not news the way a publisher's story is. What a GAME is worth (a cup final, the top two meeting, a 40-point
   night: game_significance, 0202) lifts its report's base by up to REPORT_SIG_GAIN, so an exceptional one can outrank
   an ordinary story. They are weights, not a filter.

   Pure functions (rank, scoreOf, recency, decay, detectCountry, the profile updates, dwellTracker) are exported for
   supabase/tests/feedrank.test.mjs; the browser layer (storage, the calls, the control) is at the end. Every storage
   access is in a try/catch and the whole file works with no storage at all.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaFeedRank = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const HOUR = 3600e3, DAY = 24 * HOUR;

/* ================================================================================ THE WEIGHTS, IN ONE PLACE === */
const W = Object.freeze({
  /* where it is kept (the profile) and what is kept beside it */
  KEY: 'epinoia_feed_v1',              // the learned profile: points, reads, impressions
  OFF_KEY: 'epinoia_feed_v1_off',      // '1' when the reader has switched personalisation off (kept through a reset)
  SESSION_KEY: 'epinoia_feed_s',       // sessionStorage: the seconds counted per league in this tab
  PARTNERS_KEY: 'epinoia_feed_partners', LEAGUES_KEY: 'epinoia_feed_leagues',   // public lists, cached
  PARTNERS_TTL_MS: 10 * 60e3, LEAGUES_TTL_MS: 12 * HOUR, ABSENT_TTL_MS: 30 * 60e3,
  SIG_KEY: 'epinoia_feed_sig', SIG_TTL_MS: 30 * 60e3, SIG_MAX: 200,       // sessionStorage: what a tab was told of match reports' games

  /* time */
  RECENCY_HALF_LIFE_H: 18,             // a story loses half its freshness every 18 hours...
  RECENCY_FLOOR: 0.03,                 // ...and never all of it
  DECAY_HALF_LIFE_DAYS: 30,            // learned points halve every 30 days

  /* what is learned, and how fast (points) */
  DWELL_PTS_PER_MIN: 1,
  DWELL_SESSION_CAP_S: 900,            // at most 15 minutes of dwell per league per session are counted
  DWELL_ACTIVE_MS: 30e3,               // "the reader is here": input or scroll within the last 30 s
  DWELL_TICK_MS: 5e3, DWELL_FLUSH_MS: 20e3,
  OPEN_PTS: 4,                         // a story or piece opened: to its publisher or outlet
  OPEN_LEAGUE_PTS: 1.5,                // ...and a little to each league it is about
  VISIT_PTS: 3,                        // a publisher's or an outlet's page visited
  FOLLOW_PTS: 6, FOLLOW_LEAGUE_PTS: 6, // a follow
  LEAGUE_SCALE: 20, PUB_SCALE: 10,     // points at which L or P reaches 63% of its cap (1 - e^-1)

  /* scoring */
  W_LEAGUE: 1.2, W_COUNTRY: 0.6, W_PUB: 0.8,       // each's cap on the multiplier: 1 + at most 2.6
  COUNTRY_HOME: 1, COUNTRY_NEAR: 0.4,              // a league in the reader's country / in a neighbour's or region's
  FOLLOW_BONUS: 0.5,
  /* the base of each tier, before the personal terms: a publisher's story = a creator's piece, then a league's own
     article, then a match report (the site's own, one per game), which a significant game lifts (below) */
  TIER: Object.freeze({ publisher: 1, creator: 1, league: 0.8, report: 0.35 }),
  REPORT_SIG_FULL: 60,                 // points of a game's significance that count in full
  REPORT_SIG_GAIN: 0.85,               // ...and lift a report's base by this much: 0.35 -> 1.2 at most
  SIG_WHY_MIN: 10,                     // a game worth this many says why
  AUTO_AUTHOR: 'Epinoia match report', // how finalise-game signs a report: the low tier
  PARTNER_BOOST: 10,                   // an official partner's unread story: more than any other story can score (scoreMax, 9.14), so it leads
  PARTNER_FULL_H: 168,                 // ...in full for a week from publication
  PARTNER_END_H: 216,                  // ...and fading until nothing is left, two days after
  /* language: a story in a language the reader does not read is multiplied by LANG_PENALTY, less as they engage with it */
  LANG_PENALTY: 0.3,                   // the factor for a language nobody has shown they read (0.25-0.35 is the intended range)
  LANG_SCALE: 12,                      // language points at which the language is 63% unlocked (sat): 3 pts ~ 22%, 15 pts ~ 71%
  OPEN_LANG_PTS: 3, VISIT_LANG_PTS: 2, // a story of that language opened / a publisher's page visited: one open is ~22% unlocked
  LANG_FOLLOW_RELIEF: 0.85,            // a followed league's, publisher's or creator's story: this much of the penalty is lifted
  LANG_LEAGUE_RELIEF: 0.7,             // a league the reader has points for lifts the penalty by this x its 0..1 share
  LANG_PARTNER_FLOOR: 0.75,            // an official partner's story is never held back below this
  LANGS_MAX: 12,
  LANG_ALL_KEY: 'epinoia_feed_v1_langall',   // '1' when the reader asked to see every language (kept through a reset)
  LANGS_KEY: 'epinoia_feed_langs', LANGS_TTL_MS: 12 * HOUR,   // the publishers' languages, cached
  IMPRESSION_SOFT_AT: 3, IMPRESSION_SOFT: 0.85, IMPRESSION_HARD_AT: 6, IMPRESSION_HARD: 0.7,   // shown, never opened

  /* THE GROUPS THE READER OPENS (THE THREE GROUPS, in the file's head): partner, press (a publisher's story, a creator's
     piece or post, a league's own article) or auto (a match report). Each first open is a click for its group; the clicks
     halve every 14 days; a group's share is smoothed by KIND_PRIOR virtual clicks for every group, and its stories' score
     is multiplied by 1 + KIND_GAIN x (3 x share - 1) / 2, held between KIND_FLOOR and KIND_MAX */
  KIND_HALF_LIFE_DAYS: 14,
  KIND_PRIOR: 3,
  KIND_GAIN: 1.25,
  KIND_FLOOR: 0.6,                     // a group the reader never opens keeps 60% of its weight: it sinks, it does not go
  KIND_MAX: 2,
  KIND_OPEN_PTS: 1,
  WHY_KIND_MIN: 0.25,                  // a group's multiplier this far above 1 is worth saying why
  EXPLORE_N: 6,                        // every kind in the pool has a card in the first six (the exploration floor)
  /* a slow pool (a league's own news can span months): freshness is measured against the pool, its half-life stretched to
     RECENCY_STRETCH x the pool's median age, never below RECENCY_HALF_LIFE_H. HOME's pool is hours old: unchanged there */
  RECENCY_STRETCH: 0.5,

  /* variety */
  MAX_RUN: 2,                          // never more than two in a row from one source
  PARTNER_TOP_N: 6, PARTNER_TOP_MAX: 2,   // and no more than two boosted partner items in the first six

  /* the profile's size */
  READS_MAX: 600, READS_TTL_DAYS: 60, IMPRESSIONS_MAX: 400, IMPRESSIONS_TTL_DAYS: 14,
  LEAGUES_MAX: 80, PUBS_MAX: 120, PRUNE_BELOW: 0.05,

  /* what "why" says: the smallest term worth saying */
  WHY_LEAGUE_MIN: 0.3, WHY_PUB_MIN: 0.25, WHY_COUNTRY_MIN: 0.2
});

/* ============================================================================================ the curves === */
const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
const ts = v => { const t = typeof v === 'number' ? v : Date.parse(v); return isFinite(t) ? t : 0; };

/* how fresh: 1 at once, half at 18 h, never below the floor */
function recency(ageMs, w) {
  const c = w || W;
  const h = Math.max(0, num(ageMs)) / HOUR;
  return c.RECENCY_FLOOR + (1 - c.RECENCY_FLOOR) * Math.pow(2, -h / c.RECENCY_HALF_LIFE_H);
}
/* a stored entry [points, at], as it stands at `now`: it halves every 30 days */
function decay(entry, now, w) {
  const c = w || W;
  if (!Array.isArray(entry)) return 0;
  const p = num(entry[0]), at = num(entry[1]);
  if (p <= 0) return 0;
  const age = Math.max(0, num(now) - at);
  return p * Math.pow(2, -age / (c.DECAY_HALF_LIFE_DAYS * DAY));
}
/* points to [0, 1): saturating, so the first hour counts for more than the fortieth */
const sat = (x, scale) => 1 - Math.exp(-Math.max(0, num(x)) / scale);
/* the partner boost's share by age: whole for a week, gone two days later, smooth between */
function partnerFade(ageMs, w) {
  const c = w || W;
  const h = Math.max(0, num(ageMs)) / HOUR;
  if (h <= c.PARTNER_FULL_H) return 1;
  if (h >= c.PARTNER_END_H) return 0;
  const t = (h - c.PARTNER_FULL_H) / (c.PARTNER_END_H - c.PARTNER_FULL_H);
  return 1 - t * t * (3 - 2 * t);
}

/* ==================================================================================== country, no prompt === */
/* the reader's country from the IANA zone their device is set to: a compact table by country. Zones a device
   reports that are not here are tried by their prefix, then given up on: the language is next. */
const TZ_BY_COUNTRY = {
  GB: 'Europe/London Europe/Belfast Europe/Jersey Europe/Guernsey Europe/Isle_of_Man GB GB-Eire', IE: 'Europe/Dublin Eire',
  FR: 'Europe/Paris', DE: 'Europe/Berlin Europe/Busingen', ES: 'Europe/Madrid Africa/Ceuta Atlantic/Canary', PT: 'Europe/Lisbon Atlantic/Madeira Atlantic/Azores Portugal',
  IT: 'Europe/Rome', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', LU: 'Europe/Luxembourg', CH: 'Europe/Zurich', AT: 'Europe/Vienna', LI: 'Europe/Vaduz',
  DK: 'Europe/Copenhagen', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', FI: 'Europe/Helsinki', IS: 'Atlantic/Reykjavik Iceland',
  EE: 'Europe/Tallinn', LV: 'Europe/Riga', LT: 'Europe/Vilnius', PL: 'Europe/Warsaw Poland', CZ: 'Europe/Prague', SK: 'Europe/Bratislava', HU: 'Europe/Budapest',
  SI: 'Europe/Ljubljana', HR: 'Europe/Zagreb', BA: 'Europe/Sarajevo', RS: 'Europe/Belgrade', ME: 'Europe/Podgorica', MK: 'Europe/Skopje', AL: 'Europe/Tirane',
  GR: 'Europe/Athens', BG: 'Europe/Sofia', RO: 'Europe/Bucharest', MD: 'Europe/Chisinau', UA: 'Europe/Kyiv Europe/Kiev Europe/Uzhgorod Europe/Zaporozhye', BY: 'Europe/Minsk',
  RU: 'Europe/Moscow Europe/Kaliningrad Europe/Samara Europe/Volgograd Europe/Saratov Asia/Yekaterinburg Asia/Omsk Asia/Novosibirsk Asia/Krasnoyarsk Asia/Irkutsk Asia/Yakutsk Asia/Vladivostok Asia/Magadan Asia/Kamchatka',
  TR: 'Europe/Istanbul Asia/Istanbul Turkey', CY: 'Asia/Nicosia Europe/Nicosia', MT: 'Europe/Malta', MC: 'Europe/Monaco', AD: 'Europe/Andorra', SM: 'Europe/San_Marino',
  GE: 'Asia/Tbilisi', AM: 'Asia/Yerevan', AZ: 'Asia/Baku',
  US: 'America/New_York America/Chicago America/Denver America/Los_Angeles America/Phoenix America/Anchorage America/Detroit America/Boise America/Juneau America/Adak America/Menominee America/Nome America/Sitka America/Yakutat Pacific/Honolulu US/Eastern US/Central US/Mountain US/Pacific US/Alaska US/Hawaii US/Arizona US/Michigan',
  CA: 'America/Toronto America/Vancouver America/Edmonton America/Winnipeg America/Halifax America/St_Johns America/Regina America/Montreal America/Ottawa America/Calgary America/Moncton America/Whitehorse America/Yellowknife America/Iqaluit America/Glace_Bay America/Goose_Bay America/Thunder_Bay America/Nipigon America/Rainy_River America/Rankin_Inlet America/Cambridge_Bay America/Inuvik America/Dawson America/Dawson_Creek America/Fort_Nelson',
  MX: 'America/Mexico_City America/Monterrey America/Tijuana America/Cancun America/Merida America/Chihuahua America/Hermosillo America/Mazatlan America/Matamoros America/Ojinaga America/Bahia_Banderas America/Ciudad_Juarez',
  BR: 'America/Sao_Paulo America/Manaus America/Fortaleza America/Recife America/Bahia America/Belem America/Cuiaba America/Campo_Grande America/Porto_Velho America/Rio_Branco America/Boa_Vista America/Araguaina America/Maceio America/Noronha America/Santarem America/Eirunepe Brazil/East',
  AR: 'America/Argentina/Buenos_Aires America/Buenos_Aires America/Cordoba America/Mendoza America/Argentina/Cordoba America/Argentina/Mendoza America/Argentina/Salta America/Argentina/Tucuman America/Argentina/Ushuaia America/Argentina/Jujuy America/Argentina/Catamarca America/Argentina/La_Rioja America/Argentina/San_Juan America/Argentina/San_Luis America/Argentina/Rio_Gallegos',
  CL: 'America/Santiago America/Punta_Arenas Pacific/Easter Chile/Continental', CO: 'America/Bogota', PE: 'America/Lima', VE: 'America/Caracas', UY: 'America/Montevideo', PY: 'America/Asuncion', BO: 'America/La_Paz', EC: 'America/Guayaquil',
  PR: 'America/Puerto_Rico', DO: 'America/Santo_Domingo', CR: 'America/Costa_Rica', PA: 'America/Panama', JM: 'America/Jamaica', CU: 'America/Havana', GT: 'America/Guatemala', SV: 'America/El_Salvador', HN: 'America/Tegucigalpa', NI: 'America/Managua', TT: 'America/Port_of_Spain',
  JP: 'Asia/Tokyo Japan', KR: 'Asia/Seoul ROK', CN: 'Asia/Shanghai Asia/Chongqing Asia/Harbin Asia/Urumqi PRC', HK: 'Asia/Hong_Kong Hongkong', TW: 'Asia/Taipei ROC', PH: 'Asia/Manila',
  ID: 'Asia/Jakarta Asia/Makassar Asia/Jayapura Asia/Pontianak', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh Asia/Saigon', MY: 'Asia/Kuala_Lumpur Asia/Kuching', SG: 'Asia/Singapore Singapore',
  IN: 'Asia/Kolkata Asia/Calcutta', PK: 'Asia/Karachi', BD: 'Asia/Dhaka', LK: 'Asia/Colombo', NP: 'Asia/Kathmandu', IL: 'Asia/Jerusalem Asia/Tel_Aviv Israel', LB: 'Asia/Beirut', JO: 'Asia/Amman',
  SA: 'Asia/Riyadh', AE: 'Asia/Dubai', QA: 'Asia/Qatar', KW: 'Asia/Kuwait', BH: 'Asia/Bahrain', OM: 'Asia/Muscat', IR: 'Asia/Tehran Iran', IQ: 'Asia/Baghdad', KZ: 'Asia/Almaty Asia/Aqtobe Asia/Aqtau Asia/Oral Asia/Qyzylorda', UZ: 'Asia/Tashkent Asia/Samarkand',
  AU: 'Australia/Sydney Australia/Melbourne Australia/Brisbane Australia/Perth Australia/Adelaide Australia/Hobart Australia/Darwin Australia/Canberra Australia/Lord_Howe Australia/Broken_Hill Australia/Eucla Australia/Lindeman Australia/Currie',
  NZ: 'Pacific/Auckland Pacific/Chatham NZ Antarctica/McMurdo', FJ: 'Pacific/Fiji', GU: 'Pacific/Guam',
  EG: 'Africa/Cairo Egypt', ZA: 'Africa/Johannesburg', NG: 'Africa/Lagos', KE: 'Africa/Nairobi', MA: 'Africa/Casablanca', DZ: 'Africa/Algiers', TN: 'Africa/Tunis', LY: 'Africa/Tripoli',
  GH: 'Africa/Accra', SN: 'Africa/Dakar', CI: 'Africa/Abidjan', CM: 'Africa/Douala', AO: 'Africa/Luanda', ET: 'Africa/Addis_Ababa', UG: 'Africa/Kampala', TZ: 'Africa/Dar_es_Salaam', ZW: 'Africa/Harare', MZ: 'Africa/Maputo', CD: 'Africa/Kinshasa'
};
const TZ_PREFIX = [['Australia/', 'AU'], ['US/', 'US'], ['America/Indiana/', 'US'], ['America/Kentucky/', 'US'], ['America/North_Dakota/', 'US'], ['America/Argentina/', 'AR'],
                   ['Canada/', 'CA'], ['Brazil/', 'BR'], ['Mexico/', 'MX']];
const TZ = (() => { const m = {}; Object.keys(TZ_BY_COUNTRY).forEach(c => TZ_BY_COUNTRY[c].split(' ').forEach(z => { m[z] = c; })); return m; })();

/* THE REGIONS: a league in the reader's country counts in full, one in another country of the same region less.
   A region's code (XB, the Balkans, country.js) sits in its region. */
const REGIONS = [
  ['GB', 'IE'], ['SE', 'NO', 'DK', 'FI', 'IS'], ['LT', 'LV', 'EE'], ['ES', 'PT', 'AD'], ['FR', 'BE', 'LU', 'MC', 'NL', 'CH'],
  ['DE', 'AT', 'CH', 'LI', 'LU', 'NL'], ['IT', 'SM', 'MT', 'SI', 'HR', 'CH'], ['PL', 'CZ', 'SK', 'HU', 'UA', 'LT'],
  ['RS', 'HR', 'SI', 'BA', 'ME', 'MK', 'XK', 'AL', 'BG', 'XB'], ['BG', 'RO', 'GR', 'CY', 'TR', 'MD'], ['UA', 'BY', 'MD', 'GE', 'AM', 'AZ'],
  ['US', 'CA', 'MX', 'PR'], ['AU', 'NZ'], ['JP', 'KR', 'TW', 'CN', 'HK', 'PH'], ['BR', 'AR', 'UY', 'CL', 'PY', 'BO', 'PE', 'CO', 'VE', 'EC'],
  ['IL', 'JO', 'LB', 'CY'], ['EG', 'LY', 'TN', 'DZ', 'MA'], ['NG', 'GH', 'SN', 'CI', 'CM'], ['SA', 'AE', 'QA', 'KW', 'BH', 'OM']
];
function neighbours(code) {
  const c = String(code || '').toUpperCase(), out = new Set();
  REGIONS.forEach(g => { if (g.indexOf(c) >= 0) g.forEach(x => { if (x !== c) out.add(x); }); });
  return out;
}

/* the country: from the time zone, else from the region of the first language that has one ('en-GB' -> GB). null when
   neither says: then nothing is boosted for where the reader is. No prompt, no network, no geolocation. */
function detectCountry(tz, languages) {
  const z = String(tz || '');
  if (z && TZ[z]) return TZ[z];
  for (let i = 0; i < TZ_PREFIX.length; i++) if (z.indexOf(TZ_PREFIX[i][0]) === 0) return TZ_PREFIX[i][1];
  const langs = Array.isArray(languages) ? languages : (languages ? [languages] : []);
  for (let i = 0; i < langs.length; i++) {
    const m = /^[A-Za-z]{2,3}[-_]([A-Za-z]{2})(?:[-_]|$)/.exec(String(langs[i] || ''));
    if (m) { const r = m[1].toUpperCase(); if (r !== 'ZZ' && r !== 'XX') return r; }
  }
  return null;
}
/* a league's country value ('GB', 'GB+IE', 'BE+NL', 'XB') as codes */
function countryCodes(value) {
  const parts = String(value == null ? '' : value).split('+').map(s => s.trim().toUpperCase());
  return parts.length && parts.length <= 4 && parts.every(p => /^[A-Z]{2}$/.test(p)) ? parts : [];
}
/* how much a league's country counts for a reader in `reader`: COUNTRY_HOME (their own), COUNTRY_NEAR (a region-mate), or 0 */
function countryMatch(reader, leagueCountry, w) {
  const c = w || W;
  const r = String(reader || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(r)) return 0;
  const codes = countryCodes(leagueCountry);
  if (!codes.length) return 0;
  if (codes.indexOf(r) >= 0) return c.COUNTRY_HOME;
  const n = neighbours(r);
  return codes.some(x => n.has(x)) ? c.COUNTRY_NEAR : 0;
}

/* ============================================================================================ the items === */
/* what a feed row (news_feed, 0194) is */
const isReport = it => !!it && it.kind === 'league' && (it.author === W.AUTO_AUTHOR || /^report-[0-9a-f]{8}$/.test(String(it.slug || '')));
function tierOf(it) {
  if (!it) return 'publisher';
  if (it.kind === 'creator') return 'creator';
  if (it.kind === 'league') return isReport(it) ? 'report' : 'league';
  return 'publisher';
}
/* the key a publisher or an outlet is known by, here and in official_partners(): 'source:eurohoops', 'outlet:kbl/hoops-pod'
   (an outlet's slug is only unique in its league). A league's own article has none: the league is the source. */
function pkeyOf(it) {
  if (!it) return null;
  if ((it.kind === 'outlet' || it.kind === 'channel') && it.source_slug) return 'source:' + it.source_slug;
  if (it.kind === 'creator' && it.outlet_slug && it.league_slug) return 'outlet:' + it.league_slug + '/' + it.outlet_slug;
  return null;
}
/* the source, for "never more than two in a row" */
function sourceOf(it) {
  return pkeyOf(it) || (it && it.league_slug ? 'league:' + it.league_slug : 'id:' + (it && it.id));
}
/* THE KEYS A ROW IS READ UNDER: its id, and an address made of the slugs a page knows a piece by (a creator's piece:
   'c:<league>/<outlet>/<piece>', a league's article: 'a:<league>/<article>'): the piece's own page and a notification's link
   carry the slugs and not the id, and opening it there is as much a read as pressing its card */
function readKeys(it) {
  const k = [];
  if (it && it.id) k.push(String(it.id));
  if (it && it.slug) {
    if (it.kind === 'creator' && it.outlet_slug && it.league_slug) k.push('c:' + it.league_slug + '/' + it.outlet_slug + '/' + it.slug);
    else if (it.kind === 'league' && it.league_slug) k.push('a:' + it.league_slug + '/' + it.slug);
  }
  return k;
}
/* the leagues a row is about: its tags, and the league it is filed under */
function leaguesOf(it) {
  const out = [];
  const add = (slug, name) => { if (slug && !out.some(l => l.slug === slug)) out.push({ slug, name: name || '' }); };
  if (it && it.kind === 'league') add(it.league_slug, it.league_name);
  (it && Array.isArray(it.leagues) ? it.leagues : []).forEach(l => { if (l && l.slug) add(l.slug, l.name); });
  if (it && it.kind !== 'league') add(it.league_slug, it.league_name);
  return out;
}
/* the official partners as a set of keys, from official_partners() ([{kind, slug, league?}]) or a set or a list of keys */
function partnerSet(list) {
  if (list instanceof Set) return list;
  const s = new Set();
  (Array.isArray(list) ? list : []).forEach(x => {
    if (typeof x === 'string') s.add(x);
    else if (x && x.kind === 'source' && x.slug) s.add('source:' + x.slug);
    else if (x && x.kind === 'outlet' && x.slug && x.league) s.add('outlet:' + x.league + '/' + x.slug);
  });
  return s;
}
const asSet = v => (v instanceof Set ? v : new Set(Array.isArray(v) ? v : []));
const dateOf = it => ts(it && (it.published_at || it.when));
/* ================================================================================= language === */
/* 'es-ES' -> 'es', 'zh_Hant' -> 'zh', 'jp' -> 'ja'; anything that is not a language code -> '' */
function langCode(v) {
  const m = /^([A-Za-z]{2,3})(?:[-_]|$)/.exec(String(v == null ? '' : v).trim());
  if (!m) return '';
  const c = m[1].toLowerCase();
  return c === 'jp' ? 'ja' : c === 'gr' ? 'el' : c;
}
/* what 0195 seeded, by source slug: used until 0204's news_source_languages() is there (and for a source it does not list) */
const SOURCE_LANG = Object.freeze({
  basketnews: 'en', eurohoops: 'en', sportando: 'en', talkbasket: 'en', 'basketnews-lt': 'lt', 'eurohoops-gr': 'el', gigantes: 'es',
  solobasket: 'es', pianetabasket: 'it', bebasket: 'fr', basketfaul: 'tr', 'basket-dergisi': 'tr', basketballking: 'ja', 'basket-count': 'ja',
  'pick-and-roll': 'en', 'basketball-com-au': 'en', 'b-league': 'ja', 'nbl-australia': 'en', 'slb-men': 'en', 'slb-women': 'en', bcb: 'en',
  '2bbl': 'de', 'basket-fi': 'fi', nkl: 'lt', pzkosz: 'pl', 'feb-liga-femenina': 'es', 'feb-liga-femenina-2': 'es', 'feb-primera': 'es',
  'feb-segunda': 'es', 'u-sports': 'en'
});
const LANG_CACHE = {};   // { 'source:slug': 'es', 'outlet:league/slug': 'es' }: news_source_languages(), once fetched
/* the language of a key ('source:gigantes'), or '' */
function langOfKey(key, map) {
  const k = String(key || '');
  const m = map || LANG_CACHE;
  if (m[k]) return langCode(m[k]);
  return k.indexOf('source:') === 0 && SOURCE_LANG[k.slice(7)] ? SOURCE_LANG[k.slice(7)] : '';
}
/* THE LANGUAGE OF A FEED ROW, or '' when it has none that should count: a league's own article and a match report are the site's
   (never held back for language); a row's own `lang` wins; otherwise the publisher's (or outlet's) */
function langOf(it, map) {
  if (!it || it.kind === 'league') return '';
  const own = langCode(it.lang);
  if (own) return own;
  return langOfKey(pkeyOf(it), map);
}
const newestFirst = (a, b) => dateOf(b) - dateOf(a) || String(a.id || '').localeCompare(String(b.id || ''));

/* whether the reader has opened it (and not so long ago that it is forgotten) */
function isRead(profile, id, now, w) {
  const c = w || W;
  const t = profile && profile.r && profile.r[id];
  return !!t && num(now) - num(t) < c.READS_TTL_DAYS * DAY;
}

/* ================================================================================== the three kinds === */
const GROUPS = Object.freeze(['partner', 'press', 'auto']);
/* WHICH KIND A ROW IS: an official partner's (by its key in the partners, or a row the ranking already marked partner),
   a match report (auto), or press: a publisher's story, a creator's piece or post, a league's own article */
function groupOf(it, partners) {
  if (!it) return 'press';
  if (it.partner === true) return 'partner';
  const k = pkeyOf(it);
  if (k && partners && partnerSet(partners).has(k)) return 'partner';
  return tierOf(it) === 'report' ? 'auto' : 'press';
}
const kindW = w => Object.assign({}, w || W, { DECAY_HALF_LIFE_DAYS: (w || W).KIND_HALF_LIFE_DAYS });
/* THE WEIGHT OF EACH GROUP FOR THIS READER: the clicks of each group (profile.k, halving every 14 days), smoothed by
   KIND_PRIOR virtual clicks for every group, as a multiplier on the group's stories:
       share(g) = (clicks(g) + PRIOR) / (all clicks + 3 PRIOR)
       mult(g)  = clamp(1 + KIND_GAIN * (3 share(g) - 1) / 2, KIND_FLOOR, KIND_MAX)
   No clicks, or clicks spread evenly: 1 for every group. One report opened: 1.13 (the others 0.94). Five reports and nothing
   else: 1.45 (press 0.78); ten: 1.66 (press 0.67); thirty: 1.96 (press 0.6, the floor). */
function groupWeights(profile, now, w) {
  const c = w || W;
  const kw = kindW(c);
  const k = (profile && profile.k) || {};
  const n = {}; let total = 0;
  GROUPS.forEach(x => { n[x] = decay(k[x], now, kw); total += n[x]; });
  const out = {};
  GROUPS.forEach(x => {
    const share = (n[x] + c.KIND_PRIOR) / (total + GROUPS.length * c.KIND_PRIOR);
    out[x] = Math.min(c.KIND_MAX, Math.max(c.KIND_FLOOR, 1 + c.KIND_GAIN * (GROUPS.length * share - 1) / (GROUPS.length - 1)));
  });
  return out;
}
/* THE MOST A STORY THAT IS NOT A BOOSTED PARTNER'S CAN SCORE: the highest base (a report of the most significant game),
   fresh, its group at KIND_MAX, every personal term at its cap, and followed. The partner boost is above it. */
function scoreMax(w) {
  const c = w || W;
  const base = Math.max(c.TIER.publisher, c.TIER.creator, c.TIER.league, c.TIER.report + c.REPORT_SIG_GAIN);
  return base * c.KIND_MAX * (1 + c.W_LEAGUE + c.W_COUNTRY + c.W_PUB) + c.FOLLOW_BONUS;
}

/* ============================================================================================= scoring === */
/* THE SCORE OF ONE ITEM, with the parts it is made of (the tests and "why" read them) */
function scoreOf(it, profile, now, w) {
  const c = w || W;
  const P = profile || {};
  const tier = tierOf(it);
  const age = num(now) - dateOf(it);
  const rec = recency(age, c);

  const lgs = leaguesOf(it);
  let L = 0, Lslug = null;
  lgs.forEach(l => { const v = sat(decay(P.l && P.l[l.slug], now, c), c.LEAGUE_SCALE); if (v > L) { L = v; Lslug = l; } });
  let C = 0;
  if (P.country && P.leagueCountry) lgs.forEach(l => { C = Math.max(C, countryMatch(P.country, P.leagueCountry[l.slug], c)); });
  const pkey = pkeyOf(it);
  const Pp = pkey ? sat(decay(P.p && P.p[pkey], now, c), c.PUB_SCALE) : 0;
  const personal = 1 + c.W_LEAGUE * L + c.W_COUNTRY * C + c.W_PUB * Pp;

  /* the tier, and what a match report's game is worth */
  let base = c.TIER[tier] != null ? c.TIER[tier] : 1;
  const sig = (it && it.sig) || (P.sig && P.sig[it && it.id]) || null;
  const sigPoints = tier === 'report' && sig ? Math.max(0, num(sig.points)) : 0;
  if (sigPoints) base += c.REPORT_SIG_GAIN * Math.min(1, sigPoints / c.REPORT_SIG_FULL);

  const read = readKeys(it).some(k => isRead(P, k, now, c));
  let imp = 1;
  const ie = P.i && P.i[it && it.id];
  if (Array.isArray(ie) && num(now) - num(ie[1]) < c.IMPRESSIONS_TTL_DAYS * DAY) {
    if (num(ie[0]) >= c.IMPRESSION_HARD_AT) imp = c.IMPRESSION_HARD;
    else if (num(ie[0]) >= c.IMPRESSION_SOFT_AT) imp = c.IMPRESSION_SOFT;
  }

  const followSet = asSet(P.followedIds), followLeagues = asSet(P.followedLeagues);
  const followed = followSet.has(it && it.id) || lgs.some(l => followLeagues.has(l.slug));
  const follow = followed ? c.FOLLOW_BONUS * Math.sqrt(rec) : 0;

  const partner = !!pkey && partnerSet(P.partners).has(pkey);
  const boost = partner && !read ? c.PARTNER_BOOST * partnerFade(age, c) : 0;

  /* the language: a story in one the reader does not read is held back, less as they engage with it */
  const lang = langOf(it, P.langMap);
  let langFactor = 1, langRelief = 1, foreign = false;
  const mine = Array.isArray(P.readLangs) ? P.readLangs : null;     // unknown (no list): nothing is held back
  if (lang && mine && mine.length && !P.langAll && mine.indexOf(lang) < 0) {
    foreign = true;
    const unlocked = sat(decay(P.g && P.g[lang], now, c), c.LANG_SCALE);
    langRelief = Math.max(unlocked, followed ? c.LANG_FOLLOW_RELIEF : 0, c.LANG_LEAGUE_RELIEF * L);
    langFactor = c.LANG_PENALTY + (1 - c.LANG_PENALTY) * Math.min(1, langRelief);
    if (partner) langFactor = Math.max(langFactor, c.LANG_PARTNER_FLOOR);
  }

  /* the group the reader opens more often climbs, one they never open sinks (to KIND_FLOOR at most) */
  const group = partner ? 'partner' : (tier === 'report' ? 'auto' : 'press');
  const gw = P.groupW || groupWeights(P, now, c);
  const kindMul = gw[group] != null ? gw[group] : 1;

  const score = base * kindMul * rec * personal * imp * langFactor + follow + boost;
  return { score, group, kindMul, lang, foreign, langFactor, langRelief, tier, base, rec, personal, L, Lleague: Lslug, C, P: Pp, pkey, partner, read, boost, follow, followed,
           sigPoints, sigReasons: tier === 'report' && sig && Array.isArray(sig.reasons) ? sig.reasons : [], imp,
           terms: { league: c.W_LEAGUE * L, country: c.W_COUNTRY * C, pub: c.W_PUB * Pp } };
}

/* THE WORDS BESIDE A CARD ("Why am I seeing this?"): the biggest thing that put it here */
function whyOf(it, s, profile, w) {
  const c = w || W;
  if (s.boost > 0) return 'Official partner';
  if (s.tier === 'report' && s.sigPoints >= c.SIG_WHY_MIN && s.sigReasons.length) return s.sigReasons[0];
  if (s.followed) {
    const P = profile || {};
    const fl = asSet(P.followedLeagues);
    const hit = leaguesOf(it).find(l => fl.has(l.slug));
    if (hit && hit.name) return 'You follow ' + hit.name;
    if (s.pkey && it.source_name) return 'You follow ' + it.source_name;
    return 'From what you follow';
  }
  const t = s.terms;
  const cand = [];
  if (t.league >= c.WHY_LEAGUE_MIN && s.Lleague) cand.push([t.league, 'Because you read a lot about ' + (s.Lleague.name || s.Lleague.slug.toUpperCase())]);
  if (t.pub >= c.WHY_PUB_MIN && it.source_name) cand.push([t.pub, 'Because you read ' + it.source_name]);
  if (t.country >= c.WHY_COUNTRY_MIN) cand.push([t.country, 'Popular where you are']);
  if (s.kindMul - 1 >= c.WHY_KIND_MIN && s.group !== 'partner') cand.push([s.kindMul - 1, s.group === 'auto' ? 'Because you open match reports' : 'Because you open stories like this']);
  if (cand.length) return cand.sort((a, b) => b[0] - a[0])[0][1];
  if (s.tier === 'publisher') return 'From a publisher';
  if (s.tier === 'creator') return 'From a creator';
  if (s.tier === 'report') return 'Match report';
  return 'League news';
}

/* THE ORDER. items: the feed's rows, any number; profile: what the reader is (see the file's head: l, p, r, i as
   stored, and country, leagueCountry, partners, followedIds, followedLeagues, sig as fetched); now: ms. Returns COPIES
   of the rows with { why, score, tier, partner, boosted, read }, best first. Personalisation off (profile.off), or no
   profile: the newest first and no why. */
function rank(items, profile, now, w) {
  const c = w || W;
  const list = (Array.isArray(items) ? items : []).filter(Boolean);
  const t = num(now) || Date.now();
  if (!profile || profile.off) return list.slice().sort(newestFirst).map(it => Object.assign({}, it, { why: '', score: 0 }));

  /* a slow pool: freshness against the pool's own median age (never quicker than RECENCY_HALF_LIFE_H) */
  const ages = list.map(it => Math.max(0, t - dateOf(it)) / HOUR).sort((a, b) => a - b);
  const median = ages.length ? ages[Math.floor((ages.length - 1) / 2)] : 0;
  const cs = median * c.RECENCY_STRETCH > c.RECENCY_HALF_LIFE_H ? Object.assign({}, c, { RECENCY_HALF_LIFE_H: median * c.RECENCY_STRETCH }) : c;
  const prof = Object.assign({}, profile, { groupW: groupWeights(profile, t, c) });
  const scored = list.map(it => {
    const s = scoreOf(it, prof, t, cs);
    return { it, s, source: sourceOf(it), at: dateOf(it) };
  });
  scored.sort((a, b) => b.s.score - a.s.score || b.at - a.at || String(a.it.id || '').localeCompare(String(b.it.id || '')));

  /* variety: greedy, the best that breaks neither rule; if nothing can honour both (a feed of two sources), the best that
     keeps the partner cap, and if not even that, the best */
  const out = [];
  let boosted = 0;
  const rest = scored.slice();
  const runOf = x => out.length >= c.MAX_RUN && out.slice(-c.MAX_RUN).every(y => y.source === x.source);
  const capOf = x => x.s.boost > 0 && out.length < c.PARTNER_TOP_N && boosted >= c.PARTNER_TOP_MAX;
  while (rest.length) {
    let pick = rest.findIndex(x => !runOf(x) && !capOf(x));
    if (pick < 0) pick = rest.findIndex(x => !capOf(x));
    if (pick < 0) pick = 0;
    const x = rest.splice(pick, 1)[0];
    if (x.s.boost > 0 && out.length < c.PARTNER_TOP_N) boosted++;
    out.push(x);
  }
  /* THE EXPLORATION FLOOR: a kind in the pool with no card in the first EXPLORE_N gets its best one at the last of those
     places (press first, then auto), so no kind vanishes and the reader can still show they want it */
  const N = Math.min(c.EXPLORE_N, out.length);
  const picks = ['press', 'auto'].filter(g => !out.slice(0, N).some(x => x.s.group === g))
    .map(g => out.find((x, j) => j >= N && x.s.group === g)).filter(Boolean);
  picks.forEach(x => { out.splice(out.indexOf(x), 1); x.explore = true; });
  picks.forEach((x, i) => out.splice(Math.max(0, N - picks.length + i), 0, x));
  return out.map(x => Object.assign({}, x.it, {
    why: whyOf(x.it, x.s, profile, c), score: x.s.score, lang: x.s.lang || x.it.lang || undefined, tier: x.s.tier, group: x.s.group, partner: x.s.partner,
    boosted: x.s.boost > 0, read: x.s.read, explore: !!x.explore
  }));
}

/* ==================================================================================== learning (pure) === */
const emptyState = () => ({ v: 1, l: {}, p: {}, r: {}, i: {}, g: {}, k: {} });
function sane(v) {
  const o = emptyState();
  if (!v || typeof v !== 'object' || v.v !== 1) return o;
  ['l', 'p', 'i', 'g', 'k'].forEach(k => { if (v[k] && typeof v[k] === 'object') Object.keys(v[k]).forEach(x => { const e = v[k][x]; if (Array.isArray(e) && isFinite(e[0]) && isFinite(e[1])) o[k][x] = [+e[0], +e[1]]; }); });
  if (v.r && typeof v.r === 'object') Object.keys(v.r).forEach(x => { if (isFinite(v.r[x])) o.r[x] = +v.r[x]; });
  return o;
}
function addPoints(map, key, pts, now, w) {
  if (!key || !(pts > 0)) return;
  const cur = map[key];
  map[key] = [Math.round((decay(cur, now, w) + pts) * 1000) / 1000, now];
}
/* keep the profile small: forget what has decayed to nothing or grown old, and cap each list by keeping the newest */
function prune(state, now, w) {
  const c = w || W;
  const cap = (obj, max, at) => {
    const keys = Object.keys(obj);
    if (keys.length <= max) return;
    keys.sort((a, b) => at(obj[b]) - at(obj[a])).slice(max).forEach(k => { delete obj[k]; });
  };
  Object.keys(state.l).forEach(k => { if (decay(state.l[k], now, c) < c.PRUNE_BELOW) delete state.l[k]; });
  Object.keys(state.p).forEach(k => { if (decay(state.p[k], now, c) < c.PRUNE_BELOW) delete state.p[k]; });
  if (!state.g) state.g = {};
  Object.keys(state.g).forEach(k => { if (decay(state.g[k], now, c) < c.PRUNE_BELOW) delete state.g[k]; });
  if (!state.k) state.k = {};
  Object.keys(state.k).forEach(k => { if (GROUPS.indexOf(k) < 0 || decay(state.k[k], now, kindW(c)) < c.PRUNE_BELOW) delete state.k[k]; });
  Object.keys(state.r).forEach(k => { if (num(now) - state.r[k] > c.READS_TTL_DAYS * DAY) delete state.r[k]; });
  Object.keys(state.i).forEach(k => { if (num(now) - state.i[k][1] > c.IMPRESSIONS_TTL_DAYS * DAY) delete state.i[k]; });
  cap(state.l, c.LEAGUES_MAX, e => e[1]); cap(state.p, c.PUBS_MAX, e => e[1]); cap(state.g, c.LANGS_MAX, e => e[1]);
  cap(state.r, c.READS_MAX, t => t); cap(state.i, c.IMPRESSIONS_MAX, e => e[1]);
  return state;
}
/* time on a league's pages: seconds, credited at a point a minute, at most DWELL_SESSION_CAP_S a league a session.
   `session` is the tab's tally { slug: seconds } and is updated; returns the seconds credited. */
function addDwell(state, slug, seconds, now, session, w) {
  const c = w || W;
  if (!slug || !(seconds > 0)) return 0;
  const done = num(session && session[slug]);
  const credit = Math.max(0, Math.min(seconds, c.DWELL_SESSION_CAP_S - done));
  if (!credit) return 0;
  if (session) session[slug] = done + credit;
  addPoints(state.l, slug, credit / 60 * c.DWELL_PTS_PER_MIN, now, c);
  return credit;
}
/* a story or a piece opened: it is read; its publisher or outlet, and a little its leagues, gain, and its group (partner,
   press, auto: groupOf) gets a click. Only the first time: opening it again is not a second reason to like it. Returns
   whether it was new. */
function noteOpen(state, row, now, w) {
  const c = w || W;
  const keys = readKeys(row);
  if (!keys.length) return false;
  const seen = keys.some(k => state.r[k]);
  keys.forEach(k => { if (!state.r[k]) state.r[k] = now; });
  if (seen) return false;
  addPoints(state.p, pkeyOf(row), c.OPEN_PTS, now, c);
  if (!state.g) state.g = {};
  addPoints(state.g, langOf(row), c.OPEN_LANG_PTS, now, c);
  leaguesOf(row).slice(0, 4).forEach(l => addPoints(state.l, l.slug, c.OPEN_LEAGUE_PTS, now, c));
  if (!state.k) state.k = {};
  addPoints(state.k, groupOf(row), c.KIND_OPEN_PTS, now, kindW(c));
  return true;
}
function noteVisit(state, key, now, w) {
  const c = w || W;
  addPoints(state.p, key, c.VISIT_PTS, now, c);
  if (!state.g) state.g = {};
  addPoints(state.g, langOfKey(key), c.VISIT_LANG_PTS, now, c);
}
function noteFollow(state, o, now, w) {
  const c = w || W;
  if (o && o.key) addPoints(state.p, o.key, c.FOLLOW_PTS, now, c);
  if (o && o.league) addPoints(state.l, o.league, c.FOLLOW_LEAGUE_PTS, now, c);
}
/* what was shown (impressions), kept apart from what was opened: once per id per call */
function noteShown(state, ids, now) {
  const seen = new Set();
  (ids || []).forEach(id => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const e = state.i[id];
    state.i[id] = [(Array.isArray(e) ? num(e[0]) : 0) + 1, now];
  });
}

/* ==================================================================================== dwell: the counting === */
/* THE RULES OF DWELL, with the clock and the page injected (o.now, o.visible, o.slug, o.add):
     a moment counts when the tab is visible AND the reader has touched, scrolled or typed within DWELL_ACTIVE_MS of it;
     what is counted goes to the league the page is about at the time of the tick (a page that learns its league late
     loses nothing that came after); it is handed over (o.add(slug, seconds)) by flush(), which the caller runs when
     the tab is hidden or closed and every so often. Time while hidden, a sleeping laptop, an idle tab: none. */
function dwellTracker(o) {
  const active = (o && o.activeMs) || W.DWELL_ACTIVE_MS;
  let last = o.now(), lastActive = last, visible = !!o.visible();
  const acc = {};
  return {
    activity() { const t = o.now(); if (t > lastActive) lastActive = t; },
    tick() {
      const t = o.now(), from = last;
      last = t;
      if (!visible || t <= from) return 0;
      const counted = Math.max(0, Math.min(t, lastActive + active) - from);
      if (!counted) return 0;
      const slug = o.slug && o.slug();
      if (!slug) return 0;
      acc[slug] = (acc[slug] || 0) + counted / 1000;
      return counted / 1000;
    },
    /* the tab shown or hidden: what came before the change is counted first */
    visibility(v) { this.tick(); visible = !!v; if (visible) { last = o.now(); lastActive = last; } },
    pending() { return Object.assign({}, acc); },
    flush() {
      this.tick();
      Object.keys(acc).forEach(slug => { const s = acc[slug]; delete acc[slug]; if (s > 0) o.add(slug, s); });
    }
  };
}
/* the pages whose time counts: a league's own pages (its front page, table, club, player, game, stats, news, creators).
   The platform's (HOME, games, scouting, GO, profile, admin) are nobody's league. */
function dwellPage(pathname) {
  const p = String(pathname || '').replace(/^.*\/epinoia\//, '/').replace(/index\.html$/, '');
  const seg = p.split('/').filter(Boolean);
  return seg.length === 0 || ['l', 't', 'p', 'game', 'stats', 'fixtures', 'news', 'creators', 'injuries', 'video'].indexOf(seg[0]) >= 0;
}

/* ================================================================================= storage (the browser) === */
function memoryStorage() {
  const m = {};
  return { getItem: k => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } };
}
/* the window's storage area by name: reading the property itself throws where site data is blocked */
function area(name) { try { return root[name]; } catch (_) { return null; } }
/* the browser's storage if it works, else null: a private window, blocked site data, a sandbox */
function usable(area) {
  try {
    if (!area) return null;
    area.setItem('__epinoia_t', '1'); area.removeItem('__epinoia_t');
    return area;
  } catch (_) { return null; }
}
/* THE STORE: the reader's profile in localStorage (or in memory for this page when there is none), every access guarded.
   o: { local, session, now } - injected in the tests. */
function createStore(o) {
  const opts = o || {};
  const local = opts.local === undefined ? usable(area('localStorage')) : opts.local;
  const sess = opts.session === undefined ? usable(area('sessionStorage')) : opts.session;
  const mem = memoryStorage(), memSess = memoryStorage();
  const now = opts.now || (() => Date.now());
  const rd = (s, m, k) => { try { const v = s ? s.getItem(k) : null; if (v != null) return v; } catch (_) { /* fall through */ } return m.getItem(k); };
  const wr = (s, m, k, v) => { try { if (s) { s.setItem(k, v); return; } } catch (_) { /* memory */ } m.setItem(k, v); };
  const rm = (s, m, k) => { try { if (s) s.removeItem(k); } catch (_) { /* memory */ } m.removeItem(k); };
  let cache = null;

  const enabled = () => rd(local, mem, W.OFF_KEY) !== '1';
  function load() {
    let raw = null;
    try { raw = rd(local, mem, W.KEY); } catch (_) { raw = null; }
    let st = emptyState();
    try { st = raw ? sane(JSON.parse(raw)) : emptyState(); } catch (_) { st = emptyState(); }
    cache = st;
    return st;
  }
  function save(st) {
    prune(st, now());
    let s = '';
    try { s = JSON.stringify(st); } catch (_) { return false; }
    try { if (local) { local.setItem(W.KEY, s); return true; } } catch (_) { /* a full or refusing store: trim and try once more, then keep it in memory */
      try { st.i = {}; local.setItem(W.KEY, JSON.stringify(st)); return true; } catch (_e) { /* memory */ }
    }
    mem.setItem(W.KEY, s);
    return false;
  }
  /* every recording: nothing at all while personalisation is off */
  function record(fn) {
    if (!enabled()) return false;
    try { const st = load(); const r = fn(st, now()); save(st); return r === undefined ? true : r; } catch (_) { return false; }
  }
  const sessionTally = () => { try { const v = JSON.parse(rd(sess, memSess, W.SESSION_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; } };
  return {
    enabled,
    setEnabled(on) { if (on) rm(local, mem, W.OFF_KEY); else wr(local, mem, W.OFF_KEY, '1'); },
    /* the profile as it stands (also while off: it is untouched, only not read by rank) */
    profile() { return load(); },
    dwell(slug, seconds) {
      return record((st, t) => { const tally = sessionTally(); const n = addDwell(st, slug, seconds, t, tally); wr(sess, memSess, W.SESSION_KEY, JSON.stringify(tally)); return n; });
    },
    opened(row) { return record((st, t) => noteOpen(st, row, t)); },
    visited(key) { return record((st, t) => { noteVisit(st, key, t); }); },
    followed(o) { return record((st, t) => { noteFollow(st, o, t); }); },
    shown(ids) { return record((st, t) => { noteShown(st, ids, t); }); },
    /* 'Show every language': no story is held back for its language. Kept through a reset, like the switch. */
    langAll() { return rd(local, mem, W.LANG_ALL_KEY) === '1'; },
    setLangAll(on) { if (on) wr(local, mem, W.LANG_ALL_KEY, '1'); else rm(local, mem, W.LANG_ALL_KEY); },
    /* the languages learned from what was opened: [{ lang, points, unlocked (0..1) }], most first */
    langs() {
      const st = load(), t = now();
      return Object.keys(st.g || {}).map(k => { const pts = decay(st.g[k], t, W); return { lang: k, points: pts, unlocked: sat(pts, W.LANG_SCALE) }; })
        .filter(x => x.points > 0).sort((a, b) => b.points - a.points);
    },
    /* forget one language's points (allowed while personalisation is off: it is only forgetting) */
    forgetLang(code) { try { const st = load(); if (st.g && st.g[code]) { delete st.g[code]; save(st); } return true; } catch (_) { return false; } },
    /* forget what was learned; the switch, and the follows (which are the reader's account's), stay */
    reset() { rm(local, mem, W.KEY); rm(sess, memSess, W.SESSION_KEY); cache = null; return true; },
    isRead(id) { return isRead(load(), id, now()); },
    learned() { const st = load(); return Object.keys(st.l).length + Object.keys(st.p).length + Object.keys(st.r).length + Object.keys(st.g || {}).length + Object.keys(st.k || {}).length; },
    usingStorage: !!local
  };
}

let dflt = null;
const store = () => dflt || (dflt = createStore());

/* ============================================================================== the public calls (no reader) === */
/* Everything fetched here is the same for every reader: the partners, the leagues' countries, a match report's game.
   Nothing about the reader is in any of them. A database without the function or the migration answers nothing. */
function createNet(o) {
  const opts = o || {};
  const cfg = () => opts.config || root.EPINOIA_CONFIG || {};
  const fetcher = () => opts.fetch || (typeof root.fetch === 'function' ? root.fetch.bind(root) : null);
  const local = opts.local === undefined ? usable(area('localStorage')) : opts.local;
  const now = opts.now || (() => Date.now());
  const memo = {};
  const sessArea = opts.session === undefined ? usable(area('sessionStorage')) : opts.session;
  const readCache = (key, ttl, area) => { try { const v = JSON.parse((area || local).getItem(key) || 'null'); if (v && now() - v.t < ttl) return v.d; } catch (_) { /* none */ } return null; };
  /* `aged`: written as if it were already that old, so a short-lived answer (a database that does not have the function yet) is asked again soon */
  const writeCache = (key, d, aged, area) => { try { const a = area || local; if (a) a.setItem(key, JSON.stringify({ t: now() - (aged || 0), d })); } catch (_) { /* none */ } };
  const headers = () => ({ apikey: cfg().supabaseAnonKey, 'Content-Type': 'application/json', Accept: 'application/json' });
  async function call(kind, path, body) {
    const f = fetcher(), c = cfg();
    if (!f || !c.supabaseUrl) throw new Error('no api');
    const r = await f(c.supabaseUrl + '/rest/v1/' + path, kind === 'rpc'
      ? { method: 'POST', cache: 'no-store', headers: headers(), body: JSON.stringify(body || {}) }
      : { cache: 'no-store', headers: headers() });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  const once = (k, fn) => memo[k] || (memo[k] = fn());
  const sigCache = {};
  /* what a tab has been told about match reports' games is kept for the tab (it rarely changes, and HOME and News ask the same) */
  (() => { const kept = readCache(W.SIG_KEY, W.SIG_TTL_MS, sessArea); if (kept && typeof kept === 'object') Object.keys(kept).forEach(k => { sigCache[k] = kept[k]; }); })();
  let sigAbsent = false;
  return {
    /* the official partners, once per page and remembered for an hour: a Set of keys */
    partners() {
      return once('partners', async () => {
        const c = readCache(W.PARTNERS_KEY, W.PARTNERS_TTL_MS);
        if (c) return partnerSet(c);
        try { const l = await call('rpc', 'rpc/official_partners', {}); writeCache(W.PARTNERS_KEY, Array.isArray(l) ? l : []); return partnerSet(l); }
        catch (e) {
          /* a database without 0201 answers 404: none, and not asked again for a while (every page would ask) */
          if (e && e.status === 404) writeCache(W.PARTNERS_KEY, [], Math.max(0, W.PARTNERS_TTL_MS - W.ABSENT_TTL_MS));
          return new Set();
        }
      });
    },
    /* the publishers' languages { 'source:slug': 'es', 'outlet:league/slug': 'es' }, once, kept half a day; a database without 0204 answers 404:
       the map of what 0195 seeded (SOURCE_LANG) stands. Never throws. */
    languages(lo) {
      /* cachedOnly: what this browser already has (a league's front page asks nothing more of the server), else the seeded map */
      const cachedOnly = !!(lo && lo.cachedOnly);
      return once(cachedOnly ? 'languagesCached' : 'languages', async () => {
        let rows = readCache(W.LANGS_KEY, W.LANGS_TTL_MS);
        if (!rows && cachedOnly) rows = [];
        if (!rows) {
          try { rows = await call('rpc', 'rpc/news_source_languages', {}); writeCache(W.LANGS_KEY, Array.isArray(rows) ? rows : []); }
          catch (e) { rows = []; if (e && e.status === 404) writeCache(W.LANGS_KEY, [], W.LANGS_TTL_MS - W.ABSENT_TTL_MS); }
        }
        const map = {};
        (Array.isArray(rows) ? rows : []).forEach(r => {
          const l = r && langCode(r.language);
          if (!l || !r.slug) return;
          if (r.kind === 'source') map['source:' + r.slug] = l;
          else if (r.kind === 'outlet' && r.league_slug) map['outlet:' + r.league_slug + '/' + r.slug] = l;
        });
        Object.keys(map).forEach(k => { LANG_CACHE[k] = map[k]; });
        return map;
      });
    },
    /* { country: { slug: 'GB+IE' }, idToSlug: { uuid: slug } }, once and remembered for half a day */
    leagueMap(lo) {
      const cachedOnly = !!(lo && lo.cachedOnly);
      return once(cachedOnly ? 'leaguesCached' : 'leagues', async () => {
        let rows = readCache(W.LEAGUES_KEY, W.LEAGUES_TTL_MS);
        if (!rows && cachedOnly) rows = [];
        if (!rows) {
          try { rows = await call('get', 'leagues?select=id,slug,country&order=slug'); writeCache(W.LEAGUES_KEY, rows); }
          catch (_) { rows = []; }
        }
        const country = {}, idToSlug = {};
        (Array.isArray(rows) ? rows : []).forEach(r => { if (r && r.slug) { country[r.slug] = r.country || ''; if (r.id) idToSlug[r.id] = r.slug; } });
        return { country, idToSlug };
      });
    },
    /* the points and reasons of the match reports among `rows`: { articleId: { points, reasons } } */
    async significance(rows, lo) {
      /* cachedOnly: only what this tab was already told (HOME or News asked); nothing is asked */
      const ids = lo && lo.cachedOnly ? [] : (rows || []).filter(r => isReport(r) && r.id && !(r.id in sigCache)).map(r => r.id);
      if (ids.length) {
        const ask = ids.slice(0, 60);
        ask.forEach(id => { sigCache[id] = null; });
        if (!sigAbsent) {
          try {
            const got = await call('rpc', 'rpc/news_report_significance', { p_article_ids: ask });
            (Array.isArray(got) ? got : []).forEach(g => { if (g && g.article_id) sigCache[g.article_id] = { points: num(g.points), reasons: Array.isArray(g.reasons) ? g.reasons : [] }; });
            const keep = {}; Object.keys(sigCache).slice(-W.SIG_MAX).forEach(k => { keep[k] = sigCache[k]; });
            writeCache(W.SIG_KEY, keep, 0, sessArea);
          } catch (e) { if (e && e.status === 404) sigAbsent = true; /* the reports stand at their tier */ }
        }
      }
      const out = {};
      Object.keys(sigCache).forEach(k => { if (sigCache[k]) out[k] = sigCache[k]; });
      return out;
    }
  };
}
let dnet = null;
const net = () => dnet || (dnet = createNet());

/* the reader's country, from what the device already says */
function country() {
  let tz = '', langs = [];
  try { tz = new Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { tz = ''; }
  try { const n = root.navigator; langs = (n && (n.languages && n.languages.length ? Array.prototype.slice.call(n.languages) : [n.language])) || []; } catch (_) { langs = []; }
  return detectCountry(tz, langs);
}

/* the site's language (the nav's EN / 日本語 / ES), from what i18n.js decided, else what it stored, else the page's */
function siteLang() {
  try { const I = root.EpinoiaI18n; if (I && I.lang) return langCode(I.lang); } catch (_) { /* next */ }
  try { const v = root.localStorage && root.localStorage.getItem('epinoia_lang'); if (v) return langCode(v); } catch (_) { /* next */ }
  try { const v = root.document && root.document.documentElement && root.document.documentElement.lang; if (v) return langCode(v); } catch (_) { /* none */ }
  return '';
}
/* THE LANGUAGES THE READER READS, from the start: the site's, then the browser's (navigator.languages), no duplicates */
function readerLangs(nav, site) {
  const out = [];
  const add = v => { const c = langCode(v); if (c && out.indexOf(c) < 0) out.push(c); };
  add(site === undefined ? siteLang() : site);
  let l = [];
  try { const n = nav === undefined ? root.navigator : nav; l = (n && (n.languages && n.languages.length ? Array.prototype.slice.call(n.languages) : [n.language])) || []; } catch (_) { l = []; }
  l.forEach(add);
  return out;
}

/* THE RANKING OF A POOL OF ROWS, end to end: the profile from the device; the partners, the leagues' countries and the
   match reports' points from the public calls; the follows from follow.js (the reader's account, which the server already
   has). opts: { followedIds (the ids in the reader's own feed, news_feed_mine), now, cachedOnly (ask the server nothing
   that is not cached already: a league's front page, whose page view must not cost a call more; the partners are the
   exception, which that page asks for anyway), leagues ({ slug: country } the caller knows, added to the map) }.
   Personalisation off, or nothing learnable: the newest first, ranked: false. Never throws. */
async function rankRows(rows, opts) {
  const o = opts || {};
  const t = o.now || Date.now();
  const st = o.store || store(), n = o.net || net();
  let partners = new Set();
  try { partners = await n.partners(); } catch (_) { /* none */ }
  if (!st.enabled()) return { rows: rank(rows, { off: true }, t), ranked: false, partners };
  try {
    const co = { cachedOnly: !!o.cachedOnly };
    const [lm0, sig, langMap] = await Promise.all([n.leagueMap(co), n.significance(rows, co), n.languages(co).catch(() => ({}))]);
    const lm = { country: Object.assign({}, lm0.country, o.leagues && o.leagues.country), idToSlug: Object.assign({}, lm0.idToSlug, o.leagues && o.leagues.idToSlug) };
    let followedLeagues = [];
    try {
      const F = root.EpinoiaFollow;
      const prefs = F && typeof F.load === 'function' && F.session && F.session() ? await F.load() : null;
      followedLeagues = ((prefs && prefs.fav_league_ids) || []).map(id => lm.idToSlug[id]).filter(Boolean);
    } catch (_) { /* signed out or no follows */ }
    const P = Object.assign({}, st.profile(), { country: o.country !== undefined ? o.country : country(), leagueCountry: lm.country, partners, sig,
      followedIds: o.followedIds || [], followedLeagues,
      langMap, readLangs: o.readLangs || readerLangs(), langAll: st.langAll ? st.langAll() : false });
    return { rows: rank(rows, P, t), ranked: true, partners };
  } catch (_) {
    return { rows: rank(rows, { off: true }, t), ranked: false, partners };
  }
}

/* ============================================================== the wiring of a page (browser only) === */
/* THE DWELL OF A LEAGUE'S PAGE, and its follows: interest.js calls this. No network, nothing when the reader has switched
   personalisation off or the page is nobody's league; a follow of a league or a club on a league's page counts a little. */
function watchDwell(win, o) {
  const opts = o || {};
  const w = win || root;
  const doc = w.document;
  const st = opts.store || store();
  if (!doc || !st.enabled() || !dwellPage(w.location && w.location.pathname)) return null;
  const slugNow = () => {
    let s = '';
    try { s = w.__CS_LEAGUE_SLUG || new URLSearchParams(w.location.search).get('l') || ''; } catch (_) { s = ''; }
    return /^[a-z0-9-]{1,100}$/.test(s) ? s : '';
  };
  const tracker = dwellTracker({
    now: opts.now || (() => Date.now()), visible: () => doc.visibilityState !== 'hidden', slug: slugNow,
    add: (slug, sec) => { try { st.dwell(slug, sec); } catch (_) { /* nothing */ } }
  });
  const mark = () => tracker.activity();
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll', 'mousemove'].forEach(e => {
    try { w.addEventListener(e, mark, { passive: true, capture: true }); } catch (_) { /* an old browser */ }
  });
  let n = 0;
  const timer = w.setInterval(() => { tracker.tick(); if (++n % Math.round(W.DWELL_FLUSH_MS / W.DWELL_TICK_MS) === 0) tracker.flush(); }, W.DWELL_TICK_MS);
  const onVis = () => { tracker.visibility(doc.visibilityState !== 'hidden'); if (doc.visibilityState === 'hidden') tracker.flush(); };
  doc.addEventListener('visibilitychange', onVis);
  w.addEventListener('pagehide', () => { tracker.visibility(false); tracker.flush(); });
  w.addEventListener('epinoia:follows', e => {
    const d = e && e.detail;
    const slug = slugNow();
    if (d && d.on && slug && (d.kind === 'league' || d.kind === 'team')) { try { st.followed({ league: slug }); } catch (_) { /* nothing */ } }
  });
  return { tracker, stop() { try { w.clearInterval(timer); doc.removeEventListener('visibilitychange', onVis); } catch (_) { /* nothing */ } } };
}

/* THE CONTROL for a feed's heading: { button, panel }. The button ("Personalise") opens the panel under the heading: the
   switch (off = the newest first, nothing recorded, what was learned left as it is), what is kept and where, and the
   reset (what was learned is deleted; the follows are the account's and stay). opts: { base (path to /epinoia/),
   onChange() (the page draws its feed again), store }. Text nodes only. */
function control(opts) {
  const o = opts || {};
  const doc = root.document;
  if (!doc) return null;
  const st = o.store || store();
  const el = (t, c, x) => { const n = doc.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const id = 'pcPers' + Math.floor(Math.random() * 1e6);
  const panel = el('div', 'pc-pers');
  panel.id = id; panel.hidden = true;
  const box = el('div', 'pc-pers-body');
  const row = el('label', 'pc-pers-row');
  const sw = el('input'); sw.type = 'checkbox'; sw.setAttribute('role', 'switch'); sw.checked = st.enabled();
  row.append(sw, el('span', null, 'Personalise my feed'));
  const say = el('p', 'pc-pers-note');
  say.setAttribute('aria-live', 'polite');
  const explain = () => {
    say.textContent = sw.checked
      ? 'The feed learns from the leagues you spend time on, the stories you open, where you are and the languages you read. It is kept only in this browser and is never sent to us.'
      : 'Off: the feed is simply the newest first, and nothing is kept. What was learned before is left as it is.';
  };
  explain();
  sw.addEventListener('change', () => { st.setEnabled(sw.checked); explain(); if (o.onChange) o.onChange(); });
  /* LANGUAGES: what counts as read, and the switch that lifts the hold-back */
  const lrow = el('label', 'pc-pers-row');
  const lsw = el('input'); lsw.type = 'checkbox'; lsw.setAttribute('role', 'switch'); lsw.checked = st.langAll ? st.langAll() : false;
  lrow.append(lsw, el('span', null, 'Show every language'));
  const lnote = el('p', 'pc-pers-note', 'Stories in a language you do not read sit lower in For you. Your site language, your browser\'s languages and any language you open often count as read.');
  const langs = el('div', 'pc-pers-langs');
  const name = c => { try { return new Intl.DisplayNames([siteLang() || 'en'], { type: 'language' }).of(c) || c.toUpperCase(); } catch (_) { return c.toUpperCase(); } };
  const drawLangs = () => {
    langs.textContent = '';
    langs.hidden = lsw.checked;
    if (lsw.checked) return;
    const seen = new Set();
    const chip = (code, how, drop) => {
      const c = el('span', 'pc-pers-lang'); c.dataset.lang = code;
      c.append(el('b', null, code.toUpperCase()), el('span', null, name(code) + ' \u00b7 ' + how));
      if (drop) {
        const b = el('button', 'pc-pers-langx', 'Remove'); b.type = 'button';
        b.setAttribute('aria-label', 'Forget ' + name(code));
        b.addEventListener('click', () => { st.forgetLang(code); drawLangs(); if (o.onChange) o.onChange(); });
        c.appendChild(b);
      }
      langs.appendChild(c);
    };
    const site = siteLang();
    if (site) { seen.add(site); chip(site, 'site language'); }
    readerLangs(undefined, '').forEach(code => { if (!seen.has(code)) { seen.add(code); chip(code, 'browser language'); } });
    (st.langs ? st.langs() : []).forEach(x => { if (!seen.has(x.lang) && x.unlocked >= 0.02) { seen.add(x.lang); chip(x.lang, 'you read it, ' + Math.round(x.unlocked * 100) + '%', true); } });
  };
  lsw.addEventListener('change', () => { st.setLangAll(lsw.checked); drawLangs(); if (o.onChange) o.onChange(); });
  drawLangs();
  const reset = el('button', 'pc-pers-reset', 'Reset what the site has learned');
  reset.type = 'button';
  reset.addEventListener('click', () => {
    st.reset();
    say.textContent = 'Forgotten: what was learned, the languages included, is deleted from this browser. What you follow is untouched.';
    drawLangs();
    if (o.onChange) o.onChange();
  });
  const more = el('a', 'pc-pers-more', 'How this works');
  more.href = (o.base || '../') + 'privacy/#feedSec';
  const acts = el('div', 'pc-pers-acts');
  acts.append(reset, more);
  box.append(row, say, lrow, lnote, langs, acts);
  panel.appendChild(box);
  const button = el('button', 'pc-pers-btn', 'Personalise');
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', id);
  button.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) { sw.checked = st.enabled(); lsw.checked = st.langAll ? st.langAll() : false; drawLangs(); }
  });
  return { button, panel };
}

return {
  W, HOUR, DAY,
  recency, decay, sat, partnerFade, scoreOf, whyOf, rank, rankRows, GROUPS, groupOf, groupWeights, scoreMax,
  langCode, langOf, langOfKey, siteLang, readerLangs, SOURCE_LANG, LANG_CACHE,
  detectCountry, countryMatch, countryCodes, neighbours, country, TZ, REGIONS,
  tierOf, isReport, pkeyOf, sourceOf, leaguesOf, readKeys, partnerSet, isRead,
  emptyState, sane, addPoints, addDwell, noteOpen, noteVisit, noteFollow, noteShown, prune,
  dwellTracker, dwellPage, watchDwell,
  createStore, createNet, memoryStorage, control,
  store, net,
  /* the browser's default store, as a page uses it */
  enabled: () => { try { return store().enabled(); } catch (_) { return false; } },
  opened: row => { try { return store().opened(row); } catch (_) { return false; } },
  visited: key => { try { return store().visited(key); } catch (_) { return false; } },
  shown: ids => { try { return store().shown(ids); } catch (_) { return false; } },
  partners: () => net().partners().catch(() => new Set())
};
}));
