'use strict';
/* ============================================================================
   THE FIXTURE PREVIEW — what a scheduled game's page is instead of a box score.

   A game that has not been played has no box score, and drawing one anyway is
   what produced five tabs of zeroes, a running clock and an empty
   play-by-play. Worse, it read as live. So a scheduled fixture gets a
   different page: when it is, how to get to it, and what the season so far
   says about the two clubs meeting.

   THE WRITING IS GENERATED FROM THE NUMBERS, not fetched from a model. Every
   sentence is derived at render time from the same season aggregates the
   statistics pages use — four factors both ways, ratings, pace, shot diet and
   per-player advanced rows. That is a deliberate choice rather than a
   shortcut:

     * no key, no per-view cost, no round trip, so a preview cannot arrive
       half-written or rate-limit a fixture list;
     * it cannot invent a statistic, which a language model asked to write
       about basketball will do cheerfully and plausibly;
     * it says the same thing about the same numbers every time, so a preview
       does not change its mind between two refreshes.

   What it gives up is prose that surprises you. The compensation is that every
   clause is anchored to a value printed on the page underneath it, and it
   talks about the things a person would actually notice: the biggest GAP
   between the two clubs rather than a recital of both sides' averages.
   Ranking the differences and speaking only about the top few is what keeps it
   from reading like a table set in sentences.

   NOTHING HERE IS CONFIDENT ABOUT A SMALL SAMPLE. A club three games into a
   season has no meaningful four-factor profile, and the copy says so rather
   than describing noise. Where a statistic is missing the sentence is not
   written at all — three paragraphs beat six, two of which are about nothing.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaPreview = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const num  = v => (v == null || v === '' || isNaN(v) ? null : +v);
const pct1 = v => (num(v) == null ? '—' : (+v).toFixed(1) + '%');
const one  = v => (num(v) == null ? '—' : (+v).toFixed(1));

/* Enough games for a rate statistic to mean anything. Below this the preview
   reports the record and stays quiet about tendencies. */
const MIN_GP = 3;

/* ------------------------------------------------------------ the starting five ---
   WHO IS STARTING, AS SOON AS THE TABLE HAS SAID SO.

   A LiveStats table confirms its starting five in pre-game setup, minutes before
   the ball goes up, and that is the single most interesting fact about a fixture
   in the half hour before it. It used to arrive and go straight past: the ingest
   wrote the roster and marked the game live in the same breath, so the preview was
   already gone by the time anybody could have read it.

   The circles are the ones the modern box score uses — same face, same number,
   same court, the classes live in modern.css which this page already loads — so
   the preview and the live view are plainly the same game rather than two designs
   that happen to be adjacent. No stat line under them, because there are no stats
   yet; that is the whole point of the graphic.

   The five are dealt onto the spots in the order the table listed them, which is
   the scoresheet's own order. Guessing at positions from a name and a number would
   be inventing information on the one screen whose job is to report what is known. */
const SLOTS = [
  /* fractions of the half court (boxscore.js COURT: 1500 wide, 1400 deep, ring at
     the top). Kept in step with the same table in game/modern.js. */
  { x: 0.50, y: 0.84 },
  { x: 0.19, y: 0.62 },
  { x: 0.81, y: 0.62 },
  { x: 0.29, y: 0.31 },
  { x: 0.71, y: 0.22 }
];

/* Only a fallback for when no game-wide disambiguation was handed in — see the
   labels param below, and the note above nameLabelsOf() near startersHTML. */
const surname = n => {
  const s = String(n || '').trim().split(/\s+/);
  return s.length > 1 ? s[s.length - 1] : (s[0] || '');
};

function fiveCircles(players, colour, labels) {
  return (players || []).slice(0, 5).map((p, i) => {
    const slot = SLOTS[Math.min(SLOTS.length - 1, i)];
    const label = (labels && labels[p.id]) || surname(p.name);
    return '<div class="mv-p floor" data-pid="' + esc(p.id) + '"' +
      ' style="left:' + (slot.x * 100).toFixed(1) + '%;top:' + (slot.y * 100).toFixed(1) + '%"' +
      ' aria-label="' + esc(p.name) + '">' +
      '<span class="mv-shadow"></span>' +
      '<span class="sq-face" style="--c:' + esc(colour) + '"><span class="sq-nm">' + esc(p.name) + '</span></span>' +
      (p.num !== '' && p.num != null ? '<span class="mv-num">' + esc(p.num) + '</span>' : '') +
      /* --nl matches modern.js's own floor circles: a short surname keeps full size, a
         disambiguated "Mal. Delpeche" shrinks instead of running past the badge. */
      '<span class="mv-nm" style="--nl:' + label.length + '">' + esc(label) + '</span>' +
      '</div>';
  }).join('');
}

function sideHTML(players, colour, name, labels) {
  const B = (typeof globalThis !== 'undefined') && globalThis.EpinoiaBox;
  const court = (B && B.courtSVG) ? B.courtSVG(null, { plain: true }) : '';
  return '<div class="pv-five" style="--c:' + esc(colour) + '">' +
    '<div class="pv-fivehead" style="color:' + esc(colour) + '">' + esc(name) + '</div>' +
    '<div class="mv-court">' + court + '<div class="mv-five">' + fiveCircles(players, colour, labels) + '</div></div>' +
    '</div>';
}

/* Both fives, or nothing. Half a lineup is a graphic that raises a question it
   cannot answer, and a fixture where only one table has finished its setup is a
   normal state a few minutes before a tip.

   id="starters" is where a lineups notification lands (game/?g=…&show=starters,
   docs/notifications.md §6): game.js scrolls to it on a preview, and draws this
   same section above the tabs of a game already live or final — ctx.status says
   which, so the note does not promise a tip-off that has already happened. */
