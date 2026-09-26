'use strict';
/* ============================================================================
   THE LANGUAGE MODEL OF THE MATCH REPORT: the rules of the English it is written in.

   The report engine decides what is true (story.js) and how it is shaped (report.js). Neither knows English: each
   sentence was a template, and every grammatical fact a template needed (a or an, plural or singular, whose
   apostrophe, is or are, which spelling of a number) was spelled out again, by hand, where it was used. That is how
   a report came to say "the winners's favour", "a 8-0 run", "the whistle paid they" and "1 points": each template
   was right for the case its author had in mind and wrong for the next.

   This module holds those rules ONCE, as functions and as data, and does two jobs with them:

     BUILD     small functions a template asks instead of guessing: an(), count(), possessive(), be(), list(),
               spell(), ordinalWord(), fewer() ...
     CHECK     polish() repairs, and lint() reports, what a finished paragraph got wrong anyway: doubled words and
               spaces, space before a comma, a or an against the sound of the next word, "Flyers's", "1 points",
               a sentence that starts lower case, an apostrophe that is straight where the rest are curly.

   It is a RULE MODEL, not a statistical one: every rule is a fact about English that can be written down, tested with
   its exceptions, and explained. The rules it carries, and where English breaks them:

     ARTICLES      a/an follow the SOUND of the next word, not its letter: an hour, an honest man, a university, a
                   one-point game; and of a numeral, its spoken form: an 8-0 run, an 11-point lead, an 80-point night,
                   a 110-point night, a 1-0 start, an NBA side, a FIBA game.
     PLURALS       -s, -es after a sibilant, -y to -ies after a consonant, and the few irregulars a game needs (man,
                   woman, person, foot, half, leaf). Mass nouns (time, pace) take no plural. One takes the singular,
                   zero and fractions the plural: 1 point, 0 points, 1.5 points.
     POSSESSIVES   a name or plural ending in s takes the bare apostrophe (Flyers', the winners', James'); anything else
                   takes 's. A team is written in the plural throughout (Newcastle were, Bristol have), the British
                   convention, so "Hyeres-Toulon were" and never "was".
     AGREEMENT     be/have/do and every regular verb agree with a plural or singular subject in the past and the
                   present; the irregular verbs a sports report uses (win, lose, hit, take, give, make, shoot, ...) are
                   tabled, not guessed.
     LISTS         two items joined by "and", three or more by commas and a last "and", no comma before it (the house
                   style); an item that has its own comma makes the separator a semicolon.
     NUMBERS       zero to twelve are words in running prose ("no", one ... twelve), the rest digits; ordinals are words
                   to twelfth and 13th after; a score is 94-68 with an en dash; a clock is 6:33; a percentage is 55.7%.
     COMPARISON    fewer for what is counted (turnovers, fouls), less for what is measured (time, space), more for both.
     CAPITALS      a sentence starts with a capital; a name keeps the capitals it has; a name shouted in capitals is set
                   as a name ("FUERZA REGIA" is "Fuerza Regia"), keeping its particles small and its abbreviations
                   ("BC", "FC") and suffixes ("Jr") as they should be.
     PUNCTUATION   no space before , . ; : ! ? and one after; one space between words; curly apostrophes throughout.

   Nothing here knows about basketball, so the report can use it for any sentence, and the tests can hold each rule
   to its exceptions (supabase/tests/language.test.mjs).
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLanguage = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const APOS = '’';

/* ------------------------------------------------------------------ numbers --- */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const CARD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const ORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];

/* zero to twelve as the words running prose uses ("no assists", "nine of seventeen"); a bigger figure stays digits,
   because a score or a percentage spelled out is worse than the problem it solves */
function spell(n) {
  const v = Math.round(Number(n));
  return (isFinite(v) && v >= 0 && v <= 12) ? WORDS[v] : String(isFinite(v) ? v : n);
}
/* SEVERAL FIGURES IN ONE SENTENCE ARE WRITTEN ONE WAY: all in words when every one is twelve or under ("eight of twelve"), all in
   digits when any is bigger ("8 of 28" beside "18 of 37"), never "18 of 37, against eight of 28" */
function spellSet(ns) {
  const xs = (ns || []).map(n => Math.round(Number(n)));
  const allSmall = xs.every(v => isFinite(v) && v >= 0 && v <= 12);
  return xs.map(v => (allSmall ? WORDS[v] : String(v)));
}
/* a whole number in words, up to 99 ("twenty-one"): for the few places prose wants one that large */
function spellFull(n) {
  const v = Math.round(Number(n));
  if (!(v >= 0 && v <= 99)) return String(n);
  if (v < 20) return CARD[v];
  const t = Math.floor(v / 10), u = v % 10;
  return TENS[t] + (u ? '-' + CARD[u] : '');
}
/* first ... twelfth, then 13th, 21st, 32nd: a word where a word reads naturally, a numeral after */
function ordinalWord(n) {
  const v = Math.round(Number(n));
  if (v >= 1 && v <= 12) return ORD[v];
  return ordinalNum(v);
}
function ordinalNum(n) {
  const v = Math.round(Number(n)), t = v % 100;
  if (t >= 11 && t <= 13) return v + 'th';
  return v + (['th', 'st', 'nd', 'rd'][v % 10] || 'th');
}
/* a period as a person says it: the fourth, then the first overtime, the second overtime */
function periodName(p, regulation) {
  const reg = regulation || 4;
  return p <= reg ? ordinalWord(p) : ordinalWord(p - reg) + ' overtime';
}
const numeral = n => {
  const v = Number(n);
  if (!isFinite(v)) return String(n);
  return Math.abs(v) >= 10000 ? String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : String(v);
};
const signed = (n, dec) => {
  const v = Number(n), d = dec == null ? 0 : dec;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
};
const pct = (n, dec) => (isFinite(Number(n)) ? Number(n).toFixed(dec == null ? 1 : dec) + '%' : '—');
const score = (a, b) => a + '–' + b;
const clock = ms => Math.floor((ms || 0) / 60000) + ':' + String(Math.floor(((ms || 0) % 60000) / 1000)).padStart(2, '0');
/* a stretch of the game as a person says how long it was: "just over four minutes", "nearly nine", "twelve minutes" */
function approxMinutes(ms) {
  const m = (ms || 0) / 60000;
  if (m < 1) return 'under a minute';
  const whole = Math.floor(m), frac = m - whole;
  const w = spell(whole) + ' minute' + (whole === 1 ? '' : 's');
  if (frac < 0.15) return w;
  if (frac > 0.8) return 'nearly ' + spell(whole + 1) + ' minute' + (whole + 1 === 1 ? '' : 's');
  if (frac < 0.4) return 'just over ' + w;
  return 'more than ' + w;
}

/* ----------------------------------------------------------------- articles --- */
const A_EXCEPT_AN = /^(hour|honest|honou?r|heir|herb)/i;                      // silent h
const A_EXCEPT_A = /^(uni([^n]|$)|use|usu|uti|eu|one|once|ubiq|ural|uran|ut[ae]|ewe)/i;   // a "y" or "w" sound
const SPOKEN_AS_WORDS = new Set(['FIBA', 'ELITE', 'LNBP', 'BBL', 'BCB', 'NBL', 'BNXT', 'EYBL']);   // said as a word
const LETTER_AN = /^[AEFHILMNORSX]/;                                           // letter names starting with a vowel sound
/* the spoken form of a numeral: 8, 11, 18 and everything eighty-something, eight hundred ... start on a vowel */
function numeralTakesAn(tok) {
  const digits = String(tok).replace(/,/g, '').match(/^\d+/);
  if (!digits) return false;
  const s = digits[0], n = Number(s);
  if (s.charAt(0) === '8') return true;                                        // eight, eighty, eight hundred, eight thousand
  if (n === 11 || n === 18) return true;
  if (s.length === 5 || s.length === 8) return /^(11|18)/.test(s);            // eleven / eighteen thousand (or million)
  return false;
}
/* "a" or "an" for the word that follows it */
function an(word) {
  const w = String(word == null ? '' : word).replace(/^[^A-Za-z0-9]+/, '');
  if (!w) return 'a';
  if (/^\d/.test(w)) return numeralTakesAn(w) ? 'an' : 'a';
  const first = w.split(/[\s-]/)[0];
  if (/^[A-Z]{2,5}$/.test(first) && !SPOKEN_AS_WORDS.has(first)) return LETTER_AN.test(first) ? 'an' : 'a';
  if (A_EXCEPT_AN.test(w)) return 'an';
  if (A_EXCEPT_A.test(w)) return 'a';
  return /^[aeiou]/i.test(w) ? 'an' : 'a';
}
/* "an 8-0 run": the article with its word */
const withArticle = word => an(word) + ' ' + word;

/* ------------------------------------------------------------------ plurals --- */
const IRREGULAR = { man: 'men', woman: 'women', person: 'people', foot: 'feet', half: 'halves', leaf: 'leaves', shelf: 'shelves',
  wife: 'wives', life: 'lives', child: 'children', tooth: 'teeth', goose: 'geese', mouse: 'mice' };
