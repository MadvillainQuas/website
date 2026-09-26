'use strict';
/* ============================================================================
   THE MATCH REPORT, IN WORDS AND ON THE PAGE.

   story.js decided WHAT is true and how much each finding matters. This file
   decides how it reads and how it looks, and it is deliberately the only place
   that deals in sentences.

   That seam is the point. Everything upstream is numbers with names attached,
   which is testable — "did it claim the right side won the third quarter" has
   an answer. Everything here is phrasing, which is not. Keeping them apart
   means a wording change can never alter a claim, and it means the day this
   platform wants a language model writing the prose, the model slots in HERE:
   it is handed the ranked facts as a brief and asked for paragraphs, while
   every number it is allowed to use has already been computed. That is the
   difference between a model that writes about the game and a model that
   invents one.

   THE LAYOUT interleaves prose with cards, because a match report that is only
   text buries its own evidence and one that is only tables is a box score with
   extra steps. Each section carries the graphic that belongs to what it just
   said: the flow section gets the quarter bars, the numbers section gets the
   four-factor comparison, the lineup section gets the group that decided it.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaReport = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const S = () => (root.EpinoiaStory ||
  (typeof require === 'function' ? require('./story.js') : null));
/* THE RULES OF THE ENGLISH IT IS WRITTEN IN (language.js): articles, plurals, possessives, agreement, lists, number
   words, names in capitals, and the critic that scores a sentence and the reviser that improves it. */
const L = () => (root.EpinoiaLanguage ||
  (typeof require === 'function' ? require('./language.js') : null));

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const num  = v => (v == null || v === '' || isNaN(v) ? null : +v);
const one  = v => (num(v) == null ? '—' : (+v).toFixed(1));
const pct1 = v => (num(v) == null ? '—' : (+v).toFixed(1) + '%');
const mins = ms => Math.floor((ms || 0) / 60000) + ':' +
  String(Math.floor(((ms || 0) % 60000) / 1000)).padStart(2, '0');
const plural = (n, s, p) => n + ' ' + (n === 1 ? s : (p || s + 's'));
const ordinal = n => n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third'
  : n === 4 ? 'fourth' : n + 'th';

/* THE SCORER STORES NAMES LOWERCASE and feeds send them in every case there is; a name in a sentence is written the way a
   person writes it (language.js titleCase: "soft club" and "FUERZA REGIA" and "JIMOND  IVEY" alike, McBride and KK Split left as
   they are). */
const tc = str => L().titleCase(str);
const nm = (g, t) => esc(tc(g.names[t]));
/* "Derby Trailblazers'" not "Derby Trailblazers's": a name ending in s takes
   the bare apostrophe */
const possOf = name => String(name) + (/s$/i.test(String(name).replace(/<[^>]*>/g, '')) ? '\u2019' : '\u2019s');
const nmPoss = (g, t) => possOf(nm(g, t));

/* Surnames only for a lineup sentence — five full names in one clause is a
   list, not a sentence. */
function five(g, ids) {
  const split = (ids || []).map(id => {
    const p = g.byId[id];
    if (!p) return null;
    const parts = String(p.name || '').split(/\s+/).filter(Boolean);
    /* "Glasgow Jr" is Glasgow; a suffix on its own names nobody */
    while (parts.length > 1 && /^(jr|sr|ii|iii|iv)\.?$/i.test(parts[parts.length - 1])) parts.pop();
    return { last: tc(parts[parts.length - 1] || ''), first: tc(parts.length > 1 ? parts[0] : '') };
  }).filter(Boolean);
  /* TWO ANDERSONS ARE NOT ONE. "Anderson, Brodie, Holden, Yoakum and Anderson" was two
     different men (Bristol Flyers, 2026-09-23 read-through), and read as a typo. A surname
     that appears twice in the group carries its first initial. */
  const count = {};
  split.forEach(n => { count[n.last] = (count[n.last] || 0) + 1; });
  const names = split.map(n => (count[n.last] > 1 && n.first ? n.first.charAt(0) + '. ' + n.last : n.last));
  if (!names.length) return 'that group';
  if (names.length === 1) return esc(names[0]);
  return esc(names.slice(0, -1).join(', ')) + ' and ' + esc(names[names.length - 1]);
}


/* ============================================================== referring ===
   How a club is named THIS time. See the note in the commit: the writer had
   one expression per team and used it for every sentence, which is what made
   the prose read as generated even when every claim was right.

   The rules are deliberately conservative. A pronoun is only used when the
   same side was the subject of the previous sentence, so "they" can never
   drift onto the other club; a role noun ("the winners") only after the result
   has been stated, because before that it gives the ending away. */
function makeRef(g, fs) {
  const r = fs.find(f => f.kind === 'result');
  const winner = r ? r.data.winner : null;

  /* State is deliberately tiny: who the last sentence was about, and whether
     each side has been named at all yet.

     THE FIRST VERSION OF THIS COULD NEVER PRONOMINALISE. It zeroed a counter
     when it named a club and then required that counter to be at least one
     before using "they", so the branch was unreachable and every sentence got
     the full name — which made the measured repetition WORSE than before the
     referrer existed. Counting "how long since" is the wrong model; the
     question is only ever "was the previous sentence about this side". */
  let last = null;
  const named = [false, false];
  /* the roles a side can be called, each once: winners/losers only. Hosts and visitors used
     to be in here too, and a report that called the same club "the winners", then "the
     visitors", then "Bristol Flyers" three sentences running made the reader stop and work
     out which side was home (read-through of three SLB games, 2026-09-23). Nobody reading a
     report tracks that; everybody knows who won. */
  const roles = [[], []];
  if (winner != null) {
    roles[winner].push('the winners'); roles[1 - winner].push('the losers');
  }
  const role = t => (roles[t].length ? roles[t][0] : null);
  const spendRole = t => roles[t].shift();

  return {
    subj(t, opts) {
      const o = opts || {};
      let word;
      if (last === t && named[t] && !o.noPronoun) {
        word = 'They';
      } else if (o.allowRole && named[t] && role(t)) {
        /* sentence case, not title case: "The winners", never "The Winners" */
        const rl = spendRole(t);
        word = rl.charAt(0).toUpperCase() + rl.slice(1);
      } else {
        word = nm(g, t);
        named[t] = true;
      }
      last = t;
      return word;
    },
    poss(t) {
      let word;
      if (last === t && named[t]) word = 'their';
      else { word = nmPoss(g, t); named[t] = true; }
      last = t;
      return word;
    },
    /* Object position is never a pronoun: it is almost always the OTHER club,
       and "beat them" after a sentence about them points at the wrong side. */
    obj(t) { named[t] = true; return nm(g, t); },
    neutral() { last = null; }
  };
}


/* "an 8-0 run", "a 12-0 run": the article follows the SOUND of the numeral (language.js an) */
function anFor(n) { return L().an(String(n)); }

/* A stable choice from a set of phrasings. Seeded by the thing being described
   rather than by position, so a report does not reshuffle when a fact above it
   changes, and never random, so two loads of the same game read identically. */
