'use strict';
/* ============================================================================
   THE REPORT, ON THE PAGE.

   report.js produced a headline, a standfirst and a run of sections. This
   turns that into markup, and its one real job is the INTERLEAVING: each
   section is followed by the graphic that belongs to what it just claimed.

   That pairing is the whole design. A section that says "they won the third
   18–6" sits above the quarter bars, so the claim and its evidence are in the
   same glance; the four-factor paragraph sits above the four-factor bars; the
   lineup paragraph sits above the actual five with its plus-minus. A report
   that is only prose asks the reader to trust it, and one that is only tables
   asks them to do the work. This does neither.

   Nothing here computes anything. Every number it prints comes off a fact that
   was already scored upstream, so a card cannot show one figure while the
   sentence above it says another.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaReportView = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const num  = v => (v == null || v === '' || isNaN(v) ? null : +v);
const one  = v => (num(v) == null ? '—' : (+v).toFixed(1));
const pct1 = v => (num(v) == null ? '—' : (+v).toFixed(1) + '%');
const mins = ms => Math.floor((ms || 0) / 60000) + ':' +
  String(Math.floor(((ms || 0) % 60000) / 1000)).padStart(2, '0');

/* ---- the quarter bars ---------------------------------------------------- */
/* Both sides' scoring, period by period, on a shared scale so the period that
   decided it is visible as a shape rather than as a number to compare. */
function cardQuarters(g) {
  let max = 1;
  for (let p = 1; p <= g.periods; p++) {
    max = Math.max(max, g.perQ[0][p] || 0, g.perQ[1][p] || 0);
  }
  let cols = '';
  for (let p = 1; p <= g.periods; p++) {
    const a = g.perQ[0][p] || 0, b = g.perQ[1][p] || 0;
    cols += '<div class="rq-col">' +
      '<div class="rq-pair">' +
        '<span class="rq-a" style="height:' + Math.round(a / max * 100) + '%"></span>' +
        '<span class="rq-b" style="height:' + Math.round(b / max * 100) + '%"></span>' +
      '</div>' +
      '<div class="rq-n"><b>' + a + '</b><b>' + b + '</b></div>' +
      '<div class="rq-p">' + (p > 4 ? 'OT' + (p - 4) : 'Q' + p) + '</div>' +
    '</div>';
  }
  return '<div class="rcard"><div class="rcard-h">Scoring by period</div>' +
    '<div class="rq">' + cols + '</div>' + legend(g) + '</div>';
}

function legend(g) {
  return '<div class="rlegend">' +
    '<span><i class="sw-a"></i>' + esc(g.names[0]) + '</span>' +
    '<span><i class="sw-b"></i>' + esc(g.names[1]) + '</span></div>';
}

/* ---- the four factors ---------------------------------------------------- */
function cardFactors(g, facts) {
  const rows = [
    ['shooting', 'eFG%', g.adv[0].efg, g.adv[1].efg, false],
    ['turnovers', 'TOV%', g.adv[0].tovp, g.adv[1].tovp, true],
    ['off. glass', 'ORB%', g.adv[0].orebp, g.adv[1].orebp, false],
    ['free throws', 'FTr', g.adv[0].ftr, g.adv[1].ftr, false]
  ].map(r => {
    const [label, short, a, b, low] = r;
    const av = num(a), bv = num(b);
    const win = (av == null || bv == null) ? null
      : (low ? (av < bv ? 0 : av > bv ? 1 : null)
             : (av > bv ? 0 : av < bv ? 1 : null));
    const tot = (av || 0) + (bv || 0);
    const aPct = tot ? Math.round((av || 0) / tot * 100) : 50;
    return '<div class="rf-row">' +
      '<div class="rf-lab">' + esc(label) + '<i>' + esc(short) + '</i></div>' +
      '<div class="rf-bar">' +
        '<span class="rf-a' + (win === 0 ? ' win' : '') + '" style="width:' + aPct + '%"></span>' +
        '<span class="rf-b' + (win === 1 ? ' win' : '') + '" style="width:' + (100 - aPct) + '%"></span>' +
      '</div>' +
      '<div class="rf-v"><b class="' + (win === 0 ? 'win' : '') + '">' + pct1(av) + '</b>' +
      '<b class="' + (win === 1 ? 'win' : '') + '">' + pct1(bv) + '</b></div>' +
    '</div>';
  }).join('');
  return '<div class="rcard"><div class="rcard-h">The four factors</div>' +
    '<div class="rf">' + rows + '</div>' + legend(g) + '</div>';
}

/* ---- the lineups that mattered ------------------------------------------- */
/* The groups the prose just named, with the minutes and the swing that earned
   them the sentence. */
