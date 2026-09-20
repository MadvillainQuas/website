'use strict';
/* ============================================================================
   HOME — MY FOLLOWED, section 'followed'.

   The last three results and the next three games across every league and club
   this reader follows. Shut for everybody else: signed out, following nothing,
   or following things with no games either side of today.

   THE FOLLOW LIST IS READ THROUGH follow.js, NEVER access.js. access.js
   attaches a token only where it changes the answer for a members-only league
   it has already asked access_state about (its authHeaders), and HOME never
   asks about a league — so on this page it returns no token at all, the read
   goes out anonymous, and fan_prefs comes back [] for a reader who is signed
   in and following plenty. That is exactly why this section was permanently
   empty. follow.js reads the stored session the way nav.js does and already
   holds the fan's row for the bells, so this shares one read rather than
   making a second.

   The cards are the platform's own (globalgames.js card()), the same ones the
   daily fixtures rail above is built from, so a followed game reads as the
   same kind of thing as any other.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;

  const N = 3;

  /* A follow list is a stored array this page puts straight into a query
     string, so it is checked rather than trusted: anything that is not a UUID
     never reaches the request. */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = v => (Array.isArray(v) ? v : []).filter(x => UUID.test(String(x)));
  const list = a => a.map(x => '"' + x + '"').join(',');

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* A league follow and a club follow cannot be one request — one filters an
     embedded resource, the other two columns of the game itself — so they go
     out together and are merged. Either side failing is not the section
     failing: a reader who follows a club and a league still gets the club. */
  function reads(G, leagueIds, teamIds, tail) {
    const out = [];
    if (leagueIds.length) {
      out.push(G.request('games?select=' + G.SEL +
        '&competitions.seasons.leagues.id=in.(' + list(leagueIds) + ')' + tail, false));
    }
    if (teamIds.length) {
      out.push(G.request('games?select=' + G.SEL +
        '&or=(home_team_id.in.(' + list(teamIds) + '),away_team_id.in.(' + list(teamIds) + '))' +
        tail, false));
    }
    return Promise.all(out.map(p => p.catch(() => [])));
  }

  function block(title, rows, ctx) {
    const b = el('div', 'hm-fol');
    b.appendChild(el('h3', 'hm-fol-h', title));
    const rail = el('div', 'fxc-rail');
    rail.setAttribute('role', 'list');
    rows.forEach(g => {
      const c = window.EpinoiaGlobalGames.card(g, { base: ctx.base, now: ctx.now });
      c.setAttribute('role', 'listitem');
      rail.appendChild(c);
    });
    b.appendChild(rail);
    return b;
  }

  H.register('followed', async function (ctx) {
    const F = window.EpinoiaFollow;
    const G = window.EpinoiaGlobalGames;
    if (!F || !G) throw new Error('follow.js or globalgames.js has not loaded');
    /* Signed out is not an error, and not an empty state either: there is
       nothing to say to somebody who has not signed in, so the section stays
       shut and the page reads as it always did. */
    if (!F.session()) return;

    const prefs = await F.load();
    const leagueIds = ids(prefs && prefs.fav_league_ids);
    const teamIds = ids(prefs && prefs.fav_team_ids);
    if (!leagueIds.length && !teamIds.length) return;

    const from = new Date(Date.now() - G.STALE_MS).toISOString();
    const [past, soon] = await Promise.all([
      reads(G, leagueIds, teamIds, '&status=eq.final&order=tipoff_at.desc,id.desc&limit=' + N),
      reads(G, leagueIds, teamIds, '&status=in.(scheduled,live)&tipoff_at=gte.' +
        encodeURIComponent(from) + '&order=tipoff_at.asc,id.asc&limit=' + N)
    ]);

    /* A game can arrive twice — a followed club playing in a followed league —
       so the two lists are merged before either is cut to three. */
    const t = g => Date.parse((g && g.tipoff_at) || '') || 0;
    const flat = rs => G.dedupe([].concat.apply([], rs));
    const results = flat(past).sort((a, b) => t(b) - t(a)).slice(0, N);
    const upcoming = flat(soon).sort((a, b) => t(a) - t(b)).slice(0, N);
    if (!results.length && !upcoming.length) return;

    const wrap = el('div', 'hm-fols');
    if (results.length) wrap.appendChild(block('Recent results', results, ctx));
    if (upcoming.length) wrap.appendChild(block('Coming up', upcoming, ctx));

    ctx.host.textContent = '';
    ctx.host.appendChild(wrap);
    const sec = ctx.host.closest('.sec');
    if (sec) sec.hidden = false;
    ctx.fadeIn(wrap);
  });
})();
