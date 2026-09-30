'use strict';
/* ============================================================================
   GRAPHICS FOR SOCIALS — every finished game and every week, drawn for Instagram without anybody drawing it.

   A league's socials are the same five posts, over and over: the final score, the player of the game, the
   week's results, the table and what is coming up. Each is built here from the league's own data the moment
   there is something to show (the console's panel, admin/socialgfx-ui.js, lists them), in the three shapes
   Instagram takes:

     square    1080 x 1080   the feed's old shape, still the grid's
     portrait  1080 x 1350   the feed's tallest (4:5), the one that takes the most of a phone
     story     1080 x 1920   a story or a reel's cover; nothing is drawn where Instagram lays its own bar and
                             reply box over the picture (the top 250 and the bottom 330)

   Every template is a stack of blocks (heading, body, footer) with fixed heights and the space left shared
   between them, so the one design fills all three shapes. The house style is reportcard.js's (its util: the
   same faces, colours and measuring rules), in the league's own colour.

     models                   result / performer / week / table / fixtures, from rows the console has read
     draw(ctx, model, opts)   one graphic onto a 2D context (pure layout: the tests drive it)
     png(model, opts)         -> Blob image/png at 1080 wide
     caption(model)           the words to post it with: what happened, who, and the league's tags
     zip(files)               several graphics as one download (stored, not compressed: a PNG already is)

   MODULES (opts.modules, or model.modules): the optional pieces of a graphic, for the console's builder. Every
   one defaults to today's exact output - a graphic drawn with no modules is byte-for-byte the one drawn before
   they existed - and each is one thing a person can turn on, off or reword: headline, subline, crests,
   quarters, leaders (leaderN, leaderKeys), teamStats, zone / zoneLabel (the clock every day and time is read in), venue, days, venues, rowExtras, rows, cols (the table's
   stats, ELO among them), statKeys (the star's), theme, accent, logoPos, handle, footerText, sponsor. See
   cleanModules() for the shapes. The block-stack below is unchanged (fixed heights, the room left
   shared), so every combination stays on the page in all three shapes.

   NOTHING IS POSTED FROM HERE. The graphics are ready for a person to check and post; putting them on the
   league's account for it needs Instagram's publishing permission, which a reading token (the Socials
   panel's) does not carry.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSocialCard = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const SIZES = {
  square:   { w: 1080, h: 1080, top: 64, bottom: 64, label: 'square 1:1' },
  portrait: { w: 1080, h: 1350, top: 72, bottom: 72, label: 'portrait 4:5' },
  story:    { w: 1080, h: 1920, top: 250, bottom: 330, label: 'story 9:16' }
};

/* a third colourway beside the kit's two: white on black with a yellow edge, for a post that has to read at a glance */
const EXTRA_THEMES = {
  contrast: {
    ground: '#000000', panel: '#121212', panel2: '#1c1c1c', ink: '#ffffff', ink2: '#ffffff', ink3: 'rgba(255,255,255,.86)',
    rule: 'rgba(255,255,255,.4)', rule2: 'rgba(255,255,255,.7)', lume: '#ffe600', good: '#4dff91', bad: '#ff6b6b', mid: '#ffe600',
    style: 'rgba(255,255,255,.6)', track: 'rgba(255,255,255,.14)', fringe: false
  }
};
const THEME_KEYS = ['dark', 'light', 'contrast'];
const STAT_DEFS = {   // key: [big label, small label]
  pts: ['POINTS', 'PTS'], reb: ['REBOUNDS', 'REB'], ast: ['ASSISTS', 'AST'], stl: ['STEALS', 'STL'], blk: ['BLOCKS', 'BLK'],
  fg: ['FIELD GOALS', 'FG'], p3: ['THREES', '3PT'], ft: ['FREE THROWS', 'FT'], fgp: ['FG%', 'FG%'], p3p: ['3P%', '3P%'],
  pm: ['PLUS/MINUS', '+/-'], min: ['MINUTES', 'MIN'], oreb: ['OFF. REBOUNDS', 'OREB'], dreb: ['DEF. REBOUNDS', 'DREB'],
  tov: ['TURNOVERS', 'TOV'], pf: ['FOULS', 'PF'], p2: ['TWO-POINTERS', '2PT'], efg: ['EFG%', 'EFG%'], gmsc: ['GAME SCORE', 'GMSC']
};
/* the league table's columns: those the standings hold, some worked out from them, and the ones read from the games
   (form, home and away records, the ELO rating: the console reads them when they are asked for) */
const COL_DEFS = { gp: 'GP', w: 'W', l: 'L', pct: 'PCT', pts: 'PTS', diff: 'DIFF', avg: 'AVG', pf: 'PF', pa: 'PA', ppg: 'PPG', papg: 'OPP',
                   streak: 'STK', l5: 'L5', home: 'HOME', away: 'AWAY', elo: 'ELO' };
/* a final's team stats, side by side (worked from the players' lines): [label, lower is better] */
const TEAM_STAT_DEFS = { fgp: ['FG%'], p3p: ['3P%'], ftp: ['FT%'], efg: ['EFG%'], fg: ['FG'], p3: ['3PT'], ft: ['FT'], reb: ['REBOUNDS'], oreb: ['OFF. REB'],
                         ast: ['ASSISTS'], stl: ['STEALS'], blk: ['BLOCKS'], tov: ['TURNOVERS', true], pf: ['FOULS', true] };
/* what a results row (and a fixture's) can say besides its clubs and score */
const ROW_EXTRAS = ['time', 'venue', 'quarters', 'record', 'elo'];
const LOGO_POS = ['both', 'heading', 'footer', 'none'];
const LAYOUTS = ['list', 'hero', 'five'];
const BOOL_MODS = ['crests', 'quarters', 'leaders', 'venue', 'days', 'venues', 'handle'];

/* THE SITE'S OWN STATS, by their catalogue key ("c:ppg", "c:ts_pct": admin/statcat.js). This file knows nothing of the catalogue:
   a model that offers such a key carries its text where the built-in keys' text is (a player's `stats['c:ppg']`, a table row's
   `row['c:ppg']`, a side's `teamStats.home['c:ppg']`), and its label and direction in `model.cat` = { 'c:ppg': { l: 'PPG', low } }. */
const catKey = k => typeof k === 'string' && /^c:[A-Za-z0-9_]{1,40}$/.test(k);
let CAT = {};
const sl = (k, long) => (STAT_DEFS[k] ? STAT_DEFS[k][long ? 0 : 1] : String((CAT[k] && CAT[k].l) || String(k).slice(2)).toUpperCase());
const tl = k => (TEAM_STAT_DEFS[k] ? TEAM_STAT_DEFS[k][0] : String((CAT[k] && CAT[k].l) || String(k).slice(2)).toUpperCase());
const tlow = k => (TEAM_STAT_DEFS[k] ? !!TEAM_STAT_DEFS[k][1] : !!(CAT[k] && CAT[k].low));
const cl = k => (COL_DEFS[k] || String((CAT[k] && CAT[k].l) || String(k).slice(2)).toUpperCase());

/* The modules as the drawing reads them: only what is known, in range, and not the default's own words. Anything
   else is dropped, so a stale saved setting or a hand-built object can never break a graphic. */
function cleanModules(m) {
  const o = {};
  if (!m || typeof m !== 'object') return o;
  const text = (k, max) => { const v = typeof m[k] === 'string' ? m[k].replace(/\s+/g, ' ').trim().slice(0, max) : ''; if (v) o[k] = v; };
  text('headline', 60); text('subline', 100); text('footerText', 60); text('sponsor', 80);
  BOOL_MODS.forEach(k => { if (m[k] === false) o[k] = false; });
  if (THEME_KEYS.includes(m.theme)) o.theme = m.theme;
  if (/^#[0-9a-f]{6}$/i.test(m.accent || '')) o.accent = m.accent;
  if (LOGO_POS.includes(m.logoPos) && m.logoPos !== 'both') o.logoPos = m.logoPos;
  if (LAYOUTS.includes(m.layout) && m.layout !== 'list') o.layout = m.layout;
  const zone = validZone(m.zone);
  if (zone) o.zone = zone;
  if (m.zoneLabel === 'always' || m.zoneLabel === 'never') o.zoneLabel = m.zoneLabel;
  const rows = parseInt(m.rows, 10);
  if (rows > 0) o.rows = Math.min(rows, 40);
  if (Array.isArray(m.cols)) { const c = Object.keys(COL_DEFS).filter(k => m.cols.includes(k)).concat([...new Set(m.cols.filter(catKey))]).slice(0, 6); if (c.length) o.cols = c; }   // six: a phone reads no more
  const list = (k, defs, min, max) => {
    if (!Array.isArray(m[k])) return;
    const v = [...new Set(m[k].filter(x => (Array.isArray(defs) ? defs.includes(x) : defs[x] || catKey(x))))].slice(0, max);
    if (v.length >= min) o[k] = v;
  };
  list('teamStats', TEAM_STAT_DEFS, 1, 6); list('leaderKeys', STAT_DEFS, 1, 4); list('rowExtras', ROW_EXTRAS, 1, 5);
  const ln = parseInt(m.leaderN, 10);
  if (ln > 1) o.leaderN = Math.min(ln, 3);
  if (Array.isArray(m.statKeys)) {
    const k = [...new Set(m.statKeys.filter(x => STAT_DEFS[x] || catKey(x)))].slice(0, 8);
    if (k.length >= 3) o.statKeys = k;
  }
  return o;
}
/* the modules of the graphic being drawn; draw() sets them, and every helper below reads them */
let MOD = {};
let ZNOTE = null;                 // the zone to name on the graphic being drawn, or null (see zoneNote)
const on = k => MOD[k] !== false;

const U = () => root.EpinoiaReportCard && root.EpinoiaReportCard.util;
const TH = () => root.EpinoiaReportCard && root.EpinoiaReportCard.THEMES;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ------------------------------------------------------------ the clock --- */
/* a moment as the league reads it: its own time zone (leagues.timezone), never the browser's */
function local(iso, tz) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'UTC', year: 'numeric', month: 'numeric', day: 'numeric',
      weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const v = k => (parts.find(p => p.type === k) || {}).value;
    return { y: +v('year'), mo: +v('month') - 1, d: +v('day'), wd: DAYS.indexOf(v('weekday')), hh: v('hour'), mm: v('minute') };
  } catch (_) {
    return local(iso, 'UTC');
  }
}
/* A ZONE THE BROWSER KNOWS, or null. Every time on a graphic is shown in one: the league's own (its row's timezone, or
   failing that its country's main one), the reader's device's, or UTC - see the `zone` module. */
const zoneOk = {};
function validZone(z) {
  if (typeof z !== 'string' || !z) return null;
  if (!(z in zoneOk)) {
    try { new Intl.DateTimeFormat('en-GB', { timeZone: z }); zoneOk[z] = true; } catch (_) { zoneOk[z] = false; }
  }
  return zoneOk[z] ? z : null;
}
/* the main zone of a country, for a league row that names its country but not its zone (a country with several is
   given its capital's or its league's usual one: a league that plays elsewhere sets its own timezone, and that wins) */
const COUNTRY_ZONE = { GB: 'Europe/London', UK: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris', DE: 'Europe/Berlin', ES: 'Europe/Madrid', IT: 'Europe/Rome',
  PT: 'Europe/Lisbon', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels', CH: 'Europe/Zurich', AT: 'Europe/Vienna', PL: 'Europe/Warsaw', CZ: 'Europe/Prague', SK: 'Europe/Bratislava',
  HU: 'Europe/Budapest', RO: 'Europe/Bucharest', BG: 'Europe/Sofia', GR: 'Europe/Athens', TR: 'Europe/Istanbul', SE: 'Europe/Stockholm', NO: 'Europe/Oslo', DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki', LT: 'Europe/Vilnius', LV: 'Europe/Riga', EE: 'Europe/Tallinn', RS: 'Europe/Belgrade', HR: 'Europe/Zagreb', SI: 'Europe/Ljubljana', BA: 'Europe/Sarajevo',
  ME: 'Europe/Podgorica', MK: 'Europe/Skopje', UA: 'Europe/Kyiv', IL: 'Asia/Jerusalem', AU: 'Australia/Sydney', NZ: 'Pacific/Auckland', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
  CN: 'Asia/Shanghai', TW: 'Asia/Taipei', PH: 'Asia/Manila', ID: 'Asia/Jakarta', TH: 'Asia/Bangkok', IN: 'Asia/Kolkata', AE: 'Asia/Dubai', SA: 'Asia/Riyadh', QA: 'Asia/Qatar',
  EG: 'Africa/Cairo', ZA: 'Africa/Johannesburg', NG: 'Africa/Lagos', US: 'America/New_York', CA: 'America/Toronto', MX: 'America/Mexico_City', AR: 'America/Argentina/Buenos_Aires',
  BR: 'America/Sao_Paulo', CL: 'America/Santiago', CO: 'America/Bogota', PR: 'America/Puerto_Rico' };
