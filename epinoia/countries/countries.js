'use strict';
/* ============================================================================
   THE COUNTRIES PAGE.

   One card per country, the leagues in it as lines inside the card. It replaces
   the splash's habit of listing every league on the platform in a strip: that
   worked at one league and would not have worked at forty, and it put the
   platform's whole directory on a landing page whose job is to point.

   A LEAGUE WITH NO COUNTRY IS NOT DROPPED. It goes in a card of its own at the
   end — a competition nobody has filed is still a competition somebody needs
   to reach, and hiding it until an administrator remembers to set a code would
   make the fix invisible to the person who has to make it.
   ============================================================================ */
const CFG = window.EPINOIA_CONFIG;
const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* The flag is DERIVED from the two letters of the ISO code, exactly as the rail
   derives it: the regional-indicator code points a font renders as that flag.
   Nothing is stored and nothing can go out of step with the code beside it. */
function flagOf(code) {
  if (!/^[A-Za-z]{2}$/.test(code || '')) return '\u{1F30D}';   // a globe, for the unfiled
  return String.fromCodePoint(...[...code.toUpperCase()]
    .map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

/* And the NAME from Intl, in the reader's own language, rather than from a
   hard-coded list that would be wrong for half the world and stale for the
   rest. */
let regionNames;
function countryName(code) {
  if (!/^[A-Za-z]{2}$/.test(code || '')) return 'Not yet filed';
  if (regionNames === undefined) {
    try { regionNames = new Intl.DisplayNames(undefined, { type: 'region' }); }
    catch (_) { regionNames = null; }
  }
  if (!regionNames) return code.toUpperCase();
  try { return regionNames.of(code.toUpperCase()) || code.toUpperCase(); }
  catch (_) { return code.toUpperCase(); }
}

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status + ' ' + p.split('?')[0]);
  return r.json();
}

(async function boot() {
  const grid = $('#grid');
  let ls = [];
  try {
    ls = await api('leagues?select=slug,name,colour_a,country&order=name');
  } catch (e) {
    grid.textContent = '';
    grid.appendChild(el('div', 'co-loading', 'Could not reach the server.'));
    return;
  }

  grid.textContent = '';
  if (!ls.length) {
    grid.appendChild(el('div', 'co-loading',
      'No leagues yet. One appears here the moment a league is created.'));
    return;
  }

  const groups = new Map();
  ls.forEach(l => {
    const k = (l.country || '').toUpperCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(l);
  });

  /* Named countries first, alphabetically BY THE NAME A READER SEES rather
     than by the code — sorting by code files Germany under D. The unfiled
     card is always last. */
  [...groups.keys()]
    .sort((a, b) => (a === '') - (b === '') || countryName(a).localeCompare(countryName(b)))
    .forEach(code => grid.appendChild(card(code, groups.get(code))));

  document.title = 'Countries · Epinoia';
  music();
})();

/* THE TRACK ONLY CONTINUES; IT NEVER STARTS HERE.

   A page that begins playing music because somebody followed a link to it is
   the thing everybody hates, so this asks music.js for no autoplay and lets it
   decide: it resumes if and only if sessionStorage says the track was playing
   when the last page was left, which can only be true if the visitor started
   it on the splash.

   No record means the slab is not even drawn. A silent player sitting in the
   corner of a page nobody asked for music on is furniture with no purpose. */
function music() {
  if (!window.EpinoiaMusic) return;
  if (!window.matchMedia('(min-width:901px)').matches) return;
  const prior = window.EpinoiaMusic.readState();
  if (!prior || !prior.playing) return;
  const sc = document.querySelector('#sc');
  if (!sc) return;
  sc.classList.remove('hide');
  window.EpinoiaMusic.mount(sc, { autoplay: false, kickOnInteraction: false });
}

function card(code, leagues) {
  const box = el('article', 'slab co-card');

  const flag = el('div', 'co-flag', flagOf(code));
  flag.setAttribute('aria-hidden', 'true');
  box.appendChild(flag);

  const name = countryName(code);
  box.appendChild(el('h2', 'co-name', name));
  box.appendChild(el('div', 'co-count',
    leagues.length + (leagues.length === 1 ? ' league' : ' leagues')));

  const list = el('div', 'co-leagues');
  leagues.forEach(l => {
    const a = el('a', 'co-league');
    a.href = '../?l=' + encodeURIComponent(l.slug);
    const dot = el('span', 'dot');
    dot.style.background = l.colour_a || '#93f2bf';
    a.append(dot, el('span', 'nm', l.name), el('span', 'go', '›'));
    a.setAttribute('aria-label', l.name + ' — ' + name);
    list.appendChild(a);
  });
  box.appendChild(list);

  return box;
}
