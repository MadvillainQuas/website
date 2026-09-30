'use strict';
/* ============================================================================
   ONE POSITION, AGAINST THE LEAGUE (team page): press PG, SG, SF, PF or C on the depth chart.

   A position is a GROUP, not a man: the starter and the two behind him (depth.js). What a club gets from its
   point guards is what they produce between them, so that is what is compared - every club in the league put
   through the same depth chart (its heaviest-minute five starting, everyone slotted by where he plays), and its
   group at that position measured beside this club's:

     PER GAME     points, rebounds, assists, steals + blocks, three-point attempts, turnovers (fewer is better)
     RATES        true shooting of the group's shots together (never an average of percentages), and the
                  minutes-weighted box plus-minus and on/off - how much better the club is with them on

   Every measure is ranked among the clubs (1st is the best, turnovers counted the other way) and drawn:

     THE SHAPE    a radar of the group's percentiles, the league's middle as a dashed ring
     THE FIELD    a strip for every measure, every club a dot, this one in its colour with its number
     THE MEN      each player in the group against every player the league puts at that position
     THE VERDICT  a few sentences from the ranks: where the group leads the league, where it trails, how its
                  starter compares with the other starters, and what the bench gives

   Pure except for open(): the tests drive context(), report() and html() with plain rows.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaPosition = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

/* each measure: its short name, what it is about, and how its number is said in a sentence */
const METRICS = [
  { k: 'pts', short: 'PTS', label: 'scoring', unit: ' points a game', dp: 1 },
  { k: 'reb', short: 'REB', label: 'rebounding', unit: ' rebounds a game', dp: 1 },
  { k: 'ast', short: 'AST', label: 'playmaking', unit: ' assists a game', dp: 1 },
  { k: 'stocks', short: 'STL+BLK', label: 'defensive plays', unit: ' steals and blocks a game', dp: 1 },
  { k: 'p3a', short: '3PA', label: 'three-point volume', unit: ' threes a game', dp: 1 },
  { k: 'ts', short: 'TS%', label: 'shooting efficiency', unit: '% true shooting', dp: 1 },
  { k: 'tov', short: 'TOV', label: 'ball security', unit: ' turnovers a game', dp: 1, low: true },
  { k: 'bpm', short: 'BPM', label: 'overall impact', unit: ' BPM', dp: 1 },
  { k: 'onoff', short: 'ON/OFF', label: 'on/off impact', unit: ' per 100 with them on', dp: 1 }
];
const NAMES = { PG: 'point guard', SG: 'shooting guard', SF: 'small forward', PF: 'power forward', C: 'centre' };
const PLURAL = { PG: 'point guards', SG: 'shooting guards', SF: 'small forwards', PF: 'power forwards', C: 'centres' };

const num = v => (v == null || v === '' || !isFinite(+v) ? null : +v);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
const X = () => root.EpinoiaDepth;

/* ------------------------------------------------------------ the group --- */
/* what a group of players gives its club a game: totals over the club's games, rates from the group's own sums */
function group(players, teamGp) {
  const g = Math.max(1, num(teamGp) || 1);
  const sum = k => players.reduce((a, p) => a + (num(p[k]) || 0), 0);
  const fga = sum('fga'), fta = sum('fta'), pts = sum('pts');
  const w = (k) => {
    let a = 0, m = 0;
    players.forEach(p => { const v = num(p[k]), mm = num(p.min) || 0; if (v != null && mm > 0) { a += v * mm; m += mm; } });
    return m > 0 ? a / m : null;
  };
  return {
    pts: pts / g, reb: (sum('oreb') + sum('dreb')) / g, ast: sum('ast') / g, stocks: (sum('stl') + sum('blk')) / g,
    p3a: sum('p3a') / g, tov: sum('tov') / g, ts: fga + fta > 0 ? 100 * pts / (2 * (fga + 0.44 * fta)) : null,
    bpm: w('bpm'), onoff: w('diff_net'), min: sum('min') / g
  };
}

/* ------------------------------------------------------------ the league --- */
/* Every club through the same depth chart: S is the season (EpinoiaData.season), rosters [{ team_id, position,
   players: { id, height_cm } }], meta [{ id, name, short_name, colour, logo_path }]. The club being read keeps
   its own chart (the one on the page, starts and recent minutes included) as `own`. */