const MASS = new Set(['pace', 'time', 'defence', 'defense', 'offence', 'offense', 'basketball', 'space', 'rhythm', 'momentum', 'scoring', 'shooting']);
function plural(noun) {
  const n = String(noun);
  const lower = n.toLowerCase();
  if (MASS.has(lower)) return n;
  const last = lower.split(' ').pop();
  if (IRREGULAR[last]) return n.slice(0, n.length - last.length) + IRREGULAR[last];
  if (/(s|x|z|ch|sh)$/.test(lower)) return n + 'es';
  if (/[^aeiou]y$/.test(lower)) return n.slice(0, -1) + 'ies';
  return n + 's';
}
/* 1 point, 0 points, 1.5 points, "one point"/"no points" when the caller wants words */
function count(n, noun, opts) {
  const o = opts || {};
  const v = Number(n);
  const one = v === 1;
  const head = o.words ? spell(v) : (o.numeral === false ? '' : numeral(v));
  const body = one ? noun : (o.plural || plural(noun));
  return (head ? head + ' ' : '') + body;
}
/* fewer for what is counted, less for what is measured */
const UNCOUNTED = new Set(['time', 'space', 'pace', 'rhythm', 'ground', 'help', 'room', 'energy', 'luck', 'defence', 'defense', 'pressure', 'possession']);
const fewer = noun => (UNCOUNTED.has(String(noun).toLowerCase()) ? 'less' : 'fewer');

/* -------------------------------------------------------------- possessives --- */
/* the possessive of a name, a role or a plural: "Flyers'", "James'", "the winners'", "Jordan's". Any tags around the
   name (a wrapper the report puts on it) are kept and the apostrophe goes after the visible word */
