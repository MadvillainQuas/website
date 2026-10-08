/* GENERATED from epinoia/matchwriter.js by supabase/tests/extract-shared.mjs — do not edit. */
'use strict';
/* ============================================================================
   THE MATCH REPORT AS ONE PIECE (2026-10-08).                    window.EpinoiaMatchWriter

   Louie: the report read "clunky and unlike a real game report" - a run of headed sections, each a list of true
   sentences ("It was X's first win of the season, at the third attempt. Shot-making alone was worth 12 points to X."),
   and sections that had to be there whether the game gave them anything or not (an events section of one throwaway
   line). A report is a story: what happened and why it matters, how the game went, why it was won, who did it, what it
   cost the other side, what comes next. Paragraphs flow into each other; a graphic sits after the paragraph it proves.

   WHAT THIS IS. The writer of the full-time report. story.js still decides what is TRUE and how much each finding
   matters (the facts, ranked); this decides what is WORTH SAYING and says it, in the house voice of the newsroom
   (voice.js): a phrasebook of slots ('mr.*', added to the voice with extend), each with the situations it fits and
   several ways of saying it; clubs and players passed as ENTITIES, so the first mention is the full name and every
   later one the club's short name ("Kėdainiai", clubShort) or the player's surname, a pronoun only where it cannot
   point at anyone else; every sentence proofread as it is made and sent back when it opens like the one before or
   repeats a phrase the piece has used; clauses joined by what links them (contrast, concession, cause) with the
   form varied. The editor (scrutiny.js) reads the finished piece, as it reads the newsroom's.

   THE BEATS, in a match report's order, each written only when the game gave it something:
     lede      the result and the one thing that matters most about it (a first win, a streak ended, a comeback, a
               basket at the death, a rout, a run), then the hook, then where it leaves them
     flow      how it went: the start, the break, the turn, the finish                  card: the scoring by period
     why       how it was won, in a fan's words, the counterpoint when it was ugly      card: what decided it
     stars     the winners' best: the line, the specialist, the playmaker               card: the performances
     losers    the other side: who carried them and what went wrong
     five      the group that won it, only when it really did                           card: the lineups
     preview   what the newsdesk's week preview said of the game, and whether it held
     next      where both stand and who they play next                                  card: form and fixtures

   API
     write(g, fs, kit)   -> { headline, standfirst, paras: [{ text, card, beat }], log } | null (a tie, or no voice)
                            kit: report.js's own helpers { tc, surnameOf, dayWords, preview }
     clubShort(name)     the short name a report calls a club after the first time
     clubShorts(names)   both, or the full names where the short ones would be confused
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaMatchWriter = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const VOICE = () => root.EpinoiaVoice || (typeof require === 'function' ? (() => { try { return require('../voice.js'); } catch (_) { return null; } })() : null);

/* ------------------------------------------------------------- club names --- */
/* HOW A REPORT CALLS A CLUB AFTER THE FIRST TIME. Never the database's short_name (a three-letter code). The words that
   are not the club: a sponsor's web address, the letters of a club type (BC, KK, CB, FC...), "Basket", "Women". Then:
     a Baltic name with the town twice, genitive and nominative ("Kėdainių Kėdainiai BC", "Šilutės Šilutė-PDS.lt"): the
     town as it is said, "Kėdainiai", "Šilutė";
     "X de Y" ("Dorados de Chihuahua"): X;
     one word left: that word; two words, the first (the town: "Bristol Flyers" is "Bristol");
     anything longer, or a name in a script without spaces: the whole name. */
const TYPE = /^(bc|bk|kk|kb|cb|cd|sc|fc|ac|as|bbc|ks|mks|bkm|ok|sk|tj|gs|ud|ad|sad|cs|ss|us|vbc|kts|bgs|basket|baskets|basketball|baschet|baloncesto|pallacanestro|kosarka|koszykówka|club|women|womens|women’s|men|ladies|féminin|feminin|femenino|femenina|femminile|damen|w|m)$/i;
/* an acronym (FCC, UAV, CSM): not how a club is called in a sentence, when a word that is is left */
const ACRO = /^[A-ZĀ-Ž]{2,4}$/;
function clubShort(name, o) {
  const baltic0 = !!(o && o.baltic);
  const full = String(name || '').trim();
  if (!full || !/\s/.test(full)) return full;
  let parts = full.split(/\s+/)
    .map(w => w.replace(/-[\w.]*\.[a-z]{2,}$/i, ''))                  // "Šilutė-PDS.lt"
    .filter(w => w && !/\.[a-z]{2,}$/i.test(w) && !TYPE.test(w.replace(/[.,]/g, '')));
  if (!parts.length) return full;
  const words = parts.filter(w => !ACRO.test(w));
  if (words.length && words.length < parts.length) parts = words;
  const de = parts.findIndex((w, i) => i > 0 && /^(de|del|di|da|do|du)$/i.test(w));
  if (de > 0) parts = parts.slice(0, de);
  /* the town said twice: the later, nominative form */
  if (parts.length >= 2) {
    const stem = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').slice(0, 5);
    const k = parts.findIndex((w, i) => i > 0 && stem(w) === stem(parts[0]) && w.length >= 4);
    if (k > 0) return parts[k];
  }
  if (parts.length === 1) return parts[0];
  /* a brand said in capitals is what people call the club (ASVEL, UCAM is an acronym and gone already) */
  const brand = parts.find(w => /^[A-ZĀ-Ž]{5,}$/.test(w));
  if (brand) return brand;
  /* a Baltic club: the town in the genitive, then the club ("Vilkaviškio Perlas", "Alytaus Patriotai", "Kauno R. Atletas"):
     the club, as it is called */
  if (baltic0 || BALTIC.test(full)) {
    if (/(ų|ės|ių|io|aus|os|o)$/.test(parts[0]) && parts.length >= 2) {
      const club = parts.slice(1).find(w => !/^[A-Z]\.?$/.test(w) && w.length >= 4);
      if (club) return club.replace(/-.*$/, '');
    }
  }
  const NOT_SHORT = /^(the|real|union|unión|sporting|olympique|maccabi|hapoel|bnei|ironi|elitzur|san|santa|los|las|el|la|le|lo|al|new|north|south|east|west)$/i;
  /* "City Nickname" (Bristol Flyers, Kobe Storks, Gunma Crane Thunders): the nickname is a plural, and the town comes first;
     "Sponsor City" (Kids&Us Manresa, Ratiopharm Ulm, Itelyum Varese): the town is last */
  const last = parts[parts.length - 1];
  if (/s$/i.test(last) && parts[0].length >= 3 && !NOT_SHORT.test(parts[0])) return parts[0];
  if (NOT_SHORT.test(parts[0])) return parts.length === 2 ? full : full;
  /* a town of two words ("Gran Canaria", "San Sebastián") stays whole */
  if (parts.length >= 3 && /^(gran|san|santa|los|las|tel|saint|st|new|le|la|el|nova|novo|port|bad)$/i.test(parts[parts.length - 2])) return parts.slice(-2).join(' ');
  return last;
}
const BALTIC = /[ąčęėįšųūž]/i;
function clubShorts(names, o) {
  /* a Baltic league (or a name in Lithuanian or Latvian): the genitive town before the club, even without a diacritic */
  const baltic = !!(o && o.baltic) || names.some(n => BALTIC.test(n));
  const s = names.map(n => clubShort(n, { baltic })).map((x, i) => (/\s/.test(x) && x.length > 18 ? names[i] : x));
  /* the same short name for both, or one inside the other: each keeps its full name */
  if (s[0].toLowerCase() === s[1].toLowerCase() || names[0].toLowerCase().indexOf(s[1].toLowerCase()) >= 0 && s[1] !== names[1] ||
      names[1].toLowerCase().indexOf(s[0].toLowerCase()) >= 0 && s[0] !== names[0]) return names.slice();
  return s;
}

/* A WOMEN'S LEAGUE, so a player is "she"; a league that does not say is neither (the newsroom's own rule) */
const WOMEN = /\b(women|womens|women’s|femenin|féminin|feminin|femminil|damen|naisten|kvinde|wnbl|weabl|wjbl|w league|ladies|girls|female|lnbf|slbw)|\bdam\b|-w\b|\bw$/i;
const MEN = /\b(men|mens|men’s|masculin|herren|nba|nbl|acb|lkl|nkl|bbl|liga|league|basket)\b/i;
function genderOf(g) {
  const m = g.meta || {};
  const s = [m.league, m.competition, m.leagueSlug].filter(Boolean).join(' ');
  if (WOMEN.test(s)) return 'f';
  return MEN.test(s) ? 'm' : null;
}

