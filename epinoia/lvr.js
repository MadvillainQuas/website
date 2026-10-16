'use strict';
/* ============================================================================
   LEFT V RIGHT - a player's shooting from each side of the floor (Louie, 2026-10-16: "a L vs. R visual graphic ... that
   shows the eFG going either way and the shot distribution in a modern box score like graphic that shows each shot
   distance and its FG% on the same chart", with a toggle for unassisted shots, "always accumulated across all of the
   player's seasons and competitions"; and on the reports, a condensed one in each player's card where there is no
   Synergy file, and the full one with an unassisted shot chart on a page of its own).

   THE SIDE is the side of the floor the shot was taken from, facing the basket: every feed is turned into one frame at
   ingest (half court, x across its width, the rim at the top; a right-hand basket rotated half a turn, B.LEAGUE's
   half-time flip ignored - scripts/ingest/translate/fiba_events.py), so x < 0.5 is his left wherever he played. A shot
   on the centre line (x exactly 0.5) is counted on his right.

   THE DISTANCES are from the centre of the ring, on the court of boxscore.js (1500 x 1400 cm, the ring at 750, 157.5),
   in the bands a scout reads a shot profile in: at the rim, short, mid-range and long twos, then corner and above-the-
   break threes (the corner is the straight run of the line, as shotchart.js zoneOf has it).

   UNASSISTED. An assist names the made basket it led to (situations.js assistedShots); a miss is never marked, because
   the play-by-play cannot say who set a miss up. So a miss is read by its shot type where the feed gives one: a pull-up,
   a step-back, a fadeaway, a floater, a hook, a putback or a tip-in is his own; an alley-oop was a pass. Any other miss
   (a plain jump shot, a layup, no type) is shared out at the rate his makes from that distance were his own - counted as
   that fraction of an unassisted attempt. Only games that log assists count at all (a game with none says nothing about
   who created what). Counting every miss as his own instead made his unassisted shooting look far worse than it was
   (a forward's threes 0 for 18). The card says how it is read.

   DOM-free but for the HTML strings it returns; node-tested (supabase/tests/lvr.test.mjs).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLvR = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const W = 1500, H = 1400, RIM_X = 750, RIM_Y = 157.5, ARC_R = 675, CORNER_X = 90;
const CORNER_Y = RIM_Y + Math.sqrt(ARC_R * ARC_R - Math.pow(RIM_X - CORNER_X, 2));

/* the bands, nearest first: [key, name, the distances it covers] */
const BANDS = [
  ['rim', 'At the rim', '0-1.25 m'],
  ['short', 'Short two', '1.25-3 m'],
  ['mid', 'Mid-range', '3-5 m'],
  ['long', 'Long two', '5 m to the line'],
  ['c3', 'Corner three', 'the corners'],
  ['ab3', 'Above the break', 'three'],
];
const sideOf = sh => (+sh.x < 0.5 ? 'L' : 'R');
/* metres from the centre of the ring */
const distM = sh => Math.hypot(+sh.x * W - RIM_X, +sh.y * H - RIM_Y) / 100;
function bandOf(sh) {
  if (sh.three) return +sh.y * H < CORNER_Y + 45 ? 'c3' : 'ab3';
  const d = distM(sh);
  return d < 1.25 ? 'rim' : d < 3 ? 'short' : d < 5 ? 'mid' : 'long';
}

const blank = () => ({ fga: 0, fgm: 0, f3m: 0, bands: Object.fromEntries(BANDS.map(b => [b[0], { a: 0, m: 0 }])) });
/* a shot type that says who made the shot: his own, or a pass's ('' where it says neither) */
const SELF = new Set(['pull-up', 'step-back', 'fadeaway', 'floater', 'hook', 'putback', 'tip-in']);
const PASSED = new Set(['alley-oop']);
const kindOf = st => (SELF.has(st) ? 'self' : PASSED.has(st) ? 'pass' : '');
/* HOW MUCH OF EACH SHOT WAS HIS OWN (see UNASSISTED above): 1 or 0 for a make (the assist says) and for a miss whose type
   says; for any other miss, the share of his makes from that distance (of no telling type) that were unassisted, from his
   whole set of shots (his overall share where a distance has fewer than five such makes). A game that logs no assists: 0. */
function unassistedWeights(shots) {
  const per = {}, all = { m: 0, u: 0 };
  (shots || []).forEach(sh => {
    if (!sh || !sh.ak || !sh.made || kindOf(sh.st)) return;
    const k = bandOf(sh), p = per[k] || (per[k] = { m: 0, u: 0 });
    p.m++; all.m++;
    if (!sh.ast) { p.u++; all.u++; }
  });
  const rate = k => { const p = per[k]; return p && p.m >= 5 ? p.u / p.m : all.m ? all.u / all.m : 1; };
  return (shots || []).map(sh => {
    if (!sh || !sh.ak) return 0;
    if (sh.made) return sh.ast ? 0 : 1;
    const kd = kindOf(sh.st);
    return kd === 'self' ? 1 : kd === 'pass' ? 0 : rate(bandOf(sh));
  });
}
/* shots [{x, y, made, three, ast, ak, st}] -> { L, R, n } ; o.unassisted: each shot counted as the part of it that was his
   own (unassistedWeights), so attempts may be fractions; makes are always whole */
