-- 0230: A DISABLED ACCOUNT IS OUT, AND ANOTHER EMAIL ON THE SAME NETWORK DOES NOT GET BACK IN (2026-10-04).
--
-- Before this, "disable" in the platform console (0044, platform_set_account_banned) set GoTrue's banned_until. That
-- refused a NEW sign-in, but a browser already signed in kept its session: its access token went on working until it
-- expired (up to an hour), it could be refreshed, and the page went on showing the account as signed in. And nothing
-- stopped the same person signing up again with another email.
--
--   THE DOOR ON EVERY REQUEST. public.api_gate() is PostgREST's pre-request function (pgrst.db_pre_request on the
--   authenticator role), run before every API request. A signed-in request from a disabled account, or from a blocked
--   network, is refused: HTTP 403 with the hint 'epinoia:disabled' or 'epinoia:blocked'. A signed-out request is never
--   looked at: scores, tables and every public page stay open to everyone, from anywhere. A platform administrator is
--   never refused for a network. And whatever goes wrong inside the gate lets the request through: it can fail open,
--   never shut the site. DO NOT DROP OR RENAME api_gate() without first running
--       alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';
--   or every request to the API fails.
--
--   account_status()  what a signed-in page asks when it opens (config.js): is this account disabled, is it on a blocked
--                     network? It notes the network the account is on (account_ips), and an account MADE AFTER its
--                     network was blocked (the same person with a new email) is disabled there and then. The gate lets
--                     this one call through, so the page can sign out and say why.
--   DISABLING (platform_set_account_banned, replaced) now also ends the account's sessions, so no browser can refresh
--   its way back in, and keeps the addresses GoTrue saw its sessions on. ENABLING lifts the network blocks made for it.
--
--   account_ips   an account's network addresses, noted while it is signed in; forgotten 90 days after last seen
--                 (a daily job). Nobody reads the table: the console's functions do.
--   ip_blocks     blocked networks: one IPv4 address, or an IPv6 /64 (a phone or a home router changes the rest of
--                 an IPv6 address every day), with the account they were blocked for.
--
--   platform_account_networks(user)     the addresses an account was seen on, and how many other accounts share each
--   platform_block_networks(user, ips)  block them (only a disabled account's; never the network the caller is on)
--   platform_unblock_network(net)       lift one
--   platform_ip_blocks()                every block: who it was for, signed-in visits refused on it since, and the
--                                       accounts seen on it since it was blocked

-- --------------------------------------------------------------------------------------------- addresses ---
create or replace function public.inet_or_null(p text) returns inet
language plpgsql immutable set search_path = public as $$
begin
  return nullif(btrim(p), '')::inet;
exception when others then
  return null;
end $$;

/* the address the request came from: Cloudflare's own header first (a browser cannot set it), then the gateway's */
create or replace function public.request_ip() returns inet
language plpgsql stable set search_path = public as $$
declare h jsonb; v inet;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if h is null or jsonb_typeof(h) <> 'object' then return null; end if;
  v := public.inet_or_null(h ->> 'cf-connecting-ip');
  if v is null then v := public.inet_or_null(h ->> 'x-real-ip'); end if;
  if v is null then v := public.inet_or_null(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)); end if;
  return v;
end $$;

/* the network a block covers: the IPv4 address itself, or the IPv6 /64 it is in */
create or replace function public.ip_net(p inet) returns cidr
language sql immutable set search_path = public as $$
  select case when p is null then null
              when family(p) = 6 then network(set_masklen(p, 64))
              else network(set_masklen(p, 32)) end
$$;

create table if not exists public.account_ips (
  user_id    uuid not null references auth.users on delete cascade,
  ip         inet not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  seen       int not null default 1,
  primary key (user_id, ip)
);
create index if not exists account_ips_ip on public.account_ips (ip);
alter table public.account_ips enable row level security;
revoke all on public.account_ips from anon, authenticated;
grant all on public.account_ips to service_role;

