'use strict';
/* ============================================================================
   THE CLUB'S NUMBERS, DRAWN FOR A COACH (2026-10-02): the report's pages (report-teampages.js) and the club page
   (t/team.js) draw the same pieces, so a coach who reads one can read the other. Every figure sits on a colour and,
   where it is ranked, a plain word, so a reader who never learnt what eFG% is still sees what is good and what is not.

     lineupCards   the most-used fives as cards two rows deep: the offence (points per 100 and the four factors), then
                   the defence (the four factors allowed) beside how the five plays (assisted baskets, where its shots
                   come from); every number coloured against the club's own over all its minutes
     events        each situation (half court, transition, second chances, off turnovers, after timeouts) as a card:
                   points per chance at both ends on a coloured badge with its word (strength .. weakness) from its
                   place among the league's clubs, points a game, and its share of the club's points as a bar
     shotClock     early, middle and late offence at both ends, each coloured against the club's own average
     depthBars     each position's minutes as one bar, split between the players who played there

   THE COLOURS (kit/teamviz.css): 4 green, well better; 3 light green, better; 2 amber, worse; 1 red, well worse;
   9 blue, a style (more is neither better nor worse); 0 grey, nothing to compare. Against a league: the 75th
   percentile and up, the 50th, the 25th, below. Against the club's own: a step ('sc', in the stat's own units) or
   more better, better, worse, a step or more worse.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaTeamViz = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const isNum = v => v != null && v !== '' && isFinite(+v);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fx = (v, dp) => (isNum(v) ? (+v).toFixed(dp == null ? 1 : dp) : '—');
const sg = (v, dp) => (isNum(v) ? (+v > 0 ? '+' : +v < 0 ? '−' : '±') + Math.abs(+v).toFixed(dp == null ? 1 : dp) : '');
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

/* a value against a reference: 4 a step or more better, 3 better, 2 worse, 1 a step or more worse */
function bandVs(v, ref, sc, low) {
  if (!isNum(v) || !isNum(ref)) return 0;
  const g = (low ? -1 : 1) * (+v - +ref), s = sc || 3;
  return g >= s ? 4 : g >= 0 ? 3 : g > -s ? 2 : 1;
}
/* a club's place among the league's on one key, as a percentile (100 the best; low: smaller is better) */
function pctIn(field, k, id, low) {
  const vals = (field || []).filter(r => r && isNum(r[k])).map(r => ({ id: r.id, v: +r[k] }));
  const me = vals.find(x => x.id === id);
  if (!me || vals.length < 4) return null;
  const worse = vals.filter(x => (low ? x.v > me.v : x.v < me.v)).length;
  const same = vals.filter(x => x.v === me.v).length - 1;
  return Math.round(100 * (worse + same / 2) / (vals.length - 1));
}
const bandP = p => (p == null ? 0 : p >= 75 ? 4 : p >= 50 ? 3 : p >= 25 ? 2 : 1);
const WORD = { 4: 'strength', 3: 'above average', 2: 'below average', 1: 'weakness', 0: '' };
const WORD_VS = { 4: 'much better', 3: 'better', 2: 'worse', 1: 'much worse', 0: '' };
const surname = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : (p[0] || ''); };

/* --------------------------------------------------------------- lineups --- */
/* [key, the coach's word, the abbreviation, decimals, lower is better ('style': neither), the step] */
const LU_OFF = [['ortg', 'Points per 100', 'ORTG', 1, false, 4], ['efg', 'Shooting', 'eFG%', 1, false, 3], ['tov', 'Turnovers', 'TO%', 1, true, 2],
  ['oreb', 'Off. rebounds', 'OREB%', 1, false, 4], ['ftr', 'Gets to the line', 'FTr', 1, false, 5], ['ts', 'True shooting', 'TS%', 1, false, 3]];
const LU_DEF = [['drtg', 'Allowed /100', 'DRTG', 1, true, 4], ['defg', 'Opp. shooting', 'opp eFG%', 1, true, 3], ['dtov', 'TOs forced', 'opp TO%', 1, false, 2],
  ['drb', 'Def. rebounds', 'DRB%', 1, false, 4], ['dftr', 'Opp. FT rate', 'opp FTr', 1, true, 5]];
