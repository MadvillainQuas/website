-- ============================================================================
-- 0168 · EPINOIA GO: a note on a stamp, and the leaderboard by games
--
-- Asked for by Louie on 2026-09-24 with the GO page's redesign (docs/epinoia-go.md, phase 7):
--
--   1. A NOTE ABOUT THE OCCASION. After a stamp the fan may write one line about the game - who they went
--      with, a birthday, the buzzer-beater - and it shows on their own stamps page. It is the fan's alone:
--      stamps are read only by their owner (0165's stamps_own_read), so a note never reaches anybody else,
--      and nothing public reads this column. 280 characters, trimmed; an empty one clears it. Written only
--      through set_stamp_note(), like every other write to stamps (0165: nobody writes a stamp but
--      stamp_venue), so no update grant on the table is needed.
--
--   2. THE LEADERBOARD BY GAMES. go_leaderboard ranked by arenas (then distance) or by distance; the page
--      now also ranks by games attended - the number of games stamped - then arenas, then distance.
--      Same signature and return type, so 0166's grants stand.
--
-- Idempotent; safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE NOTE
-- ----------------------------------------------------------------------------
alter table public.stamps add column if not exists note text;
alter table public.stamps drop constraint if exists stamps_note_len;
alter table public.stamps add constraint stamps_note_len check (note is null or char_length(note) between 1 and 280);
comment on column public.stamps.note is
  'The fan''s own note about the occasion (0168): read only by them (stamps_own_read), written by set_stamp_note.';

create or replace function public.set_stamp_note(p_stamp uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  n  text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  hit int;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  if n is not null and char_length(n) > 280 then
    return jsonb_build_object('ok', false, 'reason', 'too_long');
  end if;
  update stamps set note = n where id = p_stamp and user_id = me;
  get diagnostics hit = row_count;
  if hit = 0 then
    return jsonb_build_object('ok', false, 'reason', 'no_such_stamp');
  end if;
  return jsonb_build_object('ok', true, 'note', n);
end; $$;
alter function public.set_stamp_note(uuid, text) owner to postgres;
revoke all on function public.set_stamp_note(uuid, text) from public, anon;
grant execute on function public.set_stamp_note(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. THE LEADERBOARD BY GAMES (0166's function, with p_by = 'stamps')
-- ----------------------------------------------------------------------------
create or replace function public.go_leaderboard(p_league uuid default null, p_by text default 'arenas',
                                                 p_limit integer default 100)
returns table (rank bigint, username text, arenas bigint, stamps bigint, km numeric, me boolean)
language sql stable security definer set search_path = public as $$
  with n as (
    select g.user_id, g.arenas, g.stamps, g.km, g.first_at, u.username
      from public.go_numbers(p_league) g
      join go_settings gs on gs.user_id = g.user_id and gs.public and gs.adult_confirmed_at is not null
      join usernames u on u.user_id = g.user_id
     -- a private league's board is its own members' (0139): who goes to its games is not for strangers
     where p_league is null or public.league_visible(p_league)
  ), r as (
    select case when p_by = 'km' then rank() over (order by n.km desc, n.arenas desc)
                when p_by = 'stamps' then rank() over (order by n.stamps desc, n.arenas desc, n.km desc)
                else rank() over (order by n.arenas desc, n.km desc) end as rk, n.*
      from n
  )
  select r.rk, r.username, r.arenas, r.stamps, round(r.km::numeric, 1), coalesce(r.user_id = auth.uid(), false)
    from r
   order by r.rk, r.first_at, r.username
   limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
alter function public.go_leaderboard(uuid, text, integer) owner to postgres;
grant execute on function public.go_leaderboard(uuid, text, integer) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. A READ-ONLY CHECK
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'stamps' and column_name = 'note') then
    raise exception '0168: stamps.note is missing';
  end if;
  if has_function_privilege('anon', 'public.set_stamp_note(uuid, text)', 'execute') then
    raise exception '0168: anon may write a note';
  end if;
  if has_table_privilege('authenticated', 'public.stamps', 'update') then
    raise exception '0168: a fan may update stamps directly';
  end if;
  raise notice '0168 ok: a stamp can carry its fan''s note, and the leaderboard ranks by games too';
end $$;
