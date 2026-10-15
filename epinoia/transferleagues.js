'use strict';
/* ============================================================================
   THE LEAGUE MATRIX'S LEAGUES ON EPINOIA (2026-10-15).      window.EpinoiaTransferLeagues

   The transfer matrix (transfer-scale.json) measures how a player's rates move when he changes league: one row per
   league, named the way the matrix names it ("Spanish ACB", "German Pro A", "Adriatic League Liga ABA"). The site
   names its leagues its own way ("Liga Endesa", "ProA", "ABA League"). This file is the bridge, and nothing else:
   pure functions, no fetch (transferadjust.js reads the files and does the arithmetic).

   1. EVERY MATRIX NAME IS READ (parseMatrix): the countries it is in (a nationality adjective is a country code,
      "Estonian-Latvian" is EE+LV, the Adriatic league XB, the European club competitions EU), what kind of league
      it is ('pro', 'college', 'international', 'pro-development') and where it sits in its country's pyramid. A name
      alone cannot say that ProA is Germany's second division, so the divisions are an explicit table (TIER).

   2. EVERY SITE LEAGUE IS MATCHED (mapping), in this order:
        'direct'        the explicit table (ALIASES), else a name or an abbreviation that matches within the same
                        country and division (BBL in "easyCredit BBL" and "German BBL")
        'country-tier'  else the one matrix league of the same country and the same division
        'estimate'      else a men's league with a place on the SPANISH LADDER (SPANISH_RUNG): rung 1 is Liga Endesa,
                        2 Primera FEB, 3 Segunda FEB. Nothing below Segunda FEB is measured, so a rung past 3 continues
                        the measured step from Primera FEB to Segunda FEB, stat by stat, and is EXTRAPOLATED; every
                        figure adjusted through one says "estimated"
        'none'          a women's league (the matrix is men's leagues only: never offered), or a league with no match
                        and no rung. A NEW MEN'S LEAGUE IS GIVEN A RUNG HERE (with its reason), or it is never offered.

   The rungs are proposals, written up league by league in docs/transfer-leagues.md: change the number here and the
   note there together.

   API
     parseMatrix(name)                     -> { name, countries, tier, kind }
     mapping(siteLeagues, tiers, scale)    -> { [slug]: { slug, name, matrix, method, rung?, extrapolated?, estimated,
                                               label, note } }      siteLeagues: [{ slug, name, country, gender }];
                                               tiers: EPINOIA_LEAGUE_TIERS; scale: the file, or null to match against
                                               every league the matrix is known to hold
     targets(map)                          -> the adjustable leagues for a menu: measured first, then estimated, each
                                               by name
     genderOf(league, tiers)               -> 'men' | 'women'
     ladderNote(rung)                      -> the reader's sentence for an estimated league
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaTransferLeagues = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* ----------------------------------------------------------- the countries --- */
/* a nationality as the matrix writes it, longest first so "South Korean" is read before "Korean" */
const NATIONS = [
  ['north macedonian', 'MK'], ['south korean', 'KR'], ['south african', 'ZA'], ['new zealand', 'NZ'], ['puerto rican', 'PR'],
  ['argentinian', 'AR'], ['argentine', 'AR'], ['australian', 'AU'], ['austrian', 'AT'], ['azerbaijani', 'AZ'], ['albanian', 'AL'],
  ['belarusian', 'BY'], ['belgian', 'BE'], ['bosnian', 'BA'], ['brazilian', 'BR'], ['british', 'GB'], ['bulgarian', 'BG'],
  ['canadian', 'CA'], ['chilean', 'CL'], ['chinese', 'CN'], ['colombian', 'CO'], ['croatian', 'HR'], ['cypriot', 'CY'],
  ['czech', 'CZ'], ['danish', 'DK'], ['dominican', 'DO'], ['dutch', 'NL'], ['egyptian', 'EG'], ['english', 'GB'],
  ['estonian', 'EE'], ['filipino', 'PH'], ['finnish', 'FI'], ['french', 'FR'], ['georgian', 'GE'], ['german', 'DE'],
  ['greek', 'GR'], ['hungarian', 'HU'], ['icelandic', 'IS'], ['indonesian', 'ID'], ['iranian', 'IR'], ['irish', 'IE'],
  ['israeli', 'IL'], ['italian', 'IT'], ['japanese', 'JP'], ['jordanian', 'JO'], ['kazakh', 'KZ'], ['korean', 'KR'],
  ['kosovan', 'XK'], ['kosovo', 'XK'], ['latvian', 'LV'], ['lebanese', 'LB'], ['lithuanian', 'LT'], ['luxembourgish', 'LU'],
  ['macedonian', 'MK'], ['mexican', 'MX'], ['montenegrin', 'ME'], ['norwegian', 'NO'], ['philippine', 'PH'], ['polish', 'PL'],
  ['portuguese', 'PT'], ['romanian', 'RO'], ['russian', 'RU'], ['scottish', 'GB'], ['serbian', 'RS'], ['slovak', 'SK'],
  ['slovakian', 'SK'], ['slovenian', 'SI'], ['spanish', 'ES'], ['swedish', 'SE'], ['swiss', 'CH'], ['taiwanese', 'TW'],
  ['turkish', 'TR'], ['ukrainian', 'UA'], ['uruguayan', 'UY'], ['venezuelan', 'VE']
].sort((a, b) => b[0].length - a[0].length);
/* a country's own name, as a site league may carry it ("NBL Bulgaria"): left out when names are compared */
const COUNTRY_WORDS = new Set(['albania', 'australia', 'austria', 'azerbaijan', 'belgium', 'bosnia', 'brazil', 'britain', 'bulgaria',
  'canada', 'china', 'croatia', 'cyprus', 'czech', 'czechia', 'denmark', 'england', 'estonia', 'finland', 'france', 'georgia', 'germany',
  'greece', 'hungary', 'ireland', 'israel', 'italy', 'japan', 'korea', 'kosovo', 'latvia', 'lebanon', 'lithuania', 'macedonia',
  'mexico', 'montenegro', 'netherlands', 'norway', 'poland', 'portugal', 'romania', 'serbia', 'slovakia', 'slovenia', 'spain',
  'sweden', 'switzerland', 'turkey', 'ukraine', 'venezuela']);

