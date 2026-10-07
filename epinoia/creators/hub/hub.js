'use strict';
/* ============================================================================
   THE CREATOR HUB (creators/hub/, migration 0200).

     YOUR NUMBERS   for the outlets this account writes for (creator_stats): pieces seen on a page, opened here and
                    followed out to where they live, the share opened, readers, followers and what went out; day by
                    day; the pieces that did best; where readers came from, and on what. Anonymous at the source:
                    track.js counts a piece, never a person.
     WRITING DESK   the outlet's drafts, scheduled pieces and latest, each a click from the studio's editor, and a
                    new article, video, episode or post.
     STORYLINES     any league, chosen from the list: its table, the race, runs, leaders, season highs, form, the
                    latest upset, the game coming up, a milestone and its scoring, each as words to copy
                    (storylines.js), from the site's own public numbers. "Write about it" opens a new article.
     GRAPHICS       the league's week drawn as posts (socialcard.js, as the league's own console draws them), and
                    backgrounds in its colours, square, portrait or story; each or all at once.
     ICONS          icons.js's set, in the league's colours, white or ink, as SVG or PNG; each or all at once.

   The league chosen is kept (?l= and this browser), and the page wears its colours (teamcolour.js).
   ============================================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
  const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
  const BASE = '../../';
  const Q = new URLSearchParams(location.search);
  const LEAGUE_KEY = 'epinoia_hub_league';
  let sb = null, session = null, outlets = [], outlet = null, days = 30, ctx = null, league = null, gfxSize = 'portrait';

  const empty = (text, link) => {
    const d = el('div', 'pg-empty', text);
    if (link) { d.append(' '); const a = el('a', null, link.text); a.href = link.href; d.appendChild(a); }
    return d;
  };
  /* words the page sets outside a text node (an optgroup's label), in the reader's language (i18n.js) */
  /* dates and numbers in the site's language, as the rest of the site writes them */
  const loc = () => (window.EpinoiaI18n && window.EpinoiaI18n.locale) || undefined;
  const tr = s => (window.EpinoiaI18n && window.EpinoiaI18n.t ? window.EpinoiaI18n.t(s, 'creatorhub') : s);
  const errText = e => (e && (e.message || e.hint || e.details)) || String(e || 'went wrong');
  const missing = e => /PGRST202|Could not find the function|does not exist/i.test(((e && e.code) || '') + ' ' + errText(e));
  const studio = (extra) => BASE + 'creators/studio/?o=' + encodeURIComponent(outlet.outlet_id) + (extra || '');
  function save(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = el('a'); a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  }
  const seg = (host, label, options, current, onPick) => {
    const g = host.appendChild(el('div', 'pg-seg'));
    g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    options.forEach(([v, text]) => {
      const b = g.appendChild(el('button', null, text));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(v === current));
      b.addEventListener('click', () => {
        g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        onPick(v);
      });
    });
    return g;
  };

  /* ------------------------------------------------------------------ boot --- */
  (async function boot() {
    sb = window.epinoiaClient && window.epinoiaClient();
    try { session = sb ? (await sb.auth.getSession()).data.session : null; } catch (_) { session = null; }
    await numbers();
    desk();
    await leagueList();
    icons();
  })();

  /* ============================================================ YOUR NUMBERS === */
  const SOURCES = { news: 'News', home: 'Home', splash: 'Home', l: 'League pages', creators: 'Creators’ pages', fan: 'Fans’ pages',
                    t: 'Club pages', p: 'Player pages', go: 'EPINOIA GO', direct: 'Direct or shared links', elsewhere: 'Other sites' };
  async function numbers() {
    const body = $('#numBody'), pick = $('#numPick');
    body.textContent = '';
    if (!session) {
      body.appendChild(empty('Sign in to see how your work does here. The storylines, graphics and icons below are for everyone.',
        { text: 'Sign in', href: BASE + 'signin/?next=' + encodeURIComponent(location.pathname + location.search) }));
      return;
    }
    try { await sb.rpc('creator_publish_due'); } catch (_) { /* before 0200: nothing is scheduled */ }
    const { data: mine, error } = await sb.rpc('my_creator_outlets');
    if (error) { body.appendChild(empty('Your outlets could not be read: ' + errText(error))); return; }
    outlets = mine || [];
    /* the outlets this account writes for: track.js never counts their own people reading their own pieces */
    try { localStorage.setItem('epinoia_my_outlets', JSON.stringify(outlets.map(o => o.league_slug + '/' + o.slug))); } catch (_) { /* fine */ }
    if (!outlets.length) {
      body.appendChild(empty('You do not write for an outlet yet. A league’s administrators open one for a creator, named by the email you sign in with ('
        + ((session.user && session.user.email) || 'yours') + '): ask the league you cover. The storylines, graphics and icons below are for everyone.'));
      return;
    }
    outlet = outlets.find(o => o.outlet_id === Q.get('o')) || outlets[0];
    const acts = $('#chActs');
    const st = acts.appendChild(el('a', 'ep-btn pri', 'Open the studio'));
    st.href = studio();
    const pg = acts.appendChild(el('a', 'ep-btn', 'Your page'));
    pg.href = BASE + 'creators/?l=' + encodeURIComponent(outlet.league_slug) + '&o=' + encodeURIComponent(outlet.slug);
    pick.textContent = '';
    if (outlets.length > 1) {
      seg(pick, 'Outlet', outlets.map(o => [o.outlet_id, o.name]), outlet.outlet_id, v => {
        outlet = outlets.find(o => o.outlet_id === v); st.href = studio(); loadStats(); desk();
      });
    }
    seg(pick, 'Period', [[7, '7 days'], [30, '30 days'], [90, '90 days']], days, v => { days = v; loadStats(); });
    await loadStats();
  }

  async function loadStats() {
    const body = $('#numBody');
    body.textContent = '';
    body.appendChild(empty('Counting…'));
    const { data: s, error } = await sb.rpc('creator_stats', { p_outlet: outlet.outlet_id, p_days: days });
    body.textContent = '';
    if (error) { body.appendChild(empty(missing(error) ? 'Your numbers arrive with migration 0200 on the server.' : 'Your numbers could not be read: ' + errText(error))); return; }
    drawStats(body, s);
  }

  /* +12% / −3% / new, against the same stretch before */
  function delta(now, before) {
    const n = Number(now) || 0, b = Number(before) || 0;
    if (!b) return n ? { t: 'new', cls: 'up' } : null;
    const p = Math.round((n - b) / b * 100);
    return { t: (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p) + '%', cls: p > 0 ? 'up' : p < 0 ? 'down' : '' };
  }
  const fmt = n => (Number(n) || 0).toLocaleString(loc());
  function drawStats(body, s) {
    const t = s.totals || {}, b = s.before || {};
    const ctr = t.seen ? Math.round(t.open / t.seen * 1000) / 10 : null, ctrB = b.seen ? Math.round(b.open / b.seen * 1000) / 10 : null;
    const grid = body.appendChild(el('div', 'ch-cards'));
    const stat = (label, value, d, hint, key) => {
      const c = grid.appendChild(el('div', 'ch-card'));
      if (key) c.dataset.k = key;
      c.appendChild(el('span', 'ch-card-l', label));
      c.appendChild(data('b', 'ch-card-v', value));
      if (d) c.appendChild(el('span', 'ch-delta ' + d.cls, d.t));
      c.appendChild(el('span', 'ch-card-h', hint));
    };
    stat('Seen', fmt(t.seen), delta(t.seen, b.seen), 'times a card of yours was on screen', 'seen');
    stat('Opened', fmt(t.open), delta(t.open, b.open), 'pieces opened here', 'open');
    stat('Clicked out', fmt(t.out), delta(t.out, b.out), 'links followed to where your work lives', 'out');
    stat('Opened when seen', ctr == null ? '—' : ctr + '%', ctr != null && ctrB != null ? { t: (ctr - ctrB >= 0 ? '+' : '−') + Math.abs(Math.round((ctr - ctrB) * 10) / 10) + ' pts', cls: ctr >= ctrB ? 'up' : 'down' } : null,
         'of the cards seen, the share opened', 'ctr');
    stat('Readers', fmt(t.readers), delta(t.readers, b.readers), 'visits that opened at least one piece', 'readers');
    stat('Followers', fmt(s.followers), null, 'accounts that follow this outlet', 'followers');
    const pc = s.pieces || {};
    stat('Published', fmt(pc.published_in), null, 'in these ' + s.days + ' days · ' + fmt(pc.published) + ' in all' +
         (pc.scheduled ? ' · ' + pc.scheduled + ' scheduled' : ''), 'published');

    if (!t.seen && !t.open && !t.out) {
      body.appendChild(empty('Nothing counted yet in these ' + s.days + ' days. Pieces are counted as readers see, open and follow them: the first will show here.'));
    }

    /* DAY BY DAY: seen as the pale bar, opened as the strong one */
    const daily = s.daily || [];
    if (daily.length) {
      const box = body.appendChild(el('div', 'ch-panel'));
      box.appendChild(el('h3', 'ch-h', 'Day by day'));
      const max = Math.max(1, ...daily.map(d => Math.max(d.seen, d.open)));
      const NS = 'http://www.w3.org/2000/svg', W = 600, H = 150, bw = W / daily.length;
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H + 4)); svg.setAttribute('class', 'ch-chart');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Seen and opened, day by day, over ' + daily.length + ' days');
      daily.forEach((d, i) => {
        [['seen', 'ch-bar-s', 0.9], ['open', 'ch-bar-o', 0.55]].forEach(([k, cls, w]) => {
          const h = d[k] / max * H;
          const r = document.createElementNS(NS, 'rect');
          r.setAttribute('x', (i * bw + bw * (1 - w) / 2).toFixed(2)); r.setAttribute('width', Math.max(1, bw * w - 1).toFixed(2));
          r.setAttribute('y', (H - h).toFixed(2)); r.setAttribute('height', h.toFixed(2)); r.setAttribute('class', cls);
          const tt = document.createElementNS(NS, 'title'); tt.textContent = d.day + ': ' + d.seen + ' seen, ' + d.open + ' opened, ' + d.out + ' out';
          r.appendChild(tt);
          svg.appendChild(r);
        });
      });
      box.appendChild(svg);
      const axis = box.appendChild(el('div', 'ch-axis'));
      const day = x => new Date(x + 'T12:00:00').toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
      axis.append(data('span', null, day(daily[0].day)), data('span', null, day(daily[daily.length - 1].day)));
      const key = box.appendChild(el('div', 'ch-key'));
      key.append(el('span', 'ch-key-s', 'seen'), el('span', 'ch-key-o', 'opened'));
    }

    /* THE PIECES THAT DID BEST */
    const top = s.top || [];
    const row2 = body.appendChild(el('div', 'ch-two'));
    const tp = row2.appendChild(el('div', 'ch-panel'));
    tp.appendChild(el('h3', 'ch-h', 'Your best pieces'));
    if (!top.length) tp.appendChild(el('p', 'ch-muted', 'None counted yet.'));
    else {
      const tbl = tp.appendChild(el('table', 'ch-table'));
      const hr = tbl.appendChild(el('thead')).appendChild(el('tr'));
      ['Piece', 'Seen', 'Opened', 'Out'].forEach((h, i) => hr.appendChild(el('th', i ? 'num' : null, h)));
      const tb = tbl.appendChild(el('tbody'));
      top.forEach(x => {
        const tr = tb.appendChild(el('tr'));
        const td = tr.appendChild(el('td'));
        const a = td.appendChild(data('a', null, x.title));
        a.href = BASE + 'creators/?l=' + encodeURIComponent(outlet.league_slug) + '&o=' + encodeURIComponent(outlet.slug) + '&p=' + encodeURIComponent(x.slug);
        [x.seen, x.open, x.out].forEach(v => tr.appendChild(data('td', 'num', fmt(v))));
      });
    }

    /* WHERE READERS CAME FROM, AND ON WHAT */
    const wp = row2.appendChild(el('div', 'ch-panel'));
    wp.appendChild(el('h3', 'ch-h', 'Where readers came from'));
    const src = s.sources || [];
    if (!src.length) wp.appendChild(el('p', 'ch-muted', 'Nothing opened yet.'));
    const all = src.reduce((m, x) => m + x.open, 0) || 1;
    src.forEach(x => {
      const r = wp.appendChild(el('div', 'ch-src'));
      r.appendChild(el('span', 'ch-src-l', SOURCES[x.source] || x.source));
      const bar = r.appendChild(el('span', 'ch-src-b'));
      bar.style.setProperty('--w', Math.round(x.open / all * 100) + '%');
      r.appendChild(data('span', 'ch-src-n', fmt(x.open)));
    });
    if ((s.sites || []).length) {
      wp.appendChild(el('p', 'ch-sub', 'Other sites'));
      const ul = wp.appendChild(el('ul', 'ch-sites'));
      s.sites.forEach(x => { const li = ul.appendChild(el('li')); li.append(data('span', null, x.site), data('b', null, fmt(x.open))); });
    }
    const dv = s.devices || {};
    const dn = (dv.phone || 0) + (dv.tablet || 0) + (dv.desktop || 0);
    if (dn) {
      wp.appendChild(el('p', 'ch-sub', 'On what'));
      const bar = wp.appendChild(el('div', 'ch-dev'));
      [['phone', 'Phones'], ['tablet', 'Tablets'], ['desktop', 'Computers']].forEach(([k, label]) => {
        if (!dv[k]) return;
        const pc2 = Math.round(dv[k] / dn * 100);
        const seg2 = bar.appendChild(el('span', 'ch-dev-' + k));
        seg2.style.flexGrow = String(dv[k]);
        seg2.title = label + ': ' + pc2 + '%';
        seg2.appendChild(el('span', null, label + ' ' + pc2 + '%'));
      });
    }
    body.appendChild(el('p', 'ch-muted ch-note', 'Counted anonymously: a piece is counted, never a person. Your own visits to your own pieces are not counted.'));
  }

  /* ============================================================ THE WRITING DESK === */
  const KIND = { article: 'Article', video: 'Video', podcast: 'Podcast', social: 'Post' };
  async function desk() {
    const sec = $('#desk'), body = $('#deskBody'), nw = $('#deskNew');
    if (!outlet) { sec.classList.add('hide'); return; }
    sec.classList.remove('hide');
    nw.textContent = '';
    [['article', 'New article'], ['video', 'New video'], ['podcast', 'New episode'], ['social', 'New post']].forEach(([k, label], i) => {
      const a = nw.appendChild(el('a', 'ep-btn' + (i ? '' : ' pri'), label));
      a.href = studio('&new=' + k);
    });
    body.textContent = '';
    body.appendChild(empty('Loading…'));
    const { data: S, error } = await sb.rpc('creator_studio', { p_outlet: outlet.outlet_id });
    body.textContent = '';
    if (error) { body.appendChild(empty('Your pieces could not be read: ' + errText(error))); return; }
    const posts = (S && S.posts) || [];
    if (!posts.length) { body.appendChild(empty('Nothing written yet: start with a new article, or a video, an episode or a post from your own platforms.')); return; }
    const cols = body.appendChild(el('div', 'ch-desk'));
    const when = x => new Date(x).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    /* each line is [words, date]: the words are translated, the date is the reader's own */
    [['draft', 'Drafts', p => ['edited', when(p.updated_at)]],
     ['scheduled', 'Scheduled', p => ['goes out', when(p.published_at)]],
     ['published', 'Published', p => [p.hidden ? 'hidden by the league' : 'went out', when(p.published_at)]]].forEach(([st, title, line]) => {
      const mine = posts.filter(p => p.status === st).sort((a, b) => st === 'scheduled' ? new Date(a.published_at) - new Date(b.published_at)
        : new Date(b.updated_at || b.published_at) - new Date(a.updated_at || a.published_at)).slice(0, 4);
      const col = cols.appendChild(el('div', 'ch-panel ch-col'));
      col.appendChild(el('h3', 'ch-h', title));
      if (!mine.length) { col.appendChild(el('p', 'ch-muted', st === 'draft' ? 'No drafts.' : st === 'scheduled' ? 'Nothing scheduled.' : 'Nothing out yet.')); return; }
      mine.forEach(p => {
        const a = col.appendChild(el('a', 'ch-piece'));
        a.href = studio('&edit=' + encodeURIComponent(p.id));
        a.appendChild(data('b', null, p.title));
        const ln = a.appendChild(el('span'));
        ln.append(el('span', null, KIND[p.kind] || p.kind), ' · ');
        line(p).forEach((x, i) => { if (i) ln.append(' '); ln.appendChild(i ? data('span', null, x) : el('span', null, x)); });
      });
    });
  }

  /* ============================================================ THE LEAGUE, AND ITS STORYLINES === */
  async function leagueList() {
    const selEl = $('#chLeague');
    const D = window.EpinoiaData;
    let rows = [];
    try { rows = await D.get('leagues?select=*&order=name'); } catch (_) { rows = []; }
    if (!rows.length) { $('#stBody').textContent = ''; $('#stBody').appendChild(empty('The leagues could not be read.')); return; }
    const mine = new Set(outlets.map(o => o.league_slug));
    const add = (host, r) => { const op = host.appendChild(el('option', null, r.name)); op.value = r.slug; };
    if (mine.size) {
      const g = selEl.appendChild(el('optgroup')); g.label = tr('Your leagues');
      rows.filter(r => mine.has(r.slug)).forEach(r => add(g, r));
      const g2 = selEl.appendChild(el('optgroup')); g2.label = tr('Every league');
      rows.filter(r => !mine.has(r.slug)).forEach(r => add(g2, r));
    } else rows.forEach(r => add(selEl, r));
    let kept = null;
    try { kept = localStorage.getItem(LEAGUE_KEY); } catch (_) { kept = null; }
    const want = [Q.get('l'), kept, outlet && outlet.league_slug, 'euroleague'].find(s => s && rows.some(r => r.slug === s)) || rows[0].slug;
    selEl.value = want;
    const choose = slug => {
      league = rows.find(r => r.slug === slug);
      try { localStorage.setItem(LEAGUE_KEY, slug); } catch (_) { /* fine */ }
      const q = new URLSearchParams(location.search); q.set('l', slug);
      try { history.replaceState(null, '', '?' + q.toString() + location.hash); } catch (_) { /* fine */ }
      /* the page in the league's colours, as a league's own pages wear them */
      const TC = window.EpinoiaTeamColour;
      if (TC && TC.league) { try { TC.league(league, { keepAccent: !!(league.theme && league.theme.accent) }); } catch (_) { /* its own look */ } }
      stories().then(() => { graphics(); icons(); });
    };
    selEl.addEventListener('change', () => choose(selEl.value));
    choose(want);
  }

  async function stories() {
    const body = $('#stBody');
    body.textContent = '';
    body.appendChild(empty('Reading ' + league.name + '…'));
    const D = window.EpinoiaData, S = window.EpinoiaStorylines;
    try { ctx = await D.context(league.slug); } catch (e) { ctx = null; }
    body.textContent = '';
    const comp = ctx && ctx.comp;
    if (!comp) { body.appendChild(empty(league.name + ' has no season on the site yet.')); return; }
    const head = body.appendChild(el('p', 'ch-muted ch-ctx'));
    head.appendChild(data('span', null, [league.name, comp.name !== league.name ? comp.name : null, ctx.season && ctx.season.name].filter(Boolean).join(' · ')));
    const la = head.appendChild(el('a', null, 'the league’s page →'));
    la.href = BASE + '?l=' + encodeURIComponent(league.slug);
    const loading = body.appendChild(empty('Reading the numbers…'));

    const nowIso = new Date().toISOString();
    const settle = p => p.then(v => v, () => null);
    const standings = await settle(D.get('standings?competition_id=eq.' + comp.id +
      '&select=team_id,rank,gp,w,l,streak,group_name,pts_for,pts_against&order=group_name.asc,rank.asc')) || [];
    const maxGp = standings.reduce((m, s) => Math.max(m, s.gp || 0), 0);
    const min = Math.max(1, Math.ceil(maxGp * 0.4));
    const PSS = 'player_season_stats?competition_id=eq.' + comp.id + '&gp=gte.' + min +
                '&select=player_id,first_name,last_name,team_short,gp,pts,ppg,rpg,apg';
    const [ppg, rpg, apg, totals, results, fixtures, records] = await Promise.all([
      settle(D.get(PSS + '&order=ppg.desc&limit=3')), settle(D.get(PSS + '&order=rpg.desc&limit=2')),
      settle(D.get(PSS + '&order=apg.desc&limit=2')), settle(D.get(PSS + '&order=pts.desc&limit=25')),
      settle(D.get('games?competition_id=eq.' + comp.id + '&status=eq.final&select=id,tipoff_at,home_team_id,away_team_id,home_score,away_score&order=tipoff_at.desc&limit=120')),
      settle(D.get('games?competition_id=eq.' + comp.id + '&status=eq.scheduled&tipoff_at=gte.' + encodeURIComponent(nowIso) +
                   '&select=id,tipoff_at,home_team_id,away_team_id&order=tipoff_at.asc&limit=60')),
      window.EpinoiaRecords ? settle(window.EpinoiaRecords.load({ comps: [comp.id] })) : Promise.resolve(null)
    ]);
    const ids = [...new Set(standings.map(s => s.team_id).concat((results || []).flatMap(g => [g.home_team_id, g.away_team_id]),
                                                                 (fixtures || []).flatMap(g => [g.home_team_id, g.away_team_id])).filter(Boolean))];
    const teams = new Map();
    for (let i = 0; i < ids.length; i += 100) {
      const rows = await settle(D.get('teams?id=in.(' + ids.slice(i, i + 100).join(',') + ')&select=id,name,short_name,slug,colour'));
      (rows || []).forEach(t => teams.set(t.id, t));
    }
    loading.remove();
    /* the coverage plan reads the league's newsdesk; without one, it is built from these same reads */
    coverage({ comp, standings, teams, results: results || [], fixtures: fixtures || [] }).catch(e => console.warn('[coverage]', e));
    const cards = S.build({ comp, standings, teams, leaders: { ppg: ppg || [], rpg: rpg || [], apg: apg || [], totals: totals || [] },
                            records, results: results || [], fixtures: fixtures || [], now: new Date() });
    if (!cards.length) { body.appendChild(empty('Nothing to say yet: ' + league.name + ' has no games finished in ' + (ctx.season ? ctx.season.name : 'this season') + '.')); return; }
    const grid = body.appendChild(el('div', 'ch-stories'));
    cards.forEach(c => {
      const card = grid.appendChild(el('article', 'ch-story'));
      card.dataset.k = c.key;
      card.appendChild(el('span', 'ch-kick', c.kicker));
      card.appendChild(data('h3', 'ch-story-h', c.head));
      const ul = card.appendChild(el('ul', 'ch-story-l'));
      c.lines.forEach(l => ul.appendChild(data('li', null, l)));
      const acts = card.appendChild(el('div', 'ch-story-a'));
      const cp = acts.appendChild(el('button', 'ep-btn mini', 'Copy'));
      cp.type = 'button';
      cp.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(c.copy); cp.textContent = 'Copied'; }
        catch (_) { cp.textContent = 'Select it above'; }
        setTimeout(() => { cp.textContent = 'Copy'; }, 2200);
      });
      if (outlet) {
        const w = acts.appendChild(el('a', 'ep-btn mini', 'Write about it'));
        w.href = studio('&new=article&title=' + encodeURIComponent(c.head));
      }
    });
  }

  /* ======================================================= COVERAGE PLAN === */
  /* THE LEAGUE'S NEWSDESK, AS A PLAN (newsdesk.js): the hourly file (narrative.js, tools/build-narratives.mjs) drawn in
     full - the big picture, today, the storylines to run with their evidence, counterpoints and ways to cover them, what
     is under the radar, the week ahead game by game, the recaps worth writing, players and clubs to feature, data notes
     and a calendar. A league with no file yet gets the plan built here from the reads above (no player lines and no
     recaps: a lighter one, and it says so). Each storyline can be copied or, for a writer, opened as a new article. */
  let covRun = 0;
  async function coverage(read) {
    const host = $('#covBody'), acts = $('#covActs');
    const ND = window.EpinoiaNewsdesk, NB = window.EpinoiaNarrative;
    if (!host || !ND || !league) return;
    const run = ++covRun;
    host.textContent = ''; if (acts) acts.textContent = '';
    host.appendChild(empty('Reading ' + league.name + '’s newsdesk…'));
    let b = await ND.load(league.id), light = false;
    if (run !== covRun) return;
    if (!b && NB) {
      try {
        const tmap = {};
        (read.teams || new Map()).forEach((t, id) => { tmap[id] = t; });
        b = NB.build({ now: new Date(), league: { id: league.id, slug: league.slug, name: league.name, timezone: league.timezone || null },
          season: ctx && ctx.season ? { id: ctx.season.id, name: ctx.season.name } : null, comp: read.comp,
          table: { comp: read.comp, rows: read.standings || [] }, teams: tmap, games: read.results || [], fixtures: read.fixtures || [] });
        light = true;
      } catch (e) { console.warn('[coverage] build', e); b = null; }
    }
    host.textContent = '';
    if (!b || !b.stories.length) { host.appendChild(empty('Nothing to plan yet: ' + league.name + ' has no games to read in ' + (ctx && ctx.season ? ctx.season.name : 'this season') + '.')); return; }
    /* the whole plan, to paste into a document */
    if (acts) {
      const cp = acts.appendChild(el('button', 'ep-btn mini', 'Copy the whole plan'));
      cp.type = 'button';
      cp.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(ND.planText(b)); cp.textContent = 'Copied'; } catch (_) { cp.textContent = 'Could not copy'; }
        setTimeout(() => { cp.textContent = 'Copy the whole plan'; }, 2200);
      });
    }
    const note = host.appendChild(el('p', 'nd-note'));
    note.textContent = light
      ? 'Built here from the table and the results: the hourly newsdesk for this league, with every player line and the recaps of the week, is not out yet.'
      : 'From the league’s newsdesk, ' + ND.ago(b.built).replace(/^updated /, 'built ') + ', from every game’s box and play-by-play' +
        (b.stats && b.stats.model ? ' and the league’s own model of what wins.' : ' and the usual weights of the four factors (the league’s own model is not out yet).');
    host.insertAdjacentHTML('beforeend', ND.coverageHTML(b, { base: BASE, write: true }));
    /* each storyline: copy it, and for a writer, start a piece from it */
    host.querySelectorAll('.nd-acts[data-story]').forEach(span => {
      const s = b.stories.find(x => x.id === span.dataset.story);
      if (!s) return;
      const cp = span.appendChild(el('button', 'ep-btn mini', 'Copy'));
      cp.type = 'button';
      cp.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(s.copy || s.head); cp.textContent = 'Copied'; } catch (_) { cp.textContent = 'Select it above'; }
        setTimeout(() => { cp.textContent = 'Copy'; }, 2200);
      });
      if (outlet) {
        const w = span.appendChild(el('a', 'ep-btn mini', 'Write about it'));
        w.href = studio('&new=article&title=' + encodeURIComponent(s.head));
      }
    });
    try { window.dispatchEvent(new Event('epinoia:sections')); } catch (_) { /* fine */ }
  }

  /* ============================================================ GRAPHICS === */
  const crestOf = t => (t && t.logo_path && typeof window.epinoiaLogoUrl === 'function' ? window.epinoiaLogoUrl(t.logo_path, 256) : null);
  let gfxRun = 0;
  async function graphics() {
    const body = $('#gfxBody'), sizeHost = $('#gfxSize');
    const G = window.EpinoiaSocialGfx, SC = window.EpinoiaSocialCard;
    body.textContent = '';
    if (!G || !SC || !sb || !ctx || !ctx.comps || !ctx.comps.length) { body.appendChild(empty('No graphics for ' + league.name + ' yet: it has no season on the site.')); return; }
    const run = ++gfxRun;
    sizeHost.textContent = '';
    Object.keys(SC.SIZES).forEach(k => {
      const b = sizeHost.appendChild(el('button', null, SC.SIZES[k].label));
      b.type = 'button'; b.setAttribute('aria-pressed', String(k === gfxSize));
      b.addEventListener('click', () => { gfxSize = k; graphics(); });
    });
    body.appendChild(empty('Drawing ' + league.name + '’s week…'));
    let dataW = null;
    try { dataW = await G.read(sb, { id: league.id, name: league.name, slug: league.slug }, ctx.comps.filter(c => c.id)); }
    catch (e) { body.textContent = ''; body.appendChild(empty('The week could not be read: ' + errText(e))); return; }
    if (run !== gfxRun) return;
    body.textContent = '';
    const list = G.items(dataW, gfxSize, crestOf);
    const bar = body.appendChild(el('div', 'pg-row'));
    const zipB = bar.appendChild(el('button', 'ep-btn mini', 'Download all (' + (list.length + 3) + ') as a ZIP'));
    zipB.type = 'button';
    body.appendChild(el('p', 'ch-muted', 'Made from the last seven days and the week ahead, in ' + league.name + '’s colours, with the words to post beneath each.'));
    const groups = [['week', 'The week'], ['games', 'Each game']];
    groups.forEach(([g, label]) => {
      const mine = list.filter(x => x.group === g);
      if (!mine.length) return;
      body.appendChild(el('h3', 'ch-h ch-gh', label));
      const grid = body.appendChild(el('div', 'ch-gfx'));
      mine.forEach(it => grid.appendChild(gfxCard(it.title, false, () => SC.canvas(it.model, { size: gfxSize, scale: 0.25 }),
        async () => save(await SC.png(it.model, { size: gfxSize, scale: 1 }), SC.filename(it.model, gfxSize)), SC.caption(it.model))));
    });
    if (!list.length) body.appendChild(empty('No game finished in the last seven days and none in the week ahead: the backgrounds below are ready all the same.'));
    /* BACKGROUNDS in the league's colours, for a creator's own words and pictures */
    body.appendChild(el('h3', 'ch-h ch-gh', 'Backgrounds'));
    const bg = body.appendChild(el('div', 'ch-gfx'));
    const styles = [['gradient', 'Gradient'], ['mosaic', 'Mosaic'], ['court', 'Court']];
    styles.forEach(([k, label]) => bg.appendChild(gfxCard(label + ' background', true, () => Promise.resolve(background(k, gfxSize, 0.25)),
      () => new Promise(r => background(k, gfxSize, 1).toBlob(bl => { save(bl, league.slug + '-background-' + k + '-' + gfxSize + '.png'); r(); }, 'image/png')), null)));
    zipB.addEventListener('click', async () => {
      zipB.disabled = true; zipB.textContent = 'Drawing…';
      try {
        const files = [];
        for (const it of list) {
          const bl = await SC.png(it.model, { size: gfxSize, scale: 1 });
          files.push({ name: SC.filename(it.model, gfxSize), bytes: new Uint8Array(await bl.arrayBuffer()) });
          const cap = SC.caption(it.model);
          if (cap) files.push({ name: SC.filename(it.model, gfxSize).replace(/\.png$/, '.txt'), bytes: new TextEncoder().encode(cap) });
        }
        for (const [k] of styles) {
          const bl = await new Promise(r => background(k, gfxSize, 1).toBlob(r, 'image/png'));
          files.push({ name: league.slug + '-background-' + k + '-' + gfxSize + '.png', bytes: new Uint8Array(await bl.arrayBuffer()) });
        }
        save(new Blob([SC.zip(files, new Date())], { type: 'application/zip' }), league.slug + '-graphics-' + gfxSize + '.zip');
      } catch (e) { zipB.textContent = 'Could not draw them'; setTimeout(() => { zipB.textContent = 'Download all as a ZIP'; }, 3000); zipB.disabled = false; return; }
      zipB.disabled = false; zipB.textContent = 'Download all (' + (list.length + 3) + ') as a ZIP';
    });
  }
  /* words: the title is the page's own words (translated), not a game's names */
  function gfxCard(title, words, paint, download, caption) {
    const SC = window.EpinoiaSocialCard;
    const box = el('div', 'ch-gcard');
    const thumb = box.appendChild(el('div', 'ch-thumb'));
    thumb.style.aspectRatio = SC.SIZES[gfxSize].w + ' / ' + SC.SIZES[gfxSize].h;
    box.appendChild((words ? el : data)('div', 'ch-gt', title));
    const acts = box.appendChild(el('div', 'ch-story-a'));
    const dl = acts.appendChild(el('button', 'ep-btn mini', 'Download'));
    dl.type = 'button';
    dl.addEventListener('click', async () => {
      dl.disabled = true; dl.textContent = 'Drawing…';
      try { await download(); dl.textContent = 'Download'; } catch (_) { dl.textContent = 'Could not draw it'; setTimeout(() => { dl.textContent = 'Download'; }, 3000); }
      dl.disabled = false;
    });
    if (caption) {
      const cp = acts.appendChild(el('button', 'ep-btn mini', 'Copy the words'));
      cp.type = 'button';
      cp.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(caption); cp.textContent = 'Copied'; } catch (_) { cp.textContent = 'Could not copy'; }
        setTimeout(() => { cp.textContent = 'Copy the words'; }, 2200);
      });
    }
    const go = async () => {
      try { const c = await paint(); c.className = 'ch-img'; thumb.appendChild(c); }
      catch (_) { thumb.appendChild(el('div', 'ch-muted', 'Could not draw it.')); }
    };
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); go(); } }, { rootMargin: '300px' });
      io.observe(thumb);
    } else go();
    return box;
  }
  const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : d);
  /* a background at one of the sizes: the league's two colours, and a pattern of the site's */
  function background(style, size, scale) {
    const SC = window.EpinoiaSocialCard;
    const W = Math.round(SC.SIZES[size].w * scale), H = Math.round(SC.SIZES[size].h * scale);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const a = hex(league.colour_a, '#0b3d2e'), b = hex(league.colour_b, '#04100b');
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, a); g.addColorStop(1, b);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (style === 'mosaic') {
      const s = 54 * scale;
      for (let i = 0; i * s < W; i++) for (let j = 0; j * s < H; j++) {
        const v = ((i * 7919 + j * 104729) % 97) / 97;           // the same pattern every time
        if (v < 0.55) continue;
        x.fillStyle = 'rgba(255,255,255,' + (0.04 + (v - 0.55) * 0.28).toFixed(3) + ')';
        x.fillRect(i * s + 2 * scale, j * s + 2 * scale, s - 4 * scale, s - 4 * scale);
      }
    } else if (style === 'court') {
      x.strokeStyle = 'rgba(255,255,255,0.22)'; x.lineWidth = Math.max(1, 6 * scale);
      const cx = W / 2, r = Math.min(W, H) * 0.16;
      x.beginPath(); x.moveTo(0, H / 2); x.lineTo(W, H / 2); x.stroke();
      x.beginPath(); x.arc(cx, H / 2, r, 0, Math.PI * 2); x.stroke();
      const kw = W * 0.34, kh = H * 0.2;
      x.strokeRect(cx - kw / 2, 0, kw, kh); x.strokeRect(cx - kw / 2, H - kh, kw, kh);
      x.beginPath(); x.arc(cx, 0, W * 0.44, 0.08 * Math.PI, 0.92 * Math.PI); x.stroke();
      x.beginPath(); x.arc(cx, H, W * 0.44, 1.08 * Math.PI, 1.92 * Math.PI); x.stroke();
    }
    return c;
  }

  /* ============================================================ ICONS === */
  let icColour = null, icWeight = 1.8, icPx = 512;
  function icons() {
    const I = window.EpinoiaIcons, SC = window.EpinoiaSocialCard;
    const pick = $('#icPick'), body = $('#icBody');
    if (!I) return;
    const lg = league || {};
    const colours = [['league', hex(lg.colour_a, '#93f2bf'), (lg.name || 'The league') + '’s colour'],
                     ['league2', hex(lg.colour_b, '#8ff5ff'), 'Its second colour'],
                     ['white', '#ffffff', 'White'], ['ink', '#0d1f17', 'Ink']];
    if (!icColour || !colours.some(c => c[1] === icColour)) icColour = colours[0][1];
    pick.textContent = '';
    const sw = pick.appendChild(el('div', 'ch-swatches'));
    sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'Colour');
    colours.forEach(([k, v, label]) => {
      const b = sw.appendChild(el('button', 'ch-sw'));
      b.type = 'button'; b.title = label; b.setAttribute('aria-label', label);
      b.style.setProperty('--sw', v);
      b.setAttribute('aria-pressed', String(v === icColour));
      b.addEventListener('click', () => { icColour = v; icons(); });
    });
    const wsel = pick.appendChild(el('select', 'ep-input ch-sel'));
    wsel.setAttribute('aria-label', 'Weight');
    [[1.4, 'Light'], [1.8, 'Regular'], [2.4, 'Bold']].forEach(([v, t]) => { const o = wsel.appendChild(el('option', null, t)); o.value = v; });
    wsel.value = String(icWeight);
    wsel.addEventListener('change', () => { icWeight = Number(wsel.value); icons(); });
    const psel = pick.appendChild(el('select', 'ep-input ch-sel'));
    psel.setAttribute('aria-label', 'PNG size');
    [256, 512, 1024].forEach(v => { const o = psel.appendChild(el('option', null, 'PNG ' + v + ' px')); o.value = v; });
    psel.value = String(icPx);
    psel.addEventListener('change', () => { icPx = Number(psel.value); });
    const all = pick.appendChild(el('button', 'ep-btn mini', 'Download all (' + I.LIST.length + ') as a ZIP'));
    all.type = 'button';
    all.disabled = !SC;
    all.addEventListener('click', async () => {
      all.disabled = true; all.textContent = 'Drawing…';
      try {
        const files = [];
        for (const it of I.LIST) {
          const opts = { colour: icColour, weight: icWeight, px: icPx };
          files.push({ name: 'epinoia-icons/svg/' + it.key + '.svg', bytes: new TextEncoder().encode(I.svg(it.key, Object.assign({}, opts, { px: 24 }))) });
          files.push({ name: 'epinoia-icons/png-' + icPx + '/' + it.key + '.png', bytes: new Uint8Array(await (await I.png(it.key, opts)).arrayBuffer()) });
        }
        save(new Blob([SC.zip(files, new Date())], { type: 'application/zip' }), 'epinoia-icons-' + icColour.slice(1) + '.zip');
      } catch (_) { /* below */ }
      all.disabled = false; all.textContent = 'Download all (' + I.LIST.length + ') as a ZIP';
    });
    body.textContent = '';
    const grid = body.appendChild(el('div', 'ch-icons'));
    const dark = ['#ffffff'].includes(icColour) || contrastLow(icColour);
    I.LIST.forEach(it => {
      const tile = grid.appendChild(el('div', 'ch-icon' + (dark ? ' on-dark' : '')));
      const art = tile.appendChild(el('div', 'ch-icon-art'));
      art.appendChild(I.node(it.key, { colour: icColour, weight: icWeight }));
      tile.appendChild(el('span', 'ch-icon-n', it.name));
      const acts = tile.appendChild(el('div', 'ch-icon-a'));
      const sv = acts.appendChild(el('button', 'ep-btn mini', 'SVG'));
      sv.type = 'button';
      sv.addEventListener('click', () => save(new Blob([I.svg(it.key, { colour: icColour, weight: icWeight })], { type: 'image/svg+xml' }), it.key + '.svg'));
      const pn = acts.appendChild(el('button', 'ep-btn mini', 'PNG'));
      pn.type = 'button';
      pn.addEventListener('click', async () => { try { save(await I.png(it.key, { colour: icColour, weight: icWeight, px: icPx }), it.key + '-' + icPx + '.png'); } catch (_) { /* nothing */ } });
    });
  }
  /* a pale colour is shown on a dark tile so it can be seen */
  function contrastLow(h) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
    if (!m) return false;
    const [r, g, b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.7;
  }
})();
