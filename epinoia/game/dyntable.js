'use strict';
/* ============================================================================
   DYNAMIC TABLES — the box score's tab that shows what the games being played
   RIGHT NOW would do to the league table if they ended on their current score.

   THE TABLE IS NOT RECOMPUTED HERE. The official table is the database's own
   `standings` rows (recompute_standings, at each final whistle: finished games
   only, sanctions applied). A live game is laid over those rows as if it had
   finished, and the rows are ranked with the SAME keys recompute_standings
   ranks by (0144):

     league / groups   league points, then point difference, then points for
     conferences       conference win %, conference wins, overall win %, then the
                       three above; ranked inside (group, division) as stored

   (leagues.rules.tiebreak declares head-to-head steps, but the database does not
   apply them - docs/outstanding.md - so neither does the projection: a projected
   table that disagreed with the table the game will produce would be worse than
   none.) Rows level on every key keep the stored rank order, then name.

   A LEVEL SCORE IS NOT A RESULT. Basketball has no draw, so a game level right
   now cannot end level: it is listed as "level: projected as a tie" and changes
   nothing in the projection (no win, no loss, no points, no games played).

   THE LIVE PATH. The viewed game's score comes from the page's own state (the
   frames it already receives). The OTHER live games of the competition are read
   with ONE bounded query (games + game_state embedded), every 15 s while the tab
   is on screen and the document visible; never while hidden; doubled after each
   failure up to 2 min; every 60 s when nothing is live. The table itself is read
   once when the tab first opens and kept.

   project/rank/periodLabel are pure and run under node
   (supabase/tests/dyntable.test.mjs); the rest reads the page.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaDynTable = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = v => (Number.isFinite(+v) && v !== null && v !== '' ? +v : 0);
const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(+v);

/* THE POINTS SCHEME THE OFFICIAL TABLE WAS BUILT WITH. The projection adds a live game's points on top of the official
   rows, so it must add them the way those rows were made: a win and a loss worth the same as they were when the database
   last recomputed this table. The league's rules say what they ARE now; the rows say what they WERE, and the two differ for
   as long as a rule that has just been changed (a loss now worth 0) has not yet been recomputed into the stored table -
   using the new rule on old rows would move clubs that no game moved. So the scheme is read off the rows: the common
   ones and the rules' own are tried, and the one that explains the most rows wins (the rules' own on a tie, and whenever
   too few rows have played to tell). A deducted-points column is added back first, so a sanction does not spoil the fit.
   Zero is a value: a loss worth 0 is a scheme, not a missing one. */
function inferScheme(rows, rules) {
  const r = rules || {};
  const want = { win: isNum(r.win_points) ? +r.win_points : 2, loss: isNum(r.loss_points) ? +r.loss_points : 1 };
  const played = (rows || []).filter(x => x && isNum(x.gp) && +x.gp > 0 && isNum(x.w) && isNum(x.l) && isNum(x.league_points));
  if (played.length < 3) return want;
  const cands = [want, { win: 2, loss: 1 }, { win: 2, loss: 0 }, { win: 3, loss: 0 }, { win: 3, loss: 1 }, { win: 1, loss: 0 }, { win: 1, loss: 1 }];
  let best = want, bestN = -1;
  cands.forEach(c => {
    let n = 0;
    played.forEach(x => { if (+x.league_points + (isNum(x.deducted_points) ? +x.deducted_points : 0) === +x.w * c.win + +x.l * c.loss) n++; });
    if (n > bestN) { best = c; bestN = n; }         // `>`: the rules' own scheme is first, so it wins every tie
  });
  return bestN * 2 >= played.length ? best : want;
}

/* ---------------------------------------------------------------- pure --- */

