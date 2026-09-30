'use strict';
/* ============================================================================
   GRAPHICS FOR SOCIALS — the console's side of socialcard.js: every post the league's week has earned, ready.

   Nobody asks for these. The panel reads the season it is looking at and lays out what there is to post:

     THE WEEK      the week's results, the table after it, and the week coming up (each competition's own)
     EACH GAME     a final score and a player of the game for every game finished in the last seven days

   in the shape chosen above them (square, portrait or story), each with the words to post it with. One
   download each, or all of them in one ZIP. Every graphic is drawn in this browser from the rows below, so a
   game corrected in the console is a corrected graphic the next time the panel is opened; nothing is stored.

   WHAT IT READS, and only that: the season's competitions (admin.js), their games in the fortnight around
   today, the clubs in them, the finished games' quarter scores (team_game_stats.stats->perQ) and eleven
   numbers of each player line (never the whole stats blob: a round of games would be megabytes), the
   standings, and the league's Instagram handle for the footer.

   Loaded on first sight of the panel, not with the console: most visits never scroll to it.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaSocialGfx = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const DAY = 86400000;
const el = (t, c, x) => { const n = root.document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* the eleven numbers a graphic uses, read out of the stats blob by PostgREST (aliases avoid "or" and "to") */
const PLAYER_COLS = 'game_id,team_idx,' + [['pts', 'pts'], ['p2m', 'p2m'], ['p2a', 'p2a'], ['p3m', 'p3m'], ['p3a', 'p3a'],
  ['fta', 'fta'], ['ftm', 'ftm'], ['oreb', 'or'], ['dreb', 'dr'], ['ast', 'ast'], ['stl', 'stl'], ['blk', 'blk'], ['tov', 'to'],
  ['pf', 'pf'], ['pm', 'pm'], ['min', 'min']].map(([a, k]) => a + ':stats->' + k).join(',') + ',name:stats->adv->>name,num:stats->adv->>num';

/* a player row as socialcard.js reads it ({ team_idx, stats: {..., adv: {name, num}} }) */
function playerRow(r) {
  const s = { pts: r.pts, p2m: r.p2m, p2a: r.p2a, p3m: r.p3m, p3a: r.p3a, fta: r.fta, ftm: r.ftm, or: r.oreb, dr: r.dreb,
              ast: r.ast, stl: r.stl, blk: r.blk, to: r.tov, pf: r.pf, pm: r.pm, min: r.min, adv: { name: r.name || '', num: r.num } };
  return { game_id: r.game_id, team_idx: r.team_idx, stats: s };
}

const handleOf = v => {
  const s = String(v || '').trim();
  const m = /instagram\.com\/([A-Za-z0-9_.]+)/i.exec(s);
  return (m ? m[1] : s.replace(/^@/, '')).replace(/[^A-Za-z0-9_.]/g, '') || '';
};

function rangeLabel(a, b) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = x => x.getUTCDate(), mo = x => M[x.getUTCMonth()], y = x => x.getUTCFullYear();
  if (y(a) !== y(b)) return d(a) + ' ' + mo(a) + ' ' + y(a) + ' – ' + d(b) + ' ' + mo(b) + ' ' + y(b);
  if (mo(a) !== mo(b)) return d(a) + ' ' + mo(a) + ' – ' + d(b) + ' ' + mo(b) + ' ' + y(b);
  return d(a) + '–' + d(b) + ' ' + mo(b) + ' ' + y(b);
}

/* ---------------------------------------------------------------- reading --- */
/* Everything the graphics need, in five reads (and one more per thousand games). Pure of the DOM: the test
   drives it with a stub client. */
