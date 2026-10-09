'use strict';
/* ============================================================================
   MANAGER VALUES - the platform console's league editor for EPINOIA Manager (0259; Louie, 2026-10-09: "in platform,
   a value assigning to leagues system (see the FOOTBALL MANAGER EDITOR as inspiration), and also an ability to drag
   and assign multiple leagues at once a typical value range ... In newly assigned continental/secondary competitions
   ... an ability to give a value boost to teams/players playing in those").

   WHAT A RANGE IS: the money a league's market runs between. Inside it a player's place comes from his index
   (manager/core/value.js priceLeague): min + (max - min) p^3 for his percentile p in the league, a little over the top
   for its outliers and under the bottom for its fringe - so the range is "its fringe player to its best". A league
   without one is priced at the middle league's range (the adapter's medianRange). WHAT A BOOST IS: a share added to
   the value of every player at a club that also plays in the boosted league (the clubs linked in Links, 0178); a club
   in several takes the largest (manager_boosts).

   Like a football manager's editor: every league in one list, by country; ticked one by one, a country at a time, a
   run of them with shift, or by dragging down the ticks; then one range (typed - 450k, 1.2m - or a preset) or one
   boost set for all the ticked leagues at once, in one call (manager_set_values, platform administrators only).
   Reads leagues and manager_league_values (public); before 0259 is on the server it says so, and saves nothing.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaManagerUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
/* a name, a country, a sum: data, never run through the translator */
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
const btn = (text, cls, fn) => { const b = el('button', 'ep-btn ' + (cls || 'mini'), text); b.type = 'button';
  if (fn) b.addEventListener('click', fn); return b; };

/* ---------------------------------------------------------------- pure --- */
const CURVE = 3;                                   // manager/core/value.js
const DEFAULT_RANGE = { min: 4000, max: 72000 }; // ...and its range for a league nobody has set
/* the presets: a ladder of markets, from a development league to a continental one */
/* THE RANGES ARE WAGES (Louie, 2026-10-09): a league's fringe player's wage to its best's (core/value.js) */
const PRESETS = [
  ['Development', 1000, 8000], ['Second tier', 2000, 25000], ['Mid league', 4000, 72000],
  ['Strong league', 10000, 200000], ['Top league', 25000, 500000], ['Continental', 60000, 1300000]
];
const BOOSTS = [0, 5, 10, 15, 25, 40];
/* money as the Manager prints it (value.js money) */
function money(v) {
  if (!(v >= 0) || !isFinite(v)) return '–';
  if (v >= 1e6) return '€' + (Math.round(v / 1e5) / 10).toString().replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return '€' + Math.round(v / 1e3) + 'K';
  return '€' + Math.round(v);
}
/* what an administrator types: 450k, 1.2m, 450,000, €450K, 1 200 000 */
function parseMoney(s) {
  const t = String(s || '').trim().toLowerCase().replace(/[€$£\s]/g, '');
  if (!t) return null;
  const m = /^(\d+(?:[.,]\d+)?|\d{1,3}(?:,\d{3})+)(k|m)?$/.exec(t);
  if (!m) return null;
  let n = m[1];
  n = /^\d{1,3}(,\d{3})+$/.test(n) ? +n.replace(/,/g, '') : +n.replace(',', '.');
  if (m[2] === 'k') n *= 1e3; else if (m[2] === 'm') n *= 1e6;
  return isFinite(n) && n > 0 ? Math.round(n) : null;
}
/* a value at a percentile of the league (the curve, without the outliers' stretch) */
const at = (r, p) => r.min + (r.max - r.min) * Math.pow(p, CURVE);
/* a range that can be saved: min at least 1,000, max above it and at most 100M (the table's checks) */
function rangeOk(min, max) {
  if (!(min >= 1000)) return 'The bottom of a range is at least €1K.';
  if (!(max > min)) return 'The top of a range is above its bottom.';
  if (max > 1e8) return 'The top of a range is at most €100M.';
  return '';
}
/* the middle league's range, as the Manager prices a league without one */
function medianRange(values) {
  const list = [...values.values()].filter(r => r.max > r.min && !(r.boost > 0));
  if (!list.length) return DEFAULT_RANGE;
  const mids = list.map(r => (r.min + r.max) / 2).sort((a, b) => a - b), m = mids[Math.floor(mids.length / 2)];
  return list.find(r => (r.min + r.max) / 2 === m) || DEFAULT_RANGE;
}
/* the rows one call saves: each ticked league with the new range (keeping its boost), or the new boost (keeping its
   range - a league with none takes the middle league's, so its boost has a range to sit on), or nothing (cleared) */
