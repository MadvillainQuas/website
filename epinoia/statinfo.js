'use strict';
/* ============================================================================
   STAT EXPLAINERS (epinoia/statinfo.js) - one plain-English entry per statistic the site ranks.

     EpinoiaStatInfo.info(key, kind)  -> { title, what, formula, read, low } | null
         kind 'team' picks the club's reading where it differs from the player's (ast_pct, ppg, ...)
     EpinoiaStatInfo.groups           -> [{ key, title, keys: [...] }] the MAIN stats of the League percentile
                                         section, grouped the way the profile groups them (the '?' panel)
     EpinoiaStatInfo.TEAM_KEYS        -> the club page's statistics, in the order it lists them

   low: true means a smaller number is the better performance (the same list as BAR_LOW in p/player.js,
   which a test keeps in step). Used by the click-through popup (statpop.js) and the help panel.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStatInfo = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

/* e(title, what, formula, read, low, teamOverride) */
const e = (title, what, formula, read, low, team) => ({ title, what, formula, read, low: !!low, team: team || null });
const DIFF = 'Team stat with them on the floor minus the same stat with them off it. ';

const INFO = {
  /* ---- scoring ---- */
  ppg: e('Points per game', 'The points they score in an average game.', 'points ÷ games played',
    'More is better. It rewards minutes and role as well as skill, so read it beside usage and TS%.', false,
    { title: 'Points per game', what: 'The points the club scores in an average game.', read: 'More is better. Read it with pace: a fast club scores more without being better.' }),
  ts: e('True shooting %', 'How efficiently they score, counting twos, threes and free throws together.', 'points ÷ (2 × (FGA + 0.44 × FTA))',
    'Higher is better. Around 55% is a typical player; 60% and up is excellent.',
    false, { what: 'How efficiently the club scores, counting twos, threes and free throws together.', read: 'Higher is better. Around 55% is typical for a club.' }),
  efg: e('Effective FG %', 'Field-goal accuracy with a three counted as worth one and a half twos.', '(FGM + 0.5 × 3PM) ÷ FGA',
    'Higher is better. Around 50% is typical; free throws are left out (TS% includes them).'),
  usg: e('Usage', 'The share of their team’s possessions they end with a shot, a free-throw trip or a turnover while they are on the floor.', '(their FGA + 0.44 × FTA + TOV) ÷ team possessions while on court',
    'Not good or bad in itself: it says how much of the offence runs through them. About 20% is an average starter, 28%+ is a lead scorer. Ranked high-is-more.'),
  helio: e('Heliocentrism', 'How much of a unit’s offence runs through one player. Each player’s usage (their FGA + 0.44 × FTA + TOV over the plays the team used while they were on) is turned into shares of each five they played in; the Herfindahl index of those shares, averaged over the fives by plays used, says how many equal hands the load is really shared between.',
    '100 × (5 − 1 ÷ H) ÷ 4, H = Σ (usage share)², plays-weighted over the fives',
    'Not good or bad: a style. 0 is five equal hands; 100 is one man using every play. A 40% creator with four at 15% is 25, a 50% one 45; a typical five is about 10–15. Needs 10 used plays.'),
  ftr: e('Free-throw rate', 'How often they get to the line compared with how often they shoot.', 'FTA ÷ FGA × 100',
    'Higher is better: it is drawing contact. About 20–30 is typical.'),
  ev_ast_pts_sh: e('Assisted share of points', 'How much of what they scored came off somebody’s pass.', 'points from assisted baskets ÷ points',
    'Ranked the other way up: fewer assisted means they create their own scoring, the rarer skill, so the lowest share takes the top percentile.', true,
    { read: 'For a club, more assisted baskets is ball movement, so higher is better.', low: false }),
  contrib_pg: e('Total points contribution', 'The points they scored plus the points scored off their assists, per game.', '(points + points from their assists) ÷ games',
    'More is better. Total-points-based, so it is a volume (it rewards minutes) rather than a rate.'),

  /* ---- shooting ---- */
  rim_pct: e('Rim %', 'Accuracy on shots at the rim.', 'rim makes ÷ rim attempts',
    'Higher is better. Read it with rim attempts: 60% on one attempt a night means little. Around 60% is typical.'),
  rim_a100: e('Rim attempts / 100', 'How often they go to the rim: attempts per 100 possessions they play.', 'rim attempts ÷ possessions on court × 100',
    'More means a bigger part of their game is at the rim. It is a volume, not a quality.'),
  ev_rim_astp: e('Rim assisted %', 'Of the rim shots they MADE, how many came off a pass. Only makes can be assisted.', 'assisted rim makes ÷ rim makes',
    'Ranked the other way up: fewer assisted means they create their own finishes.', true),
  team_spacing: e('Team spacing', 'How stretched the floor is around them: what their teammates’ threes are worth per 100 possessions while they are on the floor (their own threes left out).', '3 × teammates’ 3PM ÷ team possessions on court × 100',
    'Higher means more room to work in. It needs 20 possessions and ten teammate three-point attempts.'),
  mid_pct: e('Mid-range %', 'Accuracy on mid-range shots.', 'mid-range makes ÷ attempts', 'Higher is better; read it with the attempts. 35–42% is typical.'),
  mid_a100: e('Mid-range attempts / 100', 'How often they shoot from mid-range, per 100 possessions.', 'mid attempts ÷ possessions on court × 100', 'A volume, not a quality: how much of their game is here.'),
  ev_mid_astp: e('Mid-range assisted %', 'Of their mid-range makes, how many came off a pass.', 'assisted mid makes ÷ mid makes', 'Ranked the other way up: fewer assisted means they create their own.', true),
  p3_pct: e('3-point %', 'Accuracy from three.', '3PM ÷ 3PA', 'Higher is better; read it with volume. About 33–36% is typical, 40% is elite.'),
  p3_a100: e('3P attempts / 100', 'How often they shoot threes, per 100 possessions.', '3PA ÷ possessions on court × 100', 'A volume, not a quality: how much of their game is beyond the arc.'),
  ev_p3_astp: e('3P assisted %', 'Of their threes made, how many came off a pass.', 'assisted 3PM ÷ 3PM', 'Ranked the other way up: fewer assisted means they make threes they create themselves.', true),
  ft_pct: e('Free-throw %', 'Accuracy from the line.', 'FTM ÷ FTA', 'Higher is better. About 70–75% is typical; 85%+ is a very good shooter.',
    false, { read: 'Higher is better. About 70–75% is typical for a club.' }),
  ft_a100: e('FT attempts / 100', 'How often they are at the line, per 100 possessions.', 'FTA ÷ possessions on court × 100', 'A volume: how often they draw fouls or is fouled.'),

  /* ---- the simple view: the box score per 75 possessions ---- */
  fg_pct: e('Field-goal %', 'Accuracy on every shot from the floor, twos and threes together.', 'FGM ÷ FGA',
    'Higher is better, but a big who only dunks will beat a shooter here: read it beside eFG% or TS%. Around 45% is typical.'),
  pts_p75: e('Points / 75', 'The points they score per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'points × 75 ÷ team possessions while on court',
    'More is better. About 15 is a typical rotation player, 25+ is a lead scorer.'),
  fgm_p75: e('Field goals made / 75', 'The baskets they make from the floor per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'FGM × 75 ÷ team possessions while on court',
    'More is better: scoring from the floor, at their rate rather than their minutes.'),
  fga_p75: e('Field-goal attempts / 75', 'The shots they take from the floor per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'FGA × 75 ÷ team possessions while on court',
    'A volume, not a quality: how much of the shooting they take on. Read it with FG%.'),
  p3m_p75: e('Threes made / 75', 'The threes they make per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', '3PM × 75 ÷ team possessions while on court',
    'More is better: the spacing they give, at their rate rather than their minutes.'),
  p3a_p75: e('3P attempts / 75', 'The threes they take per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', '3PA × 75 ÷ team possessions while on court',
    'A volume, not a quality: how much of their game is beyond the arc. Read it with 3P%.'),
  ftm_p75: e('Free throws made / 75', 'The free throws they make per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'FTM × 75 ÷ team possessions while on court',
    'More is better: points from the line, which is drawing contact and making them.'),
  fta_p75: e('Free-throw attempts / 75', 'How often they are at the line, per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'FTA × 75 ÷ team possessions while on court',
    'A volume: how often they draw fouls or is fouled. Read it with FT%.'),
  reb_p75: e('Rebounds / 75', 'The rebounds they collect per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', '(OREB + DREB) × 75 ÷ team possessions while on court',
    'More is better; it follows position as well as effort (see rebound %).'),
  oreb_p75: e('Offensive rebounds / 75', 'The offensive rebounds they collect per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'OREB × 75 ÷ team possessions while on court',
    'More is better: second chances they win for their team.'),
  dreb_p75: e('Defensive rebounds / 75', 'The defensive rebounds they collect per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'DREB × 75 ÷ team possessions while on court',
    'More is better: the opponents’ possessions they end.'),
  ast_p75: e('Assists / 75', 'The assists they record per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'AST × 75 ÷ team possessions while on court',
    'More is better; it follows role as well as skill (see assist %).'),
  tov_p75: e('Turnovers / 75', 'The turnovers they commit per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'TOV × 75 ÷ team possessions while on court',
    'Lower is better, but a player with the ball in their hands turns it over more: read it beside usage and assists.', true),
  stl_p75: e('Steals / 75', 'The steals they record per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'STL × 75 ÷ team possessions while on court',
    'More is better: possessions they take away.'),
  blk_p75: e('Blocks / 75', 'The shots they block per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'BLK × 75 ÷ team possessions while on court',
    'More is better; it follows position (see block %).'),
  pf_p75: e('Personal fouls / 75', 'The fouls they commit per 75 possessions. Per 75 of their team’s possessions while they are on the floor (index_9’s “per 75 lineup possessions”), so heavy and light minutes, and fast and slow teams, are read at the same rate. Left blank under 20 possessions on the floor.', 'PF × 75 ÷ team possessions while on court',
    'Lower is better: fouls send the other side to the line and them towards the bench.', true),

  /* ---- playmaking ---- */
  ast_pct: e('Assist %', 'The share of their teammates’ baskets they assist while they are on the floor.', 'AST ÷ (team FGM − their FGM) while on court',
    'Higher is better. Guards run 20%+, big men under 10%.',
    false, { what: 'The share of the club’s baskets that are assisted.', formula: 'assists ÷ field goals made', read: 'Higher is more passing and ball movement. About 55–65% is typical.' }),
  au: e('Assists / usage', 'How many assists they produce for each point of usage they take: are they a passer or a scorer with the ball.', 'assist % ÷ usage %', 'Higher means they create for others more than they use possessions themselves.'),
  ast_to: e('Assist to turnover', 'Assists for every turnover.', 'assists ÷ turnovers', 'Higher is better. 2.0 is good; 3.0+ is excellent for a ball handler.'),
  tov_pct: e('Turnover %', 'How often their possessions end in a turnover.', 'TOV ÷ (their possessions used)', 'Lower is better, so the top percentile turns it over least. About 12–16% is typical.', true,
    { what: 'How often the club’s possessions end in a turnover.', formula: 'TOV ÷ (FGA + 0.44 × FTA + TOV)', read: 'Lower is better. About 13–16% is typical.' }),

  /* ---- rebounding ---- */
  oreb_pct: e('Offensive rebound %', 'The share of available offensive rebounds they grab while they are on the floor.', 'OREB ÷ (team OREB + opponent DREB) while on court', 'Higher is better. Big men reach 10%+, guards 2–3%.'),
  dreb_pct: e('Defensive rebound %', 'The share of available defensive rebounds they grab while they are on the floor.', 'DREB ÷ (team DREB + opponent OREB) while on court', 'Higher is better. Big men reach 20%+, guards 8–12%.'),
  trb_pct: e('Total rebound %', 'The share of every missed shot they rebound while they are on the floor.', 'REB ÷ all rebounds available while on court', 'Higher is better. About 10% is typical; 15%+ is a strong rebounder.'),
  orb_tm_pct: e('Share of team offensive rebounds', 'How much of their team’s offensive rebounding they do.', 'their OREB ÷ team OREB', 'Higher means they are the club’s offensive glass. Size and role matter: read it beside OREB%.'),
  orb_self_pct: e('Own-miss rebounds %', 'Of the offensive rebounds they take, how many are off their own missed shots (putbacks after their own miss).', 'own-miss OREB ÷ their OREB', 'A style stat: high means they follow their own shot, low means they crash on teammates’ misses.'),

  /* ---- defence ---- */
  stl_pct: e('Steal %', 'How often they steal the ball, per opposing possession while they are on the floor.', 'STL ÷ opponent possessions on court × 100', 'Higher is better. About 1.5% is typical; 2.5%+ is a ball hawk.'),
  blk_pct: e('Block %', 'How many opposing two-point attempts they block while they are on the floor.', 'BLK ÷ opponent 2PA on court × 100', 'Higher is better. Rim protectors reach 5%+, guards under 1%.'),
  pf30: e('Fouls / 30 min', 'Personal fouls they commit per 30 minutes on the floor. Left blank under 20 minutes played.', 'fouls ÷ minutes × 30',
    'Fewer is better, so the top percentile fouls least. 2–3 is typical; 4+ costs them minutes.', true),
  def_rim_fg_pm: e('Rim FG% allowed ±', 'How the opponents’ rim shooting changes when they are the nearest defender, against what those shots normally go in at.', 'opponent rim FG% against them − league rim FG%',
    'Lower (negative) is better: shots they contest go in less often than usual.', true),
  def_rim_vol_pm: e('Rim shots faced ±', 'How many rim shots opponents take against their defence compared with normal.', 'rim attempts faced per 100 − league rate',
    'Lower is better: a defence that deters shots at the rim.', true),

  /* ---- impact: on/off ---- */
  diff_net: e('On/off net rating', 'How much better (or worse) the team’s point margin per 100 possessions is with them on the floor than off it.', 'net rating on − net rating off',
    'Higher is better. +5 is a real impact; noisy over a small sample and it depends on who they play with.'),
  diff_ortg: e('On/off offensive rating', 'How the team’s scoring per 100 possessions changes with them on the floor.', 'ORTG on − ORTG off', 'Higher is better: the offence is stronger with them on.'),
  diff_drtg: e('On/off defensive rating', 'How the points the team allows per 100 possessions change with them on the floor.', 'DRTG on − DRTG off',
    'Lower is better: negative means the defence concedes less with them on.', true),

  /* ---- impact: box plus/minus ---- */
  bpm: e('Box plus/minus', 'An estimate, from their box score, of how many points per 100 possessions they add over an average player.', 'regression on the box score, scaled to team rating',
    'Higher is better. 0 is average, +2 a good starter, +5 all-star level.'),
  obpm: e('Offensive BPM', 'The offensive half of box plus/minus.', 'BPM built from scoring, passing and offensive rebounding', 'Higher is better; 0 is average.'),
  dbpm: e('Defensive BPM', 'The defensive half of box plus/minus.', 'BPM built from steals, blocks, rebounds and fouls', 'Higher is better; 0 is average. Box scores see defence poorly, so treat it as rough.'),
  vorp: e('Value over replacement', 'Box plus/minus turned into a season total: how much they add over a replacement-level player, so minutes count as well as level.', '(BPM − replacement) × share of possessions played',
    'Higher is better. It is a volume: a good player who plays little scores small.'),

  /* ---- impact: four factors, on minus off ---- */
  diff_efg: e('Offence eFG% ±', 'How the team’s effective FG% changes with them on the floor.', DIFF.trim() + ' (eFG%)', 'Higher is better: the team shoots better with them on.'),
  diff_tov: e('Offence turnover% ±', 'How the team’s turnover rate changes with them on the floor.', DIFF.trim() + ' (TOV%)', 'Lower is better: fewer turnovers with them on.', true),
  diff_oreb: e('Offence rebound% ±', 'How the team’s offensive-rebound rate changes with them on the floor.', DIFF.trim() + ' (OREB%)', 'Higher is better: more second chances with them on.'),
  diff_ftr: e('Offence FT rate ±', 'How often the team gets to the line with them on the floor compared with off.', DIFF.trim() + ' (FTA ÷ FGA)', 'Higher is better.'),
  diff_vs_efg: e('Opp eFG% ±', 'How the opponents’ effective FG% changes with them on the floor.', 'opponent eFG% on − off', 'Lower is better: opponents shoot worse with them on.', true),
  diff_vs_tov: e('Opp turnover% ±', 'How often opponents turn it over with them on the floor compared with off.', 'opponent TOV% on − off', 'Higher is better: they force more turnovers.'),
  diff_vs_oreb: e('Opp rebound% ±', 'How the opponents’ offensive-rebound rate changes with them on the floor.', 'opponent OREB% on − off', 'Lower is better: opponents get fewer second chances.', true),
  diff_vs_ftr: e('Opp FT rate ±', 'How often opponents get to the line with them on the floor compared with off.', 'opponent FTA ÷ FGA on − off', 'Lower is better: opponents earn fewer free throws.', true),

  /* ---- profile tiles ---- */
  rpg: e('Rebounds per game', 'The rebounds they collect in an average game.', 'rebounds \u00f7 games', 'More is better; it follows minutes and position as well as skill (see rebound %).'),
  apg: e('Assists per game', 'The assists they record in an average game.', 'assists \u00f7 games', 'More is better; it follows minutes and role (see assist %).'),
  mpg: e('Minutes per game', 'How long they play in an average game.', 'minutes \u00f7 games', 'Neither good nor bad: it is the coach\u2019s trust and their role.'),

  /* ---- the club page ---- */
  papg: e('Points allowed per game', 'The points the club concedes in an average game.', 'points against ÷ games', 'Lower is better. Fast clubs concede more without being worse; see defensive rating.', true),
  diffpg: e('Point differential', 'The average winning (or losing) margin.', 'points for − points against, per game', 'Higher is better. +5 is a contender.'),
  ortg: e('Offensive rating', 'Points scored per 100 possessions.', 'points ÷ possessions × 100', 'Higher is better. It removes pace, so fast and slow clubs compare fairly.'),
  drtg: e('Defensive rating', 'Points allowed per 100 possessions.', 'opponent points ÷ opponent possessions × 100', 'Lower is better.', true),
  net: e('Net rating', 'Points scored minus points allowed per 100 possessions.', 'ORTG − DRTG', 'Higher is better. The best single number for a club’s strength.'),
  pace: e('Pace', 'How fast the club plays: possessions per 40 minutes, both sides averaged.', '(own + opponent possessions) ÷ 2 per 40 minutes', 'Neither good nor bad: it is a style.'),
  /* the club page's season line (t/seasonline.js) */
  poss_time: e('Average possession', 'How long the club keeps the ball: game-clock seconds from winning it to the possession’s last action, from its own game logs (the WOWY page’s shot clock).', 'timed seconds ÷ timed possessions', 'Neither good nor bad: a style. Shorter is quicker offence; the opponents’ figure beside it is how long the defence keeps them out.'),
  ppp: e('Points per possession', 'Points scored per possession.', 'points ÷ possessions (ORTG ÷ 100)', 'Higher is better. About 1.00 to 1.10 is typical.'),
  morey: e('MOREY%', 'The share of the club’s shots taken at the rim or from three, the two most efficient places to shoot from.', '(rim FGA + 3PA) ÷ FGA', 'A style: higher is a more modern shot diet. Only where a league’s box score splits the twos by zone.'),
  vs_start: e('Against the starters', 'The club’s net rating against the other side’s starters, with its ORTG and DRTG beside it. By default (regular starters): the minutes the other side had 4+ of its regular starters on (players with N games started or more, set on the card), or 4+ of that game’s starting five. Basic: all five of that game’s starters on.', 'NET over those minutes (lineupevents.js)', 'Higher is better: how it holds up against the other side’s best players.'),
  vs_bench: e('Against the bench', 'The club’s net rating against the other side’s bench. By default every minute that is not against the starters; basic: the minutes the other side had two of that game’s starters on, or fewer.', 'NET over those minutes (lineupevents.js)', 'Higher is better: whether it beats the second units.'),
  bench_min_pct: e('Bench minutes %', 'The share of the club’s minutes played by those who did not start.', 'non-starters’ minutes ÷ all minutes, over the games with their starters on record', 'A style: high is a deep rotation, low leans on the starting five.'),
  reb_pg: e('Rebounds per game', 'Rebounds the club collects in an average game.', 'rebounds ÷ games', 'More is better, though it also follows how many misses there were.'),
  ast_pg: e('Assists per game', 'Assists the club records in an average game.', 'assists ÷ games', 'More is better: ball movement.'),
  stl_pg: e('Steals per game', 'Steals per game.', 'steals ÷ games', 'More is better.'),
  blk_pg: e('Blocks per game', 'Blocks per game.', 'blocks ÷ games', 'More is better.'),
  paint_pg: e('Paint points per game', 'Points scored in the paint per game.', 'paint points ÷ games', 'More means more inside scoring.'),
  fast_pg: e('Fast-break points per game', 'Points scored in transition per game.', 'fast-break points ÷ games', 'More is a quicker, more transition-based offence.'),
  second_chance_pg: e('Second-chance points per game', 'Points scored after the club’s own offensive rebounds.', 'second-chance points ÷ games', 'More is better.'),
  pts_off_to_pg: e('Points off turnovers per game', 'Points scored right after forcing a turnover.', 'points off turnovers ÷ games', 'More is better.'),
  bench_pg: e('Bench points per game', 'Points scored by players who did not start.', 'bench points ÷ games', 'More means a productive second unit.'),
  ff_efg: e('Own eFG%', 'The club’s effective field-goal percentage.', '(FGM + 0.5 × 3PM) ÷ FGA', 'Higher is better. The biggest of the four factors.'),
  ff_tov: e('Own turnover%', 'How often the club’s possessions end in a turnover.', 'TOV ÷ (FGA + 0.44 × FTA + TOV)', 'Lower is better.', true),
  ff_oreb: e('Own offensive rebound%', 'The share of the club’s misses it rebounds.', 'OREB ÷ (OREB + opponent DREB)', 'Higher is better.'),
  ff_ftr: e('Own FT rate', 'How often the club gets to the line.', 'FTA ÷ FGA', 'Higher is better.'),
  dff_efg: e('Allowed eFG%', 'The effective FG% opponents shoot against the club.', 'opponent (FGM + 0.5 × 3PM) ÷ FGA', 'Lower is better.', true),
  dff_tov: e('Forced turnover%', 'How often opponents’ possessions end in a turnover.', 'opponent TOV ÷ (FGA + 0.44 × FTA + TOV)', 'Higher is better: the defence takes it away.'),
  dff_oreb: e('Allowed offensive rebound%', 'The share of opponents’ misses they rebound.', 'opponent OREB ÷ (OREB + own DREB)', 'Lower is better.', true),
  dff_ftr: e('Allowed FT rate', 'How often opponents get to the line.', 'opponent FTA ÷ FGA', 'Lower is better.', true),
  /* rebounds by where the miss came from (the club page's "what became of every shot attempt", and the team table's
     defence + rebounding): ORB% and DRB% as the four factors count them, of the misses somebody rebounded */
  rb_rim_orb: e('ORB% on own misses at the rim', 'Of the club’s own misses at the rim that somebody rebounded, the share it got back.', 'own OREB after a miss at the rim ÷ (own OREB + opponents’ DREB) after one', 'Higher is better: more second chances.'),
  rb_mid_orb: e('ORB% on own mid-range misses', 'Of the club’s own mid-range misses that somebody rebounded, the share it got back.', 'own OREB after a mid-range miss ÷ (own OREB + opponents’ DREB) after one', 'Higher is better: more second chances.'),
  rb_three_orb: e('ORB% on own missed threes', 'Of the club’s own missed threes that somebody rebounded, the share it got back.', 'own OREB after a missed three ÷ (own OREB + opponents’ DREB) after one', 'Higher is better: more second chances.'),
  rb_all_orb: e('ORB% on every own miss', 'Of all the club’s own misses that somebody rebounded, the share it got back.', 'own OREB after a miss ÷ (own OREB + opponents’ DREB) after one', 'Higher is better: more second chances.'),
  rb_rim_drb: e('DRB% on opponents’ misses at the rim', 'Of the opponents’ misses at the rim that somebody rebounded, the share the club took.', 'own DREB after an opponent’s miss at the rim ÷ (own DREB + opponents’ OREB) after one', 'Higher is better: the possession ends.'),
  rb_mid_drb: e('DRB% on opponents’ mid-range misses', 'Of the opponents’ mid-range misses that somebody rebounded, the share the club took.', 'own DREB after an opponent’s mid-range miss ÷ (own DREB + opponents’ OREB) after one', 'Higher is better: the possession ends.'),
  rb_three_drb: e('DRB% on opponents’ missed threes', 'Of the opponents’ missed threes that somebody rebounded, the share the club took.', 'own DREB after an opponent’s missed three ÷ (own DREB + opponents’ OREB) after one', 'Higher is better: the possession ends.'),
  rb_all_drb: e('DRB% on every opponents’ miss', 'Of all the opponents’ misses that somebody rebounded, the share the club took.', 'own DREB after an opponent’s miss ÷ (own DREB + opponents’ OREB) after one', 'Higher is better: the possession ends.')
};

