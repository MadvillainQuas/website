/* ============================================================================
   THE LEAGUE MATRIX'S LEAGUES ON EPINOIA -- epinoia/transferleagues.js, against the real names.

   The two lists below are the real ones on 2026-10-15: every league the matrix holds (with its player-seasons and its
   span) and every league on the site (country | gender as the database has it | slug | name | visibility).

     1. every matrix name reads as its countries, its division and its kind
     2. every site men's league resolves: measured ('direct' / 'country-tier') or estimated on the Spanish ladder; the
        private and test leagues are not offered; no women's league is ever offered
     3. twenty-five mappings, one by one
     4. without the explicit table, names and abbreviations still find most of the measured leagues, in their own
        country and division, and never a wrong one
     5. a league in a country the matrix covers, at a division it has, matches by country and division
     6. estimates: on the ladder, rungs past Segunda FEB extrapolated, and each says so in words a reader is shown
     7. a file that lacks a league turns its direct match into the next step down; the menu lists measured first
     8. the file says nothing of where the numbers came from

     node supabase/tests/transfer-leagues.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
const require = createRequire(import.meta.url);
const TL = require(path.join(ROOT, 'epinoia', 'transferleagues.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); }
  else { fail++; console.log('  FAIL  ' + n + (d != null ? '\n          ' + d : '')); } };

/* the site's tiers, read out of config.js as the browser would have them */
const cfg = rd('epinoia', 'config.js');
const TIERS = Function('return ' + /window\.EPINOIA_LEAGUE_TIERS = (\{[\s\S]*?\n\});/.exec(cfg)[1])();

const MATRIX_TXT = `
  4463  2017-2025  G-League
  3327  2017-2025  NBA
  2577  2017-2025  Spanish Segunda FEB
  2573  2017-2025  French NM1
  2458  2017-2025  Chinese CBA
  2456  2017-2025  German Pro B
  2406  2017-2025  Japanese B.League
  2362  2017-2025  Italian Serie A2 Basket
  2137  2018-2025  Basketball Champions League Europe
  2079  2018-2025  FIBA Europe Cup
  2029  2017-2025  Spanish ACB
  2013  2017-2025  Argentinian Liga A
  2011  2017-2025  Euroleague
  1874  2017-2025  Spanish Primera FEB
  1847  2017-2025  German BBL
  1798  2017-2025  French LNB Pro B
  1781  2017-2025  Serbian KLS
  1746  2017-2025  Turkish TBL
  1734  2017-2025  French Jeep Elite
  1717  2018-2025  Eurocup
  1705  2017-2025  German Pro A
  1669  2017-2025  Brazilian NBB
  1650  2017-2025  Turkish BSL
  1613  2017-2025  Polish OBL
  1564  2017-2025  Romanian Divizia A
  1560  2017-2025  Greek HEBA A2
  1531  2017-2025  Italian Lega Basket Serie A
  1425  2017-2025  Adriatic League Liga ABA
  1404  2017-2025  Hungarian NBIA
  1346  2017-2025  Mexican LNBP
  1328  2017-2025  Greek HEBA A1
  1315  2018-2025  Estonian-Latvian Basketball League
  1311  2017-2025  Czech NBL
  1288  2017-2025  Israeli BSL
  1269  2018-2025  Puerto Rican BSN
  1261  2017-2025  Croatian A-1 Liga
  1251  2014-2025  NCAA Atlantic Coast Conference
  1247  2018-2025  VTB United League
  1219  2017-2025  South Korean KBL
  1205  2014-2025  NCAA Big Ten Conference
  1204  2014-2025  NCAA Southeastern Conference
  1193  2017-2025  Bosnian BiH Liga
  1184  2017-2025  Venezuelan SLB
  1173  2021-2025  BNXT League
  1168  2014-2025  NCAA Atlantic 10 Conference
  1160  2017-2025  Portuguese LPB
  1147  2017-2025  Finnish Korisliiga
  1112  2017-2025  Lithuanian LKL
  1056  2018-2025  Montenegrin Prva A Liga
  1052  2014-2025  NCAA Conference USA
  1045  2017-2025  Danish Basketligaen
  1023  2017-2025  Slovenian SKL
  1018  2014-2025  NCAA Sun Belt Conference
  1003  2014-2025  NCAA Southland Conference
   998  2014-2025  NCAA Mid-American Conference
   993  2017-2025  Austrian A Bundesliga
   991  2017-2025  Bulgarian NBL
   967  2017-2025  Georgian Super Liga
   963  2014-2025  NCAA American Conference
   956  2018-2025  Norwegian BLNO
   952  2017-2025  Australian NBL
   947  2017-2025  Swedish Basketligan
   943  2017-2025  Swiss LNA
   939  2014-2025  NCAA Big 12 Conference
   938  2014-2025  NCAA Metro Atlantic Athletic Conference
   932  2014-2025  NCAA Ohio Valley Conference
   927  2014-2025  NCAA Coastal Athletic Association
   910  2014-2025  NCAA Big Sky Conference
   903  2014-2025  NCAA Mountain West Conference
   901  2017-2025  Slovakian Extraliga
   881  2014-2025  NCAA Southwestern Athletic Conference
   877  2017-2025  Mexican CIBACOPA
   877  2016-2025  Irish Super League
   872  2014-2025  NCAA Big South Conference
   867  2014-2025  NCAA Big East Conference
   865  2014-2025  NCAA Missouri Valley Conference
   861  2014-2025  NCAA Horizon League
   845  2017-2025  Cypriot Division A
   839  2014-2025  NCAA Mid-Eastern Athletic Conference
   837  2014-2025  NCAA Atlantic Sun Conference
   831  2014-2025  NCAA West Coast Conference
   827  2014-2025  NCAA Big West Conference
   810  2017-2025  New Zealand NBL
   809  2014-2025  NCAA Northeast Conference
   809  2014-2023  NCAA Pacific-12 Conference
   805  2014-2025  NCAA Southern Conference
   796  2014-2025  NCAA Patriot League
   790  2017-2025  Kosovo FBK
   786  2017-2025  Lebanese Division A
   767  2014-2025  NCAA Western Athletic Conference
   727  2014-2025  NCAA The Summit League
   682  2018-2025  Canadian Elite Basketball League
   592  2014-2025  NCAA Ivy League
   560  2019-2025  Basketball Champions League Americas
   406  2022-2025  PBA - Commissioners Cup
   214  2024-2025  Super League Basketball
    25  2014-2023  NCAA Independents Conference`;
