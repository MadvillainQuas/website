-- 0227: A PERSON DELETES THEIR OWN ACCOUNT (2026-10-03). "Delete my account" on the Personalisation page used to open the
-- erasure request on the privacy page: the person asked, a platform administrator deleted the account by hand within the
-- month. Apple (5.1.1(v)) and Google Play expect the deletion to start in the app and to happen, so this is the function
-- the page calls, with a typed confirmation, and the privacy form stays for whoever cannot use it (signed out, a membership
-- still running, an administrator's own account).
--
--   delete_my_account(p_confirm)   the signed-in person deletes THEIR OWN account and nobody else's. p_confirm is the
--                                  address they sign in with, typed (an account with no address: the word DELETE).
--                                  Refused, with the reason in plain words, for a platform administrator (another
--                                  administrator removes the role first, as the console already insists) and for a
--                                  membership still running (access_active, 0117): deleting the row would leave Stripe
--                                  billing a customer who no longer exists, so it is cancelled first.
--   erase_account(user, actor)     the one place an account is deleted, whoever asked. Not callable from a browser.
--   platform_delete_account        (0044) now goes through erase_account too.
--
-- WHAT WAS FOUND ON THE WAY, and is mended here: the console's own delete FAILED for any account that had ever made a
-- club, a player, a game or a play, uploaded or approved a photograph, sent an announcement or an invitation, or released a
-- player. Eleven keys to auth.users were NO ACTION (so, a foreign-key error), though 0044's comment says the history
-- "survives with the name removed", and the event log, which is append-only, refuses even the update that would clear its
-- created_by. A fan with nothing of the kind deleted fine, so nobody had seen it. Now:
--   * those keys are ON DELETE SET NULL (any other single-column key to auth.users that blocks, and may be null, with them);
--   * forbid_event_mutation (0001, 0183) allows ONE more change: created_by cleared, while an erasure has set
--     epinoia.account_erasure for its transaction. A merge's exception is as it was;
--   * erase_account also removes what is keyed to the ADDRESS rather than the account (a grant, an invitation, a scout, a
--     front-office or outlet seat, a weekly report email), which would otherwise outlive the account and keep emailing it;
--   * the person's own open erasure request (about themselves, Epinoia the controller) is closed as completed, with the
--     audit row the console writes for a close, so the queue does not keep a request that has been done;
--   * the audit row says "privacy.erase" and the account's id, and (unlike 0044's) NOT the address.
--
-- WHAT STAYS, as the privacy page says: games, scores and statistics the account entered (their name removed), what the
-- law has us keep, contact-form messages (they are read and answered by a person), and the record that the account was
-- deleted. Photograph files are not SQL's to remove (the Storage API does that): the page removes them first, as it does
-- for one photograph (go.js removePhoto), then calls this. Stripe's own customer record is Stripe's.
--
-- THE KEYS ARE ADDED NOT VALID: no table is scanned and none is locked longer than the swap, which matters on games and
-- game_events. The rows already there were valid under the old key, and every new row is checked. (To validate them later,
-- in a quiet moment: alter table <t> validate constraint <name>.)

set local lock_timeout = '5s';

-- 1. the keys that blocked an account's deletion ----------------------------------------------------------------------
do $$
declare k record;
begin
  perform set_config('lock_timeout', '5s', true);        -- here too: a push that sends statements one at a time would not have the line above
  for k in
    select c.conrelid::regclass::text as tbl, c.conname, a.attname as col, a.attnotnull
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
       and c.confdeltype in ('a', 'r') and array_length(c.conkey, 1) = 1
       and c.connamespace = 'public'::regnamespace
  loop
    if k.attnotnull then
      raise notice '% (%) cannot be null, so it still blocks deleting an account', k.tbl, k.col;
      continue;
    end if;
    execute format('alter table %s drop constraint %I', k.tbl, k.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references auth.users (id) on delete set null not valid',
                   k.tbl, k.conname, k.col);
  end loop;
end $$;

-- 2. the event log: one more exception, for the erasure ------------------------------------------------------------------
create or replace function public.forbid_event_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('epinoia.player_merge', true), '') = 'on'
     and (to_jsonb(new) - 'pid' - 'payload') = (to_jsonb(old) - 'pid' - 'payload') then
    return new;                                   -- a merge renaming a player: the play itself is not touched
  end if;
  if tg_op = 'UPDATE'
     and coalesce(current_setting('epinoia.account_erasure', true), '') = 'on'
     and new.created_by is null
     and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;                                   -- an account deleted: who entered the play is cleared, the play is not touched
  end if;
  raise exception 'game_events is append-only (attempted %)', tg_op;
end; $$;

