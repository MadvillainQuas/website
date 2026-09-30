/* ============================================================================
   THE WEEKLY REPORT AS A PAGE (epinoia/reportcard.js, weekly.js cardModel), with no browser.

     node supabase/tests/reportcard.test.mjs

   What is held here:
     * the sheet is built from the report the tab holds, nothing else: the same rows (a style still a style),
       the same keep / work lists, the week's headline numbers per game, the prose without the two lists it
       draws as lists, and a date range that reads right across a month and a year;
     * the layout, driven through a recording 2D context, keeps every word and bar on the page for a team's
       sixteen measures and a player's twelve, on A4 and on a 1080 x 1350 post, a sixty-letter name included,
       and draws an empty week without falling over;
     * the PDF is a PDF: the header, every xref offset landing on its object, startxref on the table, the image's
       /Length its own byte count, the page A4, and a title with letters outside ASCII kept (UTF-16);
     * the weekly tab offers the two buttons only when there is a week and a way to draw it, and its prose says
       63rd percentile, not 63th.
   ============================================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
};

const sandbox = { console, module: undefined, setTimeout, clearTimeout };
sandbox.self = sandbox; sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
for (const f of ['epinoia/weekly.js', 'epinoia/reportcard.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
}
const W = sandbox.EpinoiaWeekly, RC = sandbox.EpinoiaReportCard;
const NOW = new Date(Date.UTC(2026, 8, 30, 12));

/* a team week and a player week, in the shapes teamWeek / playerWeek return */
function led(measures, values, pcts) {
  const rows = measures.map((m, i) => ({ key: m.k, label: m.lab, short: m.short, style: !!m.style, value: values[i], pct: pcts[i] }));
  const j = rows.filter(r => !r.style).sort((a, b) => b.pct - a.pct);
  return { rows, good: j.filter(r => r.pct >= 60).slice(0, 3), bad: j.filter(r => r.pct <= 40).reverse().slice(0, 3), graded: true };
}
const TEAM = {
  games: [{}, {}, {}], record: '2-1',
  led: led(W.TEAM_MEASURES, [54.2, 12.8, 31.5, 71.2, 28.4, 74.1, 36.8, 41.2, 33.5, 61.4, 58.2, 1.4321, 9.1, 8.2, 1.0849, 104.6],
                            [81, 34, 66, 55, 18, 12, 88, 63, 29, 72, 92, 77, 41, 50, 85, 22]),
  totals: { pts: 253, possessions: 216.5, ortg: 116.9, drtg: 104.6 }, opponent: { pts: 226 },
  prose: ['Seagulls played 3 games (2-1) this week.', 'KEEP DOING: sharing the ball.', 'WORK ON: free throws.', 'One game is one game.']
};
const PLAYER = {
  games: [{}, {}],
  led: led(W.PLAYER_MEASURES, [61.8, 27.4, 11.2, 24.5, 6.1, 14.8, 64.0, 38.9, 44.4, 31.2, 2.1, 1.4, 1.12],
                              [84, 71, 58, 76, 32, 45, 69, 81, 55, 26, 60, 38, 88]),
  counts: { min: 2 * 31.5 * 60000, pts: 43, or: 3, dr: 11, ast: 9, pm: -6 }, prose: ['Two games.']
};

console.log('\nthe model');
const tm = W.cardModel(TEAM, { kind: 'team', name: 'Helsinki Seagulls', sub: 'Korisliiga', colour: '#e4002b', days: 7, now: NOW, url: 'https://x/t/?t=sea' });
const tile = (m, l) => (m.tiles.find(t => t.label === l) || {}).value;
ok('a team: games, record, points for and against a game, net rating signed and toned, pace',
   tile(tm, 'games') === '3' && tile(tm, 'record') === '2-1' && tile(tm, 'pts / g') === '84.3' && tile(tm, 'opp / g') === '75.3'
   && tile(tm, 'net rtg') === '+12.3' && tm.tiles.find(t => t.label === 'net rtg').tone === 'good' && tile(tm, 'pace') === '72.2',
   JSON.stringify(tm.tiles));
ok('the rows are the ledger\'s, in its order, a style still a style', tm.rows.length === 16 && tm.rows[0].short === 'eFG%'
   && tm.rows.filter(r => r.style).map(r => r.short).join() === '3PA rate,rim rate');
