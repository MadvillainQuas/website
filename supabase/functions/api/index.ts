// ============================================================================
// EPINOIA NETWORK — read-only JSON API, v1
//
// Everything served here is already public: the pages hand the same data to
// anonymous visitors. The key is not a gate, it is an IDENTITY — so traffic
// can be attributed, a runaway script can be stopped without taking the site
// down with it, and whoever built an integration can be told when it breaks.
//
// Three properties worth stating, because they are what make an API usable by
// somebody who did not write it:
//
//   IT IS SHAPED FOR THE READER, NOT THE SCHEMA. `team` is an object with a
//   name and a slug, not a bare uuid the caller has to resolve with a second
//   request. Internal ids stay internal.
//
//   EVERY LIST IS BOUNDED AND SAYS SO. PostgREST silently caps at 1000 rows,
//   which is the kind of truncation that produces a season table quietly short
//   of games. Limits here are explicit, capped, and reported back alongside the
//   data so a caller can tell a short page from the end of the list.
//
//   ERRORS ARE JSON AND SAY WHAT TO DO. A wall of Postgres is not an API
//   contract.
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // finished data does not change; a minute of CDN caching costs a caller
      // nothing and takes a surprising amount of load off the database
      'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
      ...CORS, ...extra
    }
  });
}

const fail = (status: number, error: string, hint?: string) =>
  json(hint ? { error, hint } : { error }, status);

/* ------------------------------------------------------------- shaping --- */
// One place that decides what a team looks like to a caller, so it looks the
// same in a standings row, a fixture and a box score.
const team = (t: any) => t ? {
  name: t.name, short_name: t.short_name, slug: t.slug, colour: t.colour
} : null;

/* A PLAYER IS NAMED HERE EXACTLY WHEN THE SITE NAMES THEM, and with nothing but
   their basketball: a name and a slug beside the stats, never a birth year, a
   photo or anything else about the person. Minors included (Louie, 2026-09-24).
   A player the site withholds (a minor with no consent recorded, 0049's
   player_withheld) keeps their numbers and loses the name. This reads with the
   service role, which sees every row, so the rule is applied here: every select
   that feeds this asks for is_minor and public_consent. */
const withheld = (p: any) => !!p.is_minor && !p.public_consent;
const player = (p: any) => p ? (withheld(p) ? { name: null, slug: null, withheld: true } : {
  name: [p.first_name, p.last_name].filter(Boolean).join(' '), slug: p.slug
}) : null;

/* ------------------------------------------------- members-only leagues --- */
// docs/memberships.md §2. This function reads with the service role, which the
// database lets through everything (it has to: finalise-game and this API read
// a members-only league's own data for it). So the paywall for API callers is
// decided HERE:
//   * a key issued for a league keeps reading that league, open or not — the
//     league chose to hand that key out;
//   * a platform-wide key (league_id null) does not read members-only leagues
//     at all: not in the list, not by slug, not a game by id.
// Leagues are read with select('*') rather than naming access_mode, so this
// keeps working if the function is deployed before migration 0117 (the column
// is then simply absent and every league reads as open).
// AND THE MASTER SWITCH (0117 memberships_enabled): while it is not the JSON
// boolean true nothing is gated anywhere, so a members-mode league is an open
// league here too. Read once per request, the same rule as the SQL function.
const membersOnly = (l: any, ctx: Ctx) => ctx.membershipsOn && l?.access_mode === 'members';

// Set by a route that served a members-only league's data; serve() then marks
// the response private so no CDN or shared cache holds it.
type Ctx = { private: boolean; membershipsOn: boolean };

