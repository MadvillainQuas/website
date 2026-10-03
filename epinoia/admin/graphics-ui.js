'use strict';
/* ============================================================================
   THE GRAPHICS TAB - the league's posts for its socials, made for it, and a builder for the ones nobody could
   have guessed.

   For the league in the dropdown above the tabs:

     WEEKLY CONTENT   everything the week has earned (socialgfx-ui.js reads and lays it out; socialcard.js
                      draws it), sorted by TYPE with a count on each: game results, daily scores, stars (the
                      players of the game and the player of the week), the table, the week ahead and the results roundup.
                      Pick the week (this week, last week, further back), the competition when there are several,
                      and the shape (square, portrait, story). One download each, or the lot as a ZIP, each with
                      the words to post it with.

     BUILD YOUR OWN   pick a template (a final, a star, a day's scores, the table, the week ahead, the week's results),
                      the game, game day or competition it is about, then switch its MODULES on and off and reword them:
                      headline, subline, crests, quarter scores, leaders, venue, which stat lines, how many table
                      rows and which columns, the colours, the logo, the footer's handle or words, a partner's
                      line. The preview redraws as you go; download it or copy its words.

   Nothing is posted from here and nothing is stored on the server: every graphic is drawn in this browser from
   the rows read. The builder's last settings are kept per league in this browser's localStorage, nothing more.

   Loaded with the console but read only when the Graphics tab is first opened (wstabs.js says so): most visits
   never look at it.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaGraphicsUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const el = (t, c, x) => { const n = root.document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const GX = () => root.EpinoiaSocialGfx;
const SC = () => root.EpinoiaSocialCard;

/* ------------------------------------------------------------ pure parts --- */
/* the builder's templates, in the order offered */
const TEMPLATES = [
  { id: 'result', label: 'Final score' }, { id: 'star', label: 'Star of the game' }, { id: 'day', label: 'Daily scores' }, { id: 'table', label: 'The table' },
  { id: 'fixtures', label: 'Week ahead' }, { id: 'week', label: 'Results roundup' }, { id: 'weekstars', label: 'Stars of the week' },
  { id: 'monthstars', label: 'Stars of the month' }, { id: 'leaders', label: 'Stats leaders' }
];
/* which modules each template has (the form shows only these) */
const HAS = {
  result: ['game', 'headline', 'subline', 'crests', 'quarters', 'leaders', 'leadstats', 'teamstats', 'venue'],
  star: ['game', 'player', 'headline', 'subline', 'crests', 'stats', 'discs'],
  day: ['day', 'page', 'headline', 'subline', 'crests', 'rows', 'leaders', 'dayleadstats', 'dayextras'],
  table: ['comp', 'page', 'headline', 'subline', 'crests', 'rows', 'cols'],
  fixtures: ['comp', 'page', 'headline', 'subline', 'crests', 'rows', 'venues', 'fixextras'],
  week: ['comp', 'page', 'headline', 'subline', 'crests', 'rows', 'days', 'weekextras'],
  weekstars: ['headline', 'subline', 'crests', 'rows', 'stats', 'starsby', 'layout', 'discs'],
  monthstars: ['headline', 'subline', 'crests', 'rows', 'stats', 'monthpick', 'monthby', 'mingames', 'layout', 'discs'],
  leaders: ['headline', 'subline', 'crests', 'rows', 'leadscope', 'leadsubject', 'leadcats', 'mingames']
};
/* the site's own columns (statcat.js) are offered wherever a stat is picked; the console's administrator may have the locked ones */
const CATOPTS = { premium: true, locked: false };
const LEAD_CAT_DEFAULT = ['c:ppg', 'c:rpg', 'c:apg', 'c:spg', 'c:bpg'], MONTH_DEFAULT = ['c:ppg', 'c:rpg', 'c:apg', 'c:bpm'];
const MAX_LEAD_CATS = 6, TEAM_LEAD_DEFAULT = ['c:ppg', 'c:papg', 'c:diffpg'];
const MIN_GAMES = [['', 'Automatic (two fifths of the most played)'], ['1', '1 game'], ['2', '2 games'], ['3', '3 games'], ['5', '5 games'], ['8', '8 games'], ['10', '10 games']];
const LEAD_SCOPES = [['season', 'The season'], ['month', 'The month'], ['week', 'The week']];
const MONTH_BY = [['bpm', 'BPM over the month'], ['pts', 'Points a game'], ['stat', 'Any stat of the site\'s'], ['pick', 'My pick']];
/* the stats each template can show, in the order they are laid out (the first three of a star are its big numbers) */
const STAT_ORDER = ['pts', 'reb', 'ast', 'stl', 'blk', 'fg', 'p3', 'ft', 'fgp', 'p3p', 'efg', 'p2', 'oreb', 'dreb', 'tov', 'pf', 'bpm', 'usg', 'ts', 'stocks', 'onnet', 'onortg', 'ondrtg', 'pm', 'min'];
/* a player of the game's own, worked from the game's lines (the site's engine: socialcard.js nightAdv): the stars of the week have no such line */
const NIGHT_ONLY = ['usg', 'ts', 'stocks', 'onnet', 'onortg', 'ondrtg'];
/* what a player of the game says by default: the three big numbers, then BPM (what he was picked on), usage, true shooting, steals + blocks and the on-off trio */
const STAT_DEFAULT = ['pts', 'reb', 'ast', 'bpm', 'usg', 'ts', 'stocks', 'onnet', 'onortg', 'ondrtg'];
const COL_ORDER = ['gp', 'w', 'l', 'pct', 'pts', 'diff', 'avg', 'pf', 'pa', 'ppg', 'papg', 'streak', 'l5', 'home', 'away', 'elo'];
const COL_DEFAULT = ['gp', 'w', 'l', 'pct', 'diff'];          // WIN% in the default: the table is ordered by it
/* the table's order: winning percentage (the default, as the league's own table opens) or the official one (league points, then the
   league's tiebreak rules: the stored rank) */
const TABLE_ORDER = [['', 'Win percentage (level: league points, then the tiebreak)'], ['official', 'League points: the official order']];
const COL_READ = ['l5', 'home', 'away', 'elo'];            // read from the games, not the standings
const COL_HINT = { pct: 'winning percentage (wins over games played)', pts: 'league points', avg: 'average margin', ppg: 'points scored a game', papg: 'points allowed a game', l5: 'last five games',
                   home: 'home record', away: 'away record', elo: 'ELO rating (1500 is average)', streak: 'current run' };
const TEAM_ORDER = ['fgp', 'p3p', 'ftp', 'efg', 'fg', 'p3', 'ft', 'reb', 'oreb', 'ast', 'stl', 'blk', 'tov', 'pf'];
const LEAD_ORDER = ['pts', 'reb', 'ast', 'stl', 'blk', 'fgp', 'p3p', 'pm', 'bpm'];
const LEAD_DEFAULT = ['pts', 'reb', 'ast'], WEEK_DEFAULT = ['pts', 'reb', 'ast', 'bpm'];
const WEEK_EXTRAS = [['time', 'Tip-off time'], ['venue', 'Venue'], ['quarters', 'Quarter scores'], ['record', 'Records'], ['elo', 'ELO']];
const DAY_EXTRAS = [['time', 'Tip-off time'], ['venue', 'Venue'], ['quarters', 'Quarter scores']];          // a day is read on its own: no standings, so no records
const FIX_EXTRAS = [['record', 'Records'], ['elo', 'ELO']];
const ACCENTS = [['', 'League colour'], ['#ffe600', 'Teletext yellow'], ['#00e5ff', 'Cyan']];
const THEMES = [['dark', 'League, dark'], ['light', 'Light'], ['contrast', 'High contrast']];
const LOGOS = [['both', 'Heading and footer'], ['heading', 'Heading only'], ['footer', 'Footer only'], ['none', 'Hidden']];
const ROWS = [['', 'All'], ['3', 'Top 3'], ['4', 'Top 4'], ['5', 'Top 5'], ['6', 'Top 6'], ['8', 'Top 8']];
/* the stars' ranking: the game's BPM (in place of game score, 2026-10-02: a builder saved with 'gs' reads as 'bpm') */
const STAR_BY = [['bpm', 'BPM (the game\'s)'], ['pts', 'Points'], ['pick', 'My pick']];
const byOf = v => (!v || v === 'gs' ? 'bpm' : v);
const STAR_LAYOUT = [['', 'Ranked list'], ['hero', 'One star, two runners-up'], ['five', 'Starting five']];
const MAX_COLS = 6, MIN_STATS = 3, MAX_STATS = 8, MAX_STAR = 10, MAX_TEAM = 6, MAX_LEAD = 4;