function seedOf(str) {
  let h = 0;
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
/* The template used for the previous sentence in the current paragraph, so a
   neighbour can avoid it. Reset by each section that cares. */
let lastPick = null;
function pickVaried(seed, options) {
  if (options.length < 2) return pick(seed, options);
  let i = options.indexOf(L().choose(seedOf(seed), options, RECENT));
  if (i < 0) i = seedOf(seed) % options.length;
  /* Compare the TEMPLATE, not the rendered sentence. The first version tested
     the finished strings, which differ by name and number for every player, so
     it never matched and two men were still "chipped in 21 … well up on his
     usual" and "chipped in 19 … well up on his usual" in consecutive lines.
     The option set is identified by its length, which is enough: consecutive
     sentences of the same kind draw from the same array. */
  const key = options.length + ':' + i;
  if (key === lastPick) i = (i + 1) % options.length;
  lastPick = options.length + ':' + i;
  return options[i];
}

/* THE BEST OF SEVERAL PHRASINGS, not the luckiest: language.js scores each option on the 0-100 scale (grammar, length, rhythm,
   density, repetition) and takes the highest, with a mild penalty for opening the way one of the last few sentences did; the
   seed only breaks a tie, so the same game still reads the same way twice. Options must be plain values: anything that names a
   club has to be resolved BEFORE the array is built, because every element of an array literal is evaluated. */
let RECENT = [];
function pick(seed, options) {
  const chosen = L().choose(seedOf(seed), options, RECENT);
  if (typeof chosen === 'string') { RECENT.push(L().opener(chosen)); if (RECENT.length > 4) RECENT.shift(); }
  return chosen;
}

/* Small counts read as words in running prose — "nine of seventeen" is a
   sentence, "9 of 17" is a column. Bigger figures stay as digits, because a
   score or a percentage spelled out is worse than the problem it solves. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
               'eight', 'nine', 'ten', 'eleven', 'twelve'];
function spell(n) {
  const v = Math.round(Number(n));
  return (v >= 0 && v <= 12) ? WORDS[v] : String(v);
}

/* A referring expression built for the FRONT of a sentence ("The winners",
   "They") that lands in the middle of one drops its capital. Club names keep
   theirs. */
function midCase(w) {
  return String(w).replace(/^(The winners|The losers|The hosts|The visitors|They)\b/, m => m.toLowerCase());
}

/* A player's line beyond the points, in words: only the parts worth a clause,
   so a scorer with two rebounds is not credited with two rebounds. */
function lineTail(p, opts) {
  const o = opts || {};
  const reb = (p.or || 0) + (p.dr || 0), ast = p.ast || 0, stl = p.stl || 0, blk = p.blk || 0;
  const bits = [];
  if (reb >= (o.rebMin || 6)) bits.push(spell(reb) + ' rebounds');
  if (ast >= (o.astMin || 4)) bits.push(spell(ast) + ' assists');
  if (stl >= 3) bits.push(spell(stl) + ' steals');
  if (blk >= 2 && bits.length < 3) bits.push(spell(blk) + ' blocks');
  if (!bits.length) return '';
  if (bits.length === 1) return ' and ' + bits[0];
  return ', ' + bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
}

/* "on Saturday evening at the Arena, in front of 312" — whichever parts the
   fixture actually carries; nothing is invented to fill a gap */
function dateline(g, fs) {
  const m = fs.find(f => f.kind === 'meta');
  if (!m) return '';
  const d = m.data, bits = [];
  if (d.day) bits.push('on ' + d.day + (d.evening ? ' ' + d.evening : ''));
  if (d.venue) bits.push('at ' + esc(tc(String(d.venue))));
  const where = bits.join(' ');
  return d.attendance ? (where ? where + ', in front of ' + d.attendance : 'in front of ' + d.attendance) : where;
}

/* ------------------------------------------------------------- headline --- */
function headline(g, fs) {
  const r = fs.find(f => f.kind === 'result');
  if (!r) return nm(g, 0) + ' v ' + nm(g, 1);
  const w = r.data.winner, l = r.data.loser;
  const sc = Math.max(g.score[0], g.score[1]) + '–' + Math.min(g.score[0], g.score[1]);
  const comeback = fs.find(f => f.kind === 'comeback');
  const td = fs.find(f => f.kind === 'tripleDouble');
  const big = fs.find(f => f.kind === 'bigScore');

  const ot = fs.find(f => f.kind === 'overtime');
  const stolen = fs.find(f => f.kind === 'stolenLate');
  const turned = fs.find(f => f.kind === 'turnedAfterHalf');
  const pulled = fs.find(f => f.kind === 'pulledAway');
  if (r.data.margin === 0) return nm(g, 0) + ' and ' + nm(g, 1) + ' tie ' + sc;
  if (ot) return nm(g, w) + ' outlast ' + nm(g, l) + ' in overtime, ' + sc;
  if (stolen) return nm(g, w) + ' steal it late from ' + nm(g, l) + ', ' + sc;
  if (comeback) return nm(g, w) + ' overturn ' + comeback.data.deficit +
    ' to beat ' + nm(g, l);
  if (turned) return nm(g, w) + ' come from behind to beat ' + nm(g, l) + ' ' + sc;
  if (pulled && r.data.how !== 'rout') return nm(g, w) + ' pull away late from ' + nm(g, l) + ', ' + sc;
  if (td) return possOf(esc(tc(td.data.p.name))) + ' triple-double carries ' + nm(g, w);
  if (r.data.how === 'rout') return nm(g, w) + ' overwhelm ' + nm(g, l) + ', ' + sc;
  if (r.data.how === 'squeaker') return nm(g, w) + ' edge ' + nm(g, l) + ' ' + sc;
  if (big && big.side === w) return esc(tc(big.data.p.name)) + '’s ' +
    big.data.p.pts + ' sees off ' + nm(g, l);
  return nm(g, w) + ' beat ' + nm(g, l) + ' ' + sc;
}

/* Which facts the standfirst has already spent, so the body does not hand the
   reader the same two numbers again eight lines later. Set by standfirst(),
   read by the sections. */
let SPENT = new Set();

/* ---------------------------------------------------------------------------
   THE STANDFIRST IS A HOOK, NOT A SUMMARY.

   It carried two facts and the body then restated both, in the same figures:

     "A 6:31 stretch swung it by 14. East Dock controlled the offensive glass,
      41.2% to 25.0%."
     … "41.2% of their misses came back to them, against 25.0%"
     … "they gained 14 points in that stretch alone"

   A standfirst previewing the story is normal; a standfirst that IS the story,
   printed twice, is not. So it takes the single sharpest fact available and
   records it, and the section that would otherwise repeat the same figures
   says something else about it instead. */
function standfirst(g, fs) {
  const bits = [];
  const decisive = fs.find(f => f.kind === 'stretch' || f.kind === 'run');
  if (decisive) SPENT.add(decisive.kind);
  if (decisive) {
    bits.push(decisive.kind === 'run'
      ? anFor(decisive.data.n).toUpperCase().slice(0,1) + anFor(decisive.data.n).slice(1) + ' ' + decisive.data.n + '–0 run in the ' + ordinal(decisive.data.period) + ' settled it'
      : 'A ' + mins(decisive.data.dur) + ' stretch swung it by ' + decisive.data.swing);
  }
  const factor = fs.find(f => f.kind === 'factor');
  if (factor) {
    /* Said the way the game says it, and never as a bare percentage for
       free-throw rate, which is attempts per field-goal attempt rather than a
       percentage of anything. */
    const mine = factor.side === 0 ? factor.data.a : factor.data.b;
    const theirs = factor.side === 0 ? factor.data.b : factor.data.a;
    const who = nm(g, factor.side);
    /* the body's four-factor sentence skips this one: the same two figures a paragraph apart
       read as the writer forgetting what it had just said */
    SPENT.add('factor:' + factor.data.factor);
    /* THE CLUB NAME DOES NOT LEAD THIS LINE.

       It used to — "East Dock controlled the offensive glass, 41.2% to 25.0%"
       — and the body then opened sentences with the same club, which is the
       single most reliable smell of generated prose and measurably the worst
       repetition in these reports. The fact is unchanged; the club is named
       inside the clause rather than in front of it, so the standfirst and the
       first body sentence no longer start the same way. */
    bits.push(
      factor.data.factor === 'efg'  ? 'The shooting went ' + possOf(who) + ' way, ' + pct1(mine) + ' eFG to ' + pct1(theirs)
    : factor.data.factor === 'tov'  ? 'Possessions decided it: ' + pct1(mine) + ' turnover rate for ' + who + ', ' + pct1(theirs) + ' against'
    : factor.data.factor === 'oreb' ? 'The offensive glass belonged to ' + who + ', ' + pct1(mine) + ' to ' + pct1(theirs)
    : 'The whistle sent ' + who + ' to the line far more often');
  }
  if (!bits.length) {
    const fin = fs.find(f => f.kind === 'stolenLate' || f.kind === 'closeFinish' || f.kind === 'heldOn' || f.kind === 'pulledAway');
    const half = fs.find(f => f.kind === 'turnedAfterHalf');
    const r = fs.find(f => f.kind === 'result');
    if (fin) {
      SPENT.add('finish');
      const a = fin.data.at5, w = fin.data.winner;
      bits.push(fin.kind === 'stolenLate' ? nm(g, w) + ' were ' + Math.abs(fin.data.lead5) + ' down with five minutes left'
              : fin.kind === 'heldOn' ? 'A ' + fin.data.lead5 + '-point lead with five to play nearly went'
              : fin.kind === 'pulledAway' ? 'It was ' + Math.max(a[0], a[1]) + '\u2013' + Math.min(a[0], a[1]) + ' with five minutes left, and then it was not'
              : 'It was ' + Math.max(a[0], a[1]) + '\u2013' + Math.min(a[0], a[1]) + ' with five to play');
    } else if (half) {
      SPENT.add('half');
      bits.push(nm(g, half.side) + ' trailed by ' + half.data.deficit + ' at the break and won the second half by ' + half.data.secondHalf);
    } else {
      bits.push(r ? (r.data.how === 'close' ? 'It stayed tight throughout'
                                            : 'A ' + r.data.margin + '-point margin')
                  : 'Full time');
    }
  }
  /* TWO FACTS, BUT NOT THE SAME TWO THE BODY LEADS WITH.

     Cutting this to one line removed a real duplication and took a whole
     category of coverage with it — the second bit is usually the only place a
     shooting or rebounding edge gets named at all, and reports measurably
     stopped mentioning individuals. A standfirst previewing the story is
     normal journalism; what is not is handing back the SAME figures in the
     same framing eight lines later, and that is what SPENT prevents. */
  return bits.join('. ') + '.';
}


/* Sentences joined by meaning rather than by full stops. Measured at one
   connective per report before this, which is what makes a run of true
   statements read as a list: nothing tells the reader how one fact bears on
   the next. The set is small and plain on purpose — a report that reaches for
   "moreover" is worse than one that repeats "and". */
function joinSentences(parts, mode) {
  const list = parts.filter(Boolean);
  if (list.length <= 1) return list.join(' ');
  /* THREE CLAUSES IS THE LIMIT. Joining everything produced a 48-word sentence
     with three separate numbers in it — the connectives were meant to turn a
     list into an argument, not to weld the list into one line. Anything past
     the third clause stays a sentence of its own. */
  if (list.length > 3) {
    return joinSentences(list.slice(0, 2), mode) + ' ' + list.slice(2).join(' ');
  }
  const links = mode === 'contrast'
    ? [', but ', ', though ', '. Even so, ']
    : mode === 'cause'
      ? [', so ', ', which is why ', '. From there, ']
      : [', and ', '. ', '. '];
  let out = list[0];
  /* a clause that opens with its own connective ("Even so, ...") is a sentence: welded on with
     ", and" it read "the game never came back, and even so, they took the period" */
  const ownLink = /^(Even so|But|Still|However|Yet|Instead|Meanwhile)\b/;
  for (let i = 1; i < list.length; i++) {
    /* ONE ", and" TO A SENTENCE: a clause that has already been welded to the last with one (or has its
       own inside it) starts a sentence, so a paragraph does not read as a single breathless line */
    const chained = out.indexOf(', and ') >= 0 && links[(i - 1) % links.length] === ', and ';
    const link = ownLink.test(list[i]) || chained ? '. ' : links[(i - 1) % links.length];
    const next = link.startsWith('.') ? list[i] : lower(list[i], PROPER);
    out = out.replace(/\.$/, '') + link + next;
  }
  return out;
}
/* lower-case the first letter of a clause being joined mid-sentence, unless it
   is a proper noun the writer capitalised on purpose */
function lower(sentence, proper) {
  const first = sentence.split(' ')[0];
  /* A capitalised word at the front of a clause is either a sentence opener
     (lower it) or a proper noun (leave it). Club and player names are the
     proper nouns here, and lowering one produced "and east Dock moved it
     well". A following capitalised word is the other giveaway — "East Dock",
     "Soft Club" — so a two-word name survives even when it is not on the list. */
  if (!/^[A-Z][a-z]*$/.test(first)) return sentence;
  if (proper && proper.has(first)) return sentence;
  const next = sentence.split(' ')[1] || '';
  if (/^[A-Z]/.test(next)) return sentence;
  return first.toLowerCase() + sentence.slice(first.length);
}
/* Which openers keep their capital when a clause is joined mid-sentence.
   NOT 'They': the whole point of joining is that the clause is no longer
   starting a sentence, and "took this 86-82, and They led by 11" is the
   join announcing itself. Only true proper nouns survive, and those are
   already capitalised by tc() rather than listed here. */
/* The proper nouns that actually appear at the front of a joined clause: the
   two clubs. Set per report by report(), because a one-word club name has no
   second capital for the heuristic in lower() to catch.

   NOT a list of sentence openers. An earlier version put They, It and There
   in here to stop them being lowered, which is exactly backwards — those are
   the words that MUST lower when a clause stops starting a sentence, and the
   result was "and They led by as many as 11". */
let PROPER = new Set();

/* ------------------------------------------------------------- sections --- */
function sectionFlow(g, fs, R) {
  const out = [];
  const r  = fs.find(f => f.kind === 'result');
  if (!r) return out;
  const cb = fs.find(f => f.kind === 'comeback');
  const bl = fs.find(f => f.kind === 'biggestLead');
  const run = fs.find(f => f.kind === 'run');
  const q  = fs.find(f => f.kind === 'quarter');
  const lc = fs.find(f => f.kind === 'leadChanges');
  const sw = fs.find(f => f.kind === 'sweep');
  const tempo = fs.find(f => f.kind === 'fast' || f.kind === 'slow');
  const above = fs.find(f => f.kind === 'teamAbove' || f.kind === 'teamBelow');

  const hi = Math.max(g.score[0], g.score[1]), lo = Math.min(g.score[0], g.score[1]);
  const W = R.subj(r.data.winner);        // resolved once, before the options
  const where = dateline(g, fs);
  const comp = (fs.find(f => f.kind === 'meta') || { data: {} }).data.competition;
  const inComp = comp ? ' in ' + (/^(the|division|league|cup|trophy|playoff)/i.test(String(comp)) ? '' : 'the ') + esc(String(comp)) : '';
  /* THE DATELINE LEADS when the fixture carries one: a report that knows where
     and when it happened says so first, the way a paper does. The winner is
     then named mid-sentence, which also stops the club name opening the piece
     and the next sentence in a row. */
  const opening = where
    ? pick('open' + hi + lo + r.data.how, [
        where.charAt(0).toUpperCase() + where.slice(1) + ', ' + midCase(W) + ' beat ' + R.obj(r.data.loser) + ' ' + hi + '\u2013' + lo + inComp +
          (r.data.how === 'rout' ? ', and it was never close.' : r.data.how === 'squeaker' ? ', and it took everything they had.' : '.'),
        W + ' took this ' + hi + '\u2013' + lo + ' ' + where + inComp +
          (r.data.how === 'rout' ? ', and were rarely troubled.' : r.data.how === 'comfortable' ? ', pulling clear when it mattered.' : '.'),
        'It finished ' + hi + '\u2013' + lo + ' to ' + midCase(W) + ' ' + where + inComp + '.'
      ])
    : pick('open' + hi + lo + r.data.how, [
        W + ' took this ' + hi + '\u2013' + lo +
          (r.data.how === 'rout' ? ', and it was never close'
           : r.data.how === 'squeaker' ? ', on a night that could have gone either way'
           : r.data.how === 'comfortable' ? ', pulling clear when it mattered' : '') + '.',
        W + ' came through ' + hi + '\u2013' + lo +
          (r.data.how === 'squeaker' ? ', but only just.'
           : r.data.how === 'rout' ? ', and were rarely troubled.' : '.'),
        (r.data.how === 'rout' ? 'This was over early. ' : '') + W + ' won it ' +
          hi + '\u2013' + lo + '.',
        'It finished ' + hi + '\u2013' + lo + ' to ' + W + '.'
      ]);
  const turnedEarly = fs.find(f => f.kind === 'turnedAfterHalf');
  const second = (cb && !turnedEarly)
    ? R.subj(r.data.winner) + ' had trailed by ' + cb.data.deficit +
      ', which makes this the sort of result that says more about the second ' +
      'half than the first.'
    /* Not after "it was never close" or "were rarely troubled" — the margin is
       the same observation a second time, and the two joined with "and" is the
       writer agreeing with itself: "took this 126–92, and it was never close,
       and they led by as many as 38". */
    : (bl && !/never close|rarely troubled|over early/.test(opening))
      ? R.subj(bl.side, { allowRole: true }) + ' led by as many as ' + bl.data.by + '.'
    : null;
  out.push(joinSentences([opening, second], 'plain'));

  /* THE HALF. Every match report in every paper says what the score was at the
     break, because it is the one number a reader uses to picture the game's
     shape. Said once, plainly, unless the standfirst already spent it. */
  const half = fs.find(f => f.kind === 'half');
  const turned = fs.find(f => f.kind === 'turnedAfterHalf');
  const overBy = fs.find(f => f.kind === 'overByHalf');
  const surge = fs.find(f => f.kind === 'secondHalfSurge');
  const ot = fs.find(f => f.kind === 'overtime');
  const halfBits = [];
  if (half && !SPENT.has('half')) {
    const h = half.data.h1, lead = h[0] === h[1] ? null : (h[0] > h[1] ? 0 : 1);
    if (turned) {
      R.neutral();
      const leader = nm(g, 1 - turned.side), winner = nm(g, turned.side);
      halfBits.push(pick('turned' + turned.data.deficit, [
        'It did not look that way at the break, when ' + leader + ' led ' + Math.max(h[0], h[1]) + '\u2013' + Math.min(h[0], h[1]) + '.',
        winner + ' went in ' + turned.data.deficit + ' down at half-time, ' + Math.min(h[0], h[1]) + '\u2013' + Math.max(h[0], h[1]) + ', and won the second half by ' + turned.data.secondHalf + '.'
      ]));
      R.neutral();
    } else if (lead == null) {
      halfBits.push('The sides went in level at ' + h[0] + ' apiece.');
    } else if (overBy) {
      halfBits.push(R.subj(overBy.side, { allowRole: true }) + ' had the game won by half-time, ' + h[lead] + '\u2013' + h[1 - lead] + ' at the break.');
    } else {
      const who = R.obj(lead);                       // resolved once: a plain club name in every option
      halfBits.push(pick('half' + h[0] + h[1], [
        'It was ' + h[lead] + '\u2013' + h[1 - lead] + ' to ' + who + ' at half-time.',
        who + ' led ' + h[lead] + '\u2013' + h[1 - lead] + ' at the break.',
        'The half-time score was ' + h[lead] + '\u2013' + h[1 - lead] + ', ' + who + ' in front.'
      ]));
      if (surge) halfBits.push(R.subj(surge.side) + ' won the second half by ' + surge.data.secondHalf + '.');
    }
  }
  if (ot) {
    R.neutral();
    const reg = ot.data.reg, o = ot.data.ot;
    halfBits.push('It took ' + (ot.data.ots > 1 ? ot.data.ots + ' overtimes' : 'overtime') + ': ' + reg[0] + '\u2013' + reg[1] +
      ' after forty minutes, and ' + R.subj(ot.side) + ' won the extra ' + (ot.data.ots > 1 ? 'periods' : 'period') + ' ' +
      o[ot.side] + '\u2013' + o[1 - ot.side] + '.');
  }
  if (halfBits.length) out.push(joinSentences(halfBits, 'plain'));

  /* ---------------------------------------------------------------------------
     THE SECTION MUST NOT ARGUE WITH ITSELF.

     Four facts wanted to speak here and each was true on its own, so all four
     were printed and the paragraph contradicted itself in public:

       "East Dock took this 126–92, and it was never close … There were 13 lead
        changes, so neither side ever properly settled."

     A 34-point win is not a game where neither side settled, and a reader does
     not have to be told twice to notice. Lead changes are an EARLY-GAME fact
     in a rout — the sides traded the lead before one of them left — so in that
     game it is said that way, and the "neither side settled" reading is kept
     for the games where it is actually true.

     THE SAME PERIOD, CLAIMED TWICE. A decisive run and the quarter that
     separated the sides are usually the same event seen twice, and printing
     both gave "it turned on an 11–0 burst in the fourth … and they won the
     fourth 32–16, the period that separated them". When the periods match, the
     run is the sharper fact and the quarter becomes its score rather than a
     second claim. */
  const routish = r.data.how === 'rout' ||
                  Math.abs(g.score[0] - g.score[1]) >= 20;
  const sameSpell = run && q && run.data.period === q.data.period;

  const mid = [];
  if (run) {
    /* This carried one fixed image — "a lead built and an opponent's rhythm
       taken away in the same breath" — in every report the platform had ever
       written. A phrase that good is worse than a plain one when it is the
       only phrase available: a reader who follows a league sees it weekly and
       it stops meaning anything. */
    /* A RUN ONLY "DECIDED IT" WHEN IT DID. These phrasings all claim the game was settled --
       "a lead that held", "the game never really came back" -- and were being used about an
       80-78 game with 26 lead changes, and about runs by the side that lost (read-through,
       2026-09-23). They are kept for a run by the winner in a game that was comfortable or
       more; anything else is told as what it was, the biggest swing, with whose it was. */
    const held = run.data.team === r.data.winner && ['comfortable', 'convincing', 'rout'].indexOf(r.data.how) >= 0;
    const theRun = anFor(run.data.n) + ' ' + run.data.n + '\u20130 run in the ' + ordinal(run.data.period);
    mid.push(held ? pick('run' + run.data.n + run.data.period, [
      'The decisive spell was ' + theRun + ', long enough to turn a close game into a lead that held.',
      'It turned on ' + anFor(run.data.n) + ' ' + run.data.n + '\u20130 burst in the ' +
        ordinal(run.data.period) + ', and the other side never got back into it.',
      theRun.charAt(0).toUpperCase() + theRun.slice(1) + ' did the damage. The game never really came back.',
      'The gap opened during ' + theRun + '.'
    ]) : (seedOf('swing' + run.data.n + run.data.period) % 2 === 0
      ? 'The biggest swing was ' + theRun + ' from ' + R.obj(run.data.team)
      : 'The longest run of the game was ' + nmPoss(g, run.data.team) + ' ' + run.data.n + '\u20130 in the ' + ordinal(run.data.period)
    ) + (run.data.team === r.data.winner ? '.' : '. It was not enough.'));
  }
  if (q && sameSpell) {
    /* One event, one sentence: the run is the detail, the quarter score is the
       size of it. Two sentences about the same ten minutes read as two
       different turning points. When the run and the quarter went to different
       sides, that is the point, and it is said as one. */
    const opp = run && q.side !== run.data.team;
    mid.push((opp ? 'Even so, ' + midCase(R.subj(q.side, { allowRole: true })) : R.subj(q.side, { allowRole: true })) + ' took the period ' +
      Math.max(q.data.pf, q.data.pa) + '\u2013' + Math.min(q.data.pf, q.data.pa) + '.');
  } else if (q) {
    /* ONLY ONE THING CAN BE THE THING THAT DECIDED IT.

       With a decisive run already named in another period, calling this "the
       period that separated them" gives the reader two answers to the same
       question: "the decisive spell was an 11\u20130 run in the third \u2026 and they
       won the first 24\u201316, the period that separated them." When a run has
       already been claimed, the quarter is context for it \u2014 what the run was
       built on, or what it overturned \u2014 and is said as a plain fact. */
    const sep = run ? '.' : ', the period that separated them.';
    mid.push(R.subj(q.side, { allowRole: true, noPronoun: !!run && run.data.team !== q.side }) +
      (run && q.data.period < run.data.period ? ' had already taken the ' : ' won the ') +
      ordinal(q.data.period) + ' ' +
      Math.max(q.data.pf, q.data.pa) + '\u2013' + Math.min(q.data.pf, q.data.pa) + sep);
  }
  /* In front at every break and a game nobody settled into are different
     games. The sweep is the harder fact, so it wins and the other is dropped. */
  if (sw) mid.push(R.subj(sw.side) + ' were in front at every break.');
  const early = fs.find(f => f.kind === 'earlyLead');
  /* An early lead is worth a sentence when it did not last (the game turned) or when nothing
     else has been said about how it went. After "they won the third 23–6", "They were 10–2 up
     early" walks the reader back to the first minutes for no reason. */
  if (early && !sw && !(run && run.data.period === 1) &&
      (early.side !== r.data.winner || (!q && !run))) {
    mid.push(R.subj(early.side, { allowRole: true }) + ' were ' + early.data.score[early.side] + '\u2013' + early.data.score[1 - early.side] + ' up early' +
      (early.side !== r.data.winner ? ', and it did not last.' : '.'));
  }
  const ties = fs.find(f => f.kind === 'ties');
  if (lc) {
    R.neutral();
    mid.push(routish
      /* the lead changed hands, and then it stopped: that is the story of the
         first half of a rout, not of the game */
      ? 'The lead had changed ' + plural(lc.data.changes, 'time') + ' before that.'
      : 'There were ' + plural(lc.data.changes, 'lead change') + (ties ? ' and the scores were level ' + spell(ties.data.ties) + ' times' : '') +
        ', so neither side ever properly settled.');
  } else if (ties && !routish) {
    R.neutral();
    mid.push('The scores were level ' + spell(ties.data.ties) + ' times.');
  }
  if (mid.length) out.push(joinSentences(mid, 'plain'));

  /* WHO WAS IN FRONT, AND FOR HOW LONG: the share of the clock each side led (story.js factTimeLed) */
  const led = fs.find(f => f.kind === 'timeLed');
  if (led) {
    R.neutral();
    const d = led.data, total0 = Math.round(d.total / 60000), mine0 = Math.round(d.led[led.side] / 60000);
    const [mine, total] = L().spellSet([mine0, total0]);
    const who = R.subj(led.side, { allowRole: true, noPronoun: true });
    out.push(d.kind === 'ledMost'
      ? pick('ledmost' + led.side + mine0, [
          who + ' were in front for ' + mine + ' of the ' + total + ' minutes and still lost.',
          'For ' + mine + ' of the ' + total + ' minutes it was ' + nmPoss(g, led.side) + ' game, and they lost it anyway.',
          who + ' led for most of it, ' + mine + ' of the ' + total + ' minutes, and it was not enough.'
        ])
      : pick('wire' + led.side + mine0, [
          who + ' were in front for ' + mine + ' of the ' + total + ' minutes.',
          who + ' led almost from the first basket to the last: ' + mine + ' of the ' + total + ' minutes.',
          'It was ' + nmPoss(g, led.side) + ' game from the start, in front for ' + mine + ' of the ' + total + ' minutes.'
        ]));
  }

  /* THE FINISH. What happened in the last five minutes is the paragraph a
     person who was there would write first and this report never wrote at
     all. Only when the log carries a clock. */
  const fin = fs.find(f => f.kind === 'stolenLate' || f.kind === 'closeFinish' || f.kind === 'heldOn' || f.kind === 'pulledAway');
  const closing = fs.find(f => f.kind === 'closing');
  const lastPts = fs.find(f => f.kind === 'lastPoints');
  const iced = fs.find(f => f.kind === 'icedIt');
  const cost = fs.find(f => f.kind === 'lineCostThem');
  const endBits = [];
  if (fin && closing) {
    const a = fin.data.at5, w = fin.data.winner, l = 1 - w, late = fin.data.late;
    const lead5 = fin.data.lead5;
    R.neutral();
    if (!SPENT.has('finish')) {
      const gap = Math.abs(lead5);
      const gapWords = gap === 0 ? 'level' : 'a ' + spell(gap) + '-point game';
      const WN = nm(g, w), LN = nm(g, l);          // plain names: these sentences open a new thought
      R.neutral();
      if (fin.kind === 'stolenLate') {
        endBits.push(WN + ' were ' + spell(gap) + ' down with five minutes left and outscored ' + LN + ' ' + late[w] + '\u2013' + late[l] + ' from there.');
      } else if (fin.kind === 'closeFinish') {
        endBits.push(pick('close' + a[0] + a[1], [
          'It was ' + gapWords + ' with five minutes to play, and ' + WN + ' finished it ' + late[w] + '\u2013' + late[l] + '.',
          'Five minutes out it was ' + gapWords + (gap ? ', ' + (lead5 > 0 ? WN : LN) + ' ahead' : '') + ', and the last five went ' + late[w] + '\u2013' + late[l] + ' to ' + WN + '.'
        ]));
      } else if (fin.kind === 'pulledAway') {
        endBits.push(pick('pull' + a[0] + a[1], [
          'It was still ' + gapWords + ' with five minutes left before ' + WN + ' closed it out ' + late[w] + '\u2013' + late[l] + '.',
          'The margin was ' + (gap ? 'only ' + spell(gap) : 'nothing') + ' with five to play, and then ' + WN + ' finished ' + late[w] + '\u2013' + late[l] + '.'
        ]));
      } else if (fin.kind === 'heldOn') {
        endBits.push(WN + ' led by ' + spell(lead5) + ' with five minutes to go and had to hang on, ' + LN + ' taking the last five ' + late[l] + '\u2013' + late[w] + '.');
      }
      R.neutral();
    } else {
      /* the standfirst gave the score with five to play; say what the finish looked like */
      endBits.push('The last five minutes went ' + late[w] + '\u2013' + late[l] + ' to ' + R.obj(w) + '.');
    }
  }
  if (lastPts && (!fin || fin.kind !== 'pulledAway')) {
    endBits.push(R.subj(lastPts.side) + ' scored the last ' + spell(lastPts.data.n) + ' points of the game.');
  }
  if (iced) {
    /* straight after a finish sentence that has just named the same winner, "they" */
    const sameAsFinish = endBits.length && fin && closing && iced.side === fin.data.winner;
    endBits.push((sameAsFinish ? 'They' : R.subj(iced.side)) + ' went ' + spell(iced.data.made) + ' of ' + spell(iced.data.att) + ' from the line in the last two minutes to see it out.');
  } else if (cost) {
    endBits.push(R.subj(cost.side) + ' missed ' + spell(cost.data.att - cost.data.made) + ' of ' + spell(cost.data.att) + ' free throws in the last two minutes, in a game they lost by ' + cost.data.margin + '.');
  }
  /* a finish sentence that already has its own ", and" stays a sentence: welding the next one
     on gave "..., and the last five went 16-13 to Bristol Flyers, and Bristol Flyers went..." */
  if (endBits.length) out.push(endBits.some(b => b.indexOf(', and ') >= 0) ? endBits.join(' ') : joinSentences(endBits, 'plain'));

  /* tempo and season context close the section, because they are the frame
     rather than the events */
  const frame = [];
  if (tempo) {
    R.neutral();
    const pl = fs.find(f => f.kind === 'paceVsLeague');
    const lgTail = pl ? (pl.data.faster ? ', quicker than this league\u2019s usual ' : ', slower than this league\u2019s usual ') + Math.round(pl.data.league) : '';
    frame.push(tempo.kind === 'fast'
      ? 'It was played at speed, ' + one(tempo.data.pace) + ' possessions per 40' + lgTail
      : 'It was a slow, half-court game at ' + one(tempo.data.pace) + ' possessions per 40' + lgTail);
  }
  if (above) {
    frame.push(R.subj(above.side, { allowRole: true }) +
      (above.kind === 'teamAbove'
        ? ' finished on ' + above.data.scored + ' against a season average of ' +
          one(above.data.avg)
        : ' were held to ' + above.data.scored + ', well short of the ' +
          one(above.data.avg) + ' they usually manage'));
  }
  if (frame.length) out.push(joinSentences(frame, 'contrast') + '.');
  return out;
}

/* ---------------------------------------------------------------------------
   WHERE THE POINTS CAME FROM — the events tab, in words.

   The box line already says "scored 18 on the break". What it cannot say is how many chances
   that took, whether getting that many is unusual for this league, or how the two sides did
   in the half court, where most of any game is played. story.js's situation facts carry all
   of that; this turns them into one paragraph. `tense` is 'past' for the match report and
   'present' for the half-time report, which asks the same questions of a game still going.

   A share of chances is only mentioned when it is unusual against the league (the 75th
   percentile and up, the 25th and down): "12% of their chances came that way" is noise unless
   it is a lot or a little, and a reader cannot tell which without being told.
   --------------------------------------------------------------------------- */
const ppc = v => (v == null ? '–' : (+v).toFixed(2));
function freqWords(p) {
  if (p == null) return '';
  if (p >= 90) return 'a share few sides in this league ever reach';
  if (p >= 75) return 'more than most sides manage';
  if (p <= 10) return 'as few as any side in this league gets';
  if (p <= 25) return 'fewer than most sides get';
  return '';
}
/* which box-line facts the situations paragraph makes redundant: it gives the same points
   plus the chances behind them, so the plain count is dropped rather than said twice */
function sitCovers(fs) {
  const e = fs.find(f => f.kind === 'sitEdge');
  return e ? e.data.key : null;
}
function sitSentences(g, fs, R, tense) {
  const now = tense === 'present';
  const bits = [];
  const edge = fs.find(f => f.kind === 'sitEdge');
  if (edge) {
    const m = edge.data.mine, o = edge.data.theirs, k = edge.data.key, where = edge.data.where;
    /* The two figures that belong together stay together: THEIR points, THEIR chances and
       what that came to a time; then the other side's points, named, so "to 17" is never left
       for the reader to attach. Only the chosen phrasing is built, because building both would
       spend the referrer twice. */
    const other = nmPoss(g, 1 - edge.side);
    const rate = m.ppp != null ? ', ' + ppc(m.ppp) + ' a time' : '';
    const Where = where.charAt(0).toUpperCase() + where.slice(1);
    let s;
    if (seedOf('sit' + k + edge.side + tense) % 2 === 0) {
      s = R.subj(edge.side) + (now ? ' have the edge ' : ' had the edge ') + where + ': ' + m.pts + ' points from ' +
        plural(m.chances, 'chance') + rate + ', against ' + other + ' ' + o.pts;
    } else {
      R.subj(edge.side, { noPronoun: true });                          // named below, not pronominalised
      s = Where + (now ? ' it is ' : ' it was ') + m.pts + '–' + o.pts + ' to ' + nm(g, edge.side) +
        (now ? ' so far' : '') + ', from ' + plural(m.chances, 'chance') + rate;
    }
    const fw = m.freqPct != null && m.freqPct >= 75 ? freqWords(m.freqPct) : '';
    if (fw && m.freq != null) s += '. They ' + (now ? 'are getting ' : 'got ') + Math.round(m.freq) + '% of their chances that way, ' + fw;
    bits.push(s + '.');
  }
  const hc = fs.find(f => f.kind === 'halfCourt');
  if (hc) {
    const m = hc.data.mine, o = hc.data.theirs;
    const who = R.subj(hc.side, { allowRole: !now, noPronoun: !!edge && edge.side !== hc.side });
    bits.push(pick('hc' + hc.side + tense, now ? [
      'In the half court ' + midCase(who) + ' are getting ' + ppc(m.ppp) + ' points a chance to ' + ppc(o.ppp),
      who + ' have been the better set offence, ' + ppc(m.ppp) + ' a chance in the half court against ' + ppc(o.ppp)
    ] : [
      'In the half court, where most of any game is played, ' + midCase(who) + ' scored ' + ppc(m.ppp) + ' points a chance to ' + ppc(o.ppp),
      who + ' were the better set offence — ' + ppc(m.ppp) + ' points a chance in the half court against ' + ppc(o.ppp)
    ]) + '.');
  }
  fs.filter(f => f.kind === 'sitStyle' && !(edge && edge.side === f.side && edge.data.key === f.data.key)).slice(0, 1).forEach(f => {
    const fw = freqWords(f.data.pct);
    if (!fw) return;
    const who = R.subj(f.side);
    bits.push(who + (now ? ' are living ' : ' lived ') + f.data.where + ': ' + Math.round(f.data.freq) + '% of their chances ' +
      (now ? 'have come' : 'came') + ' that way, ' + fw + '.');
  });
  const ato = fs.find(f => f.kind === 'atoSharp') || fs.find(f => f.kind === 'atoBlank');
  if (ato) {
    const x = ato.data, who = R.subj(ato.side);
    const tally = spell(x.pts) + (x.pts === 1 ? ' point' : ' points') + ' from ' + spell(x.chances) + ' possessions';
    bits.push(ato.kind === 'atoSharp'
      ? 'Out of timeouts ' + midCase(who) + (now ? ' have been' : ' were') + ' sharp: ' + tally + '.'
      : who + (now ? ' are getting' : ' got') + ' nothing out of their timeouts, ' + tally + '.');
  }
  return bits;
}

function sectionNumbers(g, fs, R) {
  const out = [];
  R.neutral();                     // a new section: name the club again before any "they"
  const covered = sitCovers(fs);

  /* THE BOX SCORE, SAID. Field-goal percentage, the three-point line, the free
     throws, the boards and the break, each only when it says something, and
     never more than one figure pair to a clause. */
  const floor = fs.find(f => f.kind === 'floor');
  const hot = fs.find(f => f.kind === 'hotThree'), cold = fs.find(f => f.kind === 'coldThree');
  const poorL = fs.find(f => f.kind === 'poorLine');
  const boards = fs.find(f => f.kind === 'boards');
  const fb = covered === 'transition' ? null : fs.find(f => f.kind === 'fastBreak');
  const careless = fs.find(f => f.kind === 'careless');
  const drought = fs.filter(f => f.kind === 'drought').sort((a, b) => b.data.dur - a.data.dur)[0];
  const box = [];
  if (floor && Math.abs(floor.data.a - floor.data.b) >= 5) {
    const hiP = Math.max(floor.data.a, floor.data.b), loP = Math.min(floor.data.a, floor.data.b);
    const who = R.subj(floor.side, { allowRole: true, noPronoun: true });   // resolved once, before the options
    box.push(pick('floor' + Math.round(hiP), [
      'From the floor it was ' + Math.round(hiP) + '% to ' + Math.round(loP) + '% in ' + possOf(midCase(who)) + ' favour',
      who + ' shot ' + Math.round(hiP) + '% from the field to ' + Math.round(loP) + '%'
    ]));
  }
  if (hot) box.push(R.subj(hot.side, { allowRole: true }) + ' made ' + hot.data.m + ' of ' + hot.data.a + ' from three');
  if (cold) box.push(R.subj(cold.side, { allowRole: true }) + ' went ' + cold.data.m + ' of ' + cold.data.a + ' from three');
  if (poorL) box.push(R.subj(poorL.side) + ' made only ' + poorL.data.m + ' of ' + poorL.data.a + ' free throws');
  if (boards) box.push(R.subj(boards.side, { allowRole: true }) + ' won the boards ' + boards.data.mine + '\u2013' + boards.data.theirs);
  if (fb) box.push(R.subj(fb.side, { allowRole: true }) + ' scored ' + fb.data.mine + ' on the break to ' + fb.data.theirs);
  if (careless) box.push(R.subj(careless.side) + ' gave the ball away ' + careless.data.tov + ' times');
  /* two figure pairs to a sentence at most; the rest start a new one */
  for (let i = 0; i < box.length; i += 2) {
    out.push(joinSentences(box.slice(i, i + 2), 'plain') + '.');
  }
  if (drought) {
    R.neutral();
    out.push(R.subj(drought.side) + ' went ' + mins(drought.data.dur) + ' without a field goal in the ' + ordinal(drought.data.period) + '.');
  }

  /* not a second shooting claim for the side the field-goal line has just credited: "The
     winners shot 47% to 37%" followed by "They shot it better, 54.2% eFG" is one fact twice */
  const saidFloor = floor && Math.abs(floor.data.a - floor.data.b) >= 5 ? floor.side : null;
  const factors = fs.filter(f => f.kind === 'factor' && !SPENT.has('factor:' + f.data.factor) &&
    !(f.data.factor === 'efg' && f.side === saidFloor)).slice(0, 3);
  if (factors.length) {
    /* EACH FACTOR IS A DIFFERENT SENTENCE, because each is a different thing.
       "The winners won this at shooting, 55.7% against 49.3%" is not something
       anybody says about basketball, and free-throw rate is not a percentage
       at all — ftr is free-throw attempts per field-goal attempt, so printing
       it as "44.4%" and calling it "winning free throws" described nothing
       real. One figure carries the clause; the card underneath has the rest. */
    const lead = factors[0];
    const mine = lead.side === 0 ? lead.data.a : lead.data.b;
    const theirs = lead.side === 0 ? lead.data.b : lead.data.a;
    const who = R.subj(lead.side, { allowRole: true, noPronoun: lead.data.factor === 'ftr' });
    const sd = 'ff' + lead.data.factor + lead.side;

    let sentence;
    if (lead.data.factor === 'efg') {
      sentence = pick(sd, [
        who + ' shot it better, ' + pct1(mine) + ' eFG against ' + pct1(theirs),
        who + ' were the sharper side from the floor \u2014 ' + pct1(mine) +
          ' eFG to ' + pct1(theirs),
        'The shooting decided it: ' + midCase(who) + ' at ' + pct1(mine) + ' eFG, their ' +
          'opponents at ' + pct1(theirs)
      ]);
    } else if (lead.data.factor === 'tov') {
      sentence = pick(sd, [
        who + ' looked after the ball, giving it up on ' + pct1(mine) +
          ' of their possessions against ' + pct1(theirs),
        who + ' were far the more careful side, a ' + pct1(mine) +
          ' turnover rate to ' + pct1(theirs),
        'Possessions were the difference \u2014 ' + midCase(who) + ' turned it over on ' +
          pct1(mine) + ' of theirs, their opponents on ' + pct1(theirs)
      ]);
    } else if (lead.data.factor === 'oreb') {
      sentence = pick(sd, [
        who + ' owned the offensive glass, rebounding ' + pct1(mine) +
          ' of their own misses to ' + pct1(theirs),
        who + ' kept possessions alive \u2014 ' + pct1(mine) + ' of their misses ' +
          'came back to them, against ' + pct1(theirs),
        'The second shots went one way: ' + midCase(who) + ' recovered ' + pct1(mine) +
          ' of their own misses to ' + pct1(theirs)
      ]);
    } else {
      /* ftr = fta / fga. Said as the ratio it is, never as a percentage. */
      const per = n => Math.round(num(n) || 0);
      sentence = pick(sd, [
        who + ' got to the line far more often \u2014 ' + per(mine) +
          ' free throws for every hundred shots, against ' + per(theirs),
        who + ' lived at the line, drawing ' + per(mine) +
          ' free-throw attempts per hundred field goals to ' + per(theirs),
        'The whistle was kind to ' + midCase(who) + ': ' + per(mine) + ' free throws per hundred ' +
          'shots, against ' + per(theirs) + ' for the other side'
      ]);
    }

    const also = factors.slice(1).filter(f => f.side === lead.side)
      .map(f => f.data.label);
    /* After a dash the tail cannot hang off the sentence: "kept possessions alive — 29.5% of
       their misses came back to them, against 11.6%, and had the better of shooting too" has
       lost its subject by the time it gets there. A sentence with a dash in it gets its own. */
    const dashed = sentence.indexOf('—') >= 0 || sentence.indexOf(': ') >= 0;
    if (also.length === 1) sentence += dashed ? '. They had the better of ' + also[0] + ' too' : ', and had the better of ' + also[0] + ' too';
    else if (also.length > 1) sentence += (dashed ? '. ' + listOf(also).replace(/^./, c => c.toUpperCase()) + ' went their way as well'
      : ', with ' + also.slice(0, -1).join(', ') + ' and ' + also[also.length - 1] + ' going the same way');
    out.push(sentence + '.');
  }

  /* how they scored, not just how well */
  const zone = fs.find(f => f.kind === 'fromRange' || f.kind === 'atRim');
  const asShare = fs.find(f => f.kind === 'assistedShare');
  const share = asShare ? null : fs.find(f => f.kind === 'sharing');
  const shapeBits = [];
  if (zone) {
    /* SHARE OF ATTEMPTS, which is what rimr/p3r measure — the accuracy is a
       different number (rimp/p3p) and gets its own clause when it is worth
       one. The previous version printed the accuracy and called it the share. */
    const acc = num(zone.data.acc) != null
      ? ', and made ' + pct1(zone.data.acc) + ' of them' : '';
    shapeBits.push(R.subj(zone.side, { allowRole: true }) +
      (zone.kind === 'fromRange'
        ? ' took the game outside \u2014 ' + pct1(zone.data.share) +
          ' of their shots came from three, against ' + pct1(zone.data.theirs) + acc
        : ' went inside \u2014 ' + pct1(zone.data.share) +
          ' of their attempts came at the rim, against ' + pct1(zone.data.theirs) + acc));
  }
  if (share) {
    shapeBits.push(R.subj(share.side, { allowRole: true }) + ' moved it well, assisting on ' +
      pct1(share.data.astp) + ' of their field goals');
  }
  if (asShare) {
    const d = asShare.data, hi = asShare.side, lo = 1 - hi;
    const [a1, m1, a2, m2] = L().spellSet([d.assisted[hi], d.made[hi], d.assisted[lo], d.made[lo]]);
    shapeBits.push(R.subj(hi, { allowRole: true }) + ' moved it well: ' + a1 + ' of their ' + m1 +
      ' baskets came off a pass, against ' + a2 + ' of ' + m2 + ' for ' + nm(g, lo));
    if (d.unastPts[lo] - d.unastPts[hi] >= 8) {
      shapeBits.push(nm(g, lo) + ' had to make more of their own shots, with ' + d.unastPts[lo] + ' of their points from baskets nobody set up');
    }
  }
  /* a clause with a dash in it has already used its "and"s; the next one is its own sentence */
  if (shapeBits.length) {
    out.push((shapeBits.some(b => b.indexOf('—') >= 0) ? shapeBits.join('. ') : joinSentences(shapeBits, 'plain')) + '.');
  }

  /* WHAT BECAME OF THE MISSES: a second shot is worth saying once, and not when the offensive-glass factor above already did */
  const mf = fs.find(f => f.kind === 'missFate');
  if (mf && covered !== 'second' && !factors.some(f => f.data.factor === 'oreb')) {
    R.neutral();
    const d = mf.data, who = R.subj(mf.side, { allowRole: true, noPronoun: true });
    const [o1, m1, o2, m2] = L().spellSet([d.orb, d.misses, d.theirs.orb, d.theirs.misses]);      // one style for all four figures
    out.push(pick('missfate' + mf.side + d.orb, [
      who + ' won the ball back on ' + o1 + ' of their ' + m1 + ' misses, against ' + o2 + ' of ' + m2 + ' for ' + nm(g, 1 - mf.side) + '.',
      'Misses were not the end of it for ' + midCase(who) + ': ' + o1 + ' of ' + m1 + ' came back to them, to ' + o2 + ' of ' + m2 + ' for the other side.'
    ]));
  }

  /* where the points came from, as one paragraph */
  R.neutral();
  const sitBits = sitSentences(g, fs, R, 'past');
  if (sitBits.length) out.push(sitBits.join(' '));

  /* the defensive half, which the report used never to mention */
  const dr = fs.find(f => f.kind === 'defRating');
  const forced = fs.find(f => f.kind === 'forcedTurnovers');
  const disrupt = fs.find(f => f.kind === 'disruption');
  const defBits = [];
  if (dr) {
    defBits.push(R.subj(dr.side, { allowRole: true }) + ' defended better, allowing ' +
      one(dr.data.drtg) + ' points per 100 possessions where the other side allowed ' +
      one(dr.data.theirs));
  }
  if (forced) {
    defBits.push(R.subj(forced.side) + ' forced the ball loose all night \u2014 ' +
      'their opponents coughed it up on ' + pct1(forced.data.rate) +
      ' of possessions');
  }
  if (disrupt && !forced) {
    defBits.push(R.poss(disrupt.side) + ' hands were everywhere: ' +
      plural(disrupt.data.stl, 'steal') + ' and ' +
      plural(disrupt.data.blk, 'block'));
  }
  /* Never "so". It once welded one club's rating to the other's steals, which read as one
     causing the other; and even about one side, "giving up 92 per 100, so they forced the
     ball loose" runs the causation backwards -- the forced turnovers are part of WHY the
     rating was low. */
  if (defBits.length) out.push(joinSentences(defBits, 'plain') + '.');

  /* the team-shape numbers */
  let shape = fs.filter(f =>
    ['bench', 'pointsOffTurnovers', 'paint', 'secondChance'].indexOf(f.kind) >= 0)
    .filter(f => !(covered === 'second' && f.kind === 'secondChance') &&
                 !(covered === 'offTo' && f.kind === 'pointsOffTurnovers'));
  const scBoth = shape.filter(f => f.kind === 'secondChance');
  if (scBoth.length === 2) {
    shape = shape.filter(f => f.kind !== 'secondChance');
    const a = scBoth.find(f => f.side === 0), b = scBoth.find(f => f.side === 1);
    R.neutral();
    out.push('Both sides lived off second chances \u2014 ' + a.data.sc + ' points for ' + nm(g, 0) + ', ' + b.data.sc + ' for ' + nm(g, 1) + '.');
  }
  const potBoth = shape.filter(f => f.kind === 'pointsOffTurnovers');
  if (potBoth.length === 2) {
    shape = shape.filter(f => f.kind !== 'pointsOffTurnovers');
    const a = potBoth.find(f => f.side === 0), b = potBoth.find(f => f.side === 1);
    R.neutral();
    out.push('Turnovers were punished at both ends: ' + a.data.pot + ' points off them for ' + nm(g, 0) + ', ' + b.data.pot + ' for ' + nm(g, 1) + '.');
  }
  shape = shape.slice(0, 3);
  if (shape.length) {
    out.push(joinSentences(shape.map(f =>
      f.kind === 'bench' ? R.poss(f.side) + ' bench put up ' + f.data.bench +
        ' to ' + f.data.other
    : f.kind === 'pointsOffTurnovers' ? R.subj(f.side) + ' turned giveaways into ' +
        f.data.pot + ' points'
    : f.kind === 'paint' ? R.subj(f.side) + ' scored ' + f.data.a +
        ' in the paint to ' + f.data.b
    : R.subj(f.side) + ' found ' + f.data.sc + ' second-chance points'
    ), 'plain') + '.');
  }

  /* the whistle, when it fell one way */
  const w = fs.find(f => f.kind === 'whistle');
  if (w) {
    out.push('The whistle fell one way: ' + midCase(R.subj(w.side, { allowRole: true, noPronoun: true })) +
      ' were called for ' + w.data.mine + ' fouls to ' + w.data.theirs + '.');
  }
  return out;
}

/* ============================================================================
   WHAT THE FOUR FACTORS WERE WORTH: the points added, factor by factor, both sides (the pills on the full stats tab).
   ============================================================================ */
function sectionFactors(g, fs, R) {
  const out = [];
  const pa = fs.find(f => f.kind === 'pointsAdded');
  if (!pa) return out;
  R.neutral();
  const d = pa.data, em = fs.find(f => f.kind === 'estMargin');
  const round = v => Math.round(Math.abs(v));
  const Lg = L();
  const pts = n => spell(n) + (n === 1 ? ' point' : ' points');

  /* 1. the total, and where it came from */
  if (em) {
    const e = em.data, est = Math.round(e.estimated), who = R.subj(em.side, { allowRole: true, noPronoun: true });
    const other = nm(g, 1 - em.side);
    out.push(pick('estm' + em.side + est, [
      'Add up the four factors and the game was worth about ' + pts(est) + ' to ' + midCase(who) + '.',
      'Weighed factor by factor, ' + midCase(who) + ' came out roughly ' + pts(est) + ' ahead.',
      'The four factors alone make it about ' + pts(est) + ' to ' + midCase(who) + '.'
    ]));
    let split = null;
    if (e.lead && e.lead.pts >= 2) {
      split = 'The biggest gain came from ' + e.lead.label + ', worth ' + pts(round(e.lead.pts)) +
        (e.second ? ', then ' + e.second.label + ' at ' + spell(round(e.second.pts)) : '');
    }
    if (e.against) split = (split ? split + '; ' : '') + other + ' won ' + spell(round(e.against.pts)) + ' back on ' + e.against.label;
    if (split) out.push(split + '.');
  } else {
    out.push('The four factors cancelled out: neither side came out more than ' + pts(3) + ' ahead on them.');
  }

  /* 2. each side's ledger: what it gained, and what it gave back */
  const winner = g.score[0] >= g.score[1] ? 0 : 1;
  [winner, 1 - winner].forEach((t, i) => {
    const gains = d.rows.filter(r => r.pts[t] != null && r.pts[t] >= 1).sort((x, y) => y.pts[t] - x.pts[t]).slice(0, 3);
    const losses = d.rows.filter(r => r.pts[t] != null && r.pts[t] <= -1).sort((x, y) => x.pts[t] - y.pts[t]).slice(0, 2);
    if (!gains.length && !losses.length) return;
    R.neutral();
    const who = R.subj(t, { allowRole: false, noPronoun: true });
    const nums = Lg.spellSet(gains.map(r => round(r.pts[t])).concat(losses.map(r => round(r.pts[t]))));
    const unit = n => (n === '1' || n === 'one' ? ' point' : ' points');
    const gainText = gains.map((r, k) => nums[k] + (k === 0 ? unit(nums[k]) : '') + ' on ' + r.label);
    const lossText = losses.map((r, k) => nums[gains.length + k] + (!gains.length && k === 0 ? unit(nums[k]) : '') + ' on ' + r.label);
    let sentence;
    if (gains.length && losses.length) {
      sentence = who + ' gained ' + Lg.list(gainText) + ', and gave back ' + Lg.list(lossText);
    } else if (gains.length) {
      sentence = who + ' gained ' + Lg.list(gainText) + ' and gave nothing back';
    } else {
      sentence = who + ' gained nothing on any factor and gave up ' + Lg.list(lossText);
    }
    out.push(sentence + '.');
  });

  /* 3. against the scoreboard */
  if (em) {
    const e = em.data, est = Math.round(e.estimated), act = Math.round(e.actual), gap = Math.abs(est - act);
    if (e.agrees && gap <= 4) {
      out.push(pick('estm-agree' + act, ['The scoreboard margin was ' + pts(act) + '.', 'The final margin was ' + pts(act) + ', close to what the factors say.']));
    } else if (e.agrees) {
      out.push('The final margin was ' + pts(act) + ', ' + (act > est ? 'more' : 'less') + ' than the factors alone account for.');
    } else if (e.actualSide != null) {
      out.push('The scoreboard told a different story: ' + nm(g, e.actualSide) + ' won by ' + pts(act) + '.');
    }
  }
  return out;
}

/* ============================================================================
   HOW THE BALL MOVED: the connections tab. Every player sentence names a club.
   ============================================================================ */
function sectionPassing(g, fs, R) {
  const out = [];
  const nameOf = n => esc(tc(n));
  R.neutral();
  const duos = fs.filter(f => f.kind === 'duo').sort((a, b) => b.data.count - a.data.count);
  const hubs = fs.filter(f => f.kind === 'passingHub');
  const fed = fs.filter(f => f.kind === 'fedScorer');
  const used = new Set();
  if (duos.length) {
    const f = duos[0], d = f.data;
    used.add(d.scorer);
    const all3 = d.threes === d.count && d.count >= 2;
    const n = spell(d.count), p = spell(d.points);
    out.push(pick('duo' + f.side + d.count + d.points, [
      'The most productive pairing was ' + nameOf(d.assister) + ' to ' + nameOf(d.scorer) + ' for ' + nm(g, f.side) + ': ' + n + ' baskets worth ' + p + ' points' + (all3 ? ', every one of them a three' : '') + '.',
      nameOf(d.assister) + ' found ' + nameOf(d.scorer) + ' ' + n + ' times for ' + nm(g, f.side) + ', ' + p + ' points in all' + (all3 ? ' and all of them threes' : '') + '.'
    ]));
    const second = duos.find(x => x.side !== f.side && x.data.count >= 3);
    if (second) {
      const d2 = second.data, n2 = spell(d2.count), p2 = spell(d2.points);
      used.add(d2.scorer);
      out.push('For ' + nm(g, second.side) + ', ' + nameOf(d2.assister) + ' and ' + nameOf(d2.scorer) + ' connected ' + n2 + ' times, worth ' + p2 + ' points.');
    }
  }
  hubs.slice(0, 2).forEach(f => {
    const d = f.data;
    const [c, tot] = L().spellSet([d.count, d.total]), tg = spell(d.targets);
    out.push(nameOf(d.name) + ' set up ' + c + ' of ' + nmPoss(g, f.side) + ' ' + tot + ' assisted baskets, finding ' + tg + ' different scorers.');
  });
  fed.filter(f => !used.has(f.data.name)).slice(0, 1).forEach(f => {
    out.push(nameOf(f.data.name) + ' scored ' + f.data.pts + ' points off assists for ' + nm(g, f.side) + '.');
  });
  return out.slice(0, 4);
}

/* ============================================================================
   PLAY TYPES AND REBOUNDS: the play type + reb tab.
   ============================================================================ */
function sectionPlayTypes(g, fs, R) {
  const out = [];
  R.neutral();
  const nameOf = n => esc(tc(n));
  fs.filter(f => f.kind === 'sitLeader').forEach(f => {
    const d = f.data, [p, t] = L().spellSet([d.pts, d.teamPts]);
    out.push(nameOf(d.name) + ' scored ' + p + ' of ' + nm(g, f.side) + '\u2019s ' + t + ' points ' + d.where + '.');
  });
  const mids = fs.filter(f => f.kind === 'midCold');
  if (mids.length === 2) {
    out.push('Neither side found the mid-range: ' + nm(g, mids[0].side) + ' made ' + spell(mids[0].data.m) + ' of ' + spell(mids[0].data.a) + ' from there, ' + nm(g, mids[1].side) + ' ' + spell(mids[1].data.m) + ' of ' + spell(mids[1].data.a) + '.');
  } else if (mids.length === 1) {
    const d = mids[0].data, [m, a] = L().spellSet([d.m, d.a]);
    out.push(nm(g, mids[0].side) + ' could not buy a mid-range basket, ' + m + ' of ' + a + ' from there.');
  }
  const zb = fs.find(f => f.kind === 'zoneBoards');
  if (zb) {
    const d = zb.data, [o1, m1, o2, m2] = L().spellSet([d.mine.o, d.mine.miss, d.theirs.o, d.theirs.miss]);
    out.push(pick('zoneb' + zb.side + d.zone, [
      nm(g, zb.side) + ' got ' + o1 + ' of their ' + m1 + ' misses ' + d.where + ' back, against ' + o2 + ' of ' + m2 + ' for ' + nm(g, 1 - zb.side) + '.',
      'The second shots came ' + d.where + ' for ' + nm(g, zb.side) + ': ' + o1 + ' of ' + m1 + ' misses came back, to ' + o2 + ' of ' + m2 + ' for the other side.'
    ]));
  }
  return out;
}

/* ============================================================================
   THE SHOT CLOCK: how long each side kept the ball, and what the early and the late shots were worth.
   ============================================================================ */
function sectionClock(g, fs, R) {
  const out = [];
  R.neutral();
  const pt = fs.find(f => f.kind === 'possessionTime');
  if (pt) {
    const d = pt.data, who = R.subj(pt.side, { allowRole: true, noPronoun: true });
    out.push(pick('ptime' + pt.side + Math.round(d.slow * 10), [
      who + ' were the more patient side, taking ' + d.slow.toFixed(1) + ' seconds a possession to ' + d.quick.toFixed(1) + ' for ' + nm(g, 1 - pt.side) + '.',
      who + ' used the clock: ' + d.slow.toFixed(1) + ' seconds a possession, against ' + d.quick.toFixed(1) + ' for ' + nm(g, 1 - pt.side) + '.'
    ]));
  }
  const ce = fs.find(f => f.kind === 'clockEarly');
  if (ce) {
    R.neutral();
    const d = ce.data, who = R.subj(ce.side, { allowRole: true, noPronoun: true });
    out.push(who + ' were sharper early in the clock: in the first eight seconds they scored ' + ppc(d.mine.ppp) + ' points a chance, ' + nm(g, 1 - ce.side) + ' ' + ppc(d.theirs.ppp) + '.');
  }
  fs.filter(f => f.kind === 'clockLate').forEach(f => {
    R.neutral();
    const d = f.data, [n, tot] = L().spellSet([d.late.n, d.all.n]);
    out.push(nm(g, f.side) + ' ran the clock down and paid for it: ' + n + ' of their ' + tot + ' chances went past 17 seconds, and they scored ' +
      ppc(d.late.ppp) + ' a time there against ' + ppc(d.all.ppp) + ' overall.');
  });
  return out;
}

/* Enough floor time before a per-100 rate is worth quoting. A group that
   played three minutes has faced perhaps eight possessions, and eight
   possessions produce net ratings like 106.8 — arithmetically correct and
   journalistically meaningless. Below this the sentence reports plus-minus and
   minutes, which are counts and stay true at any sample size. */
const RATE_MIN_MS = 360000;   // six minutes

function sectionLineups(g, fs, R) {
  const out = [];
  R.neutral();                     // a new section: "their" must not lean on the last one
  const stretch = fs.find(f => f.kind === 'stretch');
  const bests = fs.filter(f => f.kind === 'lineupBest');
  const worst = fs.find(f => f.kind === 'lineupWorst');

  /* THE SAME FIVE MINUTES, TOLD ONCE. The deciding stretch, one side's best
     group and the other's worst are frequently the very same passage of play
     seen from three directions. A group is described once, by whichever fact
     ranked highest. */
  const told = new Set();
  const key = f => (f.data.ids || []).slice().sort().join(',') + '@' + f.data.dur;
  /* the same five over a different span: the deciding spell is one unbroken stint, the best
     group is every minute they shared. Named once; the second mention is only the new number. */
  const toldFive = new Set();
  const fiveKey = f => (f.data.ids || []).slice().sort().join(',');

  if (stretch) {
    told.add(key(stretch));
    toldFive.add(fiveKey(stretch));
    const owner = stretch.data.owner, gained = owner === stretch.side;
    /* WHEN THE STANDFIRST HAS ALREADY SPENT THIS, say the part it could not.

       The headline line is "A 6:31 stretch swung it by 14" — a duration and a
       swing. Repeating both eight lines later ("a single 6:31 spell … gained
       14 points in that stretch alone") hands the reader the same two numbers
       twice and tells them nothing new. What the standfirst had no room for is
       WHO was on the floor, which is the only reason this section exists. */
    if (SPENT.has('stretch')) {
      out.push(gained
        ? 'It came with ' + five(g, stretch.data.ids) + ' on the floor for ' + R.obj(owner) + ', together for the whole of it.'
        : 'It was ' + nmPoss(g, owner) + ' worst stretch: ' + five(g, stretch.data.ids) + ' were on the floor, and the other side outscored them by ' +
          stretch.data.swing + ' in that time.');
    } else {
      out.push('The game turned inside a single ' + mins(stretch.data.dur) +
        ' spell with ' + five(g, stretch.data.ids) + ' on the floor for ' +
        R.obj(owner) + ': ' + (gained ? 'they gained ' : 'they were outscored by ') +
        stretch.data.swing + ' points in that stretch alone. Nothing else in the ' +
        'game moved the scoreboard as far in as little time.');
    }
  }
  bests.slice(0, 2).forEach(f => {
    if (told.has(key(f))) return;
    told.add(key(f));
    /* NO PER-100 RATE FOR A SINGLE GAME'S LINEUP, at any duration. Six minutes
       of one game is perhaps a dozen possessions, and a dozen possessions
       produced "60.2 points per 100" in real output — a number that is
       arithmetically correct and would be read as a season-long claim. The
       plus-minus and the minutes are counts: they mean exactly what they say
       at any sample size, and they are what a match report should carry. */
    const rate = '';
    if (toldFive.has(fiveKey(f))) {
      /* the club is named: another side's group can sit between the two mentions, and "that
         five" then points at the wrong team */
      out.push('Over every minute those five shared, ' + nm(g, f.side) + ' ' + (f.data.pm >= 0
        ? 'outscored the opposition by ' + f.data.pm : 'were outscored by ' + Math.abs(f.data.pm)) + ' in ' + mins(f.data.dur) + '.');
      return;
    }
    toldFive.add(fiveKey(f));
    /* sentence-initial: "their strongest group" needs its capital, and the
       referrer returns the mid-sentence form */
    const ps = R.poss(f.side);
    out.push(ps.charAt(0).toUpperCase() + ps.slice(1) + ' strongest group, ' + five(g, f.data.ids) + ', ' +
      (f.data.pm >= 0 ? 'outscored the other side by ' + f.data.pm : 'was outscored by ' + Math.abs(f.data.pm)) +
      ' in ' + mins(f.data.dur) + rate + '.');
  });
  if (worst && !told.has(key(worst))) {
    out.push(pick('worst' + worst.data.pm + worst.data.dur, [
      'The other end of it was ugly for ', 'It went the other way for ',
      'The worst of it fell on '
    ]) + R.obj(worst.side) + ', who were outscored by ' + Math.abs(worst.data.pm) + ' in ' + mins(worst.data.dur) +
      ' with ' + five(g, worst.data.ids) + ' out there.');
  }
  return out;
}

/* A shooting line in words. spell(0) is "no", which is right for counting
   ("no assists") and wrong the moment it lands in "shot no of eight" — a
   scoreless line is missed, not counted. */
function fromField(fgm, fga) {
  if (!fga) return null;
  /* Both figures in the same register. spell() only spells to twelve, so a
     line of thirteen attempts came out as "two of 13" — half word, half
     numeral, which is the kind of seam that makes prose look machine-set.
     Past twelve, both go to digits. */
  const big = fgm > 12 || fga > 12;
  const n = v => big ? String(v) : spell(v);
  if (!fgm) return 'missed all ' + n(fga);
  return n(fgm) + ' of ' + n(fga);
}

/* ---------------------------------------------------------------------------
   THE PERFORMANCES, AS A PARAGRAPH.

   This emitted one sentence per player, in salience order, and it read exactly
   like what it was — a list with full stops in it:

       Ronan Petrelli top-scored for East Dock with 22.
       Ade Bankole picked up his fifth and was done.
       Harvey Cline fouled out for Harbour Bay.
       Rasheed Marchetti fouled out.
       Tomas Iwu could not find it, one of nine.
       Julien Diallo shot no of eight for Harbour Bay.

   Three separate foul-outs, each phrased differently for variety's sake, is
   not variety — it is the same fact three times, and a person writing this
   would say "Bankole, Cline and Marchetti all fouled out" and move on. The
   problem was never the phrasing of any one line; it was that every fact got
   a sentence of its own regardless of whether it deserved one.

   So the section is composed rather than listed. Players are grouped by what
   they did — who scored it, who else contributed, who struggled, who fouled
   out — and each group becomes one sentence that can name several people. A
   player may appear twice where that is natural, because leading the scoring
   and fouling out are two different things worth knowing about the same man.
   --------------------------------------------------------------------------- */
/* ---------------------------------------------------------------------------
   THE PERFORMANCES.

   Composed rather than listed — players are grouped by what they did, and each
   group is one sentence that can carry several people. A man may appear twice
   where that is natural: leading the scoring and fouling out are two different
   things worth knowing about him.

   EVERY PLAYER CARRIES HIS CLUB. A name on its own is no use to a reader who
   does not already know the squads, and "Leo Nakamura, Beck Sandoval and Tomas
   Iwu never got going" asks them to know which of the three was on which side
   — in a report whose entire subject is two teams. Names are therefore grouped
   by side and the club is named once for the group, which attributes everybody
   without repeating a club name after every surname.
   --------------------------------------------------------------------------- */
function sectionPlayers(g, fs, R) {
  const out = [];
  const byKind = k => fs.filter(f => f.kind === k);
  const nameOf = p => esc(tc(p.name));
  const club = t => nm(g, t);

  const topScorer = [0, 1].map(t => g.players
    .filter(p => p.team === t)
    .reduce((best, p) => (!best || (p.pts || 0) > (best.pts || 0) ? p : best), null));
  const isLeader = p => topScorer[p.team] && topScorer[p.team].id === p.id;

  const seasonOf = id => {
    const S = g.season;
    if (!S || !S.players) return null;
    return S.players.find(x => x.id === id) || null;
  };
  const aboveAverage = p => {
    const sp = seasonOf(p.id);
    return sp && num(sp.ppg) != null && (p.pts || 0) - sp.ppg >= 6;
  };

  const list = xs => !xs.length ? '' : xs.length === 1 ? xs[0]
    : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1];

  /* Joining the per-club clauses. Each already contains an "and" of its own
     once a club has two men in it, so joining THOSE with "and" produced
     "East Dock's Sandoval and Iwu and Harbour Bay's Nakamura and Diallo" —
     four ands and no way to see where one club ends. A semicolon separates
     them cleanly the moment either side is carrying more than one name. */
  const joinClauses = cs => cs.length === 1 ? cs[0]
    : cs.some(c => / and /.test(c)) ? cs.join('; ') : cs.join(' and ');

  /* Split a set of players by side, keeping each side's own order, and drop
     the empty side. The caller renders one clause per group with the club in
     it, so nobody is ever named without a team. */
  const sides = entries => [0, 1]
    .map(t => ({ t: t, items: entries.filter(e => e.side === t) }))
    .filter(x => x.items.length);

  /* ---- who scored it -------------------------------------------------- */
  const leaders = [0, 1].map(t => topScorer[t])
    .filter(p => p && (p.pts || 0) >= 10)
    .sort((a, b) => (b.pts || 0) - (a.pts || 0));
  /* THE LEADER GETS HIS WHOLE LINE, not just the points: "22 points, seven
     rebounds and four assists" is what a report says about the man of the
     match. The other side's leader follows in his own sentence, so neither
     line is squeezed to make room for the other. */
  /* A TRIPLE-DOUBLE IS SAID, not left for the reader to add up. The headline could lead with
     "Cameron Holden's triple-double carries Bristol Flyers" while the body only said "Cameron
     Holden had ten assists" (read-through, 2026-09-23). A leader's is marked on his line; anybody
     else's gets a sentence of its own ahead of the other deeds. */
  const tdF = byKind('tripleDouble')[0];
  const tdP = tdF && tdF.data.p;
  const tdMark = p => (tdP && p.id === tdP.id ? ', a triple-double' : '');
  const tailA = leaders[0] ? lineTail(leaders[0]) : '';
  if (leaders.length === 2) {
    const [a, b] = leaders;
    const tailB = lineTail(b, { rebMin: 7, astMin: 5 });
    const first = pickVaried('lead' + a.id + b.id, [
      nameOf(a) + ' led ' + club(a.team) + ' with ' + a.pts + ' points' + tailA + tdMark(a) + '.',
      nameOf(a) + ' top-scored for ' + club(a.team) + ' with ' + a.pts + tailA + tdMark(a) + '.',
      club(a.team) + ' had ' + a.pts + ' points' + tailA + ' from ' + nameOf(a) + tdMark(a) + '.'
    ]);
    const second = pickVaried('lead2' + b.id, [
      nameOf(b) + ' answered with ' + b.pts + tailB + tdMark(b) + ' for ' + club(b.team) + '.',
      'For ' + club(b.team) + ', ' + nameOf(b) + ' had ' + b.pts + tailB + tdMark(b) + '.',
      nameOf(b) + ' finished with ' + b.pts + tailB + tdMark(b) + ' for ' + club(b.team) + '.'
    ]);
    out.push(first + ' ' + second);
  } else if (leaders.length === 1) {
    const a = leaders[0];
    out.push(nameOf(a) + ' led ' + club(a.team) + ' with ' + a.pts + ' points' + tailA +
      (aboveAverage(a) ? ', a season high' : '') + tdMark(a) + '.');
  }
  if (tdP && !leaders.some(p => p.id === tdP.id)) {
    const cats = [[tdP.pts || 0, 'points'], [(tdP.or || 0) + (tdP.dr || 0), 'rebounds'], [tdP.ast || 0, 'assists'],
                  [tdP.stl || 0, 'steals'], [tdP.blk || 0, 'blocks']].filter(c => c[0] >= 10).map(c => c[0] + ' ' + c[1]);
    out.push(nameOf(tdP) + ' had a triple-double for ' + club(tdP.team) + ': ' + listOf(cats) + '.');
  }

  /* off the bench, a personal spree, the boards, the line: the deeds a box
     score buries and a person watching would have noticed. A man already
     given his line above is not re-introduced here with the same total. */
  const deeds = [];
  const deedSeen = new Set(leaders.map(p => p.id).concat(tdP ? [tdP.id] : []));
  byKind('benchSpark').slice(0, 2).forEach(f => {
    const p = f.data.p; if (deedSeen.has(p.id)) return; deedSeen.add(p.id);
    deeds.push({ side: p.team, txt: nameOf(p) + ' came off the bench for ' + p.pts + lineTail(p, { rebMin: 7, astMin: 5 }) });
  });
  byKind('spree').slice(0, 1).forEach(f => {
    const p = f.data.p; if (deedSeen.has(p.id)) return; deedSeen.add(p.id);
    deeds.push({ side: p.team, txt: nameOf(p) + ' scored ' + spell(f.data.n) + ' straight points in the ' + ordinal(f.data.period) });
  });
  byKind('rebounder').slice(0, 2).forEach(f => {
    const p = f.data.p; if (deedSeen.has(p.id)) return; deedSeen.add(p.id);
    deeds.push({ side: p.team, txt: nameOf(p) + ' pulled down ' + f.data.reb + ' rebounds' });
  });
  byKind('lineLiving').slice(0, 1).forEach(f => {
    const p = f.data.p; if (deedSeen.has(p.id)) return; deedSeen.add(p.id);
    deeds.push({ side: p.team, txt: nameOf(p) + ' went ' + f.data.made + ' of ' + f.data.att + ' from the line' });
  });
  byKind('nearTriple').slice(0, 1).forEach(f => {
    const p = f.data.p; if (deedSeen.has(p.id)) return; deedSeen.add(p.id);
    deeds.push({ side: p.team, txt: nameOf(p) + ' came within a rebound or two of a triple-double' });
  });
  if (deeds.length) {
    out.push(joinClauses(sides(deeds.slice(0, 3)).map(grp =>
      list(grp.items.map(x => x.txt)) + ' for ' + club(grp.t))) + '.');
  }

  /* ---- who else contributed -------------------------------------------- */
  const seen = new Set(Array.from(deedSeen));
  const support = [];
  byKind('bigScore').concat(byKind('aboveSelf')).forEach(f => {
    const p = f.data.p;
    if (seen.has(p.id) || isLeader(p)) return;
    seen.add(p.id);
    support.push({ side: p.team, p: p, txt: nameOf(p) + ' added ' + p.pts,
                   short: nameOf(p) + ' ' + p.pts });
  });
  if (support.length) {
    const clauses = sides(support.slice(0, 4)).map(grp => {
      const first = grp.items[0].txt;
      const rest = grp.items.slice(1).map(x => x.short);
      return (rest.length ? first + ' and ' + list(rest) : first) + ' for ' + club(grp.t);
    });
    const solo = support.length === 1 && aboveAverage(support[0].p);
    out.push(joinClauses(clauses) + (solo ? ', well up on his usual.' : '.'));
  }

  /* ---- the specialists -------------------------------------------------- */
  const specials = [];
  /* One line per man. Somebody with seven assists AND five threes was being
     listed twice in the same sentence — "Beck Sandoval had seven assists and
     Beck Sandoval hit five from three". */
  const specialSeen = new Set();
  const inLine = new Set(leaders.map(p => p.id).concat(tdP ? [tdP.id] : []));   // their assists/steals were said with their points
  byKind('creator').slice(0, 2).forEach(f => {
    const p = f.data.p;
    if (specialSeen.has(p.id) || inLine.has(p.id)) return;
    specialSeen.add(p.id);
    specials.push({ side: p.team, who: nameOf(p),
                    did: 'had ' + spell(p.ast || 0) + ' assists',
                    txt: nameOf(p) + ' had ' + spell(p.ast || 0) + ' assists' });
  });
  byKind('shooter').slice(0, 2).forEach(f => {
    const p = f.data.p;
    if (specialSeen.has(p.id)) return;
    specialSeen.add(p.id);
    specials.push({ side: p.team, who: nameOf(p),
                    did: 'hit ' + spell(p.p3m || 0) + ' from three',
                    txt: nameOf(p) + ' hit ' + spell(p.p3m || 0) + ' from three' });
  });
  byKind('defender').slice(0, 2).forEach(f => {
    const p = f.data.p;
    if (specialSeen.has(p.id) || inLine.has(p.id)) return;
    specialSeen.add(p.id);
    const bits = [];
    if ((p.stl || 0) >= 3) bits.push(spell(p.stl) + ' steals');
    if ((p.blk || 0) >= 3) bits.push(spell(p.blk) + ' blocks');
    if (bits.length) specials.push({ side: p.team, who: nameOf(p),
      did: 'finished with ' + bits.join(' and '),
      txt: nameOf(p) + ' finished with ' + bits.join(' and ') });
  });
  if (specials.length) {
    /* TWO PLAYERS WHO DID THE SAME THING GET ONE PREDICATE.

       Listing each in full produced "Ronan Petrelli hit four from three and
       Gideon Pike hit four from three for East Dock" — a sentence that states
       its own verb twice, which no one writing this would do. When the deed is
       identical the names are collected in front of it and "each" carries the
       repetition, exactly as it does in speech. */
    const merge = items => {
      const order = [], by = new Map();
      items.forEach(it => {
        const k = it.did || it.txt;
        if (!by.has(k)) { by.set(k, []); order.push(k); }
        by.get(k).push(it);
      });
      return order.map(k => {
        const group = by.get(k);
        if (group.length === 1 || !group[0].did) return group[0].txt;
        return list(group.map(x => x.who)) + ' each ' + group[0].did;
      });
    };
    out.push(joinClauses(sides(specials.slice(0, 4)).map(grp =>
      list(merge(grp.items)) + ' for ' + club(grp.t))) + '.');
  }

  /* ---- who struggled ---------------------------------------------------- */
  const rough = [];
  byKind('belowSelf').concat(byKind('inefficient')).forEach(f => {
    const p = f.data.p;
    if (rough.some(r => r.id === p.id)) return;
    const shot = fromField((p.p2m || 0) + (p.p3m || 0), (p.p2a || 0) + (p.p3a || 0));
    const note = shot ? ' (' + shot + ')' : ((p.pts || 0) === 0 ? ' (scoreless)' : '');
    rough.push({ id: p.id, side: p.team, txt: nameOf(p) + note });
  });
  byKind('turnoverProne').slice(0, 2).forEach(f => {
    const p = f.data.p;
    if (rough.some(r => r.id === p.id) || (leaders[0] && leaders[0].id === p.id)) return;
    rough.push({ id: p.id, side: p.team, txt: nameOf(p) + ' (' + spell(f.data.to) + ' turnovers)' });
  });
  if (rough.length) {
    /* the possessive puts the club in front of its own men, which reads more
       naturally here than trailing "for X" onto a list of shooting lines */
    const clauses = sides(rough.slice(0, 4)).map(grp =>
      possOf(club(grp.t)) + ' ' + list(grp.items.map(x => x.txt)));
    /* Two clubs are two clauses, joined as English joins them. The generic joiner fell back to
       a semicolon when a clause had its own "and", which left the second club as a fragment:
       "...Kareem Queeley and Owen Koonce; Bristol Flyers' Joseph Anderson." */
    const two = clauses.length === 2;
    out.push(pickVaried('rough' + rough.length, [
      'It was a long night for ' + clauses[0] + (two ? ', and for ' + clauses[1] : '') + '.',
      'Little went right for ' + clauses[0] + (two ? ', or for ' + clauses[1] : '') + '.',
      clauses[0] + ' never got going' + (two ? ', and neither did ' + clauses[1] : '') + '.'
    ]));
  }

  /* ---- who fouled out --------------------------------------------------- */
  const dq = byKind('fouledOut').map(f => ({ side: f.data.p.team, txt: nameOf(f.data.p) }));
  if (dq.length) {
    /* "to fouls" once, at the end, where it governs both halves.

       It used to be trailed onto every clause, which gave "East Dock lost
       Petrelli and Marchetti to fouls; Harbour Bay lost Cline and Bankole to
       fouls" — the same three words twice in one sentence. Putting the verb
       and its object on the first club and eliding both on the second is what
       English does here: "East Dock lost Petrelli and Marchetti to fouls,
       Harbour Bay Cline and Bankole." */
    const grps = sides(dq);
    if (grps.length === 2) {
      /* not the gapped "..., Bristol Flyers Darnell Brodie": with a club name that ends in a
         plural it reads as one name, not as a club and the player it lost */
      out.push(club(grps[0].t) + ' lost ' + list(grps[0].items.map(x => x.txt)) +
        ' to fouls, and ' + club(grps[1].t) + ' lost ' +
        list(grps[1].items.map(x => x.txt)) + ' the same way.');
    } else {
      out.push(club(grps[0].t) + ' lost ' + list(grps[0].items.map(x => x.txt)) +
        ' to fouls.');
    }
  }

  return out;
}

