'use strict';
/* ============================================================================
   CONNECTIONS — the GAMEVIS tab, on the EPINOIA box score.

   A port of GAMEVIS_with_ShotChart_v2_6.html's renderConnectionsTab: who
   assisted whom, per side, as cards (the ten most frequent pairs a side, a bar
   scaled against the most frequent pair in the GAME) or as a full table.

   GAMEVIS keys a combination "team|assister|scorer" and counts, for each, the
   assists, the points they produced, and how many were threes and twos. The
   scorer of an assisted basket is the last made field goal the assisting side
   scored — its "lastScorer" rule, cleared once an assist has used it so one
   basket can never be assisted twice. EPINOIA's log records an assist exactly
   that way, straight after the basket it belongs to (engine.js credits points
   assisted from the same "last made" value), so the rule carries over as it is.
   A free throw is never assisted, and an and-one's free throw is not part of
   the assisted points: GAMEVIS takes the points of the SHOT.

   PPP here is GAMEVIS's own column: points per assist of that pair, not per
   possession.

   The cards / table choice survives a live redraw (a module-level setting, and
   the page's body key rebuilds this tab only when the log changes).
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaConnections = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const PLEN = p => (p <= 4 ? 600000 : 300000);
function cumEl(p, clk) { let s = 0; for (let q = 1; q < p; q++) s += PLEN(q); return s + (PLEN(p) - clk); }
function inGameOrder(evs) {
  const keyed = evs.map((ev, i) => ({ ev, i, k: cumEl(ev.period || 1, ev.clock != null ? ev.clock : PLEN(ev.period || 1)) }));
  keyed.sort((a, b) => (a.k - b.k) || (a.i - b.i));
  return keyed.map(x => x.ev);
}
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------------------------------------------------------------- compute --- */
function compute(S) {
  const teams = (S && S.teams) || [{}, {}];
  const pmap = {};
  teams.forEach((tm, t) => (tm.players || []).forEach(p => { pmap[p.id] = p; }));
  const nameOf = pid => {
    const p = pmap[pid];
    if (!p) return '#?';
    return p.name || (p.num != null && p.num !== '' ? '#' + p.num : '#?');
  };

  const combos = {};
  const order = [];
  let last = null;                                   // the last made field goal: { team, pid, pts, three }
  inGameOrder((S && S.events) || []).forEach(ev => {
    if ((ev.t === 'p2_made' || ev.t === 'p3_made') && ev.pid) {
      last = { team: ev.team, pid: ev.pid, pts: ev.t === 'p3_made' ? 3 : 2, three: ev.t === 'p3_made' };
    } else if (ev.t === 'ast') {
      const scorer = last && last.team === ev.team ? last : null;
      if (ev.pid && scorer) {
        const key = ev.team + '|' + ev.pid + '|' + scorer.pid;
        if (!combos[key]) {
          combos[key] = { team: ev.team, assister: ev.pid, scorer: scorer.pid,
                          assisterName: nameOf(ev.pid), scorerName: nameOf(scorer.pid),
                          count: 0, points: 0, threes: 0, twos: 0 };
          order.push(key);
        }
        const c = combos[key];
        c.count++;
        c.points += scorer.pts;
        if (scorer.three) c.threes++; else c.twos++;
      }
      last = null;
    }
  });

  /* most frequent first; a tie keeps the order the pair first appeared, as a stable sort does */
  const all = order.map(k => combos[k]).sort((a, b) => b.count - a.count);
  return {
    all,
    byTeam: [all.filter(c => c.team === 0), all.filter(c => c.team === 1)],
    maxCount: all.length ? Math.max(...all.map(c => c.count)) : 0
  };
}

/* ----------------------------------------------------------------- render --- */
let view = 'cards';

const ppp = c => (c.count > 0 ? (c.points / c.count).toFixed(2) : '0.00');
const person = (pid, name, cls) => UUID.test(pid || '')
  ? '<a class="' + cls + '" href="../p/?p=' + encodeURIComponent(pid) + '">' + esc(name) + '</a>'
  : '<span class="' + cls + '">' + esc(name) + '</span>';

function cardHTML(c, maxCount) {
  const side = c.team === 0 ? 'home' : 'away';
  const width = maxCount ? (c.count / maxCount) * 100 : 0;
  return '<div class="cx-card">' +
    '<div class="cx-card-head"><span class="cx-dot ' + side + '"></span>' +
      '<div class="cx-players">' + person(c.assister, c.assisterName, 'cx-passer') +
        '<span class="cx-arrow">→</span>' + person(c.scorer, c.scorerName, 'cx-scorer') + '</div></div>' +
    '<div class="cx-stats">' +
      '<div class="cx-main"><div class="cx-count">' + c.count + '</div><div class="cx-label">assists</div></div>' +
      '<div class="cx-details">' +
        '<div class="cx-detail"><span class="cx-value">' + c.points + '</span><span class="cx-dlabel">PTS</span></div>' +
        '<div class="cx-detail"><span class="cx-value">' + ppp(c) + '</span><span class="cx-dlabel">PPP</span></div>' +
        '<div class="cx-detail"><span class="cx-value three">' + c.threes + '</span><span class="cx-dlabel">3PT</span></div>' +
        '<div class="cx-detail"><span class="cx-value two">' + c.twos + '</span><span class="cx-dlabel">2PT</span></div>' +
      '</div></div>' +
    '<div class="cx-bar-track"><div class="cx-bar ' + side + '" style="width:' + width.toFixed(1) + '%"></div></div>' +
  '</div>';
}

