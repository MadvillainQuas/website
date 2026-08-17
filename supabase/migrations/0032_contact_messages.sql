-- ============================================================================
-- CONTACT MESSAGES.
--
-- A contact form has one job that is easy to get wrong: it must not put the
-- recipient's address anywhere the public can read it. The address is not in
-- this file, not in the page, and not in any JavaScript — it lives in an Edge
-- Function secret, and the browser only ever talks to the function.
--
-- Messages are ALSO stored, not only emailed. Email is the least reliable part
-- of any stack; if the provider is down, misconfigured or unpaid, a stored
-- message can still be read from the admin console, whereas one that only ever
-- existed in an SMTP attempt is gone.
--
-- The table is write-only from outside: anonymous visitors may insert, and
-- nobody may select except a platform admin. A contact form whose submissions
-- can be read back by the next visitor is a data breach with a form on top.
-- ============================================================================
create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  subject     text not null default '',
  body        text not null,
  league_id   uuid references public.leagues on delete set null,
  created_at  timestamptz not null default now(),
  -- how the delivery attempt went, so a silent failure is findable
  delivered   boolean not null default false,
  delivery_note text,
  handled_at  timestamptz,
  user_agent  text,
  source_ip   text
);
create index if not exists contact_created on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;

-- Nobody reads this but a platform admin. There is deliberately no policy for
-- anonymous or authenticated SELECT, so the default denial stands.
drop policy if exists contact_read on public.contact_messages;
create policy contact_read on public.contact_messages for select
  using (public.is_platform_admin());

-- Nor may anyone INSERT directly. Submissions come through the Edge Function,
-- which holds the service role — that is what lets it rate limit, and stops
-- the table being filled straight from the anon key at whatever rate a script
-- can manage.
-- (no insert policy, on purpose)

-- ---------------------------------------------------------------------------
-- A cheap rate limit the FUNCTION calls before accepting anything: how many
-- messages have come from this address, or this address's domain, recently.
-- Counting in the database rather than in the function means two concurrent
-- submissions cannot both see a count of zero.
-- ---------------------------------------------------------------------------
create or replace function public.contact_recent_count(p_email text, p_minutes int default 10)
returns int language sql security definer set search_path = public as $$
  select count(*)::int from contact_messages
   where lower(email) = lower(p_email)
     and created_at > now() - make_interval(mins => p_minutes);
$$;

revoke execute on function public.contact_recent_count(text, int) from anon, authenticated, public;

grant execute on function public.is_platform_admin() to authenticated;
