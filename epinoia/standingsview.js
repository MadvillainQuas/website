'use strict';
/* ============================================================================
   A LEAGUE'S STANDINGS, DRAWN — shared by the table page's Table tab (l/league.js) and a league's front page (home.js,
   its TABLE & LEADERS group; Louie, 2026-10-15: "use the same style as table for the table ... show the full league
   table"). Moved here out of l/league.js so the two can never drift: the strips of kit/standings.css, the crest in a
   white disc ringed in the club's colour, WIN% and PTS as buttons that order every table on the page, the streak as
   blocks, the ELO column, and a conference league's two records.

     EpinoiaStandingsView.render(pane, o)        reads a competition's standings and draws them into pane
         o: { api (path -> rows, the page's own reader), competition ({ id, format, ... }), base (the epinoia/ root as
              the page sees it: '../' on l/, '' on a league's front page), eloIds (the competitions the ELO is worked
              over: the season's, else this one) }
     EpinoiaStandingsView.groupTable(rows, o)    one table (o: { base, elo: Map team id -> rating, or null })
     EpinoiaStandingsView.conferences(pane, rows, ST, competition, o)
     EpinoiaStandingsView.loadElo(api, ids)      sos.js's rating for every club over those competitions' games (cached)

   The ranking is never done here: standings.js orders the rows (byWinPct) and recompute_standings ranked them.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStandingsView = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const W = () => (typeof window !== 'undefined' ? window : root);

/* THE ORDER OF THE TABLE. A reader meets it in winning-percentage order (standings.js byWinPct:
   level percentages keep the league's points-and-tiebreak order, a club with no games goes last)
   and the # follows what is on screen. The WIN% and PTS headers are buttons: PTS puts the table
   back in the official order (league points, then the league's tiebreak rules: the stored rank).
   The choice lasts for the page's life and every table on it follows it. */
let tableOrder = 'pct';
const ORDERED = new Set();          // the tables drawn, each one's redraw; a click redraws every one still on the page (and forgets the rest)

function sortHead(label, key, title) {
  const th = el('th', 'sorted-' + key);
  const b = el('button', 'sorth', label);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', () => {
    if (tableOrder === key) return;
    tableOrder = key;
    ORDERED.forEach(f => { if (!f()) ORDERED.delete(f); });
  });
  th.appendChild(b);
  return th;
}

function groupTable(rows, opts) {
  const o = opts || {};
  const ST = W().EpinoiaStandings;
  const wrap = el('div', 'ep-tw');
  const t = el('table', 'ep-tbl stand ord'); t.style.minWidth = '740px';
  const thead = el('thead'); const hr = el('tr');
  const heads = {};
  ['#', 'TEAM', 'GP', 'W', 'L', 'WIN%', 'PF', 'PA', 'DIFF', 'PTS', 'STREAK', 'ELO'].forEach(h => {
    const th = h === 'ELO' ? eloHead()
      : h === 'WIN%' ? sortHead('WIN%', 'pct', 'Order by winning percentage')
      : h === 'PTS' ? sortHead('PTS', 'pts', 'Order by league points: the official order')
      : el('th', null, h);
    if (h === 'WIN%' || h === 'PTS') heads[h === 'WIN%' ? 'pct' : 'pts'] = th;
    hr.appendChild(th);
  });
  thead.appendChild(hr); t.appendChild(thead);
  const tb = el('tbody');
  t.appendChild(tb); wrap.appendChild(t);

  const draw = () => {
    if (!wrap.isConnected && tb.childNodes.length) return false;     // a table no longer on the page
    const pct = tableOrder === 'pct' && ST && ST.byWinPct;
    Object.keys(heads).forEach(k => heads[k].setAttribute('aria-sort', k === tableOrder ? 'descending' : 'none'));
    tb.textContent = '';
    (pct ? ST.byWinPct(rows) : rows.slice().sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))).forEach(r => {
      const tr = el('tr');
      if (r.teams && r.teams.colour) tr.style.setProperty('--tc', r.teams.colour);
      tr.appendChild(el('td', 'rk', pct ? r.pos : (r.rank ?? '')));
      tr.appendChild(teamCell(r.teams, o.base));

      [r.gp, r.w, r.l].forEach(v => tr.appendChild(el('td', null, v)));
      tr.appendChild(el('td', 'wpct' + (pct ? ' key' : ''), ST ? ST.pct(r.w, r.gp) : (r.gp ? (r.w / r.gp).toFixed(3) : '—')));
      [r.pts_for, r.pts_against].forEach(v => tr.appendChild(el('td', null, v)));
      tr.appendChild(diffCell(r.diff));
      /* A DOCKED TOTAL HAS TO SAY SO. Without the marker the points column
         simply does not follow from the W-L beside it, and the first thing
         anybody does with a table that does not add up is assume it is broken. */
      const pts = el('td', 'pts' + (pct ? '' : ' key'), r.league_points);
      if (r.deducted_points) {
        const d = el('span', 'dock', ' −' + r.deducted_points);
        d.title = r.deducted_points + ' points deducted';
        pts.appendChild(d);
      }
      tr.appendChild(pts);
      tr.appendChild(streakCell(r.streak));
      tr.appendChild(eloCell(r.team_id, o.elo));
      tb.appendChild(tr);
    });
    return true;
  };
  draw();
  ORDERED.add(draw);
  return wrap;
}

