'use strict';
/* ============================================================================
   SHOT CLOCK — the view. A tab per offence, a two-handled slider over the 24
   seconds after a side gained the ball, and for the possessions that ended in
   that window: how many, how many points, the four factors against the side's
   own every-possession figure, and where the shots came from.

   Drawn by the game page's SHOT CLOCK tab (one game, both sides) and by the
   team profile's section (a season: the club's offence, and its opponents'
   offence against it). The numbers are epinoia/shotclock.js's; this file only
   draws them and keeps the slider where the reader left it.

   "POSSESSION" HERE IS THE FIRST CHANCE OF ONE: the time from the ball changing
   hands to the shot, turnover or trip to the line that ended it. An offensive
   rebound resets the clock and starts a second-chance possession, which is kept
   out of every window and reported underneath instead.

   Built as a string (the game page renders its tabs that way, and redraws them
   on every play of a live game) with delegated listeners installed once, so a
   redraw loses nothing: the side and the window live in this module, not in
   the markup.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaShotClockView = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const SC = () => root.EpinoiaShotClock;
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : null);
const pct = v => (v == null ? '–' : (100 * v).toFixed(1) + '%');
const dec2 = v => (v == null ? '–' : v.toFixed(2));
const PRESETS = [[0, 7, '0–7 s'], [8, 16, '8–16 s'], [17, 24, '17–24 s'], [0, 24, 'all']];
const SMALL = 8;          // below this many possessions a rate is a sketch, and says so

/* id -> { opts, state }. The page hands its latest numbers in on every draw; the reader's
   side and window stay put across a redraw because they are kept here. */
const REG = {};

function max() { const S = SC(); return S ? S.MAX : 24; }
function sideOf(inst) { return inst.opts.sides[Math.min(inst.state.side, inst.opts.sides.length - 1)] || { chances: [] }; }

/* ---------------------------------------------------------------- pieces --- */
function sidesHTML(inst) {
  const s = inst.opts.sides;
  if (s.length < 2) return '';
  return '<div class="scx-sides" role="group" aria-label="Whose possessions">' + s.map((x, i) => {
    const on = i === inst.state.side;
    return '<button type="button" class="scx-side' + (on ? ' on' : '') + '" data-scx-side="' + i + '" aria-pressed="' + on + '"' +
      (hex(x.colour) ? ' style="--scx-t:' + x.colour + '"' : '') + '><i></i>' + esc(x.label) + '</button>';
  }).join('') + '</div>';
}

function histHTML(inst) {
  const S = SC(), M = max();
  const h = S.histogram(sideOf(inst).chances);
  const top = Math.max(1, Math.max.apply(null, h));
  const { lo, hi } = inst.state;
  return '<div class="scx-hist" aria-hidden="true">' + h.map((n, s) => {
    const inside = s >= lo && s <= hi;
    return '<i class="' + (inside ? 'in' : '') + '" style="height:' + (n ? Math.max(6, 100 * n / top) : 0).toFixed(1) + '%" title="' +
      esc(n + (n === 1 ? ' possession' : ' possessions') + ' ended ' + (s === M ? M + ' s or later' : 'at ' + s + ' s')) + '"></i>';
  }).join('') + '</div>';
}

function fillStyle(inst) {
  const M = max(), { lo, hi } = inst.state;
  return 'left:' + (100 * lo / M).toFixed(2) + '%;right:' + (100 - 100 * hi / M).toFixed(2) + '%';
}

function readText(inst) {
  const M = max(), { lo, hi } = inst.state;
  if (lo === 0 && hi >= M) return 'every possession';
  return lo + '–' + (hi >= M ? M + '+' : hi) + ' s';
}

