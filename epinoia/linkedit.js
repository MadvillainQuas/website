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

   THE SAME PANEL ON A PLAYER'S PROFILE (kind: 'player'): the profiles that are the same person, each with an unlink button, and a
   search bar for the other profile to link to this one (a player is found by name or alias, and shown with his clubs and, to an
   administrator, his birth year, so two people of one name can be told apart). It is a LINK, not a merge: every game and stat stays
   on its own profile, and the linked ones are read together (the career table, the "other profiles" button). The career on this
   page is read when it opens, so after a change a button offers to reload it.

   AND A MERGE, for the day a link is not enough: one person under two profiles that both rank in the same table, so he is in it twice
   (players, migration 0183) - or one club under two rows, a feed with no code of its own having spelled it two ways, so it is in the
   table of clubs twice (teams, migration 0187: NBL Division One's "London Elite" / "London Elite Senior Men I", reported 2026-09-27).
   "merge into this page" on a linked profile or club, or "merge" on a search result, first ASKS the database what it would do
   (platform_player_merge_preview / platform_team_merge_preview: how many games, plays, roster entries, photos and followers would
   move, and what stops it - for players, the two played in the same game, or one is in a game not yet finished; for clubs, the two
   are in different leagues, they have played each other, or one has a game not yet finished) and shows it. Only then does "merge" run
   platform_player_merge / platform_team_merge, which moves everything to THIS row and deletes the other. It cannot be undone; the old
   address redirects here.
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
const playerHref = c => './?p=' + encodeURIComponent(c.slug || c.id);
/* a player card's clubs as short lines, "Club · League · Season", the distinct ones in the card's order (newest first) */
function spellLines(card, n) {
  const seen = [];
  ((card && card.spells) || []).forEach(x => { const l = [x.team, x.league, x.season].filter(Boolean).join(' \u00b7 '); if (l && seen.indexOf(l) < 0) seen.push(l); });
  return seen.slice(0, n == null ? 3 : n);
}

/* what to say after a link: the team, how big the group is now, and the players linked with it */
function linkedWords(row, res, kind) {
  const n = res && res.members;
  if (kind === 'player') return 'Linked ' + (row.name || 'that player') + ' to this profile' + (n ? ': ' + n + ' profiles are linked now' : '') + '.';
  const a = res && res.auto_players;
  let t = 'Linked ' + (row.name || 'that team') + (row.league ? ' (' + row.league + ')' : '') + ' to this club' + (n ? ': ' + n + ' teams are linked now' : '') + '.';
  if (a) t += ' ' + a + ' player' + (a === 1 ? '' : 's') + ' at those clubs ' + (a === 1 ? 'was' : 'were') + ' linked automatically.';
  return t;
}
/* what to say after an unlink; a group left with one team is not a link any more, and the database drops it */
function unlinkedWords(card, res, kind) {
  if (kind === 'player') {
    if (res && res.removed === false) return (card.name || 'That profile') + ' was not linked.';
    return 'Unlinked ' + (card.name || 'that profile') + '.' + (res && res.left != null && res.left < 2 ? ' That left one profile, so the link is gone.' : '');
  }
  if (res && res.removed === false) return (card.name || 'That team') + ' was not linked.';
  return 'Unlinked ' + (card.league ? card.league : (card.name || 'that team')) + '.' + (res && res.left != null && res.left < 2 ? ' That left one team, so the link is gone.' : '');
}
/* the database's own words, kept short for the two refusals that have a cause the person can act on */
function errorWords(e) {
  const msg = (e && (e.message || String(e))) || 'Something went wrong.';
  if ((e && e.code === '42501') || /permission denied|administrators only/i.test(msg)) return 'Refused: only platform administrators can edit links.';
  if ((e && e.code === 'PGRST202') || /schema cache/i.test(msg)) {
    if (/team_merge/i.test(msg)) return 'Merging clubs is not on the server yet: migration 0187 has not been applied.';
    if (/merge/i.test(msg)) return 'Merging is not on the server yet: migration 0183 has not been applied.';
    return 'Links are not on the server yet: migration 0178 has not been applied.';
  }
  return msg;
}

/* what a merge would do, in words: the preview's counts, each only when there is something to say */
function mergeLines(pv, kind) {
  const c = (pv && pv.counts) || {};
  const out = [];
  const add = (n, one, many) => { if (n) out.push(n + ' ' + (n === 1 ? one : many)); };
  if (kind === 'team') {
    add(c.competitions, 'competition entry', 'competition entries');
    add(c.games, 'game', 'games');
    add(c.rosters, 'roster entry', 'roster entries');
    add(c.photos, 'photo', 'photos');
    add(c.followers, 'follower', 'followers');
    return out;
  }
  add(c.games, 'game with his stats', 'games with his stats');
  add(c.events, 'play (and substitution) in the play-by-play', 'plays (and substitutions) in the play-by-play');
  add(c.rosters, 'roster entry', 'roster entries');
  add(c.awards, 'award', 'awards');
  add(c.photos, 'photo', 'photos');
  add(c.followers, 'follower', 'followers');
  return out;
}
function mergedWords(res, kind) {
  const g = res && res.games;
  const noun = kind === 'team' ? 'club' : 'profile';
  return 'Merged: ' + (g ? g + (g === 1 ? ' game' : ' games') + ' now belong' + (g === 1 ? 's' : '') + ' to this ' + noun : 'everything now belongs to this ' + noun) +
    '. The other ' + noun + ' is gone, and its old address redirects here.';
}

/* ---------------------------------------------------------------- mount --- */
/* o: { host, team: { id, name }, sb (a supabase client with the administrator's session), linked (linked_teams' answer, or null),
        onChange(): a promise of the fresh linked_teams answer, after the club's league buttons have been drawn again } */
function mount(o) {
  const P = o.kind === 'player', kind = P ? 'player' : 'team';
  const team = P ? o.player : o.team, sb = o.sb;                 // "team" is whatever this page is about: a club, or a player
  const W = P
    ? { heading: 'linked profiles', none: 'Not linked to any other profile yet. Search below to link this player to another profile of the same person.',
        placeholder: 'search a player to link: name or alias', aria: 'search a player to link to this profile',
        toggle: 'link this profile to other profiles of the same person, or unlink it (platform administrators)', noun: 'player' }
    : { heading: 'linked teams', none: 'Not linked to any other team yet. Search below to link it to one.',
        placeholder: 'search a team to link: name, league, alias', aria: 'search a team to link to this one',
        toggle: 'link this team to others, or unlink it (platform administrators)', noun: 'team' };
  const noun = P ? 'profile' : 'club';         // what a MERGE talks about - a "player"/"team" is what is searched for; what merges is a "profile"/"club"
  let linked = o.linked || null;
  let seq = 0, timer = 0, active = -1, rows = [], busy = false;

  const box = el('div', 'le-box');
  box.setAttribute('data-i18n', 'off');
  const toggle = box.appendChild(el('button', 'le-toggle', '✎ edit links'));
  toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
  toggle.title = W.toggle;
  const panel = box.appendChild(el('div', 'le-panel'));
  panel.hidden = true;
  panel.id = 'leLinks';
  toggle.setAttribute('aria-controls', panel.id);

  const head = panel.appendChild(el('div', 'le-h'));
  head.appendChild(el('b', null, W.heading));
  const grp = head.appendChild(nm('span', 'le-g', ''));
  const mems = panel.appendChild(el('div', 'le-mems'));
  const searchWrap = panel.appendChild(el('div', 'le-sw'));
  const input = searchWrap.appendChild(el('input', 'le-search'));
  input.type = 'search'; input.setAttribute('autocomplete', 'off'); input.setAttribute('spellcheck', 'false');
  input.placeholder = W.placeholder;
  input.setAttribute('aria-label', W.aria);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-autocomplete', 'list');
  const list = searchWrap.appendChild(el('ul', 'le-list'));
  list.hidden = true; list.setAttribute('role', 'listbox');
  const msg = panel.appendChild(el('div', 'le-msg'));
  msg.setAttribute('role', 'status');
  const mergeBox = panel.appendChild(el('div', 'le-merge-box'));
  mergeBox.hidden = true;
  /* a player's career and game log are read when the page opens; after an edit this reads them again */
  const reloadBtn = panel.appendChild(el('button', 'le-x', P ? 'reload the page to update the career' : 'reload the page to update the roster and fixtures'));
  reloadBtn.type = 'button'; reloadBtn.hidden = true;
  reloadBtn.addEventListener('click', () => { if (typeof location !== 'undefined' && location.reload) location.reload(); });

  const say = (t, kind) => { msg.textContent = t || ''; msg.className = 'le-msg' + (kind ? ' ' + kind : ''); };
  const teams = () => (linked && (P ? linked.players : linked.teams)) || [];
  const excluded = () => { const s = teams().map(c => c.id); if (s.indexOf(team.id) < 0) s.push(team.id); return s; };
  async function rpc(name, args) { const r = await sb.rpc(name, args); if (r.error) throw r.error; return r.data; }

  /* --- the teams it is linked to --- */
  function drawMembers() {
    mems.textContent = '';
    grp.textContent = (linked && linked.group) || '';
    const ms = teams();
    if (ms.length < 2) { mems.appendChild(el('div', 'le-none', W.none)); return; }
    ms.slice().sort((a, b) => (a.id === team.id ? -1 : 0) - (b.id === team.id ? -1 : 0)).forEach(c => {
      const row = mems.appendChild(el('div', 'le-mem' + (c.id === team.id ? ' here' : '')));
      const main = row.appendChild(el('div', 'le-main'));
      const top = main.appendChild(el('div', 'le-top'));
      if (P) {
        const a = top.appendChild(nm('a', 'le-name', c.name || '\u2014'));
        a.href = playerHref(c);
        if (c.id === team.id) top.appendChild(el('span', 'le-here', 'this page'));
        if (c.auto) top.appendChild(el('span', 'le-chip', 'auto'));
        main.appendChild(nm('div', 'le-sub', spellLines(c, 2).join('  |  ') || 'no club yet'));
      } else {
        const a = top.appendChild(nm('a', 'le-name', c.league || c.name));
        a.href = teamHref(c);
        if (c.women) top.appendChild(el('span', 'le-chip', 'women'));
        if (c.youth) top.appendChild(nm('span', 'le-chip', c.age || 'youth'));
        if (c.id === team.id) top.appendChild(el('span', 'le-here', 'this page'));
        const s = seasonsOf(c);
        main.appendChild(nm('div', 'le-sub', (c.name && c.league && c.name !== c.league ? c.name + ' \u00b7 ' : '') + (s.length ? s.slice(0, 3).join(' \u00b7 ') : 'no competition yet')));
      }
      const x = row.appendChild(el('button', 'le-x', 'unlink'));
      x.type = 'button'; x.title = 'take ' + (c.name || (P ? 'this profile' : 'this team')) + ' out of the link';
      x.addEventListener('click', () => unlink(c));
      if (c.id !== team.id) {
        const mg = row.appendChild(el('button', 'le-x le-merge', 'merge into this page'));
        mg.type = 'button'; mg.title = 'move everything of ' + (c.name || 'that ' + noun) + ' to this ' + noun + ' and delete it (asks first)';
        mg.addEventListener('click', () => startMerge(c));
      }
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
      const li = list.appendChild(el('li', 'le-empty', 'No ' + W.noun + ' matches "' + q + '" (' + W.noun + 's already linked to this one are left out).'));
      li.setAttribute('role', 'presentation');
    }
    rows.forEach((r, k) => {
      const li = list.appendChild(el('li', 'le-opt')); li.id = 'leOpt' + k; li.setAttribute('role', 'option');
      const top = li.appendChild(el('div', 'le-top'));
      top.appendChild(nm('b', 'le-name', r.name));
      if (P) {
        if (r.birth_year) top.appendChild(nm('span', 'le-lg', 'b. ' + r.birth_year));
        const sub = li.appendChild(el('div', 'le-sub'));
        sub.appendChild(nm('span', null, spellLines(r, 2).join('  |  ') || 'no club yet'));
        if (r.group) sub.appendChild(nm('span', 'le-in', 'in the group "' + r.group + '": the whole group is linked'));
      } else {
        if (r.league) top.appendChild(nm('span', 'le-lg', r.league));
        if (r.women) top.appendChild(el('span', 'le-chip', 'women'));
        if (r.youth) top.appendChild(nm('span', 'le-chip', r.age || 'youth'));
        const s = seasonsOf(r);
        const sub = li.appendChild(el('div', 'le-sub'));
        sub.appendChild(nm('span', null, s.length ? s.slice(0, 3).join(' \u00b7 ') : 'no competition yet'));
        if (r.group) sub.appendChild(nm('span', 'le-in', 'in the group "' + r.group + '": the whole group is linked'));
      }
      li.addEventListener('pointerdown', e => { if (e.preventDefault) e.preventDefault(); pick(r); });
      const mg = li.appendChild(el('span', 'le-merge-opt', 'merge\u2026'));
      mg.title = 'merge this ' + noun + ' into the one you are on (asks first)';
      mg.addEventListener('pointerdown', e => { if (e.preventDefault) e.preventDefault(); if (e.stopPropagation) e.stopPropagation(); startMerge(r); });
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
      const res = await rpc('platform_link_search', { p_kind: kind, p_q: q, p_limit: SHOWN, p_exclude: excluded() });
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
  /* a player's career and game log, or a club's roster and fixtures once a merge has actually moved some onto this
     page (a plain link/unlink moves nothing - 0178's whole point - so a club's own league buttons redrawing from
     onChange() is enough for those; a merge is not read again here, so the button asks for a reload instead) */
  async function changed(merged) {
    try { linked = (await o.onChange()) || null; } catch (_) { linked = null; }
    drawMembers();
    if (P || merged) reloadBtn.hidden = false;
  }
  async function pick(row) {
    if (busy) return;
    busy = true; closeList(); input.value = ''; seq++;
    say('linking…');
    try {
      const res = await rpc('platform_link_apply', { p_kind: kind, p_ids: [team.id, row.id], p_label: null });
      say(linkedWords(row, res, kind), 'ok');
      await changed(false);
    } catch (e) { say(errorWords(e), 'err'); }
    finally { busy = false; }
  }
  async function unlink(card) {
    if (busy) return;
    busy = true;
    say('unlinking…');
    try {
      const res = await rpc('platform_link_remove', { p_kind: kind, p_id: card.id });
      say(unlinkedWords(card, res, kind), 'ok');
      await changed(false);
    } catch (e) { say(errorWords(e), 'err'); }
    finally { busy = false; }
  }

  /* --- a merge: ask what it would do, show it, and only then do it --- */
  function closeMerge() { mergeBox.hidden = true; mergeBox.textContent = ''; }
  async function startMerge(card) {
    if (busy) return;
    busy = true; closeList(); seq++;
    say('checking what a merge would do\u2026');
    try {
      const pv = await rpc(P ? 'platform_player_merge_preview' : 'platform_team_merge_preview', { p_keep: team.id, p_other: card.id });
      say('');
      mergeBox.textContent = '';
      const h = mergeBox.appendChild(el('div', 'le-merge-h'));
      h.append('Merge ', nm('b', null, (pv.other && pv.other.name) || card.name || ('that ' + noun)), ' into ', nm('b', null, (pv.keep && pv.keep.name) || team.name || ('this ' + noun)), '?');
      const lines = mergeLines(pv, kind);
      mergeBox.appendChild(el('div', 'le-merge-p', lines.length ? 'This moves ' + lines.join(', ') + ' to this ' + noun + '.'
        : P ? 'There is nothing of his to move but the profile itself.' : 'There is nothing of the club’s to move but the club itself.'));
      const blockers = (pv.blockers || []);
      if (pv.birth_years_differ) mergeBox.appendChild(el('div', 'le-merge-warn', 'Their birth years differ (' + (pv.keep && pv.keep.birth_year) + ' and ' + (pv.other && pv.other.birth_year) + '): are they really one person?'));
      blockers.forEach(b => mergeBox.appendChild(el('div', 'le-merge-block', b)));
      if (!blockers.length) mergeBox.appendChild(el('div', 'le-merge-warn', 'This deletes the other ' + noun + ' and cannot be undone here. Its old address will redirect to this page.'));
      const btns = mergeBox.appendChild(el('div', 'le-merge-btns'));
      if (!blockers.length) {
        const go = btns.appendChild(el('button', 'le-x le-merge-go', 'merge'));
        go.type = 'button';
        go.addEventListener('click', () => doMerge(card));
      }
      const no = btns.appendChild(el('button', 'le-x', blockers.length ? 'close' : 'cancel'));
      no.type = 'button';
      no.addEventListener('click', closeMerge);
      mergeBox.hidden = false;
    } catch (e) { say(errorWords(e), 'err'); }
    finally { busy = false; }
  }
  async function doMerge(card) {
    if (busy) return;
    busy = true;
    say('merging\u2026');
    try {
      const res = await rpc(P ? 'platform_player_merge' : 'platform_team_merge', { p_keep: team.id, p_other: card.id });
      closeMerge();
      say(mergedWords(res, kind), 'ok');
      await changed(true);
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

return { mount, seasonsOf, spellLines, playerHref, linkedWords, unlinkedWords, errorWords, mergeLines, mergedWords };
}));
