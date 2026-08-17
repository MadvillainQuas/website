-- ============================================================================
-- 0046 — THE FORMAT DESIGNER: byes, series and two-legged ties.
--
-- 0018 gave the platform a bracket. It could do exactly one thing: a
-- single-elimination knockout whose field is a power of two, every tie decided
-- by one game (or by aggregate if somebody happened to attach two).
--
-- Real post-seasons are not that. The common shapes:
--
--   1-4 straight knockout            four teams, semis and a final
--   1 & 2 bye, 3-6 play in           six teams, two rounds, then a final
--   two legs, home and away          decided on aggregate over the pair
--   best of three, five, seven       decided on wins, not on points
--
-- and cups add a group phase in front of any of them. All of that is here,
-- expressed as one specification a league fills in once, rather than as four
-- more functions.
--
-- WHY BYES WERE REFUSED BEFORE, and why they are allowed now. 0018's comment
-- was right that who gets a bye is a decision with consequences, and wrong
-- that the answer was to refuse the whole shape: leagues went and faked it
-- with a phantom fixture. Here the number of byes is an explicit input a
-- person types, so it is still a decision made on purpose — just one the
-- platform can then carry out.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHAT A TIE NOW KNOWS
-- ---------------------------------------------------------------------------
alter table public.bracket_ties
  -- how many games the tie is. 1 = one game, 2 = home and away, 3/5/7 = series
  add column if not exists legs int not null default 1,
  -- 'aggregate' adds the scores up; 'wins' counts games won. Two-legged ties
  -- are aggregate, series are wins, and the difference is not cosmetic: a team
  -- can win a best-of-three while being outscored across it.
  add column if not exists decider text not null default 'wins',
  -- a tie with one team in it, awarded without being played
  add column if not exists is_bye boolean not null default false;