/* the builder's starting point: every module at today's default */
function defaultBuilder() {
  return { tpl: 'result', gameId: '', day: '', player: null, compId: '', page: 0, by: 'bpm', picks: [], monthOff: 0,
    mods: { headline: '', subline: '', crests: true, quarters: true, leaders: true, venue: true, days: true, venues: true, rows: '',
            cols: null, tableOrder: '', statKeys: null, weekKeys: null, monthKeys: null, teamStats: [], leaderKeys: null, leaderN: '', weekExtras: [], fixExtras: [], dayExtras: [],
            layout: '', discs: '', leadCats: null, leadScope: 'season', leadSubject: 'players', minGames: '', rankStat: 'c:ppg', zoneLabel: '', theme: 'dark', accent: '', logoPos: 'both', handle: true, footerText: '', sponsor: '' } };
}
/* the builder's options as socialcard.js's modules: only what differs from the default, so an untouched builder
   draws exactly what the weekly content does */
function modulesOf(b) {
  const m = Object.assign({}, b && b.mods);
  if (m.theme === 'dark') delete m.theme;
  const tpl = b && b.tpl;
  /* each template's own choices: a star's stat lines, a table's columns, a final's team stats and leaders, the extras of
     a results row and of a fixture's row are kept apart, so changing template never carries one's choices to another */
  /* each stars template its own stat lines: a star's, the week's (any of a night's), the month's (the site's only: a month's star has
     no night's line to read a built-in stat from, so one carried over would be drawn as a dash) */
  const stat = tpl === 'star' ? m.statKeys : tpl === 'weekstars' ? m.weekKeys : tpl === 'monthstars' ? (catOf(m.monthKeys).length ? catOf(m.monthKeys) : null) : null;
  return SC().cleanModules(Object.assign({}, m, { rows: m.rows || 0, cols: tpl === 'table' ? m.cols || null : null, statKeys: stat || null, layout: tpl === 'weekstars' || tpl === 'monthstars' ? m.layout : '',
    teamStats: tpl === 'result' ? m.teamStats : null, leaderKeys: tpl === 'result' ? m.leaderKeys : tpl === 'day' ? (m.leaderKeys || []).filter(k => !/^c:/.test(k)) : null, leaderN: tpl === 'result' ? m.leaderN : 0,
    rowExtras: tpl === 'week' ? m.weekExtras : tpl === 'fixtures' ? m.fixExtras : tpl === 'day' ? m.dayExtras : null }));
}
/* the site's columns ("c:...") a builder graphic asks for, and whether it needs the season's lines read to work them out */
const catOf = list => (Array.isArray(list) ? list : []).filter(k => /^c:/.test(k));
function needKeys(b) {
  const m = (b && b.mods) || {};
  const ks = b.tpl === 'star' ? catOf(m.statKeys) : b.tpl === 'weekstars' ? catOf(m.weekKeys) : b.tpl === 'monthstars' ? (catOf(m.monthKeys).length ? catOf(m.monthKeys) : MONTH_DEFAULT) : b.tpl === 'table' ? catOf(m.cols)
    : b.tpl === 'result' ? catOf(m.teamStats).concat(catOf(m.leaderKeys)) : b.tpl === 'leaders' ? catOf(m.leadCats || LEAD_CAT_DEFAULT) : [];
  return [...new Set(ks)];
}
const needsLines = b => b.tpl === 'monthstars' || b.tpl === 'leaders' || needKeys(b).length > 0;
/* does this graphic need what the games say beyond the table (ELO, form, home and away)? Then the tab reads it first. */
function needsExtras(b) {
  const m = (b && b.mods) || {};
  return (b.tpl === 'table' && (m.cols || []).some(k => COL_READ.includes(k))) || ((b.tpl === 'week' ? m.weekExtras : b.tpl === 'fixtures' ? m.fixExtras : null) || []).includes('elo');
}
/* one more key on or off in an ordered list, keeping it in its own order and within `min`..`max` (a refused change
   returns the list as it was, so the box the person ticked can be put back) */
function toggleKey(list, key, order, min, max) {
  const has = list.includes(key);
  if (has && list.length <= min) return list.slice();
  if (!has && list.length >= max) return list.slice();
  const next = has ? list.filter(k => k !== key) : list.concat([key]);
  return order.filter(k => next.includes(k));
}
/* the words for a game in a dropdown: "Tue 29 Sep · Paris 79–92 Virtus" */
function gameLabel(g, teamName, tz) {
  const t = SC().local(g.tipoff_at, tz);
  return (t ? SC().dayLabel(t) + ' · ' : '') + teamName(g.home_team_id) + ' ' + (g.home_score == null ? '' : g.home_score) + '–' +
    (g.away_score == null ? '' : g.away_score) + ' ' + teamName(g.away_team_id);
}
/* THE CLOCK. "Times shown in": the league's own (the default: its timezone, or its country's), the device's, or UTC. The
   choice is kept per league, in this browser only. `zoneFor` turns it into the `zone` module (null: leave each graphic in
   the league's own clock, which is what it was made in). */
