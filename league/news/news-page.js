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

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}
async function rpc(fn, args) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: CFG.supabaseAnonKey, 'Content-Type': 'application/json',
               Accept: 'application/json' },
    body: JSON.stringify(args || {})
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status));
  return j;
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
  $('#leagueName').textContent = league.name;
  if (league.colour_a) {
    document.documentElement.style.setProperty('--team-a', league.colour_a);
  }
  const back = '../?l=' + encodeURIComponent(league.slug);
  $('#backLeague').href = back;
  $('#footLeague').href = back;

  if (SLUG) await one(league);
  else await all(league, 0);
})();

/* ------------------------------------------------------------ one article --- */
async function one(league) {
  let a = null;
  try { a = await rpc('news_article', { p_league: league.id, p_slug: SLUG }); }
  catch (_) { /* below */ }

  $('#list').classList.add('hide');
  const host = $('#one');
  host.classList.remove('hide');
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
  if (a.standfirst) body.appendChild(el('p', 'art-stand', a.standfirst));
  body.appendChild(B.toDom(a.body, { url: imgUrl }));
  host.appendChild(body);

  const foot = el('div', 'art-foot');
  const link = el('a', 'ep-chip', 'all news →');
  link.href = '?l=' + encodeURIComponent(league.slug);
  foot.appendChild(link);
  host.appendChild(foot);
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
      .forEach(a => grid.appendChild(N.card(a, {
        leagueSlug: league.slug, url: imgUrl, base: '../'
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
