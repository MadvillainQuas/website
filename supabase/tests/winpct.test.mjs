/* ============================================================================
   EVERY STANDINGS TABLE SAYS WIN%, AND OPENS IN WIN% ORDER.

     node supabase/tests/winpct.test.mjs

   Held here:
     * standings.js: the winning percentage (".750", "1.000", a dash for no games) and byWinPct, the order every table opens
       in: best percentage first, level percentages by league points and then the stored rank (the league's tiebreak rules,
       applied by recompute_standings), a club with no games last, `pos` the place in that order;
     * the league page's Table tab (l/league.js groupTable): WIN% between L and PF, the rows in win% order and the # following
       them, the first row the one lit; the WIN% and PTS headers order it (PTS: the official order, the stored rank in the #),
       and every table on the page follows the choice;
     * the embed (embed/table/table.js), the preview's table and the line under a club's name (tablepos.js), the live
       dynamic table (game/dyntable.js) and the club's record strip (t/team.js) carry the column;
     * the graphics' table (socialcard.js table): WIN% in the default columns, in win% order with the rank following, the
       official order on request, the caption saying the percentage; the builder's column default and order option.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const require = createRequire(import.meta.url);
const rd = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d === undefined ? '' : '\n          ' + JSON.stringify(d))); } };

const ST = require(path.join(ROOT, 'epinoia', 'standings.js'));

/* a table where points and percentage disagree: B has the better percentage on fewer games, C and D are level on
   percentage and on points (the stored rank decides: D), E has played nobody */
const team = n => ({ name: 'Club ' + n, colour: '#123456', slug: 'c' + n });
const rows = [
  { team_id: 'a', rank: 1, gp: 10, w: 7, l: 3, league_points: 17, pts_for: 800, pts_against: 760, diff: 40, streak: 'W2', teams: team('A') },
  { team_id: 'c', rank: 3, gp: 8, w: 5, l: 3, league_points: 13, pts_for: 640, pts_against: 630, diff: 10, streak: 'L1', teams: team('C') },
  { team_id: 'd', rank: 2, gp: 8, w: 5, l: 3, league_points: 13, pts_for: 650, pts_against: 620, diff: 30, streak: 'W1', teams: team('D') },
  { team_id: 'b', rank: 4, gp: 6, w: 5, l: 1, league_points: 11, pts_for: 500, pts_against: 450, diff: 50, streak: 'W5', teams: team('B') },
  { team_id: 'e', rank: 5, gp: 0, w: 0, l: 0, league_points: 0, pts_for: 0, pts_against: 0, diff: 0, streak: '', teams: team('E') },
  { team_id: 'f', rank: 6, gp: 10, w: 2, l: 8, league_points: 12, pts_for: 700, pts_against: 790, diff: -90, streak: 'L4', teams: team('F') }
];
const WANT = ['b', 'a', 'd', 'c', 'f', 'e'];       // .833, .700, .625 (points level, rank 2), .625 (rank 3), .200, no games

console.log('\nstandings.js');
ok('the percentage as a table prints it: .833, 1.000, .000, a dash for no games', ST.pct(5, 6) === '.833' && ST.pct(4, 4) === '1.000' && ST.pct(0, 3) === '.000' && ST.pct(0, 0) === '—');
ok('...and as a number, null for no games', Math.abs(ST.winPct(5, 6) - 5 / 6) < 1e-12 && ST.winPct(0, 0) === null);
const by = ST.byWinPct(rows);
ok('win% order: best first, level percentages by points then the stored rank (the tiebreak), no games last', by.map(r => r.team_id).join() === WANT.join(), by.map(r => r.team_id));
ok('...each row\'s pos is its place in that order (1..n) and its stored rank is untouched', by.map(r => r.pos).join() === '1,2,3,4,5,6' && by.find(r => r.team_id === 'b').rank === 4);
ok('...level percentage and level points: the stored rank decides (D, ranked 2nd, before C)', by.findIndex(r => r.team_id === 'd') < by.findIndex(r => r.team_id === 'c'));
ok('...level percentage, more points first, whatever the stored rank', ST.byWinPct([{ team_id: 'x', gp: 4, w: 2, league_points: 6, rank: 1 }, { team_id: 'y', gp: 4, w: 2, league_points: 7, rank: 2 }]).map(r => r.team_id).join() === 'y,x');
ok('...2 of 4 and 3 of 6 are level exactly (no rounding decides it)', ST.byWinPct([{ team_id: 'x', gp: 6, w: 3, league_points: 9, rank: 2 }, { team_id: 'y', gp: 4, w: 2, league_points: 6, rank: 1 }]).map(r => r.team_id).join() === 'x,y');
ok('...the rows given are not changed (new objects)', !('pos' in rows[0]));

