'use strict';
/* ============================================================================
   /epinoia/winning/ — WHAT WINS, measured on every finished game (epinoia/winning.js does the measuring).

   Two reads and no more: every finished game the viewer may see (its score and its league, through its
   competition and season), and both sides' measures for them - eighteen numbers out of each team_game_stats
   row by their JSON paths (winning.js SELECT), never the whole blob, 150 games to a request.

   KEPT FOR SIX HOURS in this browser, rows and all: the answer moves a game at a time, and a reader flicking
   between leagues should not wait for the platform's box scores twice. ?l=<slug> opens on one league.
   ============================================================================ */
(function () {
  const $ = id => document.getElementById(id);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const W = () => window.EpinoiaWinning, D = () => window.EpinoiaData;
  const body = $('wwBody'), pick = $('wwLeague'), count = $('wwCount');
  const KEY = 'epinoia_winning_v1', TTL = 6 * 3600 * 1000;

  const fail = m => { body.textContent = ''; body.removeAttribute('aria-busy'); body.appendChild(el('div', 'empty', m)); };

  function cached() {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (j && Date.now() - j.at < TTL && Array.isArray(j.rows)) return j.rows;
    } catch (_) { /* a browser that keeps nothing reads again */ }
    return null;
  }
  function keep(rows) {
    try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), rows })); } catch (_) { /* full: fine */ }
  }

  async function read() {
    const hit = cached();
    if (hit) return hit;
    const games = await D().all('games?status=eq.final&select=id,home_score,away_score,competitions(seasons(name,leagues(id,name,slug,country)))');
    const list = games.map(g => {
      const lg = g.competitions && g.competitions.seasons && g.competitions.seasons.leagues;
      return { id: g.id, home_score: g.home_score, away_score: g.away_score, league: lg ? { id: lg.id, name: lg.name, slug: lg.slug, country: lg.country } : null };
    });
    const ids = list.map(g => g.id), tgs = [];
    const chunks = [];
    for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
    let done = 0;
    for (let i = 0; i < chunks.length; i += 4) {
      const part = await Promise.all(chunks.slice(i, i + 4).map(c => D().all('team_game_stats?game_id=in.(' + c.join(',') + ')&select=' + W().SELECT)));
      part.forEach(p => tgs.push(...p));
      done += part.length;
      count.textContent = 'reading ' + Math.min(100, Math.round(100 * done / chunks.length)) + '%';
    }
    /* the rows the measuring needs, and no more: the league, the margin, the result and the two sides' numbers */
    const rows = W().rows(list, tgs).map(r => ({ id: r.id, league: r.league, margin: r.margin, win: r.win, d: r.d, h: r.h, a: r.a }));
    rows.forEach(r => { delete r.h.game_id; delete r.a.game_id; });
    keep(rows);
    return rows;
  }

  const sec = (title, sub, inner) => {
    const s = el('section', 'ww-sec');
    s.appendChild(el('h3', null, title));
    if (sub) s.appendChild(el('p', 'ww-sub', sub));
    const box = el('div');
    box.innerHTML = inner;
    s.appendChild(box);
    return s;
  };

  function draw(all, slug) {
    const Wn = W();
    const list = slug ? all.filter(r => r.league && r.league.slug === slug) : all;
    const a = Wn.analyse(list);
    body.textContent = '';
    body.removeAttribute('aria-busy');
    count.textContent = a.n.toLocaleString('en-GB') + ' games';
    if (a.n < 20) { body.appendChild(el('div', 'empty', 'Too few finished games' + (slug ? ' in this league' : '') + ' to say what wins yet.')); return; }
    const ins = el('section', 'ww-sec ww-ins');
    Wn.insights(a).forEach(t => ins.appendChild(el('p', null, t)));
    body.appendChild(ins);
    body.appendChild(sec('What goes with winning', 'Each measure\'s difference between the two sides, set against who won: +1 would be the side ahead ' +
      'on it winning every time, 0 no relation at all. On the right, how often the side that won the measure won the game. Grey bars are ' +
      'shot selection - a choice, not a skill - and blue ones where the points came from.', Wn.barsSVG(a)));
    if (a.factors) {
      body.appendChild(sec('The four factors, weighed', 'The margin of every game fitted to the four factors\' differences. Together they explain ' +
        Math.round(a.factors.r2 * 100) + '% of it. Each bar is a factor\'s share of what they explain, measured here and as Dean Oliver weighted them.',
        Wn.factorsSVG(a.factors)));
    }
    body.appendChild(sec('Winners and losers', 'The averages of the sides that won and the sides that lost, measure by measure.', Wn.dumbbellSVG(a)));
    const top = a.ranked.find(m => m.group !== 'pts') || a.ranked[0];
    if (top) body.appendChild(sec('Game by game: ' + top.label, 'Every game (up to 600 of them), its ' + top.label + ' difference against the margin; ' +
      'green the home side won, red it lost. The dashed line is the fit.', Wn.scatterSVG(list, top.k, top.label)));
    if (!slug) {
      const leagues = Wn.byLeague(all, 20);
      if (leagues.length) {
        const rows = leagues.map(g => '<tr' + (g.league.slug === slug ? ' class="on"' : '') + '><td><a href="?l=' + encodeURIComponent(g.league.slug) + '" data-l="' +
          g.league.slug + '">' + escapeHTML(g.league.name) + '</a></td><td class="n">' + g.n + '</td><td>' + (g.top ? escapeHTML(g.top.label) : '—') + '</td>' +
          '<td class="n">' + (g.top && g.top.winRate != null ? Math.round(g.top.winRate) + '%' : '—') + '</td>' +
          '<td class="n">' + (g.factors && g.factors.r2 != null ? Math.round(g.factors.r2 * 100) + '%' : '—') + '</td>' +
          '<td class="n">' + (g.homeWin != null ? Math.round(g.homeWin) + '%' : '—') + '</td></tr>').join('');
        body.appendChild(sec('League by league', 'The measure most tied to winning in each league with twenty finished games or more.',
          '<div class="ww-tblwrap"><table class="ww-tbl"><thead><tr><th>league</th><th>games</th><th>what wins there</th><th>won it, won</th>' +
          '<th>four factors explain</th><th>home wins</th></tr></thead><tbody>' + rows + '</tbody></table></div>'));
      }
    }
  }
  const escapeHTML = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  (async function boot() {
    if (!W() || !D()) { fail('The page could not be loaded.'); return; }
    let all;
    try { all = await read(); } catch (e) { fail('The games could not be read just now: ' + (e && e.message || e)); return; }
    /* the leagues with enough games to say anything, biggest first */
    const counts = new Map();
    all.forEach(r => { if (r.league) { const c = counts.get(r.league.slug) || { league: r.league, n: 0 }; c.n++; counts.set(r.league.slug, c); } });
    [...counts.values()].filter(c => c.n >= 20).sort((x, y) => y.n - x.n).forEach(c => {
      const o = document.createElement('option'); o.value = c.league.slug; o.textContent = c.league.name + ' (' + c.n + ')'; pick.appendChild(o);
    });
    const want = new URLSearchParams(location.search).get('l') || '';
    if (want && counts.has(want)) pick.value = want;
    draw(all, pick.value);
    pick.addEventListener('change', () => {
      const u = new URL(location.href);
      if (pick.value) u.searchParams.set('l', pick.value); else u.searchParams.delete('l');
      history.replaceState(null, '', u);
      draw(all, pick.value);
    });
    body.addEventListener('click', e => {
      const a = e.target.closest && e.target.closest('a[data-l]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      pick.value = a.getAttribute('data-l');
      pick.dispatchEvent(new Event('change'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  })();
})();
