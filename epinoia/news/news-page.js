'use strict';
/* ============================================================================
   THE NEWS PAGE — every article, or one of them.

   Two views in one document, chosen by ?a=. That is the same shape the league
   splash and the platform hub share, and for the same reason: an article page
   and a list of articles differ by one query and one renderer, and keeping
   them apart means keeping two copies of the header, the league lookup and
   the not-found handling in step.
   ============================================================================ */
const CFG = window.EPINOIA_CONFIG;
const N = window.EpinoiaNews;
const B = window.EpinoiaNewsBlocks;
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

const Q = new URLSearchParams(location.search);
const WANT = Q.get('l') || '';
const SLUG = Q.get('a') || '';
const PAGE = 24;

/* A members-only league's news is refused to an anonymous caller (news_public and
   news_article check visibility inside), so a member's calls carry their token.
   access.js decides when that is worth doing and returns {} otherwise, so an open
   league's request is unchanged; a 401 on a token the server no longer accepts is
   asked once more without it. */
function withAuth(headers, anon) {
  const A = window.EpinoiaAccess;
  if (!anon && A && typeof A.authHeaders === 'function') {
    try { Object.assign(headers, A.authHeaders() || {}); } catch (_) { /* anonymous, as before */ }
  }
  return headers;
}
async function api(p, anon) {
  const headers = withAuth({ apikey: CFG.supabaseAnonKey, Accept: 'application/json' }, anon);
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers });
  if (r.status === 401 && headers.Authorization) return api(p, true);
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}
async function rpc(fn, args, anon) {
  const headers = withAuth({ apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json',
                             Accept: 'application/json' }, anon);
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST', cache: 'no-store',
    headers,
    body: JSON.stringify(args || {})
  });
  if (r.status === 401 && headers.Authorization) return rpc(fn, args, true);
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status));
  return j;
}

/* A MEMBERS-ONLY LEAGUE'S NEWS IS THE MEMBERS'. On a KNOWN "may not view" the
   paywall card replaces the archive (or the article), instead of "No news yet",
   which would be untrue. Without access.js, or when the check fails, nothing
   changes. Returns true when the card is up. */
async function newsWall(league) {
  const A = window.EpinoiaAccess;
  if (!A || typeof A.load !== 'function' || typeof A.get !== 'function') return false;
  try { await A.load({ leagueId: league.id, leagueSlug: league.slug }); } catch (_) { return false; }
  const st = A.get(league.id) || {};
  const walled = !!(st.known && typeof A.canView === 'function' && !A.canView(league.id));
  /* a sign-in or sign-out that changes the answer re-reads the page */
  if (typeof A.onChange === 'function') {
    A.onChange(() => {
      const now = A.get(league.id) || {};
      if (now.known && !A.canView(league.id) !== walled) location.reload();
    });
  }
  if (!walled || typeof A.paywallHTML !== 'function') return false;
  const w = $('#accessWall');
  w.innerHTML = A.paywallHTML({ league });
  w.classList.remove('hide');
  ['#one', '#list', '#pager'].forEach(s => $(s).classList.add('hide'));
  return true;
}

const imgUrl = p => /^https?:\/\//.test(p || '') ? p
  : (window.EpinoiaUpload ? window.EpinoiaUpload.publicUrl(CFG, p) : p);

(async function boot() {
  if (!WANT) {
    $('#list').textContent = '';
    $('#list').appendChild(el('div', 'empty',
      'No league asked for. Open the news from a league’s page.'));
    return;
  }

  let league = null;
  try {
    const ls = await api('leagues?slug=eq.' + encodeURIComponent(WANT) +
      '&select=id,slug,name,colour_a&limit=1');
    league = ls[0] || null;
  } catch (_) { /* handled below */ }

  if (!league) {
    $('#list').textContent = '';
    $('#list').appendChild(el('div', 'empty', 'No league called “' + WANT + '”.'));
    return;
  }

  document.title = 'News · ' + league.name;
  /* the rail marks the league, and the page wears its colours (nav.js) */
  window.__CS_LEAGUE_SLUG = league.slug;
  $('#leagueName').textContent = league.name;
  if (league.colour_a) {
    document.documentElement.style.setProperty('--team-a', league.colour_a);
  }
  const back = '../?l=' + encodeURIComponent(league.slug);
  $('#backLeague').href = back;
  $('#footLeague').href = back;

  if (await newsWall(league)) return;
  if (SLUG) await one(league);
  else await all(league, 0);
})();

