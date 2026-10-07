-- ============================================================================
-- 0238 - A PLAYER'S CAREER FREE-THROW %, ENTERED BY HAND (2026-10-06)
--
-- The club report's Clutch page draws every player's free-throw % this season, in the clutch, and - where somebody has
-- entered it - over their career (a number from outside the platform: their college, a previous league). It is kept here so
-- that every report has it: the one a reader opens, the one PRIME REPORT keeps, and the one the mailer draws.
--
--   player_career_ft            one row a player: ft_pct (0-100), optional made / attempted, where it came from, who set it
--   set_career_ft(player, pct, made, att, note)   a platform administrator only; a null pct removes the row
--
-- Readable by anyone (a free-throw percentage is a public statistic), written only through the function.
-- ============================================================================
set local lock_timeout = '5s';

create table if not exists public.player_career_ft (
  player_id  uuid primary key references public.players on delete cascade,
  ft_pct     numeric(5, 1) not null check (ft_pct between 0 and 100),
  ftm        integer check (ftm is null or ftm >= 0),
  fta        integer check (fta is null or fta >= 0),
  note       text check (note is null or char_length(note) <= 80),
  set_by     uuid references auth.users on delete set null,
  set_at     timestamptz not null default now(),
  constraint player_career_ft_made_ck check (ftm is null or fta is null or ftm <= fta)
);
alter table public.player_career_ft enable row level security;
drop policy if exists player_career_ft_read on public.player_career_ft;
create policy player_career_ft_read on public.player_career_ft for select to anon, authenticated using (true);
revoke all on public.player_career_ft from anon, authenticated;
grant select (player_id, ft_pct, ftm, fta, note, set_at) on public.player_career_ft to anon, authenticated;

create or replace function public.set_career_ft(p_player uuid, p_pct numeric, p_made int default null, p_att int default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'only a platform administrator can enter a career free-throw %%' using errcode = '42501';
  end if;
  if p_player is null then raise exception 'which player' using errcode = '22023'; end if;
  if p_pct is null then
    delete from player_career_ft where player_id = p_player;
    return jsonb_build_object('player', p_player, 'ft_pct', null);
  end if;
  if p_pct < 0 or p_pct > 100 then raise exception 'a percentage is 0 to 100' using errcode = '22023'; end if;
  insert into player_career_ft (player_id, ft_pct, ftm, fta, note, set_by, set_at)
  values (p_player, round(p_pct, 1), p_made, p_att, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (player_id) do update set ft_pct = excluded.ft_pct, ftm = excluded.ftm, fta = excluded.fta, note = excluded.note,
                                        set_by = excluded.set_by, set_at = excluded.set_at;
  return jsonb_build_object('player', p_player, 'ft_pct', round(p_pct, 1));
end $$;
revoke all on function public.set_career_ft(uuid, numeric, int, int, text) from public, anon;
grant execute on function public.set_career_ft(uuid, numeric, int, int, text) to authenticated;

notify pgrst, 'reload schema';