function controlsHTML(inst) {
  const M = max(), { lo, hi } = inst.state;
  const ticks = [0, 4, 8, 12, 16, 20, 24].map(t => '<span style="left:' + (100 * t / M).toFixed(2) + '%">' + (t === M ? M + '+' : t) + '</span>').join('');
  return '<div class="scx-ctl">' +
    '<div class="scx-read"><b class="scx-rd">' + esc(readText(inst)) + '</b><small>after gaining the ball, possessions that ended in that window</small></div>' +
    histHTML(inst) +
    '<div class="scx-range">' +
      '<div class="scx-track"><i class="scx-fill" style="' + fillStyle(inst) + '"></i></div>' +
      '<input type="range" class="scx-in scx-lo" min="0" max="' + M + '" step="1" value="' + lo + '" aria-label="From, seconds after gaining the ball">' +
      '<input type="range" class="scx-in scx-hi" min="0" max="' + M + '" step="1" value="' + hi + '" aria-label="To, seconds after gaining the ball">' +
    '</div>' +
    '<div class="scx-axis">' + ticks + '</div>' +
    '<div class="scx-presets">' + PRESETS.map(p =>
      '<button type="button" class="scx-pre' + (p[0] === lo && p[1] === hi ? ' on' : '') + '" data-scx-pre="' + p[0] + ',' + p[1] + '">' + p[2] + '</button>').join('') +
    '</div>' +
  '</div>';
}

/* ONE FACTOR: the window's figure, and beside it the same side's figure over every
   possession, so "is 44% good?" answers itself. The change is coloured by which way is
   good for the offence: fewer turnovers, more of everything else. */
function factorHTML(label, v, ref, up, fmt, tip) {
  const has = v != null && ref != null;
  const dv = has ? v - ref : null;
  const good = has && Math.abs(dv) > 1e-9 ? ((dv > 0) === up) : null;
  const w = v == null ? 0 : Math.max(0, Math.min(100, 100 * v / (label === 'TOV%' ? 0.4 : label === 'FTA rate' ? 0.6 : label === 'OREB%' ? 0.6 : 0.8)));
  const r = ref == null ? null : Math.max(0, Math.min(100, 100 * ref / (label === 'TOV%' ? 0.4 : label === 'FTA rate' ? 0.6 : label === 'OREB%' ? 0.6 : 0.8)));
  return '<div class="scx-f" title="' + esc(tip) + '">' +
    '<span class="scx-fl">' + label + '</span>' +
    '<b class="scx-fv">' + fmt(v) + '</b>' +
    '<span class="scx-bar"><i style="width:' + w.toFixed(1) + '%"></i>' + (r == null ? '' : '<em style="left:' + r.toFixed(1) + '%"></em>') + '</span>' +
    '<small>' + (ref == null ? '&nbsp;' : 'all first chances ' + fmt(ref) +
      (good == null ? '' : ' · <span class="' + (good ? 'up' : 'down') + '">' + (dv > 0 ? '+' : '−') + fmt(Math.abs(dv)).replace('%', '') + (fmt === pct ? ' pts' : '') + '</span>')) + '</small>' +
  '</div>';
}

function shotsHTML(inst, shots, colour) {
  const Chart = root.EpinoiaShotChart, B = root.EpinoiaBox;
  const located = shots.filter(x => x.x != null && x.y != null && isFinite(x.x) && isFinite(x.y)).map(x => {
    const f = B && B.snapToValue ? B.snapToValue(x.x, x.y, x.three) : x;
    return { x: f.x, y: f.y, made: x.made, three: x.three };
  });
  const unplaced = shots.length - located.length;
  if (!Chart || !Chart.renderZones || typeof document === 'undefined') return '';
  if (!shots.length) return '<div class="scx-shots empty"><p>No shots in this window.</p></div>';
  const host = document.createElement('div');
  Chart.renderZones({ host, shots: located, colour: colour || '#93f2bf', minAttempts: 3, table: false,
    note: unplaced ? unplaced + ' shot' + (unplaced === 1 ? '' : 's') + ' without a location' : '' });
  return '<div class="scx-shots">' + host.innerHTML + '</div>';
}

