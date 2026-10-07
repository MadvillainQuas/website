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
ok('each linked profile of his season counted as his', /new Map\(cs\.filter\(c => c\.pid && c\.pid !== pl\.id\)\.map\(c => \[c\.pid, pl\.id\]\)\)/.test(P));
ok('only his clubs\' games are read', /or=\(home_team_id\.in\.\(\$\{tids\.join\(','\)\}\),away_team_id\.in\./.test(P));
ok('his joint line takes his row\'s place in the page\'s field', /out\.field = \(B\.field \|\| \[\]\)\.map\(r => \(r === B\.mine \? J : r\)\)/.test(P));
ok('offered when his season has more than one competition, said on the cover', /RP_SEASON\.comps\.length > 1/.test(P) && /' · ranked among the players of ' \+ scopeText\(\)/.test(P));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
