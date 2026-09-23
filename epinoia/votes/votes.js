'use strict';
/* ============================================================================
   THE FANS' VOTE, WEEK BY WEEK (migration 0148, docs/fanvote.md).

   One row a finished week, newest first: the fans' player of the week and club
   of the week, with the points and votes they won by, and the season's most
   weekly wins across the top. Everything comes from fanvote_winners, which asks
   league_visible first, so a private league's page is its invited fans' only;
   reads carry the reader's token when they are signed in for exactly that
   reason (the league row itself is hidden from an anonymous read, 0139).
   ============================================================================ */
(async function () {
  const CFG = window.EPINOIA_CONFIG;
  const FV = window.EpinoiaFanVote;
  const $ = s => document.querySelector(s);
  const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
    if (x != null) n.textContent = x; return n; };
  const body = $('#vtBody');
  const say = msg => {
    body.textContent = '';
    body.appendChild(el('div', 'empty', msg));
    body.setAttribute('aria-busy', 'false');
  };
  const slug = new URLSearchParams(location.search).get('l') || '';
  if (!CFG || !FV) return say('This page could not load. Try again in a moment.');
  if (!slug) return say('Open this page from a league: its rail has a “fans’ vote” row.');

  let token = null;
  try {
    const A = window.EpinoiaAccess;
    const s = A && typeof A.sessionReady === 'function' ? await A.sessionReady() : null;
    token = (s && s.token) || null;
  } catch (_) { token = null; }
  const headers = json => {
    const h = { apikey: CFG.supabaseAnonKey, Accept: 'application/json' };
    if (json) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  };

  let league = null;
  try {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/leagues?slug=eq.' + encodeURIComponent(slug) +
      '&select=id,slug,name&limit=1', { cache: 'no-store', headers: headers(false) });
    const rows = r.ok ? await r.json() : [];
    league = rows[0] || null;
  } catch (_) { league = null; }
  if (!league) return say('No league called “' + slug + '”.');

  document.title = 'Fans’ vote · ' + league.name + ' · Epinoia';
  const ctx = $('#vtCtx');
  ctx.textContent = league.name;
  ctx.href = '../?l=' + encodeURIComponent(league.slug);
  $('#vtTitle').textContent = 'Fans’ vote';

  let weeks = null;
  try {
    const r = await fetch(CFG.supabaseUrl + '/rest/v1/rpc/fanvote_winners', {
      method: 'POST', cache: 'no-store', headers: headers(true),
      body: JSON.stringify({ p_league: league.id, p_limit: 104 })
    });
    weeks = r.ok ? await r.json() : null;
  } catch (_) { weeks = null; }
  if (!Array.isArray(weeks)) return say('The votes could not be read just now.');
  if (!weeks.length) return say('No week has been voted on yet. The first vote opens the Monday after the league plays.');

  const voted = weeks.filter(w => w.ballots > 0);
  $('#vtCount').textContent = voted.length + (voted.length === 1 ? ' week' : ' weeks') + ' voted on';

  /* the tile: a club plate, as small as a list allows */
  function tile(markText, team, logoPath) {
    const t = team || {};
    const c = el('div', 'club');
    const TC = window.EpinoiaTeamColour;
    if (TC && TC.card) TC.card(c, t.colour || '#93f2bf', t.colour_2);
    else c.style.setProperty('--ink-c', t.colour || '#93f2bf');
    const plate = el('div', 'club-plate');
    plate.append(el('div', 'club-flood'), el('div', 'club-tone'));
    const mark = el('div', 'club-mark');
    const mono = () => mark.append(el('span', 'club-mono ghost', markText), el('span', 'club-mono', markText));
    const url = logoPath && typeof window.epinoiaLogoUrl === 'function' ? window.epinoiaLogoUrl(logoPath) : null;
    if (url) {
      const img = el('img', 'club-logo'); img.src = url; img.alt = ''; img.loading = 'lazy';
      img.addEventListener('error', () => { img.remove(); mono(); });
      mark.appendChild(img);
    } else mono();
    plate.append(mark, el('div', 'club-grain'));
    c.appendChild(plate);
    return c;
  }

  function pick(kind, x) {
    if (!x) {
      const d = el('div', 'fvh-pick');
      d.appendChild(el('span', 'fvh-none', kind === 'player' ? 'No player vote' : 'No club vote'));
      return d;
    }
    const a = el('a', 'fvh-pick');
    const who = el('span', 'fvh-who');
    if (kind === 'player') {
      a.href = '../p/?p=' + encodeURIComponent(x.slug || '');
      a.appendChild(tile(FV.initials(x.name), x.team));
      who.append(el('span', 'fvh-k', 'Player of the week'), el('span', 'fvh-n', x.name),
                 el('span', 'fvh-s', x.points + ' pts' + (x.team && x.team.name ? ' · ' + x.team.name : '')));
    } else {
      a.href = '../t/?t=' + encodeURIComponent(x.slug || '');
      a.appendChild(tile(FV.monogram(x), x, x.logo_path));
      who.append(el('span', 'fvh-k', 'Club of the week'), el('span', 'fvh-n', x.name),
                 el('span', 'fvh-s', x.votes + (x.votes === 1 ? ' vote' : ' votes') +
                                     (x.share != null ? ' · ' + x.share + '%' : '') +
                                     (x.line ? ' · ' + FV.recordText(x.line) : '')));
    }
    a.appendChild(who);
    return a;
  }

  body.textContent = '';
  weeks.forEach(w => {
    const row = el('div', 'fvh-week');
    const when = el('div', 'fvh-when');
    when.append(el('b', null, FV.weekLabel(w.starts_at, w.ends_at)),
                document.createTextNode(w.ballots + (w.ballots === 1 ? ' vote' : ' votes') +
                  ' · ' + w.games + (w.games === 1 ? ' game' : ' games')));
    row.append(when, pick('player', w.player), pick('team', w.team));
    body.appendChild(row);
  });
  body.setAttribute('aria-busy', 'false');

  /* THE SEASON'S MOST WEEKLY WINS, across what is listed */
  const count = (list, key) => {
    const m = new Map();
    list.forEach(w => { const x = w[key]; if (!x) return;
      const k = x.id; const c = m.get(k) || { name: x.name, n: 0 }; c.n++; m.set(k, c); });
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 3);
  };
  const lead = $('#vtLead');
  const ps = count(voted, 'player'), ts = count(voted, 'team');
  if (ps.length || ts.length) {
    const box = el('div', 'fvh-lead');
    box.appendChild(el('span', 'fvh-k', 'Most weekly wins'));
    ps.concat(ts).forEach(c => {
      const chip = el('span', 'fvh-chip');
      chip.append(document.createTextNode(c.name + ' '), el('b', null, '×' + c.n));
      box.appendChild(chip);
    });
    lead.appendChild(box);
  }
})();
