'use strict';
/* ============================================================================
   LINKS — the platform console's tab for saying that two rows are one club, or one person
   (migration 0178). London Lions in the SLB, in the EuroCup and the women's side; a player who is
   "L Adekeye" in one feed and "Lewis Adekeye" in another. Nothing is merged: a link is a group the
   rows belong to, so a mistake is one click to undo and no game or stat line ever moves.

   THREE PARTS, for the clubs and, beside them, for the players:
     POSSIBLE MATCHES   what the data suggests, each one FLAGGED with how sure it is and why (the same
                        name in several leagues; the same first and last name with a middle name or
                        particle in one of them; a surname with an initial; birth years that agree or
                        clash; clubs already linked). A card's rows are ticked when the flag is high or
                        medium and left for a decision when it is low. Link the ticked ones, or say
                        "not the same" and the set is not suggested again (until a new member turns up).
     FIND AND LINK      type-ahead over thousands of rows, narrowed by league and season, picked into a
                        basket, linked together (a row already in a group brings its group).
     LINKED             every group, searchable, renamed in place, a row taken out with one click, another
                        added from a search inside the group's own card; a team's women's flag corrected.
     WHEN CLUBS ARE LINKED THEIR PLAYERS ARE TOO: the players whose names match across the linked clubs are
                        linked automatically (migration 0178, link_auto_players) and marked "auto", one click
                        undoes one and it is not made again; a club's card has a button to run it again.

   Every dropdown is one component (combo): type to search on the server, arrow keys and Enter, a click, a
   result that says the league, the seasons and whether it is a women's side; a stale answer never
   replaces a newer one. The database does the matching (0178): platform_link_suggestions / _search / _groups.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLinksUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
/* a name, a league, a season: data, never run through the translator */
const data = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };
const btn = (text, cls, fn) => { const b = el('button', 'ep-btn ' + (cls || 'mini'), text); b.type = 'button';
  if (fn) b.addEventListener('click', fn); return b; };

const PAGE = 25;
const SUB = '../../';                                    // the console is epinoia/admin/platform/

/* ---------------------------------------------------------------- pure --- */
const CONF = { high: 0, medium: 1, low: 2 };
const CONF_WORD = { high: 'high', medium: 'medium', low: 'low' };
const CONF_HELP = {
  high: 'the data agrees: link them unless you know better',
  medium: 'the name matches and nothing contradicts it: check before you link',
  low: 'something disagrees (a birth year, a league): only link if you are sure'
};
const KIND_WORD = { exact: 'same name', core: 'middle name ignored', short: 'initial + surname', ambiguous: 'initial: which one?' };

/* what to say after a link: "Linked 3 clubs. 8 players at those clubs were linked automatically." */
function linkedWords(kind, n, result, merged) {
  const noun = kind === 'team' ? 'club' : 'player';
  let t = 'Linked ' + n + ' ' + noun + 's' + (merged > 1 ? ' (' + merged + ' groups merged)' : '') + '.';
  const a = result && result.auto_players;
  if (kind === 'team' && a != null) t += ' ' + (a ? a + ' player' + (a === 1 ? '' : 's') + ' at those clubs ' + (a === 1 ? 'was' : 'were') + ' linked automatically.' : ' No players needed linking automatically.');
  return t;
}

const bySureness = (a, b) => (CONF[a.confidence] - CONF[b.confidence]) || 0;
/* the loaded suggestions narrowed to one confidence ('all' keeps every one) */
const narrowed = (rows, conf) => (conf && conf !== 'all' ? rows.filter(r => r.confidence === conf) : rows);
const tally = rows => rows.reduce((t, r) => { t[r.confidence] = (t[r.confidence] || 0) + 1; return t; }, { high: 0, medium: 0, low: 0 });

