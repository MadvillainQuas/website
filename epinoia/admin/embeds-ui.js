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

/* ============================================================================
   NOTIFICATION BUTTONS (docs/notify-embed.md §7).

   The snippet for one button — a club page's, a player page's, a match page's, or one
   that lets visitors pick clubs — and, optionally, the league's own domain: the sites
   that may sign visitors up themselves, the one file those sites upload, and where a
   tap on a notification should open. The snippet names things by slug where they have
   one, so it reads like the page it goes on.
   ============================================================================ */
const EMBED_SRC = 'https://prophesyscouting.co.uk/epinoia/embed.js';
const SW_FILE = "importScripts('https://prophesyscouting.co.uk/epinoia/embed/notify/sw.js');";
const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const attrEsc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/* the snippet for these choices; pure, so the test can pin it */
function notifySnippet(c) {
  const attrs = [['src', EMBED_SRC], ['data-epinoia', 'notify'], ['data-league', c.league]];
  if (c.kind === 'team' && c.team) attrs.push(['data-team', c.team]);
  if (c.kind === 'player' && c.player) attrs.push(['data-player', c.player]);
  if (c.kind === 'game' && c.game) attrs.push(['data-game', c.game]);
  if (c.label) attrs.push(['data-label', c.label]);
  if (c.theme === 'light') attrs.push(['data-theme', 'light']);
  if (c.sw) attrs.push(['data-sw', '/epinoia-sw.js']);
  return '<script ' + attrs.map(([k, v]) => k + '="' + attrEsc(v) + '"').join(' ') + '></script>';
}