/* the league's own zone: its timezone, else its country's, else UTC */
function leagueZone(league) {
  const l = league || {};
  return validZone(l.timezone) || validZone(COUNTRY_ZONE[String(l.country || '').toUpperCase()]) || 'UTC';
}
/* "AEST", "CEST", "GMT" where the zone has a name, and always its offset from UTC ("UTC+10", "UTC+5:30", "UTC"), at this
   instant (a zone changes its offset with the clock going forward and back) */
function zoneName(iso, zone) {
  const d = new Date(iso), z = validZone(zone) || 'UTC';
  if (isNaN(d)) return { abbr: '', offset: '', text: '' };
  const loc = /^Australia\//.test(z) ? 'en-AU' : z === 'Pacific/Auckland' ? 'en-NZ' : /^America\//.test(z) ? 'en-US' : 'en-GB';
  const part = (l, style) => { try { return (new Intl.DateTimeFormat(l, { timeZone: z, timeZoneName: style }).formatToParts(d).find(p => p.type === 'timeZoneName') || {}).value || ''; } catch (_) { return ''; } };
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part('en-GB', 'longOffset'));
  const zero = !m || (!+m[2] && (!m[3] || m[3] === '00'));
  const offset = zero ? 'UTC' : 'UTC' + m[1] + (+m[2]) + (m[3] && m[3] !== '00' ? ':' + m[3] : '');
  const short = part(loc, 'short');
  const abbr = /^[A-Z]{2,5}$/.test(short) ? short : '';
  return { abbr, offset, text: offset === 'UTC' ? abbr || 'UTC' : abbr ? abbr + ' (' + offset + ')' : offset };
}
const dayLabel = t => (t ? DAYS[t.wd] + ' ' + t.d + ' ' + MONTHS[t.mo] : '');
const dateLabel = t => (t ? DAYS[t.wd] + ' ' + t.d + ' ' + MONTHS[t.mo] + ' ' + t.y : '');
const timeLabel = t => (t ? t.hh + ':' + t.mm : '');

/* ---------------------------------------------------------- the numbers --- */
const n0 = v => (v == null || isNaN(v) ? 0 : +v);
/* Hollinger's game score: one number for a night's work, the same the box score's leaders read */
function gameScore(s) {
  const fgm = n0(s.p2m) + n0(s.p3m), fga = n0(s.p2a) + n0(s.p3a);
  return n0(s.pts) + 0.4 * fgm - 0.7 * fga - 0.4 * (n0(s.fta) - n0(s.ftm)) + 0.7 * n0(s.or) + 0.3 * n0(s.dr) +
    n0(s.stl) + 0.7 * n0(s.ast) + 0.7 * n0(s.blk) - 0.4 * n0(s.pf) - n0(s.to);
}
/* "24 PTS · 8 REB · 5 AST": the counting stats worth saying, biggest first, points always */
function statLine(s, max) {
  const reb = n0(s.or) + n0(s.dr);
  const bits = [[n0(s.pts), 'PTS', true], [reb, 'REB'], [n0(s.ast), 'AST'], [n0(s.stl), 'STL'], [n0(s.blk), 'BLK']]
    .filter(b => b[2] || b[0] >= 3);
  return bits.slice(0, max || 3).map(b => b[0] + ' ' + b[1]).join(' · ');
}
const made = (m, a) => n0(m) + '/' + n0(a);
const pct = (m, a) => (n0(a) > 0 ? Math.round(100 * n0(m) / n0(a)) + '%' : '—');
/* one player line as the graphics say it: every number a stat line can name, counting stats as numbers and shooting as text */
function statsOf(s) {
  const fgm = n0(s.p2m) + n0(s.p3m), fga = n0(s.p2a) + n0(s.p3a);
  return { pts: n0(s.pts), reb: n0(s.or) + n0(s.dr), ast: n0(s.ast), stl: n0(s.stl), blk: n0(s.blk),
           fg: made(fgm, fga), p3: made(s.p3m, s.p3a), ft: made(s.ftm, s.fta), fgp: pct(fgm, fga), p3p: pct(s.p3m, s.p3a),
           pm: n0(s.pm), min: Math.round(n0(s.min) / 60000), oreb: n0(s.or), dreb: n0(s.dr), tov: n0(s.to), pf: n0(s.pf),
           p2: made(s.p2m, s.p2a), efg: fga > 0 ? Math.round(100 * (fgm + 0.5 * n0(s.p3m)) / fga) + '%' : '—',
           gmsc: String(Math.round(gameScore(s) * 10) / 10) };
}
/* a side's totals for the game, summed from its players' lines: { key: { v: 'what is said', n: what is compared } } */
function sideTotals(players, idx) {
  const rows = (players || []).filter(p => p.team_idx === idx && p.stats);
  if (!rows.length) return null;
  const t = { pts: 0, p2m: 0, p2a: 0, p3m: 0, p3a: 0, ftm: 0, fta: 0, or: 0, dr: 0, ast: 0, stl: 0, blk: 0, to: 0, pf: 0 };
  rows.forEach(p => Object.keys(t).forEach(k => { t[k] += n0(p.stats[k]); }));
  const fgm = t.p2m + t.p3m, fga = t.p2a + t.p3a;
  const rate = (m, a) => (a > 0 ? Math.round(1000 * m / a) / 10 : null);
  const put = (n, v) => ({ n, v: v != null ? v : String(n) });
  const pc = (m, a) => { const r = rate(m, a); return put(r == null ? -1 : r, r == null ? '—' : Math.round(r) + '%'); };
  return { fgp: pc(fgm, fga), p3p: pc(t.p3m, t.p3a), ftp: pc(t.ftm, t.fta), efg: pc(fgm + 0.5 * t.p3m, fga),
           fg: put(fgm, made(fgm, fga)), p3: put(t.p3m, made(t.p3m, t.p3a)), ft: put(t.ftm, made(t.ftm, t.fta)),
           reb: put(t.or + t.dr), oreb: put(t.or), ast: put(t.ast), stl: put(t.stl), blk: put(t.blk), tov: put(t.to), pf: put(t.pf) };
}

/* ------------------------------------------------------------- models ------ */
/* every model carries the league's name, colour and handle, and a `key` that names the file */
function side(team, score, perQ) {
  const t = team || {};
  return { name: t.name || '?', short: t.short_name || '', colour: t.colour || null, colour2: t.colour_2 || null,
           crestUrl: t.crestUrl || null, score: n0(score), perQ: perQ || null,
           record: t.record || '', elo: t.elo != null && !isNaN(t.elo) ? Math.round(t.elo) : null };
}

/* THE FINAL SCORE. `players` are player_game_stats rows ({ team_idx, stats }); the leading player of each side
   by game score, and the period scores from team_game_stats' perQ when both sides have them. */
function result(o) {
  const g = o.game || {};
  const home = side(o.home, g.home_score, o.perQ && o.perQ[0]), away = side(o.away, g.away_score, o.perQ && o.perQ[1]);
  const lead = idx => {
    const rows = (o.players || []).filter(p => p.team_idx === idx && p.stats);
    if (!rows.length) return null;
    const best = rows.slice().sort((a, b) => gameScore(b.stats) - gameScore(a.stats))[0];
    return { name: best.stats.adv && best.stats.adv.name || best.name || '', line: statLine(best.stats, 3), stats: statsOf(best.stats) };
  };
  /* each side's three top scorers, for a final that names more than one */
  const scorers = idx => (o.players || []).filter(p => p.team_idx === idx && p.stats)
    .sort((a, b) => n0(b.stats.pts) - n0(a.stats.pts) || gameScore(b.stats) - gameScore(a.stats)).slice(0, 3)
    .map(p => ({ name: p.stats.adv && p.stats.adv.name || p.name || '', stats: statsOf(p.stats) }));
  const ts = { home: sideTotals(o.players, 0), away: sideTotals(o.players, 1) };
  const periods = [];
  if (home.perQ && away.perQ) {
    const keys = [...new Set(Object.keys(home.perQ).concat(Object.keys(away.perQ)))].map(Number).filter(k => k > 0).sort((a, b) => a - b);
    keys.forEach(k => periods.push({ label: k <= 4 ? 'Q' + k : (k === 5 ? 'OT' : 'OT' + (k - 4)), home: n0(home.perQ[k]), away: n0(away.perQ[k]) }));
  }
  const tz = leagueZone(o.league), t = local(g.tipoff_at, tz);
  return {
    iso: g.tipoff_at || '', tz, kind: 'result', key: 'final-' + slug(home.name) + '-' + slug(away.name), league: o.league || {}, comp: o.comp || '',
    date: dateLabel(t), venue: g.venue || '', home, away, periods: periods.length >= 4 ? periods : [],
    top: { home: lead(0), away: lead(1) }, scorers: { home: scorers(0), away: scorers(1) },
    teamStats: ts.home && ts.away ? ts : null, gameId: g.id || null
  };
}

/* THE PLAYER OF THE GAME: the best game score on the winning side (a draw: either side). */
function performer(o) {
  const g = o.game || {};
  const hs = n0(g.home_score), as = n0(g.away_score);
  const win = hs === as ? null : (hs > as ? 0 : 1);
  const rows = (o.players || []).filter(p => p.stats && (win == null || p.team_idx === win));
  /* `o.pick` names one player line (the console's builder: any player of the game, not only its best) */
  const picked = o.pick && (o.players || []).includes(o.pick) && o.pick.stats ? o.pick : null;
  if (!rows.length && !picked) return null;
  const best = picked || rows.slice().sort((a, b) => gameScore(b.stats) - gameScore(a.stats))[0];
  const s = best.stats, adv = s.adv || {};
  const mine = best.team_idx === 0 ? o.home : o.away, theirs = best.team_idx === 0 ? o.away : o.home;
  const my = best.team_idx === 0 ? hs : as, their = best.team_idx === 0 ? as : hs;
  const tz = leagueZone(o.league), t = local(g.tipoff_at, tz);
  const name = adv.name || best.name || '';
  return {
    iso: g.tipoff_at || '', tz,
    kind: 'performer', key: (o.label ? slug(o.label) : 'player-of-the-game') + '-' + slug(name), label: o.label || '', league: o.league || {}, comp: o.comp || '', date: dateLabel(t),
    player: { name, num: adv.num != null ? String(adv.num) : '' },
    team: side(mine, my), opp: side(theirs, their), won: my > their,
    stats: statsOf(s),
    gameScore: Math.round(gameScore(s) * 10) / 10, gameId: g.id || null
  };
}

/* the pages a long list is cut into, each a graphic of its own ("1/3"), as even as they can be: eighteen clubs
   on a shape that holds sixteen are two pages of nine, never sixteen and two */