/* ------------------------------------------------------------ one article --- */
async function one(league) {
  let a = null;
  try { a = await rpc('news_article', { p_league: league.id, p_slug: SLUG }); }
  catch (_) { /* below */ }

  /* No showing or hiding here: ?a= put m-article on the root before the first
     paint, so the archive was never drawn under this in the first place. */
  const host = $('#one');
  host.textContent = '';

  if (!a) {
    $('#head').textContent = 'Not found';
    host.appendChild(el('div', 'empty',
      'That article is not here. It may have been unpublished.'));
    const b = el('div', 'wrap');
    const link = el('a', 'ep-chip', 'all news →');
    link.href = '?l=' + encodeURIComponent(league.slug);
    b.appendChild(link);
    host.appendChild(b);
    return;
  }

  document.title = a.title + ' · ' + league.name;
  /* a filed match report is the report writer's prose: in another language the report pack's
     sentence templates translate its headline, standfirst and body (nothing else is tagged) */
  const generated = a.author_name === 'Epinoia match report';
  if (generated) $('#head').dataset.i18nCtx = 'report';
  else delete $('#head').dataset.i18nCtx;
  $('#head').textContent = a.title;
  $('#leagueName').textContent = league.name +
    (a.published_at ? ' · ' + N.when(a.published_at) : '') +
    (a.author_name ? ' · by ' + a.author_name : '');

  if (a.cover_path) {
    const fig = el('div', 'art-cover');
    const img = el('img');
    img.src = imgUrl(a.cover_path); img.alt = '';
    img.addEventListener('error', () => fig.remove());
    fig.appendChild(img);
    host.appendChild(fig);
  }

  const body = el('div', 'art-body');
  if (generated) body.dataset.i18nCtx = 'report';
  if (a.standfirst) body.appendChild(el('p', 'art-stand', a.standfirst));
  /* the report's game, straight after the standfirst: filled in when it answers */
  const gameSlot = el('div', 'art-game-slot');
  body.appendChild(gameSlot);
  body.appendChild(B.toDom(a.body, { url: imgUrl }));
  host.appendChild(body);

  const foot = el('div', 'art-foot');
  const link = el('a', 'ep-chip', 'all news →');
  link.href = '?l=' + encodeURIComponent(league.slug);
  foot.appendChild(link);
  host.appendChild(foot);

  reportGame(league, a).then(g => {
    if (!g) return;
    gameSlot.appendChild(gameCard(g));
    const chip = el('a', 'ep-chip', 'the game →');
    chip.href = gameHref(g.id);
    foot.insertBefore(chip, link);
  }, () => { /* a written piece, or no answer: the article stands on its own */ });
}

/* ------------------------------------------------------ a report's game ---
   A MATCH REPORT LINKS THE GAME IT IS ABOUT. finalise-game files each report with
   news_articles.game_id (0105), but news_article does not return it; the published row is
   readable directly (the news_read policy), with the member's token for a members-only league,
   as every other call here. The fixture line comes from the game itself, so the card reads
   "Nottingham Hoods 79–76 Derby Trailblazers" and opens the box score. A written article has
   no game and gets nothing. */
