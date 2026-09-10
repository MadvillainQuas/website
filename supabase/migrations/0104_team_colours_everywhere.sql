-- 0104  The club's colours reach the cards.
--
-- Two things the crest colours (0102) needed to travel:
--
--  * a manager who sets a colour through set_team_colour has CHOSEN it; that is a manual
--    colour and the ingest must never write over it (0102 only marked admin-created teams);
--  * the Team of the Year cards read their club colour from toty_public, which returned one
--    colour; the cards now take the pair, so the function returns colour_2 as well. A change
--    to a function's row type needs a drop, so the grants are restated.

create or replace function public.set_team_colour(p_team uuid, p_colour text)
returns text language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from teams where id = p_team;
  if not found then raise exception 'no such club' using errcode = '22023'; end if;
  if not public.may_manage_media('team', p_team) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;
  if not public.is_css_colour(p_colour) then
    raise exception 'a colour is a hex code such as #93f2bf' using errcode = '22023';
  end if;

  -- a chosen colour is manual: the crest reader leaves it alone from now on
  update teams set colour = p_colour, colour_source = 'manual' where id = p_team;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_team_colour', 'team', p_team::text,
          jsonb_build_object('from', t.colour, 'to', p_colour));
  return 'saved';
end; $$;

revoke all on function public.set_team_colour(uuid, text) from public, anon;
grant execute on function public.set_team_colour(uuid, text) to authenticated;

drop function if exists public.toty_public(uuid);
create function public.toty_public(p_competition uuid)
returns table (
  ballot_id uuid, title text, slots int, status text, closes_at timestamptz,
  rank int, player_id uuid, player_name text, player_slug text,
  team_id uuid, team_name text, team_colour text, team_slug text, score numeric,
  team_colour_2 text
) language sql stable security definer set search_path = public as $$
  select b.id, b.title, b.slots, b.status, b.closes_at,
         r.rank, r.player_id, trim(p.first_name || ' ' || p.last_name), p.slug,
         r.team_id, t.name, t.colour, t.slug, r.score,
         t.colour_2
    from toty_ballots b
    left join toty_results r on r.ballot_id = b.id and r.rank <= b.slots
                            and b.status = 'published'
    left join players p on p.id = r.player_id
    left join teams t on t.id = r.team_id
   where b.competition_id = p_competition
     and b.status in ('open','closed','published')
     and (p.id is null or not p.is_minor)
   order by b.created_at desc, r.rank;
$$;
grant execute on function public.toty_public(uuid) to anon, authenticated;