function tableHTML(list) {
  return '<div class="cx-table-wrap"><table class="cx-table">' +
    '<thead><tr><th></th><th>Passer</th><th>Scorer</th><th>AST</th><th>PTS</th><th>PPP</th><th>3PT</th><th>2PT</th></tr></thead>' +
    '<tbody>' + list.map(c =>
      '<tr><td><span class="cx-dot ' + (c.team === 0 ? 'home' : 'away') + '"></span></td>' +
      '<td>' + person(c.assister, c.assisterName, 'cx-passer') + '</td>' +
      '<td>' + person(c.scorer, c.scorerName, 'cx-scorer') + '</td>' +
      '<td class="cx-num cx-ast">' + c.count + '</td>' +
      '<td class="cx-num cx-pts">' + c.points + '</td>' +
      '<td class="cx-num cx-ppp">' + ppp(c) + '</td>' +
      '<td class="cx-num three">' + c.threes + '</td>' +
      '<td class="cx-num two">' + c.twos + '</td></tr>').join('') +
    '</tbody></table></div>';
}

function render(S) {
  const C = compute(S);
  const names = [0, 1].map(t => (S && S.teams && S.teams[t] && S.teams[t].name) || (t ? 'Away' : 'Home'));
  if (!C.all.length) {
    return '<div class="cx"><section class="cx-section cx-empty">' +
      '<h3>No connection data available</h3>' +
      '<p>Assist combinations appear once the play-by-play records an assist.</p>' +
      '</section></div>';
  }
  const toggle = '<div class="cx-toggle" role="tablist">' +
    [['cards', 'cards'], ['table', 'table']].map(v =>
      '<button type="button" role="tab" data-cxview="' + v[0] + '"' + (view === v[0] ? ' class="on" aria-selected="true"' : '') + '>' + v[1] + '</button>').join('') +
    '</div>';

  const head = (t, suffix) =>
    '<div class="cx-head"><h3><span class="cx-dot ' + (t === 0 ? 'home' : 'away') + '"></span>' +
    '<span data-team-slot="' + t + '">' + esc(names[t]) + '</span>' + suffix + '</h3>' +
    '<span class="cx-combos">' + C.byTeam[t].length + ' combinations</span></div>';

  const cards = '<div class="cx-cards"' + (view === 'cards' ? '' : ' hidden') + '>' + [0, 1].map(t =>
      '<section class="cx-section">' + head(t, '') +
        '<div class="cx-grid">' + C.byTeam[t].slice(0, 10).map(c => cardHTML(c, C.maxCount)).join('') + '</div>' +
        (C.byTeam[t].length ? '' : '<p class="cx-none">No assist combinations recorded</p>') +
      '</section>').join('') + '</div>';

  const table = '<div class="cx-tables"' + (view === 'table' ? '' : ' hidden') + '>' + [0, 1].map(t =>
      '<section class="cx-section">' + head(t, ' Connections') + tableHTML(C.byTeam[t]) + '</section>').join('') + '</div>';

  return '<div class="cx">' + toggle + cards + table + '</div>';
}

/* THE CLUBS' COLOURS, MADE TO READ ON THIS THEME'S GROUND. game.js inks them for the
   light theme only; on the dark one a navy club's lines and labels were navy on near-black.
   The page's raw colours are read back, inked with EpinoiaTeamColour against whichever
   ground is showing, and set on the host both tabs draw into; the text on a solid marker is
   chosen against the inked colour. */
function inkTeams(host) {
  const TC = root.EpinoiaTeamColour;
  if (!host || !TC || !TC.ink || typeof getComputedStyle !== 'function') return;
  const cs = getComputedStyle(document.documentElement);
  ['0', '1'].forEach(t => {
    const c = cs.getPropertyValue('--team' + t).trim();
    if (!/^#[0-9a-f]{6}$/i.test(c)) return;
    const k = TC.ink(c) || c;
    host.style.setProperty('--vis-t' + t, k);
    if (TC.on) host.style.setProperty('--gf-on' + t, TC.on(k));
  });
}

/* The toggle only shows and hides the two views already drawn, as GAMEVIS's does; the
   choice is remembered so the next redraw of a live game draws the same one. */
function mounted(host) {
  if (!host) return;
  inkTeams(host);
  if (host.__cxBound) return;
  host.__cxBound = true;
  host.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-cxview]');
    if (!b || !host.contains(b)) return;
    view = b.dataset.cxview === 'table' ? 'table' : 'cards';
    const wrap = b.closest('.cx');
    if (!wrap) return;
    wrap.querySelectorAll('[data-cxview]').forEach(x => {
      const on = x.dataset.cxview === view;
      x.classList.toggle('on', on);
      if (on) x.setAttribute('aria-selected', 'true'); else x.removeAttribute('aria-selected');
    });
    const cards = wrap.querySelector('.cx-cards'), tables = wrap.querySelector('.cx-tables');
    if (cards) cards.hidden = view !== 'cards';
    if (tables) tables.hidden = view !== 'table';
  });
}

return { compute, render, mounted, getView: () => view, setView: v => { view = v === 'table' ? 'table' : 'cards'; } };
}));