function fmtMinShort(ms) { return Math.round((ms || 0) / 60000) + ' minutes'; }

/* ------------------------------------------------------------- assemble --- */
/* ---------------------------------------------------------------------------
   A SENTENCE STARTS WITH A CAPITAL LETTER.

   Most clauses here are written to be JOINED — "they turned giveaways into 24
   points", "their bench put up 61 to 46" — so they begin in lower case on
   purpose, and lower() exists to put a capitalised one back down when it stops
   starting a sentence. Nothing ever did the opposite: when a clause built from
   a pronoun happened to come FIRST, it led the sentence in lower case, and
   published reports opened with "their bench put up 61 to 46".

   Doing it here, once, on finished text is deliberate. Every section assembles
   clauses in an order that depends on which facts exist, so no individual
   builder knows whether its clause will lead — only the finished sentence
   knows. */
function capitalise(text) {
  return String(text || '').replace(
    /(^|[.!?]\s+)([a-z])/g,
    function (_, lead, ch) { return lead + ch.toUpperCase(); });
}

/* ------------------------------------------------------- the scout's note ---
   THE SAME GAME, ON THE MONDAY. Everything above is written for somebody who
   did not watch: it leads with the 19-point night and the six-minute run,
   because that is what a report is for. A coach opening the same page wants a
   different question answered -- not "what happened" but "where were we, against
   everyone else who played this season, and what do we work on".

   The reference point is the whole difference, and it is why this reads as
   scouting rather than as more commentary. "They shot 43 per cent" is a fact.
   "They shot worse from the field than eight games in ten in this league" is a
   judgement, and it is the same number.

   It never ranks a STYLE. Shooting a lot of threes is not good or bad, and a
   line that told a coach to shoot fewer of them because the percentile was low
   would be inventing an instruction out of a preference. story.js marks those,
   and they are described in the ledger card without ever appearing here. */
