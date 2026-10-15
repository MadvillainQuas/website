'use strict';
/* ============================================================================
   A PLAYER'S RATES AS IF PLAYED IN ANOTHER LEAGUE (2026-10-15).      window.EpinoiaTransferAdjust

   Louie: "in comparisons across covered leagues, can there be an option to adjust stats to each players' leagues?"
   and "on player profiles, there be an option to adjust stats to a covered league?" Members only.

   THE NUMBERS ARE THE LEAGUE MATRIX'S (transfer-scale.json, beside this file, rebuilt with the matrix): for each of
   nine rates, every league's place on one scale (`net`, the network of every move between leagues solved at once,
   Liga Endesa at zero) and, for each pair of leagues players have actually moved between, the mean change those
   players showed (`pairs`, with how many moves). A figure is moved from league F to league T the matrix's BLEND way:

       emp  = pairs[F>T][k]                      the measured change, when players have made that move
       w    = emp ? emp.n / (emp.n + kBlend) : 0  trusted as far as the number of moves allows (kBlend: 30)
       diff = w * emp.mean + (1 - w) * (net[F][k] - net[T][k])
       new  = clamp(value + diff, lo, hi)

   The same league is no change. A league with no `net` for a rate cannot move that rate: it is shown as played and
   said to be (`unavailable`). A league the matrix never measured is placed on the Spanish ladder (transferleagues.js
   SPANISH_RUNG) and moves with that rung's `net`, never with measured pairs; everything adjusted through one is
   `estimated`.

   THE NINE, on the site's keys (every one a rate on 0-100, BPM signed): bpm BPM, ts TS%, usg USG%, oreb_pct OREB%,
   dreb_pct DREB%, ast_pct AST%, tov_pct TOV% (lower is better), stl_pct STL%, blk_pct BLK%. Nothing else is moved:
   a per-game count carries minutes and a role, not a league.

   API
     create(scale, siteLeagues, tiers)   pure: an instance { ready, map, targets, entry(slug), canAdjust(slug),
                                         estimated(slug), label(slug), netOf(slug), adjust(input) }
     adjust({ stats, from, to })         on the loaded instance -> { values, changed: {key: delta}, estimated, basis:
                                         { n, w, method }, unavailable: [keys], ok, same }
     load({ leagues })                   the file and the site's leagues, read once a page -> instance, or null
     catalogue({ leagues })              the leagues alone (no file): what a menu offers, before anything is chosen
     current()                           the loaded instance, or null
     locked(leagueId)                    members only: EpinoiaAccess.featureLocked('transferMatrix', league)
     lockKey()                           the key a MemLock is drawn for
   UMD; node requires it (supabase/tests/transfer-adjust.test.mjs).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaTransferAdjust = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

let TLnode = null;
try { if (typeof module === 'object' && module.exports && typeof require === 'function') TLnode = require('./transferleagues.js'); } catch (_) { TLnode = null; }
const TL = () => root.EpinoiaTransferLeagues || TLnode;

const fin = v => typeof v === 'number' && isFinite(v);
const round2 = v => Math.round(v * 100) / 100;

/* the nine: the site's key, the matrix's, the label a reader knows, and the bounds a figure is held inside */
const STATS = [
  { key: 'bpm', m: 'BPM', label: 'BPM', lo: -30, hi: 30, signed: true },
  { key: 'ts', m: 'TS_pct', label: 'TS%', lo: 0, hi: 100 },
  { key: 'usg', m: 'USG_pct', label: 'USG%', lo: 0, hi: 60 },
  { key: 'oreb_pct', m: 'ORB_pct', label: 'OREB%', lo: 0, hi: 35 },
  { key: 'dreb_pct', m: 'DRB_pct', label: 'DREB%', lo: 0, hi: 50 },
  { key: 'ast_pct', m: 'AST_pct', label: 'AST%', lo: 0, hi: 70 },
  { key: 'tov_pct', m: 'TOV_pct', label: 'TOV%', lo: 0, hi: 60, inverse: true },
  { key: 'stl_pct', m: 'STL_pct', label: 'STL%', lo: 0, hi: 12 },
  { key: 'blk_pct', m: 'BLK_pct', label: 'BLK%', lo: 0, hi: 18 }
];
const KEYS = STATS.map(s => s.key);
const BY_KEY = new Map(STATS.map(s => [s.key, s]));
const K_BLEND = 30;
const LOCK_KEY = 'transferMatrix';