create table if not exists public.ip_blocks (
  net          cidr primary key,
  for_user     uuid references auth.users on delete set null,
  blocked_by   uuid references auth.users on delete set null,
  blocked_at   timestamptz not null default now(),
  refused      int not null default 0,
  last_refused timestamptz
);
alter table public.ip_blocks enable row level security;
revoke all on public.ip_blocks from anon, authenticated;
grant all on public.ip_blocks to service_role;

-- ------------------------------------------------------------------------------------------------ the gate ---
create or replace function public.api_gate() returns void
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  claims jsonb;
  uid    uuid;
  v_ip   inet;
  deny   text;
begin
  begin
    claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    uid := nullif(claims ->> 'sub', '')::uuid;
    if uid is not null
       and coalesce(claims ->> 'role', '') <> 'service_role'
       and coalesce(current_setting('request.path', true), '') not like '%/rpc/account_status' then
      if exists (select 1 from auth.users u where u.id = uid and u.banned_until > now()) then
        deny := 'disabled';
      elsif exists (select 1 from public.ip_blocks) then
        v_ip := public.request_ip();
        if v_ip is not null
           and exists (select 1 from public.ip_blocks b where b.net >>= v_ip)
           and not exists (select 1 from public.memberships m where m.user_id = uid and m.role = 'platform_admin') then
          deny := 'blocked';
        end if;
      end if;
    end if;
  exception when others then
    deny := null;              -- a gate that cannot decide lets the request through
  end;
  if deny = 'disabled' then
    raise exception 'This account has been disabled.' using errcode = 'PT403', hint = 'epinoia:disabled';
  elsif deny = 'blocked' then
    raise exception 'Accounts cannot be used from this network.' using errcode = 'PT403', hint = 'epinoia:blocked';
  end if;
end $$;
/* every role PostgREST can switch to must be able to run it, or that role's every request fails */
grant execute on function public.api_gate() to public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------------------- ending sessions ---
/* the addresses GoTrue saw the account's sessions on are kept first, then the sessions go: no browser can refresh its
   way back in. Each step on its own: a GoTrue without one of these tables or columns skips it, and the ban still holds */
create or replace function public.account_end_sessions(p_user uuid) returns void
language plpgsql volatile security definer set search_path = public, auth as $$
begin
  begin
    execute $q$
      insert into public.account_ips as a (user_id, ip, first_seen, last_seen)
      select $1, s.ip, min(s.created_at), max(coalesce(s.updated_at, s.created_at))
        from auth.sessions s
       where s.user_id = $1 and s.ip is not null
       group by s.ip
      on conflict (user_id, ip) do update
        set first_seen = least(a.first_seen, excluded.first_seen),
            last_seen  = greatest(a.last_seen, excluded.last_seen)$q$
    using p_user;
  exception when others then null;
  end;
  begin
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  exception when others then null;
  end;
  begin
    execute 'delete from auth.refresh_tokens where user_id = $1::text' using p_user;
  exception when others then null;
  end;
end $$;

/* disabling, for this file's two callers: GoTrue's ban, the sessions ended, the audit row */
create or replace function public.account_disable_now(p_user uuid, p_actor uuid, p_detail jsonb)
returns void language plpgsql volatile security definer set search_path = public, auth as $$
begin
  execute 'update auth.users set banned_until = $1 where id = $2' using now() + interval '100 years', p_user;
  perform public.account_end_sessions(p_user);
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (p_actor, 'disable_account', 'account', p_user::text, coalesce(p_detail, '{}'::jsonb));
end $$;