function outHTML(inst) {
  const S = SC(), side = sideOf(inst);
  const { lo, hi } = inst.state;
  const firsts = side.chances.filter(r => !r.second);
  const timed = firsts.filter(r => r.dur != null);
  const inWin = side.chances.filter(r => S.inWindow(r, lo, hi));
  const w = S.summary(inWin), all = S.summary(timed);
  const secondChances = S.summary(side.chances.filter(r => r.second));
  const untimed = firsts.length - timed.length;
  const unit = inst.opts.unit === 'season' ? 'this season' : 'this game';
  const share = timed.length ? w.n / timed.length : null;

  if (!firsts.length) {
    return '<div class="scx-out"><p class="scx-empty">No possessions ' + unit + ' yet.</p></div>';
  }
  const head =
    '<div class="scx-head">' +
      '<div class="scx-big"><b>' + w.n + '</b><small>possession' + (w.n === 1 ? '' : 's') + (share == null ? '' : ' · ' + Math.round(100 * share) + '% of ' + timed.length) + '</small></div>' +
      '<div class="scx-big"><b>' + w.pts + '</b><small>points on the first chance</small></div>' +
      '<div class="scx-big"><b>' + dec2(w.ppp) + '</b><small>per first chance · all first chances ' + dec2(all.ppp) + '</small></div>' +
      '<div class="scx-big"><b>' + (w.avgDur == null ? '–' : w.avgDur.toFixed(1) + ' s') + '</b><small>average length</small></div>' +
    '</div>';
  /* HOW IT ADDS UP TO THE WHOLE GAME. Everything above is the FIRST chance of each possession,
     so its points fall short of the box score's by whatever came after offensive rebounds --
     Cheshire read 0.60 a chance here beside 0.75 in the full stats (2026-09-23), and neither
     was wrong. Said once, in points, which are the box score's to the unit. (Not in possessions:
     the full stats estimate theirs from the box score, 0.96 x (FGA + TOV + 0.44 FTA - OREB),
     and a counted number beside an estimated one would be two answers to one question.) */
  const firstAll = S.summary(firsts);
  const total = firstAll.pts + secondChances.pts;
  const whole = '<p class="scx-whole">' + (inst.opts.unit === 'season' ? 'This season' : 'The whole game') + ': ' +
    firstAll.pts + ' on first chances + ' + secondChances.pts + ' after offensive rebounds = <b>' + total + ' points</b>.</p>';
  const ff = '<div class="scx-ff">' +
    factorHTML('eFG%', w.efg, all.efg, true, pct, 'Effective field goal %: (FGM + ½·3PM) / FGA · ' + w.fgm + '/' + w.fga + ' FG, ' + w.p3m + '/' + w.p3a + ' 3PT') +
    factorHTML('TOV%', w.tovPct, all.tovPct, false, pct, 'Turnovers per possession · ' + w.tov + ' in ' + w.n) +
    factorHTML('OREB%', w.orebPct, all.orebPct, true, pct, 'Of the misses somebody rebounded, the share won back by the offence · ' + w.off + ' of ' + (w.off + w.def)) +
    factorHTML('FTA rate', w.ftr, all.ftr, true, pct, 'Free throw attempts per field goal attempt · ' + w.fta + ' FTA, ' + w.fga + ' FGA') +
  '</div>';
  const small = w.n && w.n < SMALL ? '<p class="scx-small">' + w.n + ' possession' + (w.n === 1 ? '' : 's') + ': read these rates as a sketch.</p>' : '';
  const note = '<p class="scx-note">Timed from the moment the ball changed hands — the other side\'s made basket, last free throw or turnover, this side\'s defensive rebound, or the start of the period — to the shot, turnover or trip to the line that ended the first chance. ' +
    'A second chance after an offensive rebound restarts the clock, so it is in no window: ' + secondChances.n + ' ' + unit + ', ' + secondChances.pts + ' points' +
    (secondChances.n ? ', ' + dec2(secondChances.ppp) + ' a chance' : '') + '.' +
    (untimed ? ' ' + untimed + ' possession' + (untimed === 1 ? '' : 's') + ' could not be timed (the log has a gap) and ' + (untimed === 1 ? 'is' : 'are') + ' in no window.' : '') + '</p>';
  return '<div class="scx-out">' + head + whole + small + ff + shotsHTML(inst, w.shots, side.colour) + note + '</div>';
}

