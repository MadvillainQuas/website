'use strict';
/* ============================================================================
   TAKE THE WHOLE SEASON WITH YOU.

   "What happens to our data if we leave?" is asked in every platform sale, and
   the strongest possible answer is a button that hands the season over. Games
   already export one at a time and the API pages through everything, but
   neither is an answer a league secretary can act on — one is per-fixture and
   the other needs somebody who can write a script.

   So: one file, every table that matters, as CSV, named after the season.

   WHY CSV AND NOT JSON. The people who ask for this open it in Excel. JSON is
   the better interchange format and it is already available through the API and
   the per-game export; this is the format that gets used, and a season that
   cannot be opened is not really portable.

   WHY THE ZIP IS WRITTEN BY HAND. A browser cannot make a folder, so a folder
   means an archive, and an archive normally means a library. The whole of a
   store-only ZIP is a local header per file, a central directory, and an
   end-of-central-directory record — about eighty lines including the CRC table.
   That is cheaper to carry and to reason about than a dependency, and it is
   compression the user never sees: these are text files that Excel opens either
   way, and the browser has already gzipped nothing about them.

   WHAT IT DOES NOT DO: it does not bypass row-level security. The export runs
   as the person clicking it, so a minor withheld from public pages is withheld
   from the file, and a league administrator gets their own league. That is the
   point — an export that saw more than its operator would be a way around
   every policy on the database.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaExportUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* ---------------------------------------------------------------- CSV ---- */
/* RFC 4180: quote anything containing a comma, a quote or a newline, and
   double an embedded quote. The naive join(',') version survives testing and
   then meets a club called "Preston, Old" or a news headline with a comma in
   it, and every column after that one shifts by one for that row only. */
function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'object') v = JSON.stringify(v);
  const s = String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(rows, columns) {
  if (!rows || !rows.length) return (columns || []).join(',') + '\n';
  const cols = columns && columns.length ? columns
    : [...rows.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set())];
  const head = cols.join(',');
  const body = rows.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n');
  /* A BOM, because Excel on Windows reads a UTF-8 CSV as the system codepage
     without one, and a squad list is exactly the kind of file that is full of
     names Excel would otherwise mangle — the first club with an accent in
     its name is the one that finds out. */
  return '\uFEFF' + head + '\n' + body + '\n';
}

/* ---------------------------------------------------------------- ZIP ---- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* DOS date and time, which is what a ZIP stores: seconds in two-second steps,
   and a year counted from 1980. */
function dosStamp(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function zipStore(files, when) {
  const enc = new TextEncoder();
  const stamp = dosStamp(when || new Date());
  const parts = [], central = [];
  let offset = 0;

  files.forEach(f => {
    const name = enc.encode(f.name);
    const data = typeof f.body === 'string' ? enc.encode(f.body) : f.body;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);      // local file header
    local.setUint16(4, 20, true);              // version needed
    local.setUint16(6, 0x0800, true);          // flags: names are UTF-8
    local.setUint16(8, 0, true);               // method 0 = stored
    local.setUint16(10, stamp.time, true);
    local.setUint16(12, stamp.date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);    // compressed size
    local.setUint32(22, data.length, true);    // uncompressed size
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);              // no extra field
    parts.push(new Uint8Array(local.buffer), name, data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);        // central directory header
    cen.setUint16(4, 20, true);                // version made by
    cen.setUint16(6, 20, true);                // version needed
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, stamp.time, true);
    cen.setUint16(14, stamp.date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);           // where the local header is
    central.push(new Uint8Array(cen.buffer), name);

    offset += 30 + name.length + data.length;
  });

  const centralBytes = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);          // end of central directory
  end.setUint16(8, files.length, true);        // entries on this disk
  end.setUint16(10, files.length, true);       // entries total
  end.setUint32(12, centralBytes, true);
  end.setUint32(16, offset, true);
  parts.push(...central, new Uint8Array(end.buffer));

  return new Blob(parts, { type: 'application/zip' });
}

/* ------------------------------------------------------------- the data -- */
/* Everything is fetched through PostgREST as the signed-in operator, so RLS
   decides what lands in the file. Paged, because a season of play-by-play is
   larger than any default limit and a silent truncation would be the worst
   possible bug in an export: the file looks complete. */
