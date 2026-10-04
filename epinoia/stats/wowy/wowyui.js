'use strict';
/* ============================================================================
   THE WOWY PAGE'S PARTS — circles, heat, lists of units as cards or a table, splits, and the seven views.
   window.EpinoiaWowyUI. The numbers are lineupevents.js's (over lineups.js), the rules wowylogic.js's; this file
   only draws.

   A view function is handed a `ctx` by wowy.js (the page): the team, who everyone is, the records to read (stints
   first, the play-by-play's segments once read), the scales to colour against, the thresholds, the gate and the
   callbacks (go, link). Nothing here fetches.

     PLAYER CIRCLES   a photo if the site has one, else initials on the club's colour, the club's crest on its
                      edge, the shirt number; a green ring for on the floor, a red one for off it
     THE LIST         every listing of units (lineups, the overview's fives, pairs, WOWY, vs starters, players) is
                      one component, drawn as CARDS (a league-table strip: rank badge on the club's colour edge,
                      the five circles, form blocks per game, then the stats in their categories as tiles) or as a
                      TABLE (category header row, sticky first column, sortable, the column picker)
     HEAT             every stat coloured by where it ranks, direction-aware (green is good for the team); a style
                      stat is not coloured
     DELTAS           beside every value its on/off delta (this slice minus the team's minutes outside it), green
                      or red by direction with ▲ ▼, neutral for a style stat; the reader picks values, deltas or both
     LOCKS            a play-by-play stat is members only: for a preview its cells and tiles wear the site's lock
                      (memlock.js), and while the log is being read they say so
   ============================================================================ */
(function (root) {
const W = root.EpinoiaWowyLogic;
const LE = root.EpinoiaLineupEvents;

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
const isNum = v => typeof v === 'number' && isFinite(v);

/* ink on a club colour: dark or light, whichever reads */
function hexRgb(h) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(h || '').trim());
  if (!m) return null;
  let x = m[1]; if (x.length === 3) x = x.split('').map(c => c + c).join('');
  return [0, 2, 4].map(i => parseInt(x.slice(i, i + 2), 16));
}
function inkOn(h) {
  const c = hexRgb(h);
  if (!c) return '#04100b';
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const l = 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  return l > 0.4 ? '#04100b' : '#ffffff';
}
const safeColour = c => (hexRgb(c) ? (String(c).charAt(0) === '#' ? c : '#' + c) : '#93f2bf');

/* ---------------------------------------------------------------- circles --- */
function circle(ctx, o) {
  const m = o.meta || (ctx.meta && ctx.meta[o.id]) || {};
  const team = o.team || ctx.team || {};
  const colour = safeColour(team.colour || m.colour);
  const asBtn = o.button;
  const n = el(asBtn ? 'button' : (o.link === false ? 'span' : 'a'), 'wc wc-' + (o.size || 'm') + (o.ring ? ' ring-' + o.ring : '') + (o.dim ? ' dim' : '') + (o.sel ? ' sel' : ''));
  n.dataset.pid = o.id;
  if (asBtn) n.type = 'button';
  else if (n.tagName === 'A') n.href = ctx.playerHref ? ctx.playerHref(o.id) : '../../p/?p=' + encodeURIComponent(o.id);   // a page elsewhere says where (the club page)
  n.style.setProperty('--wc', colour);
  n.style.setProperty('--wci', inkOn(colour));
  const ringTxt = o.ring === 'on' ? ' (on the floor)' : o.ring === 'off' ? ' (off the floor)' : '';
  n.title = (m.name || 'Player') + ringTxt;
  n.setAttribute('aria-label', (m.name || 'Player') + ringTxt);
  const face = el('span', 'wc-face');
  const url = ctx.photos && ctx.photos[o.id];
  if (url) face.appendChild(photoImg(url, m.name));
  else face.appendChild(el('span', 'wc-ini', W.initialsOf(m.name)));
  n.appendChild(face);
  const logo = team.logoUrl;
  if (logo && (o.size || 'm') !== 'xs') {
    const c = el('span', 'wc-crest'); const im = el('img'); im.alt = ''; im.src = logo; im.loading = 'lazy';
    im.addEventListener('error', () => c.remove());
    c.appendChild(im); n.appendChild(c);
  }
  const jn = m.jersey;
  if (jn && (o.size === 'm' || o.size === 'l' || !o.size)) n.appendChild(el('span', 'wc-num', jn));
  return n;
}
function photoImg(url, name) {
  const im = el('img'); im.alt = name || ''; im.src = url; im.loading = 'lazy'; im.decoding = 'async';
  im.addEventListener('error', () => im.remove());
  return im;
}
/* when photos arrive after the circles are drawn, put them in */
function hydrate(ctx, scope) {
  (scope || document).querySelectorAll('.wc[data-pid]').forEach(n => {
    const url = ctx.photos && ctx.photos[n.dataset.pid];
    const face = n.querySelector('.wc-face');
    if (url && face && !face.querySelector('img')) { clear(face); face.appendChild(photoImg(url, n.title)); }
  });
}
const byJersey = (ctx, ids) => ids.slice().sort((a, b) => {
  const x = parseInt(((ctx.meta[a] || {}).jersey), 10), y = parseInt(((ctx.meta[b] || {}).jersey), 10);
  return (isNaN(x) ? 99 : x) - (isNaN(y) ? 99 : y);
});
const nameOf = (ctx, id) => ((ctx.meta && ctx.meta[id]) || {}).name || 'Player';
const short = (ctx, id) => W.surname(nameOf(ctx, id));
/* A SURNAME WITH THE WHOLE NAME BEHIND IT: the lineup tables print surnames to fit five to a row, so the
   full name (first and last, as stored) is the span's title on hover, and what a screen reader reads in
   place of the cut one (kit .ep-sr) */
function shortEl(ctx, id, tag, cls) {
  const full = nameOf(ctx, id), cut = short(ctx, id);
  const s = el(tag || 'span', cls || null);
  s.title = full;
  if (cut === full) { s.textContent = cut; return s; }
  const seen = el('span', null, cut); seen.setAttribute('aria-hidden', 'true');
  s.append(seen, el('span', 'ep-sr', full));
  return s;
}

function circleRow(ctx, ids, o) {
  const row = el('span', 'wc-row wc-row-' + ((o && o.size) || 's'));
  byJersey(ctx, ids).forEach(id => row.appendChild(circle(ctx, Object.assign({ id }, o || {}, o && o.ringOf ? { ring: o.ringOf(id) } : {}))));
  return row;
}

/* ---------------------------------------------------------------- pieces --- */
function relChip(rel, thr) {
  if (rel === 'ok') return null;
  const c = el('span', 'wchip ' + rel, rel === 'tiny' ? 'tiny sample' : 'small sample');
  c.title = 'Under ' + thr.minMinutes + ' min or ' + thr.minPoss + ' possessions: read with care';
  return c;
}
function seg(items, value, onPick, label) {
  const g = el('div', 'pg-seg'); g.setAttribute('role', 'group'); if (label) g.setAttribute('aria-label', label);
  items.forEach(([v, t, disabled, title]) => {
    const b = el('button', null, t); b.type = 'button';
    b.dataset.v = String(v);
    b.setAttribute('aria-pressed', String(v === value));
    if (disabled) { b.disabled = true; b.classList.add('locked'); }
    if (title) b.title = title;
    b.addEventListener('click', () => { if (!disabled && v !== value) onPick(v); });
    g.appendChild(b);
  });
  return g;
}
function numField(label, value, step, onChange, title) {
  const f = el('label', 'wfield');
  f.appendChild(el('span', 'wl', label));
  const i = el('input', 'ep-input'); i.type = 'number'; i.min = '0'; i.step = String(step); i.value = String(value); i.inputMode = 'decimal';
  if (title) i.title = title;
  i.addEventListener('change', () => onChange(i.value));
  f.appendChild(i);
  return f;
}
function notice(text, cls) { return el('p', 'wnote ' + (cls || ''), text); }
/* signed out, what is locked waits for an account rather than a membership (access.js signinFirst) */
function signinFirst() { const A = root.EpinoiaAccess; try { return !!(A && typeof A.signinFirst === 'function' && A.signinFirst('wowy')); } catch (_) { return false; } }
function btn(label, onClick, cls, title) {
  const b = el('button', 'ep-btn wbtn ' + (cls || ''), label); b.type = 'button'; if (title) b.title = title;
  b.addEventListener('click', onClick); return b;
}
function teaser(ctx, title, lines) {
  const A = root.EpinoiaAccess;
  const box = el('div', 'wtease');
  if (A && typeof A.teaserHTML === 'function') {
    box.innerHTML = A.teaserHTML({ leagueSlug: ctx.league && ctx.league.slug, title, lines: lines || [] });   // escaped by access.js
  } else {
    box.appendChild(el('p', null, title));
  }
  return box;
}
/* the site's lock on a control or a block (memlock.js): the stop-sign cursor and ACCESS IS MEMBERSHIP-ONLY */
function lockIt(ctx, node, what) {
  const M = root.EpinoiaMemLock;
  if (M && typeof M.lock === 'function') M.lock(node, { what: what || 'Play-by-play stats', passive: true, leagueSlug: ctx.league && ctx.league.slug });
  return node;
}