/* ------------------------------------------------------- the matrix's leagues --- */
/* THE NAMES THAT DO NOT SAY THEIR OWN COUNTRY: the cross-border competitions and the leagues named without a nationality */
const COUNTRIES = {
  'Euroleague': ['EU'], 'Eurocup': ['EU'], 'Basketball Champions League Europe': ['EU'], 'FIBA Europe Cup': ['EU'],
  'VTB United League': ['RU'], 'Basketball Champions League Americas': ['XA'],           /* XA: the Americas, a code of our own */
  'Adriatic League Liga ABA': ['XB'], 'BNXT League': ['BE', 'NL'], 'Estonian-Latvian Basketball League': ['EE', 'LV'],
  'Super League Basketball': ['GB'], 'PBA - Commissioners Cup': ['PH'], 'NBA': ['US'], 'G-League': ['US']
};
const INTERNATIONAL = new Set(['Euroleague', 'Eurocup', 'Basketball Champions League Europe', 'FIBA Europe Cup', 'VTB United League',
  'Basketball Champions League Americas']);
/* WHERE EACH SITS IN ITS COUNTRY'S PYRAMID, where the name cannot say. Every other league is its country's top
   division (1). A cross-border competition counts in its own pyramid, as the site's tiers do (EuroLeague 1; EuroCup
   and the Champions League 2; the Europe Cup 3). The CIBACOPA is a professional league of its own; the LNBP is
   Mexico's national top flight (the site's tiers, Louie). */
const TIER = {
  'Spanish ACB': 1, 'Spanish Primera FEB': 2, 'Spanish Segunda FEB': 3,
  'French Jeep Elite': 1, 'French LNB Pro B': 2, 'French NM1': 3,
  'German BBL': 1, 'German Pro A': 2, 'German Pro B': 3,
  'Italian Lega Basket Serie A': 1, 'Italian Serie A2 Basket': 2,
  'Greek HEBA A1': 1, 'Greek HEBA A2': 2,
  'Turkish BSL': 1, 'Turkish TBL': 2,
  'Mexican LNBP': 1, 'Mexican CIBACOPA': 2,
  'NBA': 1, 'G-League': 2,
  'Euroleague': 1, 'Eurocup': 2, 'Basketball Champions League Europe': 2, 'FIBA Europe Cup': 3
};
/* a name the table above does not know: a second or third division by the words it uses */
const SECOND = /\b(a2|primera feb|leb oro|second|2nd)\b/i;
const THIRD = /\b(segunda feb|leb plata|nm1|third|3rd)\b/i;

const norm = s => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