/* "2026-27, 2025-26" from a team card's competitions */
function seasonsOf(card) {
  const seen = [];
  ((card && card.competitions) || []).forEach(c => { if (c.season && seen.indexOf(c.season) < 0) seen.push(c.season); });
  return seen;
}
/* the places a player has been, one line each: "Newcastle Eagles · Super League Basketball Men · 2026-27" */
function spellLines(card, max) {
  const lines = [];
  ((card && card.spells) || []).forEach(s => {
    const line = [s.team, s.league, s.season].filter(Boolean).join(' · ');
    if (line && lines.indexOf(line) < 0) lines.push(line);
  });
  return { shown: lines.slice(0, max == null ? 3 : max), more: Math.max(0, lines.length - (max == null ? 3 : max)) };
}
const nameOf = c => (c && c.name) || '—';
const publicHref = (kind, c) => kind === 'team' ? SUB + 't/?t=' + encodeURIComponent(c.slug || c.id) : SUB + 'p/?p=' + encodeURIComponent(c.id);

/* ------------------------------------------------------------- combo --- */
/* A search box with a list under it. o = {
     placeholder, fetch(q) -> Promise<{rows, more}|rows>, render(row, li), pick(row), minChars, delay, openOnFocus, clearOnPick }
   The list is built from what the server says, so it can hold thousands of names behind it; only what
   fits the dropdown is ever drawn. Arrow keys move, Enter picks, Escape closes; a slow answer to an old
   query is dropped when a newer one has been asked. */
function combo(o) {
  const box = el('div', 'lk-combo');
  const input = box.appendChild(el('input', 'ep-input'));
  input.type = 'search'; input.placeholder = o.placeholder || 'type to search'; input.autocomplete = 'off';
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false');
  const list = box.appendChild(el('ul', 'lk-list')); list.hidden = true; list.setAttribute('role', 'listbox');
  let rows = [], active = -1, ask = 0, timer = null, more = false;
  const minChars = o.minChars == null ? 1 : o.minChars;

  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
  function mark(i) {
    active = i;
    [...list.children].forEach((li, k) => li.classList.toggle('on', k === i));
    const li = list.children[i]; if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  }
  function draw(res) {
    rows = res.rows || res || []; more = !!res.more;
    list.textContent = '';
    if (!rows.length) {
      list.appendChild(el('li', 'lk-none', input.value.trim() ? 'nothing matches' : 'nothing to show'));
    } else {
      rows.forEach((r, i) => {
        const li = list.appendChild(el('li', 'lk-opt')); li.setAttribute('role', 'option');
        o.render(r, li);
        /* pointerdown, not click: the input loses focus first and would close the list under the pointer */
        li.addEventListener('pointerdown', e => { e.preventDefault(); choose(r); });
        li.addEventListener('mousemove', () => { if (active !== i) mark(i); });
      });
      if (more) list.appendChild(el('li', 'lk-none', 'more matches: type more to narrow them'));
    }
    list.hidden = false; input.setAttribute('aria-expanded', 'true'); mark(rows.length ? 0 : -1);
  }
  async function run() {
    const q = input.value.trim(); const mine = ++ask;
    if (q.length < minChars && !(o.openOnFocus && !q)) { close(); return; }
    try {
      const res = await o.fetch(q);
      if (mine !== ask) return;                                  // a newer question has been asked
      draw(res);
    } catch (e) { if (mine === ask) { list.textContent = ''; list.appendChild(el('li', 'lk-none', 'the search failed: ' + ((e && e.message) || e))); list.hidden = false; } }
  }
  function choose(r) {
    close();
    if (o.clearOnPick !== false) input.value = '';
    o.pick(r);
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, o.delay == null ? 220 : o.delay); });
  input.addEventListener('focus', () => { if (o.openOnFocus || input.value.trim()) run(); });
  input.addEventListener('blur', () => { setTimeout(close, 120); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) run(); else mark(Math.min(rows.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); mark(Math.max(0, active - 1)); }
    else if (e.key === 'Enter') { if (!list.hidden && rows[active]) { e.preventDefault(); choose(rows[active]); } }
    else if (e.key === 'Escape') { close(); }
  });
  return { root: box, input, close, refresh: run, clear() { input.value = ''; close(); } };
}

