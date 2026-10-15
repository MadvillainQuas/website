/* ============================================================================
   EPINOIA NETWORK — client configuration.
   This file is PUBLIC. It ships to every browser. Treat it accordingly.

   The anon key belongs here: it is designed to be published, and it grants
   nothing on its own — every read and write is evaluated by the row-level
   security policies in supabase/migrations/0001_init.sql.

   NEVER put the service_role key in this file, or anywhere under /epinoia/.
   That key bypasses RLS entirely. It lives only in server-side secrets (the
   Edge Functions' and the ingest's), never in anything the browser loads.

   Get the anon key:  Supabase dashboard -> Project Settings -> API
                      -> Project API keys -> "anon / public"
   ============================================================================ */
window.EPINOIA_CONFIG = {
  supabaseUrl: 'https://hhvofgqqadtyvcjudhjx.supabase.co',

  // paste the anon (public) key here — starts "eyJ…"
  supabaseAnonKey: 'sb_publishable_iYjQNoDcYluFNbdbGGxMHw_kvL4dTZO',

  // 'supabase' once the key is in and the migration is applied;
  // 'local' drives everything through BroadcastChannel for offline development.
  defaultMode: 'local',

  // true ONLY once migration 0173 (site_events, analytics_track) is applied: then every page
  // counts its views and tab clicks, anonymously (track.js). Until then nothing is sent, so
  // no browser asks for a function the database does not have yet. 0173 was applied on
  // 2026-09-25 (analytics_track answers a signed-out browser), so counting is on.
  analytics: true,

  // true ONLY once migration 0260 (site_activity, analytics_activity) is applied: then pages also count time in use,
  // scrolling, videos, downloads, links out, sharing, speed and errors (track.js, anonymous). Until then none of it is sent.
  analyticsActivity: true,

  // FALSE: crests and logos are served as stored files, never through Storage's image
  // transformation. Pro includes 100 transformed images a month; the site asked for 671 in one
  // cycle (each distinct crest counts once), which put the project over its quota (2026-09-26).
  // Another site's crest comes from its copy in the 'crests' bucket, kept small by
  // scripts/ingest/shrink_crests.py. Turn it on only if the transformation allowance is raised.
  crestSizes: false,

  // true ONLY once the Supabase Magic Link email template carries {{ .Token }}:
  // then the sign-in forms inside the app offer a field for the email's code.
  // Until then the app is told the link signs in the phone's browser instead.
  emailOtp: false
};

/* Lazily create the Supabase client, only if the SDK and a key are present.
   Pages work in local mode with neither. */
/* ============================================================================
   A CLUB'S CREST, WHEREVER IT CAME FROM.

   teams.logo_path started life as a path inside the media-public bucket (a
   club's approved upload). A league fed from FIBA LiveStats gets its crests
   from the feed instead — Genius publishes each club's logo at an absolute
   URL, and the ingest worker writes that in. One resolver, used by every page
   that draws a crest, so both kinds work everywhere and nothing prefixes a
   bucket path onto a URL that already has a host. Tolerates the JSON blob an
   early worker wrote in place of the URL. Returns null for "no crest".
   ============================================================================ */
/* THE CLUB'S CREST, WHEREVER A CLUB IS NAMED. One element: the crest where the club has one
   (uploaded, or from its feed), the initials on the club's colour where it has not, and the
   initials again if the image fails. `team` needs logo_path (or logo_url), short_name/name and
   colour; `opts.cls` names the class the host page styles (default ep-crest). */
window.epinoiaCrest = function (team, opts) {
  const o = opts || {}; const t = team || {};
  const box = document.createElement('span');
  box.className = o.cls || 'ep-crest';
  const s = String(t.short_name || '').trim();
  const words = String(t.name || '').trim().split(/\s+/).filter(Boolean);
  const initials = s ? s.slice(0, 3).toUpperCase()
    : words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase()
    : String(t.name || '?').slice(0, 2).toUpperCase();
  const paint = () => {
    box.textContent = initials; box.classList.remove('has-img');
    box.style.background = t.colour || '#93f2bf';
  };
  const url = t.logo_url || (window.epinoiaLogoUrl ? window.epinoiaLogoUrl(t.logo_path || t.logo || null) : null);
  if (url) {
    const img = document.createElement('img');
    img.src = url; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
    img.addEventListener('error', () => { img.remove(); paint(); });
    box.classList.add('has-img'); box.style.background = '';
    box.appendChild(img);
    box.title = t.name || '';
  } else paint();
  return box;
};

/* LIGHT OR DARK, DECIDED BEFORE THE PAGE PAINTS. A fan's choice on their profile is kept in
   this browser as well as on their row, so every page opens in it without a round trip. */
try {
  const th = localStorage.getItem('epinoia_theme');
  if (th !== 'dark') document.documentElement.setAttribute('data-theme', 'light');     // light unless dark was chosen
} catch (_) { document.documentElement.setAttribute('data-theme', 'light'); }
try {
  const m = document.querySelector('meta[name="theme-color"]');
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  if (m && light) m.setAttribute('content', '#f3faf6');
  /* SAMSUNG INTERNET AND CHROME CAN DARKEN A PAGE BY FORCE ("dark mode" in the browser's own
     settings): every colour is inverted or dimmed and the light theme comes out as a murky
     dark one. "only light" is the documented opt-out; a page that chose dark says so too. */
  window.epinoiaColourScheme = function (isLight) {
    let cs = document.querySelector('meta[name="color-scheme"]');
    if (!cs) { cs = document.createElement('meta'); cs.setAttribute('name', 'color-scheme'); document.head.appendChild(cs); }
    cs.setAttribute('content', isLight ? 'only light' : 'dark');
    const tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', isLight ? '#f3faf6' : '#04100b');
  };
  window.epinoiaColourScheme(light);
} catch (_) { /* no meta */ }
/* the public half of the Web Push key pair (the private half lives with the notify function) */
window.EPINOIA_VAPID = 'BLskwAuRGoAJnRcYe0gyLE5R0otKhcvu8fL5UxE06ep_VGzxfbirqziIS4uu3N6BmQob4Vl9vSiokUuVKpa7toM';

