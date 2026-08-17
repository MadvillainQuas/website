-- ============================================================================
-- 0066 — A CLUB MAY SET ITS OWN COLOUR.
--
-- A club's colour is picked once, on the screen that creates the club, and then
-- cannot be changed by the club again: admin_update_team is league-admin only,
-- and nothing in the portal touches it. That was survivable while the colour
-- was only ever chosen deliberately.
--
-- It stops being survivable now that uploading a crest suggests a colour to go
-- with it. An automatic choice that cannot be overruled is worse than no
-- automatic choice — the club would be stuck with whatever a dominant-colour
-- routine made of their artwork. So the same people who may change the crest
-- may change the colour.
--
-- The hex rule from 0056 is applied here as well as by the column constraint,
-- so a bad value comes back as a sentence rather than as a check-constraint
-- violation.
-- ============================================================================
create or replace function public.set_team_colour(p_team uuid, p_colour text)
returns text language plpgsql security definer set search_path = public as $$
declare t record;
begin
  select * into t from teams where id = p_team;
  if not found then raise exception 'no such club' using errcode = '22023'; end if;

  /* the same predicate that governs the crest: the club's manager, an
     administrator of its league, or a platform administrator */
  if not public.may_manage_media('team', p_team) then
    raise exception 'you do not manage that club' using errcode = '42501';
  end if;

  if not public.is_css_colour(p_colour) then
    raise exception 'a colour is a hex code such as #93f2bf' using errcode = '22023';
  end if;

  update teams set colour = p_colour where id = p_team;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'set_team_colour', 'team', p_team::text,
          jsonb_build_object('from', t.colour, 'to', p_colour));

  return 'saved';
end; $$;

revoke all on function public.set_team_colour(uuid, text) from public, anon;
grant execute on function public.set_team_colour(uuid, text) to authenticated;

-- ------------------------------------------------------------- assertions ---
do $$
declare tm uuid; refused boolean; before text;
begin
  select id, colour into tm, before from teams limit 1;
  if tm is null then raise notice '0066: no clubs to test against'; return; end if;

  -- nobody is signed in here, so it must refuse on authority
  begin
    perform public.set_team_colour(tm, '#ff0044');
    refused := false;
  exception when insufficient_privilege then refused := true;
            when others then refused := true;
  end;
  if not refused then
    update teams set colour = before where id = tm;
    raise exception 'ASSERT set_team_colour ran for a caller who manages nothing';
  end if;

  -- and the colour rule is the same one the column enforces
  if public.is_css_colour('red') then raise exception 'ASSERT a keyword passed'; end if;
  if not public.is_css_colour('#ff0044') then raise exception 'ASSERT hex refused'; end if;

  raise notice '0066: set_team_colour refuses outsiders and non-hex';
end $$;