function context(o) {
  const S = o.season || {}, D = X();
  const byTeam = new Map();
  (S.players || []).forEach(p => {
    const t = S.teamOfPlayer && S.teamOfPlayer.get(p.id);
    if (!t) return;
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t).push(p);
  });
  const bio = new Map();
  (o.rosters || []).forEach(r => { if (r && r.players && r.players.id) bio.set(r.players.id, { position: r.position || '', height: r.players.height_cm }); });
  const gp = new Map((S.teams || []).map(t => [t.id, num(t.gp) || 0]));
  const meta = new Map((o.meta || []).map(t => [t.id, t]));
  const clubs = [];
  byTeam.forEach((rows, teamId) => {
    if (!(gp.get(teamId) > 0)) return;
    let chart;
    if (o.own && o.own.teamId === teamId) chart = o.own.chart;
    else {
      const season = new Map(rows.map(r => [r.id, r]));
      const roster = rows.filter(r => num(r.min) > 0).map(r => Object.assign({ id: r.id, name: r.name || '' }, bio.get(r.id) || {}));
      chart = D.chart({ roster, season, recent: new Map(), starts: { season: new Map(), recent: new Map(), games: 0 } });
    }
    const seasonRows = new Map(rows.map(r => [r.id, r]));
    const slots = {};
    chart.slots.forEach(s => {
      const members = s.players.map(p => Object.assign({}, seasonRows.get(p.id) || {}, { id: p.id, name: p.name, num: p.num, role: p.role, proj: p.proj }));
      slots[s.key] = { members, stats: group(members.filter(m => num(m.min) > 0), gp.get(teamId)) };
    });
    const m = meta.get(teamId) || {};
    clubs.push({ id: teamId, name: m.name || '', short: m.short_name || '', colour: m.colour || null, logo_path: m.logo_path || null, gp: gp.get(teamId), slots });
  });
  return { clubs, byId: new Map(clubs.map(c => [c.id, c])) };
}

/* ------------------------------------------------------------ the report --- */
function report(ctx, teamId, slot) {
  const me = ctx.byId.get(teamId);
  if (!me || !me.slots[slot]) return null;
  const field = ctx.clubs.filter(c => c.slots[slot] && c.slots[slot].members.length);
  const metrics = METRICS.map(m => {
    const vals = field.map(c => ({ id: c.id, v: c.slots[slot].stats[m.k], name: c.short || c.name, colour: c.colour })).filter(x => x.v != null && isFinite(x.v));
    const mine = me.slots[slot].stats[m.k];
    if (mine == null || vals.length < 3) return Object.assign({}, m, { value: mine, rank: null, of: vals.length, pct: null, vals });
    const better = vals.filter(x => (m.low ? x.v < mine : x.v > mine)).length;
    const rank = better + 1, n = vals.length;
    const sorted = vals.map(x => x.v).sort((a, b) => a - b);
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    return Object.assign({}, m, { value: mine, rank, of: n, pct: n > 1 ? 100 * (n - rank) / (n - 1) : 50, vals, median });
  });
  /* the men: each against every player the league puts at this position, per game */
  const pool = [];
  ctx.clubs.forEach(c => (c.slots[slot] ? c.slots[slot].members : []).forEach(p => { if (num(p.min) >= 40) pool.push(Object.assign({ club: c.short || c.name }, p)); }));
  /* his percentile among the OTHERS at the position (he may be under the pool's 40 minutes, or in it: either way he is
     measured against everyone but himself), shown 1st to 99th as a percentile is */
  const pr = (p, k, low) => {
    const v = num(p[k]);
    const list = pool.filter(x => x.id !== p.id).map(x => num(x[k])).filter(x => x != null);
    if (v == null || list.length < 5) return null;
    const below = list.filter(x => (low ? x > v : x < v)).length, tie = list.filter(x => x === v).length;
    return Math.max(1, Math.min(99, Math.round(100 * (below + tie / 2) / list.length)));
  };
  const men = me.slots[slot].members.map(p => ({
    id: p.id, name: p.name, num: p.num, role: p.role, mpg: num(p.mpg), proj: num(p.proj),
    line: { ppg: num(p.ppg), rpg: num(p.rpg), apg: num(p.apg), ts: num(p.ts), bpm: num(p.bpm) },
    pct: { ppg: pr(p, 'ppg'), rpg: pr(p, 'rpg'), apg: pr(p, 'apg'), ts: pr(p, 'ts'), bpm: pr(p, 'bpm') }
  }));
  /* the starter against the other starters */
  const starters = field.map(c => c.slots[slot].members.find(x => x.role === 'starter') || c.slots[slot].members[0]).filter(Boolean);
  const mine = me.slots[slot].members.find(x => x.role === 'starter') || me.slots[slot].members[0];
  let starterRank = null;
  if (mine && num(mine.bpm) != null) {
    const list = starters.filter(s => num(s.bpm) != null);
    starterRank = { rank: list.filter(s => s.bpm > mine.bpm).length + 1, of: list.length, name: mine.name, bpm: mine.bpm };
  }
  /* what the bench gives: minutes a game from the men behind the starter, against the league's typical club */
  const benchMin = c => c.slots[slot].members.filter(x => x.role !== 'starter').reduce((a, x) => a + (num(x.mpg) || 0), 0);
  const benches = field.map(benchMin).sort((a, b) => a - b);
  const bench = { mine: benchMin(me), median: benches.length ? benches[Math.floor(benches.length / 2)] : null };
  return { slot, name: NAMES[slot], plural: PLURAL[slot], club: { id: me.id, name: me.name, colour: me.colour, gp: me.gp }, of: field.length,
           metrics, men, starterRank, bench, verdict: verdict(me, slot, metrics, starterRank, bench) };
}