-- 3. the one place an account is deleted ----------------------------------------------------------------------------------
/* p_actor: the administrator who deleted it, for the audit row; null when the account's own holder did. */
create or replace function public.erase_account(p_user uuid, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public, restricted as $$
declare
  addr   text;
  r      record;
  closed int := 0;
begin
  select lower(btrim(u.email::text)) into addr from auth.users u where u.id = p_user;
  if not found then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  addr := nullif(addr, '');
  perform set_config('epinoia.account_erasure', 'on', true);          -- this transaction only: the event log's exception

  /* their own open erasure request, about themselves, is answered by this */
  if p_actor is null then
    for r in
      select d.id from restricted.data_requests d
       where d.requester_user = p_user and d.kind = 'erasure' and d.capacity = 'self'
         and d.tenant_id is null and d.closed_at is null
         for update
    loop
      update restricted.data_requests d
         set status = 'completed',
             outcome = 'The account holder deleted the account themselves, from their account page, on ' ||
                       to_char(now() at time zone 'Europe/London', 'DD Mon YYYY') ||
                       '. The account and what it held are gone; games and statistics they entered stay, without their name.'
       where d.id = r.id;
      insert into audit_log (actor, action, subject, subject_id, detail)
      values (null, 'privacy.close', 'data_request', r.id::text,
              jsonb_build_object('kind', 'erasure', 'status', 'completed', 'by', 'the account holder'));
      closed := closed + 1;
    end loop;
  end if;

  /* what is keyed to the address, not the account, and would outlive it (the weekly report email among it) */
  if addr is not null then
    delete from public.access_grants      where lower(email) = addr;
    delete from public.platform_scouts    where lower(email) = addr;
    delete from public.front_office_grants where lower(email) = addr;
    delete from public.creator_members    where lower(email) = addr;
    delete from public.pending_roles      where lower(email) = addr;
  end if;
  delete from public.report_mail_subs where user_id = p_user or (addr is not null and lower(email) = addr);   -- its log, files and requests with it
  delete from public.notify_audience_rows where user_id = p_user;

  /* the creators with no key to the account: the work stays, the name goes */
  update public.league_discords  set created_by = null where created_by = p_user;
  update public.player_groups    set created_by = null where created_by = p_user;
  update public.team_groups      set created_by = null where created_by = p_user;
  update public.report_mail_subs set created_by = null where created_by = p_user;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (p_actor, 'privacy.erase', 'account', p_user::text,
          jsonb_build_object('by', case when p_actor is null then 'the account holder' else 'a platform administrator' end));

  delete from auth.users where id = p_user;                            -- profile, roles, follows, notifications, stamps, photographs' rows, usernames ... with it
  return jsonb_build_object('ok', true, 'closed_requests', closed);
end; $$;
revoke all on function public.erase_account(uuid, uuid) from public, anon, authenticated;

-- 4. the person's own call ------------------------------------------------------------------------------------------------
create or replace function public.delete_my_account(p_confirm text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  addr text;
begin
  if me is null then
    raise exception 'sign in to delete your account' using errcode = '42501';
  end if;
  select nullif(btrim(u.email::text), '') into addr from auth.users u where u.id = me;
  if not found then
    return jsonb_build_object('ok', true, 'already', true);        -- a token that outlived its account
  end if;

  if exists (select 1 from public.memberships m where m.user_id = me and m.role = 'platform_admin') then
    raise exception 'a platform administrator''s account is deleted by another administrator: ask one to revoke your role first'
      using errcode = '23514';
  end if;
  if exists (select 1 from public.access_subscriptions s
              where s.user_id = me and public.access_active(s.status, s.current_period_end, s.past_due_since)) then
    raise exception 'you have a membership that is still running: cancel it first (Personalisation, Membership, Cancel membership). Once it has ended you can delete your account here, or ask for it on the privacy page and say so'
      using errcode = '23514';
  end if;

  if addr is not null then
    if lower(btrim(coalesce(p_confirm, ''))) <> lower(addr) then
      raise exception 'type the address you sign in with, exactly, to confirm' using errcode = '22023';
    end if;
  elsif upper(btrim(coalesce(p_confirm, ''))) <> 'DELETE' then
    raise exception 'type DELETE to confirm' using errcode = '22023';
  end if;

  return public.erase_account(me, null);
end; $$;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- 5. the console's delete, through the same door -------------------------------------------------------------------------
create or replace function public.platform_delete_account(
  p_user uuid, p_confirm_email text
) returns text language plpgsql security definer
set search_path = public, auth as $$
declare addr text;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot delete your own account'
      using errcode = '23514';
  end if;

  select u.email::text into addr from auth.users u where u.id = p_user;
  if addr is null then return 'already gone'; end if;

  /* Typing the address is the confirmation. A dialog with an OK button is
     one mis-click; this is not, and deleting the wrong account here is not
     recoverable from the browser. */
  if lower(coalesce(trim(p_confirm_email), '')) <> lower(addr) then
    raise exception 'type the account address exactly to confirm deletion'
      using errcode = '22023';
  end if;

  if exists (select 1 from memberships where user_id = p_user and role = 'platform_admin') then
    raise exception 'that account is a platform admin — revoke the role first'
      using errcode = '23514';
  end if;

  perform public.erase_account(p_user, auth.uid());
  return 'deleted ' || addr;
end; $$;