const MATRIX = MATRIX_TXT.split('\n').map(l => /^\s*\d+\s+\d{4}-\d{4}\s+(.+?)\s*$/.exec(l)).filter(Boolean).map(m => m[1]);

const SITE_TXT = `
AL|women|kkf-albania|Kampionati Kombëtar Femra|public
AL|men|kkm-albania|Kampionati Kombëtar Meshkuj|public
AU|-|nbl|NBL|public
AU|-|nbl1-men|NBL1 Men|public
AU|women|nbl1-women|NBL1 Women|public
AU|women|wnbl|WNBL|public
AZ|men|azerbaijan-basketball-league|Azerbaijan Basketball League|public
BE+NL|-|bnxt-league|BNXT League|public
BG|-|nbl-bulgaria|NBL Bulgaria|public
BR|-|liga-ouro|Liga Ouro|public
BR|-|nbb|NBB|public
CA|men|cebl|CEBL|public
CA|-|u-sports|U SPORTS|public
CH|men|nlb-men|NLB Men|public
CH|women|nlb-women|NLB Women|public
CH|men|sb-league|SB League|public
CH|women|sb-league-women|SB League Women|public
CZ|-|czech-1-liga|1. liga mužů|public
CZ|women|czech-zbl|Chance ŽBL|public
CZ|-|czech-nbl|Kooperativa NBL|public
DE|-|bbl|easyCredit BBL|public
DE|-|proa|ProA|public
DE|-|prob|ProB|public
DK|men|basketligaen|Basketligaen|public
DK|women|kvinde-basketligaen|Kvinde Basketligaen|public
EE+LV|-|estonian-latvian-basketball-league|Estonian-Latvian Basketball League|public
ES|-|liga-endesa|Liga Endesa|public
ES|women|liga-femenina-2|Liga Femenina 2|public
ES|women|liga-femenina-challenge|Liga Femenina Challenge|public
ES|women|liga-femenina-endesa|Liga Femenina Endesa|public
ES|-|liga-u|Liga U|public
ES|-|primera-feb|Primera FEB|public
ES|-|segunda-feb|Segunda FEB|public
EU|-|basketball-champions-league|Basketball Champions League|public
EU|-|eurocup|EuroCup|public
EU|-|euroleague|EuroLeague|public
EU|-|fiba-europe-cup|FIBA Europe Cup|public
FI|men|i-divisioona-a|I divisioona A|public
FI|men|i-divisioona-b|I divisioona B|public
FI|men|korisliiga|Korisliiga|public
FI|women|naisten-korisliiga|Naisten Korisliiga|public
FR|-|lnb-elite|Betclic ÉLITE|public
FR|-|lnb-elite-2|ÉLITE 2|public
FR|-|lnb-espoirs-elite|Espoirs ÉLITE|public
FR|-|lnb-espoirs-elite-2|Espoirs ÉLITE 2|public
GB|men|bcb|British Championship Basketball|public
GB|-|eabl|Elite Academy Basketball League|public
GB|-|nbl-d1|NBL Division One|public
GB|men|slb-men|Super League Basketball Men|public
GB|women|slb-women|Super League Basketball Women|public
GB|women|wnbl-d1|WNBL Division One|public
GB|women|weabl|Women's Elite Academy Basketball League|public
GR|-|greek-elite-league|Greek Elite League|public
IL|-|winner-league|Winner League|public
IT|-|lega-basket-serie-a|Lega Basket Serie A|public
IT|women|serie-a1-femminile|Serie A1 Femminile|public
IT|women|serie-a2-femminile|Serie A2 Femminile|public
JP|-|b-league-one|B.LEAGUE One|public
JP|-|b-league-premier|B.LEAGUE Premier|public
JP|women|w-league-future|W League Future|public
JP|women|w-league-premier|W League Premier|public
KR|men|kbl|KBL|public
LT|-|lkl|LKL|public
LT|-|nkl|NKL|public
MK|-|macedonian-super-league|Macedonian Super League|public
MX|-|cibacopa|CIBACOPA|public
MX|-|lnbp|LNBP|public
PL|-|1-liga-kobiet|1 Liga Kobiet|public
PL|-|1-liga-mezczyzn|1 Liga Mężczyzn|public
PL|-|orlen-basket-liga|ORLEN Basket Liga|public
RO|women|lnbf|Liga Nationala de Baschet Feminin|public
RO|-|lnbm|Liga Nationala de Baschet Masculin|public
SE|-|basketligan|Basketligan|public
SE|-|basketligan-dam|Basketligan Dam|public
SK|-|slovak-sbl|Tipos Slovenska basketbalova liga|public
XB|men|aba-league|ABA League|public
XB|men|aba-league-2|ABA League 2|public
XB|men|aba-u19-league|ABA U19 League|public
XK|-|kosovo-superliga|Kosovo Superliga|public
--|-|nbl-u18s-men-s|NBL U18s Men's|private
--|-|test|Test|private`;
const SITE = SITE_TXT.split('\n').filter(Boolean).map(l => {
  const [country, gender, slug, name, visibility] = l.split('|');
  return { country: country === '--' ? '' : country, gender: gender === '-' ? null : gender, slug, name, visibility };
});