function fmt(m, v) {
  if (v == null || !isFinite(v)) return '—';
  const s = (+v).toFixed(m.dp);
  return (m.k === 'bpm' || m.k === 'onoff') && v > 0 ? '+' + s : s;
}

function verdict(me, slot, metrics, starterRank, bench) {
  const out = [];
  const ranked = metrics.filter(m => m.rank != null);
  if (!ranked.length) return ['Too few clubs have played to set this position against the league yet.'];
  const n = ranked[0].of;
  const impact = metrics.find(m => m.k === 'bpm' && m.rank != null);
  const pos = PLURAL[slot];
  if (impact) {
    const tier = impact.rank <= Math.ceil(n / 4) ? 'among the best in the league' : impact.rank > n - Math.ceil(n / 4) ? 'among the weakest in the league'
      : impact.rank <= n / 2 ? 'in the better half of the league' : 'in the lower half of the league';
    out.push((me.name || 'This club') + '\'s ' + pos + ' are ' + tier + ': ' + ordinal(impact.rank) + ' of ' + n + ' for overall impact (' + fmt(impact, impact.value) + ' BPM, minutes-weighted).');
  }
  const top = ranked.filter(m => m.k !== 'bpm' && m.rank <= Math.max(2, Math.ceil(n / 5))).sort((a, b) => a.rank - b.rank).slice(0, 2);
  const low = ranked.filter(m => m.k !== 'bpm' && m.rank > n - Math.max(2, Math.ceil(n / 5))).sort((a, b) => b.rank - a.rank).slice(0, 2);
  if (top.length) out.push('They lead in ' + top.map(m => m.label + ' (' + fmt(m, m.value) + m.unit + ', ' + ordinal(m.rank) + ')').join(' and ') + '.');
  if (low.length) out.push('They trail in ' + low.map(m => m.label + ' (' + fmt(m, m.value) + m.unit + ', ' + ordinal(m.rank) + ' of ' + n + ')').join(' and ') + '.');
  if (starterRank && starterRank.of >= 3) {
    out.push(starterRank.name + ', the starter, is the ' + (starterRank.rank === 1 ? 'best' : ordinal(starterRank.rank) + '-best') + ' starting ' + NAMES[slot] +
      ' in the league by box plus-minus (' + (starterRank.bpm > 0 ? '+' : '') + (+starterRank.bpm).toFixed(1) + ').');
  }
  if (bench && bench.median != null) {
    const d = bench.mine - bench.median;
    out.push(Math.abs(d) < 3 ? 'The men behind him play about what a typical club\'s do (' + bench.mine.toFixed(1) + ' minutes a game).'
      : d > 0 ? 'The bench carries more of the load than most: ' + bench.mine.toFixed(1) + ' minutes a game behind the starter, against a league middle of ' + bench.median.toFixed(1) + '.'
      : 'The starter carries the position: the bench gives ' + bench.mine.toFixed(1) + ' minutes a game, against a league middle of ' + bench.median.toFixed(1) + '.');
  }
  return out;
}