function nationsIn(name) {
  const n = norm(name);
  /* "Estonian-Latvian ...": every nationality before the first word that is not one */
  const out = [];
  let rest = n;
  for (;;) {
    const hit = NATIONS.find(([adj]) => rest.startsWith(adj + ' ') || rest.startsWith(adj + '-') || rest === adj);
    if (!hit) break;
    if (out.indexOf(hit[1]) < 0) out.push(hit[1]);
    rest = rest.slice(hit[0].length).replace(/^[-\s]+/, '');
  }
  return { codes: out, rest };
}

function parseMatrix(name) {
  const n = String(name == null ? '' : name).trim();
  const college = /^ncaa\b/i.test(n);
  const own = COUNTRIES[n];
  const nat = nationsIn(n);
  const countries = own ? own.slice() : college ? ['US'] : nat.codes.length ? nat.codes : [];
  const kind = INTERNATIONAL.has(n) ? 'international' : college ? 'college' : n === 'G-League' ? 'pro-development' : 'pro';
  let tier = TIER[n];
  if (tier == null) tier = THIRD.test(norm(n)) ? 3 : SECOND.test(norm(n)) ? 2 : 1;
  return { name: n, countries, tier, kind };
}

/* EVERY LEAGUE THE MATRIX IS KNOWN TO HOLD (2017-2025, men's), for a mapping drawn before the file is read */
const KNOWN = ['G-League', 'NBA', 'Spanish Segunda FEB', 'French NM1', 'Chinese CBA', 'German Pro B', 'Japanese B.League',
  'Italian Serie A2 Basket', 'Basketball Champions League Europe', 'FIBA Europe Cup', 'Spanish ACB', 'Argentinian Liga A',
  'Euroleague', 'Spanish Primera FEB', 'German BBL', 'French LNB Pro B', 'Serbian KLS', 'Turkish TBL', 'French Jeep Elite',
  'Eurocup', 'German Pro A', 'Brazilian NBB', 'Turkish BSL', 'Polish OBL', 'Romanian Divizia A', 'Greek HEBA A2',
  'Italian Lega Basket Serie A', 'Adriatic League Liga ABA', 'Hungarian NBIA', 'Mexican LNBP', 'Greek HEBA A1',
  'Estonian-Latvian Basketball League', 'Czech NBL', 'Israeli BSL', 'Puerto Rican BSN', 'Croatian A-1 Liga',
  'NCAA Atlantic Coast Conference', 'VTB United League', 'South Korean KBL', 'NCAA Big Ten Conference',
  'NCAA Southeastern Conference', 'Bosnian BiH Liga', 'Venezuelan SLB', 'BNXT League', 'NCAA Atlantic 10 Conference',
  'Portuguese LPB', 'Finnish Korisliiga', 'Lithuanian LKL', 'Montenegrin Prva A Liga', 'NCAA Conference USA',
  'Danish Basketligaen', 'Slovenian SKL', 'NCAA Sun Belt Conference', 'NCAA Southland Conference', 'NCAA Mid-American Conference',
  'Austrian A Bundesliga', 'Bulgarian NBL', 'Georgian Super Liga', 'NCAA American Conference', 'Norwegian BLNO', 'Australian NBL',
  'Swedish Basketligan', 'Swiss LNA', 'NCAA Big 12 Conference', 'NCAA Metro Atlantic Athletic Conference',
  'NCAA Ohio Valley Conference', 'NCAA Coastal Athletic Association', 'NCAA Big Sky Conference', 'NCAA Mountain West Conference',
  'Slovakian Extraliga', 'NCAA Southwestern Athletic Conference', 'Mexican CIBACOPA', 'Irish Super League', 'NCAA Big South Conference',
  'NCAA Big East Conference', 'NCAA Missouri Valley Conference', 'NCAA Horizon League', 'Cypriot Division A',
  'NCAA Mid-Eastern Athletic Conference', 'NCAA Atlantic Sun Conference', 'NCAA West Coast Conference', 'NCAA Big West Conference',
  'New Zealand NBL', 'NCAA Northeast Conference', 'NCAA Pacific-12 Conference', 'NCAA Southern Conference', 'NCAA Patriot League',
  'Kosovo FBK', 'Lebanese Division A', 'NCAA Western Athletic Conference', 'NCAA The Summit League',
  'Canadian Elite Basketball League', 'NCAA Ivy League', 'Basketball Champions League Americas', 'PBA - Commissioners Cup',
  'Super League Basketball', 'NCAA Independents Conference'];