/* the club's crest and name, linked to its page (base: the epinoia/ root as the page sees it) */
function teamCell(teams, base) {
  const tm = teams || {};
  const nameTd = el('td');
  const cell = el('div', 'tname-cell');
  const crest = el('span', 'crest', tm.short_name || '');
  crest.style.background = tm.colour || 'var(--lume)';
  const logo = W().epinoiaLogoUrl;
  const crestUrl = logo ? logo(tm.logo_path) : null;
  if (crestUrl) {
    const img = document.createElement('img');
    img.src = crestUrl; img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;border-radius:inherit;background:#fff';
    img.addEventListener('error', () => img.remove());
    crest.textContent = ''; crest.appendChild(img);
  }
  const a = el('a', null, tm.name || '');
  a.href = (base == null ? '../' : base) + 't/?t=' + encodeURIComponent(tm.slug || '');
  cell.append(crest, a); nameTd.appendChild(cell);
  return nameTd;
}

function diffCell(diff) {
  const d = el('td', null, (diff > 0 ? '+' : '') + diff);
  d.style.color = diff > 0 ? 'var(--good)' : (diff < 0 ? 'var(--bad)' : '');
  return d;
}

/* THE ELO COLUMN: sos.js's rating for every club (loadElo below), 1500 the average. A dash where there is none. */
function eloHead() {
  const th = el('th', 'elo', 'ELO');
  th.title = 'ELO rating, updated after every game. 1500 is average.';
  return th;
}
function eloCell(teamId, elo) {
  const v = elo && teamId ? elo.get(teamId) : null;
  const td = el('td', 'elo', v == null ? '—' : String(Math.round(v)));
  td.title = 'ELO rating, updated after every game. 1500 is average.';
  return td;
}

/* THE STREAK AS BLOCKS: one small square per game of the run, ticked green for a win, crossed red for
   a loss, up to five and then the count ("W7" is five ticks and +2). The text stays for a screen reader
   and on hover. A club with no run yet gets an empty cell. */
function streakCell(streak) {
  const st = el('td', 'streak');
  const m = /^([WL])\s*(\d+)$/i.exec(String(streak || '').trim());
  if (!m) { st.textContent = streak || ''; return st; }
  const win = m[1].toUpperCase() === 'W', n = +m[2];
  const label = (win ? 'Won ' : 'Lost ') + n + ' in a row';
  const box = el('span', 'stk ' + (win ? 'w' : 'l'));
  box.title = label;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label);
  for (let i = 0; i < Math.min(n, 5); i++) box.appendChild(el('i'));
  if (n > 5) box.appendChild(el('b', null, '+' + (n - 5)));
  st.appendChild(box);
  return st;
}

