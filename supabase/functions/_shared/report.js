/* GENERATED from epinoia/report.js by supabase/tests/extract-shared.mjs — do not edit. */
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
      ? 'A ' + decisive.data.n + '–0 run in the ' + ordinal(decisive.data.period) + ' settled it'
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

/* ------------------------------------------------------------- sections --- */
function sectionFlow(g, fs) {
  const out = [];
  const r  = fs.find(f => f.kind === 'result');
  if (!r) return out;
  const cb = fs.find(f => f.kind === 'comeback');
  const bl = fs.find(f => f.kind === 'biggestLead');
  const run = fs.find(f => f.kind === 'run');
  const q  = fs.find(f => f.kind === 'quarter');
  const lc = fs.find(f => f.kind === 'leadChanges');
  const sw = fs.find(f => f.kind === 'sweep');

  const open = [nm(g, r.data.winner) + ' took this ' +
    Math.max(g.score[0], g.score[1]) + '–' + Math.min(g.score[0], g.score[1]) +
    (r.data.how === 'rout' ? ', and it was never close'
     : r.data.how === 'squeaker' ? ', on a night that could have gone either way'
     : r.data.how === 'comfortable' ? ', pulling clear when it mattered' : '') + '.'];
  if (cb) open.push('They had trailed by ' + cb.data.deficit + ', which makes this ' +
    'the sort of result that says more about the second half than the first.');
  else if (bl) open.push(nm(g, bl.side) + ' led by as many as ' + bl.data.by + '.');
  out.push(open.join(' '));

  const mid = [];
  if (run) mid.push('The decisive spell was a ' + run.data.n + '–0 run in the ' +
    ordinal(run.data.period) + ' — ' + plural(run.data.n, 'unanswered point') +
    ' is a lead built and an opponent’s rhythm taken away in the same breath.');
  if (q) mid.push(nm(g, q.side) + ' won the ' + ordinal(q.data.period) + ' ' +
    Math.max(q.data.pf, q.data.pa) + '–' + Math.min(q.data.pf, q.data.pa) +
    ', the period that separated them.');
  if (sw) mid.push(nm(g, sw.side) + ' outscored their opponents in every period.');
  if (lc) mid.push('There were ' + plural(lc.data.changes, 'lead change') +
    ', so neither side ever properly settled.');
  if (mid.length) out.push(mid.join(' '));
  return out;
}

function sectionNumbers(g, fs) {
  const out = [];
  const factors = fs.filter(f => f.kind === 'factor').slice(0, 3);
  if (factors.length) {
    out.push(factors.map(f => {
      const mine = f.side === 0 ? f.data.a : f.data.b;
      const theirs = f.side === 0 ? f.data.b : f.data.a;
      return nm(g, f.side) + ' won ' + f.data.label + ' by ' + one(f.data.gap) +
        ' (' + pct1(mine) + ' against ' + pct1(theirs) + ')';
    }).join('; ') + '.');
  }
  const shape = fs.filter(f =>
    ['bench', 'pointsOffTurnovers', 'paint', 'secondChance'].indexOf(f.kind) >= 0)
    .slice(0, 3);
  if (shape.length) {
    out.push(shape.map(f =>
      f.kind === 'bench' ? nm(g, f.side) + '’s bench put up ' + f.data.bench +
        ' to ' + f.data.other
    : f.kind === 'pointsOffTurnovers' ? nm(g, f.side) + ' turned giveaways into ' +
        f.data.pot + ' points'
    : f.kind === 'paint' ? nm(g, f.side) + ' scored ' + f.data.a +
        ' in the paint to ' + f.data.b
    : nm(g, f.side) + ' found ' + f.data.sc + ' second-chance points'
    ).join('; ') + '.');
  }
  return out;
}

/* Enough floor time before a per-100 rate is worth quoting. A group that
   played three minutes has faced perhaps eight possessions, and eight
   possessions produce net ratings like 106.8 — a number that is arithmetically
   correct and journalistically meaningless. Below this the sentence reports
   the plus-minus and the minutes, which are counts rather than rates and stay
   true at any sample size. */
const RATE_MIN_MS = 360000;   // six minutes