/* ------------------------------------------------------------- state --- */
let S = null;

function rpc(name, args) {
  return S.sb.rpc(name, args || {}).then(r => { if (r.error) throw r.error; return r.data; });
}
const fail = e => { (S.oops || (x => S.say(x && x.message, 'err')))(e); };

function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return Promise.resolve();
  const keep = S && S.host === host ? S : null;
  S = { sb: o.sb, say: o.say || (() => {}), oops: o.oops, host,
        kind: (keep && keep.kind) || 'team', conf: 'all', sug: { rows: [], total: 0 }, groups: { rows: [], total: 0 },
        gq: '', gOffset: 0, basket: [], filters: { leagues: [], seasons: [] }, league: '', season: '' };
  host.textContent = '';
  host.setAttribute('data-i18n', 'off');
  host.appendChild(el('p', 'lead',
    'A club that plays in more than one competition (London Lions in the SLB, the EuroCup and the women\'s league) or a player ' +
    'who is written differently in two feeds is one row per feed. Link them here: nothing is merged, every game and stat line stays ' +
    'where it was written, and a link is undone with one click. The page for one of them then offers the others, and a player\'s ' +
    'career runs across them. When clubs are linked, the players whose names match across them are linked too, automatically (marked auto); ' +
    'anything doubtful is flagged below for you to check.'));
  const bar = host.appendChild(el('div', 'row lk-bar'));
  const seg = bar.appendChild(el('div', 'lk-seg'));
  S.segBtns = [['team', 'Clubs'], ['player', 'Players']].map(([k, t]) => {
    const b = seg.appendChild(el('button', 'lk-segb', t)); b.type = 'button';
    b.addEventListener('click', () => { if (S.kind !== k) { S.kind = k; S.conf = 'all'; S.basket = []; S.gq = ''; S.gOffset = 0; drawAll(); loadAll(); } });
    return b;
  });
  S.tiles = bar.appendChild(el('span', 'ep-micro lk-tiles'));
  S.body = host.appendChild(el('div', 'lk-body'));
  drawAll();
  return loadAll(true);
}

async function loadAll(first) {
  try {
    if (first || !S.filters.leagues.length) {
      const f = await rpc('platform_link_filters');
      S.filters = f || S.filters;
      drawAll();
    }
    await Promise.all([loadSuggestions(true), loadGroups()]);
  } catch (e) { fail(e); }
}

async function loadSuggestions(reset) {
  const offset = reset ? 0 : S.sug.rows.length;
  const r = await rpc('platform_link_suggestions', { p_kind: S.kind, p_limit: PAGE, p_offset: offset });
  const rows = (r && r.rows) || [];
  S.sug = { rows: reset ? rows : S.sug.rows.concat(rows), total: (r && r.total) || 0 };
  drawSuggestions(); drawTiles();
}
async function loadGroups() {
  const r = await rpc('platform_link_groups', { p_kind: S.kind, p_q: S.gq || null, p_limit: PAGE, p_offset: S.gOffset });
  S.groups = { rows: (r && r.rows) || [], total: (r && r.total) || 0 };
  drawGroups(); drawTiles();
}
/* something changed: the counts, the possible matches and the groups all move */
async function refresh() {
  try {
    const f = await rpc('platform_link_filters'); S.filters = f || S.filters;
    await Promise.all([loadSuggestions(true), loadGroups()]);
  } catch (e) { fail(e); }
}

/* ------------------------------------------------------------- drawing --- */
const isTeam = () => S.kind === 'team';
const noun = () => (isTeam() ? 'club' : 'player');

function drawTiles() {
  S.tiles.textContent = '';
  const t = tally(S.sug.rows);
  const bits = [];
  bits.push(String(isTeam() ? S.filters.teams : S.filters.players) + (isTeam() ? ' teams' : ' players'));
  bits.push(String(isTeam() ? S.filters.team_groups : S.filters.player_groups) + ' linked groups');
  bits.push(S.sug.total + ' possible matches to check' + (S.sug.rows.length ? ' (' + t.high + ' high · ' + t.medium + ' medium · ' + t.low + ' low in view)' : ''));
  S.tiles.appendChild(data('span', null, bits.join('  ·  ')));
}

