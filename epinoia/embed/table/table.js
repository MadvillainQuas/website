'use strict';
/* ============================================================================
   The standings / leaders embed.

     ?l=<league-slug>&kind=standings
     ?l=<league-slug>&kind=leaders&stat=ppg&n=10

   Small on purpose. An embed sits inside an article, so this is the top of a
   table and a link to the rest — eight columns is the ceiling and the header
   says which stat is being ranked, so nobody has to guess what they are
   looking at.

   Leaders read the same season intermediary every other page reads, so a
   number here and a number on the player's own profile cannot disagree.

   A MEMBERS-ONLY LEAGUE refuses its standings and box scores to an anonymous
   read, so this asks access.js about the league before reading anything: for a
   member it then hands data.js the member's token (EpinoiaAccess.authHeaders(),
   which data.js merges into every request), and for everybody else the reads
   are the anonymous ones they always were. Inside another site's iframe most
   browsers partition storage, so there the embed usually sees nobody signed in
   and a members-only league stays empty — which is the league's choice.
   ============================================================================ */

const CFG = window.EPINOIA_CONFIG;
const D = window.EpinoiaData;
const qp = new URLSearchParams(location.search);
const leagueSlug = qp.get('l') || 'demo-league';
const kind = (qp.get('kind') || 'standings').toLowerCase();
/* A CAP, NOT A DEFAULT. Twenty-five was low enough to cut a league's own standings short
   and there was no way to ask for more; the default is unchanged, so every page already
   embedding this gets exactly what it got. The rows scroll inside the frame now (see the
   stylesheet), so asking for the whole table costs the page nothing. */
const MAX_ROWS = 200;
const rows = Math.min(parseInt(qp.get('n'), 10) || 10, MAX_ROWS);

/* Light or dark, the club's colours and the host page's colourway: ../theme.js, shared by every
   embed. */

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const f1 = v => (v == null ? '—' : Number(v).toFixed(1));

/* THE HEIGHT THE LIST WANTS, not the height the box has. body.scrollHeight is clamped by
   the scrolling box now, so a page that resizes the frame around this embed would have been
   told to keep it exactly as tall as it already was, and the scroll would be the only way to
   see the rest — on a page that had no need to scroll at all. */
function postHeight() {
  try {
    const host = document.getElementById('host');
    const chrome = ['.ep-hd', '.ep-foot'].reduce((n, sel) => {
      const el = document.querySelector(sel);
      return n + (el ? el.offsetHeight : 0);
    }, 0);
    const height = host ? chrome + host.scrollHeight : document.body.scrollHeight;
    parent.postMessage({ epinoiaEmbed: 'height', height }, '*');
  } catch (_) {}
}

/* THE FULL TABLE OPENS IN THE PAGE ON OUR OWN PAGES, in a tab on anybody else's. The league
   front page frames the table and the leaders, and there a new window is a second copy of the
   site and a Back button that does nothing; on a club's site the club keeps its visitor. The
   same same-origin test the fixture strip uses: reading a foreign parent's location throws. */
(function moreTarget() {
  let ours = false;
  try { ours = window.parent !== window && window.parent.location.origin === location.origin; }
  catch (_) { ours = false; }
  const a = document.getElementById('more');
  if (a) a.target = ours ? '_top' : '_blank';
})();
function fail(m) {
  $('#host').textContent = '';
  $('#host').appendChild(el('div', 'ep-empty', m));
  postHeight();
}