console.log('\n1. every matrix name');
{
  ok('97 matrix leagues, 81 site leagues', MATRIX.length === 97 && SITE.length === 81, MATRIX.length + ' / ' + SITE.length);
  ok('the module knows every one of them', MATRIX.every(n => TL.KNOWN.includes(n)) && TL.KNOWN.length === 97);
  const P = Object.fromEntries(MATRIX.map(n => [n, TL.parseMatrix(n)]));
  ok('every name has a country', MATRIX.every(n => P[n].countries.length > 0), MATRIX.filter(n => !P[n].countries.length).join(', '));
  const want = [
    ['Spanish ACB', 'ES', 1, 'pro'], ['Spanish Primera FEB', 'ES', 2, 'pro'], ['Spanish Segunda FEB', 'ES', 3, 'pro'],
    ['German BBL', 'DE', 1, 'pro'], ['German Pro A', 'DE', 2, 'pro'], ['German Pro B', 'DE', 3, 'pro'],
    ['French Jeep Elite', 'FR', 1, 'pro'], ['French LNB Pro B', 'FR', 2, 'pro'], ['French NM1', 'FR', 3, 'pro'],
    ['Italian Lega Basket Serie A', 'IT', 1, 'pro'], ['Italian Serie A2 Basket', 'IT', 2, 'pro'],
    ['Greek HEBA A1', 'GR', 1, 'pro'], ['Greek HEBA A2', 'GR', 2, 'pro'], ['Turkish BSL', 'TR', 1, 'pro'], ['Turkish TBL', 'TR', 2, 'pro'],
    ['Japanese B.League', 'JP', 1, 'pro'], ['Slovakian Extraliga', 'SK', 1, 'pro'], ['Adriatic League Liga ABA', 'XB', 1, 'pro'],
    ['Estonian-Latvian Basketball League', 'EE+LV', 1, 'pro'], ['BNXT League', 'BE+NL', 1, 'pro'],
    ['Euroleague', 'EU', 1, 'international'], ['Eurocup', 'EU', 2, 'international'],
    ['Basketball Champions League Europe', 'EU', 2, 'international'], ['FIBA Europe Cup', 'EU', 3, 'international'],
    ['VTB United League', 'RU', 1, 'international'], ['NCAA Big Ten Conference', 'US', 1, 'college'], ['NCAA Ivy League', 'US', 1, 'college'],
    ['NBA', 'US', 1, 'pro'], ['G-League', 'US', 2, 'pro-development'], ['South Korean KBL', 'KR', 1, 'pro'],
    ['New Zealand NBL', 'NZ', 1, 'pro'], ['Puerto Rican BSN', 'PR', 1, 'pro'], ['Kosovo FBK', 'XK', 1, 'pro'],
    ['Super League Basketball', 'GB', 1, 'pro'], ['Mexican LNBP', 'MX', 1, 'pro'], ['Mexican CIBACOPA', 'MX', 2, 'pro'],
    ['Canadian Elite Basketball League', 'CA', 1, 'pro'], ['PBA - Commissioners Cup', 'PH', 1, 'pro'], ['Romanian Divizia A', 'RO', 1, 'pro']
  ];
  const bad = want.filter(([n, c, t, k]) => P[n].countries.join('+') !== c || P[n].tier !== t || P[n].kind !== k);
  ok('countries, divisions and kinds as expected (' + want.length + ' checked)', !bad.length,
     bad.map(([n]) => n + ' -> ' + JSON.stringify(P[n])).join('; '));
  ok('every NCAA conference is US college, division 1', MATRIX.filter(n => /^NCAA/.test(n)).every(n => P[n].kind === 'college' && P[n].tier === 1 && P[n].countries.join() === 'US'));
  ok('a name the tables do not know is still read from its words',
     TL.parseMatrix('Hungarian NB I/B second division').countries.join() === 'HU' && TL.parseMatrix('Austrian Zweite Liga second').tier === 2 &&
     TL.parseMatrix('Spanish LEB Plata').tier === 3 && TL.parseMatrix('Dutch-Belgian Cup').countries.join('+') === 'NL+BE');
}

