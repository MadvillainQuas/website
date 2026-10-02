'use strict';
/* ============================================================================
   THE STATISTICS TABLE AS A GRAPHIC — the stats page's "graphic" button.

   Whatever the table is sorted by becomes a post for socials: the top N rows,
   in the table's own order, with the stat it is sorted by as the big figure and
   up to four of the table's other columns beside it. It is drawn by the console's
   Graphics machinery (socialcard.js, kind 'statboard'), so it is the same house
   style, the same three shapes (square, portrait, story), the same player or
   team circles and the same league colours and logo.

   NOTHING NEW IS READ. The rows are the ones the table already holds, filtered,
   searched and sorted as the reader left them (fulltable.js getView), and every
   figure is the table's own text for it (its column's fmt). The crests and the
   league's logo are the images the table already shows, asked for with
   crossOrigin so the canvas can still be saved (reportcard.js readableCrest).

     modelFrom(table, o)   pure: the statboard model for a table's API and the
                           panel's choices (the tests drive it)
     defaultSecs(...)      the two columns a board opens with beside its stat
     mount({ host, ... })  the panel: open(table, button), bind(table),
                           refresh() after every draw of the table, close()
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaStatGfx = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const SC = () => root.EpinoiaSocialCard;
const N_MIN = 3, N_MAX = 20, N_DEF = 10, SECS_MAX = 4;
const SHAPES = ['square', 'portrait', 'story'];
const THEMES = ['dark', 'light', 'contrast'];
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
const tr = t => (root.EpinoiaI18n && typeof root.EpinoiaI18n.t === 'function' ? root.EpinoiaI18n.t(t) : t);
const STORE = 'epinoia.statgfx';

/* a column the board can be about: a figure, not who the row is */
const isStat = c => !!(c && c.k && c.k !== 'rank' && !c.text && !(c.g && c.g.includes('id')));

/* the club as socialcard.js draws it: its name, colour and crest (the table's own logo path, at 256px) */
function teamOf(r, crestOf) {
  const logo = r.teamLogo || r.logo || null;
  return { name: r.teamFull || r.teamName || '', short_name: r.teamShort || '', colour: r.colour || r.teamColour || null,
           colour_2: null, crestUrl: logo && typeof crestOf === 'function' ? crestOf(logo) : null };
}

/* the title a board takes from how its table is sorted: the best first is "PPG leaders", the other way "Lowest PPG" */
function titleFor(col, dir) {
  const l = String((col && col.l) || 'Stat');
  const best = col && col.low ? dir === 1 : dir !== 1;
  return best ? l + ' leaders' : (col && col.low ? 'Highest ' : 'Lowest ') + l;
}

/* the two columns a board opens with beside its stat: the next two of the table's view that are stats */
function defaultSecs(primaryKey, visible) {
  return (visible || []).filter(c => isStat(c) && c.k !== primaryKey && !/^bio_/.test(c.k)).slice(0, 2).map(c => c.k);
}

/* THE MODEL. `table` is fulltable.js's API (getView, getSort, getColumns, describe); `o` is the panel's choices:
   n, secs (column keys), league (the leagues row), season (its name), scope (a phase's name), crestOf, headline */