async function read(sb, league, comps, now) {
  const t = now || new Date();
  const since = new Date(t.getTime() - 7 * DAY), until = new Date(t.getTime() + 7 * DAY);
  const ids = comps.map(c => c.id);
  const out = { league: null, comps, finals: [], upcoming: [], teams: new Map(), perQ: new Map(), players: new Map(), standings: [],
                since, until, now: t };
  const lg = await sb.from('leagues').select('id,name,slug,timezone,colour_a,colour_b,logo_path').eq('id', league.id).maybeSingle();
  const L = lg && lg.data || league;
  let handle = '';
  try {
    const so = await sb.rpc('league_socials_admin', { p_league: league.id });
    const row = Array.isArray(so && so.data) ? so.data[0] : so && so.data;
    handle = handleOf(row && row.instagram);
  } catch (_) { /* no handle: the footer names the league */ }
  /* the league's own colours and logo: the graphics are the league's, not the platform's */
  out.league = { id: L.id, name: L.name || league.name, slug: L.slug || league.slug, timezone: L.timezone || 'UTC',
                 colour: L.colour_a || null, colour2: L.colour_b || null, logoPath: L.logo_path || null, handle };
  if (!ids.length) return out;
  const games = await sb.from('games')
    .select('id,competition_id,tipoff_at,venue,status,home_score,away_score,home_team_id,away_team_id')
    .in('competition_id', ids).gte('tipoff_at', since.toISOString()).lt('tipoff_at', until.toISOString())
    .order('tipoff_at', { ascending: true }).limit(1000);
  if (games.error) throw games.error;
  (games.data || []).forEach(g => {
    if (g.status === 'final' && new Date(g.tipoff_at) <= t) out.finals.push(g);
    else if ((g.status === 'scheduled' || !g.status) && new Date(g.tipoff_at) > t) out.upcoming.push(g);
  });
  const st = await sb.from('standings').select('competition_id,team_id,rank,gp,w,l,league_points,diff,streak,group_name')
    .in('competition_id', ids);
  out.standings = (st && st.data) || [];
  const teamIds = [...new Set(out.finals.concat(out.upcoming).flatMap(g => [g.home_team_id, g.away_team_id])
    .concat(out.standings.map(s => s.team_id)).filter(Boolean))];
  for (let i = 0; i < teamIds.length; i += 200) {
    const tm = await sb.from('teams').select('id,name,short_name,colour,colour_2,logo_path').in('id', teamIds.slice(i, i + 200));
    ((tm && tm.data) || []).forEach(x => out.teams.set(x.id, x));
  }
  const fin = out.finals.map(g => g.id);
  for (let i = 0; i < fin.length; i += 100) {
    const chunk = fin.slice(i, i + 100);
    const [q, p] = await Promise.all([
      sb.from('team_game_stats').select('game_id,team_idx,perQ:stats->perQ').in('game_id', chunk),
      sb.from('player_game_stats').select(PLAYER_COLS).in('game_id', chunk)
    ]);
    ((q && q.data) || []).forEach(r => {
      if (!out.perQ.has(r.game_id)) out.perQ.set(r.game_id, [null, null]);
      out.perQ.get(r.game_id)[r.team_idx] = r.perQ || null;
    });
    ((p && p.data) || []).forEach(r => {
      if (!out.players.has(r.game_id)) out.players.set(r.game_id, []);
      out.players.get(r.game_id).push(playerRow(r));
    });
  }
  return out;
}

/* ---------------------------------------------------------------- the list --- */
/* What there is to post, for one shape: [{ group, title, model }] */
function items(data, size, crestOf) {
  const SC = root.EpinoiaSocialCard;
  const L = Object.assign({}, data.league, { logoUrl: crestOf && data.league.logoPath ? crestOf({ logo_path: data.league.logoPath }) : null });
  const team = id => {
    const t = data.teams.get(id) || { name: '?' };
    return Object.assign({}, t, { crestUrl: crestOf ? crestOf(t) : null });
  };
  const out = [];
  const range = rangeLabel(data.since, data.now), ahead = rangeLabel(data.now, data.until);
  const asOf = rangeLabel(data.now, data.now).replace(/^\d+–/, '');
  data.comps.forEach(c => {
    const fin = data.finals.filter(g => g.competition_id === c.id);
    const up = data.upcoming.filter(g => g.competition_id === c.id);
    const stand = data.standings.filter(s => s.competition_id === c.id);
    const comp = data.comps.length > 1 ? c.name : (c.name || L.name);
    if (fin.length) {
      SC.week({ games: fin.map(g => Object.assign({}, g, { home: team(g.home_team_id), away: team(g.away_team_id) })), league: L, comp, range }, size)
        .forEach(m => out.push({ group: 'week', title: 'Results' + (m.pages > 1 ? ' ' + m.page + '/' + m.pages : '') + (data.comps.length > 1 ? ' · ' + c.name : ''), model: m }));
    }
    if (stand.length && (!c.kind || c.kind === 'league' || c.kind === 'group')) {
      SC.table({ standings: stand.map(s => Object.assign({}, s, { team: team(s.team_id) })), league: L, comp, asOf }, size)
        .forEach(m => out.push({ group: 'week', title: (m.group ? m.group + ' · ' : '') + 'The table' + (m.pages > 1 ? ' ' + m.page + '/' + m.pages : '') +
          (data.comps.length > 1 ? ' · ' + c.name : ''), model: m }));
    }
    if (up.length) {
      SC.fixtures({ games: up.map(g => Object.assign({}, g, { home: team(g.home_team_id), away: team(g.away_team_id) })), league: L, comp, range: ahead }, size)
        .forEach(m => out.push({ group: 'week', title: 'Coming up' + (m.pages > 1 ? ' ' + m.page + '/' + m.pages : '') + (data.comps.length > 1 ? ' · ' + c.name : ''), model: m }));
    }
  });
  data.finals.slice().reverse().forEach(g => {
    const c = data.comps.find(x => x.id === g.competition_id) || {};
    const comp = data.comps.length > 1 ? c.name : (c.name || L.name);
    const base = { game: g, home: team(g.home_team_id), away: team(g.away_team_id), players: data.players.get(g.id) || [],
                   perQ: data.perQ.get(g.id), league: L, comp };
    const r = SC.result(base);
    out.push({ group: 'games', title: r.home.name + ' ' + r.home.score + '–' + r.away.score + ' ' + r.away.name, model: r });
    const p = SC.performer(base);
    if (p) out.push({ group: 'games', title: 'Player of the game · ' + p.player.name, model: p });
  });
  return out;
}

