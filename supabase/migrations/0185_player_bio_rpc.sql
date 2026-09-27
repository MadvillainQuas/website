-- ============================================================================
-- 0185: player_bio(ids) - age, height and weight for a page of players in ONE call
--
-- The stats tables (league, stats, global scouting) show AGE / HT / WT beside every name. They have thousands of rows and the numbers
-- live on players, not in the season files, so they are read here, five hundred players at a time, instead of a request per column
-- and per hundred. Like player_ages() (0184) it answers only for a player who is not withheld (a minor with no consent), and the age
-- is worked out here: the date of birth itself never leaves the database.
-- ============================================================================
create or replace function public.player_bio(p_ids uuid[])
returns table (player_id uuid, height_cm int, weight_kg int, age int)
language sql stable security definer set search_path = public as $$
  select p.id, p.height_cm, p.weight_kg,
         case when p.birth_date is null then null else date_part('year', age(current_date, p.birth_date))::int end
    from public.players p
   where p.id = any ((coalesce(p_ids, '{}'::uuid[]))[1:500])
     and not public.player_withheld(p.is_minor, p.public_consent)
     and (p.height_cm is not null or p.weight_kg is not null or p.birth_date is not null)
$$;
revoke all on function public.player_bio(uuid[]) from public;
grant execute on function public.player_bio(uuid[]) to anon, authenticated, service_role;
