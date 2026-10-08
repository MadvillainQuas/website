'use strict';
/* ============================================================================
   COMPARE PLAYER (2026-10-08) -- the profile's way into the statistics page's compare chart.
                                                              window.EpinoiaProfileCompare

   Beside "find similar players" on the percentile bars (p/player.js paintBars). Pressed, a row of dropdowns
   opens under the switches: a league, a season of it, a club, a player of that club. Compare (or Enter on any
   of them) opens the chart the statistics table's tray opens (compare.js fromTable + open): the line shown on
   this profile against the line picked.

   THE OTHER PLAYER COMES THE SCOUTING PAGE'S WAY. The leagues are global.js catalogue() -- the leagues this
   reader may see, each with its seasons and their competitions, three requests whatever the platform's size --
   and a season's rows are D.season over its competitions merged by global.js mergeLeague: named from
   playerMeta, a row with no name dropped (a withheld minor is never offered), filed under the club he played
   his games for.

   EACH PLAYER IS RANKED IN HIS OWN COMPETITION. This line's percentiles are taken over the field the bars
   above are taken over (the season and competition shown), the other's over every player of the season picked
   -- the statistics page's population (a game or more) -- never the two pooled. A +3 BPM is "above this
   league's average"; ranked against another league it would compare two different zeroes (fulltable.js,
   rank within league).

   THE SEASON OPENS ON THE ONE SHOWN. A league with a season of the same name as the one on this profile opens
   on it, so 2025-26 is set against 2025-26; a league without one opens on its newest season.

   THE COLUMNS ARE THE STATISTICS TABLE'S (fulltable.js PLAYER_COLS and its presets), opening on its per-game
   preset. A premium column is left out where either league keeps its premium columns locked for this reader
   (access.js statColumns), as the global scouting page leaves out a column any of its leagues locks.

   API
     open(host, ctx)     the picker, drawn into host. ctx (p/player.js CMP_CTX) = { mine, field, name, label,
                         team, teamId, photo, leagueId, leagueRow, seasonName, onClose, focus }. Returns
                         { node, close }.
     model(o)            pure: what compare.js fromTable takes, for two lines and their fields (the tests)
     seasonFor(L, name)  pure: the season a league opens on
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaProfileCompare = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const fin = v => typeof v === 'number' && isFinite(v);
/* the statistics table's own per-game derivation (fulltable.js derive), on a copy */
const prep = r => Object.assign({}, r, { poss_pg: r.poss == null || !isFinite(r.poss) ? null : r.poss / (r.gp || 1) });
const seasonKey = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

/* ------------------------------------------------------------- the chart --- */
/* o = { mine, mineField, other, otherField, cols, groups, locked(k), percentiles (EpinoiaSeason.percentiles),
         mineAs, otherAs (what the chart names each by), league, range, title, note }
   The two lines are 'a' and 'b' in the chart: one person can be both (his 2025-26 against his 2024-25). */
function model(o) {
  const cols = o.cols || [];
  const locked = typeof o.locked === 'function' ? o.locked : () => false;
  const heat = cols.filter(c => c && c.heat && !locked(c.k));
  const keys = heat.map(c => c.k), low = heat.filter(c => c.low).map(c => c.k);
  const rank = (field, id) => {
    const pool = (field || []).filter(r => r && (r.gp || 0) >= 1).map(prep);
    const m = o.percentiles(pool, keys, low, null);
    return k => { const t = m.get(k); const p = t ? t.get(id) : null; return fin(p) ? p : null; };
  };
  const otherId = o.other.playerId != null ? o.other.playerId : o.other.id;
  const pa = rank(o.mineField, o.mine.id), pb = rank(o.otherField, otherId);
  const ranks = new Map(keys.map(k => [k, new Map([['a', pa(k)], ['b', pb(k)]])]));
  return {
    picks: [Object.assign(prep(o.mine), o.mineAs || {}, { id: 'a' }), Object.assign(prep(o.other), o.otherAs || {}, { id: 'b' })],
    statKeys: cols.filter(c => Array.isArray(c.g) && c.g.indexOf('basic') >= 0).map(c => c.k),
    cols, ranks, groups: o.groups || [], locked, max: 2,
    league: o.league || null, range: o.range || '', title: o.title || '', note: o.note || ''
  };
}

/* the season a league opens on: the one named like the season shown, else its newest */
function seasonFor(L, name) {
  const list = (L && L.seasons) || [];
  const want = seasonKey(name);
  return (want && list.find(s => seasonKey(s.name) === want)) || list[0] || null;
}