function sectionScout(g, fs, R, opts) {
  const st = S();
  if (!st.scout) return [];
  /* HALF A GAME IS NOT A RESULT. At the interval nobody has "won this on" anything and there
     is no week to take a lesson into -- there is a second half, and a dressing room. `half`
     keeps every judgement (the same percentiles, the same gaps) and changes only the tense
     and the framing: who has had the better of it, and what needs fixing at the break. */
  const half = !!(opts && opts.half);
  const sc = st.scout(g);
  const out = [];
  R.neutral();
  lastPick = null;             // this section's phrasing must not inherit the last section's
  const W = sc.winner, L = 1 - W;
  const nm = t => tc(g.names[t]);
  const tied = g.score[0] === g.score[1];

  if (sc.decided.length) {
    const top = sc.decided[0];
    if (sc.graded) {
      /* THE SIDE AHEAD ON A MEASURE IS NOT ALWAYS THE SIDE THAT WON. top.winner is whoever was
         better on the widest gap; "Bristol Flyers won this on protecting the rim" was printed
         about a game Bristol Flyers LOST 72-60 (read-through, 2026-09-23). When the two differ
         the sentence says the gap went the loser's way and was not enough. */
      const gw = top.winner, gl = 1 - gw;
      const pw = pctPhrase(top.pcts[gw], g.names[gw] + top.key + 'a');
      const pl = pctPhrase(top.pcts[gl], g.names[gl] + top.key + 'b');
      const tail = (half ? 'they have been ' : 'they were ') + pw + ' there, ' + nm(gl) + ' ' + pl;
      out.push(gw === W
        ? nm(gw) + (half ? ' have had the better of ' + top.label + ' more than anything: '
                         : ' won this on ' + top.label + ' before anything else: ') + tail + '.'
        : (half ? 'The widest gap so far is ' + top.label + ', and it favours ' + nm(gw) + (tied ? ': ' : ', who trail: ')
                : 'The widest gap between them was ' + top.label + ', and it went ' + nmPoss(g, gw) + ' way — ') +
          tail + (half ? '.' : ' — but it was not enough.'));
      const rest = sc.decided.slice(1, 3);
      if (rest.length) {
        out.push((half ? 'The other gaps to watch after the break: ' : 'The other gaps worth the film room: ') +
          rest.map(x => x.label + ' (' + nm(x.winner) + ', ' +
            Math.round(x.gap) + ' percentile points clear)').join(' and ') + '.');
      }
    } else {
      /* NO SCALES FOR THIS COMPETITION YET, so there is no league to be measured against and
         the honest comparison is the two sides against each other. It is a weaker claim and is
         phrased as one: where they were apart, not where either of them was good. */
      const mine = sc.decided.filter(x => sideAhead(sc, x, W)).slice(0, 3);
      const theirs = sc.decided.filter(x => sideAhead(sc, x, L)).slice(0, 2);
      if (mine.length) {
        out.push(nm(W) + (half ? ' are ahead on ' : ' came out ahead on ') + listOf(mine.map(x => x.label)) +
          '. There is no league scale for this competition yet, so that is a comparison of the two sides with each other.');
      }
      if (theirs.length) {
        out.push(nm(L) + (half ? ' have had the better of ' : ' had the better of ') + listOf(theirs.map(x => x.label)) +
          (half ? ', something to build on after the break.' : ', which is where they can take some credit.'));
      }
    }
  }

  /* EACH SIDE IN TURN, the leader first, because a coach reads their own column.

     The percentile is attached to the measure it describes ("the defensive glass, where they
     were better than nine games in ten") rather than trailed after a list ("... — better than
     nine games in ten on the first of those"), which made the reader count back. And the
     losing side's worst measure is left to the closing line, which is about exactly that: it
     used to be named, graded, and then named and graded again one sentence later. */
  const were = half ? 'have been ' : 'were ';
  [W, L].forEach(t => {
    const side = sc.sides[t];
    if (!side || !side.graded) return;
    const bits = [];
    if (side.good.length) {
      const g0 = side.good[0], rest = side.good.slice(1).map(r => r.label);
      bits.push(nm(t) + (half ? ' are doing their best work on ' : ' did their best work on ') + g0.label +
        ', where they ' + were + pctPhrase(g0.pct, g.names[t] + g0.key + 'good') +
        (rest.length ? ', with ' + listOf(rest) + ' not far behind' : '') + '.');
    }
    const closer = t === L;                          // its first weakness is the closing line's
    const bad = closer ? side.bad.slice(1) : side.bad;
    if (bad.length) {
      /* a side that won by twenty did not have anything "cost them", and saying so in a
         report they will read on the Monday is the quickest way to lose a coach */
      if (!closer) {
        const b0 = bad[0], rest = bad.slice(1).map(r => r.label);
        bits.push((half ? 'What they will want to tighten starts with ' : 'What they will still want back starts with ') +
          b0.label + ', where they ' + were + pctPhrase(b0.pct, g.names[t] + b0.key + 'bad') +
          (rest.length ? '; ' + listOf(rest) + (half ? ' are lagging too' : ' lagged too') : '') + '.');
      } else {
        bits.push((bits.length ? 'They ' : nm(t) + ' ') + (half ? 'are also struggling with ' : 'also struggled with ') +
          listOf(bad.map(r => r.label)) + '.');
      }
    }
    if (bits.length) out.push(bits.join(' '));
  });

  /* and the one thing to take into the week -- or into the dressing room */
  const lose = sc.sides[L];
  if (lose && lose.bad.length) {
    const b0 = lose.bad[0], ph = pctPhrase(b0.pct, g.names[L] + b0.key + 'take');
    out.push(half
      ? 'The one thing to fix at the break is ' + b0.label + ': ' + nm(L) + ' have been ' + ph +
          ' there, further behind the league than anything else in their game.'
      : 'If there is one thing to take into the week, it is ' + b0.label + ': ' + nm(L) + ' were ' + ph +
          ' there, further behind the league than anything else in their game.');
  }
  return out;
}