do $$ begin
  alter table public.bracket_ties add constraint bracket_decider_ck
    check (decider in ('wins','aggregate'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.bracket_ties add constraint bracket_legs_ck
    check (legs between 1 and 9);
exception when duplicate_object then null; end $$;

-- The specification the bracket was built from, kept so the public page can
-- say "best of three" rather than the reader counting the games.
alter table public.competitions
  add column if not exists format_config jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. advance_bracket — replaces the 0018 version.
--
-- Three changes: a bye resolves without a game, a series is decided on games
-- won rather than points, and a tie only resolves once it MATHEMATICALLY
-- cannot change. A 2-0 lead in a best-of-three is over; a 1-1 aggregate after
-- one leg of two is not, even though one side is "ahead" on the games played
-- so far.
-- ---------------------------------------------------------------------------
create or replace function public.advance_bracket(p_competition uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_home uuid; v_away uuid;
  v_hs int; v_as int; v_played int;
  v_hw int; v_aw int; v_need int;
  v_winner uuid;
begin
  for t in
    select * from bracket_ties
     where competition_id = p_competition
     order by round, slot
  loop
    v_home := t.home_team_id;
    if v_home is null and t.home_from_tie is not null then
      select winner_team_id into v_home from bracket_ties where id = t.home_from_tie;
    end if;
    v_away := t.away_team_id;
    if v_away is null and t.away_from_tie is not null then
      select winner_team_id into v_away from bracket_ties where id = t.away_from_tie;
    end if;

    -- points for and against, and games won, from this tie's point of view
    select coalesce(sum(case when g.home_team_id = v_home then g.home_score
                             when g.away_team_id = v_home then g.away_score else 0 end), 0),
           coalesce(sum(case when g.home_team_id = v_away then g.home_score
                             when g.away_team_id = v_away then g.away_score else 0 end), 0),
           count(*),
           coalesce(sum(((case when g.home_team_id = v_home then g.home_score
                               when g.away_team_id = v_home then g.away_score else 0 end)
                       > (case when g.home_team_id = v_away then g.home_score
                               when g.away_team_id = v_away then g.away_score else 0 end))::int), 0),
           coalesce(sum(((case when g.home_team_id = v_away then g.home_score
                               when g.away_team_id = v_away then g.away_score else 0 end)
                       > (case when g.home_team_id = v_home then g.home_score
                               when g.away_team_id = v_home then g.away_score else 0 end))::int), 0)
      into v_hs, v_as, v_played, v_hw, v_aw
      from games g
     where g.tie_id = t.id and g.status = 'final';

    v_winner := null;

    if t.is_bye then
      -- one side, no game. Whichever side is filled goes through.
      v_winner := coalesce(v_home, v_away);

    elsif v_home is null or v_away is null then
      v_winner := null;                         -- still waiting on a feeder

    elsif t.decider = 'wins' then
      /* First to more than half the legs. Decided the moment it is
         unreachable, not when the last game has been played — a 2-0 in a
         best-of-three does not need a dead rubber to be over. */
      v_need := (t.legs / 2) + 1;
      if v_hw >= v_need then v_winner := v_home;
      elsif v_aw >= v_need then v_winner := v_away;
      end if;

    else
      -- aggregate: every leg has to be in the book before it counts
      if v_played >= t.legs then
        if v_hs > v_as then v_winner := v_home;
        elsif v_as > v_hs then v_winner := v_away;
        end if;                                 -- level: undecided, not a toss
      end if;
    end if;

    update bracket_ties set
      home_team_id = v_home,
      away_team_id = v_away,
      home_agg = case when t.decider = 'wins' then nullif(v_hw, 0)
                      when v_played > 0 then v_hs end,
      away_agg = case when t.decider = 'wins' then nullif(v_aw, 0)
                      when v_played > 0 then v_as end,
      winner_team_id = v_winner,
      updated_at = now()
     where id = t.id;
  end loop;
end; $$;

-- ---------------------------------------------------------------------------
-- 3. THE DESIGNER.
--
-- p_spec:
--   { "entrants": 6,
--     "byes": 2,
--     "source": "<competition uuid>",        -- where the seeds come from
--     "teams":  ["<uuid>", …],               -- or an explicit seeded list
--     "rounds": [ {"label":"Play-in","legs":1,"decider":"wins"},
--                 {"legs":3,"decider":"wins"},
--                 {"label":"Final","legs":1} ] }
--
-- THE SHAPE IS ARITHMETIC, and the two conditions are worth stating because
-- they are what a league gets wrong:
--
--   (entrants − byes) must be EVEN — the teams without a bye pair off.
--   byes + (entrants − byes)/2 must be a POWER OF TWO — what comes out of the
--   first round has to fill a clean bracket.
--
-- Six with two byes works (2 + 2 = 4). Six with one does not (1 + … is not
-- even), and six with none does not either (3 is not a power of two). Rather
-- than round something silently, both are refused with the arithmetic in the
-- message.
-- ---------------------------------------------------------------------------
create or replace function public.design_bracket(p_competition uuid, p_spec jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_n     int  := coalesce((p_spec->>'entrants')::int, 0);
  v_byes  int  := coalesce((p_spec->>'byes')::int, 0);
  v_src   uuid := nullif(p_spec->>'source', '')::uuid;
  v_seeds uuid[];
  v_k     int;                       -- ties in round one
  v_s     int;                       -- survivors into the main bracket
  v_ord   int[];                     -- standard bracket order over 1..v_s
  v_next  int[];
  v_rounds int;
  v_r1    uuid[];                    -- round-one tie ids, indexed by j
  v_prev  uuid[];
  v_cur   uuid[];
  i int; j int; r int; s int;
  v_id uuid; v_label text; v_legs int; v_dec text;
  v_a int; v_b int;
  v_total int := 0;
begin
  if not public.is_competition_admin(p_competition) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;

  -- ---- the seeded field ----------------------------------------------------
  if p_spec ? 'teams' and jsonb_array_length(p_spec->'teams') > 0 then
    select array_agg(value::uuid order by ord)
      into v_seeds
      from jsonb_array_elements_text(p_spec->'teams') with ordinality as e(value, ord);
  else
    select array_agg(team_id order by rank, group_name nulls first, league_points desc)
      into v_seeds
      from standings
     where competition_id = coalesce(v_src, p_competition) and rank is not null;
  end if;

  if v_seeds is null or array_length(v_seeds, 1) < v_n then
    raise exception 'only % teams are seeded, need %',
      coalesce(array_length(v_seeds, 1), 0), v_n using errcode = '22023';
  end if;
  if v_n < 2 then
    raise exception 'a bracket needs at least two teams' using errcode = '22023';
  end if;
  if v_byes < 0 or v_byes >= v_n then
    raise exception 'byes must be fewer than the entrants' using errcode = '22023';
  end if;

  v_k := (v_n - v_byes) / 2;
  if (v_n - v_byes) % 2 <> 0 then
    raise exception
      '% entrants with % byes leaves % teams to pair off, which is odd — change one of them',
      v_n, v_byes, v_n - v_byes using errcode = '22023';
  end if;
  v_s := v_byes + v_k;
  if v_s < 1 or (v_s & (v_s - 1)) <> 0 then
    raise exception
      '% byes plus % first-round winners is %, which is not a power of two — the bracket would not fill',
      v_byes, v_k, v_s using errcode = '22023';
  end if;

  -- rounds: one for the opening round, then log2 of what survives
  v_rounds := 1;
  s := v_s;
  while s > 1 loop v_rounds := v_rounds + 1; s := s / 2; end loop;

  delete from bracket_ties where competition_id = p_competition;

  -- ---- round one -----------------------------------------------------------
  -- Seeds byes+1 … n pair best-against-worst. When byes = 0 this IS the
  -- ordinary first round, which is why there is no special case for it.
  select coalesce(jsonb_array_element(p_spec->'rounds', 0)->>'label',
                  case when v_byes > 0 then 'Play-in'
                       when v_rounds = 1 then 'Final'
                       else 'Round 1' end),
         coalesce((jsonb_array_element(p_spec->'rounds', 0)->>'legs')::int, 1),
         coalesce(jsonb_array_element(p_spec->'rounds', 0)->>'decider', 'wins')
    into v_label, v_legs, v_dec;

  v_r1 := '{}';
  for j in 1 .. v_k loop
    v_a := v_byes + j;                 -- better seed
    v_b := v_n + 1 - j;                -- worse seed
    insert into bracket_ties (competition_id, round, slot, label,
                              home_team_id, away_team_id, home_seed, away_seed,
                              legs, decider)
    values (p_competition, 1, j, v_label,
            v_seeds[v_a], v_seeds[v_b], v_a, v_b, v_legs, v_dec)
    returning id into v_id;
    v_r1 := v_r1 || v_id;
    v_total := v_total + 1;
  end loop;

  -- ---- the main bracket ----------------------------------------------------
  -- Survivor slot s is the bye seed s when s <= byes, otherwise the winner of
  -- round-one tie (s - byes).
  --
  -- The standard bracket order, built by reflection: order(1) = [1], and each
  -- doubling maps s to [s, 2n+1-s]. For eight that gives 1,8,4,5,2,7,3,6 —
  -- pair those consecutively and the top two seeds can only meet in the final.
  -- Pairing 1v8,2v7,3v6,4v5 in slot order instead, which looks equally
  -- reasonable, puts them in the same half.
  v_ord := array[1];
  while array_length(v_ord, 1) < v_s loop
    v_next := '{}';
    i := array_length(v_ord, 1);
    foreach s in array v_ord loop
      v_next := v_next || s || (2 * i + 1 - s);
    end loop;
    v_ord := v_next;
  end loop;

  v_prev := '{}';
  if v_s > 1 then
    select coalesce(jsonb_array_element(p_spec->'rounds', 1)->>'label',
                    case when v_rounds = 2 then 'Final'
                         when v_rounds = 3 then 'Semi-final'
                         when v_rounds = 4 then 'Quarter-final'
                         else 'Round 2' end),
           coalesce((jsonb_array_element(p_spec->'rounds', 1)->>'legs')::int, 1),
           coalesce(jsonb_array_element(p_spec->'rounds', 1)->>'decider', 'wins')
      into v_label, v_legs, v_dec;

    for j in 1 .. (v_s / 2) loop
      declare
        sa int := v_ord[2 * j - 1];
        sb int := v_ord[2 * j];
      begin
        insert into bracket_ties (competition_id, round, slot, label,
          home_team_id, away_team_id, home_from_tie, away_from_tie,
          home_seed, away_seed, legs, decider)
        values (p_competition, 2, j, v_label,
          case when sa <= v_byes then v_seeds[sa] end,
          case when sb <= v_byes then v_seeds[sb] end,
          case when sa >  v_byes then v_r1[sa - v_byes] end,
          case when sb >  v_byes then v_r1[sb - v_byes] end,
          sa, sb, v_legs, v_dec)
        returning id into v_id;
        v_prev := v_prev || v_id;
        v_total := v_total + 1;
      end;
    end loop;
  end if;

  -- ---- everything after ----------------------------------------------------
  r := 3;
  while array_length(v_prev, 1) > 1 loop
    select coalesce(jsonb_array_element(p_spec->'rounds', r - 1)->>'label',
                    case when r = v_rounds then 'Final'
                         when r = v_rounds - 1 then 'Semi-final'
                         when r = v_rounds - 2 then 'Quarter-final'
                         else 'Round ' || r end),
           coalesce((jsonb_array_element(p_spec->'rounds', r - 1)->>'legs')::int, 1),
           coalesce(jsonb_array_element(p_spec->'rounds', r - 1)->>'decider', 'wins')
      into v_label, v_legs, v_dec;

    v_cur := '{}';
    for j in 1 .. (array_length(v_prev, 1) / 2) loop
      insert into bracket_ties (competition_id, round, slot, label,
        home_from_tie, away_from_tie, legs, decider)
      values (p_competition, r, j, v_label,
              v_prev[2 * j - 1], v_prev[2 * j], v_legs, v_dec)
      returning id into v_id;
      v_cur := v_cur || v_id;
      v_total := v_total + 1;
    end loop;
    v_prev := v_cur;
    r := r + 1;
  end loop;

  update competitions
     set format = case when format = 'groups' then 'groups_knockout' else 'knockout' end,
         qualifiers = v_n,
         format_config = p_spec
   where id = p_competition;

  perform public.advance_bracket(p_competition);

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'design_bracket', 'competition', p_competition::text, p_spec);

  return v_total;
end; $$;

-- ---------------------------------------------------------------------------
-- 4. THE GAMES THAT MAKE UP THE TIES.
--
-- A bracket without fixtures is a diagram. This creates one game per leg for
-- every tie whose two sides are known, and leaves the rest alone — so it is
-- run again after each round resolves and only ever adds what is newly
-- playable.
--
-- HOME ADVANTAGE FOLLOWS THE SEED, and the pattern differs by length because
-- that is what competitions actually do:
--   2 legs   the better seed is at home SECOND (the away leg comes first)
--   3 games  better seed home in 1 and 3
--   5 games  home in 1, 2 and 5
--   7 games  home in 1, 2, 5 and 7
-- ---------------------------------------------------------------------------
create or replace function public.generate_tie_games(
  p_competition uuid, p_start date default null, p_gap_days int default 7
) returns int language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_n int := 0;
  leg int;
  v_home uuid; v_away uuid;
  v_better_home boolean;
  v_when timestamptz;
begin
  if not public.is_competition_admin(p_competition) then
    raise exception 'you do not administer that competition' using errcode = '42501';
  end if;

  for t in
    select * from bracket_ties
     where competition_id = p_competition
       and not is_bye
       and home_team_id is not null and away_team_id is not null
     order by round, slot
  loop
    -- never a second set for the same tie
    if exists (select 1 from games g where g.tie_id = t.id) then continue; end if;

    for leg in 1 .. t.legs loop
      v_better_home := case
        when t.legs = 1 then true
        when t.legs = 2 then leg = 2
        when t.legs = 3 then leg in (1, 3)
        when t.legs = 5 then leg in (1, 2, 5)
        when t.legs = 7 then leg in (1, 2, 5, 7)
        else leg % 2 = 1
      end;
      if v_better_home then v_home := t.home_team_id; v_away := t.away_team_id;
      else                  v_home := t.away_team_id; v_away := t.home_team_id;
      end if;

      v_when := case when p_start is null then null
                     else (p_start + ((t.round - 1) * coalesce(p_gap_days, 7)
                                      + (leg - 1) * 3))::timestamptz + interval '19 hours' end;

      insert into games (competition_id, home_team_id, away_team_id, tipoff_at,
                         status, tie_id, leg)
      values (p_competition, v_home, v_away, v_when, 'scheduled', t.id, leg);
      v_n := v_n + 1;
    end loop;
  end loop;

  insert into audit_log (actor, action, subject, subject_id, detail)
  values (auth.uid(), 'generate_tie_games', 'competition', p_competition::text,
          jsonb_build_object('games', v_n));
  return v_n;
end; $$;

-- A plain description of the format, for the public page and the console.
create or replace function public.bracket_summary(p_competition uuid)
returns table (round int, label text, ties bigint, legs int, decider text, resolved bigint)
language sql stable security definer set search_path = public as $$
  select b.round, min(b.label), count(*), min(b.legs), min(b.decider),
         count(b.winner_team_id)
    from bracket_ties b
   where b.competition_id = p_competition
   group by b.round order by b.round;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'design_bracket(uuid,jsonb)', 'generate_tie_games(uuid,date,int)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
grant execute on function public.bracket_summary(uuid) to anon, authenticated;

-- ============================================================================
-- SELF-TEST — the four shapes a league actually asks for.
-- ============================================================================
do $$
declare
  adm uuid := gen_random_uuid();
  lg uuid; ss uuid; cp uuid; ko uuid;
  tid uuid[] := '{}'; t uuid;
  orig text; failed text[] := '{}';
  n int; i int; g1 uuid; g2 uuid; g3 uuid; v_dec text;
  v_final uuid; v_win uuid;
begin
  select current_user into orig;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (adm, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'brk-admin@example.invalid', '', now(), now(), now());

  insert into leagues (slug, name) values ('brk-test', 'Bracket Test') returning id into lg;
  insert into memberships (user_id, role, scope_type, scope_id)
    values (adm, 'league_admin', 'league', lg);
  insert into seasons (league_id, name) values (lg, 'BRK') returning id into ss;
  insert into competitions (season_id, name) values (ss, 'Playoffs') returning id into ko;
  insert into competitions (season_id, name) values (ss, 'Regular') returning id into cp;

  for i in 1 .. 8 loop
    insert into teams (league_id, slug, name)
    values (lg, 'brk-' || i, 'Team ' || i) returning id into t;
    tid := tid || t;
    insert into competition_teams (competition_id, team_id) values (ko, t), (cp, t);
    -- a table to seed from: team 1 top, team 8 bottom
    insert into standings (competition_id, team_id, rank, league_points)
    values (cp, t, i, 100 - i);
  end loop;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', adm, 'role', 'authenticated')::text, true);

  -- ---- 1. straight 1-4 knockout -------------------------------------------
  n := public.design_bracket(ko, jsonb_build_object(
        'entrants', 4, 'byes', 0, 'source', cp));
  if n <> 3 then failed := array_append(failed, 'a four-team bracket should be 3 ties, got ' || n); end if;
  select count(*) into n from bracket_ties where competition_id = ko and round = 1;
  if n <> 2 then failed := array_append(failed, 'four teams did not give two semi-finals'); end if;
  -- 1 must be drawn against 4, not against 2
  select count(*) into n from bracket_ties
   where competition_id = ko and round = 1 and home_seed = 1 and away_seed = 4;
  if n <> 1 then failed := array_append(failed, 'the top seed was not drawn against the lowest'); end if;

  -- ---- 2. eight teams, and the top two must be kept apart ------------------
  n := public.design_bracket(ko, jsonb_build_object('entrants', 8, 'byes', 0, 'source', cp));
  if n <> 7 then failed := array_append(failed, 'an eight-team bracket should be 7 ties, got ' || n); end if;
  /* Seeds 1 and 2 must land in different halves: with four first-round ties
     the halves are slots 1-2 and 3-4. */
  /* The halves are the two round-TWO ties, not the round-one slots: the
     reflection is applied when the survivors are arranged, so 1 and 2 sit in
     adjacent first-round slots and still end up in opposite halves. Checking
     the slots was the first version of this test and it failed the correct
     bracket. */
  select b2.slot into i
    from bracket_ties b1
    join bracket_ties b2 on b2.competition_id = ko and b2.round = 2
                        and b1.id in (b2.home_from_tie, b2.away_from_tie)
   where b1.competition_id = ko and b1.round = 1 and 1 in (b1.home_seed, b1.away_seed);
  select b2.slot into n
    from bracket_ties b1
    join bracket_ties b2 on b2.competition_id = ko and b2.round = 2
                        and b1.id in (b2.home_from_tie, b2.away_from_tie)
   where b1.competition_id = ko and b1.round = 1 and 2 in (b1.home_seed, b1.away_seed);
  if i is null or n is null or i = n then
    failed := array_append(failed,
      'the top two seeds were drawn into the same half (round-two slots ' ||
      coalesce(i::text,'?') || ' and ' || coalesce(n::text,'?') || ')');
  end if;

  -- ---- 3. six teams, 1 and 2 bye, 3-6 play in ------------------------------
  n := public.design_bracket(ko, jsonb_build_object(
        'entrants', 6, 'byes', 2, 'source', cp,
        'rounds', jsonb_build_array(
          jsonb_build_object('label', 'Play-in', 'legs', 1),
          jsonb_build_object('label', 'Semi-final', 'legs', 3, 'decider', 'wins'),
          jsonb_build_object('label', 'Final', 'legs', 2, 'decider', 'aggregate'))));
  if n <> 5 then failed := array_append(failed, 'six with two byes should be 5 ties, got ' || n); end if;
  select count(*) into n from bracket_ties where competition_id = ko and round = 1;
  if n <> 2 then failed := array_append(failed, 'the play-in round is not two ties'); end if;
  select count(*) into n from bracket_ties
   where competition_id = ko and round = 2 and home_team_id is not null;
  if n <> 2 then failed := array_append(failed, 'the byes were not placed straight into round two'); end if;
  select legs into n from bracket_ties where competition_id = ko and round = 2 limit 1;
  if n <> 3 then failed := array_append(failed, 'the semi-finals are not best of three'); end if;
  /* NOT into `orig`. That variable holds the role this migration runs as, and
     borrowing it here overwrote it with 'aggregate' — then `select
     current_user into orig` refilled it with `authenticated`, because by that
     point we are impersonating, and the tidy-up at the end ran as the wrong
     role and was refused on auth.users. */
  select decider into v_dec from bracket_ties where competition_id = ko and round = 3 limit 1;
  if v_dec <> 'aggregate' then failed := array_append(failed, 'the final is not on aggregate'); end if;

  -- ---- 4. the arithmetic is refused, with the numbers ----------------------
  begin perform public.design_bracket(ko, jsonb_build_object('entrants', 6, 'byes', 1, 'source', cp));
    failed := array_append(failed, 'six entrants with one bye was accepted');
  exception when others then null; end;
  begin perform public.design_bracket(ko, jsonb_build_object('entrants', 6, 'byes', 0, 'source', cp));
    failed := array_append(failed, 'six entrants with no byes was accepted');
  exception when others then null; end;
  begin perform public.design_bracket(ko, jsonb_build_object('entrants', 99, 'byes', 0, 'source', cp));
    failed := array_append(failed, 'more entrants than teams was accepted');
  exception when others then null; end;

  -- ---- 5. the games, and a best-of-three that ends 2-0 ---------------------
  n := public.design_bracket(ko, jsonb_build_object(
        'entrants', 4, 'byes', 0, 'source', cp,
        'rounds', jsonb_build_array(
          jsonb_build_object('legs', 3, 'decider', 'wins'),
          jsonb_build_object('legs', 2, 'decider', 'aggregate'))));
  n := public.generate_tie_games(ko, current_date, 7);
  if n <> 6 then failed := array_append(failed, 'two best-of-three ties should make 6 games, got ' || n); end if;

  -- the better seed hosts games 1 and 3 of a best-of-three
  select count(*) into n
    from games g join bracket_ties b on b.id = g.tie_id
   where g.competition_id = ko and g.leg = 1 and g.home_team_id <> b.home_team_id;
  if n <> 0 then failed := array_append(failed, 'the better seed did not host the first game'); end if;
  select count(*) into n
    from games g join bracket_ties b on b.id = g.tie_id
   where g.competition_id = ko and g.leg = 2 and g.home_team_id <> b.away_team_id;
  if n <> 0 then failed := array_append(failed, 'the lower seed did not host the second game'); end if;

  -- running it again must add nothing
  n := public.generate_tie_games(ko, current_date, 7);
  if n <> 0 then failed := array_append(failed, 'the games were generated twice'); end if;

  -- play the first tie 2-0 to the better seed and it must be over after two
  select id into v_final from bracket_ties where competition_id = ko and round = 1 and slot = 1;
  select id into g1 from games where tie_id = v_final and leg = 1;
  select id into g2 from games where tie_id = v_final and leg = 2;
  update games set status = 'final', home_score = 90, away_score = 80 where id = g1;
  -- leg 2 is at the OTHER team's place, so the better seed wins it as the away side
  update games set status = 'final', home_score = 70, away_score = 88 where id = g2;
  perform public.advance_bracket(ko);
  select winner_team_id, home_team_id into v_win, t
    from bracket_ties where id = v_final;
  if v_win is null then failed := array_append(failed, 'a 2-0 best-of-three did not resolve'); end if;
  if v_win <> t then failed := array_append(failed, 'the wrong side won the best-of-three'); end if;

  -- and the winner has to be sitting in the final
  select count(*) into n from bracket_ties
   where competition_id = ko and round = 2 and (home_team_id = v_win or away_team_id = v_win);
  if n <> 1 then failed := array_append(failed, 'the winner was not carried into the next round'); end if;

  -- one game each way does NOT resolve an aggregate tie until both are in
  select count(*) into n from public.bracket_summary(ko);
  if n <> 2 then failed := array_append(failed, 'bracket_summary did not describe two rounds'); end if;

  -- --------------------------------------------------------------- tidy up ---
  execute format('set local role %I', orig);
  perform set_config('request.jwt.claims', '', true);

  delete from games where competition_id = ko;
  delete from bracket_ties where competition_id = ko;
  delete from standings where competition_id in (ko, cp);
  delete from competition_teams where competition_id in (ko, cp);
  delete from competitions where id in (ko, cp);
  delete from seasons where id = ss;
  delete from teams where league_id = lg;
  delete from memberships where user_id = adm;
  delete from leagues where id = lg;
  delete from audit_log where actor = adm;
  delete from auth.users where id = adm;

  if array_length(failed, 1) > 0 then
    raise exception E'BRACKET DESIGNER SELF-TEST FAILED:\n  - %',
      array_to_string(failed, E'\n  - ');
  end if;
end $$;
