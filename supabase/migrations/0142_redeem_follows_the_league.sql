-- ============================================================================
-- 0142 — OPENING A PRIVATE LEAGUE'S LINK FOLLOWS IT.
--
-- A private league is not findable. There is no listing it appears in, no
-- search that reaches it, and nothing on the front page to come back to — so
-- somebody who opens their link, reads the fixtures and closes the tab has, in
-- practice, lost the league unless they kept the message it came in. That is a
-- bad way to treat the one league on the platform a person cannot look up.
--
-- Following it fixes both halves at once: it puts the league in "your leagues"
-- on their profile and in the rail, which is the way back; and it turns on the
-- notifications they almost certainly want, because somebody who accepted an
-- invitation to a private league is by definition interested in every game in
-- it (0133 expands a followed league into its clubs, including ones that join
-- later).
--
-- IT IS A DEFAULT, NOT A LOCK. fav_league_ids is the fan's own list, editable
-- from the profile and from the bell on the league page, so this only decides
-- what it starts as. Unfollowing sticks: this fires on the redeem, and a redeem
-- happens once (the second one returns "already" before reaching here).
--
-- THE CAP IS RESPECTED, NOT RAISED. 0133 caps the list at 20 because each entry
-- expands into every club in that league when the notices are made. At 20 the
-- league is still joined — the follow is the courtesy, the access is the point
-- — and nothing is said about it, because "you are in, but you follow too many
-- leagues" is not a sentence anybody needs at that moment.
--
-- Re-running this file changes nothing.
-- ============================================================================

set local lock_timeout = '5s';

create or replace function public.redeem_league_invite(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_l record; v_new boolean := false;
begin
  if auth.uid() is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  /* Locked, because uses is a counter and two phones opening the same
     one-use link at the same moment must not both get in. */
  select * into v from league_invites where token = p_token for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;
  select id, name, slug into v_l from leagues where id = v.league_id;
  if v.revoked_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'revoked', 'league', v_l.name);
  end if;
  if v.expires_at is not null and v.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired', 'league', v_l.name);
  end if;

  /* ALREADY IN IS A SUCCESS, and it does not spend a use. Somebody who opens the
     same link twice — a bookmark, a second phone, a group chat they scrolled
     back through — is not a second person, and a one-use link that locked out
     the very person it was for would be the most annoying possible bug.

     It does not re-follow either: this returns before the follow below, so
     somebody who joined and then deliberately unfollowed is not quietly
     re-subscribed by opening their own bookmark. */
  if exists (select 1 from league_guests g
              where g.league_id = v.league_id and g.user_id = auth.uid())
     or (v.role = 'league_admin'
         and exists (select 1 from memberships m
                      where m.user_id = auth.uid() and m.role = 'league_admin'
                        and m.scope_type = 'league' and m.scope_id = v.league_id)) then
    return jsonb_build_object('ok', true, 'already', true,
                              'league', v_l.name, 'slug', v_l.slug, 'role', v.role);
  end if;

  if v.max_uses is not null and v.uses >= v.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'used_up', 'league', v_l.name);
  end if;

  /* A guest row either way, even for a league admin: is_league_admin already
     answers for the membership, but league_guests is the record of HOW somebody
     got in, and the league's staff list should show that this admin arrived
     through a link rather than a console grant. */
  insert into league_guests (league_id, user_id, invite_id)
  values (v.league_id, auth.uid(), v.id)
  on conflict do nothing;

  if v.role = 'league_admin' then
    insert into memberships (user_id, role, scope_type, scope_id)
    values (auth.uid(), 'league_admin', 'league', v.league_id)
    on conflict do nothing;
  end if;

  /* AND THEY FOLLOW IT (0142). The row is created if this is their first
     preference of any kind, which is the common case for somebody whose first
     act on the platform is opening an invitation. Guarded three ways: not
     already there, under 0133's cap, and never allowed to fail the redeem —
     being let in is the thing that matters, and a fan_prefs row that will not
     take a twenty-first league must not cost somebody their access. */
  begin
    insert into fan_prefs (user_id) values (auth.uid()) on conflict (user_id) do nothing;
    update fan_prefs
       set fav_league_ids = array_append(fav_league_ids, v.league_id)
     where user_id = auth.uid()
       and not (v.league_id = any (fav_league_ids))
       and cardinality(fav_league_ids) < 20;
  exception when others then
    raise warning '0142: % could not be followed on redeem (%)', v_l.name, sqlerrm;
  end;

  update league_invites set uses = uses + 1 where id = v.id;
  v_new := true;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'redeem_league_invite', 'league', v.league_id::text,
          jsonb_build_object('invite', v.id, 'role', v.role, 'label', v.label));

  return jsonb_build_object('ok', true, 'already', false, 'league', v_l.name,
                            'slug', v_l.slug, 'role', v.role);