/* the colour key: what the tints mean and what they were measured against */
function legend(ctx, o) {
  const k = el('div', 'wkey');
  const bar = el('div', 'wkey-bar');
  bar.appendChild(el('span', 'wk-lo', 'worse'));
  bar.appendChild(el('i', 'wk-grad'));
  bar.appendChild(el('span', 'wk-hi', 'better'));
  k.appendChild(bar);
  const p = el('p', 'wkey-t');
  p.textContent = 'Each value is coloured by where it ranks among ' + (o.note || 'the units on this page') +
    '; the play-by-play stats rank among this team’s own units. Green is better for the team, red worse: for turnovers, the opponent’s shooting and defensive rating lower is better, so the colours turn round. Style stats (pace, shot clock, heliocentrism, where the shots and rebounds come from, how often a unit runs) are not good or bad and stay uncoloured. ' +
    'Δ is the on/off delta: this unit minus the team’s minutes without it (a player: the team with him on minus off). ▲ ▼ say which way it moved. Grey rows are a small sample (under ' + ctx.thr.minMinutes + ' min or ' + ctx.thr.minPoss + ' possessions).';
  k.appendChild(p);
  return k;
}

/* WHO THEY FACED: the toggle every section carries, its key, and how much of the season it covers */
function facedBar(ctx, o) {
  const S = ctx.state, G = ctx.gate;
  const box = el('div', 'wfaced');
  const items = W.FACED.filter(f => !(o && o.noAll && f[0] === 'all')).map(f => [f[0], f[1], false, f[2]]);
  const cur = o && o.noAll && S.vs === 'all' ? 'start' : S.vs;
  const g = seg(items, G.events ? cur : 'all', v => ctx.go({ vs: v }), 'Minutes against');
  box.appendChild(el('span', 'wl', 'Against'));
  box.appendChild(g);
  if (!G.events) g.querySelectorAll('button').forEach(b => { if (b.dataset.v !== 'all') lockIt(ctx, b, 'The vs-starters split'); });
  const E = ctx.ev;
  let msg = '';
  if (!G.events) msg = signinFirst() ? 'Splitting by who the other side had on reads the play-by-play: sign in to see it.'
                                      : 'Splitting by who the other side had on reads the play-by-play: members only.';
  else if (E.status === 'loading') msg = 'Reading play-by-play… ' + E.done + '/' + E.total + ' games';
  else if (E.status === 'error') msg = 'The play-by-play could not be read: stint numbers only.';
  else if (E.status === 'ready') {
    msg = (cur === 'all' ? 'Play-by-play read for ' + E.covered + ' of ' + E.total + ' games' : 'Opponent’s five known in ' + E.oppCovered + ' of ' + E.total + ' games; only those minutes count here') +
      '. Starters: the five the opponent started that game. Mixed: three or four of them on. Bench: two or fewer.';
  }
  const p = el('p', 'wnote wfaced-n', msg); p.setAttribute('role', 'status');
  box.appendChild(p);
  return box;
}

/* how the list reads: cards or a table, values, deltas or both */
function layBar(ctx, o) {
  const S = ctx.state;
  const b = el('div', 'wlay');
  b.appendChild(seg([['cards', 'Cards'], ['table', 'Table']], S.lay, v => ctx.go({ lay: v }), 'Layout'));
  b.appendChild(seg([['values', 'Values'], ['deltas', 'Deltas'], ['both', 'Both']], S.dm, v => ctx.go({ dm: v }), 'Show'));
  if (o && o.picker && S.lay === 'table') b.appendChild(columnPicker(ctx, o.picker, () => ctx.redraw()));
  return b;
}

/* the column picker: grouped by category, searchable, remembered by the page */
function columnPicker(ctx, view, onChange) {
  const keys = ctx.cols(view);
  const kind = ctx.kind();
  const lim = W.limits(kind);
  const d = el('details', 'wcp');
  const sm = el('summary', 'ep-btn wbtn', 'Columns ' + keys.length + '/' + lim.max);
  d.appendChild(sm);
  const body = el('div', 'wcp-b');
  const search = el('input', 'ep-input'); search.type = 'search'; search.placeholder = 'Search stats'; search.setAttribute('aria-label', 'Search stats');
  body.appendChild(search);
  const list = el('div', 'wcp-l'); body.appendChild(list);
  const draw = () => {
    clear(list);
    const cur = ctx.cols(view);
    W.searchColumns(search.value).forEach(g => {
      const h = el('div', 'wcp-g');
      h.appendChild(el('span', null, g.title));
      const all = el('button', 'wcp-all', 'all'); all.type = 'button';
      all.addEventListener('click', () => { let c = ctx.cols(view); g.cols.forEach(cc => { if (c.indexOf(cc.key) === -1) c = W.toggleColumn(c, cc.key, kind); }); ctx.setCols(view, c); draw(); onChange(); });
      const none = el('button', 'wcp-all', 'none'); none.type = 'button';
      none.addEventListener('click', () => { let c = ctx.cols(view); g.cols.forEach(cc => { if (c.indexOf(cc.key) !== -1) c = W.toggleColumn(c, cc.key, kind); }); ctx.setCols(view, c); draw(); onChange(); });
      h.append(all, none);
      list.appendChild(h);
      g.cols.forEach(c => {
        const on = cur.indexOf(c.key) !== -1;
        const lab = el('label', 'wcp-c' + (on ? ' on' : ''));
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = on; cb.disabled = !on && cur.length >= lim.max;
        cb.addEventListener('change', () => { ctx.setCols(view, W.toggleColumn(ctx.cols(view), c.key, kind)); draw(); sm.textContent = 'Columns ' + ctx.cols(view).length + '/' + lim.max; onChange(); });
        lab.append(cb, el('b', null, c.label), el('span', null, c.name + (c.src === 'ev' ? ' (play-by-play)' : '')));
        list.appendChild(lab);
      });
    });
    if (!list.firstChild) list.appendChild(el('p', 'wnote', 'No stat matches that.'));
  };
  search.addEventListener('input', draw);
  const foot = el('div', 'wcp-f');
  foot.appendChild(el('span', 'wnote', 'The table scrolls sideways inside itself; the first column stays put.'));
  foot.appendChild(btn('Reset', () => { ctx.setCols(view, null); draw(); sm.textContent = 'Columns ' + ctx.cols(view).length + '/' + lim.max; onChange(); }));
  body.appendChild(foot);
  d.appendChild(body);
  d.addEventListener('toggle', () => { if (d.open) draw(); });
  return d;
}

/* rail of circles to pick from. o: { ids, sel:Set|array, onPick(id), max, ringOf(id), dimOf(id) } */
function rail(ctx, o) {
  const r = el('div', 'wrail');
  const sel = new Set(o.sel || []);
  o.ids.forEach(id => {
    const item = el('div', 'wrail-i' + (sel.has(id) ? ' on' : ''));
    const c = circle(ctx, { id, button: true, size: 'm', ring: o.ringOf ? o.ringOf(id) : (sel.has(id) ? 'on' : null), sel: sel.has(id), dim: o.dimOf ? o.dimOf(id) : false });
    if (o.max && !sel.has(id) && sel.size >= o.max) { c.disabled = true; c.classList.add('locked'); }
    c.addEventListener('click', () => o.onPick(id));
    item.appendChild(c);
    item.appendChild(shortEl(ctx, id, 'span', 'wrail-n'));
    r.appendChild(item);
  });
  return r;
}

/* =================================================================== CELLS ===
   What one stat of one row reads as, whatever draws it (a tile, a table cell, a split row): the value, why it
   is missing, its heat, its delta. The event state decides the play-by-play stats: 'locked' for a preview,
   'loading' while the log is read, 'na' where no log is read at all (the whole league's list). */