/* ORDER IS NOT OPTIONAL. A range request against an unordered query has no
   defined row order, so page two may repeat a row from page one and drop
   another entirely — and the failure is silent, which in an export is the
   worst kind there is: the file still looks complete. Every caller names a
   sort that is unique, so the pages tile instead of overlapping. */
async function pageAll(sb, table, select, filter, order) {
  if (!order || !order.length) throw new Error(table + ': paging needs an order');
  const out = [];
  const STEP = 1000;
  for (let from = 0; ; from += STEP) {
    let q = sb.from(table).select(select);
    if (filter) q = filter(q);
    (Array.isArray(order) ? order : [order]).forEach(c => { q = q.order(c); });
    const { data, error } = await q.range(from, from + STEP - 1);
    if (error) throw new Error(table + ': ' + error.message);
    out.push(...(data || []));
    if (!data || data.length < STEP) return out;
  }
}

const slug = s => String(s || 'season').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'season';

/* --------------------------------------------------------------- mount --- */
function mount(opts) {
  const host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
  if (!host) return;
  const { sb, say } = opts;
  host.innerHTML = '';

  const note = el('p', 'ep-micro');
  note.style.cssText = 'color:var(--ink-3);line-height:1.9;margin:0 0 10px';
  note.textContent = 'One archive of comma-separated files — fixtures and results, ' +
    'the table, every player and team box score, lineup stints, squads and awards. ' +
    'It contains exactly what your account can see.';
  host.appendChild(note);

  const opts2 = el('label', 'ep-micro');
  opts2.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 0 12px;color:var(--ink-3)';
  const pbp = el('input'); pbp.type = 'checkbox'; pbp.id = 'exPbp';
  opts2.appendChild(pbp);
  opts2.appendChild(document.createTextNode(
    'include the raw event log (much larger — every action of every game)'));
  host.appendChild(opts2);

  const row = el('div'); row.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
  const btn = el('button', 'ep-btn', 'Export this season');
  const prog = el('span', 'ep-micro'); prog.style.cssText = 'color:var(--ink-3)';
  row.appendChild(btn); row.appendChild(prog);
  host.appendChild(row);

  btn.onclick = async () => {
    const season = opts.season && opts.season();
    const comps = (opts.competitions && opts.competitions()) || [];
    if (!season) { say && say('Pick a season first.', true); return; }

    btn.disabled = true;
    const step = m => { prog.textContent = m; };
    try {
      const compIds = comps.map(c => c.id);
      const inComps = q => compIds.length ? q.in('competition_id', compIds) : q.eq('competition_id', '~none~');

      step('fixtures…');
      const games = compIds.length ? await pageAll(sb, 'games',
        'id,competition_id,home_team_id,away_team_id,tipoff_at,venue,venue_address,' +
        'capacity,attendance,officials,status,home_score,away_score,period,finalised_at',
        inComps, ['tipoff_at', 'id']) : [];
      const gameIds = games.map(g => g.id);
      const inGames = q => gameIds.length ? q.in('game_id', gameIds) : q.eq('game_id', '~none~');

      step('box scores…');
      const [pgs, tgs] = await Promise.all([
        gameIds.length ? pageAll(sb, 'player_game_stats', '*', inGames, ['game_id', 'player_id']) : [],
        gameIds.length ? pageAll(sb, 'team_game_stats',   '*', inGames, ['game_id', 'team_id']) : []
      ]);

      step('table, squads and awards…');
      const [standings, teamRows, awards, stints] = await Promise.all([
        compIds.length ? pageAll(sb, 'standings', '*', inComps, ['competition_id', 'team_id']) : [],
        pageAll(sb, 'competition_teams', 'competition_id,team_id,teams(name,short_name,slug)', inComps,
          ['competition_id', 'team_id']),
        pageAll(sb, 'season_awards', '*', q => q.eq('season_id', season.id), ['id']),
        gameIds.length ? pageAll(sb, 'lineup_stints', '*', inGames, ['game_id', 'id']) : []
      ]);

      /* Squads come through the roster rather than the players table directly,
         because a season export is "who played for whom", and the join is the
         thing that carries the shirt number. */
      step('rosters…');
      const teamIds = [...new Set(teamRows.map(r => r.team_id))];
      const roster = teamIds.length ? await pageAll(sb, 'roster_entries',
        'team_id,player_id,jersey,position,active,players(first_name,last_name,birth_year)',
        q => q.in('team_id', teamIds), ['team_id', 'player_id']) : [];

      const flatRoster = roster.map(r => ({
        team_id: r.team_id, player_id: r.player_id, jersey: r.jersey,
        position: r.position, active: r.active,
        first_name: (r.players || {}).first_name || '',
        last_name:  (r.players || {}).last_name  || '',
        birth_year: (r.players || {}).birth_year || ''
      }));
      const flatTeams = teamRows.map(r => ({
        competition_id: r.competition_id, team_id: r.team_id,
        name: (r.teams || {}).name || '', short_name: (r.teams || {}).short_name || '',
        slug: (r.teams || {}).slug || ''
      }));

      let events = [];
      if (pbp.checked && gameIds.length) {
        step('event log — this is the slow one…');
        events = await pageAll(sb, 'game_events',
          'game_id,seq,t,team,pid,period,clock,payload', inGames, ['game_id', 'seq']);
      }

      const base = slug(season.name) + '-export';
      const stamp = new Date();
      const files = [
        { name: base + '/README.txt', body:
            'Epinoia season export\n' +
            '=====================\n\n' +
            'Season      : ' + (season.name || '') + '\n' +
            'Competitions: ' + (comps.map(c => c.name).join(', ') || '—') + '\n' +
            'Generated   : ' + stamp.toISOString() + '\n\n' +
            'Files\n-----\n' +
            'games.csv               fixtures and results, with venue, capacity,\n' +
            '                        attendance and named match officials\n' +
            'standings.csv           the table as it currently stands\n' +
            'team_game_stats.csv     one row per team per game\n' +
            'player_game_stats.csv   one row per player per game\n' +
            'lineup_stints.csv       every combination that was on the floor, and for how long\n' +
            'competition_teams.csv   which clubs are in which competition\n' +
            'roster_entries.csv      squads, with shirt numbers\n' +
            'season_awards.csv       awards and the basis each was decided on\n' +
            (events.length ? 'game_events.csv         the raw append-only event log\n' : '') +
            '\nNotes\n-----\n' +
            'Every figure here is derived from the event log by the same engine the\n' +
            'site and the scoring app run, so these files agree with the pages they\n' +
            'came from.\n\n' +
            'This export contains exactly what the account that generated it is\n' +
            'permitted to read. Players recorded as minors without consent are\n' +
            'withheld by the database, here as everywhere else.\n' },
        { name: base + '/games.csv',             body: toCSV(games) },
        { name: base + '/standings.csv',         body: toCSV(standings) },
        { name: base + '/team_game_stats.csv',   body: toCSV(tgs) },
        { name: base + '/player_game_stats.csv', body: toCSV(pgs) },
        { name: base + '/lineup_stints.csv',     body: toCSV(stints) },
        { name: base + '/competition_teams.csv', body: toCSV(flatTeams) },
        { name: base + '/roster_entries.csv',    body: toCSV(flatRoster) },
        { name: base + '/season_awards.csv',     body: toCSV(awards) }
      ];
      if (events.length) files.push({ name: base + '/game_events.csv', body: toCSV(events) });

      step('packing…');
      const blob = zipStore(files, stamp);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = base + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      const kb = Math.max(1, Math.round(blob.size / 1024));
      step('');
      say && say('Exported ' + games.length + ' game' + (games.length === 1 ? '' : 's') +
                 ' — ' + files.length + ' files, ' + kb + ' kB.');
    } catch (err) {
      step('');
      say && say('Export failed: ' + ((err && err.message) || err), true);
    } finally {
      btn.disabled = false;
    }
  };
}

return { mount, toCSV, csvCell, zipStore, crc32, dosStamp, slug };
}));