function drawAll() {
  S.segBtns.forEach(b => b.classList.toggle('on', b.textContent === (isTeam() ? 'Clubs' : 'Players')));
  S.body.textContent = '';
  S.body.appendChild(el('h3', null, 'Possible ' + (isTeam() ? 'club' : 'player') + ' matches'));
  S.body.appendChild(el('p', 'lead', isTeam()
    ? 'Flagged from the names: the same club in more than one league (women\'s sides included), or the same club once "BC", "FC" and the gender word are set aside.'
    : 'Flagged from the names: the same name; the same first and last name with a middle name or particle in one of them ("Juan Carlos Perez" and "Juan Perez"); ' +
      'or a surname with just an initial where a feed abbreviates. Birth years that agree, or two clubs that are already linked, make one high; birth years that disagree make it low.'));
  S.sugBar = S.body.appendChild(el('div', 'row lk-confbar'));
  S.sugBox = S.body.appendChild(el('div', 'lk-sugs'));
  S.sugMore = S.body.appendChild(el('div', 'pager'));

  S.body.appendChild(el('h3', null, 'Find and link'));
  S.body.appendChild(el('p', 'lead', 'Search for the ' + noun() + 's to link. Narrow by league and season if the name is common; pick each result into the basket, then link the basket.'));
  drawFinder();

  S.body.appendChild(el('h3', null, 'Linked ' + (isTeam() ? 'clubs' : 'players')));
  const gr = S.body.appendChild(el('div', 'row'));
  const q = gr.appendChild(el('input', 'ep-input grow'));
  q.type = 'search'; q.placeholder = 'search the linked groups: a name or any member'; q.value = S.gq; q.autocomplete = 'off';
  let t = null;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.gq = q.value.trim(); S.gOffset = 0; loadGroups().catch(fail); }, 250); });
  S.gCount = gr.appendChild(el('span', 'ep-micro'));
  if (isTeam()) {
    gr.appendChild(btn('link the players of every linked club', 'mini', async ev => {
      const b = ev.currentTarget; b.disabled = true;
      try { const res = await rpc('platform_link_auto', {}); S.say(autoWords(res), 'ok'); await refresh(); } catch (e) { fail(e); } finally { b.disabled = false; }
    })).title = 'players whose names match across linked clubs are linked automatically when the clubs are linked and after each ingest pass; this runs it now';
  }
  S.grpBox = S.body.appendChild(el('div', 'lk-groups'));
  S.grpPager = S.body.appendChild(el('div', 'pager'));
  drawSuggestions(); drawGroups(); drawTiles();
}

/* ------------------------------------------------ a member's row, everywhere --- */
function pill(text, cls, title) { const p = el('span', 'pill' + (cls ? ' ' + cls : ''), text); if (title) p.title = title; return p; }

