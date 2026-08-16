'use strict';
/* Season statistics — the index_9-style full table at season scope.
   Sortable, min-games filter, CSV export. Rates come from the view, which
   computes them from summed components rather than averaging per-game rates. */

const CFG = window.COURTSIDE_CONFIG;
const qp = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const n1 = v => (v == null ? '' : Number(v).toFixed(1));
const n2 = v => (v == null ? '' : Number(v).toFixed(2));

const COLS = [
  ['#',     r => r.jersey || '',            'jersey'],
  ['PLAYER',r => r.name,                    'name'],
  ['TEAM',  r => r.teamName || '',          'teamName'],
  ['GP',    r => r.gp,                      'gp'],
  ['MIN',   r => n1(r.min),                 'min'],
  ['PTS',   r => r.pts,                     'pts'],
  ['PPG',   r => n1(r.ppg),                 'ppg'],
  ['RPG',   r => n1(r.rpg),                 'rpg'],
  ['APG',   r => n1(r.apg),                 'apg'],
  ['REB',   r => r.reb,                     'reb'],
  ['AST',   r => r.ast,                     'ast'],
  ['STL',   r => r.stl,                     'stl'],
  ['BLK',   r => r.blk,                     'blk'],
  ['TO',    r => r.tov,                     'tov'],
  ['A/TO',  r => n2(r.ast_to),              'ast_to'],
  ['FG',    r => `${r.fgm}-${r.fga}`,       'fgm'],
  ['3PT',   r => `${r.p3m}-${r.p3a}`,       'p3m'],
  ['3P%',   r => n1(r.p3_pct),              'p3_pct'],
  ['FT',    r => `${r.ftm}-${r.fta}`,       'ftm'],
  ['FT%',   r => n1(r.ft_pct),              'ft_pct'],
  ['EFG%',  r => n1(r.efg),                 'efg'],
  ['TS%',   r => n1(r.ts),                  'ts'],
  ['RIM%',  r => n1(r.rim_pct),             'rim_pct'],
  ['+/-',   r => (r.pm > 0 ? '+' : '') + (r.pm ?? ''), 'pm']
];

let rows = [], sortKey = 'ppg', sortDir = -1;

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}

(async function boot() {
  try {
    const leagueSlug = qp.get('l') || 'demo-league';
    const lg = (await api(`leagues?slug=eq.${encodeURIComponent(leagueSlug)}&select=id,name&limit=1`))[0];
    if (!lg) return fail('League not found.');
    $('#ctx').textContent = lg.name;
    $('#title').textContent = lg.name + ' — season statistics';

    let comp = qp.get('c');
    if (!comp) {
      const sn = (await api(`seasons?league_id=eq.${lg.id}&select=id&order=starts_on.desc&limit=1`))[0];
      if (sn) comp = ((await api(`competitions?season_id=eq.${sn.id}&select=id&limit=1`))[0] || {}).id;
    }
    if (!comp) return fail('This league has no competitions yet.');

    // names come from the view itself — PostgREST cannot embed into a view
    const raw = await api(`player_season_stats?competition_id=eq.${comp}&select=*`);
    rows = raw.map(r => Object.assign({}, r, {
      name: ((r.first_name || '') + ' ' + (r.last_name || '')).trim() || 'Player',
      slug: r.player_slug,
      teamName: r.team_short || r.team_name || ''
    }));
    render();
  } catch (e) { fail('Could not load: ' + e.message); }
})();

function fail(m) { const h = $('#tbl'); h.textContent = ''; h.appendChild(el('div', 'empty', m)); }

function render() {
  const minG = parseInt($('#minG').value, 10) || 0;
  const view = rows.filter(r => (r.gp || 0) >= minG).sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (typeof x === 'string' || typeof y === 'string')
      return String(x || '').localeCompare(String(y || '')) * (sortDir === -1 ? -1 : 1);
    return ((y ?? -Infinity) - (x ?? -Infinity)) * (sortDir === -1 ? 1 : -1);
  });
  $('#count').textContent = view.length + ' player' + (view.length === 1 ? '' : 's');

  const host = $('#tbl'); host.textContent = '';
  if (!view.length) {
    host.appendChild(el('div', 'empty',
      'No season statistics yet — these fill in as games are finalised in the scorer.'));
    return;
  }
  const t = el('table', 'cs-tbl'); t.style.minWidth = '1180px';
  const th = el('thead'), hr = el('tr');
  COLS.forEach(c => {
    const h = el('th', c[2] === sortKey ? 'sorted' : '', c[0]);
    h.addEventListener('click', () => {
      if (sortKey === c[2]) sortDir = -sortDir; else { sortKey = c[2]; sortDir = -1; }
      render();
    });
    hr.appendChild(h);
  });
  th.appendChild(hr); t.appendChild(th);
  const tb = el('tbody');
  view.forEach(r => {
    const tr = el('tr');
    COLS.forEach((c, i) => {
      const td = el('td');
      if (i === 1 && r.slug) { const a = el('a', 'plain', c[1](r)); a.href = '../p/?p=' + encodeURIComponent(r.slug); td.appendChild(a); }
      else td.textContent = c[1](r);
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb); host.appendChild(t);
}

$('#minG').addEventListener('input', render);
$('#csv').addEventListener('click', () => {
  const minG = parseInt($('#minG').value, 10) || 0;
  const view = rows.filter(r => (r.gp || 0) >= minG);
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [COLS.map(c => esc(c[0])).join(',')]
    .concat(view.map(r => COLS.map(c => esc(c[1](r))).join(',')))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'season-stats.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