/* A CREST AT THE SIZE IT IS SHOWN (migration 0158). Nearly every club crest is another site's
   URL, hot-linked: PNGs of 100-780 KB drawn at 24-64 px. The snapshots function copies each one
   into the public 'crests' bucket under crestKey(url), and this asks Storage's image
   transformation for it at `px` (128 by default: sharp at 64 CSS px on a 2x screen), as WebP
   where the browser takes it. An upload of our own (a media-public path) is sized the same way.
   An SVG is drawn as it is (it is already small, and vector).

   A COPY THAT IS NOT THERE FALLS BACK TO THE ORIGINAL. A crest the function has not reached
   yet, or could not copy (a dead host, not an image), answers the transformation with an error;
   the listener below catches the image's error before the page's own handlers do and points it
   at the URL it would have used before, so no crest is ever drawn worse than it was. crestKey is
   cyrb53 of the exact URL; supabase/functions/snapshots holds the same function, and
   supabase/tests/crests.test.mjs keeps the two identical. */
function crestKey(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const CREST_ORIGINAL = new Map();            // transformation URL -> the URL to fall back to
window.epinoiaLogoUrl = function (path, px) {
  if (!path) return null;
  let p = String(path).trim();
  if (p.charAt(0) === '{') {
    try { p = (JSON.parse(p) || {}).url || ''; } catch (_) { return null; }
  }
  if (!p) return null;
  if (/^http:\/\//i.test(p)) return null;          // mixed content: the browser would block it anyway
  const c = window.EPINOIA_CONFIG || {};
  const external = /^https:\/\//i.test(p);
  if (!c.supabaseUrl) return external ? p : null;
  const original = external ? p
    : c.supabaseUrl + '/storage/v1/object/public/media-public/' + p.split('/').map(encodeURIComponent).join('/');
  if (/\.svg(\?|#|$)/i.test(p)) return original;
  if (c.crestSizes === false) {
    /* NO TRANSFORMATION (the plan's allowance is 100 a month). Another site's crest is drawn from its copy in
       the 'crests' bucket, which scripts/ingest/shrink_crests.py keeps at 256 px; a stored upload is already
       at most 512 px (upload.js), so it is drawn as it is. A copy that does not exist yet fails to load and
       the handler below puts the original back. */
    if (!external) return original;
    const copy = c.supabaseUrl + '/storage/v1/object/public/crests/' + crestKey(p);
    CREST_ORIGINAL.set(copy, original);
    return copy;
  }
  const w = Math.max(32, Math.min(512, Math.round(+px || 128)));
  const object = external ? 'crests/' + crestKey(p) : 'media-public/' + p.split('/').map(encodeURIComponent).join('/');
  const sized = c.supabaseUrl + '/storage/v1/render/image/public/' + object +
                '?width=' + w + '&height=' + w + '&resize=contain';
  CREST_ORIGINAL.set(sized, original);
  return sized;
};
window.epinoiaCrestKey = crestKey;
/* Capture phase, on the window: it runs before any handler on the image itself (epinoiaCrest's
   swap to initials, a badge's monogram), and stopping the event there keeps those for the
   original URL failing too, which then errors afresh with nothing left to fall back to. */
if (typeof window.addEventListener === 'function') window.addEventListener('error', function (e) {
  const img = e.target;
  if (!img || img.tagName !== 'IMG') return;
  /* kept, not deleted: the same crest drawn in five places fails five times, and each needs it */
  const original = CREST_ORIGINAL.get(img.currentSrc || img.src);
  if (!original) return;
  e.stopImmediatePropagation();
  img.src = original;
}, true);

/* A LEAGUE'S BADGE, WHEREVER GAMES FROM MORE THAN ONE LEAGUE SIT SIDE BY SIDE (HOME's daily
   fixtures, the global fixtures page). An HTML string: span.lgb holding a small tile with the
   league's logo, or its monogram on its own two colours where it has none, then its name.
   Everything from the row is escaped. The tile's colours are the league's only when they came
   from its logo or were set by hand: a 'default' colour_a is just the platform mint and would
   make every league look like the same one. The img carries data-mono on its tile so a page can
   swap in the monogram when the logo fails (the CSP forbids onerror="";
   EpinoiaGlobalGames.wireBadges does it). opts: { cls, noName, small }. */
/* A LEAGUE'S NAME THAT FITS A CARD (Louie, 2026-10-14: on the global fixtures page "Super League Basketball..." was cut to
   the same words for the men's and the women's league). The full name when it sits on two lines of a card (about twelve
   capitals a line); otherwise the first of these that does: the initials of the name with the side it is for said in full
   ("SLB Men", "SLB Women") - or, where the name says it in another language, that language's letter ("LNBF"); the
   initials and the last word, when that word is the one that tells it apart ("LF Challenge"); the initials alone ("EABL",
   "BCB"). A word in capitals is kept whole ("WNBL"); the little words are left out. max: characters a line (12).
   epinoiaLeagueFit.forms(league): every form, longest first, for a page that measures (epinoiaFitLeagueNames). */
window.epinoiaLeagueFit = function (league, max) {
  const per = max || 12;
  const fits = s => { let lines = 1, cur = 0; for (const w of String(s).split(' ')) { if (w.length > per) return false;
    if (cur && cur + 1 + w.length > per) { lines++; cur = w.length; } else cur += (cur ? 1 : 0) + w.length; } return lines <= 2; };
  const forms = window.epinoiaLeagueFit.forms(league);
  return forms.find(fits) || forms[0];
};
window.epinoiaLeagueFit.forms = function (league) {
  const l = league || {};
  const name = String(l.name || l.slug || 'League').trim().replace(/\s+/g, ' ');
  /* the little words, written small ("de", "of"): a capital A is a word ("Serie A") */
  const NOISE = /^(of|the|and|for|a|an|de|du|la|le|el|des|di|da|del|The|Of|And|For)$/;
  const MEN = /^(men|mens|men's|men’s|m)$/i, WOMEN = /^(women|womens|women's|women’s|w)$/i;
  const OTHER = { feminin: 'F', féminin: 'F', femenina: 'F', femenino: 'F', femminile: 'F', femra: 'F', dam: 'D', damen: 'D', kvinder: 'K',
                  masculin: 'M', masculino: 'M', maschile: 'M', meshkuj: 'M', herren: 'H' };
  const GENERIC = /^(league|liga|lega|ligue|lyga|basketball|basket|baschet|championship|cup|division|series|serie)$/i;
  const ACR = /^[\p{Lu}0-9][\p{Lu}0-9.&]+$/u;
  const DIV = { one: 1, two: 2, three: 3, i: 1, ii: 2, iii: 3, 1: 1, 2: 2, 3: 3 };
  /* "Division One" is D1 ("WNBL D1"), in every form after the full name */
  const dn = name.replace(/\bDivision\s+(One|Two|Three|III|II|I|1|2|3)\b/i, (m, k) => 'D' + DIV[k.toLowerCase()]);
  let words = dn.split(/[\s-]+/).filter(w => w && !NOISE.test(w));
  let side = '', letter = '';
  const last = words[words.length - 1] || '';
  if (words.length > 1 && MEN.test(last)) { side = 'Men'; words.pop(); }
  else if (words.length > 1 && WOMEN.test(last)) { side = 'Women'; words.pop(); }
  else if (words.length > 1 && OTHER[last.toLowerCase()]) { letter = OTHER[last.toLowerCase()]; words.pop(); }
  /* initials: each word's first letter run together ("SLB"); a word in capitals is kept whole and stands apart ("WNBL"),
     and beside one the generic words go ("SB League Women" is "SB Women"); add: a letter on the end ("LNBF") */
  const ini = (ws, add) => {
    const keep = ws.some(w => ACR.test(w)) ? ws.filter(w => ACR.test(w) || !GENERIC.test(w)) : ws;
    const toks = [];
    const put = (t, acr) => { const prev = toks[toks.length - 1]; if (!acr && prev && !prev.acr) prev.t += t; else toks.push({ t, acr }); };
    keep.forEach(w => put(ACR.test(w) ? w : w.charAt(0).toUpperCase(), ACR.test(w)));
    if (add) put(add, false);
    return toks.map(x => x.t).join(' ');
  };
  const out = [];
  if (dn !== name) out.push(dn);
  if (side) out.push(ini(words) + ' ' + side);
  /* the initials and the word that tells it apart ("LF Challenge"); a last word of a letter or two goes with the one before
     it ("LB Serie A") */
  const n = (words[words.length - 1] || '').length <= 2 && words.length >= 3 ? 2 : 1;
  if (!side && !letter && words.length >= n + 2 && (n === 2 || !GENERIC.test(words[words.length - 1]))) {
    out.push(ini(words.slice(0, -n)) + ' ' + words.slice(-n).join(' '));
  }
  /* the initials alone, the side still in them ("SLBW") */
  out.push(ini(words, letter || side.charAt(0)));
  return [name].concat(out.filter((s, i) => s.replace(/\s/g, '').length >= 2 && s !== name && out.indexOf(s) === i));
};
/* FIT THE NAMES TO THE ROOM THEY ARE DRAWN IN (2026-10-14). Twelve capitals a line is a card on a
   wide screen; on a phone the fixtures page's tiles are half the screen and the same name broke
   mid-word ("KORISL IIGA") or ran out ("WNBL DIVISI..."). For each badge name drawn with fit (it
   carries data-full), on the page as laid out: the longest form that sits whole (no word cut, no
   line past the box's own), else the shortest, allowed to break (.lgb-tight). Only names that are
   shown, and only again when the room they have has changed (or force: the fonts came in).
   A PAIR READS ALIKE: the men's and the women's league in one grid take the shorter of the forms
   either needs, never "Super League Basketball Men" beside "SLB Women". */
window.epinoiaFitLeagueNames = function (root, force) {
  const scope = root || document;
  if (!scope.querySelectorAll) return;
  const SIDE = /^(men|mens|men's|men’s|women|womens|women's|women’s|feminin|féminin|femenina|femenino|femminile|femra|dam|damen|kvinder|kvinde|naisten|masculin|masculino|maschile|meshkuj|herren)$/i;
  const say = (n, i) => {
    const f = n._fit, t = f.forms[i];
    if (n.textContent !== t) n.textContent = t;
    const short = t !== f.full, badge = n.parentNode;
    if (short) n.setAttribute('aria-label', f.full); else n.removeAttribute('aria-label');
    const titled = badge && badge.classList && badge.classList.contains('lgb') ? badge : n;
    if (short) titled.setAttribute('title', f.full); else titled.removeAttribute('title');
  };
  const grids = new Map();
  /* a badge's name, and a league card's on HOME (home/leagues.js) */
  scope.querySelectorAll('.lgb-name[data-full], .lgc-name[data-full]').forEach(n => {
    const host = (n.closest && n.closest('summary')) || (n.parentNode && n.parentNode.parentNode);
    const room = host ? host.clientWidth : 0;
    if (!room || !n.getClientRects().length) return;
    if (!n._fit || n._fit.room !== room || force) {
      const full = n.getAttribute('data-full');
      const forms = window.epinoiaLeagueFit.forms({ name: full });
      const whole = () => n.scrollWidth <= n.clientWidth + 1 && n.scrollHeight <= n.clientHeight + 1;
      n.classList.remove('lgb-tight');
      let i = 0;
      for (; i < forms.length; i++) { n.textContent = forms[i]; if (whole()) break; }
      if (i === forms.length) { i = forms.length - 1; n.classList.add('lgb-tight'); }
      n._fit = { room, forms, full, level: i };
    }
    say(n, n._fit.level);
    /* its pair: the same name but for the side it is for, said first or last ("Women's Elite...", "...Basketball Women"),
       in the same grid. Not a side in the middle: "Liga Femenina Endesa" is not "Liga Endesa" made shorter */
    const grid = host.parentNode && host.parentNode.parentNode;
    const ws = n._fit.full.split(/\s+/);
    while (ws.length > 1 && SIDE.test(ws[0])) ws.shift();
    while (ws.length > 1 && SIDE.test(ws[ws.length - 1])) ws.pop();
    const stem = ws.join(' ').toLowerCase();
    if (!grids.has(grid)) grids.set(grid, new Map());
    const g = grids.get(grid);
    if (!g.has(stem)) g.set(stem, []);
    g.get(stem).push(n);
  });
  grids.forEach(g => g.forEach(list => {
    if (list.length < 2) return;
    const most = Math.max.apply(null, list.map(n => n._fit.level));
    list.forEach(n => say(n, Math.min(most, n._fit.forms.length - 1)));
  }));
};
/* A LEAGUE'S TIER (Louie, 2026-10-14: "a 'TIER' denotation from which all leagues in their countries are sorted ... SLB =
   Tier 1, BCB = Tier 2, NBL D1 = Tier 3"). Where a league stands in its country's pyramid, the men's and the women's counted
   apart (the top women's league is tier 1 too), so a country's leagues read top division first: in the rail (with ALL / MEN
   / WOMEN), on HOME, and wherever leagues are listed by country (country.js group). Researched league by league on
   2026-10-14. A competition across borders counts in its own pyramid (EuroLeague 1; EuroCup and the Champions League 2;
   the Europe Cup 3; ABA League 1, ABA League 2 2). AN UNDER-AGE LEAGUE HAS A YOUTH TIER of its own ('y1', 'y2': the
   academies, the espoirs, the U19 and U22 leagues; Louie, 2026-10-14: "a YOUTH tier sorting system too"), the top one
   for its side 'y1' (Espoirs ELITE 'y1', Espoirs ELITE 2 'y2'); 'uni' is a university league. Youth tiers come after the
   senior ones, university after those, and a league not listed last. Keyed by slug:
   [tier, side], side 'm' or 'w', which counts only where the league's own gender (0131) is not set. CIBACOPA is a pro
   league of its own (no promotion, no relegation) but the LNBP is Mexico's national top flight: tier 2 (Louie).
   A NEW LEAGUE IS ADDED HERE (its federation's own account of its level), or it lists last with no tier. */
window.EPINOIA_LEAGUE_TIERS = {
  /* Albania */ 'kkm-albania': [1, 'm'], 'kkf-albania': [1, 'w'],
  /* Australia */ 'nbl': [1, 'm'], 'nbl1-men': [2, 'm'], 'wnbl': [1, 'w'], 'nbl1-women': [2, 'w'],
  /* Azerbaijan */ 'azerbaijan-basketball-league': [1, 'm'],
  /* Belgium + Netherlands */ 'bnxt-league': [1, 'm'],
  /* Bulgaria */ 'nbl-bulgaria': [1, 'm'],
  /* Brazil */ 'nbb': [1, 'm'], 'liga-ouro': [2, 'm'],
  /* Canada */ 'cebl': [1, 'm'], 'u-sports': ['uni', 'm'],
  /* Switzerland */ 'sb-league': [1, 'm'], 'nlb-men': [2, 'm'], 'sb-league-women': [1, 'w'], 'nlb-women': [2, 'w'],
  /* Czechia */ 'czech-nbl': [1, 'm'], 'czech-1-liga': [2, 'm'], 'czech-zbl': [1, 'w'],
  /* Germany */ 'bbl': [1, 'm'], 'proa': [2, 'm'], 'prob': [3, 'm'],
  /* Denmark */ 'basketligaen': [1, 'm'], 'kvinde-basketligaen': [1, 'w'],
  /* Estonia + Latvia */ 'estonian-latvian-basketball-league': [1, 'm'],
  /* Spain */ 'liga-endesa': [1, 'm'], 'primera-feb': [2, 'm'], 'segunda-feb': [3, 'm'], 'liga-u': ['y1', 'm'],
               'liga-femenina-endesa': [1, 'w'], 'liga-femenina-challenge': [2, 'w'], 'liga-femenina-2': [3, 'w'],
  /* Europe */ 'euroleague': [1, 'm'], 'eurocup': [2, 'm'], 'basketball-champions-league': [2, 'm'], 'fiba-europe-cup': [3, 'm'],
  /* Finland */ 'korisliiga': [1, 'm'], 'i-divisioona-a': [2, 'm'], 'i-divisioona-b': [3, 'm'], 'naisten-korisliiga': [1, 'w'],
  /* France */ 'lnb-elite': [1, 'm'], 'lnb-elite-2': [2, 'm'], 'lnb-espoirs-elite': ['y1', 'm'], 'lnb-espoirs-elite-2': ['y2', 'm'],
  /* Great Britain */ 'slb-men': [1, 'm'], 'bcb': [2, 'm'], 'nbl-d1': [3, 'm'], 'eabl': ['y1', 'm'],
                     'slb-women': [1, 'w'], 'wnbl-d1': [2, 'w'], 'weabl': ['y1', 'w'],
  /* Greece */ 'greek-elite-league': [2, 'm'],
  /* Hungary */ 'hungarian-nb-i-a': [1, 'm'], 'hungarian-nb-i-a-women': [1, 'w'],
  /* Israel */ 'winner-league': [1, 'm'],
  /* Italy */ 'lega-basket-serie-a': [1, 'm'], 'serie-a1-femminile': [1, 'w'], 'serie-a2-femminile': [2, 'w'],
  /* Japan */ 'b-league-premier': [1, 'm'], 'b-league-one': [2, 'm'], 'w-league-premier': [1, 'w'], 'w-league-future': [2, 'w'],
  /* South Korea */ 'kbl': [1, 'm'],
  /* Lithuania */ 'lkl': [1, 'm'], 'nkl': [2, 'm'],
  /* North Macedonia */ 'macedonian-super-league': [1, 'm'],
  /* Mexico */ 'lnbp': [1, 'm'], 'cibacopa': [2, 'm'],
  /* Poland */ 'orlen-basket-liga': [1, 'm'], '1-liga-mezczyzn': [2, 'm'], '1-liga-kobiet': [2, 'w'],
  /* Romania */ 'lnbm': [1, 'm'], 'lnbf': [1, 'w'],
  /* Sweden */ 'basketligan': [1, 'm'], 'basketligan-dam': [1, 'w'],
  /* Slovakia */ 'slovak-sbl': [1, 'm'],
  /* Adriatic */ 'aba-league': [1, 'm'], 'aba-league-2': [2, 'm'], 'aba-u19-league': ['y1', 'm'],
  /* United States */ 'ncaa-d2-men': ['uni', 'm'], 'ncaa-d2-women': ['uni', 'w'],
  /* Kosovo */ 'kosovo-superliga': [1, 'm']
};
/* LEAGUES SHOWN AS ONE GROUP (2026-10-14). NCAA Division II is ~300 schools in ~23 conferences a gender, 140 games a
   side on a Saturday: listed like any league it would be the whole of HOME. It is shown like a COUNTRY instead - one
   "NCAA D2" block - with its conferences inside it like leagues (Men's, then Women's), and the games inside those.
   key: the group; part: this league's half of it; the conferences are its competitions' groups
   (competition_teams.group_name, from the feed). */
window.EPINOIA_LEAGUE_GROUPS = {
  'ncaa-d2-men':   { key: 'ncaa-d2', name: 'NCAA D2', part: 'Men' },
  'ncaa-d2-women': { key: 'ncaa-d2', name: 'NCAA D2', part: 'Women' }
};
window.epinoiaLeagueGroup = function (league) {
  return (window.EPINOIA_LEAGUE_GROUPS || {})[(league || {}).slug] || null;
};
/* { tier, side ('men' | 'women'), youth (an under-age league), rank (the order: 1, 2, 3 ..., then youth tiers 51, 52 ...,
   university 60, none 90), label ('Tier 1', 'Youth Tier 1', 'University' or '') } */
window.epinoiaLeagueTier = function (league) {
  const l = league || {};
  const t = (window.EPINOIA_LEAGUE_TIERS || {})[l.slug] || null;
  const tier = t ? t[0] : null;
  const side = l.gender === 'women' ? 'women' : l.gender === 'men' ? 'men' : t && t[1] === 'w' ? 'women' : 'men';
  const num = typeof tier === 'number', y = /^y(\d)$/.exec(String(tier || ''));
  return { tier, side, youth: !!y, rank: num ? tier : y ? 50 + Number(y[1]) : tier === 'uni' ? 60 : 90,
           label: num ? 'Tier ' + tier : y ? 'Youth Tier ' + y[1] : tier === 'uni' ? 'University' : '' };
};
/* A COUNTRY'S LEAGUES IN ORDER: tier 1 first, and at each tier the men's league before the women's, then by name */
window.epinoiaLeagueOrder = function (a, b) {
  const A = window.epinoiaLeagueTier(a), B = window.epinoiaLeagueTier(b);
  return A.rank - B.rank || (A.side === 'women') - (B.side === 'women') ||
    String((a && a.name) || '').localeCompare(String((b && b.name) || ''));
};
window.epinoiaLeagueBadge = function (league, opts) {
  const o = opts || {}; const l = league || {};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const hex = v => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : null);
  const full = String(l.name || l.slug || 'League').trim();
  /* opts.fit: the name that fits a card (epinoiaLeagueFit), the full name in its title */
  const name = o.fit ? window.epinoiaLeagueFit(l, typeof o.fit === 'number' ? o.fit : 12) : full;
  const words = full.split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w));
  const mono = (words.length >= 2 ? words.slice(0, 3).map(w => w[0]).join('')
    : full.slice(0, 3)).toUpperCase();
  const own = l.colour_source === 'logo' || l.colour_source === 'manual';
  const a = own && hex(l.colour_a), b = own && hex(l.colour_b);
  const style = a ? ' style="--lgb-a:' + a + ';--lgb-b:' + (b || a) + '"' : '';
  const url = window.epinoiaLogoUrl ? window.epinoiaLogoUrl(l.logo_path) : null;
  const tile = '<span class="lgb-tile" data-mono="' + esc(mono) + '"' + style + '>' +
    (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" decoding="async">'
         : '<span class="lgb-mono">' + esc(mono) + '</span>') + '</span>';
  const cls = 'lgb' + (o.small ? ' sm' : '') + (o.cls ? ' ' + esc(o.cls) : '');
  return '<span class="' + cls + '"' + (o.noName || name !== full ? ' title="' + esc(full) + '"' : '') + '>' + tile +
    (o.noName ? '' : '<span class="lgb-name"' + (l.name || l.slug ? ' translate="no"' : '') + (o.fit ? ' data-full="' + esc(full) + '"' : '') +
      (name !== full ? ' aria-label="' + esc(full) + '"' : '') + '>' + esc(name) + '</span>') + '</span>';
};

/* ============================================================================
   A HUNG REQUEST MUST NOT TAKE THE GAME WITH IT.

   Every frame the scorer publishes goes through one promise chain, on purpose:
   a retraction must not overtake the write that replaces it. That chain is only
   as quick as the request at its head, and nothing was putting a limit on one.

   A sports hall's access point does not usually fail by refusing a connection.
   It accepts the TCP handshake and then stops answering -- a captive portal
   wanting re-authentication, a saturated uplink, a handover between two APs
   with the same name. The fetch then sits open for the BROWSER's timeout, which
   is minutes on Chrome and on some iOS builds is effectively forever. For all
   of that time the chain is stopped, every subsequent play queues behind it, the
   badge still says live because the socket is a different connection, and the
   statistician has no reason to think anything is wrong.

   Fifteen seconds is far past any healthy round trip and far short of minutes.
   An abort is CHEAP here and that is what makes the number safe to pick: the
   rejected send is caught by deliver(), the frame goes on the backlog, and it is
   retried in order -- and every durable write is idempotent, the event upsert on
   conflict and the state row on game_id, so a write that actually landed before
   the abort costs nothing when it is sent again.

   Only the game's own traffic. Storage moves files -- a reel off a phone is
   legitimately minutes -- and an edge function may be finalising a game, which
   computes a season's awards and writes a match report. Neither is in front of
   a live score, and a deadline on either would break something that works. */
const FETCH_DEADLINE_MS = 15000;
const DEADLINED = /\/(rest|realtime)\/v1\//;

function deadlinedFetch(u, o) {
  const url = typeof u === 'string' ? u : ((u && u.url) || '');
  if (!DEADLINED.test(url)) return fetch(u, o);

  const ctl = new AbortController();
  const t = setTimeout(() => { try { ctl.abort(); } catch (_) {} }, FETCH_DEADLINE_MS);

  /* supabase-js passes its own signal on some paths (.abortSignal(), auth's
     own cancellation). Replacing it outright would quietly disable those, so
     ours is combined with whatever the caller already had. */
  const caller = o && o.signal;
  let signal = ctl.signal;
  if (caller) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
      signal = AbortSignal.any([caller, ctl.signal]);
    } else if (caller.aborted) {
      try { ctl.abort(); } catch (_) {}
    } else {
      caller.addEventListener('abort', () => { try { ctl.abort(); } catch (_) {} }, { once: true });
    }
  }

  return fetch(u, Object.assign({}, o, { signal }))
    .then(r => { clearTimeout(t); return r; },
          e => { clearTimeout(t); throw e; });
}