function pages(rows, per) {
  if (!rows.length) return [[]];
  const count = Math.ceil(rows.length / per), size = Math.ceil(rows.length / count);
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
/* how many rows each shape can hold, by template */
const PER = { week: { square: 7, portrait: 9, story: 10 }, table: { square: 12, portrait: 18, story: 20 },
              fixtures: { square: 5, portrait: 7, story: 9 } };

/* a game's quarters as a line: "18-15 22-29 23-23 16-25" (nothing unless both sides have all four) */
function quartersOf(perQ) {
  if (!perQ || !perQ[0] || !perQ[1]) return '';
  const keys = [...new Set(Object.keys(perQ[0]).concat(Object.keys(perQ[1])))].map(Number).filter(k => k > 0).sort((a, b) => a - b);
  return keys.length >= 4 ? keys.map(k => n0(perQ[0][k]) + '-' + n0(perQ[1][k])).join('  ') : '';
}

/* THE WEEK'S RESULTS: every final in the window, oldest first; `games` rows carry home / away teams already. */
function week(o, size) {
  const tz = leagueZone(o.league);
  const rows = (o.games || []).slice().sort((a, b) => String(a.tipoff_at).localeCompare(String(b.tipoff_at))).map(g => ({
    iso: g.tipoff_at || '', home: side(g.home, g.home_score), away: side(g.away, g.away_score), day: dayLabel(local(g.tipoff_at, tz)),
    time: timeLabel(local(g.tipoff_at, tz)), venue: g.venue || '', quarters: quartersOf(g.perQ)
  }));
  const pp = pages(rows, PER.week[size] || 8);
  return pp.map((p, i) => ({ kind: 'week', key: 'results' + (pp.length > 1 ? '-' + (i + 1) : ''), league: o.league || {},
    comp: o.comp || '', range: o.range || '', rows: p, page: i + 1, pages: pp.length, tz }));
}

/* THE STARS OF THE WEEK: the week's best performances, ranked. `o.entries` are one per player line of the week:
   { key, stats (a player_game_stats stats blob, with adv.name / adv.num), team, opp (club rows), teamScore, oppScore, gameId }.
   `by` is how they are ranked: 'gs' game score (efficiency, the default), 'pts' points, or 'pick' - `o.picks`, a list of
   entry keys, in the order the person gave them. A player who played twice is his best game only. Ties go to the higher
   game score, then more points, then the name, so the same week always ranks the same way. Five at most. */
const STAR_BY = ['gs', 'pts', 'pick', 'score'];
function weekstars(o) {
  const by = STAR_BY.includes(o.by) ? o.by : 'gs';
  /* the month's stars come with a `score` of their own (any catalogue stat, `low` if lower is better) and `out`, the stats to
     show, already worked out (per game over the month); `sub` is the line under the name in place of the game */
  const metric = e => (by === 'score' ? n0(e.score) * (o.low ? -1 : 1) : by === 'pts' ? n0(e.stats.pts) : gameScore(e.stats));
  const nameOf = e => (e.stats.adv && e.stats.adv.name) || e.name || '';
  const cmp = (a, b) => metric(b) - metric(a) || gameScore(b.stats) - gameScore(a.stats) || n0(b.stats.pts) - n0(a.stats.pts) || nameOf(a).localeCompare(nameOf(b));
  const best = new Map();
  (o.entries || []).filter(e => e && e.stats).forEach(e => {
    const k = nameOf(e) + '|' + (e.team && e.team.name);
    if (!best.has(k) || cmp(e, best.get(k)) < 0) best.set(k, e);
  });
  let list = [...best.values()];
  if (by === 'pick') {
    const at = new Map((o.picks || []).map((k, i) => [k, i]));
    list = list.filter(e => at.has(e.key)).sort((a, b) => at.get(a.key) - at.get(b.key));
  } else list.sort(cmp);
  const rows = list.slice(0, 5).map((e, i) => ({
    rank: i + 1, name: nameOf(e), num: e.stats.adv && e.stats.adv.num != null ? String(e.stats.adv.num) : '', sub: e.sub || '',
    team: side(e.team, e.teamScore), opp: side(e.opp, e.oppScore), won: n0(e.teamScore) > n0(e.oppScore),
    stats: e.out || statsOf(e.stats), gameScore: Math.round(gameScore(e.stats) * 10) / 10, gameId: e.gameId || null, key: e.key || ''
  }));
  const month = o.period === 'month';
  return { kind: 'weekstars', period: month ? 'month' : 'week', key: month ? 'stars-of-the-month' : 'stars-of-the-week', league: o.league || {}, comp: o.comp || '', range: o.range || '',
           rows, by, cat: o.cat || null, tz: leagueZone(o.league) };
}

/* THE TABLE: standings rows in rank order, one set of graphics per group */
function table(o, size) {
  const groups = new Map();
  (o.standings || []).slice().sort((a, b) => n0(a.rank) - n0(b.rank)).forEach(r => {
    const k = r.group_name || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ rank: n0(r.rank), team: side(r.team, 0), gp: n0(r.gp), w: n0(r.w), l: n0(r.l),
                         pts: r.league_points != null ? n0(r.league_points) : null, diff: n0(r.diff), streak: r.streak || '',
                         pf: r.pts_for != null ? n0(r.pts_for) : null, pa: r.pts_against != null ? n0(r.pts_against) : null,
                         pct: n0(r.w) + n0(r.l) > 0 ? n0(r.w) / (n0(r.w) + n0(r.l)) : null,
                         ppg: r.pts_for != null && n0(r.gp) > 0 ? n0(r.pts_for) / n0(r.gp) : null,
                         papg: r.pts_against != null && n0(r.gp) > 0 ? n0(r.pts_against) / n0(r.gp) : null,
                         avg: n0(r.gp) > 0 ? n0(r.diff) / n0(r.gp) : null,
                         l5: r.l5 || '', home: r.home || '', away: r.away || '', elo: r.elo != null && !isNaN(r.elo) ? Math.round(r.elo) : null });
  });
  const out = [];
  groups.forEach((rows, group) => {
    const pp = pages(rows, PER.table[size] || 14);
    pp.forEach((p, i) => out.push({ kind: 'table', key: 'table' + (group ? '-' + slug(group) : '') + (pp.length > 1 ? '-' + (i + 1) : ''),
      league: o.league || {}, comp: o.comp || '', group, asOf: o.asOf || '', rows: p, page: i + 1, pages: pp.length,
      showPts: rows.some(r => r.pts != null && r.pts !== 2 * r.w + r.l && r.pts !== 2 * r.w) || !!o.showPts }));
  });
  return out;
}

/* COMING UP: the next week's games by the league's own day, with the tip-off in the league's own time */
function fixtures(o, size) {
  const tz = leagueZone(o.league);
  const rows = (o.games || []).slice().sort((a, b) => String(a.tipoff_at).localeCompare(String(b.tipoff_at))).map(g => {
    const t = local(g.tipoff_at, tz);
    return { iso: g.tipoff_at || '', day: dayLabel(t), time: timeLabel(t), home: side(g.home, 0), away: side(g.away, 0), venue: g.venue || '' };
  });
  const pp = pages(rows, PER.fixtures[size] || 8);
  return pp.map((p, i) => ({ kind: 'fixtures', key: 'coming-up' + (pp.length > 1 ? '-' + (i + 1) : ''), league: o.league || {},
    comp: o.comp || '', range: o.range || '', rows: p, page: i + 1, pages: pp.length, tz }));
}

/* THE CLOCK OF A GRAPHIC: every day and time a model shows is worked from its instants (`iso`) in one zone - the `zone`
   module's, else the league's own - so a game late on a Saturday in UTC is early on the Sunday in Sydney, on the day
   label as well as the time. With no `zone` this returns the model as it was made. */
function zoneOfModel(m, mods) { return validZone(mods && mods.zone) || m.tz || 'UTC'; }
function relabel(m, mods) {
  const z = zoneOfModel(m, mods);
  if (z === (m.tz || 'UTC')) return m;
  const at = iso => local(iso, z);
  if (m.kind === 'result' || m.kind === 'performer') return m.iso ? Object.assign({}, m, { date: dateLabel(at(m.iso)) }) : m;
  if (m.kind === 'week') return Object.assign({}, m, { rows: m.rows.map(r => (r.iso ? Object.assign({}, r, { day: dayLabel(at(r.iso)), time: timeLabel(at(r.iso)) }) : r)) });
  if (m.kind === 'fixtures') return Object.assign({}, m, { rows: m.rows.map(r => (r.iso ? Object.assign({}, r, { day: dayLabel(at(r.iso)), time: timeLabel(at(r.iso)) }) : r)) });
  return m;
}
/* the zone to name on the graphic, or '': by default only when it is not the league's own (which the reader assumes);
   `zoneLabel` 'always' or 'never' overrides. Where the rows straddle a clock change, both names ("CET/CEST"). */
function zoneNote(m, mods) {
  const label = mods && mods.zoneLabel;
  const z = zoneOfModel(m, mods);
  if (label === 'never' || !(m.iso || (m.rows && m.rows.some(r => r.iso)))) return null;
  if (label !== 'always' && z === (m.tz || 'UTC')) return null;
  const isos = m.rows ? m.rows.map(r => r.iso).filter(Boolean) : [m.iso];
  const names = [...new Set(isos.map(i => zoneName(i, z)))].filter(Boolean);
  const texts = [...new Set(names.map(n => n.text))];
  const abbrs = [...new Set(names.map(n => n.abbr || n.offset))];
  return { zone: z, text: texts.length === 1 ? texts[0] : abbrs.join('/'), short: abbrs.join('/') };
}

/* the rows a list graphic shows: all of them, or the first `rows` when the module says so */
function rowsOf(m, mods) {
  if (!m || !m.rows || !mods || !(mods.rows > 0) || mods.rows >= m.rows.length) return m;
  return Object.assign({}, m, { rows: m.rows.slice(0, mods.rows) });
}

const MOD_CAPTION_KEYS = mods => (mods && mods.statKeys ? mods.statKeys.slice(0, 4) : ['pts', 'reb', 'ast']);
/* THE LEADERS BOARD: `boards` = [{ key, label, low, rows: [{ rank, tie, name, team (a club row), value (the text) }] }] - the site's
   league leaders in the categories chosen, players or clubs. `title` is what the caption and the graphic call it ("Season leaders"). */
function leaders(o) {
  const boards = (o.boards || []).filter(b => b && b.rows && b.rows.length).map(b => ({ key: b.key, label: b.label || b.key, low: !!b.low,
    rows: b.rows.map(r => ({ rank: n0(r.rank), tie: !!r.tie, name: r.name || '?', team: side(r.team, 0), value: String(r.value == null ? '—' : r.value), sub: r.sub || '' })) }));
  return { kind: 'leaders', key: 'leaders-' + slug(o.title || 'leaders'), league: o.league || {}, comp: o.comp || '', range: o.range || '', title: o.title || 'Leaders',
           subject: o.subject === 'teams' ? 'teams' : 'players', boards, cat: o.cat || null, tz: leagueZone(o.league) };
}
/* ------------------------------------------------------------ captions ----- */
function tags(league) {
  const t = String(league && league.name || '').replace(/[^\p{L}\p{N}]+/gu, '');
  return (t ? '#' + t + ' ' : '') + '#basketball';
}
function caption(m0, mods0) {
  if (!m0) return '';
  const mods = cleanModules(Object.assign({}, m0.modules, mods0));
  const zn = zoneNote(m0, mods);
  const m = relabel(rowsOf(m0, mods), mods);
  CAT = m0.cat || {};
  const L = m.league || {};
  if (m.kind === 'result') {
    const w = m.home.score >= m.away.score ? m.home : m.away, l = w === m.home ? m.away : m.home;
    const lines = ['FINAL | ' + m.home.name + ' ' + m.home.score + '–' + m.away.score + ' ' + m.away.name];
    const tops = [[m.home, m.top.home], [m.away, m.top.away]].filter(x => x[1] && x[1].name)
      .map(x => x[1].name + ' (' + x[0].name + '): ' + x[1].line.replace(/ · /g, ', ').toLowerCase());
    if (tops.length) lines.push('', tops.join('\n'));
    if (m.home.score !== m.away.score && m.home.score + m.away.score > 0) {
      lines.push('', w.name + ' beat ' + l.name + ' by ' + (w.score - l.score) + (m.venue ? ' at ' + m.venue : '') + '.');
    }
    return lines.concat(['', tags(L)]).join('\n');
  }
  if (m.kind === 'performer') {
    const s = m.stats;
    return [(m.label || 'Player of the game') + ': ' + m.player.name + ' (' + m.team.name + ')', '',
      s.pts + ' points, ' + s.reb + ' rebounds, ' + s.ast + ' assists on ' + s.fg + ' shooting' +
      (s.pm ? ', ' + (s.pm > 0 ? '+' : '') + s.pm + ' on the floor' : '') + ', in ' + (m.won ? 'the ' + m.team.score + '–' + m.opp.score + ' win over '
        : 'the ' + m.team.score + '–' + m.opp.score + ' game against ') + m.opp.name + '.', '', tags(L)].join('\n');
  }
  if (m.kind === 'leaders') {
    const per = mods.rows > 0 ? mods.rows : (m.boards.length === 1 ? 10 : m.boards.length > 3 ? 3 : 5);
    return [m.title + (m.comp ? ' in the ' + m.comp : '') + ':', '', m.boards.map(b => b.label + '\n' + b.rows.slice(0, per).map(r => (r.tie ? 'T-' : '') + r.rank + '. ' + r.name + (m.subject === 'teams' ? '' : ' (' + r.team.name + ')') + ' ' + r.value).join('\n')).join('\n\n'),
      '', tags(L)].join('\n');
  }
  if (m.kind === 'weekstars') {
    const keys = MOD_CAPTION_KEYS(mods);
    const said = r => keys.map(k => r.stats[k] + ' ' + sl(k).toLowerCase()).join(', ');
    return ['Stars of the ' + (m.period === 'month' ? 'month' : 'week') + (m.comp ? ' in the ' + m.comp : '') + (m.range && m.period === 'month' ? ' (' + m.range + ')' : '') + ':', '',
      m.rows.map(r => r.rank + '. ' + r.name + ' (' + r.team.name + '): ' + said(r) + (r.sub ? ' - ' + r.sub : ' vs ' + r.opp.name + ' (' + (r.won ? 'W' : r.team.score === r.opp.score ? 'D' : 'L') + ' ' + r.team.score + '–' + r.opp.score + ')')).join('\n'),
      '', tags(L)].join('\n');
  }
  if (m.kind === 'week') {
    return ['The week\'s results' + (m.comp ? ' in the ' + m.comp : '') + (m.pages > 1 ? ' (' + m.page + '/' + m.pages + ')' : ''), '',
      m.rows.map(r => r.home.name + ' ' + r.home.score + '–' + r.away.score + ' ' + r.away.name).join('\n'), '', tags(L)].join('\n');
  }
  if (m.kind === 'table') {
    return [(m.group ? m.group + ': the table' : 'The table') + (m.asOf ? ' after ' + m.asOf : '') + (m.pages > 1 ? ' (' + m.page + '/' + m.pages + ')' : ''), '',
      m.rows.map(r => r.rank + '. ' + r.team.name + ' ' + r.w + '-' + r.l).join('\n'), '', tags(L)].join('\n');
  }
  if (m.kind === 'fixtures') {
    return ['Coming up' + (m.comp ? ' in the ' + m.comp : '') + (m.pages > 1 ? ' (' + m.page + '/' + m.pages + ')' : '') + (zn ? ' (times in ' + zn.text + ')' : ''), '',
      m.rows.map(r => r.day + ' ' + r.time + (zn ? ' ' + (zoneName(r.iso, zn.zone).abbr || zoneName(r.iso, zn.zone).offset) : '') + ' · ' + r.home.name + ' v ' + r.away.name).join('\n'), '', tags(L)].join('\n');
  }
  return '';
}