function cellOf(ctx, k, row, o) {
  const c = W.col(k);
  const line = row.line || {};
  const ev = c.src === 'ev';
  const state = ev ? (o.evState || ctx.evState()) : 'ok';
  const out = { c, text: '—', title: c.name, cls: '', bg: '', d: null, locked: false };
  if (ev && state === 'locked') { out.locked = true; out.text = ''; return out; }
  if (ev && state === 'loading') { out.text = '…'; out.title = c.name + ': reading the play-by-play'; out.cls = 'ld'; return out; }
  if (ev && state === 'na') { out.title = c.name + ': pick one team to read its play-by-play'; return out; }
  const v = line[k];
  if (!isNum(v)) {
    const E = line._ev;
    out.title = c.name + ': ' + (ev && !line.evn ? 'the play-by-play of these minutes could not be read'
      : ev && c.zone === 1 && E && !E.zones ? W.NOZONE
      : ev && c.zone === 2 && E && !E.ozones ? W.NOZONE
      : (c.why || 'nothing to count in these minutes'));
    return out;
  }
  out.text = W.fmt(c, v) + (c.unit ? c.unit : '');
  const rel = row.rel || 'ok';
  if (c.heat === 'seq') {
    out.sq = W.seqShare(v, (o.maxes || {})[k]);
  } else if (c.dir && rel !== 'tiny') {
    const sc = (ev ? o.evScales : o.scales) || {};
    const t = W.tone(sc[k], v, c.dir);
    const b = W.band(t);
    if (b) {
      out.band = b;
      out.bg = W.tint(t);
      out.title = c.name + ': ' + out.text + ' · better than ' + Math.round(((t + 1) / 2) * 100) + '% of ' + (ev ? 'this team’s units' : (o.scaleNote || 'the reference'));
    }
  }
  if (k === 'helio' && line.helioTop) out.title += ' · top user ' + nameOf(ctx, line.helioTop) + ': ' + line.helioShare + '% of the ' + line.helioUsed + ' plays used, usage ' + line.helioUsage + '% while on · the load is shared like ' + line.helioEff + ' equal hands of 5';
  if (row.rest) {
    const x = W.delta(k, line, row.rest);
    if (x.d != null) {
      out.d = { text: W.fmtDelta(c, x.d), arrow: x.arrow, cls: x.good == null ? 'nt' : x.good > 0 ? 'gd' : x.good < 0 ? 'bd' : 'nt' };
      out.title += ' · Δ ' + out.d.text + ' against ' + (o.restName || 'the rest of the team') + ' (' + W.fmt(c, row.rest[k]) + (c.unit || '') + ')';
    }
  }
  return out;
}
function deltaNode(d) {
  const s = el('span', 'wd ' + d.cls);
  if (d.arrow) s.appendChild(el('i', null, d.arrow));
  s.appendChild(document.createTextNode(d.text));
  return s;
}

/* ============================================================ THE LIST ===
   o: { rows: [{ key, ids, line, rest, team, rel, label?, sub? }], keys (table columns), sort, dir, onSort(key, pick),
        scales, evScales, scaleNote, restName, max, more(), headLabel, label(row)->node, expand(row)->node,
        empty, view (the picker's name), rank: true to number the rows, cats (the categories a card shows) } */
function statList(ctx, o) {
  const host = el('div', 'wl-host');
  const rows = o.rows || [];
  if (!rows.length) { host.appendChild(el('div', 'pg-empty', o.empty || 'Nothing has shared the floor for long enough yet.')); return host; }
  const maxes = {};
  ['mins', 'poss'].forEach(k => { maxes[k] = rows.reduce((m, u) => Math.max(m, isNum(u.line[k]) ? u.line[k] : 0), 0); });
  const opts = Object.assign({ maxes }, o);
  const shown = rows.slice(0, o.max || 25);
  if (ctx.state.lay === 'table') host.appendChild(tableOf(ctx, shown, opts));
  else host.appendChild(cardsOf(ctx, shown, opts));
  if (rows.length > (o.max || 25) && o.more) {
    const more = el('button', 'ep-btn ft-morerows', 'Show ' + Math.min(25, rows.length - (o.max || 25)) + ' more of ' + (rows.length - (o.max || 25)) + ' left');
    more.type = 'button'; more.addEventListener('click', () => o.more());
    host.appendChild(more);
  }
  hydrate(ctx, host);
  return host;
}

function labelOf(ctx, row, o, size) {
  if (o.label) return o.label(row, size);
  const box = el('div', 'wu-lab');
  box.appendChild(circleRow(ctx, row.ids, { size: size || 's', team: row.team || undefined }));
  const names = el('div', 'wu-names');
  byJersey(ctx, row.ids).forEach(id => names.appendChild(shortEl(ctx, id)));
  box.appendChild(names);
  const meta = el('div', 'wu-meta');
  if (o.showTeam && row.team) { const tt = el('span', 'wu-team', row.team.short || row.team.name); tt.style.color = 'var(--wc)'; meta.appendChild(tt); }
  const chip = relChip(row.rel || 'ok', ctx.thr);
  if (chip) meta.appendChild(chip);
  if (meta.childNodes.length) box.appendChild(meta);
  return box;
}

/* the form strip: the unit's plus-minus in each game it played, oldest first, as the league table's streak blocks */
function formStrip(ctx, line) {
  const g = line && line.games;
  if (!g) return null;
  const order = ctx.gameOrder || {};
  const ids = Object.keys(g).filter(id => order[id] != null).sort((a, b) => order[a] - order[b]).slice(-8);
  if (!ids.length) return null;
  const s = el('span', 'wform');
  s.setAttribute('aria-label', 'Plus-minus game by game');
  ids.forEach(id => {
    const v = Math.round(g[id]);
    const b = el('span', 'stk ' + (v > 0 ? 'w' : v < 0 ? 'l' : 'e'));
    b.appendChild(el('i'));
    const gm = ctx.gameInfo ? ctx.gameInfo(id) : null;
    b.title = (v > 0 ? '+' : '') + v + (gm ? ' · ' + gm : '');
    s.appendChild(b);
  });
  return s;
}

function catKeys(o) {
  return (o.cats || W.GROUPS.map(g => g[0])).map(g => ({ g, title: (W.GROUPS.find(x => x[0] === g) || [0, g])[1], keys: W.GROUP_KEYS[g] || [] }));
}
const CATS_KEY = 'epinoia.wowy.cats';
function catsOpen(ctx) {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(CATS_KEY) || 'null'); } catch (_) { /* the default */ }
  if (saved && typeof saved === 'object') return saved;
  const phone = ctx.kind() === 'phone';
  return { basic: true, four: !phone, helio: !phone, shoot: !phone, play: !phone, rebo: !phone };
}
function setCatOpen(g, open) {
  try { const s = JSON.parse(localStorage.getItem(CATS_KEY) || '{}') || {}; s[g] = open; localStorage.setItem(CATS_KEY, JSON.stringify(s)); } catch (_) { /* per-viewer only */ }
}

function tileOf(ctx, k, row, o) {
  const x = cellOf(ctx, k, row, o);
  const dm = ctx.state.dm;
  const t = el('div', 'wtl' + (x.cls ? ' ' + x.cls : '') + (x.band === 5 ? ' top' : x.band === 1 ? ' bot' : ''));
  t.title = x.title;
  t.appendChild(el('span', 'wtl-l', x.c.label));
  if (x.locked) { t.classList.add('lk'); t.appendChild(el('b', 'wtl-v wtl-lk', 'Members')); return t; }
  if (x.bg) t.style.backgroundColor = x.bg;
  if (x.sq != null) t.style.setProperty('--sq', x.sq.toFixed(2));
  if (x.sq != null) t.classList.add('sq');
  if (dm !== 'deltas' || !x.d) t.appendChild(el('b', 'wtl-v', x.text));
  if (dm !== 'values' && x.d) t.appendChild(deltaNode(x.d));
  else if (dm === 'deltas' && !x.d) t.appendChild(el('b', 'wtl-v', x.text));
  if (k === 'helio' && row.line.helioTop && !x.locked && x.text !== '…') t.appendChild(el('span', 'wtl-s', short(ctx, row.line.helioTop) + ' ' + row.line.helioShare + '%'));
  return t;
}

function cardsOf(ctx, rows, o) {
  const wrap = el('div', 'wlc-list');
  const open = catsOpen(ctx);
  const locked = ctx.evState() === 'locked';
  rows.forEach((row, i) => {
    const card = el('article', 'wlc rel-' + (row.rel || 'ok'));
    const colour = safeColour((row.team || ctx.team || {}).colour);
    card.style.setProperty('--wc', colour);
    card.style.setProperty('--wci', inkOn(colour));
    const head = el('header', 'wlc-h');
    if (o.rank !== false) {
      const rk = el('span', 'wlc-rk' + (i < 3 ? ' r' + (i + 1) : ''), String(i + 1));
      rk.title = 'Rank ' + (i + 1) + ' by ' + (W.col(o.sort) ? W.col(o.sort).name : 'minutes');
      head.appendChild(rk);
    }
    const who = el('div', 'wlc-who');
    who.appendChild(labelOf(ctx, row, o, ctx.kind() === 'phone' ? 's' : 'm'));
    head.appendChild(who);
    const hero = el('div', 'wlc-hero');
    const net = cellOf(ctx, 'net', row, o);
    const nv = el('b', 'wlc-net ' + (isNum(row.line.net) ? (row.line.net > 0 ? 'pos' : row.line.net < 0 ? 'neg' : '') : ''), net.text);
    nv.title = net.title;
    hero.appendChild(nv);
    hero.appendChild(el('span', 'wlc-netl', 'NET'));
    if (net.d && ctx.state.dm !== 'values') hero.appendChild(deltaNode(net.d));
    hero.appendChild(el('span', 'wlc-sm', W.fmt('mins', row.line.mins) + ' min · ' + W.fmt('poss', row.line.poss) + ' poss'));
    const fs = formStrip(ctx, row.line);
    if (fs) hero.appendChild(fs);
    head.appendChild(hero);
    card.appendChild(head);

    const cats = el('div', 'wlc-cats');
    catKeys(o).forEach(cat => {
      const d = el('details', 'wlc-cat');
      d.dataset.g = cat.g;
      d.open = cat.g in open ? !!open[cat.g] : cat.g === 'basic';
      const sm = el('summary', null, cat.title);
      d.appendChild(sm);
      d.addEventListener('toggle', () => setCatOpen(cat.g, d.open));
      const tiles = el('div', 'wlc-tiles');
      const allEv = cat.keys.every(k => W.col(k).src === 'ev');
      if (locked && allEv) {
        const lk = el('div', 'wlc-lock', signinFirst() ? 'Play-by-play stats: sign in to see them' : 'Play-by-play stats: members only');
        tiles.appendChild(lockIt(ctx, lk, cat.title));
      } else cat.keys.forEach(k => {
        const t = tileOf(ctx, k, row, o);
        if (t.classList.contains('lk')) lockIt(ctx, t, W.col(k).name);
        tiles.appendChild(t);
      });
      d.appendChild(tiles);
      cats.appendChild(d);
    });
    card.appendChild(cats);
    if (o.expand) {
      const more = el('details', 'wlc-more');
      more.appendChild(el('summary', null, o.expandLabel || 'Against the rest of the team'));
      more.addEventListener('toggle', () => { if (more.open && more.childNodes.length === 1) { more.appendChild(o.expand(row)); hydrate(ctx, more); } }, { once: false });
      card.appendChild(more);
    }
    wrap.appendChild(card);
  });
  return wrap;
}