/* ------------------------------------------------------------- numbers --- */
const fin = v => typeof v === 'number' && isFinite(v);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const spell = n => { const v = Math.round(+n); return v >= 0 && v <= 12 ? WORDS[v] : String(v); };
const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const nth = n => { const v = Math.round(+n); if (v >= 1 && v <= 10) return ORD[v]; const t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); };
const pts = n => (Math.round(n) === 1 ? 'one point' : spell(n) + ' points');
const spellOrNum = n => (Math.round(n) <= 12 ? spell(n) : String(Math.round(n)));
const of = (m, a) => spell(m) + ' of ' + a;
const sc = (a, b) => Math.max(a, b) + '–' + Math.min(a, b);
const mmss = ms => { const s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const minsWord = ms => { const m = Math.round((ms || 0) / 60000); return m <= 1 ? 'a minute' : spell(m) + ' minutes'; };
const periodName = (p, reg) => (p > reg ? (p - reg === 1 ? 'overtime' : nth(p - reg) + ' overtime') : reg === 2 ? nth(p) + ' half' : nth(p) + ' quarter');
const periodShort = (p, reg) => (p > reg ? 'overtime' : reg === 2 ? nth(p) + ' half' : nth(p));
/* where in a period a moment came: the clock counts down, the length guessed from the format and the clock itself */
function whenIn(clock, reg) {
  if (!fin(clock)) return '';
  const len = reg === 2 ? 1200000 : clock > 600000 ? 720000 : 600000;
  const f = 1 - clock / len;
  return f < 0.34 ? 'early in' : f < 0.67 ? 'midway through' : 'late in';
}

/* THE SCORE A RUN MOVED, [home, away] before its first basket and after its last: the log replayed exactly as story.js
   factFlow finds the game's run (the first longest streak of unanswered points), so it is the same run */
function runScores(g, runF) {
  const PTS = { p2_made: 2, p3_made: 3, ft_made: 1 };
  const s = [0, 0];
  let run = null, best = null;
  (g.events || []).forEach(e => {
    const v = PTS[e.t];
    if (!v || e.team == null) return;
    if (run && run.team === e.team) { s[e.team] += v; run.n += v; run.after = s.slice(); }
    else { const before = s.slice(); s[e.team] += v; run = { team: e.team, n: v, before, after: s.slice() }; }
    if (!best || run.n > best.n) best = { team: run.team, n: run.n, before: run.before, after: run.after };
  });
  if (!best || !runF || best.team !== runF.data.team || best.n !== runF.data.n) return null;
  return { before: best.before, after: best.after };
}

/* ================================================================= the phrasebook ===
   Context: W (winners) L (losers) T (a side) O (the other) are clubs; P Q R are players. Every other value is already a
   word or a figure. A level, where given, decides between situations; an entry for a situation outranks one for any. */
const BANK = {

  /* ---------------------------------------------------------------- the lede --- */
  'mr.lede': [
    { level: 9, when: c => c.moment, say: [
      '{P} won it for {W} with {secs} left, {what} to beat {L} {score}.',
      '{W} beat {L} {score}, and {P} decided it with {secs} on the clock.'] },
    { level: 8, when: c => c.ot, say: [
      '{W} needed overtime, but they got there, beating {L} {score} {where}.',
      'It took an extra period to separate them, and {W} were the stronger in it, beating {L} {score}.',
      '{W} beat {L} {score} after overtime {where}.'] },
    { level: 7, when: c => c.comeback, say: [
      '{W} came from {deficit} points down to beat {L} {score} {where}.',
      '{deficitCap} points down at one stage, {W} still beat {L} {score}.',
      '{L} let a {deficit}-point lead slip, and {W} took the game {score}.'] },
    { level: 7, when: c => c.stolen, say: [
      '{W} stole it late, beating {L} {score} after trailing with five minutes to play.',
      '{L} had it in their hands with five minutes left; {W} took it from them, {score}.'] },
    { level: 6, when: c => c.firstWin, say: [
      '{W} have their first win of the season. At the {attempt} attempt they beat {L} {score} {where}.',
      'It took {W} {gpWords}, but they are off the mark: a {score} win over {L} {where}.',
      '{W} are up and running. A {score} win over {L} {where} was their first of the season.'] },
    { level: 6, when: c => c.firstDefeat, say: [
      '{L} are unbeaten no more. {W} beat them {score} {where}, their first defeat in {wWords}.',
      '{W} handed {L} their first defeat of the season, {score} {where}.'] },
    { level: 6, when: c => c.streakEnded, say: [
      '{W} brought {L}’s winning run to an end at {n}, beating them {score} {where}.',
      '{L} had won {n} in a row. {W} stopped them, {score}, {where}.'] },
    { level: 6, when: c => c.upset, say: [
      '{W}, {rankW} in the table, beat {rankL}-placed {L} {score} {where}.',
      'The table said {L}; the game said {W}, {score} winners {where}.'] },
    { level: 5, when: c => c.wentTop, say: [
      '{W} are top of the table after beating {L} {score} {where}.',
      'A {score} win over {L} {where} took {W} to the top.'] },
    { level: 5, when: c => c.skidEnded, say: [
      '{W} ended a run of {n} straight defeats by beating {L} {score} {where}.',
      'The losing run is over for {W}: they beat {L} {score} {where}.'] },
    { level: 5, when: c => c.streak, say: [
      '{W} made it {n} wins in a row, beating {L} {score} {where}.',
      'That is {n} straight wins for {W}, who beat {L} {score} {where}.'] },
    { level: 5, when: c => c.unbeaten, say: [
      '{W} are still perfect: {L} became their {wNth} victims, beaten {score} {where}.',
      '{W} stay unbeaten after a {score} win over {L} {where}.'] },
    { level: 4, when: c => c.starLede, say: [
      '{P} scored {ppts} as {W} beat {L} {score} {where}.',
      '{P} put up {ppts}, and {W} beat {L} {score} {where}.'] },
    { level: 3, when: c => c.rout, say: [
      '{W} took {L} apart, winning {score} {where}.',
      'This one was over long before the end: {W} beat {L} {score} {where}.',
      '{W} were in a different class, beating {L} {score} {where}.'] },
    { level: 3, when: c => c.tight, say: [
      '{W} edged {L} {score} {where} in a game that was never more than a few baskets either way.',
      '{W} held on to beat {L} {score} {where}.',
      'There was almost nothing between them, but {W} had just enough, beating {L} {score} {where}.'] },
    { level: 3, when: c => c.slipped, say: [
      '{W} were {maxW} up at one point and had to hang on, but they beat {L} {score} {where}.',
      '{W} let most of a {maxW}-point lead slip before beating {L} {score} {where}.'] },
    { level: 2, when: c => c.runLede, say: [
      'A {n}–0 run in the {period} took the game away from {L}, and {W} won it {score} {where}.',
      '{W} beat {L} {score} {where}, and a {n}–0 run in the {period} was where they won it.'] },
    { level: 1, when: c => c.away, say: [
      '{W} won on the road, beating {L} {score} {where}.',
      '{W} went to {L} and came away with a {score} win.',
      '{W} beat {L} {score} {where}.'] },
    { level: 0, say: [
      '{W} beat {L} {score} {where}.',
      '{W} were {margin}-point winners over {L} {where}.',
      '{W} saw off {L} {score} {where}.'] }
  ],
  /* the hook: why, in one line (whatever the lede has not said) */
  'mr.hook': [
    { level: 3, when: c => c.hook === 'run', say: [
      'A {n}–0 run {runWhen} the {period} broke it open for {W}.',
      'The damage was done {runWhen} the {period}, when {W} scored {nWords} unanswered points.',
      '{W} scored {nWords} points in a row {runWhen} the {period}, and {L} never recovered.'] },
    { level: 3, when: c => c.hook === 'stretch', say: [
      'They won it in a {dur} spell of the {period}, outscoring {L} by {swing} in that time.'] },
    { level: 3, when: c => c.hook === 'star', say: [
      '{P} led the way with {ppts}.',
      '{P} was the difference, with {ppts}.',
      '{P} did the most damage, with {ppts}.'] },
    { level: 2, when: c => c.hook === 'half', say: [
      '{W} were {halfLead} up at half-time and never let {L} back in.',
      'It was effectively over by the break, with {W} {halfLead} points clear.'] },
    { level: 2, when: c => c.hook === 'wire', say: [
      '{W} were in front for almost all of it.',
      '{W} led from early on and were never caught.'] },
    { level: 1, when: c => c.hook === 'comfort', say: [
      '{W} were the better side for most of the {totalWords} minutes.',
      '{W} were rarely in danger.',
      '{L} were chasing it for most of the night.'] },
    { level: 1, when: c => c.hook === 'ot', say: [
      'It took an extra period to separate them.',
      'Forty minutes were not enough to settle it.'] },
    { level: 1, when: c => c.hook === 'pulled', say: [
      '{W} pulled away after half-time.',
      'The second half was where {W} won it.'] },
    { level: 1, when: c => c.hook === 'held', say: [
      '{W} were {maxW} up at one point, and needed every bit of it.',
      '{L} came back from {maxW} down and nearly made it.'] },
    { level: 1, when: c => c.hook === 'late', say: [
      'It was settled in the last few minutes.',
      'It came down to the closing minutes.'] },
    { level: 1, when: c => c.hook === 'close', say: [
      'It was in the balance until the closing minutes.',
      'Neither side was ever far ahead.',
      'There was never much in it.'] }
  ],
  /* where it leaves them: one line of the season around the game */
  'mr.stakes': [
    { level: 3, when: c => c.k === 'winless', say: ['{L} are still waiting for a first win, {lWords} games in.', 'It is {lWords} games and no wins for {L}.'] },
    { level: 3, when: c => c.k === 'loseStreak', say: ['{L} have now lost {n} in a row.', 'That is {n} straight defeats for {L}.'] },
    { level: 2, when: c => c.k === 'climbed', say: ['The win lifts {W} to {to} in the table.', '{W} move up to {to}.'] },
    { level: 2, when: c => c.k === 'stayTop', say: ['{W} stay top, at {rec}.', 'It keeps {W} at the top of the table.'] },
    { level: 2, when: c => c.k === 'lostTop', say: ['{L} lose top spot with the defeat.'] },
    { level: 2, when: c => c.k === 'teamSeasonHigh', say: ['Their {n} points were their most of the season.'] },
    { level: 2, when: c => c.k === 'stingiest', say: ['{W} have not allowed fewer than {n} points all season.'] },
    { level: 1, when: c => c.k === 'winStreak', say: ['{W} have now won {n} straight.', 'That is {n} wins in a row for {W}.'] }
  ],

  /* ------------------------------------------------------------------ the flow --- */
  'mr.start': [
    { level: 3, when: c => c.startGap >= 8, say: [
      '{T} made the faster start and were {startWords} up after the first quarter, {q1}.',
      '{T} took the first quarter {q1} and set the tone.',
      'The first quarter belonged to {T}, {q1}.'] },
    { level: 2, when: c => c.startGap >= 4, say: [
      '{T} took the first quarter {q1}.',
      'It was {q1} to {T} after the first quarter.'] },
    { level: 1, when: c => c.startGap >= 1, say: [
      '{T} edged the first quarter {q1}.',
      'There was little in it early on, {q1} to {T} after the first quarter.'] },
    { level: 0, when: c => c.startGap === 0, say: ['There was nothing between them after the first quarter, {q1}.', 'It was level after the first quarter, {q1}.'] },
    { level: 0, say: ['There was little in it early on: {q1} after the first quarter.'] }
  ],
  'mr.half': [
    { level: 3, when: c => c.halfTied, say: ['It was level at half-time, {h1}.', 'Nothing separated them at the break: {h1}.'] },
    { level: 2, when: c => c.halfBig, say: [
      'By half-time {T} were {halfLead} clear, {h1}.',
      '{T} went in at the break {halfLead} points up, {h1}.',
      'The lead was {halfLead} at half-time, {h1}.'] },
    { level: 1, say: [
      '{T} led {h1} at the break.',
      'It was {h1} to {T} at half-time.'] }
  ],
  'mr.turn': [
    { level: 4, when: c => c.turn === 'comeback', say: [
      'Then it turned. {W} were {deficit} down at one point, and they clawed it back.',
      '{L} were {deficit} up at one stage and could not hold it.'] },
    { level: 4, when: c => c.turn === 'comebackBody', say: [
      '{L} led by {deficit} at one stage.',
      'At one point {L} were {deficit} points up.'] },
    { level: 4, when: c => c.turn === 'afterHalf', say: [
      '{W} came out after the break a different side and won the second half by {secondHalf}.',
      'The second half was all {W}: they won it by {secondHalf}.'] },
    /* THE RUN THAT DECIDED IT, told from the score it started at: a lead the other side had cut, answered; or a close game
       broken open */
    { level: 4, when: c => c.turn === 'runAnswer', say: [
      '{O} cut it to {gapWords} {runWhen} the {period}, but {T} answered with {nWords} straight points to lead {after}, and that settled it.',
      'With the lead down to {gapWords} at {before}, {T} scored the next {nWords} points {runWhen} the {period}, and the game was gone.'] },
    { level: 3, when: c => c.turn === 'run', say: [
      'The game turned {runWhen} the {period}: from {before}, {T} scored {nWords} unanswered points.',
      '{runWhenCap} the {period} it was {before}; then {T} scored {nWords} in a row, and that was the game.',
      'At {before} {runWhen} the {period}, {T} put together the {n}–0 run that decided it.'] },
    { level: 3, when: c => c.turn === 'surge', say: [
      'The second half was where {W} pulled clear, winning it by {secondHalf}.',
      '{W} kept pushing after the break and won the second half by {secondHalf}.'] },
    /* A RUN OF TEN TO FIFTEEN IS A DETAIL OF THE GAME'S FLOW, said in passing in the story of its half (Louie, 2026-10-08:
       "underindex on small 10-0 runs"), with the score it moved; never the headline, the standfirst or the lede */
    { level: 3, when: c => c.turn === 'gap2', say: [
      'The second half started close, but a {n}–0 run by {T} {runWhen} the {period} opened a gap.',
      'It stayed close after the break until {T} scored {nWords} in a row {runWhen} the {period}, taking it from {before} to {after}.',
      'There was little in it early in the second half; a gap only opened {runWhen} the {period}, off the back of a {n}–0 run by {T}.'] },
    { level: 3, when: c => c.turn === 'gapAhead', say: [
      '{T} were behind until {nWords} unanswered points {runWhen} the {period} turned {before} into {after}.',
      'Trailing {before}, {T} went in front {runWhen} the {period} with {nWords} straight points, to {after}.'] },
    { level: 3, when: c => c.turn === 'ahead', say: [
      '{T} went in front {runWhen} the {period}, scoring {nWords} in a row to turn {before} into {after}.',
      'A {n}–0 run {runWhen} the {period} put {T} ahead, {after}.'] },
    { level: 3, when: c => c.turn === 'stretchLead', say: [
      '{T} stretched their lead {runWhen} the {period} with a {n}–0 run that made it {after}.',
      '{nWordsCap} straight points {runWhen} the {period} took {T} from {before} to {after}.'] },
    { level: 3, when: c => c.turn === 'fightback', say: [
      '{T} cut it to {after} with a {n}–0 run {runWhen} the {period}, but {O} steadied.',
      '{T} made a game of it {runWhen} the {period}, scoring {nWords} in a row to get within {within}, but could not go on with it.'] },
    { level: 2, when: c => c.turn === 'drought', say: [
      '{T} went {dur} without a field goal in the {period}, and the game went with it.',
      'A spell of {dur} without a field goal in the {period} cost {T} dearly.'] }
  ],
  'mr.peak': [
    { level: 1, say: ['At its widest the gap was {by}.', '{W} went on to lead by as many as {by}.', 'At one point {W} were {by} clear.'] }
  ],
  'mr.finish': [
    { level: 5, when: c => c.fin === 'gameWinner', say: [
      'It went to the wire, and {P} won it with {secs} left.',
      'With {secs} left it was still anyone’s, until {P} settled it with a {what}.'] },
    { level: 5, when: c => c.fin === 'ot', say: [
      'It was {regScore} {regEnd}, and {W} won the extra period {otScore}.',
      'At {regScore} {regEnd} it went to overtime, where {W} were the stronger, {otScore}.'] },
    { level: 6, when: c => c.fin === 'ot' && c.many, say: ['It was {regScore} {regEnd} and took {otsWords} overtimes to settle.'] },
    { level: 5, when: c => c.fin === 'goAhead' && c.three, say: [
      'The decisive basket was {P}’s three with {left} left.',
      '{P}’s three with {left} to play put {W} ahead for good.'] },
    { level: 5, when: c => c.fin === 'goAhead' && !c.three, say: [
      '{P} put {W} ahead for good with {left} to play.',
      'With {left} left, {P} scored the basket that put {W} in front for good.'] },
    { level: 4, when: c => c.fin === 'close', say: [
      'It was {at5} with five minutes left, and it stayed that close almost to the end.',
      'With five minutes to go it was {at5}, anybody’s game.'] },
    { level: 4, when: c => c.fin === 'heldOn', say: [
      '{W} were {lead5} up with five minutes left and very nearly let it go: {L} cut it to {margin}.',
      'A {lead5}-point lead with five to play shrank to {margin} by the end, but {W} held on.'] },
    { level: 4, when: c => c.fin === 'pulledAway', say: [
      'It was {at5} with five minutes left; {W} won the last five minutes {late}.',
      'With five minutes to go it was still {at5}, and then {W} pulled away.'] },
    { level: 3, when: c => c.fin === 'iced', say: ['{W} made {ftWords} late free throws to close it out.', 'At the line late on, {W} made {ftWords} to see it through.'] },
    { level: 2, when: c => c.fin === 'never', say: [
      '{L} never got back within single figures.',
      '{L} never got close enough to make {W} nervous.',
      'From there {L} were chasing a game that had gone.'] },
    { level: 1, when: c => c.fin === 'wire', say: ['{W} led for all but {trailMins} of the {totalWords}.', '{W} were in front for {ledWords} of the {totalWords} minutes.'] }
  ],

  /* ------------------------------------------------------------------- the why --- */
  'mr.why.tov': [
    { level: 2, when: c => c.pot >= 8, say: [
      '{W} made {L} pay for their mistakes: {L} turned it over {tov} times, and {W} scored {pot} points off those turnovers.',
      'The turnovers told the story. {L} gave the ball away {tov} times and {W} turned that into {pot} points.',
      '{L} were careless with the ball, {tov} turnovers in all, and {W} cashed in for {pot} points.'] },
    { level: 1, say: ['{L} turned it over {tov} times, {W} only {tovW}.', '{W} looked after the ball far better: {tovW} turnovers to {L}’s {tov}.'] }
  ],
  'mr.why.def': [
    { level: 2, when: c => c.sb >= 12, say: [
      '{W}’s defence was all over them, with {stl} steals and {blk} blocks.',
      'Defensively {W} were relentless: {stl} steals, {blk} blocked shots.'] },
    { level: 1, when: c => fin(c.oppFg), say: [
      '{W} defended well all night, and {L} shot {oppFg}% from the field.',
      '{L} could not find a way through, shooting {oppFg}% from the field.'] }
  ],
  'mr.why.glass': [
    { level: 2, when: c => c.sc >= 10, say: [
      '{W} owned the offensive glass, getting {orb} of their own misses back and turning them into {sc} second-chance points.',
      'Second chances made the difference: {W} grabbed {orb} offensive rebounds and scored {sc} points from them.'] },
    { level: 1, say: ['{W} won the boards {reb}.', 'On the boards it was {reb} to {W}.'] }
  ],
  'mr.why.paint': [
    { level: 1, say: ['{W} did their damage inside, outscoring {L} {paint} in the paint.', 'Most of it came close to the basket: {W} won the points in the paint {paint}.'] }
  ],
  'mr.why.three': [
    { level: 2, when: c => c.hot, say: [
      '{T} were on fire from deep, making {m} of {a} threes.',
      'The threes kept falling for {T}: {m} of {a}.',
      '{T} shot the lights out from three, {m} of {a}.'] }
  ],
  'mr.why.line': [
    { level: 1, say: ['{W} got to the free-throw line {fta} times to {L}’s {ftaL}.', '{W} lived at the free-throw line, with {fta} attempts to {L}’s {ftaL}.'] }
  ],
  'mr.why.break': [
    { level: 1, say: ['{W} ran whenever they could and won the fast-break points {fast}.', 'In transition it was no contest: {fast} on the break to {W}.'] }
  ],
  'mr.why.bench': [
    { level: 1, say: ['The bench made the difference, outscoring {L}’s {bench}.', '{W} got far more from their bench: {bench}.'] }
  ],
  'mr.why.share': [
    { level: 1, say: ['{W} moved the ball well, with {ast} assists on {fgm} baskets.', 'The ball moved: {ast} of {W}’s {fgm} baskets were assisted.'] }
  ],
  /* the counterpoint: won ugly */
  'mr.why.ugly': [
    { level: 2, when: c => c.three && c.ft, say: [
      'It was not pretty. {W} made {m} of {a} threes and {ftm} of {fta} free throws, and won anyway.',
      (c, b) => b.join('concession', '{W} made only {m} of {a} threes and {ftm} of {fta} free throws.', 'They won by {marginWords}.')] },
    { level: 1, when: c => c.three, say: [
      'It was not a night for shooting: {W} made {m} of {a} from three and won anyway.',
      (c, b) => b.join('concession', '{W} made only {m} of their {a} threes.', 'They won anyway.')] },
    { level: 1, when: c => c.ft, say: [
      '{W} made only {ftm} of their {fta} free throws, and it did not matter.',
      '{W} were poor at the free-throw line, {ftm} of {fta}, and it did not matter.'] }
  ],
  'mr.why.bothCold': [
    { level: 1, say: [
      'Neither side could buy a three: {W} made {m} of {a}, {L} {m2} of {a2}.',
      'It was a poor night from deep for both: {m} of {a} for {W}, {m2} of {a2} for {L}.'] }
  ],

  /* ----------------------------------------------------------------- the stars --- */
  'mr.star': [
    { level: 3, when: c => c.td, say: ['{P} had a triple-double for {T}: {line}.', '{P} filled the sheet with a triple-double, {line}.'] },
    { level: 3, when: c => c.big && c.best, say: [
      '{P} was the best player on the floor, with {line}.',
      '{P} led everyone with {line}.',
      '{P} carried {T}: {line}.'] },
    { level: 2, when: c => c.big, say: [
      '{P} led {T} with {line}.',
      '{P} carried {T}: {line}.'] },
    { level: 1, say: [
      '{P} led {T} with {line}.',
      '{P} top-scored for {T} with {line}.',
      '{P} was {T}’s top scorer, with {line}.'] }
  ],
  'mr.star.again': [
    { level: 1, say: ['{P} also had {rest}.', 'Besides the points, {P} had {rest}.'] }
  ],
  'mr.star.shooting': [
    { level: 2, when: c => c.named, say: ['{P} made {fgmWords} of {fga} shots.', '{P} was efficient, making {fgmWords} of {fga} shots.'] },
    { level: 1, say: ['{He} was efficient, too, making {fgmWords} of {fga} shots.', 'And {he} did it efficiently, on {fgm}-of-{fga} shooting.'] }
  ],
  'mr.star.career': [
    { level: 2, when: c => c.career, say: ['It was the best scoring night of {his} career here.', 'No game of {his} in this league has brought more points.'] },
    { level: 1, when: c => c.above, say: ['That is well above the {avg} {he} had been averaging.', '{He} had been averaging {avg}.'] }
  ],
  'mr.second': [
    { level: 3, when: c => c.first, say: ['{P} scored {ppts} for {T}.', '{P} had {ppts} for {T}.'] },
    { level: 2, when: c => c.bench, say: ['{P} added {ppts} off the bench.', 'Off the bench, {P} chipped in {ppts}.', '{P} gave {T} {ppts} from the bench.'] },
    { level: 1, say: ['{P} added {ppts}.', '{P} chipped in with {ppts}.', '{P} contributed {ppts}.'] }
  ],
  'mr.spec': [
    { level: 3, when: c => c.k === 'blocks', say: ['{P} blocked {n} shots at the other end.', 'At the other end, {P} blocked {n} shots.'] },
    { level: 3, when: c => c.k === 'boards', say: ['{P} pulled down {n} rebounds.', '{P} was a force on the boards with {n} rebounds.'] },
    { level: 3, when: c => c.k === 'steals', say: ['{P} had {n} steals.', '{P} picked {n} pockets.'] },
    { level: 2, when: c => c.k === 'hub', say: [
      '{P} ran the offence, setting up {n} of {T}’s {total} assisted baskets.',
      'Much of it went through {P}, who set up {n} of {T}’s {total} assisted baskets.'] },
    { level: 2, when: c => c.k === 'assists', say: ['{P} handed out {n} assists.', '{P} ran the show with {n} assists.'] },
    { level: 2, when: c => c.k === 'plusMinus', say: ['{T} were {pm} points better with {P} on the floor.', 'With {P} on the court, {T} won by {pm}.'] }
  ],

  /* ---------------------------------------------------------------- the losers --- */
  'mr.lose.best': [
    { level: 3, when: c => c.also, say: ['{P} had {line}.', '{P} added {line}.'] },
    { level: 2, when: c => c.dd, say: [
      'For {T}, {P} had {line}.',
      '{P} did what {he2} could for {T}, with {line}.',
      '{T}’s best was {P}, with {line}.'] },
    { level: 1, say: [
      '{P} led {T} with {ppts}.',
      'For {T}, {P} scored {ppts}.',
      '{P} top-scored for {T} with {ppts}.'] }
  ],
  'mr.lose.cold': [
    { level: 2, when: c => c.two, say: [
      'But {P} ({s1}) and {Q} ({s2}) never found their range.',
      '{T} needed more from {P} and {Q}, who shot {s1} and {s2}.'] },
    { level: 1, say: ['{P} struggled, making {s1}.', 'It was a hard night for {P}, {s1} from the field.'] }
  ],
  'mr.lose.fouls': [
    { level: 1, when: c => c.two, say: ['Both {P} and {Q} fouled out.', '{P} and {Q} both fouled out.'] },
    { level: 0, say: ['{P} fouled out.', '{T} lost {P} to fouls.'] }
  ],
  'mr.lose.sc': [
    { level: 1, say: ['{T} kept themselves in it on the offensive glass, with {sc} second-chance points.', 'Second chances kept {T} going: {sc} points from them.'] }
  ],

  /* --------------------------------------------------------------- the five --- */
  'mr.five': [
    { level: 1, say: [
      '{T}’s best spell came with {five} on the floor: they won those {dur} by {pm}.',
      'The group that did it was {five}, plus {pm} in {dur} together.'] }
  ],

  /* ------------------------------------------------------------------ what next --- */
  'mr.table': [
    { level: 1, say: ['{W} are {rankW} at {recW}; {L} are {rankL} at {recL}.', '{W} move to {recW}, {rankW} in the table; {L} are {rankL} at {recL}.'] }
  ],
  'mr.next': [
    { level: 3, when: c => c.again, say: ['The two meet again on {day}.', 'They do it all again on {day}.'] },
    { level: 2, when: c => c.both && c.sameDay, say: [
      '{W} {nextW} on {day}; {L} {nextL} the same day.',
      'Next up, on {day}: {W} {nextW}, {L} {nextL}.'] },
    { level: 1, when: c => c.both, say: [
      '{W} {nextW} on {dayW}, and {L} {nextL} on {dayL}.',
      'Next for {W}: they {nextW} on {dayW}. {L} {nextL} on {dayL}.'] },
    { level: 0, when: c => c.one, say: ['Next for {T}: they {nextT} on {dayT}.', '{T} {nextT} on {dayT}.'] }
  ]
};

/* =================================================================== the writer === */
function write(g, fs, kit) {
  const V = VOICE();
  if (!V || typeof V.extend !== 'function' || !kit) return null;
  V.extend(BANK);
  const one = k => fs.find(f => f.kind === k), all = k => fs.filter(f => f.kind === k);
  const res = one('result');
  if (!res || !res.data || res.data.margin === 0 || res.data.winner == null) return null;
  const w = res.data.winner, l = res.data.loser, margin = res.data.margin;
  const tc = kit.tc || (s => String(s || ''));
  const reg = g.reg || 4;
  const seed = 'mr|' + g.names.join('|') + '|' + g.score.join('-');
  const W = V.writer(seed);
  const names = [tc(g.names[0]), tc(g.names[1])];
  const lg = String((g.meta && (g.meta.league || g.meta.leagueSlug)) || '');
  const shorts = clubShorts(names, { baltic: /^(nkl|lkl|rkl|lbl|lbl2|enbl|lmbl)$/i.test(lg.trim()) });
  const club = t => V.club(names[t], { id: 'club' + t, short: shorts[t] !== names[t] ? shorts[t] : null });
  const C = [club(0), club(1)];
  const gender = genderOf(g);
  /* a surname two players share is the full name every time */
  const sur = new Map();
  (g.players || []).forEach(p => { const k = String(kit.surnameOf(tc(p.name))).toLowerCase(); sur.set(k, (sur.get(k) || 0) + 1); });
  const PE = new Map();
  const P = p => {
    if (!p) return null;
    const key = String(p.id || p.name);
    if (!PE.has(key)) {
      /* a feed's stray brackets and escaped apostrophes ("(Mititelu)", "De\'marco") are not part of anybody's name */
      const full = tc(p.name).replace(/[()]/g, '').replace(/\\(?=['’])/g, '').replace(/\s+/g, ' ').trim(), last = kit.surnameOf(full);
      const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(full);
      PE.set(key, V.person(full, { id: 'p' + key, g: gender, short: cjk || (sur.get(String(last).toLowerCase()) || 0) > 1 || last.length < 3 ? full : last }));
    }
    return PE.get(key);
  };
  const byName = name => (g.players || []).find(p => tc(p.name) === tc(name)) || { name, id: name };
  const hi = Math.max(g.score[0], g.score[1]), lo = Math.min(g.score[0], g.score[1]);
  const score = hi + '–' + lo;
  const spent = new Set();
  const pron = gender === 'f' ? { he: 'she', He: 'She', his: 'her', him: 'her', He2: 'She', he2: 'she' }
    : gender === 'm' ? { he: 'he', He: 'He', his: 'his', him: 'him', he2: 'he' } : null;
  const say = (slot, c) => { const t = W.say(slot, c); return t || ''; };
  const base = { W: C[w], L: C[l], score, margin, marginWords: spell(margin) };
  const T = t => C[t];

  /* the player lines a report quotes: points first, then what else stood out, at most two more numbers */
  const reb = p => (p.or || 0) + (p.dr || 0);
  const line = (p, opts) => {
    const o = opts || {};
    const bits = [(p.pts || 0) + ' points'];
    const extra = [];
    if (reb(p) >= 8) extra.push([reb(p), 'rebounds']);
    if ((p.ast || 0) >= 5) extra.push([p.ast, 'assists']);
    if ((p.stl || 0) >= 4) extra.push([p.stl, 'steals']);
    if ((p.blk || 0) >= 3) extra.push([p.blk, 'blocks']);
    extra.sort((a, b) => b[0] - a[0]).slice(0, o.max == null ? 2 : o.max).forEach(x => bits.push(spell(x[0]) + ' ' + x[1]));
    return bits.length === 1 ? bits[0] : bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
  };
  const fgOf = p => [(p.p2m || 0) + (p.p3m || 0), (p.p2a || 0) + (p.p3a || 0)];
  const isStarter = p => ((g.starters || [])[p.team] || []).indexOf(p.id) >= 0;
  const players = t => (g.players || []).filter(p => p.team === t).slice().sort((a, b) => (b.pts || 0) - (a.pts || 0) || reb(b) - reb(a));

  /* ======================================================================== lede */
  const meta = (one('meta') || {}).data || {};
  const homeWon = w === 0;
  const where = meta.venue && homeWon ? 'at home' : meta.venue ? 'at ' + tc(meta.venue) : homeWon ? 'at home' : 'on the road';
  const dayPhrase = meta.day ? 'on ' + meta.day + (meta.evening && meta.evening !== 'evening' ? ' ' + meta.evening : '') : '';
  const whereDay = [where, dayPhrase].filter(Boolean).join(' ');
  const ctxL = Object.assign({}, base, { where: whereDay, score2: score + ' ', away: !homeWon });
  const bigLead0 = one('biggestLead');
  const maxLeadW = bigLead0 && bigLead0.data.side === w ? bigLead0.data.by : margin;
  const gw = one('gameWinner'), ot = one('overtime'), cb = one('comeback'), stolen = one('stolenLate');
  const fw = one('firstWin'), fdf = one('firstDefeat'), se = one('streakEnded'), up = one('upset'), top = one('wentTop');
  const ske = one('skidEnded'), ws = one('winStreak'), unb = one('unbeaten'), td = one('tripleDouble');
  const runF = one('run'), stretch = one('stretch');
  const winnersRun = runF && runF.data.team === w && runF.data.n >= 8 ? runF : null;
  /* A RUN THAT DECIDED IT, judged by the score it started from (runScores): fourteen or more after half-time in a game that
     was close or going the other way (within six, or behind), or eighteen or more from a close game at any time - never a
     run that only stretched a lead already there, nor a first-half run in a game the winners then had to come back in.
     Only such a run may lead, hook, make the headline or be "the game turned"; any other run of ten or more is a detail of
     the flow, said there in passing (Louie, 2026-10-08: "underindex on small 10-0 runs"). */
  const halfP0 = reg === 2 ? 1 : 2;
  const decisive = r => {
    if (!r || (one('comeback') && r.data.period <= halfP0)) return false;
    const rs = runScores(g, r);
    if (!rs) return false;
    const t = r.data.team, mB = rs.before[t] - rs.before[1 - t];
    if (mB > 6) return false;
    return (r.data.n >= 14 && r.data.period > halfP0) || r.data.n >= 18;
  };
  const starW = players(w)[0];
  const bigStar = (g.players || []).slice().sort((a, b) => (b.pts || 0) - (a.pts || 0))[0];
  if (gw && gw.data.p) {
    const secs = Math.max(1, Math.round((gw.data.left || gw.data.clock || 0) / 1000));
    Object.assign(ctxL, { moment: true, P: P(byName(gw.data.p.name)), secs: spell(secs) + (secs === 1 ? ' second' : ' seconds'),
      what: gw.data.kind === 'three' ? 'a three' : gw.data.kind === 'free throw' ? 'free throws' : 'a basket' });
    spent.add('moment');
  } else if (ot) { ctxL.ot = true; spent.add('ot'); }
  else if (cb && cb.data.deficit >= 8) { Object.assign(ctxL, { comeback: true, deficit: cb.data.deficit, deficitCap: V.cap(spell(cb.data.deficit)) }); spent.add('comeback'); }
  else if (stolen) { ctxL.stolen = true; spent.add('finish'); }
  else if (fw) { Object.assign(ctxL, { firstWin: true, attempt: nth(fw.data.gp), gpWords: spell(fw.data.gp) + ' games' }); spent.add('ctx:firstWin'); }
  else if (fdf) { Object.assign(ctxL, { firstDefeat: true, wWords: spell(fdf.data.w + 1) + ' games' }); spent.add('ctx:firstDefeat'); }
  else if (se) { Object.assign(ctxL, { streakEnded: true, n: spell(se.data.n) }); spent.add('ctx:streakEnded'); }
  else if (up && up.data.rank) { Object.assign(ctxL, { upset: true, rankW: nth(up.data.rank[0]), rankL: nth(up.data.rank[1]) }); spent.add('ctx:upset'); }
  else if (top) { ctxL.wentTop = true; spent.add('ctx:wentTop'); }
  else if (ske) { Object.assign(ctxL, { skidEnded: true, n: spell(ske.data.n) }); spent.add('ctx:skidEnded'); }
  else if (ws && ws.data.n >= 3) { Object.assign(ctxL, { streak: true, n: spell(ws.data.n) }); spent.add('ctx:winStreak'); }
  else if (unb && unb.data.w >= 4) { Object.assign(ctxL, { unbeaten: true, wNth: nth(unb.data.w) }); spent.add('ctx:unbeaten'); }
  else if (bigStar && bigStar.team === w && (bigStar.pts || 0) >= 30) { Object.assign(ctxL, { starLede: true, P: P(bigStar), ppts: bigStar.pts + ' points' }); spent.add('star:' + bigStar.id); }
  else if (margin >= 22) ctxL.rout = true;
  else if (margin <= 4 && maxLeadW < 10) ctxL.tight = true;
  else if (margin <= 6 && maxLeadW >= 14) { Object.assign(ctxL, { slipped: true, maxW: maxLeadW }); spent.add('peak'); }
  else if (winnersRun && winnersRun.data.n >= 14 && decisive(winnersRun)) { Object.assign(ctxL, { runLede: true, n: winnersRun.data.n, period: periodShort(winnersRun.data.period, reg) }); spent.add('run'); }
  /* THE STANDFIRST IS WRITTEN FIRST: it is read first, under the headline, so it is the one that names the clubs in full
     the first time. The hook (the run, the star, the half-time lead, or how the game went), then where it leaves them.
     The body then starts again with the full names (W.section), as a report does under its standfirst. */
  const half = (one('half') || {}).data;
  const runWhen = r => whenIn(r.data.clock, reg) || 'in';
  const totalMs = ((one('timeLed') || {}).data || {}).total || (reg === 2 ? 2400000 : 2400000);
  base.totalWords = spellOrNum(Math.round(totalMs / 60000));
  const stand = [];
  let hook = null;
  if (winnersRun && !ctxL.runLede && decisive(winnersRun)) {
    hook = say('mr.hook', Object.assign({}, base, { hook: 'run', n: winnersRun.data.n, nWords: spell(winnersRun.data.n), period: periodShort(winnersRun.data.period, reg), runWhen: runWhen(winnersRun) }));
  }
  if (!hook && starW && (starW.pts || 0) >= 20 && !spent.has('star:' + starW.id) && !ctxL.moment) {
    hook = say('mr.hook', Object.assign({}, base, { hook: 'star', P: P(starW), ppts: starW.pts + ' points' }));
  }
  if (!hook && half && half.halfLead >= 12 && !ctxL.comeback && !ctxL.ot) hook = say('mr.hook', Object.assign({}, base, { hook: 'half', halfLead: spell(half.halfLead) }));
  if (!hook) {
    const bigL0 = one('biggestLead'), maxW = bigL0 && bigL0.data.side === w ? bigL0.data.by : margin;
    const lateDecided = one('goAhead') || one('closeFinish') || one('heldOn') || one('stolenLate') || one('gameWinner');
    const h1 = half && half.h1 ? half.h1 : null, hLeadW = h1 ? (w === 0 ? h1[0] - h1[1] : h1[1] - h1[0]) : 0;
    const h2 = half && half.h2 ? half.h2 : null, h2W = h2 ? (w === 0 ? h2[0] - h2[1] : h2[1] - h2[0]) : 0;
    const kind = one('overtime') ? 'ot' : margin >= 10 && hLeadW >= 8 ? 'comfort' : margin >= 8 && h2W >= 8 ? 'pulled'
      : maxW >= 12 && margin <= 8 ? 'held' : lateDecided ? 'late' : maxW < 10 ? 'close' : null;
    if (kind) hook = say('mr.hook', Object.assign({}, base, { hook: kind, maxW }));
    if (kind === 'held') spent.add('peak');
  }
  if (hook) stand.push(hook);
  /* where it leaves them */
  const ctxKinds = ['winless', 'loseStreak', 'stayTop', 'climbed', 'lostTop', 'winStreak', 'teamSeasonHigh', 'stingiest'];
  const stake = fs.find(f => ctxKinds.indexOf(f.kind) >= 0 && !spent.has('ctx:' + f.kind) && !(f.kind === 'winStreak' && (f.data.n < 3 || f.side !== w)));
  if (stake) {
    const d = stake.data;
    const c = Object.assign({}, base, { k: stake.kind,
      n: stake.kind === 'teamSeasonHigh' || stake.kind === 'stingiest' ? d.pts : spell(d.n), lWords: spell(d.l),
      to: d.to ? nth(d.to) : '', rec: d.w != null && d.l != null ? d.w + '–' + d.l : '' });
    const s = say('mr.stakes', c);
    if (s) { stand.push(s); spent.add('ctx:' + stake.kind); }
  }
  W.section('body');
  const lede = [say('mr.lede', ctxL)];
  const paras = [{ beat: 'lede', text: lede.filter(Boolean).join(' '), card: null }];

  /* ======================================================================== flow */
  W.paragraph();
  const flow = [];
  const perQ = g.perQ || [[], []];
  const halfP = reg === 2 ? 1 : 2;
  /* WHAT TURNED IT is decided before a word is said, so the paragraph is told in the order it happened: a run in the
     second quarter comes before the half-time score, not after it. A run by the side that lost is a fightback, not
     the turn of the game. */
  const turned = one('turnedAfterHalf'), surge = one('secondHalfSurge'), drought = one('drought');
  let turnC = null, turnP = 99;
  /* the run, told by what it did: decided it (16+, or 14+ after the break), opened a gap in a close second half, put a side
     ahead or stretched its lead in the first, or - by the side that lost - made it close again. Under ten, not at all. */
  function runTurn() {
    if (!runF || runF.data.n < 10 || spent.has('run')) return null;
    const t = runF.data.team, n = runF.data.n, wh = runWhen(runF), rs = runScores(g, runF);
    const tf = x => x[t] + '–' + x[1 - t];
    const c = { T: T(t), O: T(1 - t), n, nWords: spell(n), period: periodShort(runF.data.period, reg), runWhen: wh, runWhenCap: V.cap(wh),
      before: rs ? tf(rs.before) : '', after: rs ? tf(rs.after) : '', nWordsCap: V.cap(spell(n)) };
    if (t !== w) {
      const gapAfter = rs ? Math.abs(rs.after[0] - rs.after[1]) : 99;
      return n >= 12 && rs && gapAfter <= 6 && margin <= 12 ? Object.assign(c, { turn: 'fightback', within: spell(gapAfter) }) : null;
    }
    if (!rs) return null;
    const mB = rs.before[t] - rs.before[1 - t], mA = rs.after[t] - rs.after[1 - t];
    if (decisive(runF)) {
      /* the lead they had at the break, cut before the run: the run was the answer */
      const h1 = half && half.h1 ? half.h1 : null, hlT = h1 ? h1[t] - h1[1 - t] : null;
      return mB > 0 && runF.data.period > halfP && hlT != null && hlT > mB + 2
        ? Object.assign(c, { turn: 'runAnswer', gapWords: spell(mB) }) : Object.assign(c, { turn: 'run' });
    }
    /* a run that only adds to a rout is not worth a sentence unless it was a big one */
    if (mB >= 15 && n < 18) return null;
    if (mB > 6) return Object.assign(c, { turn: 'stretchLead' });
    if (runF.data.period > halfP) return Object.assign(c, { turn: mB < 0 && mA > 0 ? 'gapAhead' : 'gap2' });
    if (mB <= 0 && mA > 0) return Object.assign(c, { turn: 'ahead' });
    return mB > 0 ? Object.assign(c, { turn: 'stretchLead' }) : null;
  }
  if (cb && cb.data.deficit >= 8 && spent.has('comeback') && !turned) { turnC = { turn: 'comebackBody', deficit: spell(cb.data.deficit) }; turnP = halfP; }
  else if (turned && !spent.has('comeback')) { turnC = { turn: 'afterHalf', secondHalf: spell(turned.data.secondHalf) }; turnP = halfP + 1; }
  else if (cb && cb.data.deficit >= 8 && !spent.has('comeback')) { turnC = { turn: 'comeback', deficit: spell(cb.data.deficit) }; turnP = 99; }
  else if ((turnC = runTurn())) { turnP = runF.data.period; spent.add('run'); }
  else if (surge && surge.data.secondHalf >= 10) { turnC = { turn: 'surge', secondHalf: spell(surge.data.secondHalf) }; turnP = halfP + 1; }
  else if (drought && drought.side === l && drought.data.dur >= 240000) { turnC = { turn: 'drought', T: T(drought.side), dur: minsWord(drought.data.dur), period: periodShort(drought.data.period, reg) }; turnP = drought.data.period; }
  const sayTurn = () => { if (turnC) flow.push(say('mr.turn', Object.assign({}, base, turnC))); turnC = null; };

  if (perQ[0] && perQ[0][1] != null && perQ[1][1] != null) {
    const a = perQ[0][1] || 0, b = perQ[1][1] || 0, gap = Math.abs(a - b), t = a > b ? 0 : 1;
    flow.push(say('mr.start', Object.assign({}, base, { T: T(t), startGap: gap, startWords: spell(gap), q1: sc(a, b) })));
  }
  if (turnC && turnP <= halfP) sayTurn();
  if (half) {
    const h1 = half.h1 || [0, 0], hl = h1[0] - h1[1], t = hl > 0 ? 0 : 1;
    const bigHalf = !spent.has('half') && Math.abs(hl) >= 10;
    flow.push(say('mr.half', Object.assign({}, base, { T: T(t), halfTied: hl === 0, halfBig: bigHalf, halfLead: spell(Math.abs(hl)), h1: sc(h1[0], h1[1]) })));
  }
  sayTurn();
  const big = one('biggestLead');
  if (big && !spent.has('peak') && big.data.side === w && big.data.by >= margin + 5 && big.data.by >= 12) flow.push(say('mr.peak', Object.assign({}, base, { by: big.data.by })));
  /* the finish */
  const close = one('closing'), held = one('heldOn'), closeF = one('closeFinish'), pulled = one('pulledAway'), iced = one('icedIt'), goA = one('goAhead'), tl = one('timeLed');
  let finC = null;
  const otF = one('overtime');
  if (gw && !spent.has('moment')) finC = { fin: 'gameWinner', P: P(byName(gw.data.p.name)), secs: spell(Math.max(1, Math.round((gw.data.left || 0) / 1000))) + ' seconds', what: gw.data.kind === 'three' ? 'three' : 'basket' };
  else if (otF && otF.data.reg) finC = { fin: 'ot', regScore: otF.data.reg[0] + '–' + otF.data.reg[1], otScore: sc(otF.data.ot[0], otF.data.ot[1]),
    regEnd: reg === 2 ? 'after two halves' : 'after four quarters', many: otF.data.ots > 1, otsWords: spell(otF.data.ots) };
  else if (goA && goA.side === w && (goA.data.left || 0) <= 180000 && margin <= 8) finC = { fin: 'goAhead', P: P(byName(goA.data.p.name)), left: mmss(goA.data.left), three: goA.data.kind === 'three' };
  else if (held) finC = { fin: 'heldOn', lead5: spell(held.data.lead5), margin: spell(margin) };
  else if (closeF && close) finC = { fin: 'close', at5: sc(close.data.at5[0], close.data.at5[1]) };
  else if (pulled && close) finC = { fin: 'pulledAway', at5: sc(close.data.at5[0], close.data.at5[1]), late: sc(close.data.late[0], close.data.late[1]) };
  else if (iced && iced.data.made >= 2 && margin <= 8) finC = { fin: 'iced', ftWords: spell(iced.data.made) };
  else if (tl && tl.data.winnerShare >= 0.85 && !spent.has('wire') && margin >= 10) finC = { fin: 'wire', trailMins: minsWord((1 - tl.data.winnerShare) * (tl.data.total || 2400000)),
    ledWords: spell(Math.round(tl.data.winnerShare * (tl.data.total || 2400000) / 60000)) };
  else if (close && margin >= 12) finC = { fin: 'never' };
  if (finC && !spent.has('finish')) flow.push(say('mr.finish', Object.assign({}, base, finC)));
  if (flow.filter(Boolean).length >= 2) paras.push({ beat: 'flow', text: flow.filter(Boolean).join(' '), card: 'quarters' });

  /* ========================================================================= why */
  W.paragraph();
  const why = [];
  const TL = all('teamLine');
  const lineOf = t => { const f = TL.find(x => x.side === t); return f ? f.data : null; };
  const LW = lineOf(w), LL = lineOf(l);
  const team = g.team || [{}, {}];
  /* the candidates, each scored on how far apart the sides were: the strongest two, then the counterpoint */
  const cands = [];
  const tovW = LW ? LW.tov : null, tovL = LL ? LL.tov : null;
  const potW = (team[w] || {}).pot || 0, potL = (team[l] || {}).pot || 0;
  if (tovL != null && tovW != null && tovL - tovW >= 5) cands.push({ s: 60 + (tovL - tovW) * 2 + Math.max(0, potW - potL), slot: 'mr.why.tov', c: { tov: tovL, tovW: spell(tovW), pot: potW } });
  if (LW && LW.stl + LW.blk >= 12) cands.push({ s: 55 + (LW.stl + LW.blk), slot: 'mr.why.def', c: { sb: LW.stl + LW.blk, stl: spell(LW.stl), blk: spell(LW.blk) } });
  else if (LL && fin(LL.fgp) && LL.fgp <= 36 && LW && LW.fgp - LL.fgp >= 6) cands.push({ s: 58 + (40 - LL.fgp), slot: 'mr.why.def', c: { sb: 0, oppFg: Math.round(LL.fgp) } });
  const scW = (team[w] || {}).sc || 0, scL = (team[l] || {}).sc || 0;
  if (LW && LL && LW.oreb - LL.oreb >= 6 && scW - scL >= 6) cands.push({ s: 58 + (scW - scL) * 1.5, slot: 'mr.why.glass', c: { orb: spell(LW.oreb), sc: scW } });
  else if (LW && LL && LW.reb - LL.reb >= 12) cands.push({ s: 55 + (LW.reb - LL.reb), slot: 'mr.why.glass', c: { sc: 0, reb: LW.reb + '–' + LL.reb } });
  const pW = (team[w] || {}).paint || 0, pL = (team[l] || {}).paint || 0;
  if (pW - pL >= 14) cands.push({ s: 55 + (pW - pL), slot: 'mr.why.paint', c: { paint: pW + '–' + pL } });
  const hot = all('hotThree').find(f => f.side === w);
  if (hot && hot.data.m >= 10) cands.push({ s: 60 + hot.data.m, slot: 'mr.why.three', c: { T: C[w], hot: true, m: spell(hot.data.m), a: hot.data.a } });
  if (LW && LL && LW.fta - LL.fta >= 10) cands.push({ s: 52 + (LW.fta - LL.fta), slot: 'mr.why.line', c: { fta: LW.fta, ftaL: LL.fta } });
  const fbW = (team[w] || {}).fast || 0, fbL = (team[l] || {}).fast || 0;
  if (fbW - fbL >= 10) cands.push({ s: 54 + (fbW - fbL), slot: 'mr.why.break', c: { fast: fbW + '–' + fbL } });
  const bW = (team[w] || {}).bench || 0, bL = (team[l] || {}).bench || 0;
  if (bW - bL >= 18) cands.push({ s: 52 + (bW - bL) / 2, slot: 'mr.why.bench', c: { bench: bW + '–' + bL } });
  if (LW && LW.fgm && LW.ast / LW.fgm >= 0.7 && LW.ast >= 18) cands.push({ s: 50 + LW.ast, slot: 'mr.why.share', c: { ast: LW.ast, fgm: LW.fgm } });
  cands.sort((a, b) => b.s - a.s).filter((x, i) => i < 2 || (i === 2 && x.s >= 66)).forEach(x => { const s = say(x.slot, Object.assign({}, base, x.c)); if (s) why.push(s); });
  /* won ugly, or both cold */
  const cold = all('coldThree');
  const coldW = cold.find(f => f.side === w), coldL = cold.find(f => f.side === l);
  const poorW = all('poorLine').find(f => f.side === w);
  if (coldW && coldL && coldW.data.a >= 15 && coldL.data.a >= 15) {
    const s = say('mr.why.bothCold', Object.assign({}, base, { m: spell(coldW.data.m), a: coldW.data.a, m2: spell(coldL.data.m), a2: coldL.data.a }));
    if (s) why.push(s);
    if (poorW && poorW.data.a - poorW.data.m >= 7) {
      const s2 = say('mr.why.ugly', Object.assign({}, base, { ft: true, three: false, ftm: spell(poorW.data.m), fta: poorW.data.a, missWords: spell(poorW.data.a - poorW.data.m) }));
      if (s2) why.push(s2);
    }
  } else if (coldW || (poorW && poorW.data.a - poorW.data.m >= 7)) {
    const s = say('mr.why.ugly', Object.assign({}, base, { three: !!(coldW && coldW.data.a >= 15), ft: !!(poorW && poorW.data.a - poorW.data.m >= 7),
      m: coldW ? spell(coldW.data.m) : '', a: coldW ? coldW.data.a : '', ftm: poorW ? spell(poorW.data.m) : '', fta: poorW ? poorW.data.a : '',
      missWords: poorW ? spell(poorW.data.a - poorW.data.m) : '' }));
    if (s) why.push(s);
  }
  const hasLedger = fs.some(f => f.kind === 'ledger' && f.data.winner != null);
  if (why.length) paras.push({ beat: 'why', text: why.join(' '), card: hasLedger ? 'ledger' : 'pointsAdded' });

  /* ======================================================================= stars */
  W.paragraph();
  const stars = [];
  const wp = players(w);
  const lead = td && td.side === w ? byName(td.data.p.name) : wp[0];
  if (lead && (lead.pts || 0) >= 8) {
    const ln = line(lead);
    const career = all('careerNight').find(f => f.side === w && f.data.p && tc(f.data.p.name) === tc(lead.name));
    const above = all('aboveSelf').find(f => f.side === w && f.data.p && tc(f.data.p.name) === tc(lead.name));
    const told = spent.has('star:' + lead.id);
    const extraLine = line(lead).replace(/^\d+ points(, | and )?/, '');
    const s1 = told ? (extraLine ? say('mr.star.again', Object.assign({}, base, { P: P(lead), T: C[w], rest: extraLine })) : '')
      : say('mr.star', Object.assign({}, base, { P: P(lead), T: C[w], line: ln, td: !!(td && td.side === w), big: (lead.pts || 0) >= 20,
          best: (lead.pts || 0) >= Math.max.apply(null, (g.players || []).map(p => p.pts || 0)) }));
    if (s1) stars.push(s1);
    spent.add('star:' + lead.id);
    const named = !s1;
    const [fm, fa] = fgOf(lead);
    if (pron && career) { const s = say('mr.star.career', Object.assign({}, base, pron, { career: true })); if (s) stars.push(s); }
    else if (pron && above && above.data.avg) { const s = say('mr.star.career', Object.assign({}, base, pron, { above: true, avg: Math.round(above.data.avg) })); if (s) stars.push(s); }
    else if ((pron || named) && fa >= 10 && fm / fa >= 0.6) { const s = say('mr.star.shooting', Object.assign({}, base, pron || {}, { fgm: fm, fgmWords: spell(fm), fga: fa, named, P: P(lead) })); if (s) stars.push(s); }
    /* the second scorer, when there was one worth a line */
    const second = wp.find(p => p !== lead && (p.pts || 0) >= 12);
    if (second) { const s = say('mr.second', Object.assign({}, base, { P: P(second), T: C[w], ppts: second.pts + ' points', bench: !isStarter(second), first: !stars.length })); if (s) stars.push(s); spent.add('star:' + second.id); }
    /* a third scorer, when the game had one worth naming */
    const third = wp.find(p => p !== lead && p !== second && (p.pts || 0) >= 15);
    if (third) { const s = say('mr.second', Object.assign({}, base, { P: P(third), T: C[w], ppts: third.pts + ' points', bench: !isStarter(third), first: false })); if (s) stars.push(s); }
    /* the specialist: blocks, boards, steals, the playmaker */
    const used = new Set([lead.id, second && second.id]);
    const spec = [];
    wp.forEach(p => {
      if ((p.blk || 0) >= 4) spec.push({ s: 70 + p.blk, k: 'blocks', p, n: p.blk });
      if (reb(p) >= 12 && p !== lead) spec.push({ s: 60 + reb(p), k: 'boards', p, n: reb(p) });
      if ((p.stl || 0) >= 5) spec.push({ s: 66 + p.stl, k: 'steals', p, n: p.stl });
      if ((p.ast || 0) >= 8 && p !== lead) spec.push({ s: 62 + p.ast, k: 'assists', p, n: p.ast });
    });
    const hub = all('passingHub').find(f => f.side === w || (f.data && wp.some(p => tc(p.name) === tc(f.data.name))));
    if (hub && hub.data.count >= 5) spec.push({ s: 64 + hub.data.count, k: 'hub', p: byName(hub.data.name), n: spell(hub.data.count), total: hub.data.total });
    spec.sort((a, b) => b.s - a.s);
    const sp = spec.find(x => !used.has(x.p.id) && !(x.k === 'hub' && tc(x.p.name) === tc(lead.name))) || null;
    if (sp) {
      const s = say('mr.spec', Object.assign({}, base, { k: sp.k, P: P(sp.p), T: C[w], n: typeof sp.n === 'number' ? spell(sp.n) : sp.n, total: sp.total }));
      if (s) stars.push(s);
    }
  }
  if (stars.length) paras.push({ beat: 'stars', text: stars.join(' '), card: 'players' });

  /* ====================================================================== losers */
  W.paragraph();
  const lose = [];
  const lp = players(l);
  const lbest = lp[0];
  if (lbest && (lbest.pts || 0) >= 8) {
    const dd = (reb(lbest) >= 10 || (lbest.ast || 0) >= 8) && (lbest.pts || 0) >= 10;
    const s = say('mr.lose.best', Object.assign({}, base, pron || {}, { P: P(lbest), T: C[l], line: line(lbest), ppts: lbest.pts + ' points', dd, he2: pron ? pron.he : 'they' }));
    if (s) lose.push(s);
    const ddL = lp.find(p => p !== lbest && (p.pts || 0) >= 10 && (reb(p) >= 10 || (p.ast || 0) >= 8));
    if (ddL) { const s1 = say('mr.lose.best', Object.assign({}, base, pron || {}, { P: P(ddL), T: C[l], line: line(ddL), ppts: ddL.pts + ' points', dd: true, he2: pron ? pron.he : 'they', also: true })); if (s1) lose.push(s1); }
    const coldP = lp.filter(p => p !== lbest && p !== ddL).map(p => ({ p, f: fgOf(p) })).filter(x => x.f[1] >= 10 && x.f[0] / x.f[1] <= 0.3).slice(0, 2);
    if (coldP.length) {
      const sh = x => x.f[0] + ' of ' + x.f[1];
      const s2 = say('mr.lose.cold', Object.assign({}, base, { T: C[l], P: P(coldP[0].p), Q: coldP[1] ? P(coldP[1].p) : null, two: coldP.length === 2, s1: sh(coldP[0]), s2: coldP[1] ? sh(coldP[1]) : '' }));
      if (s2) lose.push(s2);
    }
    const fo = all('fouledOut').filter(f => f.side === l && f.data.p).map(f => byName(f.data.p.name));
    if (fo.length && lose.length < 3) { const s3 = say('mr.lose.fouls', Object.assign({}, base, { T: C[l], P: P(fo[0]), Q: fo[1] ? P(fo[1]) : null, two: fo.length >= 2 })); if (s3) lose.push(s3); }
    if (lose.length < 3 && scL >= 12) { const s4 = say('mr.lose.sc', Object.assign({}, base, { T: C[l], sc: scL })); if (s4) lose.push(s4); }
  }
  if (lose.length === 1 && paras.length && paras[paras.length - 1].beat === 'stars') paras[paras.length - 1].text += ' ' + lose[0];
  else if (lose.length) paras.push({ beat: 'losers', text: lose.join(' '), card: null });

  /* ===================================================================== the five */
  const best = all('lineupBest').find(f => f.side === w);
  if (best && best.data.pm >= 9 && best.data.dur >= 360000) {
    W.paragraph();
    const surnames = (best.data.ids || []).map(id => (g.byId || {})[id]).filter(Boolean).map(p => P(p).short);
    if (surnames.length === 5) {
      const s = say('mr.five', Object.assign({}, base, { T: C[w], five: surnames.slice(0, -1).join(', ') + ' and ' + surnames[4], pm: best.data.pm, dur: minsWord(best.data.dur) }));
      if (s) paras.push({ beat: 'five', text: s, card: 'lineups' });
    }
  }

  /* ===================================================================== preview */
  if (typeof kit.preview === 'function') {
    let pv = null;
    try { pv = kit.preview(); } catch (_) { pv = null; }
    if (pv) { W.paragraph(); const t = W.line(pv); if (t) paras.push({ beat: 'preview', text: t, card: null }); }
  }

  /* ======================================================================== next */
  W.paragraph();
  const nextS = [];
  const st = one('standing');
  if (st && st.data.ranks && st.data.ranks[w] != null && st.data.ranks[l] != null && st.data.rec && !spent.has('ctx:climbed') && !spent.has('ctx:stayTop') && !spent.has('ctx:wentTop')) {
    const d = st.data, rec = t => d.rec[t][0] + '–' + d.rec[t][1];
    const s = say('mr.table', Object.assign({}, base, { rankW: nth(d.ranks[w]), rankL: nth(d.ranks[l]), recW: rec(w), recL: rec(l) }));
    if (s) nextS.push(s);
  }
  const nx = one('nextUp');
  if (nx && nx.data && Array.isArray(nx.data.next)) {
    const N = nx.data.next, tz = g.meta && g.meta.timezone;
    const day = n => (n && n.at && kit.dayWords ? kit.dayWords(n.at, tz) : null);
    const what = n => (n.home ? 'host ' + tc(n.oppName) : 'go to ' + tc(n.oppName));
    const nW = N[w] && N[w].oppName && day(N[w]) ? N[w] : null, nL = N[l] && N[l].oppName && day(N[l]) ? N[l] : null;
    let s = '';
    if (N[0] && N[1] && N[0].rematch && N[0].id === N[1].id && day(N[0])) s = say('mr.next', Object.assign({}, base, { again: true, day: day(N[0]) }));
    else if (nW && nL) s = say('mr.next', Object.assign({}, base, { both: true, sameDay: day(nW) === day(nL), day: day(nW), dayW: day(nW), dayL: day(nL), nextW: what(nW), nextL: what(nL) }));
    else if (nW || nL) { const n = nW || nL, t = nW ? w : l; s = say('mr.next', Object.assign({}, base, { one: true, T: C[t], nextT: what(n), dayT: day(n) })); }
    if (s) nextS.push(s);
  }
  if (nextS.length) paras.push({ beat: 'next', text: nextS.join(' '), card: 'next' });

  /* ==================================================================== headline */
  const headline = headlineOf(g, fs, { V, C, w, l, score, margin, ctxL, shorts, names, P, tc, starW, winnersRun, reg });
  const standfirst = stand.filter(Boolean).join(' ');
  const angled = !!(ctxL.moment || ctxL.ot || ctxL.comeback || ctxL.stolen || ctxL.firstWin || ctxL.firstDefeat || ctxL.streakEnded || ctxL.upset ||
    ctxL.wentTop || ctxL.skidEnded || ctxL.streak || ctxL.unbeaten || ctxL.slipped);
  return { headline, standfirst, paras: paras.filter(p => p.text && p.text.trim()), log: W.log(), shorts, angled, runDecisive: !!(runF && decisive(runF)) };
}

/* THE HEADLINE: present tense, the club names in full, the score where it reads, the angle the lede chose */
function headlineOf(g, fs, x) {
  const { C, w, l, score, ctxL, starW, winnersRun, reg } = x;
  const Wn = C[w].name, Ln = C[l].name;
  const pickH = (seed, opts) => { let h = 2166136261; const t = String(seed); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return opts[h % opts.length]; };
  const seed = 'h' + g.names.join('') + g.score.join('');
  if (ctxL.moment && ctxL.P) return pickH(seed, [ctxL.P.name + ' wins it late for ' + Wn + ' against ' + Ln, ctxL.P.name + ' settles it at the death as ' + Wn + ' beat ' + Ln]);
  if (ctxL.ot) return Wn + ' outlast ' + Ln + ' in overtime, ' + score;
  if (ctxL.comeback) return Wn + ' come from ' + ctxL.deficit + ' down to beat ' + Ln;
  if (ctxL.stolen) return Wn + ' steal it late against ' + Ln;
  if (ctxL.firstWin) return pickH(seed, [Wn + ' off the mark at last with ' + score + ' win over ' + Ln, 'First win of the season for ' + Wn + ', ' + score + ' over ' + Ln]);
  if (ctxL.firstDefeat) return Wn + ' hand ' + Ln + ' their first defeat';
  if (ctxL.streakEnded) return Wn + ' end ' + Ln + '’s winning run';
  if (ctxL.upset) return Wn + ' stun ' + Ln + ' ' + score;
  if (ctxL.wentTop) return Wn + ' go top with ' + score + ' win over ' + Ln;
  if (ctxL.skidEnded) return Wn + ' end losing run against ' + Ln;
  if (ctxL.streak) return Wn + ' make it ' + ctxL.n + ' in a row against ' + Ln;
  if (ctxL.unbeaten) return Wn + ' stay perfect with ' + score + ' win over ' + Ln;
  if (ctxL.starLede) return ctxL.P.name + ' scores ' + ctxL.ppts.replace(' points', '') + ' as ' + Wn + ' beat ' + Ln;
  if (ctxL.rout) return Wn + ' overwhelm ' + Ln + ' ' + score;
  if (ctxL.tight) return Wn + ' edge ' + Ln + ' ' + score;
  if (winnersRun && winnersRun.data.n >= 16) return Wn + ' pull clear of ' + Ln + ' with ' + winnersRun.data.n + '–0 run';
  if (starW && (starW.pts || 0) >= 25) return starW.name ? x.tc(starW.name) + '’s ' + starW.pts + ' leads ' + Wn + ' past ' + Ln : Wn + ' beat ' + Ln + ' ' + score;
  return Wn + ' beat ' + Ln + ' ' + score;
}


return { write, clubShort, clubShorts, genderOf, whenIn, BANK };
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaMatchWriter;
export const { write, clubShort, clubShorts, genderOf, whenIn, BANK } = __api;
export default __api;