/* ------------------------------------------------------------------ view --- */
let current = null;

function mount(o) {
  const host = typeof o.host === 'string' ? root.document.querySelector(o.host) : o.host;
  if (!host) return null;
  if (host.__sgStop) host.__sgStop();                 // a league switch re-mounts: the old panel's watcher goes
  const panel = { host, o, size: 'portrait', data: null, busy: false, started: false };
  current = panel;
  host.textContent = '';
  host.appendChild(el('div', 'fmt-h', 'Graphics for socials'));
  host.appendChild(el('p', 'empty',
    'Made for you from every game finished in the last seven days, the table and the week ahead — nothing to design. ' +
    'Pick the shape, check each one, download it and post it with the words beneath. Nothing is posted from here, ' +
    'and nothing is stored: a game corrected in the console is a corrected graphic when this panel is opened again.'));
  const body = el('div', 'sg');
  host.appendChild(body);
  const start = () => { if (!panel.data && !panel.busy) { panel.started = true; load(panel, body); } };
  if (typeof root.IntersectionObserver === 'function') {
    const io = new root.IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: '400px' });
    io.observe(host);
    host.__sgStop = () => io.disconnect();
  } else start();
  return panel;
}

/* a season switch: read again for the new one - but only a panel already read; one nobody has scrolled to yet
   reads the season on screen when it is first seen */
function refresh() {
  if (!current || !current.started) return;
  current.data = null;
  const body = current.host.querySelector('.sg');
  if (body) load(current, body);
}

async function load(panel, body) {
  const o = panel.o;
  const league = typeof o.league === 'function' ? o.league() : o.league;
  const comps = (typeof o.comps === 'function' ? o.comps() : o.comps) || [];
  if (!league) return;
  panel.busy = true;
  body.textContent = '';
  body.appendChild(el('div', 'empty', 'Reading the week…'));
  try {
    panel.data = await read(o.sb, league, comps);
    panel.leagueId = league.id;
  } catch (e) {
    body.textContent = '';
    body.appendChild(el('div', 'empty', 'The week could not be read: ' + (e && e.message || e)));
    panel.busy = false;
    return;
  }
  panel.busy = false;
  draw(panel, body);
}

const crestOf = t => (t && t.logo_path && typeof root.epinoiaLogoUrl === 'function' ? root.epinoiaLogoUrl(t.logo_path, 256) : null);

function draw(panel, body) {
  const SC = root.EpinoiaSocialCard;
  body.textContent = '';
  if (!SC || !root.EpinoiaReportCard) { body.appendChild(el('div', 'empty', 'The graphics could not be loaded.')); return; }
  const list = items(panel.data, panel.size, crestOf);
  const bar = el('div', 'row sg-bar');
  Object.keys(SC.SIZES).forEach(k => {
    const b = el('button', 'ep-chip' + (k === panel.size ? ' on' : ''), SC.SIZES[k].label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(k === panel.size));
    b.addEventListener('click', () => { panel.size = k; draw(panel, body); });
    bar.appendChild(b);
  });
  const all = el('button', 'ep-btn mini', 'download all (' + list.length + ') as a ZIP');
  all.type = 'button';
  all.disabled = !list.length;
  all.addEventListener('click', () => downloadAll(panel, list, all));
  bar.appendChild(all);
  const again = el('button', 'ep-btn mini', 'read again');
  again.type = 'button';
  again.addEventListener('click', () => load(panel, body));
  bar.appendChild(again);
  body.appendChild(bar);
  if (!list.length) {
    body.appendChild(el('div', 'empty', 'Nothing to post yet: no game has finished in the last seven days, and there is no table or week ahead ' +
      'in the competitions of the season chosen above.'));
    return;
  }
  [['week', 'The week'], ['games', 'Each game']].forEach(([g, label]) => {
    const mine = list.filter(x => x.group === g);
    if (!mine.length) return;
    body.appendChild(el('div', 'fmt-h', label));
    const grid = el('div', 'sg-grid');
    mine.forEach(it => grid.appendChild(card(panel, it)));
    body.appendChild(grid);
  });
}

