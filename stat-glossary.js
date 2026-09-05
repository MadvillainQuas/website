/* ============================================================================
 * stat-glossary.js — hover explanations for every stat in the Game Visualizer.
 *
 * WHO THIS IS WRITTEN FOR. A coach who knows basketball inside out and has
 * never needed the word "possession-adjusted" in their life. Every entry
 * therefore answers three questions in plain English — what the number is,
 * how to read it, and why anyone should care — before it goes anywhere near a
 * formula. The formula is last, and optional, because a coach who wants it
 * will look for it and a coach who doesn't should not have to read past it.
 *
 * WHAT IT IS NOT. Not a stats lecture, and not a list of thresholds to obey.
 * Benchmarks are given as rough senior-level rules of thumb and SAID to be
 * rough: a number that is poor in a professional league can be fine in an
 * academy game, and a tooltip that states "good is above 52%" as though it
 * were a law will quietly mislead somebody about their own team.
 *
 * HOW IT ATTACHES. Nothing in the visualiser is modified — this reads the
 * rendered DOM, matches label text against the glossary, and decorates what it
 * finds. That matters: the app defends its own integrity and will blank itself
 * if its internals are tampered with. A MutationObserver re-runs the pass
 * because the app rebuilds tables whenever a tab or a game changes.
 *
 * Loaded by GAMEVIS_with_ShotChart_v2_6.html, so it reaches the wrapper at
 * gamevis.html AND every /share/ link, with no separate wiring.
 * ========================================================================== */