const MAP = TL.mapping(SITE, TIERS, null);
const men = SITE.filter(l => TL.genderOf(l, TIERS) === 'men');
const women = SITE.filter(l => TL.genderOf(l, TIERS) === 'women');

console.log('\n2. every site men\'s league resolves');
{
  ok('the women\'s leagues are told apart (the database\'s gender, the tier\'s side, the name)',
     ['1-liga-kobiet', 'basketligan-dam', 'czech-zbl', 'liga-femenina-2', 'weabl', 'wnbl', 'serie-a1-femminile', 'lnbf', 'w-league-future']
       .every(s => women.some(l => l.slug === s)) && women.length === 21, women.map(l => l.slug).join(','));
  ok('no women\'s league is ever offered', women.every(l => MAP[l.slug].method === 'none' && !TL.adjustable(MAP[l.slug])) &&
     TL.targets(MAP).every(e => e.gender === 'men'));
  const youth = men.filter(l => TL.isYouth(TIERS[l.slug] && TIERS[l.slug][0]));
  ok('the youth leagues are told apart by their tier: Espoirs ELITE and ELITE 2, Liga U, the EABL, ABA U19',
     ['lnb-espoirs-elite', 'lnb-espoirs-elite-2', 'liga-u', 'eabl', 'aba-u19-league'].every(s => youth.some(l => l.slug === s)), youth.map(l => l.slug).join(','));
  ok('no youth league is ever offered, and each says why', youth.length && youth.every(l => MAP[l.slug].method === 'none' &&
     !TL.adjustable(MAP[l.slug]) && MAP[l.slug].note === TL.NOTES.youth));
  const pub = men.filter(l => l.visibility === 'public' && !youth.includes(l));
  const unresolved = pub.filter(l => !TL.adjustable(MAP[l.slug]));
  ok('every public senior men\'s league is measured or estimated (' + pub.length + ')', !unresolved.length, unresolved.map(l => l.slug).join(','));
  ok('the private U18 league and the test league are not offered', MAP['nbl-u18s-men-s'].method === 'none' && MAP.test.method === 'none');
  const counts = {};
  Object.values(MAP).forEach(e => { counts[e.method] = (counts[e.method] || 0) + 1; });
  ok('37 measured, 16 estimated, 28 not offered (21 women\'s, 5 youth, the private and the test league)',
     counts.direct === 37 && counts.estimate === 16 && counts.none === 28 && !counts['country-tier'], JSON.stringify(counts));
  ok('every measured match is a league the matrix holds', Object.values(MAP).filter(e => e.matrix).every(e => MATRIX.includes(e.matrix)));
  ok('no two site leagues share a matrix league', (() => { const m = Object.values(MAP).filter(e => e.matrix).map(e => e.matrix); return new Set(m).size === m.length; })());
  ok('a measured league is never called estimated, an estimate always is', Object.values(MAP).every(e => (e.method === 'estimate') === e.estimated));
}