const TZ_MODES = [['league', 'League local time'], ['device', 'My device\'s time'], ['utc', 'UTC']];
const tzKey = leagueId => 'epinoia.gfx.tz.' + leagueId;
function deviceZone() {
  try { return SC().validZone(new root.Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC'; } catch (_) { return 'UTC'; }
}
function zoneFor(mode, device) {
  return mode === 'utc' ? 'UTC' : mode === 'device' ? (SC().validZone(device) || deviceZone()) : null;
}
function loadTz(leagueId, storage) {
  try { const v = (storage || root.localStorage).getItem(tzKey(leagueId)); return TZ_MODES.some(m => m[0] === v) ? v : 'league'; } catch (_) { return 'league'; }
}
const discsKey = id => 'epinoia.gfx.discs.' + id;
function loadDiscs(id, storage) { try { return (storage || root.localStorage).getItem(discsKey(id)) === 'team' ? 'team' : 'player'; } catch (_) { return 'player'; } }
function saveDiscs(id, v, storage) { try { (storage || root.localStorage).setItem(discsKey(id), v); } catch (_) { /* private window */ } }
function saveTz(leagueId, mode, storage) {
  try { (storage || root.localStorage).setItem(tzKey(leagueId), mode); } catch (_) { /* private window */ }
}

/* the builder's memory, per league */
const memKey = leagueId => 'epinoia.gfx.builder.' + leagueId;
function loadBuilder(leagueId, storage) {
  const b = defaultBuilder();
  try {
    const raw = JSON.parse((storage || root.localStorage).getItem(memKey(leagueId)) || 'null');
    if (raw && typeof raw === 'object') {
      if (TEMPLATES.some(t => t.id === raw.tpl)) b.tpl = raw.tpl;
      if (raw.mods && typeof raw.mods === 'object') {
        Object.keys(b.mods).forEach(k => {
          const v = raw.mods[k], d0 = b.mods[k];
          if (Array.isArray(d0) ? Array.isArray(v) : d0 === null ? (v === null || Array.isArray(v)) : typeof v === typeof d0) b.mods[k] = v;
        });
      }
    }
  } catch (_) { /* nothing remembered, or storage is not here: the defaults */ }
  return b;
}
function saveBuilder(leagueId, b, storage) {
  try { (storage || root.localStorage).setItem(memKey(leagueId), JSON.stringify({ tpl: b.tpl, mods: b.mods })); } catch (_) { /* private window */ }
}

/* ------------------------------------------------------------------ view --- */
let current = null;
const crestOf = t => (t && t.logo_path && typeof root.epinoiaLogoUrl === 'function' ? root.epinoiaLogoUrl(t.logo_path, 256) : null);

function tabIsOpen() {
  return !!(root.EpinoiaTabs && root.EpinoiaTabs.current() === 'graphics');
}

function mount(o) {
  const host = typeof o.host === 'string' ? root.document.querySelector(o.host) : o.host;
  if (!host) return null;
  if (host.__gxStop) host.__gxStop();                   // a league switch re-mounts: the old panel's watcher goes
  const league = typeof o.league === 'function' ? o.league() : o.league;
  const panel = { host, o, size: 'portrait', off: 0, compId: 'all', type: 'all', sub: 'weekly', data: null, busy: false, started: false,
                  builder: league ? loadBuilder(league.id) : defaultBuilder(), tz: league ? loadTz(league.id) : 'league', discs: league ? loadDiscs(league.id) : 'player', seq: 0 };
  current = panel;
  host.textContent = '';
  host.appendChild(el('p', 'empty',
    'Made for you from the league\'s week: every finished game, the table and the week ahead, sorted by kind. Or build your own ' +
    'from a template and switch its parts on and off. Nothing is posted from here, and nothing is stored on the server: a game ' +
    'corrected in the console is a corrected graphic the next time it is read.'));
  panel.body = el('div', 'gx');
  host.appendChild(panel.body);
  const start = () => { if (!panel.started) { panel.started = true; load(panel); } };
  const onTab = e => { if (e.detail && e.detail.id === 'graphics') start(); };
  root.document.addEventListener('epinoia-tab', onTab);
  host.__gxStop = () => root.document.removeEventListener('epinoia-tab', onTab);
  if (tabIsOpen()) start();
  else panel.body.appendChild(el('div', 'empty', 'Opens when the Graphics tab does.'));
  return panel;
}

/* a season switch: read again for the new one - but only a panel already read; one nobody has opened yet reads the
   season on screen when its tab is first opened */
function refresh() {
  if (!current || !current.started) return;
  current.extras = null; current.lines = null; resetDays(current);             // another season: its games, its ratings, its lines, its game days
  load(current);
}

async function load(panel) {
  const o = panel.o, mine = ++panel.seq;
  const league = typeof o.league === 'function' ? o.league() : o.league;
  const comps = (typeof o.comps === 'function' ? o.comps() : o.comps) || [];
  if (!league) return;
  panel.leagueId = league.id;
  panel.busy = true;
  panel.body.textContent = '';
  panel.body.appendChild(el('div', 'empty', 'Reading the week…'));
  let data;
  try {
    data = await GX().read(o.sb, league, comps, undefined, panel.off);
  } catch (e) {
    if (mine !== panel.seq) return;
    panel.body.textContent = '';
    panel.body.appendChild(el('div', 'empty', 'The week could not be read: ' + (e && e.message || e)));
    panel.busy = false;
    return;
  }
  if (mine !== panel.seq) return;                        // a newer read (another week, another league) has taken over
  if (panel.extras) data.extras = panel.extras;
  panel.data = data;
  panel.busy = false;
  if (panel.compId !== 'all' && !comps.some(c => c.id === panel.compId)) panel.compId = 'all';
  draw(panel);
}

/* ---- small controls ---- */
function chip(label, on, click) {
  const b = el('button', 'ep-chip' + (on ? ' on' : ''), label);
  b.type = 'button';
  b.setAttribute('aria-pressed', String(!!on));
  b.addEventListener('click', click);
  return b;
}
function field(label, control, extra) {
  const l = el('label', 'f' + (extra ? ' ' + extra : ''));
  l.appendChild(el('span', null, label));
  l.appendChild(control);
  return l;
}
function select(opts, value, change) {
  const s = el('select', 'ep-input');
  opts.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s.appendChild(o); });
  s.value = value == null ? '' : String(value);
  s.addEventListener('change', () => change(s.value));
  return s;
}
function tabList(items, on, pick, label) {
  const bar = el('div', 'ep-tabs gx-sub');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', label);
  items.forEach(([id, text]) => {
    const b = el('button', 'ep-tab' + (id === on ? ' on' : ''), text);
    b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(id === on)); b.tabIndex = id === on ? 0 : -1;
    b.addEventListener('click', () => pick(id));
    b.addEventListener('keydown', e => {
      const i = items.findIndex(x => x[0] === id);
      const to = e.key === 'ArrowRight' ? (i + 1) % items.length : e.key === 'ArrowLeft' ? (i + items.length - 1) % items.length : -1;
      if (to < 0) return;
      e.preventDefault(); pick(items[to][0], true);
    });
    bar.appendChild(b);
  });
  return bar;
}

/* the data as the competition filter sees it */
const viewOf = panel => GX().scope(panel.data, panel.compId);
/* every graphic drawn for this panel is drawn in the clock chosen: the `zone` module (nothing at all when it is the league's own) */
const clockOf = panel => { const z = zoneFor(panel.tz, panel.device || (panel.device = deviceZone())); return Object.assign(z ? { zone: z } : {}, panel.discs === 'team' ? { discs: 'team' } : {}); };

