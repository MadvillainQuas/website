/* ============================================================================
   THE GENERATED PROSE IN EVERY LANGUAGE (epinoia/i18n/<code>/report.js).

   The match report, the half-time report and the fixture preview are written in English by game/report.js and
   game/preview.js and translated in the reader's browser sentence by sentence, one anchored pattern per template
   (docs/i18n.md, the epinoia-languages skill's engine.md). A template added to the writer without its pattern prints an
   English sentence in the middle of a Japanese or Spanish report, and nothing fails - so this test holds one real-shaped
   example of every template added on 2026-10-07 (the value ledger, the game in its season, the moments, the varied
   frames, the valued preview), each of which must come back fully translated in every visible language.

   "Fully translated": the engine returns something for it, and what comes back has no run of four English words left in
   it (names are the reader's own, so a sentence keeps its clubs and players in the original).

       node supabase/tests/report-i18n.test.mjs             every language
       node supabase/tests/report-i18n.test.mjs ja          one language, and its misses in full
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const EP = path.join(ROOT, 'epinoia');
const require = createRequire(import.meta.url);
const core = require(path.join(EP, 'i18n.js'));

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? '\n          ' + d : '')); } };

function registered(file) {
  const got = [];
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: { EpinoiaI18n: { register: (c, d, pack) => got.push({ code: c, dict: d, pack: pack || null }) } } });
  return got;
}
function dictFor(code) {
  const c = registered(path.join(EP, 'i18n', code + '.js')).find(x => x.code === code && !x.pack);
  const p = registered(path.join(EP, 'i18n', code, 'report.js')).find(x => x.code === code && x.pack === 'report');
  return core.compile(code, core.merge([c && c.dict, p && p.dict].filter(Boolean)));
}

/* ONE EXAMPLE OF EVERY NEW TEMPLATE, as the writer prints it (clubs: Neon City, Harbour Bay, Bristol Flyers, Cheshire
   Phoenix; players: Ada Shaw, Bo Lind, Maeve St John) */