function startersHTML(ctx) {
  const A = ctx.startersA || [], B = ctx.startersB || [];
  if (A.length < 5 || B.length < 5) return '';
  const started = ctx.status === 'live' || ctx.status === 'final' || ctx.status === 'finalising';
  const at = whenText(ctx.tipoff).time;
  const note = !started ? 'Confirmed at the table. Tip-off is ' + esc(at.toLowerCase()) + '.'
    : at === 'TBC' ? 'Confirmed at the table.'
    : 'Confirmed at the table. Tipped off at ' + esc(at.toLowerCase()) + '.';
  /* THE SAME QUESTION MODERN.JS ASKS OF THE FLOOR CIRCLES, ASKED HERE OF THE PREVIEW.
     Two clubs put a Marcus Delpeche and a Malcolm Delpeche on the same roster and this
     card had no way to tell them apart -- its own surname-only helper doesn't look past
     the one player it's labelling, so both circles came out "DELPECHE" (2026-09-18).
     game.js already computes this game-wide disambiguation for the squad strip
     (window.EpinoiaModernBox.nameLabels over both rosters) and hands it in as
     ctx.nameLabels; a caller that has no roster to build it from (e.g. a test) simply
     omits it and every label falls back to the bare surname, same as before. */
  const labels = ctx.nameLabels || {};
  return '<section class="pv-sec" id="starters">' +
    '<h2>Starting five</h2>' +
    '<p class="pv-fivenote" data-i18n-ctx="report">' + note + '</p>' +
    '<div class="pv-fives">' +
      sideHTML(A, ctx.colourA, ctx.nameA, labels) +
      sideHTML(B, ctx.colourB, ctx.nameB, labels) +
    '</div>' +
  '</section>';
}

/* ------------------------------------------------------- the injury report ---
   WHO IS A QUESTION MARK. Not a filed injury list — no league files one — but
   what the box scores already say: a player each club was playing who has not
   taken the floor since (epinoia/injuries.js, the same report the league's own
   page and the global wire draw, so the three cannot disagree).

   A QUESTION MARK, NOT A VERDICT. Nobody has said anybody is hurt, and the row
   says only what is known: how many of the club's games they have missed and
   what they were doing before that. It resolves itself — the first game they
   record a minute in, they are off this section, off the wire and off the
   league's report together, because none of the three is storing a judgement.

   ctx.outA / ctx.outB: [{ name, line, dnp, stale, href }], already named by
   game.js, so this file stays a pure string function. A fixture with nobody
   missing on either side gets no section: an empty heading is a worry about
   nothing. */
function outSide(list, colour, name) {
  const rows = (list || []).map(p =>
    '<div class="wr-row' + (p.dnp ? ' is-dnp' : '') + (p.stale ? ' is-stale' : '') + '">' +
      '<span class="wr-q" aria-hidden="true">' + (p.dnp ? '–' : '?') + '</span>' +
      '<span class="wr-who">' +
        (p.href ? '<a class="wr-name" href="' + esc(p.href) + '">' + esc(p.name) + '</a>'
                : '<span class="wr-name">' + esc(p.name) + '</span>') +
        '<span class="wr-line" data-i18n-ctx="report">' + esc(p.line) + '</span>' +
      '</span>' +
    '</div>').join('');
  return '<div class="pv-out-side" style="--pc:' + esc(colour) + '">' +
    '<div class="pv-out-h">' + esc(name) + '</div>' +
    (rows || '<p class="pv-out-none" data-i18n-ctx="report">Nobody missing.</p>') +
    '</div>';
}
function injuriesHTML(ctx) {
  const A = ctx.outA || [], B = ctx.outB || [];
  if (!A.length && !B.length) return '';
  return '<section class="pv-sec" id="injuries">' +
    '<h2>Injury report</h2>' +
    '<p class="pv-fivenote" data-i18n-ctx="report">Worked out from the box scores: players each club was using who have ' +
    'not taken the floor since. Nobody files this, and it clears itself the moment they play.</p>' +
    '<div class="pv-out">' + outSide(A, ctx.colourA, ctx.nameA) + outSide(B, ctx.colourB, ctx.nameB) + '</div>' +
    '<a class="pv-more" href="../injuries/' + (ctx.leagueSlug ? '?l=' + esc(encodeURIComponent(ctx.leagueSlug)) : '') +
    '">the whole report ↗</a>' +
    '</section>';
}

/* ------------------------------------------------------------ four factors ---
   The four things that decide a basketball game, in their usual order of
   weight. `low` marks the ones where a smaller number is better, so a
   comparison never has to know which way each factor runs. */
const FACTORS = [
  { k: 'efg',  off: 'ff_efg',  def: 'dff_efg',  label: 'shooting',
    full: 'effective field goal %' },
  { k: 'tov',  off: 'ff_tov',  def: 'dff_tov',  label: 'turnovers',
    full: 'turnover rate', low: true },
  { k: 'oreb', off: 'ff_oreb', def: 'dff_oreb', label: 'offensive glass',
    full: 'offensive rebound %' },
  { k: 'ftr',  off: 'ff_ftr',  def: 'dff_ftr',  label: 'free throws',
    full: 'free throw rate' }
];

/* The gap on one factor, signed so positive always means "A is better",
   whichever direction the underlying number runs. */
function edge(f, a, b) {
  const x = num(a), y = num(b);
  if (x == null || y == null) return null;
  return f.low ? y - x : x - y;
}

/* =============================================================== narrative ===
   Sentences are assembled from ranked observations rather than from a template
   with holes in it: work out what is most worth saying about THIS pairing, then
   say only that. Each observation carries a strength so the paragraph can be
   ordered by how much it matters and truncated without losing the best line. */

function teamShape(t) {
  if (!t || !t.gp) return null;
  const ff = {}, dff = {};
  FACTORS.forEach(f => { ff[f.k] = num(t[f.off]); dff[f.k] = num(t[f.def]); });
  return {
    gp: t.gp, ortg: num(t.ortg), drtg: num(t.drtg), net: num(t.net),
    pace: num(t.pace), ppg: num(t.ppg), papg: num(t.papg),
    ff, dff,
    p3_share: num(t.p3_share), rim_share: num(t.rim_share),
    p3_acc: num(t.p3_acc), ast_to: num(t.ast_to)
  };
}

/* a club's possessive: "Saga Ballooners’", "Alvark Tokyo’s" */
const poss = n => n + (/s$/i.test(String(n).replace(/<[^>]*>/g, '')) ? '’' : '’s');