window.epinoiaClient = function () {
  const c = window.EPINOIA_CONFIG;
  if (window.__sb) return window.__sb;
  if (!c.supabaseAnonKey || !window.supabase) return null;
  window.__sb = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    realtime: { params: { eventsPerSecond: 20 } },
    global: { fetch: deadlinedFetch }
  });
  return window.__sb;
};

/* ============================================================================
   SIGNING OUT, PROPERLY.

   sb.auth.signOut() posts to the server and then clears local storage, and it
   is the SERVER call that can fail — offline, a dead token, a 5xx. When it
   does, some versions leave the stored session behind and the page still holds
   a token for an account the user believes they have left. Signing in as
   somebody else then lands on top of a half-cleared state, which is how
   "logged out, logged in as another account, still shows the first one"
   happens.

   So the local half is done unconditionally afterwards, whatever the server
   said. Being signed out locally when the server disagrees is recoverable —
   the next request 401s and the page asks for a sign-in. The reverse, holding
   a session the user thinks they dropped, is not.

   scope:'local' is deliberate: this signs out THIS browser and leaves other
   devices alone, which is what a sign-out button on a shared laptop should do.
   ============================================================================ */
window.epinoiaSignOut = async function (sb) {
  const client = sb || (window.epinoiaClient && window.epinoiaClient());
  try { if (client) await client.auth.signOut({ scope: 'local' }); }
  catch (e) { console.warn('[signout] server call failed, clearing locally', e); }

  /* Whatever happened above, leave nothing behind that looks like a session. */
  try {
    const ref = (window.EPINOIA_CONFIG.supabaseUrl.match(/^https?:\/\/([^.]+)\./) || [])[1];
    if (ref) localStorage.removeItem('sb-' + ref + '-auth-token');
    Object.keys(localStorage)
      .filter(k => /^sb-.*-auth-token/.test(k))
      .forEach(k => localStorage.removeItem(k));
  } catch (_) { /* storage unavailable is not a reason to fail a sign-out */ }

  /* What wins keeps a member's files in this tab's sessionStorage under
     epinoia_ww:<user>:… (winfile.js). A sign-out on a page that never loaded
     winfile.js would otherwise leave them for whoever uses the tab next. */
  try {
    const gone = [];
    for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k && k.indexOf('epinoia_ww:') === 0) gone.push(k); }
    gone.forEach(k => sessionStorage.removeItem(k));
  } catch (_) { /* nothing kept, or storage blocked */ }

  /* The Transfer matrix keeps a member's copy of its files in this browser's
     IndexedDB, epinoia_transfer (transferdata.js). Signing out deletes it,
     whichever page it happens on. */
  try {
    if (window.EpinoiaTransferData && window.EpinoiaTransferData.clear) window.EpinoiaTransferData.clear();
    else if (window.indexedDB) window.indexedDB.deleteDatabase('epinoia_transfer');
  } catch (_) { /* nothing kept, or storage blocked */ }

  /* Tell this tab. The browser's storage event only reaches OTHER tabs, so
     without this the rail in this one would wait for its next poll. */
  try { window.dispatchEvent(new Event('epinoia:auth')); } catch (_) {}
  return true;
};

