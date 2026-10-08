/* ============================================================================
   THE SCOUT'S INSIGHTS (epinoia/scoutinsights.js): a written read on the scouting report of a club or a player, from the
   report's own numbers (Louie, 2026-10-08). Held here: what is said is what stands out (the top and bottom quarters, the
   most salient first), every claim with its number and its place, the scout's words used only with the evidence the
   lexicon pairs them with (a big's rim volume is interior finishing, not "plays downhill"), no advice another measure
   contradicts, the box score and the on/off said together when they disagree, the editor's scout register (the fan's
   model-speak rules off, the near-copy rule on), and the section on the tab, never in the PDF.

     node supabase/tests/scoutinsights.test.mjs
   ============================================================================ */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const E = p => path.join(ROOT, 'epinoia', p);
globalThis.EpinoiaVoice = require(E('voice.js'));
globalThis.EpinoiaScrutiny = require(E('scrutiny.js'));
globalThis.EpinoiaSeason = require(E('season.js'));
const SI = require(E('scoutinsights.js'));
const rd = (...p) => readFileSync(path.join(ROOT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d !== undefined ? '\n          ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 600) : '')); } };

/* a ten-club league where club 'A' is the best at forcing turnovers, the worst on the defensive glass, the most
   three-happy offence, 2nd in half-court defence and 1st in transition defence */
const keys = ['ortg', 'drtg', 'net', 'pace', 'ff_efg', 'ff_tov', 'ff_oreb', 'ff_ftr', 'dff_efg', 'dff_tov', 'dff_oreb', 'dff_ftr',
  'ev_half_ppp', 'evd_half_ppp', 'evd_transition_ppp', 'ev_transition_ppp', 'ev_transition_freq', 'z_three_att100', 'z_rim_att100', 'zd_rim_att100', 'zd_three_att100'];
const teams = [];
for (let i = 0; i < 10; i++) {
  const r = { id: 'T' + i };
  keys.forEach(k => { r[k] = 50 + i; });          // a plain spread, 50 to 59
  r.ev_transition_freq = 14;
  teams.push(r);
}
const A = teams[0];
Object.assign(A, { id: 'A', dff_tov: 99, dff_oreb: 99, z_three_att100: 99, evd_half_ppp: 50.5, evd_transition_ppp: 40, ortg: 55, drtg: 51, net: 4 });
const players = [];
['G', 'F', 'C'].forEach((g, gi) => {
  for (let i = 0; i < 14; i++) players.push({ id: g + i, name: g + ' Player ' + i, _teamId: i < 3 ? 'A' : 'T' + (i % 9 + 1), gp: 10, mpg: 20 + i,
    bpm_pos: gi === 0 ? 1.4 : gi === 1 ? 2.9 : 4.6, usg: 15 + i, ast_pct: gi === 0 ? 20 + i : 6 + i / 2, tov_pct: 12, p3_a100: gi === 2 ? 0.2 : 5 + i,
    p3_pct: 33, p3a: 30, rim_a100: gi === 2 ? 6 + i : 2 + i / 3, rim_pct: 60, ftr: 25 + i, mid_a100: 4, blk_pct: gi === 2 ? 2 + i / 2 : 0.5,
    oreb_pct: 4, stl_pct: 1.5, ft_pct: 75, fta: 40, ts: 52 + i / 2, bpm: i / 3, dbpm: i / 5 - 1, ppg: 8 + i, rpg: 3, apg: 2, jersey: String(i) });
});

console.log('the club');
{
  const r = SI.team({ S: { teams, players }, mine: { id: 'A' } }, { name: 'Alpha City' });
  const txt = x => (x || []).map(y => (typeof y === 'string' ? y : y.text)).join(' | ');
  ok('a read, opening with the club and its ratings', r && r.read.length >= 1 && /^Alpha City/.test(r.read[0]), r && r.read);
  ok('strengths are the top quarter, with the number and the place: forcing turnovers, 1st of 10', /Force turnovers|A pressure defence/.test(txt(r.strengths)) && /99\.0% of opponents’ possessions end in a turnover \(1st of 10\)/.test(txt(r.strengths)), txt(r.strengths));
  ok('weaknesses are the bottom quarter: the defensive glass, 10th of 10', /second chances|finish possessions/.test(txt(r.weaknesses)) && /99\.0% OREB allowed \(10th of 10\)/.test(txt(r.weaknesses)), txt(r.weaknesses));
  ok('a style is not a strength or a weakness: three-point volume is said in the read', !/threes per 100/.test(txt(r.strengths) + txt(r.weaknesses)) && /threes per 100 possessions/.test(r.read.join(' ')), [txt(r.strengths), r.read]);
  ok('the plan takes away what they do well and attacks what they do not, each line with its measure', r.plan.length >= 3 && r.plan.every(p => p.why && /of 10$/.test(p.why)) &&
     /Value the ball/.test(txt(r.plan)) && /offensive glass/.test(txt(r.plan)), txt(r.plan));
  ok('no line another measure contradicts: no "score early" against a side that gets back in transition (1st)', !/Score early/.test(txt(r.plan)), txt(r.plan));
  ok('the personnel: the club\'s rotation, each a role and how to guard him', Array.isArray(r.personnel) && r.personnel.every(p => p.name && p.line), r.personnel);
  const none = SI.team({ S: { teams: teams.slice(0, 4), players }, mine: { id: 'A' } }, { name: 'Alpha City' });
  ok('a league of fewer than six clubs gets no read (a place among four is not a ranking)', none === null);
}

console.log('\nthe player');
{
  const big = players.find(p => p.id === 'C13');
  const rb = SI.player({ mine: big, field: players }, { name: 'C Player 13' });
  const all = rb ? [].concat(rb.read, rb.plan.map(x => x.text), rb.defence) .join(' | ') : '';
  ok('a big is read among the bigs', rb && rb.who === 'bigs', rb && rb.who);
  ok('...his rim volume is interior finishing, never "plays downhill"; no "gap him" for not shooting threes', /Interior finisher/.test(all) && !/downhill|Gap him/.test(all), all);
  const g = players.find(p => p.id === 'G13');
  Object.assign(g, { dbpm: 9, diff_vs_efg: 6, on_poss: 900 });
  const rg = SI.player({ mine: g, field: players }, { name: 'G Player 13' });
  const d = (rg.defence || []).join(' ');
  ok('the box score and the on/off said together when they disagree, never "avoid him" and "go at him" at once',
     /box score likes his defence/.test(d) && !/^Avoid him/.test(d) && !/go at him/.test(d), rg.defence);
  Object.assign(g, { on_poss: 120 });
  const small = SI.player({ mine: g, field: players }, { name: 'G Player 13' });
  ok('...and the on/off only on a real sample (300 possessions)', !/better \(eFG\)/.test((small.defence || []).join(' ')), small.defence);
  ok('the top of his position said as a word, not "100th percentile"', /the highest among guards/.test(JSON.stringify(rg)) && !/100th percentile/.test(JSON.stringify(rg)), JSON.stringify(rg).slice(0, 400));
}

console.log('\nthe editor, in a scout\'s register');
{
  const S = globalThis.EpinoiaScrutiny;
  const q = S.scrutinise({ kind: 'scout', head: 'x', dek: '', body: ['They win the four factors at both ends.', 'Crash the offensive glass hard and punish every long rebound chance.', 'Crash the offensive glass hard and punish every long rebound chance.'] }, { log: [], clubs: [], register: 'scout' });
  ok('a scout\'s words survive ("the four factors"): the fan\'s model-speak rules are off', /four factors/.test(q.piece.body[0]), q.piece.body);
  ok('...the near-copy rule is on: a line said twice is said once', q.piece.body.filter(x => x && /Crash the offensive glass/.test(x)).length === 1, q.piece.body);
  ok('...and nothing is held back as a piece to post', q.report.held.length === 0, q.report.held);
}

{
  /* the editor drops a line said twice: the lines after it keep their own sections (read by position, a weakness was once
     printed as a strength) */
  const dup = SI.team({ S: { teams, players }, mine: { id: 'A' } }, { name: 'Alpha City' });
  const W = dup.weaknesses.map(x => x.text).join(' ');
  ok('a strength is never printed from a weakness\'s words, nor the other way round',
     dup.strengths.every(x => !/below-par|Rarely|Give up|Struggle|Turnover-prone|Do little/.test(x.text)) && !/Force turnovers|Contest well|Hard to turn over/.test(W),
     [dup.strengths.map(x => x.text), W]);
  ok('a clause in the read reads as a sentence ("force turnovers on 99.0% of possessions")', /force turnovers on 99\.0% of possessions \(1st of 10\)/.test(dup.read.join(' ')), dup.read);
}

console.log('\nthe markup and the wiring');
{
  const r = SI.team({ S: { teams, players }, mine: { id: 'A' } }, { name: 'Alpha City' });
  const h = SI.html(r, { scope: 'NBL' });
  ok('it folds, and opens closed: a <details> with its heading as the button, no open attribute', /^<details class="rp-ins"[^>]*>/.test(h) && !/<details[^>]*\bopen\b/.test(h) && /<summary class="rp-ins-hd">/.test(h), h.slice(0, 200));
  ok('...and the tab keeps it as the reader left it when the report is built again', /const open = !!\(was && was\.open\);/.test(rd('epinoia', 'report.js')) && /if \(now && open\) now\.open = true;/.test(rd('epinoia', 'report.js')));
  ok('one section: the read, strengths and weaknesses side by side, the plan with its measures, the personnel', /class="rp-ins"/.test(h) && /<h4>Strengths<\/h4>/.test(h) && /<h4>Weaknesses<\/h4>/.test(h) && /How to prepare/.test(h) && /rp-ins-why/.test(h) && /Personnel/.test(h));
  ok('...names are never translated', /translate="no"/.test(h));
  ok('nothing to draw, nothing drawn', SI.html(null) === '');
  /* THE ROW SELLS WHAT IS INSIDE (Louie, 2026-10-08: "a more visible dropdown row") */
  const sum = h.slice(h.indexOf('<summary'), h.indexOf('</summary>'));
  const esc1 = t => t.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  ok('the folded row: a kicker, "Insights on" the club (its name untranslated), the read\'s first line as a teaser',
     /<span class="rp-ins-kick">The scout’s read · NBL<\/span>/.test(sum) && /<h3>Insights <span class="rp-ins-on">on <span translate="no">Alpha City<\/span><\/span><\/h3>/.test(sum) &&
     sum.includes('<span class="rp-ins-tease" aria-hidden="true">' + esc1(r.read[0]) + '</span>'), sum.slice(0, 500));
  ok('...what the fold holds, counted as it is', sum.includes('<span>' + r.strengths.length + ' strength' + (r.strengths.length === 1 ? '' : 's') + '</span>') &&
     sum.includes('<span>' + r.weaknesses.length + (r.weaknesses.length === 1 ? ' weakness' : ' weaknesses') + '</span>') &&
     sum.includes('<span>' + r.plan.length + '-point game plan</span>') && sum.includes('<span>' + r.personnel.length + ' players scouted</span>'), sum);
  ok('...and a button in the kit\'s primary saying what a press does, "Read the insights" closed and "Hide" open',
     /<span class="ep-btn pri rp-ins-act"><span class="rp-ins-act-o">Read the insights<\/span><span class="rp-ins-act-c">Hide<\/span>/.test(sum) &&
     /\.rp-ins\[open\] \.rp-ins-act-o\{ display:none \}/.test(rd('epinoia', 'kit', 'report.css')) && /\.rp-ins\[open\] \.rp-ins-act-c\{ display:inline \}/.test(rd('epinoia', 'kit', 'report.css')));
  ok('...a summary holds phrasing content only: no <p> or <div> inside the row', !/<(p|div)[\s>]/.test(sum), sum);
  ok('...open, the teaser and the counts give way to what they stood for', /\.rp-ins\[open\] \.rp-ins-tease, \.rp-ins\[open\] \.rp-ins-chips\{ display:none \}/.test(rd('epinoia', 'kit', 'report.css')));
  const pr = SI.player({ mine: players.find(p => p.id === 'G12'), field: players }, { name: 'G Player 12' });
  const ps = SI.html(pr, { scope: 'NBL' });
  ok('a player\'s row counts the ways to guard him, and no personnel', pr && /<span>\d+ ways? to guard him<\/span>/.test(ps) && !/players scouted/.test(ps), ps.slice(0, 600));
  const rj = rd('epinoia', 'report.js');
  ok('the tab draws it FIRST, above the controls (Louie: "promoted"), and never in the pages (only they are printed and drawn into the PDF)',
     /const ins = el\('div', 'rp-ins-slot'\);/.test(rj) && rj.indexOf('wrap.appendChild(ins);') > 0 &&
     rj.indexOf('wrap.appendChild(ins);') < rj.indexOf('wrap.appendChild(bar);') && rj.indexOf('wrap.appendChild(bar);') < rj.indexOf('wrap.appendChild(pages);') &&
     /if \(typeof o\.insights === 'function'\)/.test(rj));
  ok('...holding its place with a "reading" row until the first build has it, so the controls do not jump down when it lands',
     /ins\.innerHTML = '<div class="rp-ins rp-ins-wait" aria-busy="true">/.test(rj) && /Reading this report’s numbers…/.test(rj));
  ok('...and a build that fails leaves no "reading" row behind', /if \(run === state\.running && state\.ins\.querySelector\('\.rp-ins-wait'\)\) state\.ins\.hidden = true;/.test(rj));
  ok('the print stylesheet leaves it out', /@media print\{ \.rp-ins-slot\{ display:none !important \} \}/.test(rd('epinoia', 'kit', 'report.css')));
  ok('the competitions picker stays hidden for a club in one competition ([hidden] holds against .rp-f\'s display:flex)',
     /\.rp-f\[hidden\]\{ display:none \}/.test(rd('epinoia', 'kit', 'report.css')) && /sc\.hidden = true;/.test(rj));
  ok('the club page hands it its season, the player page his line and field',
     /SI\.html\(SI\.team\(T, \{ name: team\.name \}\)/.test(rd('epinoia', 't', 'team.js')) && /SI\.html\(SI\.player\(\{ mine: B\.mine, field: B\.field \}, \{ name \}\)/.test(rd('epinoia', 'p', 'player.js')));
  for (const pg of [['t', 'index.html'], ['p', 'index.html']]) {
    const s = rd('epinoia', ...pg);
    ok(pg.join('/') + ' loads the voice, the editor and the writer', /voice\.js\?v=/.test(s) && /scrutiny\.js\?v=/.test(s) && /scoutinsights\.js\?v=/.test(s));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
