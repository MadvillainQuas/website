'use strict';
/* ============================================================================
   WHERE THE TWO CLUBS STAND — the league table a game belongs to, and each
   club's place in it. Read by the box score (the line under each club's name
   on the scoreboard) and by the fixture preview (the same line, and the table
   itself with both clubs lit).

   WHICH TABLE. The league's, not the game's own competition when that is a cup
   or a playoff: "their position in the league" is the league table of the
   season the game is in. A season with no league-kind competition falls back
   to the game's own competition, and a game in no competition has no table.

   NOTHING UNTIL A GAME HAS BEEN PLAYED. A table in which every club has played
   none is alphabetical order dressed as a ranking, so a club's position is
   only given once somebody in its table (its group, where the league has
   groups) has played.

   Pure where it can be (ordinal, place, tableHTML run under node); load()
   reads through the page's api(path) -> rows.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaTablePos = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* 1st 2nd 3rd 4th … 11th 12th 13th … 21st 22nd */
function ordinal(n) {
  n = +n;
  if (!Number.isFinite(n) || n <= 0) return '';
  const t = n % 100;
  if (t >= 11 && t <= 13) return n + 'th';
  return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}

const COLS = 'team_id,rank,gp,w,l,pts_for,pts_against,diff,league_points,group_name,' +
  'teams(id,name,short_name,slug,colour)';

/* {comp, rows} or null. `api` is the page's reader (PostgREST path -> rows). */
async function load(api, competitionId) {
  if (!api || !competitionId) return null;
  const own = (await api('competitions?id=eq.' + encodeURIComponent(competitionId) +
    '&select=id,name,kind,season_id&limit=1'))[0];
  if (!own) return null;
  let comp = own;
  if ((own.kind || 'league') !== 'league' && own.season_id) {
    const sibs = await api('competitions?season_id=eq.' + encodeURIComponent(own.season_id) +
      '&kind=eq.league&select=id,name,kind,season_id&order=name&limit=1').catch(() => []);
    if (sibs && sibs[0]) comp = sibs[0];
  }
  const rows = await api('standings?competition_id=eq.' + encodeURIComponent(comp.id) +
    '&select=' + COLS + '&order=group_name.asc.nullsfirst,rank.asc.nullslast');
  return rows && rows.length ? { comp, rows } : null;
}

/* the rows of the table a club is in: its group, where the league has groups */
function tableOf(rows, teamId) {
  const me = (rows || []).find(r => r.team_id === teamId);
  if (!me) return null;
  const g = me.group_name || '';
  return { me, rows: rows.filter(r => (r.group_name || '') === g) };
}

/* {rank, text, group} for a club, or null: not in the table, no rank, or nobody in its table has played */
function place(T, teamId) {
  if (!T) return null;
  const t = tableOf(T.rows, teamId);
  if (!t || t.me.rank == null || !t.rows.some(r => (r.gp || 0) > 0)) return null;
  const g = t.me.group_name || '';
  const where = g ? (/\s/.test(g) ? g : 'Group ' + g) : (T.comp && T.comp.name) || 'the league';
  return { rank: t.me.rank, of: t.rows.length, text: ordinal(t.me.rank) + ' in ' + where, group: g };
}

/* THE TABLE, WITH BOTH CLUBS LIT. The two clubs' rows carry their colour down the edge and a tint,
   the rest of the table recedes. A long table is cut to the stretch around the two clubs (and the
   top), with a gap row where rows are left out, so the preview does not carry twenty rows. */
function tableHTML(T, ids, opts) {
  const o = opts || {};
  if (!T) return '';
  const want = (ids || []).filter(Boolean);
  const first = want.map(id => tableOf(T.rows, id)).find(Boolean);
  if (!first || !first.rows.some(r => (r.gp || 0) > 0)) return '';
  /* both clubs in one group: that group; in two groups: both, one after the other */
  const groups = [...new Set(want.map(id => { const t = tableOf(T.rows, id); return t ? (t.me.group_name || '') : null; })
    .filter(g => g != null))];
  const colourOf = id => (o.colours && o.colours[id]) || '';
  const max = o.max || 10;
  const block = g => {
    const rows = T.rows.filter(r => (r.group_name || '') === g).slice().sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
    let keep = rows.map(() => rows.length <= max);
    if (rows.length > max) {
      const lit = rows.map((r, i) => want.indexOf(r.team_id) !== -1 ? i : -1).filter(i => i >= 0);
      rows.forEach((r, i) => { if (i < 3 || lit.some(j => Math.abs(j - i) <= 2)) keep[i] = true; });
    }
    let out = '', gap = false;
    rows.forEach((r, i) => {
      if (!keep[i]) { if (!gap) { out += '<tr class="tp-gap"><td colspan="7">⋯</td></tr>'; gap = true; } return; }
      gap = false;
      const lit = want.indexOf(r.team_id) !== -1;
      const t = r.teams || {};
      const name = t.name || '';
      const cell = o.base != null && t.slug
        ? '<a href="' + esc(o.base) + 't/?t=' + esc(encodeURIComponent(t.slug)) + '">' + esc(name) + '</a>' : esc(name);
      out += '<tr' + (lit ? ' class="lit" style="--tc:' + esc(colourOf(r.team_id) || t.colour || 'var(--lume)') + '"' : '') + '>' +
        '<td class="tp-r">' + esc(r.rank ?? '') + '</td>' +
        '<td class="tp-n">' + cell + '</td>' +
        '<td>' + (r.gp || 0) + '</td><td>' + (r.w || 0) + '</td><td>' + (r.l || 0) + '</td>' +
        '<td>' + ((r.diff || 0) > 0 ? '+' : '') + (r.diff || 0) + '</td>' +
        '<td class="tp-p">' + esc(r.league_points ?? '') + '</td></tr>';
    });
    const head = g ? '<caption>' + esc(/\s/.test(g) ? g : 'Group ' + g) + '</caption>' : '';
    return '<table class="tp-table">' + head +
      '<thead><tr><th class="tp-r">#</th><th class="tp-n">Club</th><th>GP</th><th>W</th><th>L</th><th>+/−</th><th class="tp-p">PTS</th></tr></thead>' +
      '<tbody>' + out + '</tbody></table>';
  };
  return groups.map(block).join('');
}

return { ordinal, load, place, tableOf, tableHTML, COLS };
}));
