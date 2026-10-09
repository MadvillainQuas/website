'use strict';
/* ============================================================================
   MANAGER - THE EPINOIA ADAPTER: everything the game needs from the site, and nothing the game itself knows.
                                                                                   window.Mgr.site

   THE GAME IS THE CORE (epinoia/manager/core/: values, cards, the engine, the season - no site, no DOM, no database);
   this file is where it meets EPINOIA, so a standalone game swaps this file for its own (Louie, 2026-10-09: "I want to
   be able to package this into a standalone game, so please make it able to be decoupled in some way").

   THE DATA, THE SITE'S CHEAPEST WAY (Louie: "make sure it uses as smartly/efficiently the huge data capabilities of the
   site as much as possible"; "Use smart api across the site"):
     * the leagues: global.js catalogue() - three requests whatever the platform's size;
     * a league's players: its newest season's file from the CDN (data.js season: the snapshot the site already builds
       after each final, cached by the browser), named the scouting page's way (global.js mergeLeague: a row with no
       name - a withheld minor - is never offered);
     * its fitted simulator and its clubs' minutes at each position: the What wins file (winfile.js), when this reader
       may have it; else engine.leagueOf builds the league from the season file;
     * values: the platform's ranges (manager_league_values, one small public table) and each club's continental boost
       (manager_boosts: one call a league);
     * form: one small read a round - the league's finished games in the days before it, their player lines trimmed to
       the fifteen counts form needs (stats->pts ...), and the same for the squad's men from other leagues.
   Only the reader's own league is ever played (Louie: "only that player's chosen league being simmed").

     leagues()                  the leagues a manager league can be made in, by country
     league(L)                  a league loaded: rows, ref, sim league, values, attributes, cards (cached a page)
     card(row, from, to)        a player's card for another league (the league-strength shift)
     formFor(L, from, to, more) Map playerId -> his games in the window, each with its tip-off t (the league's, and
                                `more` men's anywhere)
     clubs() / create() / save() / remove()            the reader's own clubs (0259)
     board(league?) / boardLeagues() / badges(ids)     the leaderboards
     values() / setValues(rows)                        the platform's ranges
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.Mgr = root.Mgr || {}; root.Mgr.site = api; }
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const M = () => root.Mgr || {};
const D = () => root.EpinoiaData, A = () => root.EpinoiaAccess, G = () => root.EpinoiaGlobal, WF = () => root.EpinoiaWinFile;
const cfg = () => root.EPINOIA_CONFIG || {};
const isNum = v => typeof v === 'number' && isFinite(v);

/* ------------------------------------------------------------------ the server --- */
async function sess() { try { const a = A(); return a && a.sessionReady ? await a.sessionReady() : null; } catch (_) { return null; } }
function headers(s, json) {
  const h = { apikey: cfg().supabaseAnonKey, Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  if (s && s.token) h.Authorization = 'Bearer ' + s.token;
  return h;
}
/* a call, with the reader's own session when there is one; an error carries the server's word for it */
async function rpc(fn, body, o) {
  const s = await sess();
  if (o && o.auth && !(s && s.token)) { const e = new Error('signin'); e.code = 'signin'; throw e; }
  const r = await fetch(String(cfg().supabaseUrl || '') + '/rest/v1/rpc/' + fn, { method: 'POST', cache: 'no-store', headers: headers(s, true), body: JSON.stringify(body || {}) });
  if (!r.ok) {
    let msg = '';
    try { const j = await r.json(); msg = j && (j.message || j.hint || j.details) || ''; } catch (_) { /* no body */ }
    const e = new Error(msg || ('the server said ' + r.status)); e.status = r.status; e.code = r.status === 404 ? 'missing' : 'server'; throw e;
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function rest(path) {
  const s = await sess();
  const r = await fetch(String(cfg().supabaseUrl || '') + '/rest/v1/' + path, { cache: 'no-store', headers: headers(s, false) });
  if (!r.ok) { const e = new Error('the server said ' + r.status); e.status = r.status; throw e; }
  return r.json();
}
async function signedIn() { if (LOCAL) return true; const s = await sess(); return !!(s && s.token); }
/* the reader's account id (a club not made yet is kept in this browser under it) */
async function userId() { if (LOCAL) return 'local'; const s = await sess(); return (s && s.userId) || null; }
const signinHref = () => { const a = A(); return a && a.signinHref ? a.signinHref() : '../signin/'; };

/* ------------------------------------------------------------------ the leagues --- */
let catP = null;
function leagues() {
  if (!catP) {
    catP = G().catalogue().then(c => c.leagues.filter(l => l.seasonId && l.competitionIds && l.competitionIds.length))
      .catch(e => { catP = null; throw e; });
  }
  return catP;
}
let valuesP = null;
function values() {
  if (!valuesP) valuesP = rest('manager_league_values?select=league_id,min_value,max_value,boost').then(rows => new Map((rows || []).map(r => [r.league_id, { min: +r.min_value, max: +r.max_value, boost: +r.boost || 0 }])))
    .catch(() => new Map());
  return valuesP;
}
async function setValues(rows) { const n = await rpc('manager_set_values', { p_rows: rows }, { auth: true }); valuesP = null; return n; }
/* the median league's range: the platform's ranges' middle one (the attributes' level is against it) */
async function medianRange() {
  const V = await values(), list = [...V.values()].filter(r => r.max > r.min && !(r.boost > 0));
  if (!list.length) return M().value.DEFAULT_RANGE;
  const mids = list.map(r => (r.min + r.max) / 2).sort((a, b) => a - b), m = mids[Math.floor(mids.length / 2)];
  return list.find(r => (r.min + r.max) / 2 === m) || M().value.DEFAULT_RANGE;
}

/* ONE LEAGUE, LOADED ONCE A PAGE: its newest season (every competition of it, as the statistics page's whole season),
   its named rows, its reference and simulator league, its values, attributes and cards */
const LOADED = new Map();
function league(L) {
  if (!L || !L.id) return Promise.reject(new Error('no league'));
  if (!LOADED.has(L.id)) {
    const p = load(L);
    p.catch(() => LOADED.delete(L.id));
    LOADED.set(L.id, p);
  }
  return LOADED.get(L.id);
}
async function load(L) {
  const Dd = D(), core = M();
  const [S, teamMeta, V, med] = await Promise.all([Dd.season(L.competitionIds, { rows: false }), Dd.teamMeta(L.id).catch(() => ({})), values(), medianRange()]);
  if (S.building) return { L, building: true, rows: [] };
  const meta = S.players && S.players.length ? await Dd.playerMeta(S.players.map(p => p.id)) : {};
  const rows = G().mergeLeague(L, S, meta, teamMeta);
  const range = V.get(L.id) || null;
  /* the fitted simulator and the minutes at each position, when the What wins file is there for this reader */
  let fo = null;
  try {
    const w = WF();
    if (w && w.get) { const r = await Promise.race([w.get({ scope: 'fo', league: L.id, season: L.seasonId }), new Promise(res => setTimeout(() => res(null), 6000))]); if (r && r.ok) fo = r.data; }
  } catch (_) { fo = null; }
  const players = S.players || [];
  const ref = core.cards.refOf(players);
  const sim = core.engine.leagueOf(ref, fo, 40, { teams: S.teams || [], games: S.games || [] });
  /* each player's minutes at PG..C: the fo file's position files where they are there, else his listing and his season
     line's estimate (cards.listedShare); and his position is the one the site lists him at (cards.listedSlot) */
  const share = new Map();
  if (fo && fo.pos) Object.values(fo.pos).forEach(P => (P && P.players || []).forEach(p => { if (p && p.id != null && Array.isArray(p.min)) share.set(String(p.id), p.min); }));
  const listed = new Map(rows.map(r => [String(r.playerId), r.position || '']));
  players.forEach(r => { const id = String(r.id); if (!share.has(id)) { const s = core.cards.listedShare(r, listed.get(id)); if (s) share.set(id, s); } });
  const slot = new Map(players.map(r => { const id = String(r.id); return [id, core.cards.listedSlot(listed.get(id), share.get(id) || core.cards.shareOf(r))]; }));
  /* the continental boosts, a club at a time */
  let boosts = new Map();
  try { boosts = new Map(((await rpc('manager_boosts', { p_league: L.id })) || []).map(b => [String(b.team_id), +b.boost || 0])); } catch (_) { boosts = new Map(); }
  const teamOf = id => (S.teamOfPlayer && (S.teamOfPlayer.get ? S.teamOfPlayer.get(id) : S.teamOfPlayer[id])) || null;
  const priced = core.value.priceLeague(players, range, r => boosts.get(String(teamOf(r.id))) || 0);
  const attrs = core.ratings.rateLeague(players, range || core.value.DEFAULT_RANGE, med);
  const byId = new Map(players.map(r => [String(r.id), r]));
  const cards = new Map();
  players.forEach(r => { const c = core.cards.cardOf(r, ref, { share: share.get(String(r.id)) }); if (c) cards.set(String(r.id), c); });
  const named = new Map(rows.map(r => [String(r.playerId), r]));
  const teams = (S.teams || []).map(t => Object.assign({}, t, { meta: teamMeta[t.id] || {} }));
  return { L, S, rows, named, byId, teamOf, ref, sim, fo, share, slot, range: range || core.value.DEFAULT_RANGE, hasRange: !!range, boosts, priced, attrs, cards, teams,
    budget: core.value.budgetOf(priced, players) };
}
/* a player's card for another league: his own league's reference, the strength shift between the two leagues' ranges */
function card(row, from, to) {
  const core = M();
  return core.cards.cardOf(row, from.ref, { share: from.share.get(String(row.id)), shift: core.cards.shiftOf(from.range, to.range) });
}

/* ------------------------------------------------------------------ form --- */
const FORM_KEYS = ['min', 'pts', 'p2m', 'p2a', 'p3m', 'p3a', 'ftm', 'fta', 'or', 'dr', 'ast', 'stl', 'blk', 'to', 'pf'];
const FORM_SELECT = 'game_id,player_uuid,player_id,' + FORM_KEYS.map(k => k + ':stats->' + k).join(',');
const chunks = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
/* his games between `from` and `to` (ISO times): the league's own finished games in the window, and for `more` (men from
   other leagues on the squad) their own lines, dated by their games. -> Map playerId -> [stats] */
async function formFor(L, from, to, more) {
  const Dd = D(), out = new Map(), when = new Map();
  /* each line carries its game's tip-off (t), so one read serves every round of a catch-up */
  const add = r => { const id = String(r.player_uuid || r.player_id || ''), t = when.get(r.game_id); if (!id || !t) return; r.t = t; if (!out.has(id)) out.set(id, []); out.get(id).push(r); };
  const games = await Dd.all(`games?competition_id=in.(${L.competitionIds.join(',')})&status=eq.final&tipoff_at=gte.${encodeURIComponent(from)}` +
    `&tipoff_at=lt.${encodeURIComponent(to)}&select=id,tipoff_at`).catch(() => []);
  games.forEach(g => when.set(g.id, new Date(g.tipoff_at).toISOString()));
  for (const c of chunks(games.map(g => g.id), 40)) (await Dd.all(`player_game_stats?game_id=in.(${c.join(',')})&select=${FORM_SELECT}`).catch(() => [])).forEach(add);
  const others = (more || []).map(String).filter(id => /^[0-9a-f-]{36}$/i.test(id));
  if (others.length) {
    const lines = (await Promise.all(chunks(others, 20).map(c => Dd.all(`player_game_stats?player_uuid=in.(${c.join(',')})&select=${FORM_SELECT}&order=game_id.desc&limit=400`).catch(() => [])))).flat();
    const ids = [...new Set(lines.map(r => r.game_id))].filter(id => !when.has(id));
    for (const c of chunks(ids, 40)) (await Dd.all(`games?id=in.(${c.join(',')})&status=eq.final&select=id,tipoff_at`).catch(() => [])).forEach(g => when.set(g.id, new Date(g.tipoff_at).toISOString()));
    const seen = new Set(), fromT = new Date(from).toISOString(), toT = new Date(to).toISOString();
    lines.forEach(r => { const t = when.get(r.game_id), k = r.game_id + '|' + (r.player_uuid || r.player_id); if (t && t >= fromT && t < toT && !seen.has(k)) { seen.add(k); add(r); } });
  }
  return out;
}

/* ------------------------------------------------------------------ the clubs --- */
/* LOCAL MODE (?local=1): the clubs kept in this browser, not the database - for trying the game before its tables are
   there, and the shape a standalone build's own store takes (the same calls, the same rows) */
const LOCAL = (() => { try { return /[?&]local=1(&|$)/.test(root.location.search) || root.MGR_LOCAL === true; } catch (_) { return false; } })();
const LKEY = 'mgr_local_clubs';
const lget = () => { try { return JSON.parse(root.localStorage.getItem(LKEY) || '[]'); } catch (_) { return []; } };
const lput = list => { try { root.localStorage.setItem(LKEY, JSON.stringify(list)); } catch (_) { /* full */ } };
const local = {
  clubs: async () => lget(),
  create: async o => {
    const list = lget();
    if (list.length >= 3) throw new Error('three clubs at most');
    const id = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : 'local-' + Date.now();
    list.push({ id, mode: 'solo', league_id: o.league, competition_id: o.competition, name: o.name, manager: o.manager, badge: o.badge || {}, status: 'draft', per_week: o.perWeek || 2,
      budget: null, roster: [], lineups: [], state: null, w: 0, l: 0, pf: 0, pa: 0, gp: 0, pos: null, of_n: null, rounds: null, played: 0, created_at: new Date().toISOString() });
    lput(list);
    return id;
  },
  save: async (id, p) => {
    const list = lget(), t = list.find(c => c.id === id);
    if (!t) throw new Error('not your club');
    ['name', 'manager', 'badge', 'status', 'budget', 'roster', 'lineups', 'state'].forEach(k => { if (k in p) t[k] = p[k]; });
    if (p.summary) Object.assign(t, { w: p.summary.w, l: p.summary.l, pf: p.summary.pf, pa: p.summary.pa, gp: p.summary.w + p.summary.l, pos: p.summary.pos, of_n: p.summary.of, rounds: p.summary.rounds, played: p.summary.played });
    t.updated_at = new Date().toISOString();
    lput(list);
    return t.updated_at;
  },
  remove: async id => { lput(lget().filter(c => c.id !== id)); return true; },
  board: async lid => {
    const L = await leagues().catch(() => []);
    return lget().filter(c => c.gp > 0 && (!lid || c.league_id === lid)).map(c => { const lg = L.find(x => x.id === c.league_id) || {};
      return Object.assign({}, c, { badge: Object.assign({}, c.badge, { img: undefined }), has_img: !!(c.badge && c.badge.img), league: lg.name || '', league_slug: lg.slug || '', pct: c.w / c.gp, diff: (c.pf - c.pa) / c.gp, me: true }); })
      .sort((a, b) => b.pct - a.pct || b.diff - a.diff).map((r, i) => Object.assign(r, { rank: i + 1 }));
  },
  boardLeagues: async () => [],
  badges: async ids => lget().filter(c => ids.includes(c.id) && c.badge && c.badge.img).map(c => ({ id: c.id, img: c.badge.img }))
};
const CLUB_COLS = 'id,mode,league_id,competition_id,name,manager,badge,status,per_week,budget,roster,lineups,state,w,l,pf,pa,gp,pos,of_n,rounds,played,created_at,updated_at';
async function clubs() { if (LOCAL) return local.clubs(); if (!(await signedIn())) return []; return rest('manager_teams?select=' + CLUB_COLS + '&order=created_at'); }
async function create(o) {
  if (LOCAL) return local.create(o);
  return rpc('manager_create', { p_league: o.league, p_competition: o.competition, p_name: o.name, p_manager: o.manager, p_badge: o.badge || {}, p_per_week: o.perWeek || 2 }, { auth: true });
}
async function save(id, patch) { if (LOCAL) return local.save(id, patch); return rpc('manager_save', { p_id: id, p: patch }, { auth: true }); }
async function remove(id) { if (LOCAL) return local.remove(id); return rpc('manager_delete', { p_id: id }, { auth: true }); }
async function board(leagueId, limit) { if (LOCAL) return local.board(leagueId); return (await rpc('manager_leaderboard', { p_league: leagueId || null, p_limit: limit || 100 })) || []; }
async function boardLeagues() { if (LOCAL) return local.boardLeagues(); return (await rpc('manager_board_leagues', {})) || []; }
async function badges(ids) { if (LOCAL) return local.badges(ids || []); return ids && ids.length ? ((await rpc('manager_badges', { p_ids: ids.slice(0, 60) })) || []) : []; }
async function isAdmin() { try { return (await rpc('is_platform_admin', {})) === true; } catch (_) { return false; } }

return { leagues, league, card, formFor, values, setValues, medianRange, clubs, create, save, remove, board, boardLeagues, badges, isAdmin, signedIn, userId, signinHref, rpc, rest, FORM_KEYS, LOCAL };
}));
