-- ============================================================================
-- 0215 — THE RECORDS ARE KEPT, NOT WORKED OUT ON EVERY VISIT.
--
-- HOME's Global records and a league's Records section (epinoia/records.js)
-- found the season's single-game bests in each reader's browser: every
-- finished game on the platform (1,799 rows), every season, then one sorted
-- read of player_game_stats per statistic across every league's current
-- competitions, and every team line of those seasons. Measured 2 October 2026,
-- signed out: about twenty requests and four to seven seconds a statistic, and
-- the player reads ended in statement timeouts (HTTP 500), retried, so HOME's
-- section took 18 s to give up. docs/performance-audit.md has the numbers.
--
-- WHAT THIS KEEPS. For every competition, the lines that can hold its records:
--
--   record_lines   per competition and statistic, the best lines of the
--                  competition's finished games. A player statistic keeps its
--                  twelve best lines (the page passes over a line whose player
--                  it may not name, as it did, and twelve is what it read) and
--                  every line level with the best; a team statistic keeps the
--                  lines level with the best (the page names nobody there).
--                  A few dozen small rows a competition: the statistic, the
--                  value, the game and whose line it was. Names, dates, clubs
--                  and scores are joined when read, so a corrected name or
--                  date needs nothing here.
--   record_comps   per competition, how many games are final and the latest
--                  of them (whose visibility decides the row's).
--   records_state  one row: whether the backfill has run (records_backfill).
--
-- KEPT AS GAMES ARE FINALISED, BY THE DATABASE, ON EVERY PATH. A trigger on
-- games (status, competition, scores) and statement triggers on
-- player_game_stats and team_game_stats hand every final game that changed to
-- records_apply_game, so finalise-game, the ingest, close-stuck-games, an
-- administrator's correction and a revert are all covered without any of them
-- knowing. For a game:
--   * its lines go in only where they reach the list (a guarded upsert), and
--     each list is cut back to its length: a game that set nothing changes
--     nothing;
--   * a CORRECTION that lowers or removes a line that was on a list rebuilds
--     that one list, for that one competition, from the competition's lines
--     (the next best may be anywhere in it); nothing else is recomputed;
--   * a game no longer final, moved, or deleted leaves its lists the same way;
--   * a competition never built (before the backfill, or a new one) is built
--     whole at its first touch.
-- RACE-SAFE: everything for a competition happens under a transaction-scoped
-- advisory lock on it, so two games finalised at once in one competition are
-- applied one after the other, each seeing the other's committed lines.
-- NEVER FATAL: a failure is caught, marked (record_comps.stale) and the
-- competition rebuilt whole at its next touch or by records_backfill; a
-- finalise never fails because of a record.
--
-- READ IN ONE REQUEST: records_board(p_comps, p_filter), security invoker, so
-- every read policy applies to the reader: a line is visible exactly when its
-- box score is (the policy player_game_stats has, 0151), a player is named only
-- when players_read shows him (a minor without consent is passed over, as the
-- page did), photographs and crests through media's own policy, private
-- leagues through leagues/seasons/competitions'. It answers the records, the
-- clubs on them and the counts the page prints.
--
-- ONE-TIME BACKFILL, after the push, in batches (safe on the live database:
-- each call builds at most p_max competitions under the same locks):
--     select public.records_backfill(25);     -- repeat until "left" is 0
-- Until it has finished records_state.ready is false and the pages work the
-- records out as before.
--
-- Never reads stats->sit. Statements are idempotent, so a push stopped half way
-- can be pushed again.
-- ============================================================================

-- --------------------------------------------------------------- the store ---
create table if not exists public.record_lines (
  competition_id uuid not null,
  kind           text not null check (kind in ('player', 'team')),
  cat            text not null,
  game_id        uuid not null,
  subject        text not null,       -- player_game_stats.player_id, or the side ('0' home, '1' away)
  pid            text,                -- the player: player_uuid, else player_id; null on a team line
  side           smallint not null,   -- 0 home, 1 away
  value          numeric not null,
  primary key (competition_id, kind, cat, game_id, subject)
);
create index if not exists record_lines_game on public.record_lines (game_id);

create table if not exists public.record_comps (
  competition_id uuid primary key,
  games          int not null default 0,
  last_game_id   uuid,
  stale          boolean not null default false,
  built_at       timestamptz not null default now()
);

create table if not exists public.records_state (
  id            int primary key default 1 check (id = 1),
  ready         boolean not null default false,
  backfilled_at timestamptz
);
insert into public.records_state (id) values (1) on conflict (id) do nothing;

comment on table public.record_lines is
  '0215: each competition''s record lines (a player statistic''s best twelve and every line level with the best; a team statistic''s lines level with the best), kept by triggers as games are finalised. Read through records_board().';
comment on table public.record_comps is
  '0215: per competition, its finished games (count, latest) for the records; stale = rebuild it whole at the next touch.';

-- ---------------------------------------------------------------- the reads ---
alter table public.record_lines  enable row level security;
alter table public.record_comps  enable row level security;
alter table public.records_state enable row level security;

revoke all on public.record_lines, public.record_comps, public.records_state from anon, authenticated;
grant select on public.record_lines, public.record_comps, public.records_state to anon, authenticated;

-- a line is read exactly when its game's box score is (player_game_stats' pgs_read, 0151)
drop policy if exists record_lines_read on public.record_lines;
create policy record_lines_read on public.record_lines for select
  using (coalesce((select true from public.game_rows_public p where p.id = record_lines.game_id), false)
         or public.can_read_game_rows(record_lines.game_id));

