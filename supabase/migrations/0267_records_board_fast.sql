-- ============================================================================
-- 0267 — THE RECORDS BOARD NAMES ITS PLAYERS ONE BY ONE, NOT BY READING EVERY PLAYER.
--
-- records_board (0215) failed on a league's front page and on HOME with
-- "canceling statement due to statement timeout" (57014, HTTP 500, every call;
-- Louie, 2026-10-15: "it keeps on failing elsewhere too"). The lines are few - a
-- league's season holds about a hundred - but to name the players on them the
-- board JOINED players on an expression (the line's pid, cast to a uuid when it is
-- one), and a join on an expression is a hash join: the planner read EVERY row of
-- players, applied players' read policy to each (the minor / consent / club manager
-- rule, functions per row), and kept the eighty it needed. Media (a player's photo)
-- the same. Measured on PGlite with every migration and a platform of 240
-- competitions (21,600 lines, 19,000 players): one competition's board 300-840 ms,
-- HOME's board 61-73 s; the live tables are larger, and a signed-out read has three
-- seconds.
--
-- WHAT CHANGES: only how the names and photos are found. Each candidate line (the
-- twelve best of a statistic across the competitions, every rebound line) looks its
-- player up by primary key in a LATERAL sub-select fenced with OFFSET 0, so the
-- planner cannot flatten it back into the hash join: one index probe a line, the
-- read policy on that one row. The photo is a sub-select by media's primary key.
-- Everything else - the reader's rights (security invoker: every policy applies, as
-- 0215 says), the lines read, who is named, the order, the ties, the JSON - is
-- 0215's, unchanged. Same signature, so the grant and every caller stay.
--
--   supabase db push            (records.js reads it at once; nothing else to deploy)
-- ============================================================================