function cardLineups(g, facts) {
  const picks = facts.filter(f =>
    f.kind === 'stretch' || f.kind === 'lineupBest' || f.kind === 'lineupWorst').slice(0, 3);
  if (!picks.length) return '';
  const rows = picks.map(f => {
    const side = f.kind === 'stretch' ? f.data.owner : f.side;
    const pm = f.kind === 'stretch'
      ? (f.data.owner === f.side ? f.data.swing : -f.data.swing)
      : f.data.pm;
    const names = (f.data.ids || []).map(id => {
      const p = g.byId[id];
      return p ? '<span class="rl-p"><i>' + esc(p.num || '') + '</i>' +
        esc(String(p.name || '').split(/\s+/).slice(-1)[0]) + '</span>' : '';
    }).join('');
    const what = f.kind === 'stretch' ? 'deciding stretch'
               : f.kind === 'lineupBest' ? 'best group' : 'toughest minutes';
    return '<div class="rl-row' + (side === 1 ? ' t1' : '') + '">' +
      '<div class="rl-what">' + esc(what) + ' · ' + esc(g.names[side]) + '</div>' +
      '<div class="rl-five">' + names + '</div>' +
      '<div class="rl-nums">' +
        '<span class="rl-pm ' + (pm >= 0 ? 'pos' : 'neg') + '">' +
          (pm > 0 ? '+' : '') + pm + '</span>' +
        '<span class="rl-dur">' + mins(f.data.dur) + '</span>' +
        (num(f.data.net) != null
          ? '<span class="rl-net">' + one(f.data.net) + ' net</span>' : '') +
      '</div></div>';
  }).join('');
  return '<div class="rcard"><div class="rcard-h">Who was on the floor</div>' +
    '<div class="rl">' + rows + '</div></div>';
}

/* ---- the players the prose named ----------------------------------------- */
function cardPlayers(g, facts) {
  const kinds = ['tripleDouble', 'doubleDouble', 'bigScore', 'shooter', 'efficient'];
  const seen = new Set(), picks = [];
  facts.filter(f => kinds.indexOf(f.kind) >= 0).forEach(f => {
    const id = f.data.p && f.data.p.id;
    if (!id || seen.has(id)) return;
    seen.add(id); picks.push(f);
  });
  if (!picks.length) return '';
  const cards = picks.slice(0, 4).map(f => {
    const p = f.data.p;
    const reb = (p.or || 0) + (p.dr || 0);
    const href = p.id && /^[0-9a-f-]{36}$/i.test(p.id)
      ? '../p/?p=' + encodeURIComponent(p.id) : null;
    const nm = esc(p.name || 'Player');
    return '<div class="rp' + (p.team === 1 ? ' t1' : '') + '">' +
      '<div class="rp-n">' + (href ? '<a href="' + esc(href) + '">' + nm + '</a>' : nm) + '</div>' +
      '<div class="rp-t">' + esc(g.names[p.team]) + '</div>' +
      '<div class="rp-line"><b>' + (p.pts || 0) + '</b>pts <b>' + reb + '</b>reb <b>' +
        (p.ast || 0) + '</b>ast</div>' +
      '<div class="rp-adv">' +
        ((p.p2m || 0) + (p.p3m || 0)) + '/' + ((p.p2a || 0) + (p.p3a || 0)) + ' fg' +
        (num(p.ts) != null ? ' · ' + pct1(p.ts) + ' TS' : '') +
        ((p.p3a || 0) ? ' · ' + (p.p3m || 0) + '/' + p.p3a + ' 3pt' : '') +
      '</div></div>';
  }).join('');
  return '<div class="rcard"><div class="rcard-h">The performances</div>' +
    '<div class="rps">' + cards + '</div></div>';
}

const CARDS = {
  quarters: cardQuarters,
  factors:  cardFactors,
  lineups:  cardLineups,
  players:  cardPlayers
};

/* ---- the whole article --------------------------------------------------- */
function render(g, rep) {
  const secs = rep.sections.map(s => {
    const card = CARDS[s.card] ? CARDS[s.card](g, rep.facts) : '';
    return '<section class="rsec">' +
      '<h2>' + esc(s.heading) + '</h2>' +
      '<div class="rprose">' + s.paras.map(p => '<p>' + p + '</p>').join('') + '</div>' +
      card +
    '</section>';
  }).join('');

  return '<article class="rep">' +
    '<div class="rep-head">' +
      '<div class="rep-kicker">match report · generated from the play-by-play</div>' +
      '<h1 class="rep-hl">' + rep.headline + '</h1>' +
      '<p class="rep-stand">' + rep.standfirst + '</p>' +
    '</div>' + secs +
    '<div class="rep-foot">Written from the event log: every number above is ' +
      'computed from the same replay that draws the box score below.</div>' +
  '</article>';
}

return { render, cards: CARDS };
}));
