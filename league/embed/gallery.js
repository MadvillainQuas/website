'use strict';
/* ============================================================================
   The embed gallery — where a club copies a snippet.

   Every preview is a live iframe of the real widget, not a screenshot. What
   someone sees here is exactly what they will get, including the theme they
   picked and the league they chose, and if a widget breaks the gallery breaks
   with it rather than showing a picture of a working one.

   The snippet is generated from the same choices, so it cannot describe
   something other than what is on screen.
   ============================================================================ */

const CFG = window.EPINOIA_CONFIG;
const $ = s => document.querySelector(s);

/* the absolute origin, because the snippet is pasted on someone else's site */
const ORIGIN = location.origin;
const BASE = new URL('../', location.href).pathname;      // /league/

let leagues = [], gameId = null;

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

const theme = () => $('#theme').value;
const league = () => $('#league').value;

/* Only send a colour when it differs from ours, so a club that has not chosen
   one gets a snippet without noise in it. */
const DEFAULT_A1 = '#93f2bf', DEFAULT_A2 = '#8ff5ff';
const accent  = () => ($('#accent').value.toLowerCase()  !== DEFAULT_A1 ? $('#accent').value  : '');
const accent2 = () => ($('#accent2').value.toLowerCase() !== DEFAULT_A2 ? $('#accent2').value : '');

function frameUrl(path, params) {
  const u = new URL(BASE + path, ORIGIN);
  Object.entries(params).forEach(([k, v]) => { if (v) u.searchParams.set(k, v); });
  if (theme()) u.searchParams.set('theme', theme());
  if (accent()) u.searchParams.set('accent', accent());
  if (accent2()) u.searchParams.set('accent2', accent2());
  return u.href;
}

function snippet(kind, extra) {
  const bits = [`data-epinoia="${kind}"`];
  if (league()) bits.push(`data-league="${league()}"`);
  Object.entries(extra || {}).forEach(([k, v]) => { if (v) bits.push(`data-${k}="${v}"`); });
  if (theme()) bits.push(`data-theme="${theme()}"`);
  if (accent()) bits.push(`data-accent="${accent()}"`);
  if (accent2()) bits.push(`data-accent2="${accent2()}"`);
  return `<script src="${ORIGIN}${BASE}embed.js"\n        ${bits.join(' ')}><\/script>`;
}

function paint() {
  $('#f-strip').src = frameUrl('embed/strip/', { l: league(), n: 20 });
  $('#f-strip').style.height = '129px';
  $('#s-strip').textContent = snippet('strip');

  if (gameId) {
    $('#f-game').src = frameUrl('embed/game/', { g: gameId });
    $('#f-game').style.height = '240px';
    $('#s-game').textContent = snippet('game', { game: gameId });
  } else {
    $('#s-game').textContent =
      '<!-- no finished game yet — the snippet needs a game id -->';
  }

  $('#f-tab').src = frameUrl('embed/table/', { l: league(), kind: 'standings' });
  $('#f-tab').style.height = '300px';
  $('#s-tab').textContent = snippet('standings');

  const st = $('#stat').value;
  $('#f-lead').src = frameUrl('embed/table/', { l: league(), kind: 'leaders', stat: st, n: 10 });
  $('#f-lead').style.height = '320px';
  $('#s-lead').textContent = snippet('leaders', { stat: st });
}

/* every preview posts its height; apply it to the frame that sent it, and only
   from our own origin — same contract the injector gives a host page */
window.addEventListener('message', ev => {
  if (ev.origin !== location.origin) return;
  const d = ev.data;
  if (!d || d.epinoiaEmbed !== 'height') return;
  const h = Number(d.height);
  if (!isFinite(h) || h < 60 || h > 900) return;
  ['f-strip', 'f-game', 'f-tab', 'f-lead'].forEach(id => {
    const f = document.getElementById(id);
    if (f && ev.source === f.contentWindow) f.style.height = Math.ceil(h) + 'px';
  });
});

document.querySelectorAll('[data-copy]').forEach(b => {
  b.addEventListener('click', async () => {
    const text = document.getElementById(b.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = 'copied'; }
    catch (_) { b.textContent = 'select and copy'; }
    setTimeout(() => { b.textContent = 'copy'; }, 1600);
  });
});
['#league', '#theme', '#stat', '#accent', '#accent2'].forEach(sel =>
  $(sel).addEventListener('change', paint));
$('#reset').addEventListener('click', () => {
  $('#accent').value = DEFAULT_A1; $('#accent2').value = DEFAULT_A2; paint();
});

(async function boot() {
  try {
    leagues = await api('leagues?select=slug,name&order=name');
    leagues.forEach(l => $('#league').append(new Option(l.name, l.slug)));
    if (!leagues.length) $('#league').append(new Option('no leagues yet', ''));

    /* a real finished game, so the box-score preview is a real box score */
    const g = await api('games?status=eq.final&select=id&order=tipoff_at.desc&limit=1');
    gameId = g.length ? g[0].id : null;
  } catch (_) { /* the previews still render and will show their own message */ }
  paint();
})();