console.log('\n3. twenty-five mappings, one by one');
{
  const spot = [
    ['liga-endesa', 'direct', 'Spanish ACB'], ['primera-feb', 'direct', 'Spanish Primera FEB'], ['segunda-feb', 'direct', 'Spanish Segunda FEB'],
    ['lnb-elite', 'direct', 'French Jeep Elite'], ['lnb-elite-2', 'direct', 'French LNB Pro B'], ['lkl', 'direct', 'Lithuanian LKL'],
    ['aba-league', 'direct', 'Adriatic League Liga ABA'], ['greek-elite-league', 'direct', 'Greek HEBA A2'], ['winner-league', 'direct', 'Israeli BSL'],
    ['slovak-sbl', 'direct', 'Slovakian Extraliga'], ['sb-league', 'direct', 'Swiss LNA'], ['orlen-basket-liga', 'direct', 'Polish OBL'],
    ['lnbm', 'direct', 'Romanian Divizia A'], ['kosovo-superliga', 'direct', 'Kosovo FBK'], ['slb-men', 'direct', 'Super League Basketball'],
    ['euroleague', 'direct', 'Euroleague'], ['basketball-champions-league', 'direct', 'Basketball Champions League Europe'],
    ['proa', 'direct', 'German Pro A'], ['b-league-premier', 'direct', 'Japanese B.League'], ['cebl', 'direct', 'Canadian Elite Basketball League'],
    ['nbl-bulgaria', 'direct', 'Bulgarian NBL'], ['cibacopa', 'direct', 'Mexican CIBACOPA'],
    ['nkl', 'estimate', null], ['liga-ouro', 'estimate', null], ['b-league-one', 'estimate', null]
  ];
  spot.forEach(([slug, method, matrix]) => {
    const e = MAP[slug];
    ok(slug + ' -> ' + (matrix || method), e && e.method === method && e.matrix === matrix, JSON.stringify(e));
  });
}