/* which side is ahead on a measure when there are no percentiles to rank them by: the raw
   figures, with the stat's own direction respected -- fewer turnovers is better, more of
   everything else is */
const LOWER_IS_BETTER = new Set(['tovp', 'drtg']);
function sideAhead(sc, dec, t) {
  const a = dec.values[t], b = dec.values[1 - t];
  if (a == null || b == null || a === b) return false;
  return LOWER_IS_BETTER.has(dec.key) ? a < b : a > b;
}

/* a percentile as a coach would say it, not as a number */
/* A COMPARISON WITH A SEAT LEFT FOR VARIETY. This used to be one fixed string per band, and
   the two sides of a single comparator stat (OREB% and DREB% are the same rebound, seen from
   each end) land in MIRROR bands almost every time -- one team's 94th percentile is close to
   being the other's 6th -- so a sentence that reaches for pctPhrase() twice used to say "better
   than nine games in ten... worse than nine games in ten" without a single different word
   between the two halves. Three phrasings a band and pickVaried()'s own rule (never the same
   template as the sentence just before it) means the second half never repeats the first's
   exact words, whatever their two numbers happen to be. The seed is passed in by the caller,
   not derived from the number: two teams sitting in the same band should not therefore say the
   same thing, but the SAME team's SAME stat read twice in one report should. */