/* ----------------------------------------------------------------------------
   THE SDK, FETCHED ONLY WHEN SOMETHING NEEDS IT.

   vendor/supabase.js is 207kB — half the JavaScript on the platform's front
   page — and that page uses it for exactly one thing: the sign-in box on the
   splash. Every read it performs goes through plain fetch against PostgREST,
   because anonymous reads need a URL and an apikey header and nothing else. A
   league's front page (?l=slug) does not use the SDK at all.

   It was a plain script tag, so home.js could not run until it had arrived and
   been parsed. Measured: the first API request of a league page did not leave
   the browser until 3.1 seconds in, on localhost.

   So it is loaded on demand. Callers that need auth ask for it and get a
   promise; callers that only read never pay for it. One in-flight promise is
   shared, so two callers asking at once inject one script tag.

   Pages that are all authentication — the admin console, the club portal, the
   scorer — keep their static script tag. There is nothing to defer there: the
   SDK is the point of the page, and making it lazy would only move the wait. */
let sdk = null;
window.epinoiaSdk = function () {
  if (window.supabase) return Promise.resolve(window.supabase);
  if (sdk) return sdk;
  sdk = new Promise((resolve, reject) => {
    /* The version stamp is read off this file's own URL so the SDK cannot be
       served from a stale cache while everything around it is fresh — one
       deploy, one version, no combination of the two. */
    let v = '', beside = '';
    try {
      const me = document.querySelector('script[src*="config.js"]');
      const q = me && me.getAttribute('src').split('?')[1];
      if (q) v = '?' + q;
      /* THE SDK LIVES BESIDE config.js, WHEREVER THE PAGE IS. "vendor/supabase.js" relative to a page in a folder (/epinoia/p/)
         is /epinoia/p/vendor/supabase.js, which is nothing: on the player page every lazy load failed, so a platform
         administrator was never offered the edit-links panel there. The page reached this file by its own path, so the
         SDK is the same path with the file name changed. */
      const src = me && me.getAttribute('src').split('?')[0];
      if (src && /config\.js$/.test(src)) beside = src.replace(/config\.js$/, 'vendor/supabase.js');
    } catch (_) { /* unstamped is still correct, just cacheable for longer */ }

    const s = document.createElement('script');
    /* A path set in the configuration wins; else beside config.js; else relative to the document, as the static tags are. */
    s.src = (window.EPINOIA_CONFIG.sdkPath || beside || 'vendor/supabase.js') + v;
    s.async = true;
    s.addEventListener('load', () => resolve(window.supabase));
    s.addEventListener('error', () => {
      sdk = null;                     // a retry should be a real attempt
      reject(new Error('the Supabase SDK could not be loaded'));
    });
    document.head.appendChild(s);
  });
  return sdk;
};