function modelFrom(table, o) {
  o = o || {};
  const view = table.getView() || [];
  const sort = table.getSort ? table.getSort() : { key: null, dir: -1, col: null };
  const cols = table.getColumns ? table.getColumns() : [];
  const byKey = new Map(cols.map(c => [c.k, c]));
  /* the stat it is sorted by; a table sorted by a name or a club has no figure to lead with, and the board takes PPG */
  let col = isStat(sort.col) ? sort.col : null;
  const sorted = !!col;
  if (!col) col = byKey.get('ppg') || cols.find(isStat) || null;
  const n = clampN(Math.floor(o.n) || N_DEF, N_MIN, N_MAX);
  const top = view.slice(0, n);
  const secCols = [...new Set((o.secs || []).filter(Boolean))].filter(k => !col || k !== col.k).map(k => byKey.get(k)).filter(isStat).slice(0, SECS_MAX);
  const fmt = (c, r, i) => {
    if (!c) return '—';
    try { const t = c.fmt ? c.fmt(r, i) : r[c.k]; return t == null || t === '' ? '—' : String(t); } catch (_) { return '—'; }
  };
  const L = o.league || {};
  const logoUrl = L.logo_path && typeof o.crestOf === 'function' ? o.crestOf(L.logo_path) : null;
  const league = { name: L.name || '', slug: L.slug || '', colour: L.colour_a || L.colour || null, colour2: L.colour_b || L.colour2 || null,
                   timezone: L.timezone || null, country: L.country || null, logoUrl };
  const said = typeof table.describe === 'function' ? table.describe() : '';
  const input = {
    league, comp: L.name || '', range: o.season || '',
    title: o.headline || titleFor(col, sort.dir),
    sub: [o.scope || 'Whole season', said].filter(Boolean).join(' · '),
    stat: { key: col ? col.k : '', label: col ? col.l : '' },
    secs: secCols.map(c => ({ key: c.k, label: c.l })),
    rows: top.map((r, i) => ({ rank: i + 1, name: r.name || 'Player', team: teamOf(r, o.crestOf), photoUrl: r.photo_url || r.photoUrl || null,
      value: fmt(col, r, i), secs: secCols.map(c => fmt(c, r, i)) }))
  };
  const S = SC();
  const model = S ? S.statboard(input) : Object.assign({ kind: 'statboard' }, input);
  return { model, input, col, sorted, total: view.length, empty: !!col && top.length > 0 && top.every(r => fmt(col, r, 0) === '—') };
}

/* ------------------------------------------------------------- the panel --- */
const el = (t, c, x) => { const n = root.document.createElement(t); if (c) n.className = c; if (x != null) n.textContent = x; return n; };
const load = () => { try { return JSON.parse(root.localStorage.getItem(STORE) || '{}') || {}; } catch (_) { return {}; } };
const keep = s => { try { root.localStorage.setItem(STORE, JSON.stringify(s)); } catch (_) { /* a private window */ } };