ok('values as the tab writes them: one decimal, two for PPP and AST/TO', tm.rows[0].text === '54.2'
   && tm.rows.find(r => r.short === 'PPP').text === '1.08' && tm.rows.find(r => r.short === 'AST/TO').text === '1.43');
ok('keep doing / work on: the report\'s own lists', tm.good.map(r => r.label).join() === 'sharing the ball,shooting from three,scoring per possession'
   && tm.bad.map(r => r.label).join() === 'free throws,getting to the line,their defence', tm.bad.map(r => r.label).join());
ok('the prose without the two lines drawn as lists', tm.prose.length === 2 && !tm.prose.some(p => /^(KEEP DOING|WORK ON)/.test(p)));
ok('the week and the day it was drawn', tm.range === '23–30 Sep 2026' && tm.generated === '30 Sep 2026', tm.range);
ok('...across a month, and a year', W.rangeText(7, new Date(Date.UTC(2026, 8, 3))) === '27 Aug – 3 Sep 2026'
   && W.rangeText(7, new Date(Date.UTC(2026, 0, 4))) === '28 Dec 2025 – 4 Jan 2026');
ok('the PDF\'s title names whose week', tm.title === 'Weekly report — Helsinki Seagulls, 23–30 Sep 2026', tm.title);
const pm = W.cardModel(PLAYER, { kind: 'player', name: 'Jeremiah Äänekoski', days: 7, now: NOW });
ok('a player: minutes, points, rebounds, assists a game and the plus-minus',
   tile(pm, 'min / g') === '31.5' && tile(pm, 'pts / g') === '21.5' && tile(pm, 'reb / g') === '7.0' && tile(pm, 'ast / g') === '4.5'
   && tile(pm, '+/-') === '-6' && pm.tiles.find(t => t.label === '+/-').tone === 'bad', JSON.stringify(pm.tiles));
const empty = W.cardModel({ games: [], led: null, prose: ['No games in this window yet.'] }, { kind: 'team', name: 'X', now: NOW });
ok('an empty week: no tiles, no rows, nothing to keep or work on', !empty.tiles.length && !empty.rows.length && !empty.good.length && !empty.bad.length);