-- ------------------------------------------------------------------------- disabling, from the console ---
create or replace function public.platform_set_account_banned(
  p_user uuid, p_banned boolean
) returns text language plpgsql security definer
set search_path = public, auth as $$
declare has_col boolean; n int := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot disable your own account' using errcode = '23514';
  end if;
  -- never lock the platform out of itself
  if p_banned and exists (select 1 from memberships
                          where user_id = p_user and role = 'platform_admin') then
    raise exception 'that account is a platform admin — revoke the role first'
      using errcode = '23514';
  end if;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'auth' and table_name = 'users'
                    and column_name = 'banned_until') into has_col;
  if not has_col then
    raise exception 'this GoTrue version has no banned_until column — disable the account in the Supabase dashboard'
      using errcode = '0A000';
  end if;

  if p_banned then
    perform public.account_disable_now(p_user, auth.uid(), '{}'::jsonb);
    return 'account disabled';
  end if;

  execute 'update auth.users set banned_until = null where id = $1' using p_user;
  delete from ip_blocks where for_user = p_user;
  get diagnostics n = row_count;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'enable_account', 'account', p_user::text, jsonb_build_object('networks_unblocked', n));
  return 'account enabled' || case when n = 0 then ''
                                   else ', and ' || n || ' blocked network' || case when n = 1 then '' else 's' end || ' lifted' end;
end; $$;

-- ------------------------------------------------------------------------------------- the page's question ---
create or replace function public.account_status() returns jsonb
language plpgsql volatile security definer set search_path = public, auth as $$
declare
  uid     uuid := auth.uid();
  v_ip    inet := public.request_ip();
  made    timestamptz;
  off     boolean;
  admin   boolean;
  bnet    cidr;
  bfor    uuid;
  bat     timestamptz;
begin
  if uid is null then return jsonb_build_object('signed_in', false); end if;
  select u.created_at, coalesce(u.banned_until > now(), false) into made, off from auth.users u where u.id = uid;
  if not found then return jsonb_build_object('signed_in', false, 'gone', true); end if;

  if v_ip is not null then
    insert into account_ips (user_id, ip) values (uid, v_ip)
    on conflict (user_id, ip) do update set last_seen = now(), seen = account_ips.seen + 1;

    admin := exists (select 1 from memberships m where m.user_id = uid and m.role = 'platform_admin');
    if not admin then
      select b.net, b.for_user, b.blocked_at into bnet, bfor, bat
        from ip_blocks b where b.net >>= v_ip order by masklen(b.net) desc limit 1;
      if bnet is not null then
        update ip_blocks set refused = refused + 1, last_refused = now() where net = bnet;
        /* made after its network was blocked: the same person with a new email */
        if not off and made > bat then
          perform public.account_disable_now(uid, null, jsonb_build_object(
            'why', 'made after its network was blocked', 'network', bnet::text, 'blocked_for', bfor));
          off := true;
        end if;
      end if;
    end if;
  end if;

  return jsonb_build_object('signed_in', true, 'disabled', off, 'blocked', bnet is not null);
end $$;
revoke all on function public.account_status() from public, anon;
grant execute on function public.account_status() to authenticated;

-- ----------------------------------------------------------------------------------- the console's networks ---
create or replace function public.platform_account_networks(p_user uuid)
returns table (ip text, net text, first_seen timestamptz, last_seen timestamptz, seen int, others int, blocked boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
    select host(a.ip), public.ip_net(a.ip)::text, a.first_seen, a.last_seen, a.seen,
           (select count(distinct o.user_id)::int from account_ips o
             where o.user_id <> a.user_id and o.ip <<= public.ip_net(a.ip)),
           exists (select 1 from ip_blocks b where b.net >>= a.ip)
      from account_ips a
     where a.user_id = p_user
     order by a.last_seen desc
     limit 50;
end $$;

create or replace function public.platform_block_networks(p_user uuid, p_ips text[] default null)
returns text language plpgsql volatile security definer set search_path = public, auth as $$
declare
  mine inet := public.request_ip();
  nets cidr[];
  n    int := 0;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user and u.banned_until > now()) then
    raise exception 'disable the account first: only a disabled account''s networks are blocked' using errcode = '23514';
  end if;
  select coalesce(array_agg(distinct public.ip_net(a.ip)), '{}') into nets
    from account_ips a
   where a.user_id = p_user
     and (p_ips is null or host(a.ip) = any (p_ips) or public.ip_net(a.ip)::text = any (p_ips));
  if cardinality(nets) = 0 then return 'no networks to block'; end if;
  if mine is not null and exists (select 1 from unnest(nets) x where x >>= mine) then
    raise exception 'that is the network you are on now: blocking it would refuse every other account here too'
      using errcode = '23514';
  end if;

  insert into ip_blocks (net, for_user, blocked_by)
  select x, p_user, auth.uid() from unnest(nets) x
  on conflict (net) do nothing;
  get diagnostics n = row_count;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'block_networks', 'account', p_user::text, jsonb_build_object('networks', n));
  return 'blocked ' || n || ' network' || case when n = 1 then '' else 's' end;