/* ---------------------------------------------------------------- drawing --- */
const slug = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';

/* A CREST in a disc of the club's colour, or its initials on the colour when there is no crest to draw */
function crest(ctx, th, team, cx, cy, r) {
  const u = U();
  const col = u.rgb(team.colour) ? team.colour : th.lume;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
  const pic = on('crests') ? team.crest : null;
  ctx.fillStyle = pic ? u.crestGround(pic, th) : col;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.05); ctx.strokeStyle = u.accentOn(col, th); ctx.stroke();
  if (pic && pic.width) {
    const iw = pic.naturalWidth || pic.width, ih = pic.naturalHeight || pic.height;
    const s = Math.min(1.36 * r / iw, 1.36 * r / ih);
    ctx.drawImage(pic, cx - iw * s / 2, cy - ih * s / 2, iw * s, ih * s);
  } else {
    u.font(ctx, r * 0.8, u.F.score);
    ctx.textAlign = 'center';
    ctx.fillStyle = u.lum(col) > 0.4 ? '#04100b' : '#ffffff';
    const mono = team.short && team.short.length <= 3 ? team.short.toUpperCase() : u.initials(team.name);
    ctx.fillText(mono, cx, cy + r * 0.28);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

/* THE GROUND IN THE COLOURS OF WHOEVER IT IS ABOUT: glows of the league's two colours from opposite corners,
   or on a final each club's from its own side; the edge is the league's (split with its second colour) */
function ground(ctx, th, W, H, glows, edge, edge2) {
  const u = U();
  ctx.fillStyle = th.ground;
  ctx.fillRect(0, 0, W, H);
  glows.filter(g => u.rgb(g.colour)).forEach(g => {
    const x = W * g.x, y = H * g.y, r = Math.max(W, H) * (g.r || 0.8);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, u.rgba(g.colour, (th.fringe ? 0.24 : 0.11) * (g.a || 1)));
    glow.addColorStop(1, u.rgba(g.colour, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
  });
  ctx.fillStyle = u.accentOn(edge, th);
  ctx.fillRect(0, 0, 10, H);
  if (u.rgb(edge2)) {
    ctx.fillStyle = u.accentOn(edge2, th);
    ctx.fillRect(0, H * 0.62, 10, H * 0.38);
  }
}

/* A LOGO (the league's, beside the tag and in the footer) in a box `h` high, its own proportions kept */
function logo(ctx, img, x, y, h, maxW) {
  if (!img || !img.width) return 0;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(h / ih, (maxW || h * 3) / iw);
  ctx.drawImage(img, x, y + (h - ih * s) / 2, iw * s, ih * s);
  return iw * s;
}

/* a club's colour as a stripe down the end of its row: the team's colour on every line it is named on */
function stripe(ctx, th, colour, x, y, h, w) {
  const u = U();
  if (!u.rgb(colour)) return;
  ctx.fillStyle = u.accentOn(colour, th);
  ctx.fillRect(x, y, w || 6, h);
}

/* the heading every graphic opens with: a tag in the league's colour, what it is, and when */
function heading(ctx, th, M, W, y, tag, what, when, accent, leagueLogo) {
  const u = U();
  const lw = logo(ctx, leagueLogo, M, y - 6, 52, 150);
  const x0 = M + (lw ? lw + 16 : 0);
  u.font(ctx, 22, u.F.micro);
  const tw = ctx.measureText(tag).width + 28;
  ctx.fillStyle = accent;
  u.roundRect(ctx, x0, y, tw, 40, 6); ctx.fill();
  ctx.fillStyle = contrastInk(accent, th);
  ctx.fillText(tag, x0 + 14, y + 28);
  u.font(ctx, 22, u.F.micro);
  ctx.fillStyle = th.ink2;
  const right = String(when || '').toUpperCase();
  ctx.textAlign = 'right';
  ctx.fillText(right, W - M, y + 28);
  const rw = ctx.measureText(right).width;
  ctx.textAlign = 'left';
  u.font(ctx, 22, u.F.micro);
  ctx.fillStyle = th.ink3;
  ctx.fillText(u.ellipsis(ctx, String(what || '').toUpperCase(), W - 2 * M - (x0 - M) - tw - rw - 44), x0 + tw + 16, y + 28);
  return 40;
}
/* the first colour that stands off this ground at 2:1 as it is (before accentOn lifts it), or null */
function visible(cands, th) {
  const u = U(), g = u.rgb(th.ground);
  return cands.find(c => u.rgb(c) && u.contrast(u.rgb(c), g) >= 2) || null;
}

/* dark or light ink for text on a coloured tag, whichever reads better */
function contrastInk(css, th) {
  const u = U();
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(css);
  const c = m ? [+m[1], +m[2], +m[3]] : (u.rgb(css) || [147, 242, 191]);
  return u.contrast(c, [4, 16, 11]) >= u.contrast(c, [255, 255, 255]) ? '#04100b' : '#ffffff';
}

function footer(ctx, th, M, W, y, league) {
  const custom = MOD.footerText || '';
  const u = U();
  ctx.fillStyle = th.rule;
  ctx.fillRect(M, y, W - 2 * M, 2);
  u.font(ctx, 34, u.F.mark);
  ctx.fillStyle = th.ink;
  ctx.fillText('EPINOIΛ', M, y + 54);
  const handle = !on('handle') ? '' : league && league.handle ? '@' + String(league.handle).replace(/^@/, '') : '';
  u.font(ctx, 22, u.F.micro);
  ctx.fillStyle = th.ink3;
  ctx.textAlign = 'right';
  const said = custom || (on('handle') ? (handle || String(league && league.name || '')) : '');
  const words = u.ellipsis(ctx, said.toUpperCase(), W - 2 * M - 330);
  ctx.fillText(words, W - M, y + 50);
  ctx.textAlign = 'left';
  if (league && league.logo && (MOD.logoPos === 'footer' || !MOD.logoPos)) logo(ctx, league.logo, W - M - ctx.measureText(words).width - 16 - 44, y + 20, 44, 44);
  return 70;
}

/* THE STACK. Blocks of fixed height, the space left shared out between them (a gap never more than `maxGap`),
   so one template fills a square, a portrait and a story alike. */
function stack(blocks, top, bottom, maxGap) {
  const need = blocks.reduce((a, b) => a + b.h, 0);
  const gap = Math.min(maxGap || 80, Math.max(12, (bottom - top - need) / (blocks.length + 1)));
  let y = top + Math.max(0, (bottom - top - need - gap * (blocks.length - 1)) / 2);
  const at = [];
  blocks.forEach(b => { at.push(y); y += b.h + gap; });
  return at;
}

/* ----------------------------------------------------------- templates ----- */
function drawResult(ctx, m, th, S, M, accent) {
  const u = U(), W = S.w;
  const tall = S.h >= 1300;
  const r = tall ? 122 : 104;
  const hasTop = on('leaders') && m.top && (m.top.home || m.top.away);
  const hw = m.home.score > m.away.score, aw = m.away.score > m.home.score;
  /* A STORY IS READ DOWNWARDS: each club a row of its own, crest, name and score, the winner's lit */
  const stacked = S.h >= 1900 && {
    h: 2 * 190 + 24, draw: y => {
      [[m.home, hw || !aw, 0], [m.away, aw || !hw, 1]].forEach(([t, won, i]) => {
        const ry = y + i * (190 + 24);
        ctx.fillStyle = th.panel;
        u.roundRect(ctx, M, ry, W - 2 * M, 190, 18); ctx.fill();
        stripe(ctx, th, t.colour || accent, M, ry + 24, 142, won ? 10 : 6);
        crest(ctx, th, t, M + 40 + 70, ry + 95, 70);
        const size = u.fit(ctx, String(t.score), 260, 170, 100, u.F.score);
        ctx.textAlign = 'right';
        u.display(ctx, th, String(t.score), W - M - 34, ry + 95 + size * 0.36, won ? th.ink : th.ink3, won ? 2 : 0);
        const sw = ctx.measureText(String(t.score)).width;
        ctx.textAlign = 'left';
        const nb = u.nameBlock(ctx, t.name.toUpperCase(), W - 2 * M - 220 - sw - 60, 54, 34, u.F.score);
        ctx.fillStyle = won ? th.ink : th.ink2;
        const h0 = ry + 95 - (nb.lines.length - 1) * nb.size * 0.46 + nb.size * 0.3;
        nb.lines.forEach((l, k) => ctx.fillText(l, M + 200, h0 + k * nb.size * 0.92));
      });
    }
  };
  const blocks = [stacked || {
    h: 2 * r + 120, draw: y => {
      const cxL = M + r + 10, cxR = W - M - r - 10, cy = y + r;
      crest(ctx, th, m.home, cxL, cy, r);
      crest(ctx, th, m.away, cxR, cy, r);
      [[m.home, cxL], [m.away, cxR]].forEach(([t, cx]) => {
        const nb = u.nameBlock(ctx, t.name.toUpperCase(), 2 * r + 60, 40, 26, u.F.score);
        ctx.textAlign = 'center';
        ctx.fillStyle = th.ink;
        nb.lines.forEach((l, i) => ctx.fillText(l, cx, cy + r + 50 + i * nb.size * 0.95));
        ctx.textAlign = 'left';
        stripe(ctx, th, t.colour, cx - 40, cy + r + 50 + (nb.lines.length - 1) * nb.size * 0.95 + 16, 6, 80);
      });
      /* the score between the crests: the winner's in full ink, the other's quieter */
      const mid = W / 2, gapW = cxR - cxL - 2 * r - 50;
      const size = u.fit(ctx, m.home.score + '  ' + m.away.score, gapW, tall ? 190 : 160, 80, u.F.score);
      ctx.textAlign = 'right';
      ctx.fillStyle = hw || !aw ? th.ink : th.ink3;
      u.display(ctx, th, String(m.home.score), mid - 22, cy + size * 0.36, hw || !aw ? th.ink : th.ink3, hw ? 2 : 0);
      ctx.textAlign = 'left';
      u.display(ctx, th, String(m.away.score), mid + 22, cy + size * 0.36, aw || !hw ? th.ink : th.ink3, aw ? 2 : 0);
      ctx.fillStyle = accent;
      ctx.fillRect(mid - 9, cy - 3, 18, 6);
    } }];
  if (m.periods.length && on('quarters')) {
    blocks.push({ h: 150, drop: 1, name: 'the quarter scores', draw: y => {
      const cols = m.periods.length + 1;
      const x0 = M + 200, cw = (W - 2 * M - 200) / cols;
      ctx.fillStyle = th.panel;
      u.roundRect(ctx, M, y, W - 2 * M, 150, 14); ctx.fill();
      u.font(ctx, 20, u.F.micro);
      ctx.fillStyle = th.ink3;
      ctx.textAlign = 'center';
      m.periods.concat([{ label: 'T' }]).forEach((p, i) => ctx.fillText(p.label, x0 + cw * (i + 0.5), y + 38));
      [[m.home, 'home', 84], [m.away, 'away', 128]].forEach(([t, k, ty]) => {
        ctx.textAlign = 'left';
        u.font(ctx, 26, u.F.ui, 700);
        ctx.fillStyle = th.ink;
        ctx.fillText(u.ellipsis(ctx, t.short && t.short.length <= 4 ? t.short.toUpperCase() : t.name, 170), M + 22, y + ty);
        ctx.textAlign = 'center';
        u.font(ctx, 28, u.F.data, 500);
        m.periods.forEach((p, i) => {
          const mine = p[k], theirs = p[k === 'home' ? 'away' : 'home'];
          ctx.fillStyle = mine > theirs ? th.ink : th.ink3;
          ctx.fillText(String(mine), x0 + cw * (i + 0.5), y + ty);
        });
        u.font(ctx, 30, u.F.data, 700);
        ctx.fillStyle = t.score >= (k === 'home' ? m.away.score : m.home.score) ? accent : th.ink2;
        ctx.fillText(String(t.score), x0 + cw * (cols - 0.5), y + ty);
      });
      ctx.textAlign = 'left';
    } });
  }
  const lk = MOD.leaderKeys, ln = MOD.leaderN || 1;
  const said = (st, keys) => keys.map(k => st[k] + ' ' + sl(k)).join(' · ');
  if (hasTop && ln > 1 && m.scorers) {
    /* the top scorers, two or three a side, each with the stat lines chosen (points, rebounds, assists unless said) */
    blocks.push({ h: 40 + ln * 44, drop: 2, name: 'each side\'s top scorers', draw: y => {
      const colW = (W - 2 * M - 24) / 2, keys = lk || ['pts', 'reb', 'ast'];
      [[m.scorers.home, M, m.home], [m.scorers.away, M + colW + 24, m.away]].forEach(([list, x, team]) => {
        ctx.fillStyle = u.accentOn(team.colour, th);
        ctx.fillRect(x, y + 6, 5, 40 + ln * 44 - 12);
        u.font(ctx, 18, u.F.micro);
        ctx.fillStyle = th.ink3;
        ctx.fillText('TOP SCORERS', x + 20, y + 26);
        (list || []).slice(0, ln).forEach((p, i) => {
          const by = y + 40 + i * 44 + 30;
          u.font(ctx, 20, u.F.data, 500);
          const line = u.ellipsis(ctx, said(p.stats, keys), Math.min(colW - 24 - 130, (colW - 24) * 0.62));
          const lw = ctx.measureText(line).width;
          ctx.fillStyle = th.ink2;
          ctx.textAlign = 'right';
          ctx.fillText(line, x + colW - 6, by);
          ctx.textAlign = 'left';
          u.font(ctx, 26, u.F.ui, 700);
          ctx.fillStyle = th.ink;
          ctx.fillText(u.ellipsis(ctx, p.name, colW - 24 - lw - 14), x + 20, by);
        });
      });
    } });
  } else if (hasTop) {
    blocks.push({ h: 104, drop: 2, name: 'each side\'s leader', draw: y => {
      const colW = (W - 2 * M - 24) / 2;
      [[m.top.home, M, m.home], [m.top.away, M + colW + 24, m.away]].forEach(([t, x, team]) => {
        if (!t) return;
        ctx.fillStyle = u.accentOn(team.colour, th);
        ctx.fillRect(x, y + 6, 5, 92);
        u.font(ctx, 18, u.F.micro);
        ctx.fillStyle = th.ink3;
        ctx.fillText('LED BY', x + 20, y + 26);
        u.font(ctx, 30, u.F.ui, 700);
        ctx.fillStyle = th.ink;
        ctx.fillText(u.ellipsis(ctx, t.name, colW - 24), x + 20, y + 62);
        u.font(ctx, 22, u.F.data, 500);
        ctx.fillStyle = th.ink2;
        ctx.fillText(u.ellipsis(ctx, lk && t.stats ? said(t.stats, lk) : t.line, colW - 24), x + 20, y + 94);
      });
    } });
  }
  /* the team stats, side by side, the better figure of each pair lit; when the shape has not room for all of them
     the last are cut (trim), and when it has room for none the block goes */
  if (MOD.teamStats && m.teamStats) {
    const keys = MOD.teamStats.slice();
    const blk = { h: 0, drop: 0, name: 'the team stats', draw: y => {
      ctx.fillStyle = th.panel;
      u.roundRect(ctx, M, y, W - 2 * M, blk.h, 14); ctx.fill();
      u.font(ctx, 20, u.F.ui, 700);
      ctx.fillStyle = th.ink2;
      const nameW = (W - 2 * M) / 2 - 150;
      ctx.fillText(u.ellipsis(ctx, m.home.short && m.home.short.length <= 4 ? m.home.short.toUpperCase() : m.home.name, nameW), M + 28, y + 30);
      ctx.textAlign = 'right';
      ctx.fillText(u.ellipsis(ctx, m.away.short && m.away.short.length <= 4 ? m.away.short.toUpperCase() : m.away.name, nameW), W - M - 28, y + 30);
      ctx.textAlign = 'center';
      u.font(ctx, 17, u.F.micro);
      ctx.fillStyle = th.ink3;
      ctx.fillText('TEAM STATS', W / 2, y + 28);
      keys.forEach((k, i) => {
        const by = y + 34 + i * 46 + 38, a = m.teamStats.home[k], b = m.teamStats.away[k];
        const low = tlow(k), hb = a.n === b.n ? 0 : ((a.n > b.n) !== !!low ? 1 : -1);
        u.font(ctx, 17, u.F.micro);
        ctx.fillStyle = th.ink3;
        ctx.textAlign = 'center';
        ctx.fillText(tl(k), W / 2, by - 6);
        [[a, M + 28, 'left', hb > 0], [b, W - M - 28, 'right', hb < 0]].forEach(([v, x, al, best]) => {
          u.fit(ctx, v.v, 190, 30, 20, u.F.data, 600);
          ctx.textAlign = al;
          ctx.fillStyle = best ? accent : th.ink;
          ctx.fillText(v.v, x, by);
        });
        if (i < keys.length - 1) { ctx.fillStyle = th.rule; ctx.fillRect(M + 24, by + 10, W - 2 * M - 48, 1); }
      });
      ctx.textAlign = 'left';
    }, trim: () => { if (keys.length > 1) { keys.pop(); blk.h = 34 + keys.length * 46 + 12; return 'cut'; } return 'gone'; } };
    blk.h = 34 + keys.length * 46 + 12;
    blocks.push(blk);
  }
  return (MOD.headline ? [Object.assign(titleBlock(ctx, th, S, M, '', ''), { drop: 3, name: 'the headline' })] : []).concat(blocks,
    !MOD.headline && MOD.subline ? [noteBlock(ctx, th, W, M, MOD.subline)] : []);
}

/* a line of the person's own words under a graphic that has no title of its own (a final, a player of the game) */
function noteBlock(ctx, th, W, M, text) {
  const u = U();
  return { h: 48, drop: 4, name: 'the subline', draw: y => {
    u.font(ctx, 30, u.F.ui, 600);
    ctx.fillStyle = th.ink2;
    ctx.fillText(u.ellipsis(ctx, text, W - 2 * M), M, y + 34);
  } };
}

function drawPerformer(ctx, m, th, S, M, accent) {
  const u = U(), W = S.w;
  const tall = S.h >= 1300;
  const s = m.stats;
  /* the stat lines: the three big numbers and the strip beneath are the default; `statKeys` picks its own, the
     first three big and the rest (up to five) in the strip */
  const keys = MOD.statKeys;
  const val = k => (k === 'pm' ? (s.pm > 0 ? '+' : '') + s.pm : String(s[k] == null ? '—' : s[k]));
  const big = keys ? keys.slice(0, 3).map(k => [val(k), sl(k, true)]) : [[String(s.pts), 'POINTS'], [String(s.reb), 'REBOUNDS'], [String(s.ast), 'ASSISTS']];
  const cells = keys ? keys.slice(3).map(k => [sl(k), val(k)])
    : [['FG', s.fg], ['3PT', s.p3], ['FT', s.ft], ['+/-', (s.pm > 0 ? '+' : '') + s.pm], ['MIN', String(s.min)]];
  const blocks = [
    { h: tall ? 250 : 200, draw: y => {
      /* the shirt number, huge and faint, behind the name */
      if (m.player.num) {
        ctx.save();
        u.font(ctx, tall ? 420 : 340, u.F.score);
        ctx.globalAlpha = th.fringe ? 0.07 : 0.06;
        ctx.fillStyle = accent;
        ctx.textAlign = 'right';
        ctx.fillText(m.player.num, W - M + 10, y + (tall ? 300 : 250));
        ctx.restore();
      }
      u.font(ctx, 24, u.F.micro);
      ctx.fillStyle = accent;
      ctx.fillText(u.ellipsis(ctx, (MOD.headline || m.label || 'PLAYER OF THE GAME').toUpperCase(), W - 2 * M), M, y + 24);
      const nb = u.nameBlock(ctx, m.player.name.toUpperCase(), W - 2 * M, tall ? 124 : 104, 60, u.F.score);
      nb.lines.forEach((l, i) => u.display(ctx, th, l, M, y + 40 + nb.size * (0.82 + i * 0.92), th.ink, 2));
      const after = y + 40 + nb.size * (0.9 + (nb.lines.length - 1) * 0.92) + 16;
      crest(ctx, th, m.team, M + 26, after + 22, 26);
      u.font(ctx, 28, u.F.ui, 600);
      ctx.fillStyle = th.ink2;
      ctx.fillText(u.ellipsis(ctx, m.team.name + (m.player.num ? '  #' + m.player.num : ''), W - 2 * M - 70), M + 66, after + 32);
    } },
    { h: tall ? 250 : 210, draw: y => {
      const cw = (W - 2 * M) / 3;
      big.forEach(([v, l], i) => {
        const cx = M + cw * i + cw / 2;
        ctx.textAlign = 'center';
        const px = tall ? 200 : 170;
        if (keys) u.fit(ctx, v, cw - 36, px, 60, u.F.score); else u.font(ctx, px, u.F.score);
        u.display(ctx, th, v, cx, y + (tall ? 180 : 150), i === 0 ? accent : th.ink, i === 0 ? 2 : 0);
        u.font(ctx, 22, u.F.micro);
        ctx.fillStyle = th.ink3;
        ctx.fillText(u.ellipsis(ctx, l, cw - 20), cx, y + (tall ? 230 : 196));
        if (i) { ctx.fillStyle = th.rule; ctx.fillRect(M + cw * i, y + 30, 2, (tall ? 190 : 160)); }
      });
      ctx.textAlign = 'left';
    } }
  ];
  if (cells.length) blocks.push({ h: 96, draw: y => {
      const cw = (W - 2 * M) / cells.length;
      ctx.fillStyle = th.panel;
      u.roundRect(ctx, M, y, W - 2 * M, 96, 14); ctx.fill();
      cells.forEach(([l, v], i) => {
        const cx = M + cw * (i + 0.5);
        ctx.textAlign = 'center';
        if (keys) u.fit(ctx, v, cw - 16, 34, 20, u.F.data, 600); else u.font(ctx, 34, u.F.data, 600);
        ctx.fillStyle = th.ink;
        ctx.fillText(v, cx, y + 50);
        u.font(ctx, 17, u.F.micro);
        ctx.fillStyle = th.ink3;
        ctx.fillText(l, cx, y + 80);
      });
      ctx.textAlign = 'left';
    } });
  blocks.push({ h: 64, draw: y => {
      const line = (m.won ? 'W ' : m.team.score === m.opp.score ? 'D ' : 'L ') + m.team.score + '–' + m.opp.score + '  v  ' + m.opp.name;
      crest(ctx, th, m.opp, M + 30, y + 32, 30);
      u.font(ctx, 30, u.F.ui, 600);
      ctx.fillStyle = th.ink2;
      ctx.fillText(u.ellipsis(ctx, line, W - 2 * M - 80), M + 76, y + 42);
    } });
  if (MOD.subline) blocks.push(noteBlock(ctx, th, W, M, MOD.subline));
  return blocks;
}

const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
/* A LIST'S ROW HEIGHT is what the shape leaves it: the page less its safe zones, the heading (76), the footer
   (100), the blocks above the list (`fixed`) and the least gap between blocks, shared by the rows; never
   taller than `max`. PER keeps a page's rows few enough that this never falls under `min`. */
function fitRows(S, n, fixed, min, max, gaps) {
  const avail = S.h - S.top - S.bottom - 76 - 100 - fixed - 12 * (gaps || 3);
  return clampN(Math.floor(avail / Math.max(n, 1)), min, max);
}

function rowsBlock(ctx, th, S, M, n, rowH, drawRow) {
  const u = U(), W = S.w;
  return { h: n * rowH, draw: y => {
    for (let i = 0; i < n; i++) {
      const ry = y + i * rowH;
      if (i % 2 === 0) { ctx.fillStyle = th.panel; u.roundRect(ctx, M, ry, W - 2 * M, rowH - 6, 10); ctx.fill(); }
      drawRow(i, ry, rowH - 6);
    }
  } };
}

function titleBlock(ctx, th, S, M, title0, sub0, zn) {
  const u = U(), W = S.w;
  const title = MOD.headline || title0, sub = [MOD.subline || sub0, zn && ZNOTE ? zn + ' ' + ZNOTE.text : ''].filter(Boolean).join(' · ');
  return { h: sub ? 128 : 96, draw: y => {
    const size = u.fit(ctx, title.toUpperCase(), W - 2 * M, 92, 50, u.F.score);
    u.display(ctx, th, u.ellipsis(ctx, title.toUpperCase(), W - 2 * M), M, y + size * 0.82, th.ink, 2);
    if (sub) {
      u.font(ctx, 26, u.F.ui, 500);
      ctx.fillStyle = th.ink3;
      ctx.fillText(u.ellipsis(ctx, sub, W - 2 * M), M, y + 122);
    }
  } };
}

/* a club's name with its record and its ELO beside it, when the person asked for them */
function nameWith(t) {
  const ex = MOD.rowExtras || [];
  const more = (ex.includes('record') && t.record ? [t.record] : []).concat(ex.includes('elo') && t.elo != null ? ['ELO ' + t.elo] : []);
  return more.length ? t.name + '  ·  ' + more.join('  ·  ') : t.name;
}

function drawWeek(ctx, m, th, S, M) {
  const u = U(), W = S.w;
  const n = m.rows.length;
  const rowH = fitRows(S, n, 128, 80, S.h >= 1900 ? 116 : 100, 3);
  return [
    titleBlock(ctx, th, S, M, 'Results', [m.comp, m.range].filter(Boolean).join(' · '), 'days in'),
    n ? rowsBlock(ctx, th, S, M, n, rowH, (i, y, h) => {
      const r = m.rows[i];
      const mid = W / 2, cy = y + h / 2;
      const hw = r.home.score > r.away.score, aw = r.away.score > r.home.score;
      stripe(ctx, th, r.home.colour, M, y + 10, h - 20);
      stripe(ctx, th, r.away.colour, W - M - 6, y + 10, h - 20);
      const cr = Math.min(36, h * 0.4), inset = 36 + 2 * cr;
      crest(ctx, th, r.home, M + 20 + cr, cy, cr);
      crest(ctx, th, r.away, W - M - 20 - cr, cy, cr);
      const nameW = mid - M - inset - 90;
      /* a long name is set smaller before it is cut: Crvena Zvezda Meridianbet is a club, not a typo */
      const nm = (t, x, won, align) => {
        const said = nameWith(t);
        u.fit(ctx, said, nameW, 28, 20, u.F.ui, 700);
        ctx.fillStyle = won ? th.ink : th.ink2;
        ctx.textAlign = align;
        ctx.fillText(u.ellipsis(ctx, said, nameW), x, cy + 10);
      };
      nm(r.home, M + inset, hw, 'left');
      nm(r.away, W - M - inset, aw, 'right');
      ctx.textAlign = 'right';
      u.font(ctx, 46, u.F.score);
      ctx.fillStyle = hw ? th.ink : th.ink3;
      ctx.fillText(String(r.home.score), mid - 14, cy + 16);
      ctx.textAlign = 'left';
      ctx.fillStyle = aw ? th.ink : th.ink3;
      ctx.fillText(String(r.away.score), mid + 14, cy + 16);
      ctx.fillStyle = th.rule2;
      ctx.fillRect(mid - 4, cy - 2, 8, 4);
      /* under the score: the day, and whatever else was asked for (tip-off, venue, the quarters), one line */
      const ex = MOD.rowExtras || [];
      const bits = [r.day && on('days') ? r.day.toUpperCase() : ''].concat(ex.includes('time') ? [r.time] : [], ex.includes('venue') ? [String(r.venue || '').toUpperCase()] : [],
        ex.includes('quarters') ? [r.quarters] : []).filter(Boolean);
      if (bits.length && (h >= 96 || (ex.length && h >= 84))) {
        u.font(ctx, 15, u.F.micro);
        ctx.fillStyle = th.ink3;
        ctx.textAlign = 'center';
        ctx.fillText(u.ellipsis(ctx, bits.join('  ·  '), W - 2 * M - 2 * inset), mid, y + h - 10);
        ctx.textAlign = 'left';
      }
    }) : { h: 80, draw: y => { u.font(ctx, 30, u.F.ui, 500); ctx.fillStyle = th.ink3; ctx.fillText('No finished games this week.', M, y + 40); } }
  ];
}

/* STARS OF THE WEEK. Three layouts of one idea - the best of the week, the first the biggest:
     list   #1 a tall card with his three big numbers, the rest in tiers beneath (each a row: rank, disc, name, game, line)
     hero   #1 alone, large, with two runners-up under him
     five   a starting five: two on the top row, three below, cards of equal weight
   Each player is a disc in his club's colour (initials, or the shirt number is never guessed) with the club's crest on its
   edge; names are fitted and cut, and the room a shape has is shared out by the rows it holds. */
function starDisc(ctx, th, r, cx, cy, rad, accent) {
  const u = U();
  const col = u.rgb(r.team.colour) ? r.team.colour : accent;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  ctx.fillStyle = u.accentOn(col, th); ctx.globalAlpha = 0.22; ctx.fill();
  ctx.globalAlpha = 1; ctx.lineWidth = Math.max(3, rad * 0.06); ctx.strokeStyle = u.accentOn(col, th); ctx.stroke();
  ctx.restore();
  u.font(ctx, rad * 0.78, u.F.score);
  ctx.textAlign = 'center';
  ctx.fillStyle = th.ink;
  ctx.fillText(u.initials(r.name), cx, cy + rad * 0.27);
  ctx.textAlign = 'left';
  crest(ctx, th, r.team, cx + rad * 0.72, cy + rad * 0.72, Math.max(14, rad * 0.36));
}
function starLine(r, keys) { return keys.map(k => r.stats[k] + ' ' + sl(k)).join(' · '); }

function drawWeekStars(ctx, m, th, S, M, accent) {
  const u = U(), W = S.w;
  const rows = m.rows, n = rows.length;
  const layout = MOD.layout || 'list';
  const keys = MOD.statKeys ? MOD.statKeys.slice(0, 4) : ['pts', 'reb', 'ast'];
  const big = (MOD.statKeys ? MOD.statKeys : ['pts', 'reb', 'ast']).slice(0, 3);
  const monthly = m.period === 'month';
  const title = titleBlock(ctx, th, S, M, monthly ? 'Stars of the month' : 'Stars of the week', [m.comp, m.range].filter(Boolean).join(' · '));
  if (!n) return [title, { h: 80, draw: y => { u.font(ctx, 30, u.F.ui, 500); ctx.fillStyle = th.ink3; ctx.fillText('No player lines this week.', M, y + 40); } }];
  const avail = S.h - S.top - S.bottom - 76 - 100 - title.h - 12 * 3;
  const gameLine = r => r.sub ? r.team.name + '  ·  ' + r.sub : (r.team.name + '  ·  ' + (r.won ? 'W' : r.team.score === r.opp.score ? 'D' : 'L') + ' ' + r.team.score + '–' + r.opp.score + ' v ' + r.opp.name);
  const numeral = (r, x, y, size, al) => {           // the rank, big and faint
    ctx.save(); u.font(ctx, size, u.F.score); ctx.globalAlpha = th.fringe ? 0.16 : 0.12; ctx.fillStyle = accent; ctx.textAlign = al || 'left';
    ctx.fillText(String(r.rank), x, y); ctx.restore();
  };
  /* the lead card: name across the top, disc left, the three big numbers under */
  const lead = (r, h) => ({ h, draw: y => {
    ctx.fillStyle = th.panel; u.roundRect(ctx, M, y, W - 2 * M, h, 18); ctx.fill();
    ctx.fillStyle = accent; ctx.fillRect(M, y + 14, 8, h - 28);
    numeral(r, W - M - 20, y + h - 18, h * 0.8, 'right');
    const rad = Math.min(54, h * 0.2), cx = M + 40 + rad, cy = y + 30 + rad, head = 30 + 2 * rad + 8;
    starDisc(ctx, th, r, cx, cy, rad, accent);
    const tx = cx + rad + 26, tw = W - M - tx - 24;
    u.font(ctx, 18, u.F.micro); ctx.fillStyle = accent; ctx.fillText(monthly ? 'STAR OF THE MONTH' : 'STAR OF THE WEEK', tx, y + 34);
    const nb = u.nameBlock(ctx, r.name.toUpperCase(), tw, 64, 34, u.F.score);
    nb.lines.forEach((l, i) => u.display(ctx, th, l, tx, y + 34 + nb.size * (0.95 + i * 0.9), th.ink, 2));
    const after = y + 34 + nb.size * (0.95 + (nb.lines.length - 1) * 0.9);
    u.font(ctx, 22, u.F.ui, 600); ctx.fillStyle = th.ink2;
    ctx.fillText(u.ellipsis(ctx, gameLine(r), tw), tx, Math.min(after + 34, y + head));
    const cw = (W - 2 * M - 48) / big.length, by0 = y + h - 22, nsize = Math.max(34, Math.min(96, (h - head - 44) * 0.95));
    big.forEach((k, i) => {
      const cx2 = M + 24 + cw * (i + 0.5);
      ctx.textAlign = 'center';
      u.fit(ctx, String(r.stats[k]), cw - 30, nsize, 30, u.F.score);
      u.display(ctx, th, String(r.stats[k]), cx2, by0 - 30, i === 0 ? accent : th.ink, i === 0 ? 2 : 0);
      u.font(ctx, 17, u.F.micro); ctx.fillStyle = th.ink3;
      ctx.fillText(sl(k, true).slice(0, 12), cx2, by0);
    });
    ctx.textAlign = 'left';
  } });
  /* a tiered row: rank, disc, name, the game, and the line at the right */
  const rowFor = (r, h, tier) => ({ h, draw: y => {
    ctx.fillStyle = tier ? th.panel : 'rgba(0,0,0,0)';
    if (tier) { u.roundRect(ctx, M, y, W - 2 * M, h - 6, 14); ctx.fill(); }
    numeral(r, M + 14, y + h * 0.78, h * 0.9);
    const rad = Math.min(38, (h - 6) * 0.36), cx = M + 100 + rad, cy = y + (h - 6) / 2;
    starDisc(ctx, th, r, cx, cy, rad, accent);
    const tx = cx + rad + 24, right = W - M - 22;
    u.font(ctx, Math.min(22, h * 0.2), u.F.data, 600);
    const line = u.ellipsis(ctx, starLine(r, keys), (right - tx) * 0.55);
    const lw = ctx.measureText(line).width;
    ctx.fillStyle = accent; ctx.textAlign = 'right'; ctx.fillText(line, right, cy + 8); ctx.textAlign = 'left';
    const nw = right - tx - lw - 16;
    u.fit(ctx, r.name, nw, Math.min(32, h * 0.3), 20, u.F.ui, 700);
    ctx.fillStyle = th.ink; ctx.fillText(u.ellipsis(ctx, r.name, nw), tx, cy - 4);
    u.font(ctx, Math.max(15, Math.min(19, h * 0.17)), u.F.ui, 500); ctx.fillStyle = th.ink3;
    ctx.fillText(u.ellipsis(ctx, gameLine(r), right - tx), tx, cy + Math.min(30, h * 0.26));
    stripe(ctx, th, r.team.colour, M, y + 8, h - 22, 5);
  } });
  if (layout === 'five') {
    const top = rows.slice(0, 2), bot = rows.slice(2, 5);
    const rowH = Math.min(300, (avail - 12) / 2);
    const cardRow = (list, h) => ({ h, draw: y => {
      const gap = 16, cw = (W - 2 * M - gap * (list.length - 1)) / list.length;
      list.forEach((r, i) => {
        const x = M + i * (cw + gap), cx = x + cw / 2;
        ctx.fillStyle = th.panel; u.roundRect(ctx, x, y, cw, h, 16); ctx.fill();
        ctx.fillStyle = i === 0 && r.rank === 1 ? accent : u.accentOn(r.team.colour || accent, th); ctx.fillRect(x + 14, y, cw - 28, 5);
        numeral(r, x + cw - 14, y + h * 0.42, h * 0.42, 'right');
        const rad = Math.min(52, h * 0.19);
        starDisc(ctx, th, r, cx, y + 20 + rad, rad, accent);
        u.fit(ctx, r.name, cw - 24, Math.min(28, h * 0.1), 17, u.F.ui, 800);
        ctx.textAlign = 'center'; ctx.fillStyle = th.ink;
        ctx.fillText(u.ellipsis(ctx, r.name, cw - 24), cx, y + 20 + 2 * rad + 40);
        u.font(ctx, 17, u.F.ui, 500); ctx.fillStyle = th.ink3;
        ctx.fillText(u.ellipsis(ctx, r.team.name, cw - 24), cx, y + 20 + 2 * rad + 66);
        u.font(ctx, Math.min(26, h * 0.095), u.F.data, 700); ctx.fillStyle = i === 0 && r.rank === 1 ? accent : th.ink;
        ctx.fillText(u.ellipsis(ctx, starLine(r, keys.slice(0, list.length > 2 ? 2 : 3)), cw - 20), cx, y + h - 22);
        ctx.textAlign = 'left';
      });
    } });
    return [title, cardRow(top, rowH)].concat(bot.length ? [cardRow(bot, rowH)] : []);
  }
  const rest = rows.slice(1);
  if (layout === 'hero') {
    const heroH = Math.min(420, Math.max(260, (avail - rest.slice(0, 2).length * 120) * 0.95));
    const rH = Math.min(130, Math.max(84, (avail - heroH - 24) / Math.max(1, Math.min(2, rest.length))));
    return [title, lead(rows[0], heroH)].concat(rest.slice(0, 2).map(r => rowFor(r, rH, true)));
  }
  /* list: the lead card takes about a third, the rest share the remainder, each tier a little smaller */
  const leadH = Math.max(250, Math.min(310, avail * (n > 1 ? 0.3 : 0.6)));
  const rH = n > 1 ? Math.max(76, Math.min(122, (avail - leadH - 12 * (n - 1)) / (n - 1))) : 0;
  return [title, lead(rows[0], leadH)].concat(rest.map((r, i) => rowFor(r, Math.max(76, rH - i * 4), true)));
}

/* THE LEADERS: one category is a top-ten list, several are a panel of short lists. Each row a rank (T- for a tie), the club's crest, the name
   and the figure, the leader's lit; every list is cut to what the panel's height holds at a size a phone reads. */
function drawLeaders(ctx, m, th, S, M, accent) {
  const u = U(), W = S.w, boards = m.boards, nb = boards.length;
  const title = titleBlock(ctx, th, S, M, nb === 1 ? boards[0].label + ' leaders' : m.title, [m.comp, m.range].filter(Boolean).join(' · '));
  if (!nb) return [title, { h: 80, draw: y => { u.font(ctx, 30, u.F.ui, 500); ctx.fillStyle = th.ink3; ctx.fillText('No leaders to show yet.', M, y + 40); } }];
  const avail = S.h - S.top - S.bottom - 76 - 100 - title.h - 12 * 2;
  const rowLine = (b, r, x, y, w, h, first, big) => {
    const cy = y + h / 2;
    ctx.fillStyle = th.panel; if (first) { u.roundRect(ctx, x, y, w, h - 4, 10); ctx.fill(); ctx.fillStyle = accent; ctx.fillRect(x, y + 6, 5, h - 16); }
    u.font(ctx, Math.min(big ? 30 : 22, h * 0.5), u.F.score);
    ctx.fillStyle = first ? accent : th.ink3; ctx.textAlign = 'center';
    const rk = (r.tie ? 'T' : '') + r.rank;
    ctx.fillText(rk, x + (big ? 42 : 30), cy + h * 0.16); ctx.textAlign = 'left';
    const cr = Math.min(big ? 22 : 16, h * 0.34), cx = x + (big ? 96 : 72);
    crest(ctx, th, r.team, cx, cy, cr);
    const vs = Math.min(big ? 34 : 24, h * 0.55);
    u.font(ctx, vs, u.F.data, 700);
    const val = u.ellipsis(ctx, r.value, w * 0.34), vw = ctx.measureText(val).width;
    ctx.fillStyle = first ? accent : th.ink; ctx.textAlign = 'right'; ctx.fillText(val, x + w - 14, cy + vs * 0.35); ctx.textAlign = 'left';
    const nx = cx + cr + 14, nw = x + w - 14 - vw - 14 - nx;
    u.fit(ctx, r.name, nw, Math.min(big ? 32 : 24, h * 0.5), 15, u.F.ui, first ? 800 : 600);
    ctx.fillStyle = th.ink; ctx.fillText(u.ellipsis(ctx, r.name, nw), nx, cy - (r.sub || (m.subject !== 'teams' && big) ? 2 : -h * 0.1));
    const sub = r.sub || (m.subject !== 'teams' && big ? r.team.name : '');
    if (sub) { u.font(ctx, Math.max(15, Math.min(19, h * 0.28)), u.F.ui, 500); ctx.fillStyle = th.ink3; ctx.fillText(u.ellipsis(ctx, sub, nw), nx, cy + Math.min(24, h * 0.34)); }
  };
  if (nb === 1) {
    const b = boards[0], n = Math.min(b.rows.length, MOD.rows || 10);
    const rowH = Math.max(46, Math.min(S.h >= 1900 ? 110 : 92, Math.floor(avail / Math.max(n, 1))));
    const k = Math.max(1, Math.min(n, Math.floor(avail / rowH)));
    return [title, { h: k * rowH, draw: y => { for (let i = 0; i < k; i++) rowLine(b, b.rows[i], M, y + i * rowH, W - 2 * M, rowH, i === 0, true); } }];
  }
  const cols = nb === 2 || (nb === 3 && S.h >= 1900) ? 1 : 2, lines = Math.ceil(nb / cols), gap = 18;
  const pw = (W - 2 * M - gap * (cols - 1)) / cols, ph = (avail - gap * (lines - 1)) / lines;
  const want = MOD.rows || (nb > 3 ? 3 : 5), head = 46;
  const rowH = Math.max(34, Math.min(58, (ph - head - 12) / want));
  const k = Math.max(1, Math.min(want, Math.floor((ph - head - 12) / rowH)));
  return [title, { h: lines * ph + (lines - 1) * gap, draw: y => {
    boards.forEach((b, i) => {
      const x = M + (i % cols) * (pw + gap), py = y + Math.floor(i / cols) * (ph + gap);
      ctx.fillStyle = th.panel; u.roundRect(ctx, x, py, pw, ph, 16); ctx.fill();
      ctx.fillStyle = accent; ctx.fillRect(x + 16, py, 44, 5);
      u.font(ctx, 20, u.F.ui, 800); ctx.fillStyle = th.ink;
      ctx.fillText(u.ellipsis(ctx, b.label.toUpperCase(), pw - 32), x + 18, py + 34);
      b.rows.slice(0, k).forEach((r, j) => rowLine(b, r, x + 8, py + head + j * rowH, pw - 16, rowH, j === 0, false));
    });
  } }];
}

function drawTable(ctx, m, th, S, M, accent) {
  const u = U(), W = S.w;
  const n = m.rows.length;
  /* the rows share what the heading, the title, the column names and the footer leave */
  const rowH = fitRows(S, n, 128 + 34, 44, S.h >= 1900 ? 76 : 66, 4);
  const cols = MOD.cols ? MOD.cols.map(k => [cl(k), k])
    : [['GP', 'gp'], ['W', 'w'], ['L', 'l']].concat(m.showPts ? [['PTS', 'pts']] : []).concat([['DIFF', 'diff']]);
  const cw = cols.length > 5 ? 76 : 92, x0 = W - M - cols.length * cw;
  return [
    titleBlock(ctx, th, S, M, m.group || 'The table', [m.comp, m.asOf ? 'after ' + m.asOf : ''].filter(Boolean).join(' · ')),
    { h: 34, draw: y => {
      u.font(ctx, 18, u.F.micro);
      ctx.fillStyle = th.ink3;
      ctx.textAlign = 'center';
      cols.forEach(([l], i) => ctx.fillText(l, x0 + cw * (i + 0.5), y + 24));
      ctx.textAlign = 'left';
    } },
    rowsBlock(ctx, th, S, M, n, rowH, (i, y, h) => {
      const r = m.rows[i], cy = y + h / 2;
      stripe(ctx, th, r.team.colour, M, y + 6, h - 12, 5);
      u.font(ctx, Math.min(34, h * 0.6), u.F.score);
      ctx.fillStyle = r.rank <= 1 ? accent : th.ink3;
      ctx.textAlign = 'center';
      ctx.fillText(String(r.rank), M + 34, cy + h * 0.2);
      ctx.textAlign = 'left';
      crest(ctx, th, r.team, M + 94, cy, Math.min(24, h * 0.4));
      u.font(ctx, Math.min(28, h * 0.48), u.F.ui, 700);
      ctx.fillStyle = th.ink;
      ctx.fillText(u.ellipsis(ctx, r.team.name, x0 - M - 140), M + 132, cy + h * 0.17);
      u.font(ctx, Math.min(28, h * 0.46), u.F.data, 500);
      ctx.textAlign = 'center';
      cols.forEach(([, k], ci) => {
        u.font(ctx, Math.min(cols.length > 5 ? 24 : 28, h * 0.46), u.F.data, 500);
        const one = x => (x == null ? '—' : x.toFixed(1));
        const v = k === 'diff' ? (r.diff > 0 ? '+' : '') + r.diff : k === 'avg' ? (r.avg == null ? '—' : (r.avg > 0 ? '+' : '') + one(r.avg))
          : k === 'pct' ? (r.pct == null ? '—' : r.pct >= 1 ? '1.000' : r.pct.toFixed(3).replace(/^0/, ''))
          : k === 'ppg' || k === 'papg' ? one(r[k]) : r[k] == null || r[k] === '' ? '—' : String(r[k]);
        const signed = k === 'diff' ? r.diff : k === 'avg' ? r.avg : null;
        ctx.fillStyle = k === 'w' ? th.ink : signed != null ? (signed > 0 ? th.good : signed < 0 ? th.bad : th.ink3) : th.ink2;
        ctx.fillText(v, x0 + cw * (ci + 0.5), cy + h * 0.16);
      });
      ctx.textAlign = 'left';
    })
  ];
}

function drawFixtures(ctx, m, th, S, M, accent) {
  const u = U(), W = S.w;
  const n = m.rows.length;
  const rowH = fitRows(S, n, 128, 96, S.h >= 1900 ? 140 : 124, 3);
  return [
    titleBlock(ctx, th, S, M, 'Coming up', [m.comp, m.range].filter(Boolean).join(' · '), 'times in'),
    n ? rowsBlock(ctx, th, S, M, n, rowH, (i, y, h) => {
      const r = m.rows[i], cy = y + h / 2;
      const newDay = i === 0 || m.rows[i - 1].day !== r.day;
      u.font(ctx, 17, u.F.micro);
      ctx.fillStyle = newDay ? accent : th.ink3;
      ctx.fillText(r.day.toUpperCase(), M + 18, y + 26);
      u.font(ctx, 40, u.F.score);
      ctx.fillStyle = th.ink;
      ctx.fillText(r.time, M + 18, y + h - 16);
      const tx = M + 250, tw = W - M - tx - 20;
      const venue = r.venue && h >= 104 && on('venues');
      const l1 = cy - (venue ? 22 : 10), l2 = l1 + 38;
      stripe(ctx, th, r.home.colour, W - M - 6, y + 8, (h - 16) / 2);
      stripe(ctx, th, r.away.colour, W - M - 6, y + 8 + (h - 16) / 2, (h - 16) / 2);
      crest(ctx, th, r.home, M + 212, l1 - 9, 17);
      crest(ctx, th, r.away, M + 212, l2 - 9, 17);
      [[r.home, l1], [r.away, l2]].forEach(([t, ly]) => {
        const said = nameWith(t);
        u.fit(ctx, said, tw, 28, 21, u.F.ui, 700);
        ctx.fillStyle = th.ink;
        ctx.fillText(u.ellipsis(ctx, said, tw), tx, ly);
      });
      if (venue) {
        u.font(ctx, 19, u.F.ui, 400);
        ctx.fillStyle = th.ink3;
        ctx.fillText(u.ellipsis(ctx, r.venue, tw), tx, l2 + 32);
      }
    }) : { h: 80, draw: y => { u.font(ctx, 30, u.F.ui, 500); ctx.fillStyle = th.ink3; ctx.fillText('Nothing scheduled this week.', M, y + 40); } }
  ];
}

const TAGS = { leaders: 'LEADERS', weekstars: 'STARS', result: 'FINAL', performer: 'MVP', week: 'RESULTS', table: 'STANDINGS', fixtures: 'THIS WEEK' };

function draw(ctx, m0, opts) {
  const o = opts || {};
  const u = U(), themes = TH();
  if (!u || !themes) throw new Error('socialcard.js needs reportcard.js loaded first');
  MOD = cleanModules(Object.assign({}, m0.modules, o.modules));
  ZNOTE = zoneNote(m0, MOD);
  CAT = m0.cat || {};
  try { return drawIn(ctx, relabel(rowsOf(m0, MOD), MOD), o, u, themes); } finally { MOD = {}; ZNOTE = null; CAT = {}; }
}

function drawIn(ctx, m, o, u, themes) {
  const S = SIZES[o.size] || SIZES.portrait;
  const th = themes[MOD.theme || o.theme] || EXTRA_THEMES[MOD.theme || o.theme] || themes.dark;
  const W = S.w, H = S.h, M = 64;
  const L = m.league || {};
  const leagueCol = u.rgb(L.colour) ? L.colour : '#93f2bf';
  /* the player of the game is his club's post: its colour leads - the first of its two that can be seen on this
     ground (a black kit's white, say); a club with neither falls back to the league's */
  const colour = MOD.accent || (m.kind === 'performer' && m.team ? visible([m.team.colour, m.team.colour2], th) || leagueCol : leagueCol);
  const accent = u.accentOn(colour, th);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const glows = m.kind === 'result'
    ? [{ colour: m.home.colour, x: 0.08, y: 0.32, r: 0.62 }, { colour: m.away.colour, x: 0.92, y: 0.32, r: 0.62 }, { colour: leagueCol, x: 0.5, y: 1.05, r: 0.6, a: 0.6 }]
    : m.kind === 'performer'
      ? [{ colour: m.team.colour, x: 0.85, y: 0.08 }, { colour: m.team.colour2 || L.colour2, x: 0.05, y: 0.95, r: 0.6, a: 0.7 }]
      : [{ colour: leagueCol, x: 0.85, y: 0.05 }, { colour: L.colour2, x: 0.05, y: 0.98, r: 0.6, a: 0.7 }];
  ground(ctx, th, W, H, glows, colour, m.kind === 'performer' ? m.team.colour2 : L.colour2);
  const when = m.kind === 'result' || m.kind === 'performer' ? m.date + (ZNOTE ? ' · ' + ZNOTE.short : '') : m.kind === 'table' ? (m.asOf || '') : (m.range || '');
  const what = [m.comp || L.name || '', m.pages > 1 ? m.page + '/' + m.pages : ''].filter(Boolean).join(' · ');
  const top = S.top, bottom = H - S.bottom;
  heading(ctx, th, M, W, top, TAGS[m.kind] || '', what, when, accent, !MOD.logoPos || MOD.logoPos === 'heading' ? L.logo : null);
  const body = m.kind === 'result' ? drawResult(ctx, m, th, S, M, accent)
    : m.kind === 'performer' ? drawPerformer(ctx, m, th, S, M, accent)
    : m.kind === 'week' ? drawWeek(ctx, m, th, S, M)
    : m.kind === 'weekstars' ? drawWeekStars(ctx, m, th, S, M, accent)
    : m.kind === 'leaders' ? drawLeaders(ctx, m, th, S, M, accent)
    : m.kind === 'table' ? drawTable(ctx, m, th, S, M, accent)
    : drawFixtures(ctx, m, th, S, M, accent);
  /* ROOM FOR EVERYTHING: the blocks and the least gap between them must fit the space the heading and the footer
     leave. A default graphic always does. When the person's own additions (a headline block, a subline) would
     not, the least important go first - the subline, the headline, then a final's leaders and quarter scores -
     and the graphic says which (`dropped`) rather than run over the footer. */
  const room = (bottom - 70 - 30) - (top + 40 + 36), dropped = [];
  const need = () => body.reduce((a, b) => a + b.h, 0) + 12 * Math.max(0, body.length - 1);
  while (need() > room) {
    const worst = body.reduce((w, b) => (b.drop && (!w || b.drop > w.drop) ? b : w), null);
    if (worst) { body.splice(body.indexOf(worst), 1); dropped.push(worst.name); continue; }
    const cut = body.find(b => b.trim);                    // a block that can give up some of itself (the team stats' last rows)
    if (!cut) break;
    if (cut.trim() === 'gone') { body.splice(body.indexOf(cut), 1); dropped.push(cut.name); } else if (!dropped.includes('some of ' + cut.name)) dropped.push('some of ' + cut.name);
  }
  const at = stack(body, top + 40 + 36, bottom - 70 - 30, S.h >= 1900 ? 90 : 60);
  body.forEach((b, i) => b.draw(at[i]));
  /* the line above the footer: a final's venue on the left, the partner's line (or on its own, all the way across) */
  const slot = bottom - 70 - 14;
  const venue = m.kind === 'result' && m.venue && on('venue') ? m.venue.toUpperCase() : '';
  if (venue || MOD.sponsor) {
    u.font(ctx, 20, u.F.micro);
    const both = venue && MOD.sponsor, full = W - 2 * M;
    if (venue) {
      ctx.fillStyle = th.ink3;
      ctx.fillText(u.ellipsis(ctx, venue, both ? full * 0.5 - 12 : full), M, slot);
    }
    if (MOD.sponsor) {
      ctx.fillStyle = accent;
      ctx.textAlign = both ? 'right' : 'left';
      ctx.fillText(u.ellipsis(ctx, MOD.sponsor.toUpperCase(), both ? full * 0.5 - 12 : full), both ? W - M : M, slot);
      ctx.textAlign = 'left';
    }
  }
  footer(ctx, th, M, W, bottom - 70, L);
  return { size: o.size || 'portrait', blocks: body.length, at, dropped };
}

/* ---------------------------------------------------------------- assets --- */
/* every crest a model names, read once per URL and only if it can be drawn onto a canvas that is then saved */
const crestCache = new Map();
function teamsOf(m) {
  const out = [];
  if (m.home) out.push(m.home, m.away);
  if (m.team) out.push(m.team, m.opp);
  (m.rows || []).forEach(r => { if (r.home) out.push(r.home, r.away); if (r.team) out.push(r.team); if (r.opp) out.push(r.opp); });
  (m.boards || []).forEach(b => b.rows.forEach(r => { if (r.team) out.push(r.team); }));
  return out.filter(Boolean);
}
async function withCrests(m) {
  const u = U();
  const c = JSON.parse(JSON.stringify(m));
  const teams = teamsOf(c);
  const get = url => { if (!crestCache.has(url)) crestCache.set(url, u.readableCrest(url)); return crestCache.get(url); };
  await Promise.all(teams.map(async t => { if (t.crestUrl) t.crest = await get(t.crestUrl); })
    .concat(c.league && c.league.logoUrl ? [get(c.league.logoUrl).then(img => { c.league.logo = img; })] : []));
  return c;
}

async function canvas(m, opts) {
  const o = Object.assign({ size: 'portrait', theme: 'dark', scale: 1 }, opts || {});   // opts.modules rides through to draw()
  const u = U();
  await u.fontsReady();
  const S = SIZES[o.size] || SIZES.portrait;
  const c = root.document.createElement('canvas');
  c.width = Math.round(S.w * o.scale);
  c.height = Math.round(S.h * o.scale);
  const ctx = c.getContext('2d');
  ctx.scale(o.scale, o.scale);
  c.dropped = draw(ctx, await withCrests(m), o).dropped;      // what a full shape left out (see drawIn)
  return c;
}

async function png(m, opts) {
  return U().blobOf(await canvas(m, opts), 'image/png');
}

function filename(m, size) {
  const L = m && m.league || {};
  return slug(L.slug || L.name || 'league') + '-' + (m && m.key || 'post') + '-' + (size || 'portrait') + '.png';
}

/* ------------------------------------------------------------------- ZIP --- */
/* Several graphics as one file: the ZIP format with every entry STORED (a PNG does not compress), names in UTF-8
   (flag bit 11), a CRC-32 per entry, and the central directory after them. */
let CRC = null;
function crc32(bytes) {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function utf8(s) {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Uint8Array.from(unescape(encodeURIComponent(s)), c => c.charCodeAt(0));
}
function dosTime(d) {
  const t = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [t & 0xffff, day & 0xffff];
}
/* files: [{ name, bytes: Uint8Array }] -> Uint8Array */
function zip(files, when) {
  const [tm, dt] = dosTime(when || new Date());
  const locals = [], centrals = [];
  let offset = 0;
  files.forEach(f => {
    const name = utf8(f.name), data = f.bytes, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, tm, true); h.setUint16(12, dt, true); h.setUint32(14, crc, true);
    h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true); c.setUint16(12, tm, true); c.setUint16(14, dt, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    locals.push(new Uint8Array(h.buffer), name, data);
    centrals.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true);
  e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true); e.setUint16(20, 0, true);
  const parts = locals.concat(centrals, [new Uint8Array(e.buffer)]);
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let at = 0;
  parts.forEach(p => { out.set(p, at); at += p.length; });
  return out;
}

return { SIZES, PER, THEME_KEYS, STAT_DEFS, COL_DEFS, LOGO_POS, cleanModules, rowsOf, validZone, leagueZone, zoneName, zoneNote, relabel, COUNTRY_ZONE, TEAM_STAT_DEFS, ROW_EXTRAS, catKey, leaders, result, performer, weekstars, LAYOUTS, week, table, fixtures, caption, draw, canvas, png, filename, zip, crc32,
         gameScore, statLine, local, dayLabel, dateLabel, timeLabel, slug };
}));