/* ------------------------------------------------------------ the site's side --- */
/* THE SITE LEAGUE BEHIND EACH MATRIX LEAGUE, where the names do not meet. Reasons where a reader might wonder:
   the Greek Elite League IS the old A2 renamed (the second division: the site's tier 2); the Winner League is the
   Israeli BSL under its sponsor; the Liga Nationala is Romania's first division ("Divizia A" before its renaming);
   the Tipos SBL is the Slovak Extraliga; the SB League the Swiss LNA; the ORLEN Basket Liga the Polish OBL;
   Betclic ELITE and ELITE 2 the French top two (once Jeep Elite and Pro B); B.LEAGUE Premier the top division the
   matrix's B.League (B1) became in 2026. */
const ALIASES = {
  'liga-endesa': 'Spanish ACB', 'primera-feb': 'Spanish Primera FEB', 'segunda-feb': 'Spanish Segunda FEB',
  'lnb-elite': 'French Jeep Elite', 'lnb-elite-2': 'French LNB Pro B',
  'bbl': 'German BBL', 'proa': 'German Pro A', 'prob': 'German Pro B',
  'lega-basket-serie-a': 'Italian Lega Basket Serie A',
  'greek-elite-league': 'Greek HEBA A2',
  'winner-league': 'Israeli BSL',
  'b-league-premier': 'Japanese B.League',
  'kbl': 'South Korean KBL',
  'lkl': 'Lithuanian LKL',
  'aba-league': 'Adriatic League Liga ABA',
  'slovak-sbl': 'Slovakian Extraliga',
  'sb-league': 'Swiss LNA',
  'orlen-basket-liga': 'Polish OBL',
  'lnbm': 'Romanian Divizia A',
  'kosovo-superliga': 'Kosovo FBK',
  'slb-men': 'Super League Basketball',
  'euroleague': 'Euroleague', 'eurocup': 'Eurocup', 'basketball-champions-league': 'Basketball Champions League Europe',
  'fiba-europe-cup': 'FIBA Europe Cup',
  'nbl': 'Australian NBL', 'nbb': 'Brazilian NBB', 'cebl': 'Canadian Elite Basketball League', 'czech-nbl': 'Czech NBL',
  'basketligaen': 'Danish Basketligaen', 'estonian-latvian-basketball-league': 'Estonian-Latvian Basketball League',
  'korisliiga': 'Finnish Korisliiga', 'nbl-bulgaria': 'Bulgarian NBL', 'bnxt-league': 'BNXT League',
  'cibacopa': 'Mexican CIBACOPA', 'lnbp': 'Mexican LNBP', 'basketligan': 'Swedish Basketligan'
};

/* THE SPANISH LADDER: where a men's league with no matrix row of its own is placed. 1 Liga Endesa, 2 Primera FEB,
   3 Segunda FEB; a half is halfway between; past 3 is EXTRAPOLATED (the step from Primera FEB to Segunda FEB again,
   per stat). Proposed 2026-10-15 for Louie to confirm; the reasons, longer, in docs/transfer-leagues.md. */
const SPANISH_RUNG = {
  'b-league-one': 2.5,               // Japan's new second division: the old B1 clubs short of a Premier licence, and B2's best
  'nkl': 3,                          // Lithuania's second division: LKL prospects and veterans, a professional league below the LKL
  'aba-league-2': 3,                 // the Adriatic second division: young squads of the region's clubs, below ABA League
  '1-liga-mezczyzn': 3,              // Poland's second division: professional, imports few, below the ORLEN Basket Liga
  'macedonian-super-league': 3,      // a top flight whose best clubs play the Europe Cup and ABA League 2
  'liga-ouro': 3.5,                  // Brazil's second division: below the NBB, short seasons, few imports
  'nbl1-men': 3.5,                   // Australia's semi-professional second level: college players and former NBL players
  'azerbaijan-basketball-league': 3.5, // a small top flight that leans on imports
  'czech-1-liga': 4,                 // the Czech second division: semi-professional, below Kooperativa NBL
  'kkm-albania': 4,                  // a small top flight, few professionals
  'bcb': 4,                          // Britain's second level, below Super League Basketball
  'nlb-men': 4.5,                    // Switzerland's second division, below the SB League (itself measured near the ladder's foot)
  'i-divisioona-a': 4.5,             // Finland's second division, below the Korisliiga
  'u-sports': 4.5,                   // Canadian university basketball
  'ncaa-d2-men': 4.5,                // NCAA Division II: below the Division I conferences the matrix measures
  'nbl-d1': 5,                       // Britain's third level: semi-professional and amateur
  'i-divisioona-b': 5.5              // Finland's third division
};
/* YOUTH LEAGUES ARE NEVER ADJUSTED (Louie, 2026-10-15): a league the site files under a youth tier (config.js
   EPINOIA_LEAGUE_TIERS 'y1' / 'y2': Espoirs, Liga U, ABA U19, EABL ...) is offered neither as a target nor as a
   player's own league. */