const TEAM_KEYS = ['ortg', 'drtg', 'net', 'pace', 'poss_time', 'ppp', 'ts', 'ft_pct', 'morey', 'ast_pct', 'helio', 'bench_min_pct', 'vs_start', 'vs_bench',
  'ff_efg', 'ff_tov', 'ff_oreb', 'ff_ftr', 'dff_efg', 'dff_tov', 'dff_oreb', 'dff_ftr'];

/* the MAIN stats of each League percentile card: what the '?' panel lists */
const GROUPS = [
  { key: 'scoring', title: 'scoring', keys: ['ppg', 'ts', 'efg', 'usg', 'ftr', 'ev_ast_pts_sh', 'contrib_pg'] },
  { key: 'shooting', title: 'shooting', keys: ['rim_pct', 'mid_pct', 'p3_pct', 'ft_pct', 'team_spacing'] },
  { key: 'playmaking', title: 'playmaking', keys: ['ast_pct', 'au', 'ast_to', 'tov_pct'] },
  { key: 'rebounding', title: 'rebounding', keys: ['oreb_pct', 'dreb_pct', 'trb_pct', 'orb_tm_pct', 'orb_self_pct'] },
  { key: 'defence', title: 'defence', keys: ['stl_pct', 'blk_pct', 'pf30', 'def_rim_fg_pm', 'def_rim_vol_pm'] },
  { key: 'impact', title: 'impact', keys: ['diff_net', 'diff_ortg', 'diff_drtg', 'bpm', 'obpm', 'dbpm', 'vorp'] }
];
const TEAM_GROUPS = [
  { key: 'ratings', title: 'ratings', keys: ['ortg', 'drtg', 'net'] },
  { key: 'tempo', title: 'tempo', keys: ['pace', 'poss_time'] },
  { key: 'efficiency', title: 'efficiency', keys: ['ppp', 'ts', 'ft_pct', 'morey'] },
  { key: 'distribution', title: 'distribution', keys: ['ast_pct', 'helio', 'bench_min_pct'] },
  { key: 'matchups', title: 'against starters & bench', keys: ['vs_start', 'vs_bench'] },
  { key: 'four factors', title: 'four factors', keys: ['ff_efg', 'ff_tov', 'ff_oreb', 'ff_ftr', 'dff_efg', 'dff_tov', 'dff_oreb', 'dff_ftr'] }
];

function info(key, kind) {
  const b = INFO[key];
  if (!b) return null;
  const o = { title: b.title, what: b.what, formula: b.formula, read: b.read, low: b.low };
  if (kind === 'team' && b.team) Object.keys(b.team).forEach(k => { o[k] = b.team[k]; });
  return o;
}

return { info, keys: () => Object.keys(INFO), groups: GROUPS, teamGroups: TEAM_GROUPS, TEAM_KEYS };
}));