function table(head, body) {
  const t = el('table', 'ep-tbl');
  const th = el('thead'), hr = el('tr');
  head.forEach((h, i) => hr.appendChild(el('th', i === 1 ? 'l' : (i === 0 ? '' : ''), h)));
  th.appendChild(hr); t.appendChild(th);
  const tb = el('tbody');
  body.forEach(cells => {
    const tr = el('tr');
    cells.forEach((c, i) => {
      const td = el('td', i === 1 ? 'l' : '');
      if (c && c.node) td.appendChild(c.node); else td.textContent = c;
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
  t.appendChild(tb);
  return t;
}

const nameCell = (label, colour, abbr, logo) => {
  const w = el('div', 'nm');
  const url = (logo && window.epinoiaLogoUrl) ? window.epinoiaLogoUrl(logo) : null;
  if (url) {
    const c = el('span', 'c');
    c.style.cssText = 'background:#fff;overflow:hidden';
    const img = document.createElement('img');
    img.src = url; img.alt = '';
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block';
    img.addEventListener('error', () => { img.remove(); c.textContent = (abbr || '').slice(0, 2).toUpperCase(); c.style.background = colour || '#93f2bf'; });
    c.appendChild(img); w.appendChild(c);
  } else if (colour) {
    const c = el('span', 'c', (abbr || '').slice(0, 2).toUpperCase());
    c.style.background = colour;
    w.appendChild(c);
  }
  w.appendChild(el('b', null, label));
  w.setAttribute('translate', 'no');               // a name, never a word to translate
  return { node: w };
};
/* a club's short letters in a cell of their own, likewise */
const letters = s => { const n = el('span', null, s); n.setAttribute('translate', 'no'); return { node: n }; };
/* A standings header: PTS there is league points, not points scored. The page's own tables tell
   by a PA column, which an embed does not have, so it says so. */
const standingsTable = (head, body) => {
  const t = table(head, body);
  t.querySelectorAll('th').forEach(th => th.setAttribute('data-i18n-ctx', 'standings'));
  return t;
};

/* which stats a leaders embed may rank, and what to call them */
const STATS = {
  ppg: ['PPG', r => f1(r.ppg)], rpg: ['RPG', r => f1(r.rpg)],
  apg: ['APG', r => f1(r.apg)], spg: ['SPG', r => f1(r.spg)],
  bpg: ['BPG', r => f1(r.bpg)], ts:  ['TS%', r => f1(r.ts)],
  efg: ['eFG%', r => f1(r.efg)], mpg: ['MPG', r => f1(r.mpg)]
};
/* The ranking key is one of those, never the raw ?stat=. It used to sort by
   whatever was asked for while labelling the column PPG, so ?stat=ev_second_ppg
   ranked players by a members-only analytics column in a free, public embed —
   and ?stat=constructor found Object's own constructor and broke the embed. */
const stat = Object.prototype.hasOwnProperty.call(STATS, qp.get('stat') || '') ? qp.get('stat') : 'ppg';

(async function boot() {
  try {
    /* access first, so the reads below carry a member's token where one is
       needed; load() never rejects and gives up after four seconds */
    const A = window.EpinoiaAccess;
    if (A && typeof A.load === 'function') {
      try { await A.load({ leagueSlug }); } catch (_) { /* read anonymously, as before */ }
    }
    const { league, comp } = await D.context(leagueSlug, qp.get('c'));
    $('#title').textContent = league.name;
    if (!comp) return fail('No competition yet');

    if (kind === 'standings') {
      $('#sub').textContent = 'standings';
      $('#more').href = new URL('../../l/?l=' + encodeURIComponent(league.slug),
                                location.href).href;
      /* A TABLE IN GROUPS IS SEVERAL TABLES. Ordered by rank alone, a two-group league
         interleaved its groups (1, 1, 2, 2 …) into one list nobody could read. Each group —
         or conference, and each division inside one (0144) — is drawn as its own small table
         under its name, n rows each; ?g=<name> shows one of them. An ungrouped league is the
         case of one unnamed group and gets exactly the table it always had. */
      const ST = window.EpinoiaStandings;
      const teamCols = 'name,short_name,colour,slug,logo_path';
      const conf = !!(ST && ST.isConferences(comp));
      let st = await D.all(`standings?competition_id=eq.${comp.id}` +
        `&select=${ST ? ST.columns(comp, teamCols) : 'rank,gp,w,l,diff,league_points,streak,group_name,teams(' + teamCols + ')'}` +
        `&order=group_name.asc,rank.asc`);
      const onlyGroup = qp.get('g');
      if (onlyGroup) st = st.filter(r => (r.group_name || '') === onlyGroup);
      if (!st.length) return fail('No games played yet');
      $('#host').textContent = '';
      const parts = ST ? ST.split(st) : [{ name: '', divisions: [{ name: '', rows: st }] }];
      const grouped = parts.length > 1 || parts[0].name !== '';
      parts.forEach(g => {
        if (grouped) $('#host').appendChild(el('div', 'ep-grp', ST ? ST.groupLabel(g.name, comp) : g.name));
        g.divisions.forEach(d => {
          if (d.name) $('#host').appendChild(el('div', 'ep-div', d.name));
          $('#host').appendChild(conf
            ? standingsTable(['#', 'TEAM', 'CONF', 'OVR', 'PCT', 'DIFF'],
                d.rows.slice(0, rows).map(r => {
                  const t = r.teams || {};
                  return [r.rank ?? '', nameCell(t.name || '—', t.colour, t.short_name, t.logo_path),
                          ST.record(r.conf_w, r.conf_l), ST.record(r.w, r.l), ST.pct(r.w, r.gp),
                          (r.diff > 0 ? '+' : '') + r.diff];
                }))
            : standingsTable(['#', 'TEAM', 'GP', 'W', 'L', 'DIFF', 'PTS'],
                d.rows.slice(0, rows).map(r => {
                  const t = r.teams || {};
                  return [r.rank ?? '', nameCell(t.name || '—', t.colour, t.short_name, t.logo_path),
                          r.gp, r.w, r.l, (r.diff > 0 ? '+' : '') + r.diff, r.league_points];
                })));
        });
      });
    } else {
      const [label, get] = STATS[stat];
      $('#sub').textContent = label + ' leaders';
      $('#more').href = new URL('../../stats/?l=' + encodeURIComponent(league.slug),
                                location.href).href;

      const S = await D.season(comp.id);
      if (!S.players.length) return fail('No statistics yet');
      const meta = await D.playerMeta(S.players.map(p => p.id));
      S.players.forEach(p => Object.assign(p, meta[p.id] || { name: 'Player' }));

      /* a one-game sample topping a season leaderboard is noise, not a leader */
      const eligible = S.players.filter(p => (p.gp || 0) >= 2);
      eligible.sort((a, b) => (b[stat] ?? -Infinity) - (a[stat] ?? -Infinity));

      $('#host').textContent = '';
      $('#host').appendChild(table(
        ['#', 'PLAYER', 'TEAM', 'GP', label],
        eligible.slice(0, rows).map((p, i) => [
          i + 1, nameCell(p.name, p.colour, p.teamShort, p.teamLogo), letters(p.teamShort || ''), p.gp, get(p)
        ])));
    }
    postHeight();
  } catch (e) {
    fail('Could not load');
  }
})();