create or replace function public.records_board(p_comps text default null, p_filter text default 'all')
returns table (board jsonb)
language sql stable security invoker set search_path = public as $$
with
st as (select coalesce((select s.ready from public.records_state s where s.id = 1), false) as ready),
asked as (select btrim(x)::uuid as id from unnest(string_to_array(nullif(btrim(coalesce(p_comps, '')), ''), ',')) as x),
comp as (
  select r.competition_id, r.games, se.id as season_id, se.starts_on, l.id as league_id, l.slug, l.name, l.gender
    from public.record_comps r
    join public.competitions co on co.id = r.competition_id
    join public.seasons se on se.id = co.season_id
    join public.leagues l on l.id = se.league_id
   where r.games > 0 and (p_comps is null or r.competition_id in (select id from asked))
),
cur as (
  select distinct on (comp.league_id) comp.league_id, comp.season_id
    from comp
   where p_comps is null
     and (coalesce(p_filter, 'all') not in ('men', 'women')
          or (case when comp.gender = 'women' then 'women' when comp.gender = 'mixed' then 'mixed' else 'men' end) = p_filter)
   order by comp.league_id, comp.starts_on desc nulls last, comp.season_id
),
chosen as (
  select comp.* from comp where p_comps is not null
  union all
  select comp.* from comp join cur on cur.league_id = comp.league_id and cur.season_id = comp.season_id
),
lines as (
  select rl.kind, rl.cat, rl.game_id, rl.subject, rl.pid, rl.side, rl.value,
         g.tipoff_at, g.home_team_id, g.away_team_id, g.home_score, g.away_score, g.competition_id,
         ch.league_id, ch.slug as league_slug, ch.name as league_name
    from public.record_lines rl
    join chosen ch on ch.competition_id = rl.competition_id
    join public.games g on g.id = rl.game_id
),
-- PLAYERS: the twelve best lines of a statistic across the competitions (rebounds: all kept),
-- of those the ones the reader may be shown by name, and the best of those, credited to
-- whoever set it first
pl as (
  select l.*, row_number() over (partition by l.cat order by l.value desc, l.game_id, l.subject) as rk,
         case when l.pid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then l.pid::uuid end as puid
    from lines l where l.kind = 'player'
),
cand as (select pl.* from pl where (pl.cat = 'reb' or pl.rk <= 12) and pl.puid is not null),
-- each candidate's player BY PRIMARY KEY, one probe a line (OFFSET 0 keeps the planner from turning it back into a
-- hash join over every player); the read policy applies to that one row, so who is named is 0215's rule exactly
named as (
  select c.*, pp.slug as p_slug, pp.p_name, pp.photo_url as p_photo_url, pp.photo_path as p_photo_path
    from cand c
    cross join lateral (
      select p.slug, btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) as p_name, p.photo_url,
             (select m.storage_path from public.media m where m.id = p.photo_media_id) as photo_path
        from public.players p
       where p.id = c.puid
      offset 0
    ) pp
   where pp.slug is not null and pp.p_name not in ('', 'Player')
),
pbest as (select n.*, max(n.value) over (partition by n.cat) as top from named n),
prec as (
  select distinct on (b.cat) b.*, (count(*) over (partition by b.cat))::int as shared
    from pbest b where b.value = b.top
   order by b.cat, b.tipoff_at asc nulls first, b.game_id::text collate "C", b.subject
),
tl as (select l.*, max(l.value) over (partition by l.cat) as top from lines l where l.kind = 'team'),
trec as (
  select distinct on (t.cat) t.*, (count(*) over (partition by t.cat))::int as shared
    from tl t where t.value = t.top
   order by t.cat, t.tipoff_at asc nulls first, t.game_id::text collate "C", t.side
),
tids as (
  select home_team_id as id from prec union select away_team_id from prec
  union select home_team_id from trec union select away_team_id from trec
),
clubs as (
  select t.id, t.name, t.short_name, t.slug, t.colour, t.colour_2, t.logo_path,
         (select m.storage_path from public.media m
           where m.owner_type = 'team' and m.kind = 'logo' and m.status = 'approved' and m.owner_id = t.id
           order by m.created_at desc limit 1) as crest_path
    from public.teams t where t.id in (select id from tids)
),
rec_json as (
  select r.kind, r.cat, jsonb_build_object(
      'cat', r.cat, 'v', r.value, 'shared', r.shared, 'side', r.side, 'pid', r.pid,
      'game', jsonb_build_object('id', r.game_id, 'tipoff_at', r.tipoff_at, 'home_team_id', r.home_team_id,
                                 'away_team_id', r.away_team_id, 'home_score', r.home_score, 'away_score', r.away_score,
                                 'competition_id', r.competition_id),
      'league', jsonb_build_object('id', r.league_id, 'slug', r.league_slug, 'name', r.league_name),
      'name', r.p_name, 'slug', r.p_slug, 'photo_url', r.p_photo_url, 'photo_path', r.p_photo_path) as j
    from (select 'player' as kind, prec.cat, prec.value, prec.shared, prec.side, prec.pid, prec.game_id, prec.tipoff_at,
                 prec.home_team_id, prec.away_team_id, prec.home_score, prec.away_score, prec.competition_id,
                 prec.league_id, prec.league_slug, prec.league_name, prec.p_name, prec.p_slug, prec.p_photo_url, prec.p_photo_path
            from prec
          union all
          select 'team', trec.cat, trec.value, trec.shared, trec.side, null, trec.game_id, trec.tipoff_at,
                 trec.home_team_id, trec.away_team_id, trec.home_score, trec.away_score, trec.competition_id,
                 trec.league_id, trec.league_slug, trec.league_name, null, null, null, null
            from trec) r
)
select jsonb_build_object(
  'v', 1,
  'ready', (select ready from st),
  'games', coalesce((select sum(games) from chosen), 0),
  'leagues', (select count(distinct league_id) from chosen),
  'comps', coalesce((select jsonb_agg(jsonb_build_object('id', competition_id, 'league',
                       jsonb_build_object('id', league_id, 'slug', slug, 'name', name)) order by competition_id) from chosen), '[]'::jsonb),
  'player', coalesce((select jsonb_agg(j order by cat) from rec_json where kind = 'player'), '[]'::jsonb),
  'team', coalesce((select jsonb_agg(j order by cat) from rec_json where kind = 'team'), '[]'::jsonb),
  'teams', coalesce((select jsonb_object_agg(id, jsonb_build_object('id', id, 'name', name, 'short_name', short_name, 'slug', slug,
                       'colour', colour, 'colour_2', colour_2, 'logo_path', logo_path, 'crest_path', crest_path)) from clubs), '{}'::jsonb)
) as board
$$;

comment on function public.records_board(text, text) is
  '0215, 0267: the records a page shows, in one read, as the reader (every read policy applies). p_comps: comma-separated competition ids, or null for each league''s current season; p_filter: all | men | women. Players and photos are found by primary key, one probe a candidate line (0267).';