const S = {
  /* the game in its season, near the top (report.js stakesLine) and in "What it means" */
  stakes: [
    'Harbour Bay had won their first five games; this was their first defeat.',
    'It was the first defeat of the season for Harbour Bay, after five straight wins.',
    'The win takes Neon City top, at 9–2.',
    'Neon City go top in Group A with it, 9–2.',
    'Harbour Bay lose top spot with the defeat.',
    'The defeat costs Harbour Bay first place.',
    'Neon City stay top at 10–1.',
    'It keeps Neon City top in Group A.',
    'Neon City climb to third.',
    'The win lifts Neon City to 11th in Group B.',
    'Neon City started the night ninth in the table and beat the side in second.',
    'On the table this was an upset: Neon City were ninth, Harbour Bay second.',
    'On the season’s numbers this should have been Harbour Bay’s game by about six points.',
    'The season’s four factors had Harbour Bay about six points better going in.',
    'It ended Harbour Bay’s run of six straight wins.',
    'Harbour Bay had won six in a row coming in.',
    'It ended a run of four straight defeats for Neon City.',
    'Neon City had lost four in a row before this.',
    'It is five wins in a row for Neon City.',
    'Neon City have now won five straight.',
    'Harbour Bay have now lost four straight.',
    'That is four defeats in a row for Harbour Bay.',
    'It was Neon City’s first win of the season, at the fourth attempt.',
    'Neon City are off the mark at last, at the fourth attempt.',
    'Neon City are still unbeaten, 7–0.',
    'Nobody has beaten Neon City yet: 7 games, 7 wins.',
    'Harbour Bay are still looking for a first win, five games in.',
    'It is five games and no wins for Harbour Bay.',
    'Neon City’s 112 points are the most any side has scored in this league this season.',
    'Neon City’s 112 points equal the most any side has scored in this league this season.',
    'Neon City’s 34-point win is the widest in this league this season.',
    'Neon City’s 18 threes are the most by any side in a game this season.',
    'Neon City’s 31 assists are the most by any side in a game this season.',
    'Neon City’s 22-rebound edge is the widest in this league this season.',
    'Neon City’s 104 points were their most of the season.',
    'Neon City had not scored 104 all season.',
    'Neon City have not allowed fewer all season than the 58 they gave up here.',
    'Harbour Bay’s 58 is the fewest Neon City have allowed this season.',
    'Neon City have won all three meetings this season.',
    'Harbour Bay had won the last meeting 80–70; this was Neon City’s reply.',
    'The season series between them is level at 1–1.',
    'The season series is 2–1 to Neon City.',
    'The crowd of 4210 was Neon City’s biggest of the season.',
    'Only 23% of the 61 fans who picked a winner had gone with Neon City.',
    'Harbour Bay were playing for the second time in two days.',
    'Neon City are third at 9–4, Harbour Bay sixth at 7–6.',
    'In the league, Neon City are third at 9–4, Harbour Bay 11th at 5–8.',
    'The two meet again on Saturday 17 October, at Neon City’s place.',
    'Next for Neon City: Bristol Flyers at home on Saturday 17 October.',
    'Neon City host Bristol Flyers next, on Saturday 17 October.',
    'Bristol Flyers are next for Neon City, at home on Saturday 17 October.',
    'Next for Harbour Bay: away at Cheshire Phoenix on Friday 16 October.',
    'Harbour Bay go to Cheshire Phoenix next, on Friday 16 October.',
    'A trip to Cheshire Phoenix is next for Harbour Bay, on Friday 16 October.'
  ],
  /* the moments and the shape (report.js sectionFlow) */
  moments: [
    'Ada Shaw’s three with four seconds left won it for Neon City.',
    'Ada Shaw’s basket with four seconds left in overtime won it for Neon City.',
    'Ada Shaw’s basket with 2:14 left put Neon City ahead for good.',
    'Shaw’s free throw with 49 seconds left put Neon City ahead for good.',
    'Ada Shaw scored nine of Neon City’s 14 points in the last five minutes.',
    'Bo Lind hit a three at the third-quarter buzzer for Harbour Bay.',
    'Bo Lind hit a three at the half-time buzzer for Harbour Bay.',
    'It was a low-scoring grind, 118 points between the two sides.',
    'Points were hard to come by: 118 between the two sides.',
    'It was a shootout, 197 points between the two sides.',
    'Neither defence held: 197 points between them.'
  ],
  /* what decided it, in points (report.js sectionLedger) */
  ledger: [
    'By this league’s own model of what wins, the turnover battle decided it, worth about seven of the twelve points between them.',
    'Weighed the way this league’s games are decided, the offensive glass decided it, worth about eleven points to Sporting CP.',
    'On what decides games in this league, getting to the line decided it, worth about six points, more than the whole margin.',
    'Counted factor by factor, it came down to making shots: Neon City hit 66% eFG on shots that usually go at 52% in this league, worth about 21 points, more than the whole margin.',
    'Facet by facet, the shots Neon City got decided it: in this league their attempts were worth 54% eFG and Harbour Bay’s 48%, about six of the twelve points between them.',
    'Weighing each facet at its usual value, the free throws decided it: Neon City made 18 of 22, worth about four points against the usual rate.',
    'Next came the offensive glass, worth three more.',
    'Getting to the line added about two points.',
    'Harbour Bay won about ten points back on turnovers.',
    'No single facet decided this: on the league’s own weights nothing was worth more than a point or two either way, and the margin was made in the margins.',
    'Neon City got the better shots, worth about four points, but Harbour Bay made more of theirs, about three points the other way.',
    'Before the tip, the season’s numbers had almost nothing between them; Neon City won by two.',
    'Before the tip, the season’s numbers made Neon City about four points better. They beat that by eleven points.',
    'Before the tip, the season’s numbers made Neon City about four points better. That is roughly how it went.',
    'Before the tip, the season’s numbers made Neon City about four points better. They won by less than that.',
    'Before the tip, the season’s numbers made Harbour Bay about six points better: Neon City won this as the underdogs.',
    'Home court is worth about 1.5 points in this league, and it was Neon City’s.',
    'The last five points of the margin are in no facet at all: the part of a game no factor measures.',
    'On these facets alone Neon City would have won by more; seven points went back to Harbour Bay in what no factor measures.'
  ],
  /* the performances against the season (report.js sectionPlayers) */
  players: [
    'Ada Shaw led Neon City with a season-high 27 points and seven rebounds.',
    'Ada Shaw led Neon City with 27 points, well clear of their usual.',
    'Neon City had a season-high 30 points and four steals from Ada Shaw.',
    'Bo Lind came off the bench for a season-high 27 for Harbour Bay.',
    'Bo Lind added a season-high 19 for Harbour Bay.',
    'Ada Shaw’s 41 points for Neon City were the most by anyone in a game in this league this season.',
    'Ada Shaw’s 41 points for Neon City equalled the most by anyone in a game in this league this season.',
    'Bo Lind matched their season high of 22 points for Harbour Bay.',
    'Bo Lind’s 14 rebounds for Harbour Bay were a season high, three more than their best before.',
    'Ada Shaw has now scored 20 or more in five straight games for Neon City.',
    'Maeve St John was back for Harbour Bay after missing three games, and played twelve minutes.',
    'Ada Shaw’s points took their season total past 300 for Neon City.',
    'By box plus-minus the best game on the floor was Bo Lind’s for Harbour Bay, +14.2.',
    'Bo Lind’s game for Harbour Bay was the best on the floor by box plus-minus, +14.2.',
    'Box plus-minus rates Bo Lind of Harbour Bay as the best player on the floor, at +14.2.'
  ],
  /* the headlines and standfirsts (report.js ledeAngles, headline) */
  headlines: [
    'Neon City hand Harbour Bay their first defeat of the season',
    'Neon City go top with 88–80 win over Harbour Bay',
    'Neon City stun Harbour Bay 88–80',
    'Neon City end Harbour Bay’s 6-game winning run',
    'Neon City end 4-game losing run against Harbour Bay',
    'Neon City off the mark at last against Harbour Bay',
    'Neon City make it 5 straight with 88–80 win over Harbour Bay',
    'Neon City stay perfect with 88–80 win over Harbour Bay',
    'Underdogs Neon City beat Harbour Bay 88–80',
    'Ada Shaw’s league season-best 41 carries Neon City past Harbour Bay',
    'Ada Shaw’s league season-best 41 is not enough for Neon City',
    'Ada Shaw wins it for Neon City at the death against Harbour Bay',
    'Shot-making alone was worth 21 points to Neon City.',
    'The turnover battle alone was worth 11 points to Neon City.',
    'The quality of their shots alone was worth 9 points to Neon City.',
    'Ada Shaw’s three with four seconds left won it for Neon City.'
  ],
  /* the scout's note, its new frames (report.js sectionScout) */
  scout: [
    'Sharing the ball was where Neon City won it: they were better than nine games in ten there, Harbour Bay among the weakest in the league.',
    'Neon City won this on sharing the ball above all: they were better than nine games in ten there, Harbour Bay among the weakest in the league.',
    'Two more for the film room: getting to the line (Neon City, 87 percentile points ahead) and looking after the ball (Harbour Bay, 82 percentile points ahead).',
    'Further down the list: getting to the line (Neon City, 87 percentile points clear) and looking after the ball (Harbour Bay, 82 percentile points clear).',
    'The offensive glass was Neon City’s strongest suit: they were among the best in the league there, with shooting from three and shooting from the field not far behind.',
    'Neon City were at their best on forcing turnovers: they were better than nine games in ten there, with the offensive glass and looking after the ball close behind.',
    'Nothing went better for Neon City than the defensive glass: they were well above the league average there.',
    'The weak spot was looking after the ball, where they were among the weakest in the league; the defensive glass and free throws lagged too.',
    'Free throws let them down: they were worse than most there.',
    'Where they came up short was finishing at the rim: they were well below the league average there.',
    'They had trouble with the defensive glass and sharing the ball too.',
    'They fell short on the defensive glass as well.',
    'The one thing for Harbour Bay to take into the week is getting to the line: they were worse than nine games in ten there, further behind the league than anything else in their game.',
    'The Monday work for Harbour Bay starts with getting to the line: they were worse than nine games in ten there, the furthest from the league anything in their game was.',
    'If there is one thing to take into the week, it is getting to the line: Harbour Bay were worse than nine games in ten there, and nothing else in their game sat further behind the league.',
    /* five frames a side and five phrasings a band (2026-10-08), and a plural facet's "were" */
    'Free throws were Neon City’s strongest suit: they were in the league’s top tenth there, with sharing the ball not far behind.',
    'For Neon City, the high point was the offensive glass: they were second to none in the league there, with forcing turnovers not far behind.',
    'Neon City did nothing better than protecting the rim: they were in the league’s top quarter there.',
    'Getting to the line held them back: they were in the league’s bottom tenth there; free throws lagged too.',
    'The trouble was looking after the ball: they were as poor as it gets in the league there.',
    'Sharing the ball was where Neon City won it: they were clearly better than the league’s usual there, Harbour Bay in the league’s bottom quarter.',
    'Nothing went better for Neon City than the defensive glass: they were a little better than the league’s usual there.',
    'The weak spot was the defensive glass, where they were just below the league’s average.',
    'Where they came up short was shooting from three: they were no different from the league’s usual there.',
    /* the glass and the line with the other side named, the chances' rate three ways, the shares three a band (2026-10-08) */
    'Misses were not the end of it for Neon City: 14 of 28 came back to them, to 16 of 43 for Harbour Bay.',
    'Neon City won the ball back on eight of their 13 misses, against seven of 23 for Harbour Bay.',
    'The second shots came from three for Neon City: 8 of 13 misses came back, to 7 of 23 for Harbour Bay.',
    'Neon City got 6 of their 11 misses at the rim back, against 5 of 22 for Harbour Bay.',
    'The whistle was kind to Neon City: 42 free throws per hundred shots, against 15 for Harbour Bay.',
    'Neon City lived at the line, drawing 41 free-throw attempts per hundred field goals to 18.',
    'In transition it was 27–19 to Neon City, from 22 chances, at 1.23 points each.',
    'Neon City had the edge off turnovers: 19 points from 28 chances, 0.68 points a chance, against Harbour Bay’s 11.',
    'They got 26% of their chances that way, as high a share as this league sees.',
    'They got 21% of their chances that way, more than three sides in four get.',
    'Harbour Bay turned it over 18 times.',
    'Harbour Bay coughed it up 18 times.',
    'Neon City had their hands on the ball all night — their opponents turned it over on 22.4% of possessions.',
    'Neon City kept taking it away — their opponents gave it up on 22.4% of possessions.'
  ],
  /* the valued preview (preview.js valuedParas) */
  preview: [
    'First against second: Neon City (9–2) host Harbour Bay (8–3).',
    'Neon City are third at 7–4, Harbour Bay sixth at 6–5.',
    'Neon City have won four straight; Harbour Bay have lost their last three.',
    'Neon City are unbeaten in five.',
    'Harbour Bay are still without a win in four.',
    'Neither has lost yet.',
    'Neon City have won four of their last five; Harbour Bay one.',
    'Harbour Bay won the only meeting so far, 80–70.',
    'The season series is level at 1–1.',
    'Neon City play for the second time in two days; Harbour Bay have had three days off.',
    'Weighed by what wins in this league, the season’s numbers make Neon City about four points better here.',
    'On the season’s four factors, Neon City are about 1.5 points better here.',
    'Most of that is the shooting: expect Neon City to shoot about 53% eFG to 51%, worth about three points.',
    'The biggest part is the turnover battle: Neon City should turn it over on about 13% of possessions to 16%, worth about two points.',
    'The offensive glass alone is worth more than that: Neon City should get about 39% of their misses back to 33%, worth about three points.',
    'Most of that is getting to the line: Neon City should get to the line more, about 31 free throws per hundred shots to 24, worth about 1.5 points.',
    'Harbour Bay’s edge is the shooting, about 1.5 points back.',
    'Home court is worth about 1.2 in this league.',
    'On these numbers it is close to a toss-up.',
    'The numbers lean Neon City, but not by much: a single run settles games closer than that.',
    'The numbers make Neon City clear favourites.',
    'On these numbers Neon City should win comfortably.',
    'Yes, but Harbour Bay come in on four straight wins.',
    'Yes, but the table has Harbour Bay above them.',
    'Ada Shaw has scored 20 or more in each of the last three for Neon City; Bo Lind leads Harbour Bay with 16.0 points a game.',
    'Ada Shaw has scored 20 or more in every game this season for Neon City.',
    'Ada Shaw is averaging 21.3 over the last three for Neon City, up from 14.0 for the season.',
    'Ada Shaw of Neon City needs eight for 300 points this season.'
  ]
};