/* one team or player, as a row: who, where, when, and what can be done to it (o.check: a tick box; o.remove: an unlink) */
function memberRow(card, o) {
  o = o || {};
  const row = el('div', 'lk-mem' + (o.dim ? ' dim' : ''));
  if (o.check != null) {
    const cb = row.appendChild(el('input')); cb.type = 'checkbox'; cb.checked = !!o.check; cb.dataset.id = card.id;
    cb.setAttribute('aria-label', 'include ' + nameOf(card));
    row._cb = cb;
  } else row.appendChild(el('span', 'lk-dot'));
  const main = row.appendChild(el('div', 'lk-main'));
  const top = main.appendChild(el('div', 'lk-top'));
  const a = top.appendChild(data('a', 'lk-name', nameOf(card)));
  a.href = publicHref(S.kind, card); a.target = '_blank'; a.rel = 'noopener'; a.title = 'open the public page';
  if (isTeam()) {
    top.appendChild(data('span', 'lk-lg', card.league || 'no league'));
    if (card.women) top.appendChild(pill('women', 'st', card.women_set ? 'a women\'s side (set by hand)' : 'a women\'s side (from the names)'));
  } else if (card.birth_year) {
    top.appendChild(data('span', 'lk-lg', 'born ' + card.birth_year));
  }
  if (card.group && !o.hideGroup) top.appendChild(pill('in ' + card.group, 'tm', 'already linked'));
  if (card.auto) top.appendChild(pill('auto', 'la', 'linked automatically: ' + (card.auto_reason || 'their clubs are linked') + '. Unlink it if it is wrong; it will not be made again.'));
  if (card.namesakes > 0 && o.namesakes) top.appendChild(pill('⚑ ' + card.namesakes + ' with this name', 'pa', 'other rows share this name: see the possible matches'));
  const sub = main.appendChild(el('div', 'lk-sub'));
  if (isTeam()) {
    const seasons = seasonsOf(card);
    sub.appendChild(data('span', null, seasons.length ? seasons.join(' · ') : 'no competition yet'));
    const comps = (card.competitions || []).filter(c => c.season === seasons[0]).map(c => c.name);
    if (comps.length) sub.appendChild(data('span', 'lk-cm', comps.join(', ')));
  } else {
    const sp = spellLines(card, o.spells == null ? 3 : o.spells);
    if (!sp.shown.length) sub.appendChild(el('span', null, 'no club yet'));
    sp.shown.forEach(l => sub.appendChild(data('div', null, l)));
    if (sp.more) sub.appendChild(el('div', 'lk-cm', '+ ' + sp.more + ' more'));
  }
  const act = row.appendChild(el('div', 'lk-act'));
  if (isTeam() && o.women !== false) {
    /* the women's indicator: what the names say, or what somebody set. "auto" hands it back to the names. */
    const sel = act.appendChild(el('select', 'ep-input lk-w')); sel.title = 'is this a women\'s side?';
    [['auto', card.women_set ? 'women\'s: by names' : (card.women ? 'women (names)' : 'men / mixed (names)')], ['yes', 'women (set)'], ['no', 'not women (set)']]
      .forEach(([v, t]) => { const op = el('option', null, t); op.value = v; sel.appendChild(op); });
    sel.value = card.women_set ? (card.women ? 'yes' : 'no') : 'auto';
    sel.addEventListener('change', () => {
      rpc('platform_team_set_women', { p_team: card.id, p_women: sel.value === 'auto' ? null : sel.value === 'yes' })
        .then(() => { S.say('Saved.', 'ok'); return refresh(); }).catch(fail);
    });
  }
  if (o.remove) act.appendChild(btn('unlink', 'mini danger', () => o.remove(card)));
  return row;
}

/* --------------------------------------------------- possible matches --- */
function drawSuggestions() {
  if (!S.sugBar) return;
  S.sugBar.textContent = '';
  const t = tally(S.sug.rows);
  [['all', 'all'], ['high', 'high'], ['medium', 'medium'], ['low', 'low']].forEach(([k, w]) => {
    const n = k === 'all' ? S.sug.rows.length : t[k];
    const b = S.sugBar.appendChild(el('button', 'lk-chipb' + (S.conf === k ? ' on' : '') + (k !== 'all' ? ' c-' + k : ''), w + ' (' + n + ')'));
    b.type = 'button'; b.title = k === 'all' ? 'every possible match' : CONF_HELP[k];
    b.addEventListener('click', () => { S.conf = k; drawSuggestions(); });
  });
  S.sugBox.textContent = '';
  const rows = narrowed(S.sug.rows, S.conf);
  if (!rows.length) {
    S.sugBox.appendChild(el('p', 'empty', S.sug.rows.length
      ? 'None at this confidence in what is loaded.'
      : 'No possible matches: every row that looks like another is already linked, or was marked as not the same.'));
  }
  rows.forEach(r => S.sugBox.appendChild(suggestionCard(r)));
  S.sugMore.textContent = '';
  if (S.sug.rows.length < S.sug.total) {
    S.sugMore.appendChild(btn('show ' + Math.min(PAGE, S.sug.total - S.sug.rows.length) + ' more (' + (S.sug.total - S.sug.rows.length) + ' left)', 'mini',
      () => loadSuggestions(false).catch(fail)));
  }
}