function split(shots, o) {
  const un = !!(o && o.unassisted);
  const out = { L: blank(), R: blank(), n: 0 };
  const w = un ? unassistedWeights(shots) : null;
  (shots || []).forEach((sh, i) => {
    if (!sh || sh.x == null || sh.y == null) return;
    const k = un ? w[i] : 1;
    if (!(k > 0)) return;
    const s = out[sideOf(sh)], b = s.bands[bandOf(sh)];
    s.fga += k; b.a += k; out.n += k;
    if (sh.made) { s.fgm += k; b.m += k; if (sh.three) s.f3m += k; }
  });
  out.n = Math.round(out.n);
  ['L', 'R'].forEach(k => { const s = out[k]; s.efg = s.fga ? (s.fgm + 0.5 * s.f3m) / s.fga : null; s.fg = s.fga ? s.fgm / s.fga : null; });
  return out;
}

/* ---- every shot of his career --------------------------------------------------------------------------------
   o: { D (EpinoiaData: all, events), pids: [his profile ids, linked ones too], SI (EpinoiaSituations), SC (EpinoiaShotChart),
        onProgress(done, total) } -> { shots, games, gamesWithAssists }
   His games are every final game a row of his is in (player_game_stats, any season and competition), read forty at a
   time and let go, so a long career is never all in memory; kept for the visit by profile. */
/* every located shot of a batch of games, each with its assisted mark and its shot type (the 'stype' descriptor): shotchart.js
   gather asks tag() once for each shot it keeps, in the order it keeps them, so the shot types line up with what it returns */
async function located(SC, byG, gameIds, astd) {
  if (!SC || !SC.gather) return { got: [], st: [] };
  const types = new Map();
  Object.values(byG).forEach(evs => evs.forEach(e => { if (e && e.t === 'stype' && e.ref != null) types.set(String(e.gameId) + '|' + e.ref, String(e.v || '').toLowerCase()); }));
  const st = [];
  const got = await SC.gather({ fetchEvents: async () => Object.values(byG), gameIds, playerId: null,
    tag: e => { st.push(types.get(String(e.gameId) + '|' + (e.id != null ? e.id : e.seq)) || ''); return astd.has(e); } });
  return { got, st };
}
const CAREER = new Map();
function career(o) {
  const pids = [...new Set((o.pids || []).filter(Boolean).map(String))].sort();
  if (!pids.length || !o.D) return Promise.resolve({ shots: [], games: 0, gamesWithAssists: 0 });
  const key = pids.join(',');
  if (CAREER.has(key)) return CAREER.get(key);
  const p = (async () => {
    const D = o.D, SI = o.SI || root.EpinoiaSituations, SC = o.SC || root.EpinoiaShotChart;
    const who = pids.length > 1 ? 'in.(' + pids.join(',') + ')' : 'eq.' + pids[0];
    const rows = await D.all(`player_game_stats?player_uuid=${who}&select=game_id,games!inner(status)&games.status=eq.final`);
    const gids = [...new Set((rows || []).map(r => r.game_id).filter(Boolean))];
    const mine = new Set(pids);
    const shots = [];
    let withAst = 0;
    for (let i = 0; i < gids.length; i += 40) {
      const batch = gids.slice(i, i + 40);
      const evs = await D.events(batch);
      const byG = {};
      (evs || []).forEach(e => { (byG[e.gameId] = byG[e.gameId] || []).push(e); });
      const astd = new Set(), known = new Set();
      Object.keys(byG).forEach(g => {
        if (!byG[g].some(e => e.t === 'ast')) return;
        known.add(String(g)); withAst++;
        if (SI && SI.assistedShots && SI.inGameOrder) {
          try { SI.assistedShots(SI.inGameOrder(byG[g]).filter(e => e && !/^(loc|stype|tag|tags)$/.test(e.t))).assisted.forEach(e => astd.add(e)); }
          catch (_) { /* that game unmarked */ }
        }
      });
      const { got, st } = await located(SC, byG, batch, astd);
      got.forEach((sh, k) => { if (mine.has(String(sh.pid))) shots.push({ x: sh.x, y: sh.y, made: sh.made, three: sh.three, ast: !!sh.ast, ak: known.has(String(sh.gameId)), st: st[k] }); });
      if (o.onProgress) try { o.onProgress(Math.min(gids.length, i + 40), gids.length); } catch (_) { /* a courtesy */ }
    }
    return { shots, games: gids.length, gamesWithAssists: withAst };
  })();
  CAREER.set(key, p);
  p.catch(() => CAREER.delete(key));
  return p;
}