/* ------------------------------------------------------------- DOM stub --- */
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null; this._t = ''; this.attrs = {}; this.listeners = {}; this.className = '';
    this.style = { setProperty: (k, v) => { this.style[k] = v; } }; this.dataset = {}; }
  get childNodes() { return this.children; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === BODY; }
  get textContent() { return this._t + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children.forEach(c => { c.parentNode = null; }); this.children = []; this._t = String(v); }
  appendChild(n) { if (n.parentNode) n.parentNode.children = n.parentNode.children.filter(c => c !== n); n.parentNode = this; this.children.push(n); return n; }
  append(...ns) { ns.forEach(n => this.appendChild(n)); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this); this.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { (this.listeners.click || []).forEach(f => f({ preventDefault() {} })); }
  all(pred, out = []) { this.children.forEach(c => { if (pred(c)) out.push(c); c.all(pred, out); }); return out; }
}
const BODY = new El('body');
const cls = c => n => (' ' + n.className + ' ').includes(' ' + c + ' ');
const tag = t => n => n.tagName === t.toUpperCase();

console.log('\nthe league page\'s table (l/league.js)');
{
  const src = rd('epinoia', 'l', 'league.js');
  const a = src.indexOf('/* THE ORDER OF THE TABLE.'), b = src.indexOf('/* ------------------------------------------------------ conference tables');
  ok('the table code is where this test reads it', a > 0 && b > a);
  const sandbox = { window: { EpinoiaStandings: ST }, document: { createElement: t => new El(t) }, console };
  sandbox.window.epinoiaLogoUrl = () => null;
  const code = 'const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };\n' +
    src.slice(a, b) + '\n;this.groupTable = groupTable;';
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const t1 = sandbox.groupTable(rows), t2 = sandbox.groupTable(rows.slice(0, 3));
  BODY.append(t1, t2);
  const heads = t => t.all(tag('th')).map(th => th.textContent);
  const body = t => t.all(tag('tr')).filter(tr => tr.parentNode.tagName === 'TBODY');
  const cells = tr => tr.children.map(td => td.textContent);
  const H = heads(t1);
  ok('WIN% sits between L and PF', H.indexOf('WIN%') === H.indexOf('L') + 1 && H.indexOf('PF') === H.indexOf('WIN%') + 1, H);
  ok('...and says the club\'s percentage, a dash for no games', body(t1).every(tr => { const c = cells(tr), r = rows.find(x => 'Club ' + x.teams.name.slice(5) === c[1]); return r && c[H.indexOf('WIN%')] === ST.pct(r.w, r.gp); }) && cells(body(t1)[5])[H.indexOf('WIN%')] === '—');
  ok('on arrival the rows are in win% order', body(t1).map(tr => cells(tr)[1]).join() === WANT.map(k => 'Club ' + k.toUpperCase()).join(), body(t1).map(tr => cells(tr)[1]));
  ok('...and the # follows the order on screen (1..6), not the stored rank', body(t1).map(tr => cells(tr)[0]).join() === '1,2,3,4,5,6');
  const th = n => t1.all(tag('th')).find(x => x.textContent === n);
  ok('...the WIN% header says the table is ordered by it (aria-sort), PTS does not', th('WIN%').getAttribute('aria-sort') === 'descending' && th('PTS').getAttribute('aria-sort') === 'none');
  ok('...the WIN% figures are the heavy ones (.key), the points not', body(t1).every(tr => cls('key')(tr.children[H.indexOf('WIN%')]) && !cls('key')(tr.children[H.indexOf('PTS')])));
  th('PTS').all(tag('button'))[0].click();
  ok('the PTS header orders it officially: the stored rank, in the # too', body(t1).map(tr => cells(tr)[0]).join() === '1,2,3,4,5,6' && body(t1).map(tr => cells(tr)[1].slice(-1)).join() === 'A,D,C,B,E,F', body(t1).map(tr => cells(tr).slice(0, 2).join(' ')));
  ok('...every table on the page follows the choice', body(t2).map(tr => cells(tr)[1].slice(-1)).join() === 'A,D,C' && th('PTS').getAttribute('aria-sort') === 'descending');
  th('WIN%').all(tag('button'))[0].click();
  ok('...and WIN% puts it back', body(t1).map(tr => cells(tr)[0]).join() === '1,2,3,4,5,6' && body(t2).map(tr => cells(tr)[1].slice(-1)).join() === 'A,D,C' && t2.all(tag('td')).filter(cls('rk')).map(td => td.textContent).join() === '1,2,3');
  t2.remove();
  th('PTS').all(tag('button'))[0].click();
  ok('...a table no longer on the page is not drawn again', t2.all(tag('th')).find(x => x.textContent === 'PTS').getAttribute('aria-sort') === 'none' && th('PTS').getAttribute('aria-sort') === 'descending');
  th('WIN%').all(tag('button'))[0].click();
  ok('the headers are real buttons', ['WIN%', 'PTS'].every(n => th(n).all(tag('button'))[0].type === 'button'));
  const css = rd('epinoia', 'kit', 'standings.css');
  ok('the page\'s sheet styles the buttons and the ordered column (pixel letter-spacing inherited, never above .2em)', /\.sorth\{/.test(css) && /td\.wpct\.key/.test(css) && !/letter-spacing:\s*\.(2[1-9]|[3-9])/.test(css));
}

console.log('\nthe other tables');
{
  const emb = rd('epinoia', 'embed', 'table', 'table.js');
  ok('the embed: WIN% between L and DIFF, in win% order with the # following (byWinPct, pos)', /\['#', 'TEAM', 'GP', 'W', 'L', 'WIN%', 'DIFF', 'PTS'\]/.test(emb) && /ST\.byWinPct\(d\.rows\) : d\.rows\)\.slice\(0, rows\)/.test(emb) && /r\.pos \?\? r\.rank/.test(emb));
  const TP = require(path.join(ROOT, 'epinoia', 'tablepos.js'));
  const T = { comp: { name: 'Super League' }, rows };
  const html = TP.tableHTML(T, ['b', 'f'], { max: 20 });
  const heads = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m => m[1]);
  ok('the preview\'s table: WIN% after L', heads.indexOf('WIN%') === heads.indexOf('L') + 1, heads);
  const order = [...html.matchAll(/<td class="tp-r">(\d+)<\/td><td class="tp-n">Club (\w)/g)].map(m => m[1] + m[2]);
  ok('...in win% order, the # following', order.join() === '1B,2A,3D,4C,5F,6E', order);
  ok('...and the line under a club\'s name is its place in that order (B: 1st, its stored rank 4th)', TP.place(T, 'b').text === '1st in Super League' && TP.place(T, 'c').text === '4th in Super League');
  const dyn = rd('epinoia', 'game', 'dyntable.js');
  ok('the live dynamic table: WIN% beside the record (its order stays the projection\'s, by league points)', /\['#', 'TEAM', 'GP', 'W', 'L', 'WIN%', 'PF', 'PA', 'DIFF', 'PTS'\]/.test(dyn) && /<td>' \+ l \+ '<\/td><td>' \+ pct\(w, gp\) \+ '<\/td>/.test(dyn));
  ok('the club\'s record strip: win% in place of games played (the record says how many)', /\['win%', /.test(rd('epinoia', 't', 'team.js')));
}

