'use strict';
/* ============================================================================
   THE SHOP WINDOW — a league's or a club's merchandise, for another site.

   Everything the strip and table embeds get right applies here: it runs on a
   page we do not control, so it validates its query string, it never grows
   past what the host gave it, and it reports its own height back.

   Two things are specific to this one.

   IT ONLY EVER SHOWS PUBLISHED PRODUCTS. The `merch_designs` policy makes that
   structural rather than a filter somebody could forget: a design that is
   still pending, building or failed is invisible to an anonymous reader, so a
   club's half-finished shirt cannot appear on their own website.

   IT SHOWS THE PRINT FILE, not a photograph of a garment. There is no
   photograph — the product is made when somebody orders it. Pretending
   otherwise with a stock mockup would be showing a picture of a thing that has
   never existed, so the artwork is shown for what it is, on the ground colour
   it prints onto.
   ============================================================================ */

const CFG = window.EPINOIA_CONFIG;
const qp = new URLSearchParams(location.search);
const wantLeague = qp.get('l') || '';
const wantTeam = qp.get('t') || '';
const limit = Math.min(parseInt(qp.get('n'), 10) || 12, 40);

const KIND_LABEL = { tee: 'Match tee', hoodie: 'Terrace hoodie', scarf: 'Bar scarf',
                     poster: 'Crest print', mug: 'Half-time mug' };

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
const $ = s => document.querySelector(s);

/* Appearance from the query string, validated before it is used: these strings
   arrive from a URL on somebody else's page, and writing one unchecked into a
   style is how a widget becomes an injection point. */
(function appearance() {
  const hex = v => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v || '') ? v : null;
  const a = hex(qp.get('accent'));
  if (a) document.body.style.setProperty('--ep-accent', a);
  if (qp.get('theme') === 'light') document.body.dataset.theme = 'light';
})();

async function api(path) {
  const r = await fetch(CFG.supabaseUrl + '/rest/v1/' + path,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

const money = (p, c) => p == null ? '' :
  (c === 'USD' ? '$' : c === 'EUR' ? '€' : '£') + (p / 100).toFixed(2);

(async function boot() {
  const host = $('#host');
  try {
    let q = 'merch_designs?status=eq.published&select=kind,external_url,price_pennies,' +
            'currency,artwork_path,teams(name,short_name,slug),leagues(name,slug,store_url)' +
            '&order=kind&limit=' + limit;
    if (wantTeam) q += '&teams.slug=eq.' + encodeURIComponent(wantTeam);

    /* A league is named by slug in the URL and stored by id, so it is resolved
       first rather than filtered through an embedded table — PostgREST would
       return every row with a null league instead of returning none. */
    if (wantLeague) {
      const ls = await api('leagues?slug=eq.' + encodeURIComponent(wantLeague) +
                           '&select=id,name,store_url&limit=1');
      if (!ls.length) {
        host.textContent = '';
        host.appendChild(el('div', 'ep-empty', 'No such league.'));
        return post();
      }
      $('#title').textContent = ls[0].name;
      $('#more').href = '../../?l=' + encodeURIComponent(wantLeague);
      if (ls[0].store_url) $('#more').href = ls[0].store_url;
      q += '&league_id=eq.' + ls[0].id;
    }

    let rows = await api(q);
    if (wantTeam) rows = rows.filter(r => r.teams && r.teams.slug === wantTeam);

    host.textContent = '';
    if (!rows.length) {
      host.appendChild(el('div', 'ep-empty',
        'Nothing in the shop yet. Products appear here as soon as the league ' +
        'publishes them.'));
      return post();
    }
    if (wantTeam && rows[0].teams) $('#title').textContent = rows[0].teams.name;
    $('#sub').textContent = rows.length + (rows.length === 1 ? ' item' : ' items');

    const grid = el('div', 'shop');
    rows.forEach(r => {
      const buy = r.external_url || (r.leagues && r.leagues.store_url) || null;
      const card = el(buy ? 'a' : 'div', 'it');
      if (buy) {
        card.href = buy;
        card.target = '_blank';
        /* nofollow: a shop is a commercial destination we do not vouch for */
        card.rel = 'noopener noreferrer nofollow';
      }
      const art = el('div', 'art');
      if (r.artwork_path) {
        const img = document.createElement('img');
        img.src = CFG.supabaseUrl + '/storage/v1/object/public/merch-print/' + r.artwork_path;
        img.alt = ((r.teams && r.teams.name) || '') + ' ' + (KIND_LABEL[r.kind] || r.kind);
        img.loading = 'lazy';
        art.appendChild(img);
      }
      card.appendChild(art);
      const ft = el('div', 'ft');
      ft.append(el('span', 'nm', KIND_LABEL[r.kind] || r.kind),
                el('span', 'pr', money(r.price_pennies, r.currency)));
      card.appendChild(ft);
      if (r.teams) card.appendChild(el('div', 'cl', r.teams.short_name || r.teams.name));
      grid.appendChild(card);
    });
    host.appendChild(grid);
  } catch (e) {
    host.textContent = '';
    host.appendChild(el('div', 'ep-empty', 'Could not load the shop.'));
  }
  post();
})();

/* The host page cannot know how tall this wants to be, so it is posted out and
   embed.js applies it. */
function post() {
  const send = () => {
    const h = document.documentElement.scrollHeight;
    try { parent.postMessage({ epinoiaEmbed: 'height', height: h }, '*'); } catch (_) {}
  };
  send();
  if (window.ResizeObserver) new ResizeObserver(send).observe(document.body);
  else setTimeout(send, 400);
}