/* ------------------------------------------------------ conference tables --- */
/* THE COLLEGE TABLE (0144). A conference league is not read as one ladder:
   each club's standing is read inside its own conference, and it carries two
   records — CONFERENCE (only the games against its own conference) and
   OVERALL (the complete schedule, non-conference games and playoffs
   included). The conference record comes first and decides the order, because
   it is what seeds a conference's playoffs; recompute_standings has already
   ranked it so, within each division where a conference has them.

   OVERALL is the other question a reader brings to a college league — who has
   the best record in the whole thing — so it is one click away, as one table
   ranked by the complete schedule. */
let confView = 'conf';

function conferences(pane, rows, ST, competition, opts) {
  const o = opts || {};
  const host = el('div');
  const pick = el('div', 'phasepick');
  pick.style.margin = '0 0 12px';
  [['conf', 'By conference'], ['all', 'Overall']].forEach(([k, label]) => {
    const b = el('button', 'ep-chip' + (confView === k ? ' on' : ''), label);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (confView === k) return;
      confView = k;
      pane.textContent = '';
      conferences(pane, rows, ST, competition, o);
    });
    pick.appendChild(b);
  });
  host.appendChild(pick);

  if (confView === 'all') {
    host.appendChild(overallTable(ST.overall(rows), ST, o));
  } else {
    ST.split(rows).forEach(g => {
      host.appendChild(el('div', 'grouphead', ST.groupLabel(g.name, competition)));
      g.divisions.forEach(d => {
        if (d.name) host.appendChild(el('div', 'divhead', d.name));
        host.appendChild(conferenceTable(d.rows, ST, o));
      });
    });
    host.appendChild(el('div', 'tblnote',
      'Conference: games against the club\'s own conference only, which decides the order. ' +
      'Overall: the complete schedule, non-conference games and playoffs included.'));
  }
  pane.appendChild(host);
}

function recordCells(tr, w, l, gp, ST, strong) {
  const rec = el('td', 'rec', ST.record(w, l));
  if (strong) rec.style.color = 'var(--ink)';
  tr.appendChild(rec);
  tr.appendChild(el('td', null, ST.pct(w, gp)));
}