const gameHref = id => '../game/?g=' + encodeURIComponent(id) + '&mode=supabase';
async function reportGame(league, a) {
  if (!a || !a.slug) return null;
  const rows = await api('news_articles?select=game_id&league_id=eq.' + encodeURIComponent(league.id) +
    '&slug=eq.' + encodeURIComponent(a.slug) + '&limit=1');
  const id = rows && rows[0] && rows[0].game_id;
  if (!id) return null;
  let g = null;
  try {
    const gs = await api('games?select=id,status,home_score,away_score,tipoff_at,' +
      'home:home_team_id(name),away:away_team_id(name)&id=eq.' + encodeURIComponent(id) + '&limit=1');
    g = gs && gs[0];
  } catch (_) { /* the link still works without the line */ }
  return g || { id };
}
function gameCard(g) {
  const card = el('a', 'art-game');
  card.href = gameHref(g.id);
  const one = v => (Array.isArray(v) ? v[0] : v) || {};
  const home = one(g.home).name, away = one(g.away).name;
  const scored = g.status === 'final' || g.status === 'live';
  card.appendChild(el('span', 'k', g.status === 'live' ? 'live now' : 'the game'));
  const line = el('span', 't');
  if (home && away) {
    line.append(el('span', null, home),
      el('b', null, scored && g.home_score != null && g.away_score != null ? ' ' + g.home_score + '–' + g.away_score + ' ' : ' v '),
      el('span', null, away));
  } else line.textContent = 'This report’s game';
  card.appendChild(line);
  card.appendChild(el('span', 'd', 'Box score, play-by-play and every stat →'));
  return card;
}

/* --------------------------------------------------------- every article --- */
async function all(league, offset) {
  let rows = [];
  try {
    rows = await rpc('news_public',
      { p_league: league.id, p_limit: PAGE, p_offset: offset }) || [];
  } catch (e) {
    $('#list').textContent = '';
    $('#list').appendChild(el('div', 'empty', 'Could not load the news: ' + e.message));
    return;
  }

  const host = $('#list');
  host.textContent = '';
  if (!rows.length) {
    host.appendChild(el('div', 'empty',
      offset ? 'Nothing further back than this.'
             : 'No news yet. When this league publishes something it appears here ' +
               'and on its front page.'));
    return;
  }

  /* NEWEST FIRST — which is what news_public already orders by, pinned aside.
     The pin only decides what leads the five cards on the league page; on a
     full archive it would put an old article above a new one, which is not
     what an archive is for. */
  const grid = el('div', 'news-grid');
  rows.slice()
      .sort((x, y) => new Date(y.published_at || 0) - new Date(x.published_at || 0))
      .forEach((a, i) => grid.appendChild(N.card(a, {
        leagueSlug: league.slug, url: imgUrl, base: '../',
        /* first after the sort IS the newest here, since this list is ordered
           by date rather than by the pin */
        latest: i === 0
      })));
  /* the cards link back into this page, not out of it */
  grid.querySelectorAll('a.news-card').forEach(a => {
    a.href = a.href.replace(/.*news\//, '');
    if (a.getAttribute('href').charAt(0) !== '?') {
      a.setAttribute('href', '?' + a.getAttribute('href').split('?')[1]);
    }
  });
  host.appendChild(grid);

  const total = Number(rows[0].total || rows.length);
  const pager = $('#pager');
  pager.textContent = '';
  if (total > PAGE) {
    pager.classList.remove('hide');
    const prev = el('button', 'ep-btn mini', 'newer'); prev.type = 'button';
    prev.disabled = offset === 0;
    prev.addEventListener('click', () => all(league, Math.max(0, offset - PAGE)));
    const next = el('button', 'ep-btn mini', 'older'); next.type = 'button';
    next.disabled = offset + PAGE >= total;
    next.addEventListener('click', () => all(league, offset + PAGE));
    pager.append(prev,
      el('span', null, (offset + 1) + '–' + Math.min(offset + PAGE, total) + ' of ' + total),
      next);
  } else {
    pager.classList.add('hide');
  }
}