console.log('\nthe graphics\' table (socialcard.js)');
{
  const sandbox = { console, module: undefined, setTimeout, clearTimeout, Intl, TextEncoder };
  sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const f of ['epinoia/reportcard.js', 'epinoia/socialcard.js', 'epinoia/admin/socialgfx-ui.js', 'epinoia/admin/graphics-ui.js']) vm.runInContext(rd(f), sandbox, { filename: f });
  const SC = sandbox.EpinoiaSocialCard, UI = sandbox.EpinoiaGraphicsUI;
  const st = rows.map(r => Object.assign({}, r, { team: r.teams }));
  const m = SC.table({ standings: st, league: { name: 'L' }, comp: 'Super League' }, 'portrait')[0];
  ok('in win% order, the rank following it', m.rows.map(r => r.rank + r.team.name.slice(-1)).join() === '1B,2A,3D,4C,5F,6E' && m.order === 'pct', m.rows.map(r => r.rank + r.team.name.slice(-1)));
  ok('...the percentage on every row (null with no games)', Math.abs(m.rows[0].pct - 5 / 6) < 1e-12 && m.rows[5].pct === null);
  const off = SC.table({ standings: st, league: { name: 'L' }, order: 'official' }, 'portrait')[0];
  ok('the official order on request: the stored rank', off.rows.map(r => r.rank + r.team.name.slice(-1)).join() === '1A,2D,3C,4B,5E,6F' && off.order === 'official');
  const log = []; let size = 10;
  const c = { textAlign: 'left', fillStyle: '', save() {}, restore() {}, set font(f) { const x = /(\d+)px/.exec(f); size = x ? +x[1] : size; }, get font() { return ''; },
    measureText: t => ({ width: String(t).length * size * 0.56 }), fillText(t) { log.push(String(t)); }, fillRect() {}, createRadialGradient() { return { addColorStop() {} }; },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {}, drawImage() {}, setLineDash() {}, scale() {}, clip() {} };
  SC.draw(c, m, { size: 'portrait' });
  ok('drawn with WIN% by default, between L and DIFF, the figures as a table prints them', log.indexOf('WIN%') === log.indexOf('L') + 1 && log.indexOf('DIFF') > log.indexOf('WIN%') && log.includes('.833') && log.includes('—'), log.slice(0, 20));
  ok('the caption says each percentage', /1\. Club B 5-1 \(\.833\)/.test(SC.caption(m)));
  ok('the builder: WIN% in the default columns, the order an option (win% by default)', UI.COL_DEFAULT.join() === 'gp,w,l,pct,diff' && UI.TABLE_ORDER[0][0] === '' && UI.TABLE_ORDER.some(o => o[0] === 'official') && SC.COL_DEFS.pct === 'WIN%');
  ok('...a column order the person chose is kept (no longer re-sorted to the table\'s own)', SC.cleanModules({ cols: ['diff', 'pct', 'w'] }).cols.join() === 'diff,pct,w');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