function mount(opts) {
  const host = opts.host;
  const saved = load();
  const st = {
    n: clampN(parseInt(saved.n, 10) || N_DEF, N_MIN, N_MAX),
    size: SHAPES.includes(saved.size) ? saved.size : 'square',
    theme: THEMES.includes(saved.theme) ? saved.theme : 'dark',
    discs: saved.discs === 'team' ? 'team' : 'player',
    secs: null,                       // null until the reader chooses: then the table's next two columns
    primary: null,                    // the stat the secondary choice was made against
    headline: ''
  };
  let table = null, btn = null, open = false, seq = 0, timer = null, last = null;
  const crestOf = path => (typeof root.epinoiaLogoUrl === 'function' ? root.epinoiaLogoUrl(path, 256) : null);

  const panel = el('section', 'sg');
  panel.id = 'statgfx';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Graphic of the table');
  const head = el('div', 'sg-head');
  const h = el('h3', 'sg-title', 'Graphic');
  const status = el('p', 'sg-status');
  status.setAttribute('aria-live', 'polite');
  const x = el('button', 'sg-close', '×');
  x.type = 'button'; x.setAttribute('aria-label', 'Close the graphic');
  head.append(h, status, x);

  const form = el('div', 'sg-form');
  const field = (label, ctl, cls) => { const f = el('label', 'sg-field' + (cls ? ' ' + cls : '')); f.append(el('span', 'sg-lab', label), ctl); return f; };

  /* how many players */
  const nIn = el('input', 'sg-range');
  nIn.type = 'range'; nIn.min = String(N_MIN); nIn.max = String(N_MAX); nIn.step = '1'; nIn.value = String(st.n);
  const nOut = el('output', 'sg-n', String(st.n));
  const nWrap = el('span', 'sg-nrow'); nWrap.append(nIn, nOut);
  nIn.addEventListener('input', () => { st.n = clampN(parseInt(nIn.value, 10) || N_DEF, N_MIN, N_MAX); nOut.textContent = String(st.n); persist(); later(); });
  form.appendChild(field('Players', nWrap));

  /* the shape */
  const shape = el('div', 'sg-seg'); shape.setAttribute('role', 'group'); shape.setAttribute('aria-label', 'Shape');
  const shapeBtns = SHAPES.map(k => {
    const b = el('button', 'ep-chip sg-chip', k); b.type = 'button'; b.dataset.size = k;
    b.addEventListener('click', () => { st.size = k; paintShape(); persist(); later(); });
    shape.appendChild(b); return b;
  });
  const paintShape = () => shapeBtns.forEach(b => { const on = b.dataset.size === st.size; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  paintShape();
  const shapeF = el('div', 'sg-field'); shapeF.append(el('span', 'sg-lab', 'Shape'), shape);
  form.appendChild(shapeF);

  /* the circles and the colours */
  const sel = (list, value, on) => {
    const s = el('select', 'ep-input sg-sel');
    list.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; s.appendChild(o); });
    s.value = value; s.addEventListener('change', () => on(s.value)); return s;
  };
  /* THE CIRCLES, as the console's Graphics offer them: the player's own (his photo where the register has one, else his
     initials, with his club's crest small on its edge) or the club's crest alone */
  const discs = el('div', 'sg-seg'); discs.setAttribute('role', 'group'); discs.setAttribute('aria-label', 'Circles');
  const discBtns = [['player', 'Player circles'], ['team', 'Team circles']].map(([k, l]) => {
    const b = el('button', 'ep-chip sg-chip', l); b.type = 'button'; b.dataset.discs = k;
    b.addEventListener('click', () => { st.discs = k; paintDiscs(); persist(); later(); });
    discs.appendChild(b); return b;
  });
  const paintDiscs = () => discBtns.forEach(b => { const on = b.dataset.discs === st.discs; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
  paintDiscs();
  const discF = el('div', 'sg-field'); discF.append(el('span', 'sg-lab', 'Circles'), discs);
  form.appendChild(discF);
  form.appendChild(field('Colours', sel([['dark', 'Dark'], ['light', 'Light'], ['contrast', 'High contrast']], st.theme, v => { st.theme = v; persist(); later(); })));

  /* the stats beside it: four dropdowns of every column the table has, by its own categories */
  const secBox = el('div', 'sg-secs');
  const secF = el('div', 'sg-field sg-wide'); secF.append(el('span', 'sg-lab', 'Stats beside it (up to 4)'), secBox);
  form.appendChild(secF);
  const secSels = [];
  for (let i = 0; i < SECS_MAX; i++) {
    const s = el('select', 'ep-input sg-sel sg-secsel');
    s.setAttribute('aria-label', 'Stat beside it');
    s.setAttribute('data-i18n-ctx', 'col');
    s.addEventListener('change', () => { st.secs = secSels.map(x => x.value).filter(Boolean); st.primary = sortKey(); later(); });
    secSels.push(s); secBox.appendChild(s);
  }

  /* the headline, when the words it takes from the sort are not the ones wanted */
  const hl = el('input', 'ep-input sg-hl');
  hl.type = 'text'; hl.maxLength = 60; hl.placeholder = 'Headline (optional)';
  hl.addEventListener('input', () => { st.headline = hl.value.trim(); later(); });
  form.appendChild(field('Headline', hl, 'sg-wide'));

  const acts = el('div', 'sg-acts');
  const dl = el('button', 'ep-btn pri sg-dl', 'Export PNG');
  dl.type = 'button';
  acts.appendChild(dl);
  form.appendChild(acts);

  const stage = el('div', 'sg-stage');
  const frame = el('div', 'sg-frame');
  stage.appendChild(frame);
  const body = el('div', 'sg-body');
  body.append(form, stage);
  panel.append(head, body);
  host.appendChild(panel);

  const sortKey = () => { const s = table && table.getSort ? table.getSort() : null; return s && s.col && isStat(s.col) ? s.col.k : null; };
  const persist = () => keep({ n: st.n, size: st.size, theme: st.theme, discs: st.discs });

  /* the dropdowns' lists: every column the table can show, under each of its categories, a column once */
  function fillSecs() {
    if (!table) return;
    const cols = table.getColumns().filter(isStat);
    const pk = sortKey();
    const presets = (table.presets || []).filter(p => p[0] !== '*');
    const seen = new Set();
    const groups = presets.map(([k, l]) => {
      const list = cols.filter(c => c.g && c.g.includes(k) && !seen.has(c.k) && c.k !== pk);
      list.forEach(c => seen.add(c.k));
      return [l, list];
    }).filter(g => g[1].length);
    const rest = cols.filter(c => !seen.has(c.k) && c.k !== pk);
    if (rest.length) groups.push(['player', rest]);
    if (st.secs == null) { st.secs = defaultSecs(pk, table.getVisible ? table.getVisible() : cols); st.primary = pk; }
    const known = new Set(cols.map(c => c.k));
    st.secs = st.secs.filter(k => known.has(k) && k !== pk).slice(0, SECS_MAX);
    secSels.forEach((s, i) => {
      s.textContent = '';
      const none = el('option', null, '—'); none.value = ''; s.appendChild(none);
      groups.forEach(([label, list]) => {
        /* a group's label is an attribute the page's translation does not walk, so it is asked for here */
        const g = el('optgroup'); g.label = tr(label);
        list.forEach(c => { const o = el('option', null, c.l); o.value = c.k; if (c.t) o.title = c.t; g.appendChild(o); });
        s.appendChild(g);
      });
      s.value = st.secs[i] || '';
    });
  }
  function current() {
    if (!table) return null;
    return modelFrom(table, { n: st.n, secs: st.secs || [], league: opts.league, season: opts.season ? opts.season() : '',
      scope: opts.scope ? opts.scope() : '', crestOf, headline: st.headline });
  }
  const drawOpts = scale => ({ size: st.size, theme: st.theme, scale, modules: st.discs === 'team' ? { discs: 'team' } : {} });

  async function preview() {
    if (!open || !table || !SC()) return;
    const my = ++seq;
    const got = current();
    last = got;
    if (!got) return;
    const S = SC().SIZES[st.size];
    const what = got.col ? got.col.l : '';
    /* three short parts, each its own sentence for the translation (i18n patterns "Sorted by …", "top … of …") */
    status.textContent = [got.sorted ? 'Sorted by ' + what : 'Sort the table by a stat to change it: ' + what,
      'top ' + Math.min(st.n, got.total) + ' of ' + got.total, got.empty ? 'no figures yet' : ''].filter(Boolean).join(' · ');
    dl.disabled = !got.total;
    try {
      const c = await SC().canvas(got.model, drawOpts(0.5));
      if (my !== seq) return;
      c.className = 'sg-canvas';
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', 'Preview of the graphic');
      frame.style.aspectRatio = S.w + ' / ' + S.h;
      frame.style.setProperty('--sg-r', String(S.w / S.h));
      frame.textContent = '';
      frame.appendChild(c);
    } catch (e) { console.warn('[statgfx]', e); }
  }
  function later() { clearTimeout(timer); timer = setTimeout(preview, 120); }

  dl.addEventListener('click', async () => {
    const got = current();
    if (!got || !got.total || !SC()) return;
    dl.disabled = true;
    const was = dl.textContent;
    dl.textContent = 'Drawing…';
    try {
      const blob = await SC().png(got.model, drawOpts(1));
      const url = URL.createObjectURL(blob);
      const a = el('a');
      a.href = url; a.download = SC().filename(got.model, st.size);
      root.document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { console.warn('[statgfx] export', e); status.textContent = 'The graphic could not be drawn.'; }
    dl.textContent = was; dl.disabled = false;
  });

  function paintBtn() { if (btn) { btn.classList.toggle('pri', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); btn.setAttribute('aria-controls', panel.id); } }
  function close() { open = false; panel.hidden = true; paintBtn(); }
  x.addEventListener('click', () => { close(); if (btn) btn.focus(); });

  return {
    panel, state: st,
    /* the table the panel draws from: a new one after every change of season or phase */
    bind(t) { table = t; if (open) { fillSecs(); later(); } },
    toggle(t, b) {
      if (t) table = t;
      if (b) btn = b;
      open = !open;
      panel.hidden = !open;
      paintBtn();
      if (open) { fillSecs(); preview(); if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' }); }
    },
    /* after the table draws (a sort, a filter, a search): the picture follows */
    refresh() { if (open && table) { fillSecs(); later(); } },
    close,
    get last() { return last; }
  };
}

return { modelFrom, defaultSecs, titleFor, teamOf, isStat, mount, N_MIN, N_MAX, N_DEF, SECS_MAX };
}));