/* a translation that still carries four English words in a row has left part of the sentence behind */
const ENGLISH_RUN = /\b(?:the|and|of|to|in|for|with|was|were|their|they|points|game|games|season|league|won|lost)\b(?:\W+[a-z’']+){3}/i;
const NAMES = ['Neon City', 'Harbour Bay', 'Bristol Flyers', 'Cheshire Phoenix', 'Ada Shaw', 'Bo Lind', 'Maeve St John', 'Shaw', 'Sporting CP'];
function leftover(out) {
  let s = String(out);
  NAMES.forEach(n => { s = s.split(n).join(' '); });
  return ENGLISH_RUN.test(s) ? s : null;
}

const only = process.argv[2] || null;
const CODES = core.LANGS.filter(l => l.code !== 'en' && !l.hidden && (!only || l.code === only)).map(l => l.code);
for (const code of CODES) {
  console.log('\n' + code);
  const D = dictFor(code);
  Object.keys(S).forEach(group => {
    const misses = [];
    S[group].forEach(en => {
      const out = core.translateText(D, en, ['report']);
      if (out == null || out === en) misses.push('untranslated: ' + en);
      else if (leftover(out)) misses.push('English left: ' + en + '\n            -> ' + out);
    });
    ok(code + ' ' + group + ': every template translates (' + S[group].length + ')', !misses.length,
      misses.length + ' not: ' + (only ? '\n          ' + misses.join('\n          ') : misses.slice(0, 3).join(' | ')));
  });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