/* EVERY PHRASE HAS TO READ AFTER A TEAM AND AFTER "WHERE THEY WERE". The bank is used both
   ways ("London Lions were ___", "the defensive glass, where they were ___"), and three of the
   old entries only worked after a statistic: "London Lions were rare to see this low in the
   league", "as good as almost anyone plays this in the league" and "neither a strength nor a
   weakness" all failed the first frame (read-through of three SLB games, 2026-09-23). */
const PCT_BANDS = [
  [90, ['better than nine games in ten', 'among the best in the league', 'at the very top of the league']],
  [75, ['better than three games in four', 'comfortably above the league', 'well above the league average']],
  [60, ['better than most', 'above the league’s middle', 'on the good side of average']],
  [40, ['about league average', 'in the middle of the league', 'right on the league average']],
  [25, ['worse than most', 'below the league’s middle', 'on the wrong side of average']],
  [10, ['worse than three games in four', 'comfortably below the league', 'well below the league average']],
  [-1, ['worse than nine games in ten', 'among the weakest in the league', 'near the bottom of the league']]
];
function pctOptions(r) {
  if (r >= 90) return PCT_BANDS[0][1];
  if (r >= 75) return PCT_BANDS[1][1];
  if (r >= 60) return PCT_BANDS[2][1];
  if (r > 40) return PCT_BANDS[3][1];
  if (r > 25) return PCT_BANDS[4][1];
  if (r > 10) return PCT_BANDS[5][1];
  return PCT_BANDS[6][1];
}
/* `seed` ties the choice to what the sentence is ABOUT (which team, which measure), not to the
   number itself, so the pick is stable across a re-render but two different teams landing in
   the same band are free to say it differently -- and pickVaried's own memory of the last
   template used is what actually stops a sentence saying the same words about both sides of
   one comparison in a row. */