function suggestionCard(r) {
  const card = el('div', 'lk-card lk-sug c-' + r.confidence);
  const head = card.appendChild(el('div', 'lk-head'));
  head.appendChild(el('span', 'lk-flag', '⚑ possible match'));
  head.appendChild(el('span', 'lk-conf c-' + r.confidence, CONF_WORD[r.confidence] + ' confidence')).title = CONF_HELP[r.confidence];
  if (r.kind) head.appendChild(pill(KIND_WORD[r.kind] || r.kind, ''));
  head.appendChild(data('span', 'lk-why', r.reason));
  const list = card.appendChild(el('div', 'lk-mems'));
  const rows = r.cards.map(c => list.appendChild(memberRow(c, { check: r.confidence !== 'low', namesakes: false, spells: 3 })));
  const foot = card.appendChild(el('div', 'lk-foot'));
  const go = foot.appendChild(btn('link the ticked ones', 'mini', async () => {
    const ids = rows.filter(x => x._cb && x._cb.checked).map(x => x._cb.dataset.id);
    if (ids.length < 2) return S.say('Tick at least two rows to link them.', 'err');
    go.disabled = true;
    try { const res = await rpc('platform_link_apply', { p_kind: S.kind, p_ids: ids, p_label: null }); S.say(linkedWords(S.kind, ids.length, res, 1), 'ok'); await refresh(); }
    catch (e) { go.disabled = false; fail(e); }
  }));
  foot.appendChild(btn('not the same', 'mini', async () => {
    try { await rpc('platform_link_dismiss', { p_kind: S.kind, p_ids: r.ids }); S.say('Marked as not the same: it will not be suggested again.', 'ok'); await refresh(); }
    catch (e) { fail(e); }
  }));
  const tick = () => { const n = rows.filter(x => x._cb && x._cb.checked).length; go.textContent = n >= 2 ? 'link the ' + n + ' ticked' : 'tick two or more'; go.disabled = n < 2; };
  rows.forEach(x => x._cb && x._cb.addEventListener('change', tick));
  tick();
  return card;
}

/* ----------------------------------------------------- find and link --- */
function drawFinder() {
  const wrap = S.body.appendChild(el('div', 'lk-finder'));
  const row = wrap.appendChild(el('div', 'row'));
  /* the league drop-down is itself a search: a hundred leagues are found by typing part of a name */
  const lg = combo({
    placeholder: 'any league', minChars: 0, openOnFocus: true, delay: 60, clearOnPick: false,
    fetch: async q => {
      const f = fold(q);
      const rows = [{ id: '', name: 'any league' }].concat(S.filters.leagues || []).filter(l => !f || fold(l.name).includes(f) || fold(l.slug).includes(f));
      return { rows: rows.slice(0, 40), more: rows.length > 40 };
    },
    render: (l, li) => li.appendChild(data('span', null, l.name)),
    pick: l => { S.league = l.id || ''; lg.input.value = l.id ? l.name : ''; lg.input.placeholder = l.id ? l.name : 'any league'; search.refresh(); }
  });
  lg.root.classList.add('lk-small');
  row.appendChild(lg.root);
  const se = combo({
    placeholder: 'any season', minChars: 0, openOnFocus: true, delay: 60, clearOnPick: false,
    fetch: async q => {
      const f = fold(q);
      const rows = [''].concat(S.filters.seasons || []).filter(s => !f || fold(s).includes(f));
      return { rows: rows.slice(0, 40), more: rows.length > 40 };
    },
    render: (s, li) => li.appendChild(data('span', null, s || 'any season')),
    pick: s => { S.season = s || ''; se.input.value = s || ''; search.refresh(); }
  });
  se.root.classList.add('lk-small');
  row.appendChild(se.root);
  const search = combo({
    placeholder: isTeam() ? 'search a club: name, short name, league…' : 'search a player: any part of the name, in any order…', minChars: 1,
    fetch: q => rpc('platform_link_search', { p_kind: S.kind, p_q: q, p_league: S.league || null, p_season: S.season || null,
                                                 p_limit: 20, p_offset: 0, p_exclude: S.basket.map(c => c.id) }),
    render: (c, li) => li.appendChild(memberRow(c, { women: false, namesakes: true, spells: 2, hideGroup: false, dim: false })),
    pick: c => { if (!S.basket.some(x => x.id === c.id)) S.basket.push(c); drawBasket(); }
  });
  search.root.classList.add('lk-grow');
  row.appendChild(search.root);
  S.finder = { search };
  S.basketBox = wrap.appendChild(el('div', 'lk-basket'));
  drawBasket();
}

