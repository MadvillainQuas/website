'use strict';
/* ============================================================================
   THE WOWY PAGE'S PARTS — circles, heat, tables, splits and the views built from them.
   window.EpinoiaWowyUI. The numbers are lineups.js's, the rules are wowylogic.js's; this file only draws.

   A view function is handed a `ctx` by wowy.js (the page): the team, who everyone is, the scales to colour
   against, the thresholds, the gate and the callbacks (go, link). Nothing here fetches.

     PLAYER CIRCLES   a photo if the site has one, else initials on the club's colour, the club's crest on its
                      edge, the shirt number; a green ring for on the floor, a red one for off it
     HEAT             every stat coloured by where it ranks against the league's own units, turned round for
                      the stats where lower is better, with an arrow on the top and bottom fifth (colour is
                      never the only sign) and a grey, labelled row for a small sample
     SPLITS           on against off with the difference, in the same colours
   ============================================================================ */
(function (root) {
const W = root.EpinoiaWowyLogic;
const L = root.EpinoiaLineups;

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
  else if (n.tagName === 'A') n.href = '../../p/?p=' + encodeURIComponent(o.id);
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

function circleRow(ctx, ids, o) {
  const row = el('span', 'wc-row wc-row-' + ((o && o.size) || 's'));
  byJersey(ctx, ids).forEach(id => row.appendChild(circle(ctx, Object.assign({ id }, o || {}, o && o.ringOf ? { ring: o.ringOf(id) } : {}))));
  return row;
}

/* ------------------------------------------------------------------ heat --- */
function relChip(rel, thr) {
  if (rel === 'ok') return null;
  const c = el('span', 'wchip ' + rel, rel === 'tiny' ? 'tiny sample' : 'small sample');
  c.title = 'Under ' + thr.minMinutes + ' min or ' + thr.minPoss + ' possessions: read with care';
  return c;
}
function heatTd(k, v, o) {
  const c = W.col(k);
  const td = el('td', 'hc' + (k === 'net' ? ' lead' : ''), W.fmt(k, v));
  td.dataset.l = c.label;
  if (c.heat === 'seq') {
    td.classList.add('sq');
    td.style.setProperty('--sq', W.seqShare(v, (o.maxes || {})[k]).toFixed(2));
  } else if (c.dir && o.rel !== 'tiny') {
    const t = W.tone(o.scales && o.scales[k], v, c.dir);
    const b = W.band(t);
    if (b) {
      td.dataset.b = String(b);
      const bg = W.tint(t);
      if (bg) td.style.background = bg;
      td.title = c.name + ': ' + W.fmt(k, v) + ' · ' + Math.round(((t + 1) / 2) * 100) + 'th percentile for the team' + (o.scaleNote ? ' among ' + o.scaleNote : '');
    }
  }
  return td;
}
function netPill(v) {
  const s = el('span', 'netpill ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : ''), W.fmt('net', v));
  return s;
}

/* ------------------------------------------------- units table (leaderboard) ---
   o: { units, keys, sort, dir, scales, scaleNote, thr, max, showTeam, label(u) -> node, onSort(key), expand(u)-> node,
        empty, more(n) }
   Rows are capped at `max`; a "show more" button asks the page for more. Markup is the site's table.ft in a
   .ft-wrap; below the container width of a phone the same rows are drawn as cards (wowy.css). */
function unitsTable(ctx, o) {
  const host = el('div', 'wu-host');
  const rows = o.units || [];
  if (!rows.length) { host.appendChild(el('div', 'pg-empty', o.empty || 'Nothing has shared the floor for long enough yet.')); return host; }
  const keys = o.keys;
  const maxes = {};
  keys.forEach(k => { if (W.col(k).heat === 'seq') maxes[k] = rows.reduce((m, u) => Math.max(m, isNum(u[k]) ? u[k] : 0), 0); });
  /* on a narrow column the headers are gone (the rows are cards), so the order is chosen here instead */
  const ss = el('select', 'wsortsel'); ss.setAttribute('aria-label', 'Sort by');
  keys.forEach(k => { const op = el('option', null, 'Sort: ' + W.col(k).name); op.value = k; if (k === o.sort) op.selected = true; ss.appendChild(op); });
  ss.addEventListener('change', () => o.onSort && o.onSort(ss.value, true));
  if (o.onSort) host.appendChild(ss);
  const wrap = el('div', 'ft-wrap wu-wrap');
  const t = el('table', 'ft wu');
  const hr = el('tr');
  const th0 = el('th', 'stick wu-h0', o.headLabel || 'LINEUP'); hr.appendChild(th0);
  keys.forEach(k => {
    const c = W.col(k);
    const th = el('th', o.sort === k ? 'sorted' : '', c.label + (o.sort === k ? (o.dir === 'asc' ? ' ▲' : ' ▼') : ''));
    th.title = c.name + (c.dir ? (c.dir > 0 ? ' (higher is better)' : ' (lower is better)') : '');
    th.tabIndex = 0; th.setAttribute('role', 'button');
    const go = () => o.onSort && o.onSort(k);
    th.addEventListener('click', go);
    th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    hr.appendChild(th);
  });
  const thead = el('thead'); thead.appendChild(hr); t.appendChild(thead);
  const tb = el('tbody');
  const open = new Set();
  rows.slice(0, o.max || 25).forEach(u => {
    const rel = W.reliability(u, o.thr);
    const tr = el('tr', 'wr rel-' + rel);
    const team = u.teamId && ctx.teamsById ? ctx.teamsById[u.teamId] : ctx.team;
    if (team) tr.style.setProperty('--wc', safeColour(team.colour));
    const c0 = el('td', 'stick wu-c0');
    c0.appendChild(o.label ? o.label(u, team) : defaultLabel(ctx, u, team, o));
    tr.appendChild(c0);
    keys.forEach(k => tr.appendChild(heatTd(k, u[k], { scales: o.scales, scaleNote: o.scaleNote, rel, maxes })));
    if (o.expand) {
      tr.classList.add('xp'); tr.tabIndex = 0; tr.setAttribute('aria-expanded', 'false');
      const toggle = () => {
        if (open.has(u)) {
          open.delete(u); tr.setAttribute('aria-expanded', 'false');
          const nx = tr.nextSibling; if (nx && nx.classList.contains('wr-x')) nx.remove();
        } else {
          open.add(u); tr.setAttribute('aria-expanded', 'true');
          const xr = el('tr', 'wr-x'); const xd = el('td'); xd.colSpan = keys.length + 1;
          xd.appendChild(o.expand(u, team)); xr.appendChild(xd);
          tr.parentNode.insertBefore(xr, tr.nextSibling);
          hydrate(ctx, xr);
        }
      };
      tr.addEventListener('click', e => { if (e.target.closest('a,button,input,select')) return; toggle(); });
      tr.addEventListener('keydown', e => { if (e.target === tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(); } });
    }
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); host.appendChild(wrap);
  if (rows.length > (o.max || 25) && o.more) {
    const more = el('button', 'ep-btn ft-morerows', 'Show ' + Math.min(25, rows.length - (o.max || 25)) + ' more of ' + (rows.length - (o.max || 25)) + ' left');
    more.type = 'button'; more.addEventListener('click', () => o.more());
    host.appendChild(more);
  }
  return host;
}
function defaultLabel(ctx, u, team, o) {
  const box = el('div', 'wu-lab');
  box.appendChild(circleRow(ctx, u.ids, { size: 's', team: team || undefined }));
  const names = el('div', 'wu-names');
  byJersey(ctx, u.ids).forEach(id => names.appendChild(el('span', null, short(ctx, id))));
  box.appendChild(names);
  const meta = el('div', 'wu-meta');
  if (o && o.showTeam && team) { const tt = el('span', 'wu-team', team.short || team.name); tt.style.color = 'var(--wc)'; meta.appendChild(tt); }
  const chip = relChip(W.reliability(u, o.thr), o.thr);
  if (chip) meta.appendChild(chip);
  if (meta.childNodes.length) box.appendChild(meta);
  return box;
}

/* --------------------------------------------------------------- split grid ---
   ON against OFF for every stat, with the difference coloured by whether it is good for the team.
   rows: W.splitRows(...). labels: { on, off } */
function splitGrid(rows, labels, o) {
  const t = el('table', 'wsg');
  const head = el('tr'); ['STAT', labels.on, labels.off, 'DIFF'].forEach((h, i) => head.appendChild(el('th', i ? 'n' : '', h)));
  const th = el('thead'); th.appendChild(head); t.appendChild(th);
  const tb = el('tbody');
  let lastGroup = '';
  rows.forEach(r => {
    if (!r.col || (r.on == null && r.off == null)) return;
    if (r.col.group !== lastGroup) {
      lastGroup = r.col.group;
      const g = el('tr', 'wsg-g'); const td = el('td', null, (W.GROUPS.find(x => x[0] === lastGroup) || [0, lastGroup])[1]); td.colSpan = 4; g.appendChild(td); tb.appendChild(g);
    }
    const tr = el('tr');
    const nm = el('td', 'nm', r.col.label); nm.title = r.col.name; tr.appendChild(nm);
    const cell = (v, who) => {
      const td = el('td', 'n', W.fmt(r.col, v));
      if (o && o.scales && r.col.dir) {
        const tn = W.tone(o.scales[r.key], v, r.col.dir);
        const bg = W.tint(tn); if (bg) td.style.background = bg;
      }
      return td;
    };
    tr.appendChild(cell(r.on)); tr.appendChild(cell(r.off));
    const d = el('td', 'n d ' + (r.good == null ? '' : r.good > 0.05 ? 'gd' : r.good < -0.05 ? 'bd' : ''),
      r.delta == null ? '—' : (r.delta > 0 ? '+' : '') + (r.col.fmt === 'n0' || r.col.fmt === 'pm' ? Math.round(r.delta) : r.delta.toFixed(1)));
    if (r.good != null && Math.abs(r.good) > 0.05) d.dataset.a = r.good > 0 ? '▲' : '▼';
    tr.appendChild(d);
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  const w = el('div', 'wsg-wrap'); w.appendChild(t);
  return w;
}

/* ---------------------------------------------------------------- pieces --- */
function seg(items, value, onPick, label) {
  const g = el('div', 'pg-seg'); g.setAttribute('role', 'group'); if (label) g.setAttribute('aria-label', label);
  items.forEach(([v, t, disabled, title]) => {
    const b = el('button', null, t); b.type = 'button';
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

/* the colour key: what the tints mean and what they were measured against */
function legend(ctx, o) {
  const k = el('div', 'wkey');
  const bar = el('div', 'wkey-bar');
  bar.appendChild(el('span', 'wk-lo', 'worse'));
  bar.appendChild(el('i', 'wk-grad'));
  bar.appendChild(el('span', 'wk-hi', 'better'));
  k.appendChild(bar);
  const p = el('p', 'wkey-t');
  p.textContent = 'Each stat is coloured by where it ranks among ' + (o.note || 'the units on this page') +
    '. Green is better for the team, red worse; for turnovers, opponent shooting and defensive rating the lower number is the better one, so the colours are turned round. ' +
    '▲ ▼ mark the top and bottom fifth. Grey rows are a small sample (under ' + ctx.thr.minMinutes + ' min or ' + ctx.thr.minPoss + ' possessions) and are left out of the ranking.';
  k.appendChild(p);
  return k;
}

/* the column picker: grouped, searchable, capped, remembered by the page */
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
      const h = el('div', 'wcp-g', g.title); list.appendChild(h);
      g.cols.forEach(c => {
        const on = cur.indexOf(c.key) !== -1;
        const lab = el('label', 'wcp-c' + (on ? ' on' : ''));
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = on; cb.disabled = !on && cur.length >= lim.max;
        cb.addEventListener('change', () => { ctx.setCols(view, W.toggleColumn(cur, c.key, kind)); draw(); sm.textContent = 'Columns ' + ctx.cols(view).length + '/' + lim.max; onChange(); });
        lab.append(cb, el('b', null, c.label), el('span', null, c.name));
        list.appendChild(lab);
      });
    });
    if (!list.firstChild) list.appendChild(el('p', 'wnote', 'No stat matches that.'));
  };
  search.addEventListener('input', draw);
  const foot = el('div', 'wcp-f');
  foot.appendChild(el('span', 'wnote', 'Up to ' + lim.max + ' on this width. The engine has no 3P%, assists, steals, blocks or shot zones for a five, so those are not offered.'));
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
    item.appendChild(el('span', 'wrail-n', short(ctx, id)));
    r.appendChild(item);
  });
  return r;
}

/* ------------------------------------------------- the lineups view (05) --- */
function lineupsView(ctx, host) {
  const S = ctx.state, G = ctx.gate;
  clear(host);
  const bar = el('div', 'wbar');
  const sizes = [2, 3, 4, 5].map(n => [n, n + '-man', G.sizes.indexOf(n) === -1, G.sizes.indexOf(n) === -1 ? 'Members: units of ' + n + ' players' : null]);
  bar.appendChild(seg(sizes, S.sz, v => ctx.go({ sz: v }), 'Unit size'));
  bar.appendChild(seg([['', 'Most used'], ['best', 'Best net'], ['worst', 'Worst net']], S.best, v => ctx.go({ best: v, sort: v ? 'net' : 'mins', dir: v === 'worst' ? 'asc' : 'desc' }), 'Order'));
  bar.appendChild(numField('Min minutes', S.mm, 0.5, v => ctx.go({ mm: W.normThr(v, S.mp).minMinutes }), 'A unit needs this many minutes to be ranked and to count in the colours'));
  bar.appendChild(numField('Min possessions', S.mp, 1, v => ctx.go({ mp: W.normThr(S.mm, v).minPoss })));
  bar.appendChild(columnPicker(ctx, 'lineups', () => ctx.redraw()));
  bar.appendChild(btn('Copy link', () => ctx.link(), 'ghost', 'A link to exactly this view'));
  host.appendChild(bar);

  /* the players to keep in or leave out: click a circle once for WITH him, twice for WITHOUT him */
  const roster = ctx.rosterIds();
  if (roster.length && ctx.state.t !== 'all') {
    const f = el('div', 'wfilter');
    f.appendChild(el('span', 'wl', 'With / without'));
    const r = rail(ctx, {
      ids: roster, sel: [], onPick: id => {
        const c = W.cycleFilter(S.inc, S.exc, id);
        const cap = G.players;
        ctx.go({ inc: c.inc.slice(0, cap), exc: c.exc.slice(0, cap) });
      },
      ringOf: id => S.inc.indexOf(id) !== -1 ? 'on' : S.exc.indexOf(id) !== -1 ? 'off' : null,
      dimOf: id => S.inc.indexOf(id) === -1 && S.exc.indexOf(id) === -1 && (S.inc.length || S.exc.length) > 0
    });
    f.appendChild(r);
    f.appendChild(el('p', 'wnote', (S.inc.length || S.exc.length) ? 'Green ring: must be on the floor. Red ring: must be off it. Click again to cycle.' : 'Click a circle to keep only units with him; click again for only units without him.'));
    host.appendChild(f);
  }
  if (G.preview) host.appendChild(teaser(ctx, 'The full lineups table is for members', ['Units of two, three and four players as well as fives, every row, and any players kept in or out at once. A preview shows the five best fives.']));

  const size = G.sizes.indexOf(S.sz) === -1 ? 5 : S.sz;
  const all = ctx.unitsFor(size);
  const scales = ctx.scalesFor(size);
  let units = W.filterUnits(all, { inc: S.inc, exc: S.exc, minMinutes: 0, minPoss: 0 });
  units = W.sortRows(units, S.sort, S.dir, ctx.thr, S.best === 'best' || S.best === 'worst');
  const shown = units.length;
  const cap = Math.min(G.rows, ctx.rowsMax);
  const info = el('p', 'wcount', shown + ' ' + size + '-man unit' + (shown === 1 ? '' : 's') +
    (ctx.state.t === 'all' ? ' across the league' : ' for ' + (ctx.team ? ctx.team.name : 'the team')) +
    (G.preview && shown > G.rows ? ' · the ' + G.rows + ' best shown' : ''));
  host.appendChild(info);
  host.appendChild(legend(ctx, { note: ctx.scaleNote(size) }));

  const listUnits = G.preview ? W.sortRows(W.filterUnits(all, { inc: S.inc, exc: S.exc }), 'net', 'desc', ctx.thr, true).slice(0, G.rows) : units;
  host.appendChild(unitsTable(ctx, {
    units: listUnits, keys: ctx.cols('lineups'), sort: G.preview ? 'net' : S.sort, dir: G.preview ? 'desc' : S.dir, scales,
    scaleNote: ctx.scaleNote(size), thr: ctx.thr, max: cap, showTeam: ctx.state.t === 'all',
    onSort: (k, pick) => ctx.go({ sort: k, dir: pick ? 'desc' : (S.sort === k && S.dir === 'desc' ? 'asc' : 'desc'), best: '' }),
    more: () => { ctx.rowsMax += 25; ctx.redraw(); },
    expand: (u, team) => unitDetail(ctx, u, team, scales),
    empty: 'No ' + size + '-man unit has played yet under those filters.'
  }));
  hydrate(ctx, host);
}

/* what opens under a row: the unit against the rest of its team's minutes, and what to do with it */
function unitDetail(ctx, u, team, scales) {
  const box = el('div', 'wdet');
  const stints = ctx.stintsOfTeam(u.teamId || (ctx.team && ctx.team.id));
  const vs = W.unitVsRest(stints, u.ids);
  const head = el('div', 'wdet-h');
  head.appendChild(circleRow(ctx, u.ids, { size: 'm', team: team || undefined }));
  const t = el('div', 'wdet-t');
  t.appendChild(el('b', null, byJersey(ctx, u.ids).map(id => short(ctx, id)).join(' · ')));
  t.appendChild(el('span', null, u.ids.length + ' on the floor · ' + W.fmt('mins', u.mins) + ' min · ' + u.stints + ' stint' + (u.stints === 1 ? '' : 's') + ' · ' + W.fmt('poss', u.poss) + ' possessions'));
  head.appendChild(t);
  box.appendChild(head);
  box.appendChild(splitGrid(W.splitRows(vs.on, vs.off), { on: 'THIS UNIT', off: 'REST OF TEAM' }, { scales }));
  const acts = el('div', 'wdet-a');
  acts.appendChild(btn('Copy link', () => ctx.link({ v: 'build', u: u.ids.slice(0, 5) })));
  acts.appendChild(btn('Open in builder', () => ctx.go({ v: 'build', u: u.ids.slice(0, 5) })));
  box.appendChild(acts);
  box.appendChild(notice('Rest of team = every minute this team played without all of these players on together. Diff is unit minus rest; green when that is good for the team.'));
  return box;
}

/* ------------------------------------------------------ the overview view --- */
function overviewView(ctx, host) {
  clear(host);
  const G = ctx.gate;
  const team = ctx.team;
  const base = L.filter(ctx.teamStints, []);
  const tiles = el('div', 'wtiles');
  const tscale = ctx.teamScales();
  [['net', 'NET RATING'], ['ortg', 'OFF RATING'], ['drtg', 'DEF RATING'], ['pace', 'PACE'], ['mins', 'MINUTES'], ['poss', 'POSSESSIONS']].forEach(([k, l]) => {
    const c = W.col(k); const t = el('div', 'wtile'); const v = el('div', 'v', W.fmt(k, base[k])); const tn = c.dir && tscale[k] ? W.tone(tscale[k], base[k], c.dir) : null;
    const bg = W.tint(tn); if (bg) t.style.background = bg;
    if (tn != null && W.band(tn) >= 5) t.dataset.a = '▲'; else if (tn != null && W.band(tn) <= 1) t.dataset.a = '▼';
    t.appendChild(v); t.appendChild(el('div', 'l', l));
    if (tn != null) t.appendChild(el('div', 's', Math.round(((tn + 1) / 2) * 100) + 'th pct of teams'));
    tiles.appendChild(t);
  });
  host.appendChild(tiles);
  if (!tscale.net) host.appendChild(notice('The league’s other teams are still loading: the tiles gain their colour when they arrive.'));

  /* the starting five, the unit the coach picks */
  const sf = W.startingFive(ctx.games, team.id);
  const cols = el('div', 'wov');
  if (sf) {
    const card = el('div', 'wcard wstart');
    card.appendChild(el('h3', null, 'Starting five'));
    card.appendChild(circleRow(ctx, sf.ids, { size: 'l', ring: 'on' }));
    const names = el('div', 'wu-names'); byJersey(ctx, sf.ids).forEach(id => names.appendChild(el('span', null, short(ctx, id)))); card.appendChild(names);
    const line = L.filter(ctx.teamStints, sf.ids, 'starters');
    card.appendChild(el('p', 'wsub', 'Started ' + sf.games + ' of ' + ctx.games.length + ' game' + (ctx.games.length === 1 ? '' : 's') +
      (line.stints ? ' · ' + W.fmt('mins', line.mins) + ' min together · net ' + W.fmt('net', line.net) : ' · no shared stints on record')));
    const acts = el('div', 'wdet-a');
    acts.appendChild(btn('Open in builder', () => ctx.go({ v: 'build', u: sf.ids })));
    card.appendChild(acts);
    cols.appendChild(card);
  }
  host.appendChild(cols);

  /* the rotation: every player who took the floor, biggest share of the minutes first, with the team's swing when on */
  const roster = ctx.rosterIds();
  const splits = {};
  W.playerSplits(ctx.teamStints, 0).forEach(s => { splits[s.id] = s; });
  const sc = ctx.playerScales();
  const total = base.mins || 1;
  const rot = el('div', 'wcard wrot');
  rot.appendChild(el('h3', null, 'Rotation'));
  rot.appendChild(el('p', 'wsub', 'Circle ring: green when the team is better with him on than off, red when worse. Bar: share of the team’s floor time he was on for.'));
  const grid = el('div', 'wrot-g');
  roster.forEach(id => {
    const s = splits[id]; if (!s) return;
    const sw = s.diff.net;
    const rel = W.reliability(s.on, { minMinutes: ctx.thr.minMinutes, minPoss: ctx.thr.minPoss });
    const it = el('a', 'wrot-i rel-' + rel); it.href = '?' + ctx.qs({ v: 'onoff', p: id }).slice(1);
    it.addEventListener('click', e => { e.preventDefault(); ctx.go({ v: 'onoff', p: id }); });
    it.appendChild(circle(ctx, { id, link: false, size: 'm', ring: sw == null ? null : sw >= 0 ? 'on' : 'off' }));
    const tx = el('div', 'wrot-t');
    tx.appendChild(el('b', null, nameOf(ctx, id)));
    const bar = el('span', 'wrot-bar'); const fill = el('i'); fill.style.width = Math.min(100, s.on.mins / total * 100).toFixed(0) + '%'; bar.appendChild(fill);
    tx.appendChild(bar);
    const nums = el('span', 'wrot-n');
    const nv = el('span', 'wrot-net', W.fmt('net', s.on.net));
    const tn = sc.onNet ? W.tone(sc.onNet, s.on.net, 1) : null; const bg = W.tint(tn); if (bg && rel !== 'tiny') nv.style.background = bg;
    nums.append(nv, el('span', null, W.fmt('mins', s.on.mins) + ' min'), el('span', null, 'swing ' + (sw == null ? '—' : (sw > 0 ? '+' : '') + sw.toFixed(1))));
    tx.appendChild(nums);
    const chip = relChip(rel, ctx.thr); if (chip) tx.appendChild(chip);
    it.appendChild(tx);
    grid.appendChild(it);
  });
  rot.appendChild(grid);
  host.appendChild(rot);

  /* the units, best of them, as the same table the Lineups view has */
  const top = el('div', 'wcard');
  top.appendChild(el('h3', null, 'Most used fives'));
  const units = ctx.unitsFor(5).slice(0, 5);
  top.appendChild(unitsTable(ctx, {
    units, keys: ctx.cols('lineups').slice(0, ctx.kind() === 'phone' ? 3 : 6), sort: 'mins', dir: 'desc', scales: ctx.scalesFor(5), scaleNote: ctx.scaleNote(5), thr: ctx.thr, max: 5,
    expand: (u, t) => unitDetail(ctx, u, t, ctx.scalesFor(5))
  }));
  top.appendChild(btn('All lineups →', () => ctx.go({ v: 'lineups' }), 'ghost'));
  host.appendChild(top);
  hydrate(ctx, host);
}

/* ------------------------------------------------------- the on/off view --- */
function onOffView(ctx, host, withHost) {
  clear(host);
  const roster = ctx.rosterIds();
  const S = ctx.state;
  const pid = S.p && roster.indexOf(S.p) !== -1 ? S.p : roster[0];
  if (!pid) { host.appendChild(el('div', 'pg-empty', 'No lineup data for this team yet.')); return null; }
  host.appendChild(rail(ctx, { ids: roster, sel: [pid], onPick: id => ctx.go({ p: id }), ringOf: id => (id === pid ? 'on' : null) }));
  const oo = L.onOff(ctx.teamStints, pid);
  const sc = ctx.playerScales();
  const rel = W.reliability(oo.on, ctx.thr);
  const relOff = W.reliability(oo.off, ctx.thr);
  const card = (k, side, ring, r) => {
    const c = el('div', 'woo woo-' + k);
    const h = el('div', 'woo-h');
    h.appendChild(circle(ctx, { id: pid, link: k === 'on', size: 'l', ring }));
    const ht = el('div'); ht.appendChild(el('b', null, nameOf(ctx, pid)));
    ht.appendChild(el('span', null, k === 'on' ? 'on the floor' : 'off the floor'));
    h.appendChild(ht); c.appendChild(h);
    const v = el('div', 'woo-v ' + (side.net > 0 ? 'pos' : side.net < 0 ? 'neg' : ''), W.fmt('net', side.net));
    const scl = k === 'on' ? sc.onNet : sc.offNet;
    const tn = scl ? W.tone(scl, side.net, 1) : null; const bg = W.tint(tn); if (bg && r !== 'tiny') c.style.background = bg;
    c.appendChild(v); c.appendChild(el('div', 'woo-l', 'team net rating per 100 possessions'));
    const row = el('div', 'woo-r');
    [['ortg', 'ORTG'], ['drtg', 'DRTG'], ['pace', 'PACE'], ['mins', 'MIN'], ['poss', 'POSS']].forEach(([kk, l]) => { const d = el('div'); d.append(el('b', null, W.fmt(kk, side[kk])), el('i', null, l)); row.appendChild(d); });
    c.appendChild(row);
    const chip = relChip(r, ctx.thr); if (chip) c.appendChild(chip);
    return c;
  };
  const wrap = el('div', 'woo-wrap');
  wrap.appendChild(card('on', oo.on, 'on', rel));
  const sw = el('div', 'woo-sw'); sw.appendChild(el('span', 'k', 'SWING')); sw.appendChild(el('span', 'n', (oo.diff.net > 0 ? '+' : '') + W.fmt('mins', oo.diff.net == null ? null : oo.diff.net)));
  sw.appendChild(el('span', 'k', 'on minus off'));
  const stn = sc.swing ? W.tone(sc.swing, oo.diff.net, 1) : null;
  if (stn != null && W.band(stn) >= 4) sw.classList.add('good'); else if (stn != null && W.band(stn) <= 2) sw.classList.add('bad');
  wrap.appendChild(sw);
  wrap.appendChild(card('off', oo.off, 'off', relOff));
  host.appendChild(wrap);
  host.appendChild(notice(sc.n ? 'Colours rank his numbers against ' + sc.n + ' players across ' + (sc.source === 'league' ? 'the league' : 'this team') + ' with at least ' + Math.max(ctx.thr.minMinutes * 3, 30) + ' minutes on.' : ''));

  const det = el('details', 'wdetails'); det.open = ctx.kind() !== 'phone';
  det.appendChild(el('summary', null, 'Every stat, on against off'));
  det.appendChild(splitGrid(W.splitRows(oo.on, oo.off), { on: 'ON', off: 'OFF' }, { scales: ctx.scalesFor(1) }));
  host.appendChild(det);

  /* his partners: every teammate with both circles */
  const minT = Math.max(ctx.thr.minMinutes / 2, 1);
  const pts = W.partners(ctx.teamStints, pid, 0);
  const good = pts.filter(p => W.reliability(p.both, ctx.thr) !== 'tiny' && p.swing != null);
  const partnerCard = (p, kind) => {
    const c = el('div', 'wpartner ' + kind);
    const cr = el('div', 'wpartner-c');
    cr.appendChild(circle(ctx, { id: pid, size: 'm', ring: 'on', link: false }));
    cr.appendChild(circle(ctx, { id: p.id, size: 'm', ring: 'on' }));
    c.appendChild(cr);
    c.appendChild(el('b', null, nameOf(ctx, p.id)));
    c.appendChild(el('span', 'wpartner-n' + (p.swing > 0 ? ' pos' : p.swing < 0 ? ' neg' : ''), (p.swing > 0 ? '+' : '') + p.swing.toFixed(1) + ' swing'));
    c.appendChild(el('span', 'wsub', W.fmt('mins', p.both.mins) + ' min together · net ' + W.fmt('net', p.both.net) + ' vs ' + W.fmt('net', p.subjOnly.net) + ' without him'));
    c.title = 'Team net with both on, minus the team net with ' + nameOf(ctx, pid) + ' on and ' + nameOf(ctx, p.id) + ' off';
    c.addEventListener('click', e => { if (e.target.closest('a')) return; ctx.go({ v: 'pair', a: pid, b: p.id }); });
    return c;
  };
  const pw = el('div', 'wpartners');
  const best = good.slice(0, 3), worst = good.slice(-3).reverse().filter(p => best.indexOf(p) === -1);
  if (best.length) {
    const col1 = el('div'); col1.appendChild(el('h3', 'wh3', 'Best partners')); const g = el('div', 'wpartner-g'); best.forEach(p => g.appendChild(partnerCard(p, 'best'))); col1.appendChild(g); pw.appendChild(col1);
  }
  if (worst.length) {
    const col2 = el('div'); col2.appendChild(el('h3', 'wh3', 'Worst partners')); const g = el('div', 'wpartner-g'); worst.forEach(p => g.appendChild(partnerCard(p, 'worst'))); col2.appendChild(g); pw.appendChild(col2);
  }
  if (pw.firstChild) host.appendChild(pw);
  host.appendChild(notice('Swing: the team’s net rating with the two on together, minus its net with ' + nameOf(ctx, pid) + ' on and the other off. Only partners with more than a tiny sample are ranked. Tap one to open the pair.'));

  /* the whole list */
  const tb = el('div', 'ft-wrap wu-wrap wpl'); const t = el('table', 'ft wu wpt');
  const hr = el('tr'); ['PARTNER', 'MIN TOGETHER', 'NET BOTH', 'NET WITHOUT HIM', 'NET HIM WITHOUT', 'SWING'].forEach((h, i) => hr.appendChild(el('th', i ? '' : 'stick wu-h0', h)));
  const th = el('thead'); th.appendChild(hr); t.appendChild(th);
  const body = el('tbody');
  const swingScale = W.scaleOf(good.map(p => p.swing));
  pts.slice().sort((a, b) => b.both.mins - a.both.mins).forEach(p => {
    const r = W.reliability(p.both, ctx.thr);
    const tr = el('tr', 'wr rel-' + r);
    const c0 = el('td', 'stick wu-c0'); const lab = el('div', 'wu-lab');
    lab.appendChild(circle(ctx, { id: p.id, size: 's' })); const nm = el('div', 'wu-names'); nm.appendChild(el('span', null, nameOf(ctx, p.id))); lab.appendChild(nm);
    const chip = relChip(r, ctx.thr); if (chip) lab.appendChild(chip);
    c0.appendChild(lab); tr.appendChild(c0);
    const cell = (l, v, k, tnv) => { const td = el('td', 'hc' + (k === 'sw' ? ' lead' : ''), k === 'mins' ? W.fmt('mins', v) : (k === 'sw' ? (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(1)) : W.fmt('net', v))); td.dataset.l = l;
      if (tnv != null && r !== 'tiny') { const b = W.band(tnv); td.dataset.b = String(b); const bg = W.tint(tnv); if (bg) td.style.background = bg; } return td; };
    tr.appendChild(cell('MIN TOGETHER', p.both.mins, 'mins'));
    tr.appendChild(cell('NET BOTH', p.both.net, 'net', ctx.scalesFor(2).net ? W.tone(ctx.scalesFor(2).net, p.both.net, 1) : null));
    tr.appendChild(cell('NET MATE ALONE', p.mateOnly.net, 'net'));
    tr.appendChild(cell('NET HIM ALONE', p.subjOnly.net, 'net'));
    tr.appendChild(cell('SWING', p.swing, 'sw', swingScale.n >= 4 ? W.tone(swingScale, p.swing, 1) : null));
    tr.classList.add('xp'); tr.addEventListener('click', e => { if (!e.target.closest('a')) ctx.go({ v: 'pair', a: pid, b: p.id }); });
    body.appendChild(tr);
  });
  t.appendChild(body); tb.appendChild(t);
  const all = el('details', 'wdetails'); all.appendChild(el('summary', null, 'All ' + pts.length + ' teammates')); all.appendChild(tb);
  host.appendChild(all);
  hydrate(ctx, host);
  return pid;
}

/* ---------------------------------------------------------- the pair view --- */
const BUCKETS = {
  both: 'Both on', aOnly: 'only A', bOnly: 'only B', neither: 'Neither'
};
function pairView(ctx, host) {
  clear(host);
  const G = ctx.gate;
  const roster = ctx.rosterIds();
  const S = ctx.state;
  if (roster.length < 2) { host.appendChild(el('div', 'pg-empty', 'A pair needs two players with lineup data.')); return; }
  const a = roster.indexOf(S.a) !== -1 ? S.a : roster[0];
  const b = roster.indexOf(S.b) !== -1 && S.b !== a ? S.b : roster.find(x => x !== a);
  if (!G.pair) {
    host.appendChild(teaser(ctx, 'Pairs and combinations are for members', ['Pick two players and see the four ways they shared the floor: together, either alone, neither. The combinations grid takes up to five players.']));
  } else {
    const pick = el('div', 'wpick2');
    const pa = el('div'); pa.appendChild(el('span', 'wl', 'Player A')); pa.appendChild(rail(ctx, { ids: roster.filter(x => x !== b), sel: [a], onPick: id => ctx.go({ a: id }), ringOf: id => (id === a ? 'on' : null) }));
    const pb = el('div'); pb.appendChild(el('span', 'wl', 'Player B')); pb.appendChild(rail(ctx, { ids: roster.filter(x => x !== a), sel: [b], onPick: id => ctx.go({ b: id }), ringOf: id => (id === b ? 'on' : null) }));
    pick.append(pa, pb); host.appendChild(pick);

    const buckets = W.pairBuckets(ctx.teamStints, a, b);
    const scales = ctx.scalesFor(2);
    const cards = el('div', 'wbuckets');
    buckets.forEach(bk => {
      const rel = W.reliability(bk.line, ctx.thr);
      const c = el('div', 'wbucket rel-' + rel + ' bk-' + bk.key);
      const cr = el('div', 'wbucket-c');
      cr.appendChild(circle(ctx, { id: a, size: 'm', ring: bk.a ? 'on' : 'off', link: false }));
      cr.appendChild(circle(ctx, { id: b, size: 'm', ring: bk.b ? 'on' : 'off', link: false }));
      c.appendChild(cr);
      const label = bk.key === 'both' ? 'Both on' : bk.key === 'neither' ? 'Neither on' : bk.key === 'aOnly' ? short(ctx, a) + ' without ' + short(ctx, b) : short(ctx, b) + ' without ' + short(ctx, a);
      c.appendChild(el('b', null, label));
      const net = el('div', 'wbucket-v ' + (bk.line.net > 0 ? 'pos' : bk.line.net < 0 ? 'neg' : ''), bk.line.stints ? W.fmt('net', bk.line.net) : '—');
      const tn = bk.line.stints && scales.net ? W.tone(scales.net, bk.line.net, 1) : null; const bg = W.tint(tn); if (bg && rel !== 'tiny') c.style.background = bg;
      c.appendChild(net);
      c.appendChild(el('div', 'wsub', bk.line.stints ? W.fmt('mins', bk.line.mins) + ' min · ' + W.fmt('poss', bk.line.poss) + ' poss · ' + W.fmt('ortg', bk.line.ortg) + ' / ' + W.fmt('drtg', bk.line.drtg) : 'never happened'));
      const chip = bk.line.stints ? relChip(rel, ctx.thr) : null; if (chip) c.appendChild(chip);
      cards.appendChild(c);
    });
    host.appendChild(cards);
    const sw = (isNum(buckets[0].line.net) && isNum(buckets[1].line.net)) ? Math.round((buckets[0].line.net - buckets[1].line.net) * 10) / 10 : null;
    if (sw != null) host.appendChild(el('p', 'wswing', short(ctx, a) + ' with ' + short(ctx, b) + ' against ' + short(ctx, a) + ' without: ' + (sw > 0 ? '+' : '') + sw.toFixed(1) + ' net rating.'));

    /* every stat, down the page, the four buckets across */
    const t = el('table', 'wsg wsg4'); const hr = el('tr'); hr.appendChild(el('th', null, 'STAT'));
    ['BOTH', short(ctx, a).toUpperCase() + ' ONLY', short(ctx, b).toUpperCase() + ' ONLY', 'NEITHER'].forEach(h => hr.appendChild(el('th', 'n', h)));
    const th = el('thead'); th.appendChild(hr); t.appendChild(th);
    const tb = el('tbody'); let lg = '';
    W.COLS.filter(c => ['sample', 'rating', 'ours', 'theirs', 'shoot', 'board'].indexOf(c.group) !== -1 && c.key !== 'stints' && c.key !== 'pf' && c.key !== 'pa').forEach(c => {
      if (c.group !== lg) { lg = c.group; const g = el('tr', 'wsg-g'); const td = el('td', null, W.GROUPS.find(x => x[0] === lg)[1]); td.colSpan = 5; g.appendChild(td); tb.appendChild(g); }
      const tr = el('tr'); const nm = el('td', 'nm', c.label); nm.title = c.name; tr.appendChild(nm);
      buckets.forEach(bk => {
        const v = bk.line.stints ? bk.line[c.key] : null;
        const td = el('td', 'n', W.fmt(c, v));
        const r = W.reliability(bk.line, ctx.thr);
        if (c.dir && r !== 'tiny' && v != null) { const bgt = W.tint(W.tone(scales[c.key], v, c.dir)); if (bgt) td.style.background = bgt; }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    const wr = el('div', 'wsg-wrap'); wr.appendChild(t); host.appendChild(wr);
    host.appendChild(notice('Coloured against the league’s two-man units (' + ctx.scaleNote(2) + '). "Only" means that player on and the other off.'));
    const acts = el('div', 'wdet-a');
    acts.appendChild(btn('Copy link', () => ctx.link({ v: 'pair', a, b })));
    host.appendChild(acts);
  }

  /* the combinations grid: up to five players, every on/off arrangement (index_9's WOWY) */
  const M = G.matrixMax;
  const h = el('div', 'wsubhead'); h.appendChild(el('h3', 'wh3', 'Combinations')); h.appendChild(el('span', 'wnote', 'Pick up to ' + M + ' player' + (M === 1 ? '' : 's') + ': every arrangement of them on and off'));
  host.appendChild(h);
  ctx.matrixPick = (ctx.matrixPick || []).filter(id => roster.indexOf(id) !== -1).slice(0, M);
  if (!ctx.matrixPick.length) ctx.matrixPick = [a, b].filter(Boolean).slice(0, M);
  host.appendChild(rail(ctx, { ids: roster, sel: ctx.matrixPick, max: M, onPick: id => {
    const i = ctx.matrixPick.indexOf(id); if (i !== -1) ctx.matrixPick.splice(i, 1); else if (ctx.matrixPick.length < M) ctx.matrixPick.push(id);
    ctx.redraw();
  } }));
  if (G.preview) host.appendChild(teaser(ctx, 'A preview: ' + M + (M === 1 ? ' player' : ' players') + ' at a time', ['Members compare up to five players at once, every on/off arrangement of them.']));
  const picked = ctx.matrixPick;
  if (picked.length) {
    const rows = L.matrix(ctx.teamStints, picked).map(r => Object.assign(r, { ids: r.on }));
    const sc = ctx.scalesFor(Math.max(1, Math.min(5, picked.length)));
    host.appendChild(unitsTable(ctx, {
      units: rows, keys: ctx.cols('matrix'), sort: 'mins', dir: 'desc', scales: sc, scaleNote: ctx.scaleNote(picked.length), thr: ctx.thr, max: 40,
      headLabel: 'ARRANGEMENT', empty: 'Pick a player to begin.',
      label: u => {
        const box = el('div', 'wu-lab');
        const row = el('span', 'wc-row wc-row-s');
        picked.forEach((id, i) => row.appendChild(circle(ctx, { id, size: 's', ring: u.state[i] ? 'on' : 'off', link: false, dim: !u.state[i] })));
        box.appendChild(row);
        const onN = picked.filter((id, i) => u.state[i]).map(id => short(ctx, id)), offN = picked.filter((id, i) => !u.state[i]).map(id => short(ctx, id));
        const words = !u.stints ? 'never shared the floor' : picked.length === 1 ? (onN.length ? onN[0] + ' on' : offN[0] + ' off') : !onN.length ? 'none of them' : !offN.length ? 'all together' : onN.join(' + ') + ' · not ' + offN.join(', ');
        const nm = el('div', 'wu-names'); nm.appendChild(el('span', null, words)); box.appendChild(nm);
        const chip = u.stints ? relChip(W.reliability(u, ctx.thr), ctx.thr) : null; if (chip) { const mm = el('div', 'wu-meta'); mm.appendChild(chip); box.appendChild(mm); }
        return box;
      }
    }));
  }
  hydrate(ctx, host);
}

/* --------------------------------------------------------- the builder view --- */
function buildView(ctx, host) {
  clear(host);
  const G = ctx.gate, S = ctx.state;
  const roster = ctx.rosterIds();
  if (!G.builder) {
    host.appendChild(teaser(ctx, 'The lineup builder is for members', ['Choose up to five players from the roster and read that unit: its ratings, four factors and how it compares with the rest of the team.']));
    if (G.players >= 1 && roster.length) host.appendChild(notice('You can look at one player at a time in On / off.'));
    return;
  }
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
  const res = W.build(ctx.teamStints, picked);
  const base = L.filter(ctx.teamStints, []);
  if (res.mode === 'never' || res.mode === 'none') {
    host.appendChild(el('div', 'pg-empty', 'These players never shared the floor' + (picked.length < 5 ? ' all at once.' : '.') + ' Take one out to see the nearest unit.'));
  } else if (res.mode === 'nearest') {
    host.appendChild(notice('These five have not played together as a unit. The nearest units that have (four of the five):', 'wwarn'));
    const list = el('div', 'wnear');
    res.near.forEach(n => {
      const c = el('div', 'wcard');
      c.appendChild(circleRow(ctx, n.ids, { size: 'm' }));
      c.appendChild(el('p', 'wsub', 'without ' + short(ctx, n.without) + ' · ' + W.fmt('mins', n.mins) + ' min · net ' + W.fmt('net', n.net)));
      c.appendChild(btn('Read this four', () => ctx.go({ u: n.ids })));
      list.appendChild(c);
    });
    host.appendChild(list);
  } else {
    const line = res.line;
    const scales = ctx.scalesFor(picked.length);
    const rel = W.reliability(line, ctx.thr);
    host.appendChild(notice(res.mode === 'exact' ? 'The exact five, from the stints they shared.' : 'Every stint with all ' + picked.length + ' of them on the floor together (the other ' + (5 - picked.length) + ' spots were anyone).', 'wsub'));
    const tiles = el('div', 'wtiles');
    ['net', 'ortg', 'drtg', 'pace', 'mins', 'poss'].forEach(k => {
      const c = W.col(k); const t = el('div', 'wtile'); t.appendChild(el('div', 'v', W.fmt(k, line[k]))); t.appendChild(el('div', 'l', c.label));
      const tn = c.dir && rel !== 'tiny' && scales[k] ? W.tone(scales[k], line[k], c.dir) : null; const bg = W.tint(tn); if (bg) t.style.background = bg;
      if (tn != null && W.band(tn) >= 5) t.dataset.a = '▲'; else if (tn != null && W.band(tn) <= 1) t.dataset.a = '▼';
      tiles.appendChild(t);
    });
    host.appendChild(tiles);
    const chip = relChip(rel, ctx.thr); if (chip) host.appendChild(chip);
    const vs = W.unitVsRest(ctx.teamStints, picked);
    host.appendChild(splitGrid(W.splitRows(vs.on, vs.off), { on: 'THIS UNIT', off: 'REST OF TEAM' }, { scales }));
    const acts = el('div', 'wdet-a');
    acts.appendChild(btn('Copy link', () => ctx.link()));
    acts.appendChild(btn('Clear', () => ctx.go({ u: [] })));
    host.appendChild(acts);
    host.appendChild(notice('Coloured against the league’s ' + picked.length + '-man units (' + ctx.scaleNote(picked.length) + ').'));
  }
  hydrate(ctx, host);
}

root.EpinoiaWowyUI = { circle, circleRow, hydrate, unitsTable, splitGrid, seg, legend, columnPicker, rail, teaser, notice, btn,
  lineupsView, overviewView, onOffView, pairView, buildView, inkOn, safeColour, byJersey, short, nameOf };
})(typeof window !== 'undefined' ? window : globalThis);