function pctPhrase(p, seed) {
  if (p == null) return 'hard to place';
  return pickVaried(String(seed || ''), pctOptions(Math.round(p)));
}

function listOf(xs) {
  const a = xs.slice(0, 3);
  if (a.length <= 1) return a[0] || '';
  return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}

/* ===========================================================================
   THE HALF-TIME REPORT — the same questions, asked of a game still going.

   The caller passes a brief built from the FIRST HALF ONLY (game.js slices the log at the end
   of the second quarter and replays it), so every fact story.js finds is a first-half fact and
   nothing here has to filter. What changes is the register: nobody has won, so nothing is
   "decided"; the lead is a lead, the tense is present, and the last word is what to fix at the
   break rather than what to take into the week. makeRef still knows a "winner" (the side ahead)
   but nothing here asks it for a role, so no one is called "the winners" at 20 minutes.
   =========================================================================== */
function halftime(g) {
  const st = S();
  const fs = st.facts(g);
  const R = makeRef(g, fs);
  PROPER = new Set(g.names.map(n => tc(String(n)).split(' ')[0]));
  SPENT = new Set();
  lastPick = null; RECENT = [];
  const [a, b] = g.score;
  const L = a > b ? 0 : a < b ? 1 : null, T = L == null ? null : 1 - L;
  const m = Math.abs(a - b), hi = Math.max(a, b), lo = Math.min(a, b);
  const nameOf = p => esc(tc(p.name));
  const run = fs.find(f => f.kind === 'run');

  /* ---- headline ---- */
  const hl = L == null
    ? nm(g, 0) + ' and ' + nm(g, 1) + ' level at ' + a + '–' + b + ' at the half'
    : m <= 3 ? nm(g, L) + ' edge ' + nm(g, T) + ' ' + hi + '–' + lo + ' at the break'
    : m >= 15 ? nm(g, L) + ' lead ' + nm(g, T) + ' by ' + m + ' at the half'
    : nm(g, L) + ' lead ' + nm(g, T) + ' ' + hi + '–' + lo + ' at the half';

  /* ---- standfirst: how the two quarters went, then who is carrying it ---- */
  const q = p => [(g.perQ[0][p] || 0), (g.perQ[1][p] || 0)];
  const won = s => (s[0] > s[1] ? 0 : s[0] < s[1] ? 1 : null);
  const q1 = q(1), q2 = q(2), w1 = won(q1), w2 = won(q2);
  const qs = (s, t) => s[t] + '–' + s[1 - t];
  let lede;
  if (L == null) {
    lede = 'Twenty minutes in there is nothing between them' +
      (w1 != null && w2 != null && w1 !== w2
        ? ': ' + nm(g, w1) + ' took the first quarter ' + qs(q1, w1) + ' and ' + nm(g, w2) + ' answered with the second, ' + qs(q2, w2)
        : '');
  } else if (w1 === L && w2 === L) {
    lede = nm(g, L) + ' have won both quarters, ' + qs(q1, L) + ' and ' + qs(q2, L);
  } else if (w2 === L) {
    lede = nm(g, L) + (w1 == null ? ' were level after one' : ' trailed after one') +
      ' and took over in the second, winning it ' + qs(q2, L);
  } else if (w1 === L) {
    lede = nm(g, L) + ' built the lead in the first quarter, ' + qs(q1, L) + ', and ' +
      (w2 === T ? nm(g, T) + ' have been chipping at it since' : 'have held on to it since');
  } else {
    lede = nm(g, L) + ' lead by ' + m;
  }
  let usedRun = false;
  if (run && run.data.n >= 8 && L != null && run.side === L) {
    lede += ', helped by ' + anFor(run.data.n) + ' ' + run.data.n + '–0 run in the ' + ordinal(run.data.period);
    usedRun = true;
  }
  const scorers = (g.players || []).filter(p => (p.pts || 0) > 0).sort((x, y) => (y.pts || 0) - (x.pts || 0));
  /* the scorers are "who has it going", below; saying the top one here as well gave the same
     clause twice on one screen */
  const stand = lede + '.';

  const secs = [];
  const add = (heading, paras, card) => { if (paras && paras.length) secs.push({ heading, paras: paras.map(capitalise), card }); };

  /* ---- the first half: its shape ---- */
  {
    R.neutral();
    const bits = [];
    if (run && run.data.n >= 8 && !usedRun) {
      bits.push(R.subj(run.side) + ' had the best spell of the half, ' + anFor(run.data.n) + ' ' + run.data.n + '–0 run in the ' + ordinal(run.data.period) + '.');
    }
    const bl = fs.find(f => f.kind === 'biggestLead');
    if (bl) {
      const who = R.subj(bl.side);
      const still = L === bl.side;
      bits.push(who + ' have led by as many as ' + bl.data.by +
        (still ? (m <= bl.data.by - 8 ? ', and have given most of it back' : '') : ', and all of it has gone') + '.');
    }
    const lc = fs.find(f => f.kind === 'leadChanges');
    if (lc) { R.neutral(); bits.push('The lead has already changed hands ' + lc.data.changes + ' times.'); }
    const dr = fs.filter(f => f.kind === 'drought').sort((x, y) => y.data.dur - x.data.dur)[0];
    if (dr) bits.push(R.subj(dr.side, { noPronoun: true }) + ' went ' + mins(dr.data.dur) + ' without a field goal in the ' + ordinal(dr.data.period) + '.');
    add('The first half', bits.length ? [bits.join(' ')] : [], 'quarters');
  }

  /* ---- where it is being decided: shooting, the four factors, the events tab ---- */
  {
    R.neutral();
    const paras = [];
    const box = [];
    const floor = fs.find(f => f.kind === 'floor');
    if (floor && Math.abs(floor.data.a - floor.data.b) >= 5) {
      const up = Math.max(floor.data.a, floor.data.b), dn = Math.min(floor.data.a, floor.data.b);
      box.push(R.subj(floor.side) + ' are shooting ' + Math.round(up) + '% from the field to ' + Math.round(dn) + '%');
    }
    const lead = fs.find(f => f.kind === 'factor');
    if (lead) {
      const mine = lead.side === 0 ? lead.data.a : lead.data.b, theirs = lead.side === 0 ? lead.data.b : lead.data.a;
      const who = R.subj(lead.side);
      const per = n => Math.round(num(n) || 0);
      const s = lead.data.factor === 'efg' ? (floor && floor.side === lead.side ? null : who + ' are the sharper side, ' + pct1(mine) + ' eFG to ' + pct1(theirs))
        : lead.data.factor === 'tov' ? who + ' are looking after the ball, turning it over on ' + pct1(mine) + ' of possessions to ' + pct1(theirs)
        : lead.data.factor === 'oreb' ? who + ' own the offensive glass so far, getting ' + pct1(mine) + ' of their misses back to ' + pct1(theirs)
        : who + ' are living at the line, ' + per(mine) + ' free throws per hundred shots to ' + per(theirs);
      if (s) box.push(s);
    }
    if (box.length) paras.push(joinSentences(box, 'plain') + '.');
    R.neutral();
    const sit = sitSentences(g, fs, R, 'present');
    if (sit.length) paras.push(sit.join(' '));
    add('Where it is being decided', paras, 'factors');
  }

  /* ---- who has it going, and who is carrying fouls into the second half ---- */
  {
    const paras = [];
    const side = t => scorers.filter(p => p.team === t);
    const lines = [];
    [L == null ? 0 : L, L == null ? 1 : T].forEach(t => {
      const top = side(t);
      if (!top.length || top[0].pts < 6) return;
      const p = top[0];
      const fgm = (p.p2m || 0) + (p.p3m || 0), fga = (p.p2a || 0) + (p.p3a || 0);
      const ff = fromField(fgm, fga);
      let s = nameOf(p) + ' has ' + p.pts + ' for ' + nm(g, t) + (ff && fga >= 4 ? ' on ' + ff + ' shooting' : '') + lineTail(p, { rebMin: 5, astMin: 3 });
      if (top[1] && top[1].pts >= 8) s += ', with ' + nameOf(top[1]) + ' on ' + top[1].pts;
      lines.push(s);
    });
    if (lines.length) paras.push(lines.join('; ') + '.');
    const fouls = (g.players || []).filter(p => (p.pf || 0) >= 3).sort((x, y) => (y.pf || 0) - (x.pf || 0));
    if (fouls.length) {
      paras.push('Foul trouble to watch: ' + listOf(fouls.map(p => nameOf(p) + ' of ' + nm(g, p.team) + ' with ' + spell(p.pf))) +
        (fouls.length > 3 ? ', among others' : '') + '.');
    }
    add('Who has it going', paras, null);
  }

  /* ---- the scout's note, at the break ---- */
  add('The scout’s note', sectionScout(g, fs, R, { half: true }), 'scout');

  let sc = null;
  try { sc = st.scout ? st.scout(g) : null; } catch (_) { sc = null; }
  const done = finish(g, secs, stand, hl);
  return { headline: done.headline, standfirst: done.standfirst, quality: done.quality, sections: secs, facts: fs, scout: sc, half: true };
}