/* EVERY PLAYER OF A SQUAD AT ONCE (a club report's player cards): each one's career, from one read of the union of their
   games - a club's players share most of them, so each game's play-by-play is read once, not once a player.
   o: { D, pids, SI, SC } -> Map pid -> { shots, games, gamesWithAssists } (linked profiles are not followed here) */
function careers(o) {
  const pids = [...new Set((o.pids || []).filter(Boolean).map(String))];
  const out = new Map(pids.map(p => [p, { shots: [], games: 0, gamesWithAssists: 0 }]));
  if (!pids.length || !o.D) return Promise.resolve(out);
  return (async () => {
    const D = o.D, SI = o.SI || root.EpinoiaSituations, SC = o.SC || root.EpinoiaShotChart;
    const whoIn = new Map();                                         // game -> the squad's players with a row in it
    for (let i = 0; i < pids.length; i += 40) {
      const part = pids.slice(i, i + 40);
      const rows = await D.all(`player_game_stats?player_uuid=in.(${part.join(',')})&select=game_id,player_uuid,games!inner(status)&games.status=eq.final`);
      (rows || []).forEach(r => { if (!r.game_id) return; if (!whoIn.has(r.game_id)) whoIn.set(r.game_id, new Set()); whoIn.get(r.game_id).add(String(r.player_uuid)); });
    }
    const gids = [...whoIn.keys()];
    whoIn.forEach(set => set.forEach(p => { if (out.has(p)) out.get(p).games++; }));
    for (let i = 0; i < gids.length; i += 40) {
      const batch = gids.slice(i, i + 40);
      const evs = await D.events(batch);
      const byG = {};
      (evs || []).forEach(e => { (byG[e.gameId] = byG[e.gameId] || []).push(e); });
      const astd = new Set(), known = new Set();
      Object.keys(byG).forEach(g => {
        if (!byG[g].some(e => e.t === 'ast')) return;
        known.add(String(g));
        (whoIn.get(g) || new Set()).forEach(p => { if (out.has(p)) out.get(p).gamesWithAssists++; });
        if (SI && SI.assistedShots && SI.inGameOrder) {
          try { SI.assistedShots(SI.inGameOrder(byG[g]).filter(e => e && !/^(loc|stype|tag|tags)$/.test(e.t))).assisted.forEach(e => astd.add(e)); }
          catch (_) { /* that game unmarked */ }
        }
      });
      const { got, st } = await located(SC, byG, batch, astd);
      got.forEach((sh, k) => { const c = out.get(String(sh.pid)); if (c) c.shots.push({ x: sh.x, y: sh.y, made: sh.made, three: sh.three, ast: !!sh.ast, ak: known.has(String(sh.gameId)), st: st[k] }); });
      if (o.onProgress) try { o.onProgress(Math.min(gids.length, i + 40), gids.length); } catch (_) { /* a courtesy */ }
    }
    return out;
  })();
}

/* ---- drawing --------------------------------------------------------------------------------------------------- */
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pc = (v, dp) => (v == null ? '-' : (100 * v).toFixed(dp == null ? 1 : dp) + '%');
const share = (n, of) => (of ? Math.round(100 * n / of) + '%' : '-');

/* THE FULL GRAPHIC, as the modern box score draws a shot profile: his left down the left, his right down the right, a row
   per distance - on each side the FG% and makes-attempts, a bar as long as the share of that side's shots from there,
   filled to the FG% - and at the head each side's eFG% and its share of his shots. o: { title, note, compact } */