console.log('\n4. without the table: names and abbreviations');
{
  const bare = TL.mapping(SITE, TIERS, null, { aliases: false });
  const byName = Object.values(bare).filter(e => e.method === 'direct');
  ok('most measured leagues are found by name alone (' + byName.length + ')', byName.length >= 25, byName.map(e => e.slug).join(','));
  const wrong = byName.filter(e => MAP[e.slug].matrix !== e.matrix);
  ok('and none of them differently from the table', !wrong.length, wrong.map(e => e.slug + ' -> ' + e.matrix).join('; '));
  ok('an abbreviation finds its league: CEBL, LKL, KBL, NBB, LNBP', ['cebl', 'lkl', 'kbl', 'nbb', 'lnbp'].every(s => bare[s].matrix === MAP[s].matrix));
  ok('a sponsor is not a name: easyCredit BBL, Kooperativa NBL, Betclic ELITE', ['bbl', 'czech-nbl', 'lnb-elite'].every(s => bare[s].matrix === MAP[s].matrix));
  ok('ProA is Pro A, NBL Bulgaria the Bulgarian NBL', bare.proa.matrix === 'German Pro A' && bare['nbl-bulgaria'].matrix === 'Bulgarian NBL');
  ok('a second division never takes its top division\'s row: NBL1 Men, ELITE 2, ABA League 2, B.LEAGUE One',
     ['nbl1-men', 'aba-league-2', 'b-league-one'].every(s => bare[s].method === 'estimate') && bare['lnb-elite-2'].matrix !== 'French Jeep Elite');
  ok('a youth league never takes a senior row: Espoirs ELITE, ABA U19, Liga U', ['lnb-espoirs-elite', 'aba-u19-league', 'liga-u'].every(s => bare[s].method === 'none'));
  ok('likeness: a name in another country is not compared at all', TL.mapping([{ slug: 'x', name: 'Basketligaen', country: 'NO' }], {}, null, { aliases: false }).x.method === 'none');
}

console.log('\n5. by country and division');
{
  const fresh = [
    { slug: 'hu-nb1', name: 'NB I/A Férfi', country: 'HU' }, { slug: 'rs-klsx', name: 'Prva muška liga', country: 'RS' },
    { slug: 'it-a2', name: 'Serie A2 Old Wild West', country: 'IT' }, { slug: 'tr-2', name: 'Türkiye Basketbol Ligi', country: 'TR' },
    { slug: 'gr-1', name: 'Stoiximan GBL', country: 'GR' }, { slug: 'de-2w', name: '2. DBBL', country: 'DE', gender: 'women' }
  ];
  const T = { 'hu-nb1': [1, 'm'], 'rs-klsx': [1, 'm'], 'it-a2': [2, 'm'], 'tr-2': [2, 'm'], 'gr-1': [1, 'm'], 'de-2w': [2, 'w'] };
  const m = TL.mapping(fresh, T, null);
  ok('a new Hungarian top flight: the Hungarian NBIA by country and division', m['hu-nb1'].method === 'country-tier' && m['hu-nb1'].matrix === 'Hungarian NBIA');
  ok('Serbia, Italy\'s second division, Turkey\'s second, Greece\'s first: the one row each', m['rs-klsx'].matrix === 'Serbian KLS' &&
     m['it-a2'].matrix === 'Italian Serie A2 Basket' && m['tr-2'].matrix === 'Turkish TBL' && m['gr-1'].matrix === 'Greek HEBA A1');
  ok('a women\'s league is never matched, however its country and division line up', m['de-2w'].method === 'none');
  ok('a new league with no division known is matched by its exact name only',
     TL.mapping([{ slug: 'q', name: 'Korisliiga', country: 'FI' }], {}, null).q.method === 'direct' &&
     TL.mapping([{ slug: 'q', name: 'Korisliiga Pro', country: 'FI' }], {}, null).q.method === 'none');
  ok('two candidates (EU, division 2: the EuroCup and the Champions League): no guess',
     TL.mapping([{ slug: 'new-eu', name: 'Some Cup', country: 'EU' }], { 'new-eu': [2, 'm'] }, null)['new-eu'].method === 'none');
}

