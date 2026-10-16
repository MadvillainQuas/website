-- ============================================================================
-- 0281: THE LINK EDITOR'S PLAYER SEARCH IN TIME (Louie, 2026-10-16: "when I try to type in players in the linked profiles/edit
-- links bit it sometimes comes up with error and usually takes a long time")
--
-- platform_link_search('player') folded every player's name up to four times on every keystroke -- the whole name, the name
-- surname first, each word again for the word-by-word match, every alias -- 19,000 players' worth of accent tables and regular
-- expressions per letter typed, so an answer took seconds and a busy moment ran past the request's time limit (the error).
--
--   player_link_keys (0278)  gains the folded name, the name surname first and the folded aliases, kept by the same trigger
--                            (now also on a change of aliases) and filled here for every player there is
--   platform_link_search     restated: the players' half reads those columns (a plain text match per row); the word-by-word
--                            match is "every word typed starts a word of the name". The clubs' half is as 0178 left it.
-- ============================================================================

alter table public.player_link_keys add column if not exists name_fold text;
alter table public.player_link_keys add column if not exists rev_fold text;
alter table public.player_link_keys add column if not exists alias_fold text;

create or replace function public.player_link_keys_keep()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text[] := public.link_person_tokens(new.first_name, new.last_name);
begin
  insert into public.player_link_keys (player_id, xkey, ckey, skey, first_tok, name_fold, rev_fold, alias_fold)
  values (new.id,
          nullif(array_to_string(array(select x from unnest(t) x order by x), ' '), ''),
          case when cardinality(t) >= 2 then t[1] || '|' || t[cardinality(t)] end,
          case when cardinality(t) >= 2 then left(t[1], 1) || '|' || t[cardinality(t)] end,
          t[1],
          public.link_fold(new.first_name || ' ' || coalesce(new.last_name, '')),
          public.link_fold(coalesce(new.last_name, '') || ' ' || new.first_name),
          nullif(array_to_string(array(select public.link_fold(a) from unnest(coalesce(new.aliases, '{}')) a where public.link_fold(a) is not null), '|'), ''))
  on conflict (player_id) do update set xkey = excluded.xkey, ckey = excluded.ckey, skey = excluded.skey, first_tok = excluded.first_tok,
    name_fold = excluded.name_fold, rev_fold = excluded.rev_fold, alias_fold = excluded.alias_fold;
  return new;
end $$;
revoke all on function public.player_link_keys_keep() from public, anon, authenticated;

drop trigger if exists players_link_keys on public.players;
create trigger players_link_keys after insert or update of first_name, last_name, aliases on public.players
  for each row execute function public.player_link_keys_keep();

-- every player there is now (a player 0278 has not keyed yet is keyed whole here)
insert into public.player_link_keys (player_id, xkey, ckey, skey, first_tok, name_fold, rev_fold, alias_fold)
select pl.id, public.link_person_key(pl.first_name, pl.last_name), public.link_person_core(pl.first_name, pl.last_name),
       public.link_person_short(pl.first_name, pl.last_name), (public.link_person_tokens(pl.first_name, pl.last_name))[1],
       public.link_fold(pl.first_name || ' ' || coalesce(pl.last_name, '')),
       public.link_fold(coalesce(pl.last_name, '') || ' ' || pl.first_name),
       nullif(array_to_string(array(select public.link_fold(a) from unnest(coalesce(pl.aliases, '{}')) a where public.link_fold(a) is not null), '|'), '')
  from public.players pl
on conflict (player_id) do update set name_fold = excluded.name_fold, rev_fold = excluded.rev_fold, alias_fold = excluded.alias_fold;

create or replace function public.platform_link_search(
  p_kind text, p_q text default null, p_league uuid default null, p_season text default null,
  p_limit int default 20, p_offset int default 0, p_exclude uuid[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  qk text := public.link_fold(p_q);
  qw text[] := string_to_array(public.link_fold(p_q), ' ');
  lim int := least(greatest(coalesce(p_limit, 20), 1), 50);
  ids uuid[];
  more boolean;
begin
  perform public.link_require_admin();
  perform public.link_require_kind(p_kind);
  if p_kind = 'team' then
    select array_agg(h.id order by h.rank, h.name), count(*) > lim into ids, more from (
      select t.id, t.name,
             case when qk is null then 2 when public.link_fold(t.name) = qk then 0 when public.link_fold(t.name) like qk || '%' then 1 else 2 end rank
        from public.teams t left join public.leagues l on l.id = t.league_id
       where (qk is null
              or public.link_fold(t.name) like '%' || qk || '%'
              or public.link_fold(t.short_name) like '%' || qk || '%'
              or public.link_team_key(t.name) like '%' || qk || '%'
              or public.link_fold(l.name) like '%' || qk || '%'
              or exists (select 1 from unnest(t.aliases) a where public.link_fold(a) like '%' || qk || '%'))
         and (p_league is null or t.league_id = p_league)
         and (p_season is null or exists (select 1 from public.competition_teams ct
                                            join public.competitions c on c.id = ct.competition_id
                                            join public.seasons s on s.id = c.season_id
                                           where ct.team_id = t.id and s.name = p_season))
         and not (t.id = any(coalesce(p_exclude, '{}')))
       order by 3, t.name offset greatest(coalesce(p_offset, 0), 0) limit lim + 1) h;
    return jsonb_build_object('rows', public.link_team_cards(coalesce(ids[1:lim], '{}')), 'more', coalesce(more, false));
  end if;
  select array_agg(h.id order by h.rank, h.name), count(*) > lim into ids, more from (
    select p.id, btrim(p.first_name || ' ' || coalesce(p.last_name, '')) as name,
           case when qk is null then 2 when k.name_fold = qk then 0 when k.name_fold like qk || '%' then 1 else 2 end rank
      from public.players p
      join public.player_link_keys k on k.player_id = p.id
     where (qk is null
            or k.name_fold like '%' || qk || '%'
            or k.rev_fold like '%' || qk || '%'
            -- every word typed starts a word of the name, in any order
            or not exists (select 1 from unnest(qw) w where w <> '' and (' ' || coalesce(k.name_fold, '')) not like '% ' || w || '%')
            or k.alias_fold like '%' || qk || '%')
       and (p_league is null or exists (select 1 from public.roster_entries re join public.teams t on t.id = re.team_id
                                         where re.player_id = p.id and t.league_id = p_league))
       and (p_season is null or exists (select 1 from public.roster_entries re join public.seasons s on s.id = re.season_id
                                         where re.player_id = p.id and s.name = p_season))
       and not (p.id = any(coalesce(p_exclude, '{}')))
     order by 3, 2 offset greatest(coalesce(p_offset, 0), 0) limit lim + 1) h;
  return jsonb_build_object('rows', public.link_player_cards(coalesce(ids[1:lim], '{}'), true), 'more', coalesce(more, false));
end $$;