const LU_PLAY = [['astp', 'Assisted', 'AST%', 1, false, 5], ['rim100', 'Rim shots', '/100', 1, false, 3], ['mid100', 'Mid-range', '/100', 1, 'style', 3],
  ['p3a100', 'Threes', '/100', 1, 'style', 3], ['p3', '3PT%', '3P%', 1, false, 4]];
/* a five's share of its baskets that came off a pass (lineupevents.js line: each zone's own rate and makes) */
function astOf(l) {
  const e = l && l._ev;
  if (!e) return null;
  let m = 0, a = 0;
  [['rimast', 'rimM'], ['midast', 'midM'], ['p3ast', 'p3m']].forEach(([r, n]) => { if (isNum(l[r]) && e[n] > 0) { m += e[n]; a += e[n] * l[r] / 100; } });
  return m ? Math.round(1000 * a / m) / 10 : null;
}
function tile(spec, l, base) {
  const [k, word, abbr, dp, low, sc] = spec;
  const v = l[k], ref = base ? base[k] : null;
  const b = low === 'style' ? (isNum(v) ? 9 : 0) : bandVs(v, ref, sc, low);
  const d = isNum(v) && isNum(ref) ? +v - +ref : null;
  return '<div class="tv-t" data-b="' + b + '" title="' + esc(word + ' (' + abbr + '): ' + fx(v, dp) + (isNum(ref) ? ', the club ' + fx(ref, dp) : '')) + '">' +
    '<small>' + esc(word) + '</small><b>' + fx(v, dp) + '</b><em>' + esc(abbr) + (d != null ? ' <i>' + sg(d, dp) + '</i>' : '') + '</em></div>';
}
/* units: [{ ids, line }] most used first; base: the club's line over all its minutes; o: { names: id -> name, photos } */
function lineupCards(units, base, o) {
  const opt = o || {};
  const B = Object.assign({}, base || {}); B.astp = astOf(base);
  const nm = id => surname((opt.names && opt.names[id]) || 'Player');
  const cards = (units || []).map((u, i) => {
    const l = Object.assign({}, u.line); l.astp = astOf(u.line);
    const nb = bandVs(l.net, B.net, 5, false);
    const five = (u.ids || []).map(id => '<li>' + (opt.photos && opt.photos[id] ? '<img src="' + esc(opt.photos[id]) + '" alt="" crossorigin="anonymous">' : '') + '<span>' + esc(nm(id)) + '</span></li>').join('');
    return '<article class="tv-lu">' +
      '<header><b class="tv-lu-no">' + (i + 1) + '</b><ol class="tv-lu-five">' + five + '</ol>' +
        '<div class="tv-lu-net" data-b="' + nb + '"><b>' + (isNum(l.net) ? sg(l.net, 1) : '—') + '</b><span>net per 100</span><em>' + WORD_VS[nb] + (nb ? ' than the club' : '') + '</em></div>' +
        '<div class="tv-lu-meta"><span><b>' + Math.round(l.mins || 0) + '</b> min</span><span><b>' + Math.round(l.poss || 0) + '</b> poss</span><span><b>' + (l.pm > 0 ? '+' : '') + (l.pm || 0) + '</b> +/−</span></div></header>' +
      '<div class="tv-lu-row"><div class="tv-lu-g"><h5 class="o">Offence</h5><div class="tv-ts">' + LU_OFF.map(s => tile(s, l, B)).join('') + '</div></div></div>' +
      '<div class="tv-lu-row tv-lu-r2"><div class="tv-lu-g"><h5 class="d">Defence</h5><div class="tv-ts">' + LU_DEF.map(s => tile(s, l, B)).join('') + '</div></div>' +
        '<div class="tv-lu-g"><h5 class="p">How it plays</h5><div class="tv-ts">' + LU_PLAY.map(s => tile(s, l, B)).join('') + '</div></div></div>' +
      '</article>';
  });
  if (!cards.length) return '<div class="empty">No five has played enough minutes together yet.</div>';
  return '<div class="tv tv-lus">' + cards.join('') + '</div>' + key('the club over all its minutes', true);
}

