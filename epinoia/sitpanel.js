'use strict';
/* ============================================================================
   THE EVENTS PANEL — a season's second chances, breaks, turnovers, timeouts and
   half-court sets, on every player's and every club's profile.

   The game page's EVENTS tab says what each kind of play turned into in one
   game. This is the same question over a season: how much of a player's (or a
   club's) scoring came from each situation, how well it was made, and — tap a
   row — where on the floor those shots were taken, rim / mid / 3PT. Beneath it,
   the assisted and unassisted baskets and where each kind was made.

   IT READS ONLY THE FLAT SEASON KEYS. epinoia/season.js rolls the per-game
   `stats.sit` lines up into ev_<situation>_<stat> on every player and team row
   (and evd_ for what opponents did against a club), so the numbers here are the
   ones the season tables show under "events · ..." and the two cannot disagree.
   Nothing is recomputed from events on this page; the only arithmetic is a
   made-per-game figure (a total over ev_gp, the way season.js makes every other
   per-game number) and a 3PT eFG% (makes × 1.5 over attempts).

   COVERAGE IS SAID OUT LOUD. Only games finalised with the splits carry them,
   so a season can be part-covered: ev_gp is how many games the numbers come
   from and the panel says "from N of M games" whenever that is not all of them.
   With no coverage every ev_ key is null, and the panel says so rather than
   printing a table of dashes.

   PERCENTILES RANK LIKE AGAINST LIKE. A chip beside a rate is its rank among
   rows with enough volume to mean something — not every row in the
   competition, where a player who took three second-chance shots and made two
   would sit at the 95th percentile. The floors, per situation:
       players   eFG% needs 10+ attempts, a zone's FG% 5+ attempts in that zone
       teams     eFG% needs 20+ attempts, a zone's FG% 10+, PPP 10+ chances
   The row itself must clear the same floor to get a chip, and fewer than three
   qualifying rows means no chip at all. A club's DEFENCE ranks the other way:
   less allowed is better, so the league's best defence is its 100th percentile.

   Two entry points. html(opts) is pure — a string, testable in node. render()
   draws it into opts.host and handles the taps: one row open at a time and
   the Offence / Defence toggle, both remembered per host so a competition-scope
   switch on the profile redraws with the same row still open.

     opts = { host, kind:'player'|'team', row, field, name, side:'off'|'def', note }
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSitPanel = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fin = v => typeof v === 'number' && isFinite(v);
const r1 = v => Math.round(v * 10) / 10;
const DASH = '—';
const f1 = v => (fin(v) ? v.toFixed(1) : DASH);
const f2 = v => (fin(v) ? v.toFixed(2) : DASH);
const pc = v => (fin(v) ? v.toFixed(1) + '%' : DASH);
/* made-attempted per game, the way the season table prints its pair columns */
const ma = (m, a) => (fin(m) || fin(a) ? f1(m) + '-' + f1(a) : DASH);
const perGame = (total, gp) => (fin(total) && gp > 0 ? r1(total / gp) : null);
const ord = n => { const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'); };

/* the order every reader uses (contract: UI vocabulary) */
const SITS = [
  { k: 'all',        label: 'All shots' },
  { k: 'second',     label: 'Second chance' },
  { k: 'transition', label: 'Transition' },
  { k: 'offTo',      label: 'Off turnovers' },
  { k: 'ato',        label: 'After timeout' },
  { k: 'half',       label: 'Half court' }
];
const SIT_KEYS = SITS.map(s => s.k);

/* Rim, Mid, 3PT: the key stems each zone uses on a season row. mult is what a
   make is worth against a two, so a zone's eFG% is makes × mult over attempts. */
const ZONES = [
  { z: 'rim',   label: 'Rim', M: 'rimM', A: 'rimA', apg: 'rim_apg', pct: 'rim_pct', sh: 'rim_sh', astp: 'rim_astp', mult: 1 },
  { z: 'mid',   label: 'Mid', M: 'midM', A: 'midA', apg: 'mid_apg', pct: 'mid_pct', sh: 'mid_sh', astp: 'mid_astp', mult: 1 },
  { z: 'three', label: '3PT', M: 'p3m',  A: 'p3a',  apg: 'p3_apg',  pct: 'p3_pct',  sh: 'p3_sh',  astp: 'p3_astp',  mult: 1.5 }
];

/* THE PERCENTILE FLOOR. A rate from a handful of plays is noise, so a row is only
   ranked, and only ranked against, when its volume in that situation reaches a
   quarter of the league's typical (median) volume there, and never less than a
   small minimum. Relative on purpose: the situations differ by an order of
   magnitude. A club's season of after-timeout sets is a fraction of its second
   chances, so one fixed floor (it was 20 attempts / 10 chances) hid every
   after-timeout chip for the first month, while still letting a player's pair of
   second-chance shots rank in a big situation. */
const MIN = { player: 5, team: 3 };
const REL = 0.25;
const FLOORS = typeof WeakMap === 'function' ? new WeakMap() : null;
function floorOf(field, volKey, kind) {
  let byField = FLOORS ? FLOORS.get(field) : null;
  if (FLOORS && !byField) { byField = new Map(); FLOORS.set(field, byField); }
  const tag = volKey + '|' + kind;
  if (byField && byField.has(tag)) return byField.get(tag);
  const vols = (Array.isArray(field) ? field : []).map(r => r && r[volKey]).filter(v => fin(v) && v > 0).sort((a, b) => a - b);
  const med = vols.length ? vols[Math.floor(vols.length / 2)] : 0;
  const f = Math.max(MIN[kind], Math.ceil(REL * med));
  if (byField) byField.set(tag, f);
  return f;
}

const prefix = (kind, side) => (kind === 'team' && side === 'def' ? 'evd_' : 'ev_');

/* how many games the splits come from, and the words for it */
function coverage(row, kind, side) {
  const pre = prefix(kind, side);
  const gp = row && fin(row[pre + 'gp']) ? row[pre + 'gp'] : 0;
  const of = row && fin(row.gp) ? row.gp : 0;
  const text = !gp ? '' : (of > gp ? 'from ' + gp + ' of ' + of + ' games'
                                   : gp + (gp === 1 ? ' game' : ' games'));
  return { pre, gp, of, text };
}

/* ---------------------------------------------------------------- ranking ---
   EpinoiaSeason.percentiles when the page has it, so a chip here is the same
   rank the season table's heat map gives; otherwise the same arithmetic. Each
   (key, floor) pool is ranked once per field and remembered, because the panel
   redraws on every tap and a competition can hold a few hundred players. */
function localRanks(pool, key, low) {
  const vals = pool.map(r => r[key]).sort((a, b) => a - b);
  const table = new Map();
  pool.forEach(r => {
    let below = 0;
    for (let i = 0; i < vals.length; i++) if (vals[i] < r[key]) below++; else break;
    let p = 100 * below / (vals.length - 1 || 1);
    if (low) p = 100 - p;
    table.set(r.id, Math.max(0, Math.min(100, p)));
  });
  return table;
}

const MEMO = typeof WeakMap === 'function' ? new WeakMap() : null;
const enough = (r, volKey, min) => !!r && fin(r[volKey]) && r[volKey] >= min;

function rankIn(field, row, key, volKey, min, low) {
  if (!row || row.id == null || !Array.isArray(field) || !fin(row[key]) || !enough(row, volKey, min)) return null;
  const tag = key + '|' + volKey + '|' + min + '|' + (low ? 1 : 0);
  let byField = MEMO ? MEMO.get(field) : null;
  if (MEMO && !byField) { byField = new Map(); MEMO.set(field, byField); }
  let R = byField ? byField.get(tag) : null;
  if (!R) {
    const pool = field.filter(r => r && r.id != null && fin(r[key]) && enough(r, volKey, min));
    R = { n: pool.length, table: null };
    if (pool.length >= 3) {
      const SE = root && root.EpinoiaSeason;
      R.table = SE && typeof SE.percentiles === 'function'
        ? (SE.percentiles(pool, [key], low ? [key] : []).get(key) || null)
        : localRanks(pool, key, low);
    }
    if (byField) byField.set(tag, R);
  }
  if (!R.table) return null;
  const p = R.table.get(row.id);
  return fin(p) ? { p, n: R.n } : null;
}

/* rank one figure on this panel's row: the floor comes from the volume key, the
   direction from the side (a defence ranks low-is-good) unless flip turns it over */
function rank(o, key, volKey, unit, flip) {
  const min = floorOf(o.field, volKey, o.kind);
  const low = flip ? !o.low : o.low;
  return chip(rankIn(o.field, o.row, key, volKey, min, low), o, min + '+ ' + unit);
}

/* the small number beside a rate, banded the way the percentile bars are */
function chip(r, o, floor) {
  if (!r) return '';
  const p = Math.round(r.p);
  const band = r.p >= 75 ? 3 : r.p >= 50 ? 2 : r.p >= 25 ? 1 : 0;
  const title = ord(p) + ' percentile among ' + r.n + (o.kind === 'team' ? ' teams' : ' players') +
    ' with ' + floor + (o.side === 'def' ? ' · less allowed ranks higher' : '');
  return '<span class="sp-pct b' + band + '" title="' + esc(title) + '">' + p + '</span>';
}

/* ------------------------------------------------------------------ marks ---
   RIM, MID, 3PT AS ONE ORDERED BAR. A single hue stepped from the strongest
   (rim, nearest the basket) to the faintest (3PT), 2px apart, with every part
   named in words under it — so the zone is never told by colour alone, and a
   club's colours (body.themed remaps --lume) carry straight through. */
function dietHTML(row, base, width, of) {
  const parts = ZONES.map(Z => ({ Z, sh: row[base + Z.sh] }));
  if (!parts.some(x => fin(x.sh) && x.sh > 0)) {
    return '<span class="sp-diet none"><span class="sp-dl">no shots</span></span>';
  }
  const title = parts.map(x => x.Z.label + ' ' + pc(x.sh)).join(' · ') + ' ' + of;
  const bar = parts.map(x => (fin(x.sh) && x.sh > 0
    ? '<i class="z-' + x.Z.z + '" style="flex:' + x.sh + ' 1 0%"></i>' : '')).join('');
  const words = parts.map(x => '<span><i class="sp-sw z-' + x.Z.z + '"></i>' + x.Z.label + ' ' +
    (fin(x.sh) ? Math.round(x.sh) : DASH) + '</span>').join('');
  return '<span class="sp-diet" title="' + esc(title) + '">' +
    '<span class="sp-bar"' + (width == null ? '' : ' style="width:' + width.toFixed(1) + '%"') + '>' + bar + '</span>' +
    '<span class="sp-dl">' + words + '</span></span>';
}

/* ------------------------------------------------------------------- rows --- */
function head(o) {
  const th = (label, title, cls) => '<th scope="col"' + (cls ? ' class="' + cls + '"' : '') +
    (title ? ' title="' + esc(title) + '"' : '') + '>' + label + '</th>';
  const whose = o.side === 'def' ? 'allowed' : (o.kind === 'team' ? 'the team’s' : 'his');
  return '<tr>' + th('Situation', '', 'sp-k') +
    th('PTS/G', 'points per game ' + (o.side === 'def' ? 'allowed ' : '') + 'in this situation') +
    th('%PTS', 'share of ' + whose + ' points') +
    (o.kind === 'team'
      ? th('CH/G', 'chances per game (after timeout: possessions)') +
        th('FREQ', 'share of all chances') +
        th('PPP', 'points per chance (after timeout: per possession)')
      : '') +
    th('FG M-A/G', 'field goals made-attempted per game') +
    th('eFG%', 'effective field goal percentage') +
    th('Shot mix', 'share of the attempts at the rim, from mid-range and from three', 'sp-mix') + '</tr>';
}

/* EVERY FIGURE IN A ROW IS RANKED, the volumes as well as the rates. A rate is
   pooled by its own volume (eFG% by attempts, PPP by chances); a volume or a
   share by the whole season's shooting, so a club with a thin sample does not
   rank on how often something happened to it. The All row's share and frequency
   are 100 for everyone and carry no rank. */
function rowHTML(o, S) {
  const row = o.row, base = o.pre + S.k + '_', on = o.open === S.k;
  const fga = row[base + 'fga'];
  const cls = 'sp-row' + (S.k === 'all' ? ' ref' : '') + (on ? ' on' : '') + (fin(fga) && fga > 0 ? '' : ' none');
  const inSit = S.k === 'all' ? '' : ' in this situation';
  const whole = o.pre + 'all_fga', seasonShots = 'attempts in the season';
  const fig = (v, c) => '<td class="sp-fig">' + v + c + '</td>';
  let cells = fig(f1(row[base + 'ppg']), rank(o, base + 'ppg', whole, seasonShots)) +
    (S.k === 'all' ? '<td>' + f1(row[base + 'pts_sh']) + '</td>' : fig(f1(row[base + 'pts_sh']), rank(o, base + 'pts_sh', whole, seasonShots)));
  if (o.kind === 'team') {
    cells += fig(f1(row[base + 'ch_pg']), rank(o, base + 'ch_pg', whole, seasonShots)) +
      (S.k === 'all' ? '<td>' + f1(row[base + 'freq']) + '</td>' : fig(f1(row[base + 'freq']), rank(o, base + 'freq', whole, seasonShots))) +
      fig(f2(row[base + 'ppp']), rank(o, base + 'ppp', base + 'ch', (S.k === 'ato' ? 'possessions' : 'chances') + inSit));
  }
  cells += '<td>' + ma(row[base + 'fgm_pg'], row[base + 'fga_pg']) + '</td>' +
    fig(f1(row[base + 'efg']), rank(o, base + 'efg', base + 'fga', 'attempts' + inSit)) +
    '<td class="sp-mix">' + dietHTML(row, base, null, 'of the attempts') + '</td>';
  return '<tr class="' + cls + '" data-sp-open="' + S.k + '">' +
    '<th scope="row" class="sp-k"><button type="button" class="sp-open" aria-expanded="' + on + '">' +
      esc(S.label) + '</button></th>' + cells + '</tr>' +
    (on ? detailHTML(o, S) : '');
}

/* THE BREAKDOWN UNDER A TAPPED ROW: each zone's makes and attempts a game, how
   well they went in (ranked), and how much of the situation's shooting it was;
   then the free throws and turnovers the situation also produced. */
function detailHTML(o, S) {
  const row = o.row, base = o.pre + S.k + '_';
  const tile = (cls, label, value, meta) => '<div class="sp-tile' + cls + '"><div class="sp-tl">' + label + '</div>' +
    '<div class="sp-tv">' + value + '<small>per game</small></div>' + (meta ? '<div class="sp-tm">' + meta + '</div>' : '') + '</div>';
  const zones = ZONES.map(Z => {
    return tile(' z', '<i class="sp-sw z-' + Z.z + '"></i>' + Z.label,
      ma(perGame(row[base + Z.M], o.gp), row[base + Z.apg]),
      'FG <b>' + pc(row[base + Z.pct]) + '</b>' + rank(o, base + Z.pct, base + Z.A, Z.label + ' attempts' + (S.k === 'all' ? '' : ' in this situation')) +
      '<br><b>' + pc(row[base + Z.sh]) + '</b> of the attempts');
  }).join('');
  const ft = tile(' aux', 'Free throws', ma(perGame(row[base + 'ftm'], o.gp), row[base + 'fta_pg']),
    'FT <b>' + pc(row[base + 'ft_pct']) + '</b>');
  const tov = tile(' aux', 'Turnovers', f1(row[base + 'tov_pg']),
    o.kind === 'team' ? '<b>' + pc(row[base + 'tov_pct']) + '</b> of ' + (S.k === 'ato' ? 'possessions' : 'chances') : '');
  return '<tr class="sp-detail"><td colspan="' + (o.kind === 'team' ? 9 : 6) + '"><div class="sp-in">' +
    '<div class="sp-dh">' + esc(S.label) + (o.side === 'def' ? ' allowed' : '') + ', by zone</div>' +
    '<div class="sp-tiles">' + zones + ft + tov + '</div></div></td></tr>';
}

/* ASSISTED AND UNASSISTED. Only a make can be assisted, so the two lines are
   made baskets: how many a game, what share of all of them, what a basket was
   worth, and where each kind was made. Beside each zone, the share of its
   makes that came off a pass and how the zone was shot from ALL its attempts —
   there is no such thing as an assisted miss, so no assisted eFG% either. */
function assistHTML(o) {
  const row = o.row, pre = o.pre;
  const aF = row[pre + 'ast_fgm'], uF = row[pre + 'unast_fgm'];
  const made = (fin(aF) ? aF : 0) + (fin(uF) ? uF : 0);
  const share = g => (g === 'ast' ? (fin(row[pre + 'ast_sh']) ? row[pre + 'ast_sh'] : null)
                                  : (made > 0 && fin(uF) ? r1(100 * uF / made) : null));
  const groups = [['ast', 'Assisted'], ['unast', 'Unassisted']];
  const max = Math.max(0, ...groups.map(([g]) => (fin(row[pre + g + '_fgm_pg']) ? row[pre + g + '_fgm_pg'] : 0)));
  /* Ranked like the table above: the per-game and share figures pooled by the
     season's made baskets, points per basket by that group's own baskets. The
     unassisted share is the assisted share read the other way up, so it ranks
     from the same numbers turned over rather than from a key of its own. */
  const all = pre + 'all_';
  const made0 = all + 'fgm';
  const line = ([g, label]) => {
    const b = pre + g + '_', v = row[b + 'fgm_pg'];
    const width = max > 0 && fin(v) ? Math.max(2, 100 * v / max) : 0;
    return '<div class="sp-aline"><div class="sp-al"><b>' + label + '</b><small>' +
      '<em>' + f1(v) + '</em>' + rank(o, b + 'fgm_pg', made0, 'made baskets in the season') + ' made per game · ' +
      '<em>' + pc(share(g)) + '</em>' + rank(o, pre + 'ast_sh', made0, 'made baskets in the season', g === 'unast') + ' of baskets · ' +
      '<em>' + f2(row[b + 'ppb']) + '</em>' + rank(o, b + 'ppb', b + 'fgm', label.toLowerCase() + ' baskets') + ' pts per basket</small></div>' +
      '<div class="sp-abar">' + dietHTML(row, b, width, 'of the makes') + '</div></div>';
  };
  /* a zone's eFG% is its FG% times what a make is worth, so one rank serves both */
  const zrow = Z => {
    const A = row[all + Z.A], Mk = row[all + Z.M];
    const efg = fin(A) && A > 0 && fin(Mk) ? r1(100 * Mk * Z.mult / A) : null;
    const shot = rank(o, all + Z.pct, all + Z.A, Z.label + ' attempts');
    return '<tr><th scope="row" class="sp-k"><i class="sp-sw z-' + Z.z + '"></i>' + Z.label + '</th>' +
      '<td>' + pc(row[pre + Z.astp]) + rank(o, pre + Z.astp, all + Z.M, Z.label + ' makes') + '</td>' +
      '<td>' + pc(row[all + Z.pct]) + shot + '</td><td>' + pc(efg) + shot + '</td></tr>';
  };
  return '<div class="sp-ast"><div class="sp-sub">Assisted and unassisted baskets' + (o.side === 'def' ? ' allowed' : '') + '</div>' +
    groups.map(line).join('') +
    '<table class="sp-ztbl"><thead><tr><th scope="col" class="sp-k">Zone</th>' +
      '<th scope="col" title="share of the zone’s makes that were assisted">Makes assisted</th>' +
      '<th scope="col">FG%</th><th scope="col">eFG%</th></tr></thead>' +
      '<tbody>' + ZONES.map(zrow).join('') + '</tbody></table>' +
    '<p class="sp-note">A missed shot has no assist, so eFG% is given per zone for all attempts.</p></div>';
}

/* ------------------------------------------------------------------- html --- */
function html(opts) {
  const O = opts || {};
  const kind = O.kind === 'team' ? 'team' : 'player';
  const side = kind === 'team' && O.side === 'def' ? 'def' : 'off';
  const row = O.row && typeof O.row === 'object' ? O.row : null;
  const nm = O.name == null ? '' : String(O.name);
  const cov = coverage(row, kind, side);
  const other = kind === 'team' ? coverage(row, kind, side === 'def' ? 'off' : 'def') : { gp: 0 };
  const shell = inner => '<div class="sp sp-' + kind + '" data-side="' + side + '">' + inner + '</div>';
  const EMPTY = 'No event splits yet — they fill in as games are finalised.';
  if (!cov.gp && !other.gp) return shell('<div class="sp-empty">' + EMPTY + '</div>');

  const tabs = kind === 'team'
    ? '<div class="ep-tabs sp-side" role="tablist" aria-label="Offence or defence">' +
        [['off', 'Offence'], ['def', 'Defence']].map(([k, l]) =>
          '<button type="button" class="ep-tab' + (k === side ? ' on' : '') + '" role="tab" aria-selected="' + (k === side) +
          '" data-sp-side="' + k + '">' + l + '</button>').join('') + '</div>'
    : '';
  const who = kind === 'player'
    ? (nm ? '<b>' + esc(nm) + '</b>' : 'This player')
    : side === 'def'
      ? 'Opponents against ' + (nm ? '<b>' + esc(nm) + '</b>' : 'this club')
      : (nm ? '<b>' + esc(nm) + '</b>' : 'This club') + ' on offence';
  const lede = '<p class="sp-lede">' + who + (cov.text ? ' · ' + esc(cov.text) : '') +
    (O.note ? ' · ' + esc(O.note) : '') + '</p>';
  const top = '<div class="sp-head">' + tabs + lede + '</div>';
  if (!cov.gp) {
    return shell(top + '<div class="sp-empty">No event splits ' + (side === 'def' ? 'against this club' : 'for this club') +
      ' yet — they fill in as games are finalised.</div>');
  }

  const o = {
    kind, side, row, pre: cov.pre, gp: cov.gp, low: side === 'def',
    field: Array.isArray(O.field) ? O.field : [],
    open: SIT_KEYS.indexOf(O.open) >= 0 ? O.open : null
  };
  const floors = 'among ' + (kind === 'team' ? 'teams' : 'players') + ' with at least a quarter of the league’s usual volume ' +
    'for that figure (never under ' + MIN[kind] + '); hover a number for its pool';
  return shell(top +
    '<div class="ep-xscroll sp-scroll"><table class="sp-tbl ' + kind + '">' +
      '<thead>' + head(o) + '</thead><tbody>' + SITS.map(S => rowHTML(o, S)).join('') + '</tbody></table></div>' +
    '<p class="sp-note">Tap a situation for its rim, mid and 3PT breakdown. A basket can be in more than one situation, ' +
      'so the rows do not add up to All shots. The small number is the league percentile, ' + floors +
      (side === 'def' ? '; less allowed ranks higher' : '') + '.</p>' +
    assistHTML(o));
}

/* ----------------------------------------------------------------- render ---
   Draws into the host and listens once. The open row and the side live in a
   WeakMap keyed by the host element, so a page that calls render() again on
   the same host (a competition-scope switch) keeps them, and a host that is
   thrown away takes its state with it. */
const STATE = typeof WeakMap === 'function' ? new WeakMap() : null;

function render(opts) {
  const O = opts || {};
  const host = typeof O.host === 'string'
    ? (typeof document !== 'undefined' ? document.querySelector(O.host) : null) : O.host;
  if (!host || !STATE) return null;
  let st = STATE.get(host);
  if (!st) {
    st = { open: null, side: O.side === 'def' ? 'def' : 'off', opts: O, bound: false };
    STATE.set(host, st);
  }
  st.opts = O;
  const draw = focus => {
    host.innerHTML = html(Object.assign({}, st.opts, { host: null, open: st.open, side: st.side }));
    if (focus && host.querySelector) {
      const b = host.querySelector(focus);
      if (b && b.focus) { try { b.focus({ preventScroll: true }); } catch (_) { /* focus is a nicety */ } }
    }
  };
  if (!st.bound && host.addEventListener) {
    st.bound = true;
    host.addEventListener('click', e => {
      const t = e && e.target;
      if (!t || !t.closest) return;
      const sb = t.closest('[data-sp-side]');
      if (sb && (!host.contains || host.contains(sb))) {
        const s = sb.getAttribute('data-sp-side') === 'def' ? 'def' : 'off';
        if (s !== st.side) { st.side = s; draw('[data-sp-side="' + s + '"]'); }
        return;
      }
      const tr = t.closest('[data-sp-open]');
      if (tr && (!host.contains || host.contains(tr))) {
        const k = tr.getAttribute('data-sp-open');
        if (SIT_KEYS.indexOf(k) === -1) return;
        st.open = st.open === k ? null : k;
        draw('[data-sp-open="' + k + '"] .sp-open');
      }
    });
  }
  draw(null);
  return { host, state: st, redraw: () => draw(null) };
}

return { html, render, coverage, SITS, ZONES, MIN };
}));
