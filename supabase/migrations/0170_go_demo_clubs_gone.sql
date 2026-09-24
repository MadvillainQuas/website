-- ============================================================================
-- 0170 · The demo league's leftovers, deleted - and EPINOIA GO offers only a league's games
--
-- Louie, 2026-09-24: "make sure the demo league teams (i.e. neon city) are deleted and not shown there"
-- (EPINOIA GO's arenas to tick off, docs/epinoia-go.md 7.10).
--
-- The demo league (0004, "Courtside Demo League") was deleted from leagues at some point, but its four
-- clubs were left behind with no league (teams.league_id is cleared when a league goes), with their 22
-- games and 48 players (their roster rows went with the league's seasons). 0035 had given the clubs REAL
-- arenas so the map could be tested - Neon City the Emirates Arena, East Dock the Copper Box, Harbour
-- Bay Ponds Forge, Soft Club the University of Worcester Arena - and 0162 learnt them as their home
-- arenas, so EPINOIA GO drew Neon City on a real arena's card.
--
-- 1. The four clubs, their games and their players are deleted, and nothing else: the clubs by their
--    demo slugs AND having no league (a demo league seeded again keeps its own); their games only when
--    both sides are demo clubs (a game against a real club stops the whole migration before anything is
--    deleted); their players by the demo slug prefix AND no roster row with any club. Everything hanging
--    off them goes with them: every foreign key to a game, a club or a player cascades or clears itself
--    (a stamp or a fan's photograph of such a game would keep its row with the game cleared; there are
--    none). The arenas stay: they are real buildings, pinned and checked by hand, and with no club and no
--    game they are on no card and in no count.
-- 2. go_games_now() offers only games that belong to a league, so a game left behind like these can never
--    be stamped. 0165's function with that one line more; same signature, so its grants stand.
--
-- Idempotent; safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE DEMO LEAGUE'S CLUBS, GAMES AND PLAYERS
-- ----------------------------------------------------------------------------
do $$
declare
  demo uuid[];
  n_g int := 0; n_t int := 0; n_p int := 0;
begin
  select array_agg(id) into demo
    from teams
   where league_id is null
     and slug in ('neon-city', 'soft-club', 'harbour-bay', 'east-dock');
  if demo is not null then
    if exists (select 1 from games
                where (home_team_id = any(demo)) <> (away_team_id = any(demo))) then
      raise exception '0170: a demo club played a real one - look before deleting anything';
    end if;
    -- games first: a game names its clubs with no cascade (0001), so a club with games cannot go
    delete from games where home_team_id = any(demo) and away_team_id = any(demo);
    get diagnostics n_g = row_count;
    delete from teams where id = any(demo);
    get diagnostics n_t = row_count;
  end if;
  delete from players p
   where (p.slug like 'neon-city-%' or p.slug like 'soft-club-%' or p.slug like 'harbour-bay-%'
          or p.slug like 'east-dock-%')
     and not exists (select 1 from roster_entries r where r.player_id = p.id);
  get diagnostics n_p = row_count;
  raise notice '0170: % demo clubs, % of their games and % of their players deleted', n_t, n_g, n_p;
end $$;

-- ----------------------------------------------------------------------------
-- 2. THE GAMES A FAN CAN STAMP: a league's only (0165's function, one line more)
-- ----------------------------------------------------------------------------
create or replace function public.go_games_now()
returns table (game_id uuid, tipoff_at timestamptz, status text, opens_at timestamptz, closes_at timestamptz,
               venue_id uuid, venue text, city text, country text, lat double precision, lng double precision,
               radius_m integer, trusted boolean, league_id uuid, league text, league_slug text,
               home text, away text)
language sql stable security definer set search_path = public as $$
  select g.id, g.tipoff_at, g.status::text, w.opens_at, w.closes_at,
         v.id, v.name, v.city, v.country, v.lat, v.lng, v.radius_m,
         (v.lat is not null and v.pin_note is null),
         l.id, l.name, l.slug, ht.name, awt.name
    from games g
    cross join lateral public.go_window(g.tipoff_at, g.status::text, g.finalised_at) w
    left join venues v on v.id = public.game_venue_id(g.id)
    left join competitions c on c.id = g.competition_id
    left join seasons s on s.id = c.season_id
    left join leagues l on l.id = s.league_id
    left join teams ht on ht.id = g.home_team_id
    left join teams awt on awt.id = g.away_team_id
   where g.tipoff_at between now() - interval '7 hours' and now() + interval '26 hours'
     and g.status::text <> 'void'
     and w.closes_at > now() and w.opens_at < now() + interval '24 hours'
     and l.id is not null                              -- 0170: a game no league holds is nobody's to stamp
     and public.can_read_game(g.id)
   order by g.tipoff_at, g.id
   limit 500;
$$;
alter function public.go_games_now() owner to postgres;
revoke all on function public.go_games_now() from public;
grant execute on function public.go_games_now() to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from teams where league_id is null
                and slug in ('neon-city', 'soft-club', 'harbour-bay', 'east-dock')) then
    raise exception '0170: a demo club is still here';
  end if;
  if exists (select 1 from players p
              where p.slug like 'neon-city-%' and not exists (select 1 from roster_entries r where r.player_id = p.id)) then
    raise exception '0170: a demo player is still here';
  end if;
  raise notice '0170 ok: the demo league''s clubs, games and players are gone, and GO offers only a league''s games';
end $$;