/* --------------------------------------------------------------- events --- */
const SITS = [
  ['half', 'Half court', 'set offence against a set defence'],
  ['transition', 'Transition', 'fast breaks, and shots within 8 seconds of a rebound or a steal'],
  ['second', 'Second chances', 'after an offensive rebound'],
  ['offTo', 'Off turnovers', 'after the other side gives the ball away'],
  ['ato', 'After timeouts', 'the play drawn up in the timeout']
];
const ICON = {
  half: '<svg viewBox="0 0 24 24"><path d="M3 20h18M5 20a7 7 0 0 1 14 0M9 20v-5h6v5"/></svg>',
  transition: '<svg viewBox="0 0 24 24"><path d="M4 7l6 5-6 5M12 7l6 5-6 5"/></svg>',
  second: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>',
  offTo: '<svg viewBox="0 0 24 24"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
  ato: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7"/><path d="M12 9v4l3 2M9 3h6"/></svg>'
};
/* row: the club's season row (ev_ / evd_ keys); field: every club's; o: { name } */
function events(row, field, o) {
  const opt = o || {};
  if (!row) return '';
  const side = (k, def) => {
    const p = (def ? 'evd_' : 'ev_') + k + '_';
    const ppp = row[p + 'ppp'], ppg = row[p + 'ppg'], sh = row[p + 'pts_sh'], efg = row[p + 'efg'], tov = row[p + 'tov_pct'], fq = row[p + 'freq'];
    if (!isNum(ppp) && !isNum(ppg)) return '<div class="tv-ev-s"><span class="tv-ev-none">not recorded</span></div>';
    const bp = bandP(pctIn(field, p + 'ppp', row.id, def));
    const chip = (key, v, low, lab) => { const b = bandP(pctIn(field, key, row.id, low)); return '<span class="tv-c" data-b="' + b + '">' + lab + ' <b>' + fx(v, 1) + '%</b></span>'; };
    return '<div class="tv-ev-s ' + (def ? 'd' : 'o') + '">' +
      '<div class="tv-ev-ppp" data-b="' + bp + '"><b>' + fx(ppp, 2) + '</b><span>pts a chance</span></div>' +
      '<div class="tv-ev-m"><div class="tv-wl"><span class="tv-w" data-b="' + bp + '">' + (WORD[bp] || 'not ranked') + '</span>' +
        (isNum(efg) ? chip(p + 'efg', efg, def, 'eFG') : '') + (isNum(tov) ? chip(p + 'tov_pct', tov, !def, 'TO') : '') + '</div>' +
        '<p><b>' + fx(ppg, 1) + '</b> pts a game' + (def ? ' allowed' : '') + ' · ' + fx(sh, 0) + '% of ' + (def ? 'all' : 'its points') + '</p>' +
        '<div class="tv-bar" title="share of the points"><i style="width:' + (isNum(sh) ? Math.max(2, Math.min(100, +sh)).toFixed(1) : 0) + '%"></i></div>' +
        (isNum(fq) ? '<p class="tv-sm">' + fx(fq, 0) + '% of ' + (def ? 'opponents’' : 'its') + ' chances</p>' : '') + '</div></div>';
  };
  const rows = SITS.map(([k, name, what]) => '<div class="tv-ev">' +
    '<div class="tv-ev-n"><i>' + ICON[k] + '</i><b>' + name + '</b><span>' + what + '</span></div>' + side(k, false) + side(k, true) + '</div>').join('');
  return '<div class="tv tv-evs"><div class="tv-ev tv-ev-hd"><span></span><span class="o">' + esc(opt.name || 'The club') + ' with the ball</span><span class="d">Opponents with the ball</span></div>' +
    rows + '</div>' + key('the league’s clubs (points a chance; eFG and TO chips too)', false);
}

/* --------------------------------------------------------------- the shot clock --- */
/* own / opp: [{ label, n, all, s: shotclock.js summary }] early, middle, late; ownAll / oppAll: the summaries of every
   first chance, the club's average each window is coloured against */