const isYouth = tier => typeof tier === 'string' && /^y\d/.test(tier);
const LADDER = ['Spanish ACB', 'Spanish Primera FEB', 'Spanish Segunda FEB'];
/* the site's own names for the ladder's three, as the reader knows them */
const LADDER_SITE = ['Liga Endesa', 'Primera FEB', 'Segunda FEB'];

/* every sentence a reader can be shown, fixed, so a translation can find each one whole */
const NOTES = {
  direct: 'Measured from players who moved between leagues.',
  'country-tier': 'Measured from players who moved between leagues, matched by country and division.',
  women: 'The league matrix covers men’s leagues only.',
  youth: 'Youth leagues are not adjusted.',
  none: 'No measured moves for this league, and no place on the Spanish ladder yet.'
};
const BELOW = { 0.5: 'half a level', 1: 'one level', 1.5: 'one and a half levels', 2: 'two levels', 2.5: 'two and a half levels', 3: 'three levels' };
function ladderNote(rung) {
  const r = Number(rung);
  if (!(r > 0)) return NOTES.none;
  if (r <= 1) return 'Estimated: no measured moves, so it is placed at Liga Endesa level.';
  if (r < 2) return 'Estimated: no measured moves, so it is placed between Liga Endesa and Primera FEB.';
  if (r === 2) return 'Estimated: no measured moves, so it is placed at Primera FEB level.';
  if (r < 3) return 'Estimated: no measured moves, so it is placed between Primera FEB and Segunda FEB.';
  if (r === 3) return 'Estimated: no measured moves, so it is placed at Segunda FEB level.';
  const b = BELOW[Math.round((r - 3) * 2) / 2];
  return b ? 'Estimated: no measured moves, so it is placed ' + b + ' below Segunda FEB, extrapolated from the step between Primera FEB and Segunda FEB.'
    : 'Estimated: no measured moves, so it is placed below Segunda FEB, extrapolated from the step between Primera FEB and Segunda FEB.';
}

/* WOMEN'S OR MEN'S: the league's own gender (0131), else the side its tier is filed under, else its name. A league
   that says neither is a men's league, as the tiers take it. */
const WOMEN_NAME = /\b(women|womens|women's|women’s|ladies|female|femenina|femminile|feminin|femra|femmes|kobiet|naisten|kvinde|dam|damen|zbl|wnbl|weabl|w league)\b/i;
function genderOf(league, tiers) {
  const l = league || {};
  if (l.gender === 'women' || l.gender === 'men') return l.gender;
  const t = (tiers || {})[l.slug];
  if (t && t[1] === 'w') return 'women';
  if (t && t[1] === 'm') return 'men';
  return WOMEN_NAME.test(norm(l.name) + ' ' + norm(String(l.slug || '').replace(/-/g, ' '))) ? 'women' : 'men';
}

/* ------------------------------------------------------------ name matching --- */
const STOP = new Set(['league', 'liga', 'basketball', 'basket', 'baschet', 'basketbal', 'de', 'the', 'of', 'men', 'mens', 'man', 'masculin',
  'national', 'nationala', 'la', 'le', 'el']);
/* a sponsor in a league's name is not its name */
const SPONSORS = new Set(['easycredit', 'betclic', 'kooperativa', 'tipos', 'orlen', 'endesa', 'jeep', 'winner', 'chance', 'turkish airlines']);
const squash = s => norm(s).replace(/[^a-z0-9]+/g, '');
function tokensOf(s, nations) {
  let n = norm(s);
  if (nations) n = nationsIn(n).rest;
  return n.split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t) && !SPONSORS.has(t) && !COUNTRY_WORDS.has(t));
}
/* how alike a site league's name and a matrix name are, 0 to 1 */
function likeness(siteName, matrixName) {
  const a = squash(siteName), whole = squash(matrixName), bare = squash(nationsIn(matrixName).rest);
  if (!a) return 0;
  if (a === whole || a === bare) return 1;
  const words = norm(matrixName).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length > 2 && a === words.map(w => w[0]).join('')) return 0.9;               /* CEBL */
  const A = tokensOf(siteName, false), B = tokensOf(matrixName, true);
  if (!A.length || !B.length) return 0;
  if (A.join('') === B.join('')) return 1;                                                /* ProA, Pro A */
  const sa = new Set(A), sb = new Set(B);
  const both = [...sa].filter(t => sb.has(t)).length;
  return both / new Set([...sa, ...sb]).size;
}