function observations(A, B, nameA, nameB) {
  const out = [];
  const push = (strength, text) => out.push({ strength, text });

  /* --- the headline: who has been better, and by how much --- */
  if (A.net != null && B.net != null) {
    const d = A.net - B.net, m = Math.abs(d);
    if (m < 2) {
      push(10, 'On the season so far there is almost nothing between them: ' +
        esc(nameA) + ' at ' + one(A.net) + ' net points per 100 possessions, ' +
        esc(nameB) + ' at ' + one(B.net) + '.');
    } else {
      const lead = d > 0 ? nameA : nameB, trail = d > 0 ? nameB : nameA;
      const how = m > 12 ? 'by a distance' : m > 6 ? 'clearly' : 'narrowly';
      push(10, esc(lead) + ' have been the better team ' + how + ' — ' +
        one(Math.max(A.net, B.net)) + ' net points per 100 against ' +
        one(Math.min(A.net, B.net)) + ' for ' + esc(trail) + '.');
    }
  }

  /* --- the strength meeting a weakness, which decides most games ---
     An offence that does one thing well, against a defence that concedes
     exactly that thing, is the most useful sentence a preview can carry. Both
     directions are scored and only the sharper one survives. */
  let best = null;
  const consider = (f, attName, defName, off, def) => {
    const v = edge(f, off, def);
    /* ONLY A POSITIVE EDGE IS A MATCHUP. A negative one means the attacking
       side does this LESS well than the defence usually allows — which says
       something about the attack, not that the defence is stopping it, and an
       earlier draft of this reported exactly that backwards ("good at taking
       away what they do best" about a defence that was in fact generous on
       that factor and simply not being punished). If nothing is positive there
       is no matchup worth naming and the sentence is not written. */
    if (v == null || v <= 0) return;
    if (best == null || v > best.v) {
      best = { f: f, v: v, att: attName, def: defName,
               off: num(off), def_: num(def) };
    }
  };
  FACTORS.forEach(f => {
    consider(f, nameA, nameB, A.ff[f.k], B.dff[f.k]);
    consider(f, nameB, nameA, B.ff[f.k], A.dff[f.k]);
  });
  if (best && best.v >= 2) {
    /* Both numbers, so the claim is checkable against the cards below it
       rather than being a gap the reader has to take on trust. */
    push(9, 'The matchup to watch is ' + poss(esc(best.att)) + ' ' + best.f.label +
      ' against ' + poss(esc(best.def)) + ': on ' + best.f.full + ' ' +
      esc(best.att) + ' post ' + pct1(best.off) + ' where ' + esc(best.def) +
      ' concede ' + pct1(best.def_) + '.');
  }

  /* --- tempo, when the two want different games --- */
  if (A.pace != null && B.pace != null && Math.abs(A.pace - B.pace) >= 4) {
    const fast = A.pace > B.pace ? nameA : nameB;
    const slow = A.pace > B.pace ? nameB : nameA;
    push(7, 'They want different games: ' + esc(fast) + ' have played at ' +
      one(Math.max(A.pace, B.pace)) + ' possessions per 40 to ' + poss(esc(slow)) +
      ' ' + one(Math.min(A.pace, B.pace)) + ', so whoever sets the ' +
      'tempo has already won something.');
  }

  /* --- shot diet, where it is lopsided enough to change how it looks --- */
  if (A.p3_share != null && B.p3_share != null &&
      Math.abs(A.p3_share - B.p3_share) >= 8) {
    const heavyA = A.p3_share > B.p3_share;
    const heavy = heavyA ? nameA : nameB;
    const share = Math.max(A.p3_share, B.p3_share);
    const acc = heavyA ? A.p3_acc : B.p3_acc;
    push(6, esc(heavy) + ' live behind the arc — ' + pct1(share) +
      ' of their shots are threes' + (acc != null ? ', at ' + pct1(acc) : '') +
      ' — which makes this a game that can swing quickly either way.');
  }

  /* --- turnovers: the factor most often decided by one side alone --- */
  const tEdge = edge(FACTORS[1], A.ff.tov, B.ff.tov);
  if (tEdge != null && Math.abs(tEdge) >= 3) {
    const safe = tEdge > 0 ? nameA : nameB;
    push(5, esc(safe) + ' have looked after the ball far better — a ' +
      one(Math.abs(tEdge)) + ' point gap in turnover rate is possessions ' +
      'handed over, and that is usually the game.');
  }

  return out.sort((x, y) => y.strength - x.strength);
}

/* A player worth a sentence, chosen for being unusual rather than for topping
   a list — a preview that only ever names the leading scorer stops being read
   after the second week. */
function playerNote(p, teamName) {
  if (!p || !p.gp || p.gp < MIN_GP) return null;
  const bits = [];
  if (num(p.ts) != null && p.ts >= 58 && num(p.ppg) != null && p.ppg >= 10) {
    bits.push('scoring at ' + pct1(p.ts) + ' true shooting');
  }
  if (num(p.ast_to) != null && p.ast_to >= 2 && num(p.apg) != null && p.apg >= 3) {
    bits.push(one(p.ast_to) + ' assists for every turnover');
  }
  if (num(p.p3_pct) != null && p.p3_pct >= 38 &&
      num(p.p3a) != null && p.p3a >= 2 * p.gp) {
    bits.push(pct1(p.p3_pct) + ' from three on real volume');
  }
  if (num(p.rpg) != null && p.rpg >= 8) bits.push(one(p.rpg) + ' rebounds a game');
  if (!bits.length) return null;
  return esc(p.name || 'A player') + ' is the one to watch for ' +
         esc(teamName) + ' — ' + bits.slice(0, 2).join(' and ') + '.';
}

/* ============================================================================
   THE MATCHUP, VALUED (2026-10-07): what the season says about THIS game, from context.js preview() (ctx.pre) - where
   the two stand and how they come in (runs, the meetings, the rest), what the season's four factors expect when this
   offence meets that defence (the league's own What Wins weights where it has them), which facet the game turns on and
   who carries each side's form - and then an honest lean, with what argues against it. Every figure is one context.js
   worked out from games already played; nothing is a prediction dressed as a fact.
   ============================================================================ */
const PWORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const pspell = n => { const v = Math.round(+n); return v >= 0 && v <= 12 ? PWORDS[v] : String(v); };
const ptsW = n => { const v = Math.max(1, Math.round(Math.abs(n) * 2) / 2); return (v % 1 ? String(v) : pspell(v)) + (v === 1 ? ' point' : ' points'); };
const PLACE = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const placeW = n => { const v = Math.round(+n); if (v >= 1 && v <= 10) return PLACE[v]; const t = v % 100; return v + (t >= 11 && t <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th')); };
const FACET_W = { efg: 'the shooting', tovp: 'the turnover battle', orebp: 'the offensive glass', ftr: 'getting to the line' };
const recW = s => s.w + '–' + s.l;
function valuedParas(ctx) {
  const pre = ctx.pre;
  const nameA = esc(ctx.nameA), nameB = esc(ctx.nameB);
  const N = [nameA, nameB];
  const S = pre.sides, T = pre.table || [null, null];
  const out = [];

  /* 1. WHERE THEY STAND AND HOW THEY COME IN */
  const st = [];
  if (T[0] && T[1] && T[0].gp >= 3 && T[1].gp >= 3) {
    const a = T[0], b = T[1];
    if (Math.max(a.rank, b.rank) <= 2) st.push(cap(placeW(Math.min(a.rank, b.rank))) + ' against ' + placeW(Math.max(a.rank, b.rank)) + ': ' + N[0] + ' (' + recW(a) + ') host ' + N[1] + ' (' + recW(b) + ').');
    else st.push(N[0] + ' are ' + placeW(a.rank) + ' at ' + recW(a) + ', ' + N[1] + ' ' + placeW(b.rank) + ' at ' + recW(b) + '.');
  }
  /* a run that is the whole season is said as what it is: unbeaten, or still without a win */
  const whole = t => S[t].streak && S[t].streak.n === S[t].gp && S[t].gp >= 2;
  const run = t => {
    const s = S[t].streak;
    if (!s || s.n < 3) return null;
    if (whole(t)) return s.won ? N[t] + ' are unbeaten in ' + pspell(s.n) : N[t] + ' are still without a win in ' + pspell(s.n);
    return s.won ? N[t] + ' have won ' + pspell(s.n) + ' straight' : N[t] + ' have lost their last ' + pspell(s.n);
  };
  /* HOW EACH COMES IN (the wire services' opening line): its last game, if it was in the last fortnight, the score the
     winner's first, where, against whom, and whoever carried it - "with 31 from X" in a win, "despite 31 from X" in a
     defeat. Inside a run it is the run's latest; otherwise a sentence of its own. */
  const names = ctx.names || {};
  const scoreOf = g => Math.max(g.for, g.against) + '–' + Math.min(g.for, g.against);
  const aScore = s => (/^(8\d|11|18)–/.test(s) ? 'an ' : 'a ') + s;
  /* a defeat names its best line only when it stood out (20 points, or a double-double): "despite 17" in a 25-point
     beating is no comfort worth printing */
  const carried = (top, won) => {
    if (!top || !names[top.id]) return '';
    const more = top.reb >= 10 ? ' points and ' + top.reb + ' rebounds' : top.ast >= 10 ? ' points and ' + top.ast + ' assists' : '';
    if (!(top.pts >= (won ? 15 : more ? 15 : 20))) return '';
    return (won ? ' with ' : ' despite ') + top.pts + more + ' from ' + esc(names[top.id]);
  };
  const lastG = t => { const g = S[t].last; return g && !g.tied && S[t].rest != null && S[t].rest <= 14 ? g : null; };
  const latest = t => {
    const g = lastG(t);
    if (!g) return '';
    const opp = g.oppName ? esc(g.oppName) : null;
    return ', the latest ' + scoreOf(g) + (g.home ? (opp ? ' at home to ' + opp : ' at home') : (opp ? ' at ' + opp : ' away')) + carried(g.top, g.won);
  };
  /* the second of two is said the other way round, so two sentences in a row do not open alike */
  const cameIn = (t, second) => {
    const g = lastG(t);
    if (!g) return null;
    const opp = g.oppName ? esc(g.oppName) : null;
    const c = carried(g.top, g.won);
    if (second) {
      const verb = g.won ? (opp && g.home ? 'beat ' + opp + ' ' : 'won ') : 'lost ';
      const where = g.home ? (opp && !g.won ? ' at home to ' + opp : ' at home') : (opp ? ' at ' + opp : ' away');
      return N[t] + ' ' + verb + scoreOf(g) + where + ' last time out' + (c ? ',' + c : '') + '.';
    }
    const what = g.won ? (g.home ? 'home win' : 'win') : (g.home ? 'home defeat' : 'defeat');
    const vs = opp ? (g.won ? (g.home ? ' over ' : ' at ') : (g.home ? ' to ' : ' at ')) + opp : (g.home ? '' : ' away from home');
    return N[t] + ' come in off ' + aScore(scoreOf(g)) + ' ' + what + vs + (c ? ',' + c : '') + '.';
  };
  /* the two met last time out (a series, a pair of fixtures back to back): that game once, from the winner's end */
  const g0 = lastG(0), g1 = lastG(1);
  const same = !!(g0 && g1 && g0.id === g1.id);
  const runs = [run(0), run(1)];
  if (runs[0] && runs[1] && whole(0) && whole(1) && S[0].streak.won && S[1].streak.won) st.push('Neither has lost yet.');
  else {
    /* the home side first, then the visitors: a run with its latest game, else how it comes in */
    const came = [null, null];
    [0, 1].forEach(t => {
      if (runs[t]) { st.push(runs[t] + (same ? '' : latest(t)) + '.'); return; }
      if (same) return;
      came[t] = cameIn(t, t === 1 && !!came[0]);
      if (came[t]) st.push(came[t]);
    });
    if (same) {
      const w = g0.won ? 0 : 1, gw = w === 0 ? g0 : g1;
      st.push('They met last time out, ' + N[w] + ' winning ' + scoreOf(gw) + (gw.home ? ' at home' : ' away') + carried(gw.top, true) + '.');
    }
    if (!runs[0] && !runs[1] && !came[0] && !came[1]) {
      const f = t => (S[t].last5 || '').length === 5 ? (S[t].last5.match(/W/g) || []).length : null;
      const fa = f(0), fb = f(1);
      if (fa != null && fb != null && Math.abs(fa - fb) >= 3) {
        const hi = fa > fb ? 0 : 1;
        st.push(N[hi] + ' have won ' + pspell(Math.max(fa, fb)) + ' of their last five; ' + N[1 - hi] + ' ' + pspell(Math.min(fa, fb)) + '.');
      }
    }
  }
  if (st.length) out.push(st.join(' '));
  st.length = 0;

  /* HOME AND AWAY: the home side at home and the visitors on the road, said only when it is all one way (three games
     or more) or the two halves of a season are far apart (four of each, half the games apart). A club whose whole
     season is one run has said it already. */
  const hr = (t, here, there, hereW, thereW) => {
    const n = here.w + here.l, m = there ? there.w + there.l : 0;
    if (whole(t)) return null;
    if (n >= 3 && here.l === 0) return N[t] + ' have won all ' + pspell(n) + ' ' + hereW + '.';
    if (n >= 3 && here.w === 0) return N[t] + ' have lost all ' + pspell(n) + ' ' + hereW + '.';
    if (n >= 4 && m >= 4 && Math.abs(here.w / n - there.w / m) >= 0.5) return N[t] + ' are ' + recW(here) + ' ' + hereW + ' and ' + recW(there) + ' ' + thereW + '.';
    return null;
  };
  const roadOf = t => S[t].road || null, homeOf = t => S[t].home || null;
  if (homeOf(0)) { const s = hr(0, homeOf(0), roadOf(0), 'at home', 'away'); if (s) st.push(s); }
  if (roadOf(1)) { const s = hr(1, roadOf(1), homeOf(1), 'on the road', 'at home'); if (s) st.push(s); }
  const M = pre.meetings || [];
  if (M.length === 1) {
    const m = M[0], w = m.won, sc = [Math.max(m.score[0], m.score[1]), Math.min(m.score[0], m.score[1])];
    const top = w != null && m.tops ? m.tops[w] : null;
    const by = top && names[top.id] && top.pts >= 18 ? ', with ' + top.pts + ' from ' + esc(names[top.id]) : '';
    if (w != null && !(same && g0.id === m.id)) st.push(N[w] + ' won the only meeting so far, ' + sc[0] + '–' + sc[1] + by + '.');
  } else if (M.length > 1) {
    const wA = M.filter(m => m.won === 0).length, wB = M.filter(m => m.won === 1).length;
    st.push(wA === wB ? 'The season series is level at ' + wA + '–' + wB + '.' : 'The season series is ' + Math.max(wA, wB) + '–' + Math.min(wA, wB) + ' to ' + N[wA > wB ? 0 : 1] + '.');
  }
  const r0 = S[0].rest, r1 = S[1].rest;
  if (r0 != null && r1 != null) {
    if (r0 < 1.5 && r1 >= 2.5) st.push(N[0] + ' play for the second time in two days; ' + N[1] + ' have had ' + pspell(Math.floor(r1)) + ' days off.');
    else if (r1 < 1.5 && r0 >= 2.5) st.push(N[1] + ' play for the second time in two days; ' + N[0] + ' have had ' + pspell(Math.floor(r0)) + ' days off.');
  }
  if (st.length) out.push(st.join(' '));

  /* 2. THE MATCHUP, VALUED */
  const X = pre.expect;
  if (X && isFinite(X.margin)) {
    const fav = X.margin >= 0 ? 0 : 1, m = Math.abs(X.margin);
    const by = X.model ? 'Weighed by what wins in this league, the season’s numbers make ' : 'On the season’s four factors, ';
    const lead = X.model ? by + N[fav] + ' about ' + ptsW(m) + ' better here.' : by + N[fav] + ' are about ' + ptsW(m) + ' better here.';
    const parts = Object.keys(X.parts).map(k => ({ k, pts: X.parts[k].pts, a: X.parts[k].home, b: X.parts[k].away }))
      .sort((p, q) => Math.abs(q.pts) - Math.abs(p.pts));
    const forFav = parts.filter(p => (fav === 0 ? p.pts : -p.pts) >= 1);
    const against = parts.filter(p => (fav === 0 ? p.pts : -p.pts) <= -1);
    const bits = [lead];
    if (forFav.length && m >= 1) {
      const p = forFav[0], mine = fav === 0 ? p.a : p.b, theirs = fav === 0 ? p.b : p.a;
      const what = p.k === 'efg' ? 'expect ' + N[fav] + ' to shoot about ' + Math.round(mine) + '% eFG to ' + Math.round(theirs) + '%'
        : p.k === 'tovp' ? N[fav] + ' should turn it over on about ' + Math.round(mine) + '% of possessions to ' + Math.round(theirs) + '%'
        : p.k === 'orebp' ? N[fav] + ' should get about ' + Math.round(mine) + '% of their misses back to ' + Math.round(theirs) + '%'
        : N[fav] + ' should get to the line more, about ' + Math.round(mine) + ' free throws per hundred shots to ' + Math.round(theirs);
      /* judged on the figures the reader sees (each said to the half point): "six" and "seven" is more than that */
      const half = v => Math.max(1, Math.round(Math.abs(v) * 2) / 2);
      const share = half(p.pts) / half(m);
      const opener = share > 1 ? cap(FACET_W[p.k]) + ' alone is worth more than that' : share >= 0.5 ? 'Most of that is ' + FACET_W[p.k] : 'The biggest part is ' + FACET_W[p.k];
      bits.push(opener + ': ' + what + ', worth about ' + ptsW(Math.abs(p.pts)) + '.');
    }
    const possN = n => n + (/s$/i.test(String(n).replace(/<[^>]*>/g, '')) ? '’' : '’s');
    if (against.length) bits.push(possN(N[1 - fav]) + ' edge is ' + FACET_W[against[0].k] + ', about ' + ptsW(Math.abs(against[0].pts)) + ' back.');
    if (X.alpha != null && Math.abs(X.alpha) >= 0.5) bits.push('Home court is worth about ' + (Math.round(X.alpha * 10) / 10).toFixed(1) + ' in this league.');
    /* the lean, said honestly, and what argues against it */
    const lean = m < 2 ? 'On these numbers it is close to a toss-up.'
      : m < 5 ? 'The numbers lean ' + N[fav] + ', but not by much: a single run settles games closer than that.'
      : m < 9 ? 'The numbers make ' + N[fav] + ' clear favourites.'
      : 'On these numbers ' + N[fav] + ' should win comfortably.';
    bits.push(lean);
    /* if it is close: how each has done in games decided by five points or fewer (three of them or more), when one has
       won or lost them all, or the two are half their games apart */
    if (m < 5) {
      const cl = t => S[t].close || { w: 0, l: 0 }, cn = t => cl(t).w + cl(t).l;
      if (cn(0) >= 3 && cn(1) >= 3 && Math.abs(cl(0).w / cn(0) - cl(1).w / cn(1)) >= 0.5) {
        bits.push('In games decided by five points or fewer, ' + N[0] + ' are ' + recW(cl(0)) + ' and ' + N[1] + ' ' + recW(cl(1)) + '.');
      } else {
        const t = [0, 1].find(t => cn(t) >= 3 && (cl(t).w === cn(t) || cl(t).l === cn(t)));
        if (t != null) bits.push(N[t] + ' are ' + recW(cl(t)) + ' in games decided by five points or fewer.');
      }
    }
    const dog = 1 - fav, ds = S[dog].streak;
    if (m >= 2 && ds && ds.won && ds.n >= 3) bits.push('Yes, but ' + N[dog] + ' come in on ' + pspell(ds.n) + ' straight wins.');
    else if (m >= 2 && T[dog] && T[fav] && T[dog].rank < T[fav].rank && T[dog].gp >= 3) bits.push('Yes, but the table has ' + N[dog] + ' above them.');
    out.push(bits.join(' '));
  }

  /* 3. WHO CARRIES THE FORM */
  const who = (t) => {
    const list = (pre.players && pre.players[t]) || [];
    for (const p of list.slice(0, 6)) {
      const nm = names[p.id];
      if (!nm || p.gp < 3) continue;
      const last3 = (p.last3 || []).length === 3 ? p.last3.reduce((a, b) => a + b, 0) / 3 : null;
      if (p.run20 >= 2) return esc(nm) + ' has scored 20 or more in ' + (p.run20 === p.gp ? 'every game this season' : 'each of the last ' + pspell(p.run20)) + ' for ' + N[t];
      if (last3 != null && last3 - p.ppg >= 5 && last3 >= 12) return esc(nm) + ' is averaging ' + (Math.round(last3 * 10) / 10).toFixed(1) + ' over the last three for ' + N[t] + ', up from ' + (Math.round(p.ppg * 10) / 10).toFixed(1) + ' for the season';
    }
    const top = list.find(p => names[p.id] && p.gp >= 3);
    return top ? esc(names[top.id]) + ' leads ' + N[t] + ' with ' + (Math.round(top.ppg * 10) / 10).toFixed(1) + ' points a game' : null;
  };
  const ps = [who(0), who(1)].filter(Boolean);
  if (ps.length) out.push(ps.join('; ') + '.');
  /* a milestone in reach on either side */
  const ms = [];
  [0, 1].forEach(t => ((pre.players && pre.players[t]) || []).forEach(p => {
    const nm = names[p.id];
    if (!nm || p.total == null || p.total < 180 || !p.ppg) return;
    const next = Math.floor(p.total / 100) * 100 + 100, need = next - p.total;
    if (need <= Math.max(6, Math.round(p.ppg))) ms.push(esc(nm) + ' of ' + N[t] + ' needs ' + pspell(need) + ' for ' + next + ' points this season');
  }));
  if (ms.length) out.push(ms.slice(0, 2).join('; ') + '.');
  return out;
}
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);

function narrative(ctx) {
  const nameA = ctx.nameA, nameB = ctx.nameB;
  const A = teamShape(ctx.teamA), B = teamShape(ctx.teamB);
  /* THE SEASON, READ FOR THIS GAME (ctx.pre): the valued matchup first, then the tempo and shot-diet observations the
     season's averages still say best */
  if (ctx.pre && A && B && A.gp >= MIN_GP && B.gp >= MIN_GP) {
    const v = valuedParas(ctx);
    if (v.length) {
      const extra = observations(A, B, nameA, nameB).filter(o => o.strength <= 7).slice(0, 2).map(o => o.text);
      return v.concat(extra);
    }
  }

  /* Nothing to say yet, and saying so beats inventing a storyline from one
     result. */
  if (!A || !B) {
    return ['Neither club has a finished game in this season’s records ' +
      'yet, so there is nothing to read into. This preview fills itself in as ' +
      'results come through.'];
  }
  if (A.gp < MIN_GP || B.gp < MIN_GP) {
    return ['Early days — ' + esc(nameA) + ' have ' + A.gp + ' game' +
      (A.gp === 1 ? '' : 's') + ' on the board and ' + esc(nameB) + ' ' + B.gp +
      '. Rate statistics this early describe the schedule more than the teams, ' +
      'so take the shape below lightly.'];
  }

  const paras = observations(A, B, nameA, nameB).slice(0, 4).map(o => o.text);
  const notes = [playerNote((ctx.starsA || [])[0], nameA),
                 playerNote((ctx.starsB || [])[0], nameB)].filter(Boolean);
  if (notes.length) paras.push(notes.join(' '));
  return paras;
}

/* ==================================================================== view ===
   Markup is built as strings and escaped at every interpolation. Club and
   player names come from the database and are treated as hostile, exactly as
   the box score treats them. */

function factorRow(f, a, b, def) {
  const av = num(a), bv = num(b);
  /* the defence's factors are what it allowed (forced, for turnovers): every direction turned round */
  const e0 = edge(f, av, bv), e = e0 == null ? null : def ? -e0 : e0;
  const aWins = e != null && e > 0, bWins = e != null && e < 0;
  /* The bar is each side's share of the pair, so two similar numbers give two
     similar bars instead of an exaggerated gap off a zero baseline. */
  const tot = (av || 0) + (bv || 0);
  const aPct = tot ? Math.round((av || 0) / tot * 100) : 50;
  return '<div class="pv-factor">' +
      '<div class="pv-fhead"><span class="pv-flabel">' + esc(f.label) + '</span>' +
      '<span class="pv-ffull">' + esc(f.full) + '</span></div>' +
      '<div class="pv-fbar">' +
        '<span class="pv-fa' + (aWins ? ' win' : '') + '" style="width:' + aPct + '%"></span>' +
        '<span class="pv-fb' + (bWins ? ' win' : '') + '" style="width:' + (100 - aPct) + '%"></span>' +
      '</div>' +
      '<div class="pv-fvals"><b class="' + (aWins ? 'win' : '') + '">' + pct1(av) + '</b>' +
      '<b class="' + (bWins ? 'win' : '') + '">' + pct1(bv) + '</b></div>' +
    '</div>';
}

function tile(label, value, sub) {
  return '<div class="pv-tile"><div class="pv-tval">' + esc(value) + '</div>' +
    '<div class="pv-tlabel">' + esc(label) + '</div>' +
    (sub ? '<div class="pv-tsub">' + esc(sub) + '</div>' : '') + '</div>';
}

function playerCard(p, colour, teamName) {
  if (!p) return '';
  const nm = esc(p.name || 'Player');
  const href = p.id ? '../p/?p=' + encodeURIComponent(p.id) : null;
  const adv = [];
  if (num(p.ts) != null)     adv.push(['TS%', pct1(p.ts)]);
  if (num(p.efg) != null)    adv.push(['eFG%', pct1(p.efg)]);
  if (num(p.p3_pct) != null) adv.push(['3P%', pct1(p.p3_pct)]);
  if (num(p.ast_to) != null) adv.push(['A/TO', one(p.ast_to)]);
  return '<div class="pv-player" style="--pc:' + esc(colour) + '">' +
      '<div class="pv-pname">' + (href ? '<a href="' + esc(href) + '">' + nm + '</a>' : nm) + '</div>' +
      '<div class="pv-pteam">' + esc(teamName) + ' · ' + (p.gp || 0) + ' games</div>' +
      '<div class="pv-pline">' + esc(one(p.ppg) + ' pts · ' + one(p.rpg) +
        ' reb · ' + one(p.apg) + ' ast') + '</div>' +
      '<div class="pv-padv">' + adv.slice(0, 4).map(function (kv) {
        return '<span><i>' + esc(kv[0]) + '</i>' + esc(kv[1]) + '</span>';
      }).join('') + '</div>' +
    '</div>';
}

/* THE MAP. Google's embed endpoint takes a plain query and needs no API key,
   which matters because a key in a public page is a key given away. Drawn only
   when the fixture actually carries somewhere to point at — an iframe with an
   empty query renders a map of nowhere, which reads as a fault rather than as
   an absence. The page's CSP names this origin explicitly and nothing else may
   be framed. */
/* THE ARENA'S PIN, NOT A SEARCH FOR ITS NAME. A venue written as a name ("Sアリ", "Archers Arena") finds whichever
   place Google likes best under it - a pinned arena in Japan opened a map of London. The arena's own pin is
   what a person confirmed in the platform console, so the map and the route are asked for it; the address, then
   the name, are only for a game whose arena has none (game.js reads the pin off the arena's row). */
function mapQuery(venue, address, pin) {
  if (pin && pin.lat != null && pin.lng != null && isFinite(+pin.lat) && isFinite(+pin.lng)) return (+pin.lat) + ',' + (+pin.lng);
  return String(address || venue || '').trim();
}

/* the route to it: from wherever the reader is, to the pin (and its Google place when there is one) */
function directionsHref(venue, address, pin) {
  const q = mapQuery(venue, address, pin);
  if (!q) return '';
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(q) +
    (pin && pin.place_id ? '&destination_place_id=' + encodeURIComponent(pin.place_id) : '');
}

function mapEmbed(venue, address, pin) {
  const q = mapQuery(venue, address, pin);
  if (!q) return '';
  const src = 'https://www.google.com/maps?q=' + encodeURIComponent(q) + (pin && pin.lat != null ? '&z=16' : '') + '&output=embed';
  return '<div class="pv-map"><iframe src="' + esc(src) + '" loading="lazy" ' +
    'referrerpolicy="no-referrer-when-downgrade" title="Venue map"></iframe></div>';
}

function whenText(iso) {
  if (!iso) return { day: 'Date to be confirmed', time: 'TBC' };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { day: 'Date to be confirmed', time: 'TBC' };
  return {
    day: d.toLocaleDateString('en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    time: d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
  };
}

/* ONE STAT, BOTH CLUBS: the value each side has, in its own colour, either side of what it is, and the
   better one marked. `low` is a stat where less is better (points allowed). */
function vsRow(label, sub, a, b, low) {
  const av = num(a), bv = num(b);
  const better = av == null || bv == null || av === bv ? 0 : ((low ? av < bv : av > bv) ? 1 : -1);
  return '<div class="pv-vs">' +
    '<b class="a' + (better > 0 ? ' win' : '') + '">' + one(av) + '</b>' +
    '<span class="k">' + esc(label) + (sub ? '<i>' + esc(sub) + '</i>' : '') + '</span>' +
    '<b class="b' + (better < 0 ? ' win' : '') + '">' + one(bv) + '</b></div>';
}

/* "B.LEAGUE One · B.LEAGUE One" is a competition named after its league: said once */
function compLine(c) {
  const parts = String(c || '').split(' · ').map(x => x.trim()).filter(Boolean);
  return parts.filter((x, i) => parts.findIndex(y => y.toLowerCase() === x.toLowerCase()) === i).join(' · ');
}

function render(ctx) {
  const nameA = ctx.nameA, nameB = ctx.nameB;
  const A = ctx.teamA, B = ctx.teamB;
  const w = whenText(ctx.tipoff);
  const scope = ctx.leagueSlug ? '?l=' + encodeURIComponent(ctx.leagueSlug) : '';
  const d = ctx.tipoff ? new Date(ctx.tipoff) : null;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayShort = d && !isNaN(d) ? DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] : 'Date TBC';

  const record = t => (t && t.gp)
    ? t.gp + (t.gp === 1 ? ' game' : ' games') + ' · ' + one(t.ppg) + ' for, ' + one(t.papg) + ' against'
    : 'no games yet this season';

  const teamLink = (slug, name) => slug
    ? '<a href="../t/?t=' + esc(encodeURIComponent(slug)) + '">' + esc(name) + '</a>'
    : esc(name);
  const crest = url => url
    ? '<span class="pv-crest"><img src="' + esc(url) + '" alt="" onerror="this.parentNode.remove()"></span>' : '';
  /* the club: crest, name, where it stands in the table, and its season so far */
  const side = (k, slug, name, colour, url, place, t) =>
    '<div class="pv-side ' + k + '" style="--pc:' + esc(colour) + '">' +
      crest(url) +
      '<div class="pv-tname">' + teamLink(slug, name) + '</div>' +
      (place ? '<div class="pv-pos">' + esc(place) + '</div>' : '') +
      '<div class="pv-trec">' + esc(record(t)) + '</div>' +
    '</div>';

  const paras = narrative(ctx).map(p => '<p>' + p + '</p>').join('');
  const ffOff = FACTORS.map(f => factorRow(f, A && A[f.off], B && B[f.off])).join('');
  const ffDef = FACTORS.map(f => factorRow(f, A && A[f.def], B && B[f.def], true)).join('');

  const stars = (ctx.starsA || []).slice(0, 2).map(p => playerCard(p, ctx.colourA, nameA))
    .concat((ctx.starsB || []).slice(0, 2).map(p => playerCard(p, ctx.colourB, nameB)))
    .join('');
  const comp = compLine(ctx.competition);
  const head = (t, note) => '<div class="pv-h"><h2>' + t + '</h2>' + (note ? '<span class="pv-note">' + esc(note) + '</span>' : '') + '</div>';

  return '<div class="pv" style="--pa:' + esc(ctx.colourA) + ';--pb:' + esc(ctx.colourB) + '">' +

    '<div class="pv-hero">' +
      '<div class="pv-badge"><span>PREVIEW</span>' + (comp ? '<span>' + esc(comp) + '</span>' : '') + '</div>' +
      '<div class="pv-teams">' +
        side('left', ctx.slugA, nameA, ctx.colourA, ctx.crestA, ctx.placeA, A) +
        '<div class="pv-when">' +
          '<span class="pv-day">' + esc(dayShort.toUpperCase()) + '</span>' +
          '<span class="pv-time">' + esc(w.time) + '</span>' +
          '<span class="pv-v">vs</span>' +
          (ctx.venue ? '<span class="pv-venue">' + esc(ctx.venue) + '</span>' : '') +
          /* where to watch, filled by the page (watch.js) */
          '<span class="pv-watch-slot"></span>' +
        '</div>' +
        side('right', ctx.slugB, nameB, ctx.colourB, ctx.crestB, ctx.placeB, B) +
      '</div>' +
      /* who wins? filled by the page (predict.js) */
      '<div class="pv-pred-slot"></div>' +
    '</div>' +

    startersHTML(ctx) +
    injuriesHTML(ctx) +

    (paras
      ? '<section class="pv-sec">' + head('The story so far') +
        '<div class="pv-prose" data-i18n-ctx="report">' + paras + '</div></section>'
      : '') +

    /* ON THE NEWSDESK: the league's running storylines this game touches (narrative.js threadsOf, from the league's hourly
       newsdesk file), each said as what the game means for it; and the way to all of them */
    (ctx.threads && ctx.threads.length
      ? '<section class="pv-sec">' + head('On the newsdesk', 'the storylines this game touches') +
        '<ul class="pv-threads" data-i18n-ctx="newsdesk">' + ctx.threads.slice(0, 4).map(t =>
          '<li' + (t.side === 1 ? ' class="b"' : '') + '><span class="pv-thk">' + esc(t.kicker) + '</span><span class="pv-thl">' + esc(t.line) + '</span></li>').join('') + '</ul>' +
        (ctx.leagueSlug ? '<a class="pv-more" href="../' + scope + '#storySec">every storyline in the league ↗</a>' : '') + '</section>'
      : '') +

    /* THE TABLE, with both clubs lit (epinoia/tablepos.js); only once somebody in it has played */
    (ctx.tableHTML
      ? '<section class="pv-sec pv-table">' + head('The table', ctx.tableName || '') + ctx.tableHTML +
        (ctx.leagueSlug ? '<a class="pv-more" href="../l/' + scope + '">the full table ↗</a>' : '') + '</section>'
      : '') +

    '<section class="pv-sec">' + head('Key team stats') +
      '<div class="pv-key">' +
        '<span class="a">' + esc(nameA) + '</span>' +
        '<span class="b">' + esc(nameB) + '</span>' +
      '</div>' +
      '<div class="pv-vss">' +
        vsRow('Offensive rating', 'points per 100', A && A.ortg, B && B.ortg) +
        vsRow('Defensive rating', 'allowed per 100', A && A.drtg, B && B.drtg, true) +
        vsRow('Net rating', 'per 100', A && A.net, B && B.net) +
        vsRow('Pace', 'possessions per 40', A && A.pace, B && B.pace) +
      '</div>' +
      '<h3 class="pv-sub">Four factors — with the ball</h3>' +
      '<div class="pv-factors">' + ffOff + '</div>' +
      '<h3 class="pv-sub">Four factors — without it</h3>' +
      '<div class="pv-factors">' + ffDef + '</div>' +
      '<a class="pv-more" href="../stats/' + scope + '">every team stat ↗</a>' +
    '</section>' +

    (stars
      ? '<section class="pv-sec">' + head('Key players') +
        '<div class="pv-players">' + stars + '</div>' +
        '<a class="pv-more" href="../stats/' + scope + '">every player ↗</a>' +
        '</section>'
      : '') +

    /* EPINOIΛ'S WIN PROBABILITY (winprob.js, filled by the page): hidden until it has something to say */
    '<section class="pv-sec pv-wp" hidden>' + head('Win probability', 'EPINOIΛ’s model: What wins, Elo, form and the home court') +
      '<div class="pv-wp-slot"></div></section>' +

    '<section class="pv-sec">' + head('How to get there') +
      '<div class="pv-tiles two">' +
        tile('tip-off', w.time, w.day) +
        tile('venue', ctx.venue || 'To be confirmed', ctx.address || '') +
      '</div>' +
      mapEmbed(ctx.venue, ctx.address, ctx.pin) +
      (directionsHref(ctx.venue, ctx.address, ctx.pin) && (ctx.address || ctx.pin)
        ? '<a class="pv-more" target="_blank" rel="noopener" href="' +
          esc(directionsHref(ctx.venue, ctx.address, ctx.pin)) + '">directions ↗</a>'
        : '') +
      /* EPINOIA GO's STAMP THIS GAME (game.js mounts go/venuestamp.js here, when the arena is known) */
      '<div class="pv-go" id="pvGo"></div>' +
    '</section>' +

  '</div>';
}

return { render: render, narrative: narrative, startersHTML: startersHTML, mapQuery: mapQuery, directionsHref: directionsHref,
         injuriesHTML: injuriesHTML, FACTORS: FACTORS, MIN_GP: MIN_GP,
         __test: { observations: observations, teamShape: teamShape, valuedParas: valuedParas,
                   playerNote: playerNote, edge: edge, whenText: whenText, compLine: compLine, vsRow: vsRow } };
}));
