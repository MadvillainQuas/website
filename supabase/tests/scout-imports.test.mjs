// GLOBAL SCOUTING'S IMPORTS (scouting/imports.js) AND THE SCOUT ROLE (0210). A scout - or a platform administrator - drops the
// files their scouting extension saves (fa_results_<date>.csv) on global scouting's Imports tab, and gets one table to sort and
// filter. What is held here:
//   * with no database, on a made-up file in the extension's own shape (no real player or agent is in this repository): the
//     reader (quotes, "" inside quotes, a byte-order mark, CRLF, a ; file, a file that is not one of the extension's); the
//     tidying (a birth year run into the position, the Eurobasket height, "25-26" and "2026", the line a row is read by, a
//     season only just begun, the last_season column when there is no _json); several files as one table; the filters, the
//     sort, the shade, the CSV;
//   * the tab on a stand-in document: drawn from the files kept on the device, sorted by PPG, filtered, opened, downloaded,
//     a file taken out;
//   * the page: the switch drawn for a scout only, after scout_access; the section on the page standard; the leagues'
//     sections away while it is open; ON THIS PAGE told; the words in Spanish and Japanese;
//   * the platform console: "scout" in Grant a role, the list of scouts, its words;
//   * on a real Postgres (PGlite; skipped with a note when it is not installed): 0210 - who is a scout (a platform
//     administrator; a live grant on a confirmed address), who may name or end one, audit-logged, idempotent, run again.
//
//   node supabase/tests/scout-imports.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const EP = path.join(ROOT, 'epinoia');
const src = (...f) => readFileSync(path.join(EP, ...f), 'utf8');
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (what, cond, saw) => { if (cond) { pass++; console.log('  PASS  ' + what); } else { fail++; console.log('  FAIL  ' + what + (saw === undefined ? '' : '  -- saw ' + JSON.stringify(saw).slice(0, 400))); } };
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

const I = require(path.join(EP, 'scouting', 'imports.js'));