/* ============================================================== revising ===
   THE REPORT IS NOT LEFT AS FIRST WRITTEN. Every paragraph goes through language.js revise(): it is scored on the 0-100 scale
   (grammar, length, rhythm, density, repetition, filler), and while it is below the target the reviser tries each repair it
   knows (split a run-on, cut a filler, a pronoun for a club just named, drop a sentence said twice), keeps the one that raises
   the score most, and goes again. What it did is returned with the report (quality), so it can be read and measured. */
function finish(g, secs, stand, headline) {
  const Lg = L();
  const names = [nm(g, 0), nm(g, 1)];
  const initial = [], final = [], log = [];
  let before = null;
  const one = (text, section, first) => {
    const r = Lg.revise(text, { names, before, paragraphStart: !!first, target: Lg.TARGET });
    initial.push(r.initial); final.push(r.score);
    r.log.forEach(x => log.push(Object.assign({ section }, x)));
    const sn = Lg.sentencesOf(r.text.replace(/<[^>]*>/g, ''));
    before = sn.length ? sn[sn.length - 1] : before;
    return r.text;
  };
  const head = Lg.polish(headline, { names });
  const st = stand ? one(stand, 'standfirst', false) : stand;
  secs.forEach(sec => { sec.paras = sec.paras.map((p, i) => one(p, sec.heading, i === 0)); });
  const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 100);
  return { headline: head, standfirst: st,
           quality: { target: Lg.TARGET, initial: mean(initial), score: mean(final), min: final.length ? Math.min.apply(null, final) : 100,
                      paragraphs: final.length, satisfied: final.filter(x => x >= Lg.TARGET).length, revisions: log } };
}

function report(g) {
  const st = S();
  const fs = st.facts(g);
  RECENT = []; lastPick = null;      // what the last few sentences opened with, and the last template used: reset per article
  /* One referrer for the whole article, so "they" in the third section still
     knows who the second section was talking about. */
  const R = makeRef(g, fs);
  /* first word of each club name, so the joiner never lower-cases one */
  PROPER = new Set(g.names.map(n => tc(String(n)).split(" ")[0]));
  /* standfirst() fills this; the sections read it. Built before them, and
     cleared per report so one game cannot silence the next. */
  SPENT = new Set();
  const stand = standfirst(g, fs);
  const secs = [];
  const add = (heading, paras, card) => {
    if (paras && paras.length) secs.push({ heading, paras, card });
  };
  const addCapped = function (heading, paras, card) {
    add(heading, (paras || []).map(capitalise), card);
  };
  addCapped('How it was won', sectionFlow(g, fs, R), 'quarters');
  addCapped('The numbers that decided it', sectionNumbers(g, fs, R), 'factors');
  addCapped('What the four factors were worth', sectionFactors(g, fs, R), 'pointsAdded');
  addCapped('How the ball moved', sectionPassing(g, fs, R), null);
  addCapped('Play types and rebounds', sectionPlayTypes(g, fs, R), null);
  addCapped('The shot clock', sectionClock(g, fs, R), null);
  addCapped('On the floor', sectionLineups(g, fs, R), 'lineups');
  addCapped('The performances', sectionPlayers(g, fs, R), 'players');
  addCapped('The scout’s note', sectionScout(g, fs, R), 'scout');
  let sc = null;
  try { sc = st.scout ? st.scout(g) : null; } catch (_) { sc = null; }
  const done = finish(g, secs, stand, headline(g, fs));
  return { headline: done.headline, standfirst: done.standfirst, quality: done.quality,
           sections: secs, facts: fs, scout: sc };
}

/* Plain text, for a news article body or a feed — same words, no markup. */
function plain(g) {
  const r = report(g);
  const strip = s => String(s).replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const lines = [strip(r.headline), '', strip(r.standfirst), ''];
  r.sections.forEach(s => {
    lines.push(s.heading.toUpperCase(), '');
    s.paras.forEach(p => lines.push(strip(p)));
    lines.push('');
  });
  return lines.join('\n').trim();
}

return { report, plain, headline, standfirst, five, halftime,
         __x: { sectionFlow, sectionNumbers, sectionFactors, sectionPassing, sectionPlayTypes, sectionClock, sectionLineups, sectionPlayers, makeRef, joinSentences } };
}));
