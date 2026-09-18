'use strict';
/* ============================================================================
   Player profile.

   Reached from every place a player's name appears — box score, leaders, the
   season table, a team's roster — by id, so a rename never breaks the link.
   ?p= accepts either the uuid or the slug; ids are what the tables link with
   and slugs are what a person would type.

   A minor is withheld by RLS, so this page simply gets nothing back for one
   and says so. It never has to remember to check.
   ============================================================================ */

const CFG = window.EPINOIA_CONFIG;
const T = window.EpinoiaTable;
const want = new URLSearchParams(location.search).get('p') || '';
const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(want);

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const n1 = (v, d = '—') => (v == null ? d : Number(v).toFixed(1));
/* 1st, 2nd, 3rd, 4th … 11th-13th are the exceptions that catch naive code */
const ord = n => { const v = Math.round(n), t = v % 100;
  if (t >= 11 && t <= 13) return v + 'th';
  return v + ({ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'); };

/* ---------------------------------------------------------------- access ---
   WHAT THIS VIEWER MAY SEE (docs/memberships.md), decided once, from the league of the
   player's current club, before the first gated section is drawn, and handed down as flags.
   Both answers start open and stay open unless access.js is on the page AND has an answer:
   analytics fail open, and the members-only card needs a known "cannot view". A free agent
   has no league to ask about, so his page is never gated. */
let ANALYTICS_LOCKED = false;
let ACCESS_LEAGUE = { id: null, slug: '' };
const accessTeaser = o => { const A = window.EpinoiaAccess;
  return A && typeof A.teaserHTML === 'function'
    ? A.teaserHTML(Object.assign({ leagueSlug: ACCESS_LEAGUE.slug }, o)) : ''; };

/* A MEMBERS-ONLY LEAGUE IS REFUSED BY ROW-LEVEL SECURITY, so a member's reads say who is
   asking: access.js hands back a token only for a members-only league this viewer may see and
   {} otherwise, so an open league's request is exactly what it was. A 401 with a token on it
   is a token the server stopped accepting: asked once more anonymously, as it always was. */
async function api(p, anon) {
  const headers = { apikey: CFG.supabaseAnonKey, Accept: 'application/json' };
  const A = window.EpinoiaAccess;
  if (!anon && A && typeof A.authHeaders === 'function') {
    try { Object.assign(headers, A.authHeaders() || {}); } catch (_) { /* anonymous */ }
  }
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`, { cache: 'no-store', headers });
  if (r.status === 401 && headers.Authorization && !anon) return api(p, true);
  if (!r.ok) throw new Error(r.status + ' on ' + p.split('?')[0]);
  return r.json();
}

function fail(msg) {
  $('#seasons').textContent = '';
  $('#seasons').appendChild(el('div', 'empty', msg));
  $('#log').textContent = '';
}

/* --------------------------------------------------------------- identity --- */
function paintIdentity(pl, entry, team) {
  const name = ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim();
  $('#name').textContent = name;
  document.title = name + ' · Epinoia';
  /* follow the player: his line after every game */
  if (window.EpinoiaFollow && pl.id) {
    const fb = window.EpinoiaFollow.bell('player', pl.id, { cls: 'big', label: 'follow' });
    fb.classList.add('lbl'); $('#name').insertAdjacentElement('afterend', fb);
  }

  const colour = (team && team.colour) || '#93f2bf';
  document.documentElement.style.setProperty('--team-a', colour);
  /* THE PLAYER IN HIS CLUB'S COLOURS. A club with colours of its own (read from its crest,
     or chosen) dresses the page -- body.themed in the stylesheet; a club still on the site's
     default mint leaves the page in the site's own. */
  const TC = window.EpinoiaTeamColour;
  const themed = !!(TC && team && team.colour && String(team.colour).toLowerCase() !== '#93f2bf' &&
                    TC.apply(document.documentElement, team.colour, team.colour_2));
  document.body.classList.toggle('themed', themed);

  /* Photo. media rows are only readable once approved, and a minor's needs
     recorded guardian consent — both enforced in the database, so if a photo
     comes back it is publishable. Initials stand in when it does not. */
  const box = $('#photo');
  /* An approved upload wins over a pasted URL: it has been through moderation
     and the consent check, and it is served from our own CDN rather than
     whatever host someone linked. photo_url stays as the simple fallback. */
  const stored = pl.__photoPath
    ? window.EpinoiaUpload.publicUrl(CFG, pl.__photoPath) : null;
  if (stored || pl.photo_url) {
    const img = document.createElement('img');
    img.src = stored || pl.photo_url;
    img.alt = name;
    img.addEventListener('error', () => img.remove());   // never a broken frame
    box.textContent = '';
    box.appendChild(img);
  } else {
    $('#ini').textContent = ((pl.first_name || '?')[0] + (pl.last_name || '')[0] || '')
      .toUpperCase() || '—';
  }
  if (entry && entry.jersey) {
    const num = el('span', 'num', entry.jersey);
    if (!themed) num.style.background = colour;
    box.appendChild(num);
  }

  const sub = $('#sub'); sub.textContent = '';
  if (team && team.name) {
    const a = el('a', null, team.name);
    a.href = '../t/?t=' + encodeURIComponent(team.slug || '');
    sub.appendChild(a);
    $('#teamLink').href = a.href;
  } else {
    sub.appendChild(el('span', null, 'Free agent'));
    $('#teamLink').style.display = 'none';
  }
  if (entry && entry.position) sub.appendChild(el('span', 'pos-chip', entry.position));
  if (pl.birth_year) sub.appendChild(el('span', null, 'born ' + pl.birth_year));
  $('#ctx').textContent = [(team || {}).name, name].filter(Boolean).join(' · ');
}

/* --------------------------------------------------------------- released ---
   THE ONE THING THE INJURY REPORT CANNOT WORK OUT. It reads who is missing
   straight out of the box scores (epinoia/injuries.js), which is right for an
   injury and wrong for a player who has simply gone: he will never appear
   again, so he would sit on the wire and on every preview's question marks
   forever. So the club says so, here or on the wire itself — the same
   set_player_released (0132), and the same row either way.

   Only for whoever manages the club, asked of the database rather than assumed,
   and only ever asked when somebody is signed in. It is a toggle: a player who
   comes back is un-released and the report picks him up the moment he plays. */
async function offerRelease(pl, team) {
  if (!pl || !pl.id || !team || !team.id) return;
  /* a reader who is signed out never loads the SDK for this */
  if (!(window.epinoiaMaybeSignedIn && window.epinoiaMaybeSignedIn())) return;
  const sb = window.epinoiaClientReady ? await window.epinoiaClientReady() : null;
  if (!sb) return;
  let released = false;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return;
    const { data: mine } = await sb.rpc('is_team_manager', { p_team: team.id });
    if (!mine) return;
    const rows = await api(`player_releases?team_id=eq.${team.id}&player_id=eq.${pl.id}&select=player_id&limit=1`);
    released = !!(rows && rows.length);
  } catch (_) { return; }               // no button, which is the safe way to be wrong

  const sub = $('#sub');
  const b = el('button', 'wr-rel' + (released ? ' on' : ''), released ? 'released' : 'mark released');
  b.type = 'button';
  const title = () => b.classList.contains('on')
    ? 'Released from ' + (team.name || 'this club') + ' — press to put them back on the injury report'
    : 'Mark as released from ' + (team.name || 'this club') + ' — they leave the injury report and the game previews';
  b.title = title();
  b.addEventListener('click', async () => {
    const want = !b.classList.contains('on');
    b.disabled = true;
    try {
      const { error } = await sb.rpc('set_player_released',
        { p_team: team.id, p_player: pl.id, p_released: want, p_note: '' });
      if (error) throw error;
      b.classList.toggle('on', want);
      b.textContent = want ? 'released' : 'mark released';
      b.title = title();
    } catch (err) {
      b.title = 'Could not do that: ' + ((err && err.message) || err);
    } finally { b.disabled = false; }
  });
  sub.appendChild(b);
}

function paintTiles(s) {
  const host = $('#tiles'); host.textContent = '';
  if (!s) {
    host.appendChild(el('div', 'empty', 'No finalised games yet.'));
    return;
  }
  [['games', s.gp, false], ['pts', n1(s.ppg), true], ['reb', n1(s.rpg), true],
   ['ast', n1(s.apg), true], ['mins', n1(s.mpg), false],
   ['ts%', n1(s.ts), false], ['usg%', n1(s.usg), false],
   ['on-off', s.diff_net == null ? '—' : (s.diff_net > 0 ? '+' : '') + n1(s.diff_net), true]]
    .forEach(([l, v, hi]) => {
      const d = el('div', 'tile' + (hi ? ' hi' : ''));
      d.append(el('div', 'v', v), el('div', 'l', l));
      host.appendChild(d);
    });
}

/* ------------------------------------------------------------ percentile --- */
/* index_9's profile bars. Each row is where this player ranks in the
   competition for that statistic, which turns a number nobody has a feel for
   ("11.4 AST%") into one anybody can read ("83rd percentile").

   Rates only. Ranking a total would just rank minutes played. */
/* [key, label]
   Every row is a percentile bar against the rest of the competition.

   Each shooting rate is followed by its OWN VOLUME ROW, ranked the same way.
   A rate without its volume is unreadable — 60% at the rim means one thing on
   eight attempts a night and nothing at all on one — but a volume printed as a
   bare number beside the rate is barely better, because nobody knows whether
   four rim attempts a game is a lot. Ranked against the league, it answers
   both questions at once: how often he goes there, and how he does when he
   gets there. Those are different skills and they deserve different bars. */
const BAR_GROUPS = [
  ['scoring',    [['ppg','PTS / GAME'],['ts','TS%'],['efg','eFG%'],['usg','USAGE'],['ftr','FT RATE'],
                  ['ev_ast_pts_sh','ASSISTED%']]],
  /* ASSISTED% under each distance: of the shots he MADE there, how many came off a pass.
     Only a make can be assisted -- nobody records the pass before a miss -- so it is a
     share of makes, and the row above it is that distance's accuracy over every attempt.
     ASSISTED% in scoring is the same question of his points: how much of what he scored
     came off somebody's pass, free throws included in the total. */
  ['shooting',   [['rim_pct','RIM%'],   ['rim_apg','RIM ATT / G'], ['ev_rim_astp','RIM ASSISTED%'],
                  ['mid_pct','MID%'],   ['mid_apg','MID ATT / G'], ['ev_mid_astp','MID ASSISTED%'],
                  ['p3_pct','3P%'],     ['p3_apg','3P ATT / G'],   ['ev_p3_astp','3P ASSISTED%'],
                  ['ft_pct','FT%'],     ['ft_apg','FT ATT / G']]],
  ['playmaking', [['ast_pct','ASSIST%'],['au','AST / USG'],['ast_to','AST / TO'],
                  ['tov_pct','TURNOVER%']]],
  ['rebounding', [['oreb_pct','OREB%'],['dreb_pct','DREB%'],['trb_pct','TOTAL REB%']]],
  ['defence',    [['stl_pct','STEAL%'],['blk_pct','BLOCK%'],['diff_vs_efg','OPP eFG% ±']]],
  /* on/off as differentials: how much better the team is in each with him on */
  ['impact',     [['diff_net','NET ±'],['diff_ortg','ORTG ±'],['diff_drtg','DRTG ±'],
                  ['diff_efg','eFG% ±'],['diff_tov','TOV% ±'],['diff_oreb','OREB% ±']]]
];
/* the ones where a smaller number is the better performance */
/* ASSISTED% RANKS THE OTHER WAY UP. Every other bar here reads high-is-better, but a
   basket somebody else created is the easier one to make: between two players shooting
   the same percentage from the same distance, the one doing it off his own dribble is
   the rarer player. So the LEAST assisted scoring takes the top percentile, and the bar
   fills for the share he created himself. (For a CLUB the opposite is true — ball
   movement — which is why this list is the player profile's alone.) */
const BAR_LOW = ['tov_pct', 'diff_vs_efg', 'diff_drtg', 'diff_tov',
                 'ev_ast_pts_sh', 'ev_rim_astp', 'ev_mid_astp', 'ev_p3_astp'];

/* ADJUSTED FOR POSITION: the same bars, ranked inside his own position group.
   A centre's assist rate against every player in the competition says only that he
   is a centre; against other centres it says whether he passes. The group comes
   from season.js positionGroup -- the calculated position corrected by the listed
   one -- and the choice is remembered for the next profile opened. */
let barsByPos = false;
try { barsByPos = localStorage.getItem('epinoia_bars_pos') === '1'; } catch (_) { /* default */ }

function paintBars(mine, field) {
  const host = $('#bars'); host.textContent = '';
  if (!mine || field.length < 3) {
    host.appendChild(el('div', 'empty',
      'Percentiles appear once enough of the competition has played.'));
    return;
  }
  const SE = window.EpinoiaSeason;
  /* PREMIUM BARS ARE LEFT OUT, not drawn empty: an empty track reads as a bottom percentile.
     The catalogue says which keys they are (today the assisted shares, from the events
     splits); the group they came from says so in one line instead. */
  const CAT = ANALYTICS_LOCKED && window.EpinoiaAccess ? window.EpinoiaAccess.CATALOGUE : null;
  const premiumBar = k => !!CAT && (typeof CAT.barKeys === 'function' ? !!CAT.barKeys(k)
    : Array.isArray(CAT.barKeys) && CAT.barKeys.indexOf(k) !== -1);
  const groups = BAR_GROUPS.map(([title, rows]) =>
    [title, rows.filter(r => !premiumBar(r[0])), rows.some(r => premiumBar(r[0]))]);
  const keys = groups.flatMap(([, rows]) => rows.map(r => r[0]));
  const posMap = barsByPos && SE.positionGroups ? SE.positionGroups(field) : null;
  const group = posMap ? (posMap.get(mine.id) || null) : null;
  const ranks = SE.percentiles(field, keys, BAR_LOW, group ? (r => posMap.get(r.id) || null) : null);
  const pool = group ? field.filter(r => posMap.get(r.id) === group) : field;
  $('#barNote').textContent = 'vs ' + pool.length + ' ' +
    (group ? (SE.positionLabel ? SE.positionLabel(group) : 'players') : 'players');

  /* the switch sits above the bars, where the note it changes is */
  const sw = el('div', 'barswitch');
  const btn = el('button', 'ep-btn' + (barsByPos ? ' pri' : ''), 'adjust for position');
  btn.type = 'button';
  btn.title = group || !barsByPos
    ? 'rank him against players of his own position rather than the whole competition'
    : 'his position could not be worked out, so the bars stay against everybody';
  btn.addEventListener('click', () => {
    barsByPos = !barsByPos;
    try { localStorage.setItem('epinoia_bars_pos', barsByPos ? '1' : '0'); } catch (_) { /* fine */ }
    paintBars(mine, field);
  });
  sw.appendChild(btn);
  if (barsByPos && !group) sw.appendChild(el('span', 'barswitch-note', 'no position for this player'));
  host.appendChild(sw);

  const wrap = el('div', 'bars');
  groups.forEach(([title, rows, held]) => {
    wrap.appendChild(el('div', 'bargroup', title));
    rows.forEach(([k, label]) => {
      const v = mine[k];
      const p = (ranks.get(k) || new Map()).get(mine.id);
      const row = el('div', 'barrow');

      /* volume rows are visibly subordinate to the rate they belong to, so
         the group still reads as four shot types rather than eight statistics */
      const isVol = /ATT \/ G$/.test(label);
      if (isVol) row.classList.add('volrow');
      row.appendChild(el('div', 'bl', label));

      const track = el('div', 'bt');
      const fill = el('i');
      fill.style.width = (p == null ? 0 : Math.max(2, p)) + '%';
      /* the same five-band scale the table's heat map uses, in --good rather than --lume: this
         page wears the club's colours (--lume is its ink), and a good number must stay green */
      fill.style.background = p == null ? 'var(--rule-2)'
        : p >= 75 ? 'var(--good)' : p >= 50 ? 'color-mix(in oklch,var(--good) 70%,var(--amber))'
        : p >= 25 ? 'var(--amber)' : 'var(--flare)';
      track.appendChild(fill);
      row.appendChild(track);

      const dp = (k === 'ast_to' || k === 'au') ? 2 : 1;
      /* a differential carries its sign: +12.5 is a claim, 12.5 is a number */
      const val = el('div', 'bv', v == null ? '—' : ((String(k).startsWith('diff_') && Number(v) > 0 ? '+' : '') + Number(v).toFixed(dp)));
      if (p != null) val.appendChild(el('div', 'bp', ord(p)));
      row.appendChild(val);
      wrap.appendChild(row);
    });
    if (held) {
      const line = el('div', 'barteaser');
      line.innerHTML = accessTeaser({ compact: true, title: 'Assisted and self-created scoring',
        lines: ['How much of the scoring came off a pass, by distance — part of Epinoia analytics.'] });
      wrap.appendChild(line);
    }
  });
  host.appendChild(wrap);
}


/* Every competition this player has appeared in, newest first, aggregated
   through the shared intermediary.

   Bounded at eight: each season is a full aggregation, and a profile that
   takes ten seconds to draw because somebody played for fifteen years is worse
   than one that shows the last eight and says so. */
const CAREER_MAX = 8;

async function paintCareer(pl, current, team) {
  const D = window.EpinoiaData;
  const host = $('#seasons');
  host.textContent = '';

  let appearances = [];
  try {
    appearances = await D.all(`player_season_stats?player_id=eq.${pl.id}` +
      `&select=competition_id,season_id,team_id,gp`);
  } catch (e) { console.warn('[career]', e); }

  if (!appearances.length) {
    if (current) {
      /* the intermediary found a season the view has not caught up with */
      $('#seasonNote').textContent = current.gp + (current.gp === 1 ? ' game' : ' games');
      return renderCareerRows(host, [Object.assign({}, current, {
        name: ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim(),
        teamName: (team && team.short_name) || '', teamShort: (team && team.short_name) || '',
        colour: (team && team.colour) || null
      })], pl);
    }
    host.appendChild(el('div', 'empty',
      'No finalised games yet — a season line appears once one is played.'));
    return;
  }

  /* name the seasons and competitions so a row says which year it was */
  const compIds = [...new Set(appearances.map(a => a.competition_id).filter(Boolean))];
  let comps = [];
  try {
    comps = await D.all(`competitions?id=in.(${compIds.join(',')})` +
      `&select=id,name,seasons(id,name,starts_on,leagues(name,slug))`);
  } catch (e) { console.warn('[career comps]', e); }
  const compById = new Map(comps.map(c => [c.id, c]));

  /* newest first, by the season's start date */
  const ordered = compIds.slice().sort((a, b) => {
    const sa = (compById.get(a) || {}).seasons || {};
    const sb = (compById.get(b) || {}).seasons || {};
    return String(sb.starts_on || '').localeCompare(String(sa.starts_on || ''));
  });
  const shown = ordered.slice(0, CAREER_MAX);

  const rows = [];
  for (const cid of shown) {
    try {
      const S = await D.season(cid);
      const row = S.players.find(r => r.id === pl.id);
      if (!row) continue;
      const c = compById.get(cid) || {};
      const sn = c.seasons || {};
      rows.push(Object.assign({}, row, {
        /* the name column carries the season, since every row is the same
           person and repeating their name down the table says nothing */
        name: sn.name || c.name || '—',
        teamName: (team && team.short_name) || '',
        teamShort: (team && team.short_name) || '',
        colour: (team && team.colour) || null,
        _comp: c.name || '', _league: (sn.leagues && sn.leagues.name) || ''
      }));
    } catch (e) { console.warn('[career season]', cid, e); }
  }

  if (!rows.length) {
    host.appendChild(el('div', 'empty', 'No finalised games yet.'));
    return;
  }

  const games = rows.reduce((n, r) => n + (r.gp || 0), 0);
  $('#seasonNote').textContent = rows.length +
    (rows.length === 1 ? ' season · ' : ' seasons · ') + games +
    (games === 1 ? ' game' : ' games') +
    (ordered.length > shown.length ? ' · showing the last ' + CAREER_MAX : '');

  renderCareerRows(host, rows, pl);
}

function renderCareerRows(host, rows, pl) {
  window.EpinoiaTable.render({
    host: '#seasons', kind: 'player', sortKey: 'gp', showMinGames: false, heat: false,
    filename: (pl.slug || 'player') + '-career',
    nameLabel: 'SEASON',
    /* the table drops the premium columns itself when this league's analytics are locked */
    leagueId: ACCESS_LEAGUE.id, leagueSlug: ACCESS_LEAGUE.slug,
    rows
  });
}

/* -------------------------------------------------------------- game log --- */
function paintLog(rows) {
  const host = $('#log'); host.textContent = '';
  if (!rows.length) {
    host.appendChild(el('div', 'empty', 'No games yet.'));
    return;
  }
  $('#logNote').textContent = rows.length + (rows.length === 1 ? ' game' : ' games');

  const wrap = el('div', 'ft-wrap');
  const t = el('table', 'ft');
  const head = ['DATE', 'OPP', 'RES', 'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PF', 'FG', '3PT', 'FT', '+/-'];
  const thead = el('thead'), hr = el('tr');
  head.forEach((h, i) => hr.appendChild(el('th', i < 2 ? 'stick c' + i : '', h)));
  thead.appendChild(hr); t.appendChild(thead);

  const tb = el('tbody');
  rows.forEach(r => {
    const s = r.stats || {};
    const g = r.games || {};
    const tr = el('tr');
    const date = g.tipoff_at
      ? new Date(g.tipoff_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—';

    const d0 = el('td', 'stick c0', date); tr.appendChild(d0);

    const oppTd = el('td', 'stick c1');
    const cell = el('div', 'ft-name');
    if (r.__opp) {
      const a = el('a', null, (r.__home ? 'v ' : '@ ') + r.__opp.name);
      a.href = '../t/?t=' + encodeURIComponent(r.__opp.slug || '');
      cell.appendChild(a);
    } else cell.appendChild(el('span', null, '—'));
    oppTd.appendChild(cell); tr.appendChild(oppTd);

    const res = el('td', null, r.__res || '');
    if (r.__res && r.__res.startsWith('W')) res.classList.add('pos');
    if (r.__res && r.__res.startsWith('L')) res.classList.add('neg');
    tr.appendChild(res);

    const boxLink = '../game/?g=' + encodeURIComponent(r.game_id) + '&mode=supabase';
    [Math.round((s.min || 0) / 60000) + "'", s.pts, (s.or || 0) + (s.dr || 0), s.ast,
     s.stl, s.blk, s.to, s.pf,
     `${(s.p2m || 0) + (s.p3m || 0)}-${(s.p2a || 0) + (s.p3a || 0)}`,
     `${s.p3m || 0}-${s.p3a || 0}`, `${s.ftm || 0}-${s.fta || 0}`]
      .forEach(v => tr.appendChild(el('td', null, v)));

    const pmTd = el('td', null, (s.pm > 0 ? '+' : '') + (s.pm ?? ''));
    if (s.pm > 0) pmTd.classList.add('pos'); else if (s.pm < 0) pmTd.classList.add('neg');
    tr.appendChild(pmTd);

    tr.style.cursor = 'pointer';
    tr.addEventListener('click', () => { location.href = boxLink; });
    tb.appendChild(tr);
  });
  t.appendChild(tb); wrap.appendChild(t); host.appendChild(wrap);
}

/* Every league he has a roster entry in, read once per page however many callers ask
   (membersOnly and loadCareerAccess, below). Rosters are the shop window, so no league
   refuses this read to anybody. A failed read is remembered as failed for this page: both
   callers treat it as "no other leagues", which leaves the page as open as it was. */
let rosterLeaguesP = null;
function rosterLeagues(pl) {
  if (!rosterLeaguesP) {
    rosterLeaguesP = api(`roster_entries?player_id=eq.${pl.id}&select=teams(leagues(id))`)
      .then(rows => [...new Set(rows.map(r => ((r.teams || {}).leagues || {}).id).filter(Boolean))]);
  }
  return rosterLeaguesP;
}

/* ---------------------------------------------------------- members only ---
   A MEMBERS-ONLY LEAGUE (docs/memberships.md §2). The database already refuses this player's
   games and season rows to a viewer who is not a member, so every section below would come
   up empty and look broken; the card says why instead. Name, photo and club stay: squads and
   player names are the league's shop window.

   ONLY WHEN EVERY LEAGUE HE IS ROSTERED IN IS CLOSED TO THIS VIEWER. A player who also
   appears in an open league keeps his page, and the closed league's rows simply do not come
   back. The other leagues are only looked up once the current one has said no, so an open
   league costs nothing here. Anything that cannot be told -- a failed read, a league the
   module has no answer for -- leaves the page open, as every access check does. */
async function membersOnly(pl, lgRow) {
  const A = window.EpinoiaAccess;
  if (!A || typeof A.get !== 'function' || typeof A.canView !== 'function') return false;
  const shut = id => { const s = A.get(id); return !!(s && s.known) && !A.canView(id); };
  if (!shut(lgRow.id)) return false;
  let others = [];
  try {
    others = (await rosterLeagues(pl)).filter(id => id !== lgRow.id);
    await Promise.all(others.map(id =>
      Promise.resolve().then(() => A.load({ leagueId: id })).catch(() => null)));
  } catch (_) { return false; }
  if (!others.every(shut)) return false;
  document.body.classList.add('members-only');
  const card = $('#paywall');
  if (card && typeof A.paywallHTML === 'function') {
    card.innerHTML = A.paywallHTML({ league: lgRow });
    card.hidden = false;
  }
  return true;
}

/* THE REST OF HIS CAREER, BEFORE IT IS READ. A token rides on this page's reads only once
   access.js has loaded a members-only league the viewer may see, and boot loads one league:
   his current club's. A member looking at a player who came from another members-only
   league would have that league's season rows and games refused -- the career table and the
   game log quietly a season short. So those leagues are asked about too, before the career
   is read. Only for somebody signed in: an anonymous viewer carries no token whatever the
   answer, so for most readers this costs nothing, and an open league's answer is cached for
   the next page. Never rejects, and bounded by access.js's own four-second limit. */
async function loadCareerAccess(pl, lgRow) {
  const A = window.EpinoiaAccess;
  if (!A || typeof A.load !== 'function') return;
  try {
    /* sessionReady renews an expired token first, as load() does -- a member back at an
       old tab is still a member */
    const s = typeof A.sessionReady === 'function' ? await A.sessionReady()
      : (typeof A.session === 'function' ? A.session() : null);
    if (!s) return;
    const others = (await rosterLeagues(pl)).filter(id => !lgRow || id !== lgRow.id);
    await Promise.all(others.map(id =>
      Promise.resolve().then(() => A.load({ leagueId: id })).catch(() => null)));
  } catch (_) { /* the career as the current league's answer leaves it */ }
}

/* ------------------------------------------------------------------- boot --- */
(async function boot() {
  if (!want) return fail('No player specified.');
  try {
    const key = isUuid ? 'id' : 'slug';
    const ps = await api(`players?${key}=eq.${encodeURIComponent(want)}&select=*&limit=1`);
    if (!ps.length) {
      return fail('This profile is not public. Under-18 players are only visible to their club.');
    }
    const pl = ps[0];

    /* the approved photograph, if the league has passed one */
    if (pl.photo_media_id) {
      try {
        const md = await api(`media?id=eq.${pl.photo_media_id}` +
                             `&status=eq.approved&select=storage_path&limit=1`);
        if (md.length) pl.__photoPath = md[0].storage_path;
      } catch (_) { /* an unapproved or withdrawn photo simply does not show */ }
    }

    const re = await api(`roster_entries?player_id=eq.${pl.id}` +
      `&select=jersey,position,teams(id,name,slug,colour,colour_2,colour_source,short_name,leagues(id,slug,name))&order=created_at.desc&limit=1`);
    const entry = re[0] || {};
    const team = entry.teams || null;
    paintIdentity(pl, entry, team);
    /* the club's own button, if this is the club's own person (nothing is fetched for anybody else) */
    offerRelease(pl, team).catch(() => { /* no button */ });
    if (team && team.leagues && team.leagues.slug) window.__CS_LEAGUE_SLUG = team.leagues.slug;

    /* ---- access ----
       ANSWERED BEFORE HIS CLUB'S GAMES ARE READ, not beside that read. data.js fixes a
       request's headers the moment the request is made, and a token rides on it only once
       access.js holds this league's answer -- so the games read that used to go out while
       the answer was still on its way was always anonymous, row-level security refused it
       in a members-only league, and a member got an empty season every time. Everything
       read above (the player, his photo, his roster entry) is the shop window and does not
       wait. Asked by id, since a slug would cost a leagues read first.
       The wait is bounded: load() never rejects, gives up by itself after four seconds and
       answers open, and an answer given on the league page a moment ago is cached, so an
       open league's profile is held for one small request at most. */
    const A = window.EpinoiaAccess;
    const lgRow = (team && team.leagues && team.leagues.id) ? team.leagues : null;
    if (A && typeof A.load === 'function') {
      /* a free agent has no league to ask about, but the platform's analytics default still
         applies to him: load({}) asks for the no-league answer (access_state's top-level
         analytics_ok), so his bars follow the same switch as everybody else's */
      try { await A.load(lgRow ? { leagueId: lgRow.id } : {}); } catch (_) { /* open, as every failure is */ }
    }
    if (A) {
      const lockedNow = () => typeof A.analyticsOk === 'function' && !A.analyticsOk(lgRow ? lgRow.id : null);
      const shutNow = () => { if (!lgRow || typeof A.get !== 'function' || typeof A.canView !== 'function') return false;
        const s = A.get(lgRow.id); return !!(s && s.known) && !A.canView(lgRow.id); };
      if (lgRow) ACCESS_LEAGUE = { id: lgRow.id, slug: lgRow.slug || '' };
      ANALYTICS_LOCKED = lockedNow();
      /* THE ANSWER CAN MOVE UNDER A DRAWN PAGE: a sign-in or sign-out in another tab, an answer
         that lands after the module's time limit, the admin preview switch. The bars, the
         events, the shot chart and the teammate panel were all drawn from it, so a change to
         what was decided draws the page again from the top; an open league never notices. On a
         change of account the new account's answer is waited for, not the empty state between.
         Answers about his OTHER leagues (loadCareerAccess, membersOnly) are not this page's
         decision and are ignored here, so loading them can never start a reload. */
      const drawn = ANALYTICS_LOCKED + '|' + shutNow();
      if (typeof A.onChange === 'function') {
        const check = () => { if (lockedNow() + '|' + shutNow() !== drawn) location.reload(); };
        try {
          A.onChange(d => {
            if (d && d.leagueId && (!lgRow || d.leagueId !== lgRow.id)) return;
            if (d && d.reason === 'auth' && lgRow && typeof A.load === 'function') {
              Promise.resolve().then(() => A.load({ leagueId: lgRow.id })).then(check, () => {});
            } else check();
          });
        } catch (_) { /* the page as drawn */ }
      }
      /* the card is drawn in place of the statistics, and nothing behind it is fetched -- not
         even the club's games, which the database would refuse every row of anyway */
      if (lgRow && await membersOnly(pl, lgRow)) return;
    }
    /* his other leagues, for the career table and the game log: asked now so the answers
       arrive while the season is being drawn, rather than after it (never rejects) */
    const careerAccess = loadCareerAccess(pl, lgRow);

    /* ---- the season, from the shared intermediary ----
       Aggregated the same way as the leaders board, so the two cannot
       disagree, and computed across the whole competition so this player can
       be ranked against everyone else in it. */
    const D = window.EpinoiaData;
    let mine = null, field = [];
    /* WHICH COMPETITION. A club plays a league and a trophy in the same season and
       the two are different fields; the reader chooses all of it or one kind of it.
       The competitions are whatever the club's finalised games belong to. */
    let compRows = [];
    try {
      const played = team && team.id
        ? await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
                      `&status=eq.final&select=competition_id`)
        : [];
      const ids = [...new Set(played.map(g => g.competition_id).filter(Boolean))];
      if (ids.length) {
        compRows = await D.all(`competitions?id=in.(${ids.join(',')})&select=id,name,kind`);
      }
    } catch (e) { console.warn('[competitions]', e); }
    const KIND_LABEL = { league: 'League', cup: 'Cup', trophy: 'Trophy', playoff: 'Playoffs', friendly: 'Friendlies' };
    const kinds = [...new Set(compRows.map(c => c.kind || 'league'))];
    let scopeKind = 'all';
    /* the label the events panel names its rows for: computed here, apart from
       any markup, and escaped by the panel itself */
    const fullName = ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim();
    const paintScope = async kind => {
      scopeKind = kind;
      const ids = compRows.filter(c => kind === 'all' || (c.kind || 'league') === kind).map(c => c.id);
      mine = null; field = [];
      try {
        if (ids.length) {
          const S = await D.season(ids);
          field = S.players;
          mine = field.find(r => r.id === pl.id) || null;
        }
      } catch (e) { console.warn('[season]', e); }
      paintTiles(mine);
      paintBars(mine, field);
      /* ---- events ----
         The season's situations (second chance, transition, off turnovers,
         after timeout, half court) and assisted baskets, read from the same
         scoped rows as the bars above and ranked against the same field. Its
         own try: a panel that cannot draw must never reach boot's catch, which
         wipes the season table and the game log. */
      try {
        const evHost = $('#events');
        /* without analytics the section stays, with the teaser where the panel would be */
        if (evHost && ANALYTICS_LOCKED) {
          evHost.innerHTML = accessTeaser({ title: 'Events',
            lines: ['Second chances, transition, points off turnovers, after-timeout sets, the half court and assisted baskets, ranked against the league.'] });
        } else if (evHost && window.EpinoiaSitPanel) {
          window.EpinoiaSitPanel.render({ host: evHost, kind: 'player', row: mine, field, name: fullName });
          const en = $('#eventsNote');
          if (en) en.textContent = kind === 'all' ? '' : (KIND_LABEL[kind] || kind);
        }
      } catch (e) { console.warn('[events]', e); }
      const bn = $('#barNote');
      if (bn && kind !== 'all') bn.textContent = (bn.textContent || '').replace(/ \u00b7 .*$/, '') + ' \u00b7 ' + (KIND_LABEL[kind] || kind);
      document.querySelectorAll('#compScope .ep-tab').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
    };
    if (kinds.length > 1) {
      const strip = document.createElement('div');
      strip.className = 'ep-tabs compscope'; strip.id = 'compScope'; strip.setAttribute('role', 'tablist');
      [['all', 'All']].concat(kinds.map(k => [k, KIND_LABEL[k] || k])).forEach(([k, lab]) => {
        const b = document.createElement('button');
        b.className = 'ep-tab' + (k === 'all' ? ' on' : ''); b.dataset.k = k; b.setAttribute('role', 'tab'); b.textContent = lab;
        b.onclick = () => paintScope(k);
        strip.appendChild(b);
      });
      const bars = $('#bars');
      if (bars && bars.parentNode) bars.parentNode.insertBefore(strip, bars);
    }
    await paintScope('all');

    /* ---- career, a row per season ----
       One line was fine when nobody had a second season. A career table is the
       thing a profile is actually for, and it is built through the SAME
       intermediary as the current season so every column means what it means
       everywhere else — a career table assembled from a different query is how
       a profile ends up disagreeing with the leaders board it links to.
       It waits for his other leagues' answers (started beside the season above),
       and so does everything after it: the game log reads across them too. */
    await careerAccess;
    await paintCareer(pl, mine, team);

    /* ---------------------------------------------------------------------------
   THE SHOT CHART, AND THE TWO NUMBERS THAT MAKE IT READABLE.

   Cell size and the attempt floor are exposed because the right values depend
   on how much a player has played: a season of eighteen games supports smaller
   cells and a higher floor than a run of three. The defaults are a stride and
   a bit (120cm) and two attempts, which is the point at which a cell stops
   being one shot somebody happened to take.
   --------------------------------------------------------------------------- */
let SHOTS = [];
/* redraw on either control, and only bind once */
document.addEventListener('change', e => {
  if (e.target && (e.target.id === 'scCell' || e.target.id === 'scMin')) drawShotChart();
});
let SHOT_COLOUR = null, SHOT_GAMES = 0;
function drawShotChart(shots, colour, games) {
  if (shots) SHOTS = shots;
  if (colour) SHOT_COLOUR = colour;
  if (games) SHOT_GAMES = games;
  const host = document.querySelector('#shotchart');
  if (!host || !window.EpinoiaShotChart) return;
  /* THE BOX SCORE'S CHART, over the season: every located shot as a dot or a cross in the
     club's colour, the floor cut into zones with each zone's makes, attempts and percentage */
  /* without analytics: the same court and the same marks, no zones -- and a line saying
     what the zones would add */
  window.EpinoiaShotChart.renderZones({ host, shots: SHOTS, colour: SHOT_COLOUR || '#93f2bf', minAttempts: 3, games: SHOT_GAMES,
    zones: !ANALYTICS_LOCKED });
  if (ANALYTICS_LOCKED) {
    host.insertAdjacentHTML('beforeend', accessTeaser({ compact: true, title: 'Shot zones',
      lines: ['Twelve zones, each tinted against its own break-even, with a zone-by-zone table.'] }));
  }
}

/* ---- on the floor with ----
       The team's on/off as tiles, then this player's OWN numbers split by who
       was beside him. The second is derived by replaying the event log — no
       table stores an individual box broken down by teammate — so it needs the
       log, the stints for shared minutes, and the frozen starters to know who
       was on the floor before the first substitution. */
    try {
      if (team && team.id) {
        /* BOUNDED, BECAUSE A CAREER IS NOT WHAT A READER IS LOOKING AT.

           This asked for every game the club has ever played and then fetched
           the full event log of each — which is right for four games and
           ruinous for two hundred. The lineup work below is about who this
           player has been on the floor with lately; the career table above it
           already covers the long view and reads pre-aggregated season rows.

           Newest first and capped, so the cost of this page is the same in a
           league's fifth season as in its first. */
        const RECENT_GAMES = 40;
        const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
          `&status=eq.final&select=id,home_team_id,away_team_id,starters,tipoff_at` +
          `&order=tipoff_at.desc&limit=${RECENT_GAMES}`);
        if (!gs.length) {
          $('#withpanel').appendChild(el('div', 'empty',
            'No finalised games yet — this fills in once one is played.'));
        } else {
          const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
          const [st, evs] = await Promise.all([
            D.stints(gs.map(g => g.id), team.id, byGame),
            D.events(gs.map(g => g.id))
          ]);

          window.EpinoiaWowy.onOffTiles('#onoff', st, pl.id);

          const games = gs.map(g => ({
            starters: g.starters,
            events: evs.filter(e => e.gameId === g.id)
          }));
          const recs = window.EpinoiaWith.index(games);

          /* ---- the season shot chart ----
             Built from the events already in hand rather than a second trip:
             locations live in the log, not in the season aggregates, and this
             block has just fetched the whole log for every game the club
             played. Grouped by game because a 'loc' event references its shot
             by an id that only means anything within its own game. */
          try {
            const byG = {};
            evs.forEach(e => { (byG[e.gameId] = byG[e.gameId] || []).push(e); });
            const shots = await window.EpinoiaShotChart.gather({
              fetchEvents: async () => Object.values(byG),
              gameIds: gs.map(g => g.id),
              playerId: pl.id
            });
            /* games this player appeared in among those fetched: a game with an event of theirs */
            const played = new Set(evs.filter(e => String(e.pid) === String(pl.id)).map(e => e.gameId));
            drawShotChart(shots, (team && team.colour) || null, played.size);
          } catch (e) { /* a chart is not worth breaking the page for */ }

          /* ---- on video ----
             The whole log for every game the club played is already in hand,
             so this costs exactly one more query: which of those games has
             footage attached. Anything without a video, or with one that has
             not been lined up with the game clock, is filtered out by the
             panel itself — a list of plays that cannot be found in a video is
             worse than no list. */
          try {
            /* CHUNKED, because an in.() list is a URL and a URL has a length.

               Forty uuids is 1.5KB of query string before anything else; a
               league where a club has played two hundred games would build one
               past every proxy's default header limit and fail with a 414 that
               says nothing about video. Forty at a time is what the rest of
               this file already uses, for the same reason. */
            const inChunks = async (ids, build) => {
              const out = [];
              for (let i = 0; i < ids.length; i += 40) {
                out.push(...await api(build(ids.slice(i, i + 40))));
              }
              return out;
            };
            const vids = await inChunks(gs.map(g => g.id), c =>
              'game_videos?game_id=in.(' + c.join(',') + ')' +
              '&is_primary=eq.true&select=game_id,url,provider,video_ref,label,' +
              'stream_started_at,tip_at,tip_wall,tip_offset_ms,trim_ms,clock_track');
            const byGameV = {};
            vids.forEach(v => { if (v.url) byGameV[v.game_id] = v; });
            if (Object.keys(byGameV).length && window.EpinoiaPlayerVideo) {
              const meta = {};
              (await inChunks(Object.keys(byGameV), c =>
                'games?id=in.(' + c.join(',') + ')' +
                '&select=id,tipoff_at,home:home_team_id(short_name,name),' +
                'away:away_team_id(short_name,name)')).forEach(g => { meta[g.id] = g; });

              const withVideo = Object.keys(byGameV).map(id => {
                const m = meta[id] || {};
                const h = (m.home || {}).short_name || (m.home || {}).name || 'home';
                const a = (m.away || {}).short_name || (m.away || {}).name || 'away';
                return {
                  id, video: byGameV[id], date: m.tipoff_at,
                  title: h + ' v ' + a +
                    (m.tipoff_at ? ' · ' + new Date(m.tipoff_at).toLocaleDateString() : ''),
                  events: evs.filter(e => e.gameId === id)
                };
              });
              /* names for the ASSIST tags and for "by <shooter>" on his assists */
              const names = {};
              try {
                const pids = [...new Set(evs.map(e => e.pid).filter(Boolean))];
                const meta = await D.playerMeta(pids);
                Object.keys(meta).forEach(id => { if (meta[id] && meta[id].name) names[id] = meta[id].name; });
              } catch (_) { /* tags fall back to "assisted" */ }
              const shown = window.EpinoiaPlayerVideo.render({
                host: '#videopanel', games: withVideo, playerId: pl.id, names: names
              });
              if (shown) {
                $('#videoNote').textContent = withVideo.length +
                  (withVideo.length === 1 ? ' game with footage' : ' games with footage');
                /* THE VIDEO TAB. The section stays out of the profile's flow and gets a
                   tab of its own beside the profile, shown only when there is footage. */
                const tabs = $('#ptabs');
                if (tabs) {
                  tabs.style.display = '';
                  const showVideo = on => {
                    document.body.classList.toggle('vtab', on);
                    $('#videosec').style.display = on ? '' : 'none';
                    tabs.querySelectorAll('.ep-tab').forEach(b => b.classList.toggle('on', (b.dataset.p === 'video') === on));
                    if (on) window.scrollTo({ top: tabs.getBoundingClientRect().top + window.scrollY - 12, behavior: 'smooth' });
                  };
                  tabs.querySelectorAll('.ep-tab').forEach(b => { b.onclick = () => showVideo(b.dataset.p === 'video'); });
                  if (new URLSearchParams(location.search).get('tab') === 'video') showVideo(true);
                }
              }
            }
          } catch (e) {
            /* Before 0082 is applied the table does not exist, and a profile
               that cannot show video is a profile, not a failure. */
            console.warn('[video]', e);
          }

          /* teammates are whoever actually shared a stint with him */
          const mates = new Set();
          st.forEach(s3 => {
            const ids = s3.player_ids || [];
            if (ids.indexOf(pl.id) === -1) return;
            ids.forEach(id => { if (id !== pl.id) mates.add(id); });
          });
          const mm = await D.playerMeta([...mates]);
          $('#wowyNote').textContent = st.length + ' stints · ' + mates.size + ' teammates' +
            (gs.length >= RECENT_GAMES ? ' · last ' + RECENT_GAMES + ' games' : '');

          /* locked: withui.js draws its compact teaser in place of the teammate comparison */
          window.EpinoiaWithUI.render({
            host: '#withpanel', recs, stints: st, playerId: pl.id,
            meta: mm, teammates: [...mates], locked: ANALYTICS_LOCKED, leagueSlug: ACCESS_LEAGUE.slug
          });
        }
      }
    } catch (e) {
      console.warn('[with]', e);
      if (!$('#withpanel').children.length) {
        $('#withpanel').appendChild(el('div', 'empty',
          'Could not load lineup data: ' + (e.message || e)));
      }
    }

    /* game log, with the opponent resolved from the game row */
    const gl = await api(`player_game_stats?player_uuid=eq.${pl.id}` +
      `&select=game_id,team_idx,stats,games(tipoff_at,home_score,away_score,status,` +
      `home:home_team_id(name,slug),away:away_team_id(name,slug))&limit=80`);
    const rows = gl.filter(r => r.games)
      .sort((a, b) => new Date(b.games.tipoff_at || 0) - new Date(a.games.tipoff_at || 0))
      .map(r => {
        const g = r.games;
        const home = r.team_idx === 0;
        const us = home ? g.home_score : g.away_score;
        const them = home ? g.away_score : g.home_score;
        return Object.assign({}, r, {
          __home: home,
          __opp: home ? g.away : g.home,
          __res: g.status === 'final' ? (us > them ? 'W ' + us + '-' + them
                                                   : 'L ' + us + '-' + them) : ''
        });
      });
    paintLog(rows);
  } catch (e) {
    fail('Could not load: ' + e.message);
  }
})();
