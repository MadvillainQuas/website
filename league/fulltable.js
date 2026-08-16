'use strict';
/* ============================================================================
   COURTSIDE FULL TABLE

   The dense sortable statistics table used by the leaders board, the season
   statistics page and the team pages. Modelled on index_9's full table: stat
   group pills that swap the column set, per-column toggles, search, a minimum
   games filter, sticky header and CSV export.

   One deliberate departure. index_9 defaults to per-75 rates (pts75, reb75,
   ast75 …). This defaults to counting stats — points, rebounds, assists, the
   shooting splits — because that is what someone opening a league page wants
   to read, and a rate needs a possession estimate that only makes sense once a
   season is long enough to trust it. The rate columns are not offered at all
   here rather than offered and wrong.

   Everything is built with DOM methods, never innerHTML with a player's name
   in it — see the security plan.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CourtsideTable = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const n1 = v => (v == null ? '' : Number(v).toFixed(1));
const n2 = v => (v == null ? '' : Number(v).toFixed(2));
const int = v => (v == null ? '' : String(v));
const pm  = v => (v == null ? '' : (v > 0 ? '+' : '') + v);

/* ---------------------------------------------------------------- columns ---
   key      the field on the row
   label    the header
   get      how to render it
   num      how to sort it (undefined = use the field)
   groups   which stat-group pills include it                                 */
const PLAYER_COLS = [
  { key: 'jersey', label: '#',    get: r => r.jersey || '',   sort: r => +r.jersey || 999, always: true },
  { key: 'name',   label: 'PLAYER', get: r => r.name,         sort: r => r.name, always: true, text: true },
  { key: 'team',   label: 'TEAM', get: r => r.teamName || '', sort: r => r.teamName || '', always: true, text: true },

  { key: 'gp',   label: 'GP',   get: r => int(r.gp),   groups: ['all','scoring','defense','playmaking','hustle','advanced'] },
  { key: 'min',  label: 'MIN',  get: r => n1(r.min),   groups: ['all','hustle','advanced'] },
  { key: 'pts',  label: 'PTS',  get: r => int(r.pts),  groups: ['all','scoring'], lead: true },
  { key: 'ppg',  label: 'PPG',  get: r => n1(r.ppg),   groups: ['all','scoring'], lead: true },
  { key: 'reb',  label: 'REB',  get: r => int(r.reb),  groups: ['all','hustle'] },
  { key: 'rpg',  label: 'RPG',  get: r => n1(r.rpg),   groups: ['all','hustle'] },
  { key: 'oreb', label: 'OREB', get: r => int(r.oreb), groups: ['hustle'] },
  { key: 'dreb', label: 'DREB', get: r => int(r.dreb), groups: ['hustle','defense'] },
  { key: 'ast',  label: 'AST',  get: r => int(r.ast),  groups: ['all','playmaking'] },
  { key: 'apg',  label: 'APG',  get: r => n1(r.apg),   groups: ['all','playmaking'] },
  { key: 'stl',  label: 'STL',  get: r => int(r.stl),  groups: ['all','defense','hustle'] },
  { key: 'blk',  label: 'BLK',  get: r => int(r.blk),  groups: ['all','defense','hustle'] },
  { key: 'tov',  label: 'TO',   get: r => int(r.tov),  groups: ['all','playmaking'] },
  { key: 'pf',   label: 'PF',   get: r => int(r.pf),   groups: ['all','defense'] },

  { key: 'fgm',    label: 'FG',   get: r => `${r.fgm}-${r.fga}`, sort: r => r.fgm, groups: ['all','scoring'] },
  { key: 'fg_pct', label: 'FG%',  get: r => n1(r.fg_pct != null ? r.fg_pct
                                       : (r.fga ? 100 * r.fgm / r.fga : null)),
                   sort: r => (r.fga ? r.fgm / r.fga : -1), groups: ['all','scoring'] },
  { key: 'p3m',    label: '3PT',  get: r => `${r.p3m}-${r.p3a}`, sort: r => r.p3m, groups: ['all','scoring'] },
  { key: 'p3_pct', label: '3P%',  get: r => n1(r.p3_pct), groups: ['all','scoring'] },
  { key: 'ftm',    label: 'FT',   get: r => `${r.ftm}-${r.fta}`, sort: r => r.ftm, groups: ['all','scoring'] },
  { key: 'ft_pct', label: 'FT%',  get: r => n1(r.ft_pct), groups: ['all','scoring'] },

  { key: 'efg',     label: 'EFG%', get: r => n1(r.efg),     groups: ['all','scoring','advanced'] },
  { key: 'ts',      label: 'TS%',  get: r => n1(r.ts),      groups: ['all','scoring','advanced'] },
  { key: 'rim_pct', label: 'RIM%', get: r => n1(r.rim_pct), groups: ['scoring','advanced'] },
  { key: 'ast_to',  label: 'A/TO', get: r => n2(r.ast_to),  groups: ['playmaking','advanced'] },
  { key: 'pm',      label: '+/-',  get: r => pm(r.pm),      groups: ['all','defense','advanced'], signed: true }
];