function cardHTML(sum, o) {
  o = o || {};
  const L = sum.L, R = sum.R, tot = L.fga + R.fga;
  if (!tot) return '<div class="lvr lvr-none">' + esc(o.empty || 'No located shots yet.') + '</div>';
  const better = (a, b) => (a != null && b != null && a !== b ? (a > b ? 'w' : '') : '');
  const maxShare = Math.max(1e-9, ...BANDS.map(b => Math.max(L.fga ? L.bands[b[0]].a / L.fga : 0, R.fga ? R.bands[b[0]].a / R.fga : 0)));
  const side = (s, k, other) => {
    const b = s.bands[k], o2 = other.bands[k];
    const fg = b.a ? b.m / b.a : null, fo = o2.a ? o2.m / o2.a : null;
    const w = s.fga ? b.a / s.fga : 0;
    return {
      fig: '<span class="lvr-v ' + better(fg, fo) + '"><b>' + (b.a ? pc(fg, 0) : '-') + '</b><i>' + Math.round(b.m) + '-' + Math.round(b.a) + '</i></span>',
      bar: '<span class="lvr-bar"><span class="lvr-tr" style="width:' + (100 * w / maxShare).toFixed(1) + '%"><i style="width:' + (fg == null ? 0 : (100 * fg).toFixed(1)) + '%"></i></span></span>'
    };
  };
  const rows = BANDS.map(([k, name, range]) => {
    if (Math.round(L.bands[k].a) === 0 && Math.round(R.bands[k].a) === 0) return '';     // nothing whole either side
    const l = side(L, k, R), r = side(R, k, L);
    return '<div class="lvr-row">' + l.fig + l.bar.replace('lvr-bar', 'lvr-bar l') +
      '<span class="lvr-mid"><b>' + esc(name) + '</b><i>' + esc(range) + ' · ' + share(L.bands[k].a, L.fga) + ' | ' + share(R.bands[k].a, R.fga) + '</i></span>' +
      r.bar.replace('lvr-bar', 'lvr-bar r') + r.fig + '</div>';
  }).join('');
  const head = (s, cls, lab, other) => '<div class="lvr-side ' + cls + '"><span class="lvr-k">' + lab + '</span>' +
    '<b class="lvr-efg ' + better(s.efg, other.efg) + '">' + pc(s.efg) + '</b>' +
    '<i>eFG · ' + Math.round(s.fgm) + '-' + Math.round(s.fga) + ' FG · ' + share(s.fga, tot) + ' of shots</i></div>';
  return '<div class="lvr' + (o.compact ? ' compact' : '') + '">' +
    (o.title ? '<div class="lvr-title">' + esc(o.title) + '</div>' : '') +
    '<div class="lvr-head">' + head(L, 'l', 'Left side', R) + '<span class="lvr-vs">eFG%</span>' + head(R, 'r', 'Right side', L) + '</div>' +
    '<div class="lvr-duel" title="his shots from each side"><i class="l" style="width:' + (100 * L.fga / tot).toFixed(1) + '%"></i><i class="r" style="width:' + (100 * R.fga / tot).toFixed(1) + '%"></i></div>' +
    '<div class="lvr-rows">' + rows + '</div>' +
    '<div class="lvr-key">Bar: the share of that side’s shots from there · filled to the FG%' + (o.note ? ' · ' + esc(o.note) : '') + '</div>' +
    '</div>';
}

/* THE CONDENSED ONE, for a player's card on a report: eFG% from each side, all his shots and his unassisted ones, as two
   mirrored duels with the share of shots between them */
function miniHTML(all, un) {
  const line = (s, lab) => {
    const L = s.L, R = s.R, tot = L.fga + R.fga;
    if (!tot) return '<div class="lvm-row none"><span class="lvm-lab">' + esc(lab) + '</span><span class="lvm-na">no located shots</span></div>';
    const wl = L.efg != null && R.efg != null && L.efg > R.efg, wr = L.efg != null && R.efg != null && R.efg > L.efg;
    return '<div class="lvm-row"><span class="lvm-v l' + (wl ? ' w' : '') + '">' + pc(L.efg) + '</span>' +
      '<span class="lvm-mid"><span class="lvm-lab">' + esc(lab) + '</span>' +
      '<span class="lvm-duel"><i class="l" style="width:' + (100 * L.fga / tot).toFixed(1) + '%"></i><i class="r" style="width:' + (100 * R.fga / tot).toFixed(1) + '%"></i></span>' +
      '<span class="lvm-n">' + Math.round(L.fga) + ' | ' + Math.round(R.fga) + ' shots</span></span>' +
      '<span class="lvm-v r' + (wr ? ' w' : '') + '">' + pc(R.efg) + '</span></div>';
  };
  return '<div class="lvm"><div class="lvm-h"><span>LEFT</span><b>eFG% by side</b><span>RIGHT</span></div>' +
    line(all, 'All shots') + line(un, 'Unassisted') + '</div>';
}

/* what the card's footnote says about where its shots come from */
function basis(c) {
  if (!c) return '';
  return 'every season and competition: ' + c.games + (c.games === 1 ? ' game' : ' games');
}
const UN_NOTE = 'unassisted: his makes without an assist; a miss by its shot type (pull-up, step-back, fadeaway, floater, hook, putback: his own), any other miss shared out as his makes from that distance were; games that log assists';
/* the shots to draw on an unassisted shot chart: every one at least half his own */
const unassistedShots = shots => { const w = unassistedWeights(shots); return (shots || []).filter((sh, i) => w[i] >= 0.5); };

return { BANDS, sideOf, distM, bandOf, split, career, careers, cardHTML, miniHTML, basis, UN_NOTE, CORNER_Y, unassistedWeights, unassistedShots, kindOf };
}));