/* 'Q3', 'OT1'; 'H2' where the league plays halves */
function periodLabel(p, periods) {
  p = +p;
  if (!Number.isFinite(p) || p < 1) return '';
  const n = periods || 4;
  if (p > n) return 'OT' + (p - n);
  return (n === 2 ? 'H' : 'Q') + p;
}
/* 187000 -> '3:07', 9400 -> '9.4' under a minute, as the scoreboard shows it */
function clockLabel(ms) {
  if (!isNum(ms)) return '';
  ms = Math.max(0, +ms);
  if (ms < 60000) return (Math.floor(ms / 100) / 10).toFixed(1);
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function rec(r) {
  const t = r.teams || {};
  return {
    team_id: r.team_id, group: r.group_name || '', division: r.division_name || '',
    gp: num(r.gp), w: num(r.w), l: num(r.l), pf: num(r.pts_for), pa: num(r.pts_against),
    pts: num(r.league_points), dock: num(r.deducted_points),
    cgp: num(r.conf_gp), cw: num(r.conf_w), cl: num(r.conf_l),
    stored: isNum(r.rank) ? +r.rank : 1e9,
    name: t.name || r.name || '', short: t.short_name || '', colour: t.colour || '', slug: t.slug || '',
    logo: t.logo_path || '', touched: []
  };
}
const diffOf = x => x.pf - x.pa;

/* position of every record inside its table (its group, and division in a conference league),
   1-based, by recompute_standings's own keys. Returns the same records, `pos` set. */
function rank(recs, conferences) {
  const parts = new Map();
  recs.forEach(x => {
    const k = x.group + '\u0001' + (conferences ? x.division : '');
    if (!parts.has(k)) parts.set(k, []);
    parts.get(k).push(x);
  });
  parts.forEach(list => {
    list.sort((a, b) => {
      if (conferences) {
        const ca = a.cgp ? a.cw / a.cgp : 0, cb = b.cgp ? b.cw / b.cgp : 0;
        if (cb !== ca) return cb - ca;
        if (b.cw !== a.cw) return b.cw - a.cw;
        const oa = a.gp ? a.w / a.gp : 0, ob = b.gp ? b.w / b.gp : 0;
        if (ob !== oa) return ob - oa;
      }
      return (b.pts - a.pts) || (diffOf(b) - diffOf(a)) || (b.pf - a.pf) ||
        (a.stored - b.stored) || String(a.name).localeCompare(String(b.name));
    });
    list.forEach((x, i) => { x.pos = i + 1; });
  });
  return recs;
}

/* Lay `games` over the official rows.
     rows   standings rows (team_id, group_name, gp, w, l, pts_for, pts_against, league_points, conf_*, teams)
     games  [{id, home_team_id, away_team_id, home_score, away_score, conference_game?}] - games in progress
     opts   {winPoints=2, lossPoints=1, conferences=false}
   -> { rows:[{...record, off, pos, move, pts0, touched:[gameId]}], level:[game], applied:[game], skipped:[game] }
   `move` is places gained (positive = up). Rows are in table order (group, then projected position). */
function project(rows, games, opts) {
  const o = opts || {};
  const winPts = isNum(o.winPoints) ? +o.winPoints : 2;
  const lossPts = isNum(o.lossPoints) ? +o.lossPoints : 1;
  const conf = !!o.conferences;

  const official = rank((rows || []).map(rec), conf);
  const off = new Map(official.map(x => [x.team_id, x.pos]));
  const before = new Map(official.map(x => [x.team_id, { pts: x.pts, w: x.w, l: x.l, gp: x.gp, pf: x.pf, pa: x.pa, cw: x.cw, cl: x.cl, cgp: x.cgp, diff: diffOf(x) }]));

  const cur = (rows || []).map(rec);
  const by = new Map(cur.map(x => [x.team_id, x]));
  const applied = [], level = [], skipped = [];
  (games || []).forEach(g => {
    const h = by.get(g.home_team_id), a = by.get(g.away_team_id);
    if (!h || !a || !isNum(g.home_score) || !isNum(g.away_score)) { skipped.push(g); return; }
    const hs = +g.home_score, as = +g.away_score;
    h.touched.push(g.id); a.touched.push(g.id);
    if (hs === as) { level.push(g); return; }
    applied.push(g);
    const win = hs > as ? h : a, lose = hs > as ? a : h;
    const wf = hs > as ? hs : as, lf = hs > as ? as : hs;
    win.gp++; win.w++; win.pf += wf; win.pa += lf; win.pts += winPts;
    lose.gp++; lose.l++; lose.pf += lf; lose.pa += wf; lose.pts += lossPts;
    /* a conference game: the feed's flag where it has one, else two clubs of one conference */
    const isConf = g.conference_game != null ? !!g.conference_game : !!(h.group && h.group === a.group);
    if (conf && isConf) {
      win.cgp++; win.cw++; lose.cgp++; lose.cl++;
    }
  });
  rank(cur, conf);
  cur.forEach(x => {
    x.off = off.get(x.team_id);
    x.move = x.off - x.pos;
    x.before = before.get(x.team_id);
  });
  /* table order: by group name (blank last), then by position */
  cur.sort((a, b) => (a.group === b.group ? 0 : a.group === '' ? 1 : b.group === '' ? -1 : String(a.group).localeCompare(String(b.group))) ||
    (conf ? String(a.division).localeCompare(String(b.division)) : 0) || (a.pos - b.pos));
  return { rows: cur, applied, level, skipped };
}

/* which competitions have a table at all: everything but a pure knockout */
function hasTable(comp) {
  return !!comp && comp.format !== 'knockout';
}

/* ---------------------------------------------------------------- page --- */

const POLL_MS = 15000, IDLE_MS = 60000, MAX_MS = 120000;
const st = {
  compId: null, comp: null, rules: null, rows: null, table: 'idle',   // idle | loading | ready | none | failed
  live: [], liveAt: 0, fails: 0, timer: 0, busy: false, mode: 'now', gen: 0, hooked: false
};
try { if (root.localStorage && root.localStorage.getItem('epinoia_dyn_mode') === 'official') st.mode = 'official'; } catch (_) { /* default */ }

const win = () => (typeof window !== 'undefined' ? window : null);
const page = () => { const w = win(); return w && w.S ? w.S : null; };
const conferences = () => !!(st.comp && st.comp.format === 'conferences');
const periods = () => (st.rules && +st.rules.periods) || 4;

/* the page's own reader (PostgREST path -> rows), which carries a member's token where the league needs one */
function reader() {
  const w = win();
  if (!w || !w.EPINOIA_CONFIG) return null;
  const C = w.EPINOIA_CONFIG;
  return async p => {
    const headers = { apikey: C.supabaseAnonKey, Accept: 'application/json' };
    const A = w.EpinoiaAccess;
    if (A && typeof A.authHeaders === 'function') { try { Object.assign(headers, A.authHeaders() || {}); } catch (_) { /* anonymous */ } }
    const r = await fetch(C.supabaseUrl + '/rest/v1/' + p, { cache: 'no-store', headers });
    if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
    return r.json();
  };
}

/* the table and the league's rules, once per page: two small reads */
async function loadTable() {
  const S = page(), read = reader();
  const cid = S && S.meta && S.meta.competitionId;
  if (!read || !cid) { st.table = 'none'; return; }
  if (st.compId === cid && (st.table === 'ready' || st.table === 'none' || st.table === 'loading')) return;
  st.compId = cid; st.table = 'loading';
  const gen = ++st.gen;
  try {
    const comp = (await read('competitions?id=eq.' + encodeURIComponent(cid) +
      '&select=id,name,kind,format,season_id,seasons(leagues(id,name,rules))&limit=1'))[0];
    if (gen !== st.gen) return;
    if (!comp || !hasTable(comp)) { st.comp = comp || null; st.table = 'none'; return; }
    st.comp = comp;
    st.rules = (((comp.seasons || {}).leagues) || {}).rules || {};
    const ST = win().EpinoiaStandings;
    const teamCols = 'id,name,short_name,slug,colour,logo_path';
    const cols = (ST ? ST.columns(comp, teamCols) : 'rank,gp,w,l,pts_for,pts_against,diff,league_points,deducted_points,group_name,teams(' + teamCols + ')');
    st.rows = await read('standings?competition_id=eq.' + encodeURIComponent(cid) + '&select=' + cols + ',team_id&order=group_name.asc.nullsfirst,rank.asc.nullslast');
    if (gen !== st.gen) return;
    st.table = st.rows.length ? 'ready' : 'none';
  } catch (e) {
    if (gen === st.gen) { st.table = 'failed'; st.fails++; }
  }
}

/* ONE bounded query: the live games of the competition, each with its game_state row (period, clock) */
async function loadLive() {
  const read = reader();
  if (!read || !st.compId || st.table !== 'ready') return false;
  const fields = 'id,status,home_team_id,away_team_id,home_score,away_score,period,game_state(period,clock_ms,running,break_ms)' +
    (conferences() ? ',conference_game' : '');
  const rows = await read('games?competition_id=eq.' + encodeURIComponent(st.compId) + '&status=eq.live&select=' + fields + '&limit=40');
  st.live = rows || []; st.liveAt = Date.now();
  return true;
}

/* the games the projection runs on: the polled ones, with the viewed game as this page has it
   (its own frames are newer than any poll), and a viewed game that is not live left out */
function liveGames(d) {
  const S = page(), m = (S && S.meta) || {};
  const me = currentId();
  const out = st.live.filter(g => g.id !== me).map(g => {
    const gs = g.game_state || {};
    return Object.assign({}, g, { period: isNum(gs.period) ? gs.period : g.period, clock_ms: gs.clock_ms, brk: num(gs.break_ms) > 0 });
  });
  if (S && S.status === 'live' && m.homeTeamId && m.awayTeamId && d && d.score) {
    const polled = st.live.find(g => g.id === me);
    out.unshift({ id: me, mine: true, status: 'live', home_team_id: m.homeTeamId, away_team_id: m.awayTeamId,
      home_score: d.score[0], away_score: d.score[1], period: S.period, clock_ms: S.clockMs,
      conference_game: polled ? polled.conference_game : undefined });
  }
  return out;
}
function currentId() {
  try { const q = new URLSearchParams(location.search).get('g'); if (q) return q;
    const e = document.querySelector('meta[name="epinoia-entity"]'); return e ? e.content : ''; } catch (_) { return ''; }
}
const gameHref = id => {
  let base = '';
  try { base = new URL('./', (document.currentScript && document.currentScript.src) || SCRIPT_SRC).href; } catch (_) { base = ''; }
  return base + '?g=' + encodeURIComponent(id);
};
const SCRIPT_SRC = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';

const teamOf = (S, id) => {
  const m = (S && S.meta) || {};
  return id === m.homeTeamId ? m.home : id === m.awayTeamId ? m.away : null;
};

function liveStamp(g) {
  if (g.brk) return periodLabel(g.period, periods()) + ' break';
  const c = clockLabel(g.clock_ms);
  return (periodLabel(g.period, periods()) + ' ' + c).trim();
}

/* ---- markup ---- */
function liveListHTML(P, games, d) {
  const S = page();
  const names = id => { const r = P.rows.find(x => x.team_id === id); return r ? r.name : ''; };
  const items = games.map(g => {
    const h = names(g.home_team_id), a = names(g.away_team_id);
    const lvl = +g.home_score === +g.away_score;
    return '<li class="dt-g' + (g.mine ? ' mine' : '') + '"><span class="dt-dot" aria-hidden="true"></span>' +
      '<a class="dt-gl" href="' + esc(gameHref(g.id)) + '">' +
      '<span class="dt-gt">' + esc(h) + '</span> <b class="dt-gs">' + esc(g.home_score) + '</b><span class="dt-gsep">-</span><b class="dt-gs">' + esc(g.away_score) + '</b> <span class="dt-gt">' + esc(a) + '</span></a>' +
      '<span class="dt-gp">' + esc(liveStamp(g)) + '</span>' +
      (g.mine ? '<span class="dt-tag">this game</span>' : '') +
      (lvl ? '<span class="dt-lvl">level: projected as a tie</span>' : '') + '</li>';
  }).join('');
  return '<ul class="dt-games">' + items + '</ul>';
}

function moveHTML(m) {
  if (m > 0) return '<span class="dt-mv up" title="up ' + m + '"><i aria-hidden="true">&#9650;</i><b>' + m + '</b></span>';
  if (m < 0) return '<span class="dt-mv dn" title="down ' + (-m) + '"><i aria-hidden="true">&#9660;</i><b>' + (-m) + '</b></span>';
  return '<span class="dt-mv eq" title="no change"><i aria-hidden="true">&ndash;</i></span>';
}
const sign = n => (n > 0 ? '+' : '') + n;

function tableHTML(P, games, viewIds, colours, showNow, ST) {
  const S = page();
  const conf = conferences();
  const byGame = new Map(games.map(g => [g.id, g]));
  const groups = [];
  /* the official view is in the official order: within each table, by the place held before the live games */
  let ordered = P.rows;
  if (!showNow) {
    const gi = new Map();
    P.rows.forEach(r => { const k = r.group + '\u0001' + (conf ? r.division : ''); if (!gi.has(k)) gi.set(k, gi.size); });
    ordered = P.rows.slice().sort((x, y) => (gi.get(x.group + '\u0001' + (conf ? x.division : '')) - gi.get(y.group + '\u0001' + (conf ? y.division : ''))) || (x.off - y.off));
  }
  ordered.forEach(r => {
    const key = r.group + '\u0001' + (conf ? r.division : '');
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, group: r.group, division: r.division, rows: [] }; groups.push(g); }
    g.rows.push(r);
  });
  const anyPlayed = P.rows.some(r => r.gp > 0);
  return groups.map(g => {
    const head = (g.group || g.division)
      ? '<caption>' + esc([g.group ? (ST ? ST.groupLabel(g.group, st.comp) : (/\s/.test(g.group) ? g.group : 'Group ' + g.group)) : '', g.division].filter(Boolean).join(' · ')) + '</caption>' : '';
    const crest = r => {
      const url = typeof window !== 'undefined' && window.epinoiaLogoUrl && r.logo ? window.epinoiaLogoUrl(r.logo) : null;
      return '<span class="crest" style="background:' + esc(r.colour || 'var(--lume)') + '">' +
        (url ? '<img src="' + esc(url) + '" alt="" style="width:100%;height:100%;object-fit:contain;display:block;border-radius:inherit;background:#fff" onerror="this.remove()">' : esc(r.short || '')) + '</span>';
    };
    const pct = (w, gp) => (ST && ST.pct ? ST.pct(w, gp) : (gp ? (w / gp).toFixed(3).replace(/^0/, '') : '—'));
    const rec = (w, l) => (ST && ST.record ? ST.record(w, l) : w + '-' + l);
    const body = g.rows.map(r => {
      const lit = viewIds.indexOf(r.team_id) !== -1;
      const b0 = r.before;
      const pos = showNow ? r.pos : r.off;
      const mv = showNow ? r.move : 0;
      const gp = showNow ? r.gp : b0.gp, w = showNow ? r.w : b0.w, l = showNow ? r.l : b0.l;
      const pf = showNow ? r.pf : b0.pf, pa = showNow ? r.pa : b0.pa;
      const pts = showNow ? r.pts : b0.pts;
      const diff = pf - pa;
      const cw = showNow ? r.cw : b0.cw, cl = showNow ? r.cl : b0.cl, cgp = showNow ? r.cgp : b0.cgp;
      const mark = showNow ? r.touched.map(id => {
        const gm = byGame.get(id); if (!gm) return '';
        const own = gm.home_team_id === r.team_id;
        const my = own ? gm.home_score : gm.away_score, their = own ? gm.away_score : gm.home_score;
        const lvl = +my === +their;
        return '<a class="dt-mk' + (lvl ? ' lvl' : +my > +their ? ' w' : ' l') + '" href="' + esc(gameHref(id)) + '" title="' +
          esc(liveStamp(gm) + (lvl ? ' - level: projected as a tie' : '')) + '"><span class="dt-dot" aria-hidden="true"></span>' +
          esc(my + '-' + their) + ' <span class="dt-mp">' + esc(liveStamp(gm)) + '</span></a>';
      }).join('') : '';
      const dCol = diff > 0 ? 'var(--good)' : diff < 0 ? 'var(--bad)' : '';
      const dock = r.dock ? '<span class="dock" title="' + r.dock + ' points deducted"> &minus;' + r.dock + '</span>' : '';
      return '<tr' + (lit ? ' class="lit"' : '') + ' style="--tc:' + esc(colours[r.team_id] || r.colour || 'var(--rule-2)') + '"' +
        (r.touched.length && showNow ? ' data-live="1"' : '') + '>' +
        '<td class="rk">' + pos + (showNow ? moveHTML(mv) : '') + '</td>' +
        '<td><div class="tname-cell">' + crest(r) + (r.slug ? '<a href="../t/?t=' + encodeURIComponent(r.slug) + '">' + esc(r.name) + '</a>' : '<span>' + esc(r.name) + '</span>') + '</div>' +
          (mark ? '<span class="dt-marks">' + mark + '</span>' : '') + '</td>' +
        (conf
          ? '<td class="rec">' + rec(cw, cl) + '</td><td>' + pct(cw, cgp) + '</td><td class="rec">' + rec(w, l) + '</td><td>' + pct(w, gp) + '</td>'
          : '<td>' + gp + '</td><td>' + w + '</td><td>' + l + '</td><td>' + pct(w, gp) + '</td>') +
        '<td>' + pf + '</td><td>' + pa + '</td>' +
        '<td' + (dCol ? ' style="color:' + dCol + '"' : '') + '>' + sign(diff) + '</td>' +
        (conf ? '' : '<td class="pts">' + pts + dock + '</td>') + '</tr>';
    }).join('');
    const heads = conf
      ? ['#', 'TEAM', 'CONF W-L', 'CONF PCT', 'W-L', 'PCT', 'PF', 'PA', 'DIFF']
      /* WIN% beside the record, as on every table; the order stays the projection's (league points), since this is the
         table the live games move, read against the official one by places gained and lost */
      : ['#', 'TEAM', 'GP', 'W', 'L', 'WIN%', 'PF', 'PA', 'DIFF', 'PTS'];
    return '<div class="ep-tw dt-tw">' + (head ? '<div class="dt-cap">' + head.replace(/^<caption>|<\/caption>$/g, '') + '</div>' : '') +
      '<table class="ep-tbl stand" style="min-width:700px"><thead><tr>' +
      heads.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }).join('') + (anyPlayed ? '' : '<p class="dt-note">No games have finished in this competition yet.</p>');
}