end $$;

create or replace function public.platform_unblock_network(p_net text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare who uuid; n int;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  delete from ip_blocks where net = public.inet_or_null(p_net)::cidr returning for_user into who;
  get diagnostics n = row_count;
  if n = 0 then return 'that network was not blocked'; end if;
  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'unblock_network', 'account', who::text, '{}'::jsonb);
  return 'network unblocked';
end $$;

create or replace function public.platform_ip_blocks()
returns table (net text, for_user uuid, for_email text, blocked_at timestamptz, refused int, last_refused timestamptz,
               accounts_since int)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrators only' using errcode = '42501';
  end if;
  return query
    select b.net::text, b.for_user, u.email::text, b.blocked_at, b.refused, b.last_refused,
           (select count(distinct a.user_id)::int from account_ips a
             where a.ip <<= b.net and a.last_seen >= b.blocked_at and a.user_id is distinct from b.for_user)
      from ip_blocks b
      left join auth.users u on u.id = b.for_user
     order by b.blocked_at desc;
end $$;

-- --------------------------------------------------------------------------------------------- forgetting ---
create or replace function public.account_ips_prune() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from account_ips where last_seen < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;
do $cron$
begin
  if to_regclass('cron.job') is not null then
    begin
      execute 'select cron.unschedule(j.jobid) from cron.job j where j.jobname = $1' using 'epinoia-account-ips-prune'::text;
      execute 'select cron.schedule($1, $2, $3)'
        using 'epinoia-account-ips-prune'::text, '41 4 * * *'::text, 'select public.account_ips_prune()'::text;
    exception when others then
      raise warning '0230: the prune job was not scheduled (%: %); run select public.account_ips_prune() now and then', sqlstate, sqlerrm;
    end;
  end if;
end $cron$;

-- ------------------------------------------------------------------------------------------------- grants ---
do $$
declare f text;
begin
  foreach f in array array[
    'platform_set_account_banned(uuid,boolean)', 'platform_account_networks(uuid)',
    'platform_block_networks(uuid,text[])', 'platform_unblock_network(text)', 'platform_ip_blocks()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'account_end_sessions(uuid)', 'account_disable_now(uuid,uuid,jsonb)', 'account_ips_prune()',
    'request_ip()', 'inet_or_null(text)', 'ip_net(inet)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ------------------------------------------------------------------------------- the gate, switched on ---
/* Only where PostgREST has no pre-request function of its own yet: one that is there is left alone, and the notice
   says to call public.api_gate() from it. */
do $gate$
declare cur text;
begin
  select substr(c, length('pgrst.db_pre_request=') + 1) into cur
    from pg_roles r, unnest(coalesce(r.rolconfig, '{}'::text[])) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%'
   limit 1;
  if cur is not null and cur not in ('public.api_gate', 'api_gate') then
    raise notice '0230: PostgREST already runs % before each request, so the gate is not switched on: call public.api_gate() from it', cur;
  else
    begin
      execute 'alter role authenticator set pgrst.db_pre_request = ''public.api_gate''';
    exception when others then
      raise warning '0230: the gate is not switched on (%: %): as the postgres user, set pgrst.db_pre_request to public.api_gate on the authenticator role, then notify pgrst to reload config (docs/accounts-and-networks.md)', sqlstate, sqlerrm;
    end;
  end if;
end $gate$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