const TEAM_COLS = [
  { key: 'rank', label: '#',     get: (r, i) => String(i + 1), sort: r => r.__i, always: true },
  { key: 'name', label: 'TEAM',  get: r => r.name,             sort: r => r.name, always: true, text: true },

  { key: 'gp',   label: 'GP',   get: r => int(r.gp),   groups: ['all','scoring','defense','playmaking','hustle','advanced'] },
  { key: 'ppg',  label: 'PPG',  get: r => n1(r.ppg),   groups: ['all','scoring'], lead: true },
  { key: 'papg', label: 'OPP',  get: r => n1(r.papg),  groups: ['all','defense'] },
  { key: 'diff', label: 'DIFF', get: r => pm(r.diff),  groups: ['all','advanced'], signed: true },
  { key: 'reb',  label: 'REB',  get: r => int(r.reb),  groups: ['all','hustle'] },
  { key: 'rpg',  label: 'RPG',  get: r => n1(r.rpg),   groups: ['hustle'] },
  { key: 'oreb', label: 'OREB', get: r => int(r.oreb), groups: ['hustle'] },
  { key: 'dreb', label: 'DREB', get: r => int(r.dreb), groups: ['hustle','defense'] },
  { key: 'ast',  label: 'AST',  get: r => int(r.ast),  groups: ['all','playmaking'] },
  { key: 'apg',  label: 'APG',  get: r => n1(r.apg),   groups: ['playmaking'] },
  { key: 'stl',  label: 'STL',  get: r => int(r.stl),  groups: ['all','defense'] },
  { key: 'blk',  label: 'BLK',  get: r => int(r.blk),  groups: ['all','defense'] },
  { key: 'tov',  label: 'TO',   get: r => int(r.tov),  groups: ['all','playmaking'] },
  { key: 'fouls',label: 'PF',   get: r => int(r.fouls),groups: ['defense'] },

  { key: 'fgm',    label: 'FG',   get: r => `${r.fgm}-${r.fga}`, sort: r => r.fgm, groups: ['all','scoring'] },
  { key: 'fg_pct', label: 'FG%',  get: r => n1(r.fg_pct), groups: ['all','scoring'] },
  { key: 'p3m',    label: '3PT',  get: r => `${r.p3m}-${r.p3a}`, sort: r => r.p3m, groups: ['scoring'] },
  { key: 'p3_pct', label: '3P%',  get: r => n1(r.p3_pct), groups: ['all','scoring'] },
  { key: 'ft_pct', label: 'FT%',  get: r => n1(r.ft_pct), groups: ['scoring'] },
  { key: 'efg',    label: 'EFG%', get: r => n1(r.efg),    groups: ['all','scoring','advanced'] },
  { key: 'ts',     label: 'TS%',  get: r => n1(r.ts),     groups: ['scoring','advanced'] },

  { key: 'paint',         label: 'PAINT',  get: r => int(r.paint),         groups: ['scoring'] },
  { key: 'fast',          label: 'FAST',   get: r => int(r.fast),          groups: ['scoring'] },
  { key: 'second_chance', label: '2ND',    get: r => int(r.second_chance), groups: ['hustle','scoring'] },
  { key: 'pts_off_to',    label: 'PoT',    get: r => int(r.pts_off_to),    groups: ['defense','scoring'] },
  { key: 'bench',         label: 'BENCH',  get: r => int(r.bench),         groups: ['all'] },
  { key: 'ast_to',        label: 'A/TO',   get: r => n2(r.ast_to),         groups: ['all','playmaking','advanced'] },
  { key: 'ortg',          label: 'ORTG',   get: r => n1(r.ortg),           groups: ['all','advanced'], lead: true },
  { key: 'pace',          label: 'PACE',   get: r => n1(r.pace),           groups: ['all','advanced'] }
];