/* where each of the nine sits in the file's arrays, and the file's own bounds where it gives them */
function layout(scale) {
  const names = scale && Array.isArray(scale.stats) ? scale.stats : STATS.map(s => s.m);
  const meta = scale && Array.isArray(scale.meta) ? scale.meta : [];
  return STATS.map(s => {
    const j = names.indexOf(s.m);
    const m = meta.find(x => x && x.k === s.m) || (j >= 0 ? meta[j] : null) || {};
    return { key: s.key, j, lo: fin(m.lo) ? m.lo : s.lo, hi: fin(m.hi) ? m.hi : s.hi };
  });
}

/* THE SPANISH LADDER'S NET at a rung: 1 Liga Endesa, 2 Primera FEB, 3 Segunda FEB, a half halfway; past 3 the step
   from Primera FEB to Segunda FEB is taken again, rate by rate (extrapolated). A rate any of the three lacks: none. */
function ladderNet(scale, rung) {
  const L = TL();
  const rows = (L ? L.LADDER : []).map(n => scale && scale.leagues && scale.leagues[n] && scale.leagues[n].net);
  if (rows.length !== 3 || rows.some(x => !Array.isArray(x))) return null;
  const r = Number(rung);
  return rows[0].map((_, j) => {
    const a = rows[0][j], b = rows[1][j], c = rows[2][j];
    if (r <= 1) return fin(a) ? a : null;
    if (r <= 2) return fin(a) && fin(b) ? a + (r - 1) * (b - a) : null;
    if (r <= 3) return fin(b) && fin(c) ? b + (r - 2) * (c - b) : null;
    return fin(b) && fin(c) ? c + (r - 3) * (c - b) : null;
  });
}

function create(scale, siteLeagues, tiers) {
  const L = TL();
  const S = scale && scale.leagues && typeof scale.leagues === 'object' ? scale : null;
  const map = L ? L.mapping(siteLeagues || [], tiers || {}, S) : {};
  const list = L ? L.targets(map) : [];
  const lay = layout(S);
  const kBlend = S && S.settings && fin(S.settings.kBlend) && S.settings.kBlend >= 0 ? S.settings.kBlend : K_BLEND;
  const ok = e => !!(L && L.adjustable(e));
  const nets = new Map();
  const entry = slug => (slug != null && map[slug]) || null;
  function netOf(slug) {
    const e = entry(slug);
    if (!S || !ok(e)) return null;
    if (!nets.has(slug)) {
      const row = e.method === 'estimate' ? ladderNet(S, e.rung) : (S.leagues[e.matrix] && S.leagues[e.matrix].net) || null;
      nets.set(slug, Array.isArray(row) ? row : null);
    }
    return nets.get(slug);
  }
  function adjust(input) {
    const i = input || {};
    const from = String(i.from == null ? '' : i.from), to = String(i.to == null ? '' : i.to);
    const stats = i.stats || {};
    const keys = KEYS.filter(k => fin(stats[k]));
    const values = {};
    keys.forEach(k => { values[k] = stats[k]; });
    const out = { values, changed: {}, estimated: false, basis: { n: 0, w: 0, method: 'none' }, unavailable: [], from, to, ok: false, same: false };
    const F = entry(from), T = entry(to);
    if (!S || !ok(F) || !ok(T)) { out.unavailable = keys.slice(); return out; }
    out.ok = true;
    out.estimated = !!(F.estimated || T.estimated);
    if (from === to) { out.same = true; out.basis.method = 'same'; return out; }
    const nF = netOf(from), nT = netOf(to);
    /* measured moves only between two measured leagues; an estimate has none of its own */
    const pair = !F.estimated && !T.estimated && F.matrix !== T.matrix && S.pairs ? S.pairs[F.matrix + '>' + T.matrix] : null;
    keys.forEach(k => {
      const at = lay.find(x => x.key === k);
      const a = nF && at.j >= 0 ? nF[at.j] : null, b = nT && at.j >= 0 ? nT[at.j] : null;
      if (!fin(a) || !fin(b)) { out.unavailable.push(k); return; }
      const e = Array.isArray(pair) && Array.isArray(pair[at.j]) && fin(pair[at.j][0]) && fin(pair[at.j][1]) && pair[at.j][1] > 0 ? pair[at.j] : null;
      const w = e ? e[1] / (e[1] + kBlend) : 0;
      const diff = w * (e ? e[0] : 0) + (1 - w) * (a - b);
      const v = round2(Math.max(at.lo, Math.min(at.hi, stats[k] + diff)));
      values[k] = v;
      out.changed[k] = round2(v - stats[k]);
      if (k === 'bpm' || (out.basis.method === 'none' && !('bpm' in stats))) out.basis = { n: e ? e[1] : 0, w: round2(w), method: '' };
    });
    out.basis.method = out.estimated ? 'estimate' : out.basis.n ? 'blend' : 'network';
    return out;
  }
  return {
    ready: !!S, built: S ? S.built || '' : '', fixture: !!(S && S.fixture),
    map, targets: list, entry, netOf, adjust,
    canAdjust: slug => ok(entry(slug)),
    estimated: slug => !!(entry(slug) && entry(slug).estimated),
    label: slug => (entry(slug) || {}).label || ''
  };
}