function render(S, d) {
  S = S || page();
  d = d || (win() && win().derive ? win().derive() : null);
  const m = (S && S.meta) || {};
  kick(S);
  const head = '<div class="dt-top"><h3 class="dt-h">Dynamic tables</h3></div>';
  if (st.table === 'idle' || st.table === 'loading') return '<div class="dt" data-dt="1">' + head + '<div class="msg">Loading the league table&hellip;</div></div>';
  if (st.table === 'failed') return '<div class="dt" data-dt="1">' + head + '<div class="msg">The league table could not be loaded. Trying again shortly.</div></div>';
  if (st.table === 'none') return '<div class="dt" data-dt="1">' + head + '<div class="msg">There is no league table for this competition' +
    (st.comp && st.comp.name ? ' (' + esc(st.comp.name) + ')' : '') + ', so there is nothing for a live game to move.</div></div>';

  const ST = win() && win().EpinoiaStandings;
  const games = liveGames(d);
  const r = st.rules || {};
  const sch = inferScheme(st.rows, r);
  const P = project(st.rows, games, { winPoints: sch.win, lossPoints: sch.loss, conferences: conferences() });
  const anyLive = games.length > 0;
  const showNow = st.mode === 'now' && anyLive;
  const others = games.filter(g => !g.mine).length;
  const viewIds = [m.homeTeamId, m.awayTeamId].filter(Boolean);
  const colours = {};
  const col = (t, x) => { try { return win().EpinoiaTeamColour && win().EpinoiaTeamColour.ink ? win().EpinoiaTeamColour.ink(x) : x; } catch (_) { return x; } };
  if (m.homeTeamId && m.home && m.home.colour) colours[m.homeTeamId] = col(0, m.home.colour);
  if (m.awayTeamId && m.away && m.away.colour) colours[m.awayTeamId] = col(1, m.away.colour);

  const sw = '<div class="dt-sw" role="tablist">' +
    [['now', 'as it stands now'], ['official', 'official table']].map(x =>
      '<button type="button" role="tab" data-dtmode="' + x[0] + '"' + (st.mode === x[0] ? ' class="on" aria-selected="true"' : '') + '>' + x[1] + '</button>').join('') + '</div>';

  let lede;
  if (!anyLive) {
    lede = '<p class="dt-lede">No games are live in this league right now. This is the official table' +
      (S && S.status === 'scheduled' ? '; projected outcomes appear here once a game is being played.' : '.') + '</p>';
  } else if (!others) {
    lede = '<p class="dt-lede">No other games are live in this league right now. The table has this game\'s current score applied.</p>';
  } else {
    lede = '<p class="dt-lede">' + games.length + ' game' + (games.length === 1 ? ' is' : 's are') + ' live in ' + esc(st.comp.name || 'this competition') + '.</p>';
  }
  const levels = P.level.length
    ? '<p class="dt-note">A level score is provisional: a basketball game cannot end level, so a game that is level right now is shown as a tie and moves nobody until one side leads.</p>' : '';
  const legend = '<p class="dt-legend"><span class="dt-mv up"><i aria-hidden="true">&#9650;</i></span> places gained, ' +
    '<span class="dt-mv dn"><i aria-hidden="true">&#9660;</i></span> places lost against the official table, ' +
    '<span class="dt-mv eq"><i aria-hidden="true">&ndash;</i></span> unchanged. Provisional until the games finish: ' +
    'a game counts as a win or loss on its current score, and the table is ordered by ' +
    (conferences() ? 'conference record, then league points and point difference' : 'league points, then point difference, then points scored') + '.</p>';

  return '<div class="dt" data-dt="1">' + head + lede +
    (anyLive ? liveListHTML(P, games, d) : '') +
    (anyLive ? '<div class="dt-bar">' + sw + '</div>' : '') +
    tableHTML(P, games, viewIds, colours, showNow, ST) +
    levels + legend + '</div>';
}

