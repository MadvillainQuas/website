'use strict';
/* ============================================================================
   EDITING A CLUB'S LINKS FROM ITS OWN PAGE - platform administrators only (migration 0178's console functions).

   The Links tab of the platform console is where clubs are linked in bulk. This is the same edit made from the page you
   are looking at when you notice the mistake: on a team's page an administrator gets an "edit links" button under the
   club's league buttons. It opens a small panel with
     * the teams this one is linked to, each with an unlink button, and
     * a search bar: type a club, a league or an alias, and pick the team to link to this one. A team that already belongs
       to a group brings its whole group in (the result says so); linking clubs links their matching players too
       (link_auto_players), and the message says how many.

   WHO SEES IT: linkswitch.js asks whoami() and loads this file only on a yes, so nobody else even downloads it. That is a
   courtesy, not the control: every call here is one of the console's own RPCs (platform_link_search / _apply / _remove),
   which refuse anybody who is not a platform administrator in the database (link_require_admin). A page that showed this
   to the wrong person would find every button answering "refused".

   It does not scroll the page and does not reload it: after a change the club's league buttons are drawn again from the
   database (onChange), and the panel stays open for the next one.
   ============================================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaLinkEdit = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };
/* a club's, league's or season's name is data: never run through the translator */
const nm = (t, c, x) => { const n = el(t, c, x); n.setAttribute('translate', 'no'); return n; };

const DELAY = 180;                                   // ms after the last key before the server is asked
const SHOWN = 8;                                     // results listed

/* ---------------------------------------------------------------- pure --- */
/* the distinct season names of a card's competitions, newest first */
function seasonsOf(card) {
  const seen = [];
  ((card && card.competitions) || []).forEach(k => { if (k.season && seen.indexOf(k.season) < 0) seen.push(k.season); });
  return seen.sort().reverse();
}
const teamHref = c => './?t=' + encodeURIComponent(c.slug || c.id);

/* what to say after a link: the team, how big the group is now, and the players linked with it */
function linkedWords(row, res) {
  const n = res && res.members;
  const a = res && res.auto_players;
  let t = 'Linked ' + (row.name || 'that team') + (row.league ? ' (' + row.league + ')' : '') + ' to this club' + (n ? ': ' + n + ' teams are linked now' : '') + '.';
  if (a) t += ' ' + a + ' player' + (a === 1 ? '' : 's') + ' at those clubs ' + (a === 1 ? 'was' : 'were') + ' linked automatically.';
  return t;
}
/* what to say after an unlink; a group left with one team is not a link any more, and the database drops it */
function unlinkedWords(card, res) {
  if (res && res.removed === false) return (card.name || 'That team') + ' was not linked.';
  return 'Unlinked ' + (card.league ? card.league : (card.name || 'that team')) + '.' + (res && res.left != null && res.left < 2 ? ' That left one team, so the link is gone.' : '');
}
/* the database's own words, kept short for the two refusals that have a cause the person can act on */
function errorWords(e) {
  const msg = (e && (e.message || String(e))) || 'Something went wrong.';
  if ((e && e.code === '42501') || /permission denied|administrators only/i.test(msg)) return 'Refused: only platform administrators can edit links.';
  if ((e && e.code === 'PGRST202') || /schema cache/i.test(msg)) return 'Links are not on the server yet: migration 0178 has not been applied.';
  return msg;
}

/* ---------------------------------------------------------------- mount --- */
/* o: { host, team: { id, name }, sb (a supabase client with the administrator's session), linked (linked_teams' answer, or null),
        onChange(): a promise of the fresh linked_teams answer, after the club's league buttons have been drawn again } */
