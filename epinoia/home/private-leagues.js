'use strict';
/* ============================================================================
   HOME — PRIVATE LEAGUES, section 'privateLeagues'.

   The private leagues this reader was let into, drawn as the very same cards
   the leagues section above uses (leagues.js grid()). Shut for everybody else.

   THESE ROWS DO NOT EXIST ANONYMOUSLY. A private league is invisible to a
   stranger by row-level security — that is what keeps it off the front page in
   the first place — so every read here carries the reader's own token, the
   league row and the three facts printed on its card alike. Asked without one
   the request succeeds and returns nothing, which is a section that is always
   empty rather than an error anybody would notice.

   THE TOKEN COMES FROM follow.js. access.js will not supply one on HOME: its
   authHeaders speaks only for a members-only league it has already asked
   access_state about, and HOME asks about none. follow.js reads the stored
   session the way nav.js does.

   league_guests is readable by the guest themselves (0139 guests_read), so the
   embedded leagues(...) resolves for exactly the people it should and returns
   nothing for anybody else — the same policy, asked from the other end.
   ============================================================================ */
(function () {
  const H = window.EpinoiaHome;
  if (!H) return;

  const COLS = 'id,slug,name,country,colour_a,colour_b,colour_source,logo_path,' +
    'access_mode,access_fixtures_public';
  const HOUR = 3600 * 1000;

  function token() {
    const F = window.EpinoiaFollow;
    const s = F && typeof F.session === 'function' ? F.session() : null;
    return (s && s.token) || null;
  }

  async function api(path, tok) {
    const c = window.EPINOIA_CONFIG;
    if (!c || !c.supabaseUrl) throw new Error('config.js has not loaded');
    const r = await fetch(c.supabaseUrl + '/rest/v1/' + path, {
      cache: 'no-store',
      headers: {
        apikey: c.supabaseAnonKey, Accept: 'application/json',
        Authorization: 'Bearer ' + tok
      }
    });
    if (!r.ok) throw new Error(r.status + ' on ' + path.split('?')[0]);
    return r.json();
  }

  const one = v => (Array.isArray(v) ? v[0] : v) || null;

  H.register('privateLeagues', async function (ctx) {
    const L = window.EpinoiaHomeLeagues;
    if (!L) throw new Error('leagues.js has not loaded');
    const tok = token();
    if (!tok) return;                     // signed out: the section stays shut

    const rows = await api('league_guests?select=joined_at,leagues(' + COLS + ')' +
      '&order=joined_at.desc', tok);
    /* a guest row whose league has since been deleted embeds as null */
    const ls = (rows || []).map(r => one(r.leagues)).filter(Boolean);
    if (!ls.length) return;

    /* The three facts the public cards carry, asked as this reader so a private
       league's clubs, season and next game are not blank on its own card. */
    const [counts, seasons] = await Promise.all([
      api('teams?select=league_id&league_id=not.is.null', tok).then(ts => {
        const m = new Map();
        ts.forEach(t => { if (t.league_id) m.set(t.league_id, (m.get(t.league_id) || 0) + 1); });
        return m;
      }).catch(() => null),
      api('seasons?select=league_id,name,starts_on&order=starts_on.desc.nullslast,name.desc', tok)
        .then(ss => {
          const m = new Map();
          ss.forEach(s => { if (!m.has(s.league_id)) m.set(s.league_id, s); });
          return m;
        }).catch(() => new Map())
    ]);

    const from = new Date(Date.now() - 2 * HOUR).toISOString();
    const nextFor = id => api('games?select=id,tipoff_at,status,' +
      'home:home_team_id(name,short_name),away:away_team_id(name,short_name),' +
      'competitions!inner(id,seasons!inner(id,league_id))' +
      '&status=eq.scheduled&tipoff_at=gte.' + encodeURIComponent(from) +
      '&competitions.seasons.league_id=eq.' + encodeURIComponent(id) +
      '&order=tipoff_at.asc,id.asc&limit=1', tok).then(r => r[0] || null);

    const g = L.grid(ls, ctx, {
      counts, seasons, nextFor, label: 'Private leagues you were let into'
    });

    ctx.host.textContent = '';
    ctx.host.appendChild(g.node);
    const sec = ctx.host.closest('.sec');
    if (sec) sec.hidden = false;
    ctx.fadeIn(g.node);
    await Promise.all(g.pending);
  });
})();
