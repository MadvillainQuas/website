'use strict';
/* ============================================================================
   LINKED CLUBS AND PEOPLE, ON THE PUBLIC PAGES (migration 0178; the console's Links tab makes the links).

   A team page for a club that plays in more than one competition -- London Lions in the SLB, in the
   EuroCup and the women's side -- gets a button at the top that opens the club's other competitions and
   seasons; a team page for a women's side carries a WOMEN indicator beside its league, and one for a youth side
   (Liga U, an academy, an U19 team) a YOUTH indicator, or its age group. A player's profile
   offers the other rows that are the same person, and his career table runs across all of them.

   Nothing here is required: a page whose club or player is linked to nothing shows nothing new, and a
   database that has not had 0178 yet answers the two calls with an error, which is treated as "no links".
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLinks = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
/* a club's, league's or player's name is never translated */
const nm = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };

/* A PLAIN REQUEST, NOT THE SDK: the player page does not load supabase-js (it reads through fetch), and these are two small
   public reads that need no session. A page that has not had migration 0178 answers 404, which is "no links". */
async function call(name, args) {
  const c = root.EPINOIA_CONFIG;
  if (!c || !c.supabaseUrl || !c.supabaseAnonKey || typeof fetch !== 'function') return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), 6000) : null;
  try {
    const r = await fetch(c.supabaseUrl + '/rest/v1/rpc/' + name, {
      method: 'POST', signal: ctl ? ctl.signal : undefined,
      headers: { apikey: c.supabaseAnonKey, Authorization: 'Bearer ' + c.supabaseAnonKey, 'content-type': 'application/json' },
      body: JSON.stringify(args || {}) });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; } finally { if (t) clearTimeout(t); }
}

/* ---------------------------------------------------------------- pure --- */

/* A SIDE THAT LOOKS LIKE A WOMEN'S TEAM by what it and its league are called -- the same words and the same folding as the
   database's team_is_women (0178), so the indicator shows before that migration is applied and agrees with it after */
const WOMEN_RE = /(^| )(women|womens|woman|female|ladies|feminin|feminine|femenina|femenino|femminile|damen|frauen|dames|vrouwen|wnba|wnbl|wjbl|lfb|kadinlar|kobiet|w league)( |$)/;
function foldName(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-￿]+/g, ' ').trim();
}
const looksWomen = (...parts) => WOMEN_RE.test(foldName(parts.join(' ')));

/* A YOUTH SIDE by what it and its league are called (0181's link_looks_youth and link_youth_age, word for word): the word
   in English and the leagues' languages, an academy or a junior side, "Liga U", an age (U19, U-21, Under 18, Sub-20; 12 to 25) */
const YOUTH_RE = /(^| )(youth|junior|juniors|juniorit|junioren|juvenil|juveniles|cadete|cadetes|infantil|academy|academia|akademie|nachwuchs|jugend|jeunes|espoirs|espoir|primavera|jong|liga u|((u|under|sub) ?(1[2-9]|2[0-5])))( |$)/;
const AGE_RE = /(^| )(u|under|sub) ?(1[2-9]|2[0-5])( |$)/;
const looksYouth = (...parts) => YOUTH_RE.test(foldName(parts.join(' ')));
const youthAge = (...parts) => { const m = AGE_RE.exec(foldName(parts.join(' '))); return m ? 'U' + m[3] : null; };

/* the distinct season names across a list of team cards, newest first */
function seasonsAcross(cards) {
  const seen = [];
  (cards || []).forEach(c => (c.competitions || []).forEach(k => { if (k.season && seen.indexOf(k.season) < 0) seen.push(k.season); }));
  return seen.sort().reverse();
}
/* a card's competitions grouped by season, newest first: [{ season, names: [...] }] */
function bySeason(card, only) {
  const map = new Map();
  ((card && card.competitions) || []).forEach(k => {
    if (only && k.season !== only) return;
    if (!map.has(k.season)) map.set(k.season, []);
    if (map.get(k.season).indexOf(k.name) < 0) map.get(k.season).push(k.name);
  });
  return [...map.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0]))).map(([season, names]) => ({ season, names }));
}
/* every profile id in a player's link group (himself included), or just his own */
function playerIds(linked, id) {
  const ids = ((linked && linked.players) || []).map(p => p.id).filter(Boolean);
  if (ids.indexOf(id) < 0) ids.unshift(id);
  return ids;
}
const teamHref = c => './?t=' + encodeURIComponent(c.slug || c.id);
const playerHref = c => './?p=' + encodeURIComponent(c.slug || c.id);
const womenChip = () => el('span', 'ls-women', 'women');
/* the age group when there is one (a name: never translated), else the word */
const youthChip = age => { const c = age ? nm('span', 'ls-youth', age) : el('span', 'ls-youth', 'youth'); c.title = 'a youth team'; return c; };

/* ------------------------------------------------------------ the popover --- */
/* a button that opens a small panel; closes on an outside press, Escape, or choosing a link */
function popover(label, count) {
  const wrap = el('span', 'ls-wrap');
  const b = wrap.appendChild(el('button', 'ls-btn'));
  b.type = 'button'; b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
  b.appendChild(el('span', 'ls-btn-t', label));
  if (count) b.appendChild(el('span', 'ls-btn-n', String(count)));
  b.appendChild(el('i', 'ls-chev'));
  const pop = wrap.appendChild(el('div', 'ls-pop')); pop.hidden = true;
  const set = open => { pop.hidden = !open; b.setAttribute('aria-expanded', String(open)); };
  b.addEventListener('click', e => { e.stopPropagation(); set(pop.hidden); });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) set(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  return { wrap, pop, set };
}