console.log('\nthe page');
/* a 2D context that records where every word and shape lands; text is measured at 0.56 of its size a letter */
function recorder() {
  const log = [];
  let size = 10, alpha = 1;
  const c = {
    log, fillStyle: '', strokeStyle: '', lineWidth: 1, textAlign: 'left', textBaseline: 'alphabetic',
    set font(f) { const m = /(\d+)px/.exec(f); size = m ? +m[1] : size; this._font = f; }, get font() { return this._font; },
    set globalAlpha(a) { alpha = a; }, get globalAlpha() { return alpha; },
    measureText(t) { return { width: String(t).length * size * 0.56 }; },
    fillText(t, x, y) {
      const w = String(t).length * size * 0.56;
      const left = c.textAlign === 'center' ? x - w / 2 : c.textAlign === 'right' ? x - w : x;
      log.push({ kind: 'text', t: String(t), x0: left, x1: left + w, y0: y - size, y1: y + size * 0.25, size });
    },
    fillRect(x, y, w, h) { log.push({ kind: 'rect', x0: x, x1: x + w, y0: y, y1: y + h }); },
    createRadialGradient() { return { addColorStop() {} }; },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {}, fill() {}, stroke() {},
    save() {}, restore() {}, setLineDash() {}, drawImage(img, x, y, w, h) { log.push({ kind: 'image', x0: x, x1: x + w, y0: y, y1: y + h }); },
    scale() {}
  };
  return c;
}
function inside(log, fmt) {
  const { w, h } = RC.FORMATS[fmt];
  return log.filter(e => e.kind !== 'rect' || e.x1 - e.x0 < w)          // the ground and the club's edge are the page itself
            .filter(e => e.x0 < -0.5 || e.x1 > w + 0.5 || e.y0 < -0.5 || e.y1 > h + 0.5);
}
for (const [label, model, fmt] of [['a team, A4', tm, 'a4'], ['a team, a post', tm, 'post'], ['a player, A4', pm, 'a4'], ['a player, a post', pm, 'post']]) {
  const c = recorder();
  const r = RC.draw(c, model, { format: fmt, theme: fmt === 'a4' ? 'light' : 'dark' });
  const out = inside(c.log, fmt);
  ok(label + ': every row drawn, all of it on the page', r.rows === model.rows.length && !out.length,
     out.slice(0, 3).map(e => e.t || e.kind).join(' | '));
  const texts = c.log.filter(e => e.kind === 'text').map(e => e.t);
  ok('...the name, every measure, both lists and the footer\'s mark are there',
     texts.includes(model.name.toUpperCase()) && model.rows.every(x => texts.includes(x.short)) &&
     texts.includes('KEEP DOING') && texts.includes('WORK ON') && texts.includes('EPINOIΛ'));
  ok('...the rows neither crushed nor stretched', r.rowH >= 26 * RC.FORMATS[fmt].w / 1240 && r.rowH <= 58 * RC.FORMATS[fmt].w / 1240, r.rowH.toFixed(1));
  const bottomBar = Math.max(...c.log.filter(e => e.kind === 'text' && model.rows.some(x => x.short === e.t)).map(e => e.y1));
  const foot = c.log.find(e => e.kind === 'text' && e.t === 'EPINOIΛ');
  ok('...and the last measure clear of the footer', bottomBar < foot.y0 - 20, bottomBar.toFixed(0) + ' v ' + foot.y0.toFixed(0));
}
{
  const c = recorder();
  RC.draw(c, pm, { format: 'a4', theme: 'light' });
  const two = c.log.some(e => e.kind === 'text' && e.t === 'scoring efficiency');
  ok('A4 has room to say what each measure is ("TS%" / "scoring efficiency")', two);
  const cp = recorder();
  RC.draw(cp, tm, { format: 'post' });
  ok('...a post keeps to the names', !cp.log.some(e => e.kind === 'text' && e.t === 'shooting from the field'));
  ok('the report\'s words on A4 only', c.log.some(e => e.kind === 'text' && /Two games/.test(e.t)) && !cp.log.some(e => e.kind === 'text' && /Seagulls played/.test(e.t)));
}
{
  const long = W.cardModel(TEAM, { kind: 'team', name: 'Associação Desportiva Recreativa e Cultural Icasa de Juazeiro do Norte', now: NOW });
  const c = recorder();
  RC.draw(c, long, { format: 'post' });
  const words = long.name.toUpperCase().split(' ');
  const lines = c.log.filter(e => e.kind === 'text' && e.t.split(' ').every(w => words.includes(w)) && e.t.includes(' ') && e.size > 30);
  ok('a sixty-letter name goes onto two lines, every word of it, and stays on the page',
     lines.length >= 2 && new Set(lines.map(e => e.t)).size === 2 && [...new Set(lines.map(e => e.t))].join(' ') === long.name.toUpperCase()
     && !inside(c.log, 'post').length, lines.map(e => e.t + ' @' + e.size).join(' | '));
  const huge = W.cardModel(TEAM, { kind: 'team', name: 'Sociedade Esportiva e Recreativa Associação Atlética Clube de Regatas Vasco da Gama do Brasil Oficial', now: NOW });
  const c4 = recorder();
  RC.draw(c4, huge, { format: 'post' });
  ok('...and one too long for two is cut, never off the page', !inside(c4.log, 'post').length &&
     c4.log.some(e => e.kind === 'text' && /…$/.test(e.t) && e.size > 25));
  const c2 = recorder();
  let threw = null;
  try { RC.draw(c2, empty, { format: 'a4' }); } catch (e) { threw = e.message; }
  ok('an empty week draws, and says there is nothing yet', !threw && c2.log.some(e => e.kind === 'text' && /No games in this window yet/.test(e.t)), threw || '');
  const c3 = recorder();
  RC.draw(c3, Object.assign({}, tm, { crest: { width: 256, height: 128, naturalWidth: 256, naturalHeight: 128 } }), { format: 'a4' });
  const img = c3.log.find(e => e.kind === 'image');
  ok('a crest keeps its proportions inside the disc', img && Math.abs((img.x1 - img.x0) / (img.y1 - img.y0) - 2) < 0.01);
  ok('no crest: the club\'s initials', RC.initials('Helsinki Seagulls') === 'HS' && RC.initials('Kobrat') === 'KO' && RC.initials('') === '?');
}
{
  const px = s => s.match(/\d+/g).map(Number);
  const kits = ['#f7e017', '#0a0a0a', '#1b5e20', '#e4002b', '#ffffff', '#003da5', '#93f2bf'];
  const reads = kits.every(k => ['dark', 'light'].every(t => RC.contrast(px(RC.accentOn(k, RC.THEMES[t])), px(RC.THEMES[t].ground.replace(/^#/, '')
    .match(/../g).map(h => parseInt(h, 16)).join(','))) >= 4.5));
  ok('every club colour is drawn at 4.5:1 or better on either page (yellow on paper, dark green on the screen)', reads);
  ok('...and a colour that already reads is left as it is', RC.accentOn('#ff5f6b', RC.THEMES.dark) === 'rgb(255,95,107)');
}
ok('ordinals: 1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 63rd', [1, 2, 3, 4, 11, 12, 13, 21, 22, 63].map(RC.ordinal).join() ===
   '1st,2nd,3rd,4th,11th,12th,13th,21st,22nd,63rd');
ok('the file says whose week and which day', /^epinoia-weekly-helsinki-seagulls-\d{4}-\d{2}-\d{2}\.pdf$/.test(RC.filename(tm, 'pdf'))
   && /^epinoia-weekly-jeremiah-aanekoski-\d{4}-\d{2}-\d{2}\.png$/.test(RC.filename(pm, 'png')), RC.filename(pm, 'png'));

console.log('\nthe PDF');
{
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x0a, 0x28, 0x29, 0x5c, 0xff, 0xd9]);
  const pdf = RC.pdfFromJpeg(jpeg, 2480, 3508, { title: 'Weekly report — Äänekosken Huima (Ω)', date: NOW });
  const text = Array.from(pdf, b => String.fromCharCode(b)).join('');
  ok('a PDF 1.4 header, with the binary comment', text.startsWith('%PDF-1.4\n%') && pdf[10] > 127);
  const sx = +/startxref\n(\d+)\n%%EOF\n$/.exec(text)[1];
  ok('startxref lands on the table', text.slice(sx, sx + 4) === 'xref');
  const rows = text.slice(sx).split('\n').slice(3, 9);
  ok('every xref offset lands on its object', rows.length === 6 && rows.every((r, i) => text.slice(+r.slice(0, 10), +r.slice(0, 10) + 7) === (i + 1) + ' 0 obj'),
     rows.map(r => r.slice(0, 10)).join());
  const im = text.indexOf('/Subtype /Image');
  const len = +/\/Length (\d+)/.exec(text.slice(im))[1];
  const st = text.indexOf('stream\n', im) + 7;
  ok('the image goes in byte for byte, its /Length its own', len === jpeg.length && pdf.slice(st, st + len).every((b, i) => b === jpeg[i])
     && text.slice(st + len, st + len + 10) === '\nendstream');
  ok('an A4 page, the sheet on it in its proportions', /\/MediaBox \[0 0 595\.28 841\.89\]/.test(text) && /q 595\.18 0 0 841\.89 0\.05 0 cm \/Im0 Do Q/.test(text));
  const hex = /\/Title <([0-9A-F]+)>/.exec(text)[1];
  let title = '';
  for (let i = 4; i < hex.length; i += 4) title += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  ok('the title in UTF-16, every letter kept', hex.startsWith('FEFF') && title === 'Weekly report — Äänekosken Huima (Ω)', title);
  ok('the date the PDF way', /\/CreationDate \(D:20260930120000Z\)/.test(text));
}

console.log('\nthe tab');
{
  const html = W.render(TEAM, { window: 'the last seven days', saveable: true });
  ok('a week and a way to draw it: an image and a PDF', /data-wk-save="png"/.test(html) && /data-wk-save="pdf"/.test(html));
  ok('no way to draw it (reportcard.js not on the page): no buttons', !/data-wk-save/.test(W.render(TEAM, {})));
  ok('no games: nothing to save', !/data-wk-save/.test(W.render({ games: [], led: null, prose: [] }, { saveable: true })));
  const styles = W.prose('X', { rows: [{ key: 'p3r', label: 'how much they shot from three', style: true, pct: 63 },
                                       { key: 'rimr', label: 'getting to the rim', style: true, pct: 11 }], good: [], bad: [], graded: true }, [{}, {}], null);
  ok('the prose: 63rd percentile, 11th percentile', styles.some(p => /63rd percentile/.test(p) && /11th percentile/.test(p)), styles.join(' | '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