/* ---------------------------------------------------------------- mapping --- */
const sameSet = (a, b) => a.length === b.length && a.every(x => b.indexOf(x) >= 0);
const countriesOf = c => String(c || '').toUpperCase().split(/[+,/\s]+/).filter(x => /^[A-Z]{2}$/.test(x));
/* the matrix leagues a file holds: a league with no net row at all is not one it can adjust */
function heldBy(scale) {
  if (!scale || !scale.leagues) return KNOWN.slice();
  return Object.keys(scale.leagues).filter(n => {
    const L = scale.leagues[n];
    return L && Array.isArray(L.net) && L.net.some(v => typeof v === 'number' && isFinite(v));
  });
}

/* opts.aliases === false: the names alone (the tests ask, to show the matching stands without the table) */
function mapping(siteLeagues, tiers, scale, opts) {
  const T = tiers || {};
  const useAliases = !(opts && opts.aliases === false);
  const held = heldBy(scale);
  const has = new Set(held);
  const parsed = held.map(parseMatrix);
  const ladderOk = LADDER.every(n => has.has(n));
  const out = {};
  (siteLeagues || []).forEach(l => {
    if (!l || !l.slug) return;
    const slug = String(l.slug);
    const name = String(l.name || slug);
    const t = T[slug] || null;
    const tier = t ? t[0] : null;
    const gender = genderOf(l, T);
    const e = { slug, name, label: name, gender, tier, matrix: null, method: 'none', estimated: false, note: '' };
    out[slug] = e;
    if (gender === 'women') { e.note = NOTES.women; return; }
    if (isYouth(tier)) { e.note = NOTES.youth; return; }
    /* 1. the explicit table */
    const alias = useAliases ? ALIASES[slug] : null;
    if (alias && has.has(alias)) { e.matrix = alias; e.method = 'direct'; e.note = NOTES.direct; return; }
    /* 2. a name or an abbreviation, within the same countries and the same division */
    const cs = countriesOf(l.country);
    const numeric = typeof tier === 'number';
    const fits = p => cs.length && sameSet(p.countries, cs) &&
      (numeric ? p.tier === tier && p.kind !== 'college' : tier == null);
    const scored = parsed.filter(fits).map(p => ({ p, s: likeness(name, p.name) })).filter(x => x.s >= (numeric ? 0.75 : 0.99))
      .sort((a, b) => b.s - a.s);
    if (scored.length && (scored.length === 1 || scored[0].s > scored[1].s)) {
      e.matrix = scored[0].p.name; e.method = 'direct'; e.note = NOTES.direct; return;
    }
    /* 3. the one league of the same countries and division */
    if (numeric && cs.length) {
      const same = parsed.filter(p => sameSet(p.countries, cs) && p.tier === tier && p.kind !== 'college');
      if (same.length === 1) { e.matrix = same[0].name; e.method = 'country-tier'; e.note = NOTES['country-tier']; return; }
    }
    /* 4. the Spanish ladder */
    const rung = SPANISH_RUNG[slug];
    if (rung != null && ladderOk) {
      e.method = 'estimate'; e.rung = rung; e.extrapolated = rung > 3; e.estimated = true; e.note = ladderNote(rung);
      return;
    }
    e.note = NOTES.none;
  });
  return out;
}

/* THE MENU: every league a figure can be adjusted to, measured first then estimated, each group by name */
const adjustable = e => !!e && (e.method === 'direct' || e.method === 'country-tier' || e.method === 'estimate');
function targets(map) {
  const list = Object.values(map || {}).filter(adjustable);
  const by = (a, b) => String(a.label).localeCompare(String(b.label), 'en', { sensitivity: 'base' });
  return list.filter(e => !e.estimated).sort(by).concat(list.filter(e => e.estimated).sort(by));
}

return { parseMatrix, mapping, targets, adjustable, genderOf, isYouth, ladderNote, likeness, nationsIn,
         NATIONS, TIER, ALIASES, SPANISH_RUNG, LADDER, LADDER_SITE, KNOWN, NOTES };
}));