/* ------------------------------------------------------------- the team --- */
function teamSwitcher(linked, currentId) {
  const cards = (linked && linked.teams) || [];
  if (cards.length < 2) return null;
  const P = popover('competitions & seasons', cards.length);
  const head = P.pop.appendChild(el('div', 'ls-h'));
  head.appendChild(el('b', null, 'the same club in other competitions'));
  if (linked.group) head.appendChild(nm('span', 'ls-g', linked.group));
  const seasons = seasonsAcross(cards);
  let sel = null;
  if (seasons.length > 1) {
    sel = P.pop.appendChild(el('select', 'ls-season')); sel.setAttribute('aria-label', 'season');
    const all = el('option', null, 'all seasons'); all.value = ''; sel.appendChild(all);
    seasons.forEach(s => { const o = nm('option', null, s); o.value = s; sel.appendChild(o); });
  }
  const list = P.pop.appendChild(el('div', 'ls-list'));
  function draw() {
    const only = sel ? sel.value : '';
    list.textContent = '';
    cards.forEach(c => {
      const groups = bySeason(c, only);
      if (only && !groups.length) return;                          // that season: this side did not play
      const a = list.appendChild(el('a', 'ls-item' + (c.id === currentId ? ' on' : '')));
      a.href = teamHref(c);
      const top = a.appendChild(el('div', 'ls-top'));
      top.appendChild(nm('b', null, c.league || c.name));
      if (c.women) top.appendChild(womenChip());
      if (c.youth) top.appendChild(youthChip(c.age));
      if (c.id === currentId) top.appendChild(el('span', 'ls-here', 'you are here'));
      const sub = a.appendChild(el('div', 'ls-sub'));
      if (!groups.length) sub.appendChild(el('span', null, 'no competition yet'));
      groups.forEach(g => {
        const row = sub.appendChild(el('div', 'ls-row'));
        row.appendChild(nm('span', 'ls-s', g.season));
        row.appendChild(nm('span', 'ls-c', g.names.join(' · ')));
      });
    });
    if (!list.children.length) list.appendChild(el('div', 'ls-none', 'nothing in that season'));
  }
  if (sel) sel.addEventListener('change', draw);
  draw();
  return P.wrap;
}

/* asked once for the team page: its women and youth indicators and its links. Fills the header and returns what it found. */
async function paintTeam(team, o) {
  o = o || {};
  const [traits, linked] = await Promise.all([call('team_traits', { p_team: team.id }), call('linked_teams', { p_team: team.id })]);
  const self = linked && (linked.teams || []).find(c => c.id === team.id);
  const lg = team.leagues || {};
  const parts = [team.name, team.slug, lg.name, lg.slug];
  /* the database's answer when it has one (a hand-set flag outranks the names); the names themselves before it does */
  let women, youth, age;
  if (traits) { women = !!traits.women; youth = !!traits.youth; age = traits.age || null; }
  else if (self) { women = !!self.women; youth = !!self.youth; age = self.age || null; }
  else {
    const w = await call('team_is_women', { p_team: team.id });          // a database that has 0178 but not 0181
    women = w === true || (w === null && looksWomen(...parts));
    youth = looksYouth(...parts); age = youth ? youthAge(...parts) : null;
  }
  if (women) document.body.classList.add('is-women');
  if (youth) document.body.classList.add('is-youth');
  if (o.sub) {
    if (women) { const chip = womenChip(); chip.title = 'a women\'s team'; o.sub.appendChild(document.createTextNode(' ')); o.sub.appendChild(chip); }
    if (youth) { o.sub.appendChild(document.createTextNode(' ')); o.sub.appendChild(youthChip(age)); }
  }
  const sw = teamSwitcher(linked, team.id);
  if (sw && o.sub && o.sub.parentNode) { const row = el('div', 'ls-row-host'); row.appendChild(sw); o.sub.parentNode.appendChild(row); }
  return { women, youth, age, linked };
}

/* ----------------------------------------------------------- the player --- */
function playerSwitcher(linked, currentId) {
  const cards = (linked && linked.players) || [];
  if (cards.length < 2) return null;
  const P = popover('other profiles', cards.length - 1);
  const head = P.pop.appendChild(el('div', 'ls-h'));
  head.appendChild(el('b', null, 'the same player in other competitions'));
  const list = P.pop.appendChild(el('div', 'ls-list'));
  cards.forEach(c => {
    const a = list.appendChild(el('a', 'ls-item' + (c.id === currentId ? ' on' : '')));
    a.href = playerHref(c);
    const top = a.appendChild(el('div', 'ls-top'));
    top.appendChild(nm('b', null, c.name || '—'));
    if (c.id === currentId) top.appendChild(el('span', 'ls-here', 'you are here'));
    const sub = a.appendChild(el('div', 'ls-sub'));
    const seen = [];
    (c.spells || []).forEach(s => {
      const line = [s.team, s.league, s.season].filter(Boolean).join(' · ');
      if (!line || seen.indexOf(line) >= 0) return;
      seen.push(line);
      const row = sub.appendChild(el('div', 'ls-row'));
      row.appendChild(nm('span', 'ls-c', line));
      if (s.women) row.appendChild(womenChip());
    });
    if (!seen.length) sub.appendChild(el('span', null, 'no club yet'));
  });
  return P.wrap;
}

/* the promise for a profile's link group, started early so the career can wait for it */
function loadPlayer(playerId) { return call('linked_players', { p_player: playerId }); }
function paintPlayer(pl, linked, o) {
  const sw = playerSwitcher(linked, pl.id);
  if (sw && o && o.sub) o.sub.appendChild(sw);
  return sw;
}

return { paintTeam, looksWomen, looksYouth, youthAge, youthChip, teamSwitcher, playerSwitcher, loadPlayer, paintPlayer, playerIds, seasonsAcross, bySeason, womenChip, call };
}));
