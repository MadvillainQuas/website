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

const CFG = window.COURTSIDE_CONFIG;
const T = window.CourtsideTable;
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

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
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
  document.title = name + ' · Courtside';

  const colour = (team && team.colour) || '#93f2bf';
  document.documentElement.style.setProperty('--team-a', colour);

  /* Photo. media rows are only readable once approved, and a minor's needs
     recorded guardian consent — both enforced in the database, so if a photo
     comes back it is publishable. Initials stand in when it does not. */
  const box = $('#photo');
  /* An approved upload wins over a pasted URL: it has been through moderation
     and the consent check, and it is served from our own CDN rather than
     whatever host someone linked. photo_url stays as the simple fallback. */
  const stored = pl.__photoPath
    ? window.CourtsideUpload.publicUrl(CFG, pl.__photoPath) : null;
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
    num.style.background = colour;
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
/* [key, label, attempts-key]
   The third entry is what the percentage rests on. A shooting rate without its
   volume is unreadable — 60% at the rim means one thing on eight attempts a
   night and nothing at all on one — so the attempts sit under the number. */
const BAR_GROUPS = [
  ['scoring',    [['ppg','PTS / GAME'],['ts','TS%'],['efg','eFG%'],['usg','USAGE'],['ftr','FT RATE']]],
  ['shooting',   [['rim_pct','RIM%','rim_apg'],['mid_pct','MID%','mid_apg'],
                  ['p3_pct','3P%','p3_apg'],['ft_pct','FT%','ft_apg']]],
  ['playmaking', [['ast_pct','ASSIST%'],['au','AST / USG'],['ast_to','AST / TO'],
                  ['tov_pct','TURNOVER%']]],
  ['rebounding', [['oreb_pct','OREB%'],['dreb_pct','DREB%'],['trb_pct','TOTAL REB%']]],
  ['defence',    [['stl_pct','STEAL%'],['blk_pct','BLOCK%'],['vs_efg','OPP eFG% ON']]],
  ['impact',     [['on_net','ON NET'],['diff_net','ON-OFF']]]
];
/* the ones where a smaller number is the better performance */
const BAR_LOW = ['tov_pct', 'vs_efg'];

function paintBars(mine, field) {
  const host = $('#bars'); host.textContent = '';
  if (!mine || field.length < 3) {
    host.appendChild(el('div', 'empty',
      'Percentiles appear once enough of the competition has played.'));
    return;
  }
  const keys = BAR_GROUPS.flatMap(([, rows]) => rows.map(r => r[0]));
  const ranks = window.CourtsideSeason.percentiles(field, keys, BAR_LOW);
  $('#barNote').textContent = 'vs ' + field.length + ' players';

  const wrap = el('div', 'bars');
  BAR_GROUPS.forEach(([title, rows]) => {
    wrap.appendChild(el('div', 'bargroup', title));
    rows.forEach(([k, label, attKey]) => {
      const v = mine[k];
      const p = (ranks.get(k) || new Map()).get(mine.id);
      const row = el('div', 'barrow');
      row.appendChild(el('div', 'bl', label));

      const track = el('div', 'bt');
      const fill = el('i');
      fill.style.width = (p == null ? 0 : Math.max(2, p)) + '%';
      /* the same five-band scale the table's heat map uses */
      fill.style.background = p == null ? 'var(--rule-2)'
        : p >= 75 ? 'var(--lume)' : p >= 50 ? 'color-mix(in oklch,var(--lume) 70%,var(--amber))'
        : p >= 25 ? 'var(--amber)' : 'var(--flare)';
      track.appendChild(fill);
      row.appendChild(track);

      const dp = (k === 'ast_to' || k === 'au') ? 2 : 1;
      const val = el('div', 'bv', v == null ? '—' : Number(v).toFixed(dp));
      if (p != null) val.appendChild(el('div', 'bp', ord(p)));
      /* the volume the rate rests on, under it */
      if (attKey && mine[attKey] != null) {
        val.appendChild(el('div', 'ba', Number(mine[attKey]).toFixed(1) + ' att'));
      }
      row.appendChild(val);
      wrap.appendChild(row);
    });
  });
  host.appendChild(wrap);
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
      `&select=jersey,position,teams(id,name,slug,colour,short_name)&order=created_at.desc&limit=1`);
    const entry = re[0] || {};
    const team = entry.teams || null;
    paintIdentity(pl, entry, team);

    /* ---- the season, from the shared intermediary ----
       Aggregated the same way as the leaders board, so the two cannot
       disagree, and computed across the whole competition so this player can
       be ranked against everyone else in it. */
    const D = window.CourtsideData;
    let mine = null, field = [];
    try {
      const comps = team && team.id
        ? await D.get(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
                      `&status=eq.final&select=competition_id&limit=1`)
        : [];
      const compId = comps[0] && comps[0].competition_id;
      if (compId) {
        const S = await D.season(compId);
        field = S.players;
        mine = field.find(r => r.id === pl.id) || null;
      }
    } catch (e) { console.warn('[season]', e); }

    paintTiles(mine);
    paintBars(mine, field);

    if (mine) {
      $('#seasonNote').textContent = mine.gp + (mine.gp === 1 ? ' game' : ' games');
      T.render({
        host: '#seasons', kind: 'player', sortKey: 'gp', showMinGames: false, heat: false,
        filename: (pl.slug || 'player') + '-season',
        rows: [Object.assign({}, mine, {
          name: ((pl.first_name || '') + ' ' + (pl.last_name || '')).trim(),
          teamName: (team && team.short_name) || '', teamShort: (team && team.short_name) || '',
          colour: (team && team.colour) || null
        })]
      });
    } else {
      $('#seasons').appendChild(el('div', 'empty',
        'No finalised games yet — a season line appears once one is played.'));
    }

    /* ---- with or without ----
       Read from lineup_stints, which carries the five on the floor for every
       stretch of every game — the only shape this question can be answered
       from, and the reason it is real rather than an approximation. */
    try {
      if (team && team.id) {
        const gs = await D.all(`games?or=(home_team_id.eq.${team.id},away_team_id.eq.${team.id})` +
          `&status=eq.final&select=id,home_team_id,away_team_id`);
        const byGame = {}; gs.forEach(g => { byGame[g.id] = g; });
        const st = await D.stints(gs.map(g => g.id), team.id, byGame);
        if (st.length) {
          window.CourtsideWowy.onOffTiles('#onoff', st, pl.id);
          const mateIds = [...new Set(st.flatMap(r => r.player_ids))];
          const mm = await D.playerMeta(mateIds);
          $('#wowyNote').textContent = st.length + ' stints';
          /* seeded with this player, so the matrix opens on the question the
             reader came here to ask */
          window.CourtsideWowy.render({
            host: '#wowy', stints: st, meta: mm, max: 4, preselect: [pl.id]
          });
        } else {
          $('#wowy').appendChild(el('div', 'empty', 'No lineup data yet.'));
        }
      }
    } catch (e) {
      console.warn('[wowy]', e);
      if (!$('#wowy').children.length) {
        $('#wowy').appendChild(el('div', 'empty',
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
