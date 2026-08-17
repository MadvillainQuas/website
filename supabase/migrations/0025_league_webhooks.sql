-- ============================================================================
-- COURTSIDE NETWORK — Phase 3 tail: tell somebody when a game finishes.
--
-- A result is only useful if the people who care hear about it. Most clubs
-- already have a Discord; posting the final score there the moment it is final
-- is the cheapest reach this platform can buy, and it needs no infrastructure
-- beyond a URL.
--
-- The URL IS A SECRET. Anyone holding a Discord webhook can post to that
-- channel as the app, so it must never reach a browser. Hence:
--
--   * the column lives on a table nobody can select — not the league admin who
--     set it, not the anon key, nobody. It is written through a function and
--     read only by the service role inside the finalise Edge Function.
--   * what a league admin CAN see is whether one is configured and how the
--     last delivery went, which is all anyone needs to manage it.
--
-- That is stricter than the obvious design (a column on `leagues`, which is
-- world-readable) and the reason for the separate table.
-- ============================================================================
create table if not exists public.league_webhooks (
  league_id   uuid primary key references public.leagues on delete cascade,
  url         text not null,
  kind        text not null default 'discord',
  enabled     boolean not null default true,
  created_by  uuid references auth.users on delete set null,
  updated_at  timestamptz not null default now(),
  last_sent_at   timestamptz,
  last_status    int,
  last_error     text
);

alter table public.league_webhooks enable row level security;
-- No policy at all. Default-deny means SELECT returns nothing to everyone,
-- including league admins; the secret is genuinely write-only from outside.

do $$ begin
  alter table public.league_webhooks
    add constraint league_webhooks_kind_ck check (kind in ('discord', 'slack'));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- set_league_webhook — write-only from a browser's point of view.
--
-- The URL is validated rather than trusted: it must be a Discord or Slack
-- webhook on their own domain over HTTPS. Without that check this is a
-- server-side request forgery primitive — a league admin could point it at an
-- internal address and have our function fetch it for them.
-- ---------------------------------------------------------------------------
create or replace function public.set_league_webhook(
  p_league uuid, p_url text, p_kind text default 'discord')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_league_admin(p_league) then
    raise exception 'only an administrator of that league may set its webhook'
      using errcode = '42501';
  end if;

  if p_url is null or trim(p_url) = '' then
    delete from league_webhooks where league_id = p_league;
    return;
  end if;

  if p_kind = 'discord' and p_url !~ '^https://(canary\.|ptb\.)?discord(app)?\.com/api/webhooks/' then
    raise exception 'that is not a Discord webhook URL — it should begin https://discord.com/api/webhooks/';
  end if;
  if p_kind = 'slack' and p_url !~ '^https://hooks\.slack\.com/services/' then
    raise exception 'that is not a Slack webhook URL — it should begin https://hooks.slack.com/services/';
  end if;

  insert into league_webhooks (league_id, url, kind, created_by, updated_at)
  values (p_league, trim(p_url), p_kind, auth.uid(), now())
  on conflict (league_id) do update
    set url = excluded.url, kind = excluded.kind,
        enabled = true, updated_at = now(),
        last_status = null, last_error = null;
end; $$;

-- what an admin may know about it: that it exists, and how it is doing
create or replace function public.league_webhook_status(p_league uuid)
returns table (configured boolean, kind text, enabled boolean,
               last_sent_at timestamptz, last_status int, last_error text)
language sql security definer set search_path = public as $$
  select true, w.kind, w.enabled, w.last_sent_at, w.last_status, w.last_error
    from league_webhooks w
   where w.league_id = p_league and public.is_league_admin(p_league)
  union all
  select false, null, null, null, null, null
   where public.is_league_admin(p_league)
     and not exists (select 1 from league_webhooks w2 where w2.league_id = p_league)
  limit 1;
$$;

revoke execute on function public.set_league_webhook(uuid, text, text) from anon, public;
grant  execute on function public.set_league_webhook(uuid, text, text) to authenticated;
revoke execute on function public.league_webhook_status(uuid) from anon, public;
grant  execute on function public.league_webhook_status(uuid) to authenticated;