function draw(panel, keepFocus) {
  const SCd = SC();
  const body = panel.body;
  body.textContent = '';
  const note = root.document.getElementById('gfxNote');
  const season = typeof panel.o.season === 'function' ? panel.o.season() : null;
  if (note) note.textContent = season ? 'season ' + season.name : '';
  if (!SCd || !root.EpinoiaReportCard) { body.appendChild(el('div', 'empty', 'The graphics could not be loaded.')); return; }
  const d = panel.data;
  if (!d.comps.length) {
    const p = el('div', 'empty', 'This league has no competition to make graphics from yet. Add a season and a competition in ');
    const a = el('a', null, 'Settings'); a.href = '#settings'; a.setAttribute('data-tab-link', 'settings'); a.style.color = 'var(--lume)';
    p.appendChild(a); p.appendChild(root.document.createTextNode('.'));
    body.appendChild(p);
    return;
  }

  /* --- the week, the competition and the shape: what both halves are about --- */
  const ctx = el('div', 'gx-ctx');
  const wk = el('div', 'gx-week');
  const prev = el('button', 'ep-btn mini', '◀'); prev.type = 'button'; prev.setAttribute('aria-label', 'an earlier week');
  const next = el('button', 'ep-btn mini', '▶'); next.type = 'button'; next.setAttribute('aria-label', 'a later week');
  next.disabled = panel.off >= 0;
  prev.addEventListener('click', () => { panel.off = GX().stepWeek(panel.off, -1); load(panel); });
  next.addEventListener('click', () => { panel.off = GX().stepWeek(panel.off, 1); load(panel); });
  const span = GX().rangeLabel(d.since, panel.off < 0 ? d.until : d.now);
  const lbl = el('div', 'gx-weeklbl');
  lbl.appendChild(el('b', null, GX().weekLabel(panel.off)));
  lbl.appendChild(el('span', null, span));
  lbl.setAttribute('aria-live', 'polite');
  wk.append(prev, lbl, next);
  ctx.appendChild(wk);
  if (d.comps.length > 1) {
    ctx.appendChild(field('Competition', select([['all', 'All competitions']].concat(d.comps.map(c => [c.id, c.name])), panel.compId,
      v => { panel.compId = v; panel.builder.compId = v === 'all' ? '' : v; panel.builder.page = 0; draw(panel); }), 'gx-comp'));
  }
  const lz = SCd.leagueZone(d.league);
  ctx.appendChild(field('Times shown in', select([['league', 'League time (' + lz.replace(/_/g, ' ') + ')'], ['device', 'My device\'s time (' + (panel.device || (panel.device = deviceZone())).replace(/_/g, ' ') + ')'], ['utc', 'UTC']], panel.tz,
    v => { panel.tz = v; saveTz(panel.leagueId, v); draw(panel); }), 'gx-tz'));
  ctx.appendChild(field('Circles', select([['player', 'Player circles'], ['team', 'Team crests']], panel.discs, v => { panel.discs = v; saveDiscs(panel.leagueId, v); draw(panel); }), 'gx-tz'));
  const shape = el('div', 'gx-shape');
  shape.setAttribute('role', 'group'); shape.setAttribute('aria-label', 'Shape');
  Object.keys(SCd.SIZES).forEach(k => shape.appendChild(chip(SCd.SIZES[k].label, k === panel.size, () => { panel.size = k; draw(panel); })));
  ctx.appendChild(shape);
  const again = el('button', 'ep-btn mini', 'read again'); again.type = 'button';
  again.addEventListener('click', () => { resetDays(panel); load(panel); });
  ctx.appendChild(again);
  body.appendChild(ctx);

  body.appendChild(tabList([['weekly', 'Weekly content'], ['build', 'Build your own']], panel.sub, (id, focus) => {
    panel.sub = id; draw(panel);
    if (focus) { const b = body.querySelector('.gx-sub .ep-tab.on'); if (b) b.focus(); }
  }, 'Graphics'));
  if (panel.off < 0) body.appendChild(el('p', 'empty gx-note', 'An earlier week: its results and stars. The table is only kept as it stands today, and the week ahead is over.'));
  const pane = el('div', 'gx-pane');
  body.appendChild(pane);
  if (panel.sub === 'build') drawBuilder(panel, pane); else drawWeekly(panel, pane);
  if (keepFocus) { const b = body.querySelector('.gx-sub .ep-tab.on'); if (b) b.focus(); }
}

/* ------------------------------------------------------- weekly content --- */
/* The season's lines (every finished game's full stats, the newest 800 games), read once when something needs them: the site's own
   numbers for a star, the month's stars, the leaders. */
function ensureLines(panel) {
  if (panel.lines) return Promise.resolve(panel.lines);
  if (!panel.linesP) panel.linesP = GX().readLines(panel.o.sb, panel.data.comps).then(l => { panel.lines = l; return l; }, e => { panel.linesP = null; throw e; });
  return panel.linesP;
}
/* THE GAME DAYS, for the Daily scores template: which days the league played on (one narrow read of every finished game's tip-off, kept),
   and any one day read on its own (its games, clubs, quarters, team lines and players: kept by day and competition). A read again, or
   another season, forgets them. */
function resetDays(panel) { panel.daysRaw = null; panel.daysP = null; panel.dayCache = null; }
function ensureDays(panel) {
  if (panel.daysRaw) return Promise.resolve(panel.daysRaw);
  if (!panel.daysP) panel.daysP = GX().readDays(panel.o.sb, panel.data.comps).then(r => { panel.daysRaw = r; return r; }, e => { panel.daysP = null; throw e; });
  return panel.daysP;
}
/* the days with a final on, newest first, for the competition on screen: [{ day, n }] (the newest 150: a season is never that many game days to pick from) */
const daysOf = panel => (panel.daysRaw ? GX().gameDays(panel.daysRaw.rows, SC().leagueZone(panel.data.league), panel.compId).slice(0, 150) : []);
const dayKeyOf = (panel, key) => key + '|' + panel.compId;
function ensureDay(panel, key) {
  panel.dayCache = panel.dayCache || new Map();
  const k = dayKeyOf(panel, key);
  if (panel.dayCache.has(k)) return Promise.resolve(panel.dayCache.get(k));
  return GX().readDay(panel.o.sb, panel.data.league, viewOf(panel).comps, key).then(d => { panel.dayCache.set(k, d); return d; });
}

/* the month and the season's leaders as cards of Weekly content (Stars, Leaders), once the lines are here */
function extraItems(panel) {
  if (!panel.lines) return [];
  const SCd = SC(), d = viewOf(panel);
  d.lines = panel.lines;
  const zone = clockOf(panel).zone || SCd.leagueZone(d.league);
  const bounds = GX().monthBounds(new Date(), 0, zone);
  const out = [];
  const ms = GX().builderModel(d, { tpl: 'monthstars', lines: panel.lines, bounds, by: 'bpm', opts: CATOPTS }, panel.size, crestOf);
  if (ms.model && ms.games >= 3) out.push({ group: 'week', type: 'stars', title: 'Stars of the month · ' + bounds.label, model: ms.model });
  const season = typeof panel.o.season === 'function' ? panel.o.season() : null;
  const ld = GX().builderModel(d, { tpl: 'leaders', lines: panel.lines, scope: 'season', seasonName: season ? season.name : 'Season', opts: CATOPTS }, panel.size, crestOf);
  if (ld.model) out.push({ group: 'week', type: 'leaders', title: 'Season leaders', model: ld.model });
  return out;
}

function drawWeekly(panel, pane) {
  const all = GX().items(viewOf(panel), panel.size, crestOf).concat(extraItems(panel));
  if (!panel.lines && !panel.linesFailed && panel.data.comps.length) {
    pane.appendChild(el('p', 'empty gx-note', 'Reading the season for the month\'s stars and the leaders…'));
    ensureLines(panel).then(() => { if (current === panel && panel.sub === 'weekly') draw(panel); }, e => { panel.linesFailed = true; if (current === panel && panel.sub === 'weekly') draw(panel); });
  } else if (panel.linesFailed) pane.appendChild(el('p', 'empty gx-note', 'The month\'s stars and the leaders could not be read.'));
  const cnt = GX().counts(all);
  if (!cnt.some(c => c.id === panel.type)) panel.type = 'all';
  const list = GX().filterBy(all, panel.type);
  const bar = el('div', 'row gx-filters');
  bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Kind of graphic');
  cnt.forEach(c => {
    const b = chip(c.label + ' ', c.id === panel.type, () => { panel.type = c.id; draw(panel); });
    b.appendChild(el('span', 'gx-n', String(c.n)));
    bar.appendChild(b);
  });
  pane.appendChild(bar);
  const acts = el('div', 'row gx-acts');
  const zip = el('button', 'ep-btn mini', 'download ' + list.length + ' as a ZIP');
  zip.type = 'button'; zip.disabled = !list.length;
  zip.addEventListener('click', () => downloadAll(panel, list, zip));
  acts.appendChild(zip);
  pane.appendChild(acts);
  if (!all.length) {
    pane.appendChild(el('div', 'empty', panel.off < 0 ? 'No game finished in the competitions chosen in this week.'
      : 'Nothing to post yet: no game has finished in the last seven days, and there is no table or week ahead in the competitions of the season chosen.'));
    return;
  }
  const groups = panel.type === 'all' ? [['week', 'The week'], ['games', 'Each game']] : [[null, (cnt.find(c => c.id === panel.type) || {}).label]];
  groups.forEach(([g, label]) => {
    const mine = g ? list.filter(x => x.group === g) : list;
    if (!mine.length) return;
    pane.appendChild(el('div', 'fmt-h', label));
    const grid = el('div', 'gx-grid');
    mine.forEach(it => grid.appendChild(card(panel, it)));
    pane.appendChild(grid);
  });
}