function card(panel, it) {
  const SC = root.EpinoiaSocialCard;
  const box = el('div', 'sg-card');
  const thumb = el('div', 'sg-thumb');
  thumb.style.aspectRatio = SC.SIZES[panel.size].w + ' / ' + SC.SIZES[panel.size].h;
  box.appendChild(thumb);
  box.appendChild(el('div', 'nm', it.title));
  const acts = el('div', 'sg-acts');
  const dl = el('button', 'ep-btn mini', 'download');
  dl.type = 'button';
  dl.addEventListener('click', async () => {
    dl.disabled = true; dl.textContent = 'drawing…';
    try { save(await SC.png(it.model, { size: panel.size, scale: 1 }), SC.filename(it.model, panel.size)); dl.textContent = 'download'; }
    catch (e) { dl.textContent = 'could not draw it'; setTimeout(() => { dl.textContent = 'download'; }, 4000); }
    dl.disabled = false;
  });
  const cp = el('button', 'ep-btn mini', 'copy caption');
  cp.type = 'button';
  const words = SC.caption(it.model);
  cp.addEventListener('click', async () => {
    try { await root.navigator.clipboard.writeText(words); cp.textContent = 'copied'; }
    catch (_) { ta.select(); cp.textContent = 'select and copy below'; }
    setTimeout(() => { cp.textContent = 'copy caption'; }, 2500);
  });
  acts.append(dl, cp);
  box.appendChild(acts);
  const ta = el('textarea', 'ep-input sg-cap');
  ta.value = words;
  ta.readOnly = true;
  ta.rows = 4;
  box.appendChild(ta);
  /* the thumbnail is drawn when the card comes into view: a busy week is forty graphics */
  const paint = async () => {
    try {
      const c = await SC.canvas(it.model, { size: panel.size, scale: 0.25 });
      c.className = 'sg-img';
      thumb.appendChild(c);
    } catch (_) { thumb.appendChild(el('div', 'empty', 'could not draw')); }
  };
  if (typeof root.IntersectionObserver === 'function') {
    const io = new root.IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); paint(); } }, { rootMargin: '300px' });
    io.observe(thumb);
  } else paint();
  return box;
}

function save(blob, name) {
  const url = root.URL.createObjectURL(blob);
  const a = root.document.createElement('a');
  a.href = url; a.download = name;
  root.document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => root.URL.revokeObjectURL(url), 30000);
}

async function downloadAll(panel, list, btn) {
  const SC = root.EpinoiaSocialCard;
  const label = btn.textContent;
  btn.disabled = true;
  try {
    const files = [];
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
      btn.textContent = 'drawing ' + (i + 1) + ' of ' + list.length + '…';
      const it = list[i];
      let name = String(i + 1).padStart(2, '0') + '-' + SC.filename(it.model, panel.size);
      while (seen.has(name)) name = name.replace(/\.png$/, '-b.png');
      seen.add(name);
      const blob = await SC.png(it.model, { size: panel.size, scale: 1 });
      files.push({ name, bytes: new Uint8Array(await blob.arrayBuffer()) });
      files.push({ name: name.replace(/\.png$/, '.txt'), bytes: new TextEncoder().encode(SC.caption(it.model) + '\n') });
    }
    const L = panel.data.league;
    const day = new Date().toISOString().slice(0, 10);
    save(new Blob([SC.zip(files)], { type: 'application/zip' }), SC.slug(L.slug || L.name) + '-socials-' + panel.size + '-' + day + '.zip');
    btn.textContent = label;
  } catch (e) {
    btn.textContent = 'could not make the ZIP';
    setTimeout(() => { btn.textContent = label; }, 4000);
  }
  btn.disabled = false;
}

return { mount, refresh, read, items, playerRow, handleOf, rangeLabel, PLAYER_COLS };
}));
