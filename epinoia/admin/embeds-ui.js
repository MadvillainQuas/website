'use strict';
/* ============================================================================
   WHERE THE EMBEDS ARE PLANTED.

   An embed is a line of markup on somebody else's website, and once it is there
   the league cannot reach it. Every setting used to live in the URL of that
   snippet — which league, how many fixtures, which colours — so changing what a
   club's site showed meant asking the club to edit their page again, and clubs
   do not edit their pages again.

   This registers the website instead. A rule says: on this host, an embed with
   nothing in its URL shows this league — or only this club's fixtures. The
   snippet stays one line and never changes, and what it shows is the league's
   to decide from here.

   WHAT A RULE CANNOT DO, said plainly on the panel as well as here: it does not
   grant access to anything. The host is read from the embedding page and the
   embedding page could claim to be anybody, so this arranges public information
   and nothing else. Everything an embed can show was already readable by
   anyone who typed the league's name into the snippet themselves.
   ============================================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EpinoiaEmbedsUI = api;
}(typeof globalThis !== 'undefined' ? globalThis : self, function () {

const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c;
  if (x != null) n.textContent = x; return n; };

const KINDS = [
  ['any',   'every embed'],
  ['strip', 'fixture strip'],
  ['table', 'table & leaders'],
  ['game',  'live box score'],
  ['merch', 'merchandise']
];

/* opts: { host, sb, league, teams, say } */
function mount(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host) return;
  host.textContent = '';

  host.appendChild(el('p', 'empty',
    'Register a website and an embed planted there needs no settings of its ' +
    'own. Anything written into the snippet still wins, so nothing already ' +
    'in place changes. This arranges public information — it is not a ' +
    'permission, and a site could claim to be another site.'));

  /* ---- add a rule ---- */
  const row1 = el('div', 'row');
  const hostIn = el('input', 'ep-input grow');
  hostIn.placeholder = 'neoncitybasketball.co.uk';
  hostIn.title = 'the club’s website — paste the address, the rest is trimmed off';

  const kind = el('select', 'ep-input');
  kind.style.flex = '0 0 150px';
  KINDS.forEach(([v, l]) => { const op = el('option', null, l); op.value = v; kind.appendChild(op); });

  const team = el('select', 'ep-input');
  team.style.flex = '0 0 190px';
  const anyTeam = el('option', null, 'the whole league'); anyTeam.value = '';
  team.appendChild(anyTeam);
  Object.values(o.teams || {}).forEach(t => {
    const op = el('option', null, t.name); op.value = t.id; team.appendChild(op);
  });

  row1.append(hostIn, kind, team);
  host.appendChild(row1);

  const row2 = el('div', 'row');
  const max = el('input', 'ep-input');
  max.type = 'number'; max.min = '1'; max.max = '60'; max.placeholder = 'how many';
  max.style.flex = '0 0 120px';
  max.title = 'how many fixtures the embed shows — leave blank for its own default';
  const theme = el('select', 'ep-input');
  theme.style.flex = '0 0 150px';
  [['', 'their choice'], ['dark', 'dark'], ['light', 'light']].forEach(([v, l]) => {
    const op = el('option', null, l); op.value = v; theme.appendChild(op);
  });
  const note = el('input', 'ep-input grow');
  note.placeholder = 'a note for yourself — “their fixtures page”';
  note.maxLength = 120;
  const add = el('button', 'ep-btn pri', 'register'); add.type = 'button';
  row2.append(max, theme, note, add);
  host.appendChild(row2);

  const list = el('div', 'list');
  host.appendChild(list);

  async function load() {
    list.textContent = '';
    const { data, error } = await o.sb.rpc('embed_sites_list', { p_league: o.league.id });
    if (error) { list.appendChild(el('div', 'empty', error.message)); return; }
    if (!data || !data.length) {
      list.appendChild(el('div', 'empty',
        'No websites registered. Embeds fall back to whatever their snippet says.'));
      return;
    }
    data.forEach(r => {
      const item = el('div', 'item');
      const mid = el('div');
      mid.appendChild(el('div', 'nm', r.host));
      const bits = [ (KINDS.find(k => k[0] === r.kind) || [, r.kind])[1],
                     r.team_name || 'the whole league' ];
      if (r.max_items) bits.push(r.max_items + ' items');
      if (r.theme) bits.push(r.theme);
      if (r.note) bits.push('“' + r.note + '”');
      mid.appendChild(el('div', 'mt', bits.join(' · ')));
      const sp = el('div', 'sp');
      const del = el('button', 'ep-btn mini', 'remove'); del.type = 'button';
      del.addEventListener('click', async () => {
        del.disabled = true;
        const { error: e2 } = await o.sb.rpc('delete_embed_site', { p_id: r.id });
        if (e2) { del.disabled = false; return o.say(e2.message, 'err'); }
        o.say('Removed ' + r.host + '.', 'ok');
        load();
      });
      sp.appendChild(del);
      item.append(mid, sp);
      list.appendChild(item);
    });
  }

  add.addEventListener('click', async () => {
    if (!hostIn.value.trim()) return o.say('Give the website address.', 'err');
    add.disabled = true;
    const { error } = await o.sb.rpc('set_embed_site', {
      p_league: o.league.id,
      p_host: hostIn.value,
      p_team: team.value || null,
      p_kind: kind.value,
      p_max: max.value ? Number(max.value) : null,
      p_theme: theme.value || null,
      p_note: note.value
    });
    add.disabled = false;
    if (error) return o.say(error.message, 'err');
    o.say('Registered ' + hostIn.value.trim() + '.', 'ok');
    hostIn.value = ''; note.value = ''; max.value = '';
    load();
  });

  load();
}

return { mount };
}));