/* a thumbnail is drawn when it comes into view: a busy week is forty graphics */
function lazyPaint(thumb, paint) {
  if (typeof root.IntersectionObserver === 'function') {
    const io = new root.IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); paint(); } }, { rootMargin: '300px' });
    io.observe(thumb);
  } else paint();
}

function actions(getModel, opts) {
  const SCd = SC();
  const acts = el('div', 'gx-acts');
  const dl = el('button', 'ep-btn mini', 'download PNG');
  dl.type = 'button';
  dl.addEventListener('click', async () => {
    dl.disabled = true; dl.textContent = 'drawing…';
    try { const m = getModel(); save(await SCd.png(m, opts()), SCd.filename(m, opts().size)); dl.textContent = 'download PNG'; }
    catch (e) { dl.textContent = 'could not draw it'; setTimeout(() => { dl.textContent = 'download PNG'; }, 4000); }
    dl.disabled = false;
  });
  const cp = el('button', 'ep-btn mini', 'copy caption');
  cp.type = 'button';
  acts.append(dl, cp);
  return { acts, dl, cp };
}

function card(panel, it) {
  const SCd = SC();
  const box = el('div', 'gx-card');
  const thumb = el('div', 'gx-thumb');
  thumb.style.aspectRatio = SCd.SIZES[panel.size].w + ' / ' + SCd.SIZES[panel.size].h;
  box.appendChild(thumb);
  box.appendChild(el('div', 'nm', it.title));
  const { acts, cp } = actions(() => it.model, () => ({ size: panel.size, scale: 1, modules: clockOf(panel) }));
  box.appendChild(acts);
  const words = SCd.caption(it.model, clockOf(panel));
  const ta = el('textarea', 'ep-input gx-cap');
  ta.value = words; ta.readOnly = true; ta.rows = 4;
  ta.setAttribute('aria-label', 'Caption for ' + it.title);
  cp.addEventListener('click', () => copy(words, ta, cp));
  box.appendChild(ta);
  lazyPaint(thumb, async () => {
    try {
      const c = await SCd.canvas(it.model, { size: panel.size, scale: 0.25, modules: clockOf(panel) });
      c.className = 'gx-img';
      thumb.appendChild(c);
    } catch (_) { thumb.appendChild(el('div', 'empty', 'could not draw')); }
  });
  return box;
}

async function copy(words, ta, btn) {
  const label = btn.textContent;
  try { await root.navigator.clipboard.writeText(words); btn.textContent = 'copied'; }
  catch (_) { ta.select(); btn.textContent = 'select and copy below'; }
  setTimeout(() => { btn.textContent = label; }, 2500);
}

function save(blob, name) {
  const url = root.URL.createObjectURL(blob);
  const a = root.document.createElement('a');
  a.href = url; a.download = name;
  root.document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => root.URL.revokeObjectURL(url), 30000);
}

async function downloadAll(panel, list, btn) {
  const SCd = SC();
  const label = btn.textContent;
  btn.disabled = true;
  try {
    const files = [];
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
      btn.textContent = 'drawing ' + (i + 1) + ' of ' + list.length + '…';
      const it = list[i];
      let name = String(i + 1).padStart(2, '0') + '-' + SCd.filename(it.model, panel.size);
      while (seen.has(name)) name = name.replace(/\.png$/, '-b.png');
      seen.add(name);
      const blob = await SCd.png(it.model, { size: panel.size, scale: 1, modules: clockOf(panel) });
      files.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
      files.push({ name: name.replace(/\.png$/, '.txt'), bytes: new TextEncoder().encode(SCd.caption(it.model, clockOf(panel)) + '\n') });
    }
    const L = panel.data.league;
    const day = new Date().toISOString().slice(0, 10);
    const kind = panel.type === 'all' ? 'socials' : panel.type;
    save(new Blob([SCd.zip(files)], { type: 'application/zip' }), SCd.slug(L.slug || L.name) + '-' + kind + '-' + panel.size + '-' + day + '.zip');
    btn.textContent = label;
  } catch (e) {
    btn.textContent = 'could not make the ZIP';
    setTimeout(() => { btn.textContent = label; }, 4000);
  }
  btn.disabled = false;
}