const PILLS = [
  ['all', 'all stats'], ['scoring', 'scoring'], ['defense', 'defense'],
  ['playmaking', 'playmaking'], ['hustle', 'hustle'], ['advanced', 'advanced']
];

/* --------------------------------------------------------------- component ---
   opts: { host, rows, kind:'player'|'team', sortKey, minGames, playerHref,
           teamHref, filename, showMinGames }                                 */
function render(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return null;

  const isTeam = opts.kind === 'team';
  const CATALOGUE = isTeam ? TEAM_COLS : PLAYER_COLS;
  const rows = (opts.rows || []).map((r, i) => Object.assign({ __i: i }, r));

  let group = 'all';
  let sortKey = opts.sortKey || (isTeam ? 'ppg' : 'ppg');
  let sortDir = -1;
  let search = '';
  let minGames = opts.minGames != null ? opts.minGames : 0;
  let showCols = false;
  let chosen = new Set(CATALOGUE.filter(c => c.always || (c.groups || []).includes('all'))
                                .map(c => c.key));

  host.textContent = '';

  /* ---- controls ---- */
  const bar = el('div', 'ft-bar');
  const q = el('input', 'cs-input grow');
  q.type = 'search'; q.placeholder = isTeam ? 'find a team…' : 'find a player or team…';
  q.addEventListener('input', () => { search = q.value.trim().toLowerCase(); draw(); });
  bar.appendChild(q);

  if (!isTeam && opts.showMinGames !== false) {
    const mg = el('input', 'cs-input');
    mg.type = 'number'; mg.min = '0'; mg.value = String(minGames);
    mg.style.width = '92px'; mg.title = 'minimum games played';
    mg.addEventListener('input', () => { minGames = parseInt(mg.value, 10) || 0; draw(); });
    bar.appendChild(mg);
    const lab = el('span', 'ft-count', 'min games');
    bar.appendChild(lab);
  }

  const colsBtn = el('button', 'cs-btn', 'columns');
  colsBtn.type = 'button';
  colsBtn.style.cssText = 'font-size:9px;padding:8px 12px';
  colsBtn.addEventListener('click', () => { showCols = !showCols; drawer.hidden = !showCols; });
  bar.appendChild(colsBtn);

  const csv = el('button', 'cs-btn', 'csv');
  csv.type = 'button';
  csv.style.cssText = 'font-size:9px;padding:8px 12px';
  csv.addEventListener('click', exportCsv);
  bar.appendChild(csv);

  const count = el('span', 'ft-count');
  count.style.marginLeft = 'auto';
  bar.appendChild(count);
  host.appendChild(bar);

  /* ---- group pills ---- */
  const pills = el('div', 'ft-pills');
  PILLS.forEach(([key, label]) => {
    const b = el('button', 'ft-pill' + (key === group ? ' on' : ''), label);
    b.type = 'button'; b.dataset.g = key;
    b.addEventListener('click', () => {
      group = key;
      chosen = new Set(CATALOGUE.filter(c => c.always || (c.groups || []).includes(key))
                                .map(c => c.key));
      pills.querySelectorAll('.ft-pill').forEach(p => p.classList.toggle('on', p.dataset.g === key));
      drawDrawer(); draw();
    });
    pills.appendChild(b);
  });
  host.appendChild(pills);

  /* ---- column toggles ---- */
  const drawer = el('div', 'ft-cols');
  drawer.hidden = true;
  const grid = el('div', 'ft-colgrid');
  drawer.appendChild(grid);
  host.appendChild(drawer);

  function drawDrawer() {
    grid.textContent = '';
    CATALOGUE.filter(c => !c.always).forEach(c => {
      const b = el('button', 'ft-col' + (chosen.has(c.key) ? ' on' : ''), c.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (chosen.has(c.key)) chosen.delete(c.key); else chosen.add(c.key);
        b.classList.toggle('on');
        draw();
      });
      grid.appendChild(b);
    });
  }
  drawDrawer();

  /* ---- table ---- */
  const wrap = el('div', 'ft-wrap');
  host.appendChild(wrap);

  const visible = () => CATALOGUE.filter(c => c.always || chosen.has(c.key));

  function sortValue(col, r) {
    return col.sort ? col.sort(r) : r[col.key];
  }

  function view() {
    const cols = visible();
    let v = rows.filter(r => (r.gp || 0) >= minGames);
    if (search) {
      v = v.filter(r => ((r.name || '') + ' ' + (r.teamName || '')).toLowerCase().includes(search));
    }
    const col = CATALOGUE.find(c => c.key === sortKey) || cols[3];
    v.sort((a, b) => {
      const x = sortValue(col, a), y = sortValue(col, b);
      if (typeof x === 'string' || typeof y === 'string')
        return String(x || '').localeCompare(String(y || '')) * (sortDir === -1 ? 1 : -1);
      return (((y ?? -Infinity) - (x ?? -Infinity)) || 0) * (sortDir === -1 ? 1 : -1);
    });
    return v;
  }

  function draw() {
    const cols = visible();
    const v = view();
    count.textContent = v.length + (isTeam ? (v.length === 1 ? ' team' : ' teams')
                                           : (v.length === 1 ? ' player' : ' players'));
    wrap.textContent = '';
    if (!v.length) {
      wrap.appendChild(el('div', 'ft-empty',
        rows.length ? 'Nothing matches that filter.'
                    : 'No statistics yet — these fill in as games are finalised.'));
      return;
    }

    const t = el('table', 'ft');
    const thead = el('thead'), hr = el('tr');
    cols.forEach((c, i) => {
      const th = el('th', (c.key === sortKey ? 'sorted ' : '') +
                          (i < 2 ? 'stick c' + i : ''), c.label);
      th.addEventListener('click', () => {
        if (sortKey === c.key) sortDir = -sortDir;
        else { sortKey = c.key; sortDir = c.text ? 1 : -1; }
        draw();
      });
      hr.appendChild(th);
    });
    thead.appendChild(hr); t.appendChild(thead);

    const tb = el('tbody');
    v.forEach((r, idx) => {
      const tr = el('tr');
      cols.forEach((c, i) => {
        const td = el('td', i < 2 ? 'stick c' + i : '');

        if (c.key === 'name') {
          const cell = el('div', 'ft-name');
          if (r.colour || r.teamColour) {
            const crest = el('span', 'ft-crest', (r.teamShort || r.short_name || '').slice(0, 3));
            crest.style.background = r.colour || r.teamColour;
            cell.appendChild(crest);
          }
          const href = isTeam ? (opts.teamHref && opts.teamHref(r))
                              : (opts.playerHref && opts.playerHref(r));
          if (href) { const a = el('a', null, r.name); a.href = href; cell.appendChild(a); }
          else cell.appendChild(el('span', null, r.name));
          td.appendChild(cell);
        } else {
          td.textContent = c.get(r, idx);
          if (c.lead) td.classList.add('lead');
          if (c.signed) {
            const n = Number(String(c.get(r, idx)).replace('+', ''));
            if (n > 0) td.classList.add('pos'); else if (n < 0) td.classList.add('neg');
          }
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    wrap.appendChild(t);
  }

  function exportCsv() {
    const cols = visible();
    const v = view();
    const esc = x => `"${String(x ?? '').replace(/"/g, '""')}"`;
    const body = [cols.map(c => esc(c.label)).join(',')]
      .concat(v.map((r, i) => cols.map(c => esc(c.key === 'name' ? r.name : c.get(r, i))).join(',')))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = (opts.filename || 'courtside') + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  draw();
  return { redraw: draw, setRows(next) { rows.length = 0; (next || []).forEach((r, i) => rows.push(Object.assign({ __i: i }, r))); draw(); } };
}

return { render, PLAYER_COLS, TEAM_COLS };
}));