/* IS THERE A SESSION AT ALL?

   A look at the SDK's own storage key (sb-<project-ref>-auth-token), so a page
   can decide whether it is worth loading the SDK to ask the question properly.
   Most readers of most pages are signed out, and fetching the whole client to
   discover that is a request and a parse for nothing.

   IT ANSWERS "MAYBE", NEVER "YES". A token that has expired, been revoked or
   belongs to an account with no rights all look the same from here, so nothing
   may be shown or allowed on the strength of it — every answer that matters
   comes back from the database. */
window.epinoiaMaybeSignedIn = function () {
  try {
    const m = String((window.EPINOIA_CONFIG || {}).supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
    if (!m) return false;
    const raw = localStorage.getItem('sb-' + m[1] + '-auth-token');
    if (!raw) return false;
    const j = JSON.parse(raw);
    return !!(j && (j.access_token || (j.currentSession && j.currentSession.access_token)));
  } catch (_) { return false; }
};

/* The client, once the SDK is there. Callers that cannot proceed without auth
   should await this; window.epinoiaClient() stays synchronous for the pages
   that load the SDK up front. */
window.epinoiaClientReady = async function () {
  try { await window.epinoiaSdk(); } catch (_) { return null; }
  return window.epinoiaClient();
};

/* THE CLIENT FOR WHOEVER MIGHT BE SIGNED IN (2026-10-15): null at once for a reader with no session on file (no SDK
   fetched), else the SDK loaded on demand and its client. For a page that no longer loads the SDK up front (the club
   page: its 55 KB tag held every read of the page back by about three seconds), in place of the synchronous
   epinoiaClient() an editing control used to ask. */
window.epinoiaSignedClient = async function () {
  if (window.__sb) return window.__sb;
  if (typeof window.epinoiaMaybeSignedIn === 'function' && !window.epinoiaMaybeSignedIn()) return null;
  return window.epinoiaClientReady();
};

/* Which transport should a page use? ?mode= wins, then the key's presence. */
window.epinoiaMode = function () {
  const q = new URLSearchParams(location.search).get('mode');
  if (q === 'local' || q === 'supabase') return q;
  const c = window.EPINOIA_CONFIG;
  return c.supabaseAnonKey ? 'supabase' : c.defaultMode;
};

/* ============================================================================
   A DISABLED ACCOUNT IS SIGNED OUT, AND TOLD WHY (migration 0230).

   Disabling an account in the platform console stops it signing in, ends its
   sessions, and the database refuses every signed-in request it makes
   (api_gate). This is the page's half: a signed-in page asks account_status()
   when it opens, when the tab comes back, when the session changes and every
   ten minutes while it stays open. An account that has been disabled, or that
   is on a network the console blocked, is signed out here and now, and a box
   says why. The answer is remembered for a minute in this tab, so moving from
   page to page costs nothing.

   The same words for GoTrue's refusal at sign-in: epinoiaAuthText(message).
   ============================================================================ */
window.epinoiaAuthText = function (m) {
  const s = String((m && m.message) || m || '');
  if (/banned/i.test(s)) return 'This account has been disabled, so it cannot sign in. If you think that is a mistake, contact us.';
  return s;
};

(function accountStatus() {
  if (typeof document === 'undefined' || typeof location === 'undefined' || typeof fetch !== 'function'
      || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  if (/\/embed\//.test(location.pathname)) return;
  const here = document.currentScript && document.currentScript.src;
  const contact = (() => { try { return new URL('contact/', here || location.href).href; } catch (_) { return '/epinoia/contact/'; } })();
  const SEEN = 'epinoia_acct_ok', SAID = 'epinoia_acct_refused';
  let busy = false, off = false;

  function token() {
    try {
      const m = String((window.EPINOIA_CONFIG || {}).supabaseUrl || '').match(/^https?:\/\/([^.]+)\./);
      const j = m && JSON.parse(localStorage.getItem('sb-' + m[1] + '-auth-token') || 'null');
      return (j && (j.access_token || (j.currentSession && j.currentSession.access_token))) || null;
    } catch (_) { return null; }
  }
  function seen() { try { return JSON.parse(sessionStorage.getItem(SEEN) || 'null') || {}; } catch (_) { return {}; } }

  const WORDS = {
    disabled: ['This account has been disabled',
               'It has been signed out, and it cannot sign in again or use the parts of EPINOIA that need an account.'],
    blocked:  ['Accounts can’t be used from this network',
               'Signing in from the network you are on has been blocked, so this account has been signed out.'],
    gone:     ['This account no longer exists',
               'It has been deleted, so it has been signed out.']
  };
  function tell(why) {
    if (!document.body) { document.addEventListener('DOMContentLoaded', () => tell(why)); return; }
    if (document.querySelector('.ep-refused')) return;
    const w = WORDS[why] || WORDS.disabled;
    if (!document.getElementById('ep-refused-css')) {
      const st = document.createElement('style'); st.id = 'ep-refused-css';
      st.textContent =
        '.ep-refused{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgba(2,8,5,.72);backdrop-filter:blur(3px)}' +
        '.ep-refused .box{max-width:420px;width:100%;background:var(--panel,#0a1a13);color:var(--ink,#e6fff1);border:1px solid var(--rule-2,rgba(147,242,191,.44));' +
        'border-radius:14px;padding:22px 22px 18px;text-align:center;font-family:var(--f-ui,system-ui,sans-serif);box-shadow:0 18px 60px rgba(0,0,0,.5)}' +
        '.ep-refused svg{width:64px;height:64px;color:var(--flare,#ff5f6b);margin:0 auto 10px;display:block}' +
        '.ep-refused h2{margin:0 0 8px;font:700 18px/1.25 var(--f-ui,system-ui,sans-serif)}' +
        '.ep-refused p{margin:0 0 8px;font-size:14px;line-height:1.5;color:var(--ink-3,rgba(230,255,241,.84))}' +
        '.ep-refused .row{display:flex;gap:8px;justify-content:center;margin-top:14px;flex-wrap:wrap}' +
        '.ep-refused a,.ep-refused button{font:600 13px/1 var(--f-ui,system-ui,sans-serif);padding:10px 16px;border-radius:999px;cursor:pointer;text-decoration:none;' +
        'border:1px solid var(--rule-2,rgba(147,242,191,.44));background:transparent;color:var(--ink,#e6fff1)}' +
        '.ep-refused button{background:var(--lume,#93f2bf);color:var(--on-accent,#04100b);border-color:transparent}';
      document.head.appendChild(st);
    }
    const veil = document.createElement('div');
    veil.className = 'ep-refused';
    veil.setAttribute('role', 'alertdialog'); veil.setAttribute('aria-modal', 'true');
    veil.setAttribute('aria-labelledby', 'ep-refused-h'); veil.setAttribute('aria-describedby', 'ep-refused-p');
    veil.innerHTML =
      '<div class="box"><svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="4">' +
      '<circle cx="32" cy="32" r="26"/><path d="M14 50 50 14"/>' +
      (why === 'blocked' ? '<path d="M20 30a17 17 0 0 1 24 0M25 37a9 9 0 0 1 14 0" stroke-width="3"/><circle cx="32" cy="44" r="2.5" fill="currentColor" stroke="none"/>'
                         : '<rect x="23" y="30" width="18" height="14" rx="2" stroke-width="3"/><path d="M27 30v-5a5 5 0 0 1 10 0v5" stroke-width="3"/>') +
      '</svg><h2 id="ep-refused-h"></h2><p id="ep-refused-p"></p>' +
      '<p>Everything public, from scores and tables to players and clubs, is still open to you. If you think this is a mistake, contact us.</p>' +
      '<div class="row"><a class="ct"></a><button type="button">OK</button></div></div>';
    veil.querySelector('h2').textContent = w[0];
    veil.querySelector('#ep-refused-p').textContent = w[1];
    const a = veil.querySelector('a.ct'); a.href = contact; a.textContent = 'Contact us';
    const close = () => { veil.remove(); try { sessionStorage.removeItem(SAID); } catch (_) {} };
    veil.querySelector('button').addEventListener('click', close);
    veil.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.appendChild(veil);
    veil.querySelector('button').focus();
  }

  async function check(timer) {
    if (busy || off) return;
    const t = token();
    if (!t) return;
    const mark = t.slice(-24), s = seen();
    if (s.t === mark && Date.now() - (s.at || 0) < (timer ? 600000 : 60000)) return;
    const c = window.EPINOIA_CONFIG || {};
    if (!c.supabaseUrl || !c.supabaseAnonKey) return;
    busy = true;
    try {
      const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/account_status', {
        method: 'POST', body: '{}',
        headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }
      });
      if (r.status === 404) { off = true; return; }     // the database has not had 0230 yet
      if (!r.ok) return;                                // an expired token, a hiccup: nothing to say
      const a = await r.json();
      const why = a && (a.disabled ? 'disabled' : a.blocked ? 'blocked' : a.gone ? 'gone' : null);
      if (!why) { try { sessionStorage.setItem(SEEN, JSON.stringify({ t: mark, at: Date.now() })); } catch (_) {} return; }
      try { sessionStorage.removeItem(SEEN); sessionStorage.setItem(SAID, why); } catch (_) {}
      try { if (window.epinoiaSignOut) await window.epinoiaSignOut(); } catch (_) {}
      tell(why);
    } catch (_) { /* offline */ }
    finally { busy = false; }
  }
  window.epinoiaAccountCheck = check;

  /* said on the page that signed out, and once more if that page moved on before it could be read */
  try { const said = sessionStorage.getItem(SAID); if (said && !token()) tell(said); } catch (_) {}
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => check());
  else check();
  window.addEventListener('focus', () => check());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  window.addEventListener('storage', e => { if (e.key && e.key.indexOf('-auth-token') !== -1) check(); });
  setInterval(() => check(true), 20000);
})();