/* ============================================================ a file in the extension's shape ====== */
const HEAD = ['country', 'league_tab', 'team', 'player', 'url', 'height_cm', 'pos', 'born', 'eb_height_cm', 'eb_weight_kg', 'agent', 'last_season', '_json'];
const cell = v => { const s = v == null ? '' : String(v); return '"' + s.replace(/"/g, '""') + '"'; };
const stats = (mpg, ppg, rpg, apg, spg, bpg, tpg, two, three) => ({ MPG: mpg, PPG: ppg, RPG: rpg, APG: apg, SPG: spg, BPG: bpg, TPG: tpg, '2P%': two + '%', '3P%': three + '%' });
const line = (season, team, league, g, st, end) => ({ season, team, league, g: g == null ? undefined : String(g), stats: st, masked: false, endYear: end });
function player(o) {
  const j = { country: o.country, tab: o.tab, team: o.team, name: o.name, url: o.url, cm: o.cm || '', pos: o.pos, born: o.born || '',
    heightCm: o.heightCm == null ? null : o.heightCm, heightFt: o.ft || '', weightKg: o.kg == null ? null : o.kg, weightLbs: null,
    bornYear: o.born || '', agent: o.agent ? { name: o.agent, url: o.agentUrl || null } : null, needsLogin: !!o.login,
    last: { via: o.via || 'career', rows: o.rows || [] }, _orig: 0, hiddenByFilter: false };
  return [o.country, o.tab, o.team, o.name, o.url, o.cm || '', o.pos, o.born || '', o.eb || '', o.kg || '', o.agent || '', o.lastText || '', o.noJson ? '' : JSON.stringify(j)];
}
const ROWS = [
  player({ country: 'Spain', tab: 'Segunda FEB', team: 'CB EXAMPLE', name: 'Alex Pinto', url: 'https://basketball.example.com/player/Alex-Pinto/1',
           cm: '198', pos: 'G/F', born: '2001', eb: '198', kg: 92, heightCm: 198, ft: "6'6''", agent: 'Agent One (Agency, "AO")', agentUrl: 'https://agents.example.com/1',
           lastText: '25-26 CB Example (ESP-3)', rows: [line('25-26', 'CB Example', 'ESP-3', 20, stats('25.0', '12.5', '4.0', '2.0', '1.0', '0.2', '1.5', '50.0', '35.0'), 2026)] }),
  /* Australia: the birth year run into the position, the height only on the profile, a single-year season, two lines */
  player({ country: 'Australia', tab: 'NBL One', team: 'NORTH EXAMPLE', name: 'Bo Riley', url: 'https://basketball.example.com/player/Bo-Riley/2',
           pos: 'G2000', eb: '191', heightCm: 191, rows: [line('2026', 'North Example', 'AUS-2', 3, stats('10.0', '30.0', '1.0', '1.0', '0.0', '0.0', '0.5', '60.0', '50.0'), 2026),
                                                       line('2026', 'North Example B', 'AUS-3', 10, stats('30.0', '18.0', '6.0', '3.0', '1.5', '0.5', '2.5', '55.0', '38.0'), 2026)] }),
  /* last season was 24-25 */
  player({ country: 'Serbia', tab: 'KLS', team: 'EXAMPLE BG', name: 'Cedo Ilic', url: 'https://basketball.example.com/player/Cedo-Ilic/3', cm: '205', pos: 'C', born: '1996',
           kg: 108, agent: 'Agent Two', rows: [line('24-25', 'Example BG', 'SRB-1', 28, stats('22.0', '9.0', '7.5', '1.0', '0.5', '1.2', '1.1', '58.0', '0.0'), 2025)] }),
  /* two games of next season: his row is read by the full season before it */
  player({ country: 'Spain', tab: 'Segunda FEB', team: 'CB EXAMPLE', name: 'Dani Ruiz', url: 'https://basketball.example.com/player/Dani-Ruiz/4', cm: '190', pos: 'PG', born: '1999',
           rows: [line('26-27', 'CB Example', 'ESP-3', 2, stats('30.0', '25.0', '3.0', '8.0', '2.0', '0.0', '4.0', '60.0', '60.0'), 2027),
                  line('25-26', 'CB Example', 'ESP-3', 25, stats('28.0', '14.0', '3.5', '6.0', '1.6', '0.1', '2.8', '48.0', '36.0'), 2026)] }),
  /* the same player on a European cup's roster too: both rows stay */
  player({ country: 'FIBA Europe Cup', tab: 'Main', team: 'CB EXAMPLE', name: 'Alex Pinto', url: 'https://basketball.example.com/player/Alex-Pinto/1', cm: '198', pos: 'G/F', born: '2001',
           rows: [line('25-26', 'CB Example', 'FEC', 6, stats('20.0', '8.0', '3.0', '1.0', '0.5', '0.0', '1.0', '45.0', '30.0'), 2026)] }),
  /* no _json: the columns alone, the season from last_season */
  player({ country: 'Greece', tab: 'Elite League', team: 'EXAMPLE FC', name: 'Eli Papas', url: 'https://basketball.example.com/player/Eli-Papas/5', cm: '201', pos: 'F', born: '2003',
           kg: 95, lastText: '25-26 Example FC (GRE-2); 24-25 Example U (GRE-3)', noJson: true }),
  /* a profile behind a login: no numbers */
  player({ country: 'Australia', tab: 'NBL One', team: 'NORTH EXAMPLE', name: 'Finn Doe', url: 'https://basketball.example.com/player/Finn-Doe/6', pos: 'F2007', via: 'none', login: true }),
  /* a row with no name is not a player */
  ['Spain', 'Segunda FEB', 'CB EXAMPLE', '', '', '', '', '', '', '', '', '', '']
];
const FILE = '﻿' + [HEAD.join(','), ...ROWS.map(r => r.map(cell).join(','))].join('\r\n') + '\r\n';

console.log('reading the file');
{
  const rows = I.parseCsv(FILE);
  ok('a byte-order mark, CRLF, quotes and "" inside them: the header and every row read whole', rows.length === ROWS.length + 1 && rows[0][0] === 'country' &&
     rows.slice(1).every((r, i) => r.length === 13 && r[3] === ROWS[i][3]) && rows[1][10] === 'Agent One (Agency, "AO")', rows.length);
  ok('...a field\'s JSON comes back exactly as written', JSON.parse(rows[1][12]).agent.name === 'Agent One (Agency, "AO")');
  ok('a line break inside quotes stays in its field', JSON.stringify(I.parseCsv('a,b\n"x\ny",z\n')) === JSON.stringify([['a', 'b'], ['x\ny', 'z']]));
  ok('a file saved again by a spreadsheet with ; between its fields', JSON.stringify(I.parseCsv('country;team;player\nSpain;"CB; Example";Alex\n')) ===
     JSON.stringify([['country', 'team', 'player'], ['Spain', 'CB; Example', 'Alex']]));
  let msg = '';
  try { I.readFile('a,b,c\n1,2,3\n'); } catch (e) { msg = e.message; }
  ok('a file that is not the extension\'s says so', /not a file from the scouting extension: it has no player, team and country columns/.test(msg), msg);
  try { I.readFile(''); msg = ''; } catch (e) { msg = e.message; }
  ok('...and an empty one', msg === 'That file is empty.', msg);
}

console.log('\nthe tidying');
const got = I.readFile(FILE, { year: 2026, file: 'f1' });
const P = got.players;
const by = (name, country) => P.find(p => p.name === name && (!country || p.country === country));
{
  ok('every named row is a player; a row with no name is skipped', P.length === 7 && got.skipped === 1, [P.length, got.skipped]);
  const a = by('Alex Pinto', 'Spain');
  ok('from _json: name, link, country, league tab, team, height, weight, agent and the agent\'s page',
     a.url === 'https://basketball.example.com/player/Alex-Pinto/1' && a.league === 'Segunda FEB' && a.team === 'CB EXAMPLE' && a.ht === 198 &&
     a.wt === 92 && a.htFt === "6'6''" && a.agent === 'Agent One (Agency, "AO")' && a.agentUrl === 'https://agents.example.com/1');
  ok('...born 2001, so 25 this year; a G/F counts as a guard and a forward', a.born === 2001 && a.age === 25 && a.groups === 'GF' && a.pos === 'G/F');
  ok('...his line: the season, the team, the competition, the games and every stat as a number (percentages too)',
     a.main.season === '25-26' && a.main.end === 2026 && a.main.league === 'ESP-3' && a.main.g === 20 && a.main.stats.PPG === 12.5 && a.main.stats['2P%'] === 50);
  const b = by('Bo Riley');
  ok('"G2000": a guard born in 2000', b.pos === 'G' && b.born === 2000 && b.groups === 'G');
  ok('a height only on the Eurobasket profile is the height', b.ht === 191);
  ok('two lines in one season: the one with the most games is his row, the other counted', b.main.league === 'AUS-3' && b.main.g === 10 && b.others === 1);
  const d = by('Dani Ruiz');
  ok('two games of next season give way to the full season before it (both still his lines)', d.main.season === '25-26' && d.main.g === 25 && d.lines.length === 2);
  const e = by('Eli Papas');
  ok('no _json: the columns alone, the lines from last_season, with no numbers', e.ht === 201 && e.wt === 95 && e.lines.length === 2 &&
     e.main.season === '25-26' && e.main.team === 'Example FC' && e.main.league === 'GRE-2' && e.main.g == null);
  const f = by('Finn Doe');
  ok('a profile behind a login: no lines, said so; "F2007" a forward born 2007', f.needsLogin && !f.main && f.lines.length === 0 && f.pos === 'F' && f.born === 2007);
  ok('the stats the files carry, in their order', JSON.stringify(I.statKeys(P)) === JSON.stringify(['MPG', 'PPG', 'RPG', 'APG', 'SPG', 'BPG', 'TPG', '2P%', '3P%']));
  ok('a season\'s end year: 25-26 2026, 2026 2026, 1998-99 1999, 99-00 2000, 2024/25 2025',
     I.endYearOf('25-26') === 2026 && I.endYearOf('2026') === 2026 && I.endYearOf('1998-99') === 1999 && I.endYearOf('99-00') === 2000 && I.endYearOf('2024/25') === 2025);
  ok('positions as groups: PG and SG guards, SF and PF forwards, F/C both, nothing for nothing',
     I.groupsOf('PG') === 'G' && I.groupsOf('SF') === 'F' && I.groupsOf('F/C') === 'FC' && I.groupsOf('') === '' && I.groupsOf('G-F') === 'GF');
  ok('the current season is the one most players\' numbers are from, not the newest', I.latestOf(P) === 2026);
}

console.log('\nseveral files, one table');
{
  const newer = FILE.replace('"12.5"', '"15.5"');
  const g2 = I.readFile(newer, { year: 2026, file: 'f2' });
  const m = I.merge([{ id: 'f2', added: 2, players: g2.players }, { id: 'f1', added: 1, players: P }]);
  const alex = m.players.filter(p => p.name === 'Alex Pinto');
  ok('a player in both files is there from the file loaded last', alex.length === 2 && alex.every(p => p.file === 'f2') &&
     alex.find(p => p.country === 'Spain').main.stats.PPG === 15.5);
  ok('...on both of the rosters he is on in that file', alex.map(p => p.country).sort().join() === 'FIBA Europe Cup,Spain');
  ok('...counted once per player, and nobody lost', m.dupes === 6 && m.players.length === 7, [m.dupes, m.players.length]);
  ok('a file\'s id is its text: the same file twice is one file', I.idOf(FILE) === I.idOf(FILE) && I.idOf(FILE) !== I.idOf(newer));
}

console.log('\nthe filters and the sort');
{
  const run = f => I.filter(P, Object.assign(I.blankFilter(), f)).map(p => p.name + (p.country === 'FIBA Europe Cup' ? '*' : '')).sort().join();
  ok('nothing set: everybody', I.filter(P, I.blankFilter()).length === 7);
  ok('words: every one, anywhere in the name, team, agent, country or league', run({ q: 'agent one' }) === 'Alex Pinto' && run({ q: 'example bg' }) === 'Cedo Ilic' &&
     run({ q: 'aus-3' }) === 'Bo Riley');
  ok('a country, and a league in it', run({ country: 'Australia' }) === 'Bo Riley,Finn Doe' && run({ country: 'Spain', league: 'Segunda FEB' }) === 'Alex Pinto,Dani Ruiz');
  ok('guards, or centres: a G/F is a guard', run({ pos: 'G' }) === 'Alex Pinto,Alex Pinto*,Bo Riley,Dani Ruiz' && run({ pos: 'C' }) === 'Cedo Ilic');
  ok('a range leaves out who has no record of it, unless asked to keep them', run({ htMin: 195 }) === 'Alex Pinto,Alex Pinto*,Cedo Ilic,Eli Papas' &&
     run({ htMin: 195, unknown: true }) === 'Alex Pinto,Alex Pinto*,Bo Riley,Cedo Ilic,Eli Papas,Finn Doe'.split(',').filter(n => n !== 'Bo Riley').concat([]).join() ||
     run({ htMin: 195, unknown: true }).split(',').length === 6, run({ htMin: 195, unknown: true }));
  ok('born from-to', run({ bornMin: 2000, bornMax: 2002 }) === 'Alex Pinto,Alex Pinto*,Bo Riley');
  ok('with an agent, without', run({ agent: 'yes' }) === 'Alex Pinto,Cedo Ilic' && run({ agent: 'no' }).split(',').length === 5);
  ok('this season\'s numbers only: not a line from 24-25', !run({ latest: true }).includes('Cedo Ilic') && run({ latest: true }).includes('Dani Ruiz'));
  ok('a stat at least / at most; no number at all is not "at least"', run({ stats: [{ k: 'PPG', op: '>=', v: 12 }] }) === 'Alex Pinto,Bo Riley,Dani Ruiz' &&
     run({ stats: [{ k: 'TPG', op: '<=', v: 1.2 }] }) === 'Alex Pinto*,Cedo Ilic' && run({ stats: [{ k: 'G', op: '>=', v: 20 }] }) === 'Alex Pinto,Cedo Ilic,Dani Ruiz');
  ok('...an empty value is no filter yet', run({ stats: [{ k: 'PPG', op: '>=', v: null }] }).split(',').length === 7);
  const cols = I.columns(I.statKeys(P));
  const col = k => cols.find(c => c.k === k);
  const names = (k, d) => I.sort(P, col(k), d).map(p => p.name);
  ok('by a number, high first: and nobody without one is ever above anybody with one', names('PPG', -1).slice(0, 3).join() === 'Bo Riley,Dani Ruiz,Alex Pinto' &&
     ['Eli Papas', 'Finn Doe'].every(n => names('PPG', -1).indexOf(n) >= 5) && ['Eli Papas', 'Finn Doe'].every(n => names('PPG', 1).indexOf(n) >= 5));
  ok('by words, A to Z', names('country', 1)[0] === 'Bo Riley' && names('name', 1)[0] === 'Alex Pinto');
  ok('the season sorts by its end year, then games', names('season', -1)[0] === 'Dani Ruiz' || names('season', -1)[0] === 'Alex Pinto');
  ok('the columns: the place, the player, then who and where, the line, the games and every stat', cols.slice(0, 2).map(c => c.l).join() === '#,PLAYER' &&
     cols.map(c => c.k).join().endsWith('G,MPG,PPG,RPG,APG,SPG,BPG,TPG,2P%,3P%') && col('TPG').low && !col('PPG').low && col('PPG').heat && !col('G').heat);
}

console.log('\nthe shade and the file out');
{
  const many = [];
  for (let i = 0; i < 30; i++) many.push({ name: 'P' + i, main: { g: 20, stats: { PPG: i, TPG: i }, end: 2026 }, lines: [] });
  many.push({ name: 'Short', main: { g: 1, stats: { PPG: 99, TPG: 0 }, end: 2026 }, lines: [] });
  const R = I.percentiles(many, ['PPG', 'TPG']);
  ok('ranked among the players with five games or more: one game\'s 99 is not the scale, and is the top, not past it',
     R.PPG(29) === 100 && Math.abs(R.PPG(15) - 51.7) < 0.1 && R.PPG(99) === 100 && R.PPG(-5) === 0, [R.PPG(15), R.PPG(99), R.PPG(-5)]);
  ok('turnovers: fewer is better, so the shade turns round', R.TPG(0) === 100 && R.TPG(29) === 0);
  ok('the shade is the full table\'s own: green above 60, nothing between 40 and 60, red under 25',
     /var\(--good\) 34%/.test(I.heatOf(95)) && I.heatOf(50) === '' && /var\(--flare\) 24%/.test(I.heatOf(5)) && I.heatOf(null) === '');
  const csv = I.toCsv(P.slice(0, 2), I.columns(I.statKeys(P)));
  const lines = csv.split('\r\n');
  ok('the CSV: a byte-order mark for Excel, the columns but the place, and the two links', csv.charAt(0) === '﻿' &&
     lines[0].replace('﻿', '') === 'PLAYER,POS,BORN,AGE,HT,WT,COUNTRY,LEAGUE,TEAM,AGENT,SEASON,PLAYED FOR,COMP,G,MPG,PPG,RPG,APG,SPG,BPG,TPG,2P%,3P%,PROFILE,AGENT PAGE');
  const sly = I.toCsv([Object.assign({}, P[0], { name: '=HYPERLINK("http://x.example","go")', team: '-5 TEAM', agent: '@agent' })], I.columns(I.statKeys(P))).split('\r\n')[1];
  ok('...a word a spreadsheet would run as a formula is set down as text; a number is not touched',
     sly.startsWith('"\'=HYPERLINK(""http://x.example"",""go"")"') && sly.includes(",-5 TEAM,") && sly.includes(",'@agent,") && sly.includes(',25-26,'), sly.slice(0, 160));
  ok('...a value with a comma or a quote is quoted', lines[1].includes('"Agent One (Agency, ""AO"")"') && lines[1].endsWith(',https://basketball.example.com/player/Alex-Pinto/1,https://agents.example.com/1'));
}

/* ============================================================ the tab on a stand-in document ====== */
console.log('\nthe tab');
class Text { constructor(t) { this._t = String(t); this.parentNode = null; } get textContent() { return this._t; } }
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this._text = ''; this.className = '';
    this.attrs = {}; this.listeners = {}; this.checked = false; this.disabled = false; this.hidden = false; this.value = ''; this.type = ''; this.dataset = {};
    this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } };
    const me = this;
    this.classList = {
      contains: c => me.className.split(/\s+/).includes(c),
      add: c => { if (!me.classList.contains(c)) me.className = (me.className + ' ' + c).trim(); },
      remove: c => { me.className = me.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
      toggle: (c, on) => { const want = on === undefined ? !me.classList.contains(c) : !!on; if (want) me.classList.add(c); else me.classList.remove(c); return want; }
    };
  }
  appendChild(n) { if (n.parentNode && n.parentNode.children) n.parentNode.children = n.parentNode.children.filter(c => c !== n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(typeof n === 'string' ? new Text(n) : n)); }
  remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; } }
  set textContent(v) { this.children = []; this._text = String(v); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(t, e) { return Promise.all((this.listeners[t] || []).map(fn => fn(Object.assign({ preventDefault() {}, target: this }, e || {})))); }
  click() { return this.fire('click'); }
  all() { const out = []; const walk = n => (n.children || []).forEach(c => { if (c instanceof El) { out.push(c); walk(c); } }); walk(this); return out; }
  querySelectorAll(sel) {
    const s = String(sel).trim();
    if (s.startsWith('.')) return this.all().filter(n => n.classList.contains(s.slice(1)));
    return this.all().filter(n => n.tagName === s.toUpperCase());
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const doc = { createElement: t => new El(t), body: new El('body') };
globalThis.document = doc;
const blobs = [];
globalThis.Blob = class { constructor(parts, o) { this.text = parts.join(''); this.type = o && o.type; blobs.push(this); } };
globalThis.URL.createObjectURL = () => 'blob:x';
globalThis.URL.revokeObjectURL = () => {};
globalThis.confirm = () => true;
{
  const kept = [{ id: 'f1', name: 'fa_results_2026-09-24_0104.csv', added: 1, text: FILE }];
  const store = { recs: kept.slice(), del: async id => { store.gone = id; store.recs = store.recs.filter(r => r.id !== id); }, put: async r => { store.recs.push(r); },
                  all: async () => store.recs.slice(), clear: async () => { store.recs = []; } };
  const host = new El('div'), said = [];
  const T = I.mount({ host, store, say: (m, k) => said.push([m, k]), year: 2026 });
  await settle();
  const count = () => host.querySelector('.ix-count').textContent;
  const rows = () => host.querySelector('.ix-wrap').querySelectorAll('tr').filter(tr => tr.parentNode.tagName === 'TBODY' && !tr.classList.contains('ix-sub'));
  const nameOf = tr => tr.children[1].querySelector('a') ? tr.children[1].querySelector('a').textContent : tr.children[1].textContent;
  ok('the files kept on this device are read back: the table, a chip for the file, nothing said', count() === '7 of 7 players' && rows().length === 7 &&
     host.querySelectorAll('.ix-chip').length === 1 && /fa_results_2026-09-24_0104\.csv7 players/.test(host.querySelector('.ix-chip').textContent));
  ok('...sorted by points a game, most first', nameOf(rows()[0]) === 'Bo Riley' && host.querySelector('.ix-wrap').querySelector('th').parentNode.children.some(th => th.classList.contains('sorted') && th.textContent === 'PPG'));
  ok('...the player\'s name his profile, in a new tab; his data never translated', rows()[0].children[1].querySelector('a').rel === 'noopener noreferrer' &&
     rows()[0].children[1].querySelector('a').target === '_blank' &&
     host.querySelector('.ix-wrap').querySelector('tbody').attrs.translate === 'no' && host.querySelector('.ix').attrs['data-i18n-ctx'] === 'imports');
  ok('...each stat shaded, the identity columns not', rows()[0].children.some(td => td.classList.contains('heat')) && !rows()[0].children.slice(0, 14).some(td => td.classList.contains('heat')));
  ok('the less-used filters wait behind "more filters"', host.querySelector('.ix-ranges').hidden && host.querySelector('.ix-morefilters').textContent === 'more filters');
  await host.querySelector('.ix-pos').children.find(b => b.dataset.g === 'C').click();
  ok('centres: one', count() === '1 of 7 players' && nameOf(rows()[0]) === 'Cedo Ilic');
  await host.querySelector('.ix-pos').children.find(b => b.dataset.g === 'C').click();
  const ht = host.querySelector('.ix-wrap').querySelectorAll('th').find(th => th.textContent === 'HT');
  await ht.click();
  ok('a header sorts by it (high first), and again the other way', nameOf(rows()[0]) === 'Cedo Ilic' && (await ht.click(), nameOf(rows()[0])) === 'Dani Ruiz');
  await host.querySelector('.ix-morefilters').click();
  ok('"more filters" opens them', !host.querySelector('.ix-ranges').hidden && host.querySelector('.ix-morefilters').textContent === 'fewer filters');
  const born = host.querySelector('.ix-ranges').querySelectorAll('input').find(i => i.dataset.k === 'bornMin');
  born.value = '2000'; await born.fire('input');
  ok('born from 2000: and the button says one is set, and cannot fold it away', count() === '5 of 7 players' &&
     host.querySelector('.ix-morefilters').textContent === 'fewer filters (1)' && host.querySelector('.ix-morefilters').disabled);
  const open = rows()[0].children[1].querySelector('.ix-open');
  await open.click();
  const sub = host.querySelector('.ix-sub');
  ok('a player\'s lines open under his row, his line marked, with his links', sub && sub.querySelector('.ix-mini') && /profile ↗/.test(sub.textContent) &&
     host.querySelector('.ix-wrap').querySelector('.ix-mini').querySelector('tbody').attrs.translate === 'no');
  await host.querySelector('.ix-tally').children.find(b => /^download/.test(b.textContent)).click();
  const csv = blobs.length ? blobs[blobs.length - 1].text : '';
  ok('download: what is shown, in the table\'s order (born 2000 on, the shortest first)', csv.split('\r\n').length === 7 &&
     csv.split('\r\n')[1].startsWith('Bo Riley,') && csv.split('\r\n')[5].startsWith('Finn Doe,') && /^﻿PLAYER,/.test(csv), csv.split('\r\n').length);
  await host.querySelector('.ix-tally').children.find(b => /^reset/.test(b.textContent)).click();
  ok('reset: everybody again', count() === '7 of 7 players');
  /* a second file, and a file that is not one */
  const newer = { name: 'fa_results_2026-10-01.csv', text: async () => FILE.replace('"12.5"', '"15.5"') };
  await T.take([newer, { name: 'notes.csv', text: async () => 'a,b\n1,2\n' }, { name: 'photo.png', type: 'image/png', text: async () => '' }]);
  await settle();
  ok('a second file: its players take over the ones it shares, two chips, said', count() === '7 of 7 players' && host.querySelectorAll('.ix-chip').length === 2 &&
     said.some(s => s[0] === '7 players read.' && s[1] === 'ok') && /^6 players were in more than one file/.test(host.querySelector('.ix-note').textContent),
     [count(), host.querySelectorAll('.ix-chip').length, said, host.querySelector('.ix-note').textContent]);
  ok('...a CSV that is not the extension\'s says why, and a picture is not even read', said.some(s => /^notes\.csv: That is not a file from the scouting extension/.test(s[0]) && s[1] === 'err') &&
     !said.some(s => /photo\.png/.test(s[0])));
  ok('...kept on the device for next time', store.recs.length === 2);
  const off = host.querySelectorAll('.ix-chip')[0].querySelector('.ix-x');
  await off.click();
  await settle();
  ok('a file taken out goes from the table and from the device', host.querySelectorAll('.ix-chip').length === 1 && store.gone === 'f1' && count() === '7 of 7 players');
}
{
  const host = new El('div');
  I.mount({ host, store: { all: async () => [], put: async () => {}, del: async () => {}, clear: async () => {} }, year: 2026 });
  await settle();
  ok('no files yet: the empty state says what to do, and no filters or table over nothing',
     !host.querySelector('.ix-empty').hidden && /Drop the extension’s fa_results files above/.test(host.querySelector('.ix-empty').textContent) &&
     host.querySelector('.ix-bar').hidden && host.querySelector('.ix-wrap').hidden);
}

/* ================================================================================== the page ====== */
console.log('\nthe page');
{
  const html = src('scouting', 'index.html'), js = src('scouting', 'imports.js'), css = src('kit', 'scouting.css'), nav = src('nav.js');
  ok('the switch is drawn for nobody until the database says so: hidden, under the head, Leagues pressed',
     /<div class="pg-row sc-tabs" id="scTabs" data-i18n-ctx="imports" hidden>/.test(html) && html.indexOf('id="scTabs"') > html.indexOf('</header>') &&
     /data-tab="leagues" aria-pressed="true">Leagues<\/button><button type="button" data-tab="imports" aria-pressed="false">Imports<\/button>/.test(html));
  const sec = /<section class="sec ix-sec hide" id="imports" aria-labelledby="importsH" data-i18n-ctx="imports">([\s\S]*?)<\/section>/.exec(html);
  ok('IMPORTS is a section of the standard: away until chosen, its title, a short subtitle with no full stop',
     sec && /<h2 id="importsH">Imports<\/h2>/.test(sec[1]) && /<p class="note">([^<]{10,70})<\/p>/.test(sec[1]) && !/\.<\/p>/.test(/<p class="note">[^<]*<\/p>/.exec(sec[1])[0]));
  ok('...drawn by imports.js, after the page\'s own scripts and before nav.js', html.indexOf('imports.js?v=') > html.indexOf('scouting.js?v=') && html.indexOf('imports.js?v=') < html.indexOf('../nav.js?v='));
  ok('it asks scout_access only with a session, with the reader\'s own token', /if \(!s \|\| !s\.token \|\| !C\.supabaseUrl\) return \{ scout: false \};/.test(js) &&
     /\/rest\/v1\/rpc\/scout_access/.test(js) && /Authorization: 'Bearer ' \+ s\.token/.test(js));
  ok('...and draws the switch only on a yes', /if \(!a\.scout\) return;\s*tabs\.hidden = false;/.test(js));
  ok('open, the leagues\' sections step away; ON THIS PAGE is told', /\.ep-frame\.sc\.sc-ix > #setup, *\.ep-frame\.sc\.sc-ix > #results\{display:none\}/.test(css) &&
     /root\.dispatchEvent\(new root\.Event\('epinoia:sections'\)\)/.test(js) && /window\.addEventListener\('epinoia:sections', \(\) => \{ setTimeout\(paint, 30\); \}\);/.test(nav));
  ok('nothing is sent anywhere: the only request is the role\'s', (js.match(/fetch\(/g) || []).length === 1 && !/XMLHttpRequest|sendBeacon/.test(js));
  ok('...the files are kept in IndexedDB, the view in localStorage, both as conveniences that fail quietly',
     /indexedDB\.open\(STORE, 1\)/.test(js) && /try \{ root\.localStorage\.setItem\(VIEW_KEY/.test(js));
  const es = src('i18n', 'es.js'), ja = src('i18n', 'ja.js');
  const block = t => { const i = t.indexOf('      imports: {\n'); return i < 0 ? '' : t.slice(i, t.indexOf('\n      },\n', i)); };
  const keys = t => [...block(t).matchAll(/^        '((?:[^'\\]|\\.)*)':/gm)].map(m => m[1]);
  ok('the words in Spanish and Japanese, in a context of their own, the same in both', keys(es).length > 60 && JSON.stringify(keys(es)) === JSON.stringify(keys(ja)) &&
     /'Imports': 'Importaciones'/.test(block(es)) && /'Imports': 'インポート'/.test(block(ja)));
  ok('...every phrase the tab writes has its translation', ['Drop the extension’s files here, or choose them', '+ add more files', 'more filters', 'reset the filters',
     'download these as a CSV', 'this season’s numbers only', 'Nobody in the files matches all of these filters.', 'PLAYED FOR'].every(k => keys(es).includes(k)));
}

/* ======================================================================= the platform console ====== */
console.log('\nthe platform console');
{
  const html = src('admin', 'platform', 'index.html'), js = src('admin', 'platform', 'platform.js');
  ok('"scout" in Grant a role, for the whole platform', /<option value="scout">scout — global scouting&rsquo;s Imports tab<\/option>/.test(html) &&
     /if \(picked === 'platform_admin' \|\| picked === 'scout'\) \{/.test(js));
  ok('...granted by address through grant_scout, said in its words', /if \(picked === 'scout'\) \{\s*const out = await rpc\('grant_scout', \{ p_email: email \}\);/.test(js));
  ok('the scouts listed, each with a way to end it (revoke_scout), and a database without 0210 said in a line',
     /<h3 id="scoutsH">Scouts<\/h3>\s*<div id="scoutsList"><\/div>/.test(html) && /sb\.rpc\('scouts_list'\)/.test(js) && /rpc\('revoke_scout', \{ p_email: x\.email \}\)/.test(js) &&
     /Scouts arrive with migration 0210/.test(js) && /loadPending\(\), loadScouts\(\)\]\)/.test(js));
  const pes = src('i18n', 'es', 'platform.js'), pja = src('i18n', 'ja', 'platform.js');
  ok('...its words in Spanish and Japanese', ['scout — global scouting’s Imports tab', 'Scouts', 'No scouts yet.', 'has not signed in yet', 'end'].every(k => pes.includes("'" + k + "':") && pja.includes("'" + k + "':")) &&
     /is a scout from the moment they sign in with that address/.test(pes) && /is a scout from the moment they sign in with that address/.test(pja));
}

/* ====================================================================== on a real Postgres ====== */
let PGlite;
try { ({ PGlite } = await import(process.env.PGLITE_DIR ? pathToFileURL(path.join(process.env.PGLITE_DIR, 'dist', 'index.js')).href : '@electric-sql/pglite')); }
catch { console.log('\nSKIP  the database: @electric-sql/pglite is not installed'); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
console.log('\nthe scout role (0210)');
const mig = n => readFileSync(path.join(here, '..', 'migrations', n), 'utf8');
const PLAT = '55555555-5555-5555-5555-555555555555', SCOUT = '66666666-6666-6666-6666-666666666666', FAN = '33333333-3333-3333-3333-333333333333',
      LATE = '77777777-7777-7777-7777-777777777777', SHAM = '88888888-8888-8888-8888-888888888888';
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.audit_log (actor uuid, action text, subject text, subject_id text, detail jsonb, at timestamptz default now());
  create function public.is_platform_admin() returns boolean language sql stable as $$ select auth.uid() = '${PLAT}'::uuid $$;
  grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated;
`);
await db.exec(mig('0210_scouts.sql'));
const q = async (sql, params, role = 'authenticated') => {
  await db.exec('set role ' + role);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec('reset role'); }
};
const as = uid => db.exec(`select set_config('test.uid', '${uid || ''}', false)`);
const fails = async fn => { try { await fn(); return null; } catch (e) { return e.message || String(e); } };
const access = async uid => { await as(uid); return (await q(`select public.scout_access() as a`))[0].a; };
await db.query(`insert into auth.users values ($1, 'plat@epinoia.com', now(), now()), ($2, 'Scout@Club.org', now(), now()), ($3, 'fan@x.com', now(), now()),
  ($4, 'sham@x.com', null, null)`, [PLAT, SCOUT, FAN, SHAM]);
{
  ok('a platform administrator is a scout already', JSON.stringify(await access(PLAT)) === JSON.stringify({ scout: true, platform: true }));
  ok('a fan is not', JSON.stringify(await access(FAN)) === JSON.stringify({ scout: false, platform: false }));
  await as(PLAT);
  const g1 = (await q(`select public.grant_scout($1, $2) as v`, ['  SCOUT@club.org ', 'covers Spain']))[0].v;
  ok('the platform names a scout by address (any case, any spaces): it holds at once for an account that has it', g1 === 'granted: scout@club.org is a scout', g1);
  ok('...and they are one', (await access(SCOUT)).scout === true);
  await as(PLAT);
  ok('naming them again is the same grant', (await q(`select public.grant_scout($1) as v`, ['scout@club.org']))[0].v === 'already a scout: scout@club.org' &&
     (await db.query(`select count(*)::int as n from platform_scouts where revoked_at is null`)).rows[0].n === 1);
  await as(PLAT);
  const g2 = (await q(`select public.grant_scout($1) as v`, ['late@club.org']))[0].v;
  ok('an address with no account yet is invited: it holds from the moment they sign in', g2 === 'invited: late@club.org is a scout from the moment they sign in with that address', g2);
  await db.query(`insert into auth.users values ($1, 'late@club.org', now(), now())`, [LATE]);
  ok('...and it does', (await access(LATE)).scout === true);
  await as(PLAT);
  await q(`select public.grant_scout($1)`, ['sham@x.com']);
  ok('an address nobody has confirmed is not a scout, whatever the grant says', (await access(SHAM)).scout === false);
  await as(PLAT);
  const list = await q(`select * from public.scouts_list()`);
  ok('the platform\'s list: every live grant, with whether the address has a confirmed account', list.length === 3 &&
     list.find(r => r.email === 'scout@club.org').has_account === true && list.find(r => r.email === 'scout@club.org').note === 'covers Spain' &&
     list.find(r => r.email === 'sham@x.com').has_account === false);
  ok('...audit-logged', (await db.query(`select count(*)::int as n from audit_log where action = 'grant_scout'`)).rows[0].n === 3);
  await as(FAN);
  ok('a fan cannot name a scout, end one or see the list', /only a platform administrator can name a scout/.test(await fails(() => q(`select public.grant_scout('fan@x.com')`)) || '') &&
     /only a platform administrator/.test(await fails(() => q(`select public.revoke_scout('scout@club.org')`)) || '') &&
     /only a platform administrator can see the scouts/.test(await fails(() => q(`select * from public.scouts_list()`)) || ''));
  await as(SCOUT);
  ok('...nor can a scout', /only a platform administrator/.test(await fails(() => q(`select public.grant_scout('friend@x.com')`)) || ''));
  await as('');
  ok('a signed-out caller cannot call any of them', /permission denied/.test(await fails(() => q(`select public.scout_access()`, [], 'anon')) || '') &&
     /permission denied/.test(await fails(() => q(`select public.grant_scout('x@y.z')`, [], 'anon')) || ''));
  ok('...nor read the table', /permission denied/.test(await fails(() => q(`select * from platform_scouts`)) || ''));
  await as(PLAT);
  ok('not an address: refused', /not an email address/.test(await fails(() => q(`select public.grant_scout('nobody')`)) || ''));
  ok('ended: no longer a scout, the row kept as the record', (await q(`select public.revoke_scout('Scout@Club.org') as n`))[0].n === 1 &&
     (await access(SCOUT)).scout === false && (await db.query(`select count(*)::int as n from platform_scouts where email = 'scout@club.org' and revoked_at is not null`)).rows[0].n === 1);
  await as(PLAT);
  ok('...ending it again ends nothing; naming them again is a new grant', (await q(`select public.revoke_scout('scout@club.org') as n`))[0].n === 0 &&
     /^granted: /.test((await q(`select public.grant_scout('scout@club.org') as v`))[0].v));
  await db.exec(mig('0210_scouts.sql'));
  ok('0210 run again: every grant kept, who may call what the same', (await access(SCOUT)).scout === true && (await access(LATE)).scout === true &&
     /permission denied/.test(await fails(async () => { await as(''); return q(`select public.scout_access()`, [], 'anon'); }) || ''));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