/* opts: { host, sb, league, teams, say } */
function mountNotify(o) {
  const host = typeof o.host === 'string' ? document.querySelector(o.host) : o.host;
  if (!host || !o.league) return;
  host.textContent = '';
  const league = o.league;
  const teams = Object.values(o.teams || {}).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  host.appendChild(el('p', 'empty',
    'A button for any page of your own website: a club page’s follows that club, a player page’s that player, ' +
    'a match page’s that game. Visitors need no Epinoia account; the button opens a small Epinoia window where ' +
    'they allow notifications, and it works on any website.'));

  const row1 = el('div', 'row');
  const kind = el('select', 'ep-input'); kind.style.flex = '0 0 170px';
  [['team', 'a club page'], ['player', 'a player page'], ['game', 'a match page'], ['league', 'visitors pick clubs']]
    .forEach(([v, l]) => { const op = el('option', null, l); op.value = v; kind.appendChild(op); });
  const club = el('select', 'ep-input grow');
  teams.forEach(t => { const op = el('option', null, t.name); op.value = t.slug || t.id; club.appendChild(op); });
  const who = el('input', 'ep-input grow'); who.placeholder = 'player’s name'; who.type = 'search';
  const whoPick = el('select', 'ep-input grow');
  const game = el('input', 'ep-input grow'); game.placeholder = 'paste the game’s Epinoia link or id';
  row1.append(kind, club, who, whoPick, game);
  host.appendChild(row1);

  const row2 = el('div', 'row');
  const label = el('input', 'ep-input grow'); label.placeholder = 'button words (optional) — “Follow the Lions”'; label.maxLength = 60;
  const theme = el('select', 'ep-input'); theme.style.flex = '0 0 150px';
  [['dark', 'dark button'], ['light', 'light button']].forEach(([v, l]) => { const op = el('option', null, l); op.value = v; theme.appendChild(op); });
  const ownLab = el('label', 'sw');
  const own = document.createElement('input'); own.type = 'checkbox'; own.disabled = true;
  ownLab.append(own, document.createTextNode(' from our own domain'));
  row2.append(label, theme, ownLab);
  host.appendChild(row2);

  const snipWrap = el('div', 'row');
  const snip = el('pre', 'ep-input grow');
  snip.style.cssText = 'white-space:pre-wrap;word-break:break-all;margin:0;font-size:11px;line-height:1.6';
  const copy = el('button', 'ep-btn', 'copy'); copy.type = 'button';
  snipWrap.append(snip, copy);
  host.appendChild(snipWrap);

  function draw() {
    const k = kind.value;
    club.classList.toggle('hide', k !== 'team');
    who.classList.toggle('hide', k !== 'player');
    whoPick.classList.toggle('hide', k !== 'player' || !whoPick.options.length);
    game.classList.toggle('hide', k !== 'game');
    const gm = (game.value.match(UUID_IN) || [''])[0].toLowerCase();
    snip.textContent = notifySnippet({ league: league.slug, kind: k, team: club.value, player: whoPick.value, game: gm,
                                       label: label.value.trim(), theme: theme.value, sw: own.checked });
  }
  let searchTimer = null;
  who.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      const { data } = await o.sb.rpc('fan_player_search', { p_league: league.id, p_q: who.value.trim() });
      whoPick.textContent = '';
      (data || []).forEach(p => { const op = el('option', null, p.name + ' · ' + p.team_name); op.value = p.id; whoPick.appendChild(op); });
      draw();
    }, 250);
  });
  [kind, club, whoPick, theme, own].forEach(x => x.addEventListener('change', draw));
  [game, label].forEach(x => x.addEventListener('input', draw));
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(snip.textContent); o.say('Snippet copied.', 'ok'); }
    catch (_) { o.say('Select the snippet and copy it.', 'err'); }
  });

  /* ---- the league's own domain ---- */
  host.appendChild(el('div', 'fmt-h', 'On your own domain (optional)'));
  host.appendChild(el('p', 'empty',
    'Notifications can come from your website instead of Epinoia: upload one file called epinoia-sw.js to your site’s ' +
    'root with the line below in it, list the website here, and tick “from our own domain” above. Websites that cannot ' +
    'host a file (Wix, Squarespace) use the Epinoia window, which needs nothing.'));
  const file = el('pre', 'ep-input');
  file.style.cssText = 'white-space:pre-wrap;word-break:break-all;margin:0 0 9px;font-size:11px';
  file.textContent = SW_FILE;
  host.appendChild(file);
  const row3 = el('div', 'row');
  const sites = el('textarea', 'ep-input grow'); sites.rows = 2; sites.placeholder = 'https://www.yourleague.co.uk — one website per line';
  row3.appendChild(sites);
  host.appendChild(row3);
  const row4 = el('div', 'row');
  const gameUrl = el('input', 'ep-input grow'); gameUrl.placeholder = 'match page link, with {game} or {external} — https://yourleague.co.uk/match/{game}';
  const homeUrl = el('input', 'ep-input grow'); homeUrl.placeholder = 'home page for news and tests — https://yourleague.co.uk';
  const save = el('button', 'ep-btn pri', 'save'); save.type = 'button';
  row4.append(gameUrl, homeUrl, save);
  host.appendChild(row4);
  const stats = el('div', 'empty', '');
  host.appendChild(stats);

  async function load() {
    const { data } = await o.sb.from('notify_embeds').select('sites,game_url,home_url').eq('league_id', league.id).maybeSingle();
    sites.value = ((data && data.sites) || []).join('\n');
    gameUrl.value = (data && data.game_url) || '';
    homeUrl.value = (data && data.home_url) || '';
    own.disabled = !((data && data.sites) || []).length;
    if (own.disabled) own.checked = false;
    const { data: s } = await o.sb.rpc('notify_embed_stats', { p_league: league.id });
    stats.textContent = s ? (s.devices + ' browser' + (s.devices === 1 ? '' : 's') + ' follow ' + league.name + ' through its buttons (' +
      s.clubs + ' a club, ' + s.players + ' a player, ' + s.games + ' a game).') : '';
    draw();
  }
  save.addEventListener('click', async () => {
    save.disabled = true;
    const { error } = await o.sb.rpc('set_notify_embed', {
      p_league: league.id,
      p_sites: sites.value.split(/\s+/).map(s => s.trim()).filter(Boolean),
      p_game_url: gameUrl.value.trim() || null,
      p_home_url: homeUrl.value.trim() || null
    });
    save.disabled = false;
    if (error) return o.say(error.message, 'err');
    o.say('Saved.', 'ok');
    load();
  });

  draw();
  load();
}

return { mount, mountNotify, notifySnippet };
}));