/* ------------------------------------------------------------- the reads --- */
let catP = null;
function catalogue() {
  const G = root.EpinoiaGlobal;
  if (!catP) catP = G.catalogue().catch(e => { catP = null; throw e; });
  return catP;
}
/* a league's season, read once a page: its rows (named, with their clubs) and its whole field (the ranking) */
const ROWS = new Map();
function seasonRows(L, s) {
  const key = L.id + '|' + s.id;
  if (!ROWS.has(key)) {
    const D = root.EpinoiaData, G = root.EpinoiaGlobal;
    const p = (async () => {
      if (!s.competitionIds || !s.competitionIds.length) return { rows: [], field: [] };
      const [S, teams] = await Promise.all([D.season(s.competitionIds, { trim: true, rows: false }), D.teamMeta(L.id)]);
      if (S.building) return { rows: [], field: [], building: true };
      const meta = S.players && S.players.length ? await D.playerMeta(S.players.map(p => p.id)) : {};
      return { rows: G.mergeLeague(L, S, meta, teams), field: S.players || [] };
    })();
    p.catch(() => ROWS.delete(key));
    ROWS.set(key, p);
  }
  return ROWS.get(key);
}

/* ------------------------------------------------------------ the picker --- */
/* what was picked, kept for the page: a redraw of the bars (a switch, another scope) opens the picker as it was */
const pick = { league: '', season: '', club: '', player: '' };
const el = (t, c, x) => { const n = root.document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
/* a select's options: a first line saying what it is for, then [value, label, isName] -- a name is never translated */
function fill(sel, head, list, value) {
  sel.textContent = '';
  const h = el('option', null, head);
  h.value = '';
  sel.appendChild(h);
  list.forEach(([v, label, name]) => {
    const o = el('option', null, label);
    o.value = v;
    if (name) o.setAttribute('translate', 'no');
    sel.appendChild(o);
  });
  sel.value = list.some(x => x[0] === value) ? value : '';
}

function open(host, ctx) {
  const C = root.EpinoiaCompare, T = root.EpinoiaTable, SE = root.EpinoiaSeason, G = root.EpinoiaGlobal;
  const box = el('form', 'pcmp');
  box.setAttribute('aria-label', 'Compare with another player');
  box.noValidate = true;
  const field = (label, cls) => {
    const w = el('label', 'pcmp-f ' + cls);
    w.appendChild(el('span', 'pcmp-l', label));
    const s = el('select', 'ep-input pcmp-s');
    w.appendChild(s);
    box.appendChild(w);
    return s;
  };
  const lgS = field('league', 'pcmp-lg'), snS = field('season', 'pcmp-sn'), clS = field('club', 'pcmp-cl'), plS = field('player', 'pcmp-pl');
  const go = el('button', 'ep-btn pri pcmp-go', 'compare');
  go.type = 'submit';
  box.appendChild(go);
  const msg = el('div', 'pcmp-msg');
  msg.setAttribute('role', 'status');
  box.appendChild(msg);
  host.appendChild(box);

  if (!C || !T || !SE || !G) { msg.textContent = 'The comparison could not be loaded.'; return { node: box, close() {} }; }

  let L = null, S = null, data = null, run = 0;
  const say = t => { msg.textContent = t || ''; };
  const ready = () => { go.disabled = !(data && plS.value); };
  const busy = (sel, t) => { fill(sel, t, [], ''); sel.disabled = true; };

  const players = () => {
    const list = data ? data.rows.filter(r => String(r.teamId) === clS.value) : [];
    fill(plS, 'player', list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(r => [String(r.playerId), r.name, true]), pick.player);
    plS.disabled = !list.length;
    pick.player = plS.value;
    ready();
  };
  const clubs = () => {
    const seen = new Map();
    (data ? data.rows : []).forEach(r => { if (r.teamId && !seen.has(r.teamId)) seen.set(r.teamId, r.teamFull || r.teamName || 'Club'); });
    fill(clS, 'club', [...seen].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id, n]) => [String(id), n, true]), pick.club);
    clS.disabled = !seen.size;
    pick.club = clS.value;
    players();
  };
  const season = async () => {
    const my = ++run;
    data = null;
    S = L && (L.seasons || []).find(s => String(s.id) === snS.value) || null;
    pick.season = S ? String(S.id) : '';
    busy(clS, 'club'); busy(plS, 'player'); ready();
    if (!L || !S) { say(''); return; }
    say('loading…');
    let d = null;
    try { d = await seasonRows(L, S); } catch (e) { if (root.console) console.warn('[compare]', e); }
    if (my !== run) return;
    if (!d) { say('Could not load that season.'); return; }
    data = d;
    say(d.building ? 'This competition’s statistics are built on the server, hourly — the first build is on its way.'
      : d.rows.length ? '' : 'No statistics for this season yet.');
    clubs();
  };
  const league = () => {
    L = (cat ? cat.leagues : []).find(l => String(l.id) === lgS.value) || null;
    pick.league = L ? String(L.id) : '';
    const list = L ? (L.seasons || []) : [];
    const want = list.some(s => String(s.id) === pick.season) ? pick.season : String((seasonFor(L, ctx.seasonName) || {}).id || '');
    fill(snS, 'season', list.map(s => [String(s.id), s.name || 'Season']), want);
    snS.disabled = !list.length;
    return season();
  };

  lgS.addEventListener('change', () => { pick.season = pick.club = pick.player = ''; league(); });
  snS.addEventListener('change', () => { pick.club = pick.player = ''; season(); });
  clS.addEventListener('change', () => { pick.club = clS.value; pick.player = ''; players(); });
  plS.addEventListener('change', () => { pick.player = plS.value; ready(); });

  const compare = async () => {
    if (go.disabled || !data) return;
    const other = data.rows.find(r => String(r.playerId) === plS.value && String(r.teamId) === clS.value);
    if (!other) return;
    const A = root.EpinoiaAccess;
    const shut = id => !!(id && A && typeof A.featureLocked === 'function' && A.featureLocked('statColumns', id));
    const locks = shut(ctx.leagueId) || shut(L.id);
    const locked = k => locks && !!(A && typeof A.isPremiumColumn === 'function' && A.isPremiumColumn(k));
    /* his club for the picture's circle, where the profile's own club is not the one he played this season for */
    let team = ctx.team;
    if (!team && ctx.teamId && root.EpinoiaData) {
      try {
        const t = (await root.EpinoiaData.get('teams?id=eq.' + ctx.teamId + '&select=name,short_name,colour,logo_path&limit=1'))[0];
        if (t) team = { name: t.name, short: t.short_name, colour: t.colour, logo: t.logo_path };
      } catch (_) { /* initials in the circle */ }
    }
    const t = team || {};
    C.open(C.fromTable(model({
      mine: ctx.mine, mineField: ctx.field, other, otherField: data.field,
      cols: T.PLAYER_COLS, groups: T.PRESETS && T.PRESETS.player, locked, percentiles: SE.percentiles,
      mineAs: { name: ctx.name, leagueShort: ctx.label, teamFull: t.name || '', teamName: t.short || t.name || '',
                teamShort: t.short || '', colour: t.colour || null, teamLogo: t.logo || null, photo_url: ctx.photo || null },
      otherAs: { leagueShort: (L.short + ' ' + G.shortSeason(S.name)).trim() },
      league: ctx.leagueRow, range: ctx.seasonName || '',
      title: ctx.name + ' v ' + other.name,
      note: 'Percentiles: each player among the players of their own competition that season.'
    })));
  };
  box.addEventListener('submit', e => { e.preventDefault(); compare(); });
  /* Enter on a dropdown is the compare button (a select does not submit its form by itself) */
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target && e.target.tagName === 'SELECT') { e.preventDefault(); compare(); }
    else if (e.key === 'Escape' && typeof ctx.onClose === 'function') { e.preventDefault(); ctx.onClose(); }
  });

  let cat = null;
  busy(lgS, 'league'); busy(snS, 'season'); busy(clS, 'club'); busy(plS, 'player'); ready();
  say('loading…');
  catalogue().then(c => {
    if (!box.isConnected) return;
    cat = c;
    const list = (c.leagues || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const want = pick.league || (list.some(l => String(l.id) === String(ctx.leagueId)) ? String(ctx.leagueId) : '');
    fill(lgS, 'league', list.map(l => [String(l.id), l.name, true]), want);
    lgS.disabled = !list.length;
    say('');
    league();
    if (ctx.focus) lgS.focus();          // pressed open, not drawn again under a switch
  }, e => {
    if (root.console) console.warn('[compare]', e);
    say('Could not load the leagues.');
  });

  return { node: box, close() { run++; if (box.parentNode) box.parentNode.removeChild(box); } };
}

return { open, model, seasonFor, _pick: pick };
}));
