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

/* ------------------------------------------------------------ four factors ---
   The four things that decide a basketball game, in the order Dean Oliver
   weighted them. `low` marks the ones where a smaller number is better, so a
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
    push(9, 'The matchup to watch is ' + esc(best.att) + '’s ' + best.f.label +
      ' against ' + esc(best.def) + '’s: on ' + best.f.full + ' ' +
      esc(best.att) + ' post ' + pct1(best.off) + ' where ' + esc(best.def) +
      ' concede ' + pct1(best.def_) + '.');
  }

  /* --- tempo, when the two want different games --- */
  if (A.pace != null && B.pace != null && Math.abs(A.pace - B.pace) >= 4) {
    const fast = A.pace > B.pace ? nameA : nameB;
    const slow = A.pace > B.pace ? nameB : nameA;
    push(7, 'They want different games: ' + esc(fast) + ' have played at ' +
      one(Math.max(A.pace, B.pace)) + ' possessions per 40 to ' + esc(slow) +
      '’s ' + one(Math.min(A.pace, B.pace)) + ', so whoever sets the ' +
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

function narrative(ctx) {
  const nameA = ctx.nameA, nameB = ctx.nameB;
  const A = teamShape(ctx.teamA), B = teamShape(ctx.teamB);

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

function factorRow(f, a, b) {
  const av = num(a), bv = num(b);
  const e = edge(f, av, bv);
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
function mapEmbed(venue, address) {
  const q = String(address || venue || '').trim();
  if (!q) return '';
  const src = 'https://www.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed';
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

function render(ctx) {
  const nameA = ctx.nameA, nameB = ctx.nameB;
  const A = ctx.teamA, B = ctx.teamB;
  const w = whenText(ctx.tipoff);
  const scope = ctx.leagueSlug ? '?l=' + encodeURIComponent(ctx.leagueSlug) : '';

  const record = t => (t && t.gp)
    ? t.gp + ' games · ' + one(t.ppg) + ' for, ' + one(t.papg) + ' against'
    : 'no games yet this season';

  const teamLink = (slug, name) => slug
    ? '<a href="../t/?t=' + esc(encodeURIComponent(slug)) + '">' + esc(name) + '</a>'
    : esc(name);

  const paras = narrative(ctx).map(p => '<p>' + p + '</p>').join('');
  const ffOff = FACTORS.map(f => factorRow(f, A && A[f.off], B && B[f.off])).join('');
  const ffDef = FACTORS.map(f => factorRow(f, A && A[f.def], B && B[f.def])).join('');

  const stars = (ctx.starsA || []).slice(0, 2).map(p => playerCard(p, ctx.colourA, nameA))
    .concat((ctx.starsB || []).slice(0, 2).map(p => playerCard(p, ctx.colourB, nameB)))
    .join('');

  return '<div class="pv">' +

    '<div class="pv-hero">' +
      '<div class="pv-badge">preview &amp; info</div>' +
      '<div class="pv-teams">' +
        '<div class="pv-side" style="--pc:' + esc(ctx.colourA) + '">' +
          '<div class="pv-tname">' + teamLink(ctx.slugA, nameA) + '</div>' +
          '<div class="pv-trec">' + esc(record(A)) + '</div></div>' +
        '<div class="pv-v">v</div>' +
        '<div class="pv-side right" style="--pc:' + esc(ctx.colourB) + '">' +
          '<div class="pv-tname">' + teamLink(ctx.slugB, nameB) + '</div>' +
          '<div class="pv-trec">' + esc(record(B)) + '</div></div>' +
      '</div>' +
      (ctx.competition ? '<div class="pv-comp">' + esc(ctx.competition) + '</div>' : '') +
    '</div>' +

    '<section class="pv-sec">' +
      '<h2>How to get there</h2>' +
      '<div class="pv-tiles two">' +
        tile('tip-off', w.time, w.day) +
        tile('venue', ctx.venue || 'To be confirmed', ctx.address || '') +
      '</div>' +
      mapEmbed(ctx.venue, ctx.address) +
      (ctx.address
        ? '<a class="pv-more" target="_blank" rel="noopener" href="' +
          esc('https://www.google.com/maps/dir/?api=1&destination=' +
              encodeURIComponent(ctx.address)) + '">directions ↗</a>'
        : '') +
    '</section>' +

    (paras
      ? '<section class="pv-sec"><h2>The story so far</h2>' +
        '<div class="pv-prose">' + paras + '</div></section>'
      : '') +

    '<section class="pv-sec">' +
      '<h2>Key team stats</h2>' +
      '<div class="pv-key">' +
        '<span style="--pc:' + esc(ctx.colourA) + '">' + esc(nameA) + '</span>' +
        '<span style="--pc:' + esc(ctx.colourB) + '">' + esc(nameB) + '</span>' +
      '</div>' +
      '<div class="pv-tiles">' +
        tile('offensive rating', one(A && A.ortg) + ' / ' + one(B && B.ortg), 'points per 100') +
        tile('defensive rating', one(A && A.drtg) + ' / ' + one(B && B.drtg), 'allowed per 100') +
        tile('pace', one(A && A.pace) + ' / ' + one(B && B.pace), 'possessions per 40') +
        tile('net', one(A && A.net) + ' / ' + one(B && B.net), 'per 100') +
      '</div>' +
      '<h3 class="pv-sub">Four factors — with the ball</h3>' +
      '<div class="pv-factors">' + ffOff + '</div>' +
      '<h3 class="pv-sub">Four factors — without it</h3>' +
      '<div class="pv-factors">' + ffDef + '</div>' +
      '<a class="pv-more" href="../stats/' + scope + '">every team stat ↗</a>' +
    '</section>' +

    (stars
      ? '<section class="pv-sec"><h2>Key players</h2>' +
        '<div class="pv-players">' + stars + '</div>' +
        '<a class="pv-more" href="../stats/' + scope + '">every player ↗</a>' +
        '</section>'
      : '') +

  '</div>';
}

return { render: render, narrative: narrative, FACTORS: FACTORS, MIN_GP: MIN_GP,
         __test: { observations: observations, teamShape: teamShape,
                   playerNote: playerNote, edge: edge, whenText: whenText } };
}));