/* --------------------------------------------------------------- routes --- */
async function route(parts: string[], url: URL, leagueScope: string | null, ctx: Ctx) {
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') || '', 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '', 10) || 0, 0);

  // A key issued for one league may only read that league. A key with no
  // league is platform-wide, which is only issuable by editing the row
  // directly — there is deliberately no UI that mints one.
  const scoped = async (slug: string) => {
    const { data } = await admin.from('leagues')
      .select('*').eq('slug', slug).maybeSingle();
    if (!data) return { err: fail(404, 'no such league', 'try /v1/leagues') };
    if (leagueScope && data.id !== leagueScope) {
      return { err: fail(403, 'your key is not valid for that league') };
    }
    if (membersOnly(data, ctx)) {
      if (!leagueScope) {
        return { err: fail(403, 'that league is for members only',
                           'ask the league for an API key issued for it') };
      }
      ctx.private = true;
    }
    return { league: data };
  };

  // /v1/leagues
  if (parts.length === 1 && parts[0] === 'leagues') {
    let q = admin.from('leagues').select('*').order('name');
    if (leagueScope) q = q.eq('id', leagueScope);
    const { data, error } = await q;
    if (error) return fail(500, error.message);
    // a platform-wide key is not told about members-only leagues' data, and
    // the list is the door to it; a league's own key sees its own league
    const rows = (data || []).filter((l: any) => leagueScope || !membersOnly(l, ctx));
    if (rows.some((l: any) => membersOnly(l, ctx))) ctx.private = true;
    return json({ leagues: rows.map((l: any) =>
      ({ slug: l.slug, name: l.name, colour_a: l.colour_a, colour_b: l.colour_b })) });
  }

  // /v1/leagues/{slug}/...
  if (parts[0] === 'leagues' && parts.length >= 2) {
    const r = await scoped(parts[1]);
    if (r.err) return r.err;
    const league = r.league!;
    const tail = parts[2] || 'overview';

    // the competition to read; defaults to the newest season's first
    const compId = url.searchParams.get('competition');
    const { data: seasons } = await admin.from('seasons')
      .select('id,name,starts_on').eq('league_id', league.id)
      .order('starts_on', { ascending: false }).limit(1);
    const season = seasons?.[0] || null;
    const { data: comps } = season
      ? await admin.from('competitions')
          .select('id,name,kind,format').eq('season_id', season.id).order('name')
      : { data: [] as any[] };
    const comp = (comps || []).find((c: any) => c.id === compId) || (comps || [])[0] || null;

    if (tail === 'overview') {
      return json({
        league: { slug: league.slug, name: league.name },
        season: season ? { name: season.name } : null,
        competitions: (comps || []).map((c: any) =>
          ({ id: c.id, name: c.name, kind: c.kind, format: c.format }))
      });
    }

    if (!comp) return fail(404, 'this league has no competitions yet');

    if (tail === 'standings') {
      const { data, error } = await admin.from('standings')
        .select('rank,group_name,gp,w,l,pts_for,pts_against,diff,league_points,streak,' +
                'teams(name,short_name,slug,colour)')
        .eq('competition_id', comp.id)
        .order('group_name', { ascending: true, nullsFirst: true })
        .order('rank');
      if (error) return fail(500, error.message);
      return json({
        competition: { id: comp.id, name: comp.name },
        standings: (data || []).map((r: any) => ({
          rank: r.rank, group: r.group_name, team: team(r.teams),
          played: r.gp, won: r.w, lost: r.l,
          points_for: r.pts_for, points_against: r.pts_against,
          difference: r.diff, league_points: r.league_points, streak: r.streak
        }))
      });
    }

    if (tail === 'games') {
      const status = url.searchParams.get('status');
      let q = admin.from('games')
        .select('id,tipoff_at,status,venue,home_score,away_score,' +
                'home:home_team_id(name,short_name,slug,colour),' +
                'away:away_team_id(name,short_name,slug,colour)')
        .eq('competition_id', comp.id)
        .order('tipoff_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) return fail(500, error.message);
      return json({
        competition: { id: comp.id, name: comp.name },
        limit, offset, count: (data || []).length,
        games: (data || []).map((g: any) => ({
          id: g.id, tipoff_at: g.tipoff_at, status: g.status, venue: g.venue,
          home: team(g.home), away: team(g.away),
          score: g.status === 'scheduled' ? null
                                          : { home: g.home_score, away: g.away_score }
        }))
      });
    }

    if (tail === 'players') {
      // player_season_stats is a VIEW, and PostgREST cannot embed a related
      // table into one — a view has no foreign keys for it to follow. So the
      // names are resolved in a second pass and stitched here, which is what
      // the pages do too.
      /* EVERY COLUMN THE VIEW COMPUTES, not the dozen the first version
         picked. A partner republishing a league is doing arithmetic we have
         already done — offensive and defensive rebounds separately, fouls
         drawn, plus/minus, the shot splits by zone, and the rates. Making
         them re-derive eFG% from four counting stats is how two sites end up
         publishing different numbers for the same player, and the columns
         cost nothing to send: the view already produced them. */
      const { data, error } = await admin.from('player_season_stats')
        .select('player_id,team_id,gp,min,pts,oreb,dreb,reb,ast,stl,blk,tov,pf,fd,pm,' +
                'p2m,p2a,p3m,p3a,ftm,fta,fgm,fga,rim_a,rim_m,mid_a,mid_m,' +
                'ppg,rpg,apg,efg,ts,p3_pct,ft_pct,rim_pct,ast_to')
        .eq('competition_id', comp.id)
        .order('pts', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) return fail(500, error.message);

      const pids = [...new Set((data || []).map((r: any) => r.player_id).filter(Boolean))];
      const tids = [...new Set((data || []).map((r: any) => r.team_id).filter(Boolean))];
      const [{ data: ps }, { data: ts }] = await Promise.all([
        pids.length ? admin.from('players').select('id,first_name,last_name,slug,is_minor,public_consent').in('id', pids)
                    : Promise.resolve({ data: [] as any[] }),
        tids.length ? admin.from('teams').select('id,name,short_name,slug,colour').in('id', tids)
                    : Promise.resolve({ data: [] as any[] })
      ]);
      const pById = new Map((ps || []).map((p: any) => [p.id, p]));
      const tById = new Map((ts || []).map((t: any) => [t.id, t]));

      return json({
        competition: { id: comp.id, name: comp.name },
        limit, offset, count: (data || []).length,
        players: (data || []).map((r: any) => ({
          player: player(pById.get(r.player_id)), team: team(tById.get(r.team_id)),
          games: r.gp, minutes: r.min,
          totals: {
            points: r.pts,
            rebounds: r.reb, offensive_rebounds: r.oreb, defensive_rebounds: r.dreb,
            assists: r.ast, steals: r.stl, blocks: r.blk, turnovers: r.tov,
            fouls: r.pf, fouls_drawn: r.fd, plus_minus: r.pm,
            fg: { made: r.fgm, attempted: r.fga },
            two: { made: r.p2m, attempted: r.p2a },
            three: { made: r.p3m, attempted: r.p3a },
            ft: { made: r.ftm, attempted: r.fta },
            /* Shot location, which nothing downstream can reconstruct: it
               comes from the coordinates the scorer recorded, not from the
               box score. */
            at_rim: { made: r.rim_m, attempted: r.rim_a },
            mid_range: { made: r.mid_m, attempted: r.mid_a }
          },
          /* PRE-DIVIDED, from the view rather than from JavaScript here. Two
             places rounding the same average is two places to disagree. */
          per_game: r.gp ? {
            points: r.ppg, rebounds: r.rpg, assists: r.apg,
            steals: +(r.stl / r.gp).toFixed(1),
            blocks: +(r.blk / r.gp).toFixed(1),
            turnovers: +(r.tov / r.gp).toFixed(1),
            minutes: +(r.min / r.gp).toFixed(1)
          } : null,
          rates: {
            efg_pct: r.efg, ts_pct: r.ts, three_pct: r.p3_pct,
            ft_pct: r.ft_pct, rim_pct: r.rim_pct, assist_to_turnover: r.ast_to
          }
        }))
      });
    }

    if (tail === 'awards') {
      const { data, error } = await admin.from('season_awards')
        .select('code,value,detail,players(first_name,last_name,slug,is_minor,public_consent),' +
                'teams(name,short_name,slug,colour)')
        .eq('competition_id', comp.id);
      if (error) return fail(500, error.message);
      return json({
        competition: { id: comp.id, name: comp.name },
        awards: (data || []).map((a: any) => ({
          award: a.code, value: a.value, basis: a.detail,
          player: player(a.players), team: team(a.teams)
        }))
      });
    }

    if (tail === 'bracket') {
      const { data, error } = await admin.from('bracket_ties')
        .select('round,slot,label,home_seed,away_seed,home_agg,away_agg,' +
                'home:home_team_id(name,short_name,slug,colour),' +
                'away:away_team_id(name,short_name,slug,colour),' +
                'winner:winner_team_id(name,short_name,slug,colour)')
        .eq('competition_id', comp.id).order('round').order('slot');
      if (error) return fail(500, error.message);
      return json({
        competition: { id: comp.id, name: comp.name },
        ties: (data || []).map((t: any) => ({
          round: t.round, slot: t.slot, label: t.label,
          home: team(t.home), away: team(t.away),
          seeds: { home: t.home_seed, away: t.away_seed },
          aggregate: t.home_agg == null ? null : { home: t.home_agg, away: t.away_agg },
          winner: team(t.winner)
        }))
      });
    }

    return fail(404, 'no such collection',
      'try standings, games, players, awards or bracket');
  }

  // /v1/games/{id} — the box score
  if (parts[0] === 'games' && parts.length === 2) {
    const { data: g } = await admin.from('games')
      .select('id,tipoff_at,status,venue,home_score,away_score,period,competition_id,' +
              'home:home_team_id(name,short_name,slug,colour),' +
              'away:away_team_id(name,short_name,slug,colour)')
      .eq('id', parts[1]).maybeSingle();
    if (!g) return fail(404, 'no such game');

    // a key scoped to one league may not read another league's games, and a
    // platform-wide key may not read a members-only league's. The chain is
    // looked up for every key now, not only scoped ones; an ad-hoc game (no
    // competition) belongs to no league, as in can_read_game.
    if (g.competition_id) {
      const { data: chain } = await admin.from('competitions')
        .select('seasons(league_id)').eq('id', g.competition_id).maybeSingle();
      const lid = (chain as any)?.seasons?.league_id;
      if (lid && leagueScope && lid !== leagueScope) {
        return fail(403, 'your key is not valid for that league');
      }
      if (lid) {
        const { data: lg } = await admin.from('leagues').select('*').eq('id', lid).maybeSingle();
        if (membersOnly(lg, ctx)) {
          if (!leagueScope) {
            return fail(403, 'that game is in a league for members only',
                        'ask the league for an API key issued for it');
          }
          ctx.private = true;
        }
      }
    }
    if (g.status !== 'final') {
      return json({ game: { id: g.id, status: g.status,
                            home: team(g.home), away: team(g.away) },
                    note: 'box scores are published when a game is final' });
    }

    const { data: rows } = await admin.from('player_game_stats')
      .select('team_idx,stats,players(first_name,last_name,slug,is_minor,public_consent)')
      .eq('game_id', g.id);

    const box = [[], []] as any[][];
    (rows || []).forEach((r: any) => {
      const s = r.stats || {};
      box[r.team_idx]?.push({
        player: player(r.players),
        minutes: s.min == null ? null : +(s.min / 60000).toFixed(1),
        points: s.pts, rebounds: (s.or || 0) + (s.dr || 0),
        offensive_rebounds: s.or, defensive_rebounds: s.dr,
        assists: s.ast, steals: s.stl, blocks: s.blk,
        turnovers: s.to, fouls: s.pf, plus_minus: s.pm,
        fg: { made: (s.p2m || 0) + (s.p3m || 0), attempted: (s.p2a || 0) + (s.p3a || 0) },
        three: { made: s.p3m, attempted: s.p3a },
        ft: { made: s.ftm, attempted: s.fta }
      });
    });

    return json({
      game: {
        id: g.id, tipoff_at: g.tipoff_at, status: g.status, venue: g.venue,
        home: team(g.home), away: team(g.away),
        score: { home: g.home_score, away: g.away_score }
      },
      box_score: { home: box[0], away: box[1] }
    });
  }

  return fail(404, 'no such endpoint', 'the collections are /v1/leagues and /v1/games/{id}');
}

/* ------------------------------------------------------------------ serve --- */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return fail(405, 'this API is read-only');

  const url = new URL(req.url);
  // the deployed path is /functions/v1/api/v1/... — drop everything up to and
  // including the function's own name so routes read as they are documented
  const all = url.pathname.split('/').filter(Boolean);
  const i = all.indexOf('api');
  const parts = i === -1 ? all : all.slice(i + 1);
  if (parts[0] === 'v1') parts.shift();

  if (!parts.length) {
    return json({
      name: 'Epinoia Network API', version: 1,
      docs: '/epinoia/api/',
      endpoints: [
        'GET /v1/leagues',
        'GET /v1/leagues/{slug}',
        'GET /v1/leagues/{slug}/standings',
        'GET /v1/leagues/{slug}/games',
        'GET /v1/leagues/{slug}/players',
        'GET /v1/leagues/{slug}/awards',
        'GET /v1/leagues/{slug}/bracket',
        'GET /v1/games/{id}'
      ],
      authentication: 'send your key as the X-API-Key header, or ?key='
    });
  }

  const key = req.headers.get('x-api-key') ||
              (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
              url.searchParams.get('key') || '';

  const { data: checked, error: cErr } = await admin
    .rpc('api_key_check', { p_key: key });
  if (cErr) return fail(500, 'could not check that key: ' + cErr.message);
  const v = Array.isArray(checked) ? checked[0] : checked;

  if (!v?.ok) {
    const meta: Record<string, string> = {};
    if (v?.rate_limit) {
      meta['X-RateLimit-Limit'] = String(v.rate_limit);
      meta['X-RateLimit-Remaining'] = String(Math.max(0, v.rate_limit - (v.used || 0)));
      if (v.resets_at) meta['X-RateLimit-Reset'] = String(
        Math.floor(new Date(v.resets_at).getTime() / 1000));
    }
    if (v?.reason === 'rate limit exceeded') {
      const retry = v.resets_at
        ? Math.max(1, Math.ceil((new Date(v.resets_at).getTime() - Date.now()) / 1000))
        : 3600;
      return json({ error: 'rate limit exceeded',
                    hint: `your key allows ${v.rate_limit} requests an hour; it resets at ${v.resets_at}` },
                  429, { ...meta, 'Retry-After': String(retry) });
    }
    return json({ error: v?.reason || 'invalid key',
                  hint: 'send your key as the X-API-Key header. A league ' +
                        'administrator issues keys from the admin console.' },
                401, meta);
  }

  // the memberships master switch: a missing row (a deploy ahead of 0117) is
  // off, like memberships_enabled(); a failed read refuses rather than guesses
  const { data: sw, error: swErr } = await admin.from('platform_settings')
    .select('value').eq('key', 'memberships_enabled').maybeSingle();
  if (swErr) return fail(500, 'could not read the platform settings: ' + swErr.message);
  const ctx: Ctx = { private: false, membershipsOn: sw?.value === true };
  const res = await route(parts, url, v.league_id || null, ctx);
  const h = new Headers(res.headers);
  // a members-only league's data is for the holder of this key, not for a CDN
  if (ctx.private) h.set('Cache-Control', 'private, no-store');
  h.set('X-RateLimit-Limit', String(v.rate_limit));
  h.set('X-RateLimit-Remaining', String(Math.max(0, v.rate_limit - v.used)));
  h.set('X-RateLimit-Reset', String(Math.floor(new Date(v.resets_at).getTime() / 1000)));
  return new Response(res.body, { status: res.status, headers: h });
});