function drawBasket() {
  const box = S.basketBox; if (!box) return;
  box.textContent = '';
  if (!S.basket.length) { box.appendChild(el('p', 'empty', 'Nothing picked yet. Search above and pick two or more to link.')); return; }
  const chips = box.appendChild(el('div', 'lk-chips'));
  S.basket.forEach(c => {
    const ch = chips.appendChild(el('span', 'lk-chip'));
    ch.appendChild(data('b', null, nameOf(c)));
    ch.appendChild(data('span', null, isTeam() ? (c.league || '') : (spellLines(c, 1).shown[0] || '')));
    if (c.group) ch.appendChild(pill('in ' + c.group, 'tm'));
    const x = ch.appendChild(el('button', 'lk-x', '×')); x.type = 'button'; x.title = 'take it out';
    x.addEventListener('click', () => { S.basket = S.basket.filter(y => y.id !== c.id); drawBasket(); });
  });
  const groups = [...new Set(S.basket.map(c => c.group_id).filter(Boolean))];
  const foot = box.appendChild(el('div', 'lk-foot'));
  const label = foot.appendChild(el('input', 'ep-input lk-label')); label.placeholder = 'name for the group (optional)'; label.autocomplete = 'off';
  const go = foot.appendChild(btn(S.basket.length >= 2 ? 'link these ' + S.basket.length : 'pick two or more', 'mini', async () => {
    go.disabled = true;
    try {
      const res = await rpc('platform_link_apply', { p_kind: S.kind, p_ids: S.basket.map(c => c.id), p_label: label.value.trim() || null });
      S.say(linkedWords(S.kind, S.basket.length, res, groups.length), 'ok');
      S.basket = []; drawBasket(); await refresh();
    } catch (e) { go.disabled = false; fail(e); }
  }));
  go.disabled = S.basket.length < 2;
  foot.appendChild(btn('clear', 'mini', () => { S.basket = []; drawBasket(); }));
  if (groups.length) box.appendChild(el('p', 'ep-micro', groups.length === 1
    ? 'One of these is already in a group: the rest join it.' : groups.length + ' of these are in groups: the groups become one.'));
}

/* -------------------------------------------------------------- groups --- */
function drawGroups() {
  if (!S.grpBox) return;
  S.gCount.textContent = S.groups.total + ' group' + (S.groups.total === 1 ? '' : 's');
  S.grpBox.textContent = '';
  if (!S.groups.rows.length) S.grpBox.appendChild(el('p', 'empty', S.gq ? 'No linked group matches.' : 'Nothing is linked yet. Link the possible matches above, or find rows yourself.'));
  S.groups.rows.forEach(g => S.grpBox.appendChild(groupCard(g)));
  S.grpPager.textContent = '';
  const pages = Math.max(1, Math.ceil(S.groups.total / PAGE)), page = Math.floor(S.gOffset / PAGE);
  if (pages > 1) {
    const prev = btn('previous', 'mini', () => { S.gOffset = Math.max(0, S.gOffset - PAGE); loadGroups().catch(fail); });
    const next = btn('next', 'mini', () => { S.gOffset += PAGE; loadGroups().catch(fail); });
    prev.disabled = page === 0; next.disabled = page >= pages - 1;
    S.grpPager.append(prev, data('span', null, (page + 1) + ' / ' + pages), next);
  }
}