/* ------------------------------------------------------------------ public --- */
/* opts: { sides: [{ label, colour, chances }], unit: 'game' | 'season' } */
function html(id, opts) {
  const S = SC();
  if (!S) return '<div class="msg">The shot clock analysis could not be loaded.</div>';
  const inst = REG[id] = REG[id] || { state: { side: 0, lo: 0, hi: S.MAX } };
  inst.opts = Object.assign({ sides: [], unit: 'game' }, opts || {});
  install();
  const side = sideOf(inst);
  return '<div class="scx" data-scx="' + esc(id) + '"' + (hex(side.colour) ? ' style="--scx-c:' + side.colour + '"' : '') + '>' +
    sidesHTML(inst) + controlsHTML(inst) + outHTML(inst) + '</div>';
}

function mount(host, id, opts) {
  if (!host) return;
  host.innerHTML = html(id, opts);
}

/* a change of window redraws the read-out, the bars and the results, never the two inputs
   (redrawing one mid-drag would drop the handle out of the reader's finger) */
function refresh(rootEl, inst, withInputs) {
  const rd = rootEl.querySelector('.scx-rd'); if (rd) rd.textContent = readText(inst);
  const fill = rootEl.querySelector('.scx-fill'); if (fill) fill.setAttribute('style', fillStyle(inst));
  const hist = rootEl.querySelector('.scx-hist'); if (hist) hist.outerHTML = histHTML(inst);
  rootEl.querySelectorAll('.scx-pre').forEach(b => {
    const p = b.getAttribute('data-scx-pre').split(',').map(Number);
    b.classList.toggle('on', p[0] === inst.state.lo && p[1] === inst.state.hi);
  });
  if (withInputs) {
    const a = rootEl.querySelector('.scx-lo'), b = rootEl.querySelector('.scx-hi');
    if (a) a.value = inst.state.lo; if (b) b.value = inst.state.hi;
  }
  lift(rootEl, inst);
  const out = rootEl.querySelector('.scx-out'); if (out) out.outerHTML = outHTML(inst);
}

/* both handles at the far right would leave only the upper one reachable: the lower one is
   lifted over it whenever it is in the top half, which is the only place they can meet there */
function lift(rootEl, inst) {
  const a = rootEl.querySelector('.scx-lo');
  if (a) a.classList.toggle('top', inst.state.lo > max() / 2);
}

let installed = false;
function install() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('input', e => {
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('scx-in')) return;
    const rootEl = t.closest('.scx'); const inst = rootEl && REG[rootEl.getAttribute('data-scx')];
    if (!inst) return;
    let v = Math.max(0, Math.min(max(), Math.round(+t.value)));
    if (t.classList.contains('scx-lo')) { if (v > inst.state.hi) { v = inst.state.hi; t.value = v; } inst.state.lo = v; }
    else { if (v < inst.state.lo) { v = inst.state.lo; t.value = v; } inst.state.hi = v; }
    refresh(rootEl, inst, false);
  });
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target.closest('[data-scx-side],[data-scx-pre]') : null;
    if (!t) return;
    const rootEl = t.closest('.scx'); const inst = rootEl && REG[rootEl.getAttribute('data-scx')];
    if (!inst) return;
    if (t.hasAttribute('data-scx-side')) {
      inst.state.side = +t.getAttribute('data-scx-side') || 0;
      rootEl.outerHTML = html(rootEl.getAttribute('data-scx'), inst.opts);
      return;
    }
    const p = t.getAttribute('data-scx-pre').split(',').map(Number);
    inst.state.lo = p[0]; inst.state.hi = p[1];
    refresh(rootEl, inst, true);
  });
}

return { html, mount, PRESETS };
}));
