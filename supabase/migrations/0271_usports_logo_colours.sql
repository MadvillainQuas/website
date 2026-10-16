-- ============================================================================
-- 0271  U SPORTS IN ITS LOGO'S TWO COLOURS
--
-- Louie, 2026-10-16: "make sure the hub/sidebar is colour matched to the logo".
-- The U SPORTS logo is black with a red maple leaf. Reading it (0122) found the
-- black and, the leaf being small, gave the second colour as a grey derived from
-- the black (#737373), so the system's hub, its conferences' pages and the
-- sidebar beside them wore black and grey. The second colour is the leaf's red,
-- sampled from the logo as stored (#ff3e2d).
--
-- 'manual' (0122: picked by hand, never overwritten): a later read of the same
-- logo by the console or the team_colours.py sweep would put the grey back.
-- teamcolour.js league() paints 'logo' and 'manual' alike.
-- ============================================================================

update public.leagues
   set colour_a = '#000000', colour_b = '#ff3e2d', colour_source = 'manual'
 where slug = 'u-sports';