function sectionLineups(g, fs) {
  const out = [];
  const stretch = fs.find(f => f.kind === 'stretch');
  const bests = fs.filter(f => f.kind === 'lineupBest');
  const worst = fs.find(f => f.kind === 'lineupWorst');

  /* THE SAME FIVE MINUTES, TOLD ONCE. The deciding stretch, one side's best
     group and the other's worst are frequently the very same passage of play
     seen from three directions, and reporting all three read as a stutter:
     "a 4:11 spell", then "+11 across 4:11", then "lost 11 points in 4:11".
     A group is described once, by whichever fact ranked highest. */
  const told = new Set();
  const key = f => (f.data.ids || []).slice().sort().join(',') + '@' + f.data.dur;

  if (stretch) {
    told.add(key(stretch));
    const owner = stretch.data.owner, gained = owner === stretch.side;
    out.push('The game turned inside a single ' + mins(stretch.data.dur) +
      ' spell with ' + five(g, stretch.data.ids) + ' on the floor for ' +
      nm(g, owner) + ': ' + (gained ? 'they gained ' : 'they were outscored by ') +
      stretch.data.swing + ' points in that stretch alone. Nothing else in the ' +
      'game moved the scoreboard as far in as little time.');
  }
  bests.slice(0, 2).forEach(f => {
    if (told.has(key(f))) return;
    told.add(key(f));
    const rate = (num(f.data.net) != null && f.data.dur >= RATE_MIN_MS)
      ? ', worth ' + one(Math.abs(f.data.net)) + ' points per 100 possessions ' +
        'while they were together' : '';
    out.push(nm(g, f.side) + '’s strongest group — ' + five(g, f.data.ids) +
      ' — was ' + (f.data.pm > 0 ? '+' : '') + f.data.pm + ' across ' +
      mins(f.data.dur) + rate + '.');
  });
  if (worst && !told.has(key(worst))) {
    out.push('At the other end of it, ' + nm(g, worst.side) + ' lost ' +
      Math.abs(worst.data.pm) + ' points in ' + mins(worst.data.dur) + ' with ' +
      five(g, worst.data.ids) + ' out there — the combination that cost them most.');
  }
  return out;
}

function sectionPlayers(g, fs) {
  const out = [];
  const kinds = ['tripleDouble', 'doubleDouble', 'bigScore', 'shooter',
                 'efficient', 'inefficient'];
  const seen = new Set(), picked = [];
  fs.filter(f => kinds.indexOf(f.kind) >= 0).forEach(f => {
    const id = f.data.p && f.data.p.id;
    if (!id || seen.has(id)) return;      // one sentence per player, their best
    seen.add(id); picked.push(f);
  });

  picked.slice(0, 5).forEach(f => {
    const p = f.data.p;
    const reb = (p.or || 0) + (p.dr || 0);
    /* plural() throughout — "13 rebounds and 1 assists" is the kind of seam
       that makes generated prose read as generated */
    const line = plural(p.pts || 0, 'point') + ', ' + plural(reb, 'rebound') +
      ' and ' + plural(p.ast || 0, 'assist');
    const shooting = ((p.p2m || 0) + (p.p3m || 0)) + ' of ' +
      ((p.p2a || 0) + (p.p3a || 0)) + ' from the field';
    if (f.kind === 'tripleDouble') {
      out.push(esc(tc(p.name)) + ' filled every column for ' + nm(g, f.side) + ' — ' + line + '.');
    } else if (f.kind === 'doubleDouble') {
      out.push(esc(tc(p.name)) + ' went for ' + line + ' for ' + nm(g, f.side) + '.');
    } else if (f.kind === 'bigScore') {
      out.push(esc(tc(p.name)) + ' led ' + nm(g, f.side) + ' with ' + p.pts + ', ' +
        shooting + (num(p.ts) != null ? ' for ' + pct1(p.ts) + ' true shooting' : '') + '.');
    } else if (f.kind === 'shooter') {
      out.push(esc(tc(p.name)) + ' was the range-finder, ' + p.p3m + ' of ' + p.p3a + ' from three.');
    } else if (f.kind === 'efficient') {
      out.push(esc(tc(p.name)) + ' barely wasted a possession — ' + shooting +
        ' at ' + pct1(p.ts) + ' true shooting.');
    } else {
      out.push(esc(tc(p.name)) + ' had one of those nights: ' + shooting + '.');
    }
  });
  return out;
}

/* ------------------------------------------------------------- assemble --- */
function report(g) {
  const st = S();
  const fs = st.facts(g);
  const secs = [];
  const add = (heading, paras, card) => {
    if (paras && paras.length) secs.push({ heading, paras, card });
  };
  add('How it was won', sectionFlow(g, fs), 'quarters');
  add('The numbers that decided it', sectionNumbers(g, fs), 'factors');
  add('On the floor', sectionLineups(g, fs), 'lineups');
  add('The performances', sectionPlayers(g, fs), 'players');
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
         __x: { sectionFlow, sectionNumbers, sectionLineups, sectionPlayers } };
}));

/* ---------------------------------------------------------------------------
   GENERATED TAIL — do not edit this file. Edit the browser copy and re-run
   `node supabase/tests/extract-shared.mjs`; CI fails if the two drift.

   The UMD half above attaches to globalThis; this re-exports the same object
   so the Edge Function and the browser run one identical file.
   --------------------------------------------------------------------------- */
const __api = globalThis.EpinoiaReport;
export const { report, plain, headline, standfirst, five } = __api;
export default __api;
