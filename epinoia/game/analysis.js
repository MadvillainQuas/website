'use strict';
/* ============================================================================
   THE GAME ANALYSIS (2026-10-02): a final game as A4 pages, downloaded as one PDF like the club and player reports
   (report.js), from the side of one of the two clubs. Under the scoresheet button ("Game analysis · PDF"); for members
   (access.js club_report, the club report's own tier).

     COVER         the club, the game, its starting five on a half court
     MAIN STATS    the club report's (report-teampages.js), with THIS GAME's figures for both clubs, each ranked and
                   coloured against the competition's clubs over the season: the four factors, the season line, against
                   starters and bench, the shot distribution, the rebounds
     SHOT CHART    the club report's: both ends' zones, the half court, transition, the events -- this game
     PLAYERS       both teams' full stats (the statistics page's player tables), fitted to one page
     GAME FLOW     the Game Flow tab (game/flow.js), every chart of it, on one page
     LEGEND

   ?analysis=0 (home) or 1 (away) opens it on load: the mailer's way in (scripts/report_mailer.mjs).
   ============================================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const qp = new URLSearchParams(location.search);
  const ver = (() => { const s = [...document.scripts].find(x => /game\/analysis\.js/.test(x.src) || /\/analysis\.js/.test(x.src)); const m = s && /v=(\d+)/.exec(s.src); return m ? m[1] : ''; })();
  const NEED = [['EpinoiaLineupsCore', '../lineups.js'], ['EpinoiaMemLock', '../memlock.js'], ['EpinoiaStatInfo', '../statinfo.js'], ['EpinoiaLineupEvents', '../lineupevents.js'],
    ['EpinoiaSeasonLine', '../t/seasonline.js'], ['EpinoiaRaster', '../raster.js'], ['EpinoiaTeamViz', '../teamviz.js'],
    ['EpinoiaA4', '../report.js'], ['EpinoiaReportTeam', '../report-teampages.js']];
  const CSS = ['../kit/report.css', '../kit/teamviz.css', '../kit/sitpanel.css', '../kit/shotchart.css', '../kit/table.css'];
  const add = (tag, attrs) => new Promise((res, rej) => { const n = document.createElement(tag); Object.assign(n, attrs); n.onload = res; n.onerror = rej; document.head.appendChild(n); });
  let loaded = null;
  function load() {
    if (loaded) return loaded;
    const q = ver ? '?v=' + ver : '';
    CSS.forEach(h => { if (![...document.styleSheets].some(x => x.href && x.href.indexOf(h.slice(2)) >= 0)) add('link', { rel: 'stylesheet', href: h + q }).catch(() => {}); });
    /* the page's own EpinoiaReport (the match report) is put back once the A4 engine has taken the name too */
    loaded = (async () => { const match = window.EpinoiaReport, tab = window.EpinoiaLineups; for (const [g, src] of NEED) if (!window[g]) await add('script', { src: src + q }); if (match) window.EpinoiaReport = match; if (tab) window.EpinoiaLineups = tab; })();
    loaded.catch(() => { loaded = null; });
    return loaded;
  }

  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isNum = v => v != null && v !== '' && isFinite(+v);

  /* ---------------------------------------------------------------- the data, scoped to the game --- */
  const SHARED = {};
  function context(side) {
    const S = window.S, M = S.meta || {}, D = window.EpinoiaData, SC = window.EpinoiaShotChart;
    const gid = qp.get('g');
    const teamId = side ? M.awayTeamId : M.homeTeamId;
    const game = { id: gid, home_team_id: M.homeTeamId, away_team_id: M.awayTeamId, starters: S.starters, period: S.period, tipoff_at: M.tipoff_at,
      competition_id: M.competitionId };
    const SH = SHARED[gid] = SHARED[gid] || {};
    let seasonP = null;
    const events = () => SH.ev || (SH.ev = D.events([gid]));
    const base = () => SH.base || (SH.base = (async () => {
      const comps = [M.competitionId];
      const [all, one] = await Promise.all([D.season(comps, { rows: false, trim: true }), D.season(comps, { rows: false, trim: true, gameIds: [gid] })]);
      SH.Ss = all;
      /* this game's line for both clubs and their players, the rest of the competition's season around it */
      const gT = new Map(one.teams.map(r => [r.id, r])), gP = new Map(one.players.map(r => [r.id, r]));
      const teams = all.teams.map(r => gT.get(r.id) || r).concat(one.teams.filter(r => !all.teams.some(x => x.id === r.id)));
      const players = all.players.map(r => gP.get(r.id) || r).concat(one.players.filter(r => !all.players.some(x => x.id === r.id)));
      return { S: Object.assign({}, all, { teams, players, games: one.games, gameOnly: one }), comps };
    })());
    const season = () => seasonP || (seasonP = base().then(B => ({ S: B.S, mine: B.S.teams.find(r => r.id === teamId) || null, scopeComps: B.comps, kind: 'all' })));
    const logs = async () => { const evs = await events(); return { gs: [game], byG: { [gid]: evs }, sideOf: { [gid]: side } }; };
    return {
      season,
      logs,
      clubLogs: async () => {
        const LE = window.EpinoiaLineupEvents;
        const evs = await events();
        const G = LE ? LE.gameSegments({ id: gid, starters: S.starters, events: evs, period: S.period }) : null;
        if (!G || !G.ok) return { why: 'no lineups for this game' };
        const recs = LE.recordsOf(G, side); recs.forEach(r => { r.oteam = side ? M.homeTeamId : M.awayTeamId; });
        return { recs, games: 1 };
      },
      starters: async () => [game],
      /* the cover's five: the game's starters */
      depth: async () => {
        const ids = (S.starters && S.starters[side]) || [];
        const pl = ((S.teams[side] || {}).players) || [];
        const nm = id => (pl.find(p => p.id === id) || {}).name || '';
        return ids.length ? { c: { slots: ids.slice(0, 5).map(id => ({ players: [{ id, name: nm(id) }] })), games: 1 } } : null;
      },
      /* both ends' zones: the competition's clubs over the season, the two clubs over this game */
      zones: async T => {
        if (!SC || !SC.attachZoneStats) return;
        try { if (SH.Ss) await SC.attachZoneStats(SH.Ss, D); } catch (_) { /* the game alone */ }
        const two = T.teams.filter(r => r.id === M.homeTeamId || r.id === M.awayTeamId);
        try { await SC.attachZoneStats({ games: T.games, teams: two }, D); } catch (_) { /* without */ }
      },
      rebounds: async () => '',
      meta: ids => D.playerMeta(ids),
      stints: () => Promise.resolve([]),
      rapm: null,
      bigGames: D.BIG_GAMES || 0,
      week: null
    };
  }

  /* ---------------------------------------------------------------- both teams' full stats --- */
  /* THE GAME PAGE'S OWN FULL STATS TAB (boxscore.js advHTML): its player tables, one a team, exactly as the tab draws
     them (the columns, the bars, the colours against the game's average), shrunk to the page's width so a whole table
     reads on an A4 sheet, with a plain-words key for a reader new to the numbers */
  const PAGE_W = 726;
  function fitted(html) {
    const probe = document.createElement('div');
    probe.className = 'ga-adv';
    probe.style.cssText = 'position:absolute;left:-99999px;top:0;width:' + PAGE_W + 'px';
    probe.innerHTML = html;
    document.body.appendChild(probe);
    const w = Math.max(probe.scrollWidth, ...[...probe.querySelectorAll('table')].map(t => t.scrollWidth));
    probe.remove();
    return Math.min(1, PAGE_W / Math.max(1, w));
  }
  /* the tab's table cut to some of its column groups (boxscore.js ADV_GROUPS: a row is the name, then each group's columns
     in order), so a page holds both teams at a size a coach can read */
  function slice(html, keep) {
    const G = window.EpinoiaBox.ADV_GROUPS;
    const d = document.createElement('div'); d.innerHTML = html;
    const pcs = d.querySelector('.pcs');
    if (pcs) G.forEach(g => { if (keep.indexOf(g.key) < 0) pcs.classList.add('hide-' + g.key); });
    d.querySelectorAll('.pcs-tools, .pcs-list').forEach(n => n.remove());
    return d.innerHTML;
  }
  const PARTS = [['scoring, usage and shooting', ['scoring', 'usage', 'shotdist']],
    ['on the floor and individual', ['offcourt', 'defcourt', 'individual']]];
  function boxesModule() {
    const E = window.EpinoiaA4;
    return {
      key: 'boxes', title: 'Full stats', page: 'FULL STATS', on: true,
      async build(c, R) {
        const B = window.EpinoiaBox, S = window.S;
        if (!B || !B.advHTML || !window.derive) return [];
        const tmp = document.createElement('div');
        tmp.innerHTML = B.advHTML(window.derive());
        const secs = [0, 1].map(t => tmp.querySelector('[data-fsec="players' + t + '"] .fsec-b'));
        if (!secs[0] || !secs[1]) return [];
        R.legendExtra.push(['FULL STATS', 'The game page’s Full stats tab, player by player: scoring, usage, shot distribution, how his team did on the floor at both ends while he played and his individual rates.']);
        const key = '<p class="ga-key"><b>How to read it.</b> One row a player, starters first. A bar shows how big a figure was next to the other players; ' +
          'a shaded cell is green where it was good for his team and red where it was not. The on-court columns are how his team did while he was on the floor, against the game’s average.</p>';
        /* each part a page: both teams, one above the other */
        return PARTS.flatMap(([what, keep], pi) => (pi ? [E.block('', 'rp-break')] : []).concat([0, 1].map(t => {
          const html = slice(secs[t].innerHTML, keep);
          const z = fitted(html);
          return E.block((t ? '' : E.title('Full stats: ' + what, (S.teams[0].name || '') + ' and ' + (S.teams[1].name || '') + ', every player of the game')) +
            '<div class="ga-adv fstats" style="zoom:' + z.toFixed(3) + '">' + html + '</div>' + (t && !pi ? key : ''), 'ga-advb');
        })));
      }
    };
  }

  /* ---------------------------------------------------------------- the game flow --- */
  function flowModule() {
    const E = window.EpinoiaA4;
    return {
      key: 'flow', title: 'Game flow', page: 'GAME FLOW', on: true,
      async build(c, R) {
        const F = window.EpinoiaGameFlow;
        if (!F || !F.render) return [];
        const html = F.render(window.S);
        R.legendExtra.push(['GAME FLOW', 'Scoring runs (six points or more in a row), the margin through the game, expected points added from turnovers and offensive rebounds, the scoring battle (shooting and free throws) and points per possession, all on the game’s clock, beside the rotations.']);
        return [E.block(E.title('Game flow', 'runs, the margin, the rotations and every chart of the Game Flow tab, on the game’s clock') + '<div class="ga-flow">' + html + '</div>', 'ga-flowb')];
      }
    };
  }

  /* ---------------------------------------------------------------- the panel --- */
  let current = null;
  async function open(side) {
    const S = window.S;
    if (!S || S.status !== 'final') return;
    let wrap = $('#gaWrap');
    if (!wrap) {
      wrap = document.createElement('section');
      wrap.id = 'gaWrap'; wrap.className = 'ga-wrap';
      document.querySelector('#view').appendChild(wrap);
    }
    wrap.innerHTML = '<div class="ga-top"><h2>Game analysis</h2><div class="ga-sides">' + [0, 1].map(t =>
      '<button type="button" class="ep-btn' + (t === side ? ' pri' : '') + '" data-ga="' + t + '">' + esc((S.teams[t] || {}).name || (t ? 'Away' : 'Home')) + '</button>').join('') +
      '</div><button type="button" class="ep-btn ga-x" aria-label="Close">close</button></div><div id="gaTabs" class="ep-tabs" style="display:none"></div><div id="gaPanel"></div>';
    wrap.querySelectorAll('[data-ga]').forEach(b => { b.onclick = () => open(+b.dataset.ga); });
    wrap.querySelector('.ga-x').onclick = () => { wrap.remove(); current = null; document.body.classList.remove('rptab'); };
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await load();
    const E = window.EpinoiaA4, RT = window.EpinoiaReportTeam;
    /* ONE SET OF PAGES, BOTH CLUBS ON EVERY ONE: in a single game what the club report calls "allowed" and "opponents"
       is the other club, so each page is a head-to-head, named for both (c.vs); the side it was opened for (or the
       member's club) reads first. Then both teams' full stats and the game flow. */
    const RTm = RT.modules(context(side));
    const cover = {
      key: 'cover', title: 'Cover', on: true,
      async build(c) {
        const E2 = window.EpinoiaA4, M2 = S.meta || {};
        c.name = (S.teams[0].name || 'Home') + ' vs. ' + (S.teams[1].name || 'Away');
        const sc = [M2.home_score, M2.away_score];
        c.facts = [['Result', S.teams[0].name + ' ' + sc[0] + '–' + sc[1] + ' ' + S.teams[1].name], ['Date', M2.tipoff_at ? new Date(M2.tipoff_at).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''],
          ['Venue', M2.venue || S.venue || ''], ['Competition', [M2.leagueName, M2.competitionName].filter(Boolean).join(' · ')], ['Prepared for', mine.name || '']];
        const five = t => {
          const ids = (S.starters && S.starters[t]) || [], pl = (S.teams[t] || {}).players || [];
          const nm = id => { const n = (pl.find(p => p.id === id) || {}).name || ''; const w = n.trim().split(/\s+/); return w.length > 1 ? w[0][0] + '. ' + w.slice(1).join(' ') : n; };
          return '<div><div class="rp-cap">' + esc(S.teams[t].name || '') + '</div>' + E2.posCourtHTML([20, 20, 20, 20, 20], { names: ids.slice(0, 5).map(nm) }) + '</div>';
        };
        return '<h4>The starting fives</h4><div class="rp-two ga-fives">' + five(0) + five(1) + '</div>';
      }
    };
    const mods = [cover].concat(['main', 'shots'].map(k => RTm.find(m => m.key === k)).filter(Boolean))
      .concat([boxesModule(), flowModule(), RTm.find(m => m.key === 'legend')]).filter(Boolean);
    const M = S.meta || {}, mine = S.teams[side] || {}, opp = S.teams[1 - side] || {};
    const shortOf = t => { const cl = t ? M.away : M.home; return (cl && cl.short_name) || (S.teams[t] || {}).name || ''; };
    const sc = [M.home_score, M.away_score];
    const when = M.tipoff_at ? new Date(M.tipoff_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const club = side ? M.away : M.home;
    const line = (S.teams[0].name + ' ' + sc[0] + '–' + sc[1] + ' ' + S.teams[1].name);
    current = E.mount({
      tabs: '#gaTabs', panel: '#gaPanel', kind: 'team', label: 'Game analysis', title: 'Game analysis', store: 'epinoia_report_game',
      lock: { key: 'clubReport', what: 'The game analysis', league: S.leagueId || null, leagueSlug: S.leagueSlug || '',
              lines: ['A printable A4 analysis of any game: four factors, shot charts, both box scores and the game flow.'] },
      modules: mods,
      context: () => ({
        /* every page's head: the game itself, home v away, its score, date and venue (Louie, 2026-10-02) */
        vs: { a: mine.name, b: opp.name, as: shortOf(side), bs: shortOf(1 - side) },
        kind: 'team', head: (S.teams[0].name || 'Home') + ' vs. ' + (S.teams[1].name || 'Away'), name: mine.name, club: mine.name, kicker: 'Game analysis',
        crest: club && club.logo_path && window.epinoiaLogoUrl ? window.epinoiaLogoUrl(club.logo_path, 512) : null,
        colour: mine.color || '#93f2bf', accent: E.inkOn ? E.inkOn(mine.color) : '#08603f',
        monogram: club && club.short_name && club.short_name.length <= 4 ? club.short_name : null,
        line: [sc[0] + '–' + sc[1], when, M.venue || S.venue, M.leagueName].filter(Boolean).join(' · '),
        scope: line + (when ? ' · ' + when : ''), subtitle: line + (when ? ' · ' + when : '') + ' · v ' + (opp.name || ''),
        file: ('game-analysis-' + (mine.name || 'club') + '-v-' + (opp.name || 'opponent')).replace(/[^\w-]+/g, '-').toLowerCase()
      })
    });
    if (current) current.show(true);
  }
  window.EpinoiaGameAnalysis = { open };

  /* the button, under the scoresheet's, once the head has drawn it */
  const place = () => {
    const sheet = $('#csSheet');
    if (!sheet || $('#csAnalysis')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.id = 'csAnalysis'; b.className = 'bt-sheet bt-ga'; b.textContent = 'Game analysis · PDF';
    const AX = window.EpinoiaAccess, S = window.S;
    if (AX && AX.featureLocked && S && AX.featureLocked('clubReport', S.leagueId || null)) b.classList.add('locked');
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); open(0); };
    sheet.insertAdjacentElement('afterend', b);
  };
  new MutationObserver(place).observe(document.documentElement, { childList: true, subtree: true });
  if (qp.has('analysis')) {
    const go = () => (window.S && window.S.status === 'final' ? open(+qp.get('analysis') === 1 ? 1 : 0) : setTimeout(go, 500));
    setTimeout(go, 800);
  }
})();
