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

/* THE SCORER STORES NAMES LOWERCASE and the box score up-cases them in CSS,
   which is fine for a table heading and wrong in a sentence: "soft club took
   this 106-79" reads as a typo, and at the start of a paragraph it plainly is
   one. Prose has to carry its own capitalisation because it cannot borrow the
   stylesheet's. Existing capitals are left alone, so "McBride" survives. */
function tc(str) {
  /* Split rather than a word-boundary regex: this file is edited by tools
     that treat a backslash escape as their own, and an earlier version of
     this line shipped with a literal control character where \b was meant,
     so the regex matched nothing and every name stayed lowercase. No
     escapes here means nothing to get lost in transit. */
  return String(str == null ? '' : str).split(' ')
    .map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w)
    .join(' ');
}
const nm = (g, t) => esc(tc(g.names[t]));

/* Surnames only for a lineup sentence — five full names in one clause is a
   list, not a sentence. */
function five(g, ids) {
  const names = (ids || []).map(id => {
    const p = g.byId[id];
    return p ? tc(String(p.name || '').split(/\s+/).slice(-1)[0]) : null;
  }).filter(Boolean);
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
  let roleUsed = [false, false];

  const role = t => (winner == null ? null
    : t === winner ? 'the winners' : 'the losers');

  return {
    subj(t, opts) {
      const o = opts || {};
      let word;
      if (last === t && named[t] && !o.noPronoun) {
        word = 'They';
      } else if (o.allowRole && named[t] && !roleUsed[t] && role(t)) {
        /* sentence case, not title case: "The winners", never "The Winners" */
        word = role(t).charAt(0).toUpperCase() + role(t).slice(1);
        roleUsed[t] = true;
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
      else { word = nm(g, t) + '\u2019s'; named[t] = true; }
      last = t;
      return word;
    },
    /* Object position is never a pronoun: it is almost always the OTHER club,
       and "beat them" after a sentence about them points at the wrong side. */
    obj(t) { named[t] = true; return nm(g, t); },
    neutral() { last = null; }
  };
}


/* "A 8-0 run" — the indefinite article follows the SOUND of what comes next,
   and a numeral spells out to a vowel more often than its digits suggest: 8,
   11 and 18 all take "an", while 1 takes "a" despite starting with a vowel
   letter. Cheaper and more reliable than a spell-out. */
function anFor(n) {
  const s = String(n);
  if (/^(8|11|18)/.test(s)) return 'an';
  if (/^1[0-9]/.test(s)) return 'a';        // 10, 12-17, 19 all sound consonantal
  return 'a';
}

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
  let i = seedOf(seed) % options.length;
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

function pick(seed, options) {
  /* Options must be plain values. Anything that names a club has to be
     resolved BEFORE the array is built — every element of an array literal is
     evaluated, so a referrer called inside one runs for all of them and the
     chosen sentence can end up carrying a pronoun the reader never saw
     introduced. Passing functions would work too; hoisting is simpler to read
     and impossible to get wrong by accident. */
  return options[seedOf(seed) % options.length];
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

/* ------------------------------------------------------------- headline --- */
function headline(g, fs) {
  const r = fs.find(f => f.kind === 'result');
  if (!r) return nm(g, 0) + ' v ' + nm(g, 1);
  const w = r.data.winner, l = r.data.loser;
  const sc = Math.max(g.score[0], g.score[1]) + '–' + Math.min(g.score[0], g.score[1]);
  const comeback = fs.find(f => f.kind === 'comeback');
  const td = fs.find(f => f.kind === 'tripleDouble');
  const big = fs.find(f => f.kind === 'bigScore');

  if (r.data.margin === 0) return nm(g, 0) + ' and ' + nm(g, 1) + ' tie ' + sc;
  if (comeback) return nm(g, w) + ' overturn ' + comeback.data.deficit +
    ' to beat ' + nm(g, l);
  if (td) return esc(tc(td.data.p.name)) + ' triple-double carries ' + nm(g, w);
  if (r.data.how === 'rout') return nm(g, w) + ' overwhelm ' + nm(g, l) + ', ' + sc;
  if (r.data.how === 'squeaker') return nm(g, w) + ' edge ' + nm(g, l) + ' ' + sc;
  if (big && big.side === w) return esc(tc(big.data.p.name)) + '’s ' +
    big.data.p.pts + ' sees off ' + nm(g, l);
  return nm(g, w) + ' beat ' + nm(g, l) + ' ' + sc;
}

function standfirst(g, fs) {
  const bits = [];
  const decisive = fs.find(f => f.kind === 'stretch' || f.kind === 'run');
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
    bits.push(
      factor.data.factor === 'efg'  ? who + ' shot it better, ' + pct1(mine) + ' eFG to ' + pct1(theirs)
    : factor.data.factor === 'tov'  ? who + ' took better care of the ball, ' + pct1(mine) + ' turnover rate to ' + pct1(theirs)
    : factor.data.factor === 'oreb' ? who + ' controlled the offensive glass, ' + pct1(mine) + ' to ' + pct1(theirs)
    : who + ' got to the line far more often');
  }
  if (!bits.length) {
    const r = fs.find(f => f.kind === 'result');
    bits.push(r ? (r.data.how === 'close' ? 'It stayed tight throughout'
                                          : 'A ' + r.data.margin + '-point margin')
                : 'Full time');
  }
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
      : [', and ', '. ', '. In turn, '];
  let out = list[0];
  for (let i = 1; i < list.length; i++) {
    const link = links[(i - 1) % links.length];
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
  const opening = pick('open' + hi + lo + r.data.how, [
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
  const second = cb
    ? R.subj(r.data.winner) + ' had trailed by ' + cb.data.deficit +
      ', which makes this the sort of result that says more about the second ' +
      'half than the first.'
    : bl ? R.subj(bl.side, { allowRole: true }) + ' led by as many as ' + bl.data.by + '.'
    : null;
  out.push(joinSentences([opening, second], 'plain'));

  const mid = [];
  if (run) {
    /* This carried one fixed image — "a lead built and an opponent's rhythm
       taken away in the same breath" — in every report the platform had ever
       written. A phrase that good is worse than a plain one when it is the
       only phrase available: a reader who follows a league sees it weekly and
       it stops meaning anything. */
    mid.push(pick('run' + run.data.n + run.data.period, [
      'The decisive spell was ' + anFor(run.data.n) + ' ' + run.data.n +
        '\u20130 run in the ' + ordinal(run.data.period) + ', long enough to turn a ' +
        'close game into a lead that held.',
      'It turned on ' + anFor(run.data.n) + ' ' + run.data.n + '\u20130 burst in the ' +
        ordinal(run.data.period) + ' \u2014 the sort of stretch that decides games ' +
        'at this level.',
      anFor(run.data.n).charAt(0).toUpperCase() + anFor(run.data.n).slice(1) + ' ' +
        run.data.n + '\u20130 run in the ' + ordinal(run.data.period) +
        ' did the damage, and the game never really came back.',
      'The gap opened during ' + anFor(run.data.n) + ' ' + run.data.n +
        '\u20130 run in the ' + ordinal(run.data.period) + '.'
    ]));
  }
  if (q) {
    mid.push(R.subj(q.side, { allowRole: true }) + ' won the ' + ordinal(q.data.period) +
      ' ' + Math.max(q.data.pf, q.data.pa) + '\u2013' + Math.min(q.data.pf, q.data.pa) +
      ', the period that separated them.');
  }
  if (sw) mid.push(R.subj(sw.side) + ' were in front in every period.');
  if (lc) { R.neutral(); mid.push('There were ' + plural(lc.data.changes, 'lead change') +
    ', so neither side ever properly settled.'); }
  if (mid.length) out.push(joinSentences(mid, 'plain'));

  /* tempo and season context close the section, because they are the frame
     rather than the events */
  const frame = [];
  if (tempo) {
    R.neutral();
    frame.push(tempo.kind === 'fast'
      ? 'It was played at speed \u2014 ' + one(tempo.data.pace) +
        ' possessions per 40, which is quick for this level'
      : 'It was a slow, half-court game at ' + one(tempo.data.pace) +
        ' possessions per 40');
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

function sectionNumbers(g, fs, R) {
  const out = [];
  const factors = fs.filter(f => f.kind === 'factor').slice(0, 3);
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
    const who = R.subj(lead.side, { allowRole: true });
    const sd = 'ff' + lead.data.factor + lead.side;

    let sentence;
    if (lead.data.factor === 'efg') {
      sentence = pick(sd, [
        who + ' shot it better, ' + pct1(mine) + ' effective field goal ' +
          'against ' + pct1(theirs),
        who + ' were the sharper side from the floor \u2014 ' + pct1(mine) +
          ' eFG to ' + pct1(theirs),
        'The shooting decided it: ' + who + ' at ' + pct1(mine) + ' eFG, their ' +
          'opponents at ' + pct1(theirs)
      ]);
    } else if (lead.data.factor === 'tov') {
      sentence = pick(sd, [
        who + ' looked after the ball, giving it up on ' + pct1(mine) +
          ' of their possessions against ' + pct1(theirs),
        who + ' were far the more careful side, a ' + pct1(mine) +
          ' turnover rate to ' + pct1(theirs),
        'Possessions were the difference \u2014 ' + who + ' turned it over on ' +
          pct1(mine) + ' of theirs, their opponents on ' + pct1(theirs)
      ]);
    } else if (lead.data.factor === 'oreb') {
      sentence = pick(sd, [
        who + ' owned the offensive glass, rebounding ' + pct1(mine) +
          ' of their own misses to ' + pct1(theirs),
        who + ' kept possessions alive \u2014 ' + pct1(mine) + ' of their misses ' +
          'came back to them, against ' + pct1(theirs),
        'The second shots went one way: ' + who + ' recovered ' + pct1(mine) +
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
        'The whistle paid ' + who + ': ' + per(mine) + ' free throws per hundred ' +
          'shots, their opponents ' + per(theirs)
      ]);
    }

    const also = factors.slice(1).filter(f => f.side === lead.side)
      .map(f => f.data.label);
    if (also.length === 1) sentence += ', and had the better of ' + also[0] + ' too';
    else if (also.length > 1) sentence += ', with ' + also.slice(0, -1).join(', ') +
      ' and ' + also[also.length - 1] + ' going the same way';
    out.push(sentence + '.');
  }

  /* how they scored, not just how well */
  const zone = fs.find(f => f.kind === 'fromRange' || f.kind === 'atRim');
  const share = fs.find(f => f.kind === 'sharing');
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
    shapeBits.push(R.subj(share.side) + ' moved it well, assisting on ' +
      pct1(share.data.astp) + ' of their field goals');
  }
  if (shapeBits.length) out.push(joinSentences(shapeBits, 'plain') + '.');

  /* the defensive half, which the report used never to mention */
  const dr = fs.find(f => f.kind === 'defRating');
  const forced = fs.find(f => f.kind === 'forcedTurnovers');
  const disrupt = fs.find(f => f.kind === 'disruption');
  const defBits = [];
  if (dr) {
    defBits.push(R.subj(dr.side, { allowRole: true }) + ' defended the better, ' +
      'giving up ' + one(dr.data.drtg) + ' points per 100 possessions to ' +
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
  if (defBits.length) out.push(joinSentences(defBits, 'cause') + '.');

  /* the team-shape numbers */
  const shape = fs.filter(f =>
    ['bench', 'pointsOffTurnovers', 'paint', 'secondChance'].indexOf(f.kind) >= 0)
    .slice(0, 3);
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
    out.push('The whistle fell one way: ' + R.subj(w.side, { allowRole: true }) +
      ' were called for ' + w.data.mine + ' fouls to ' + w.data.theirs + '.');
  }
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
  const stretch = fs.find(f => f.kind === 'stretch');
  const bests = fs.filter(f => f.kind === 'lineupBest');
  const worst = fs.find(f => f.kind === 'lineupWorst');

  /* THE SAME FIVE MINUTES, TOLD ONCE. The deciding stretch, one side's best
     group and the other's worst are frequently the very same passage of play
     seen from three directions. A group is described once, by whichever fact
     ranked highest. */
  const told = new Set();
  const key = f => (f.data.ids || []).slice().sort().join(',') + '@' + f.data.dur;

  if (stretch) {
    told.add(key(stretch));
    const owner = stretch.data.owner, gained = owner === stretch.side;
    out.push('The game turned inside a single ' + mins(stretch.data.dur) +
      ' spell with ' + five(g, stretch.data.ids) + ' on the floor for ' +
      R.obj(owner) + ': ' + (gained ? 'they gained ' : 'they were outscored by ') +
      stretch.data.swing + ' points in that stretch alone. Nothing else in the ' +
      'game moved the scoreboard as far in as little time.');
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
    /* sentence-initial: "their strongest group" needs its capital, and the
       referrer returns the mid-sentence form */
    const ps = R.poss(f.side);
    out.push(ps.charAt(0).toUpperCase() + ps.slice(1) + ' strongest group \u2014 ' + five(g, f.data.ids) +
      ' \u2014 was ' + (f.data.pm > 0 ? '+' : '') + f.data.pm + ' across ' +
      mins(f.data.dur) + rate + '.');
  });
  if (worst && !told.has(key(worst))) {
    out.push('At the other end of it, ' + R.subj(worst.side) + ' lost ' +
      Math.abs(worst.data.pm) + ' points in ' + mins(worst.data.dur) + ' with ' +
      five(g, worst.data.ids) + ' out there \u2014 the combination that cost ' +
      'them most.');
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
  if (leaders.length === 2) {
    const [a, b] = leaders;
    out.push(pickVaried('lead' + a.id + b.id, [
      nameOf(a) + ' led ' + club(a.team) + ' with ' + a.pts + ', and ' +
        nameOf(b) + ' had ' + b.pts + ' for ' + club(b.team) + '.',
      nameOf(a) + ' top-scored for ' + club(a.team) + ' with ' + a.pts +
        ', while ' + nameOf(b) + ' managed ' + b.pts + ' for ' + club(b.team) + '.',
      club(a.team) + ' had ' + nameOf(a) + ' for ' + a.pts + '; ' +
        club(b.team) + ' had ' + nameOf(b) + ' for ' + b.pts + '.'
    ]));
  } else if (leaders.length === 1) {
    const a = leaders[0];
    out.push(nameOf(a) + ' led ' + club(a.team) + ' with ' + a.pts +
      (aboveAverage(a) ? ', a season high.' : '.'));
  }

  /* ---- who else contributed -------------------------------------------- */
  const seen = new Set(leaders.map(p => p.id));
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
  byKind('creator').slice(0, 2).forEach(f => {
    const p = f.data.p;
    if (specialSeen.has(p.id)) return;
    specialSeen.add(p.id);
    specials.push({ side: p.team, txt: nameOf(p) + ' had ' + spell(p.ast || 0) + ' assists' });
  });
  byKind('shooter').slice(0, 2).forEach(f => {
    const p = f.data.p;
    if (specialSeen.has(p.id)) return;
    specialSeen.add(p.id);
    specials.push({ side: p.team, txt: nameOf(p) + ' hit ' + spell(p.p3m || 0) + ' from three' });
  });
  byKind('defender').slice(0, 2).forEach(f => {
    const p = f.data.p;
    if (specialSeen.has(p.id)) return;
    specialSeen.add(p.id);
    const bits = [];
    if ((p.stl || 0) >= 3) bits.push(spell(p.stl) + ' steals');
    if ((p.blk || 0) >= 3) bits.push(spell(p.blk) + ' blocks');
    if (bits.length) specials.push({ side: p.team,
      txt: nameOf(p) + ' finished with ' + bits.join(' and ') });
  });
  if (specials.length) {
    out.push(joinClauses(sides(specials.slice(0, 4)).map(grp =>
      list(grp.items.map(x => x.txt)) + ' for ' + club(grp.t))) + '.');
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
  if (rough.length) {
    /* the possessive puts the club in front of its own men, which reads more
       naturally here than trailing "for X" onto a list of shooting lines */
    const clauses = sides(rough.slice(0, 4)).map(grp =>
      club(grp.t) + '\u2019s ' + list(grp.items.map(x => x.txt)));
    out.push(pickVaried('rough' + rough.length, [
      'It was a long night for ' + joinClauses(clauses) + '.',
      'Little went right for ' + joinClauses(clauses) + '.',
      joinClauses(clauses) + ' never got going.'
    ]));
  }

  /* ---- who fouled out --------------------------------------------------- */
  const dq = byKind('fouledOut').map(f => ({ side: f.data.p.team, txt: nameOf(f.data.p) }));
  if (dq.length) {
    /* "to fouls" belongs to each clause: trailing it once onto a joined pair
       left the first club merely "losing" its players. */
    const clauses = sides(dq).map(grp =>
      club(grp.t) + ' lost ' + list(grp.items.map(x => x.txt)) + ' to fouls');
    out.push(joinClauses(clauses) + '.');
  }

  return out;
}

function fmtMinShort(ms) { return Math.round((ms || 0) / 60000) + ' minutes'; }

/* ------------------------------------------------------------- assemble --- */
function report(g) {
  const st = S();
  const fs = st.facts(g);
  /* One referrer for the whole article, so "they" in the third section still
     knows who the second section was talking about. */
  const R = makeRef(g, fs);
  /* first word of each club name, so the joiner never lower-cases one */
  PROPER = new Set(g.names.map(n => tc(String(n)).split(" ")[0]));
  const secs = [];
  const add = (heading, paras, card) => {
    if (paras && paras.length) secs.push({ heading, paras, card });
  };
  add('How it was won', sectionFlow(g, fs, R), 'quarters');
  add('The numbers that decided it', sectionNumbers(g, fs, R), 'factors');
  add('On the floor', sectionLineups(g, fs, R), 'lineups');
  add('The performances', sectionPlayers(g, fs, R), 'players');
  return { headline: headline(g, fs), standfirst: standfirst(g, fs),
           sections: secs, facts: fs };
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

return { report, plain, headline, standfirst, five,
         __x: { sectionFlow, sectionNumbers, sectionLineups, sectionPlayers, makeRef, joinSentences } };
}));
