-- ============================================================================
-- 0274  A PLAYER'S POTENTIAL MATCH-UPS, WITH THEIR REPORT
--
-- Louie, 2026-10-16: "Can these reports (if enabled/ticked on the player report manager) also send truncated 'potential
-- match-up' reports that show all of the potential match-ups for that player (gauged off of the opponents they're facing
-- in the next week plus smart matching to position/one position up) in 1 PDF ... selectable in the send now if clicked".
--
--   report_mail_players.send_matchups       the reports manager's tick: with the Monday email, one more PDF - every player
--                                           of every club they play that week whom they could be matched up onto
--                                           (epinoia/matchup.js), each a cover, the shot chart, left v right and connections
--   report_mail_players.send_now_matchups   "send now"'s upcoming games ticked for it (at most eight): the match-ups of those
--                                           games' opponents; cleared with send_now_at
--   report_mail_players.send_now_report     false: "send now" sends the match-ups alone (no player report ticked); null or
--                                           true: the report as before; cleared with send_now_at
--
-- The table is platform administrators' only (0272), and so are these columns: no new grant or policy is needed.
-- ============================================================================

alter table public.report_mail_players add column if not exists send_matchups boolean not null default false;
alter table public.report_mail_players add column if not exists send_now_matchups uuid[]
  check (send_now_matchups is null or cardinality(send_now_matchups) between 1 and 8);
alter table public.report_mail_players add column if not exists send_now_report boolean;

notify pgrst, 'reload schema';
