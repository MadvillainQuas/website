-- ============================================================================
-- 0156 — A FINISHED GAME'S EVENT LOG IS A FILE ON THE CDN.
--
-- The event logs are the heaviest thing the public site reads: 650-1000 rows a
-- game, and a club's shot zones, a player's profile, WOWY and a league's zone
-- table each read dozens to hundreds of them. Every one was a PostgREST read
-- through game_events' policy. Once a game is final its log almost never
-- changes, so, as the season lines did in 0153, it becomes a file:
-- snapshots/events/<game id>.json in the public 'snapshots' bucket, served by
-- the CDN (Smart CDN on the Pro plan purges a rewritten file within a minute).
--
-- THE SNAPSHOTS FUNCTION WRITES THEM, as a signed-out reader: it takes the games
-- in game_rows_public (0151, read with the publishable key, so the ids of games
-- whose rows everybody may read) that are final, reads each log through the
-- page's own data.js gameLog(), and uploads exactly those rows. A members-only
-- or private league's games never get a file; their readers read the database
-- as before. epinoia/data.js events() asks for the file first and falls back to
-- the database for anything without one.
--
-- THIS FILE: the index of written files (event_files: which game, from which
-- finalisation, how many events), and a trigger that marks a game's file stale
-- the moment any of its events is inserted, changed or deleted, so a correction
-- made without finalising again is rewritten too. snapshots_tick counts stale
-- files into its fingerprint, which makes the tick call the function within
-- five minutes of a correction rather than at the next hourly call.
-- ============================================================================

create table if not exists public.event_files (
  game_id      uuid primary key,          -- no foreign key: a deleted game's file is removed by the
                                          -- function, which needs the row to find it
  finalised_at timestamptz,               -- the games.finalised_at it was written from; null = stale
  events       int not null default 0,
  built_at     timestamptz not null default now()
);
alter table public.event_files enable row level security;
revoke all on table public.event_files from public, anon, authenticated;
grant all on table public.event_files to service_role;
alter table public.event_files owner to postgres;

-- ----------------------------------------------------------------------------
-- STALE ON ANY CHANGE. Statement-level, so a batch of a thousand events costs one
-- pass over the changed rows; games without a file (every game still being
-- played) match nothing.
-- ----------------------------------------------------------------------------
create or replace function public.event_files_stale()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update event_files f
     set finalised_at = null
   where f.finalised_at is not null
     and f.game_id in (select distinct c.game_id from changed c);
  return null;
end $$;
revoke all on function public.event_files_stale() from public, anon, authenticated;
alter function public.event_files_stale() owner to postgres;

drop trigger if exists event_files_stale_ins on public.game_events;
create trigger event_files_stale_ins after insert on public.game_events
  referencing new table as changed for each statement execute function public.event_files_stale();
drop trigger if exists event_files_stale_upd on public.game_events;
create trigger event_files_stale_upd after update on public.game_events
  referencing new table as changed for each statement execute function public.event_files_stale();
drop trigger if exists event_files_stale_del on public.game_events;
create trigger event_files_stale_del after delete on public.game_events
  referencing old table as changed for each statement execute function public.event_files_stale();

-- ----------------------------------------------------------------------------
-- snapshots_tick (latest: 0152), character for character but for the
-- fingerprint, which also counts stale event files (marked 0156).
-- ----------------------------------------------------------------------------
create or replace function public.snapshots_tick()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_fp      text;
  v_done    text;
  v_called  timestamptz;
  v_net     boolean;
  v_request bigint;
  v_call    boolean := false;
  v_result  jsonb;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('epinoia.snapshots_tick', 0)) then
    return jsonb_build_object('skipped', 'another tick is running');
  end if;

  select count(*)::text || '@' || coalesce(max(finalised_at)::text, '')
    into v_fp
    from games where status = 'final';
  -- 0156: a corrected game's file waiting to be rewritten moves the fingerprint too
  v_fp := v_fp || '~' || (select count(*) from event_files where finalised_at is null)::text;
  select done_fingerprint, called_at into v_done, v_called from snapshot_ticks where id = 1;

  v_net := to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null;
  -- a game finalised since the function last finished, or an hour since it did
  -- (a league's visibility or a player's consent can change without a final)
  if v_net
     and ( v_fp is distinct from v_done
           or coalesce((select done_at from snapshot_ticks where id = 1), 'epoch') < now() - interval '1 hour' )
     and (v_called is null or v_called < now() - interval '4 minutes') then
    begin
      execute 'select net.http_post(url := $1, body := $2, params := $3, headers := $4, timeout_milliseconds := $5)'
         into v_request
        using 'https://hhvofgqqadtyvcjudhjx.supabase.co/functions/v1/snapshots'::text,
              jsonb_build_object('source', 'tick'),
              '{}'::jsonb,
              jsonb_build_object('Content-Type', 'application/json',
                                 'apikey', 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO'),
              5000;
      v_call := true;
    exception when others then
      v_result := jsonb_build_object('call_error', sqlerrm);
    end;
  end if;

  v_result := coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'ran_at', now(), 'fingerprint', v_fp, 'done', v_done, 'net', v_net, 'called', v_call, 'request_id', v_request);
  insert into snapshot_ticks (id, ran_at, called_at, fingerprint, result)
  values (1, now(), case when v_call then now() end, v_fp, v_result)
  on conflict (id) do update
    set ran_at      = excluded.ran_at,
        called_at   = coalesce(excluded.called_at, snapshot_ticks.called_at),
        fingerprint = excluded.fingerprint,
        result      = excluded.result;
  return v_result;
end $$;
alter function public.snapshots_tick() owner to postgres;
revoke all on function public.snapshots_tick() from public, anon, authenticated;

-- ============================================================================
-- SELF-TEST: a file row goes stale when one of its game's events is removed,
-- and a row for another game is left alone. (An event of a final game cannot be
-- inserted, 0001's reject_events_when_final, or updated, forbid_event_mutation;
-- a delete from a server-side context is the one way its log changes without a
-- reopen, and a reopen takes the game out of 'final', which drops its file.)
-- On the newest finished game with events, inside a block that ends by raising
-- P0156 (which only its own handler swallows), so every row it touches is
-- rolled back.
-- ============================================================================
do $test$
declare
  g     uuid;
  other uuid := gen_random_uuid();
  s     bigint;
  v     timestamptz;
begin
  select e.game_id, max(e.seq) into g, s
    from game_events e
   where e.game_id = (select gm.id from games gm
                       where gm.status = 'final' and exists (select 1 from game_events x where x.game_id = gm.id)
                       order by gm.finalised_at desc nulls last limit 1)
   group by e.game_id;
  if g is null then
    return;                                    -- nothing to test against (an empty database)
  end if;
  begin
    insert into event_files (game_id, finalised_at, events) values (g, now(), 1), (other, now(), 1);

    delete from game_events where game_id = g and seq = s;
    select finalised_at into v from event_files where game_id = g;
    if v is not null then
      raise exception '0156: removing an event did not mark its game''s file stale';
    end if;
    select finalised_at into v from event_files where game_id = other;
    if v is null then
      raise exception '0156: removing one game''s event marked another game''s file stale';
    end if;

    raise exception using errcode = 'P0156', message = '0156 self-test passed; rolling its rows back';
  exception when sqlstate 'P0156' then
    null;
  end;
end $test$;