(function () {
    'use strict';

    // ── the glossary ────────────────────────────────────────────────────────
    // what : one sentence, no jargon. read : what a high or low number means.
    // why  : why it beats the obvious alternative. math : optional, last.
    const G = {

        /* ─────────────── team efficiency and pace ─────────────── */
        'ORTG': {
            name: 'Offensive Rating',
            what: 'Points your team scores for every 100 times it has the ball.',
            read: 'Higher is better. At senior level, somewhere near 100 is ordinary; the low 90s is a hard night, 110+ is a very good one.',
            why: 'Points per game lies to you. A team that plays fast scores more simply because it gets more possessions, not because it is better at scoring. This puts a run-and-gun side and a walk-it-up side on the same scale.',
            math: 'Points ÷ possessions × 100'
        },
        'DRTG': {
            name: 'Defensive Rating',
            what: 'Points your team gives up for every 100 possessions the opponent has.',
            read: 'Lower is better — this is the one where a small number is the good news.',
            why: 'Same reason as Offensive Rating. "We only conceded 62" means nothing if the game had 55 possessions.',
            math: 'Opponent points ÷ possessions × 100'
        },
        'NET RATING': {
            name: 'Net Rating',
            what: 'Offensive Rating minus Defensive Rating — your points per 100 possessions, minus theirs.',
            read: 'Positive means you outscored them per possession. +10 is a comfortable win rate; anything past +20 is a hiding.',
            why: 'It is the scoreline with the pace taken out, which makes two different games comparable.'
        },
        'NET': {
            name: 'Net Rating (on court)',
            what: 'How much your team outscored the opponent by per 100 possessions while this player was on the floor.',
            read: 'Positive is good. Treat small minutes with suspicion — six minutes of garbage time can produce a wild number.',
            why: 'Plus/minus in raw points depends on how long someone played. This does not.'
        },
        'PACE': {
            name: 'Pace',
            what: 'Roughly how many possessions each team gets in a 40-minute game.',
            read: 'Higher means a faster game. It is not good or bad in itself — it is the tempo the two teams settled on.',
            why: 'It is the number that makes every other per-100 stat readable, and it tells you whether the game was played at your speed or theirs.'
        },
        'POSSESSIONS/GAME': {
            name: 'Possessions per game',
            what: 'How many times a team had the ball, on average.',
            read: 'A possession ends when you score, turn it over, or miss and the other team rebounds. An offensive rebound continues the same possession.',
            why: 'It is the denominator behind almost everything else on this page.'
        },
        'PPP': {
            name: 'Points Per Possession',
            what: 'Points produced each time the team (or player) has the ball.',
            read: 'Around 1.00 is roughly par. 1.15+ is excellent; below 0.90 is a struggle.',
            why: 'The same idea as Offensive Rating, just not multiplied by 100. Useful for judging a single player or a single lineup.'
        },

        /* ─────────────── the four factors ─────────────── */
        'EFG%': {
            name: 'Effective Field Goal %',
            what: 'Shooting percentage that counts a three-pointer as being worth more than a two, because it is.',
            read: 'Higher is better. Around 50% is roughly par at senior level. Compare it with plain FG% — if eFG% is much higher, the threes are doing real work.',
            why: 'Plain FG% treats a three and a lay-up as the same event, so a team shooting 40% from deep looks worse than one shooting 45% on long twos, when it is actually scoring more. This is the single most important of the four factors.',
            math: '(FGM + 0.5 × 3PM) ÷ FGA'
        },
        'EFG': {
            alias: 'EFG%'
        },
        'TOV%': {
            name: 'Turnover %',
            what: 'The share of your possessions that end in a turnover.',
            read: 'Lower is better. Low teens is tidy; above about 18% you are giving away too many.',
            why: 'A turnover is the worst outcome in basketball — no shot, and usually a chance the other way. Counting raw turnovers punishes fast teams; this does not.',
            math: 'Turnovers ÷ possessions'
        },
        'TO%': { alias: 'TOV%' },
        'OREB%': {
            name: 'Offensive Rebound %',
            what: 'The share of your own missed shots that you rebounded.',
            read: 'Higher is better. Roughly 25–30% is normal; over a third is a genuine strength.',
            why: 'It is a second chance measured properly. Raw offensive rebound counts reward a team that misses a lot — this measures how many of the available ones you actually took.',
            math: 'Offensive rebounds ÷ (your offensive rebounds + their defensive rebounds)'
        },
        'ORB%': { alias: 'OREB%' },
        'FTA RATE': {
            name: 'Free Throw Rate',
            what: 'How often you get to the line relative to how often you shoot.',
            read: 'Higher usually means you are attacking the rim and drawing contact rather than settling.',
            why: 'Free throws are the most efficient shot in basketball. This measures whether you are earning them — it is about getting there, not about making them.',
            math: 'Free throw attempts ÷ field goal attempts'
        },
        'FT RATE': { alias: 'FTA RATE' },

        /* ─────────────── the same four, from the defensive side ─────────────── */
        'OPP EFG%': {
            name: 'Opponent Effective FG %',
            what: 'How well the other team shot against you, counting threes properly.',
            read: 'Lower is better. This is the clearest single measure of whether your defence contested well.',
            why: 'Most of defence is making shots harder. This is where that shows up.'
        },
        'OPP EFG': { alias: 'OPP EFG%' },
        'OPP ORB': {
            name: 'Opponent Offensive Rebound %',
            what: 'The share of their own misses the opponent got back.',
            read: 'Lower is better. High numbers mean you got the stop and then gave the ball back.',
            why: 'Second-chance points are the most avoidable points in a game, and they rarely show up in a box score as anything.'
        },
        'OREB% ALLOWED': { alias: 'OPP ORB' },
        'DRB%': {
            name: 'Defensive Rebound %',
            what: 'The share of the opponent\'s misses that you rebounded.',
            read: 'Higher is better. It is the same measurement as Opponent Offensive Rebound %, viewed from your side.',
            why: 'A stop is not a stop until somebody secures the ball.'
        },
        'TOV FORCED%': {
            name: 'Turnovers Forced %',
            what: 'The share of the opponent\'s possessions on which your defence took the ball away.',
            read: 'Higher is better. A pressing team lives here; a drop-coverage team will be low and that is fine.',
            why: 'It separates turnovers you caused from turnovers they gifted you, and puts pressing and passive defences on one scale.'
        },
        'TOV FRC': { alias: 'TOV FORCED%' },
        'OPP FT RATE': {
            name: 'Opponent Free Throw Rate',
            what: 'How often you sent the other team to the line, relative to their shot attempts.',
            read: 'Lower is better. A high number means fouling rather than contesting.',
            why: 'It is the cost of your defensive aggression, in the currency that hurts most.'
        },

        /* ─────────────── shooting ─────────────── */
        'TS%': {
            name: 'True Shooting %',
            what: 'One shooting number that accounts for twos, threes and free throws together.',
            read: 'Higher is better. Around 55% is solid at senior level; 60%+ is excellent. It runs higher than FG% by design, so do not compare the two directly.',
            why: 'It is the fairest way to compare a rim-runner who lives at the line with a shooter who never gets there. If you look at one shooting number, look at this one.',
            math: 'Points ÷ (2 × (FGA + 0.44 × FTA))'
        },
        'TRUE SHOOTING %': { alias: 'TS%' },
        'TSA/100': {
            name: 'True Shot Attempts per 100',
            what: 'How many scoring attempts a player takes per 100 possessions, counting trips to the line as part of an attempt.',
            read: 'Higher means more shot volume. Read it next to TS% — high volume at low efficiency is a problem, high volume at high efficiency is your best player.',
            math: 'FGA + 0.44 × FTA, per 100 possessions'
        },
        'TRUE SHOT ATTEMPTS': { alias: 'TSA/100' },
        'FG%': {
            name: 'Field Goal %',
            what: 'The share of shots from the floor that went in. Free throws are not included.',
            read: 'Higher is better, but it treats a three and a lay-up as equal — prefer eFG% or TS% when comparing players.',
            why: 'Familiar and useful for a quick read, but it is the crudest shooting number here.'
        },
        '3PT%': {
            name: 'Three-Point %',
            what: 'The share of three-point attempts that went in.',
            read: 'Around 33% from three is worth about the same as 50% from two. Small samples swing wildly — one good night is not a shooter.',
            why: 'Judged against the right benchmark it tells you whether taking those threes was the right decision.'
        },
        '2PT': {
            name: 'Two-Point shooting',
            what: 'Makes and attempts from inside the arc.',
            read: 'Read it with the shot distribution — good two-point volume at the rim is very different from the same volume from mid-range.'
        },
        '3PT': {
            name: 'Three-Point shooting',
            what: 'Makes and attempts from beyond the arc.',
            read: 'Volume matters as much as percentage. A team that takes very few threes can shoot a lovely percentage and still lose the maths.'
        },
        'FT%': {
            name: 'Free Throw %',
            what: 'The share of free throws made.',
            read: 'Higher is better. Unlike Free Throw Rate, this is purely about conversion once you are there.',
            why: 'Free throws are the only uncontested shot in the game, which makes them the most fixable number on this page.'
        },
        'FREE THROW %': { alias: 'FT%' },

        /* ─────────────── where the shots come from ─────────────── */
        'RIM': {
            name: 'Rim attempts',
            what: 'Shots taken right at the basket.',
            read: 'More is generally better — these are the highest-percentage shots in basketball outside a free throw.'
        },
        'RIM%': {
            name: 'Rim shooting %',
            what: 'The share of shots at the rim that went in.',
            read: 'Expect a high number — around 60% is normal. Well below that means shots are being contested or rushed.'
        },
        'RIMA/FGA': {
            name: 'Rim attempt share',
            what: 'What proportion of all shots were taken at the rim.',
            read: 'Higher means a team getting downhill. Low numbers mean a jump-shooting night, by design or because the defence forced it.'
        },
        'RIMA/100': {
            name: 'Rim attempts per 100',
            what: 'How many shots at the rim, per 100 possessions.',
            read: 'A volume measure — it tells you how often a player actually gets there, independent of minutes.'
        },
        'MID': {
            name: 'Mid-range attempts',
            what: 'Shots from inside the arc but away from the basket.',
            read: 'The least efficient shot in basketball by the numbers — worth two points at a lower percentage than a rim shot, and worth less than a three at a similar one.',
            why: 'Not that mid-range is forbidden: it is where a good big or a late-clock possession lives. But a lot of these usually means the defence made you settle.'
        },
        'MID%': {
            name: 'Mid-range shooting %',
            what: 'The share of mid-range shots that went in.',
            read: 'Around 40% is respectable. It needs to be high to be worth taking, because the shot is only worth two.'
        },
        'MIDA/100': {
            name: 'Mid-range attempts per 100',
            what: 'Mid-range shots per 100 possessions.',
            read: 'A volume measure. Read alongside RIMA/100 and 3PTA/100 to see a player\'s shot diet at a glance.'
        },
        '3PTA/FGA': {
            name: 'Three-point attempt share',
            what: 'What proportion of all shots were threes.',
            read: 'Higher means a team that hunts threes. Says nothing about whether they went in — that is 3PT%.'
        },
        '3PTA/100': {
            name: 'Three-point attempts per 100',
            what: 'Threes attempted per 100 possessions.',
            read: 'Volume, independent of minutes played.'
        },
        'SHOT DISTRIBUTION': {
            name: 'Shot Distribution',
            what: 'Where the shots came from — rim, mid-range, or three.',
            read: 'Read it as a shot diet. Two teams can shoot the same percentage from very different, and very differently sustainable, places.',
            why: 'It is the most directly coachable thing on the page: you can change where shots come from far more easily than whether they go in.'
        },

        /* ─────────────── shot zones ─────────────── */
        'RIM (RESTRICTED)': {
            name: 'Rim (restricted area)',
            what: 'The semicircle right under the basket.',
            read: 'The best real-estate on the floor. Most efficient shots in the game come from here.'
        },
        'PAINT (NON-RESTRICTED)': {
            name: 'Paint, outside the restricted area',
            what: 'In the key, but not right at the rim — floaters, short jumpers, post turnarounds.',
            read: 'Middling efficiency: better than a long two, well short of a lay-up.'
        },
        'ELBOW': {
            name: 'Elbow',
            what: 'The corners of the free throw line.',
            read: 'A classic mid-range spot, and a common pick-and-pop landing place.'
        },
        'BASELINE MID-RANGE': {
            name: 'Baseline mid-range',
            what: 'Two-point shots along the baseline outside the paint.',
            read: 'Mid-range efficiency, with the added difficulty of no shooter\'s bounce off the backboard.'
        },
        'CORNER 3': {
            name: 'Corner three',
            what: 'A three from the corner, where the arc is closest to the basket.',
            read: 'The most efficient three on the floor — a shorter shot for the same three points. Usually created by a drive-and-kick.'
        },
        'WING 3': {
            name: 'Wing three',
            what: 'A three from the sides, between the corner and the top.',
            read: 'The most common three in most offences.'
        },
        'TOP OF KEY 3': {
            name: 'Top of the key three',
            what: 'A three from straight on, above the arc.',
            read: 'Often a pick-and-roll pull-up or a swing-swing catch.'
        },
        'ZONE BREAKDOWN': {
            name: 'Zone Breakdown',
            what: 'Shooting split by area of the floor.',
            read: 'Look for the mismatch between where a team shoots most and where it shoots best — that gap is a game plan.'
        },

        /* ─────────────── playmaking and usage ─────────────── */
        'AST': {
            name: 'Assists',
            what: 'Passes that led directly to a made basket.',
            read: 'A count, not a rate. A high-assist guard on a team that shoots well will always look better than the same player on a team that misses.'
        },
        'AST%': {
            name: 'Assist %',
            what: 'The share of teammates\' baskets that this player assisted, while on the floor.',
            read: 'Higher means more of the team\'s scoring went through their passing. 25%+ is a primary creator.',
            why: 'Raw assists depend on minutes and on whether teammates made shots. This is closer to a measure of the player.'
        },
        'TEAM AST %': {
            name: 'Team Assist %',
            what: 'The share of the team\'s made baskets that came off an assist.',
            read: 'Higher means the ball moved. Low numbers mean isolation scoring — sometimes a plan, sometimes a stalled offence.'
        },
        '% PTS OFF AST': {
            name: 'Percentage of points off assists',
            what: 'How much of the scoring was created by a pass rather than made alone.',
            read: 'A directness measure for the offence — how much came from the system versus from individual shot-making.'
        },
        'AST / TO RATIO': {
            name: 'Assist to Turnover Ratio',
            what: 'Assists divided by turnovers.',
            read: 'Above 2.0 is good ball security for a guard. Below 1.0 means giving it away more often than creating with it.',
            why: 'The simplest read on whether a playmaker is helping or leaking.'
        },
        'USG': {
            name: 'Usage %',
            what: 'The share of the team\'s possessions a player used while on the floor — by shooting, getting fouled, or turning it over.',
            read: '20% is an even share among five players. 30%+ is a lead option carrying the offence.',
            why: 'It is the volume knob. Every efficiency number should be read next to it: efficient on low usage is easy, efficient on high usage is a star.'
        },
        'USAGE': { alias: 'USG' },
        'A/U': {
            name: 'Assist to Usage ratio',
            what: 'How much a player creates for others relative to how much of the offence they use up.',
            read: 'High means a distributor — they pass more than they consume. Low means a finisher or a scorer.',
            why: 'Separates the point guard who runs things from the wing who is fed by them, even when both touch the ball constantly.',
            math: 'AST% ÷ USG%'
        },
        'MADE': {
            name: 'Field goals made',
            what: 'Shots from the floor that went in.'
        },
        '+AST': {
            name: 'Points assisted',
            what: 'Points that teammates scored off this player\'s passes.',
            read: 'A creation credit — three assists on three-pointers is nine points here, not three.',
            why: 'An assist on a three and an assist on a lay-up are not the same contribution, and the assist count cannot tell them apart.'
        },
        'TPC': {
            name: 'Total Point Contribution',
            what: 'Points a player scored, plus the points they created for teammates by assisting.',
            read: 'The fullest single answer to "how much scoring did this player put on the board?"',
            why: 'A guard with 8 points and 10 assists on threes contributed far more than 8 — this is the number that says so.',
            math: 'Points scored + points assisted'
        },
        'PASSER': {
            name: 'Passer',
            what: 'The player who made the assist in this pairing.',
            read: 'The Connections table pairs every passer with every scorer, so you can see which two players actually generate offence together.'
        },
        'SCORER': {
            name: 'Scorer',
            what: 'The player who finished the pass in this pairing.'
        },

        /* ─────────────── defensive individual ─────────────── */
        'STL%': {
            name: 'Steal %',
            what: 'The share of opponent possessions this player ended with a steal.',
            read: 'Higher means more disruption. Read with caution — gambling for steals can cost more than it wins.'
        },
        'BLK%': {
            name: 'Block %',
            what: 'The share of opponent two-point attempts this player blocked while on the floor.',
            read: 'Higher means genuine rim protection. It undersells defenders who deter shots rather than swat them.'
        },

        /* ─────────────── plus-minus family ─────────────── */
        'BPM': {
            name: 'Box Plus/Minus',
            what: 'An estimate of the points per 100 possessions a player added compared with an average player.',
            read: '0 is average. +5 is very good, +10 is a standout, negative means the team was worse with them out there.',
            why: 'It rolls a whole box score line into one number, so you can rank a 14-point scorer against a 6-point defender. It is an estimate built from box-score stats, not a measurement — treat it as a strong hint, not a verdict.'
        },
        'OBPM': {
            name: 'Offensive Box Plus/Minus',
            what: 'The offensive half of BPM — points added per 100 possessions at the offensive end.',
            read: '0 is average. Scoring, shooting efficiency and creation drive it.'
        },
        'DBPM': {
            name: 'Defensive Box Plus/Minus',
            what: 'The defensive half of BPM.',
            read: '0 is average. Built mostly from steals, blocks and rebounds, so it misses good positional defence — the most underrated skill it cannot see.'
        },
        'TPA': {
            name: 'Total Points Added',
            what: 'BPM converted into actual points across the minutes the player actually played.',
            read: 'BPM says how good they were per possession; this says how much it was worth in this game. A great rate in five minutes produces a small number here, correctly.',
            math: 'BPM × (possessions ÷ 100)'
        },
        'POS': {
            name: 'Estimated position',
            what: 'Where the player behaved on a 1-to-5 scale, from the numbers rather than the team sheet.',
            read: '1 is point guard behaviour, 5 is centre behaviour. A listed guard playing like a 4 is telling you something real.'
        },
        'ROLE': {
            name: 'Offensive role',
            what: 'Whether a player created their own offence or finished someone else\'s, on a 1-to-5 scale.',
            read: '1 is a creator, 5 is a finisher. Neither is better — a team needs both.'
        },
        '+/-': {
            name: 'Plus/Minus',
            what: 'The points your team outscored the opponent by while this player was on the floor.',
            read: 'Raw and noisy. Heavily affected by who else was out there — read it alongside Net Rating and minutes, never alone.'
        },
        'MIN': {
            name: 'Minutes played',
            what: 'Time on the floor.',
            read: 'The context for everything else. A big number over four minutes is not a performance.'
        },
        'PTS': { name: 'Points', what: 'Points scored.' },
        'LINEUP': {
            name: 'Lineup',
            what: 'A specific five players on the floor together.',
            read: 'Lineup numbers come from small samples — often only a few minutes. Use them to raise questions, not to settle them.'
        },

        /* ─────────────── models and derived views ─────────────── */
        'EPA': {
            name: 'Expected Points Added',
            what: 'How many points the turnover and offensive-rebound battle was worth, converted into scoreboard points.',
            read: 'Positive means those two areas were earning you points. It is an estimate of the value of extra possessions won.',
            why: 'Winning the turnover and rebound battle wins you possessions, and possessions are worth roughly a point each. This puts a number on that.'
        },
        'EPA (PTS)': { alias: 'EPA' },
        'EPA (TO + OREB BATTLE)': { alias: 'EPA' },
        'SB (PTS)': {
            name: 'Scoring Battle',
            what: 'How many points the shooting and free-throw battle was worth.',
            read: 'Positive means you won the efficiency exchange. Its partner is EPA, which covers the possession battle.',
            why: 'Together, these two split the final margin into "we shot better" and "we got more chances" — usually the first thing worth knowing after a game.',
            math: '(eFG% margin × 1.77 + FT-rate margin × 0.25), scaled by pace'
        },
        'SCORING BATTLE': { alias: 'SB (PTS)' },
        'EXPECTED MARGIN': {
            name: 'Expected Margin',
            what: 'The winning margin the four factors say this performance deserved.',
            read: 'Compare it with the real margin. A win by 2 with an expected margin of +12 says you played better than the scoreboard admits — and probably got unlucky late.',
            why: 'It separates how you played from how it finished, which is exactly what you want the day after a one-point loss.'
        },
        'MARGIN STD DEV': {
            name: 'Margin standard deviation',
            what: 'How much the expected margin could reasonably have swung either way.',
            read: 'A bigger number means a less certain read. A +6 expected margin with a swing of 10 is not a confident claim.'
        },
        'SCORE MARGIN': {
            name: 'Score Margin',
            what: 'The actual lead or deficit, tracked through the game.',
            read: 'Read the shape, not just the end. A steady 12 and a wild swing from -15 to +3 are different games with the same result.'
        },
        'Z-SCORE': {
            name: 'Z-Score',
            what: 'How far above or below normal a number is, measured in standard deviations.',
            read: '0 is exactly average. +1 is better than about 84% of cases, +2 better than about 98%. Negative is below average.',
            why: 'It puts stats measured on completely different scales onto one comparable footing.'
        },
        'WIN PROBABILITY': {
            name: 'Win Probability',
            what: 'How often a team with this four-factor performance would win, simulated many times over.',
            read: 'It describes the performance, not the result you already know. 80% means one in five of those games is still lost.',
            why: 'It answers "was that win earned or survived?" — worth far more than the final score for deciding what to work on.'
        },
        'SIMULATIONS': {
            name: 'Simulations',
            what: 'How many times the model replayed this game to produce the win probability.',
            read: 'More runs means a steadier estimate. It does not make the model more right, only less jumpy.'
        },
        'CONFIDENCE': {
            name: 'Confidence',
            what: 'How firm the model considers its own read.',
            read: 'Low confidence usually means the factors disagree with each other — worth reading the detail rather than the headline.'
        },
        'LEAD CHANGES': {
            name: 'Lead Changes',
            what: 'How many times the lead swapped hands.',
            read: 'A tightness measure. Lots of changes means neither side established control.'
        },
        'FACTOR ADVANTAGES': {
            name: 'Factor Advantages',
            what: 'Which of the four factors each team won.',
            read: 'The quickest post-game read there is: win three of four and you almost always win the game. If you won three and lost, look at which one you lost and by how much.'
        },
        'OFFENSIVE ON-COURT': {
            name: 'Offensive On-Court',
            what: 'How the team\'s offence performed while this player was on the floor.',
            read: 'It is about the team with them out there, not about their own scoring. A low-scoring player can have excellent on-court offensive numbers.'
        },
        'DEFENSIVE ON-COURT': {
            name: 'Defensive On-Court',
            what: 'How the team\'s defence performed while this player was on the floor.',
            read: 'The best available box-score answer to "does our defence hold up with them out there?" Still affected by the other four.'
        },
        'INDIVIDUAL': {
            name: 'Individual',
            what: 'Stats about the player themselves, rather than about the team while they played.'
        },
        /* ─────────────── section headings that carry a real idea ─────────────── */
        // The Four Factors heading is the most valuable tooltip on the page.
        // Everything in that panel assumes the reader already knows what the
        // four factors ARE, and a coach meeting them for the first time has
        // nowhere else to find out.
        'OFFENSIVE RATING & FOUR FACTORS': {
            name: 'The Four Factors',
            what: 'Four things decide basketball games, in this order of importance: shooting well (eFG%), not turning it over (TOV%), getting your own misses back (OREB%), and getting to the free throw line (FT Rate).',
            read: 'Each is shown for both teams. Win three of the four and you win the game the overwhelming majority of the time.',
            why: 'They were identified by working backwards from thousands of results, and they are roughly weighted 40/25/20/15 in that order — which is why shooting well matters more than everything else here combined with a bit to spare. As a post-game read: find the factor you lost, and you have found what to work on Monday.'
        },
        'FOUR FACTORS: HALF-BY-HALF COMPARISON': {
            name: 'Four Factors by half',
            what: 'The same four factors, split into the first and second half.',
            read: 'Look for what changed. A team that won the first half on shooting and lost the second on turnovers had two different games.',
            why: 'It tells you whether an adjustment worked, or whether the game simply drifted.'
        },
        'BOX PLUS/MINUS (GBPM)': {
            name: 'Box Plus/Minus for this game',
            what: 'Every player rated on one scale — how many points per 100 possessions they added compared with an average player, in this game only.',
            read: '0 is average, positive is above it. The "g" means it is calculated for this single game, so it swings far more than a season figure would.',
            why: 'It is the quickest way to rank a whole roster on a single evening. Because it is built from the box score, it sees scoring and rebounding well and positional defence barely at all — so use it to start an argument, not to end one.'
        },
        'SHOT CHART ANALYSIS': {
            name: 'Shot Chart Analysis',
            what: 'Every shot in the game plotted where it was taken, with makes and misses separated.',
            read: 'Look at the clusters before the percentages. Where a team shoots from is usually a more useful finding than whether those shots dropped on the night.',
            why: 'Shot selection is coachable and repeatable; shot-making on a given evening largely is not.'
        },
        'TEAM SHOT DISTRIBUTION': { alias: 'SHOT DISTRIBUTION' },
        'SEASON STATS COMPARISON': {
            name: 'Season Stats Comparison',
            what: 'This game set against the team\'s season averages.',
            read: 'It answers "was that normal for us?" — a bad night at a usual level of play is a very different conversation from a genuine drop-off.'
        },
        'ADDITIONAL METRICS': {
            name: 'Additional Metrics',
            what: 'Supporting numbers beyond the four factors — shooting efficiency, passing, and where shots came from.',
            read: 'Use these to explain WHY a four factor landed where it did. If eFG% was poor, the shot-distribution numbers usually say why.'
        },

        'SCORING': { name: 'Scoring', what: 'Points, shot-making and points created for others.' },
        'FREE THROWS': { name: 'Free Throws', what: 'How often the team got to the line, and how often they converted.' },
        'BALL CONTROL & REBOUNDING': { name: 'Ball Control & Rebounding', what: 'Looking after the ball, and winning it back off the glass.' },
        'DEFENSE': { name: 'Defense', what: 'Stops, disruption and defensive rebounding.' },
        'PLAYMAKING': { name: 'Playmaking', what: 'Creating shots for other people.' },
        'EFFICIENCY': { name: 'Efficiency', what: 'Points produced per chance used — output measured against opportunity, not against minutes.' }
    };

    // ── matching ────────────────────────────────────────────────────────────
    // Labels arrive with sort arrows, emoji, footnote counts and inconsistent
    // spacing. Normalise hard, then look up; entries with `alias` forward to
    // the real one so "eFG" and "eFG%" cannot drift apart.
    function normalise(text) {
        return String(text || '')
            .replace(/[↑↓↕▲▼]/g, ' ')      // sort arrows
            .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ') // emoji
            .replace(/\(\d+[^)]*\)/g, ' ')                           // "(29/70)"
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();
    }

    function lookup(text) {
        let key = normalise(text);
        if (!key || key.length > 44) return null;
        let entry = G[key];
        // "ORTG" arrives as "ORtg"; "- 1st Half" suffixes should still match.
        if (!entry) {
            const stripped = key.replace(/\s*-\s*(1ST|2ND)\s+HALF$/, '').trim();
            entry = G[stripped];
        }
        let guard = 0;
        while (entry && entry.alias && guard++ < 5) entry = G[entry.alias];
        return entry && entry.name ? entry : null;
    }

    // ── the tooltip ─────────────────────────────────────────────────────────
    let tip = null, tipFor = null, hideTimer = null;

    function buildTip() {
        if (tip) return tip;
        const style = document.createElement('style');
        style.textContent = `
            .sg-tip {
                position: fixed; z-index: 2147483000; max-width: 340px;
                background: #12141b; color: #e8eaf0;
                border: 1px solid #2b2f3a; border-radius: 10px;
                padding: 13px 15px; font-size: 13px; line-height: 1.55;
                font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
                box-shadow: 0 16px 44px rgba(0,0,0,.55);
                pointer-events: none; opacity: 0; transform: translateY(4px);
                transition: opacity .12s ease, transform .12s ease;
            }
            .sg-tip.on { opacity: 1; transform: translateY(0); }
            .sg-tip h4 { margin: 0 0 7px; font-size: 13.5px; font-weight: 700; color: #00d4ff; letter-spacing: .01em; }
            .sg-tip p { margin: 0 0 8px; }
            .sg-tip p:last-child { margin-bottom: 0; }
            .sg-tip .lbl {
                display: block; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase;
                color: #8892a8; margin-bottom: 2px; font-weight: 700;
            }
            .sg-tip .math {
                font-family: ui-monospace, Consolas, monospace; font-size: 11.5px;
                color: #8892a8; border-top: 1px solid #2b2f3a; padding-top: 8px; margin-top: 9px;
            }
            /* The affordance. Without it nobody discovers the tooltips at all —
               a hover that is not advertised may as well not exist. */
            .sg-has {
                text-decoration: underline dotted rgba(0,212,255,.5) !important;
                text-underline-offset: 3px; cursor: help !important;
            }
            @media (prefers-reduced-motion: reduce) { .sg-tip { transition: none; } }
        `;
        (document.head || document.documentElement).appendChild(style);

        tip = document.createElement('div');
        tip.className = 'sg-tip';
        tip.setAttribute('role', 'tooltip');
        tip.id = 'sg-tip';
        document.body.appendChild(tip);
        return tip;
    }

    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    function show(el, entry) {
        const t = buildTip();
        if (tipFor === el && t.classList.contains('on')) return;
        tipFor = el;
        clearTimeout(hideTimer);

        t.innerHTML =
            '<h4>' + esc(entry.name) + '</h4>' +
            '<p>' + esc(entry.what) + '</p>' +
            (entry.read ? '<p><span class="lbl">How to read it</span>' + esc(entry.read) + '</p>' : '') +
            (entry.why ? '<p><span class="lbl">Why it matters</span>' + esc(entry.why) + '</p>' : '') +
            (entry.math ? '<p class="math">' + esc(entry.math) + '</p>' : '');

        // Measure and position SYNCHRONOUSLY. This used to happen inside a
        // requestAnimationFrame callback, which is correct right up until the
        // frame is not painting — a background tab, a hidden iframe, a
        // minimised window — at which point rAF never fires, the tooltip keeps
        // the -9999px it was parked at, and it is "visible" somewhere nobody
        // can see. Reading getBoundingClientRect forces the layout we need
        // anyway, so there was never anything to wait for.
        t.style.left = '0px';
        t.style.top = '0px';
        t.classList.add('on');

        const r = el.getBoundingClientRect();
        const b = t.getBoundingClientRect();   // forces layout; size is real
        const pad = 10;
        let left = r.left + r.width / 2 - b.width / 2;
        left = Math.max(pad, Math.min(left, window.innerWidth - b.width - pad));
        // Above the label by default; below when there is no room above,
        // which matters because these labels are usually sticky table headers
        // pinned to the top of the viewport. Then clamp: these cards run to
        // ~340px and a short viewport has room for neither placement, in which
        // case flipping below silently pushes the formula line off the bottom
        // of the screen. Clamping keeps the whole card readable and simply
        // lets it overlap the label, which is the lesser problem.
        let top = r.top - b.height - 9;
        if (top < pad) {
            const below = r.bottom + 9;
            top = (below + b.height + pad <= window.innerHeight)
                ? below
                : Math.max(pad, window.innerHeight - b.height - pad);
        }
        t.style.left = Math.round(left) + 'px';
        t.style.top = Math.round(top) + 'px';
    }

    function hide() {
        if (!tip) return;
        tipFor = null;
        tip.classList.remove('on');
        // Park it off-screen only after the fade, and only if it has not been
        // shown again in the meantime.
        hideTimer = setTimeout(() => {
            if (tip && !tip.classList.contains('on')) { tip.style.left = '-9999px'; tip.style.top = '0px'; }
        }, 200);
    }

    // ── decorate ────────────────────────────────────────────────────────────
    const SELECTOR = [
        'th', '.factor-label', '.metric-label', '.stat-label', '.stat-name',
        '.card-title', '.col-group-header', '.legend-label', '.kpi-label'
    ].join(',');

    function decorate(root) {
        let found = 0;
        let nodes;
        try { nodes = (root || document).querySelectorAll(SELECTOR); } catch (_) { return 0; }
        nodes.forEach((el) => {
            if (el.dataset.sgDone === '1') return;
            // Only leaf-ish labels — a <th> wrapping other elements is a group
            // container whose text is the concatenation of its children.
            if (el.querySelector('table, tbody, tr')) { el.dataset.sgDone = '1'; return; }
            const entry = lookup(el.textContent);
            el.dataset.sgDone = '1';
            if (!entry) return;

            // The app already sets `title` on a few of these (POS, ROLE, TPA).
            // Two tooltips for one label is worse than either, so the native
            // one steps aside — its content is covered by the glossary entry.
            if (el.hasAttribute('title')) {
                el.dataset.sgOldTitle = el.getAttribute('title');
                el.removeAttribute('title');
            }

            el.classList.add('sg-has');
            el.setAttribute('aria-describedby', 'sg-tip');
            // Reachable without a mouse. Table headers are not focusable by
            // default, and a coach on a laptop trackpad is not the only person
            // who will read this.
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');

            el.addEventListener('mouseenter', () => show(el, entry));
            el.addEventListener('mouseleave', hide);
            el.addEventListener('focus', () => show(el, entry));
            el.addEventListener('blur', hide);
            // Touch: no hover to rely on, so a tap opens it and a tap anywhere
            // else closes it.
            el.addEventListener('click', (e) => {
                if (!window.matchMedia('(hover: none)').matches) return;
                e.stopPropagation();
                if (tipFor === el) hide(); else show(el, entry);
            });
            found++;
        });
        return found;
    }

    document.addEventListener('click', (e) => {
        if (tipFor && !e.target.closest('.sg-has')) hide();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);

    function run() {
        const n = decorate(document);
        if (n) console.log('[StatGlossary] explained ' + n + ' new labels');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', run);
    } else {
        run();
    }

    // The app rebuilds whole tables when a tab changes or a new game loads, so
    // one pass at startup would cover almost nothing. Debounced because a
    // re-render fires a burst of mutations, not one.
    let pending = null;
    try {
        new MutationObserver(() => {
            clearTimeout(pending);
            pending = setTimeout(run, 220);
        }).observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}

    // Exposed for the console, and so a future page can ask what is defined
    // without reaching into the closure.
    try {
        window.PROPHESY_STAT_GLOSSARY = { entries: G, lookup: lookup, rescan: run };
    } catch (_) {}
})();