/* ---- live: draw again in place when data arrives, poll while the tab is on screen ---- */
function host() { return typeof document !== 'undefined' ? document.querySelector('#csBody .dt') : null; }
function redraw() {
  const h = host(); if (!h) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = render();
  const fresh = tmp.firstElementChild;
  if (!fresh) return;
  const keep = [...h.querySelectorAll('.dt-tw')].map(x => x.scrollLeft);
  h.replaceWith(fresh);
  fresh.querySelectorAll('.dt-tw').forEach((x, i) => { if (keep[i]) x.scrollLeft = keep[i]; });
  bind(fresh);
}
function bind(el) {
  el.querySelectorAll('[data-dtmode]').forEach(b => {
    b.onclick = () => {
      st.mode = b.dataset.dtmode;
      try { root.localStorage.setItem('epinoia_dyn_mode', st.mode); } catch (_) { /* fine */ }
      redraw();
    };
  });
}
let firstLoad = null;
function kick(S) {
  if (st.table === 'idle' && !firstLoad) {
    firstLoad = loadTable().then(() => { firstLoad = null; return loadLive().catch(() => false); })
      .then(() => { redraw(); schedule(); }).catch(() => { firstLoad = null; });
  }
}
function schedule(now) {
  clearTimeout(st.timer);
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc || !host() || doc.hidden) return;
  const base = st.live.length || (page() && page().status === 'live') ? POLL_MS : IDLE_MS;
  const wait = st.fails ? Math.min(MAX_MS, base * Math.pow(2, st.fails)) : base;
  st.timer = setTimeout(tick, now ? 0 : wait);
}
async function tick() {
  if (!host() || document.hidden) return;
  if (st.busy) return schedule();
  st.busy = true;
  try {
    if (st.table === 'failed') { st.table = 'idle'; await loadTable(); }
    if (st.table === 'ready') { await loadLive(); st.fails = 0; }
  } catch (_) { st.fails = Math.min(st.fails + 1, 6); }
  st.busy = false;
  redraw(); schedule();
}
/* called by the page after the tab's HTML is in */
function mounted(el) {
  const h = (el && el.querySelector && el.querySelector('.dt')) || host();
  if (h) bind(h);
  if (typeof document !== 'undefined' && !st.hooked) {
    st.hooked = true;
    /* back on screen: refresh at once if the last read is older than a poll, else carry on */
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearTimeout(st.timer); return; }
      if (host()) schedule(Date.now() - st.liveAt > POLL_MS);
    });
  }
  if (st.table === 'ready' && Date.now() - st.liveAt > POLL_MS) schedule(true); else schedule();
}

return { project, rank, inferScheme, hasTable, periodLabel, clockLabel, render, mounted, TAB: ['dyn', 'dynamic tables'], _state: st };
}));