function shotClock(own, opp, ownAll, oppAll) {
  const pc = v => (isNum(v) ? (100 * v).toFixed(1) : '—');
  const card = (r, all, def) => {
    const s = r.s || {}, A = all || {};
    const bp = bandVs(s.ppp, A.ppp, 0.08, def);
    const sh = r.all ? 100 * r.n / r.all : null;
    const chip = (lab, v, ref, low, sc) => '<span class="tv-c" data-b="' + bandVs(isNum(v) ? 100 * v : null, isNum(ref) ? 100 * ref : null, sc, low) + '">' + lab + ' <b>' + pc(v) + '</b></span>';
    return '<div class="tv-sc-c ' + (def ? 'd' : 'o') + '"><div class="tv-sc-top"><div class="tv-ev-ppp" data-b="' + bp + '"><b>' + (isNum(s.ppp) ? s.ppp.toFixed(2) : '—') + '</b><span>pts a poss.</span></div>' +
      '<div class="tv-sc-r"><h6>' + (def ? 'Opponents' : 'The club') + '</h6><div class="tv-bar"><i style="width:' + (isNum(sh) ? Math.max(2, sh).toFixed(1) : 0) + '%"></i></div>' +
      '<p class="tv-sm">' + (isNum(sh) ? sh.toFixed(0) + '% of possessions' : '') + ' · ' + r.n + '</p></div></div>' +
      '<div class="tv-cs">' + chip('eFG', s.efg, A.efg, def, 3) + chip('TO', s.tovPct, A.tovPct, !def, 2) + chip('OREB', s.orebPct, A.orebPct, def, 4) + chip('FTr', s.ftr, A.ftr, def, 5) + '</div></div>';
  };
  const NAME = [['Early', 'the first 7 seconds'], ['Middle', '8 to 16 seconds'], ['Late', '17 seconds and after']];
  return '<div class="tv tv-sc">' + (own || []).map((r, i) => '<div class="tv-sc-w"><div class="tv-sc-h"><b>' + NAME[i][0] + '</b><span>' + r.label + ' · ' + NAME[i][1] + '</span></div>' +
    card(r, ownAll, false) + card((opp || [])[i] || { n: 0, all: 0, s: {} }, oppAll, true) + '</div>').join('') + '</div>' +
    key('the club’s (or its opponents’) average over every possession', true);
}

/* --------------------------------------------------------------- depth --- */
/* c: depth.js's shares ({ slots: [{ key, label, players: [{ name, num, pct, min }], others }] }); colour: the club's */
function depthBars(c, o) {
  const opt = o || {};
  if (!c || !c.slots) return '';
  const col = opt.colour || '#08603f';
  const rows = c.slots.map(s => {
    const segs = s.players.filter(p => p.pct > 0).map((p, i) => {
      const w = Math.max(1, p.pct), dark = i < 2;
      const label = w >= 22 ? (p.num != null && p.num !== '' ? '#' + p.num + ' ' : '') + surname(p.name) + ' ' + p.pct + '%' : w >= 14 ? surname(p.name).split(' ').pop() + ' ' + p.pct + '%' : w >= 6 ? p.pct + '%' : '';
      return '<span class="tv-dp-s' + (dark ? ' dk' : '') + '" style="flex:' + w + ' 1 0;--k:' + Math.max(18, 100 - i * 22) + '%" title="' + esc((p.name || '') + ': ' + p.pct + '% · ' + Math.round(p.min) + ' min') + '">' + esc(label) + '</span>';
    }).join('') + (s.others && s.others.pct > 0 ? '<span class="tv-dp-s ot" style="flex:' + Math.max(1, s.others.pct) + ' 1 0" title="' + esc(s.others.n + ' others') + '">' + (s.others.pct >= 7 ? s.others.pct + '%' : '') + '</span>' : '');
    return '<div class="tv-dp"><b class="tv-dp-k">' + esc(s.key) + '</b><div class="tv-dp-bar">' + (segs || '<span class="tv-dp-s ot" style="flex:1">—</span>') + '</div></div>';
  }).join('');
  return '<div class="tv tv-dps" style="--tv-club:' + esc(col) + '">' + rows + '</div>';
}

/* the colours, said once under a piece */
function key(against, vs) {
  return '<p class="tv-key"><span class="tv-c" data-b="4">' + (vs ? 'much better' : 'strength') + '</span><span class="tv-c" data-b="3">' + (vs ? 'better' : 'above average') + '</span>' +
    '<span class="tv-c" data-b="2">' + (vs ? 'worse' : 'below average') + '</span><span class="tv-c" data-b="1">' + (vs ? 'much worse' : 'weakness') + '</span>' +
    (vs ? '<span class="tv-c" data-b="9">a style</span>' : '') + '<span>against ' + esc(against) + '</span></p>';
}

return { lineupCards, events, shotClock, depthBars, key, bandVs, bandP, pctIn, astOf, WORD, SITS, LU_OFF, LU_DEF, LU_PLAY };
}));
