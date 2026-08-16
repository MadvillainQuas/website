'use strict';
/* ============================================================================
   The fixture strip — a horizontal bar of games for another site's page.

   Modelled on the LiveStats widget: a brand plate, then a scrolling rail of
   cards each carrying the competition, the state, both teams and when.

   Three things it must get right, because it runs on a page we do not control:

   LIVE GAMES COME FIRST, then upcoming, then finished. A strip is glanced at,
   not read, and the thing worth glancing at is what is happening now.

   IT REFRESHES ITSELF. An embed is left on a page for hours. Scores are polled
   rather than socketed — one small query a minute costs nothing and needs no
   connection held open per visitor, which matters when the widget is on a page
   with more traffic than this platform has.

   IT REPORTS ITS HEIGHT. The host page cannot know how tall this wants to be,
   so it is posted out and embed.js applies it.
   ============================================================================ */

const CFG = window.COURTSIDE_CONFIG;
const qp = new URLSearchParams(location.search);
const wantLeague = qp.get('l') || '';
const limit = Math.min(parseInt(qp.get('n'), 10) || 12, 40);
const POLL_MS = 60000;

const $ = s => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

/* a three-letter code is what fits a card; prefer the club's own abbreviation */
const abbr = t => ((t && (t.short_name || t.name)) || '???')
  .replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 3).toUpperCase();

async function api(p) {
  const r = await fetch(`${CFG.supabaseUrl}/rest/v1/${p}`,
    { cache: 'no-store', headers: { apikey: CFG.supabaseAnonKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

function fmtDate(iso) {
  if (!iso) return 'TBC';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
    .replace(/^0/, '').toUpperCase();
}

function card(g) {
  const live = g.status === 'live', final = g.status === 'final';
  const a = document.createElement('a');
  a.className = 'cs-card';
  a.target = '_blank'; a.rel = 'noopener';
  a.href = new URL('../../game/?g=' + encodeURIComponent(g.id) + '&mode=supabase',
                   location.href).href;

  const hd = el('div', 'hd');
  const comp = (g.competitions && g.competitions.name) || 'Fixture';
  hd.appendChild(el('span', 'comp', comp));
  const st = el('span', 'st ' + (live ? 'live' : final ? 'final' : 'upcoming'));
  if (live) { st.appendChild(el('span', 'dot')); st.appendChild(document.createTextNode('LIVE')); }
  else st.textContent = final ? 'FINAL' : 'UPCOMING';
  hd.appendChild(st);
  a.appendChild(hd);

  const showScore = live || final;
  [[g.home, g.home_score, 0], [g.away, g.away_score, 1]].forEach(([t, sc]) => {
    const other = t === g.home ? g.away_score : g.home_score;
    const side = el('div', 'side' +
      (final ? (sc > other ? ' win' : sc < other ? ' lose' : '') : ''));
    const cr = el('span', 'crest', abbr(t).slice(0, 2));
    cr.style.background = (t && t.colour) || '#93f2bf';
    side.append(cr, el('span', 'abbr', abbr(t)));
    if (showScore) side.appendChild(el('span', 'sc', sc == null ? '0' : String(sc)));
    a.appendChild(side);
  });

  const ft = el('div', 'ft');
  ft.appendChild(el('span', 'vn', live ? (g.venue || 'in progress') : fmtDate(g.tipoff_at)));
  ft.appendChild(el('span', null, live ? 'watch' : fmtTime(g.tipoff_at)));
  a.appendChild(ft);
  return a;
}

/* live first, then what is coming, then what is done — a strip is glanced at */
const RANK = { live: 0, scheduled: 1, final: 2 };
function order(a, b) {
  const r = RANK[a.status] - RANK[b.status];
  if (r) return r;
  const ta = new Date(a.tipoff_at || 0), tb = new Date(b.tipoff_at || 0);
  return a.status === 'final' ? tb - ta : ta - tb;   // upcoming ascending, finished descending
}

let lastKey = '';

async function load() {
  let sel = 'games?select=id,tipoff_at,status,venue,home_score,away_score,' +
    'home:home_team_id(name,short_name,colour),away:away_team_id(name,short_name,colour),' +
    'competitions(name,seasons(leagues(slug,name)))' +
    '&status=in.(live,scheduled,final)&order=tipoff_at.desc&limit=60';

  let gs;
  try { gs = await api(sel); }
  catch (e) {
    if (!lastKey) {           // keep whatever is on screen if a refresh fails
      $('#rail').textContent = '';
      $('#rail').appendChild(el('div', 'cs-empty', 'Fixtures unavailable'));
    }
    return;
  }

  if (wantLeague) {
    gs = gs.filter(g => {
      const l = g.competitions && g.competitions.seasons && g.competitions.seasons.leagues;
      return l && l.slug === wantLeague;
    });
  }
  gs.sort(order);
  gs = gs.slice(0, limit);

  /* only touch the DOM when something actually changed — this repaints every
     minute, and a strip that flickers on someone's homepage is worse than one
     that is a few seconds stale */
  const key = gs.map(g => g.id + ':' + g.status + ':' + g.home_score + '-' + g.away_score).join('|');
  if (key === lastKey) return;
  lastKey = key;

  const rail = $('#rail');
  rail.textContent = '';
  if (!gs.length) { rail.appendChild(el('div', 'cs-empty', 'No fixtures')); }
  else gs.forEach(g => rail.appendChild(card(g)));
  arrows();
  postHeight();
}

/* ------------------------------------------------------------------ chrome --- */
function arrows() {
  const rail = $('#rail');
  const over = rail.scrollWidth > rail.clientWidth + 4;
  $('#left').hidden = !over || rail.scrollLeft <= 2;
  $('#right').hidden = !over || rail.scrollLeft >= rail.scrollWidth - rail.clientWidth - 2;
}
$('#left').addEventListener('click', () => $('#rail').scrollBy({ left: -440, behavior: 'smooth' }));
$('#right').addEventListener('click', () => $('#rail').scrollBy({ left: 440, behavior: 'smooth' }));
$('#rail').addEventListener('scroll', arrows, { passive: true });
window.addEventListener('resize', arrows, { passive: true });

/* the host page cannot know how tall this wants to be, so tell it */
function postHeight() {
  try {
    const h = Math.max(104, document.querySelector('.cs-strip').offsetHeight);
    parent.postMessage({ courtsideEmbed: 'height', height: h }, '*');
  } catch (_) {}
}

if (wantLeague) $('#plate').href = new URL('../../l/?l=' + encodeURIComponent(wantLeague),
                                           location.href).href;
load();
setInterval(load, POLL_MS);
setTimeout(postHeight, 400);