function possessive(name) {
  const s = String(name);
  const plain = s.replace(/<[^>]*>/g, '').replace(/&[a-z#0-9]+;/gi, 'x');
  if (/[’']s?$/.test(plain) && /[’']$/.test(plain)) return s;        // already possessive
  return s + (/s$/i.test(plain) ? APOS : APOS + 's');
}
const POSSESSIVE_PRONOUN = { they: 'their', it: 'its', he: 'his', she: 'her', we: 'our', you: 'your', i: 'my' };

/* -------------------------------------------------------------------- verbs --- */
/* A TEAM IS PLURAL in this report, whatever it is called: Newcastle Eagles were, Hyeres-Toulon have. The one
   exception is the referring expressions that are singular in form (a player, "it", "nobody"). */
const SINGULAR_SUBJECTS = /^(he|she|it|nobody|no one|everyone|everybody|each|either|neither|the game|the match|the night|the run|the spell|the lead)$/i;
function isPlural(subject) {
  const s = String(subject == null ? '' : subject).replace(/<[^>]*>/g, '').trim();
  if (/^(they|we|you|the winners|the losers|the hosts|the visitors|both sides|both teams)$/i.test(s)) return true;
  if (SINGULAR_SUBJECTS.test(s)) return false;
  return true;
}
const IRREG_VERBS = {
  be: { past: ['was', 'were'], pres: ['is', 'are'], part: 'been', ing: 'being' },
  have: { past: ['had', 'had'], pres: ['has', 'have'], part: 'had', ing: 'having' },
  do: { past: ['did', 'did'], pres: ['does', 'do'], part: 'done', ing: 'doing' },
  go: { past: ['went', 'went'], pres: ['goes', 'go'], part: 'gone', ing: 'going' },
  make: { past: ['made', 'made'], pres: ['makes', 'make'], part: 'made', ing: 'making' },
  take: { past: ['took', 'took'], pres: ['takes', 'take'], part: 'taken', ing: 'taking' },
  get: { past: ['got', 'got'], pres: ['gets', 'get'], part: 'got', ing: 'getting' },
  give: { past: ['gave', 'gave'], pres: ['gives', 'give'], part: 'given', ing: 'giving' },
  win: { past: ['won', 'won'], pres: ['wins', 'win'], part: 'won', ing: 'winning' },
  lose: { past: ['lost', 'lost'], pres: ['loses', 'lose'], part: 'lost', ing: 'losing' },
  lead: { past: ['led', 'led'], pres: ['leads', 'lead'], part: 'led', ing: 'leading' },
  hit: { past: ['hit', 'hit'], pres: ['hits', 'hit'], part: 'hit', ing: 'hitting' },
  shoot: { past: ['shot', 'shot'], pres: ['shoots', 'shoot'], part: 'shot', ing: 'shooting' },
  run: { past: ['ran', 'ran'], pres: ['runs', 'run'], part: 'run', ing: 'running' },
  keep: { past: ['kept', 'kept'], pres: ['keeps', 'keep'], part: 'kept', ing: 'keeping' },
  put: { past: ['put', 'put'], pres: ['puts', 'put'], part: 'put', ing: 'putting' },
  set: { past: ['set', 'set'], pres: ['sets', 'set'], part: 'set', ing: 'setting' },
  come: { past: ['came', 'came'], pres: ['comes', 'come'], part: 'come', ing: 'coming' },
  see: { past: ['saw', 'saw'], pres: ['sees', 'see'], part: 'seen', ing: 'seeing' },
  find: { past: ['found', 'found'], pres: ['finds', 'find'], part: 'found', ing: 'finding' },
  hold: { past: ['held', 'held'], pres: ['holds', 'hold'], part: 'held', ing: 'holding' },
  build: { past: ['built', 'built'], pres: ['builds', 'build'], part: 'built', ing: 'building' },
  cut: { past: ['cut', 'cut'], pres: ['cuts', 'cut'], part: 'cut', ing: 'cutting' },
  draw: { past: ['drew', 'drew'], pres: ['draws', 'draw'], part: 'drawn', ing: 'drawing' },
  beat: { past: ['beat', 'beat'], pres: ['beats', 'beat'], part: 'beaten', ing: 'beating' },
  send: { past: ['sent', 'sent'], pres: ['sends', 'send'], part: 'sent', ing: 'sending' },
  pull: { past: ['pulled', 'pulled'], pres: ['pulls', 'pull'], part: 'pulled', ing: 'pulling' },
  throw: { past: ['threw', 'threw'], pres: ['throws', 'throw'], part: 'thrown', ing: 'throwing' },
  drive: { past: ['drove', 'drove'], pres: ['drives', 'drive'], part: 'driven', ing: 'driving' },
  spend: { past: ['spent', 'spent'], pres: ['spends', 'spend'], part: 'spent', ing: 'spending' },
  fall: { past: ['fell', 'fell'], pres: ['falls', 'fall'], part: 'fallen', ing: 'falling' },
  rise: { past: ['rose', 'rose'], pres: ['rises', 'rise'], part: 'risen', ing: 'rising' },
  begin: { past: ['began', 'began'], pres: ['begins', 'begin'], part: 'begun', ing: 'beginning' },
  bring: { past: ['brought', 'brought'], pres: ['brings', 'bring'], part: 'brought', ing: 'bringing' },
  leave: { past: ['left', 'left'], pres: ['leaves', 'leave'], part: 'left', ing: 'leaving' },
  meet: { past: ['met', 'met'], pres: ['meets', 'meet'], part: 'met', ing: 'meeting' },
  pay: { past: ['paid', 'paid'], pres: ['pays', 'pay'], part: 'paid', ing: 'paying' },
  sit: { past: ['sat', 'sat'], pres: ['sits', 'sit'], part: 'sat', ing: 'sitting' },
  stand: { past: ['stood', 'stood'], pres: ['stands', 'stand'], part: 'stood', ing: 'standing' },
  tie: { past: ['tied', 'tied'], pres: ['ties', 'tie'], part: 'tied', ing: 'tying' },
  grab: { past: ['grabbed', 'grabbed'], pres: ['grabs', 'grab'], part: 'grabbed', ing: 'grabbing' }
};
const DOUBLE_FINAL = new Set(['stop', 'drop', 'trim', 'plan', 'slip', 'step', 'chop', 'clap', 'flip', 'grip', 'pop', 'rip', 'skip', 'tap', 'top', 'wrap', 'jam', 'rob', 'nod', 'log', 'hug', 'dip']);
function regular(base, form) {
  const b = String(base).toLowerCase();
  if (form === 's') {
    if (/(s|x|z|ch|sh|o)$/.test(b)) return b + 'es';
    if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ies';
    return b + 's';
  }
  if (form === 'ed') {
    if (/e$/.test(b)) return b + 'd';
    if (/[^aeiou]y$/.test(b)) return b.slice(0, -1) + 'ied';
    if (DOUBLE_FINAL.has(b)) return b + b.slice(-1) + 'ed';
    return b + 'ed';
  }
  if (form === 'ing') {
    if (/ie$/.test(b)) return b.slice(0, -2) + 'ying';
    if (/[^aeiou]e$/.test(b) && !/ee$/.test(b)) return b.slice(0, -1) + 'ing';
    if (DOUBLE_FINAL.has(b)) return b + b.slice(-1) + 'ing';
    return b + 'ing';
  }
  return b;
}
/* verb('score', { plural: true, tense: 'past' }) -> 'scored'; tense: 'past' | 'present' | 'perfect' | 'participle' | 'ing' */
function verb(base, opts) {
  const o = opts || {}, tense = o.tense || 'past', pl = o.plural !== false;
  const b = String(base).toLowerCase(), irr = IRREG_VERBS[b];
  if (tense === 'ing') return irr ? irr.ing : regular(b, 'ing');
  if (tense === 'participle') return irr ? irr.part : regular(b, 'ed');
  if (tense === 'perfect') return (pl ? 'have ' : 'has ') + (irr ? irr.part : regular(b, 'ed'));
  if (tense === 'past') return irr ? irr.past[pl ? 1 : 0] : regular(b, 'ed');
  return irr ? irr.pres[pl ? 1 : 0] : (pl ? b : regular(b, 's'));
}
const be = (pl, tense) => verb('be', { plural: pl, tense: tense === 'present' ? 'present' : 'past' });

/* ------------------------------------------------------------------- lists --- */
/* "A, B and C": no comma before the last "and" (the house style); an item with a comma of its own makes the separator a
   semicolon, so "A, then B; C and D" is never read as four items */
function list(items, opts) {
  const o = opts || {};
  const xs = (items || []).filter(x => x != null && String(x) !== '');
  const conj = o.conj || 'and';
  if (xs.length === 0) return '';
  if (xs.length === 1) return String(xs[0]);
  if (xs.length === 2) return xs[0] + ' ' + conj + ' ' + xs[1];
  const inner = xs.some(x => /,/.test(String(x).replace(/<[^>]*>/g, '')));
  const sep = inner ? '; ' : ', ';
  return xs.slice(0, -1).join(sep) + (inner ? '; ' + conj + ' ' : ' ' + conj + ' ') + xs[xs.length - 1];
}

/* ----------------------------------------------------------------- capitals --- */
/* a name shouted in capitals is set as a name; see the note at the top of this file */
const PARTICLES = new Set(['de', 'del', 'della', 'di', 'da', 'do', 'dos', 'das', 'la', 'las', 'le', 'les', 'lo', 'los', 'el', 'en',
  'y', 'e', 'of', 'the', 'and', 'van', 'von', 'der', 'den', 'du', 'des', 'al', 'dei']);
const SMALL_WORDS = new Set(['san', 'sao', 'sur', 'mar', 'new', 'old', 'red', 'top', 'sun', 'sky', 'zoo', 'day', 'bay', 'fox', 'cat', 'ant']);
function unshout(str) {
  const s = String(str);
  const letters = s.replace(/[^A-Za-zÀ-ɏ]/g, '');
  if (letters.length < 4 || s !== s.toUpperCase() || s === s.toLowerCase()) return s;
  return s.split(' ').map((w, i) => {
    if (!w) return w;
    const lw = w.toLowerCase();
    if (i > 0 && PARTICLES.has(lw)) return lw;
    if (lw === 'jr' || lw === 'sr') return w.charAt(0) + lw.charAt(1);
    if (w.length <= 3 && /^[A-Z.]+$/.test(w) && !SMALL_WORDS.has(lw) && !PARTICLES.has(lw)) return w;
    return w.charAt(0) + w.slice(1).toLowerCase();
  }).join(' ');
}
/* inside a word: McCormack, King-Danchie, O'Garro (a letter after a hyphen or an apostrophe is raised only when the
   part before it is short, so "Wasn't" in a club name stays) */
function capParts(w) {
  let out = w.replace(/^Mc([a-z])/, (m, c) => 'Mc' + c.toUpperCase());
  out = out.split('-').map(p => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join('-');
  return out.replace(/^([A-Z])(['’])([a-z])/, (m, a, q, c) => a + q + c.toUpperCase());
}
/* the scorer stores names lower case, feeds send them in every case there is; a name in a sentence is written the way a
   person would write it. No escapes in this function's own source (see report.js on the day one went missing). */
function titleCase(str) {
  const flat = String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
  const un = unshout(flat), shouted = un !== flat;
  return un.split(' ')
    .map((w, i) => !w ? w
      : shouted && i > 0 && PARTICLES.has(w) ? w                       // "de", "del", "la" stay small in a name that was shouted
      : /^(ii|iii|iv|vi|vii|viii|ix|xi|xii)$/i.test(w) ? w.toUpperCase()
      : capParts(w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}
const capitalise = s => String(s).replace(/^(\s*(?:<[^>]*>)*)([a-zà-ÿ])/, (m, pre, c) => pre + c.toUpperCase());

/* ----------------------------------------------------------- repair and check --- */
const ABBREV = /(?:\b(?:Jr|Sr|St|Mr|Ms|Dr|vs|No|Mt|Ft)|\b[A-Z])\.$/;
const KEEP_DOUBLE = new Set(['had', 'that', 'is', 'do', 'can', 'very', 'so']);
const COUNTED = 'points?|rebounds?|assists?|steals?|blocks?|fouls?|turnovers?|possessions?|minutes?|seconds?|games?|times?|baskets?|threes?|misses|shots?|attempts?|quarters?|periods?|lead changes?|free throws?';
const SINGLE = { points: 'point', rebounds: 'rebound', assists: 'assist', steals: 'steal', blocks: 'block', fouls: 'foul', turnovers: 'turnover',
  possessions: 'possession', minutes: 'minute', seconds: 'second', games: 'game', times: 'time', baskets: 'basket', threes: 'three',
  shots: 'shot', attempts: 'attempt', quarters: 'quarter', periods: 'period', 'lead changes': 'lead change', 'free throws': 'free throw' };
const MULTI = {}; Object.keys(SINGLE).forEach(k => { MULTI[SINGLE[k]] = k; });

/* apply fn to the text between tags, so a wrapper the report puts on a name is never touched */
function inText(html, fn) {
  return String(html).split(/(<[^>]+>)/).map(seg => (seg.charAt(0) === '<' ? seg : fn(seg))).join('');
}

/* ============================================================================
   THE GRAMMAR: a register of the rules of formal written English, each with what it says, how serious a breach is, the
   repair when one is certain, and an example of the wrong and the right. It is what a careful university-level writer
   checks a paragraph against, in the order they would: SPELLING (misspellings, and American forms in a British report),
   WORD CHOICE (its/it's, their/there, then/than, of for have, fewer/less, number/amount, loose/lose, affect/effect),
   AGREEMENT (one of the ... was; there were two; a team is plural), COMPARISON (no "more better"), HYPHENATION (a compound
   before a noun: second-chance points, an 11-point lead), PUNCTUATION (dashes for ranges, curly quotes, an ellipsis, a percent
   sign that is not spaced off, a decade with no apostrophe, capitals for days and months), STYLE (wordiness, redundancy,
   clichés, contractions in a formal register, a sentence that starts with a numeral or a conjunction, a comma splice, a
   dangling modifier, an overworked passive, a list whose items are not parallel).

   Three levels: ERROR (wrong: -12 on the critic's scale), STYLE (weak: -5), HINT (worth a look: -2). A rule with a `fix` is
   repaired by polish() wherever it can be repaired without changing what a sentence claims; the rest is reported by lint()
   and pulls the score down so the reviser and the phrasing chooser steer away from it. Every rule carries its own examples,
   and the tests run each one both ways: the wrong form is found (and repaired, where there is a fix), the right one is not.
   ============================================================================ */
const matchCase = (orig, repl) => (/^[A-Z]/.test(orig) && repl ? repl.charAt(0).toUpperCase() + repl.slice(1) : repl);
const NUM_WORD = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)';
const COUNT_PL = 'times|days|turnovers|fouls|rebounds|assists|points|steals|blocks|possessions|shots|attempts|baskets|threes|misses|games|players|minutes|seconds|chances|free throws|lead changes';
const MASS_N = 'time|pressure|space|luck|defence|offence|energy|help|room|ground';
const MONTHS = 'january|february|april|june|july|august|september|october|november|december';
const DAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const MISSPELL = { seperate: 'separate', definately: 'definitely', occured: 'occurred', recieve: 'receive', recieved: 'received', untill: 'until',
  acheive: 'achieve', acheived: 'achieved', begining: 'beginning', beleive: 'believe', goverment: 'government', occassion: 'occasion',
  succesful: 'successful', neccessary: 'necessary', wich: 'which', teh: 'the', adn: 'and', thier: 'their', becuase: 'because',
  definitly: 'definitely', occurence: 'occurrence', existance: 'existence', independant: 'independent', persistant: 'persistent',
  comitted: 'committed', embarass: 'embarrass', accomodate: 'accommodate', publically: 'publicly', tounge: 'tongue', wierd: 'weird',
  rebouding: 'rebounding', defence_: 'defence', aggresive: 'aggressive', competitve: 'competitive', dissapointing: 'disappointing', sucess: 'success' };
const AMERICAN = [
  ['defense', 'defence'], ['defenses', 'defences'], ['defensive', 'defensive'], ['offense', 'offence'], ['offenses', 'offences'],
  ['center', 'centre'], ['centers', 'centres'], ['color', 'colour'], ['colors', 'colours'], ['favor', 'favour'], ['favors', 'favours'],
  ['favorite', 'favourite'], ['honor', 'honour'], ['honors', 'honours'], ['analyze', 'analyse'], ['analyzed', 'analysed'], ['realize', 'realise'],
  ['realized', 'realised'], ['organize', 'organise'], ['organized', 'organised'], ['recognize', 'recognise'], ['recognized', 'recognised'],
  ['emphasize', 'emphasise'], ['emphasized', 'emphasised'], ['minimize', 'minimise'], ['maximize', 'maximise'], ['gray', 'grey'],
  ['traveling', 'travelling'], ['traveled', 'travelled'], ['labeled', 'labelled'], ['canceled', 'cancelled'], ['fulfill', 'fulfil'],
  ['skeptical', 'sceptical'], ['judgment', 'judgement'], ['program', 'programme'], ['catalog', 'catalogue'], ['tire', 'tyre']
].filter(([a]) => a !== 'defensive' && a !== 'program' && a !== 'tire');           // "defensive" is the same word; "program" and "tire" have other senses
const AMERICAN_RE = new RegExp('\\b(' + AMERICAN.map(x => x[0]).join('|') + ')\\b', 'g');
const AMERICAN_TO = {}; AMERICAN.forEach(([a, b]) => { AMERICAN_TO[a] = b; });
const HYPHENS = [
  ['second chance', 'points|basket|baskets|shot|shots|opportunity|opportunities|scoring'], ['fast break', 'points|basket|baskets|chance|chances|scoring|offence'],
  ['half court', 'offence|defence|set|sets|game|basket|offense|possession|possessions'], ['full court', 'press|pressure|defence'],
  ['three point', 'shot|shots|attempt|attempts|line|shooting|percentage|range|play|specialist|shooter'], ['two point', 'shot|shots|attempt|attempts|game|lead|shooting'],
  ['one point', 'game|win|loss|lead|margin|victory|defeat'], ['late clock', 'shot|shots|possession|possessions|chance|chances|situation'],
  ['high scoring', 'game|quarter|half|affair|night'], ['low scoring', 'game|quarter|half|affair|night'], ['hard fought', 'game|win|victory|contest'],
  ['last minute', 'basket|shot|surge|charge|change'], ['long range', 'shot|shots|jumper|shooting|attempt'], ['off ball', 'movement|screen|defence|action'],
  ['open floor', 'play|running']
];
const HYPHEN_RES = HYPHENS.map(([a, b]) => [new RegExp('\\b(' + a + ') (' + b + ')\\b', 'gi'), a.replace(' ', '-')]);
const COMPOUND_NUM = new RegExp('\\b(' + NUM_WORD + ') (point|minute|second|game|possession|quarter|man|foot) (lead|run|game|stretch|spell|deficit|win|loss|victory|defeat|night|margin|burst|swing|advantage|cushion|halftime|streak|period|effort|performance|specialist)\\b', 'gi');

/* each rule: id, level, message, find (RegExp, global) or test(text) -> [{sample, index}], fix(match...) -> replacement, examples */
const GRAMMAR = [
  /* -------------------------------------------------------------- logic
     A sentence can be grammatical and impossible. These find what cannot be true whatever the game was: a part larger than its
     whole, a whole written as a fraction of itself, a hedge on an exact figure, a margin over nothing, two equal figures compared. */
  { id: 'all-of-all', logic: true, level: 'error', msg: 'a whole written as a share of itself ("40 of the 40"): "all 40"',
    find: new RegExp('\\b(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) of (?:the|their|his|her|its) \\1\\b', 'gi'), fix: (m, n) => 'all ' + n,
    bad: 'They led for 40 of the 40 minutes.', good: 'They led for all 40 minutes.' },
  { id: 'part-exceeds-whole', logic: true, level: 'error', msg: 'a part larger than its whole ("12 of 10")', test: 'partwhole', fix: null,
    bad: 'They made 12 of 10 free throws.', good: 'They made 10 of 12 free throws.' },
  { id: 'hedged-exact', logic: true, level: 'error', msg: 'a hedge on an exact figure ("almost ... all 40")',
    find: /\b(?:almost|nearly|virtually|practically)\b[^.!?]{0,70}\b(?:all \d+|every single|\d+ of the \d+ (?:minutes|games|shots)|100%)/gi, fix: null,
    bad: 'They led almost throughout: all 40 minutes.', good: 'They led for all 40 minutes.' },
  { id: 'equal-figures-compared', logic: true, level: 'error', msg: 'two equal figures put as a difference ("won the boards 40\u201340")',
    find: /\b(?:won|beat|outscored|outshot|outrebounded|edged|took)\b[^.!?]{0,50}\b(\d+(?:\.\d+)?)%?\u2013\1%?\b/gi, fix: null,
    bad: 'They won the boards 40\u201340.', good: 'They won the boards 41\u201340.' },
  { id: 'zero-of-zero', logic: true, level: 'error', msg: 'a share of nothing ("0 of 0")', find: /\b(?:0|no|zero) of (?:0|no|zero)\b/gi, fix: null,
    bad: 'They went 0 of 0 from three.', good: 'They took no threes.' },
  { id: 'impossible-percent', logic: true, level: 'error', msg: 'a share above 100%', find: /\b(?:1[0-9]{2}|[2-9][0-9]{2})(?:\.\d+)?% of\b/g, fix: null,
    bad: 'They took 140% of their shots from three.', good: 'They took 40% of their shots from three.' },
  { id: 'lead-by-nothing', logic: true, level: 'error', msg: 'a lead of nothing', find: /\bled by (?:no|zero|0)\b/gi, fix: null,
    bad: 'They led by 0.', good: 'They led by 4.' },
  { id: 'won-with-less', logic: true, level: 'error', msg: '"won" a comparison the figures say was lost or level ("won the boards 30\u201340")',
    find: /\b(?:won|took|owned|controlled) the (?:boards|paint|glass)\b[^.!?]{0,30}\b(\d+)\u2013(\d+)\b/gi, test: 'lowerwins', fix: null,
    bad: 'They won the boards 30\u201340.', good: 'They won the boards 40\u201330.' },
  /* ------------------------------------------------------------- spelling */
  { id: 'misspelling', level: 'error', msg: 'a misspelt word', find: new RegExp('\\b(' + Object.keys(MISSPELL).filter(k => !/_$/.test(k)).join('|') + ')\\b', 'gi'),
    fix: m => matchCase(m, MISSPELL[m.toLowerCase()]), bad: 'They recieve the ball.', good: 'They receive the ball.' },
  { id: 'american-spelling', level: 'style', msg: 'an American spelling in a British report', find: AMERICAN_RE,
    fix: m => AMERICAN_TO[m], bad: 'They played tough defense.', good: 'They played tough defence.' },
  /* ---------------------------------------------------------- word choice */
  { id: 'its-possessive', level: 'error', msg: '"it\u2019s" where the possessive "its" is meant', find: /\bit[\u2019']s (own|lead|bench|first|second|third|last|best|worst|defence|offence|players|coach|record|season|rhythm|shooting|rebounding)\b/gi,
    fix: (m, w) => 'its ' + w, bad: 'The team lost it\u2019s lead.', good: 'The team lost its lead.' },
  { id: 'its-contraction', level: 'error', msg: '"its" where "it is" or "it has" is meant', find: /\bits (been|not|going|just now|a (?:good|bad|big|long)|an? (?:easy|early|old))\b/gi,
    fix: (m, w) => 'it\u2019s ' + w, bad: 'Its been a long night.', good: 'It\u2019s been a long night.' },
  { id: 'its-apostrophe', level: 'error', msg: '"its\u2019" is not a word', find: /\bits[\u2019'](?=\s|[.,;:!?]|$)/gi, fix: () => 'its', bad: 'The side lost its\u2019 way.', good: 'The side lost its way.' },
  { id: 'their-there', level: 'error', msg: '"there" where "their" is meant', find: /\bthere (own|bench|best|worst|coach|players|lead|defence|offence|first|second|last)\b/gi, fix: (m, w) => 'their ' + w, bad: 'They lost there lead.', good: 'They lost their lead.' },
  { id: 'there-their', level: 'error', msg: '"their" where "there" is meant', find: /\btheir (was|were|is|are|will be|has been|have been)\b/gi, fix: (m, w) => 'there ' + w, bad: 'Their were two runs.', good: 'There were two runs.' },
  { id: 'theyre-their', level: 'error', msg: '"they\u2019re" where "their" is meant', find: /\bthey[\u2019']re (own|bench|best|worst|coach|players|lead|defence|offence|first|second|last)\b/gi, fix: (m, w) => 'their ' + w, bad: 'They lost they\u2019re lead.', good: 'They lost their lead.' },
  { id: 'then-than', level: 'error', msg: '"then" after a comparative: "than"', find: /\b(better|worse|more|less|fewer|higher|lower|bigger|smaller|faster|slower|rather|other|earlier|later|greater|larger|longer|shorter|stronger|weaker) then\b/gi,
    fix: (m, w) => w + ' than', bad: 'They shot better then their rivals.', good: 'They shot better than their rivals.' },
  { id: 'modal-of', level: 'error', msg: '"of" for "have"', find: /\b(could|would|should|must|might) of\b/gi, fix: (m, w) => w + ' have', bad: 'They could of won.', good: 'They could have won.' },
  { id: 'alot', level: 'error', msg: '"alot" is two words', find: /\balot\b/gi, fix: m => matchCase(m, 'a lot'), bad: 'They shot alot of threes.', good: 'They shot a lot of threes.' },
  { id: 'fewer-less', level: 'error', msg: '"less" with something counted: "fewer"', find: new RegExp('\\bless (' + COUNT_PL + ')\\b', 'gi'), fix: (m, w) => 'fewer ' + w, bad: 'They gave it away less times.', good: 'They gave it away fewer times.' },
  { id: 'less-fewer', level: 'error', msg: '"fewer" with something measured: "less"', find: new RegExp('\\bfewer (' + MASS_N + ')\\b', 'gi'), fix: (m, w) => 'less ' + w, bad: 'They had fewer time.', good: 'They had less time.' },
  { id: 'amount-number', level: 'error', msg: '"amount" of something counted: "number"', find: new RegExp('\\bamount of (' + COUNT_PL + ')\\b', 'gi'), fix: (m, w) => 'number of ' + w, bad: 'A large amount of turnovers.', good: 'A large number of turnovers.' },
  { id: 'whos-whose', level: 'error', msg: '"who\u2019s" where "whose" is meant', find: /\bwho[\u2019']s (own|bench|game|team|side|lead)\b/gi, fix: (m, w) => 'whose ' + w, bad: 'A side who\u2019s bench scored 40.', good: 'A side whose bench scored 40.' },
  { id: 'loose-lose', level: 'error', msg: '"loose" for "lose"', find: /\bloose (the|a|it|his|their|control|ground|track|possession)\b/gi, fix: (m, w) => 'lose ' + w, bad: 'They will loose the game.', good: 'They will lose the game.' },
  { id: 'loosing', level: 'error', msg: '"loosing" for "losing"', find: /\bloosing\b/gi, fix: m => matchCase(m, 'losing'), bad: 'They are loosing ground.', good: 'They are losing ground.' },
  { id: 'affect-noun', level: 'error', msg: '"affect" as a noun: "effect"', find: /\b(a|an|the|no|little|any|big|real|lasting) affect\b/gi, fix: (m, w) => w + ' effect', bad: 'It had a big affect.', good: 'It had a big effect.' },
  { id: 'irregardless', level: 'error', msg: '"irregardless" is "regardless"', find: /\birregardless\b/gi, fix: m => matchCase(m, 'regardless'), bad: 'Irregardless of the score.', good: 'Regardless of the score.' },
  { id: 'supposed-to', level: 'error', msg: '"suppose to" is "supposed to"', find: /\bsuppose to\b/gi, fix: () => 'supposed to', bad: 'They were suppose to win.', good: 'They were supposed to win.' },
  { id: 'who-that', level: 'hint', msg: '"that" for a person: "who"', find: /\b(player|man|woman|guard|forward|centre|scorer|coach|captain) that (?=(?:scored|led|made|took|won|played|had))/gi, fix: (m, w) => w + ' who ', bad: 'The player that scored 20.', good: 'The player who scored 20.' },
  /* ------------------------------------------------------------ agreement */
  { id: 'one-of-plural', level: 'error', msg: '"one of the ..." takes a singular verb', find: /\b(one of the [a-z][a-z' \u2019-]{2,50}?) (were|are|have)\b/gi,
    fix: (m, head, v) => head + ' ' + ({ were: 'was', are: 'is', have: 'has' })[v.toLowerCase()], bad: 'One of the best sides were beaten.', good: 'One of the best sides was beaten.' },
  { id: 'there-was-plural', level: 'error', msg: '"there was" before a plural', find: new RegExp('\\bthere was (' + NUM_WORD + '(?<!\\bone)(?<!\\b1)|several|many|both) ', 'gi'), test: null,
    fix: (m, w) => 'there were ' + w + ' ', bad: 'There was two runs.', good: 'There were two runs.' },
  { id: 'there-were-singular', level: 'error', msg: '"there were" before a singular', find: /\bthere were (one|1|a|an) /gi, fix: (m, w) => 'there was ' + w + ' ', bad: 'There were a run.', good: 'There was a run.' },
  { id: 'number-of-verb', level: 'error', msg: '"a number of ..." takes a plural verb; "the number of ..." a singular one', find: /\b(a number of [a-z]+(?: [a-z]+)?) (is|was|has)\b/gi,
    fix: (m, head, v) => head + ' ' + ({ is: 'are', was: 'were', has: 'have' })[v.toLowerCase()], bad: 'A number of players was hurt.', good: 'A number of players were hurt.' },
  /* ----------------------------------------------------------- comparison */
  { id: 'double-comparative', level: 'error', msg: 'a comparative or superlative twice ("more better")', find: /\b(more|most) (better|worse|faster|slower|higher|lower|bigger|smaller|best|worst|greatest|easier|harder)\b/gi,
    fix: (m, a, w) => w, bad: 'They were more better.', good: 'They were better.' },
  { id: 'double-negative', level: 'error', msg: 'a double negative', find: /\b(?:not|never|hardly|barely|didn[\u2019']t|wasn[\u2019']t|couldn[\u2019']t)(?: [a-z]+){0,2} (?:no|nobody|nothing|nowhere)\b/gi, fix: null, bad: 'They did not score nothing.', good: 'They scored nothing.' },
  /* ---------------------------------------------------------- hyphenation */
  { id: 'compound-modifier', level: 'style', msg: 'a compound modifier before a noun takes a hyphen', test: 'hyphen', fix: 'hyphen',
    bad: 'They scored 15 second chance points.', good: 'They scored 15 second-chance points.' },
  { id: 'numeral-compound', level: 'style', msg: 'a number and a unit before a noun take a hyphen: an 11-point lead', find: COMPOUND_NUM, fix: (m, n, unit, noun) => n + '-' + unit + ' ' + noun,
    bad: 'It was an 11 point lead.', good: 'It was an 11-point lead.' },
  /* ---------------------------------------------------------- punctuation */
  { id: 'spaced-hyphen', level: 'style', msg: 'a spaced hyphen is a dash', find: /([A-Za-z]) - (?=[A-Za-z])/g, fix: (m, a) => a + ' \u2014 ', bad: 'They won - easily.', good: 'They won \u2014 easily.' },
  { id: 'double-hyphen', level: 'style', msg: '"--" is a dash', find: /\s?--\s?/g, fix: () => ' \u2014 ', bad: 'They won--easily.', good: 'They won \u2014 easily.' },
  { id: 'score-hyphen', level: 'style', msg: 'a range or a score takes an en dash', find: /(?<![\d-])(\d{1,4})-(\d{1,4})(?![\d-])/g, fix: (m, a, b) => a + '\u2013' + b, bad: 'They won 94-68.', good: 'They won 94\u201368.' },
  { id: 'straight-quotes', level: 'style', msg: 'straight quotation marks: use curly ones', find: /"([^"<>\n]{1,80})"/g, fix: (m, t) => '\u201c' + t + '\u201d', bad: 'They "collapsed".', good: 'They \u201ccollapsed\u201d.' },
  { id: 'ellipsis', level: 'style', msg: 'three full stops are an ellipsis', find: /\.\.\./g, fix: () => '\u2026', bad: 'And then...', good: 'And then\u2026' },
  { id: 'percent-space', level: 'style', msg: 'no space before a percent sign', find: /(\d) %/g, fix: (m, d) => d + '%', bad: 'They shot 55.7 %.', good: 'They shot 55.7%.' },
  { id: 'decade-apostrophe', level: 'error', msg: 'no apostrophe in a decade or a plural numeral', find: /\b(\d{2,4})[\u2019']s\b/g, fix: (m, d) => d + 's', bad: 'The 1990\u2019s.', good: 'The 1990s.' },
  { id: 'day-capital', level: 'error', msg: 'days and months take capitals', find: new RegExp('\\b(' + DAYS + '|' + MONTHS + ')\\b', 'g'), fix: m => m.charAt(0).toUpperCase() + m.slice(1), bad: 'On saturday night.', good: 'On Saturday night.' },
  { id: 'space-before-semicolon', level: 'style', msg: 'no space before a semicolon or colon', find: /(\w) ([;:])(?=\s)/g, fix: (m, w, p) => w + p, bad: 'They won ; easily.', good: 'They won; easily.' },
  /* ---------------------------------------------------------------- style */
  { id: 'redundant-phrase', level: 'style', msg: 'a redundant phrase', find: /\b(each and every|end result|past history|in the event that|at this point in time|due to the fact that|the reason why|completely eliminate|very unique|advance planning|future plans|close proximity|absolutely essential)\b/gi,
    fix: m => matchCase(m, ({ 'each and every': 'every', 'end result': 'result', 'past history': 'history', 'in the event that': 'if', 'at this point in time': 'now', 'due to the fact that': 'because',
      'the reason why': 'the reason', 'completely eliminate': 'eliminate', 'very unique': 'unique', 'advance planning': 'planning', 'future plans': 'plans', 'close proximity': 'proximity', 'absolutely essential': 'essential' })[m.toLowerCase()]),
    bad: 'The end result was clear.', good: 'The result was clear.' },
  { id: 'wordy-phrase', level: 'style', msg: 'a wordy phrase', find: /\b(in order to|it is worth noting that|a total of|in terms of|as a matter of fact|for the purpose of)\b/gi,
    fix: m => matchCase(m, ({ 'in order to': 'to', 'it is worth noting that': '', 'a total of': '', 'in terms of': 'in', 'as a matter of fact': 'in fact', 'for the purpose of': 'for' })[m.toLowerCase()]),
    bad: 'They did it in order to win.', good: 'They did it to win.' },
  { id: 'intensifier', level: 'style', msg: 'an empty intensifier', find: /\b(very|really|basically|literally|totally|extremely|incredibly|absolutely)\s+(?=[a-z])/gi, fix: () => '', bad: 'They played really well.', good: 'They played well.' },
  { id: 'cliche', level: 'hint', msg: 'a cliché', find: /\b(at the end of the day|give 110%|game of two halves|left it all on the floor|tale of the tape|in the driver[\u2019']s seat|take it to the next level|sent a message|the dagger|step up to the plate|back against the wall)\b/gi, fix: null, bad: 'At the end of the day it was close.', good: 'It was close.' },
  { id: 'contraction', level: 'hint', msg: 'a contraction in a formal register', find: /\b(?:did|does|do|was|were|is|are|has|have|had|could|would|should|can|won|isn|aren|wasn|weren|hasn|haven|hadn|couldn|wouldn|shouldn|doesn|didn|don)[\u2019']t\b|\b(?:they|we|it|that|there|he|she)[\u2019'](?:re|ll|ve|d)\b/gi, fix: null, bad: 'They didn\u2019t score.', good: 'They did not score.' },
  { id: 'colloquial', level: 'hint', msg: 'a colloquial word', find: /\b(gonna|wanna|kinda|sorta|gotta|lots of|guys|stuff|a bit of a|pretty much)\b/gi, fix: null, bad: 'They were pretty much done.', good: 'They were done.' },
  { id: 'numeral-start', level: 'hint', msg: 'a sentence that starts with a numeral', find: /(?:^|[.!?]\s+)(\d[\d,.]*%?)(?=\s+[a-z])/g, fix: null, bad: '38 free throws were taken.', good: 'They took 38 free throws.' },
  { id: 'conjunction-start', level: 'hint', msg: 'a sentence that starts with a conjunction', find: /(?:^|[.!?]\s+)(And|But|So|Or|Because)\s+(?=[a-z])/g, fix: null, bad: 'And they won.', good: 'They won, too.' },
  { id: 'fragment', level: 'error', msg: 'a sentence that is only a subordinate clause', find: /(?:^|[.!?]\s+)(Which|Whereas)\b[^.!?]{3,80}[.!?]/g, fix: null, bad: 'Which was the difference.', good: 'That was the difference.' },
  { id: 'comma-splice', level: 'error', msg: 'a comma splice: two sentences joined by a comma', find: /\b[A-Z][a-z]+(?: [A-Z][a-z]+)* (?:won|lost|led|scored|beat|took|trailed|shot)\b[^.,;:!?]{0,40}, (?:they|it|he|she) (?:were|was|had|did|made|took|scored|won|lost|led|went|got|shot|ran|gave|finished)\b/g, fix: null,
    bad: 'Newcastle won 94\u201368, they led throughout.', good: 'Newcastle won 94\u201368, and they led throughout.' },
  { id: 'dangling-modifier', level: 'hint', msg: 'an opening participle whose subject may not be the main clause\u2019s', find: /(?:^|[.!?]\s+)(?:Having|Being|Looking|Shooting|Driving|Coming|Trailing|Leading|Facing)\b[^,.!?]{2,60}, (?:the|a|an|their|its) /g, fix: null,
    bad: 'Trailing by ten, the crowd roared.', good: 'Trailing by ten, they pressed.' },
  { id: 'passive-pileup', level: 'hint', msg: 'the passive three times in a paragraph', test: 'passive', fix: null,
    bad: 'It was played by them. It was decided by him. It was watched by her.', good: 'They played it.' },
  { id: 'unparallel-list', level: 'style', msg: 'a list whose items are not parallel (a gerund beside a noun)', test: 'parallel', fix: null,
    bad: 'They led on shooting, the boards and taking care of the ball.', good: 'They led on shooting, rebounding and ball security.' }
];
GRAMMAR.forEach(r => { if (r.find && !r.find.global) throw new Error('grammar rule ' + r.id + ' needs a global pattern'); });
const LEVEL_COST = { error: 12, style: 5, hint: 2 };

/* the two rules that need more than a pattern */
function findHyphens(text) {
  const out = [];
  HYPHEN_RES.forEach(([re]) => { re.lastIndex = 0; let m; while ((m = re.exec(text))) out.push({ sample: m[0], index: m.index }); });
  return out;
}
function findPassive(text) {
  const n = (text.match(/\b(?:was|were|been|being|is|are) \w+ed by\b/g) || []).length;
  return n >= 3 ? [{ sample: 'passive x' + n, index: 0 }] : [];
}
function findParallel(text) {
  const out = [];
  const re = /\b(?:on|at|in|with|for) ((?:[A-Za-z-]+ ?){1,3}), ((?:[A-Za-z-]+ ?){1,3}) and ((?:[A-Za-z-]+ ?){1,5})(?=[.,;])/g;
  let m;
  while ((m = re.exec(text))) {
    const items = [m[1], m[2], m[3]].map(x => x.trim());
    /* a verbal gerund phrase ("taking care of the ball") beside a plain noun ("the boards") is the break; "shooting, rebounding and ball security" is fine */
    const verbal = items.map(x => /^[a-z]+ing\s+[a-z]+/i.test(x) && !/^(?:free|ball|three|shot)\b/i.test(x));
    if (verbal.some(Boolean) && !verbal.every(Boolean)) out.push({ sample: m[0], index: m.index });
  }
  return out;
}
function findPartWhole(text) {
  const out = [];
  const re = /\b(\d+) of (?:the |their |his |her |its )?(\d+)\b/g;
  let m;
  while ((m = re.exec(text))) if (Number(m[1]) > Number(m[2])) out.push({ sample: m[0], index: m.index });
  return out;
}
/* "won the boards 30-40": the winner's figure is the first one in every sentence the report writes */
function findLowerWins(text) {
  const out = [];
  const re = /\b(?:won|took|owned|controlled) the (?:boards|paint|glass)\b[^.!?]{0,30}\b(\d+)\u2013(\d+)\b/gi;
  let m;
  while ((m = re.exec(text))) if (Number(m[1]) < Number(m[2])) out.push({ sample: m[0], index: m.index });
  return out;
}
const SPECIAL = { hyphen: findHyphens, passive: findPassive, parallel: findParallel, partwhole: findPartWhole, lowerwins: findLowerWins };

/* what the grammar finds in a text (tags are ignored): [{ id, level, msg, sample }] */
function grammar(html, opts) {
  const o = opts || {};
  const text = String(html).replace(/<[^>]*>/g, '');
  const out = [];
  GRAMMAR.forEach(r => {
    let hits = [];
    if (typeof r.test === 'string' && SPECIAL[r.test]) hits = SPECIAL[r.test](text);
    else if (r.find) { r.find.lastIndex = 0; let m; while ((m = r.find.exec(text))) hits.push({ sample: m[0], index: m.index }); }
    if (r.id === 'american-spelling' && o.american) hits = [];
    hits.forEach(h => out.push({ id: r.id, level: r.level, logic: !!r.logic, msg: r.msg, sample: h.sample.trim().slice(0, 60) }));
  });
  /* a club is plural in this report: "Bristol Flyers were", never "was" */
  (o.names || []).forEach(n => {
    const plain = String(n).replace(/<[^>]*>/g, '');
    if (!plain) return;
    const re = new RegExp('\\b' + plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' (was|is|has)\\b', 'g');
    let m; while ((m = re.exec(text))) out.push({ id: 'team-agreement', level: 'error', msg: 'a club is plural in this report', sample: m[0] });
  });
  return out;
}

/* REPAIR the certain ones, in a piece of text with no tags in it */
function fixGrammar(seg, opts) {
  const o = opts || {};
  let s = seg;
  GRAMMAR.forEach(r => {
    if (!r.fix) return;
    if (r.fix === 'hyphen') { HYPHEN_RES.forEach(([re, hy]) => { s = s.replace(re, (m, a, b) => matchCase(a, hy) + ' ' + b); }); return; }
    if (r.id === 'american-spelling' && o.american) return;
    r.find.lastIndex = 0;
    s = s.replace(r.find, (...m) => {
      const groups = m.slice(0, -2);                       // the match and its groups, without index and input
      const out = r.fix.apply(null, groups);
      /* a repair that starts a sentence keeps the capital the wrong form had */
      return out == null ? groups[0] : (/^[A-Z]/.test(groups[0]) && /^[a-z]/.test(out) ? out.charAt(0).toUpperCase() + out.slice(1) : out);
    });
  });
  (o.names || []).forEach(n => {
    const plain = String(n).replace(/<[^>]*>/g, '');
    if (!plain) return;
    s = s.replace(new RegExp('\\b(' + plain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ') (was|is|has)\\b', 'g'), (m, name, v) => name + ' ' + ({ was: 'were', is: 'are', has: 'have' })[v]);
  });
  return s.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1');
}

/* REPAIR what a finished paragraph got wrong. Only the rules that cannot change what a sentence claims. */
function polish(html, opts) {
  let out = inText(html, seg => {
    let s = fixGrammar(seg, opts);
    s = s.replace(/[ \t ]{2,}/g, ' ');                                  // one space between words
    s = s.replace(/\s+([,;:!?])(?=\s|$)/g, '$1');                            // none before a comma
    s = s.replace(/\s+\.(?=\s|$)/g, '.');                                    // ... or a full stop
    s = s.replace(/,\s*,+/g, ',').replace(/,\s*\./g, '.').replace(/\.{2,}(?!\.)/g, m => (m.length === 2 ? '.' : m));
    s = s.replace(/([a-z0-9à-ÿ]),([A-Za-zÀ-ÿ])/g, '$1, $2');  // one after a comma
    s = s.replace(/([a-zà-ÿ])\.([A-Z][a-z])/g, '$1. $2');             // ... and after a full stop
    s = s.replace(/([A-Za-z])'([A-Za-z])/g, '$1' + APOS + '$2');            // curly apostrophes throughout
    s = s.replace(/([A-Za-z]s)’s\b/g, '$1' + APOS);                     // Flyers's -> Flyers'
    /* a doubled word: "the the", "and and" (a few doubles are English: "had had", "that that") */
    s = s.replace(/\b([A-Za-z]+)(\s+)\1\b/gi, (m, w) => (KEEP_DOUBLE.has(w.toLowerCase()) ? m : w));
    /* a or an against the sound of the next word, keeping the capital */
    s = s.replace(/\b([Aa]n?)\s+([A-Za-z0-9][\wÀ-ɏ’'-]*)/g, (m, art, next) => {
      const want = an(next), was = art.toLowerCase();
      if (was === want) return m;
      return (art.charAt(0) === 'A' ? want.charAt(0).toUpperCase() + want.slice(1) : want) + ' ' + next;
    });
    /* one point, two points: a counted noun agrees with its digit */
    s = s.replace(new RegExp('\\b(\\d+(?:\\.\\d+)?)\\s+(' + COUNTED + ')\\b(?![-\\w])', 'gi'), (m, n, noun) => {
      const v = Number(n), lower = noun.toLowerCase();
      if (v === 1 && SINGLE[lower]) return n + ' ' + SINGLE[lower];
      if (v !== 1 && MULTI[lower]) return n + ' ' + MULTI[lower];
      return m;
    });
    return s;
  });
  /* the first letter of every sentence is a capital (not after an abbreviation such as "Jr." or an initial) */
  out = inText(out, seg => seg.replace(/([.!?])(\s+)([a-zà-ÿ])/g, (m, p, sp, c, at) => {
    const before = seg.slice(Math.max(0, at - 6), at + 1);
    return ABBREV.test(before) ? m : p + sp + c.toUpperCase();
  }));
  return out;
}

/* CHECK a finished text, changing nothing: what is still wrong after polish() (or what polish() would have to fix) */
function lint(html, opts) {
  const o = opts || {};
  const plain = String(html).replace(/<[^>]*>/g, '');
  const issues = [];
  const add = (rule, sample) => issues.push({ rule, sample: String(sample).slice(0, 60) });
  let m;
  if ((m = /[ \t ]{2,}/.exec(plain))) add('double-space', plain.slice(Math.max(0, m.index - 12), m.index + 14));
  if ((m = /\s[,;:!?](?=\s|$)|\s\.(?=\s|$)/.exec(plain))) add('space-before-punctuation', plain.slice(Math.max(0, m.index - 12), m.index + 6));
  if ((m = /,\s*,|,\s*\.|\.\.(?!\.)/.exec(plain))) add('doubled-punctuation', plain.slice(Math.max(0, m.index - 12), m.index + 6));
  if ((m = /[A-Za-z]s’s\b/.exec(plain))) add('possessive', plain.slice(Math.max(0, m.index - 8), m.index + 12));
  if ((m = /[A-Za-z]'[A-Za-z]/.exec(plain))) add('straight-apostrophe', plain.slice(Math.max(0, m.index - 8), m.index + 8));
  const dbl = /\b([A-Za-z]+)\s+\1\b/gi;
  while ((m = dbl.exec(plain))) { if (!KEEP_DOUBLE.has(m[1].toLowerCase())) { add('doubled-word', m[0]); break; } }
  const art = /\b([Aa]n?)\s+([A-Za-z0-9][\wÀ-ɏ’'-]*)/g;
  while ((m = art.exec(plain))) { if (m[1].toLowerCase() !== an(m[2])) { add('article', m[0]); break; } }
  const cnt = new RegExp('\\b(\\d+(?:\\.\\d+)?)\\s+(' + COUNTED + ')\\b(?![-\\w])', 'gi');
  while ((m = cnt.exec(plain))) {
    const v = Number(m[1]), noun = m[2].toLowerCase();
    if ((v === 1 && SINGLE[noun]) || (v !== 1 && MULTI[noun])) { add('number-agreement', m[0]); break; }
  }
  const sent = /([.!?])(\s+)([a-zà-ÿ])/g;
  while ((m = sent.exec(plain))) {
    if (!ABBREV.test(plain.slice(Math.max(0, m.index - 5), m.index + 1))) { add('sentence-capital', plain.slice(m.index, m.index + 14)); break; }
  }
  if (/^\s*[a-z]/.test(plain)) add('starts-lower-case', plain.slice(0, 20));
  const opens = (plain.match(/\(/g) || []).length, closes = (plain.match(/\)/g) || []).length;
  if (opens !== closes) add('unbalanced-brackets', plain.slice(0, 40));
  if ((m = /&[a-z#0-9]+;/i.exec(plain)) && !o.allowEntities) add('stray-entity', m[0]);
  if ((m = /\b(?:undefined|NaN|null|Infinity)\b/.exec(plain))) add('leaked-value', m[0]);
  if ((m = /\bthe (?:winners|losers)’s\b/i.exec(plain))) add('possessive', m[0]);
  const long = plain.split(/(?<=[.!?])\s+/).find(x => (x.match(/\b\d+(?:\.\d+)?%?/g) || []).length > (o.maxNumerals || 5));
  if (long) add('too-many-numbers', long);
  grammar(html, o).forEach(f => { if (f.level !== 'hint' || o.hints) issues.push({ rule: f.id, level: f.level, logic: f.logic, sample: f.sample }); });
  return issues;
}

/* ============================================================================
   THE CRITIC AND THE REVISER: writing that is improved until it is good enough, not re-rolled.

   A template offers several phrasings and used to pick one by hashing a seed, which is a dice throw: the same game
   always reads the same, but nothing says the phrasing chosen is a good one, and a bad sentence stays bad. Here every
   piece of text is SCORED on a 0-100 scale by critique() against what makes prose read as written by a person, and
   revise() then works on it deterministically: it tries each repair it knows (split a run-on at its second "and",
   cut a filler, put a pronoun where the same club has just been named, drop a sentence that repeats an earlier one),
   keeps the one that raises the score most, and goes again, until the score reaches the target or no repair helps.
   The same score chooses between a template's phrasings (choose()): the best, not the luckiest.

   THE SCALE (100 is clean; each finding takes points off, and every finding is listed so it can be read, not trusted):
     grammar and typography   any lint() finding                                       -12 each
     length                   a sentence of 31-40 words / over 40                       -7 / -14
     density                  each numeral beyond four in one sentence                  -5
     rhythm                   two or more ", and" in one sentence                       -8
                              five or more commas / two or more dashes in one           -5 / -6
     filler                   "a total of", "in terms of", "very", "really" ...         -5
     repetition               a sentence opening like the one before it                 -6
                              a third pronoun opener in a row                           -4
                              a sentence that says what an earlier one said             -10
                              a paragraph that opens on a bare pronoun                  -4
     shape                    a sentence under three words                              -3
   ============================================================================ */
const TARGET = 92;
const FILLERS = [
  [/\ba total of\s+/gi, ''], [/\bin order to\b/gi, 'to'], [/\bvery\s+/gi, ''], [/\breally\s+/gi, ''],
  [/\bbasically,?\s+/gi, ''], [/\bin terms of\b/gi, 'in'], [/\bit is worth noting that\s+/gi, ''],
  [/\bthe fact that\b/gi, 'that'], [/\bat this point in time\b/gi, 'now'], [/\bdue to the fact that\b/gi, 'because']
];
const FILLER_TEST = new RegExp('\\b(?:a total of|in order to|very|really|basically|in terms of|it is worth noting that|the fact that|at this point in time|due to the fact that)\\b', 'i');
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from', 'that', 'this', 'it', 'they', 'their', 'was', 'were', 'is', 'are', 'had', 'have', 'has', 'as', 'but', 'so', 'or']);

const stripTags = h => String(h).replace(/<[^>]*>/g, '');
function sentencesOf(plain) {
  return String(plain).split(/(?<=[.!?])\s+/).map(x => x.trim()).filter(Boolean);
}
const contentWords = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9\u00E0-\u00FF\s]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w)));
function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; a.forEach(w => { if (b.has(w)) inter++; });
  return inter / (a.size + b.size - inter);
}
const opener = s => String(s).trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();

/* SCORE a text (one sentence or a paragraph). Returns { score, notes:[{why, cost}] }. `before` is the sentence that
   came just ahead of it in the article, so a repeated opener is seen across a paragraph break too. */
function critique(html, o) {
  const opts = o || {};
  const plain = stripTags(html);
  const notes = [];
  let score = 100;
  const pen = (cost, why) => { score -= cost; notes.push({ why, cost }); };
  lint(html, { maxNumerals: 99, allowEntities: true, names: opts.names, hints: true }).forEach(i => { if (i.rule !== 'too-many-numbers') pen(i.logic ? 25 : (i.level ? LEVEL_COST[i.level] : 12), (i.logic ? 'logic: ' : 'grammar: ') + i.rule + ' (' + i.sample.trim() + ')'); });
  const sents = sentencesOf(plain);
  sents.forEach((sn, i) => {
    const words = sn.split(/\s+/).length;
    if (words > 40) pen(14, 'very long sentence (' + words + ' words)');
    else if (words > 30) pen(7, 'long sentence (' + words + ' words)');
    if (words < 3 && sents.length > 1) pen(3, 'fragment');
    const nums = (sn.match(/\b\d+(?:\.\d+)?%?/g) || []).length;
    if (nums > 4) pen(5 * (nums - 4), 'dense with numbers (' + nums + ')');
    if ((sn.match(/, and /g) || []).length >= 2) pen(8, 'chained clauses');
    if ((sn.match(/,/g) || []).length >= 5) pen(5, 'comma pile-up');
    if ((sn.match(/ \u2014 /g) || []).length >= 2) pen(6, 'dash pile-up');
    if (FILLER_TEST.test(sn)) pen(5, 'filler');
    const prev = i > 0 ? sents[i - 1] : (opts.before || null);
    if (prev && opener(prev) === opener(sn) && opener(sn).split(' ').length > 1) pen(6, 'repeated opener');
    if (i > 1 && /^(They|Their|It)\b/.test(sn) && /^(They|Their|It)\b/.test(sents[i - 1]) && /^(They|Their|It)\b/.test(sents[i - 2])) pen(4, 'third pronoun opener in a row');
    for (let j = 0; j < i; j++) {
      const a = contentWords(sents[j]), b = contentWords(sn);
      if (a.size >= 4 && b.size >= 4 && jaccard(a, b) >= 0.8) { pen(10, 'repeats an earlier sentence'); break; }
    }
  });
  if (sents.length && /^(They|Their)\b/.test(sents[0]) && opts.paragraphStart) pen(4, 'opens on a bare pronoun');
  const rp = repeatedPhrase(sents);
  if (rp) pen(6, 'says "' + rp.phrase + '" twice');
  /* LOGIC AGAINST THE FACTS: the caller's verifier reads a sentence and the game it describes, and says what is not so */
  if (typeof opts.verify === 'function') opts.verify(html).forEach(f => pen(25, 'logic: ' + f.rule + ' (' + String(f.why || f.sentence).slice(0, 60) + ')'));
  sents.forEach(sn => { if (mixedNumbers(sn)) pen(4, 'digits and number words in one breath'); });
  (opts.names || []).forEach(n => {
    const plainName = stripTags(n);
    sents.forEach(sn => { if (plainName && sn.split(plainName).length - 1 >= 3) pen(5, 'names ' + plainName + ' three times in a sentence'); });
  });
  return { score: Math.max(0, Math.min(100, score)), notes };
}

/* a phrase of five or more words that appears in two different sentences of one paragraph ("a share few sides in this league ever reach") */
function repeatedPhrase(sents) {
  const grams = sents.map(sn => {
    const w = sn.toLowerCase().replace(/[^a-z0-9\u00e0-\u00ff'\u2019\s-]/g, ' ').split(/\s+/).filter(Boolean);
    const set = new Map();
    for (let i = 0; i + 5 <= w.length; i++) set.set(w.slice(i, i + 5).join(' '), i);
    return set;
  });
  for (let a = 0; a < sents.length; a++) {
    for (let b = a + 1; b < sents.length; b++) {
      for (const [g, at] of grams[b]) {
        if (!grams[a].has(g)) continue;
        if (/^(the|a|of|to|and|they|their|against|for|in|on)( (the|a|of|to|and|they|their|against|for|in|on)){4}$/.test(g)) continue;
        return { phrase: g, later: b, at };
      }
    }
  }
  return null;
}
/* "18 of 37 ... eight of 28": a number word and a bigger digit figure in one sentence */
const NUM_WORD_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve) (of|for|from) (?=\d)/i;
function mixedNumbers(sn) {
  if (!NUM_WORD_RE.test(sn)) return false;
  return (sn.match(/\b\d{2,}\b/g) || []).some(x => Number(x) > 12);
}
const WORD_TO_DIGIT = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/* THE REPAIRS: each takes a paragraph and returns a changed one, or the same one when it has nothing to do. None of them
   can alter a claim: they split, trim, substitute a pronoun for a name just used, or drop a sentence said twice. */
function joinBack(sents) { return sents.join(' '); }
function opFillers(text) {
  let out = text;
  FILLERS.forEach(([re, to]) => { out = out.replace(re, to); });
  return out.replace(/\s{2,}/g, ' ');
}
/* split the worst sentence at its second ", and" (or its semicolon, or the "and" nearest its middle) */
function opSplit(text) {
  if (/<[^>]+>/.test(text)) return text;
  const sents = sentencesOf(text);
  let worst = -1, worstCost = 0;
  sents.forEach((sn, i) => {
    const c = critique(sn, {}).notes.filter(n => /long|chained|comma|dash|dense/.test(n.why)).reduce((a, n) => a + n.cost, 0);
    if (c > worstCost) { worstCost = c; worst = i; }
  });
  if (worst < 0) return text;
  const sn = sents[worst];
  const cuts = [];
  let m; const re = /, and |; /g;
  while ((m = re.exec(sn))) cuts.push({ at: m.index, len: m[0].length });
  if (!cuts.length) return text;
  const mid = sn.length / 2;
  const cut = cuts.length >= 2 ? cuts[1] : cuts.sort((a, b) => Math.abs(a.at - mid) - Math.abs(b.at - mid))[0];
  const left = sn.slice(0, cut.at), right = sn.slice(cut.at + cut.len);
  if (left.split(/\s+/).length < 5 || right.split(/\s+/).length < 4) return text;
  sents[worst] = left.replace(/[,;]$/, '') + '. ' + right.charAt(0).toUpperCase() + right.slice(1);
  return joinBack(sents);
}
/* a club named at the start of two sentences running, with the other club in neither, is "They" the second time */
function opPronoun(text, o) {
  const names = (o && o.names) || [];
  if (!names.length || /<[^>]+>/.test(text)) return text;
  const sents = sentencesOf(text);
  let changed = false;
  for (let i = 1; i < sents.length; i++) {
    for (let t = 0; t < names.length; t++) {
      const n = names[t], other = names[1 - t];
      if (!n || !sents[i].startsWith(n + ' ') || !sents[i - 1].startsWith(n + ' ')) continue;
      if (other && (sents[i].includes(other) || sents[i - 1].includes(other))) continue;
      sents[i] = 'They' + sents[i].slice(n.length);
      changed = true;
    }
  }
  return changed ? joinBack(sents) : text;
}
function opDedupe(text) {
  if (/<[^>]+>/.test(text)) return text;
  const sents = sentencesOf(text);
  for (let i = 1; i < sents.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = contentWords(sents[j]), b = contentWords(sents[i]);
      if (a.size >= 4 && b.size >= 4 && jaccard(a, b) >= 0.8) { sents.splice(i, 1); return joinBack(sents); }
    }
  }
  return text;
}
/* "18 of 37, against eight of 28" -> "18 of 37, against 8 of 28" */
function opNumbers(text) {
  if (/<[^>]+>/.test(text)) return text;
  return sentencesOf(text).map(sn => (mixedNumbers(sn)
    ? sn.replace(new RegExp(NUM_WORD_RE.source, 'gi'), (m, w, p) => WORD_TO_DIGIT[w.toLowerCase()] + ' ' + p + ' ')
    : sn)).join(' ');
}
/* a closing clause that repeats a phrase from an earlier sentence is cut back to the comma before it: ", a share few sides in this league ever reach" */
function opTail(text) {
  if (/<[^>]+>/.test(text)) return text;
  const sents = sentencesOf(text);
  const rp = repeatedPhrase(sents);
  if (!rp) return text;
  const sn = sents[rp.later], low = sn.toLowerCase();
  const at = low.indexOf(rp.phrase.split(' ').slice(0, 3).join(' '));
  if (at < 0) return text;
  const comma = sn.lastIndexOf(',', at);
  const tail = sn.slice(at).replace(/[.!?]+$/, '');
  if (comma < 0 || tail.split(/\s+/).length > 12 || sn.slice(comma).replace(/[.!?]+$/, '').split(/\s+/).length > 14) return text;
  sents[rp.later] = sn.slice(0, comma) + '.';
  return sents.join(' ');
}
/* A SENTENCE THE FACTS REFUSE IS DROPPED. It is never rewritten by guessing what was meant: a report with one sentence fewer is true,
   and one with a plausible patch may not be. */
function opClaims(text, opts) {
  const o = opts || {};
  if (/<[^>]+>/.test(text)) return text;
  const bad = (typeof o.verify === 'function' ? o.verify(text).map(f => f.sentence) : []).filter(Boolean);
  /* ... and one the text alone shows to be impossible (a part larger than its whole, a hedge on an exact figure) */
  grammar(text, {}).filter(f => f.logic).forEach(f => {
    const sn = sentencesOf(text).find(x => x.indexOf(f.sample) >= 0);
    if (sn) bad.push(sn);
  });
  if (!bad.length) return text;
  const kept = sentencesOf(text).filter(sn => !bad.some(b => sn.indexOf(b) >= 0 || b.indexOf(sn) >= 0));
  return kept.join(' ');
}
const REPAIRS = [['claims', opClaims], ['fillers', opFillers], ['numbers', opNumbers], ['tail', opTail], ['split', opSplit], ['pronoun', opPronoun], ['dedupe', opDedupe]];

/* REVISE until satisfied: hill-climb on critique(), one repair a pass, the one that gains most, until the target or until
   nothing helps. Deterministic, and it says what it did. */
function revise(html, o) {
  const opts = o || {};
  const target = opts.target || TARGET, max = opts.max || 8;
  let cur = polish(html, opts), c = critique(cur, opts);
  const first = c.score, log = [];
  const logicLeft = cc => cc.notes.some(n => /^logic:/.test(n.why));
  for (let pass = 0; pass < max && (c.score < 100 || logicLeft(c)); pass++) {
    let best = null;
    REPAIRS.forEach(([name, fn]) => {
      const cand = polish(fn(cur, opts), opts);
      if (cand === cur || (!cand.trim() && name !== 'claims')) return;
      const cc = critique(cand, opts);
      if (cc.score > c.score && (!best || cc.score > best.c.score)) best = { cand, c: cc, name };
    });
    if (!best) break;
    /* satisfied, and nothing left that is worth more than a point or two: stop rather than fiddle with a text that is good */
    if (c.score >= target && !logicLeft(c) && best.c.score - c.score < 4) break;
    log.push({ repair: best.name, from: c.score, to: best.c.score });
    cur = best.cand; c = best.c;
  }
  return { text: cur, score: c.score, initial: first, log, notes: c.notes, satisfied: c.score >= target && !logicLeft(c), logic: c.notes.filter(n => /^logic:/.test(n.why)) };
}

/* CHOOSE between a template's phrasings by score, not by luck: the option the critic likes best given what has just been
   written (`recent` is the openers of the last few sentences chosen), and only when several tie does the seed decide, so
   the same game still reads the same way twice. */
function choose(seed, options, recent) {
  if (!options || !options.length) return undefined;
  if (options.length === 1) return options[0];
  const rc = recent || [];
  const start = seed % options.length;
  let best = -1, bestScore = -Infinity;
  for (let k = 0; k < options.length; k++) {
    const i = (start + k) % options.length;
    const opt = options[i];
    if (typeof opt !== 'string') continue;
    let sc = critique(opt, {}).score;
    if (rc.indexOf(opener(opt)) >= 0) sc -= 6;
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  return options[best < 0 ? start : best];
}

return { spell, spellFull, ordinalWord, ordinalNum, periodName, numeral, signed, pct, score, clock, approxMinutes,
         an, withArticle, plural, count, spellSet, fewer, possessive, POSSESSIVE_PRONOUN, isPlural, verb, be, list,
         unshout, capParts, titleCase, capitalise, polish, lint, inText, IRREG_VERBS,
         critique, revise, choose, opener, sentencesOf, TARGET,
         GRAMMAR, grammar, fixGrammar, LEVEL_COST, opClaims };
}));