console.log('\n6. the Spanish ladder');
{
  const est = Object.values(MAP).filter(e => e.method === 'estimate');
  ok('every estimate has a rung, and NKL and Liga Ouro are among them (no matrix data for either)',
     est.every(e => typeof e.rung === 'number' && e.rung >= 1) && MAP.nkl.rung === 3 && MAP['liga-ouro'].rung === 3.5);
  ok('a rung past Segunda FEB is extrapolated, and only then', est.every(e => e.extrapolated === (e.rung > 3)));
  ok('the university leagues are estimates below the senior ones (U SPORTS, NCAA Division II)', MAP['u-sports'].method === 'estimate' &&
     MAP['u-sports'].rung >= 4.5 && TL.SPANISH_RUNG['ncaa-d2-men'] >= 4.5);
  ok('no youth league is on the ladder', Object.keys(TL.SPANISH_RUNG).every(s => !MAP[s] || MAP[s].method !== 'none'));
  ok('every estimate tells the reader it is estimated, and where it sits', est.every(e => /^Estimated: /.test(e.note) &&
     (e.extrapolated ? /extrapolated/.test(e.note) : !/extrapolated/.test(e.note))));
  ok('the ladder\'s words: at a level, between two, or so far below Segunda FEB',
     TL.ladderNote(3) === 'Estimated: no measured moves, so it is placed at Segunda FEB level.' &&
     /between Primera FEB and Segunda FEB/.test(TL.ladderNote(2.5)) && /one level below Segunda FEB/.test(TL.ladderNote(4)) &&
     /half a level below/.test(TL.ladderNote(3.5)) && /three levels below/.test(TL.ladderNote(6)));
  ok('every rung in the table is a number between 1 and 7', Object.values(TL.SPANISH_RUNG).every(r => typeof r === 'number' && r >= 1 && r <= 7));
  ok('the table names only men\'s leagues the site has, or will (NCAA Division II)',
     Object.keys(TL.SPANISH_RUNG).every(s => s === 'ncaa-d2-men' || (MAP[s] && MAP[s].gender === 'men')));
  ok('a measured league is never on the ladder too', Object.keys(TL.SPANISH_RUNG).every(s => !TL.ALIASES[s]));
}

console.log('\n7. a file that lacks a league; the menu');
{
  const scale = { leagues: {} };
  MATRIX.filter(n => n !== 'Lithuanian LKL').forEach(n => { scale.leagues[n] = { net: [0, 0, 0, 0, 0, 0, 0, 0, 0] }; });
  scale.leagues['Swiss LNA'] = { net: [null, null, null, null, null, null, null, null, null] };
  const m = TL.mapping(SITE, TIERS, scale);
  ok('a league missing from the file is not matched to it (LKL)', m.lkl.matrix !== 'Lithuanian LKL' && !TL.adjustable(m.lkl));
  ok('a league with no figures at all is as good as missing (Swiss LNA)', m['sb-league'].method === 'none');
  const noLadder = Object.assign({}, scale, { leagues: Object.assign({}, scale.leagues) });
  delete noLadder.leagues['Spanish Segunda FEB'];
  ok('without the ladder\'s three leagues there are no estimates', Object.values(TL.mapping(SITE, TIERS, noLadder)).every(e => e.method !== 'estimate'));
  const t = TL.targets(MAP);
  const firstEst = t.findIndex(e => e.estimated);
  ok('the menu: every measured league, then every estimate', firstEst === 37 && t.slice(firstEst).every(e => e.estimated) && t.length === 53);
  ok('each part by name', t.slice(0, firstEst).every((e, i, a) => !i || a[i - 1].label.localeCompare(e.label, 'en', { sensitivity: 'base' }) <= 0));
}

console.log('\n8. nothing of where the numbers came from');
{
  const src = rd('epinoia', 'transferleagues.js');
  const names = /basketball-?reference|bbref|kenpom|torvik|cleaning ?the ?glass|nba\.com|real ?gm|eurobasket|sports-reference|proballers|flashscore|synergy/i;
  ok('no stats site is named in the file', !names.test(src), (src.match(names) || [])[0]);
  ok('UMD: module.exports and window.EpinoiaTransferLeagues', /module\.exports = api/.test(src) && /root\.EpinoiaTransferLeagues = api/.test(src));
  ok('no fetch in the matching', !/\bfetch\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