function groupCard(g) {
  const card = el('div', 'lk-card lk-grp');
  const head = card.appendChild(el('div', 'lk-head'));
  const name = head.appendChild(data('b', 'lk-gname', g.name));
  head.appendChild(el('span', 'ep-micro', g.members.length + ' ' + (isTeam() ? 'teams' : 'profiles')));
  const rename = head.appendChild(btn('rename', 'mini', () => {
    const inp = el('input', 'ep-input lk-label'); inp.value = g.name; inp.maxLength = 120;
    name.replaceWith(inp); rename.hidden = true; inp.focus(); inp.select();
    const save = async () => {
      const v = inp.value.trim();
      if (!v || v === g.name) return drawGroups();
      try { await rpc('platform_link_rename', { p_kind: S.kind, p_group: g.id, p_label: v }); S.say('Renamed.', 'ok'); await loadGroups(); } catch (e) { fail(e); drawGroups(); }
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') drawGroups(); });
    inp.addEventListener('blur', save);
  }));
  if (isTeam()) {
    head.appendChild(btn('link their players', 'mini', async ev => {
      const b = ev.currentTarget; b.disabled = true;
      try { const res = await rpc('platform_link_auto', { p_group: g.id }); S.say(autoWords(res), 'ok'); await refresh(); } catch (e) { b.disabled = false; fail(e); }
    })).title = 'link the players whose names match across these clubs (this also runs when clubs are linked)';
  }
  const list = card.appendChild(el('div', 'lk-mems'));
  g.members.forEach(m => list.appendChild(memberRow(m, {
    hideGroup: true, spells: 4,
    remove: async c => {
      try { await rpc('platform_link_remove', { p_kind: S.kind, p_id: c.id }); S.say('Taken out of the group.', 'ok'); await refresh(); } catch (e) { fail(e); }
    }
  })));
  /* add another from a search that leaves out the group's own members */
  const add = card.appendChild(el('div', 'lk-add'));
  const c = combo({
    placeholder: 'add another ' + noun() + ' to this group…', minChars: 1,
    fetch: q => rpc('platform_link_search', { p_kind: S.kind, p_q: q, p_league: null, p_season: null, p_limit: 20, p_offset: 0, p_exclude: g.members.map(m => m.id) }),
    render: (r, li) => li.appendChild(memberRow(r, { women: false, namesakes: true, spells: 2 })),
    pick: async r => {
      try {
        const res = await rpc('platform_link_apply', { p_kind: S.kind, p_ids: g.members.map(m => m.id).concat([r.id]), p_label: null });
        S.say('Added ' + nameOf(r) + '.' + (isTeam() && res && res.auto_players ? ' ' + res.auto_players + ' player' + (res.auto_players === 1 ? '' : 's') + ' at the clubs linked automatically.' : ''), 'ok');
        await refresh();
      }
      catch (e) { fail(e); }
    }
  });
  add.appendChild(c.root);
  return card;
}

const autoWords = res => (res && res.players
  ? res.players + ' player' + (res.players === 1 ? '' : 's') + ' linked across ' + res.sets + ' set' + (res.sets === 1 ? '' : 's') + '.'
  : 'Nothing new to link: every matching player at those clubs is already linked, or is left for you to check below.');

/* -------------------------------------------------------------- misc --- */
function fold(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

return { mount, combo, bySureness, narrowed, tally, seasonsOf, spellLines, publicHref, KIND_WORD, CONF_HELP, _state: () => S };
}));