/* ------------------------------------------------------------- the page's copy --- */
/* THE SCALE IS MEMBERS' DATA, never a public file: transferdata.js load('tscale') hands it over (see load below) */
const valid = j => !!(j && j.version === 1 && j.leagues && typeof j.leagues === 'object' && Array.isArray(j.stats));
const tiers = () => root.EPINOIA_LEAGUE_TIERS || {};

/* the site's leagues the reader can see: one light read a page (a page that has them already hands them over) */
let leaguesP = null;
function siteLeagues(given) {
  if (Array.isArray(given) && given.length) return Promise.resolve(given);
  if (!leaguesP) {
    const D = root.EpinoiaData;
    leaguesP = (D && typeof D.get === 'function'
      ? Promise.resolve(D.get('leagues?select=slug,name,country,gender&order=name'))
          .catch(() => D.get('leagues?select=slug,name,country&order=name'))          /* before 0131: no gender column */
      : Promise.resolve([]))
      .then(r => (Array.isArray(r) ? r : []), () => { leaguesP = null; return []; });
  }
  return leaguesP;
}

let INST = null, loadP = null, failedAt = 0, menuP = null;
/* a failed read is not asked for again for a minute: a missing file must not cost a request per redraw */
function load(opts) {
  if (INST) return Promise.resolve(INST);
  if (loadP) return loadP;
  if (failedAt && Date.now() - failedAt < 60000) return Promise.resolve(null);
  /* THE FILE IS MEMBERS' DATA: it comes through the analytics gate (transferdata.js: the analytics-file function's
     signed link, kept on the device by its token), never from a public address. No loader, or a reader the gate
     turns away (signed out, not a member, the hourly limit): no adjustment. */
  const TD = root.EpinoiaTransferData;
  if (!TD || typeof TD.load !== 'function') return Promise.resolve(null);
  loadP = Promise.all([
    Promise.resolve().then(() => TD.load('tscale')).catch(() => null),
    siteLeagues(opts && opts.leagues)
  ]).then(([scale, leagues]) => {
    if (!valid(scale)) return null;
    INST = create(scale, leagues, tiers());
    return INST;
  }).catch(e => { if (root.console) console.warn('[transfer]', e); return null; })
    .then(v => { loadP = null; if (!v) failedAt = Date.now(); return v; });
  return loadP;
}
/* what a menu offers before anything has been chosen: the leagues and how each is matched, without the file */
function catalogue(opts) {
  if (INST) return Promise.resolve(INST);
  if (!menuP) menuP = siteLeagues(opts && opts.leagues).then(ls => create(null, ls, tiers()));
  return menuP;
}
const current = () => INST;

/* MEMBERS ONLY. The lock is access.js's: featureLocked('transferMatrix', league) - the same key the analytics gate
   (analytics_check, 0265) answers for the file itself. No access.js (node): open. */
function lockKey() { return LOCK_KEY; }
function locked(league) {
  const A = root.EpinoiaAccess;
  if (!A || typeof A.featureLocked !== 'function') return false;
  try { return !!A.featureLocked(lockKey(), league == null ? null : league); } catch (_) { return false; }
}

/* the reader's words for what is moved, fixed so a translation finds them whole */
const WHAT = 'Adjusted: BPM, TS%, USG%, OREB%, DREB%, AST%, TOV%, STL% and BLK%. Every other figure is as played.';

return { create, ladderNet, layout, load, catalogue, current, locked, lockKey, valid,
         STATS, KEYS, BY_KEY, K_BLEND, LOCK_KEY, WHAT,
         _reset() { INST = null; loadP = null; failedAt = 0; menuP = null; leaguesP = null; } };
}));
