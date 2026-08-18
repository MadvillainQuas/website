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
    const mine = factor.side === 0 ? factor.data.a : factor.data.b;
    const theirs = factor.side === 0 ? factor.data.b : factor.data.a;
    bits.push(nm(g, factor.side) + ' won ' + factor.data.label + ', ' +
      pct1(mine) + ' to ' + pct1(theirs));
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
    /* ONE FACTOR CARRIES THE FIGURES. Printing the gap and both percentages
       for every factor, then joining two of them, put six numbers in one
       sentence — the single densest thing the writer produced. The decisive
       factor gets its numbers; the others are named, because knowing WHICH
       four factors a side won is the point and the reader can see the values
       on the card directly underneath. */
    const lead = factors[0];
    const mine = lead.side === 0 ? lead.data.a : lead.data.b;
    const theirs = lead.side === 0 ? lead.data.b : lead.data.a;
    const who = R.subj(lead.side, { allowRole: true });
    let sentence = pick('ff' + lead.data.factor + lead.side, [
      who + ' won this at ' + lead.data.label + ', ' + pct1(mine) + ' against ' + pct1(theirs),
      who + ' were the better side on ' + lead.data.label + ' — ' + pct1(mine) + ' to ' + pct1(theirs),
      'The difference was ' + lead.data.label + ': ' + who + ' at ' + pct1(mine) + ', their opponents ' + pct1(theirs)
    ]);
    const also = factors.slice(1).filter(f => f.side === lead.side).map(f => f.data.label);
    if (also.length === 1) sentence += ', and had the better of ' + also[0] + '' + ' too';
    else if (also.length > 1) sentence += ', with ' + also.slice(0, -1).join(', ') +
      ' and ' + also[also.length - 1] + ' going the same way';
    out.push(sentence + '.');
  }

  /* how they scored, not just how well */
  const zone = fs.find(f => f.kind === 'fromRange' || f.kind === 'atRim');
  const share = fs.find(f => f.kind === 'sharing');
  const shapeBits = [];
  if (zone) {
    shapeBits.push(R.subj(zone.side, { allowRole: true }) +
      (zone.kind === 'fromRange'
        ? ' played from distance \u2014 ' + pct1(zone.data.share) +
          ' of their attempts were threes against ' + pct1(zone.data.theirs)
        : ' lived at the rim, ' + pct1(zone.data.share) +
          ' of their shots from close against ' + pct1(zone.data.theirs)));
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

function sectionPlayers(g, fs, R) {
  const out = [];
  const kinds = ['tripleDouble', 'doubleDouble', 'bigScore', 'aboveSelf', 'creator',
                 'shooter', 'defender', 'efficient', 'belowSelf', 'fouledOut',
                 'drawsFouls', 'inefficient'];
  const seen = new Set(), picked = [];
  fs.filter(f => kinds.indexOf(f.kind) >= 0).forEach(f => {
    const id = f.data.p && f.data.p.id;
    if (!id || seen.has(id)) return;
    seen.add(id); picked.push(f);
  });

  /* "led" is a claim about the whole team, not about the player it is attached
     to. Firing it per-fact produced two different players leading the same side
     in one report. */
  const topScorer = [0, 1].map(t => g.players
    .filter(p => p.team === t)
    .reduce((best, p) => (!best || (p.pts || 0) > (best.pts || 0) ? p : best), null));
  const isLeader = p => topScorer[p.team] && topScorer[p.team].id === p.id;

  const seasonOf = id => {
    const S = g.season;
    if (!S || !S.players) return null;
    return S.players.find(x => x.id === id) || null;
  };

  picked.slice(0, 6).forEach(f => {
    const p = f.data.p;
    const nme = esc(tc(p.name));
    const sd = p.id + f.kind;
    const pts = p.pts || 0;
    const reb = (p.or || 0) + (p.dr || 0);
    const fgm = (p.p2m || 0) + (p.p3m || 0), fga = (p.p2a || 0) + (p.p3a || 0);
    const sp = seasonOf(p.id);
    const gap = (sp && num(sp.ppg) != null) ? pts - sp.ppg : null;

    /* ONE FIGURE CARRIES THE CLAUSE. Where a second earns its place it goes in
       a subordinate clause rather than a comma-separated list, and everything
       else the engine knows is dropped. */
    if (f.kind === 'tripleDouble') {
      out.push(pick(sd, [
        nme + ' was everywhere for ' + R.obj(f.side) + ', filling every column on the sheet.',
        'There was a triple-double in it too, ' + nme + ' touching every part of the game.'
      ]));

    } else if (f.kind === 'doubleDouble') {
      out.push(pick(sd, [
        nme + ' worked the glass for a double-double, ' + spell(reb) + ' rebounds to go with his ' + pts + '.',
        nme + ' had ' + pts + ' and ' + spell(reb) + ' boards, the kind of night that does not need explaining.',
        'A double-double for ' + nme + ', who finished with ' + pts + ' and ' + spell(reb) + ' off the glass.'
      ]));

    } else if (f.kind === 'bigScore' || f.kind === 'aboveSelf') {
      const big = gap != null && gap >= 6;
      if (isLeader(p)) {
        out.push(pick(sd, [
          nme + ' carried ' + R.obj(f.side) + ' with ' + pts +
            (big ? ', comfortably his best of the season.' : '.'),
          nme + ' top-scored with ' + pts +
            (big ? ' — well clear of what he usually manages.' : ', and looked the most likely all night.'),
          'It was ' + nme + ' who led the way, his ' + pts +
            (big ? ' a season high.' : ' the highest on either side.')
        ]));
      } else {
        out.push(pick(sd, [
          nme + ' chipped in with ' + pts + (big ? ', well up on his usual return.' : '.'),
          nme + ' added ' + pts + ' from ' + spell(fga) + ' attempts.',
          'Behind him, ' + nme + ' contributed ' + pts + '.'
        ]));
      }

    } else if (f.kind === 'creator') {
      out.push(pick(sd, [
        nme + ' ran the offence, ' + spell(p.ast || 0) + ' assists and rarely a wasted pass.',
        'Most of it came through ' + nme + ', who finished with ' + spell(p.ast || 0) + ' assists.',
        nme + ' set the table all evening — ' + spell(p.ast || 0) + ' assists.'
      ]));

    } else if (f.kind === 'shooter') {
      out.push(pick(sd, [
        nme + ' found his range from three, ' + spell(p.p3m || 0) + ' of them by the end.',
        'From distance it was ' + nme + ', who knocked down ' + spell(p.p3m || 0) + '.',
        nme + ' was the one stretching the floor, ' + spell(p.p3m || 0) + ' from the arc.'
      ]));

    } else if (f.kind === 'defender') {
      const what = (p.blk || 0) >= (p.stl || 0)
        ? spell(p.blk || 0) + ' blocks' : spell(p.stl || 0) + ' steals';
      out.push(pick(sd, [
        nme + ' was a nuisance at the other end, ' + what + ' among the damage.',
        'Defensively ' + nme + ' caused problems all night, ' + what + ' to show for it.',
        nme + ' made the other end hard work — ' + what + '.'
      ]));

    } else if (f.kind === 'efficient') {
      out.push(pick(sd, [
        nme + ' barely missed, ' + spell(fgm) + ' of ' + spell(fga) + ' from the field.',
        'Nothing was forced from ' + nme + ', who went ' + spell(fgm) + ' of ' + spell(fga) + '.',
        nme + ' took what came and made almost all of it.'
      ]));

    } else if (f.kind === 'belowSelf') {
      out.push(pick(sd, [
        nme + (pts === 0 ? ' never got on the board at all.'
                         : ' never got going, held to ' + spell(pts) + '.'),
        'It was a quiet night for ' + nme + (pts === 0 ? ', who never scored.'
                                                       : ', who managed ' + spell(pts) + '.'),
        nme + ' could not find it, well short of his usual.'
      ]));

    } else if (f.kind === 'fouledOut') {
      out.push(pick(sd, [
        nme + ' fouled out with time still on the clock.',
        nme + ' was gone before the end, five fouls and an early seat.',
        'Trouble found ' + nme + ', who fouled out.'
      ]));

    } else if (f.kind === 'drawsFouls') {
      out.push(pick(sd, [
        nme + ' spent much of the night at the line.',
        'Nobody drew more contact than ' + nme + '.'
      ]));

    } else {
      out.push(pick(sd, [
        nme + ' had one of those nights, ' + spell(fgm) + ' from ' + spell(fga) + '.',
        'Little went down for ' + nme + '.'
      ]));
    }
  });
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
