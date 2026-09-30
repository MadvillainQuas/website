-- 0198: HOW MUCH A GAME MATTERS - the points the feed gives a match report.
--
-- finalise-game files a report for every game it closes ("Epinoia match report", news_articles.game_id, 0105). Most of
-- them are ordinary results, and the News feed (epinoia/feedrank.js) ranks them BELOW a publisher's story or a
-- creator's piece. Some games are not ordinary: a cup final, the top two clubs meeting, somebody scoring 40. Those
-- lift their report.
--
-- game_significance(game ids) says how much, and why, for up to 60 games at a time: one row per FINAL game in a league
-- the caller may see (league_visible, 0139), with the points and the reasons as short human strings:
--
--   THE TABLE (once each club has played 3 games, and in the same group - a rank in another group is another table)
--     30  Top-of-the-table clash: 1st v 2nd
--     22  Top-three clash: 2nd v 3rd
--     10  Table-top rivals: 3rd v 5th        (a top-four club against one within two places of it)
--     18  Upset: 9th beat 2nd                (a top-three club lost to the bottom third of a table of six or more)
--   A PLAYER (player_game_stats; the best of each kind counts once; a withheld player is not named - player_withheld, 0049)
--     25  Triple-double: <name>              (ten or more in three of points, rebounds, assists, steals, blocks)
--     40 / 28 / 14   52-point game, 41-point game, 33-point game: <name>   (50+, 40+, 30+)
--     18  20-20 game: <name>                 (20 points and 20 rebounds)
--      4  Double-double: <name>              (only when there is no triple-double or 20-20)
--     10  Season high: 34 points            (a 30+ game nobody in the competition has beaten)
--   THE STAGE (bracket_ties.label / round, competitions.kind)
--     50  Cup final / Playoff final / Final
--     30  Cup semi-final / Playoff semi-final / Semi-final
--     18  ... quarter-final
--      8  Knockout tie (any other tie of a bracket), Playoff game (a playoff competition's game without a tie)
--   EXTRAS
--     14 / 8   Double overtime / Overtime    (period beyond the league's periods, 0001 rules)
--      6  Decided by N points                (a margin of 1 to 3)
--   The four groups are capped (table 30, player 45, stage 50, extras 30) and the game at 100. What the points are
--   WORTH is the feed's business (feedrank.js), which can change without a migration.
--
-- THE CHEAP WAY: one pass over the standings of the games' competitions, one over their player_game_stats, one
-- over their ties; the season-high check runs only for a 30+ game. Nothing is written.
--
-- news_report_significance(article ids) is the same for the feed, which knows articles and not games: it maps a
-- published match report to its game and answers with the article's id as well.

create or replace function public.game_significance(p_game_ids uuid[])
returns table (game_id uuid, points int, reasons text[])
language plpgsql stable security definer set search_path = public as $$
declare v_ids uuid[] := coalesce(p_game_ids, '{}'::uuid[]);
begin
  return query
  with ids as (select distinct u as id from unnest(v_ids[1:60]) u),
  g as (
    select gm.id as gid, gm.home_team_id as h, gm.away_team_id as a, gm.home_score as hs, gm.away_score as aws,
           gm.period, gm.tie_id, c.id as comp, c.kind, coalesce((l.rules->>'periods')::int, 4) as periods
      from ids
      join games gm on gm.id = ids.id and gm.status = 'final'
      join competitions c on c.id = gm.competition_id
      join seasons s on s.id = c.season_id
      join leagues l on l.id = s.league_id
     where public.league_visible(l.id)
  ),
  -- ---- the table: every rank of the competitions in question, once
  st as (
    select x.competition_id, x.team_id, x.rank, x.gp, x.group_name,
           count(*) over (partition by x.competition_id, x.group_name) as n
      from standings x
     where x.competition_id in (select comp from g) and x.rank is not null
  ),
  tbl as (
    select g.gid, sh.rank as rh, sa.rank as ra, sh.n,
           case when g.hs > g.aws then sh.rank when g.aws > g.hs then sa.rank end as win_rank,
           case when g.hs > g.aws then sa.rank when g.aws > g.hs then sh.rank end as lose_rank
      from g
      join st sh on sh.competition_id = g.comp and sh.team_id = g.h
      join st sa on sa.competition_id = g.comp and sa.team_id = g.a
     where sh.gp >= 3 and sa.gp >= 3 and sh.group_name is not distinct from sa.group_name
  ),
  r_tbl as (
    select t.gid, 'table'::text as grp,
           case when least(t.rh, t.ra) = 1 and greatest(t.rh, t.ra) = 2 then 30
                when greatest(t.rh, t.ra) <= 3 then 22
                else 10 end as pts,
           case when least(t.rh, t.ra) = 1 and greatest(t.rh, t.ra) = 2 then 'Top-of-the-table clash: '
                when greatest(t.rh, t.ra) <= 3 then 'Top-three clash: '
                else 'Table-top rivals: ' end
             || public.game_sig_ordinal(least(t.rh, t.ra)) || ' v ' || public.game_sig_ordinal(greatest(t.rh, t.ra)) as reason
      from tbl t
     where least(t.rh, t.ra) <> greatest(t.rh, t.ra)
       and (greatest(t.rh, t.ra) <= 3 or (least(t.rh, t.ra) <= 4 and greatest(t.rh, t.ra) - least(t.rh, t.ra) <= 2))
    union all
    select t.gid, 'table', 18, 'Upset: ' || public.game_sig_ordinal(t.win_rank) || ' beat ' || public.game_sig_ordinal(t.lose_rank)
      from tbl t
     where t.n >= 6 and t.lose_rank <= 3 and t.win_rank >= t.n - t.n / 3 + 1
  ),
  -- ---- the players: one line per game per kind
  pp as (
    select p.game_id as gid, p.player_uuid as pid,
           coalesce((p.stats->>'pts')::int, 0) as pts,
           coalesce((p.stats->>'or')::int, 0) + coalesce((p.stats->>'dr')::int, 0) as reb,
           ((coalesce((p.stats->>'pts')::int, 0) >= 10)::int + ((coalesce((p.stats->>'or')::int, 0) + coalesce((p.stats->>'dr')::int, 0)) >= 10)::int
            + (coalesce((p.stats->>'ast')::int, 0) >= 10)::int + (coalesce((p.stats->>'stl')::int, 0) >= 10)::int
            + (coalesce((p.stats->>'blk')::int, 0) >= 10)::int) as cats
      from player_game_stats p
     where p.game_id in (select gid from g)
  ),
  ppn as (
    select pp.*, case when pl.id is null or public.player_withheld(pl.is_minor, pl.public_consent) then null
                      else btrim(coalesce(pl.first_name, '') || ' ' || coalesce(pl.last_name, '')) end as nm
      from pp left join players pl on pl.id = pp.pid
     where pp.pts >= 10 or pp.cats >= 2
  ),
  td as (select distinct on (gid) gid, nm from ppn where cats >= 3 order by gid, pts desc, pid),
  sc as (select distinct on (gid) gid, nm, pts from ppn where pts >= 30 order by gid, pts desc, pid),
  tt as (select distinct on (gid) gid, nm from ppn where pts >= 20 and reb >= 20 order by gid, pts desc, pid),
  dd as (select distinct on (gid) gid, nm from ppn where cats = 2 order by gid, pts desc, pid),
  hi as (                                       -- a 30+ game nobody else in the competition has matched: only for those
    select sc.gid from sc join g on g.gid = sc.gid
     where not exists (select 1 from player_game_stats x join games xg on xg.id = x.game_id
                        where xg.competition_id = g.comp and xg.status = 'final' and xg.id <> g.gid
                          and coalesce((x.stats->>'pts')::int, 0) >= sc.pts)
  ),
  r_pl as (
    select gid, 'player'::text as grp, 25 as pts, 'Triple-double' || coalesce(': ' || nm, '') as reason from td
    union all
    select sc.gid, 'player', case when sc.pts >= 50 then 40 when sc.pts >= 40 then 28 else 14 end,
           sc.pts || '-point game' || coalesce(': ' || sc.nm, '') from sc
    union all
    select gid, 'player', 18, '20-20 game' || coalesce(': ' || nm, '') from tt
    union all
    select dd.gid, 'player', 4, 'Double-double' || coalesce(': ' || dd.nm, '') from dd where not exists (select 1 from td where td.gid = dd.gid) and not exists (select 1 from tt where tt.gid = dd.gid)
    union all
    select hi.gid, 'player', 10, 'Season high: ' || sc.pts || ' points' from hi join sc on sc.gid = hi.gid
  ),
  -- ---- the stage
  mr as (select b.competition_id, max(b.round) as maxr from bracket_ties b where b.competition_id in (select comp from g) group by 1),
  stg as (
    select g.gid, g.kind, coalesce(t.label, '') as label, t.round, mr.maxr, g.tie_id is not null as knock
      from g left join bracket_ties t on t.id = g.tie_id left join mr on mr.competition_id = g.comp
  ),
  stg2 as (
    select s.*,
           case when not s.knock then null
                when s.label ~* 'third|3rd|bronze|consolation|play-?in' then 'tie'
                when s.label ~* 'semi' then 'semi'
                when s.label ~* 'quarter' then 'quarter'
                when s.label ~* '(^|[^a-z])final([^a-z]|$)' then 'final'
                when s.label = '' and s.round = s.maxr then 'final'
                when s.label = '' and s.round = s.maxr - 1 then 'semi'
                when s.label = '' and s.round = s.maxr - 2 then 'quarter'
                else 'tie' end as stage
      from stg s
  ),
  r_stg as (
    select gid, 'stage'::text as grp,
           case stage when 'final' then 50 when 'semi' then 30 when 'quarter' then 18 else 8 end as pts,
           case stage
             when 'final' then case kind when 'cup' then 'Cup final' when 'playoff' then 'Playoff final' else 'Final' end
             when 'semi' then case kind when 'cup' then 'Cup semi-final' when 'playoff' then 'Playoff semi-final' else 'Semi-final' end
             when 'quarter' then case kind when 'cup' then 'Cup quarter-final' when 'playoff' then 'Playoff quarter-final' else 'Quarter-final' end
             else case kind when 'cup' then 'Cup tie' when 'playoff' then 'Playoff tie' else 'Knockout tie' end end as reason
      from stg2 where stage is not null
    union all
    select gid, 'stage', 8, 'Playoff game' from stg2 where not knock and kind = 'playoff'
  ),
  -- ---- the extras
  r_ex as (
    select gid, 'extra'::text as grp, case when period - periods >= 2 then 14 else 8 end as pts,
           case when period - periods >= 3 then (period - periods) || ' overtimes'
                when period - periods = 2 then 'Double overtime' else 'Overtime' end as reason
      from g where period > periods
    union all
    select gid, 'extra', 6, 'Decided by ' || abs(hs - aws) || case when abs(hs - aws) = 1 then ' point' else ' points' end
      from g where abs(hs - aws) between 1 and 3
  ),
  allr as (
    select * from r_tbl union all select * from r_pl union all select * from r_stg union all select * from r_ex
  ),
  gsum as (
    select a.gid, least(sum(a.pts), case a.grp when 'table' then 30 when 'player' then 45 when 'stage' then 50 else 30 end)::int as gpts
      from allr a group by a.gid, a.grp
  )
  select g.gid, coalesce((select least(100, sum(m.gpts))::int from gsum m where m.gid = g.gid having count(*) > 0), 0),
         coalesce((select array_agg(a.reason order by a.pts desc, a.reason) from allr a where a.gid = g.gid), '{}'::text[])
    from g
   order by g.gid;
end $$;

/* 1st, 2nd, 3rd, 11th: the reasons' ordinals */
create or replace function public.game_sig_ordinal(p int)
returns text language sql immutable as $$
  select p::text || case when p % 100 in (11, 12, 13) then 'th' when p % 10 = 1 then 'st' when p % 10 = 2 then 'nd'
                         when p % 10 = 3 then 'rd' else 'th' end;
$$;

/* THE FEED KNOWS ARTICLES: a published match report -> its game -> its points */
create or replace function public.news_report_significance(p_article_ids uuid[])
returns table (article_id uuid, game_id uuid, points int, reasons text[])
language plpgsql stable security definer set search_path = public as $$
declare v uuid[] := coalesce(p_article_ids, '{}'::uuid[]);
begin
  return query
  with a as (
    select n.id, n.game_id
      from news_articles n
     where n.id = any (v[1:60]) and n.status = 'published' and n.game_id is not null and public.league_visible(n.league_id)
  )
  select a.id, a.game_id, s.points, s.reasons
    from a join public.game_significance((select array_agg(distinct x.game_id) from a x)) s on s.game_id = a.game_id;
end $$;

revoke all on function public.game_significance(uuid[]) from public, anon;
revoke all on function public.news_report_significance(uuid[]) from public, anon;
grant execute on function public.game_significance(uuid[]) to anon, authenticated;
grant execute on function public.news_report_significance(uuid[]) to anon, authenticated;
revoke all on function public.game_sig_ordinal(int) from public, anon;
grant execute on function public.game_sig_ordinal(int) to anon, authenticated;