function conferenceTable(rows, ST, o) {
  const wrap = el('div', 'ep-tw');
  const t = el('table', 'ep-tbl stand'); t.style.minWidth = '700px';
  const thead = el('thead');
  const top = el('tr');
  [['', 2], ['CONFERENCE', 2], ['OVERALL', 2], ['', 5]].forEach(([h, n]) => {
    const th = el('th', 'spanhead', h); th.colSpan = n; top.appendChild(th);
  });
  const hr = el('tr');
  ['#', 'TEAM', 'W-L', 'PCT', 'W-L', 'PCT', 'PF', 'PA', 'DIFF', 'STREAK', 'ELO']
    .forEach(h => hr.appendChild(h === 'ELO' ? eloHead() : el('th', null, h)));
  thead.append(top, hr); t.appendChild(thead);

  const tb = el('tbody');
  rows.forEach(r => {
    const tr = el('tr');
    if (r.teams && r.teams.colour) tr.style.setProperty('--tc', r.teams.colour);
    tr.appendChild(el('td', 'rk', r.rank ?? ''));
    tr.appendChild(teamCell(r.teams, o.base));
    recordCells(tr, r.conf_w, r.conf_l, r.conf_gp, ST, true);
    recordCells(tr, r.w, r.l, r.gp, ST, false);
    tr.appendChild(el('td', null, r.pts_for));
    tr.appendChild(el('td', null, r.pts_against));
    tr.appendChild(diffCell(r.diff));
    tr.appendChild(streakCell(r.streak));
    tr.appendChild(eloCell(r.team_id, o.elo));
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t);
  return wrap;
}

function overallTable(rows, ST, o) {
  const wrap = el('div', 'ep-tw');
  const t = el('table', 'ep-tbl stand'); t.style.minWidth = '740px';
  const thead = el('thead'); const hr = el('tr');
  ['#', 'TEAM', 'CONF.', 'W-L', 'PCT', 'CONF. W-L', 'PF', 'PA', 'DIFF', 'STREAK', 'ELO']
    .forEach(h => hr.appendChild(h === 'ELO' ? eloHead() : el('th', null, h)));
  thead.appendChild(hr); t.appendChild(thead);

  const tb = el('tbody');
  rows.forEach(r => {
    const tr = el('tr');
    if (r.teams && r.teams.colour) tr.style.setProperty('--tc', r.teams.colour);
    tr.appendChild(el('td', 'rk', r.overall_rank));
    tr.appendChild(teamCell(r.teams, o.base));
    tr.appendChild(el('td', null, [r.group_name, r.division_name].filter(Boolean).join(' · ')));
    recordCells(tr, r.w, r.l, r.gp, ST, true);
    tr.appendChild(el('td', 'rec', ST.record(r.conf_w, r.conf_l)));
    tr.appendChild(el('td', null, r.pts_for));
    tr.appendChild(el('td', null, r.pts_against));
    tr.appendChild(diffCell(r.diff));
    tr.appendChild(streakCell(r.streak));
    tr.appendChild(eloCell(r.team_id, o.elo));
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t);
  return wrap;
}

/* ---------------------------------------------------------------- the ELO --- */
/* sos.js's rating for every club, worked from the competitions' finalised games (the rating needs only the scores and
   the order of play), kept for the page's life per set of competitions. Null when there is nothing to show: the column
   is then drawn with dashes rather than the table failing. Never throws. */
const ELO_CACHE = new Map();
async function loadElo(api, ids) {
  const X = W().EpinoiaSOS;
  const list = (ids || []).filter(Boolean);
  if (!X || !X.eloRatings || !api || !list.length) return null;
  const key = list.slice().sort().join(',');
  try {
    if (!ELO_CACHE.has(key)) {
      const games = await api(`games?competition_id=in.(${list.join(',')})&status=in.(final,finalising)` +
        `&select=id,home_team_id,away_team_id,home_score,away_score,tipoff_at`);
      const m = new Map();
      X.eloRatings(games).forEach((r, id) => m.set(id, r.elo));
      ELO_CACHE.set(key, m);
    }
    return ELO_CACHE.get(key);
  } catch (e) { if (typeof console !== 'undefined') console.warn('[elo]', e); return null; }
}

/* ------------------------------------------------------------ the whole read --- */
/* A COMPETITION'S STANDINGS, READ AND DRAWN: a table, a table per group (ProB Nord / Süd), or a conference league's
   tables. The ELO is asked for beside the standings, not after them: the two need nothing from each other. */
async function render(pane, o) {
  const ST = W().EpinoiaStandings;
  const competition = o.competition;
  const teamCols = 'name,short_name,colour,slug,logo_path';
  const cols = ST ? ST.columns(competition, teamCols)
    : `rank,gp,w,l,pts_for,pts_against,diff,league_points,deducted_points,streak,group_name,teams(${teamCols})`;
  const eloP = loadElo(o.api, (o.eloIds && o.eloIds.length) ? o.eloIds : [competition.id]);
  const rows = await o.api(
    `standings?competition_id=eq.${competition.id}` +
    `&select=${cols},team_id` +
    `&order=group_name.asc,rank.asc`);
  if (!rows.length) { pane.appendChild(el('div', 'empty', 'No games played yet.')); return rows; }
  const elo = await eloP;
  const view = { base: o.base, elo };
  if (ST && ST.isConferences(competition)) { conferences(pane, rows, ST, competition, view); return rows; }
  const groups = new Map();
  rows.forEach(r => {
    const k = r.group_name || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  groups.forEach((groupRows, name) => {
    if (name) pane.appendChild(el('div', 'grouphead', ST ? ST.groupLabel(name, competition) : 'Group ' + name));
    pane.appendChild(groupTable(groupRows, view));
  });
  return rows;
}

return { render, groupTable, conferences, conferenceTable, overallTable, teamCell, diffCell, streakCell, eloHead, eloCell, loadElo };
}));