function rowsFor(ids, values, change) {
  const mid = medianRange(values);
  return ids.map(id => {
    const cur = values.get(id) || null;
    if (change.clear) return { league_id: id, min_value: null };
    const r = change.range || (cur ? { min: cur.min, max: cur.max } : mid);
    const boost = change.boost != null ? change.boost : cur ? cur.boost : 0;
    return { league_id: id, min_value: r.min, max_value: r.max, boost };
  });
}

/* ---------------------------------------------------------------- mount --- */
function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host || host.dataset.mounted === '1') { if (host && host._mgvReload) host._mgvReload(); return; }
  host.dataset.mounted = '1';
  const sb = o.sb, say = o.say || (() => {});
  let leagues = [], values = new Map(), ready = false, missing = false;
  const ticked = new Set();
  const state = { q: '', show: 'all' };
  let lastIdx = -1, drag = null;

  host.textContent = '';
  const lead = el('p', 'lead');
  lead.appendChild(el('span', null, 'What a player is paid in each league in EPINOIA Manager. A wage range runs from a league’s fringe player to its best (his value is his wage over 16%); '
    + 'a player’s place in it comes from his index. A boost adds to the value of every player at a club that also plays in that league (the clubs linked in Links): for the continental competitions. '
    + 'Tick leagues (shift for a run, or drag down the ticks), then set one range or one boost for all of them.'));
  host.appendChild(lead);

  const tools = el('div', 'row mgv-tools');
  const q = el('input', 'ep-input grow'); q.type = 'search'; q.placeholder = 'find a league or a country'; q.setAttribute('aria-label', 'Find a league or a country');
  q.addEventListener('input', () => { state.q = q.value.trim().toLowerCase(); draw(); });
  const seg = el('div', 'mgv-seg');
  [['all', 'all'], ['set', 'with a range'], ['unset', 'without'], ['boost', 'boosted']].forEach(([k, label]) => {
    const b = el('button', 'mgv-segb' + (k === state.show ? ' on' : ''), label); b.type = 'button';
    b.addEventListener('click', () => { state.show = k; seg.querySelectorAll('.mgv-segb').forEach(x => x.classList.toggle('on', x === b)); draw(); });
    seg.appendChild(b);
  });
  tools.append(q, seg);
  host.appendChild(tools);
  const sum = el('div', 'mgv-sum');
  host.appendChild(sum);
  const list = el('div', 'mgv-list');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Leagues');
  host.appendChild(list);

  /* THE BAR: what is ticked, and what to set on it */
  const bar = el('div', 'mgv-bar hide');
  const count = el('b', 'mgv-n');
  const minIn = el('input', 'ep-input mgv-money'); minIn.placeholder = 'bottom · 25k'; minIn.setAttribute('aria-label', 'Bottom of the range');
  const maxIn = el('input', 'ep-input mgv-money'); maxIn.placeholder = 'top · 450k'; maxIn.setAttribute('aria-label', 'Top of the range');
  const prev = el('span', 'mgv-prev');
  const setR = btn('set range', 'mini pri', () => save({ range: readRange() }));
  const presets = el('div', 'mgv-presets');
  PRESETS.forEach(([name, a, b]) => {
    const p = el('button', 'mgv-chip'); p.type = 'button';
    p.appendChild(el('span', null, name));
    p.appendChild(data('small', null, money(a) + '–' + money(b)));
    p.addEventListener('click', () => { minIn.value = money(a).slice(1); maxIn.value = money(b).slice(1); preview(); });
    presets.appendChild(p);
  });
  const boostIn = el('input', 'ep-input mgv-pct'); boostIn.type = 'number'; boostIn.min = '0'; boostIn.max = '200'; boostIn.step = '1'; boostIn.placeholder = '%';
  boostIn.setAttribute('aria-label', 'Boost, per cent');
  const boosts = el('div', 'mgv-presets');
  BOOSTS.forEach(v => { const p = el('button', 'mgv-chip'); p.type = 'button'; p.appendChild(data('span', null, v + '%')); p.addEventListener('click', () => { boostIn.value = String(v); }); boosts.appendChild(p); });
  const setB = btn('set boost', 'mini pri', () => {
    const v = boostIn.value === '' ? NaN : +boostIn.value;
    if (!(v >= 0 && v <= 200)) return say('A boost is 0% to 200%.', 'err');
    save({ boost: Math.round(v * 10) / 1000 });
  });
  const clear = btn('clear range', 'mini', () => {
    const n = [...ticked].filter(id => values.has(id)).length;
    if (!n) return say('None of the ticked leagues has a range to clear.', 'err');
    if (!confirm('Clear the range (and boost) of ' + n + ' league' + (n === 1 ? '' : 's') + '? Their players go back to the middle league’s range.')) return;
    save({ clear: true });
  });
  const untick = btn('untick all', 'mini', () => { ticked.clear(); draw(); });
  const r1 = el('div', 'mgv-brow');
  const lab = el('span', 'mgv-blab');
  lab.append(count);
  r1.append(lab, minIn, el('span', 'mgv-dash', '–'), maxIn, setR, prev);
  const r2 = el('div', 'mgv-brow'); r2.append(el('span', 'mgv-blab', 'presets'), presets);
  const r3 = el('div', 'mgv-brow'); r3.append(el('span', 'mgv-blab', 'boost'), boostIn, boosts, setB, el('span', 'mgv-gap'), clear, untick);
  bar.append(r1, r2, r3);
  host.appendChild(bar);
  [minIn, maxIn].forEach(i => i.addEventListener('input', preview));

  function readRange() {
    const a = parseMoney(minIn.value), b = parseMoney(maxIn.value);
    const bad = a == null || b == null ? 'Type a wage range as 4k – 72k, or pick a preset.' : rangeOk(a, b);
    if (bad) { say(bad, 'err'); return null; }
    return { min: a, max: b };
  }
  /* what the range would make of a league's players: its middle man, a starter, its best */
  function preview() {
    const a = parseMoney(minIn.value), b = parseMoney(maxIn.value);
    prev.textContent = '';
    if (a == null || b == null || rangeOk(a, b)) return;
    const r = { min: a, max: b };
    prev.appendChild(el('span', null, 'middle man '));
    prev.appendChild(data('b', null, money(at(r, 0.5))));
    prev.appendChild(el('span', null, ' · a starter '));
    prev.appendChild(data('b', null, money(at(r, 0.85))));
    prev.appendChild(el('span', null, ' · its best '));
    prev.appendChild(data('b', null, money(at(r, 0.99))));
  }

  async function save(change) {
    if (change.range === null) return;
    if (missing) return say('The Manager’s tables are not on the server yet (migration 0259): nothing can be saved.', 'err');
    const ids = [...ticked];
    if (!ids.length) return;
    const rows = rowsFor(ids, values, change);
    const busy = [setR, setB, clear];
    busy.forEach(b => { b.disabled = true; });
    try {
      const { data: n, error } = await sb.rpc('manager_set_values', { p_rows: rows });
      if (error) throw error;
      say((change.clear ? 'Cleared' : 'Saved') + ': ' + (n || rows.length) + ' league' + ((n || rows.length) === 1 ? '' : 's') + '.', 'ok');
      await load();
    } catch (e) {
      say('Not saved: ' + (e && (e.message || e.details) || e), 'err');
    } finally { busy.forEach(b => { b.disabled = false; }); }
  }

  /* --------------------------------------------------------------- read --- */
  async function load() {
    list.textContent = '';
    list.appendChild(el('div', 'empty', 'Reading the leagues…'));
    try {
      const [L, V] = await Promise.all([
        sb.from('leagues').select('id,slug,name,country,gender').order('name'),
        sb.from('manager_league_values').select('league_id,min_value,max_value,boost,updated_at')
      ]);
      if (L.error) throw L.error;
      leagues = L.data || [];
      missing = !!(V.error && (V.error.code === '42P01' || V.error.code === 'PGRST205' || /does not exist|schema cache/i.test(V.error.message || '')));
      values = new Map(((V.error ? [] : V.data) || []).map(r => [r.league_id, { min: +r.min_value, max: +r.max_value, boost: +r.boost || 0, at: r.updated_at }]));
      ready = true;
      draw();
    } catch (e) {
      list.textContent = '';
      list.appendChild(el('div', 'empty', 'The leagues could not be read: ' + (e && e.message || e)));
    }
  }
  host._mgvReload = load;

  /* --------------------------------------------------------------- draw --- */
  function visible() {
    return leagues.filter(l => {
      const v = values.get(l.id);
      if (state.show === 'set' && !v) return false;
      if (state.show === 'unset' && v) return false;
      if (state.show === 'boost' && !(v && v.boost > 0)) return false;
      if (!state.q) return true;
      return (l.name + ' ' + (l.slug || '') + ' ' + (l.country || '')).toLowerCase().includes(state.q);
    }).sort((a, b) => (a.country || '~').localeCompare(b.country || '~') || a.name.localeCompare(b.name));
  }
  function draw() {
    if (!ready) return;
    const rows = visible();
    sum.textContent = '';
    const set = leagues.filter(l => values.has(l.id)).length, boosted = [...values.values()].filter(v => v.boost > 0).length, mid = medianRange(values);
    sum.appendChild(el('span', null, set + ' of ' + leagues.length + ' leagues have a range · ' + boosted + ' boosted · a league without one is priced at '));
    sum.appendChild(data('b', null, money(mid.min) + '–' + money(mid.max)));
    if (missing) sum.appendChild(el('span', 'mgv-warn', ' · the Manager’s tables are not on the server yet (migration 0259): nothing can be saved'));
    list.textContent = '';
    if (!rows.length) { list.appendChild(el('div', 'empty', 'No league matches.')); bars(); return; }
    let country = null, group = null;
    rows.forEach((l, i) => {
      const c = l.country || 'No country';
      if (c !== country) {
        country = c;
        const inC = rows.filter(x => (x.country || 'No country') === c);
        group = el('div', 'mgv-country');
        const ck = el('input'); ck.type = 'checkbox';
        ck.checked = inC.every(x => ticked.has(x.id));
        ck.indeterminate = !ck.checked && inC.some(x => ticked.has(x.id));
        ck.setAttribute('aria-label', 'Tick every league in ' + c);
        ck.addEventListener('change', () => { inC.forEach(x => { if (ck.checked) ticked.add(x.id); else ticked.delete(x.id); }); draw(); });
        const lb = el('label', 'mgv-ch');
        lb.append(ck, data('span', null, c), el('small', null, inC.length + (inC.length === 1 ? ' league' : ' leagues')));
        group.appendChild(lb);
        list.appendChild(group);
      }
      group.appendChild(rowOf(l, i, rows));
    });
    bars();
  }
  function rowOf(l, i, rows) {
    const v = values.get(l.id);
    const r = el('div', 'mgv-row' + (ticked.has(l.id) ? ' on' : '') + (v ? '' : ' unset'));
    r.dataset.i = String(i);
    const ck = el('input'); ck.type = 'checkbox'; ck.checked = ticked.has(l.id); ck.tabIndex = 0;
    ck.setAttribute('aria-label', 'Tick ' + l.name);
    /* a tick: one click, a run with shift, or a drag down the ticks */
    const tickTo = (on, j) => { const x = rows[j]; if (!x) return; if (on) ticked.add(x.id); else ticked.delete(x.id); };
    ck.addEventListener('click', e => {
      e.preventDefault();
      const on = !ticked.has(l.id);
      if (e.shiftKey && lastIdx >= 0) { const [a, b] = [Math.min(lastIdx, i), Math.max(lastIdx, i)]; for (let j = a; j <= b; j++) tickTo(on, j); }
      else tickTo(on, i);
      lastIdx = i;
      draw();
    });
    /* a drag starts on a tick; the first row it reaches ticks the one it started on as well (that one's own click
       never comes: the button goes up elsewhere) */
    r.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.shiftKey || !e.target.closest('.mgv-tick')) return;
      drag = { on: !ticked.has(l.id), start: i, moved: false };
    });
    r.addEventListener('pointerenter', e => {
      if (!drag || !(e.buttons & 1) || (i === drag.start && !drag.moved)) return;
      const show = j => {
        const row = list.querySelector('.mgv-row[data-i="' + j + '"]');
        if (!row) return;
        row.classList.toggle('on', drag.on);
        const c = row.querySelector('input[type="checkbox"]');
        if (c) c.checked = drag.on;
      };
      if (!drag.moved) { drag.moved = true; tickTo(drag.on, drag.start); show(drag.start); }
      tickTo(drag.on, i);
      show(i);
      lastIdx = i;
      bars();
    });
    const tk = el('span', 'mgv-tick'); tk.appendChild(ck);
    const nm = el('span', 'mgv-nm');
    nm.appendChild(data('b', null, l.name));
    if (l.gender === 'women') nm.appendChild(el('small', null, 'women'));
    const rg = el('span', 'mgv-rg');
    if (v) {
      rg.appendChild(data('b', null, money(v.min) + '–' + money(v.max)));
      rg.appendChild(data('small', null, 'best ' + money(at(v, 0.99))));
    } else rg.appendChild(el('span', 'mgv-none', 'middle league’s'));
    const bo = el('span', 'mgv-bo' + (v && v.boost > 0 ? ' up' : ''));
    bo.appendChild(data('span', null, v && v.boost > 0 ? '+' + Math.round(v.boost * 1000) / 10 + '%' : '–'));
    const up = el('span', 'mgv-up');
    if (v && v.at) up.appendChild(data('span', null, new Date(v.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })));
    r.append(tk, nm, rg, bo, up);
    return r;
  }
  function bars() {
    const n = ticked.size;
    bar.classList.toggle('hide', !n);
    count.textContent = n + (n === 1 ? ' league ticked' : ' leagues ticked');
    /* one league ticked: its own range in the boxes, to change */
    if (n === 1) {
      const v = values.get([...ticked][0]);
      if (v && document.activeElement !== minIn && document.activeElement !== maxIn) {
        minIn.value = money(v.min).slice(1); maxIn.value = money(v.max).slice(1);
        boostIn.value = String(Math.round(v.boost * 1000) / 10);
        preview();
      }
    }
  }
  document.addEventListener('pointerup', () => { if (drag) { const m = drag.moved; drag = null; if (m) draw(); } });

  load();
}

return { mount, parseMoney, money, rowsFor, medianRange, rangeOk, PRESETS };
}));
