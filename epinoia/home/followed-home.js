'use strict';
/* ============================================================================
   HOME — MY FOLLOWED, section 'followed'.

   One dropdown per league and per club this reader follows, in the shape the
   global fixtures page uses (details.ep-acc, kit/epinoia-kit.css 10b), each
   opening on three rows:

     Recent results   the last three, as fixture cards
     Coming up        the next three, as fixture cards
     Best this week   the three best players in that league or club this week

   The summary carries the league's badge or the club's name and a link through
   to its page, so the row both opens and directs.

   THE FOLLOW LIST IS READ THROUGH follow.js, NEVER access.js. access.js
   attaches a token only where it changes the answer for a members-only league
   it has already asked access_state about (its authHeaders), and HOME asks
   about no league — so on this page it returns no token at all, the read goes
   out anonymous, and fan_prefs comes back [] for a reader who is signed in and
   following plenty. follow.js reads the stored session the way nav.js does and
   already holds the fan's row for the bells, so this shares one read.

   TWO REQUESTS FOR EVERY DROPDOWN'S GAMES, NOT TWO EACH. The results and the
   fixtures are asked once across every follow and grouped in the browser; a
   game in a followed league played by a followed club is in both dropdowns,
   which is right, and is why they are grouped rather than queried separately.

   THE STARS ARE THE EXPENSIVE PART AND ARE NOT PAID FOR UNTIL THEY ARE ASKED
   FOR. Each one is a week of box scores through stars.js — the same arithmetic
   as the podium below, so HOME cannot disagree with itself about who a star is
   — so it runs when its dropdown is first opened. Every row starts closed, so
   the section costs nothing beyond its two game reads until a reader opens one.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;

  const N = 3;
  /* far enough back that a league playing once a week still has three results */
  const RESULT_DAYS = 24;
  const DAY = 86400000;

  /* A follow list is a stored array this page puts straight into a query
     string, so it is checked rather than trusted: anything that is not a UUID
     never reaches the request. */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = v => (Array.isArray(v) ? v : []).filter(x => UUID.test(String(x)));
  const list = a => a.map(x => '"' + x + '"').join(',');
  const at = g => Date.parse((g && g.tipoff_at) || '') || 0;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ------------------------------------------------------------- the games ---
     A league follow and a club follow cannot be one request — one filters an
     embedded resource, the other two columns of the game itself — so they go
     out together and are merged. Either side failing is not the section
     failing: a reader who follows a club and a league still gets the club. */
  /* SEL carries the two clubs as embedded rows (home:home_team_id(…)), which is
     what the cards want, but stars.js computeWindow puts a player on a side with
     the SCALAR game.home_team_id / away_team_id. Without them every player is
     attached to an undefined club, the team adjustment finds nothing, and BPM
     comes back null for the lot — a Best-this-week row that is silently always
     empty. They cost two integers a game and are asked for here. */
  const SEL = G => G.SEL + ',home_team_id,away_team_id';

  function games(G, leagueIds, teamIds, tail) {
    const out = [];
    if (leagueIds.length) {
      out.push(G.request('games?select=' + SEL(G) +
        '&competitions.seasons.leagues.id=in.(' + list(leagueIds) + ')' + tail, false));
    }
    if (teamIds.length) {
      out.push(G.request('games?select=' + SEL(G) +
        '&or=(home_team_id.in.(' + list(teamIds) + '),away_team_id.in.(' + list(teamIds) + '))' +
        tail, false));
    }
    return Promise.all(out.map(p => p.catch(() => [])))
      .then(rs => G.dedupe([].concat.apply([], rs)));
  }

  /* --------------------------------------------------------- the dropdowns ---
     A follow with no game either side of today has nothing to open onto, so it
     is left out rather than drawn empty. Its name comes off the games, which is
     also the only place a club's colours are to hand. */
  function group(G, leagueIds, teamIds, finals, soon) {
    const by = new Map();
    const want = { league: new Set(leagueIds), team: new Set(teamIds) };

    const put = (kind, id, who, g, which) => {
      const key = kind + ':' + id;
      let f = by.get(key);
      if (!f) { f = { key, kind, who, finals: [], soon: [] }; by.set(key, f); }
      if (!f.who && who) f.who = who;
      f[which].push(g);
    };

    const scan = (rows, which) => rows.forEach(g => {
      const l = G.leagueOf(g);
      if (l && want.league.has(l.id)) put('league', l.id, l, g, which);
      [g.home, g.away].forEach(t => {
        if (t && t.id && want.team.has(t.id)) put('team', t.id, t, g, which);
      });
    });
    scan(finals, 'finals');
    scan(soon, 'soon');

    const all = [...by.values()].filter(f => f.who && (f.finals.length || f.soon.length));
    all.forEach(f => {
      f.finals.sort((a, b) => at(b) - at(a));
      f.soon.sort((a, b) => at(a) - at(b));
      f.href = f.kind === 'league'
        ? '../?l=' + encodeURIComponent(f.who.slug || '')
        : '../t/?t=' + encodeURIComponent(f.who.slug || '');
    });
    /* leagues first, then clubs, each alphabetical: a fixed order, so the page
       does not reshuffle itself under a reader between visits */
    const name = f => String(f.who.name || f.who.slug || '').toLowerCase();
    return all.sort((a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'league' ? -1 : 1) || (name(a) < name(b) ? -1 : 1));
  }

  /* ------------------------------------------------------------- the stars ---
     stars.js's own arithmetic over this follow's week of finals: the same
     windows, the same minimums, the same cards as the podium further down. */
  async function stars(f, ctx) {
    const S = window.EpinoiaStars;
    const D = window.EpinoiaData;
    const G = window.EpinoiaGlobalGames;
    if (!S || !D) return null;
    const w = S.WINDOWS.filter(x => x.key === 'week')[0];
    if (!w) return null;

    /* the week runs back from the latest game this follow has played, not from
       today: a league that last played on Sunday still has a week of stars on
       Wednesday, which is what the podium below does too */
    const anchor = f.finals.length ? at(f.finals[0]) : 0;
    if (!anchor) return null;
    const rows = f.finals.filter(g => at(g) >= anchor - w.days * DAY);
    if (!rows.length) return null;

    const box = await S.boxScores(rows.map(g => g.id));
    const agg = S.computeWindow(box.pgs, box.tgs, rows, { leagueOf: g => G.leagueOf(g) });
    const top = S.pick(agg.players, w, N);
    if (!top.length) return null;

    let meta = {};
    try { meta = await D.playerMeta(top.map(p => p.id)); } catch (_) { return null; }
    /* a line with no player behind it is a scoresheet artefact, not a star */
    const named = top.filter(p => {
      const m = meta[p.id];
      return !!(m && m.slug && m.name && m.name !== 'Player');
    });
    if (!named.length) return null;

    const teamsById = {};
    f.finals.forEach(g => [g.home, g.away].forEach(t => { if (t && t.id) teamsById[t.id] = t; }));

    const r = { meta, teamsById, teamOf: agg.teamOfPlayer };
    const grid = el('div', 'stargrid');
    named.forEach((p, i) =>
      grid.appendChild(S.card(r, p, i, false, { base: ctx.base, league: p._league || null })));
    /* under .hm-stars so it picks up the phone rail and the name sizes the
       podium below uses (home/stars.css scopes them to that) */
    const wrap = el('div', 'hm-stars');
    wrap.appendChild(grid);
    return wrap;
  }

  /* ---------------------------------------------------------------- a row --- */
  function row(title, node, count) {
    const h = el('h3', 'hm-fol-h');
    h.appendChild(document.createTextNode(title));
    if (count != null) h.appendChild(el('span', 'n', ' · ' + count));
    const frag = document.createDocumentFragment();
    frag.appendChild(h);
    frag.appendChild(node);
    return frag;
  }

  /* A league dropdown has the league on its summary, so the badge on every card
     inside it would say the same thing three times; a club's does not, and its
     cards keep theirs. */
  function cards(rows, ctx, badge) {
    const grid = el('div', 'fxc-grid');
    rows.forEach(g => grid.appendChild(
      window.EpinoiaGlobalGames.card(g, { base: ctx.base, now: ctx.now, badge: !!badge })));
    return grid;
  }

  /* --------------------------------------------------------- one dropdown --- */
  function dropdown(f, ctx) {
    const G = window.EpinoiaGlobalGames;
    const det = el('details', 'ep-acc hmf-acc');

    const sum = el('summary');
    const t = el('span', 't');
    if (f.kind === 'league') {
      t.innerHTML = window.epinoiaLeagueBadge(f.who, { cls: 'lg' });
      G.wireBadges(t);
    } else {
      const dot = el('span', 'hmf-dot');
      if (/^#[0-9a-f]{6}$/i.test(String(f.who.colour || ''))) dot.style.background = f.who.colour;
      t.append(dot, el('span', 'hmf-nm', f.who.name || f.who.slug || 'Club'));
    }
    sum.appendChild(t);

    const go = el('a', 'hmf-go', f.kind === 'league' ? 'league →' : 'club →');
    go.href = f.href;
    /* inside a summary a click would toggle the row instead of following the
       link, so this one stops before it gets there */
    go.addEventListener('click', e => e.stopPropagation());
    sum.appendChild(go);
    det.appendChild(sum);

    const badge = f.kind !== 'league';
    const body = el('div', 'hmf-body');
    if (f.finals.length) {
      body.appendChild(row('Recent results', cards(f.finals.slice(0, N), ctx, badge)));
    }
    if (f.soon.length) {
      body.appendChild(row('Coming up', cards(f.soon.slice(0, N), ctx, badge)));
    }

    /* the stars row reserves its label and fills underneath, so opening a
       dropdown does not shift what is already in it */
    const starHost = el('div', 'hmf-stars');
    body.appendChild(starHost);
    det.appendChild(body);

    let asked = false;
    const fill = () => {
      if (asked) return;
      asked = true;
      if (!f.finals.length) return;
      const h = el('h3', 'hm-fol-h', 'Best this week');
      const wait = el('div', 'hmf-wait', 'working out who…');
      starHost.append(h, wait);
      stars(f, ctx).then(node => {
        wait.remove();
        if (node) starHost.appendChild(node);
        else { h.remove(); }
      }, () => { wait.remove(); h.remove(); });
    };
    det.addEventListener('toggle', () => { if (det.open) fill(); });

    return det;
  }

  /* ------------------------------------------------------------ the section --- */
  H.register('followed', async function (ctx) {
    const F = window.EpinoiaFollow;
    const G = window.EpinoiaGlobalGames;
    if (!F || !G) throw new Error('follow.js or globalgames.js has not loaded');
    /* Signed out is not an error and not an empty state either: there is
       nothing to say to somebody who has not signed in, so the section stays
       shut and the page reads as it always did. */
    if (!F.session()) return;

    const prefs = await F.load();
    const leagueIds = ids(prefs && prefs.fav_league_ids);
    const teamIds = ids(prefs && prefs.fav_team_ids);
    if (!leagueIds.length && !teamIds.length) return;

    const back = new Date(Date.now() - RESULT_DAYS * DAY).toISOString();
    const from = new Date(Date.now() - G.STALE_MS).toISOString();
    const [finals, soon] = await Promise.all([
      games(G, leagueIds, teamIds, '&status=eq.final&tipoff_at=gte.' +
        encodeURIComponent(back) + '&order=tipoff_at.desc,id.desc&limit=300'),
      games(G, leagueIds, teamIds, '&status=in.(scheduled,live)&tipoff_at=gte.' +
        encodeURIComponent(from) + '&order=tipoff_at.asc,id.asc&limit=300')
    ]);

    const follows = group(G, leagueIds, teamIds, finals, soon);
    if (!follows.length) return;

    const wrap = el('div', 'hm-fols');
    follows.forEach(f => wrap.appendChild(dropdown(f, ctx)));

    ctx.host.textContent = '';
    ctx.host.appendChild(wrap);
    const sec = ctx.host.closest('.sec');
    if (sec) sec.hidden = false;
    ctx.fadeIn(wrap);
  });
})();