end; $$;

revoke all on function public.redeem_league_invite(text) from public, anon;
grant execute on function public.redeem_league_invite(text) to authenticated;
alter function public.redeem_league_invite(text) owner to postgres;

-- ============================================================================
-- SELF-TEST. Asserts only about the league, the link and the account it makes.
-- ============================================================================
do $test$
declare
  orig text := current_user;
  lg uuid; joiner uuid; capped uuid; res jsonb; arr uuid[]; n int;
begin
  begin
    insert into leagues (slug, name) values ('t0142-lg', 'Test 0142 League') returning id into lg;
    insert into league_invites (league_id, token, role, label)
    values (lg, 't0142TokenAAAAAAAAAAAAAA', 'viewer', 'the test');

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 't0142-joiner@example.invalid', '', now(), now(), now())
      returning id into joiner;

    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', joiner, 'role', 'authenticated')::text, true);

    res := public.redeem_league_invite('t0142TokenAAAAAAAAAAAAAA');
    if not (res->>'ok')::boolean then raise exception '0142: the redeem failed (%)', res; end if;

    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);

    select fav_league_ids into arr from fan_prefs where user_id = joiner;
    if arr is null or not (lg = any (arr)) then
      raise exception '0142: opening the link did not follow the league (%)', arr;
    end if;

    -- 2. unfollowing sticks: a second open must not put it back
    update fan_prefs set fav_league_ids = '{}' where user_id = joiner;
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', joiner, 'role', 'authenticated')::text, true);
    res := public.redeem_league_invite('t0142TokenAAAAAAAAAAAAAA');
    if not (res->>'already')::boolean then
      raise exception '0142: the second redeem was not recognised as already in';
    end if;
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);
    select fav_league_ids into arr from fan_prefs where user_id = joiner;
    if cardinality(arr) <> 0 then
      raise exception '0142: opening the link again re-followed a league they had dropped';
    end if;

    -- 3. somebody already at the cap is still let in
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
            'authenticated', 't0142-capped@example.invalid', '', now(), now(), now())
      returning id into capped;
    insert into fan_prefs (user_id, fav_league_ids)
    values (capped, array(select gen_random_uuid() from generate_series(1, 20)));
    insert into league_invites (league_id, token, role) values (lg, 't0142TokenBBBBBBBBBBBBBB', 'viewer');

    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', capped, 'role', 'authenticated')::text, true);
    res := public.redeem_league_invite('t0142TokenBBBBBBBBBBBBBB');
    execute format('set local role %I', orig);
    perform set_config('request.jwt.claims', null, true);
    if not (res->>'ok')::boolean then
      raise exception '0142: a full follow list cost somebody their access (%)', res;
    end if;
    select count(*) into n from league_guests where league_id = lg and user_id = capped;
    if n <> 1 then raise exception '0142: they were not actually let in'; end if;
    select cardinality(fav_league_ids) into n from fan_prefs where user_id = capped;
    if n <> 20 then raise exception '0142: the cap was raised to % instead of respected', n; end if;

    raise exception using errcode = 'P0004', message = '0142 self-test rollback';
  exception when sqlstate 'P0004' then null;
  end;
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', null, true);
end $test$;