/* ---------------------------------------------------------------- charts --- */
/* THE SHAPE: a radar of percentiles, the league's middle a dashed ring */
function radar(metrics, colour) {
  const ax = metrics.filter(m => m.pct != null);
  if (ax.length < 3) return '';
  const S = 340, C = S / 2, R = 118;
  const pt = (i, r) => { const a = -Math.PI / 2 + i * 2 * Math.PI / ax.length; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const ring = f => ax.map((_, i) => pt(i, R * f).map(v => v.toFixed(1)).join(',')).join(' ');
  const shape = ax.map((m, i) => pt(i, R * Math.max(0.04, m.pct / 100)).map(v => v.toFixed(1)).join(',')).join(' ');
  const labels = ax.map((m, i) => {
    const [x, y] = pt(i, R + 26);
    const anchor = Math.abs(x - C) < 8 ? 'middle' : x > C ? 'start' : 'end';
    return '<text x="' + x.toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="' + anchor + '" class="pv-ax">' + esc(m.short) + '</text>' +
      '<text x="' + x.toFixed(1) + '" y="' + (y + 18).toFixed(1) + '" text-anchor="' + anchor + '" class="pv-axv">' + ordinal(m.rank) + '</text>';
  }).join('');
  const spokes = ax.map((_, i) => { const [x, y] = pt(i, R); return '<line x1="' + C + '" y1="' + C + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="pv-spoke"/>'; }).join('');
  const dots = ax.map((m, i) => { const [x, y] = pt(i, R * Math.max(0.04, m.pct / 100)); return '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4" class="pv-dot"><title>' + esc(m.label) + ': ' + ordinal(m.rank) + ' of ' + m.of + '</title></circle>'; }).join('');
  return '<svg class="pv-radar" viewBox="-40 -10 ' + (S + 80) + ' ' + (S + 20) + '" role="img" aria-label="percentiles against the league" style="--pc:' + esc(colour || 'var(--team-a,var(--lume))') + '">' +
    [1, 0.75, 0.25].map(f => '<polygon points="' + ring(f) + '" class="pv-ring"/>').join('') +
    '<polygon points="' + ring(0.5) + '" class="pv-mid"/>' + spokes +
    '<polygon points="' + shape + '" class="pv-shape"/>' + dots + labels +
    '<text x="' + C + '" y="' + (C + R * 0.5 + 14).toFixed(1) + '" text-anchor="middle" class="pv-midl">league middle</text></svg>';
}

/* THE FIELD: a strip per measure, every club a dot, this one lit and labelled. Dots are HTML placed by percent, not an
   SVG stretched to the width: a stretched circle is an ellipse on a phone. Clubs on the same spot stack up and down. */
function strips(metrics, clubId, colour) {
  const rows = metrics.filter(m => m.rank != null && m.vals.length >= 3);
  return '<div class="pv-strips" style="--pc:' + esc(colour || 'var(--team-a,var(--lume))') + '">' + rows.map(m => {
    const vs = m.vals.map(x => x.v);
    let lo = Math.min(...vs), hi = Math.max(...vs);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const at = v => 2 + 96 * ((m.low ? hi - v : v - lo) / (hi - lo));          // percent along the track, better to the right
    const seen = new Map();
    const dots = m.vals.filter(d => d.id !== clubId).map(d => {
      const x = at(d.v), key = Math.round(x / 1.6);
      const k = seen.get(key) || 0; seen.set(key, k + 1);
      const dy = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 7;
      return '<i class="pv-o" style="left:' + x.toFixed(2) + '%;--dy:' + dy + 'px" title="' + esc(d.name + ': ' + fmt(m, d.v)) + '"></i>';
    }).join('');
    const med = m.median != null ? '<i class="pv-med" style="left:' + at(m.median).toFixed(2) + '%" title="the league\'s middle: ' + esc(fmt(m, m.median)) + '"></i>' : '';
    return '<div class="pv-row"><div class="pv-lab"><b>' + esc(m.short) + '</b><span>' + esc(m.label) + (m.low ? ' · fewer is better' : '') + '</span></div>' +
      '<div class="pv-strip" role="img" aria-label="' + esc(m.label + ': ' + ordinal(m.rank) + ' of ' + m.of) + '"><i class="pv-track"></i>' + med + dots +
      '<i class="pv-me" style="left:' + at(m.value).toFixed(2) + '%"></i></div>' +
      '<div class="pv-val"><b>' + fmt(m, m.value) + '</b><span>' + ordinal(m.rank) + '/' + m.of + '</span></div></div>';
  }).join('') + '<div class="pv-key"><i class="pv-kme"></i> this club <i class="pv-ko"></i> the others <i class="pv-kmed"></i> the league\'s middle · better to the right</div></div>';
}

/* THE MEN: each player's line, and where it stands among everyone the league plays at the position */
function men(list, plural, link) {
  if (!list.length) return '';
  const bar = (label, v, p) => '<div class="pv-mb"><span class="pv-mk">' + label + '</span><span class="pv-mv">' + (v == null ? '—' : v) + '</span>' +
    '<span class="pv-mt"><i style="width:' + (p == null ? 0 : Math.max(3, p)) + '%"></i></span><span class="pv-mp">' + (p == null ? '' : ordinal(p)) + '</span></div>';
  return '<div class="pv-men">' + list.map(p => '<div class="pv-man' + (p.role === 'starter' ? ' pv-starter' : '') + '">' +
    '<div class="pv-mh"><span class="pv-mrole">' + (p.role === 'starter' ? 'starter' : 'behind him') + '</span>' +
      '<b>' + (p.num != null && p.num !== '' ? '#' + esc(p.num) + ' ' : '') + (link ? '<a href="' + esc(link(p)) + '">' + esc(p.name) + '</a>' : esc(p.name)) + '</b>' +
      '<span class="pv-mmin">' + (p.proj ? p.proj.toFixed(1) + ' min projected' : '') + '</span></div>' +
    bar('PTS', p.line.ppg != null ? p.line.ppg.toFixed(1) : null, p.pct.ppg) + bar('REB', p.line.rpg != null ? p.line.rpg.toFixed(1) : null, p.pct.rpg) +
    bar('AST', p.line.apg != null ? p.line.apg.toFixed(1) : null, p.pct.apg) + bar('TS%', p.line.ts != null ? p.line.ts.toFixed(1) : null, p.pct.ts) +
    bar('BPM', p.line.bpm != null ? (p.line.bpm > 0 ? '+' : '') + p.line.bpm.toFixed(1) : null, p.pct.bpm) +
    '</div>').join('') + '</div><div class="pv-note">the bar is the percentile among every player the league puts at ' + esc(plural) + ' (40 minutes or more)</div>';
}

function html(rep, opts) {
  const o = opts || {};
  if (!rep) return '<div class="empty">No players at this position yet.</div>';
  const colour = rep.club.colour && /^#[0-9a-f]{6}$/i.test(rep.club.colour) ? rep.club.colour : null;
  return '<div class="pv" style="--pc:' + esc(colour || 'var(--team-a,var(--lume))') + '">' +
    '<div class="pv-head"><div class="pv-code">' + esc(rep.slot) + '</div><div class="pv-title"><div class="pv-k">' + esc(rep.name) + ' · against the league</div>' +
    '<h3>' + esc(rep.club.name) + '</h3><div class="pv-sub">' + rep.of + ' clubs\' ' + esc(rep.plural) + ', each club\'s starter and the two behind him · ' +
    rep.club.gp + (rep.club.gp === 1 ? ' game' : ' games') + (rep.club.gp < 5 ? ' <b class="pv-early">an early reading</b>' : '') + '</div></div>' +
    (o.close ? '<button type="button" class="pv-x" data-pv-close aria-label="close">×</button>' : '') + '</div>' +
    '<div class="pv-top"><div class="pv-chart">' + radar(rep.metrics, colour) + '</div>' +
    '<div class="pv-verdict">' + rep.verdict.map(t => '<p>' + esc(t) + '</p>').join('') + '</div></div>' +
    '<div class="pv-sec">the field</div>' + strips(rep.metrics, rep.club.id, colour) +
    '<div class="pv-sec">the men</div>' + men(rep.men, rep.plural, o.link) + '</div>';
}

/* ------------------------------------------------------------ the panel --- */
/* One overlay for the page: opened on a position, closed on ×, Escape or the backdrop; focus goes into it and
   comes back to the button that opened it. */
let overlay = null, opener = null;
function open(content, from) {
  const d = root.document;
  close();
  opener = from || null;
  overlay = d.createElement('div');
  overlay.className = 'pv-ov';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = '<div class="pv-card">' + content + '</div>';
  overlay.addEventListener('click', e => { if (e.target === overlay || (e.target.closest && e.target.closest('[data-pv-close]'))) close(); });
  d.addEventListener('keydown', onKey);
  d.body.appendChild(overlay);
  d.body.classList.add('pv-open');
  const x = overlay.querySelector('[data-pv-close]');
  if (x) x.focus();
  return overlay;
}
function onKey(e) { if (e.key === 'Escape') close(); }
function close() {
  if (!overlay) return;
  const d = root.document;
  overlay.remove();
  overlay = null;
  d.removeEventListener('keydown', onKey);
  d.body.classList.remove('pv-open');
  if (opener && opener.focus) opener.focus();
  opener = null;
}

return { METRICS, group, context, report, html, radar, strips, open, close, verdict };
}));
