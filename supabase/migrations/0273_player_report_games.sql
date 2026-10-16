-- ============================================================================
-- 0273  A PLAYER'S REPORT, SENT NOW, OF THE GAMES CHOSEN
--
-- Louie, 2026-10-16: "give the option to select which games to include if 'send now' is selected for player reports".
--
--   report_mail_players.send_now_games   the games ticked in the reports manager (its Players tab) when "send now" is
--                                        pressed: the mailer draws the report of those games alone (p/?rpgames=), in place
--                                        of the week of the player's latest game, and clears it with send_now_at. Null: the
--                                        week, as before. At most twelve.
--
-- The table is platform administrators' only (0272), and so is this column: no new grant or policy is needed.
-- ============================================================================

alter table public.report_mail_players add column if not exists send_now_games uuid[]
  check (send_now_games is null or cardinality(send_now_games) between 1 and 12);

notify pgrst, 'reload schema';