function mount(o) {
  const team = o.team, sb = o.sb;
  let linked = o.linked || null;
  let seq = 0, timer = 0, active = -1, rows = [], busy = false;

  const box = el('div', 'le-box');
  box.setAttribute('data-i18n', 'off');
  const toggle = box.appendChild(el('button', 'le-toggle', '✎ edit links'));
  toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
  toggle.title = 'link this team to others, or unlink it (platform administrators)';
  const panel = box.appendChild(el('div', 'le-panel'));
  panel.hidden = true;
  panel.id = 'leLinks';
  toggle.setAttribute('aria-controls', panel.id);

  const head = panel.appendChild(el('div', 'le-h'));
  head.appendChild(el('b', null, 'linked teams'));
  const grp = head.appendChild(nm('span', 'le-g', ''));
  const mems = panel.appendChild(el('div', 'le-mems'));
  const searchWrap = panel.appendChild(el('div', 'le-sw'));
  const input = searchWrap.appendChild(el('input', 'le-search'));
  input.type = 'search'; input.setAttribute('autocomplete', 'off'); input.setAttribute('spellcheck', 'false');
  input.placeholder = 'search a team to link: name, league, alias';
  input.setAttribute('aria-label', 'search a team to link to this one');
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-autocomplete', 'list');
  const list = searchWrap.appendChild(el('ul', 'le-list'));
  list.hidden = true; list.setAttribute('role', 'listbox');
  const msg = panel.appendChild(el('div', 'le-msg'));
  msg.setAttribute('role', 'status');

  const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'le-msg' + (kind ? ' ' + kind : ''); };
  const teams = () => (linked && linked.teams) || [];
  const excluded = () => { const s = teams().map(c => c.id); if (s.indexOf(team.id) < 0) s.push(team.id); return s; };
  async function rpc(name, args) { const r = await sb.rpc(name, args); if (r.error) throw r.error; return r.data; }

  /* --- the teams it is linked to --- */
  function drawMembers() {
    mems.textContent = '';
    grp.textContent = (linked && linked.group) || '';
    const ms = teams();
    if (ms.length < 2) { mems.appendChild(el('div', 'le-none', 'Not linked to any other team yet. Search below to link it to one.')); return; }
    ms.slice().sort((a, b) => (a.id === team.id ? -1 : 0) - (b.id === team.id ? -1 : 0)).forEach(c => {
      const row = mems.appendChild(el('div', 'le-mem' + (c.id === team.id ? ' here' : '')));
      const main = row.appendChild(el('div', 'le-main'));
      const top = main.appendChild(el('div', 'le-top'));
      const a = top.appendChild(nm('a', 'le-name', c.league || c.name));
      a.href = teamHref(c);
      if (c.women) top.appendChild(el('span', 'le-chip', 'women'));
      if (c.youth) top.appendChild(nm('span', 'le-chip', c.age || 'youth'));
      if (c.id === team.id) top.appendChild(el('span', 'le-here', 'this page'));
      const s = seasonsOf(c);
      main.appendChild(nm('div', 'le-sub', (c.name && c.league && c.name !== c.league ? c.name + ' · ' : '') + (s.length ? s.slice(0, 3).join(' · ') : 'no competition yet')));
      const x = row.appendChild(el('button', 'le-x', 'unlink'));
      x.type = 'button'; x.title = 'take ' + (c.name || 'this team') + ' out of the link';
      x.addEventListener('click', () => unlink(c));
    });
  }

  /* --- the search --- */
  function closeList() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
  function mark(i) {
    active = i;
    Array.from(list.children).forEach((li, k) => li.classList.toggle('on', k === i));
    input.setAttribute('aria-activedescendant', i >= 0 && list.children[i] ? list.children[i].id : '');
    const li = list.children[i]; if (li && li.scrollIntoView) li.scrollIntoView({ block: 'nearest' });
  }
  function drawList(res, q) {
    list.textContent = '';
    rows = (res && res.rows) || [];
    if (!rows.length) {
      const li = list.appendChild(el('li', 'le-empty', 'No team matches "' + q + '" (teams already linked to this one are left out).'));
      li.setAttribute('role', 'presentation');
    }
    rows.forEach((r, k) => {
      const li = list.appendChild(el('li', 'le-opt')); li.id = 'leOpt' + k; li.setAttribute('role', 'option');
      const top = li.appendChild(el('div', 'le-top'));
      top.appendChild(nm('b', 'le-name', r.name));
      if (r.league) top.appendChild(nm('span', 'le-lg', r.league));
      if (r.women) top.appendChild(el('span', 'le-chip', 'women'));
      if (r.youth) top.appendChild(nm('span', 'le-chip', r.age || 'youth'));
      const s = seasonsOf(r);
      const sub = li.appendChild(el('div', 'le-sub'));
      sub.appendChild(nm('span', null, s.length ? s.slice(0, 3).join(' · ') : 'no competition yet'));
      if (r.group) sub.appendChild(nm('span', 'le-in', 'in the group "' + r.group + '": the whole group is linked'));
      li.addEventListener('pointerdown', e => { if (e.preventDefault) e.preventDefault(); pick(r); });
    });
    if (res && res.more) list.appendChild(el('li', 'le-more', 'more matches: type more of the name'));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    mark(rows.length ? 0 : -1);
  }
  async function run() {
    const q = input.value.trim();
    if (!q) { closeList(); return; }
    const mine = ++seq;
    try {
      const res = await rpc('platform_link_search', { p_kind: 'team', p_q: q, p_limit: SHOWN, p_exclude: excluded() });
      if (mine !== seq) return;                       // a slower answer to an older question never replaces a newer one
      say('');
      drawList(res, q);
    } catch (e) { if (mine === seq) { closeList(); say(errorWords(e), 'err'); } }
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, DELAY); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.hidden) { run(); return; }
      if (e.preventDefault) e.preventDefault();
      const n = rows.length; if (!n) return;
      mark(e.key === 'ArrowDown' ? (active + 1) % n : (active - 1 + n) % n);
    } else if (e.key === 'Enter') {
      if (!list.hidden && rows[active]) { if (e.preventDefault) e.preventDefault(); pick(rows[active]); }
    } else if (e.key === 'Escape') {
      if (!list.hidden) { closeList(); if (e.stopPropagation) e.stopPropagation(); }
      else if (input.value) input.value = '';
      else close();
    }
  });
  input.addEventListener('focus', () => { if (input.value.trim() && list.hidden && rows.length) { list.hidden = false; input.setAttribute('aria-expanded', 'true'); } });
  input.addEventListener('blur', () => { setTimeout(closeList, 120); });

  /* --- the two edits --- */
  async function changed() {
    try { linked = (await o.onChange()) || null; } catch (_) { linked = null; }
    drawMembers();
  }
  async function pick(row) {
    if (busy) return;
    busy = true; closeList(); input.value = ''; seq++;
    say('linking…');
    try {
      const res = await rpc('platform_link_apply', { p_kind: 'team', p_ids: [team.id, row.id], p_label: null });
      say(linkedWords(row, res), 'ok');
      await changed();
    } catch (e) { say(errorWords(e), 'err'); }
    finally { busy = false; }
  }
  async function unlink(card) {
    if (busy) return;
    busy = true;
    say('unlinking…');
    try {
      const res = await rpc('platform_link_remove', { p_kind: 'team', p_id: card.id });
      say(unlinkedWords(card, res), 'ok');
      await changed();
    } catch (e) { say(errorWords(e), 'err'); }
    finally { busy = false; }
  }

  /* --- open and shut --- */
  function open() {
    panel.hidden = false; toggle.setAttribute('aria-expanded', 'true');
    drawMembers();
    if (input.focus) input.focus();
  }
  function close() {
    panel.hidden = true; toggle.setAttribute('aria-expanded', 'false');
    closeList(); say('');
    if (toggle.focus) toggle.focus();
  }
  toggle.addEventListener('click', () => { if (panel.hidden) open(); else close(); });

  drawMembers();
  if (o.host) o.host.appendChild(box);
  return { root: box, open, close, refresh(l) { linked = l || null; drawMembers(); }, _state: () => ({ linked, rows, active, busy }) };
}

return { mount, seasonsOf, linkedWords, unlinkedWords, errorWords };
}));
