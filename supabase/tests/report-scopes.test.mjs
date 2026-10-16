/* ============================================================================
   THE REPORTS OVER LINKED COMPETITIONS (2026-10-07): a club's or a player's report over every competition of the season
   (London Lions in SLB and in the EuroCup), the linked side's ids counted as the club's and the player's, ranked against
   the league's own field all the same.

     node supabase/tests/report-scopes.test.mjs
   ============================================================================ */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (what, cond) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what); } };

const D = rd('epinoia', 'data.js'), R = rd('epinoia', 'report.js'), TP = rd('epinoia', 'report-teampages.js'), PP = rd('epinoia', 'report-playerpages.js');
const T = rd('epinoia', 't', 'team.js'), P = rd('epinoia', 'p', 'player.js');

console.log('data.js season: the same club and people under another competition\'s ids, summed as one');
ok('opts.alias maps a club and its players onto the ids they count as', /const alias = opts && opts\.alias && \(opts\.alias\.team \|\| opts\.alias\.player\) \? opts\.alias : null;/.test(D));
ok('...the games\' clubs before anything is summed', /if \(alias\) games\.forEach\(g => \{ g\.home_team_id = aT\(g\.home_team_id\); g\.away_team_id = aT\(g\.away_team_id\); \}\);/.test(D));
ok('...each batch\'s player rows before they are added', /if \(alias\) pgs\.forEach\(r => \{ if \(r\.player_uuid\) r\.player_uuid = aP\(r\.player_uuid\);/.test(D));
ok('...never cached and never from a file (those are the competition\'s own ids)', /const ckey = keepRows \|\| only \|\| alias \? null :/.test(D));

console.log('\nreport.js: the choice');
ok('a COMPETITIONS select, offered only when the page has more than one choice', /sc\.append\(el\('span', null, 'competitions'\)\)/.test(R) && /if \(list\.length > 1\)/.test(R) && /sc\.hidden = true;/.test(R));
ok('the page is told the choice before a build, and a build waits for it', /o\.setScope\(conf\.scope\)/.test(R) && /if \(state\.scopeReady\) await state\.scopeReady;/.test(R));
ok('kept with the other settings, and ?rpscope= asks for one (the mailer)', /scope: conf\.scope \}\)/.test(R) && /get\('rpscope'\)/.test(R));
ok('the club report\'s kept reads are kept per choice', /const scopeKey = \(\) => \(ctx\.scopeKey \? ctx\.scopeKey\(\) : ''\);/.test(TP) && /seasonK === scopeKey\(\)/.test(TP) && /stintK === scopeKey\(\)/.test(TP) && /clockK === scopeKey\(\)/.test(TP));
ok('the squad and the season line name the field they are ranked in, not the lines\' scope', /own position in ' \+ \(c\.field \|\| c\.scope/.test(TP) && /Rk\.who \+ ' of ' \+ \(c\.field \|\| c\.scope/.test(PP));

console.log('\nthe club page');
ok('the linked sides are the season card\'s (recLinked), waited for', /LINKED_READY = recLinked\(team\)/.test(T) && /await LINKED_READY/.test(T));
ok('their players by their linked profiles, and an unlinked one only on a unique surname and initial', /player_group_members\?player_id=in\./.test(T) && /bySig\.set\(k, bySig\.has\(k\) \? null : id\)/.test(T));
ok('the field stays the league\'s: only this club\'s row and its players\' are the joint ones', /teams: T\.S\.teams\.map\(r => \(r\.id === team\.id \? mineJ : r\)\)/.test(T));
ok('the logs take in the linked side\'s games under this club\'s ids', /const x = rpAliasDeep\(e, A\.player\)/.test(T) && /logs: \(\) => rpLogs\(team\)/.test(T));
ok('the RAPM never reads the linked side\'s games', /\(ids \|\| \[\]\)\.filter\(id => !RP_LINKED_IDS\.has\(id\)\)/.test(T));
ok('the cover says what the lines are over and what they are ranked against', /' · ranked among ' \+ \(lg\.name \|\| 'the league'\) \+ ' clubs'/.test(T));

console.log('\nthe player page');
ok('each linked profile of his season counted as his (jointSeasonLine, shared with the page’s ALL)', /new Map\(cs\.filter\(c => c\.pid && c\.pid !== plId\)\.map\(c => \[c\.pid, plId\]\)\)/.test(P) && /jointSeasonLine\(pl\.id, jointComps\(\)\)/.test(P));
ok('only his clubs\' games are read', /or=\(home_team_id\.in\.\(\$\{tids\.join\(','\)\}\),away_team_id\.in\./.test(P));
ok('his joint line takes his row\'s place in the page\'s field', /out\.field = \(B\.field \|\| \[\]\)\.map\(r => \(r === B\.mine \? J : r\)\)/.test(P));
ok('offered when his season has more than one competition, said on the cover', /RP_SEASON\.comps\.length > 1/.test(P) && /' · ranked among the players of ' \+ scopeText\(\)/.test(P));

console.log('\nthe opposition report: compared with the club it goes to, and lineups - misc. (Louie, 2026-10-16)');
{
  const RT = rd('epinoia', 'report-teampages.js'), RJ = rd('epinoia', 'report.js'), TJ = rd('epinoia', 't', 'team.js'), MJ = rd('scripts', 'report_mailer.mjs');
  const SJ = rd('epinoia', 'season.js'), SH = rd('supabase', 'functions', '_shared', 'season.js');
  ok('two pages before the legend, off unless asked for', /return \[cover, main, shots, players, synergy, depth, combos, clutch, week, cmp, lmisc, legend\];/.test(RT) &&
     /key: 'cmp', title: 'Comparison', page: 'COMPARISON', on: false/.test(RT) && /key: 'lmisc', title: 'Lineups – misc\.', page: 'LINEUPS – MISC\.', on: false/.test(RT));
  ok('...asked for by the address (?rpadd=), for that view only, never kept as the reader\'s choice', /get\('rpadd'\)/.test(RJ) && /addMods\.forEach\(k => \{ conf\.on\[k\] = true; \}\);/.test(RJ) &&
     /state\.onlyMods = onlyMods\.length > 0 \|\| addMods\.length > 0;/.test(RJ));
  ok('the club it is compared with comes from ?rpvs= (never the report\'s own club)', /get\('rpvs'\); return v && \/\^\[0-9a-f-\]\{36\}\$\/i\.test\(v\) && v !== team\.id \? v : null;/.test(TJ));
  ok('the comparison\'s figures: rating and the four factors, the style of play, the defence - as asked', ["['ortg', 'ORTG'", "['ff_efg', 'eFG%'", "['ff_ftr', 'FTA RATE'", "['ff_oreb', 'OREB%'", "['ff_tov', 'TOV%'",
     "['cmp_top', 'AVG TIME OF POSSESSION'", "['ev_half_pts_sh', '% OF PTS IN HALF COURT'", "['ev_transition_pts_sh', '% OF PTS IN TRANSITION'", "['tm_hc_ast_pct', 'HALF-COURT AST%'",
     "['ast_sh_all', 'SHARE OF BASKETS ASSISTED'", "['fl_stop_pct', 'STOP%'", "['evd_half_efg', 'DEF HALF-COURT eFG%'", "['tr_def_delta', 'TRANSITION PTS v OPP AVERAGE'", "['blk_pct', 'BLK%'"].every(x => RT.includes(x)));
  ok('...stops from every club\'s play-by-play, possession time from the shot clock, both clubs the same way', /GF\.attachTeams\(S, D\)/.test(RT) && /SCk\.compute\(\{ events: g\.events \|\| \[\] \}\)/.test(RT));
  ok('...a figure every club has the same of is left out', /const spread = k => new Set\(/.test(RT));
  ok('a club\'s BLK%: blocks per opponent two-point attempt, in the season line and its server copy', /blk_pct: r1\(pct\(A\.blk, num\(O\.fga\) - num\(O\.fg3a\)\)\),/.test(SJ) && /blk_pct: r1\(pct\(A\.blk, num\(O\.fga\) - num\(O\.fg3a\)\)\),/.test(SH));
  ok('small lineups: the designated 5 (the most centre-like by the season\'s breakdown) under 60% of their minutes at C', /const LM_SMALL = 0\.6, LM_OREB = 12, LM_DREB = 27/.test(RT) &&
     /const isSmall = r => \{ const sh = cShare\(fiveOf\(r\.ids\)\); return sh != null && sh < LM_SMALL; \};/.test(RT));
  ok('...against physical and rebounding bigs: an opponent on the floor with OREB% 12+ or DREB% over 27, by their season now', /\+p\.oreb_pct >= LM_OREB \|\| \+p\.dreb_pct > LM_DREB/.test(RT) &&
     /faced\.filter\(r => r\.oids\.some\(id => bigs\.has\(id\)\)\)/.test(RT));
  ok('...each with ORTG, DRTG, NET and the four factors at both ends', ["['ortg', 'ORTG'", "['drtg', 'DRTG'", "['net', 'NET'", "['efg', 'eFG%'", "['tov', 'TOV%'", "['oreb', 'OREB%'", "['ftr', 'FTr'",
     "['defg', 'OPP eFG%'", "['dtov', 'OPP TOV%'", "['drb', 'DREB%'", "['dftr', 'OPP FTr'"].every(x => RT.includes(x)));
  ok('the Sunday email\'s opposition reports carry them, compared with the address\'s club', /&tab=report&rpvs=\$\{team\.id\}&rpadd=cmp,lmisc`/.test(MJ));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