function tableOf(ctx, rows, o) {
  const keys = o.keys || ctx.cols(o.view || 'lineups');
  const dm = ctx.state.dm;
  const wrap = el('div', 'ft-wrap wx-wrap');
  const t = el('table', 'ft wx');
  const thead = el('thead');
  /* the category row: one header over each run of columns from the same category */
  const gr = el('tr', 'wx-g');
  gr.appendChild(el('th', 'stick wx-h0 wx-gh', ''));
  let i = 0;
  while (i < keys.length) {
    const g = W.col(keys[i]).group; let n = 0;
    while (i + n < keys.length && W.col(keys[i + n]).group === g) n++;
    const th = el('th', 'wx-gh g-' + g, (W.GROUPS.find(x => x[0] === g) || [0, g])[1]); th.colSpan = n;
    gr.appendChild(th); i += n;
  }
  thead.appendChild(gr);
  const hr = el('tr');
  hr.appendChild(el('th', 'stick wx-h0', o.headLabel || 'LINEUP'));
  const locked = ctx.evState() === 'locked';
  const gs = new Set(keys.filter((k, j) => j > 0 && W.col(k).group !== W.col(keys[j - 1]).group));
  gr.querySelectorAll('th.wx-gh').forEach((th, j) => { if (j > 1) th.classList.add('gs'); });
  keys.forEach(k => {
    const c = W.col(k);
    const th = el('th', 'g-' + c.group + (gs.has(k) ? ' gs' : '') + (o.sort === k ? ' sorted' : ''), c.label + (o.sort === k ? (o.dir === 'asc' ? ' ▲' : ' ▼') : ''));
    th.title = c.name + (c.dir ? (c.dir > 0 ? ' (higher is better)' : ' (lower is better)') : ' (a style, not good or bad)');
    if (o.onSort) {
      th.tabIndex = 0; th.setAttribute('role', 'button');
      const go = () => o.onSort(k);
      th.addEventListener('click', go);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    }
    if (locked && c.src === 'ev') lockIt(ctx, th, c.name);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  t.appendChild(thead);
  const tb = el('tbody');
  rows.forEach((row, ri) => {
    const tr = el('tr', 'wr rel-' + (row.rel || 'ok'));
    const colour = safeColour((row.team || ctx.team || {}).colour);
    tr.style.setProperty('--wc', colour);
    const c0 = el('td', 'stick wx-c0');
    const c0i = el('div', 'wx-c0i');
    if (o.rank !== false) c0i.appendChild(el('span', 'wx-rk' + (ri < 3 ? ' r' + (ri + 1) : ''), String(ri + 1)));
    c0i.appendChild(labelOf(ctx, row, o, 'xs'));
    c0.appendChild(c0i);
    tr.appendChild(c0);
    keys.forEach(k => {
      const x = cellOf(ctx, k, row, o);
      const td = el('td', 'hc g-' + x.c.group + (gs.has(k) ? ' gs' : '') + (k === 'net' ? ' lead' : '') + (x.cls ? ' ' + x.cls : ''));
      td.title = x.title;
      if (x.locked) { td.classList.add('lk'); td.textContent = 'members'; }
      else {
        if (x.bg) td.style.background = x.bg;
        if (x.band) td.dataset.b = String(x.band);
        if (x.sq != null) { td.classList.add('sq'); td.style.setProperty('--sq', x.sq.toFixed(2)); }
        if (dm !== 'deltas' || !x.d) td.appendChild(el('span', 'cv', x.text));
        if (dm !== 'values' && x.d) td.appendChild(deltaNode(x.d));
      }
      tr.appendChild(td);
    });
    if (o.expand) {
      tr.classList.add('xp'); tr.tabIndex = 0; tr.setAttribute('aria-expanded', 'false');
      const toggle = () => {
        const open = tr.getAttribute('aria-expanded') === 'true';
        if (open) { tr.setAttribute('aria-expanded', 'false'); const nx = tr.nextSibling; if (nx && nx.classList.contains('wr-x')) nx.remove(); }
        else {
          tr.setAttribute('aria-expanded', 'true');
          const xr = el('tr', 'wr-x'); const xd = el('td'); xd.colSpan = keys.length + 1;
          xd.appendChild(o.expand(row)); xr.appendChild(xd);
          tr.parentNode.insertBefore(xr, tr.nextSibling);
          hydrate(ctx, xr);
        }
      };
      tr.addEventListener('click', e => { if (e.target.closest('a,button,input,select')) return; toggle(); });
      tr.addEventListener('keydown', e => { if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } });
    }
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  if (locked) tb.querySelectorAll('td.lk').forEach(td => lockIt(ctx, td, 'Play-by-play stats'));
  wrap.appendChild(t);
  return wrap;
}

/* --------------------------------------------------------------- split grid ---
   ON against OFF for every stat (the play-by-play ones too), with the difference coloured by whether it is good
   for the team. labels: { on, off } */
function splitGrid(ctx, on, off, labels, o) {
  const t = el('table', 'wsg');
  const head = el('tr'); ['STAT', labels.on, labels.off, 'Δ'].forEach((h, i) => head.appendChild(el('th', i ? 'n' : '', h)));
  const th = el('thead'); th.appendChild(head); t.appendChild(th);
  const tb = el('tbody');
  const state = ctx.evState();
  W.GROUPS.forEach(([g, title]) => {
    const gr = el('tr', 'wsg-g'); const td = el('td', null, title); td.colSpan = 4; gr.appendChild(td); tb.appendChild(gr);
    W.COLS.filter(c => c.group === g).forEach(c => {
      const tr = el('tr');
      const nm = el('td', 'nm', c.label); nm.title = c.name; tr.appendChild(nm);
      if (c.src === 'ev' && state === 'locked') {
        const lk = el('td', 'n lk', 'members'); lk.colSpan = 3; tr.appendChild(lockIt(ctx, lk, c.name)); tb.appendChild(tr); return;
      }
      const a = cellOf(ctx, c.key, { line: on, rest: off, rel: o && o.rel }, o || {});
      const b = cellOf(ctx, c.key, { line: off, rel: o && o.relOff }, o || {});
      const cell = x => { const d = el('td', 'n' + (x.cls ? ' ' + x.cls : ''), x.text); d.title = x.title; if (x.bg) d.style.background = x.bg; return d; };
      tr.appendChild(cell(a)); tr.appendChild(cell(b));
      const d = el('td', 'n d ' + (a.d ? a.d.cls : ''), a.d ? a.d.text : '—');
      if (a.d && a.d.arrow) d.dataset.a = a.d.arrow;
      tr.appendChild(d);
      tb.appendChild(tr);
    });
  });
  t.appendChild(tb);
  const w = el('div', 'wsg-wrap'); w.appendChild(t);
  return w;
}

/* tiles for one line, a few stats, with the delta under each */
function tiles(ctx, row, keys, o) {
  const box = el('div', 'wtiles');
  keys.forEach(k => {
    const x = cellOf(ctx, k, row, o || {});
    const t = el('div', 'wtile');
    t.title = x.title;
    if (x.locked) { lockIt(ctx, t, x.c.name); t.appendChild(el('div', 'v', '·')); t.appendChild(el('div', 'l', x.c.label)); box.appendChild(t); return; }
    if (x.bg) t.style.backgroundImage = 'linear-gradient(' + x.bg + ',' + x.bg + ')';
    if (x.band >= 5) t.dataset.a = '▲'; else if (x.band === 1) t.dataset.a = '▼';
    t.appendChild(el('div', 'v', x.text));
    t.appendChild(el('div', 'l', x.c.label));
    if (x.d) { const dd = deltaNode(x.d); dd.classList.add('s'); t.appendChild(dd); }
    else if (o && o.sub && o.sub(k)) t.appendChild(el('div', 's', o.sub(k)));
    box.appendChild(t);
  });
  return box;
}

/* ================================================================= VIEWS === */

/* what opens under a unit: the split against the rest of its team, and what to do with it */
function unitDetail(ctx, row, o) {
  const box = el('div', 'wdet');
  const head = el('div', 'wdet-h');
  head.appendChild(circleRow(ctx, row.ids, { size: 'm', team: row.team || undefined }));
  const t = el('div', 'wdet-t');
  { const b = el('b'); byJersey(ctx, row.ids).forEach((id, i) => { if (i) b.appendChild(document.createTextNode(' · ')); b.appendChild(shortEl(ctx, id)); }); t.appendChild(b); }
  t.appendChild(el('span', null, row.ids.length + ' on the floor · ' + W.fmt('mins', row.line.mins) + ' min · ' + W.fmt('poss', row.line.poss) + ' possessions'));
  head.appendChild(t);
  box.appendChild(head);
  box.appendChild(splitGrid(ctx, row.line, row.rest, { on: 'THIS UNIT', off: 'REST OF TEAM' }, o));
  const acts = el('div', 'wdet-a');
  if (!row.team || !ctx.team || row.team.id === ctx.team.id) {
    acts.appendChild(btn('Copy link', () => ctx.link({ v: 'build', u: row.ids.slice(0, 5) })));
    acts.appendChild(btn('Open in builder', () => ctx.go({ v: 'build', u: row.ids.slice(0, 5) })));
    if (row.ids.length <= 5) acts.appendChild(btn('Open in WOWY', () => ctx.go({ v: 'wowy', w: row.ids.slice(0, 5) })));
  }
  box.appendChild(acts);
  box.appendChild(notice('Rest of team = every minute this team played without all of these players on together' + (ctx.state.vs !== 'all' ? ', against the same kind of opponent five' : '') + '.'));
  return box;
}

/* ------------------------------------------------- the lineups view --- */
function lineupsView(ctx, host) {
  const S = ctx.state, G = ctx.gate;
  clear(host);
  if (S.t !== 'all') host.appendChild(facedBar(ctx));
  const bar = el('div', 'wbar');
  const sizes = [2, 3, 4, 5].map(n => [n, n + '-man', G.sizes.indexOf(n) === -1, G.sizes.indexOf(n) === -1 ? 'Members: units of ' + n + ' players' : null]);
  bar.appendChild(seg(sizes, S.sz, v => ctx.go({ sz: v }), 'Unit size'));
  bar.appendChild(seg([['', 'Most used'], ['best', 'Best net'], ['worst', 'Worst net']], S.best, v => ctx.go({ best: v, sort: v ? 'net' : 'mins', dir: v === 'worst' ? 'asc' : 'desc' }), 'Order'));
  bar.appendChild(numField('Min minutes', S.mm, 0.5, v => ctx.go({ mm: W.normThr(v, S.mp).minMinutes }), 'A unit needs this many minutes to be ranked and to count in the colours'));
  bar.appendChild(numField('Min possessions', S.mp, 1, v => ctx.go({ mp: W.normThr(S.mm, v).minPoss })));
  bar.appendChild(btn('Copy link', () => ctx.link(), 'ghost', 'A link to exactly this view'));
  host.appendChild(bar);
  host.appendChild(layBar(ctx, { picker: 'lineups' }));

  /* the players to keep in or leave out: click a circle once for WITH him, twice for WITHOUT him */
  const roster = ctx.rosterIds();
  if (roster.length && S.t !== 'all') {
    const f = el('div', 'wfilter');
    f.appendChild(el('span', 'wl', 'With / without'));
    f.appendChild(rail(ctx, {
      ids: roster, sel: [], onPick: id => { const c = W.cycleFilter(S.inc, S.exc, id); ctx.go({ inc: c.inc.slice(0, G.players), exc: c.exc.slice(0, G.players) }); },
      ringOf: id => S.inc.indexOf(id) !== -1 ? 'on' : S.exc.indexOf(id) !== -1 ? 'off' : null,
      dimOf: id => S.inc.indexOf(id) === -1 && S.exc.indexOf(id) === -1 && (S.inc.length || S.exc.length) > 0
    }));
    f.appendChild(el('p', 'wnote', (S.inc.length || S.exc.length) ? 'Green ring: must be on the floor. Red ring: must be off it. Click again to cycle.' : 'Click a circle to keep only units with him; click again for only units without him.'));
    host.appendChild(f);
  }
  if (G.preview) host.appendChild(teaser(ctx, 'The full lineups list is for members', ['Units of two, three and four players as well as fives, every row, the play-by-play stats and the vs-starters split. A preview shows the five best fives.']));

  const size = G.sizes.indexOf(S.sz) === -1 ? 5 : S.sz;
  const all = ctx.unitRows(size);
  let units = W.filterUnits(all.map(r => Object.assign(r, { mins: r.line.mins, poss: r.line.poss })), { inc: S.inc, exc: S.exc });
  if (G.preview) {
    /* the five best fives with a proper sample; early in a season, when none has one yet, the most used */
    const ok = sortLines(units.slice(), 'net', 'desc', ctx.thr, true);
    units = (ok.length ? ok : sortLines(units.slice(), 'mins', 'desc', ctx.thr, false)).slice(0, G.rows);
  }
  else units = sortLines(units, S.sort, S.dir, ctx.thr, S.best === 'best' || S.best === 'worst');
  const info = el('p', 'wcount', units.length + ' ' + size + '-man unit' + (units.length === 1 ? '' : 's') +
    (S.t === 'all' ? ' across the league' : ' for ' + (ctx.team ? ctx.team.name : 'the team')) + (S.vs !== 'all' && S.t !== 'all' ? ' · ' + facedName(S.vs) : ''));
  host.appendChild(info);
  host.appendChild(legend(ctx, { note: ctx.scaleNote(size) }));
  host.appendChild(statList(ctx, {
    rows: units, view: 'lineups', keys: ctx.cols('lineups'), sort: G.preview ? 'net' : S.sort, dir: G.preview ? 'desc' : S.dir,
    scales: ctx.scalesFor(size), evScales: ctx.evScales(size), scaleNote: ctx.scaleNote(size), max: Math.min(G.rows, ctx.rowsMax),
    showTeam: S.t === 'all', evState: S.t === 'all' ? (G.events ? 'na' : 'locked') : undefined,
    onSort: k => ctx.go({ sort: k, dir: S.sort === k && S.dir === 'desc' ? 'asc' : 'desc', best: '' }),
    more: () => { ctx.rowsMax += 25; ctx.redraw(); },
    expand: row => unitDetail(ctx, row, { scales: ctx.scalesFor(size), evScales: ctx.evScales(size) }),
    empty: S.vs !== 'all' && ctx.ev.status !== 'ready' ? 'Reading the play-by-play to split by the opponent’s five…' : 'No ' + size + '-man unit has played yet under those filters.'
  }));
}
const facedName = v => (W.FACED.find(f => f[0] === v) || [0, 'All'])[1];

/* rows carry their line: sort on it, small samples out of a best/worst list */
function sortLines(rows, key, dir, thr, gateSample) {
  const flat = rows.map(r => Object.assign(r, { [key]: r.line[key], mins: r.line.mins, poss: r.line.poss }));
  return W.sortRows(flat, key, dir, thr, gateSample);
}

/* ------------------------------------------------------ the overview view --- */
function overviewView(ctx, host) {
  clear(host);
  const S = ctx.state;
  const team = ctx.team;
  host.appendChild(facedBar(ctx));
  const tot = ctx.teamRow();
  const tscale = ctx.teamScales();
  const keys = ['net', 'ortg', 'drtg', 'pace40', 'mins', 'poss', 'sclock', 'helio', 'ts', 'trfreq', 'rim100', 'p3a100'];
  host.appendChild(tiles(ctx, tot, keys, {
    scales: tscale, evScales: {}, scaleNote: 'the league’s teams', restName: S.vs === 'all' ? 'the league’s average team' : 'the team’s other minutes',
    sub: k => { const sc = tscale[k]; const c = W.col(k); if (S.vs !== 'all' || !sc || !c.dir) return ''; const tn = W.tone(sc, tot.line[k], c.dir); return tn == null ? '' : Math.round(((tn + 1) / 2) * 100) + 'th pct of teams'; }
  }));
  host.appendChild(notice(S.vs === 'all' ? 'Δ on these tiles: the team against the league’s average team (stint numbers; the play-by-play ones have no league reference yet).' : 'Δ on these tiles: these minutes against the team’s other minutes.'));
  if (!tscale.net && S.vs === 'all') host.appendChild(notice('The league’s other teams are still loading: the tiles gain their colour when they arrive.'));

  /* the starting five, the unit the coach picks */
  const sf = W.startingFive(ctx.games, team.id);
  if (sf) {
    const card = el('div', 'wcard wstart');
    card.appendChild(el('h3', null, 'Starting five'));
    card.appendChild(el('p', 'wsub', 'Started ' + sf.games + ' of ' + ctx.games.length + ' game' + (ctx.games.length === 1 ? '' : 's')));
    const row = ctx.rowFor(sf.ids);
    if (row.line.stints) card.appendChild(statList(ctx, { rows: [row], view: 'lineups', keys: ctx.cols('lineups'), rank: false, sort: 'mins', scales: ctx.scalesFor(5), evScales: ctx.evScales(5), scaleNote: ctx.scaleNote(5), max: 1 }));
    else card.appendChild(notice('No shared minutes on record' + (S.vs !== 'all' ? ' against this kind of five.' : '.')));
    const acts = el('div', 'wdet-a');
    acts.appendChild(btn('Open in builder', () => ctx.go({ v: 'build', u: sf.ids })));
    card.appendChild(acts);
    host.appendChild(card);
  }

  /* the rotation: every player who took the floor, biggest share of the minutes first, with the team's swing */
  const players = ctx.playerRows();
  const total = tot.line.mins || 1;
  const rot = el('div', 'wcard wrot');
  rot.appendChild(el('h3', null, 'Rotation'));
  rot.appendChild(el('p', 'wsub', 'Circle ring: green when the team is better with him on than off, red when worse. Bar: share of the team’s floor time he was on for.'));
  const grid = el('div', 'wrot-g');
  const sc = ctx.playerScales();
  players.forEach(p => {
    const sw = W.delta('net', p.line, p.rest).d;
    const rel = p.rel;
    const it = el('a', 'wrot-i rel-' + rel); it.href = '?' + ctx.qs({ v: 'onoff', p: p.id }).slice(1);
    it.addEventListener('click', e => { e.preventDefault(); ctx.go({ v: 'onoff', p: p.id }); });
    it.appendChild(circle(ctx, { id: p.id, link: false, size: 'm', ring: sw == null ? null : sw >= 0 ? 'on' : 'off' }));
    const tx = el('div', 'wrot-t');
    tx.appendChild(el('b', null, nameOf(ctx, p.id)));
    const bar = el('span', 'wrot-bar'); const fill = el('i'); fill.style.width = Math.min(100, p.line.mins / total * 100).toFixed(0) + '%'; bar.appendChild(fill);
    tx.appendChild(bar);
    const nums = el('span', 'wrot-n');
    const nv = el('span', 'wrot-net', W.fmt('net', p.line.net));
    const tn = sc.onNet ? W.tone(sc.onNet, p.line.net, 1) : null; const bg = W.tint(tn); if (bg && rel !== 'tiny') nv.style.background = bg;
    nums.append(nv, el('span', null, W.fmt('mins', p.line.mins) + ' min'), el('span', 'wrot-sw ' + (sw > 0 ? 'gd' : sw < 0 ? 'bd' : ''), 'Δ ' + W.fmtDelta('net', sw)));
    tx.appendChild(nums);
    const chip = relChip(rel, ctx.thr); if (chip) tx.appendChild(chip);
    it.appendChild(tx);
    grid.appendChild(it);
  });
  rot.appendChild(grid);
  host.appendChild(rot);

  /* the units most used, as the Lineups view draws them */
  const top = el('div', 'wcard');
  top.appendChild(el('h3', null, 'Most used fives'));
  top.appendChild(layBar(ctx, { picker: 'lineups' }));
  const units = ctx.unitRows(5).slice().sort((a, b) => b.line.mins - a.line.mins).slice(0, 5);
  top.appendChild(statList(ctx, {
    rows: units, view: 'lineups', keys: ctx.cols('lineups'), sort: 'mins', dir: 'desc', scales: ctx.scalesFor(5), evScales: ctx.evScales(5), scaleNote: ctx.scaleNote(5), max: 5,
    expand: row => unitDetail(ctx, row, { scales: ctx.scalesFor(5), evScales: ctx.evScales(5) })
  }));
  top.appendChild(btn('All lineups →', () => ctx.go({ v: 'lineups' }), 'ghost'));
  host.appendChild(top);
  hydrate(ctx, host);
}

/* ------------------------------------------------------- the on/off view --- */
function onOffView(ctx, host) {
  clear(host);
  const roster = ctx.rosterIds();
  const S = ctx.state;
  const pid = S.p && roster.indexOf(S.p) !== -1 ? S.p : roster[0];
  if (!pid) { host.appendChild(el('div', 'pg-empty', 'No lineup data for this team yet.')); return null; }
  host.appendChild(facedBar(ctx));
  host.appendChild(rail(ctx, { ids: roster, sel: [pid], onPick: id => ctx.go({ p: id }), ringOf: id => (id === pid ? 'on' : null) }));
  const pr = ctx.playerRow(pid);
  const on = pr.line, off = pr.rest;
  const sc = ctx.playerScales();
  const rel = W.reliability(on, ctx.thr), relOff = W.reliability(off, ctx.thr);
  const card = (k, side, ring, r) => {
    const c = el('div', 'woo woo-' + k);
    const h = el('div', 'woo-h');
    h.appendChild(circle(ctx, { id: pid, link: k === 'on', size: 'l', ring }));
    const ht = el('div'); ht.appendChild(el('b', null, nameOf(ctx, pid)));
    ht.appendChild(el('span', null, k === 'on' ? 'on the floor' : 'off the floor'));
    h.appendChild(ht); c.appendChild(h);
    const v = el('div', 'woo-v ' + (side.net > 0 ? 'pos' : side.net < 0 ? 'neg' : ''), W.fmt('net', side.net));
    const scl = k === 'on' ? sc.onNet : sc.offNet;
    const tn = scl ? W.tone(scl, side.net, 1) : null; const bg = W.tint(tn); if (bg && r !== 'tiny') c.style.backgroundImage = 'linear-gradient(' + bg + ',' + bg + ')';
    c.appendChild(v); c.appendChild(el('div', 'woo-l', 'team net rating per 100 possessions'));
    const row = el('div', 'woo-r');
    [['ortg', 'ORTG'], ['drtg', 'DRTG'], ['pace40', 'PACE'], ['mins', 'MIN'], ['poss', 'POSS']].forEach(([kk, l]) => { const d = el('div'); d.append(el('b', null, W.fmt(kk, side[kk])), el('i', null, l)); row.appendChild(d); });
    c.appendChild(row);
    const chip = relChip(r, ctx.thr); if (chip) c.appendChild(chip);
    return c;
  };
  const wrap = el('div', 'woo-wrap');
  wrap.appendChild(card('on', on, 'on', rel));
  const swv = W.delta('net', on, off).d;
  const sw = el('div', 'woo-sw'); sw.appendChild(el('span', 'k', 'SWING')); sw.appendChild(el('span', 'n', W.fmtDelta('net', swv)));
  sw.appendChild(el('span', 'k', 'on minus off'));
  const stn = sc.swing ? W.tone(sc.swing, swv, 1) : null;
  if (stn != null && W.band(stn) >= 4) sw.classList.add('good'); else if (stn != null && W.band(stn) <= 2) sw.classList.add('bad');
  wrap.appendChild(sw);
  wrap.appendChild(card('off', off, 'off', relOff));
  host.appendChild(wrap);
  host.appendChild(notice(sc.n ? 'Colours rank his numbers against ' + sc.n + ' players across ' + (sc.source === 'league' ? 'the league' : 'this team') + ' with at least ' + Math.max(ctx.thr.minMinutes * 3, 30) + ' minutes on.' : ''));

  const det = el('details', 'wdetails'); det.open = ctx.kind() !== 'phone';
  det.appendChild(el('summary', null, 'Every stat, on against off'));
  det.appendChild(splitGrid(ctx, on, off, { on: 'ON', off: 'OFF' }, { scales: ctx.scalesFor(1), evScales: ctx.evScales(5), rel, relOff, restName: 'the team with him off' }));
  host.appendChild(det);

  /* his partners: every teammate, both circles */
  const pts = ctx.partners(pid);
  const good = pts.filter(p => p.rel !== 'tiny' && p.swing != null).sort((a, b) => b.swing - a.swing);
  const partnerCard = (p, kind) => {
    const c = el('div', 'wpartner ' + kind);
    const cr = el('div', 'wpartner-c');
    cr.appendChild(circle(ctx, { id: pid, size: 'm', ring: 'on', link: false }));
    cr.appendChild(circle(ctx, { id: p.id, size: 'm', ring: 'on' }));
    c.appendChild(cr);
    c.appendChild(el('b', null, nameOf(ctx, p.id)));
    c.appendChild(el('span', 'wpartner-n' + (p.swing > 0 ? ' pos' : p.swing < 0 ? ' neg' : ''), W.fmtDelta('net', p.swing) + ' swing'));
    c.appendChild(el('span', 'wsub', W.fmt('mins', p.both.mins) + ' min together · net ' + W.fmt('net', p.both.net) + ' vs ' + W.fmt('net', p.subjOnly.net) + ' without him'));
    c.title = 'Team net with both on, minus the team net with ' + nameOf(ctx, pid) + ' on and ' + nameOf(ctx, p.id) + ' off';
    c.addEventListener('click', e => { if (e.target.closest('a')) return; ctx.go({ v: 'pair', a: pid, b: p.id }); });
    return c;
  };
  const pw = el('div', 'wpartners');
  const best = good.slice(0, 3), worst = good.slice(-3).reverse().filter(p => best.indexOf(p) === -1);
  if (best.length) { const c1 = el('div'); c1.appendChild(el('h3', 'wh3', 'Best partners')); const g = el('div', 'wpartner-g'); best.forEach(p => g.appendChild(partnerCard(p, 'best'))); c1.appendChild(g); pw.appendChild(c1); }
  if (worst.length) { const c2 = el('div'); c2.appendChild(el('h3', 'wh3', 'Worst partners')); const g = el('div', 'wpartner-g'); worst.forEach(p => g.appendChild(partnerCard(p, 'worst'))); c2.appendChild(g); pw.appendChild(c2); }
  if (pw.firstChild) host.appendChild(pw);
  host.appendChild(notice('Swing: the team’s net rating with the two on together, minus its net with ' + nameOf(ctx, pid) + ' on and the other off. Only partners with more than a tiny sample are ranked. Tap one to open the pair.'));

  /* every player's on/off, in the list's two layouts */
  const h = el('div', 'wsubhead'); h.appendChild(el('h3', 'wh3', 'Every player, on against off')); h.appendChild(el('span', 'wnote', 'The team with each player on the floor; Δ is on minus off'));
  host.appendChild(h);
  host.appendChild(layBar(ctx, { picker: 'players' }));
  const rows = ctx.playerRows().map(p => Object.assign({}, p, { ids: [p.id] }));
  host.appendChild(statList(ctx, {
    rows: sortLines(rows, 'mins', 'desc', ctx.thr, false), view: 'players', keys: ctx.cols('players'), sort: 'mins', dir: 'desc', max: 40, headLabel: 'PLAYER',
    scales: ctx.scalesFor(1), evScales: ctx.evScales(5), restName: 'the team with him off',
    label: row => { const b = el('div', 'wu-lab wu-one'); b.appendChild(circle(ctx, { id: row.ids[0], size: 's' })); const nm = el('div', 'wu-names'); nm.appendChild(el('span', null, nameOf(ctx, row.ids[0]))); b.appendChild(nm); const ch = relChip(row.rel, ctx.thr); if (ch) b.appendChild(ch); return b; }
  }));
  hydrate(ctx, host);
  return pid;
}

/* ---------------------------------------------------------- the pair view --- */
function pairView(ctx, host) {
  clear(host);
  const G = ctx.gate;
  const roster = ctx.rosterIds();
  const S = ctx.state;
  if (roster.length < 2) { host.appendChild(el('div', 'pg-empty', 'A pair needs two players with lineup data.')); return; }
  const a = roster.indexOf(S.a) !== -1 ? S.a : roster[0];
  const b = roster.indexOf(S.b) !== -1 && S.b !== a ? S.b : roster.find(x => x !== a);
  if (!G.pair) {
    host.appendChild(teaser(ctx, 'Pairs are for members', ['Pick two players and see the four ways they shared the floor: together, either alone, neither, with every stat and its on/off delta.']));
    return;
  }
  host.appendChild(facedBar(ctx));
  const pick = el('div', 'wpick2');
  const pa = el('div'); pa.appendChild(el('span', 'wl', 'Player A')); pa.appendChild(rail(ctx, { ids: roster.filter(x => x !== b), sel: [a], onPick: id => ctx.go({ a: id }), ringOf: id => (id === a ? 'on' : null) }));
  const pb = el('div'); pb.appendChild(el('span', 'wl', 'Player B')); pb.appendChild(rail(ctx, { ids: roster.filter(x => x !== a), sel: [b], onPick: id => ctx.go({ b: id }), ringOf: id => (id === b ? 'on' : null) }));
  pick.append(pa, pb); host.appendChild(pick);

  const rows = ctx.pairRows(a, b);
  const both = rows[0], aOnly = rows[1];
  const swv = W.delta('net', both.line, aOnly.line).d;
  if (swv != null) host.appendChild(el('p', 'wswing', short(ctx, a) + ' with ' + short(ctx, b) + ' against ' + short(ctx, a) + ' without: ' + W.fmtDelta('net', swv) + ' net rating.'));
  host.appendChild(layBar(ctx, { picker: 'pair' }));
  host.appendChild(statList(ctx, {
    rows, view: 'pair', keys: ctx.cols('pair'), rank: false, sort: '', headLabel: 'ON THE FLOOR', max: 4,
    scales: ctx.scalesFor(2), evScales: ctx.evScales(2), scaleNote: ctx.scaleNote(2), restName: 'the team’s other minutes',
    label: row => {
      const box = el('div', 'wu-lab');
      const r = el('span', 'wc-row wc-row-s');
      r.appendChild(circle(ctx, { id: a, size: 's', ring: row.a ? 'on' : 'off', link: false, dim: !row.a }));
      r.appendChild(circle(ctx, { id: b, size: 's', ring: row.b ? 'on' : 'off', link: false, dim: !row.b }));
      box.appendChild(r);
      const words = row.key === 'both' ? 'Both on' : row.key === 'neither' ? 'Neither on' : row.key === 'aOnly' ? short(ctx, a) + ' without ' + short(ctx, b) : short(ctx, b) + ' without ' + short(ctx, a);
      const nm = el('div', 'wu-names'); nm.appendChild(el('span', null, row.line.stints ? words : words + ' · never happened')); box.appendChild(nm);
      const chip = row.line.stints ? relChip(row.rel, ctx.thr) : null; if (chip) { const m = el('div', 'wu-meta'); m.appendChild(chip); box.appendChild(m); }
      return box;
    }
  }));
  host.appendChild(notice('Four buckets: both on, each without the other, neither. Δ: that bucket against every other minute the team played. Heat: against the league’s two-man units (' + ctx.scaleNote(2) + ').'));
  const acts = el('div', 'wdet-a');
  acts.appendChild(btn('Copy link', () => ctx.link({ v: 'pair', a, b })));
  acts.appendChild(btn('Open both in WOWY', () => ctx.go({ v: 'wowy', w: [a, b] })));
  host.appendChild(acts);
  hydrate(ctx, host);
}

/* ------------------------------------------------ the WOWY (combinations) view --- */
function wowyView(ctx, host) {
  clear(host);
  const G = ctx.gate, S = ctx.state;
  const roster = ctx.rosterIds();
  const M = G.matrixMax;
  host.appendChild(facedBar(ctx));
  host.appendChild(notice('Pick up to ' + M + ' player' + (M === 1 ? '' : 's') + ': every arrangement of them on and off the floor, each its own line.', 'wcenter'));
  let picked = (S.w || []).filter(id => roster.indexOf(id) !== -1).slice(0, M);
  if (!picked.length) picked = roster.slice(0, Math.min(2, M));
  host.appendChild(rail(ctx, { ids: roster, sel: picked, max: M, onPick: id => {
    const i = picked.indexOf(id); const next = picked.slice(); if (i !== -1) next.splice(i, 1); else if (next.length < M) next.push(id);
    ctx.go({ w: next });
  } }));
  if (G.preview) host.appendChild(teaser(ctx, 'A preview: ' + M + (M === 1 ? ' player' : ' players') + ' at a time', ['Members compare up to five players at once, every on/off arrangement of them, with the play-by-play stats.']));
  if (!picked.length) { host.appendChild(el('div', 'pg-empty', 'Pick a player to begin.')); return; }
  const rows = ctx.matrixRows(picked);
  host.appendChild(layBar(ctx, { picker: 'matrix' }));
  const size = Math.max(1, Math.min(5, picked.length));
  host.appendChild(statList(ctx, {
    rows: sortLines(rows, 'mins', 'desc', ctx.thr, false), view: 'matrix', keys: ctx.cols('matrix'), sort: 'mins', dir: 'desc', max: 40, headLabel: 'ARRANGEMENT',
    scales: ctx.scalesFor(size), evScales: ctx.evScales(size), scaleNote: ctx.scaleNote(size), restName: 'the team’s other minutes',
    label: row => {
      const box = el('div', 'wu-lab');
      const r = el('span', 'wc-row wc-row-s');
      picked.forEach((id, i) => r.appendChild(circle(ctx, { id, size: 's', ring: row.state[i] ? 'on' : 'off', link: false, dim: !row.state[i] })));
      box.appendChild(r);
      const onN = picked.filter((id, i) => row.state[i]).map(id => short(ctx, id)), offN = picked.filter((id, i) => !row.state[i]).map(id => short(ctx, id));
      const words = !row.line.stints ? 'never shared the floor' : picked.length === 1 ? (onN.length ? onN[0] + ' on' : offN[0] + ' off') : !onN.length ? 'none of them' : !offN.length ? 'all together' : onN.join(' + ') + ' · not ' + offN.join(', ');
      const nm = el('div', 'wu-names'); nm.appendChild(el('span', null, words)); box.appendChild(nm);
      const chip = row.line.stints ? relChip(row.rel, ctx.thr) : null; if (chip) { const m = el('div', 'wu-meta'); m.appendChild(chip); box.appendChild(m); }
      return box;
    }
  }));
  host.appendChild(notice('An arrangement needs every "on" player on the floor and every "off" player off it, so the rows never overlap and add up to the team’s whole season. Δ: that arrangement against every other minute.'));
  const acts = el('div', 'wdet-a');
  acts.appendChild(btn('Copy link', () => ctx.link({ v: 'wowy', w: picked })));
  host.appendChild(acts);
  hydrate(ctx, host);
}

/* ------------------------------------------------------ the vs-starters view --- */
function vsView(ctx, host) {
  clear(host);
  const G = ctx.gate, S = ctx.state;
  if (!G.events) {
    host.appendChild(teaser(ctx, 'The vs-starters split is for members', ['Every unit and every player split by who the other side had on: its starting five, a mixed five or its bench, with every stat and its delta. It is read from the play-by-play.']));
    const M = root.EpinoiaMemLock;
    if (M && M.placeholder) host.appendChild(M.placeholder({ rows: 6, what: 'The vs-starters split', leagueSlug: ctx.league && ctx.league.slug }));
    return;
  }
  host.appendChild(facedBar(ctx, { noAll: true }));
  if (ctx.ev.status !== 'ready') { host.appendChild(el('div', 'pg-empty', ctx.ev.status === 'error' ? 'The play-by-play could not be read, so the split cannot be made.' : 'Reading the play-by-play: the split fills in when every game is read.')); return; }
  const b = S.vs === 'all' ? 'start' : S.vs;

  /* the team, one row per kind of opponent five */
  const h1 = el('div', 'wsubhead'); h1.appendChild(el('h3', 'wh3', 'The team, by who it faced')); h1.appendChild(el('span', 'wnote', 'Δ: those minutes against the team’s other minutes'));
  host.appendChild(h1);
  host.appendChild(layBar(ctx, { picker: 'vs' }));
  const teamRows = ctx.bucketRows();
  host.appendChild(statList(ctx, {
    rows: teamRows, view: 'vs', keys: ctx.cols('vs'), rank: false, sort: '', headLabel: 'AGAINST', max: 4, restName: 'the team’s other minutes',
    scales: ctx.teamScales(), evScales: {},
    label: row => { const box = el('div', 'wu-lab'); const t = el('b', 'wvs-t', row.title); box.appendChild(t); box.appendChild(el('span', 'wsub', row.sub)); const ch = relChip(row.rel, ctx.thr); if (ch) box.appendChild(ch); return box; }
  }));

  /* every player, in the chosen bucket */
  const h2 = el('div', 'wsubhead'); h2.appendChild(el('h3', 'wh3', 'Players ' + facedName(b))); h2.appendChild(el('span', 'wnote', 'The team with each player on, in those minutes; Δ is on minus off'));
  host.appendChild(h2);
  const prow = ctx.playerRows().map(p => Object.assign({}, p, { ids: [p.id] })).filter(p => p.line.stints);
  host.appendChild(statList(ctx, {
    rows: sortLines(prow, 'mins', 'desc', ctx.thr, false), view: 'vs', keys: ctx.cols('vs'), sort: 'mins', dir: 'desc', max: 30, headLabel: 'PLAYER',
    scales: ctx.scalesFor(1), evScales: ctx.evScales(5), restName: 'the team with him off',
    label: row => { const bx = el('div', 'wu-lab wu-one'); bx.appendChild(circle(ctx, { id: row.ids[0], size: 's' })); const nm = el('div', 'wu-names'); nm.appendChild(el('span', null, nameOf(ctx, row.ids[0]))); bx.appendChild(nm); const ch = relChip(row.rel, ctx.thr); if (ch) bx.appendChild(ch); return bx; },
    empty: 'No player has minutes ' + facedName(b) + ' yet.'
  }));

  /* the fives, in the chosen bucket */
  const h3 = el('div', 'wsubhead'); h3.appendChild(el('h3', 'wh3', 'Fives ' + facedName(b))); h3.appendChild(el('span', 'wnote', 'Every five in those minutes, most used first'));
  host.appendChild(h3);
  const units = sortLines(ctx.unitRows(5).slice(), 'mins', 'desc', ctx.thr, false);
  host.appendChild(statList(ctx, {
    rows: units, view: 'vs', keys: ctx.cols('vs'), sort: 'mins', dir: 'desc', max: ctx.rowsMax,
    scales: ctx.scalesFor(5), evScales: ctx.evScales(5), scaleNote: ctx.scaleNote(5),
    more: () => { ctx.rowsMax += 25; ctx.redraw(); },
    expand: row => unitDetail(ctx, row, { scales: ctx.scalesFor(5), evScales: ctx.evScales(5) }),
    empty: 'No five has minutes ' + facedName(b) + ' yet.'
  }));
  hydrate(ctx, host);
}

/* --------------------------------------------------------- the builder view --- */
function buildView(ctx, host) {
  clear(host);
  const G = ctx.gate, S = ctx.state;
  const roster = ctx.rosterIds();
  if (!G.builder) {
    host.appendChild(teaser(ctx, 'The lineup builder is for members', ['Choose up to five players from the roster and read that unit: every stat, its delta against the rest of the team, and the play-by-play numbers.']));
    if (G.players >= 1 && roster.length) host.appendChild(notice('You can look at one player at a time in On / off.'));
    return;
  }
  host.appendChild(facedBar(ctx));
  const picked = S.u.filter(id => roster.indexOf(id) !== -1).slice(0, 5);
  const slots = el('div', 'wslots');
  for (let i = 0; i < 5; i++) {
    const id = picked[i];
    const s = el('div', 'wslot' + (id ? ' full' : ''));
    if (id) { const c = circle(ctx, { id, size: 'l', ring: 'on', button: true }); c.addEventListener('click', () => ctx.go({ u: picked.filter(x => x !== id) })); s.appendChild(c); s.appendChild(el('span', null, short(ctx, id))); }
    else { s.appendChild(el('span', 'wslot-e', '+')); s.appendChild(el('span', null, 'empty')); }
    slots.appendChild(s);
  }
  host.appendChild(slots);
  host.appendChild(rail(ctx, { ids: roster.filter(id => picked.indexOf(id) === -1), sel: [], max: 0, onPick: id => { if (picked.length < 5) ctx.go({ u: picked.concat(id) }); } }));
  if (!picked.length) { host.appendChild(notice('Pick a player to start; add up to four more.')); hydrate(ctx, host); return; }
  const row = ctx.rowFor(picked);
  if (!row.line.stints) {
    if (picked.length === 5) {
      const near = [];
      picked.forEach((_, i) => { const four = picked.filter((__, j) => j !== i); const r4 = ctx.rowFor(four); if (r4.line.stints) near.push(Object.assign(r4, { without: picked[i] })); });
      near.sort((a, b) => b.line.mins - a.line.mins);
      if (near.length) {
        host.appendChild(notice('These five have not played together' + (S.vs !== 'all' ? ' against this kind of five' : '') + '. The nearest units that have (four of the five):', 'wwarn'));
        const list = el('div', 'wnear');
        near.forEach(n => {
          const c = el('div', 'wcard');
          c.appendChild(circleRow(ctx, n.ids, { size: 'm' }));
          c.appendChild(el('p', 'wsub', 'without ' + short(ctx, n.without) + ' · ' + W.fmt('mins', n.line.mins) + ' min · net ' + W.fmt('net', n.line.net)));
          c.appendChild(btn('Read this four', () => ctx.go({ u: n.ids })));
          list.appendChild(c);
        });
        host.appendChild(list);
        hydrate(ctx, host);
        return;
      }
    }
    host.appendChild(el('div', 'pg-empty', 'These players never shared the floor' + (picked.length < 5 ? ' all at once' : '') + (S.vs !== 'all' ? ' against this kind of five' : '') + '. Take one out to see the nearest unit.'));
    hydrate(ctx, host);
    return;
  }
  const scales = ctx.scalesFor(picked.length), evs = ctx.evScales(picked.length);
  host.appendChild(notice(picked.length === 5 ? 'The exact five, from the minutes they shared.' : 'Every minute with all ' + picked.length + ' of them on the floor together (the other ' + (5 - picked.length) + ' spots were anyone).', 'wsub wcenter'));
  host.appendChild(tiles(ctx, row, ['net', 'ortg', 'drtg', 'pace40', 'mins', 'poss', 'sclock', 'helio', 'ts', 'trppp', 'hcppp', 'rimfg'], { scales, evScales: evs, scaleNote: ctx.scaleNote(picked.length) }));
  const chip = relChip(row.rel, ctx.thr); if (chip) { const c = el('div', 'wcenter'); c.appendChild(chip); host.appendChild(c); }
  host.appendChild(splitGrid(ctx, row.line, row.rest, { on: 'THIS UNIT', off: 'REST OF TEAM' }, { scales, evScales: evs, rel: row.rel, relOff: W.reliability(row.rest, ctx.thr) }));
  const acts = el('div', 'wdet-a');
  acts.appendChild(btn('Copy link', () => ctx.link()));
  acts.appendChild(btn('Open in WOWY', () => ctx.go({ v: 'wowy', w: picked })));
  acts.appendChild(btn('Clear', () => ctx.go({ u: [] })));
  host.appendChild(acts);
  host.appendChild(notice('Heat: the league’s ' + picked.length + '-man units (' + ctx.scaleNote(picked.length) + '); the play-by-play stats against this team’s own units. Δ: this unit against every other minute of the team.'));
  hydrate(ctx, host);
}

root.EpinoiaWowyUI = { circle, circleRow, hydrate, statList, splitGrid, tiles, seg, legend, columnPicker, rail, teaser, notice, btn, facedBar, layBar, cellOf,
  lineupsView, overviewView, onOffView, pairView, wowyView, vsView, buildView, inkOn, safeColour, byJersey, short, shortEl, nameOf };
})(typeof window !== 'undefined' ? window : globalThis);
