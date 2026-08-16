'use strict';
/* ============================================================================
   The standings / leaders embed.

     ?l=<league-slug>&kind=standings
     ?l=<league-slug>&kind=leaders&stat=ppg&n=10

   Small on purpose. An embed sits inside an article, so this is the top of a
   table and a link to the rest — eight columns is the ceiling and the header
   says which stat is being ranked, so nobody has to guess what they are
   looking at.

   Leaders read the same season intermediary every other page reads, so a
   number here and a number on the player's own profile cannot disagree.
   ============================================================================ */

const CFG = window.COURTSIDE_CONFIG;
const D = window.CourtsideData;
const qp = new URLSearchParams(location.search);
const leagueSlug = qp.get('l') || 'demo-league';
const kind = (qp.get('kind') || 'standings').toLowerCase();
const stat = qp.get('stat') || 'ppg';
const rows = Math.min(parseInt(qp.get('n'), 10) || 10, 25);

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const f1 = v => (v == null ? '—' : Number(v).toFixed(1));

function postHeight() {
  try { parent.postMessage({ courtsideEmbed: 'height', height: document.body.scrollHeight }, '*'); }
  catch (_) {}
}
function fail(m) {
  $('#host').textContent = '';
  $('#host').appendChild(el('div', 'cs-empty', m));
  postHeight();
}

function table(head, body) {
  const t = el('table', 'cs-tbl');
  const th = el('thead'), hr = el('tr');
  head.forEach((h, i) => hr.appendChild(el('th', i === 1 ? 'l' : (i === 0 ? '' : ''), h)));
  th.appendChild(hr); t.appendChild(th);
  const tb = el('tbody');
  body.forEach(cells => {
    const tr = el('tr');
    cells.forEach((c, i) => {
      const td = el('td', i === 1 ? 'l' : '');
      if (c && c.node) td.appendChild(c.node); else td.textContent = c;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return t;
}

const nameCell = (label, colour, abbr) => {
  const w = el('div', 'nm');
  if (colour) {
    const c = el('span', 'c', (abbr || '').slice(0, 2).toUpperCase());
    c.style.background = colour;
    w.appendChild(c);
  }
  w.appendChild(el('b', null, label));
  return { node: w };
};

/* which stats a leaders embed may rank, and what to call them */
const STATS = {
  ppg: ['PPG', r => f1(r.ppg)], rpg: ['RPG', r => f1(r.rpg)],
  apg: ['APG', r => f1(r.apg)], spg: ['SPG', r => f1(r.spg)],
  bpg: ['BPG', r => f1(r.bpg)], ts:  ['TS%', r => f1(r.ts)],
  efg: ['eFG%', r => f1(r.efg)], mpg: ['MPG', r => f1(r.mpg)]
};

(async function boot() {
  try {
    const { league, comp } = await D.context(leagueSlug, qp.get('c'));
    $('#title').textContent = league.name;
    if (!comp) return fail('No competition yet');

    if (kind === 'standings') {
      $('#sub').textContent = 'standings';
      $('#more').href = new URL('../../l/?l=' + encodeURIComponent(league.slug),
                                location.href).href;
      const st = await D.all(`standings?competition_id=eq.${comp.id}` +
        `&select=rank,gp,w,l,diff,league_points,streak,teams(name,short_name,colour,slug)` +
        `&order=rank`);
      if (!st.length) return fail('No games played yet');
      $('#host').textContent = '';
      $('#host').appendChild(table(
        ['#', 'TEAM', 'GP', 'W', 'L', 'DIFF', 'PTS'],
        st.slice(0, rows).map(r => {
          const t = r.teams || {};
          return [r.rank ?? '', nameCell(t.name || '—', t.colour, t.short_name),
                  r.gp, r.w, r.l, (r.diff > 0 ? '+' : '') + r.diff, r.league_points];
        })));
    } else {
      const [label, get] = STATS[stat] || STATS.ppg;
      $('#sub').textContent = label + ' leaders';
      $('#more').href = new URL('../../stats/?l=' + encodeURIComponent(league.slug),
                                location.href).href;

      const S = await D.season(comp.id);
      if (!S.players.length) return fail('No statistics yet');
      const meta = await D.playerMeta(S.players.map(p => p.id));
      S.players.forEach(p => Object.assign(p, meta[p.id] || { name: 'Player' }));

      /* a one-game sample topping a season leaderboard is noise, not a leader */
      const eligible = S.players.filter(p => (p.gp || 0) >= 2);
      eligible.sort((a, b) => (b[stat] ?? -Infinity) - (a[stat] ?? -Infinity));

      $('#host').textContent = '';
      $('#host').appendChild(table(
        ['#', 'PLAYER', 'TEAM', 'GP', label],
        eligible.slice(0, rows).map((p, i) => [
          i + 1, nameCell(p.name, p.colour, p.teamShort), p.teamShort || '', p.gp, get(p)
        ])));
    }
    postHeight();
  } catch (e) {
    fail('Could not load');
  }
})();
