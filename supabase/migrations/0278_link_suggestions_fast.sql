-- ============================================================================
-- 0278: THE POSSIBLE PLAYER MATCHES IN TIME (the console's Links tab, Players)
--
-- Louie, 2026-10-16: "in links it isn't showing me possible player links the website has flagged". platform_link_suggestions('player')
-- worked out four name keys for EVERY player on every call (19,000 of them, each key folding the name again) and then, for each of
-- ~1,500 candidates, scanned every player's clubs to ask whether two of them were at linked clubs -- three times over. On a database
-- the size of the site's it took far longer than a request is allowed (a PGlite copy: 131 s), so the call was cancelled and the
-- page kept the club matches it had drawn before.
--
--   player_link_keys     each player's name keys, worked out once when the name is written (trigger) and read from here
--   platform_link_suggestions   restated: the keys from that table, its working sets materialised, and the same-club evidence
--                        as one join over the candidates' own players. The answer is the same row for row (entity-links test).
-- Nothing else changes. The clubs' half of the function is as 0181 left it.
-- ============================================================================

create table if not exists public.player_link_keys (
  player_id uuid primary key references public.players on delete cascade,
  xkey      text,
  ckey      text,
  skey      text,
  first_tok text
);
create index if not exists player_link_keys_x on public.player_link_keys (xkey) where xkey is not null;
create index if not exists player_link_keys_c on public.player_link_keys (ckey) where ckey is not null;
create index if not exists player_link_keys_s on public.player_link_keys (skey) where skey is not null;
alter table public.player_link_keys enable row level security;   -- read only by the console's security-definer functions
revoke all on public.player_link_keys from anon, authenticated;

create or replace function public.player_link_keys_keep()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text[] := public.link_person_tokens(new.first_name, new.last_name);
begin
  insert into public.player_link_keys (player_id, xkey, ckey, skey, first_tok)
  values (new.id,
          nullif(array_to_string(array(select x from unnest(t) x order by x), ' '), ''),
          case when cardinality(t) >= 2 then t[1] || '|' || t[cardinality(t)] end,
          case when cardinality(t) >= 2 then left(t[1], 1) || '|' || t[cardinality(t)] end,
          t[1])
  on conflict (player_id) do update set xkey = excluded.xkey, ckey = excluded.ckey, skey = excluded.skey, first_tok = excluded.first_tok;
  return new;
end $$;
revoke all on function public.player_link_keys_keep() from public, anon, authenticated;

drop trigger if exists players_link_keys on public.players;
create trigger players_link_keys after insert or update of first_name, last_name on public.players
  for each row execute function public.player_link_keys_keep();

-- every player there is now, keyed by the same functions the suggestions used (so the answer cannot move)
insert into public.player_link_keys (player_id, xkey, ckey, skey, first_tok)
select pl.id, public.link_person_key(pl.first_name, pl.last_name), public.link_person_core(pl.first_name, pl.last_name),
       public.link_person_short(pl.first_name, pl.last_name), (public.link_person_tokens(pl.first_name, pl.last_name))[1]
  from public.players pl
on conflict (player_id) do update set xkey = excluded.xkey, ckey = excluded.ckey, skey = excluded.skey, first_tok = excluded.first_tok;

create or replace function public.platform_link_suggestions(p_kind text, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  lim int := least(greatest(coalesce(p_limit, 25), 1), 60);
  out_rows jsonb;
  n_total int;
begin
  perform public.link_require_admin();
  perform public.link_require_kind(p_kind);
  if p_kind = 'team' then
    with k as (
      select t.id, t.league_id, t.name, public.link_team_key(t.name) key, m.group_id
        from public.teams t left join public.team_group_members m on m.team_id = t.id),
    g as (
      select key, array_agg(id order by id) ids, count(distinct league_id) leagues,
             count(distinct public.link_fold(name)) spellings, count(distinct coalesce(group_id::text, id::text)) units
        from k where key is not null group by key having count(*) > 1),
    c as (
      select g.*, case when leagues > 1 and spellings = 1 then 'high' when leagues > 1 then 'medium' else 'low' end confidence,
             md5(array_to_string(ids, ',')) h
        from g where units > 1
         and not exists (select 1 from public.link_dismissals d where d.kind = 'team' and d.members_hash = md5(array_to_string(g.ids, ',')))),
    o as (
      select c.*, row_number() over (order by case confidence when 'high' then 0 when 'medium' then 1 else 2 end,
                                               cardinality(ids) desc, key) rn, count(*) over () total
        from c)
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', o.key, 'confidence', o.confidence, 'flag', 'possible',
             'reason', case o.confidence
                         when 'high' then 'the same name in ' || o.leagues || ' leagues'
                         when 'medium' then 'the same club once the legal-form, gender and youth words are set aside (' || o.leagues || ' leagues)'
                         else 'the same name twice in one league' end,
             'ids', to_jsonb(o.ids), 'cards', public.link_team_cards(o.ids)) order by o.rn), '[]'::jsonb),
           coalesce(max(o.total), 0)
      into out_rows, n_total from o where o.rn > greatest(coalesce(p_offset, 0), 0) and o.rn <= greatest(coalesce(p_offset, 0), 0) + lim;
    return jsonb_build_object('rows', out_rows, 'total', n_total);
  end if;

  with p as materialized (
    /* a row the trigger has not seen (none should be) is keyed here, as before */
    select pl.id, pl.birth_year, m.group_id,
           case when k.player_id is null then public.link_person_key(pl.first_name, pl.last_name) else k.xkey end xkey,
           case when k.player_id is null then public.link_person_core(pl.first_name, pl.last_name) else k.ckey end ckey,
           case when k.player_id is null then public.link_person_short(pl.first_name, pl.last_name) else k.skey end skey,
           case when k.player_id is null then (public.link_person_tokens(pl.first_name, pl.last_name))[1] else k.first_tok end first_tok
      from public.players pl
      left join public.player_link_keys k on k.player_id = pl.id
      left join public.player_group_members m on m.player_id = pl.id),
  ex as (
    select 0 prio, 'exact'::text kind, null::text note, xkey key, array_agg(id order by id) ids, count(*) n,
           count(distinct coalesce(group_id::text, id::text)) units,
           count(distinct birth_year) filter (where birth_year is not null) years,
           count(*) filter (where birth_year is not null) with_year
      from p where xkey is not null group by xkey having count(*) > 1),
  co as (
    /* first and last word alike, whatever is between them */
    select 1 prio, 'core'::text kind, null::text note, ckey key, array_agg(id order by id) ids, count(*) n,
           count(distinct coalesce(group_id::text, id::text)) units,
           count(distinct birth_year) filter (where birth_year is not null) years,
           count(*) filter (where birth_year is not null) with_year
      from p where ckey is not null group by ckey having count(*) > 1 and count(distinct xkey) > 1),
  sh as (
    /* a short key is only a candidate where its rows are not all one full name (an initial can be any first name):
       one full first name at most, the rest initials */
    select 2 prio, 'short'::text kind, null::text note, skey key, array_agg(id order by id) ids, count(*) n,
           count(distinct coalesce(group_id::text, id::text)) units,
           count(distinct birth_year) filter (where birth_year is not null) years,
           count(*) filter (where birth_year is not null) with_year
      from p where skey is not null
     group by skey
    having count(*) > 1 and count(distinct xkey) > 1
       and count(distinct first_tok) filter (where length(first_tok) > 1) <= 1),
  /* AN INITIAL THAT COULD BE SEVERAL PEOPLE ("J Smith" beside John and James Smith): one candidate per full first name, the
     initial rows with it, always low -- the console decides which, if any */
  s0 as materialized (
    select id, skey, first_tok, (length(first_tok) = 1) is_init, xkey, group_id, birth_year from p where skey is not null),
  amb as (
    select 3 prio, 'ambiguous'::text kind,
           (select string_agg(distinct y.first_tok, ' or ' order by y.first_tok) from s0 y where y.skey = f.skey and not y.is_init) note,
           f.skey || ' > ' || f.first_tok key, array_agg(x.id order by x.id) ids, count(*) n,
           count(distinct coalesce(x.group_id::text, x.id::text)) units,
           count(distinct x.birth_year) filter (where x.birth_year is not null) years,
           count(*) filter (where x.birth_year is not null) with_year
      from (select distinct skey, first_tok from s0 where not is_init
             and skey in (select skey from s0 where not is_init group by skey having count(distinct first_tok) > 1)
             and skey in (select skey from s0 where is_init)) f
      join s0 x on x.skey = f.skey and (x.first_tok = f.first_tok or x.is_init)
     group by f.skey, f.first_tok
    having count(*) > 1),
  cand0 as materialized (
    select row_number() over (order by prio, key) no, u.*
      from (select * from ex where units > 1 union all select * from co where units > 1
            union all select * from sh where units > 1 union all select * from amb where units > 1) u),
  /* A SET THAT IS INSIDE A BIGGER ONE (the same name twice, and a third spelling with a middle name) is shown once,
     as the bigger one; two equal sets are shown as the more exact kind */
  mem as materialized (select no, unnest(ids) id from cand0),
  absorbed as (
    select m1.no from mem m1 join mem m2 on m2.id = m1.id and m2.no <> m1.no
      join cand0 c1 on c1.no = m1.no join cand0 c2 on c2.no = m2.no
     group by m1.no, m2.no, c1.n, c1.prio, c2.n, c2.prio
    having count(*) = c1.n and (c2.n > c1.n or c2.prio < c1.prio)),
  cand as materialized (select * from cand0 where no not in (select no from absorbed)),
  /* two of a candidate's players at clubs that are one club (a club group) is the strongest evidence there is */
  sc as materialized (
    select distinct x.no
      from (select c.no, unnest(c.ids) id from cand c) x
      join public.roster_entries re on re.player_id = x.id
      join public.team_group_members tm on tm.team_id = re.team_id
     group by x.no, tm.group_id
    having count(distinct x.id) > 1),
  ev as materialized (
    select c.*, (c.no in (select no from sc)) same_club
      from cand c
     where not exists (select 1 from public.link_dismissals d where d.kind = 'player' and d.members_hash = md5(array_to_string(c.ids, ',')))),
  o as (
    select ev.*,
           case when kind = 'ambiguous' or years > 1 then 'low'
                when same_club or (years = 1 and with_year >= 2) then 'high'
                else 'medium' end confidence
      from ev),
  r as (
    select o.*, row_number() over (order by case confidence when 'high' then 0 when 'medium' then 1 else 2 end,
                                             prio, n desc, key) rn, count(*) over () total
      from o)
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', r.key, 'kind', r.kind, 'confidence', r.confidence, 'flag', 'possible',
           'reason', concat_ws(', ',
             case r.kind when 'exact' then 'the same name'
                         when 'core' then 'the same first and last name, with a middle name or particle in one of them'
                         when 'ambiguous' then 'an initial that could be ' || r.note || ': only this full name and the initials'
                         else 'the same surname and first initial (one feed abbreviates)' end,
             case when r.years > 1 then 'but the birth years differ'
                  when r.years = 1 and r.with_year >= 2 then 'the same birth year' end,
             case when r.same_club then 'at clubs that are already linked' end),
           'ids', to_jsonb(r.ids), 'cards', public.link_player_cards(r.ids, true)) order by r.rn), '[]'::jsonb),
         coalesce(max(r.total), 0)
    into out_rows, n_total from r where r.rn > greatest(coalesce(p_offset, 0), 0) and r.rn <= greatest(coalesce(p_offset, 0), 0) + lim;
  return jsonb_build_object('rows', out_rows, 'total', n_total);
end $$;