-- a competition's count when the reader may see its latest finished game (games_read and 0147)
drop policy if exists record_comps_read on public.record_comps;
create policy record_comps_read on public.record_comps for select
  using (exists (select 1 from public.games g where g.id = record_comps.last_game_id));

drop policy if exists records_state_read on public.records_state;
create policy records_state_read on public.records_state for select using (true);

-- ----------------------------------------------------- a number, as the page reads one ---
-- records.js num(): a JSON number, or a string holding one; anything else is no value
create or replace function public.record_num(j jsonb)
returns numeric language sql immutable set search_path = public as $$
  select case jsonb_typeof(j)
    when 'number' then (j #>> '{}')::numeric
    when 'string' then case when btrim(j #>> '{}') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
                            then btrim(j #>> '{}')::numeric end
  end
$$;

-- a list's length: a player statistic its best twelve, a team statistic its best
create or replace function public.record_keep(p_kind text)
returns int language sql immutable set search_path = public as $$
  select case when p_kind = 'player' then 12 else 1 end
$$;

-- ------------------------------------------------- every line that could hold one ---
-- The competition's finished games' lines (or one game's), one row per statistic with a
-- value above nought, exactly as records.js reads them:
--   player  pts, ast, stl, blk, p3m from the line's stats; reb = or + dr (either present)
--   team    pts = the side's score; margin = score - the other side's; p3m = adv.fg3m;
--           ast = adv.ast; reb = (oreb + dreb) - the other side's, when both sides have one
create or replace function public.record_candidates(p_comp uuid, p_game uuid default null)
returns table (kind text, cat text, game_id uuid, subject text, pid text, side smallint, value numeric)
language sql stable set search_path = public as $$
  select 'player'::text, x.cat, s.game_id, s.player_id, coalesce(s.player_uuid::text, s.player_id),
         (case when s.team_idx = 0 then 0 else 1 end)::smallint, x.v
    from public.games g
    join public.player_game_stats s on s.game_id = g.id
    cross join lateral (values
      ('pts', public.record_num(s.stats -> 'pts')),
      ('reb', case when public.record_num(s.stats -> 'or') is null and public.record_num(s.stats -> 'dr') is null then null
                   else coalesce(public.record_num(s.stats -> 'or'), 0) + coalesce(public.record_num(s.stats -> 'dr'), 0) end),
      ('ast', public.record_num(s.stats -> 'ast')),
      ('stl', public.record_num(s.stats -> 'stl')),
      ('blk', public.record_num(s.stats -> 'blk')),
      ('p3m', public.record_num(s.stats -> 'p3m'))) as x(cat, v)
   where g.competition_id = p_comp and g.status = 'final' and (p_game is null or g.id = p_game) and x.v > 0
  union all
  select 'team'::text, x.cat, g.id, sd.side::text, null::text, sd.side::smallint, x.v
    from public.games g
    cross join (values (0), (1)) as sd(side)
    left join public.team_game_stats me on me.game_id = g.id and me.team_idx = sd.side
    left join public.team_game_stats th on th.game_id = g.id and th.team_idx = 1 - sd.side
    cross join lateral (select
        (case when sd.side = 0 then g.home_score else g.away_score end)::numeric as pts,
        (case when sd.side = 0 then g.away_score else g.home_score end)::numeric as opp,
        me.game_id is not null and th.game_id is not null
          and (jsonb_typeof(me.stats -> 'adv' -> 'oreb') is distinct from 'null' and me.stats -> 'adv' -> 'oreb' is not null
               or jsonb_typeof(me.stats -> 'adv' -> 'dreb') is distinct from 'null' and me.stats -> 'adv' -> 'dreb' is not null)
          and (jsonb_typeof(th.stats -> 'adv' -> 'oreb') is distinct from 'null' and th.stats -> 'adv' -> 'oreb' is not null
               or jsonb_typeof(th.stats -> 'adv' -> 'dreb') is distinct from 'null' and th.stats -> 'adv' -> 'dreb' is not null) as has_reb
      ) as v
    cross join lateral (values
      ('pts', v.pts),
      ('margin', v.pts - v.opp),
      ('p3m', public.record_num(me.stats -> 'adv' -> 'fg3m')),
      ('ast', public.record_num(me.stats -> 'adv' -> 'ast')),
      ('reb', case when v.has_reb then
                (coalesce(public.record_num(me.stats -> 'adv' -> 'oreb'), 0) + coalesce(public.record_num(me.stats -> 'adv' -> 'dreb'), 0))
              - (coalesce(public.record_num(th.stats -> 'adv' -> 'oreb'), 0) + coalesce(public.record_num(th.stats -> 'adv' -> 'dreb'), 0)) end)
    ) as x(cat, v)
   where g.competition_id = p_comp and g.status = 'final' and (p_game is null or g.id = p_game) and x.v > 0
$$;

-- ------------------------------------------------------------ the upkeep ---
-- a competition's lists rebuilt from all its lines: one statistic, one kind, or all of them
create or replace function public.records_rebuild(p_comp uuid, p_kind text default null, p_cat text default null)
returns void language sql security definer set search_path = public as $$
  delete from public.record_lines
   where competition_id = p_comp and (p_kind is null or kind = p_kind) and (p_cat is null or cat = p_cat);
  insert into public.record_lines (competition_id, kind, cat, game_id, subject, pid, side, value)
  select p_comp, c.kind, c.cat, c.game_id, c.subject, c.pid, c.side, c.value
    from (select c.*, row_number() over (partition by c.kind, c.cat order by c.value desc, c.game_id, c.subject) as rk,
                 max(c.value) over (partition by c.kind, c.cat) as top
            from public.record_candidates(p_comp) c
           where (p_kind is null or c.kind = p_kind) and (p_cat is null or c.cat = p_cat)) c
   where c.rk <= public.record_keep(c.kind) or c.value = c.top
  on conflict do nothing;
$$;

-- one list cut back to its length (and every line level with its best)
create or replace function public.records_prune(p_comp uuid, p_kind text, p_cat text)
returns void language sql security definer set search_path = public as $$
  delete from public.record_lines r
   using (select l.game_id, l.subject, l.value,
                 row_number() over (order by l.value desc, l.game_id, l.subject) as rk,
                 max(l.value) over () as top
            from public.record_lines l
           where l.competition_id = p_comp and l.kind = p_kind and l.cat = p_cat) x
   where r.competition_id = p_comp and r.kind = p_kind and r.cat = p_cat
     and r.game_id = x.game_id and r.subject = x.subject
     and x.rk > public.record_keep(p_kind) and x.value < x.top;
$$;

-- a competition's count of finished games and the latest of them; none left, nothing kept
create or replace function public.records_count(p_comp uuid)
returns void language plpgsql security definer set search_path = public as $$
declare n int; last uuid;
begin
  select count(*)::int, (array_agg(g.id order by g.tipoff_at desc nulls last, g.id desc))[1]
    into n, last
    from public.games g where g.competition_id = p_comp and g.status = 'final';
  if n = 0 then
    delete from public.record_lines where competition_id = p_comp;
    delete from public.record_comps where competition_id = p_comp;
    return;
  end if;
  insert into public.record_comps (competition_id, games, last_game_id)
  values (p_comp, n, last)
  on conflict (competition_id) do update set games = excluded.games, last_game_id = excluded.last_game_id;
end
$$;

-- the lock that makes everything for one competition happen one game at a time
create or replace function public.records_lock(p_comp uuid)
returns void language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended('epinoia.records:' || p_comp::text, 0));
$$;

-- ONE GAME, after anything that may have changed its lines. p_was: a competition the game
-- was in until now (moved, or deleted), whose lists and count are put right too.
create or replace function public.records_apply_game(p_game uuid, p_was uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  g        record;
  c        uuid;
  comps    uuid[];
  had      boolean;
  was_bad  boolean;
  k        record;
  rebuilt  text[];
  touched  text[];
begin
  select id, competition_id, status into g from public.games where id = p_game;
  comps := array(select distinct x from unnest(
             array(select distinct r.competition_id from public.record_lines r where r.game_id = p_game)
             || array[g.competition_id, p_was]) as x where x is not null order by 1);
  -- every competition's lock first, always in the same order, so two callers cannot deadlock here
  foreach c in array comps loop perform public.records_lock(c); end loop;

  foreach c in array comps loop
    select true, r.stale into had, was_bad from public.record_comps r where r.competition_id = c;
    perform public.records_count(c);
    if not exists (select 1 from public.record_comps r where r.competition_id = c) then
      continue;                                    -- nothing final left in it: nothing kept
    end if;

    -- never built (a new competition, or before the backfill), or a build that failed: all of it
    if had is null or was_bad then
      perform public.records_rebuild(c);
      update public.record_comps set stale = false, built_at = now() where competition_id = c;
      continue;
    end if;

    -- not (or no longer) a final game of this competition: its lines leave, and each list
    -- they were on is rebuilt (the next best may be anywhere in the competition)
    if g.id is null or g.competition_id is distinct from c or g.status <> 'final' then
      for k in select distinct r.kind, r.cat from public.record_lines r
                where r.competition_id = c and r.game_id = p_game loop
        perform public.records_rebuild(c, k.kind, k.cat);
      end loop;
      update public.record_comps set built_at = now() where competition_id = c;
      continue;
    end if;

    -- A CORRECTION: a line of this game on a list that fell, or went, rebuilds that list
    rebuilt := array(
      select distinct h.kind || ':' || h.cat from public.record_lines h
       where h.competition_id = c and h.game_id = p_game
         and not exists (select 1 from public.record_candidates(c, p_game) n
                          where n.kind = h.kind and n.cat = h.cat and n.subject = h.subject and n.value >= h.value));
    for k in select split_part(x, ':', 1) as kind, split_part(x, ':', 2) as cat from unnest(rebuilt) as x loop
      perform public.records_rebuild(c, k.kind, k.cat);
    end loop;

    -- THE GAME'S LINES, where they reach a list: a list not yet full takes any line, a full
    -- one only a line at least level with its last (the cut below settles the order)
    with n as (
      select n.* from public.record_candidates(c, p_game) n
       where not ((n.kind || ':' || n.cat) = any (rebuilt))
    ), ins as (
      insert into public.record_lines as r (competition_id, kind, cat, game_id, subject, pid, side, value)
      select c, n.kind, n.cat, n.game_id, n.subject, n.pid, n.side, n.value
        from n
       where n.value >= coalesce((select l.value from public.record_lines l
                                   where l.competition_id = c and l.kind = n.kind and l.cat = n.cat
                                   order by l.value desc offset public.record_keep(n.kind) - 1 limit 1), 0)
      on conflict (competition_id, kind, cat, game_id, subject)
        do update set value = excluded.value, pid = excluded.pid, side = excluded.side
        where r.value is distinct from excluded.value or r.pid is distinct from excluded.pid or r.side is distinct from excluded.side
      returning r.kind || ':' || r.cat as kc
    )
    select array(select distinct kc from ins) into touched;
    for k in select split_part(x, ':', 1) as kind, split_part(x, ':', 2) as cat from unnest(touched) as x loop
      perform public.records_prune(c, k.kind, k.cat);
    end loop;
    if cardinality(rebuilt) > 0 or cardinality(touched) > 0 then
      update public.record_comps set built_at = now() where competition_id = c;
    end if;
  end loop;
end
$$;

-- the triggers' door: never lets a record stop a finalise. A failure marks the competitions
-- stale (rebuilt whole at their next touch, or by records_backfill) and is reported as a warning.
create or replace function public.records_touch(p_game uuid, p_was uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare msg text;
begin
  begin
    perform public.records_apply_game(p_game, p_was);
  exception when others then
    get stacked diagnostics msg = message_text;
    raise warning '0215 records: game % not applied (%); its competition will be rebuilt', p_game, msg;
    insert into public.record_comps (competition_id, stale)
    select x, true from (
      select g.competition_id as x from public.games g where g.id = p_game
      union select p_was) s where x is not null
    on conflict (competition_id) do update set stale = true;
  end;
end
$$;

-- ------------------------------------------------------------ the triggers ---
create or replace function public.records_on_game()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.records_touch(old.id, old.competition_id);
  elsif tg_op = 'INSERT' then
    perform public.records_touch(new.id, null);
  else
    perform public.records_touch(new.id,
      case when old.competition_id is distinct from new.competition_id then old.competition_id end);
  end if;
  return null;
end
$$;

drop trigger if exists records_game_ins on public.games;
create trigger records_game_ins after insert on public.games
  for each row when (new.status = 'final' and new.competition_id is not null)
  execute function public.records_on_game();
drop trigger if exists records_game_upd on public.games;
create trigger records_game_upd after update of status, competition_id, home_score, away_score on public.games
  for each row when ((old.status = 'final' or new.status = 'final')
                     and (old.status is distinct from new.status
                          or old.competition_id is distinct from new.competition_id
                          or old.home_score is distinct from new.home_score
                          or old.away_score is distinct from new.away_score))
  execute function public.records_on_game();
drop trigger if exists records_game_del on public.games;
create trigger records_game_del after delete on public.games
  for each row when (old.status = 'final' and old.competition_id is not null)
  execute function public.records_on_game();

-- the box scores: once a statement, for each final game it touched (a live game's lines are
-- written all evening and cost one look at games here)
create or replace function public.records_on_lines()
returns trigger language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if tg_op = 'INSERT' then
    for gid in select distinct n.game_id from new_rows n
                 join public.games g on g.id = n.game_id
                where g.status = 'final' and g.competition_id is not null order by 1 loop
      perform public.records_touch(gid, null);
    end loop;
  elsif tg_op = 'DELETE' then
    for gid in select distinct o.game_id from old_rows o
                 join public.games g on g.id = o.game_id
                where g.status = 'final' and g.competition_id is not null order by 1 loop
      perform public.records_touch(gid, null);
    end loop;
  else
    for gid in select distinct x.game_id from (select game_id from new_rows union select game_id from old_rows) x
                 join public.games g on g.id = x.game_id
                where g.status = 'final' and g.competition_id is not null order by 1 loop
      perform public.records_touch(gid, null);
    end loop;
  end if;
  return null;
end
$$;

do $t$
declare tbl text; op text;
begin
  foreach tbl in array array['player_game_stats', 'team_game_stats'] loop
    foreach op in array array['insert', 'update', 'delete'] loop
      execute format('drop trigger if exists records_lines_%s on public.%I', op, tbl);
      execute format('create trigger records_lines_%s after %s on public.%I referencing %s for each statement execute function public.records_on_lines()',
                     op, op, tbl,
                     case op when 'insert' then 'new table as new_rows'
                             when 'delete' then 'old table as old_rows'
                             else 'old table as old_rows new table as new_rows' end);
    end loop;
  end loop;
end
$t$;

-- ------------------------------------------------------------ the backfill ---
-- Builds the competitions not built yet (or marked stale), at most p_max a call, and says how
-- many are left; when none are, the pages switch to the kept records. Re-run it any time: a
-- built competition is skipped. To rebuild everything: update record_comps set stale = true.
create or replace function public.records_backfill(p_max int default 25)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; n int := 0; left_ int;
begin
  for c in
    select distinct g.competition_id from public.games g
     where g.status = 'final' and g.competition_id is not null
       and not exists (select 1 from public.record_comps r where r.competition_id = g.competition_id and not r.stale)
     order by 1 limit greatest(coalesce(p_max, 25), 1)
  loop
    perform public.records_lock(c);
    perform public.records_count(c);
    perform public.records_rebuild(c);
    update public.record_comps set stale = false, built_at = now() where competition_id = c;
    n := n + 1;
  end loop;
  select count(distinct g.competition_id) into left_ from public.games g
   where g.status = 'final' and g.competition_id is not null
     and not exists (select 1 from public.record_comps r where r.competition_id = g.competition_id and not r.stale);
  if left_ = 0 then
    update public.records_state set ready = true, backfilled_at = coalesce(backfilled_at, now()) where id = 1;
  end if;
  return jsonb_build_object('built', n, 'left', left_);
end
$$;

-- ------------------------------------------------------------ the board ---
-- ONE READ FOR THE PAGE. p_comps: a season's competitions, comma-separated (a league's
-- front page), or null for every league's current season (HOME: each league's newest season
-- with a finished game the reader can see). p_filter on HOME: 'men' / 'women' by the league's
-- gender (unmarked counts as men's, as stars.js leagueFits); anything else is every league.
-- As the reader: every policy applies (see the head of this file).
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
  select l.*, row_number() over (partition by l.cat order by l.value desc, l.game_id, l.subject) as rk
    from lines l where l.kind = 'player'
),
named as (
  select pl.*, p.slug as p_slug, btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) as p_name,
         p.photo_url as p_photo_url, m.storage_path as p_photo_path
    from pl
    join public.players p
      on p.id = case when pl.pid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then pl.pid::uuid end
    left join public.media m on m.id = p.photo_media_id
   where (pl.cat = 'reb' or pl.rk <= 12)
     and p.slug is not null and btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) not in ('', 'Player')
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
  '0215: the records a page shows, in one read, as the reader (every read policy applies). p_comps: comma-separated competition ids, or null for each league''s current season; p_filter: all | men | women.';

-- ------------------------------------------------------------ who may call what ---
revoke execute on function public.record_candidates(uuid, uuid)   from public, anon, authenticated;
revoke execute on function public.records_rebuild(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.records_prune(uuid, text, text)   from public, anon, authenticated;
revoke execute on function public.records_count(uuid)               from public, anon, authenticated;
revoke execute on function public.records_lock(uuid)                from public, anon, authenticated;
revoke execute on function public.records_apply_game(uuid, uuid)    from public, anon, authenticated;
revoke execute on function public.records_touch(uuid, uuid)         from public, anon, authenticated;
revoke execute on function public.records_backfill(int)             from public, anon, authenticated;
revoke execute on function public.records_on_game()                 from public, anon, authenticated;
revoke execute on function public.records_on_lines()                from public, anon, authenticated;
grant execute on function public.records_board(text, text) to anon, authenticated;
grant execute on function public.record_num(jsonb) to anon, authenticated;