/* --------------------------------------------------------- the builder ---- */
function drawBuilder(panel, pane) {
  const SCd = SC();
  const b = panel.builder, d = viewOf(panel), M = b.mods;
  if (panel.lines) d.lines = panel.lines;
  if (b.compId && !d.comps.some(c => c.id === b.compId)) b.compId = '';
  const persist = () => saveBuilder(panel.leagueId, b);
  const mods = () => Object.assign({}, clockOf(panel), modulesOf(b));      // the options and the clock chosen above
  const wrap = el('div', 'gx-build');
  const form = el('div', 'gx-form');
  const prev = el('div', 'gx-prev');
  wrap.append(form, prev);
  pane.appendChild(wrap);

  let res = null, seq = 0, timer = null;
  const bounds = () => GX().monthBounds(new Date(), b.monthOff || 0, clockOf(panel).zone || SCd.leagueZone(d.league));
  const season = typeof panel.o.season === 'function' ? panel.o.season() : null;
  /* the subject and the site's own columns the graphic asks for (the lines are read when something needs them) */
  /* a day: the game day picked (the newest the league has when none is, or the one picked is not a day of this competition), and its own read */
  const days = () => daysOf(panel);
  const dayKey = () => { const l = days(); return b.day && l.some(x => x.day === b.day) ? b.day : (l[0] && l[0].day) || ''; };
  const dayData = () => (panel.dayCache && dayKey() ? panel.dayCache.get(dayKeyOf(panel, dayKey())) : null) || null;
  const selOf = () => Object.assign({}, b, { dayKey: b.tpl === 'day' ? dayKey() : '', dayData: b.tpl === 'day' ? dayData() : null, lines: d.lines, need: needKeys(b), opts: CATOPTS, bounds: bounds(), by: b.tpl === 'monthstars' ? ({ pts: 'pts', stat: 'stat', pick: 'pick' }[b.by] || 'bpm') : byOf(b.by),
    stat: M.rankStat, minGames: +M.minGames || 0, keys: b.tpl === 'leaders' ? (M.leadCats || (M.leadSubject === 'teams' ? TEAM_LEAD_DEFAULT : LEAD_CAT_DEFAULT)) : (catOf(M.monthKeys).length ? catOf(M.monthKeys) : MONTH_DEFAULT), scope: M.leadScope, order: M.tableOrder || '', subject: M.leadSubject,
    rows: +M.rows || 0, seasonName: season ? season.name : 'Season' });
  const compute = () => { res = GX().builderModel(d, selOf(), panel.size, crestOf); return res; };
  compute();

  const setRes = () => { compute(); paint(); };
  /* every control is tagged with the templates it belongs to; the others are hidden, not removed */
  const put = (host, keys, node) => { node.dataset.has = keys; host.appendChild(node); return node; };
  const show = () => form.querySelectorAll('[data-has]').forEach(n => { n.hidden = !HAS[b.tpl].includes(n.dataset.has); });
  const text = (key, label, max, ph) => {
    const i = el('input', 'ep-input'); i.type = 'text'; i.maxLength = max; i.value = M[key] || ''; i.placeholder = ph || '';
    i.addEventListener('input', () => { M[key] = i.value; persist(); schedule(); });
    return field(label, i);
  };
  const tick = (key, label) => {
    const l = el('label', 'sw'); const i = el('input'); i.type = 'checkbox'; i.checked = M[key] !== false;
    i.addEventListener('change', () => { M[key] = i.checked; persist(); schedule(); });
    l.append(i, el('span', null, label));
    return l;
  };
  const schedule = () => { root.clearTimeout(timer); timer = root.setTimeout(setRes, 90); };
  /* a change of template, game or competition rebuilds the form (its choices differ); the control keeps focus */
  const drawBuilder2 = focus => { pane.textContent = ''; drawBuilder(panel, pane); const f = focus && pane.querySelector('#' + focus); if (f) f.focus(); };

  /* --- 1. what it is about --- */
  const fs1 = el('fieldset', 'gx-fs'); fs1.appendChild(el('legend', null, 'What it is about'));
  const tp = select(TEMPLATES.map(t => [t.id, t.label]), b.tpl, v => { b.tpl = v; b.page = 0; persist(); drawBuilder2('gxTpl'); });
  tp.id = 'gxTpl';
  fs1.appendChild(field('Template', tp));
  const games = d.finals.slice().reverse();
  const tname = id => (d.teams.get(id) || {}).name || '?';
  const gsel = select(games.map(g => [g.id, gameLabel(g, tname, d.league.timezone)]), (res && res.game && res.game.id) || '',
    v => { b.gameId = v; b.player = null; persist(); drawBuilder2('gxGame'); });
  gsel.id = 'gxGame';
  put(fs1, 'game', field('Game', gsel));
  if (!games.length) gsel.disabled = true;
  /* the game day: every day the league played on (the competition on screen's), newest first, each with its games counted */
  const dayList = days();
  const dsel = select(dayList.map(x => [x.day, GX().dayKeyLabel(x.day) + ' · ' + x.n + (x.n === 1 ? ' game' : ' games')]), dayKey(),
    v => { b.day = v; b.page = 0; drawBuilder2('gxDay'); });
  dsel.id = 'gxDay';
  put(fs1, 'day', field('Game day', dsel));
  if (!dayList.length) dsel.disabled = true;
  const players = (res && res.players) || [];
  const night = players.length ? SCd.gameBPMs(players) : new Map();            // the game's BPM, which the list is in the order of
  const psel = select([['', 'Player of the game']].concat(players.map((p, i) => [String(i), ((p.stats.adv && p.stats.adv.name) || 'Player') + ' · ' + p.stats.pts + ' pts' +
    (night.has(p) ? ' · ' + SCd.bpmText(night.get(p)) + ' BPM' : '') + ' · ' + Math.round((p.stats.min || 0) / 60000) + ' min'])),
    b.player == null ? '' : String(b.player), v => { b.player = v === '' ? null : +v; persist(); setRes(); });
  put(fs1, 'player', field('Player', psel));
  if (d.comps.length > 1) {
    const cs = select(d.comps.map(c => [c.id, c.name]), (res && res.comp && res.comp.id) || (d.comps[0] || {}).id, v => { b.compId = v; b.page = 0; persist(); drawBuilder2('gxComp'); });
    cs.id = 'gxComp';
    put(fs1, 'comp', field('Competition', cs));
  }
  const pg = select(Array.from({ length: Math.max(1, (res && res.pages) || 1) }, (_, i) => [String(i), 'Page ' + (i + 1) + ' of ' + Math.max(1, res.pages || 1)]), b.page || 0,
    v => { b.page = +v; setRes(); });
  const pgf = put(fs1, 'page', field('Page', pg));
  if (!res || !(res.pages > 1)) pgf.classList.add('gx-off');
  form.appendChild(fs1);

  /* --- 2. words --- */
  const fs2 = el('fieldset', 'gx-fs'); fs2.appendChild(el('legend', null, 'Words'));
  put(fs2, 'headline', text('headline', 'Headline', 60, 'the template\'s own'));
  put(fs2, 'subline', text('subline', 'Subline', 100, 'the template\'s own'));
  form.appendChild(fs2);

  /* --- 3. parts --- */
  const fs3 = el('fieldset', 'gx-fs'); fs3.appendChild(el('legend', null, 'Parts'));
  const ticks = el('div', 'gx-ticks');
  put(ticks, 'crests', tick('crests', 'Club crests'));
  put(ticks, 'quarters', tick('quarters', 'Quarter scores'));
  put(ticks, 'leaders', tick('leaders', 'Each side\'s leader'));
  put(ticks, 'venue', tick('venue', 'Venue'));
  put(ticks, 'days', tick('days', 'Day of each game'));
  put(ticks, 'venues', tick('venues', 'Venue of each game'));
  fs3.appendChild(ticks);
  /* STARS OF THE WEEK: how they are picked, the layout, and (for "my pick") which players, up to five, in the order ticked */
  put(fs3, 'starsby', field('Choose the stars by', select(STAR_BY, byOf(b.by), v => { b.by = v; persist(); drawBuilder2('gxBy'); })));
  fs3.querySelector('[data-has="starsby"] select').id = 'gxBy';
  if (b.by === 'pick') {
    const pk = el('div', 'gx-checks'); pk.appendChild(el('span', 'gx-cl', 'Your five, in the order ticked'));
    ((res && res.pool) || []).forEach(p => {
      const l = el('label', 'sw'); const i = el('input'); i.type = 'checkbox'; i.checked = b.picks.includes(p.key);
      i.addEventListener('change', () => {
        if (i.checked && b.picks.length >= 5) { i.checked = false; return; }
        b.picks = i.checked ? b.picks.concat([p.key]) : b.picks.filter(k => k !== p.key); setRes();
      });
      l.append(i, el('span', null, p.name + ' · ' + p.team + ' · ' + p.pts + ' pts' + (p.bpm != null ? ' · ' + SCd.bpmText(p.bpm) + ' BPM' : '')));
      pk.appendChild(l);
    });
    put(fs3, 'starsby', pk);
  }
  put(fs3, 'discs', field('Circles', select([['', 'Follow the setting above'], ['player', 'Player circles'], ['team', 'Team crests']], M.discs || '', v => { M.discs = v; persist(); setRes(); })));
  put(fs3, 'layout', field('Layout', select(STAR_LAYOUT, M.layout || '', v => { M.layout = v; persist(); setRes(); })));
  put(fs3, 'rows', field('How many rows', select(ROWS, M.rows || '', v => { M.rows = v; persist(); setRes(); })));
  /* A GROUP OF TICKS (what a results row or a fixture says besides its clubs): tick the ones wanted */
  const checks = (has, title, order, labelOf, current, set, min, max, hint) => {
    const box = el('div', 'gx-checks');
    box.appendChild(el('span', 'gx-cl', title));
    const inputs = {};
    order.forEach(k => {
      const l = el('label', 'sw'); const i = el('input'); i.type = 'checkbox'; i.checked = current().includes(k); inputs[k] = i;
      if (hint && hint[k]) l.title = hint[k];
      i.addEventListener('change', () => {
        const next = toggleKey(current(), k, order, min, max);
        set(next); order.forEach(x => { inputs[x].checked = next.includes(x); }); persist(); schedule();
      });
      l.append(i, el('span', null, labelOf(k)));
      box.appendChild(l);
    });
    return put(fs3, has, box);
  };
  /* THE STATS A GRAPHIC SHOWS, IN ITS ORDER (statpicker.js): the chosen as chips to drag, move or remove, one search box to add
     from the graphic's own stats and every column of the site's (statcat.js), the limits said, a reset. The preview redraws at once. */
  const X = root.EpinoiaStatCat, SP = root.EpinoiaStatPicker;
  const siteItems = kind => {
    if (!X || !X.catalogue) return [];
    let list = X.catalogue(kind, CATOPTS);
    if (d.lines) { const r = X.rowsOf(d.lines, null); list = X.available(list, kind === 'team' ? r.teams : r.players); }
    return list.map(c => { const info = X.explain(c); return { id: c.id, label: c.label, title: (info ? info.title : c.title) + (X.isLow(c) ? ' (lower is better)' : ''), group: c.group, groupLabel: c.groupLabel }; });
  };
  const ownItems = (order, labelOf, titleOf) => order.map(k => ({ id: k, label: labelOf(k), title: titleOf ? titleOf(k) : '', group: 'own', groupLabel: 'This graphic\'s own' }));
  const picker = (has, title, items, current, set, def, min, max) => {
    if (!SP) return null;
    const node = SP.create({ title, items, current, set: v => { set(v); persist(); setRes(); }, def, min, max });
    return put(fs3, has, node);
  };
  const STAR_OWN = night => ownItems(night ? STAT_ORDER : STAT_ORDER.filter(k => !NIGHT_ONLY.includes(k)), k => SCd.STAT_DEFS[k][1], k => SCd.STAT_DEFS[k][0].toLowerCase());
  /* THE STAR'S, THE WEEK'S AND THE MONTH'S STAT LINES: 3 to 8, each template its own list (a month's are the site's only:
     its stars are worked over the month, not a night) */
  if (b.tpl === 'star') picker('stats', 'Stat lines, in order (' + MIN_STATS + '–' + MAX_STAR + '; the first three are the big numbers)', STAR_OWN(true).concat(siteItems('player')),
    () => M.statKeys || STAT_DEFAULT, v => { M.statKeys = v; }, STAT_DEFAULT, MIN_STATS, MAX_STAR);
  if (b.tpl === 'weekstars') picker('stats', 'Stat lines, in order (' + MIN_STATS + '–' + MAX_STATS + '; the first three are the star\'s big numbers)', STAR_OWN().concat(siteItems('player')),
    () => M.weekKeys || WEEK_DEFAULT, v => { M.weekKeys = v; }, WEEK_DEFAULT, MIN_STATS, MAX_STATS);
  if (b.tpl === 'monthstars') picker('stats', 'Stat lines, in order (the site\'s, per game over the month; ' + MIN_STATS + '–' + MAX_STATS + ')', siteItems('player'),
    () => catOf(M.monthKeys).length ? catOf(M.monthKeys) : MONTH_DEFAULT, v => { M.monthKeys = v; }, MONTH_DEFAULT, MIN_STATS, MAX_STATS);
  /* THE TABLE'S COLUMNS: what the standings hold, some worked out from them, ELO, form and home / away read from the games, and the
     site's club columns; 1 to 6, in the order chosen. WIN% is in the default, as the table is ordered by it */
  picker('cols', 'Table columns, in order (1–' + MAX_COLS + ')', ownItems(COL_ORDER, k => SCd.COL_DEFS[k], k => COL_HINT[k] || '').concat(siteItems('team')),
    () => M.cols || COL_DEFAULT, v => { M.cols = v; }, COL_DEFAULT, 1, MAX_COLS);
  put(fs3, 'cols', field('Order the table by', select(TABLE_ORDER, M.tableOrder || '', v => { M.tableOrder = v; persist(); setRes(); })));
  /* A FINAL'S TEAM STATS, side by side (none unless chosen), and the leaders' lines */
  picker('teamstats', 'Team stats, in order (up to ' + MAX_TEAM + ', none by default)', ownItems(TEAM_ORDER, k => SCd.TEAM_STAT_DEFS[k][0]).concat(siteItems('team')),
    () => M.teamStats || [], v => { M.teamStats = v; }, [], 0, MAX_TEAM);
  put(fs3, 'leadstats', field('Top scorers per side', select([['', 'The leader of each side'], ['2', 'Top 2 scorers'], ['3', 'Top 3 scorers']], M.leaderN || '', v => { M.leaderN = v; persist(); setRes(); })));
  picker('leadstats', 'Stats beside each leader, in order (1–' + MAX_LEAD + ')', ownItems(LEAD_ORDER, k => SCd.STAT_DEFS[k][1], k => SCd.STAT_DEFS[k][0].toLowerCase()).concat(siteItems('player')),
    () => M.leaderKeys || LEAD_DEFAULT, v => { M.leaderKeys = v; }, LEAD_DEFAULT, 1, MAX_LEAD);
  /* A DAY'S LEADERS: the stat lines beside each side's leader (the leader is the night's best BPM, 18 minutes or more), the graphic's own only */
  picker('dayleadstats', 'Stats beside each leader, in order (1–' + MAX_LEAD + ')', ownItems(LEAD_ORDER, k => SCd.STAT_DEFS[k][1], k => SCd.STAT_DEFS[k][0].toLowerCase()),
    () => (M.leaderKeys || LEAD_DEFAULT).filter(k => !/^c:/.test(k)), v => { M.leaderKeys = v; }, LEAD_DEFAULT, 1, MAX_LEAD);
  /* WHAT A ROW SAYS BESIDES ITS CLUBS AND SCORE */
  checks('dayextras', 'Also on each game', DAY_EXTRAS.map(x => x[0]), k => DAY_EXTRAS.find(x => x[0] === k)[1], () => M.dayExtras, v => { M.dayExtras = v; }, 0, DAY_EXTRAS.length);
  checks('weekextras', 'Also on each result', WEEK_EXTRAS.map(x => x[0]), k => WEEK_EXTRAS.find(x => x[0] === k)[1], () => M.weekExtras, v => { M.weekExtras = v; }, 0, WEEK_EXTRAS.length);
  checks('fixextras', 'Also on each fixture', FIX_EXTRAS.map(x => x[0]), k => FIX_EXTRAS.find(x => x[0] === k)[1], () => M.fixExtras, v => { M.fixExtras = v; }, 0, FIX_EXTRAS.length);
  /* THE MONTH: which one, how its stars are ranked, and how many games a player needs */
  const months = Array.from({ length: 13 }, (_, i) => [String(-i), GX().monthBounds(new Date(), -i, clockOf(panel).zone || SCd.leagueZone(d.league)).label]);
  put(fs3, 'monthpick', field('Month', select(months, String(b.monthOff || 0), v => { b.monthOff = +v; setRes(); })));
  put(fs3, 'monthby', field('Rank the stars by', select(MONTH_BY, b.by === 'pts' || b.by === 'stat' || b.by === 'pick' ? b.by : 'bpm', v => { b.by = v; persist(); drawBuilder2('gxMonthBy'); })));
  fs3.querySelector('[data-has="monthby"] select').id = 'gxMonthBy';
  if (b.tpl === 'monthstars' && b.by === 'stat' && X) {
    const rs = el('select', 'ep-input'); rs.id = 'gxRankStat';
    X.grouped(X.catalogue('player', CATOPTS)).forEach(g => { const og = el('optgroup'); og.label = g.label; g.cols.forEach(c => { const o = el('option', null, c.title.length > 34 ? c.label : c.title + (X.isLow(c) ? ' (lower is better)' : '')); o.value = c.id; og.appendChild(o); }); rs.appendChild(og); });
    rs.value = M.rankStat; rs.addEventListener('change', () => { M.rankStat = rs.value; persist(); setRes(); });
    put(fs3, 'monthby', field('The stat', rs));
  }
  if (b.tpl === 'monthstars' && b.by === 'pick') {
    const pk = el('div', 'gx-checks'); pk.appendChild(el('span', 'gx-cl', 'Your five, in the order ticked'));
    ((res && res.pool) || []).forEach(p => {
      const l = el('label', 'sw'); const i = el('input'); i.type = 'checkbox'; i.checked = b.picks.includes(p.key);
      i.addEventListener('change', () => { if (i.checked && b.picks.length >= 5) { i.checked = false; return; } b.picks = i.checked ? b.picks.concat([p.key]) : b.picks.filter(k => k !== p.key); setRes(); });
      l.append(i, el('span', null, p.name + ' · ' + p.team)); pk.appendChild(l);
    });
    put(fs3, 'monthby', pk);
  }
  put(fs3, 'mingames', field('Games needed to qualify', select(MIN_GAMES, M.minGames || '', v => { M.minGames = v; persist(); setRes(); })));
  /* THE LEADERS: scope, players or clubs, and the categories (any of the site's columns, up to six) */
  put(fs3, 'leadscope', field('Over', select(LEAD_SCOPES, M.leadScope, v => { M.leadScope = v; persist(); setRes(); })));
  put(fs3, 'leadsubject', field('Leaders among', select([['players', 'Players'], ['teams', 'Clubs']], M.leadSubject, v => { M.leadSubject = v; M.leadCats = null; persist(); drawBuilder2('gxLeadSubj'); })));
  fs3.querySelector('[data-has="leadsubject"] select').id = 'gxLeadSubj';
  const leadDef = M.leadSubject === 'teams' ? TEAM_LEAD_DEFAULT : LEAD_CAT_DEFAULT;
  picker('leadcats', 'Categories, in order (1–' + MAX_LEAD_CATS + '; one is a top ten, several a panel)', siteItems(M.leadSubject === 'teams' ? 'team' : 'player'),
    () => M.leadCats || leadDef, v => { M.leadCats = v; }, leadDef, 1, MAX_LEAD_CATS);
  form.appendChild(fs3);

  /* --- 4. look --- */
  const fs4 = el('fieldset', 'gx-fs'); fs4.appendChild(el('legend', null, 'Look'));
  fs4.appendChild(field('Colours', select(THEMES, M.theme, v => { M.theme = v; persist(); setRes(); })));
  fs4.appendChild(field('Accent', select(ACCENTS, M.accent, v => { M.accent = v; persist(); setRes(); })));
  fs4.appendChild(field('Name the time zone', select([['', 'Only when it is not the league\'s own'], ['always', 'Always'], ['never', 'Never']], M.zoneLabel || '', v => { M.zoneLabel = v; persist(); setRes(); })));
  fs4.appendChild(field('League logo', select(LOGOS, M.logoPos, v => { M.logoPos = v; persist(); setRes(); })));
  form.appendChild(fs4);

  /* --- 5. footer --- */
  const fs5 = el('fieldset', 'gx-fs'); fs5.appendChild(el('legend', null, 'Footer'));
  fs5.appendChild(tick('handle', 'Instagram handle (or league name)'));
  fs5.appendChild(text('footerText', 'Footer text instead', 60, 'e.g. @yourleague · yourleague.com'));
  fs5.appendChild(text('sponsor', 'Partner line', 80, 'e.g. Presented by Acme Sports'));
  form.appendChild(fs5);

  const reset = el('button', 'ep-btn mini', 'reset to the defaults'); reset.type = 'button';
  reset.addEventListener('click', () => { const keep = b.tpl; Object.assign(b, defaultBuilder(), { tpl: keep }); persist(); drawBuilder2('gxTpl'); });
  form.appendChild(reset);
  show();

  /* --- the preview --- */
  const stage = el('div', 'gx-stage');
  stage.style.aspectRatio = SCd.SIZES[panel.size].w + ' / ' + SCd.SIZES[panel.size].h;
  const status = el('div', 'gx-status');
  status.setAttribute('role', 'status');
  prev.append(stage, status);
  const { acts, dl, cp } = actions(() => res.model, () => ({ size: panel.size, scale: 1, modules: mods() }));
  prev.appendChild(acts);
  const ta = el('textarea', 'ep-input gx-cap'); ta.readOnly = true; ta.rows = 6; ta.setAttribute('aria-label', 'Caption');
  prev.appendChild(ta);
  cp.addEventListener('click', () => copy(ta.value, ta, cp));

  async function paint() {
    const mine = ++seq;
    show();
    /* the season's lines, when the graphic needs the site's own numbers, the month or the leaders */
    if (needsLines(b) && !d.lines) {
      status.textContent = 'Reading the season\'s games for the site\'s own numbers…';
      try { d.lines = await ensureLines(panel); } catch (e) { status.textContent = 'Could not read the season\'s games: ' + (e && e.message || e); return; }
      if (mine !== seq) return;
      compute();
      if (b.tpl === 'monthstars' || b.tpl === 'leaders') { drawBuilder2(); return; }        // the pickers list only what these games have numbers for
    }
    /* a day: the league's game days first (the picker lists only the days it played on), then the day picked, read on its own */
    if (b.tpl === 'day') {
      if (!panel.daysRaw) {
        status.textContent = 'Reading the game days…';
        try { await ensureDays(panel); } catch (e) { status.textContent = 'Could not read the game days: ' + (e && e.message || e); return; }
        if (mine !== seq) return;
        drawBuilder2(); return;
      }
      const key = dayKey();
      if (key && !dayData()) {
        status.textContent = 'Reading that game day…';
        try { await ensureDay(panel, key); } catch (e) { status.textContent = 'Could not read that game day: ' + (e && e.message || e); return; }
        if (mine !== seq) return;
        compute();
      }
    }
    /* ELO, form and the home / away records are read from the games the first time a graphic asks for them */
    if (needsExtras(b) && !d.extras) {
      status.textContent = 'Reading ratings and form from the games…';
      try { panel.extras = panel.extras || await GX().readExtras(panel.o.sb, panel.data.comps); }
      catch (e) { status.textContent = 'Could not read the games for ELO and form: ' + (e && e.message || e); return; }
      panel.data.extras = panel.extras; d.extras = panel.extras;
      if (mine !== seq) return;
      compute();
    }
    if (!res.model) {
      stage.textContent = '';
      status.textContent = res.reason || 'Nothing to draw.';
      ta.value = ''; dl.disabled = true; cp.disabled = true;
      return;
    }
    dl.disabled = false; cp.disabled = false;
    status.textContent = '';
    ta.value = SCd.caption(res.model, mods());
    try {
      const c = await SCd.canvas(res.model, { size: panel.size, scale: 0.5, modules: mods() });
      if (mine !== seq) return;                          // a newer change has already redrawn it
      c.className = 'gx-canvas'; c.setAttribute('role', 'img');
      c.setAttribute('aria-label', 'Preview of the graphic');
      stage.textContent = ''; stage.appendChild(c);
      if (c.dropped && c.dropped.length) status.textContent = 'Not enough room in this shape, so it leaves out ' + c.dropped.join(', ') + '. Try a taller shape, fewer rows, or fewer parts.';
    } catch (e) {
      if (mine === seq) status.textContent = 'The preview could not be drawn: ' + (e && e.message || e);
    }
  }
  paint();
}

return { mount, refresh, TABLE_ORDER, WEEK_DEFAULT, loadDiscs, saveDiscs, discsKey, needKeys, needsLines, CATOPTS, LEAD_CAT_DEFAULT, MONTH_DEFAULT, TZ_MODES, zoneFor, loadTz, saveTz, tzKey, deviceZone, TEMPLATES, HAS, STAT_ORDER, STAT_DEFAULT, COL_ORDER, COL_DEFAULT, COL_READ, TEAM_ORDER, LEAD_ORDER, defaultBuilder, modulesOf, needsExtras, toggleKey, gameLabel,
         loadBuilder, saveBuilder, memKey };
}));
